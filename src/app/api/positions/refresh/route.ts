import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getQuote } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/positions/refresh - Update all open position prices with live quotes
export async function POST() {
  try {
    const positions = await prisma.position.findMany({
      select: { id: true, symbol: true, shares: true, entryPrice: true },
    })

    if (positions.length === 0) {
      return NextResponse.json({ success: true, updated: 0, message: 'No open positions' })
    }

    // Get unique symbols
    const symbols = [...new Set(positions.map(p => p.symbol))]

    // Fetch quotes for all symbols (with rate limiting)
    const quotes = new Map<string, number>()
    for (const symbol of symbols) {
      const quote = await getQuote(symbol)
      if (quote && quote.c > 0) {
        quotes.set(symbol, quote.c)
      }
      // Rate limit: 100ms between calls
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Update all positions with fresh prices
    let updated = 0
    for (const position of positions) {
      const currentPrice = quotes.get(position.symbol)
      if (currentPrice) {
        const currentValue = position.shares * currentPrice
        const unrealizedPL = currentValue - position.shares * position.entryPrice
        const unrealizedPLPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100

        await prisma.position.update({
          where: { id: position.id },
          data: {
            currentPrice,
            currentValue,
            unrealizedPL,
            unrealizedPLPercent,
          },
        })
        updated++
      }
    }

    return NextResponse.json({
      success: true,
      updated,
      total: positions.length,
      symbols: symbols.length,
    })
  } catch (error) {
    console.error('Error refreshing positions:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to refresh positions' },
      { status: 500 }
    )
  }
}
