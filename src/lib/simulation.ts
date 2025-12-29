import prisma from './prisma'
import {
  getQuote,
  getCandles,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateSMA,
  calculateEMA,
  calculateATR,
  calculateStochastic,
  calculateADX,
  calculateBBWidth,
  detectRSIDivergence,
  calculateROC,
  detectMAAlignment,
  getTradeableSymbols,
} from './finnhub'

interface EntryConditions {
  indicators: Array<{
    type: string
    period?: number
    threshold?: number
    comparison?: string
    [key: string]: unknown
  }>
  priceRange: { min: number; max: number }
}

interface ExitConditions {
  indicators: Array<{
    type: string
    [key: string]: unknown
  }>
  profitTarget: number
  stopLoss: number
}

interface TradeSignal {
  symbol: string
  action: 'BUY' | 'SELL' | 'HOLD'
  price: number
  reason: string
  indicators: Record<string, number | string | null>
}

// Check if entry conditions are met for a strategy
async function checkEntryConditions(
  symbol: string,
  conditions: EntryConditions
): Promise<TradeSignal | null> {
  const quote = await getQuote(symbol)
  if (!quote || quote.c === 0) return null

  const price = quote.c

  // Check price range
  if (price < conditions.priceRange.min || price > conditions.priceRange.max) {
    return null
  }

  // Get historical data for indicator calculation
  const now = Math.floor(Date.now() / 1000)
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60
  const candles = await getCandles(symbol, 'D', thirtyDaysAgo, now)

  if (!candles || candles.s !== 'ok' || !candles.c || candles.c.length < 20) {
    return null
  }

  const closes = candles.c
  const volumes = candles.v
  const highs = candles.h
  const lows = candles.l

  // Calculate ALL indicators for hybrid strategies
  const indicators: Record<string, number | string | null> = {
    rsi14: calculateRSI(closes, 14),
    sma10: calculateSMA(closes, 10),
    sma20: calculateSMA(closes, 20),
    sma50: calculateSMA(closes, 50),
    sma200: calculateSMA(closes, 200),
    roc12: calculateROC(closes, 12),
    bbWidth: calculateBBWidth(closes, 20, 2),
  }

  const macdData = calculateMACD(closes)
  if (macdData) {
    indicators.macd = macdData.macd
    indicators.macdSignal = macdData.signal
    indicators.macdHistogram = macdData.histogram
  }

  const bbands = calculateBollingerBands(closes, 20, 2)
  if (bbands) {
    indicators.bbUpper = bbands.upper
    indicators.bbMiddle = bbands.middle
    indicators.bbLower = bbands.lower
  }

  // Advanced indicators for hybrid strategies
  const stoch = calculateStochastic(highs, lows, closes, 14, 3)
  if (stoch) {
    indicators.stochK = stoch.k
    indicators.stochD = stoch.d
  }

  const adxData = calculateADX(highs, lows, closes, 14)
  if (adxData) {
    indicators.adx = adxData.adx
    indicators.plusDI = adxData.plusDI
    indicators.minusDI = adxData.minusDI
  }

  const atr = calculateATR(highs, lows, closes, 14)
  if (atr) {
    indicators.atr = atr
    indicators.atrPercent = (atr / price) * 100
  }

  // Divergence and alignment detection
  const rsiDivergence = detectRSIDivergence(closes, 14, 10)
  indicators.rsiDivergence = rsiDivergence

  const maAlignment = detectMAAlignment(closes, 10, 20, 50)
  indicators.maAlignment = maAlignment

  // Check each indicator condition
  let allConditionsMet = true
  const reasons: string[] = []

  for (const condition of conditions.indicators) {
    switch (condition.type) {
      case 'RSI':
        const rsi = indicators.rsi14 as number | null
        if (rsi !== null) {
          const comp = condition.comparison
          const threshold = condition.threshold || 30
          // Support both formats: 'below'/'above' and 'less_than'/'greater_than'
          if ((comp === 'below' || comp === 'less_than') && rsi >= threshold) {
            allConditionsMet = false
          } else if ((comp === 'above' || comp === 'greater_than') && rsi <= threshold) {
            allConditionsMet = false
          } else if (comp === 'between') {
            const minVal = (condition as { min?: number }).min || 30
            const maxVal = (condition as { max?: number }).max || 70
            if (rsi < minVal || rsi > maxVal) {
              allConditionsMet = false
            } else {
              reasons.push(`RSI ${rsi.toFixed(1)} in range ${minVal}-${maxVal}`)
            }
          } else {
            reasons.push(`RSI ${rsi.toFixed(1)} ${comp} ${threshold}`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'MACD':
      case 'MACD_CROSSOVER':
        if (macdData) {
          const dir = (condition as { direction?: string }).direction
          const comp = condition.comparison
          // Support both: direction 'bullish'/'bearish' and comparison 'crossover_above'/'crossover_below'
          const isBullish = dir === 'bullish' || comp === 'crossover_above'
          const isBearish = dir === 'bearish' || comp === 'crossover_below'
          const isPositive = comp === 'positive' || comp === 'histogram_positive'
          const isIncreasing = comp === 'increasing'

          if (isBullish && macdData.histogram <= 0) {
            allConditionsMet = false
          } else if (isBearish && macdData.histogram >= 0) {
            allConditionsMet = false
          } else if (isPositive && macdData.histogram <= 0) {
            allConditionsMet = false
          } else if (isIncreasing) {
            // Check if histogram is increasing (basic approximation)
            if (macdData.histogram <= 0) allConditionsMet = false
            else reasons.push(`MACD histogram positive and increasing`)
          } else {
            reasons.push(`MACD crossover detected`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'BollingerBands':
      case 'BOLLINGER':
        if (bbands) {
          const comp = condition.comparison
          const band = (condition as { band?: string }).band
          // Support multiple formats
          if ((comp === 'below_lower' || band === 'lower') && price >= bbands.lower) {
            allConditionsMet = false
          } else if ((comp === 'above_upper' || comp === 'price_above' || band === 'upper') && price <= bbands.upper) {
            allConditionsMet = false
          } else if (comp === 'above_middle' || (band === 'middle' && comp === 'above')) {
            if (price <= bbands.middle) {
              allConditionsMet = false
            } else {
              reasons.push(`Price above middle BB`)
            }
          } else if (comp === 'near_lower') {
            const tolerance = bbands.middle - bbands.lower
            if (price > bbands.lower + tolerance * 0.3) {
              allConditionsMet = false
            } else {
              reasons.push(`Price near lower BB`)
            }
          } else {
            reasons.push(`Price at Bollinger Band`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'BB_WIDTH':
      case 'BOLLINGER_WIDTH':
        const width = indicators.bbWidth as number | null
        if (width !== null) {
          const comp = condition.comparison
          const threshold = condition.threshold || 10
          if (comp === 'squeeze' || comp === 'less_than') {
            if (width >= threshold) {
              allConditionsMet = false
            } else {
              reasons.push(`BB Width ${width.toFixed(1)}% (squeeze)`)
            }
          } else if (comp === 'expansion' || comp === 'greater_than') {
            if (width <= threshold) {
              allConditionsMet = false
            } else {
              reasons.push(`BB Width ${width.toFixed(1)}% (expansion)`)
            }
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'SMA':
      case 'MA_CROSSOVER':
        const shortSMA = indicators.sma20 as number | null
        const longSMA = indicators.sma50 as number | null
        if (shortSMA && longSMA) {
          const dir = (condition as { direction?: string }).direction
          const comp = condition.comparison
          const isGolden = dir === 'golden' || comp === 'golden_cross'
          const isDeath = dir === 'death' || comp === 'death_cross'

          if (isGolden && shortSMA <= longSMA) {
            allConditionsMet = false
          } else if (isDeath && shortSMA >= longSMA) {
            allConditionsMet = false
          } else {
            reasons.push(`SMA crossover detected`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'MA_ALIGNMENT':
        const alignment = indicators.maAlignment as string
        const requiredAlign = (condition as { direction?: string }).direction || 'bullish'
        if (alignment !== requiredAlign) {
          allConditionsMet = false
        } else {
          reasons.push(`MA ${alignment} alignment`)
        }
        break

      case 'PRICE_VS_MA':
        const maPeriod = (condition as { period?: number }).period || 50
        const maKey = `sma${maPeriod}` as keyof typeof indicators
        const maValue = indicators[maKey] as number | null || calculateSMA(closes, maPeriod)
        if (maValue) {
          const comp = condition.comparison
          if ((comp === 'above') && price <= maValue) {
            allConditionsMet = false
          } else if ((comp === 'below') && price >= maValue) {
            allConditionsMet = false
          } else if (comp === 'pullback_to') {
            const tolerance = maValue * 0.02
            if (Math.abs(price - maValue) > tolerance) {
              allConditionsMet = false
            } else {
              reasons.push(`Price pullback to ${maPeriod} MA`)
            }
          } else {
            reasons.push(`Price ${comp} ${maPeriod} MA`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'STOCHASTIC':
        const stochK = indicators.stochK as number | null
        const stochD = indicators.stochD as number | null
        if (stochK !== null && stochD !== null) {
          const comp = condition.comparison
          const threshold = condition.threshold || 20
          if (comp === 'oversold' && stochK >= threshold) {
            allConditionsMet = false
          } else if (comp === 'overbought' && stochK <= (100 - threshold)) {
            allConditionsMet = false
          } else if (comp === 'bullish_cross' && stochK <= stochD) {
            allConditionsMet = false
          } else if (comp === 'turning_up' && stochK <= stochD) {
            allConditionsMet = false
          } else {
            reasons.push(`Stochastic %K ${stochK.toFixed(1)} ${comp}`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'ADX':
        const adx = indicators.adx as number | null
        const plusDI = indicators.plusDI as number | null
        const minusDI = indicators.minusDI as number | null
        if (adx !== null) {
          const comp = condition.comparison
          const threshold = condition.threshold || 25
          if (comp === 'strong_trend' && adx < threshold) {
            allConditionsMet = false
          } else if (comp === 'weak_trend' && adx >= threshold) {
            allConditionsMet = false
          } else if (comp === 'bullish_di' && (plusDI === null || minusDI === null || plusDI <= minusDI)) {
            allConditionsMet = false
          } else {
            reasons.push(`ADX ${adx.toFixed(1)} ${comp}`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'RSI_DIVERGENCE':
        const divergence = indicators.rsiDivergence as string | null
        const reqDivergence = (condition as { direction?: string }).direction || 'bullish'
        if (divergence !== reqDivergence) {
          allConditionsMet = false
        } else {
          reasons.push(`RSI ${divergence} divergence`)
        }
        break

      case 'ROC':
        const roc = indicators.roc12 as number | null
        if (roc !== null) {
          const comp = condition.comparison
          const threshold = condition.threshold || 0
          if (comp === 'positive' && roc <= threshold) {
            allConditionsMet = false
          } else if (comp === 'negative' && roc >= threshold) {
            allConditionsMet = false
          } else if (comp === 'greater_than' && roc <= threshold) {
            allConditionsMet = false
          } else {
            reasons.push(`ROC ${roc.toFixed(1)}%`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'ATR':
        const atrPercent = indicators.atrPercent as number | null
        if (atrPercent !== null) {
          const comp = condition.comparison
          const threshold = condition.threshold || 2
          if (comp === 'expanding' && atrPercent < threshold) {
            allConditionsMet = false
          } else if (comp === 'contracting' && atrPercent >= threshold) {
            allConditionsMet = false
          } else {
            reasons.push(`ATR ${atrPercent.toFixed(2)}%`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'Volume':
      case 'VOLUME':
        if (volumes && volumes.length >= 30) {
          const period = (condition as { period?: number }).period || 30
          const avgVolume = volumes.slice(-period).reduce((a, b) => a + b, 0) / period
          const currentVolume = volumes[volumes.length - 1]
          const multiplier = (condition as { multiplier?: number }).multiplier || condition.threshold || 1.5

          if (currentVolume < avgVolume * multiplier) {
            allConditionsMet = false
          } else {
            reasons.push(`Volume ${(currentVolume / avgVolume).toFixed(1)}x average`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'Fibonacci':
      case 'FIBONACCI':
        if (highs && lows && highs.length >= 20) {
          const recentHigh = Math.max(...highs.slice(-20))
          const recentLow = Math.min(...lows.slice(-20))
          const range = recentHigh - recentLow
          const level = (condition as { level?: number }).level || 0.618
          const fibLevel = recentHigh - range * level
          const tolerance = (condition as { tolerance?: number }).tolerance || 0.02
          const toleranceAbs = range * tolerance

          if (Math.abs(price - fibLevel) <= toleranceAbs) {
            reasons.push(`Near Fibonacci ${level} level`)
          } else {
            allConditionsMet = false
          }
        } else {
          allConditionsMet = false
        }
        break

      // Skip conditions we don't have data for (like CANDLESTICK, TREND, PRICE_BREAKOUT)
      case 'CANDLESTICK':
      case 'TREND':
      case 'PRICE_BREAKOUT':
      case 'PRICE_VS_SMA':
        // These require more complex analysis - skip for now, don't fail
        reasons.push(`${condition.type} check skipped`)
        break
    }
  }

  if (allConditionsMet && reasons.length > 0) {
    return {
      symbol,
      action: 'BUY',
      price,
      reason: reasons.join(', '),
      indicators,
    }
  }

  return null
}

// Check if exit conditions are met for a position
async function checkExitConditions(
  position: { symbol: string; entryPrice: number },
  conditions: ExitConditions
): Promise<TradeSignal | null> {
  const quote = await getQuote(position.symbol)
  if (!quote || quote.c === 0) return null

  const price = quote.c
  const pnlPercent = ((price - position.entryPrice) / position.entryPrice) * 100

  // Check profit target
  if (pnlPercent >= conditions.profitTarget) {
    return {
      symbol: position.symbol,
      action: 'SELL',
      price,
      reason: 'PROFIT_TARGET',
      indicators: {},
    }
  }

  // Check stop loss
  if (pnlPercent <= -conditions.stopLoss) {
    return {
      symbol: position.symbol,
      action: 'SELL',
      price,
      reason: 'STOP_LOSS',
      indicators: {},
    }
  }

  // Check indicator-based exits
  const now = Math.floor(Date.now() / 1000)
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60
  const candles = await getCandles(position.symbol, 'D', thirtyDaysAgo, now)

  if (candles && candles.s === 'ok' && candles.c) {
    const closes = candles.c

    for (const condition of conditions.indicators) {
      if (condition.type === 'RSI') {
        const rsi = calculateRSI(closes, 14)
        if (rsi !== null && rsi >= 70) {
          return {
            symbol: position.symbol,
            action: 'SELL',
            price,
            reason: 'SIGNAL',
            indicators: { rsi14: rsi },
          }
        }
      }
    }
  }

  return null
}

// Run simulation tick for a single strategy
export async function runSimulationTick(simulationId: string): Promise<{
  entriesExecuted: number
  exitsExecuted: number
  errors: string[]
}> {
  const errors: string[] = []
  let entriesExecuted = 0
  let exitsExecuted = 0

  try {
    const simulation = await prisma.simulation.findUnique({
      where: { id: simulationId },
      include: {
        strategy: true,
        positions: true,
        trades: {
          where: { exitDate: null },
        },
      },
    })

    if (!simulation || simulation.status !== 'running') {
      return { entriesExecuted, exitsExecuted, errors: ['Simulation not running'] }
    }

    if (simulation.tradesCompleted >= simulation.tradesLimit) {
      await prisma.simulation.update({
        where: { id: simulationId },
        data: { status: 'completed' },
      })
      return { entriesExecuted, exitsExecuted, errors: ['Trade limit reached'] }
    }

    const entryConditions = simulation.strategy.entryConditions as unknown as EntryConditions
    const exitConditions = simulation.strategy.exitConditions as unknown as ExitConditions

    // Check exits for existing positions
    for (const position of simulation.positions) {
      const signal = await checkExitConditions(
        { symbol: position.symbol, entryPrice: position.entryPrice },
        exitConditions
      )

      if (signal && signal.action === 'SELL') {
        const holdTimeHours = (Date.now() - position.entryDate.getTime()) / (1000 * 60 * 60)
        const profitLoss = (signal.price - position.entryPrice) * position.shares
        const profitLossPercent = ((signal.price - position.entryPrice) / position.entryPrice) * 100
        const isWin = profitLoss >= 0

        // Close the trade
        await prisma.trade.updateMany({
          where: {
            simulationId,
            symbol: position.symbol,
            exitDate: null,
          },
          data: {
            exitDate: new Date(),
            exitPrice: signal.price,
            profitLoss,
            profitLossPercent,
            holdTimeHours,
            exitReason: signal.reason,
          },
        })

        // Remove position
        await prisma.position.delete({
          where: { id: position.id },
        })

        // Update simulation stats
        await prisma.simulation.update({
          where: { id: simulationId },
          data: {
            currentCapital: { increment: position.shares * signal.price },
            totalPL: { increment: profitLoss },
            tradesCompleted: { increment: 1 },
            winCount: isWin ? { increment: 1 } : undefined,
            lossCount: !isWin ? { increment: 1 } : undefined,
            largestWin: isWin && profitLoss > simulation.largestWin ? profitLoss : undefined,
            largestLoss: !isWin && profitLoss < simulation.largestLoss ? profitLoss : undefined,
          },
        })

        exitsExecuted++
      }
    }

    // Check for new entries if we have available capital
    const updatedSimulation = await prisma.simulation.findUnique({
      where: { id: simulationId },
    })

    if (!updatedSimulation) return { entriesExecuted, exitsExecuted, errors }

    const positionSize = simulation.strategy.positionSize / 100
    const maxPositionValue = updatedSimulation.currentCapital * positionSize

    // Only open new positions if we have capital
    if (maxPositionValue >= 100) {
      // Get all tradeable symbols and shuffle to avoid bias
      // Scan up to 30 symbols per strategy, stop early if we find an entry
      const allSymbols = await getTradeableSymbols()
      const shuffledSymbols = [...allSymbols].sort(() => Math.random() - 0.5).slice(0, 30)
      const startTime = Date.now()
      const maxScanTime = 8000 // 8 seconds max per strategy for scanning

      for (const symbol of shuffledSymbols) {
        // Time check - don't exceed scan time
        if (Date.now() - startTime > maxScanTime) break
        // Check if we already have a position
        const existingPosition = await prisma.position.findUnique({
          where: {
            simulationId_symbol: { simulationId, symbol },
          },
        })

        if (existingPosition) continue

        const signal = await checkEntryConditions(symbol, entryConditions)

        if (signal && signal.action === 'BUY') {
          const shares = Math.floor(maxPositionValue / signal.price)
          if (shares < 1) continue

          const totalCost = shares * signal.price

          // Create position
          await prisma.position.create({
            data: {
              simulationId,
              symbol,
              shares,
              entryPrice: signal.price,
              entryDate: new Date(),
              currentPrice: signal.price,
              currentValue: totalCost,
              unrealizedPL: 0,
              unrealizedPLPercent: 0,
            },
          })

          // Create trade record
          await prisma.trade.create({
            data: {
              simulationId,
              strategyId: simulation.strategyId,
              symbol,
              side: 'BUY',
              entryDate: new Date(),
              entryPrice: signal.price,
              shares,
              totalCost,
              indicatorsAtEntry: signal.indicators,
            },
          })

          // Update simulation capital
          await prisma.simulation.update({
            where: { id: simulationId },
            data: {
              currentCapital: { decrement: totalCost },
            },
          })

          entriesExecuted++

          // Only one entry per tick to avoid over-concentration
          break
        }

        // Rate limit API calls
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    // Update simulation stats
    const finalSimulation = await prisma.simulation.findUnique({
      where: { id: simulationId },
    })

    if (finalSimulation && (finalSimulation.winCount + finalSimulation.lossCount) > 0) {
      const winRate =
        (finalSimulation.winCount / (finalSimulation.winCount + finalSimulation.lossCount)) * 100
      const totalPLPercent =
        ((finalSimulation.currentCapital - finalSimulation.initialCapital) /
          finalSimulation.initialCapital) *
        100

      await prisma.simulation.update({
        where: { id: simulationId },
        data: {
          winRate,
          totalPLPercent,
        },
      })
    }
  } catch (error) {
    console.error('Simulation error:', error)
    errors.push(error instanceof Error ? error.message : 'Unknown error')
  }

  return { entriesExecuted, exitsExecuted, errors }
}

// Update position prices
export async function updatePositionPrices(simulationId: string): Promise<void> {
  const positions = await prisma.position.findMany({
    where: { simulationId },
  })

  for (const position of positions) {
    const quote = await getQuote(position.symbol)
    if (quote && quote.c > 0) {
      const currentValue = position.shares * quote.c
      const unrealizedPL = currentValue - position.shares * position.entryPrice
      const unrealizedPLPercent = ((quote.c - position.entryPrice) / position.entryPrice) * 100

      await prisma.position.update({
        where: { id: position.id },
        data: {
          currentPrice: quote.c,
          currentValue,
          unrealizedPL,
          unrealizedPLPercent,
        },
      })
    }

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

// Run all active simulations
export async function runAllSimulations(): Promise<{
  simulationsProcessed: number
  totalEntries: number
  totalExits: number
  errors: string[]
}> {
  const simulations = await prisma.simulation.findMany({
    where: { status: 'running' },
  })

  let totalEntries = 0
  let totalExits = 0
  const allErrors: string[] = []

  for (const simulation of simulations) {
    const result = await runSimulationTick(simulation.id)
    totalEntries += result.entriesExecuted
    totalExits += result.exitsExecuted
    allErrors.push(...result.errors)

    // Update position prices
    await updatePositionPrices(simulation.id)
  }

  return {
    simulationsProcessed: simulations.length,
    totalEntries,
    totalExits,
    errors: allErrors,
  }
}
