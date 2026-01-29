'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, BookOpen, TrendingUp, TrendingDown, Lightbulb, AlertCircle, CheckCircle, Calendar } from 'lucide-react'

interface DiaryEntry {
  id: string
  entryNumber: number
  periodStart: string
  periodEnd: string
  title: string
  summary: string
  tradesOpened: number
  tradesClosed: number
  winCount: number
  lossCount: number
  periodPL: number
  whatWorked: string[]
  whatDidnt: string[]
  keyTakeaways: string[]
  generatedAt: string
}

export default function DiaryPage() {
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fetchEntries() {
    try {
      const res = await fetch('/api/diary')
      if (res.ok) {
        const data = await res.json()
        setEntries(data.entries || [])
      }
    } catch (error) {
      console.error('Failed to fetch diary entries:', error)
    } finally {
      setLoading(false)
    }
  }

  async function generateEntry() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/diary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      if (res.ok) {
        await fetchEntries()
      } else {
        setError(data.error || 'Failed to generate entry')
      }
    } catch (error) {
      console.error('Failed to generate entry:', error)
      setError('Failed to generate entry')
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    fetchEntries()
  }, [])

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
  }

  const formatFullDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatCurrency = (n: number) => {
    const prefix = n >= 0 ? '+$' : '-$'
    return prefix + Math.abs(n).toFixed(2)
  }

  const getDaysCovered = (start: string, end: string) => {
    const startDate = new Date(start)
    const endDate = new Date(end)
    return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  }

  const Header = () => (
    <header className="border-b border-slate-200 bg-white">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <span className="text-xl font-bold text-slate-900">StrategyForge</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">
              Leaderboard
            </Link>
            <Link href="/analysis" className="text-sm text-slate-600 hover:text-slate-900">
              Analysis
            </Link>
            <Link href="/diary" className="text-sm text-slate-900 font-medium">
              Diary
            </Link>
          </div>
        </div>
      </div>
    </header>
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold mb-8 flex items-center gap-3">
            <BookOpen className="w-8 h-8" />
            Trading Diary
          </h1>
          <div className="animate-pulse">Loading diary entries...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <BookOpen className="w-8 h-8" />
            Trading Diary
          </h1>
          <button
            onClick={generateEntry}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Generating...' : 'Generate Update'}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {entries.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-slate-200">
            <BookOpen className="w-12 h-12 mx-auto text-slate-400 mb-4" />
            <p className="text-slate-600 mb-4">No diary entries yet.</p>
            <p className="text-sm text-slate-500">
              Click "Generate Update" to create your first entry based on all trading activity.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {entries.map(entry => (
              <div
                key={entry.id}
                className="bg-white rounded-lg border border-slate-200 overflow-hidden"
              >
                {/* Header */}
                <div
                  className="p-6 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                        <Calendar className="w-4 h-4" />
                        <span>
                          Entry #{entry.entryNumber} • {formatDate(entry.periodStart)} - {formatDate(entry.periodEnd)}
                          <span className="text-slate-400 ml-1">
                            ({getDaysCovered(entry.periodStart, entry.periodEnd)} days)
                          </span>
                        </span>
                      </div>
                      <h2 className="text-xl font-bold">{entry.title}</h2>
                    </div>
                    <div className="text-right">
                      <div className={`text-xl font-bold ${entry.periodPL >= 0 ? 'text-emerald-800' : 'text-red-700'}`}>
                        {formatCurrency(entry.periodPL)}
                      </div>
                      <div className="text-sm text-slate-500">
                        {entry.winCount}W / {entry.lossCount}L
                      </div>
                    </div>
                  </div>

                  {/* Quick Stats */}
                  <div className="flex gap-6 mt-4 text-sm">
                    <div>
                      <span className="text-slate-500">Opened:</span>{' '}
                      <span className="font-medium">{entry.tradesOpened}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Closed:</span>{' '}
                      <span className="font-medium">{entry.tradesClosed}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Win Rate:</span>{' '}
                      <span className={`font-medium ${
                        entry.tradesClosed > 0 && (entry.winCount / entry.tradesClosed) >= 0.5
                          ? 'text-emerald-800'
                          : 'text-red-700'
                      }`}>
                        {entry.tradesClosed > 0
                          ? ((entry.winCount / entry.tradesClosed) * 100).toFixed(0)
                          : 0}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {expandedEntry === entry.id && (
                  <div className="border-t border-slate-200 p-6 space-y-6">
                    {/* Summary */}
                    <div>
                      <p className="text-slate-700 whitespace-pre-line leading-relaxed">
                        {entry.summary}
                      </p>
                    </div>

                    {/* What Worked */}
                    {entry.whatWorked.length > 0 && (
                      <div className="bg-emerald-50 rounded-lg p-4">
                        <h3 className="font-bold text-emerald-900 mb-3 flex items-center gap-2">
                          <TrendingUp className="w-5 h-5" />
                          What Worked
                        </h3>
                        <ul className="space-y-2">
                          {entry.whatWorked.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-emerald-900">
                              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* What Didn't Work */}
                    {entry.whatDidnt.length > 0 && (
                      <div className="bg-red-50 rounded-lg p-4">
                        <h3 className="font-bold text-red-900 mb-3 flex items-center gap-2">
                          <TrendingDown className="w-5 h-5" />
                          What Didn't Work
                        </h3>
                        <ul className="space-y-2">
                          {entry.whatDidnt.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-red-900">
                              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Key Takeaways */}
                    {entry.keyTakeaways.length > 0 && (
                      <div className="bg-amber-50 rounded-lg p-4">
                        <h3 className="font-bold text-amber-900 mb-3 flex items-center gap-2">
                          <Lightbulb className="w-5 h-5" />
                          Key Takeaways
                        </h3>
                        <ul className="space-y-2">
                          {entry.keyTakeaways.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-amber-900">
                              <span className="font-bold">{i + 1}.</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="text-xs text-slate-400 pt-2">
                      Generated {new Date(entry.generatedAt).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
