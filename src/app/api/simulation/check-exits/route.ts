import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getQuote } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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
      tradesClosed: 0,
      exits: [] as Array<{ symbol: string; strategy: string; reason: string; pnl: number }>,
      errors: [] as string[],
    }

    // Get ALL positions (this is a lightweight check)
    const positions = await prisma.position.findMany({
      include: { simulation: { include: { strategy: true } } },
      orderBy: { entryDate: 'asc' },
    })

    results.positionsChecked = positions.length

    for (const position of positions) {
      // Time check - keep it fast
      if (Date.now() - startTime > 25000) break

      try {
        // Get current price
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

          await Promise.all([
            prisma.trade.updateMany({
              where: { simulationId: position.simulationId, symbol: position.symbol, exitDate: null },
              data: {
                exitDate: new Date(),
                exitPrice: currentPrice,
                profitLoss,
                profitLossPercent: pnlPercent,
                exitReason,
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

// GET - Quick status check
export async function GET() {
  const positions = await prisma.position.findMany({
    include: { simulation: { include: { strategy: { select: { name: true, exitConditions: true } } } } },
  })

  return NextResponse.json({
    totalPositions: positions.length,
    positions: positions.map(p => {
      const exitConds = p.simulation.strategy.exitConditions as { profitTarget: number; stopLoss: number }
      const pnlPercent = ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100
      return {
        symbol: p.symbol,
        strategy: p.simulation.strategy.name,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        pnlPercent: pnlPercent.toFixed(2),
        target: exitConds.profitTarget,
        stopLoss: exitConds.stopLoss,
        distanceToTarget: (exitConds.profitTarget - pnlPercent).toFixed(2),
        distanceToStop: (pnlPercent + exitConds.stopLoss).toFixed(2),
      }
    }),
  })
}
