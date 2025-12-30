import Link from 'next/link'
import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import { ArrowLeft, TrendingUp, TrendingDown, Activity, DollarSign, Target, BookOpen } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

async function getStrategy(id: string) {
  const strategy = await prisma.strategy.findUnique({
    where: { id },
    include: {
      simulations: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          positions: true,
          trades: {
            orderBy: { createdAt: 'desc' },
            take: 20,
          },
        },
      },
    },
  })

  return strategy
}

export default async function StrategyPage({ params }: PageProps) {
  const { id } = await params
  const decodedId = decodeURIComponent(id)
  const strategy = await getStrategy(decodedId)

  if (!strategy) {
    notFound()
  }

  const simulation = strategy.simulations[0]
  const positions = simulation?.positions || []
  const trades = simulation?.trades || []

  // Calculate portfolio value (cash + positions at current price)
  const cash = simulation?.currentCapital || 2000
  const positionValue = positions.reduce((sum, p) => sum + p.currentValue, 0)
  const portfolioValue = cash + positionValue

  // Handle null/undefined conditions gracefully
  const rawEntry = strategy.entryConditions as { indicators?: Array<{ type: string; [key: string]: unknown }>; priceRange?: { min: number; max: number } } | null
  const rawExit = strategy.exitConditions as { indicators?: Array<{ type: string; [key: string]: unknown }>; profitTarget?: number; stopLoss?: number } | null

  const entryConditions = {
    indicators: rawEntry?.indicators || [],
    priceRange: rawEntry?.priceRange || { min: 25, max: 100 }
  }
  const exitConditions = {
    indicators: rawExit?.indicators || [],
    profitTarget: rawExit?.profitTarget || 10,
    stopLoss: rawExit?.stopLoss || 5
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <span className="text-xl font-bold text-slate-900">StrategyForge</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link
                href="/analysis"
                className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
              >
                Analysis
              </Link>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Live
              </span>
            </div>
          </div>
          <Link href="/" className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Leaderboard
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{strategy.name}</h1>
              <p className="text-slate-600 text-sm">{strategy.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {simulation ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  Running
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-500/10 text-slate-600 border border-gray-500/20">
                  Idle
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Whitepaper Info */}
        <div className="bg-white rounded-xl p-4 border border-slate-200 mb-6">
          <div className="flex items-center gap-2 text-slate-600 text-sm mb-2">
            <BookOpen className="w-4 h-4" />
            Based on Whitepaper
          </div>
          <div className="font-medium">{strategy.whitepaperTitle}</div>
          <div className="text-sm text-slate-500">{strategy.whitepaperAuthor}, {strategy.whitepaperYear}</div>
        </div>

        {/* Performance Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <DollarSign className="w-4 h-4" />
              Portfolio Value
            </div>
            <div className="text-2xl font-bold">${portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              {(simulation?.totalPL || 0) >= 0 ? <TrendingUp className="w-4 h-4 text-green-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
              Total P&L
            </div>
            <div className={`text-2xl font-bold ${(simulation?.totalPL || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {(simulation?.totalPL || 0) >= 0 ? '+' : ''}${(simulation?.totalPL || 0).toFixed(2)}
              <span className="text-sm ml-1">({(simulation?.totalPLPercent || 0).toFixed(1)}%)</span>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <Target className="w-4 h-4" />
              Win Rate
            </div>
            <div className={`text-2xl font-bold ${(simulation?.winRate || 0) >= 50 ? 'text-green-500' : 'text-yellow-500'}`}>
              {(simulation?.winRate || 0).toFixed(1)}%
            </div>
            <div className="text-sm text-slate-500">
              {simulation?.winCount || 0}W / {simulation?.lossCount || 0}L
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="flex items-center gap-2 text-slate-600 text-sm mb-1">
              <Activity className="w-4 h-4" />
              Trades
            </div>
            <div className="text-2xl font-bold">{simulation?.tradesCompleted || 0}</div>
            <div className="text-sm text-slate-500">/ {simulation?.tradesLimit || 200} limit</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Strategy Rules */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold">Strategy Rules</h2>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <h3 className="text-sm font-medium text-slate-600 mb-2">Entry Conditions</h3>
                <ul className="space-y-2">
                  {entryConditions.indicators.map((ind, i) => (
                    <li key={i} className="text-sm bg-slate-100/50 rounded px-3 py-2">
                      {ind.type}: {JSON.stringify(ind).replace(/"type":"[^"]+",?/, '').replace(/[{}]/g, '')}
                    </li>
                  ))}
                  <li className="text-sm bg-slate-100/50 rounded px-3 py-2">
                    Price Range: ${entryConditions.priceRange.min} - ${entryConditions.priceRange.max}
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-medium text-slate-600 mb-2">Exit Conditions</h3>
                <ul className="space-y-2">
                  {exitConditions.indicators.map((ind, i) => (
                    <li key={i} className="text-sm bg-slate-100/50 rounded px-3 py-2">
                      {ind.type}: {JSON.stringify(ind).replace(/"type":"[^"]+",?/, '').replace(/[{}]/g, '')}
                    </li>
                  ))}
                  <li className="text-sm bg-green-500/10 text-green-400 rounded px-3 py-2">
                    Profit Target: +{exitConditions.profitTarget}%
                  </li>
                  <li className="text-sm bg-red-500/10 text-red-400 rounded px-3 py-2">
                    Stop Loss: -{exitConditions.stopLoss}%
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Active Positions */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Active Positions</h2>
              <span className="text-sm text-slate-600">{positions.length} open</span>
            </div>
            <div className="overflow-x-auto">
              {positions.length > 0 ? (
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-sm text-slate-600 border-b border-slate-200">
                      <th className="px-6 py-3 font-medium">Symbol</th>
                      <th className="px-6 py-3 font-medium text-right">Entry</th>
                      <th className="px-6 py-3 font-medium text-right">Current</th>
                      <th className="px-6 py-3 font-medium text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos) => (
                      <tr key={pos.id} className="border-b border-slate-200/50">
                        <td className="px-6 py-4 font-medium">{pos.symbol}</td>
                        <td className="px-6 py-4 text-right">${pos.entryPrice.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right">${pos.currentPrice.toFixed(2)}</td>
                        <td className={`px-6 py-4 text-right font-medium ${pos.unrealizedPL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pos.unrealizedPL >= 0 ? '+' : ''}${pos.unrealizedPL.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-6 text-center text-slate-500">No active positions</div>
              )}
            </div>
          </div>
        </div>

        {/* Trade History */}
        <div className="mt-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Trades</h2>
            <span className="text-sm text-slate-600">Last 20</span>
          </div>
          <div className="overflow-x-auto">
            {trades.length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-slate-600 border-b border-slate-200">
                    <th className="px-6 py-3 font-medium">Symbol</th>
                    <th className="px-6 py-3 font-medium">Entry</th>
                    <th className="px-6 py-3 font-medium">Exit</th>
                    <th className="px-6 py-3 font-medium text-right">Shares</th>
                    <th className="px-6 py-3 font-medium text-right">P&L</th>
                    <th className="px-6 py-3 font-medium text-right">Hold Time</th>
                    <th className="px-6 py-3 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={trade.id} className="border-b border-slate-200/50">
                      <td className="px-6 py-4 font-medium">{trade.symbol}</td>
                      <td className="px-6 py-4">${trade.entryPrice.toFixed(2)}</td>
                      <td className="px-6 py-4">{trade.exitPrice ? `$${trade.exitPrice.toFixed(2)}` : '-'}</td>
                      <td className="px-6 py-4 text-right">{trade.shares}</td>
                      <td className={`px-6 py-4 text-right font-medium ${(trade.profitLoss || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {trade.profitLoss !== null ? `${trade.profitLoss >= 0 ? '+' : ''}$${trade.profitLoss.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-6 py-4 text-right text-slate-600">
                        {trade.holdTimeHours ? `${Math.round(trade.holdTimeHours / 24)}d` : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                          trade.exitReason === 'PROFIT_TARGET' ? 'bg-green-500/10 text-green-400' :
                          trade.exitReason === 'STOP_LOSS' ? 'bg-red-500/10 text-red-400' :
                          'bg-gray-500/10 text-slate-600'
                        }`}>
                          {trade.exitReason || 'Open'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-6 text-center text-slate-500">No trades yet</div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
