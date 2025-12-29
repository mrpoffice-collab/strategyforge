import prisma from './prisma'
import {
  getQuote,
  getCandles,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateSMA,
  calculateEMA,
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
  indicators: Record<string, number | null>
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

  // Calculate all indicators
  const indicators: Record<string, number | null> = {
    rsi14: calculateRSI(closes, 14),
    sma20: calculateSMA(closes, 20),
    sma50: calculateSMA(closes, 50),
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

  // Check each indicator condition
  let allConditionsMet = true
  const reasons: string[] = []

  for (const condition of conditions.indicators) {
    switch (condition.type) {
      case 'RSI':
        const rsi = indicators.rsi14
        if (rsi !== null) {
          if (condition.comparison === 'below' && rsi >= (condition.threshold || 30)) {
            allConditionsMet = false
          } else if (condition.comparison === 'above' && rsi <= (condition.threshold || 70)) {
            allConditionsMet = false
          } else {
            reasons.push(`RSI ${rsi.toFixed(1)} ${condition.comparison} ${condition.threshold}`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'MACD':
        if (macdData) {
          // Check for crossover
          if (condition.comparison === 'crossover_above' && macdData.histogram <= 0) {
            allConditionsMet = false
          } else if (condition.comparison === 'crossover_below' && macdData.histogram >= 0) {
            allConditionsMet = false
          } else {
            reasons.push(`MACD crossover detected`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'BollingerBands':
        if (bbands) {
          if (condition.comparison === 'below_lower' && price >= bbands.lower) {
            allConditionsMet = false
          } else if (condition.comparison === 'above_upper' && price <= bbands.upper) {
            allConditionsMet = false
          } else {
            reasons.push(`Price at Bollinger Band`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'SMA':
        const shortSMA = indicators.sma20
        const longSMA = indicators.sma50
        if (shortSMA && longSMA) {
          if (condition.comparison === 'golden_cross' && shortSMA <= longSMA) {
            allConditionsMet = false
          } else if (condition.comparison === 'death_cross' && shortSMA >= longSMA) {
            allConditionsMet = false
          } else {
            reasons.push(`SMA crossover detected`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'Volume':
        if (volumes && volumes.length >= 30) {
          const avgVolume = volumes.slice(-30).reduce((a, b) => a + b, 0) / 30
          const currentVolume = volumes[volumes.length - 1]
          const volumeMultiple = condition.threshold || 1.5

          if (currentVolume < avgVolume * volumeMultiple) {
            allConditionsMet = false
          } else {
            reasons.push(`Volume ${(currentVolume / avgVolume).toFixed(1)}x average`)
          }
        } else {
          allConditionsMet = false
        }
        break

      case 'Fibonacci':
        if (highs && lows && highs.length >= 20) {
          const recentHigh = Math.max(...highs.slice(-20))
          const recentLow = Math.min(...lows.slice(-20))
          const range = recentHigh - recentLow
          const fib382 = recentHigh - range * 0.382
          const fib618 = recentHigh - range * 0.618
          const tolerance = range * 0.02

          if (Math.abs(price - fib618) <= tolerance || Math.abs(price - fib382) <= tolerance) {
            reasons.push(`Near Fibonacci level`)
          } else {
            allConditionsMet = false
          }
        } else {
          allConditionsMet = false
        }
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
      const allSymbols = await getTradeableSymbols()
      const shuffledSymbols = [...allSymbols].sort(() => Math.random() - 0.5).slice(0, 50)

      for (const symbol of shuffledSymbols) {
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
