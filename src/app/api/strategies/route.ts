import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import type { Strategy, Simulation } from '@prisma/client'

type StrategyWithSimulations = Strategy & { simulations: Simulation[] }

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const strategies = await prisma.strategy.findMany({
      include: {
        simulations: {
          where: { status: 'running' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    })

    // Format response with simulation data
    const formatted = strategies.map((strategy: StrategyWithSimulations) => {
      const simulation = strategy.simulations[0]
      return {
        id: strategy.id,
        name: strategy.name,
        description: strategy.description,
        whitepaperTitle: strategy.whitepaperTitle,
        whitepaperAuthor: strategy.whitepaperAuthor,
        whitepaperYear: strategy.whitepaperYear,
        positionSize: strategy.positionSize,
        status: strategy.status,
        // Simulation metrics (if running)
        simulation: simulation ? {
          id: simulation.id,
          status: simulation.status,
          currentCapital: simulation.currentCapital,
          totalPL: simulation.totalPL,
          totalPLPercent: simulation.totalPLPercent,
          tradesCompleted: simulation.tradesCompleted,
          tradesLimit: simulation.tradesLimit,
          winCount: simulation.winCount,
          lossCount: simulation.lossCount,
          winRate: simulation.winRate,
        } : null,
      }
    })

    return NextResponse.json({ strategies: formatted })
  } catch (error) {
    console.error('Failed to fetch strategies:', error)
    return NextResponse.json(
      { error: 'Failed to fetch strategies' },
      { status: 500 }
    )
  }
}
