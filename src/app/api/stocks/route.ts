import { NextResponse } from 'next/server'
import { getEligibleStocks, getQuote, getCandles } from '@/lib/finnhub'

export const dynamic = 'force-dynamic'

// GET /api/stocks - Get eligible stocks in price range
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const minPrice = parseFloat(searchParams.get('min') || '25')
    const maxPrice = parseFloat(searchParams.get('max') || '100')
    const maxStocks = parseInt(searchParams.get('limit') || '30')

    const stocks = await getEligibleStocks(minPrice, maxPrice, maxStocks)

    return NextResponse.json({
      success: true,
      count: stocks.length,
      stocks,
    })
  } catch (error) {
    console.error('Error fetching stocks:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch stocks' },
      { status: 500 }
    )
  }
}
