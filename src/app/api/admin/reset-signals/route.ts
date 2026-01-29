import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// POST /api/admin/reset-signals - Reset processed signals so they can be reprocessed
export async function POST() {
  try {
    // Get current state before reset
    const beforeCount = await prisma.screenerSignal.count({ where: { processed: true } })

    // Reset all signals from the last 7 days to unprocessed
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const result = await prisma.screenerSignal.updateMany({
      where: {
        processed: true,
        scannedAt: { gte: sevenDaysAgo },
      },
      data: { processed: false },
    })

    // Get state after reset
    const afterPending = await prisma.screenerSignal.count({ where: { processed: false } })

    return NextResponse.json({
      success: true,
      message: `Reset ${result.count} signals to unprocessed`,
      before: { processed: beforeCount },
      after: { pending: afterPending },
      note: 'Run /api/simulation/process-signals to process them with the fixed code',
    })
  } catch (error) {
    console.error('Reset signals error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET - Show signal stats
export async function GET() {
  const [total, processed, pending] = await Promise.all([
    prisma.screenerSignal.count(),
    prisma.screenerSignal.count({ where: { processed: true } }),
    prisma.screenerSignal.count({ where: { processed: false } }),
  ])

  // Get strategy key distribution
  const byStrategyKey = await prisma.screenerSignal.groupBy({
    by: ['strategyKey'],
    _count: { id: true },
    where: { processed: false },
  })

  // Check which strategies exist
  const strategies = await prisma.strategy.findMany({
    where: { status: 'active' },
    select: { id: true, name: true },
  })

  return NextResponse.json({
    signals: { total, processed, pending },
    pendingByStrategy: byStrategyKey,
    activeStrategies: strategies.map(s => ({ id: s.id, name: s.name })),
  })
}
