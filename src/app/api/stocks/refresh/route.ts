import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getTradeableSymbols, getQuote } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for full refresh

// GET /api/stocks/refresh - Get cached eligible stocks
export async function GET() {
  try {
    const stocks = await prisma.stock.findMany({
      where: { isEligible: true },
      orderBy: { symbol: 'asc' },
    })

    return NextResponse.json({
      success: true,
      count: stocks.length,
      stocks: stocks.map(s => ({
        symbol: s.symbol,
        price: s.currentPrice,
        lastUpdated: s.lastUpdated,
      })),
    })
  } catch (error) {
    console.error('Error fetching cached stocks:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cached stocks' },
      { status: 500 }
    )
  }
}

// POST /api/stocks/refresh - Refresh eligible stocks cache (run daily)
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const minPrice = parseFloat(searchParams.get('min') || '25')
    const maxPrice = parseFloat(searchParams.get('max') || '100')
    const batchSize = parseInt(searchParams.get('batch') || '100')

    // Get all known liquid symbols
    const allSymbols = await getTradeableSymbols()
    console.log(`Scanning ${allSymbols.length} symbols for price range $${minPrice}-$${maxPrice}`)

    const eligible: Array<{
      symbol: string
      price: number
      name: string
    }> = []

    // Process in batches to respect rate limits
    for (let i = 0; i < Math.min(allSymbols.length, batchSize); i++) {
      const symbol = allSymbols[i]
      const quote = await getQuote(symbol)

      if (quote && quote.c >= minPrice && quote.c <= maxPrice) {
        eligible.push({
          symbol,
          price: quote.c,
          name: symbol, // We'd need another API call for full name
        })
      }

      // Rate limit: 60 calls/min = 1 per second
      if (i < batchSize - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    // Upsert eligible stocks to cache
    for (const stock of eligible) {
      await prisma.stock.upsert({
        where: { symbol: stock.symbol },
        update: {
          currentPrice: stock.price,
          isEligible: true,
          lastUpdated: new Date(),
        },
        create: {
          symbol: stock.symbol,
          name: stock.name,
          exchange: 'US',
          currentPrice: stock.price,
          avgVolume: 0,
          isEligible: true,
        },
      })
    }

    // Store last refresh info
    await prisma.systemConfig.upsert({
      where: { key: 'lastStockRefresh' },
      update: { value: new Date().toISOString() },
      create: { key: 'lastStockRefresh', value: new Date().toISOString() },
    })

    await prisma.systemConfig.upsert({
      where: { key: 'eligibleStockCount' },
      update: { value: eligible.length.toString() },
      create: { key: 'eligibleStockCount', value: eligible.length.toString() },
    })

    return NextResponse.json({
      success: true,
      scanned: Math.min(allSymbols.length, batchSize),
      eligible: eligible.length,
      priceRange: { min: minPrice, max: maxPrice },
      stocks: eligible.map(s => ({ symbol: s.symbol, price: s.price })),
    })
  } catch (error) {
    console.error('Error refreshing stocks:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to refresh stocks' },
      { status: 500 }
    )
  }
}
