import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

// GET: Fetch all diary entries
export async function GET() {
  try {
    const entries = await prisma.diaryEntry.findMany({
      orderBy: { entryNumber: 'desc' }
    })

    return NextResponse.json({ entries })
  } catch (error) {
    console.error('Error fetching diary entries:', error)
    return NextResponse.json({ error: 'Failed to fetch diary entries' }, { status: 500 })
  }
}

// POST: Generate a new diary entry since the last one
export async function POST() {
  try {
    // Find the most recent diary entry
    const lastEntry = await prisma.diaryEntry.findFirst({
      orderBy: { entryNumber: 'desc' }
    })

    const now = new Date()
    let periodStart: Date

    if (lastEntry && lastEntry.periodEnd) {
      periodStart = lastEntry.periodEnd
    } else if (lastEntry && lastEntry.weekEnd) {
      periodStart = lastEntry.weekEnd
    } else {
      const earliestTrade = await prisma.trade.findFirst({
        orderBy: { entryDate: 'asc' },
        select: { entryDate: true }
      })
      periodStart = earliestTrade?.entryDate || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    // Fetch trades with FULL strategy details including entry/exit conditions
    const tradesInPeriod = await prisma.trade.findMany({
      where: {
        OR: [
          { entryDate: { gte: periodStart } },
          { exitDate: { gte: periodStart } }
        ]
      },
      include: {
        strategy: {
          select: {
            name: true,
            description: true,
            whitepaperTitle: true,
            whitepaperAuthor: true,
            entryConditions: true,
            exitConditions: true
          }
        }
      },
      orderBy: { entryDate: 'asc' }
    })

    const openPositions = await prisma.position.count()

    if (tradesInPeriod.length === 0 && openPositions === 0) {
      return NextResponse.json({
        error: 'No trading activity since last entry',
        lastEntryDate: lastEntry?.periodEnd || null
      }, { status: 400 })
    }

    // Get all strategies for reference
    const strategies = await prisma.strategy.findMany({
      select: {
        name: true,
        description: true,
        whitepaperTitle: true,
        whitepaperAuthor: true,
        entryConditions: true,
        exitConditions: true
      }
    })

    // Get strategy performance for the period
    const strategyPerformance = await getStrategyPerformanceForPeriod(periodStart, now)

    // Calculate period stats
    const tradesOpened = tradesInPeriod.filter(t => t.entryDate >= periodStart).length
    const closedTrades = tradesInPeriod.filter(t => t.exitDate && t.exitDate >= periodStart)
    const tradesClosed = closedTrades.length
    const winCount = closedTrades.filter(t => (t.profitLoss || 0) > 0).length
    const lossCount = closedTrades.filter(t => (t.profitLoss || 0) <= 0).length
    const periodPL = closedTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0)

    const daysCovered = Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24))

    // Generate AI summary with full context
    const diaryContent = await generateDiarySummary({
      entryNumber: (lastEntry?.entryNumber || 0) + 1,
      periodStart,
      periodEnd: now,
      daysCovered,
      trades: tradesInPeriod,
      strategies,
      strategyPerformance,
      stats: { tradesOpened, tradesClosed, winCount, lossCount, periodPL }
    })

    const entry = await prisma.diaryEntry.create({
      data: {
        periodStart,
        periodEnd: now,
        title: diaryContent.title,
        summary: diaryContent.summary,
        tradesOpened,
        tradesClosed,
        winCount,
        lossCount,
        periodPL,
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

async function getStrategyPerformanceForPeriod(periodStart: Date, periodEnd: Date) {
  const trades = await prisma.trade.findMany({
    where: {
      exitDate: { gte: periodStart, lte: periodEnd }
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
    avgHoldHours: number
  }> = {}

  for (const trade of trades) {
    const name = trade.strategy.name
    if (!strategyStats[name]) {
      strategyStats[name] = { name, trades: 0, wins: 0, losses: 0, pl: 0, avgReturn: 0, avgHoldHours: 0 }
    }
    strategyStats[name].trades++
    if ((trade.profitLoss || 0) > 0) {
      strategyStats[name].wins++
    } else {
      strategyStats[name].losses++
    }
    strategyStats[name].pl += trade.profitLoss || 0
    strategyStats[name].avgReturn += trade.profitLossPercent || 0
    strategyStats[name].avgHoldHours += trade.holdTimeHours || 0
  }

  for (const stat of Object.values(strategyStats)) {
    if (stat.trades > 0) {
      stat.avgReturn = stat.avgReturn / stat.trades
      stat.avgHoldHours = stat.avgHoldHours / stat.trades
    }
  }

  return Object.values(strategyStats).sort((a, b) => b.pl - a.pl)
}

interface StrategyInfo {
  name: string
  description: string
  whitepaperTitle: string | null
  whitepaperAuthor: string | null
  entryConditions: unknown
  exitConditions: unknown
}

interface TradeWithStrategy {
  symbol: string
  side: string
  entryDate: Date
  entryPrice: number
  exitDate: Date | null
  exitPrice: number | null
  profitLoss: number | null
  profitLossPercent: number | null
  exitReason: string | null
  holdTimeHours: number | null
  indicatorsAtEntry: unknown
  strategy: StrategyInfo
}

interface DiaryInput {
  entryNumber: number
  periodStart: Date
  periodEnd: Date
  daysCovered: number
  trades: TradeWithStrategy[]
  strategies: StrategyInfo[]
  strategyPerformance: Array<{
    name: string
    trades: number
    wins: number
    losses: number
    pl: number
    avgReturn: number
    avgHoldHours: number
  }>
  stats: {
    tradesOpened: number
    tradesClosed: number
    winCount: number
    lossCount: number
    periodPL: number
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

  const prompt = buildAnalyticalPrompt(input)

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  return parseAIResponse(text, input)
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function formatConditions(conditions: unknown): string {
  if (!conditions) return 'Not specified'
  try {
    const c = conditions as Record<string, unknown>
    const parts: string[] = []

    if (c.rsiBelow) parts.push(`RSI below ${c.rsiBelow}`)
    if (c.rsiAbove) parts.push(`RSI above ${c.rsiAbove}`)
    if (c.rsi2Below) parts.push(`RSI(2) below ${c.rsi2Below}`)
    if (c.priceAboveSMA) parts.push(`Price above ${c.priceAboveSMA}-day SMA`)
    if (c.priceBelowSMA) parts.push(`Price below ${c.priceBelowSMA}-day SMA`)
    if (c.macdCrossover) parts.push('MACD bullish crossover')
    if (c.macdCrossunder) parts.push('MACD bearish crossover')
    if (c.bollingerBreakout) parts.push(`Bollinger Band breakout (${c.bollingerBreakout})`)
    if (c.stochasticOversold) parts.push(`Stochastic oversold (<${c.stochasticOversold})`)
    if (c.adxAbove) parts.push(`ADX above ${c.adxAbove} (strong trend)`)
    if (c.volumeSpike) parts.push(`Volume spike (>${c.volumeSpike}x average)`)

    // Exit conditions
    if (c.profitTarget) parts.push(`Profit target: ${c.profitTarget}%`)
    if (c.stopLoss) parts.push(`Stop loss: ${c.stopLoss}%`)
    if (c.trailingStop) parts.push(`Trailing stop: ${c.trailingStop}%`)
    if (c.atrStop) parts.push(`ATR-based stop: ${c.atrStop}x ATR`)
    if (c.exitAboveSMA) parts.push(`Exit when price above ${c.exitAboveSMA}-day SMA`)
    if (c.macdExit) parts.push('Exit on MACD signal')
    if (c.bollingerExit) parts.push('Exit at Bollinger middle band')
    if (c.timeLimit) parts.push(`Time limit: ${c.timeLimit} days`)

    return parts.length > 0 ? parts.join(', ') : JSON.stringify(conditions)
  } catch {
    return String(conditions)
  }
}

function formatIndicators(indicators: unknown): string {
  if (!indicators) return 'No indicator data'
  try {
    const ind = indicators as Record<string, number>
    const parts: string[] = []

    if (ind.rsi14 !== undefined) parts.push(`RSI(14): ${ind.rsi14.toFixed(1)}`)
    if (ind.rsi2 !== undefined) parts.push(`RSI(2): ${ind.rsi2.toFixed(1)}`)
    if (ind.macd !== undefined) parts.push(`MACD: ${ind.macd.toFixed(3)}`)
    if (ind.macdHistogram !== undefined) parts.push(`MACD Hist: ${ind.macdHistogram.toFixed(3)}`)
    if (ind.bbUpper !== undefined && ind.bbLower !== undefined) {
      parts.push(`BB: ${ind.bbLower.toFixed(2)}-${ind.bbUpper.toFixed(2)}`)
    }
    if (ind.atr14 !== undefined) parts.push(`ATR: ${ind.atr14.toFixed(2)}`)
    if (ind.adx !== undefined) parts.push(`ADX: ${ind.adx.toFixed(1)}`)
    if (ind.stochK !== undefined) parts.push(`Stoch %K: ${ind.stochK.toFixed(1)}`)
    if (ind.sma20 !== undefined) parts.push(`SMA20: ${ind.sma20.toFixed(2)}`)
    if (ind.sma50 !== undefined) parts.push(`SMA50: ${ind.sma50.toFixed(2)}`)

    return parts.length > 0 ? parts.join(' | ') : 'Limited data'
  } catch {
    return 'Error parsing indicators'
  }
}

function buildAnalyticalPrompt(input: DiaryInput): string {
  const { entryNumber, periodStart, periodEnd, daysCovered, stats, strategyPerformance, trades, strategies } = input

  const winRate = stats.tradesClosed > 0
    ? ((stats.winCount / stats.tradesClosed) * 100).toFixed(1)
    : '0'

  // Separate winners and losers with full details
  const closedTrades = trades.filter(t => t.exitDate !== null)
  const winners = closedTrades.filter(t => (t.profitLoss || 0) > 0).sort((a, b) => (b.profitLoss || 0) - (a.profitLoss || 0))
  const losers = closedTrades.filter(t => (t.profitLoss || 0) <= 0).sort((a, b) => (a.profitLoss || 0) - (b.profitLoss || 0))

  // Build strategy reference
  const strategyReference = strategies.map(s =>
    `**${s.name}**${s.whitepaperAuthor ? ` (${s.whitepaperAuthor})` : ''}
   - Theory: ${s.description}
   - Entry rules: ${formatConditions(s.entryConditions)}
   - Exit rules: ${formatConditions(s.exitConditions)}`
  ).join('\n\n')

  // Build detailed trade analysis for top winners
  const winnerAnalysis = winners.slice(0, 5).map(t => {
    const holdDays = t.holdTimeHours ? (t.holdTimeHours / 24).toFixed(1) : '?'
    return `• ${t.symbol} via ${t.strategy.name}
     Entry: $${t.entryPrice.toFixed(2)} → Exit: $${(t.exitPrice || 0).toFixed(2)}
     Result: +$${(t.profitLoss || 0).toFixed(2)} (+${(t.profitLossPercent || 0).toFixed(1)}%)
     Hold time: ${holdDays} days | Exit reason: ${t.exitReason || 'Unknown'}
     Indicators at entry: ${formatIndicators(t.indicatorsAtEntry)}`
  }).join('\n\n')

  // Build detailed trade analysis for losers
  const loserAnalysis = losers.slice(0, 5).map(t => {
    const holdDays = t.holdTimeHours ? (t.holdTimeHours / 24).toFixed(1) : '?'
    return `• ${t.symbol} via ${t.strategy.name}
     Entry: $${t.entryPrice.toFixed(2)} → Exit: $${(t.exitPrice || 0).toFixed(2)}
     Result: -$${Math.abs(t.profitLoss || 0).toFixed(2)} (${(t.profitLossPercent || 0).toFixed(1)}%)
     Hold time: ${holdDays} days | Exit reason: ${t.exitReason || 'Unknown'}
     Indicators at entry: ${formatIndicators(t.indicatorsAtEntry)}`
  }).join('\n\n')

  return `You are a swing trading coach writing an educational diary entry. Your job is to TEACH the reader why trades won or lost by analyzing the strategy mechanics.

=== PERIOD OVERVIEW ===
Entry #${entryNumber}: ${formatDate(periodStart)} to ${formatDate(periodEnd)} (${daysCovered} days)

Stats: ${stats.tradesOpened} opened, ${stats.tradesClosed} closed
Results: ${stats.winCount} wins, ${stats.lossCount} losses (${winRate}% win rate)
P&L: $${stats.periodPL.toFixed(2)}

=== STRATEGY REFERENCE (The Rules These Trades Followed) ===
${strategyReference}

=== STRATEGY PERFORMANCE THIS PERIOD ===
${strategyPerformance.length > 0 ? strategyPerformance.map(s =>
  `${s.name}: ${s.trades} trades (${s.wins}W/${s.losses}L), $${s.pl.toFixed(2)} P&L, ${s.avgReturn.toFixed(1)}% avg, held ${(s.avgHoldHours/24).toFixed(1)} days avg`
).join('\n') : 'No completed trades'}

=== WINNING TRADES (Analyze WHY these worked) ===
${winnerAnalysis || 'No winners this period'}

=== LOSING TRADES (Analyze WHY these failed) ===
${loserAnalysis || 'No losers this period'}

=== YOUR TASK ===
Write an EDUCATIONAL diary entry that teaches the reader:

1. TITLE: A descriptive title (e.g., "Entry #${entryNumber}: RSI Signals Shine, MACD Struggles")

2. SUMMARY (2-3 paragraphs):
   - Overall performance narrative
   - SPECIFICALLY explain which strategy mechanics worked and which didn't
   - Connect the indicator readings to the outcomes
   - Use plain language - explain what RSI being "oversold at 15" actually means

3. WHAT WORKED (3-5 bullets):
   - Be SPECIFIC about the strategy mechanics
   - Example: "The RSI(2) strategy caught AAPL at extreme oversold (RSI=8), which historically bounces. It did."
   - Explain WHY the entry/exit rules made sense for the market conditions
   - Connect indicator values to outcomes

4. WHAT DIDN'T WORK (3-5 bullets):
   - Be SPECIFIC about what failed in the strategy
   - Example: "MACD crossover triggered on XYZ, but ADX was only 12 (weak trend), so there was no follow-through."
   - Explain what the indicators were telling us vs what actually happened
   - Identify if it was bad entry timing, wrong exit, or market conditions

5. KEY LESSONS (2-3 bullets):
   - Actionable insights about the strategies
   - What conditions make each strategy work better or worse?
   - What should we watch for next time?

FORMAT:
TITLE: [title]

SUMMARY:
[paragraphs]

WHAT WORKED:
- [specific analysis with numbers]
- [etc]

WHAT DIDN'T:
- [specific analysis with numbers]
- [etc]

KEY LESSONS:
- [actionable insight]
- [etc]

Remember: Be a TEACHER. Don't just say "RSI strategy lost" - explain WHY based on the actual indicator values and market behavior.`
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

  const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/i)
  sections.title = titleMatch ? titleMatch[1].trim() : `Entry #${input.entryNumber}: Trading Update`

  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]+?)(?=WHAT WORKED:|$)/i)
  sections.summary = summaryMatch ? summaryMatch[1].trim() : 'No summary available.'

  const workedMatch = text.match(/WHAT WORKED:\s*([\s\S]+?)(?=WHAT DIDN'?T:|$)/i)
  if (workedMatch) {
    sections.whatWorked = workedMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean)
  }

  const didntMatch = text.match(/WHAT DIDN'?T.*?:\s*([\s\S]+?)(?=KEY LESSONS:|KEY TAKEAWAYS:|$)/i)
  if (didntMatch) {
    sections.whatDidnt = didntMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean)
  }

  const takeawaysMatch = text.match(/KEY (?:LESSONS|TAKEAWAYS):\s*([\s\S]+?)$/i)
  if (takeawaysMatch) {
    sections.keyTakeaways = takeawaysMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean)
  }

  return sections
}
