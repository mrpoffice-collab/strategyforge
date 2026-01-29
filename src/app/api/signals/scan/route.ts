import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getQuote } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Top 25 most liquid symbols
const SCAN_SYMBOLS = [
  'AMD', 'INTC', 'MU', 'QCOM', 'PYPL',
  'SQ', 'SOFI', 'COIN', 'NET', 'CRWD',
  'UBER', 'ABNB', 'TGT', 'DG', 'ROST',
  'XOM', 'CVX', 'OXY', 'FSLR', 'ENPH',
  'JPM', 'BAC', 'PFE', 'MRNA', 'F',
]

// Strategy key patterns to match against strategy names (case-insensitive partial match)
const STRATEGY_KEY_PATTERNS: Record<string, string[]> = {
  'rsi_stochastic_oversold': ['rsi', 'stochastic', 'oversold'],
  'adx_trend_pullback': ['adx', 'trend', 'pullback'],
  'bollinger_squeeze': ['bollinger', 'squeeze'],
  'macd_bb_volume': ['macd', 'bb', 'volume'],
  'rsi_mean_reversion': ['rsi', 'mean', 'reversion'],
}

// Build dynamic strategy mapping from database
async function buildStrategyKeyMap(): Promise<Record<string, string>> {
  const strategies = await prisma.strategy.findMany({
    where: { status: 'active' },
    select: { id: true, name: true },
  })

  const mapping: Record<string, string> = {}

  for (const [key, patterns] of Object.entries(STRATEGY_KEY_PATTERNS)) {
    // Find strategy whose name contains all patterns (case-insensitive)
    const matchedStrategy = strategies.find(s => {
      const nameLower = s.name.toLowerCase()
      return patterns.every(p => nameLower.includes(p.toLowerCase()))
    })
    if (matchedStrategy) {
      mapping[key] = matchedStrategy.id
    }
  }

  return mapping
}

interface CachedIndicators {
  symbol: string
  price: number
  rsi14: number | null
  macd: number | null
  macdSignal: number | null
  stochK: number | null
  stochD: number | null
  adx: number | null
  plusDI: number | null
  minusDI: number | null
  bbUpper: number | null
  bbMiddle: number | null
  bbLower: number | null
  sma20: number | null
  sma50: number | null
  atr14: number | null
  change: number
}

// Check if stock matches strategy entry conditions using cached indicators
function checkStrategyMatch(data: CachedIndicators, strategyKey: string): boolean {
  const { price, rsi14, macd, macdSignal, stochK, adx, plusDI, minusDI, bbUpper, sma20, sma50 } = data

  // Price filter - must be $25-$100
  if (price < 25 || price > 100) return false

  switch (strategyKey) {
    case 'rsi_stochastic_oversold':
      // RSI < 40, Stoch K < 30, MACD bullish
      return (
        rsi14 !== null && rsi14 < 40 &&
        stochK !== null && stochK < 30 &&
        macd !== null && macdSignal !== null && macd > macdSignal
      )

    case 'adx_trend_pullback':
      // ADX > 20, +DI > -DI, price > SMA50
      return (
        adx !== null && adx > 20 &&
        plusDI !== null && minusDI !== null && plusDI > minusDI &&
        sma50 !== null && price > sma50
      )

    case 'bollinger_squeeze':
      // Price breaking above upper band, MACD positive
      return (
        bbUpper !== null && price > bbUpper &&
        macd !== null && macd > 0
      )

    case 'macd_bb_volume':
      // MACD bullish, price > SMA20, healthy RSI
      return (
        macd !== null && macdSignal !== null && macd > macdSignal &&
        sma20 !== null && price > sma20 &&
        rsi14 !== null && rsi14 >= 40 && rsi14 <= 70
      )

    case 'rsi_mean_reversion':
      // RSI oversold (< 30), expecting bounce
      return (
        rsi14 !== null && rsi14 < 30 &&
        sma20 !== null && price < sma20
      )

    default:
      return false
  }
}

export async function POST() {
  const startTime = Date.now()

  try {
    const results = {
      scanned: 0,
      signalsCreated: 0,
      errors: [] as string[],
      signals: [] as Array<{ symbol: string; strategy: string; price: number }>,
      usedCache: 0,
      fetchedFresh: 0,
    }

    // Build dynamic strategy key mapping from database
    const STRATEGY_KEY_MAP = await buildStrategyKeyMap()
    console.log('Strategy key mapping:', Object.keys(STRATEGY_KEY_MAP).length, 'strategies mapped')

    // Get active strategies
    const strategies = await prisma.strategy.findMany({
      where: { status: 'active' },
      select: { id: true, name: true },
    })

    const strategyMap = new Map(strategies.map(s => [s.id, s.name]))

    // Get recent cached market data (last 3 days to account for weekends)
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

    const cachedData = await prisma.marketData.findMany({
      where: {
        symbol: { in: SCAN_SYMBOLS },
        date: { gte: threeDaysAgo },
      },
      orderBy: { date: 'desc' },
      distinct: ['symbol'],
    })

    const cachedBySymbol = new Map(cachedData.map(d => [d.symbol, d]))

    // Scan each symbol
    for (const symbol of SCAN_SYMBOLS) {
      // Time check - don't exceed 50 seconds
      if (Date.now() - startTime > 50000) {
        console.log('Time limit reached, stopping scan')
        break
      }

      try {
        // Get current quote (this is fast and doesn't hit Yahoo)
        const quote = await getQuote(symbol)
        if (!quote || quote.c <= 0) {
          continue
        }

        results.scanned++

        // Try to use cached indicators
        const cached = cachedBySymbol.get(symbol)

        let indicatorData: CachedIndicators

        if (cached) {
          // Use cached indicators with fresh price
          results.usedCache++
          indicatorData = {
            symbol,
            price: quote.c,
            rsi14: cached.rsi14,
            macd: cached.macd,
            macdSignal: cached.macdSignal,
            stochK: cached.stochK,
            stochD: cached.stochD,
            adx: cached.adx,
            plusDI: cached.plusDI,
            minusDI: cached.minusDI,
            bbUpper: cached.bbUpper,
            bbMiddle: cached.bbMiddle,
            bbLower: cached.bbLower,
            sma20: cached.sma20,
            sma50: cached.sma50,
            atr14: cached.atr14,
            change: quote.dp || 0,
          }
        } else {
          // No cached data - skip for now (background job will populate)
          results.errors.push(`${symbol}: no cached indicators`)
          continue
        }

        // Check each strategy
        for (const [strategyKey, strategyId] of Object.entries(STRATEGY_KEY_MAP)) {
          if (!strategyMap.has(strategyId)) continue

          if (checkStrategyMatch(indicatorData, strategyKey)) {
            // Always upsert signal with fresh data
            const indicatorJson = JSON.parse(JSON.stringify(indicatorData))
            await prisma.screenerSignal.upsert({
              where: {
                symbol_strategyKey: { symbol, strategyKey },
              },
              update: {
                price: quote.c,
                indicators: indicatorJson,
                processed: false,
                scannedAt: new Date(),
              },
              create: {
                symbol,
                strategyKey,
                strategyName: strategyMap.get(strategyId),
                price: quote.c,
                indicators: indicatorJson,
              },
            })

            results.signalsCreated++
            results.signals.push({
              symbol,
              strategy: strategyMap.get(strategyId) || strategyKey,
              price: quote.c,
            })
          }
        }

        // Small delay between Finnhub calls
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (error) {
        results.errors.push(`${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
      duration: Date.now() - startTime,
    })
  } catch (error) {
    console.error('Signal scan error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to scan for signals' },
      { status: 500 }
    )
  }
}

// GET endpoint for status/testing
export async function GET() {
  const pendingSignals = await prisma.screenerSignal.count({ where: { processed: false } })
  const recentSignals = await prisma.screenerSignal.findMany({
    where: { processed: false },
    orderBy: { scannedAt: 'desc' },
    take: 10,
    select: { symbol: true, strategyKey: true, price: true, scannedAt: true },
  })

  // Check cached data status
  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

  const cachedSymbols = await prisma.marketData.findMany({
    where: { date: { gte: threeDaysAgo } },
    distinct: ['symbol'],
    select: { symbol: true },
  })

  return NextResponse.json({
    pendingSignals,
    recentSignals,
    cachedSymbolCount: cachedSymbols.length,
    scanSymbolCount: SCAN_SYMBOLS.length,
  })
}
