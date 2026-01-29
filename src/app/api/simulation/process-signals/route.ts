import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getQuote } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Determine market session based on current time (EST/EDT)
function getMarketSession(): string {
  const now = new Date()
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const hours = estTime.getHours()
  const minutes = estTime.getMinutes()
  const timeInMinutes = hours * 60 + minutes

  if (timeInMinutes >= 240 && timeInMinutes < 570) return 'PRE_MARKET'
  if (timeInMinutes >= 570 && timeInMinutes < 960) return 'REGULAR'
  if (timeInMinutes >= 960 && timeInMinutes < 1200) return 'AFTER_HOURS'
  return 'CLOSED'
}

// Process in batches to avoid timeout (runs every 5 min)
const MAX_SIGNALS_PER_RUN = 30
const MAX_EXITS_PER_RUN = 50  // Increased to close more positions per run

// Strategy key to database ID mapping - these ARE the actual strategy IDs in the database
const STRATEGY_KEY_MAP: Record<string, string> = {
  'rsi_stochastic_oversold': 'strat_rsi_stochastic_double_oversold',
  'adx_trend_pullback': 'strat_adx_trend_+_ma_pullback',
  'bollinger_squeeze': 'strat_bollinger_squeeze_breakout',
  'macd_bb_volume': 'strat_macd_bb_volume_triple_filter',
  'stochastic_rsi_sync': 'strat_stochastic_rsi_momentum_sync',
  'rsi_mean_reversion': 'strat_rsi_mean_reversion',
  'macd_momentum': 'strat_macd_momentum_crossover',
  'volume_breakout': 'strat_volume_breakout_scanner',
  // Trend-following strategies (CUID format)
  '52_week_high_breakout': 'cmjrkxxny00008sfmhyrvkbcs',
  'adx_trend_rider': 'cmjrkxxtk00018sfm4vkptvmd',
  'triple_ma_trend': 'cmjrkxxyc00028sfmj434l2m0',
  'momentum_persistence': 'cmjrkxy3900038sfm5l2ldi05',
}

// Reverse lookup: get strategy key from strategy ID
function getStrategyKeyById(strategyId: string): string | undefined {
  return Object.entries(STRATEGY_KEY_MAP).find(([_, id]) => id === strategyId)?.[0]
}

// POST /api/simulation/process-signals - Process screener signals into trades
export async function POST(request: Request) {
  const startTime = Date.now()
  let cronLogId: number | null = null

  try {
    // Auth check - allow browser calls (no auth header) or valid cron calls
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CRON_SECRET
    // Only reject if auth header is present but wrong
    if (authHeader && expectedToken && authHeader !== `Bearer ${expectedToken}`) {
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

    // STEP 1: Check exits for existing positions (prioritize most profitable)
    const positions = await prisma.position.findMany({
      include: { simulation: { include: { strategy: true } } },
      take: MAX_EXITS_PER_RUN,
      orderBy: { unrealizedPLPercent: 'desc' },  // Check most profitable first
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
          const exitSession = getMarketSession()
          await Promise.all([
            prisma.trade.updateMany({
              where: { simulationId: position.simulationId, symbol: position.symbol, exitDate: null },
              data: { exitDate: new Date(), exitPrice: currentPrice, profitLoss, profitLossPercent: pnlPercent, exitReason, exitSession },
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

    // STEP 2: Process signals STRATEGY BY STRATEGY (ensures all strategies get checked)
    // Get all strategies with running simulations that have capital
    const strategiesWithCapital = await prisma.strategy.findMany({
      where: {
        simulations: {
          some: {
            status: 'running',
            currentCapital: { gte: 100 },
          },
        },
      },
      include: {
        simulations: {
          where: { status: 'running' },
          take: 1,
        },
      },
    })

    console.log(`Found ${strategiesWithCapital.length} strategies with capital >= $100`)
    console.log(`Strategy key mapping has ${Object.keys(STRATEGY_KEY_MAP).length} entries`)

    // Process up to 5 signals per strategy (ensures fair distribution)
    const SIGNALS_PER_STRATEGY = 5

    for (const strategy of strategiesWithCapital) {
      // Time check
      if (Date.now() - startTime > 50000) {
        console.log('Time limit approaching, stopping')
        break
      }

      const simulation = strategy.simulations[0]
      if (!simulation) continue

      // Find the strategy key for this strategy ID
      const strategyKey = getStrategyKeyById(strategy.id)
      if (!strategyKey) {
        console.log(`No screener key for strategy: ${strategy.name} (id: ${strategy.id})`)
        continue
      }

      // Get signals for THIS strategy (look back 14 days for signals)
      const signals = await prisma.screenerSignal.findMany({
        where: {
          processed: false,
          strategyKey: strategyKey,
          scannedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { scannedAt: 'desc' },
        take: SIGNALS_PER_STRATEGY,
      })

      console.log(`${strategy.name}: ${signals.length} pending signals, $${simulation.currentCapital.toFixed(0)} capital`)

      for (const signal of signals) {
        if (Date.now() - startTime > 50000) break

        try {
          // Check trade limit - DON'T mark as processed, maybe another strategy can use it
          if (simulation.tradesCompleted >= simulation.tradesLimit) {
            results.skipReasons['trade_limit_reached'] = (results.skipReasons['trade_limit_reached'] || 0) + 1
            continue
          }

          // Check existing position - DON'T mark as processed, signal stays available
          const existingPosition = await prisma.position.findUnique({
            where: { simulationId_symbol: { simulationId: simulation.id, symbol: signal.symbol } },
          })

          if (existingPosition) {
            results.skipReasons['already_holding'] = (results.skipReasons['already_holding'] || 0) + 1
            continue
          }

          // Validate price - DON'T mark as processed, price may update later
          const price = signal.price
          if (!price || price < 25 || price > 100) {
            results.skipReasons['invalid_price'] = (results.skipReasons['invalid_price'] || 0) + 1
            continue
          }

          // Re-fetch simulation for current capital
          const currentSim = await prisma.simulation.findUnique({
            where: { id: simulation.id },
            select: { currentCapital: true },
          })
          if (!currentSim || currentSim.currentCapital < 100) {
            results.skipReasons['insufficient_capital'] = (results.skipReasons['insufficient_capital'] || 0) + 1
            break // Stop processing this strategy - it's out of money (signal stays unprocessed)
          }

          const positionValue = currentSim.currentCapital * (strategy.positionSize / 100)
          const targetValue = Math.max(positionValue, 100)
          const shares = Math.max(1, Math.floor(targetValue / price))
          const totalCost = shares * price

          if (totalCost > currentSim.currentCapital) {
            results.skipReasons['cost_exceeds_capital'] = (results.skipReasons['cost_exceeds_capital'] || 0) + 1
            break // Stop this strategy (signal stays unprocessed for retry)
          }

          // Execute trade
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
          // On error, DON'T mark signal as processed - it can be retried
          results.errors.push(`Signal ${signal.symbol}: ${err instanceof Error ? err.message : 'Unknown'}`)
        }
      }
    }

    // Log unmapped signals for debugging (but DON'T mark them processed - they may be valid)
    const unmappedSignals = await prisma.screenerSignal.count({
      where: {
        processed: false,
        strategyKey: { notIn: Object.keys(STRATEGY_KEY_MAP) },
      },
    })
    if (unmappedSignals > 0) {
      console.log(`Warning: ${unmappedSignals} signals have unmapped strategy keys`)
      results.skipReasons['unmapped_strategy_keys'] = unmappedSignals
    }

    // Cleanup: Mark very old signals (>30 days) as processed to prevent infinite buildup
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const staleSignals = await prisma.screenerSignal.updateMany({
      where: {
        processed: false,
        scannedAt: { lt: thirtyDaysAgo },
      },
      data: { processed: true },
    })
    if (staleSignals.count > 0) {
      console.log(`Cleaned up ${staleSignals.count} stale signals (>30 days old)`)
      results.skipReasons['stale_signals_cleaned'] = staleSignals.count
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
