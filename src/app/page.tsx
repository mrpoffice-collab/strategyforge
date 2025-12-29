import Link from 'next/link'
import prisma from '@/lib/prisma'
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, BarChart3 } from 'lucide-react'

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

export default async function Dashboard() {
  const strategies = await getStrategies()

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
            <div>
              <h1 className="text-2xl font-bold text-white">StrategyForge</h1>
              <p className="text-gray-400 text-sm">Autonomous Swing Trading Simulator</p>
            </div>
            <div className="flex items-center gap-2">
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
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

        {/* Start Simulation Button */}
        <div className="mt-8 flex justify-center">
          <Link
            href="/api/simulation/start"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            <Activity className="w-5 h-5" />
            Start All Simulations
          </Link>
        </div>
      </main>
    </div>
  )
}
