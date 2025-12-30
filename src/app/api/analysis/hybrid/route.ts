import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

interface HybridAnalysis {
  entryStrategy: string
  exitStrategy: string
  simulatedTrades: number
  simulatedWinRate: number
  simulatedProfitFactor: number
  avgReturn: number
  recommendation: string
}

// GET /api/analysis/hybrid - Analyze potential hybrid strategy combinations
export async function GET() {
  try {
    // Get all strategies with their exit conditions and trade data
    const strategies = await prisma.strategy.findMany({
      include: {
        simulations: {
          where: { status: 'running' },
          include: {
            trades: {
              where: { exitDate: { not: null } },
            },
          },
        },
      },
    })

    const activeStrategies = strategies.filter(s =>
      s.simulations[0]?.trades && s.simulations[0].trades.length >= 5
    )

    if (activeStrategies.length < 2) {
      return NextResponse.json({
        message: 'Insufficient data - need at least 2 strategies with 5+ closed trades each',
        hybrids: [],
        bestCombination: null,
      })
    }

    // Analyze each strategy's entry and exit characteristics
    const strategyCharacteristics = activeStrategies.map(strategy => {
      const trades = strategy.simulations[0].trades
      const wins = trades.filter(t => (t.profitLoss ?? 0) > 0)
      const losses = trades.filter(t => (t.profitLoss ?? 0) <= 0)

      const exitConditions = strategy.exitConditions as {
        profitTarget: number
        stopLoss: number
      }

      // Analyze how often trades hit profit target vs stop loss
      const profitTargetHits = trades.filter(t => t.exitReason === 'PROFIT_TARGET').length
      const stopLossHits = trades.filter(t => t.exitReason === 'STOP_LOSS').length

      // Calculate average max favorable excursion (how far in profit trades go)
      // This is approximated from the profit target hits
      const avgWinPercent = wins.length > 0
        ? wins.reduce((sum, t) => sum + (t.profitLossPercent ?? 0), 0) / wins.length
        : 0

      const avgLossPercent = losses.length > 0
        ? Math.abs(losses.reduce((sum, t) => sum + (t.profitLossPercent ?? 0), 0) / losses.length)
        : 0

      return {
        id: strategy.id,
        name: strategy.name,
        trades: trades.length,
        winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
        profitTargetHits,
        stopLossHits,
        profitTarget: exitConditions.profitTarget,
        stopLoss: exitConditions.stopLoss,
        avgWinPercent,
        avgLossPercent,
        // Entry quality score: win rate weighted by sample size
        entryQuality: trades.length > 0 ? (wins.length / trades.length) * Math.min(trades.length / 20, 1) : 0,
        // Exit efficiency: profit target hits / total exits
        exitEfficiency: (profitTargetHits + stopLossHits) > 0
          ? profitTargetHits / (profitTargetHits + stopLossHits)
          : 0,
      }
    })

    // Generate hybrid combinations
    const hybrids: HybridAnalysis[] = []

    for (const entry of strategyCharacteristics) {
      for (const exit of strategyCharacteristics) {
        if (entry.id === exit.id) continue

        // Simulate: Use entry's win rate with exit's profit target/stop loss ratio
        const simulatedWinRate = entry.winRate
        const riskRewardRatio = exit.profitTarget / exit.stopLoss

        // Expected value calculation
        const winProb = simulatedWinRate / 100
        const lossProb = 1 - winProb
        const expectedReturn = (winProb * exit.profitTarget) - (lossProb * exit.stopLoss)

        // Profit factor approximation
        const simulatedProfitFactor = lossProb > 0
          ? (winProb * exit.profitTarget) / (lossProb * exit.stopLoss)
          : winProb > 0 ? Infinity : 0

        let recommendation = ''
        if (expectedReturn > 2) {
          recommendation = 'Strong potential - high expected return'
        } else if (expectedReturn > 1) {
          recommendation = 'Good potential - positive expected return'
        } else if (expectedReturn > 0) {
          recommendation = 'Marginal - small positive expected return'
        } else {
          recommendation = 'Not recommended - negative expected return'
        }

        hybrids.push({
          entryStrategy: entry.name,
          exitStrategy: exit.name,
          simulatedTrades: entry.trades,
          simulatedWinRate: simulatedWinRate,
          simulatedProfitFactor: simulatedProfitFactor,
          avgReturn: expectedReturn,
          recommendation,
        })
      }
    }

    // Sort by expected return
    hybrids.sort((a, b) => b.avgReturn - a.avgReturn)

    // Find best combination
    const bestCombination = hybrids[0] ?? null

    // Additional insights
    const insights = {
      bestEntryStrategy: strategyCharacteristics.sort((a, b) => b.entryQuality - a.entryQuality)[0]?.name,
      bestExitStrategy: strategyCharacteristics.sort((a, b) => b.exitEfficiency - a.exitEfficiency)[0]?.name,
      highestWinRate: strategyCharacteristics.sort((a, b) => b.winRate - a.winRate)[0]?.name,
      bestRiskReward: strategyCharacteristics.sort((a, b) =>
        (b.profitTarget / b.stopLoss) - (a.profitTarget / a.stopLoss)
      )[0]?.name,
    }

    // Strategy-specific recommendations
    const strategyRecommendations = strategyCharacteristics.map(s => {
      const issues: string[] = []
      const strengths: string[] = []

      if (s.winRate > 55) strengths.push('High win rate')
      if (s.winRate < 45) issues.push('Low win rate - consider tighter entry criteria')

      if (s.exitEfficiency > 0.5) strengths.push('Good exit timing')
      if (s.exitEfficiency < 0.3) issues.push('Many stop-outs - consider wider stops or better entries')

      if (s.profitTarget / s.stopLoss > 2) strengths.push('Good risk/reward ratio')
      if (s.profitTarget / s.stopLoss < 1) issues.push('Risk/reward below 1:1 - consider wider targets')

      return {
        strategy: s.name,
        winRate: s.winRate,
        profitTarget: s.profitTarget,
        stopLoss: s.stopLoss,
        strengths,
        issues,
        overallScore: (s.entryQuality + s.exitEfficiency) / 2,
      }
    }).sort((a, b) => b.overallScore - a.overallScore)

    return NextResponse.json({
      generatedAt: new Date().toISOString(),

      insights,

      topHybrids: hybrids.slice(0, 10),

      bestCombination: bestCombination ? {
        ...bestCombination,
        explanation: `Combine ${bestCombination.entryStrategy}'s entry signals with ${bestCombination.exitStrategy}'s exit rules (${strategyCharacteristics.find(s => s.name === bestCombination.exitStrategy)?.profitTarget}% target, ${strategyCharacteristics.find(s => s.name === bestCombination.exitStrategy)?.stopLoss}% stop)`,
      } : null,

      strategyRecommendations,

      rawCharacteristics: strategyCharacteristics,
    })
  } catch (error) {
    console.error('Hybrid analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
