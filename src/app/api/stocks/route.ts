import { NextResponse } from 'next/server'
import { quickScanEligibleStocks, scanForEligibleStocks } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/stocks - Scan for eligible stocks in price range
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const minPrice = parseFloat(searchParams.get('min') || '25')
    const maxPrice = parseFloat(searchParams.get('max') || '100')
    const sampleSize = parseInt(searchParams.get('sample') || '50')
    const fullScan = searchParams.get('full') === 'true'
    const startIndex = parseInt(searchParams.get('startIndex') || '0')

    if (fullScan) {
      // Full sequential scan (for batch processing)
      const result = await scanForEligibleStocks(minPrice, maxPrice, sampleSize, startIndex)
      return NextResponse.json({
        success: true,
        ...result,
      })
    } else {
      // Quick random sample scan
      const stocks = await quickScanEligibleStocks(minPrice, maxPrice, sampleSize)
      return NextResponse.json({
        success: true,
        count: stocks.length,
        stocks,
      })
    }
  } catch (error) {
    console.error('Error scanning stocks:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to scan stocks' },
      { status: 500 }
    )
  }
}
