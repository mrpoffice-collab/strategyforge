import Link from 'next/link'
import prisma from '@/lib/prisma'
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, BarChart3, Radio, Clock, Briefcase } from 'lucide-react'
import { RefreshButton } from '@/components/RefreshButton'

export const dynamic = 'force-dynamic'

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
  const totalCapital = strategies.reduce((sum, s) => sum + (s.simulation?.currentCapital || 2000), 0)
  const totalPL = strategies.reduce((sum, s) => sum + (s.simulation?.totalPL || 0), 0)
  const totalTrades = strategies.reduce((sum, s) => sum + (s.simulation?.tradesCompleted || 0), 0)
  const avgWinRate = strategies.length > 0
    ? strategies.reduce((sum, s) => sum + (s.simulation?.winRate || 0), 0) / strategies.length
    : 0

  // Sort by P&L for ranking
  const rankedStrategies = [...strategies].sort((a, b) =>
    (b.simulation?.totalPL || 0) - (a.simulation?.totalPL || 0)
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <h1 className="text-2xl font-bold text-white">StrategyForge</h1>
              <p className="text-gray-400 text-sm">Autonomous Swing Trading Simulator</p>
            </Link>
            <div className="flex items-center gap-4">
              <RefreshButton />
              <Link
                href="/analysis"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Analysis
              </Link>
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <DollarSign className="w-4 h-4" />
              Total Capital
            </div>
            <div className="text-2xl font-bold">${totalCapital.toLocaleString()}</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
              {totalPL >= 0 ? <TrendingUp className="w-4 h-4 text-green-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
              Total P&L
            </div>
            <div className={`text-2xl font-bold ${totalPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <Activity className="w-4 h-4" />
              Total Trades
            </div>
            <div className="text-2xl font-bold">{totalTrades}</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <Target className="w-4 h-4" />
              Avg Win Rate
            </div>
            <div className="text-2xl font-bold">{avgWinRate.toFixed(1)}%</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-blue-800/50">
            <div className="flex items-center gap-2 text-blue-400 text-sm mb-1">
              <Radio className="w-4 h-4" />
              Screener Signals
            </div>
            <div className="text-2xl font-bold text-blue-400">{screenerStats.totalSignals}</div>
            <div className="text-xs text-gray-500">{screenerStats.unprocessedSignals} pending</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-4 border border-purple-800/50">
            <div className="flex items-center gap-2 text-purple-400 text-sm mb-1">
              <Briefcase className="w-4 h-4" />
              Open Positions
            </div>
            <div className="text-2xl font-bold text-purple-400">{openPositions.length}</div>
          </div>
        </div>

        {/* Strategy Leaderboard */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-semibold">Strategy Leaderboard</h2>
            </div>
            <span className="text-sm text-gray-400">{strategies.length} strategies</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-gray-400 border-b border-gray-800">
                  <th className="px-6 py-3 font-medium">Rank</th>
                  <th className="px-6 py-3 font-medium">Strategy</th>
                  <th className="px-6 py-3 font-medium text-right">P&L</th>
                  <th className="px-6 py-3 font-medium text-right">Win Rate</th>
                  <th className="px-6 py-3 font-medium text-right">Trades</th>
                  <th className="px-6 py-3 font-medium text-right">Portfolio</th>
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
                  const capital = sim?.currentCapital || 2000

                  return (
                    <tr key={strategy.id} className="border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                          index === 0 ? 'bg-yellow-500/20 text-yellow-500' :
                          index === 1 ? 'bg-gray-400/20 text-gray-400' :
                          index === 2 ? 'bg-amber-600/20 text-amber-600' :
                          'bg-gray-700/50 text-gray-500'
                        }`}>
                          {index + 1}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Link href={`/strategy/${strategy.id}`} className="hover:text-blue-400 transition-colors">
                          <div className="font-medium">{strategy.name}</div>
                          <div className="text-sm text-gray-500">{strategy.whitepaperAuthor}</div>
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
                        <div className={`font-medium ${winRate >= 50 ? 'text-green-500' : winRate > 0 ? 'text-yellow-500' : 'text-gray-500'}`}>
                          {winRate.toFixed(1)}%
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-medium">{trades}</div>
                        <div className="text-sm text-gray-500">/ {limit}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-medium">${capital.toLocaleString()}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {sim ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                            Running
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-gray-500/10 text-gray-400">
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
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-purple-500" />
              <h2 className="text-lg font-semibold">Open Positions</h2>
              <span className="ml-auto text-sm text-gray-400">{openPositions.length} active</span>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {openPositions.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">No open positions</div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-800">
                      <th className="px-4 py-2">Symbol</th>
                      <th className="px-4 py-2">Strategy</th>
                      <th className="px-4 py-2 text-right">Shares</th>
                      <th className="px-4 py-2 text-right">Entry</th>
                      <th className="px-4 py-2 text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPositions.map((pos) => (
                      <tr key={pos.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-2 font-medium">{pos.symbol}</td>
                        <td className="px-4 py-2 text-sm text-gray-400">{pos.simulation.strategy.name.slice(0, 20)}</td>
                        <td className="px-4 py-2 text-right">{pos.shares}</td>
                        <td className="px-4 py-2 text-right">${pos.entryPrice.toFixed(2)}</td>
                        <td className={`px-4 py-2 text-right ${pos.unrealizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pos.unrealizedPL >= 0 ? '+' : ''}${pos.unrealizedPL.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Recent Trades */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-2">
              <Clock className="w-5 h-5 text-green-500" />
              <h2 className="text-lg font-semibold">Recent Trades</h2>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {recentTrades.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">No trades yet</div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-800">
                      <th className="px-4 py-2">Symbol</th>
                      <th className="px-4 py-2">Strategy</th>
                      <th className="px-4 py-2 text-right">Shares</th>
                      <th className="px-4 py-2 text-right">Cost</th>
                      <th className="px-4 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTrades.map((trade) => (
                      <tr key={trade.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-2 font-medium">{trade.symbol}</td>
                        <td className="px-4 py-2 text-sm text-gray-400">{trade.strategy.name.slice(0, 20)}</td>
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
