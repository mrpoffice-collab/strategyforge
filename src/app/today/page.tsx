import Link from 'next/link'
import prisma from '@/lib/prisma'
import { ArrowLeft, CalendarDays, TrendingUp, TrendingDown, Clock, Target } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

async function getTodaysTrades() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return prisma.trade.findMany({
    where: {
      exitDate: { gte: today },
      profitLoss: { not: null },
    },
    include: {
      strategy: {
        select: {
          name: true,
          whitepaperAuthor: true,
        },
      },
    },
    orderBy: { exitDate: 'desc' },
  })
}

export default async function TodayPage() {
  const trades = await getTodaysTrades()

  const totalPL = trades.reduce((sum, t) => sum + (t.profitLoss || 0), 0)
  const winners = trades.filter(t => (t.profitLoss || 0) > 0)
  const losers = trades.filter(t => (t.profitLoss || 0) <= 0)
  const winRate = trades.length > 0 ? (winners.length / trades.length) * 100 : 0

  const totalWinAmount = winners.reduce((sum, t) => sum + (t.profitLoss || 0), 0)
  const totalLossAmount = losers.reduce((sum, t) => sum + (t.profitLoss || 0), 0)
  const avgWin = winners.length > 0 ? totalWinAmount / winners.length : 0
  const avgLoss = losers.length > 0 ? totalLossAmount / losers.length : 0

  // Group by strategy
  const byStrategy = new Map<string, { name: string; trades: number; pl: number; wins: number }>()
  for (const trade of trades) {
    const key = trade.strategy.name
    const existing = byStrategy.get(key) || { name: key, trades: 0, pl: 0, wins: 0 }
    existing.trades++
    existing.pl += trade.profitLoss || 0
    if ((trade.profitLoss || 0) > 0) existing.wins++
    byStrategy.set(key, existing)
  }
  const strategyStats = Array.from(byStrategy.values()).sort((a, b) => b.pl - a.pl)

  const formatTime = (date: Date | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatHoldTime = (hours: number | null) => {
    if (!hours) return '-'
    if (hours < 24) return `${hours.toFixed(1)}h`
    return `${(hours / 24).toFixed(1)}d`
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-slate-600 hover:text-slate-900 transition-colors">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                  <CalendarDays className="w-6 h-6" />
                  Today's Trades
                </h1>
                <p className="text-slate-600 text-sm">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            </div>
            <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="text-slate-600 text-sm mb-1">Total P&L</div>
            <div className={`text-2xl font-bold ${totalPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="text-slate-600 text-sm mb-1">Trades Closed</div>
            <div className="text-2xl font-bold">{trades.length}</div>
            <div className="text-xs text-slate-500">{winners.length}W / {losers.length}L</div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200">
            <div className="text-slate-600 text-sm mb-1">Win Rate</div>
            <div className={`text-2xl font-bold ${winRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
              {winRate.toFixed(0)}%
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-green-200">
            <div className="text-green-700 text-sm mb-1">Avg Win</div>
            <div className="text-2xl font-bold text-green-600">
              +${avgWin.toFixed(2)}
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-red-200">
            <div className="text-red-700 text-sm mb-1">Avg Loss</div>
            <div className="text-2xl font-bold text-red-600">
              ${avgLoss.toFixed(2)}
            </div>
          </div>
        </div>

        {/* By Strategy */}
        {strategyStats.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Target className="w-5 h-5 text-blue-500" />
                Performance by Strategy
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-slate-600 border-b border-slate-200">
                    <th className="px-6 py-3 font-medium">Strategy</th>
                    <th className="px-6 py-3 font-medium text-right">Trades</th>
                    <th className="px-6 py-3 font-medium text-right">W/L</th>
                    <th className="px-6 py-3 font-medium text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {strategyStats.map((stat) => (
                    <tr key={stat.name} className="border-b border-slate-200/50 hover:bg-slate-50">
                      <td className="px-6 py-3 font-medium">{stat.name}</td>
                      <td className="px-6 py-3 text-right">{stat.trades}</td>
                      <td className="px-6 py-3 text-right text-slate-600">
                        {stat.wins}W / {stat.trades - stat.wins}L
                      </td>
                      <td className={`px-6 py-3 text-right font-medium ${stat.pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {stat.pl >= 0 ? '+' : ''}${stat.pl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Trade List */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5 text-green-500" />
              All Trades Closed Today
            </h2>
          </div>

          {trades.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500">
              <CalendarDays className="w-12 h-12 mx-auto mb-4 text-slate-300" />
              <p>No trades closed today yet.</p>
              <p className="text-sm mt-2">Check back after market hours or hit refresh on the dashboard.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-slate-600 border-b border-slate-200">
                    <th className="px-6 py-3 font-medium">Symbol</th>
                    <th className="px-6 py-3 font-medium">Strategy</th>
                    <th className="px-6 py-3 font-medium text-right">Entry</th>
                    <th className="px-6 py-3 font-medium text-right">Exit</th>
                    <th className="px-6 py-3 font-medium text-right">Shares</th>
                    <th className="px-6 py-3 font-medium text-right">Hold Time</th>
                    <th className="px-6 py-3 font-medium text-center">Exit Reason</th>
                    <th className="px-6 py-3 font-medium text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => {
                    const pl = trade.profitLoss || 0
                    const plPercent = trade.profitLossPercent || 0
                    const isWin = pl >= 0

                    return (
                      <tr key={trade.id} className="border-b border-slate-200/50 hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <div className="font-medium">{trade.symbol}</div>
                          <div className="text-xs text-slate-500">{formatTime(trade.exitDate)}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm">{trade.strategy.name}</div>
                          <div className="text-xs text-slate-500">{trade.strategy.whitepaperAuthor}</div>
                        </td>
                        <td className="px-6 py-4 text-right text-slate-600">${trade.entryPrice.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right">${trade.exitPrice?.toFixed(2) || '-'}</td>
                        <td className="px-6 py-4 text-right">{trade.shares}</td>
                        <td className="px-6 py-4 text-right text-slate-600">{formatHoldTime(trade.holdTimeHours)}</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`text-xs px-2 py-1 rounded ${
                            trade.exitReason === 'PROFIT_TARGET' ? 'bg-green-100 text-green-700' :
                            trade.exitReason === 'STOP_LOSS' ? 'bg-red-100 text-red-700' :
                            trade.exitReason === 'SIGNAL' ? 'bg-blue-100 text-blue-700' :
                            trade.exitReason === 'TIME_LIMIT' ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {trade.exitReason?.replace('_', ' ') || 'MANUAL'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className={`font-medium ${isWin ? 'text-green-600' : 'text-red-600'}`}>
                            {isWin ? '+' : ''}${pl.toFixed(2)}
                          </div>
                          <div className={`text-xs ${isWin ? 'text-green-500' : 'text-red-500'}`}>
                            {isWin ? '+' : ''}{plPercent.toFixed(1)}%
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
