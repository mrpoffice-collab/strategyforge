import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getQuote } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
  try {
    // Auth check
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CRON_SECRET
    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const results = {
      signalsProcessed: 0,
      tradesOpened: 0,
      tradesClosed: 0,
      errors: [] as string[],
      trades: [] as Array<{ symbol: string; strategy: string; action: string; shares: number; value: number }>,
    }

    // STEP 1: Check exits for all existing positions first
    const positions = await prisma.position.findMany({
      include: { simulation: { include: { strategy: true } } },
    })

    for (const position of positions) {
      try {
        const quote = await getQuote(position.symbol)
        if (!quote || quote.c === 0) continue

        const currentPrice = quote.c
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

          // Update trade record
          await prisma.trade.updateMany({
            where: {
              simulationId: position.simulationId,
              symbol: position.symbol,
              exitDate: null,
            },
            data: {
              exitDate: new Date(),
              exitPrice: currentPrice,
              profitLoss,
              profitLossPercent: pnlPercent,
              exitReason,
            },
          })

          // Delete position
          await prisma.position.delete({ where: { id: position.id } })

          // Update simulation stats
          const totalTrades = position.simulation.tradesCompleted + 1
          const totalWins = position.simulation.winCount + (isWin ? 1 : 0)

          await prisma.simulation.update({
            where: { id: position.simulationId },
            data: {
              currentCapital: { increment: position.shares * currentPrice },
              totalPL: { increment: profitLoss },
              tradesCompleted: { increment: 1 },
              winCount: isWin ? { increment: 1 } : undefined,
              lossCount: !isWin ? { increment: 1 } : undefined,
              winRate: (totalWins / totalTrades) * 100,
            },
          })

          results.tradesClosed++
          results.trades.push({
            symbol: position.symbol,
            strategy: position.simulation.strategy.name,
            action: exitReason,
            shares: position.shares,
            value: position.shares * currentPrice,
          })
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 200))
      } catch (err) {
        results.errors.push(`Exit check ${position.symbol}: ${err instanceof Error ? err.message : 'Unknown'}`)
      }
    }

    // STEP 2: Process unprocessed screener signals
    const signals = await prisma.screenerSignal.findMany({
      where: {
        processed: false,
        scannedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
      },
      orderBy: { scannedAt: 'desc' },
    })

    console.log(`Processing ${signals.length} screener signals`)

    for (const signal of signals) {
      try {
        // Map screener strategy key to database strategy ID
        const strategyId = STRATEGY_KEY_MAP[signal.strategyKey]
        if (!strategyId) {
          results.errors.push(`Unknown strategy key: ${signal.strategyKey}`)
          continue
        }

        // Get strategy with running simulation
        const strategy = await prisma.strategy.findUnique({
          where: { id: strategyId },
          include: {
            simulations: {
              where: { status: 'running' },
              take: 1,
            },
          },
        })

        if (!strategy || strategy.simulations.length === 0) {
          continue // Strategy not active or no running simulation
        }

        const simulation = strategy.simulations[0]

        // Skip if simulation has reached trade limit
        if (simulation.tradesCompleted >= simulation.tradesLimit) {
          continue
        }

        // Check if we already have a position in this symbol
        const existingPosition = await prisma.position.findUnique({
          where: {
            simulationId_symbol: {
              simulationId: simulation.id,
              symbol: signal.symbol,
            },
          },
        })

        if (existingPosition) {
          // Mark signal as processed
          await prisma.screenerSignal.update({
            where: { id: signal.id },
            data: { processed: true },
          })
          continue
        }

        // Get current price
        const quote = await getQuote(signal.symbol)
        const price = (quote && quote.c > 0) ? quote.c : signal.price
        if (!price || price < 25 || price > 100) {
          continue
        }

        // FIXED POSITION SIZING: ~$200 per trade (10% of $2000)
        // positionSize is a percentage (e.g., 10 = 10%)
        const positionValue = simulation.currentCapital * (strategy.positionSize / 100)

        // Ensure minimum position value of $100
        const targetValue = Math.max(positionValue, 100)

        // Calculate shares (must buy at least 1 share)
        const shares = Math.max(1, Math.floor(targetValue / price))
        const totalCost = shares * price

        // Check if we have enough capital
        if (totalCost > simulation.currentCapital) {
          results.errors.push(`${signal.symbol}: Insufficient capital ($${simulation.currentCapital.toFixed(2)} < $${totalCost.toFixed(2)})`)
          continue
        }

        // Create position
        await prisma.position.create({
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
        })

        // Create trade record
        await prisma.trade.create({
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
        })

        // Update simulation capital
        await prisma.simulation.update({
          where: { id: simulation.id },
          data: { currentCapital: { decrement: totalCost } },
        })

        // Mark signal as processed
        await prisma.screenerSignal.update({
          where: { id: signal.id },
          data: { processed: true },
        })

        results.tradesOpened++
        results.trades.push({
          symbol: signal.symbol,
          strategy: strategy.name,
          action: 'BUY',
          shares,
          value: totalCost,
        })

        results.signalsProcessed++

        // Rate limit
        await new Promise(r => setTimeout(r, 500))
      } catch (err) {
        results.errors.push(`Signal ${signal.symbol}: ${err instanceof Error ? err.message : 'Unknown'}`)
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error) {
    console.error('Process signals error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET - Check status of signals
export async function GET() {
  try {
    const [totalSignals, unprocessedSignals, recentTrades] = await Promise.all([
      prisma.screenerSignal.count(),
      prisma.screenerSignal.count({ where: { processed: false } }),
      prisma.trade.findMany({
        take: 10,
        orderBy: { entryDate: 'desc' },
        include: { strategy: { select: { name: true } } },
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
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
