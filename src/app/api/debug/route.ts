import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { getQuote } from '@/lib/finnhub'

const yahooFinance = new YahooFinance()

export const dynamic = 'force-dynamic'

export async function GET() {
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
