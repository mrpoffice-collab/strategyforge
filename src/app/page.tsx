import Link from 'next/link'
import prisma from '@/lib/prisma'
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, BarChart3, Radio, Clock, Briefcase, Wallet, PiggyBank } from 'lucide-react'
import { RefreshButton } from '@/components/RefreshButton'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

async function getStrategies() {
  const strategies = await prisma.strategy.findMany({
    include: {
      simulations: {
        where: { status: 'running' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { name: 'asc' },
  })

  return strategies.map((strategy) => {
    const simulation = strategy.simulations[0]
    return {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      whitepaperAuthor: strategy.whitepaperAuthor,
      status: strategy.status,
      simulation: simulation ? {
        currentCapital: simulation.currentCapital,
        totalPL: simulation.totalPL,
        totalPLPercent: simulation.totalPLPercent,
        tradesCompleted: simulation.tradesCompleted,
        tradesLimit: simulation.tradesLimit,
        winRate: simulation.winRate,
        status: simulation.status,
      } : null,
    }
  })
}

async function getScreenerStats() {
  const [totalSignals, unprocessedSignals] = await Promise.all([
    prisma.screenerSignal.count(),
    prisma.screenerSignal.count({ where: { processed: false } }),
  ])
  return { totalSignals, unprocessedSignals }
}

async function getRecentTrades() {
  return prisma.trade.findMany({
    take: 10,
    orderBy: { entryDate: 'desc' },
    include: { strategy: { select: { name: true } } },
  })
}

async function getOpenPositions() {
  return prisma.position.findMany({
    include: { simulation: { include: { strategy: { select: { name: true } } } } },
    orderBy: { entryDate: 'desc' },
  })
}

export default async function Dashboard() {
  const [strategies, screenerStats, recentTrades, openPositions] = await Promise.all([
    getStrategies(),
    getScreenerStats(),
    getRecentTrades(),
    getOpenPositions(),
  ])

  // Calculate aggregate stats
  const cashAvailable = strategies.reduce((sum, s) => sum + (s.simulation?.currentCapital || 2000), 0)
  const totalPL = strategies.reduce((sum, s) => sum + (s.simulation?.totalPL || 0), 0)
  const totalTrades = strategies.reduce((sum, s) => sum + (s.simulation?.tradesCompleted || 0), 0)

  // Actual win rate based on closed trades (not average of strategy win rates)
  const totalWins = strategies.reduce((sum, s) => {
    const winRate = s.simulation?.winRate || 0
    const trades = s.simulation?.tradesCompleted || 0
    return sum + Math.round((winRate / 100) * trades)
  }, 0)
  const actualWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0

  // Position values
  const investedValue = openPositions.reduce((sum, p) => sum + p.currentValue, 0)
  const unrealizedPL = openPositions.reduce((sum, p) => sum + p.unrealizedPL, 0)
  const totalPortfolioValue = cashAvailable + investedValue

  // Calculate per-strategy position values
  const positionValueByStrategy = new Map<string, number>()
  for (const pos of openPositions) {
    const strategyId = pos.simulation.strategy.name
    positionValueByStrategy.set(strategyId, (positionValueByStrategy.get(strategyId) || 0) + pos.currentValue)
  }

  // Sort by P&L for ranking
  const rankedStrategies = [...strategies].sort((a, b) =>
    (b.simulation?.totalPL || 0) - (a.simulation?.totalPL || 0)
  )

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <h1 className="text-2xl font-bold text-slate-900">StrategyForge</h1>
              <p className="text-slate-600 text-sm">Autonomous Swing Trading Simulator</p>
            </Link>
            <div className="flex items-center gap-4">
              <RefreshButton />
              <Link
                href="/analysis"
                className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
              >
                Analysis
              </Link>
              <Link
                href="/diary"
                className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
              >
                Diary
              </Link>
              <span className="text-xs text-slate-400" title="Last server render">
                {new Date().toLocaleTimeString()}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Live
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Aggregate Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <DollarSign className="w-4 h-4" />
              Portfolio Value
            </div>
            <div className="text-2xl font-bold">${totalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <Wallet className="w-4 h-4" />
              Cash
            </div>
            <div className="text-2xl font-bold">${cashAvailable.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-purple-800/50">
            <div className="flex items-center gap-2 text-purple-400 text-sm mb-1">
              <PiggyBank className="w-4 h-4" />
              Invested
            </div>
            <div className="text-2xl font-bold text-purple-400">${investedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <div className="text-xs text-slate-500">{openPositions.length} positions</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              {unrealizedPL >= 0 ? <TrendingUp className="w-4 h-4 text-green-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
              Unrealized P&L
            </div>
            <div className={`text-2xl font-bold ${unrealizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {unrealizedPL >= 0 ? '+' : ''}${unrealizedPL.toFixed(0)}
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              {totalPL >= 0 ? <TrendingUp className="w-4 h-4 text-green-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
              Realized P&L
            </div>
            <div className={`text-2xl font-bold ${totalPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(0)}
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <Activity className="w-4 h-4" />
              Total Trades
            </div>
            <div className="text-2xl font-bold">{totalTrades}</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <Target className="w-4 h-4" />
              Win Rate
            </div>
            <div className={`text-2xl font-bold ${actualWinRate >= 50 ? 'text-green-500' : actualWinRate >= 40 ? 'text-yellow-500' : 'text-red-500'}`}>
              {actualWinRate.toFixed(1)}%
            </div>
            <div className="text-xs text-slate-500">{totalWins}W / {totalTrades - totalWins}L</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-blue-800/50">
            <div className="flex items-center gap-2 text-blue-400 text-sm mb-1">
              <Radio className="w-4 h-4" />
              Signals
            </div>
            <div className="text-2xl font-bold text-blue-400">{screenerStats.totalSignals}</div>
            <div className="text-xs text-slate-500">{screenerStats.unprocessedSignals} pending</div>
          </div>
        </div>

        {/* Strategy Leaderboard */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-semibold">Strategy Leaderboard</h2>
            </div>
            <span className="text-sm text-slate-600">{strategies.length} strategies</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-slate-600 border-b border-slate-200">
                  <th className="px-6 py-3 font-medium">Rank</th>
                  <th className="px-6 py-3 font-medium">Strategy</th>
                  <th className="px-6 py-3 font-medium text-right">P&L</th>
                  <th className="px-6 py-3 font-medium text-right">Win Rate</th>
                  <th className="px-6 py-3 font-medium text-right">Trades</th>
                  <th className="px-6 py-3 font-medium text-right">Cash</th>
                  <th className="px-6 py-3 font-medium text-right">Invested</th>
                  <th className="px-6 py-3 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {rankedStrategies.map((strategy, index) => {
                  const sim = strategy.simulation
                  const pl = sim?.totalPL || 0
                  const plPercent = sim?.totalPLPercent || 0
                  const winRate = sim?.winRate || 0
                  const trades = sim?.tradesCompleted || 0
                  const limit = sim?.tradesLimit || 200
                  const cash = sim?.currentCapital || 2000
                  const positionValue = positionValueByStrategy.get(strategy.name) || 0
                  const portfolioValue = cash + positionValue

                  return (
                    <tr key={strategy.id} className="border-b border-slate-200/50 hover:bg-slate-100 transition-colors">
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                          index === 0 ? 'bg-yellow-500/20 text-yellow-500' :
                          index === 1 ? 'bg-gray-400/20 text-slate-600' :
                          index === 2 ? 'bg-amber-600/20 text-amber-600' :
                          'bg-slate-200 text-slate-500'
                        }`}>
                          {index + 1}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/strategy/${encodeURIComponent(strategy.id)}`} className="hover:text-blue-400 transition-colors">
                          <div className="font-medium">{strategy.name}</div>
                          <div className="text-sm text-slate-500">{strategy.whitepaperAuthor}</div>
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className={`font-medium ${pl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pl >= 0 ? '+' : ''}${pl.toFixed(2)}
                        </div>
                        <div className={`text-sm ${plPercent >= 0 ? 'text-green-500/70' : 'text-red-500/70'}`}>
                          {plPercent >= 0 ? '+' : ''}{plPercent.toFixed(1)}%
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className={`font-medium ${winRate >= 50 ? 'text-green-500' : winRate > 0 ? 'text-yellow-500' : 'text-slate-500'}`}>
                          {winRate.toFixed(1)}%
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-medium">{trades}</div>
                        <div className="text-sm text-slate-500">/ {limit}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-medium">${cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-medium text-purple-400">${positionValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {sim ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                            Running
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-gray-500/10 text-slate-600">
                            Idle
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Open Positions & Recent Trades */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Open Positions */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-purple-500" />
              <h2 className="text-lg font-semibold">Open Positions</h2>
              <span className="ml-auto text-sm text-slate-600">{openPositions.length} active</span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {openPositions.length === 0 ? (
                <div className="px-6 py-8 text-center text-slate-500">No open positions</div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-xs text-slate-600 border-b border-slate-200">
                      <th className="px-4 py-2">Symbol</th>
                      <th className="px-4 py-2">Strategy</th>
                      <th className="px-4 py-2 text-right">Entry</th>
                      <th className="px-4 py-2 text-right">Current</th>
                      <th className="px-4 py-2 text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPositions.map((pos) => {
                      const plPercent = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100
                      return (
                        <tr key={pos.id} className="border-b border-slate-200/50 hover:bg-slate-50">
                          <td className="px-4 py-2 font-medium">{pos.symbol}</td>
                          <td className="px-4 py-2 text-sm text-slate-600">{pos.simulation.strategy.name.slice(0, 15)}</td>
                          <td className="px-4 py-2 text-right text-slate-600">${pos.entryPrice.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right">${pos.currentPrice.toFixed(2)}</td>
                          <td className={`px-4 py-2 text-right ${plPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            <div className="font-medium">{plPercent >= 0 ? '+' : ''}{plPercent.toFixed(2)}%</div>
                            <div className="text-xs opacity-70">{pos.unrealizedPL >= 0 ? '+' : ''}${pos.unrealizedPL.toFixed(0)}</div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Recent Trades */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
              <Clock className="w-5 h-5 text-green-500" />
              <h2 className="text-lg font-semibold">Recent Trades</h2>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {recentTrades.length === 0 ? (
                <div className="px-6 py-8 text-center text-slate-500">No trades yet</div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-xs text-slate-600 border-b border-slate-200">
                      <th className="px-4 py-2">Symbol</th>
                      <th className="px-4 py-2">Strategy</th>
                      <th className="px-4 py-2 text-right">Shares</th>
                      <th className="px-4 py-2 text-right">Cost</th>
                      <th className="px-4 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTrades.map((trade) => (
                      <tr key={trade.id} className="border-b border-slate-200/50 hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium">{trade.symbol}</td>
                        <td className="px-4 py-2 text-sm text-slate-600">{trade.strategy.name.slice(0, 20)}</td>
                        <td className="px-4 py-2 text-right">{trade.shares}</td>
                        <td className="px-4 py-2 text-right">${trade.totalCost.toFixed(2)}</td>
                        <td className="px-4 py-2 text-right">
                          {trade.exitDate ? (
                            <span className={`text-xs px-2 py-0.5 rounded ${trade.profitLoss && trade.profitLoss >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                              {trade.profitLoss && trade.profitLoss >= 0 ? '+' : ''}${trade.profitLoss?.toFixed(2) || '0'}
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">OPEN</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

      </main>
    </div>
  )
}
