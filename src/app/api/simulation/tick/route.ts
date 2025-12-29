import { NextResponse } from 'next/server'
import { runAllSimulations } from '@/lib/simulation'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60 seconds for this endpoint

// This endpoint is called by Vercel Cron Jobs
// POST /api/simulation/tick - Run one tick of all simulations
export async function POST(request: Request) {
  try {
    // Verify cron secret (optional security)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await runAllSimulations()

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    })
  } catch (error) {
    console.error('Simulation tick error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

// GET for easy testing
export async function GET(request: Request) {
  return POST(request)
}
