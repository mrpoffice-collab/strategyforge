import { Client } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || ''

const strategies = [
  {
    name: 'RSI Mean Reversion',
    description: 'Buys oversold stocks (RSI < 30) and sells when RSI normalizes above 50. Classic mean reversion strategy based on momentum oscillator.',
    whitepaperTitle: 'New Concepts in Technical Trading Systems',
    whitepaperAuthor: 'J. Welles Wilder',
    whitepaperYear: 1978,
    positionSize: 10,
    entryConditions: {
      indicators: [
        { type: 'RSI', period: 14, threshold: 30, comparison: 'less_than' },
        { type: 'VOLUME', period: 20, multiplier: 1.0, comparison: 'greater_than' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'RSI', period: 14, threshold: 50, comparison: 'greater_than' }
      ],
      profitTarget: 5.0,
      stopLoss: 3.0,
      maxHoldDays: null
    }
  },
  {
    name: 'MACD Momentum Crossover',
    description: 'Enters on bullish MACD crossover (MACD line crosses above signal line) when price is above 50-day MA. Trend-following momentum strategy.',
    whitepaperTitle: 'Technical Analysis of the Futures Markets',
    whitepaperAuthor: 'Gerald Appel',
    whitepaperYear: 1979,
    positionSize: 15,
    entryConditions: {
      indicators: [
        { type: 'MACD_CROSSOVER', direction: 'bullish' },
        { type: 'PRICE_VS_SMA', period: 50, comparison: 'above' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'MACD_CROSSOVER', direction: 'bearish' }
      ],
      profitTarget: 7.0,
      stopLoss: 4.0,
      maxHoldDays: null
    }
  },
  {
    name: 'Bollinger Band Breakout',
    description: 'Enters when price closes above upper Bollinger Band with volume spike. Momentum breakout strategy targeting strong moves.',
    whitepaperTitle: 'Bollinger on Bollinger Bands',
    whitepaperAuthor: 'John Bollinger',
    whitepaperYear: 2001,
    positionSize: 12,
    entryConditions: {
      indicators: [
        { type: 'BOLLINGER', band: 'upper', period: 20, stdDev: 2, comparison: 'price_above' },
        { type: 'VOLUME', period: 20, multiplier: 1.5, comparison: 'greater_than' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'BOLLINGER', band: 'middle', period: 20, stdDev: 2, comparison: 'price_touches' }
      ],
      profitTarget: 10.0,
      stopLoss: 5.0,
      maxHoldDays: null
    }
  },
  {
    name: 'Fibonacci Retracement Bounce',
    description: 'Enters when price bounces off 61.8% Fibonacci retracement level with bullish candlestick confirmation. Targets 1.618 extension.',
    whitepaperTitle: 'Fibonacci Analysis',
    whitepaperAuthor: 'Constance Brown',
    whitepaperYear: 2008,
    positionSize: 10,
    entryConditions: {
      indicators: [
        { type: 'FIBONACCI', level: 0.618, tolerance: 0.02, comparison: 'bounce' },
        { type: 'CANDLESTICK', pattern: 'bullish_reversal' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'FIBONACCI', level: 1.618, comparison: 'reaches_extension' }
      ],
      profitTarget: 8.0,
      stopLoss: 4.0,
      maxHoldDays: null
    }
  },
  {
    name: 'Golden Cross Momentum',
    description: 'Enters when 50-day MA crosses above 200-day MA (golden cross) with confirmed uptrend. Long-term swing position strategy.',
    whitepaperTitle: 'Technical Analysis of Stock Trends',
    whitepaperAuthor: 'Edwards & Magee',
    whitepaperYear: 1948,
    positionSize: 20,
    entryConditions: {
      indicators: [
        { type: 'MA_CROSSOVER', shortPeriod: 50, longPeriod: 200, direction: 'golden' },
        { type: 'TREND', direction: 'up', confirmation: 'higher_highs' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'MA_CROSSOVER', shortPeriod: 50, longPeriod: 200, direction: 'death' }
      ],
      profitTarget: 15.0,
      stopLoss: 6.0,
      maxHoldDays: 60
    }
  },
  {
    name: 'Volume Breakout Scanner',
    description: 'Enters when volume exceeds 200% of 30-day average and price breaks 52-week high. High-momentum breakout strategy.',
    whitepaperTitle: 'How to Make Money in Stocks',
    whitepaperAuthor: "William O'Neil",
    whitepaperYear: 1988,
    positionSize: 15,
    entryConditions: {
      indicators: [
        { type: 'VOLUME', period: 30, multiplier: 2.0, comparison: 'greater_than' },
        { type: 'PRICE_BREAKOUT', period: 252, comparison: '52_week_high' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'VOLUME', period: 30, multiplier: 1.0, comparison: 'less_than' }
      ],
      profitTarget: 12.0,
      stopLoss: 5.0,
      maxHoldDays: null
    }
  }
]

async function main() {
  console.log('Connecting to database...')

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })

  await client.connect()
  console.log('Connected! Seeding 6 trading strategies...')

  for (const strategy of strategies) {
    const id = `strat_${strategy.name.toLowerCase().replace(/\s+/g, '_')}`

    await client.query(`
      INSERT INTO "Strategy" (
        id, name, description, "whitepaperTitle", "whitepaperAuthor", "whitepaperYear",
        "entryConditions", "exitConditions", "positionSize", status, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW(), NOW()
      )
      ON CONFLICT (name) DO UPDATE SET
        description = EXCLUDED.description,
        "whitepaperTitle" = EXCLUDED."whitepaperTitle",
        "whitepaperAuthor" = EXCLUDED."whitepaperAuthor",
        "whitepaperYear" = EXCLUDED."whitepaperYear",
        "entryConditions" = EXCLUDED."entryConditions",
        "exitConditions" = EXCLUDED."exitConditions",
        "positionSize" = EXCLUDED."positionSize",
        "updatedAt" = NOW()
    `, [
      id,
      strategy.name,
      strategy.description,
      strategy.whitepaperTitle,
      strategy.whitepaperAuthor,
      strategy.whitepaperYear,
      JSON.stringify(strategy.entryConditions),
      JSON.stringify(strategy.exitConditions),
      strategy.positionSize
    ])

    console.log(`Created strategy: ${strategy.name}`)
  }

  await client.end()
  console.log('Seeding complete!')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
