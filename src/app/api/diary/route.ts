import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

// GET: Fetch all diary entries
export async function GET() {
  try {
    const entries = await prisma.diaryEntry.findMany({
      orderBy: [
        { year: 'desc' },
        { weekNumber: 'desc' }
      ]
    })

    return NextResponse.json({ entries })
  } catch (error) {
    console.error('Error fetching diary entries:', error)
    return NextResponse.json({ error: 'Failed to fetch diary entries' }, { status: 500 })
  }
}

// POST: Generate a new diary entry for a specific week
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { weekNumber, year } = body

    // Calculate current week if not provided
    const now = new Date()
    const targetYear = year || now.getFullYear()
    const targetWeek = weekNumber || getWeekNumber(now)

    // Check if entry already exists
    const existing = await prisma.diaryEntry.findUnique({
      where: { weekNumber_year: { weekNumber: targetWeek, year: targetYear } }
    })

    if (existing) {
      return NextResponse.json({
        entry: existing,
        message: 'Entry already exists for this week'
      })
    }

    // Calculate week boundaries
    const { weekStart, weekEnd } = getWeekBoundaries(targetWeek, targetYear)

    // Fetch trades for this week
    const trades = await prisma.trade.findMany({
      where: {
        OR: [
          { entryDate: { gte: weekStart, lte: weekEnd } },
          { exitDate: { gte: weekStart, lte: weekEnd } }
        ]
      },
      include: {
        strategy: { select: { name: true } }
      },
      orderBy: { entryDate: 'asc' }
    })

    // Get strategy performance for the week
    const strategyPerformance = await getStrategyPerformanceForWeek(weekStart, weekEnd)

    // Calculate week stats
    const tradesOpened = trades.filter(t => t.entryDate >= weekStart && t.entryDate <= weekEnd).length
    const closedTrades = trades.filter(t => t.exitDate && t.exitDate >= weekStart && t.exitDate <= weekEnd)
    const tradesClosed = closedTrades.length
    const winCount = closedTrades.filter(t => (t.profitLoss || 0) > 0).length
    const lossCount = closedTrades.filter(t => (t.profitLoss || 0) <= 0).length
    const weeklyPL = closedTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0)

    // Generate AI summary
    const diaryContent = await generateDiarySummary({
      weekNumber: targetWeek,
      year: targetYear,
      weekStart,
      weekEnd,
      trades,
      strategyPerformance,
      stats: { tradesOpened, tradesClosed, winCount, lossCount, weeklyPL }
    })

    // Save to database
    const entry = await prisma.diaryEntry.create({
      data: {
        weekNumber: targetWeek,
        year: targetYear,
        weekStart,
        weekEnd,
        title: diaryContent.title,
        summary: diaryContent.summary,
        tradesOpened,
        tradesClosed,
        winCount,
        lossCount,
        weeklyPL,
        whatWorked: diaryContent.whatWorked,
        whatDidnt: diaryContent.whatDidnt,
        keyTakeaways: diaryContent.keyTakeaways
      }
    })

    return NextResponse.json({ entry, generated: true })
  } catch (error) {
    console.error('Error generating diary entry:', error)
    return NextResponse.json({ error: 'Failed to generate diary entry' }, { status: 500 })
  }
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getWeekBoundaries(weekNumber: number, year: number): { weekStart: Date, weekEnd: Date } {
  // Find first Thursday of the year (ISO week 1 contains first Thursday)
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const firstMonday = new Date(jan4)
  firstMonday.setDate(jan4.getDate() - dayOfWeek + 1)

  // Calculate target week's Monday
  const weekStart = new Date(firstMonday)
  weekStart.setDate(firstMonday.getDate() + (weekNumber - 1) * 7)
  weekStart.setHours(0, 0, 0, 0)

  // Friday of that week
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 4)
  weekEnd.setHours(23, 59, 59, 999)

  return { weekStart, weekEnd }
}

async function getStrategyPerformanceForWeek(weekStart: Date, weekEnd: Date) {
  const trades = await prisma.trade.findMany({
    where: {
      exitDate: { gte: weekStart, lte: weekEnd }
    },
    include: {
      strategy: { select: { name: true } }
    }
  })

  const strategyStats: Record<string, {
    name: string
    trades: number
    wins: number
    losses: number
    pl: number
    avgReturn: number
  }> = {}

  for (const trade of trades) {
    const name = trade.strategy.name
    if (!strategyStats[name]) {
      strategyStats[name] = { name, trades: 0, wins: 0, losses: 0, pl: 0, avgReturn: 0 }
    }
    strategyStats[name].trades++
    if ((trade.profitLoss || 0) > 0) {
      strategyStats[name].wins++
    } else {
      strategyStats[name].losses++
    }
    strategyStats[name].pl += trade.profitLoss || 0
    strategyStats[name].avgReturn += trade.profitLossPercent || 0
  }

  // Calculate averages
  for (const stat of Object.values(strategyStats)) {
    stat.avgReturn = stat.trades > 0 ? stat.avgReturn / stat.trades : 0
  }

  return Object.values(strategyStats).sort((a, b) => b.pl - a.pl)
}

interface DiaryInput {
  weekNumber: number
  year: number
  weekStart: Date
  weekEnd: Date
  trades: Array<{
    symbol: string
    side: string
    entryDate: Date
    entryPrice: number
    exitDate: Date | null
    exitPrice: number | null
    profitLoss: number | null
    profitLossPercent: number | null
    exitReason: string | null
    strategy: { name: string }
  }>
  strategyPerformance: Array<{
    name: string
    trades: number
    wins: number
    losses: number
    pl: number
    avgReturn: number
  }>
  stats: {
    tradesOpened: number
    tradesClosed: number
    winCount: number
    lossCount: number
    weeklyPL: number
  }
}

async function generateDiarySummary(input: DiaryInput): Promise<{
  title: string
  summary: string
  whatWorked: string[]
  whatDidnt: string[]
  keyTakeaways: string[]
}> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  })

  const prompt = buildPrompt(input)

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  // Parse the response
  return parseAIResponse(text, input)
}

function buildPrompt(input: DiaryInput): string {
  const { weekNumber, year, stats, strategyPerformance, trades } = input

  const winRate = stats.tradesClosed > 0
    ? ((stats.winCount / stats.tradesClosed) * 100).toFixed(1)
    : '0'

  // Get top winners and losers
  const closedTrades = trades.filter(t => t.exitDate !== null)
  const sortedByPL = [...closedTrades].sort((a, b) => (b.profitLoss || 0) - (a.profitLoss || 0))
  const topWinners = sortedByPL.slice(0, 3).filter(t => (t.profitLoss || 0) > 0)
  const topLosers = sortedByPL.slice(-3).reverse().filter(t => (t.profitLoss || 0) < 0)

  return `You are writing a weekly trading diary for a swing trading simulation. Write at a 9th grade reading level - simple, clear, conversational. No jargon. Explain things like you're talking to a friend who's learning about trading.

WEEK ${weekNumber} OF ${year}

WEEKLY STATS:
- Trades opened: ${stats.tradesOpened}
- Trades closed: ${stats.tradesClosed}
- Wins: ${stats.winCount}
- Losses: ${stats.lossCount}
- Win rate: ${winRate}%
- Weekly P&L: $${stats.weeklyPL.toFixed(2)}

STRATEGY PERFORMANCE THIS WEEK:
${strategyPerformance.map(s =>
  `- ${s.name}: ${s.trades} trades, ${s.wins}W/${s.losses}L, $${s.pl.toFixed(2)} P&L, ${s.avgReturn.toFixed(1)}% avg return`
).join('\n')}

TOP WINNERS:
${topWinners.length > 0 ? topWinners.map(t =>
  `- ${t.symbol} (${t.strategy.name}): +$${(t.profitLoss || 0).toFixed(2)} (+${(t.profitLossPercent || 0).toFixed(1)}%), exited via ${t.exitReason}`
).join('\n') : 'None this week'}

NOTABLE LOSSES:
${topLosers.length > 0 ? topLosers.map(t =>
  `- ${t.symbol} (${t.strategy.name}): $${(t.profitLoss || 0).toFixed(2)} (${(t.profitLossPercent || 0).toFixed(1)}%), exited via ${t.exitReason}`
).join('\n') : 'None this week'}

Please write:

1. TITLE: A short, catchy title for this week (e.g., "Week 2: Finding Our Groove" or "Week 3: Rough Waters")

2. SUMMARY: A 2-3 paragraph diary entry explaining:
   - How the week went overall
   - What patterns or trends you noticed
   - Any interesting observations about the strategies
   - Keep it conversational and easy to understand

3. WHAT WORKED: 3-5 bullet points about what went well and why

4. WHAT DIDN'T: 3-5 bullet points about what didn't work and possible reasons

5. KEY TAKEAWAYS: 2-3 main lessons or insights from this week

Format your response exactly like this:
TITLE: [Your title here]

SUMMARY:
[Your summary paragraphs here]

WHAT WORKED:
- [Point 1]
- [Point 2]
- [Point 3]

WHAT DIDN'T:
- [Point 1]
- [Point 2]
- [Point 3]

KEY TAKEAWAYS:
- [Takeaway 1]
- [Takeaway 2]
- [Takeaway 3]`
}

function parseAIResponse(text: string, input: DiaryInput): {
  title: string
  summary: string
  whatWorked: string[]
  whatDidnt: string[]
  keyTakeaways: string[]
} {
  const sections = {
    title: '',
    summary: '',
    whatWorked: [] as string[],
    whatDidnt: [] as string[],
    keyTakeaways: [] as string[]
  }

  // Extract title
  const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/i)
  sections.title = titleMatch ? titleMatch[1].trim() : `Week ${input.weekNumber}: Trading Summary`

  // Extract summary
  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]+?)(?=WHAT WORKED:|$)/i)
  sections.summary = summaryMatch ? summaryMatch[1].trim() : 'No summary available.'

  // Extract what worked
  const workedMatch = text.match(/WHAT WORKED:\s*([\s\S]+?)(?=WHAT DIDN'?T:|$)/i)
  if (workedMatch) {
    sections.whatWorked = workedMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean)
  }

  // Extract what didn't work
  const didntMatch = text.match(/WHAT DIDN'?T.*?:\s*([\s\S]+?)(?=KEY TAKEAWAYS:|$)/i)
  if (didntMatch) {
    sections.whatDidnt = didntMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean)
  }

  // Extract key takeaways
  const takeawaysMatch = text.match(/KEY TAKEAWAYS:\s*([\s\S]+?)$/i)
  if (takeawaysMatch) {
    sections.keyTakeaways = takeawaysMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean)
  }

  return sections
}
