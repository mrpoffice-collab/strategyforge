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
  const DEFAULT_PROFIT_TARGET = 5  // 5% profit target
  const DEFAULT_STOP_LOSS = 3      // 3% stop loss

  // Get strategies with missing or invalid exit conditions
  const strategies = await prisma.strategy.findMany({
    select: { id: true, name: true, exitConditions: true },
  })

  const updated = []
  for (const strategy of strategies) {
    const exit = strategy.exitConditions as Record<string, unknown> | null
    const profitTarget = exit?.profitTarget as number | null | undefined
    const stopLoss = exit?.stopLoss as number | null | undefined

    // Check if profitTarget or stopLoss is null, undefined, or not a positive number
    const needsUpdate = !profitTarget || profitTarget <= 0 || !stopLoss || stopLoss <= 0

    if (needsUpdate) {
      const newExit = {
        ...(exit || {}),
        profitTarget: (profitTarget && profitTarget > 0) ? profitTarget : DEFAULT_PROFIT_TARGET,
        stopLoss: (stopLoss && stopLoss > 0) ? stopLoss : DEFAULT_STOP_LOSS,
      }

      await prisma.strategy.update({
        where: { id: strategy.id },
        data: { exitConditions: newExit },
      })
      updated.push({
        name: strategy.name,
        before: { profitTarget, stopLoss },
        after: { profitTarget: newExit.profitTarget, stopLoss: newExit.stopLoss },
      })
    }
  }

  return NextResponse.json({
    success: true,
    message: `Updated ${updated.length} strategies with default exit conditions`,
    defaults: { profitTarget: DEFAULT_PROFIT_TARGET, stopLoss: DEFAULT_STOP_LOSS },
    updatedStrategies: updated,
  })
}
