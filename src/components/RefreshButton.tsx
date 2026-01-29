'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

export function RefreshButton() {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function handleRefresh() {
    setRefreshing(true)

    try {
      // Step 1: Ensure simulations are running
      setStatus('Starting simulations...')
      await fetch('/api/simulation/start', { method: 'POST', cache: 'no-store' })

      // Step 2: Update position prices from live market data (Finnhub - reliable)
      setStatus('Fetching live prices...')
      const priceRes = await fetch('/api/positions/refresh', {
        method: 'POST',
        cache: 'no-store',
      })
      const priceData = await priceRes.json()

      // Step 3: Check exit conditions for existing positions
      setStatus('Checking exits...')
      const exitRes = await fetch('/api/simulation/check-exits', {
        method: 'POST',
        cache: 'no-store',
      })
      const exitData = await exitRes.json()

      // Step 4: Process existing signals into new trades
      setStatus('Processing signals...')
      const signalRes = await fetch('/api/simulation/process-signals', {
        method: 'POST',
        cache: 'no-store',
      })
      const signalData = await signalRes.json()

      // Show detailed summary - always show prices updated
      const updates = []
      if (priceData.updated > 0) updates.push(`${priceData.updated} prices`)
      if (exitData.closedPositions > 0) updates.push(`${exitData.closedPositions} exits`)
      if (signalData.tradesOpened > 0) updates.push(`${signalData.tradesOpened} trades`)

      // Log detailed results to console for debugging
      console.log('Refresh results:', {
        prices: priceData,
        exits: exitData,
        signals: signalData,
      })

      setStatus(updates.length > 0 ? updates.join(', ') : 'Prices up to date')

      // Small delay to show status
      await new Promise(resolve => setTimeout(resolve, 500))

      // Force Next.js to revalidate server components
      router.refresh()

      // Also do a hard navigation to bust any edge cache
      setTimeout(() => {
        window.location.replace(window.location.pathname + '?_t=' + Date.now())
      }, 200)
    } catch (error) {
      console.error('Refresh failed:', error)
      setStatus('Error refreshing')
      setTimeout(() => {
        window.location.replace(window.location.pathname + '?_t=' + Date.now())
      }, 1000)
    }
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={refreshing}
      className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 rounded-lg text-sm text-slate-700 transition-colors"
      title={status || 'Refresh position prices and data'}
    >
      <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
      {refreshing ? (status || 'Refreshing...') : 'Refresh'}
    </button>
  )
}
