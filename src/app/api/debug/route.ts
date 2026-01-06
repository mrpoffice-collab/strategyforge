import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { getQuote } from '@/lib/finnhub'
import prisma from '@/lib/prisma'

const yahooFinance = new YahooFinance()

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')

  // Price comparison mode - compare stored vs live prices
  if (mode === 'compare') {
    const positions = await prisma.position.findMany({
      select: { symbol: true, currentPrice: true, updatedAt: true },
      distinct: ['symbol'],
      take: 50, // Check more symbols
    })

    const comparisons = []
    for (const pos of positions) {
      try {
        const liveQuote = await getQuote(pos.symbol)
        const livePrice = liveQuote?.c || 0
        const diff = livePrice - pos.currentPrice
        const diffPercent = pos.currentPrice > 0 ? (diff / pos.currentPrice) * 100 : 0

        comparisons.push({
          symbol: pos.symbol,
          storedPrice: pos.currentPrice,
          livePrice: livePrice,
          diff: diff.toFixed(2),
          diffPercent: diffPercent.toFixed(2) + '%',
          lastUpdated: pos.updatedAt.toISOString(),
        })
      } catch (e) {
        comparisons.push({
          symbol: pos.symbol,
          storedPrice: pos.currentPrice,
          livePrice: 'error',
          error: e instanceof Error ? e.message : 'Unknown',
        })
      }
    }

    return NextResponse.json({
      mode: 'compare',
      timestamp: new Date().toISOString(),
      comparisons,
    })
  }

  // Test specific symbol mode
  const testSymbol = searchParams.get('symbol')
  if (testSymbol) {
    try {
      const quote = await getQuote(testSymbol)
      return NextResponse.json({
        symbol: testSymbol,
        timestamp: new Date().toISOString(),
        quote,
        price: quote?.c || null,
      })
    } catch (e) {
      return NextResponse.json({
        symbol: testSymbol,
        error: e instanceof Error ? e.message : 'Unknown',
      })
    }
  }

  // Default mode - test AAPL
  const symbol = 'AAPL'
  const now = new Date()
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)

  const results = {
    symbol,
    dates: { from: sixtyDaysAgo.toISOString(), to: now.toISOString() },
    finnhubQuote: null as unknown,
    yahooRaw: null as unknown,
  }

  // Test Finnhub quote
  try {
    const quote = await getQuote(symbol)
    results.finnhubQuote = quote
  } catch (e) {
    results.finnhubQuote = { error: e instanceof Error ? e.message : 'Unknown' }
  }

  // Test Yahoo directly
  try {
    const data = await yahooFinance.historical(symbol, {
      period1: sixtyDaysAgo,
      period2: now,
      interval: '1d',
    }) as Array<{ date: Date; close: number; open: number; high: number; low: number; volume: number }>

    results.yahooRaw = {
      type: typeof data,
      isArray: Array.isArray(data),
      length: data.length,
      sample: data.length > 0 ? data.slice(-3) : 'no data',
    }
  } catch (e) {
    results.yahooRaw = { error: e instanceof Error ? e.message : String(e) }
  }

  return NextResponse.json(results)
}
