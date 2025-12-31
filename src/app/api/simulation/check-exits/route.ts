import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getQuote } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Increased to handle all ~250 positions

// Determine market session based on current time (EST/EDT)
function getMarketSession(): string {
  const now = new Date()
  // Convert to Eastern Time
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const hours = estTime.getHours()
  const minutes = estTime.getMinutes()
  const timeInMinutes = hours * 60 + minutes

  // Pre-market: 4:00 AM - 9:30 AM EST (240 - 570 minutes)
  if (timeInMinutes >= 240 && timeInMinutes < 570) {
    return 'PRE_MARKET'
  }
  // Regular: 9:30 AM - 4:00 PM EST (570 - 960 minutes)
  if (timeInMinutes >= 570 && timeInMinutes < 960) {
    return 'REGULAR'
  }
  // After-hours: 4:00 PM - 8:00 PM EST (960 - 1200 minutes)
  if (timeInMinutes >= 960 && timeInMinutes < 1200) {
    return 'AFTER_HOURS'
  }
  // Outside trading hours
  return 'CLOSED'
}

// Lightweight endpoint - ONLY checks exits on existing positions
// No signal processing, no trade opening
export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    // Auth check
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CRON_SECRET
    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const results = {
      positionsChecked: 0,
      positionsUpdated: 0,
      positionsSkipped: 0, // Skipped due to failed quote
      tradesClosed: 0,
      uniqueSymbols: 0,
      quotesFetched: 0,
      quotesFailed: 0,
      failedSymbols: [] as string[],
      marketSession: getMarketSession(),
      exits: [] as Array<{ symbol: string; strategy: string; reason: string; pnl: number; session: string }>,
      errors: [] as string[],
    }

    // Get ALL positions and shuffle for fair coverage
    const allPositions = await prisma.position.findMany({
      include: { simulation: { include: { strategy: true } } },
    })

    // Shuffle positions so different ones get checked each run
    const positions = [...allPositions].sort(() => Math.random() - 0.5)

    results.positionsChecked = positions.length

    // Get unique symbols to fetch quotes for
    const uniqueSymbols = [...new Set(positions.map(p => p.symbol))]

    // Fetch quotes in parallel (batch of 10 at a time to speed up)
    const quoteCache = new Map<string, number>()
    const failedQuotes: string[] = []
    const BATCH_SIZE = 10
    const QUOTE_TIME_LIMIT = 40000 // 40 seconds for quote fetching

    console.log(`Fetching quotes for ${uniqueSymbols.length} unique symbols...`)

    for (let i = 0; i < uniqueSymbols.length && Date.now() - startTime < QUOTE_TIME_LIMIT; i += BATCH_SIZE) {
      const batch = uniqueSymbols.slice(i, i + BATCH_SIZE)
      const quotePromises = batch.map(async (symbol) => {
        try {
          const quote = await getQuote(symbol)
          if (quote && quote.c > 0) {
            quoteCache.set(symbol, quote.c)
          } else {
            failedQuotes.push(`${symbol}:no_price`)
          }
        } catch (err) {
          failedQuotes.push(`${symbol}:${err instanceof Error ? err.message : 'error'}`)
        }
      })
      await Promise.all(quotePromises)
      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < uniqueSymbols.length) {
        await new Promise(r => setTimeout(r, 100))
      }
    }

    results.uniqueSymbols = uniqueSymbols.length
    results.quotesFetched = quoteCache.size
    results.quotesFailed = failedQuotes.length
    results.failedSymbols = failedQuotes.slice(0, 20) // Show first 20 failures
    if (failedQuotes.length > 0) {
      console.log(`Failed to fetch ${failedQuotes.length} quotes: ${failedQuotes.slice(0, 10).join(', ')}`)
    }
    console.log(`Fetched ${quoteCache.size}/${uniqueSymbols.length} quotes in ${Date.now() - startTime}ms`)

    const PROCESS_TIME_LIMIT = 55000 // 55 seconds total (leave 5s buffer)

    for (const position of positions) {
      // Time check
      if (Date.now() - startTime > PROCESS_TIME_LIMIT) break

      try {
        // Only process if we have a fresh quote - skip positions where quote fetch failed
        const freshPrice = quoteCache.get(position.symbol)
        if (!freshPrice) {
          // No fresh quote - skip this position entirely (don't update with stale data)
          results.positionsSkipped++
          continue
        }

        const currentPrice = freshPrice

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
          const exitSession = getMarketSession()

          await Promise.all([
            prisma.trade.updateMany({
              where: { simulationId: position.simulationId, symbol: position.symbol, exitDate: null },
              data: {
                exitDate: new Date(),
                exitPrice: currentPrice,
                profitLoss,
                profitLossPercent: pnlPercent,
                exitReason,
                exitSession,
                holdTimeHours: (Date.now() - new Date(position.entryDate).getTime()) / (1000 * 60 * 60),
              },
            }),
            prisma.position.delete({ where: { id: position.id } }),
            prisma.simulation.update({
              where: { id: position.simulationId },
              data: {
                currentCapital: { increment: position.shares * currentPrice },
                totalPL: { increment: profitLoss },
                totalPLPercent: ((position.simulation.totalPL + profitLoss) / position.simulation.initialCapital) * 100,
                tradesCompleted: { increment: 1 },
                winCount: isWin ? { increment: 1 } : undefined,
                lossCount: !isWin ? { increment: 1 } : undefined,
                winRate: (totalWins / totalTrades) * 100,
              },
            }),
          ])

          results.tradesClosed++
          results.exits.push({
            symbol: position.symbol,
            strategy: position.simulation.strategy.name,
            reason: exitReason,
            pnl: profitLoss,
            session: exitSession,
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
        results.errors.push(`${position.symbol}: ${err instanceof Error ? err.message : 'Unknown'}`)
      }
    }

    return NextResponse.json({
      success: true,
      processingTimeMs: Date.now() - startTime,
      ...results,
    })
  } catch (error) {
    console.error('Check exits error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET - Quick status check with update timestamps
export async function GET() {
  const positions = await prisma.position.findMany({
    include: { simulation: { include: { strategy: { select: { name: true, exitConditions: true } } } } },
    orderBy: { updatedAt: 'desc' },
  })

  // Calculate aggregate stats
  const totalCurrentValue = positions.reduce((sum, p) => sum + p.currentValue, 0)
  const mostRecentUpdate = positions.length > 0 ? positions[0].updatedAt : null
  const oldestUpdate = positions.length > 0 ? positions[positions.length - 1].updatedAt : null

  return NextResponse.json({
    totalPositions: positions.length,
    totalCurrentValue: totalCurrentValue.toFixed(2),
    mostRecentUpdate: mostRecentUpdate?.toISOString(),
    oldestUpdate: oldestUpdate?.toISOString(),
    positions: positions.map(p => {
      const exitConds = p.simulation.strategy.exitConditions as { profitTarget: number; stopLoss: number }
      const pnlPercent = ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100
      return {
        symbol: p.symbol,
        strategy: p.simulation.strategy.name,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        currentValue: p.currentValue.toFixed(2),
        pnlPercent: pnlPercent.toFixed(2),
        target: exitConds.profitTarget,
        stopLoss: exitConds.stopLoss,
        distanceToTarget: (exitConds.profitTarget - pnlPercent).toFixed(2),
        distanceToStop: (pnlPercent + exitConds.stopLoss).toFixed(2),
        updatedAt: p.updatedAt.toISOString(),
      }
    }),
  })
}
