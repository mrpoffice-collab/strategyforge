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
    const failedSymbols: string[] = []

    for (const symbol of symbols) {
      try {
        const quote = await getQuote(symbol)
        if (quote && quote.c > 0) {
          quotes.set(symbol, quote.c)
        } else {
          failedSymbols.push(symbol)
        }
      } catch (err) {
        failedSymbols.push(`${symbol}:error`)
      }
      // Rate limit: 100ms between calls
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    console.log(`Fetched ${quotes.size}/${symbols.length} quotes, failed: ${failedSymbols.slice(0, 10).join(',')}`)

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
      quotesFetched: quotes.size,
      quotesFailed: failedSymbols.length,
      failedSample: failedSymbols.slice(0, 5),
    })
  } catch (error) {
    console.error('Error refreshing positions:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to refresh positions' },
      { status: 500 }
    )
  }
}
