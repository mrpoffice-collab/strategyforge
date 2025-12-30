import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/analysis/report - Generate comprehensive text report
export async function GET() {
  try {
    // Fetch all data
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

    const firstTrade = await prisma.trade.findFirst({ orderBy: { entryDate: 'asc' } })
    const simulationDays = firstTrade
      ? Math.ceil((Date.now() - new Date(firstTrade.entryDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0

    // Build report
    let report = `
================================================================================
                    STRATEGYFORGE TRADING ANALYSIS REPORT
================================================================================
Generated: ${new Date().toISOString()}
Simulation Duration: ${simulationDays} days
================================================================================

EXECUTIVE SUMMARY
-----------------
`

    // Calculate totals
    let totalCapital = 0
    let totalCurrentValue = 0
    let totalTrades = 0
    let totalWins = 0
    let totalLosses = 0

    const strategyResults: Array<{
      name: string
      returnPct: number
      winRate: number
      trades: number
      profitFactor: number
    }> = []

    for (const strategy of strategies) {
      const sim = strategy.simulations[0]
      if (!sim) continue

      totalCapital += sim.initialCapital
      const unrealizedPL = sim.positions.reduce((sum, p) => sum + p.unrealizedPL, 0)
      totalCurrentValue += sim.currentCapital + unrealizedPL

      const closed = sim.trades.filter(t => t.exitDate)
      const wins = closed.filter(t => (t.profitLoss ?? 0) > 0)
      const losses = closed.filter(t => (t.profitLoss ?? 0) <= 0)

      totalTrades += closed.length
      totalWins += wins.length
      totalLosses += losses.length

      const grossProfit = wins.reduce((sum, t) => sum + (t.profitLoss ?? 0), 0)
      const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.profitLoss ?? 0), 0))

      strategyResults.push({
        name: strategy.name,
        returnPct: ((sim.totalPL + unrealizedPL) / sim.initialCapital) * 100,
        winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
        trades: closed.length,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      })
    }

    const overallReturn = totalCurrentValue - totalCapital
    const overallReturnPct = totalCapital > 0 ? (overallReturn / totalCapital) * 100 : 0
    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0

    report += `
Total Capital Deployed:     $${totalCapital.toFixed(2)}
Current Portfolio Value:    $${totalCurrentValue.toFixed(2)}
Overall Return:             $${overallReturn.toFixed(2)} (${overallReturnPct.toFixed(2)}%)
Total Trades Executed:      ${totalTrades}
Overall Win Rate:           ${overallWinRate.toFixed(1)}%

`

    // Sort by return
    strategyResults.sort((a, b) => b.returnPct - a.returnPct)

    report += `
STRATEGY RANKINGS (by Return %)
-------------------------------
`
    strategyResults.forEach((s, i) => {
      report += `${(i + 1).toString().padStart(2)}. ${s.name.padEnd(40)} ${s.returnPct >= 0 ? '+' : ''}${s.returnPct.toFixed(2)}%
`
    })

    report += `

DETAILED STRATEGY ANALYSIS
--------------------------
`

    for (const strategy of strategies) {
      const sim = strategy.simulations[0]
      if (!sim) continue

      const closed = sim.trades.filter(t => t.exitDate)
      const open = sim.trades.filter(t => !t.exitDate)
      const wins = closed.filter(t => (t.profitLoss ?? 0) > 0)
      const losses = closed.filter(t => (t.profitLoss ?? 0) <= 0)

      const grossProfit = wins.reduce((sum, t) => sum + (t.profitLoss ?? 0), 0)
      const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.profitLoss ?? 0), 0))
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

      const avgWin = wins.length > 0 ? grossProfit / wins.length : 0
      const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0

      const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.profitLoss ?? 0)) : 0
      const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.profitLoss ?? 0)) : 0

      const unrealizedPL = sim.positions.reduce((sum, p) => sum + p.unrealizedPL, 0)
      const totalReturn = sim.totalPL + unrealizedPL
      const returnPct = (totalReturn / sim.initialCapital) * 100

      const exitConditions = strategy.exitConditions as { profitTarget: number; stopLoss: number }
      const profitTargetExits = closed.filter(t => t.exitReason === 'PROFIT_TARGET').length
      const stopLossExits = closed.filter(t => t.exitReason === 'STOP_LOSS').length

      report += `
${'='.repeat(70)}
${strategy.name}
${'='.repeat(70)}

PERFORMANCE METRICS
  Initial Capital:      $${sim.initialCapital.toFixed(2)}
  Current Capital:      $${sim.currentCapital.toFixed(2)}
  Unrealized P&L:       $${unrealizedPL.toFixed(2)}
  Total Return:         $${totalReturn.toFixed(2)} (${returnPct.toFixed(2)}%)

TRADE STATISTICS
  Total Trades:         ${sim.trades.length}
  Closed Trades:        ${closed.length}
  Open Positions:       ${open.length}
  Wins:                 ${wins.length}
  Losses:               ${losses.length}
  Win Rate:             ${closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(1) : 0}%

PROFIT ANALYSIS
  Gross Profit:         $${grossProfit.toFixed(2)}
  Gross Loss:           $${grossLoss.toFixed(2)}
  Profit Factor:        ${profitFactor === Infinity ? 'Infinite' : profitFactor.toFixed(2)}
  Average Win:          $${avgWin.toFixed(2)}
  Average Loss:         $${avgLoss.toFixed(2)}
  Largest Win:          $${largestWin.toFixed(2)}
  Largest Loss:         $${largestLoss.toFixed(2)}

EXIT ANALYSIS
  Profit Target (${exitConditions.profitTarget}%): ${profitTargetExits} exits
  Stop Loss (${exitConditions.stopLoss}%):      ${stopLossExits} exits
  Target/Stop Ratio:    ${(profitTargetExits + stopLossExits) > 0 ? ((profitTargetExits / (profitTargetExits + stopLossExits)) * 100).toFixed(1) : 0}%

`
    }

    report += `

RECOMMENDATIONS
---------------
`

    // Best performers
    const bestReturn = strategyResults[0]
    const bestWinRate = [...strategyResults].sort((a, b) => b.winRate - a.winRate)[0]
    const bestProfitFactor = [...strategyResults].sort((a, b) => b.profitFactor - a.profitFactor)[0]
    const worstReturn = strategyResults[strategyResults.length - 1]

    report += `
BEST OVERALL:           ${bestReturn?.name ?? 'N/A'} (${bestReturn?.returnPct.toFixed(2)}% return)
HIGHEST WIN RATE:       ${bestWinRate?.name ?? 'N/A'} (${bestWinRate?.winRate.toFixed(1)}%)
BEST PROFIT FACTOR:     ${bestProfitFactor?.name ?? 'N/A'} (${bestProfitFactor?.profitFactor === Infinity ? 'Infinite' : bestProfitFactor?.profitFactor.toFixed(2)})
WORST PERFORMER:        ${worstReturn?.name ?? 'N/A'} (${worstReturn?.returnPct.toFixed(2)}% return)

`

    // Hybrid suggestion
    if (bestWinRate && bestProfitFactor && bestWinRate.name !== bestProfitFactor.name) {
      report += `
HYBRID STRATEGY SUGGESTION:
Consider combining ${bestWinRate.name}'s entry signals (${bestWinRate.winRate.toFixed(1)}% win rate)
with ${bestProfitFactor.name}'s exit rules (${bestProfitFactor.profitFactor === Infinity ? 'Infinite' : bestProfitFactor.profitFactor.toFixed(2)} profit factor).

`
    }

    report += `

METHODOLOGY NOTES
-----------------
- All strategies started with $2,000 initial capital
- Position sizes vary by strategy (10-20% of capital)
- Exit conditions: Profit target or stop loss (varies by strategy)
- Price filter: $25-$100 stocks only
- Signals generated by TradingView screener every 5 minutes during market hours
- Trades executed automatically without emotion or discretion

================================================================================
                              END OF REPORT
================================================================================
`

    return new NextResponse(report, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="strategyforge-report-${new Date().toISOString().split('T')[0]}.txt"`,
      },
    })
  } catch (error) {
    console.error('Report generation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
