import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// POST /api/admin/reset-overspent - Reset overspent simulations
export async function POST(request: Request) {
  try {
    // Auth check - requires CRON_SECRET
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CRON_SECRET
    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const results = {
      simulationsReset: 0,
      positionsDeleted: 0,
      tradesDeleted: 0,
      details: [] as Array<{ strategy: string; oldCapital: number; positionsRemoved: number }>,
    }

    // Find all overspent simulations (negative capital)
    const overspentSims = await prisma.simulation.findMany({
      where: {
        currentCapital: { lt: 0 },
        status: 'running',
      },
      include: {
        strategy: { select: { name: true } },
        positions: true,
        trades: { where: { exitDate: null } },
      },
    })

    console.log(`Found ${overspentSims.length} overspent simulations`)

    for (const sim of overspentSims) {
      const oldCapital = sim.currentCapital
      const positionCount = sim.positions.length

      // Delete all open positions
      await prisma.position.deleteMany({
        where: { simulationId: sim.id },
      })
      results.positionsDeleted += positionCount

      // Delete all open trades (no exit date)
      const deletedTrades = await prisma.trade.deleteMany({
        where: {
          simulationId: sim.id,
          exitDate: null,
        },
      })
      results.tradesDeleted += deletedTrades.count

      // Reset simulation to initial state
      await prisma.simulation.update({
        where: { id: sim.id },
        data: {
          currentCapital: sim.initialCapital,
          totalPL: 0,
          totalPLPercent: 0,
          tradesCompleted: 0,
          winCount: 0,
          lossCount: 0,
          winRate: 0,
          largestWin: 0,
          largestLoss: 0,
        },
      })

      results.simulationsReset++
      results.details.push({
        strategy: sim.strategy.name,
        oldCapital,
        positionsRemoved: positionCount,
      })
    }

    return NextResponse.json({
      success: true,
      message: `Reset ${results.simulationsReset} overspent simulations`,
      ...results,
    })
  } catch (error) {
    console.error('Reset error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET - Check status of overspent simulations
export async function GET() {
  try {
    const overspent = await prisma.simulation.findMany({
      where: {
        currentCapital: { lt: 0 },
      },
      include: {
        strategy: { select: { name: true } },
        positions: { select: { symbol: true, currentValue: true } },
      },
    })

    return NextResponse.json({
      overspentCount: overspent.length,
      simulations: overspent.map(s => ({
        strategy: s.strategy.name,
        currentCapital: s.currentCapital,
        initialCapital: s.initialCapital,
        deficit: s.initialCapital - s.currentCapital,
        openPositions: s.positions.length,
        positionValue: s.positions.reduce((sum, p) => sum + p.currentValue, 0),
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
