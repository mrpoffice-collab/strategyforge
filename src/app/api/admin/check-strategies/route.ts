import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/admin/check-strategies - Check strategy exit conditions
export async function GET() {
  const strategies = await prisma.strategy.findMany({
    select: {
      id: true,
      name: true,
      exitConditions: true,
      positionSize: true,
    },
  })

  return NextResponse.json({
    strategies: strategies.map(s => ({
      name: s.name,
      exitConditions: s.exitConditions,
      positionSize: s.positionSize,
    })),
  })
}

// POST /api/admin/check-strategies - Set default exit conditions for strategies missing them
export async function POST() {
  const DEFAULT_EXIT = {
    profitTarget: 5,  // 5% profit target
    stopLoss: 3,      // 3% stop loss
  }

  // Get strategies with missing or invalid exit conditions
  const strategies = await prisma.strategy.findMany({
    select: { id: true, name: true, exitConditions: true },
  })

  const updated = []
  for (const strategy of strategies) {
    const exit = strategy.exitConditions as { profitTarget?: number; stopLoss?: number } | null

    // Check if exit conditions are missing or incomplete
    if (!exit || exit.profitTarget === undefined || exit.stopLoss === undefined) {
      await prisma.strategy.update({
        where: { id: strategy.id },
        data: {
          exitConditions: {
            ...(exit || {}),
            profitTarget: exit?.profitTarget ?? DEFAULT_EXIT.profitTarget,
            stopLoss: exit?.stopLoss ?? DEFAULT_EXIT.stopLoss,
          },
        },
      })
      updated.push(strategy.name)
    }
  }

  return NextResponse.json({
    success: true,
    message: `Updated ${updated.length} strategies with default exit conditions`,
    defaultExit: DEFAULT_EXIT,
    updatedStrategies: updated,
  })
}
