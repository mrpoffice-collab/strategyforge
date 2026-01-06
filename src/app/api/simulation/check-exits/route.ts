import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getQuote, getCandles, calculateRSI, calculateMACD, calculateBollingerBands, calculateSMA } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Increased to handle all ~250 positions

// Exit condition types from whitepaper-aligned strategies
interface ExitConditions {
  indicators: Array<{ type: string; period?: number; threshold?: number; comparison?: string }>
  exitLogic?: 'ALL' | 'ANY'
  profitTarget: number | null
  stopLoss: number | null
  stopLossType?: 'ATR_TRAILING' | 'ATR_FIXED' | 'BOLLINGER_MIDDLE' | 'MACD_TROUGH' | 'NONE'
  atrMultiplier?: number
  maxHoldDays?: number
}

// Determine market session based on current time (EST/EDT)
function getMarketSession(): string {
  const now = new Date()
  // Convert to Eastern Time
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const hours = estTime.getHours()
  const minutes = estTime.getMinutes()
  const timeInMinutes = hours * 60 + minutes

  // Pre-market: 4:00 AM - 9:30 AM EST (240 - 570 minutes)
  if (timeInMinutes >= 240 && timeInMinutes < 570) {
    return 'PRE_MARKET'
  }
  // Regular: 9:30 AM - 4:00 PM EST (570 - 960 minutes)
  if (timeInMinutes >= 570 && timeInMinutes < 960) {
    return 'REGULAR'
  }
  // After-hours: 4:00 PM - 8:00 PM EST (960 - 1200 minutes)
  if (timeInMinutes >= 960 && timeInMinutes < 1200) {
    return 'AFTER_HOURS'
  }
  // Outside trading hours
  return 'CLOSED'
}

// Lightweight endpoint - ONLY checks exits on existing positions
// No signal processing, no trade opening
export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    // Auth check
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CRON_SECRET
    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const results = {
      positionsChecked: 0,
      positionsUpdated: 0,
      positionsSkipped: 0, // Skipped due to failed quote
      tradesClosed: 0,
      uniqueSymbols: 0,
      quotesFetched: 0,
      quotesFailed: 0,
      failedSymbols: [] as string[],
      marketSession: getMarketSession(),
      exits: [] as Array<{ symbol: string; strategy: string; reason: string; pnl: number; session: string }>,
      errors: [] as string[],
    }

    // Get ALL positions and shuffle for fair coverage
    const allPositions = await prisma.position.findMany({
      include: { simulation: { include: { strategy: true } } },
    })

    // Shuffle positions so different ones get checked each run
    const positions = [...allPositions].sort(() => Math.random() - 0.5)

    results.positionsChecked = positions.length

    // Get unique symbols to fetch quotes for
    const uniqueSymbols = [...new Set(positions.map(p => p.symbol))]

    // Fetch quotes in parallel (batch of 10 at a time to speed up)
    const quoteCache = new Map<string, number>()
    const failedQuotes: string[] = []
    const BATCH_SIZE = 10
    const QUOTE_TIME_LIMIT = 40000 // 40 seconds for quote fetching

    console.log(`Fetching quotes for ${uniqueSymbols.length} unique symbols...`)

    for (let i = 0; i < uniqueSymbols.length && Date.now() - startTime < QUOTE_TIME_LIMIT; i += BATCH_SIZE) {
      const batch = uniqueSymbols.slice(i, i + BATCH_SIZE)
      const quotePromises = batch.map(async (symbol) => {
        try {
          const quote = await getQuote(symbol)
          if (quote && quote.c > 0) {
            quoteCache.set(symbol, quote.c)
          } else {
            failedQuotes.push(`${symbol}:no_price`)
          }
        } catch (err) {
          failedQuotes.push(`${symbol}:${err instanceof Error ? err.message : 'error'}`)
        }
      })
      await Promise.all(quotePromises)
      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < uniqueSymbols.length) {
        await new Promise(r => setTimeout(r, 100))
      }
    }

    results.uniqueSymbols = uniqueSymbols.length
    results.quotesFetched = quoteCache.size
    results.quotesFailed = failedQuotes.length
    results.failedSymbols = failedQuotes.slice(0, 20) // Show first 20 failures
    if (failedQuotes.length > 0) {
      console.log(`Failed to fetch ${failedQuotes.length} quotes: ${failedQuotes.slice(0, 10).join(', ')}`)
    }
    console.log(`Fetched ${quoteCache.size}/${uniqueSymbols.length} quotes in ${Date.now() - startTime}ms`)

    const PROCESS_TIME_LIMIT = 55000 // 55 seconds total (leave 5s buffer)

    // Cache for indicator data (to avoid redundant API calls)
    const indicatorCache = new Map<string, { bbMiddle?: number; macdHistogram?: number; rsi2?: number; sma5?: number }>()

    for (const position of positions) {
      // Time check
      if (Date.now() - startTime > PROCESS_TIME_LIMIT) break

      try {
        // Only process if we have a fresh quote - skip positions where quote fetch failed
        const freshPrice = quoteCache.get(position.symbol)
        if (!freshPrice) {
          // No fresh quote - skip this position entirely (don't update with stale data)
          results.positionsSkipped++
          continue
        }

        const currentPrice = freshPrice
        const exitConds = position.simulation.strategy.exitConditions as unknown as ExitConditions
        const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100
        const holdDays = (Date.now() - new Date(position.entryDate).getTime()) / (1000 * 60 * 60 * 24)

        let shouldExit = false
        let exitReason = ''

        // 1. Check TIME EXIT (all strategies have maxHoldDays as fallback)
        if (exitConds.maxHoldDays && holdDays >= exitConds.maxHoldDays) {
          shouldExit = true
          exitReason = 'TIME_EXIT'
        }

        // 2. Check PROFIT TARGET (if defined - some whitepaper strategies don't use fixed targets)
        if (!shouldExit && exitConds.profitTarget !== null && pnlPercent >= exitConds.profitTarget) {
          shouldExit = true
          exitReason = 'PROFIT_TARGET'
        }

        // 3. Check STOP LOSS based on type
        if (!shouldExit) {
          const stopType = exitConds.stopLossType || (exitConds.stopLoss !== null ? 'FIXED_PERCENT' : 'NONE')

          switch (stopType) {
            case 'NONE':
              // Connors strategy: NO stop loss - let the indicator exits handle it
              break

            case 'FIXED_PERCENT':
              // Legacy fixed percentage stop (for backwards compatibility)
              if (exitConds.stopLoss !== null && pnlPercent <= -exitConds.stopLoss) {
                shouldExit = true
                exitReason = 'STOP_LOSS'
              }
              break

            case 'ATR_FIXED':
              // Wilder/Elder: Fixed ATR-based stop from entry
              if (position.atrStopPrice && currentPrice <= position.atrStopPrice) {
                shouldExit = true
                exitReason = 'ATR_STOP'
              }
              break

            case 'ATR_TRAILING':
              // Wilder: Trailing stop that moves up with price
              if (position.trailingStopHigh && position.entryATR) {
                const atrMultiplier = exitConds.atrMultiplier || 2.0
                const newHigh = Math.max(position.trailingStopHigh, currentPrice)
                const trailingStop = newHigh - (position.entryATR * atrMultiplier)

                if (currentPrice <= trailingStop) {
                  shouldExit = true
                  exitReason = 'ATR_TRAILING_STOP'
                } else if (currentPrice > position.trailingStopHigh) {
                  // Update trailing stop high (done later in position update)
                }
              }
              break

            case 'BOLLINGER_MIDDLE':
              // Bollinger: Exit when price falls below middle band (20-day SMA)
              // Fetch current BB middle if not cached
              if (!indicatorCache.has(position.symbol)) {
                try {
                  const now = Math.floor(Date.now() / 1000)
                  const thirtyDaysAgo = now - 30 * 24 * 60 * 60
                  const candles = await getCandles(position.symbol, 'D', thirtyDaysAgo, now)
                  if (candles?.s === 'ok' && candles.c) {
                    const bb = calculateBollingerBands(candles.c, 20, 2)
                    const macd = calculateMACD(candles.c)
                    const rsi2 = calculateRSI(candles.c, 2)
                    const sma5 = calculateSMA(candles.c, 5)
                    indicatorCache.set(position.symbol, {
                      bbMiddle: bb?.middle,
                      macdHistogram: macd?.histogram,
                      rsi2: rsi2 ?? undefined,
                      sma5: sma5 ?? undefined,
                    })
                  }
                } catch (e) {
                  // Ignore indicator fetch errors
                }
              }
              const indicators = indicatorCache.get(position.symbol)
              if (indicators?.bbMiddle && currentPrice < indicators.bbMiddle) {
                shouldExit = true
                exitReason = 'BB_MIDDLE_STOP'
              }
              break

            case 'MACD_TROUGH':
              // Appel: Exit when MACD histogram falls below the trough at entry
              if (!indicatorCache.has(position.symbol)) {
                try {
                  const now = Math.floor(Date.now() / 1000)
                  const thirtyDaysAgo = now - 30 * 24 * 60 * 60
                  const candles = await getCandles(position.symbol, 'D', thirtyDaysAgo, now)
                  if (candles?.s === 'ok' && candles.c) {
                    const macd = calculateMACD(candles.c)
                    indicatorCache.set(position.symbol, { macdHistogram: macd?.histogram })
                  }
                } catch (e) {
                  // Ignore
                }
              }
              const macdData = indicatorCache.get(position.symbol)
              if (macdData?.macdHistogram !== undefined && position.entryMACDTrough !== null) {
                if (macdData.macdHistogram < position.entryMACDTrough) {
                  shouldExit = true
                  exitReason = 'MACD_TROUGH_STOP'
                }
              }
              break
          }
        }

        // 4. Check INDICATOR-BASED EXITS (Connors: RSI > 50 or price above 5-day MA)
        if (!shouldExit && exitConds.indicators && exitConds.indicators.length > 0) {
          const exitLogic = exitConds.exitLogic || 'ANY'

          // Fetch indicators if needed
          if (!indicatorCache.has(position.symbol)) {
            try {
              const now = Math.floor(Date.now() / 1000)
              const thirtyDaysAgo = now - 30 * 24 * 60 * 60
              const candles = await getCandles(position.symbol, 'D', thirtyDaysAgo, now)
              if (candles?.s === 'ok' && candles.c) {
                const rsi2 = calculateRSI(candles.c, 2)
                const sma5 = calculateSMA(candles.c, 5)
                const bb = calculateBollingerBands(candles.c, 20, 2)
                const macd = calculateMACD(candles.c)
                indicatorCache.set(position.symbol, {
                  rsi2: rsi2 ?? undefined,
                  sma5: sma5 ?? undefined,
                  bbMiddle: bb?.middle,
                  macdHistogram: macd?.histogram,
                })
              }
            } catch (e) {
              // Ignore
            }
          }

          const indData = indicatorCache.get(position.symbol)
          let conditionsMet = 0
          let conditionsChecked = 0

          for (const cond of exitConds.indicators) {
            conditionsChecked++
            if (cond.type === 'RSI' && indData?.rsi2 !== undefined) {
              const threshold = cond.threshold || 50
              if (cond.comparison === 'greater_than' && indData.rsi2 > threshold) {
                conditionsMet++
                exitReason = 'RSI_EXIT'
              }
            } else if (cond.type === 'PRICE_VS_MA' && indData?.sma5 !== undefined) {
              if (cond.comparison === 'closes_above' && currentPrice > indData.sma5) {
                conditionsMet++
                exitReason = 'MA_EXIT'
              }
            } else if (cond.type === 'STOCHASTIC' && cond.comparison === 'overbought') {
              // Would need stochastic data - simplified for now
              conditionsMet++
            }
          }

          // Check if exit conditions are met based on logic
          if (exitLogic === 'ANY' && conditionsMet > 0) {
            shouldExit = true
          } else if (exitLogic === 'ALL' && conditionsMet === conditionsChecked) {
            shouldExit = true
          }
        }

        if (shouldExit) {
          const profitLoss = (currentPrice - position.entryPrice) * position.shares
          const isWin = profitLoss >= 0
          const totalTrades = position.simulation.tradesCompleted + 1
          const totalWins = position.simulation.winCount + (isWin ? 1 : 0)
          const exitSession = getMarketSession()

          await Promise.all([
            prisma.trade.updateMany({
              where: { simulationId: position.simulationId, symbol: position.symbol, exitDate: null },
              data: {
                exitDate: new Date(),
                exitPrice: currentPrice,
                profitLoss,
                profitLossPercent: pnlPercent,
                exitReason,
                exitSession,
                holdTimeHours: (Date.now() - new Date(position.entryDate).getTime()) / (1000 * 60 * 60),
              },
            }),
            prisma.position.delete({ where: { id: position.id } }),
            prisma.simulation.update({
              where: { id: position.simulationId },
              data: {
                currentCapital: { increment: position.shares * currentPrice },
                totalPL: { increment: profitLoss },
                totalPLPercent: ((position.simulation.totalPL + profitLoss) / position.simulation.initialCapital) * 100,
                tradesCompleted: { increment: 1 },
                winCount: isWin ? { increment: 1 } : undefined,
                lossCount: !isWin ? { increment: 1 } : undefined,
                winRate: (totalWins / totalTrades) * 100,
              },
            }),
          ])

          results.tradesClosed++
          results.exits.push({
            symbol: position.symbol,
            strategy: position.simulation.strategy.name,
            reason: exitReason,
            pnl: profitLoss,
            session: exitSession,
          })
        } else {
          // Update position's current price and trailing stop high
          const newTrailingHigh = position.trailingStopHigh
            ? Math.max(position.trailingStopHigh, currentPrice)
            : currentPrice

          await prisma.position.update({
            where: { id: position.id },
            data: {
              currentPrice,
              currentValue: position.shares * currentPrice,
              unrealizedPL: (currentPrice - position.entryPrice) * position.shares,
              unrealizedPLPercent: pnlPercent,
              trailingStopHigh: newTrailingHigh, // Update for ATR trailing stops
            },
          })
          results.positionsUpdated++
        }
      } catch (err) {
        results.errors.push(`${position.symbol}: ${err instanceof Error ? err.message : 'Unknown'}`)
      }
    }

    return NextResponse.json({
      success: true,
      processingTimeMs: Date.now() - startTime,
      ...results,
    })
  } catch (error) {
    console.error('Check exits error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET - Quick status check with update timestamps
export async function GET() {
  const positions = await prisma.position.findMany({
    include: { simulation: { include: { strategy: { select: { name: true, exitConditions: true } } } } },
    orderBy: { updatedAt: 'desc' },
  })

  // Calculate aggregate stats
  const totalCurrentValue = positions.reduce((sum, p) => sum + p.currentValue, 0)
  const mostRecentUpdate = positions.length > 0 ? positions[0].updatedAt : null
  const oldestUpdate = positions.length > 0 ? positions[positions.length - 1].updatedAt : null

  return NextResponse.json({
    totalPositions: positions.length,
    totalCurrentValue: totalCurrentValue.toFixed(2),
    mostRecentUpdate: mostRecentUpdate?.toISOString(),
    oldestUpdate: oldestUpdate?.toISOString(),
    positions: positions.map(p => {
      const exitConds = p.simulation.strategy.exitConditions as { profitTarget: number; stopLoss: number }
      const pnlPercent = ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100
      return {
        symbol: p.symbol,
        strategy: p.simulation.strategy.name,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        currentValue: p.currentValue.toFixed(2),
        pnlPercent: pnlPercent.toFixed(2),
        target: exitConds.profitTarget,
        stopLoss: exitConds.stopLoss,
        distanceToTarget: (exitConds.profitTarget - pnlPercent).toFixed(2),
        distanceToStop: (pnlPercent + exitConds.stopLoss).toFixed(2),
        updatedAt: p.updatedAt.toISOString(),
      }
    }),
  })
}
