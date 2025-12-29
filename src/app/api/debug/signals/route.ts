import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const signals = await prisma.screenerSignal.findMany({
      where: { processed: false },
      take: 50,
      orderBy: { scannedAt: 'desc' },
      select: { symbol: true, strategyKey: true, price: true }
    })

    const validPrices = signals.filter(s => s.price && s.price >= 25 && s.price <= 100)
    const invalidPrices = signals.filter(s => !s.price || s.price < 25 || s.price > 100)

    // Group by strategy
    const byStrategy: Record<string, number> = {}
    signals.forEach(s => {
      byStrategy[s.strategyKey] = (byStrategy[s.strategyKey] || 0) + 1
    })

    // Group invalid by reason
    const invalidReasons = {
      null_price: signals.filter(s => !s.price).length,
      below_25: signals.filter(s => s.price && s.price < 25).length,
      above_100: signals.filter(s => s.price && s.price > 100).length,
    }

    return NextResponse.json({
      totalPending: signals.length,
      validPrices: validPrices.length,
      invalidPrices: invalidPrices.length,
      invalidReasons,
      byStrategy,
      sampleInvalid: invalidPrices.slice(0, 10).map(s => ({
        symbol: s.symbol,
        strategy: s.strategyKey,
        price: s.price
      })),
      sampleValid: validPrices.slice(0, 10).map(s => ({
        symbol: s.symbol,
        strategy: s.strategyKey,
        price: s.price
      }))
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
