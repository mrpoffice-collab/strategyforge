import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import {
  getQuote,
  getCandles,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateSMA,
  calculateATR,
  calculateStochastic,
  calculateADX,
  calculateBBWidth,
  detectRSIDivergence,
  calculateROC,
  detectMAAlignment,
} from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface StrategyMatch {
  strategyId: string
  strategyName: string
  simulationId: string
  reason: string
}

// Check if a symbol matches ANY strategy's entry conditions
async function checkSymbolAgainstAllStrategies(
  symbol: string,
  price: number,
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
  strategies: Array<{
    id: string
    name: string
    entryConditions: unknown
    simulation: { id: string; currentCapital: number } | null
  }>
): Promise<StrategyMatch[]> {
  const matches: StrategyMatch[] = []

  // Pre-calculate ALL indicators once (not per strategy)
  const indicators = {
    rsi14: calculateRSI(closes, 14),
    sma10: calculateSMA(closes, 10),
    sma20: calculateSMA(closes, 20),
    sma50: calculateSMA(closes, 50),
    sma200: calculateSMA(closes, 200),
    roc12: calculateROC(closes, 12),
    bbWidth: calculateBBWidth(closes, 20, 2),
    macd: calculateMACD(closes),
    bbands: calculateBollingerBands(closes, 20, 2),
    stoch: calculateStochastic(highs, lows, closes, 14, 3),
    adx: calculateADX(highs, lows, closes, 14),
    atr: calculateATR(highs, lows, closes, 14),
    rsiDivergence: detectRSIDivergence(closes, 14, 10),
    maAlignment: detectMAAlignment(closes, 10, 20, 50),
  }

  // Check each strategy
  for (const strategy of strategies) {
    if (!strategy.simulation || strategy.simulation.currentCapital < 100) continue

    const conditions = strategy.entryConditions as {
      indicators: Array<{ type: string; [key: string]: unknown }>
      priceRange: { min: number; max: number }
    }

    // Check price range
    if (price < conditions.priceRange.min || price > conditions.priceRange.max) continue

    // Check all indicator conditions
    let allMet = true
    const reasons: string[] = []

    for (const cond of conditions.indicators) {
      const met = checkCondition(cond, price, indicators, closes, volumes)
      if (!met.passed) {
        allMet = false
        break
      }
      reasons.push(met.reason)
    }

    if (allMet && reasons.length > 0) {
      matches.push({
        strategyId: strategy.id,
        strategyName: strategy.name,
        simulationId: strategy.simulation.id,
        reason: reasons.join(', '),
      })
    }
  }

  return matches
}

// Check a single condition against pre-calculated indicators
function checkCondition(
  cond: { type: string; [key: string]: unknown },
  price: number,
  ind: {
    rsi14: number | null
    sma10: number | null
    sma20: number | null
    sma50: number | null
    sma200: number | null
    roc12: number | null
    bbWidth: number | null
    macd: { macd: number; signal: number; histogram: number } | null
    bbands: { upper: number; middle: number; lower: number } | null
    stoch: { k: number; d: number } | null
    adx: { adx: number; plusDI: number; minusDI: number } | null
    atr: number | null
    rsiDivergence: 'bullish' | 'bearish' | null
    maAlignment: 'bullish' | 'bearish' | 'neutral'
  },
  closes: number[],
  volumes: number[]
): { passed: boolean; reason: string } {
  const comp = cond.comparison as string
  const threshold = cond.threshold as number

  switch (cond.type) {
    case 'RSI':
      if (ind.rsi14 === null) return { passed: false, reason: '' }
      if (comp === 'less_than' && ind.rsi14 >= threshold) return { passed: false, reason: '' }
      if (comp === 'greater_than' && ind.rsi14 <= threshold) return { passed: false, reason: '' }
      if (comp === 'between') {
        const min = (cond.min as number) || 30
        const max = (cond.max as number) || 70
        if (ind.rsi14 < min || ind.rsi14 > max) return { passed: false, reason: '' }
        return { passed: true, reason: `RSI ${ind.rsi14.toFixed(1)} in ${min}-${max}` }
      }
      return { passed: true, reason: `RSI ${ind.rsi14.toFixed(1)}` }

    case 'MACD':
    case 'MACD_CROSSOVER':
      if (!ind.macd) return { passed: false, reason: '' }
      if (comp === 'positive' && ind.macd.histogram <= 0) return { passed: false, reason: '' }
      if ((cond.direction as string) === 'bullish' && ind.macd.histogram <= 0) return { passed: false, reason: '' }
      if ((cond.direction as string) === 'bearish' && ind.macd.histogram >= 0) return { passed: false, reason: '' }
      return { passed: true, reason: 'MACD positive' }

    case 'STOCHASTIC':
      if (!ind.stoch) return { passed: false, reason: '' }
      if (comp === 'oversold' && ind.stoch.k >= (threshold || 25)) return { passed: false, reason: '' }
      if (comp === 'overbought' && ind.stoch.k <= (100 - (threshold || 20))) return { passed: false, reason: '' }
      if (comp === 'bullish_cross' && ind.stoch.k <= ind.stoch.d) return { passed: false, reason: '' }
      return { passed: true, reason: `Stoch %K ${ind.stoch.k.toFixed(1)}` }

    case 'ADX':
      if (!ind.adx) return { passed: false, reason: '' }
      if (comp === 'strong_trend' && ind.adx.adx < (threshold || 25)) return { passed: false, reason: '' }
      if (comp === 'bullish_di' && ind.adx.plusDI <= ind.adx.minusDI) return { passed: false, reason: '' }
      return { passed: true, reason: `ADX ${ind.adx.adx.toFixed(1)}` }

    case 'MA_ALIGNMENT':
      if (ind.maAlignment !== (cond.direction as string)) return { passed: false, reason: '' }
      return { passed: true, reason: `MA ${ind.maAlignment}` }

    case 'PRICE_VS_MA':
      const period = (cond.period as number) || 50
      const ma = period === 10 ? ind.sma10 : period === 20 ? ind.sma20 : period === 50 ? ind.sma50 : ind.sma200
      if (!ma) return { passed: false, reason: '' }
      if (comp === 'above' && price <= ma) return { passed: false, reason: '' }
      if (comp === 'below' && price >= ma) return { passed: false, reason: '' }
      if (comp === 'pullback_to') {
        const tolerance = ma * 0.02
        if (Math.abs(price - ma) > tolerance) return { passed: false, reason: '' }
      }
      return { passed: true, reason: `Price vs ${period}MA` }

    case 'BOLLINGER':
    case 'BollingerBands':
      if (!ind.bbands) return { passed: false, reason: '' }
      if ((comp === 'price_above' || cond.band === 'upper') && price <= ind.bbands.upper) return { passed: false, reason: '' }
      if (comp === 'above_middle' && price <= ind.bbands.middle) return { passed: false, reason: '' }
      if (comp === 'near_lower') {
        const tol = ind.bbands.middle - ind.bbands.lower
        if (price > ind.bbands.lower + tol * 0.3) return { passed: false, reason: '' }
      }
      return { passed: true, reason: 'BB condition met' }

    case 'BB_WIDTH':
    case 'BOLLINGER_WIDTH':
      if (ind.bbWidth === null) return { passed: false, reason: '' }
      if (comp === 'squeeze' && ind.bbWidth >= (threshold || 10)) return { passed: false, reason: '' }
      return { passed: true, reason: `BB Width ${ind.bbWidth.toFixed(1)}%` }

    case 'ROC':
      if (ind.roc12 === null) return { passed: false, reason: '' }
      if (comp === 'greater_than' && ind.roc12 <= threshold) return { passed: false, reason: '' }
      if (comp === 'positive' && ind.roc12 <= 0) return { passed: false, reason: '' }
      return { passed: true, reason: `ROC ${ind.roc12.toFixed(1)}%` }

    case 'RSI_DIVERGENCE':
      if (ind.rsiDivergence !== (cond.direction as string)) return { passed: false, reason: '' }
      return { passed: true, reason: `RSI ${ind.rsiDivergence} divergence` }

    case 'VOLUME':
      if (!volumes || volumes.length < 30) return { passed: false, reason: '' }
      const period2 = (cond.period as number) || 20
      const avgVol = volumes.slice(-period2).reduce((a, b) => a + b, 0) / period2
      const currVol = volumes[volumes.length - 1]
      const mult = (cond.multiplier as number) || threshold || 1.5
      if (currVol < avgVol * mult) return { passed: false, reason: '' }
      return { passed: true, reason: `Vol ${(currVol / avgVol).toFixed(1)}x` }

    default:
      // Skip unknown conditions
      return { passed: true, reason: `${cond.type} skipped` }
  }
}

// POST /api/simulation/batch - Process a batch of symbols
export async function POST(request: Request) {
  try {
    // Auth check
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CRON_SECRET
    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const batchNumber = parseInt(searchParams.get('batch') || '0')
    const batchSize = parseInt(searchParams.get('size') || '20')

    // Get all running strategies with their simulations
    const strategies = await prisma.strategy.findMany({
      where: { status: 'active' },
      include: {
        simulations: {
          where: { status: 'running' },
          take: 1,
        },
      },
    })

    const strategiesWithSim = strategies
      .filter(s => s.simulations.length > 0)
      .map(s => ({
        id: s.id,
        name: s.name,
        entryConditions: s.entryConditions,
        exitConditions: s.exitConditions,
        positionSize: s.positionSize,
        simulation: s.simulations[0],
      }))

    // Get cached eligible stocks for this batch
    const eligibleStocks = await prisma.stock.findMany({
      where: { isEligible: true },
      orderBy: { symbol: 'asc' },
      skip: batchNumber * batchSize,
      take: batchSize,
    })

    console.log(`Batch ${batchNumber}: Found ${eligibleStocks.length} eligible stocks`)

    const results = {
      batch: batchNumber,
      symbolsProcessed: 0,
      entriesCreated: 0,
      exitsProcessed: 0,
      matches: [] as Array<{ symbol: string; strategy: string; action: string }>,
      errors: [] as string[],
      debug: {
        stocksInBatch: eligibleStocks.length,
        stockSymbols: eligibleStocks.map(s => s.symbol),
      },
    }

    // FIRST: Check exits for all existing positions
    const allPositions = await prisma.position.findMany({
      include: { simulation: { include: { strategy: true } } },
    })

    for (const position of allPositions) {
      const quote = await getQuote(position.symbol)
      if (!quote || quote.c === 0) continue

      const exitConds = position.simulation.strategy.exitConditions as {
        profitTarget: number
        stopLoss: number
      }

      const pnlPercent = ((quote.c - position.entryPrice) / position.entryPrice) * 100
      let shouldExit = false
      let exitReason = ''

      if (pnlPercent >= exitConds.profitTarget) {
        shouldExit = true
        exitReason = 'PROFIT_TARGET'
      } else if (pnlPercent <= -exitConds.stopLoss) {
        shouldExit = true
        exitReason = 'STOP_LOSS'
      }

      if (shouldExit) {
        const profitLoss = (quote.c - position.entryPrice) * position.shares
        const isWin = profitLoss >= 0

        await prisma.trade.updateMany({
          where: { simulationId: position.simulationId, symbol: position.symbol, exitDate: null },
          data: {
            exitDate: new Date(),
            exitPrice: quote.c,
            profitLoss,
            profitLossPercent: pnlPercent,
            exitReason,
          },
        })

        await prisma.position.delete({ where: { id: position.id } })

        await prisma.simulation.update({
          where: { id: position.simulationId },
          data: {
            currentCapital: { increment: position.shares * quote.c },
            totalPL: { increment: profitLoss },
            tradesCompleted: { increment: 1 },
            winCount: isWin ? { increment: 1 } : undefined,
            lossCount: !isWin ? { increment: 1 } : undefined,
          },
        })

        results.exitsProcessed++
        results.matches.push({ symbol: position.symbol, strategy: position.simulation.strategy.name, action: exitReason })
      }

      await new Promise(r => setTimeout(r, 100))
    }

    // THEN: Check entries for batch symbols
    for (const stock of eligibleStocks) {
      try {
        // Rate limit: wait 1 second before each stock
        await new Promise(r => setTimeout(r, 1000))

        const quote = await getQuote(stock.symbol)

        // Use cached price if live quote unavailable (weekend/after hours)
        const price = (quote && quote.c > 0) ? quote.c : stock.currentPrice
        if (price < 25 || price > 100) continue

        // Rate limit before candles call
        await new Promise(r => setTimeout(r, 1000))

        const now = Math.floor(Date.now() / 1000)
        const sixtyDaysAgo = now - 60 * 24 * 60 * 60 // Extended to 60 days
        const candles = await getCandles(stock.symbol, 'D', sixtyDaysAgo, now)

        if (!candles) {
          results.errors.push(`${stock.symbol}: candles null`)
          continue
        }
        if (candles.s !== 'ok') {
          results.errors.push(`${stock.symbol}: status=${candles.s}`)
          continue
        }
        if (!candles.c || candles.c.length < 20) {
          results.errors.push(`${stock.symbol}: only ${candles.c?.length || 0} points`)
          continue
        }

        results.symbolsProcessed++

        // Check against ALL strategies at once
        const matches = await checkSymbolAgainstAllStrategies(
          stock.symbol,
          price,
          candles.c,
          candles.h,
          candles.l,
          candles.v,
          strategiesWithSim
        )

        // Execute trades for matches
        for (const match of matches) {
          // Check if position already exists
          const existing = await prisma.position.findUnique({
            where: { simulationId_symbol: { simulationId: match.simulationId, symbol: stock.symbol } },
          })
          if (existing) continue

          const sim = strategiesWithSim.find(s => s.id === match.strategyId)
          if (!sim) continue

          const positionValue = sim.simulation.currentCapital * (sim.positionSize / 100)
          const shares = Math.floor(positionValue / price)
          if (shares < 1) continue

          const totalCost = shares * price

          await prisma.position.create({
            data: {
              simulationId: match.simulationId,
              symbol: stock.symbol,
              shares,
              entryPrice: price,
              entryDate: new Date(),
              currentPrice: price,
              currentValue: totalCost,
              unrealizedPL: 0,
              unrealizedPLPercent: 0,
            },
          })

          await prisma.trade.create({
            data: {
              simulationId: match.simulationId,
              strategyId: match.strategyId,
              symbol: stock.symbol,
              side: 'BUY',
              entryDate: new Date(),
              entryPrice: price,
              shares,
              totalCost,
            },
          })

          await prisma.simulation.update({
            where: { id: match.simulationId },
            data: { currentCapital: { decrement: totalCost } },
          })

          results.entriesCreated++
          results.matches.push({ symbol: stock.symbol, strategy: match.strategyName, action: 'BUY' })
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 1000))
      } catch (err) {
        results.errors.push(`${stock.symbol}: ${err instanceof Error ? err.message : 'Unknown'}`)
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
      totalEligibleStocks: await prisma.stock.count({ where: { isEligible: true } }),
      strategiesActive: strategiesWithSim.length,
    })
  } catch (error) {
    console.error('Batch processing error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
