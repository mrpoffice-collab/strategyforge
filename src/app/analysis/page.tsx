'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'

interface StrategyMetrics {
  strategyId: string
  strategyName: string
  initialCapital: number
  currentCapital: number
  totalReturn: number
  totalReturnPercent: number
  totalTrades: number
  openTrades: number
  closedTrades: number
  winCount: number
  lossCount: number
  winRate: number
  grossProfit: number
  grossLoss: number
  profitFactor: number
  averageWin: number
  averageLoss: number
  expectancy: number
  largestWin: number
  largestLoss: number
  maxDrawdown: number
  maxDrawdownPercent: number
  avgHoldTimeHours: number
  profitTargetExits: number
  stopLossExits: number
  unrealizedPL: number
}

interface AnalysisData {
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
    byRiskAdjusted: string[]
  }
  correlations: Array<{
    strategy1: string
    strategy2: string
    sharedSymbols: string[]
    correlation: number
  }>
  recommendations: {
    bestOverall: string
    bestWinRate: string
    bestRiskAdjusted: string
    worstPerformer: string
    hybridSuggestion: string
  }
}

interface HybridData {
  insights: {
    bestEntryStrategy: string
    bestExitStrategy: string
    highestWinRate: string
    bestRiskReward: string
  }
  topHybrids: Array<{
    entryStrategy: string
    exitStrategy: string
    simulatedWinRate: number
    simulatedProfitFactor: number
    avgReturn: number
    recommendation: string
  }>
  bestCombination: {
    entryStrategy: string
    exitStrategy: string
    avgReturn: number
    explanation: string
  } | null
  strategyRecommendations: Array<{
    strategy: string
    winRate: number
    profitTarget: number
    stopLoss: number
    strengths: string[]
    issues: string[]
    overallScore: number
  }>
}

export default function AnalysisPage() {
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [hybrid, setHybrid] = useState<HybridData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'strategies' | 'hybrid' | 'correlations'>('overview')

  async function fetchData() {
    try {
      const [analysisRes, hybridRes] = await Promise.all([
        fetch('/api/analysis'),
        fetch('/api/analysis/hybrid'),
      ])

      if (analysisRes.ok) {
        setAnalysis(await analysisRes.json())
      }
      if (hybridRes.ok) {
        setHybrid(await hybridRes.json())
      }
    } catch (error) {
      console.error('Failed to fetch analysis:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    fetchData()
  }

  const Header = () => (
    <header className="border-b border-gray-800 bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <span className="text-xl font-bold text-white">StrategyForge</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/analysis"
              className="text-sm text-white font-medium"
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
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <Header />
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold mb-8">Strategy Analysis</h1>
          <div className="animate-pulse">Loading analysis data...</div>
        </div>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <Header />
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold mb-8">Strategy Analysis</h1>
          <div className="text-red-400">Failed to load analysis data</div>
        </div>
      </div>
    )
  }

  const formatCurrency = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const formatPercent = (n: number) => n.toFixed(2) + '%'

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Header />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Strategy Analysis</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded-lg text-sm transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <div className="text-sm text-gray-400">
              Day {analysis.simulationDays} | Generated {new Date(analysis.generatedAt).toLocaleString()}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(['overview', 'strategies', 'hybrid', 'correlations'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg capitalize ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="text-gray-400 text-sm">Total Capital Deployed</div>
                <div className="text-2xl font-bold">{formatCurrency(analysis.totalCapitalDeployed)}</div>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="text-gray-400 text-sm">Current Value</div>
                <div className="text-2xl font-bold">{formatCurrency(analysis.totalCurrentValue)}</div>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="text-gray-400 text-sm">Overall Return</div>
                <div className={`text-2xl font-bold ${analysis.overallReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(analysis.overallReturn)}
                </div>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg">
                <div className="text-gray-400 text-sm">Return %</div>
                <div className={`text-2xl font-bold ${analysis.overallReturnPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatPercent(analysis.overallReturnPercent)}
                </div>
              </div>
            </div>

            {/* Recommendations */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-xl font-bold mb-4">Recommendations</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-gray-400 text-sm">Best Overall</div>
                  <div className="text-lg text-green-400">{analysis.recommendations.bestOverall}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Best Win Rate</div>
                  <div className="text-lg text-blue-400">{analysis.recommendations.bestWinRate}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Best Risk-Adjusted</div>
                  <div className="text-lg text-purple-400">{analysis.recommendations.bestRiskAdjusted}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Worst Performer</div>
                  <div className="text-lg text-red-400">{analysis.recommendations.worstPerformer}</div>
                </div>
              </div>
              <div className="mt-4 p-4 bg-gray-700 rounded-lg">
                <div className="text-gray-400 text-sm mb-1">Hybrid Suggestion</div>
                <div className="text-yellow-400">{analysis.recommendations.hybridSuggestion}</div>
              </div>
            </div>

            {/* Rankings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="font-bold mb-3">By Return</h3>
                <ol className="space-y-1">
                  {analysis.rankings.byReturn.map((name, i) => (
                    <li key={name} className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                        i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-600' : 'bg-gray-700'
                      }`}>{i + 1}</span>
                      <span className="truncate">{name}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="bg-gray-800 p-6 rounded-lg">
                <h3 className="font-bold mb-3">By Win Rate</h3>
                <ol className="space-y-1">
                  {analysis.rankings.byWinRate.map((name, i) => (
                    <li key={name} className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                        i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-600' : 'bg-gray-700'
                      }`}>{i + 1}</span>
                      <span className="truncate">{name}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* Strategies Tab */}
        {activeTab === 'strategies' && (
          <div className="space-y-4">
            {analysis.strategies.map(strategy => (
              <div key={strategy.strategyId} className="bg-gray-800 p-6 rounded-lg">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-xl font-bold">{strategy.strategyName}</h3>
                  <div className={`text-2xl font-bold ${strategy.totalReturnPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatPercent(strategy.totalReturnPercent)}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                  <div>
                    <div className="text-gray-400">Capital</div>
                    <div>{formatCurrency(strategy.currentCapital)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Total Trades</div>
                    <div>{strategy.totalTrades}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Win Rate</div>
                    <div className={strategy.winRate >= 50 ? 'text-green-400' : 'text-red-400'}>
                      {formatPercent(strategy.winRate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400">Profit Factor</div>
                    <div className={strategy.profitFactor >= 1 ? 'text-green-400' : 'text-red-400'}>
                      {strategy.profitFactor === Infinity ? '∞' : strategy.profitFactor.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400">Avg Win</div>
                    <div className="text-green-400">{formatCurrency(strategy.averageWin)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Avg Loss</div>
                    <div className="text-red-400">{formatCurrency(strategy.averageLoss)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Largest Win</div>
                    <div className="text-green-400">{formatCurrency(strategy.largestWin)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Largest Loss</div>
                    <div className="text-red-400">{formatCurrency(strategy.largestLoss)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Max Drawdown</div>
                    <div className="text-red-400">{formatPercent(strategy.maxDrawdownPercent)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Expectancy</div>
                    <div className={strategy.expectancy >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {formatCurrency(strategy.expectancy)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400">Avg Hold Time</div>
                    <div>{strategy.avgHoldTimeHours.toFixed(1)}h</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Exit Ratio</div>
                    <div className="text-xs">
                      <span className="text-green-400">{strategy.profitTargetExits} TP</span>
                      {' / '}
                      <span className="text-red-400">{strategy.stopLossExits} SL</span>
                    </div>
                  </div>
                </div>

                {strategy.openTrades > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-700">
                    <span className="text-gray-400 text-sm">
                      {strategy.openTrades} open positions | Unrealized P&L:{' '}
                      <span className={strategy.unrealizedPL >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {formatCurrency(strategy.unrealizedPL)}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Hybrid Tab */}
        {activeTab === 'hybrid' && hybrid && (
          <div className="space-y-6">
            {/* Best Combination */}
            {hybrid.bestCombination && (
              <div className="bg-gradient-to-r from-purple-900 to-blue-900 p-6 rounded-lg">
                <h2 className="text-xl font-bold mb-2">Recommended Hybrid Strategy</h2>
                <div className="text-lg text-yellow-400 mb-2">
                  {hybrid.bestCombination.entryStrategy} + {hybrid.bestCombination.exitStrategy}
                </div>
                <div className="text-gray-300">{hybrid.bestCombination.explanation}</div>
                <div className="mt-3 text-sm">
                  Expected Return: <span className="text-green-400">{hybrid.bestCombination.avgReturn.toFixed(2)}% per trade</span>
                </div>
              </div>
            )}

            {/* Insights */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-800 p-4 rounded-lg">
                <div className="text-gray-400 text-sm">Best Entry Signals</div>
                <div className="text-green-400">{hybrid.insights.bestEntryStrategy}</div>
              </div>
              <div className="bg-gray-800 p-4 rounded-lg">
                <div className="text-gray-400 text-sm">Best Exit Rules</div>
                <div className="text-blue-400">{hybrid.insights.bestExitStrategy}</div>
              </div>
              <div className="bg-gray-800 p-4 rounded-lg">
                <div className="text-gray-400 text-sm">Highest Win Rate</div>
                <div className="text-purple-400">{hybrid.insights.highestWinRate}</div>
              </div>
              <div className="bg-gray-800 p-4 rounded-lg">
                <div className="text-gray-400 text-sm">Best Risk/Reward</div>
                <div className="text-yellow-400">{hybrid.insights.bestRiskReward}</div>
              </div>
            </div>

            {/* Top Hybrids */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h3 className="font-bold mb-4">Top 10 Hybrid Combinations</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700">
                      <th className="text-left py-2">Entry Strategy</th>
                      <th className="text-left py-2">Exit Strategy</th>
                      <th className="text-right py-2">Win Rate</th>
                      <th className="text-right py-2">Profit Factor</th>
                      <th className="text-right py-2">Exp. Return</th>
                      <th className="text-left py-2">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hybrid.topHybrids.map((h, i) => (
                      <tr key={i} className="border-b border-gray-700">
                        <td className="py-2">{h.entryStrategy}</td>
                        <td className="py-2">{h.exitStrategy}</td>
                        <td className="py-2 text-right">{h.simulatedWinRate.toFixed(1)}%</td>
                        <td className="py-2 text-right">{h.simulatedProfitFactor.toFixed(2)}</td>
                        <td className={`py-2 text-right ${h.avgReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {h.avgReturn.toFixed(2)}%
                        </td>
                        <td className="py-2 text-xs">{h.recommendation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Strategy Recommendations */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h3 className="font-bold mb-4">Individual Strategy Analysis</h3>
              <div className="space-y-4">
                {hybrid.strategyRecommendations.map(s => (
                  <div key={s.strategy} className="p-4 bg-gray-700 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-bold">{s.strategy}</div>
                      <div className="text-sm">
                        Score: <span className="text-yellow-400">{(s.overallScore * 100).toFixed(0)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm mb-2">
                      <div>Win Rate: {s.winRate.toFixed(1)}%</div>
                      <div>Target: {s.profitTarget}%</div>
                      <div>Stop: {s.stopLoss}%</div>
                    </div>
                    {s.strengths.length > 0 && (
                      <div className="text-sm text-green-400">
                        + {s.strengths.join(' | ')}
                      </div>
                    )}
                    {s.issues.length > 0 && (
                      <div className="text-sm text-red-400">
                        - {s.issues.join(' | ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Correlations Tab */}
        {activeTab === 'correlations' && (
          <div className="space-y-6">
            <div className="bg-gray-800 p-6 rounded-lg">
              <h2 className="text-xl font-bold mb-4">Strategy Correlations</h2>
              <p className="text-gray-400 text-sm mb-4">
                Shows how often strategies trade the same symbols. High correlation = similar picks, low diversification.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700">
                      <th className="text-left py-2">Strategy 1</th>
                      <th className="text-left py-2">Strategy 2</th>
                      <th className="text-right py-2">Correlation</th>
                      <th className="text-right py-2">Shared Symbols</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.correlations.map((c, i) => (
                      <tr key={i} className="border-b border-gray-700">
                        <td className="py-2">{c.strategy1}</td>
                        <td className="py-2">{c.strategy2}</td>
                        <td className="py-2 text-right">
                          <span className={`${
                            c.correlation > 0.5 ? 'text-red-400' :
                            c.correlation > 0.25 ? 'text-yellow-400' :
                            'text-green-400'
                          }`}>
                            {(c.correlation * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-400">
                          {c.sharedSymbols.length > 0 ? c.sharedSymbols.slice(0, 5).join(', ') : 'None'}
                          {c.sharedSymbols.length > 5 && ` +${c.sharedSymbols.length - 5} more`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
