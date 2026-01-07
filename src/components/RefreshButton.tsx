'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

export function RefreshButton() {
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function handleRefresh() {
    setRefreshing(true)
    setStatus('Fetching live prices...')

    try {
      // First update position prices from live market data
      const res = await fetch('/api/positions/refresh', { method: 'POST' })
      const data = await res.json()

      if (data.success) {
        setStatus(`Updated ${data.updated} positions`)
      } else {
        setStatus('Price update failed')
      }

      // Small delay to show status, then reload page
      await new Promise(resolve => setTimeout(resolve, 500))
      window.location.href = window.location.pathname + '?t=' + Date.now()
    } catch (error) {
      console.error('Refresh failed:', error)
      setStatus('Error refreshing')
      // Still try to reload
      setTimeout(() => {
        window.location.href = window.location.pathname + '?t=' + Date.now()
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
