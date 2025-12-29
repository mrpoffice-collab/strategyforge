import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getQuote } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Process in batches to avoid timeout (runs every 5 min)
const MAX_SIGNALS_PER_RUN = 30
const MAX_EXITS_PER_RUN = 15

// Strategy key to database ID mapping
const STRATEGY_KEY_MAP: Record<string, string> = {
  'rsi_stochastic_oversold': 'strat_rsi_stochastic_double_oversold',
  'adx_trend_pullback': 'strat_adx_trend_+_ma_pullback',
  'bollinger_squeeze': 'strat_bollinger_squeeze_breakout',
  'macd_bb_volume': 'strat_macd_bb_volume_triple_filter',
  'stochastic_rsi_sync': 'strat_stochastic_rsi_momentum_sync',
  'rsi_mean_reversion': 'strat_rsi_mean_reversion',
  'macd_momentum': 'strat_macd_momentum_crossover',
  'volume_breakout': 'strat_volume_breakout_scanner',
}

// POST /api/simulation/process-signals - Process screener signals into trades
export async function POST(request: Request) {
  const startTime = Date.now()
  let cronLogId: number | null = null

  try {
    // Auth check
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CRON_SECRET
    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get initial state for logging
    const [pendingSignals, totalPositions] = await Promise.all([
      prisma.screenerSignal.count({ where: { processed: false } }),
      prisma.position.count(),
    ])

    // Create cron log entry
    const cronLog = await prisma.cronLog.create({
      data: {
        runType: 'process',
        pendingSignals,
        totalPositions,
      },
    })
    cronLogId = cronLog.id
    console.log(`[CronLog #${cronLogId}] Started - ${pendingSignals} pending signals, ${totalPositions} positions`)

    const results = {
      signalsProcessed: 0,
      tradesOpened: 0,
      tradesClosed: 0,
      positionsUpdated: 0,
      errors: [] as string[],
      trades: [] as Array<{ symbol: string; strategy: string; action: string; shares: number; value: number }>,
      skipReasons: {} as Record<string, number>, // Track why signals were skipped
    }

    // STEP 1: Check exits for existing positions (limited batch)
    const positions = await prisma.position.findMany({
      include: { simulation: { include: { strategy: true } } },
      take: MAX_EXITS_PER_RUN,
      orderBy: { entryDate: 'asc' },
    })

    for (const position of positions) {
      // Time check - leave buffer for signal processing
      if (Date.now() - startTime > 25000) break

      try {
        // Use screener's cached price from position, try live quote as fallback
        let currentPrice = position.currentPrice
        try {
          const quote = await getQuote(position.symbol)
          if (quote && quote.c > 0) currentPrice = quote.c
        } catch {
          // Use cached price if API fails
        }

        const exitConds = position.simulation.strategy.exitConditions as {
          profitTarget: number
          stopLoss: number
        }

        const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100
        let shouldExit = false
        let exitReason = ''

        if (pnlPercent >= exitConds.profitTarget) {
          shouldExit = true
          exitReason = 'PROFIT_TARGET'
        } else if (pnlPercent <= -exitConds.stopLoss) {
          shouldExit = true
          exitReason = 'STOP_LOSS'
        }

        if (shouldExit) {
          const profitLoss = (currentPrice - position.entryPrice) * position.shares
          const isWin = profitLoss >= 0
          const totalTrades = position.simulation.tradesCompleted + 1
          const totalWins = position.simulation.winCount + (isWin ? 1 : 0)

          // Batch all updates together
          await Promise.all([
            prisma.trade.updateMany({
              where: { simulationId: position.simulationId, symbol: position.symbol, exitDate: null },
              data: { exitDate: new Date(), exitPrice: currentPrice, profitLoss, profitLossPercent: pnlPercent, exitReason },
            }),
            prisma.position.delete({ where: { id: position.id } }),
            prisma.simulation.update({
              where: { id: position.simulationId },
              data: {
                currentCapital: { increment: position.shares * currentPrice },
                totalPL: { increment: profitLoss },
                tradesCompleted: { increment: 1 },
                winCount: isWin ? { increment: 1 } : undefined,
                lossCount: !isWin ? { increment: 1 } : undefined,
                winRate: (totalWins / totalTrades) * 100,
              },
            }),
          ])

          results.tradesClosed++
          results.trades.push({
            symbol: position.symbol,
            strategy: position.simulation.strategy.name,
            action: exitReason,
            shares: position.shares,
            value: position.shares * currentPrice,
          })
        } else {
          // Update position's current price
          await prisma.position.update({
            where: { id: position.id },
            data: {
              currentPrice,
              currentValue: position.shares * currentPrice,
              unrealizedPL: (currentPrice - position.entryPrice) * position.shares,
              unrealizedPLPercent: pnlPercent,
            },
          })
          results.positionsUpdated++
        }
      } catch (err) {
        results.errors.push(`Exit check ${position.symbol}: ${err instanceof Error ? err.message : 'Unknown'}`)
      }
    }

    // STEP 2: Process unprocessed screener signals (limited batch)
    const signals = await prisma.screenerSignal.findMany({
      where: {
        processed: false,
        scannedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { scannedAt: 'desc' },
      take: MAX_SIGNALS_PER_RUN,
    })

    console.log(`Processing ${signals.length} screener signals (batch of ${MAX_SIGNALS_PER_RUN})`)

    for (const signal of signals) {
      // Time check - ensure we don't timeout
      if (Date.now() - startTime > 50000) {
        console.log('Time limit approaching, stopping signal processing')
        break
      }

      try {
        const strategyId = STRATEGY_KEY_MAP[signal.strategyKey]
        if (!strategyId) {
          results.skipReasons['no_strategy_mapping'] = (results.skipReasons['no_strategy_mapping'] || 0) + 1
          await prisma.screenerSignal.update({ where: { id: signal.id }, data: { processed: true } })
          continue
        }

        const strategy = await prisma.strategy.findUnique({
          where: { id: strategyId },
          include: { simulations: { where: { status: 'running' }, take: 1 } },
        })

        if (!strategy || strategy.simulations.length === 0) {
          results.skipReasons['no_running_simulation'] = (results.skipReasons['no_running_simulation'] || 0) + 1
          await prisma.screenerSignal.update({ where: { id: signal.id }, data: { processed: true } })
          continue
        }

        const simulation = strategy.simulations[0]

        if (simulation.tradesCompleted >= simulation.tradesLimit) {
          results.skipReasons['trade_limit_reached'] = (results.skipReasons['trade_limit_reached'] || 0) + 1
          await prisma.screenerSignal.update({ where: { id: signal.id }, data: { processed: true } })
          continue
        }

        // Check existing position
        const existingPosition = await prisma.position.findUnique({
          where: { simulationId_symbol: { simulationId: simulation.id, symbol: signal.symbol } },
        })

        if (existingPosition) {
          results.skipReasons['already_holding'] = (results.skipReasons['already_holding'] || 0) + 1
          await prisma.screenerSignal.update({ where: { id: signal.id }, data: { processed: true } })
          continue
        }

        // Use screener's price (already validated) - skip expensive API call
        const price = signal.price
        if (!price || price < 25 || price > 100) {
          results.skipReasons['invalid_price'] = (results.skipReasons['invalid_price'] || 0) + 1
          await prisma.screenerSignal.update({ where: { id: signal.id }, data: { processed: true } })
          continue
        }

        // Re-fetch simulation for current capital (prevent overspending)
        const currentSim = await prisma.simulation.findUnique({
          where: { id: simulation.id },
          select: { currentCapital: true },
        })
        if (!currentSim || currentSim.currentCapital < 100) {
          results.skipReasons['insufficient_capital'] = (results.skipReasons['insufficient_capital'] || 0) + 1
          await prisma.screenerSignal.update({ where: { id: signal.id }, data: { processed: true } })
          continue
        }

        const positionValue = currentSim.currentCapital * (strategy.positionSize / 100)
        const targetValue = Math.max(positionValue, 100)
        const shares = Math.max(1, Math.floor(targetValue / price))
        const totalCost = shares * price

        // CAPITAL CHECK: Never spend more than available
        if (totalCost > currentSim.currentCapital) {
          results.skipReasons['cost_exceeds_capital'] = (results.skipReasons['cost_exceeds_capital'] || 0) + 1
          await prisma.screenerSignal.update({ where: { id: signal.id }, data: { processed: true } })
          continue
        }

        // Create position, trade, update capital, mark processed - all at once
        await Promise.all([
          prisma.position.create({
            data: {
              simulationId: simulation.id,
              symbol: signal.symbol,
              shares,
              entryPrice: price,
              entryDate: new Date(),
              currentPrice: price,
              currentValue: totalCost,
              unrealizedPL: 0,
              unrealizedPLPercent: 0,
            },
          }),
          prisma.trade.create({
            data: {
              simulationId: simulation.id,
              strategyId: strategy.id,
              symbol: signal.symbol,
              side: 'BUY',
              entryDate: new Date(),
              entryPrice: price,
              shares,
              totalCost,
              indicatorsAtEntry: signal.indicators ?? undefined,
            },
          }),
          prisma.simulation.update({
            where: { id: simulation.id },
            data: { currentCapital: { decrement: totalCost } },
          }),
          prisma.screenerSignal.update({
            where: { id: signal.id },
            data: { processed: true },
          }),
        ])

        results.tradesOpened++
        results.trades.push({
          symbol: signal.symbol,
          strategy: strategy.name,
          action: 'BUY',
          shares,
          value: totalCost,
        })
        results.signalsProcessed++
      } catch (err) {
        results.errors.push(`Signal ${signal.symbol}: ${err instanceof Error ? err.message : 'Unknown'}`)
        // Mark as processed to avoid retrying broken signals
        try {
          await prisma.screenerSignal.update({ where: { id: signal.id }, data: { processed: true } })
        } catch {}
      }
    }

    const durationMs = Date.now() - startTime

    // Update cron log with results
    if (cronLogId) {
      await prisma.cronLog.update({
        where: { id: cronLogId },
        data: {
          completedAt: new Date(),
          durationMs,
          signalsProcessed: results.signalsProcessed,
          tradesOpened: results.tradesOpened,
          tradesClosed: results.tradesClosed,
          positionsUpdated: results.positionsUpdated,
          success: true,
          errorMessage: results.errors.length > 0 ? results.errors.join('; ') : null,
        },
      })
      console.log(`[CronLog #${cronLogId}] Completed in ${durationMs}ms - ${results.tradesOpened} opened, ${results.tradesClosed} closed`)
    }

    return NextResponse.json({
      success: true,
      cronLogId,
      processingTimeMs: durationMs,
      ...results,
    })
  } catch (error) {
    console.error('Process signals error:', error)

    // Log failure
    if (cronLogId) {
      try {
        await prisma.cronLog.update({
          where: { id: cronLogId },
          data: {
            completedAt: new Date(),
            durationMs: Date.now() - startTime,
            success: false,
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        })
      } catch {}
    }

    return NextResponse.json(
      { success: false, cronLogId, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET - Check status of signals and recent cron logs
export async function GET() {
  try {
    const [totalSignals, unprocessedSignals, recentTrades, recentLogs] = await Promise.all([
      prisma.screenerSignal.count(),
      prisma.screenerSignal.count({ where: { processed: false } }),
      prisma.trade.findMany({
        take: 10,
        orderBy: { entryDate: 'desc' },
        include: { strategy: { select: { name: true } } },
      }),
      prisma.cronLog.findMany({
        take: 20,
        orderBy: { startedAt: 'desc' },
      }),
    ])

    return NextResponse.json({
      totalSignals,
      unprocessedSignals,
      recentTrades: recentTrades.map(t => ({
        symbol: t.symbol,
        strategy: t.strategy.name,
        entryPrice: t.entryPrice,
        shares: t.shares,
        totalCost: t.totalCost,
        status: t.exitDate ? 'CLOSED' : 'OPEN',
        pnl: t.profitLoss,
      })),
      cronLogs: recentLogs.map(log => ({
        id: log.id,
        runType: log.runType,
        startedAt: log.startedAt,
        completedAt: log.completedAt,
        durationMs: log.durationMs,
        signalsProcessed: log.signalsProcessed,
        tradesOpened: log.tradesOpened,
        tradesClosed: log.tradesClosed,
        positionsUpdated: log.positionsUpdated,
        pendingSignals: log.pendingSignals,
        totalPositions: log.totalPositions,
        success: log.success,
        error: log.errorMessage,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
