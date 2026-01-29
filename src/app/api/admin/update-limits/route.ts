import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// POST /api/admin/update-limits - Update trade limit for all running simulations
export async function POST() {
  try {
    const NEW_LIMIT = 500

    // Update all running simulations
    const result = await prisma.simulation.updateMany({
      where: { status: 'running' },
      data: { tradesLimit: NEW_LIMIT },
    })

    return NextResponse.json({
      success: true,
      message: `Updated ${result.count} simulations to ${NEW_LIMIT} trade limit`,
      newLimit: NEW_LIMIT,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET - Show current limits
export async function GET() {
  const simulations = await prisma.simulation.findMany({
    where: { status: 'running' },
    select: {
      id: true,
      tradesLimit: true,
      tradesCompleted: true,
      strategy: { select: { name: true } },
    },
  })

  return NextResponse.json({
    simulations: simulations.map(s => ({
      strategy: s.strategy.name,
      tradesCompleted: s.tradesCompleted,
      tradesLimit: s.tradesLimit,
      remaining: s.tradesLimit - s.tradesCompleted,
      atLimit: s.tradesCompleted >= s.tradesLimit,
    })),
  })
}
