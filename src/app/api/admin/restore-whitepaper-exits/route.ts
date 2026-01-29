import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Original whitepaper exit conditions - restored from design
const WHITEPAPER_EXIT_CONDITIONS: Record<string, object> = {
  'RSI Mean Reversion': {
    indicators: [
      { type: 'RSI', period: 14, threshold: 50, comparison: 'greater_than' }
    ],
    maxHoldDays: 10,
    exitLogic: 'ANY',
    // No fixed profit target or stop loss - pure indicator-based
  },
  'MACD Momentum Crossover': {
    indicators: [
      { type: 'MACD_CROSSOVER', direction: 'bearish' }
    ],
    maxHoldDays: 20,
    exitLogic: 'ANY',
  },
  'Volume Breakout Scanner': {
    indicators: [
      { type: 'VOLUME', period: 30, comparison: 'less_than', multiplier: 1 }
    ],
    profitTarget: 12,  // This strategy does use a profit target per whitepaper
    stopLoss: 5,
    maxHoldDays: 15,
    exitLogic: 'ANY',
  },
  'RSI-Stochastic Double Oversold': {
    // Connors RSI(2) strategy - exit when RSI(2) > 50 or price > 5-day MA
    indicators: [
      { type: 'RSI', period: 2, threshold: 50, comparison: 'greater_than' },
      { type: 'PRICE_VS_MA', period: 5, comparison: 'closes_above' }
    ],
    maxHoldDays: 10,
    exitLogic: 'ANY',  // Exit on ANY condition met
  },
  'Bollinger Squeeze Breakout': {
    indicators: [
      { type: 'BOLLINGER', band: 'middle', comparison: 'price_below' }
    ],
    stopLossType: 'BOLLINGER_MIDDLE',  // Trail stop at middle band
    maxHoldDays: 20,
    exitLogic: 'ANY',
  },
  'ADX Trend + MA Pullback': {
    indicators: [
      { type: 'ADX', period: 14, threshold: 20, comparison: 'less_than' },
      { type: 'ADX', comparison: 'bearish_di' }  // -DI crosses above +DI
    ],
    stopLossType: 'ATR_TRAILING',
    atrPeriod: 14,
    atrMultiplier: 2,
    maxHoldDays: 30,
    exitLogic: 'ANY',
  },
  'Triple MA Trend': {
    indicators: [
      { type: 'MA_ALIGNMENT', direction: 'bearish' }  // MAs flip bearish
    ],
    profitTarget: 8,
    stopLoss: 5,
    exitLogic: 'ANY',
  },
  'Momentum Persistence': {
    indicators: [
      { type: 'ROC', period: 12, comparison: 'negative' }  // Momentum turns negative
    ],
    profitTarget: 10,
    stopLoss: 7,
    exitLogic: 'ANY',
  },
  '52-Week High Breakout': {
    indicators: [
      { type: 'PRICE_VS_52W_HIGH', threshold: 80, comparison: 'less_than' }  // Price drops 20% from 52w high
    ],
    maxHoldDays: 126,  // ~6 months per O'Neil methodology
    exitLogic: 'ANY',
  },
  'ADX Trend Rider': {
    indicators: [
      { type: 'ADX', period: 14, threshold: 20, comparison: 'less_than' },
      { type: 'ADX', comparison: 'bearish_di' }
    ],
    stopLossType: 'ATR_TRAILING',
    atrPeriod: 14,
    atrMultiplier: 2,
    exitLogic: 'ANY',
  },
  'Stochastic-RSI Momentum Sync': {
    indicators: [
      { type: 'STOCHASTIC', threshold: 80, comparison: 'overbought' }
    ],
    stopLossType: 'ATR_FIXED',
    atrPeriod: 14,
    atrMultiplier: 1.5,
    accountRiskPercent: 2,
    maxHoldDays: 12,
    exitLogic: 'ANY',
  },
  'MACD-BB-Volume Triple Filter': {
    indicators: [
      { type: 'MACD', comparison: 'below_entry_trough' }  // Appel's MACD trough method
    ],
    stopLossType: 'MACD_TROUGH',
    maxHoldDays: 30,
    exitLogic: 'ANY',
  },
}

// POST - Restore original whitepaper exit conditions
export async function POST() {
  const strategies = await prisma.strategy.findMany({
    select: { id: true, name: true, exitConditions: true },
  })

  const updated = []
  for (const strategy of strategies) {
    const whitepaperExit = WHITEPAPER_EXIT_CONDITIONS[strategy.name]
    if (whitepaperExit) {
      await prisma.strategy.update({
        where: { id: strategy.id },
        data: { exitConditions: whitepaperExit },
      })
      updated.push({
        name: strategy.name,
        newConditions: whitepaperExit,
      })
    }
  }

  return NextResponse.json({
    success: true,
    message: `Restored ${updated.length} strategies to whitepaper exit conditions`,
    updated,
  })
}

// GET - Show comparison of current vs whitepaper conditions
export async function GET() {
  const strategies = await prisma.strategy.findMany({
    select: { name: true, exitConditions: true },
  })

  return NextResponse.json({
    strategies: strategies.map(s => ({
      name: s.name,
      current: s.exitConditions,
      whitepaper: WHITEPAPER_EXIT_CONDITIONS[s.name] || 'NOT DEFINED',
    })),
  })
}
