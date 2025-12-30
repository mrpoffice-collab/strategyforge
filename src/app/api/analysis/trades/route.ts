import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/analysis/trades - Detailed trade-level analysis
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const strategyId = searchParams.get('strategy')
    const status = searchParams.get('status') // 'open' | 'closed' | 'all'

    const whereClause: Record<string, unknown> = {}
    if (strategyId) {
      whereClause.strategyId = strategyId
    }
    if (status === 'open') {
      whereClause.exitDate = null
    } else if (status === 'closed') {
      whereClause.exitDate = { not: null }
    }

    const trades = await prisma.trade.findMany({
      where: whereClause,
      include: {
        strategy: { select: { name: true } },
      },
      orderBy: { entryDate: 'desc' },
    })

    // Group trades by symbol for concentration analysis
    const symbolAnalysis: Record<string, {
      symbol: string
      tradeCount: number
      strategies: string[]
      totalPL: number
      winCount: number
      lossCount: number
      avgReturn: number
    }> = {}

    for (const trade of trades) {
      if (!symbolAnalysis[trade.symbol]) {
        symbolAnalysis[trade.symbol] = {
          symbol: trade.symbol,
          tradeCount: 0,
          strategies: [],
          totalPL: 0,
          winCount: 0,
          lossCount: 0,
          avgReturn: 0,
        }
      }

      const sym = symbolAnalysis[trade.symbol]
      sym.tradeCount++
      if (!sym.strategies.includes(trade.strategy.name)) {
        sym.strategies.push(trade.strategy.name)
      }

      if (trade.exitDate) {
        sym.totalPL += trade.profitLoss ?? 0
        if ((trade.profitLoss ?? 0) > 0) {
          sym.winCount++
        } else {
          sym.lossCount++
        }
      }
    }

    // Calculate avg return for each symbol
    Object.values(symbolAnalysis).forEach(sym => {
      const closedCount = sym.winCount + sym.lossCount
      if (closedCount > 0) {
        sym.avgReturn = sym.totalPL / closedCount
      }
    })

    // Day of week analysis
    const dayOfWeekStats = {
      0: { name: 'Sunday', entries: 0, exits: 0, profit: 0 },
      1: { name: 'Monday', entries: 0, exits: 0, profit: 0 },
      2: { name: 'Tuesday', entries: 0, exits: 0, profit: 0 },
      3: { name: 'Wednesday', entries: 0, exits: 0, profit: 0 },
      4: { name: 'Thursday', entries: 0, exits: 0, profit: 0 },
      5: { name: 'Friday', entries: 0, exits: 0, profit: 0 },
      6: { name: 'Saturday', entries: 0, exits: 0, profit: 0 },
    }

    for (const trade of trades) {
      const entryDay = new Date(trade.entryDate).getDay()
      dayOfWeekStats[entryDay as keyof typeof dayOfWeekStats].entries++

      if (trade.exitDate) {
        const exitDay = new Date(trade.exitDate).getDay()
        dayOfWeekStats[exitDay as keyof typeof dayOfWeekStats].exits++
        dayOfWeekStats[exitDay as keyof typeof dayOfWeekStats].profit += trade.profitLoss ?? 0
      }
    }

    // Hold time distribution
    const holdTimeDistribution = {
      under1Hour: 0,
      hours1to4: 0,
      hours4to24: 0,
      days1to3: 0,
      days3to7: 0,
      over7Days: 0,
    }

    const closedTrades = trades.filter(t => t.exitDate)
    for (const trade of closedTrades) {
      const holdHours = (new Date(trade.exitDate!).getTime() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60)

      if (holdHours < 1) holdTimeDistribution.under1Hour++
      else if (holdHours < 4) holdTimeDistribution.hours1to4++
      else if (holdHours < 24) holdTimeDistribution.hours4to24++
      else if (holdHours < 72) holdTimeDistribution.days1to3++
      else if (holdHours < 168) holdTimeDistribution.days3to7++
      else holdTimeDistribution.over7Days++
    }

    // Return distribution (buckets)
    const returnDistribution = {
      under_neg10: 0,
      neg10_to_neg5: 0,
      neg5_to_neg2: 0,
      neg2_to_0: 0,
      zero_to_2: 0,
      two_to_5: 0,
      five_to_10: 0,
      over_10: 0,
    }

    for (const trade of closedTrades) {
      const pct = trade.profitLossPercent ?? 0
      if (pct < -10) returnDistribution.under_neg10++
      else if (pct < -5) returnDistribution.neg10_to_neg5++
      else if (pct < -2) returnDistribution.neg5_to_neg2++
      else if (pct < 0) returnDistribution.neg2_to_0++
      else if (pct < 2) returnDistribution.zero_to_2++
      else if (pct < 5) returnDistribution.two_to_5++
      else if (pct < 10) returnDistribution.five_to_10++
      else returnDistribution.over_10++
    }

    // Best and worst trades
    const sortedByPL = [...closedTrades].sort((a, b) => (b.profitLoss ?? 0) - (a.profitLoss ?? 0))
    const bestTrades = sortedByPL.slice(0, 10).map(t => ({
      symbol: t.symbol,
      strategy: t.strategy.name,
      entryDate: t.entryDate,
      exitDate: t.exitDate,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      shares: t.shares,
      profitLoss: t.profitLoss,
      profitLossPercent: t.profitLossPercent,
      holdTimeHours: t.exitDate
        ? (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / (1000 * 60 * 60)
        : null,
    }))

    const worstTrades = sortedByPL.slice(-10).reverse().map(t => ({
      symbol: t.symbol,
      strategy: t.strategy.name,
      entryDate: t.entryDate,
      exitDate: t.exitDate,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      shares: t.shares,
      profitLoss: t.profitLoss,
      profitLossPercent: t.profitLossPercent,
      holdTimeHours: t.exitDate
        ? (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / (1000 * 60 * 60)
        : null,
    }))

    return NextResponse.json({
      totalTrades: trades.length,
      closedTrades: closedTrades.length,
      openTrades: trades.length - closedTrades.length,

      symbolAnalysis: Object.values(symbolAnalysis)
        .sort((a, b) => b.tradeCount - a.tradeCount)
        .slice(0, 50),

      dayOfWeekStats: Object.values(dayOfWeekStats),
      holdTimeDistribution,
      returnDistribution,

      bestTrades,
      worstTrades,
    })
  } catch (error) {
    console.error('Trade analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
