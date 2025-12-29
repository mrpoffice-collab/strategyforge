import { Client } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || ''

// HYBRID STRATEGIES - Multiple indicators confirming signals
// Based on academic research showing multi-factor approaches outperform single indicators
const strategies = [
  {
    name: 'RSI-Stochastic Double Oversold',
    description: 'Hybrid momentum reversal: Enters when BOTH RSI and Stochastic indicate oversold AND MACD histogram turns positive. Triple confirmation reduces false signals. Based on Connors RSI research and multi-oscillator studies.',
    whitepaperTitle: 'Short Term Trading Strategies That Work',
    whitepaperAuthor: 'Larry Connors & Cesar Alvarez',
    whitepaperYear: 2008,
    positionSize: 12,
    entryConditions: {
      indicators: [
        { type: 'RSI', period: 14, threshold: 35, comparison: 'less_than' },
        { type: 'STOCHASTIC', period: 14, threshold: 25, comparison: 'oversold' },
        { type: 'MACD', comparison: 'positive' },
        { type: 'VOLUME', period: 20, multiplier: 1.0, comparison: 'greater_than' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'RSI', period: 14, threshold: 60, comparison: 'greater_than' }
      ],
      profitTarget: 6.0,
      stopLoss: 3.5,
      maxHoldDays: 15
    }
  },
  {
    name: 'ADX Trend + MA Pullback',
    description: 'Trend-following hybrid: Requires strong trend (ADX > 25) with bullish MA alignment (10 > 20 > 50), then enters on pullback to 20-day MA. Combines trend strength with optimal entry timing.',
    whitepaperTitle: 'New Concepts in Technical Trading Systems',
    whitepaperAuthor: 'J. Welles Wilder',
    whitepaperYear: 1978,
    positionSize: 15,
    entryConditions: {
      indicators: [
        { type: 'ADX', period: 14, threshold: 25, comparison: 'strong_trend' },
        { type: 'ADX', comparison: 'bullish_di' },
        { type: 'MA_ALIGNMENT', direction: 'bullish' },
        { type: 'PRICE_VS_MA', period: 20, comparison: 'pullback_to' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'MA_ALIGNMENT', direction: 'neutral' }
      ],
      profitTarget: 8.0,
      stopLoss: 4.0,
      maxHoldDays: 20
    }
  },
  {
    name: 'Bollinger Squeeze Breakout',
    description: 'Volatility expansion hybrid: Waits for Bollinger Band squeeze (low volatility), then enters on volume-confirmed breakout above upper band with positive momentum (ROC). Captures the start of big moves.',
    whitepaperTitle: 'Bollinger on Bollinger Bands',
    whitepaperAuthor: 'John Bollinger',
    whitepaperYear: 2001,
    positionSize: 10,
    entryConditions: {
      indicators: [
        { type: 'BB_WIDTH', threshold: 8, comparison: 'squeeze' },
        { type: 'BOLLINGER', band: 'upper', comparison: 'price_above' },
        { type: 'ROC', period: 12, threshold: 2, comparison: 'greater_than' },
        { type: 'VOLUME', period: 20, multiplier: 1.5, comparison: 'greater_than' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'BOLLINGER', band: 'middle', comparison: 'price_touches' }
      ],
      profitTarget: 10.0,
      stopLoss: 5.0,
      maxHoldDays: 15
    }
  },
  {
    name: 'RSI Divergence + MACD Confirm',
    description: 'Divergence-based hybrid: Detects bullish RSI divergence (price lower low, RSI higher low), confirms with MACD turning positive, and requires price near lower Bollinger Band. High-probability reversal setups.',
    whitepaperTitle: 'Technical Analysis: The Complete Resource',
    whitepaperAuthor: 'Charles Kirkpatrick & Julie Dahlquist',
    whitepaperYear: 2010,
    positionSize: 10,
    entryConditions: {
      indicators: [
        { type: 'RSI_DIVERGENCE', direction: 'bullish' },
        { type: 'MACD', comparison: 'positive' },
        { type: 'BOLLINGER', comparison: 'near_lower' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'RSI', period: 14, threshold: 65, comparison: 'greater_than' }
      ],
      profitTarget: 7.0,
      stopLoss: 3.5,
      maxHoldDays: 12
    }
  },
  {
    name: 'MACD-BB-Volume Triple Filter',
    description: 'Conservative momentum hybrid: Requires ALL three filters - MACD histogram positive, price above middle BB (bullish territory), RSI in healthy range (40-70), AND volume confirmation. Reduces whipsaws in choppy markets.',
    whitepaperTitle: 'Technical Analysis of the Futures Markets',
    whitepaperAuthor: 'Gerald Appel',
    whitepaperYear: 1979,
    positionSize: 15,
    entryConditions: {
      indicators: [
        { type: 'MACD', comparison: 'positive' },
        { type: 'BOLLINGER', comparison: 'above_middle' },
        { type: 'RSI', period: 14, comparison: 'between', min: 40, max: 70 },
        { type: 'VOLUME', period: 20, multiplier: 1.3, comparison: 'greater_than' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'MACD', direction: 'bearish' }
      ],
      profitTarget: 8.0,
      stopLoss: 4.0,
      maxHoldDays: 25
    }
  },
  {
    name: 'Stochastic-RSI Momentum Sync',
    description: 'Dual oscillator sync: Enters when both Stochastic crosses above %D AND RSI is between 30-50 (recovering from oversold), with price above 50-day MA (uptrend filter). Catches momentum at early stage.',
    whitepaperTitle: 'The New Trading for a Living',
    whitepaperAuthor: 'Dr. Alexander Elder',
    whitepaperYear: 2014,
    positionSize: 12,
    entryConditions: {
      indicators: [
        { type: 'STOCHASTIC', comparison: 'bullish_cross' },
        { type: 'RSI', period: 14, comparison: 'between', min: 30, max: 50 },
        { type: 'PRICE_VS_MA', period: 50, comparison: 'above' },
        { type: 'VOLUME', period: 20, multiplier: 1.0, comparison: 'greater_than' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'STOCHASTIC', threshold: 80, comparison: 'overbought' }
      ],
      profitTarget: 6.0,
      stopLoss: 3.0,
      maxHoldDays: 10
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
  console.log('Connected! Seeding 6 HYBRID trading strategies...')

  for (const strategy of strategies) {
    const id = `strat_${strategy.name.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')}`

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
    console.log(`  Conditions: ${strategy.entryConditions.indicators.length} entry indicators`)
  }

  await client.end()
  console.log('\nSeeding complete! Hybrid strategies deployed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
