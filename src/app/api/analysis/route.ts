import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface StrategyMetrics {
  strategyId: string
  strategyName: string

  // Capital & Returns
  initialCapital: number
  currentCapital: number
  totalReturn: number
  totalReturnPercent: number

  // Trade Statistics
  totalTrades: number
  openTrades: number
  closedTrades: number
  winCount: number
  lossCount: number
  winRate: number

  // Profit/Loss Analysis
  grossProfit: number
  grossLoss: number
  profitFactor: number // grossProfit / grossLoss
  averageWin: number
  averageLoss: number
  averageWinPercent: number
  averageLossPercent: number
  expectancy: number // (winRate * avgWin) - (lossRate * avgLoss)

  // Risk Metrics
  largestWin: number
  largestLoss: number
  largestWinPercent: number
  largestLossPercent: number
  maxDrawdown: number
  maxDrawdownPercent: number

  // Time Analysis
  avgHoldTimeHours: number
  avgWinHoldTime: number
  avgLossHoldTime: number

  // Trade Distribution
  profitTargetExits: number
  stopLossExits: number

  // Current Positions
  unrealizedPL: number
  unrealizedPLPercent: number
}

interface CorrelationData {
  strategy1: string
  strategy2: string
  sharedSymbols: string[]
  correlation: number // -1 to 1
}

interface AnalysisResponse {
  generatedAt: string
  simulationDays: number
  totalCapitalDeployed: number
  totalCurrentValue: number
  overallReturn: number
  overallReturnPercent: number

  strategies: StrategyMetrics[]
  rankings: {
    byReturn: string[]
    byWinRate: string[]
    byProfitFactor: string[]
    byRiskAdjusted: string[] // Return / MaxDrawdown
  }

  correlations: CorrelationData[]

  recommendations: {
    bestOverall: string
    bestWinRate: string
    bestRiskAdjusted: string
    worstPerformer: string
    hybridSuggestion: string
  }
}

// GET /api/analysis - Full strategy analysis
export async function GET() {
  try {
    // Get all strategies with simulations and trades
    const strategies = await prisma.strategy.findMany({
      include: {
        simulations: {
          where: { status: 'running' },
          include: {
            trades: true,
            positions: true,
          },
        },
      },
    })

    const strategyMetrics: StrategyMetrics[] = []

    for (const strategy of strategies) {
      const simulation = strategy.simulations[0]
      if (!simulation) continue

      const closedTrades = simulation.trades.filter(t => t.exitDate !== null)
      const openTrades = simulation.trades.filter(t => t.exitDate === null)

      const wins = closedTrades.filter(t => (t.profitLoss ?? 0) > 0)
      const losses = closedTrades.filter(t => (t.profitLoss ?? 0) <= 0)

      const grossProfit = wins.reduce((sum, t) => sum + (t.profitLoss ?? 0), 0)
      const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.profitLoss ?? 0), 0))

      const avgWin = wins.length > 0 ? grossProfit / wins.length : 0
      const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0

      const avgWinPercent = wins.length > 0
        ? wins.reduce((sum, t) => sum + (t.profitLossPercent ?? 0), 0) / wins.length
        : 0
      const avgLossPercent = losses.length > 0
        ? Math.abs(losses.reduce((sum, t) => sum + (t.profitLossPercent ?? 0), 0) / losses.length)
        : 0

      const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0
      const lossRate = 100 - winRate

      // Calculate hold times
      const calculateHoldTime = (trades: typeof closedTrades) => {
        if (trades.length === 0) return 0
        const totalHours = trades.reduce((sum, t) => {
          if (!t.exitDate) return sum
          const hours = (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / (1000 * 60 * 60)
          return sum + hours
        }, 0)
        return totalHours / trades.length
      }

      // Calculate max drawdown (simplified - based on closed trades)
      let maxDrawdown = 0
      let peak = simulation.initialCapital
      let runningCapital = simulation.initialCapital

      const sortedTrades = [...closedTrades].sort((a, b) =>
        new Date(a.exitDate!).getTime() - new Date(b.exitDate!).getTime()
      )

      for (const trade of sortedTrades) {
        runningCapital += (trade.profitLoss ?? 0)
        if (runningCapital > peak) {
          peak = runningCapital
        }
        const drawdown = peak - runningCapital
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown
        }
      }

      // Unrealized P&L from positions
      const unrealizedPL = simulation.positions.reduce((sum, p) => sum + p.unrealizedPL, 0)
      const positionValue = simulation.positions.reduce((sum, p) => sum + p.currentValue, 0)
      const positionCost = simulation.positions.reduce((sum, p) => sum + (p.entryPrice * p.shares), 0)
      const unrealizedPLPercent = positionCost > 0 ? (unrealizedPL / positionCost) * 100 : 0

      // Exit reason counts
      const profitTargetExits = closedTrades.filter(t => t.exitReason === 'PROFIT_TARGET').length
      const stopLossExits = closedTrades.filter(t => t.exitReason === 'STOP_LOSS').length

      // Find largest win/loss
      const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.profitLoss ?? 0)) : 0
      const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.profitLoss ?? 0)) : 0
      const largestWinPercent = wins.length > 0 ? Math.max(...wins.map(t => t.profitLossPercent ?? 0)) : 0
      const largestLossPercent = losses.length > 0 ? Math.min(...losses.map(t => t.profitLossPercent ?? 0)) : 0

      const totalReturn = simulation.totalPL + unrealizedPL
      const totalReturnPercent = (totalReturn / simulation.initialCapital) * 100

      strategyMetrics.push({
        strategyId: strategy.id,
        strategyName: strategy.name,

        initialCapital: simulation.initialCapital,
        currentCapital: simulation.currentCapital,
        totalReturn,
        totalReturnPercent,

        totalTrades: simulation.trades.length,
        openTrades: openTrades.length,
        closedTrades: closedTrades.length,
        winCount: wins.length,
        lossCount: losses.length,
        winRate,

        grossProfit,
        grossLoss,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
        averageWin: avgWin,
        averageLoss: avgLoss,
        averageWinPercent: avgWinPercent,
        averageLossPercent: avgLossPercent,
        expectancy: (winRate / 100 * avgWin) - (lossRate / 100 * avgLoss),

        largestWin,
        largestLoss,
        largestWinPercent,
        largestLossPercent,
        maxDrawdown,
        maxDrawdownPercent: simulation.initialCapital > 0 ? (maxDrawdown / simulation.initialCapital) * 100 : 0,

        avgHoldTimeHours: calculateHoldTime(closedTrades),
        avgWinHoldTime: calculateHoldTime(wins),
        avgLossHoldTime: calculateHoldTime(losses),

        profitTargetExits,
        stopLossExits,

        unrealizedPL,
        unrealizedPLPercent,
      })
    }

    // Calculate correlations (shared symbols between strategies)
    const correlations: CorrelationData[] = []
    for (let i = 0; i < strategyMetrics.length; i++) {
      for (let j = i + 1; j < strategyMetrics.length; j++) {
        const strat1 = strategies.find(s => s.id === strategyMetrics[i].strategyId)
        const strat2 = strategies.find(s => s.id === strategyMetrics[j].strategyId)

        if (!strat1?.simulations[0] || !strat2?.simulations[0]) continue

        const symbols1 = new Set(strat1.simulations[0].trades.map(t => t.symbol))
        const symbols2 = new Set(strat2.simulations[0].trades.map(t => t.symbol))

        const sharedSymbols = [...symbols1].filter(s => symbols2.has(s))
        const totalUniqueSymbols = new Set([...symbols1, ...symbols2]).size

        correlations.push({
          strategy1: strategyMetrics[i].strategyName,
          strategy2: strategyMetrics[j].strategyName,
          sharedSymbols,
          correlation: totalUniqueSymbols > 0 ? sharedSymbols.length / totalUniqueSymbols : 0,
        })
      }
    }

    // Sort for rankings
    const byReturn = [...strategyMetrics].sort((a, b) => b.totalReturnPercent - a.totalReturnPercent)
    const byWinRate = [...strategyMetrics].sort((a, b) => b.winRate - a.winRate)
    const byProfitFactor = [...strategyMetrics].sort((a, b) => b.profitFactor - a.profitFactor)
    const byRiskAdjusted = [...strategyMetrics].sort((a, b) => {
      const aRatio = a.maxDrawdownPercent > 0 ? a.totalReturnPercent / a.maxDrawdownPercent : a.totalReturnPercent
      const bRatio = b.maxDrawdownPercent > 0 ? b.totalReturnPercent / b.maxDrawdownPercent : b.totalReturnPercent
      return bRatio - aRatio
    })

    // Calculate totals
    const totalCapitalDeployed = strategyMetrics.reduce((sum, s) => sum + s.initialCapital, 0)
    const totalCurrentValue = strategyMetrics.reduce((sum, s) => sum + s.currentCapital + s.unrealizedPL, 0)

    // Get simulation start date
    const firstTrade = await prisma.trade.findFirst({
      orderBy: { entryDate: 'asc' },
    })
    const simulationDays = firstTrade
      ? Math.ceil((Date.now() - new Date(firstTrade.entryDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0

    // Generate recommendations
    const bestOverall = byReturn[0]?.strategyName ?? 'N/A'
    const bestWinRate = byWinRate[0]?.strategyName ?? 'N/A'
    const bestRiskAdjusted = byRiskAdjusted[0]?.strategyName ?? 'N/A'
    const worstPerformer = byReturn[byReturn.length - 1]?.strategyName ?? 'N/A'

    // Hybrid suggestion logic
    let hybridSuggestion = 'Insufficient data for hybrid recommendation'
    if (strategyMetrics.length >= 2 && strategyMetrics.some(s => s.closedTrades >= 10)) {
      const highWinRate = byWinRate[0]
      const highProfitFactor = byProfitFactor[0]

      if (highWinRate && highProfitFactor && highWinRate.strategyName !== highProfitFactor.strategyName) {
        hybridSuggestion = `Consider combining ${highWinRate.strategyName} entry signals (${highWinRate.winRate.toFixed(1)}% win rate) with ${highProfitFactor.strategyName} exit rules (${highProfitFactor.profitFactor.toFixed(2)} profit factor)`
      } else if (highWinRate) {
        hybridSuggestion = `${highWinRate.strategyName} shows promise - consider widening profit targets to capture larger moves`
      }
    }

    const response: AnalysisResponse = {
      generatedAt: new Date().toISOString(),
      simulationDays,
      totalCapitalDeployed,
      totalCurrentValue,
      overallReturn: totalCurrentValue - totalCapitalDeployed,
      overallReturnPercent: totalCapitalDeployed > 0
        ? ((totalCurrentValue - totalCapitalDeployed) / totalCapitalDeployed) * 100
        : 0,

      strategies: strategyMetrics,
      rankings: {
        byReturn: byReturn.map(s => s.strategyName),
        byWinRate: byWinRate.map(s => s.strategyName),
        byProfitFactor: byProfitFactor.map(s => s.strategyName),
        byRiskAdjusted: byRiskAdjusted.map(s => s.strategyName),
      },

      correlations: correlations.sort((a, b) => b.correlation - a.correlation),

      recommendations: {
        bestOverall,
        bestWinRate,
        bestRiskAdjusted,
        worstPerformer,
        hybridSuggestion,
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
