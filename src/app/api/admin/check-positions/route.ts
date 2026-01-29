import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/admin/check-positions - Check position P&L vs exit conditions
export async function GET() {
  try {
    // Get sample positions with their strategy exit conditions
    const positions = await prisma.position.findMany({
      take: 20,
      orderBy: { unrealizedPLPercent: 'desc' },
      include: {
        simulation: {
          include: {
            strategy: {
              select: { name: true, exitConditions: true },
            },
          },
        },
      },
    })

    const analysis = positions.map(pos => {
      const exitConds = pos.simulation.strategy.exitConditions as {
        profitTarget?: number
        stopLoss?: number
      }

      return {
        symbol: pos.symbol,
        strategy: pos.simulation.strategy.name,
        entryPrice: pos.entryPrice,
        currentPrice: pos.currentPrice,
        plPercent: pos.unrealizedPLPercent.toFixed(2) + '%',
        profitTarget: exitConds.profitTarget ? exitConds.profitTarget + '%' : 'not set',
        stopLoss: exitConds.stopLoss ? '-' + exitConds.stopLoss + '%' : 'not set',
        shouldExit: exitConds.profitTarget && pos.unrealizedPLPercent >= exitConds.profitTarget
          ? 'YES - PROFIT TARGET'
          : exitConds.stopLoss && pos.unrealizedPLPercent <= -exitConds.stopLoss
            ? 'YES - STOP LOSS'
            : 'NO',
        distanceToTarget: exitConds.profitTarget
          ? (exitConds.profitTarget - pos.unrealizedPLPercent).toFixed(2) + '% away'
          : 'N/A',
      }
    })

    // Summary stats
    const totalPositions = await prisma.position.count()
    const avgPL = positions.reduce((sum, p) => sum + p.unrealizedPLPercent, 0) / positions.length

    // Count positions at various P&L levels
    const allPositions = await prisma.position.findMany({
      select: { unrealizedPLPercent: true },
    })

    const plDistribution = {
      above5pct: allPositions.filter(p => p.unrealizedPLPercent >= 5).length,
      above0pct: allPositions.filter(p => p.unrealizedPLPercent >= 0 && p.unrealizedPLPercent < 5).length,
      below0pct: allPositions.filter(p => p.unrealizedPLPercent < 0 && p.unrealizedPLPercent > -2).length,
      belowMinus2pct: allPositions.filter(p => p.unrealizedPLPercent <= -2).length,
    }

    return NextResponse.json({
      totalPositions,
      avgPLPercent: avgPL.toFixed(2) + '%',
      plDistribution,
      samplePositions: analysis,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
