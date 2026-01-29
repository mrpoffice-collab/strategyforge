import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// POST /api/simulation/start - Start simulations for all strategies
export async function POST() {
  try {
    // Get all active strategies
    const strategies = await prisma.strategy.findMany({
      where: { status: 'active' },
    })

    const results = []

    for (const strategy of strategies) {
      // Check if there's already a running simulation
      const existingSimulation = await prisma.simulation.findFirst({
        where: {
          strategyId: strategy.id,
          status: 'running',
        },
      })

      if (existingSimulation) {
        results.push({
          strategyId: strategy.id,
          strategyName: strategy.name,
          status: 'already_running',
          simulationId: existingSimulation.id,
        })
        continue
      }

      // Create new simulation
      const simulation = await prisma.simulation.create({
        data: {
          strategyId: strategy.id,
          mode: 'realtime',
          status: 'running',
          initialCapital: 2000,
          currentCapital: 2000,
          tradesLimit: 500,
        },
      })

      results.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        status: 'started',
        simulationId: simulation.id,
      })
    }

    return NextResponse.json({
      success: true,
      message: `Started ${results.filter((r) => r.status === 'started').length} new simulations`,
      results,
    })
  } catch (error) {
    console.error('Error starting simulations:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to start simulations' },
      { status: 500 }
    )
  }
}

// GET /api/simulation/start - Redirect to dashboard after starting
export async function GET() {
  const response = await POST()
  const data = await response.json()

  // Redirect to dashboard
  return NextResponse.redirect(new URL('/', process.env.VERCEL_URL || 'http://localhost:3000'))
}
