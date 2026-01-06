import { Client } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || ''

// HYBRID STRATEGIES - Multiple indicators confirming signals
// UPDATED: Exit conditions now match original whitepaper specifications exactly
// Key changes: Removed arbitrary fixed % stops, implemented ATR-based and signal-based exits
const strategies = [
  {
    name: 'RSI-Stochastic Double Oversold',
    description: 'Hybrid momentum reversal per Connors methodology. Connors Chapter 6: "Stops Hurt" - no fixed stop loss. Exit on RSI recovery above 50 OR price closes above 5-day MA OR time exit. Mean reversion strategies need room to work.',
    whitepaperTitle: 'Short Term Trading Strategies That Work',
    whitepaperAuthor: 'Larry Connors & Cesar Alvarez',
    whitepaperYear: 2008,
    positionSize: 12,
    entryConditions: {
      indicators: [
        { type: 'RSI', period: 2, threshold: 10, comparison: 'less_than' }, // Connors uses 2-period RSI
        { type: 'STOCHASTIC', period: 14, threshold: 25, comparison: 'oversold' },
        { type: 'PRICE_VS_MA', period: 200, comparison: 'above' }, // Only trade uptrends
        { type: 'VOLUME', period: 20, multiplier: 1.0, comparison: 'greater_than' }
      ],
      priceRange: { min: 25, max: 100 }
    },
    exitConditions: {
      indicators: [
        { type: 'RSI', period: 2, threshold: 50, comparison: 'greater_than' }, // Exit when RSI recovers
        { type: 'PRICE_VS_MA', period: 5, comparison: 'closes_above' } // Or price above 5-day MA
      ],
      exitLogic: 'ANY', // Exit on ANY condition met (not all)
      profitTarget: null, // No fixed profit target per Connors
      stopLoss: null, // NO STOP LOSS per Connors "Stops Hurt"
      maxHoldDays: 10 // Time-based exit as fallback
    }
  },
  {
    name: 'ADX Trend + MA Pullback',
    description: 'Trend-following per Wilder. Uses ATR-based trailing stop (2x ATR) as specified in "New Concepts in Technical Trading Systems". Parabolic SAR methodology for trailing stops.',
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
        { type: 'ADX', period: 14, threshold: 20, comparison: 'less_than' }, // Trend weakening
        { type: 'ADX', comparison: 'bearish_di' } // DI crossover
      ],
      exitLogic: 'ANY',
      profitTarget: null, // Let winners run with trailing stop
      stopLoss: null, // Replaced with ATR trailing
      stopLossType: 'ATR_TRAILING',
      atrMultiplier: 2.0, // 2x ATR trailing stop per Wilder
      atrPeriod: 14,
      maxHoldDays: 30
    }
  },
  {
    name: 'Bollinger Squeeze Breakout',
    description: 'Per Bollinger: "There is nothing about a tag of a band that is a signal." Uses middle band as dynamic stop, not fixed %. Exit when price touches middle band (the 20-period MA).',
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
        { type: 'BOLLINGER', band: 'middle', comparison: 'price_below' } // Stop: price falls below middle band
      ],
      exitLogic: 'ANY',
      profitTarget: null, // Let price walk the upper band
      stopLoss: null, // Middle band IS the stop
      stopLossType: 'BOLLINGER_MIDDLE', // Dynamic stop at 20-period MA
      maxHoldDays: 20
    }
  },
  {
    name: 'RSI Divergence + MACD Confirm',
    description: 'Per Kirkpatrick: Uses ATR-based stop placement. Stop set at 2x ATR below entry to account for volatility. Professional risk management approach.',
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
        { type: 'RSI', period: 14, threshold: 70, comparison: 'greater_than' } // Overbought exit
      ],
      exitLogic: 'ANY',
      profitTarget: null,
      stopLoss: null,
      stopLossType: 'ATR_FIXED', // Fixed ATR-based stop (not trailing)
      atrMultiplier: 2.0, // 2x ATR from entry
      atrPeriod: 14,
      maxHoldDays: 15
    }
  },
  {
    name: 'MACD-BB-Volume Triple Filter',
    description: 'Per Appel: Exit when MACD declines below the trough that preceded the buy signal. Signal-based exit, not arbitrary percentage. Lets winners run while cutting losers on signal failure.',
    whitepaperTitle: 'Understanding MACD',
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
        { type: 'MACD', comparison: 'below_entry_trough' } // Appel's actual rule
      ],
      exitLogic: 'ANY',
      profitTarget: null, // Signal-based, not target-based
      stopLoss: null, // MACD signal IS the stop
      stopLossType: 'MACD_TROUGH', // Exit when MACD below prior trough
      maxHoldDays: 30
    }
  },
  {
    name: 'Stochastic-RSI Momentum Sync',
    description: 'Per Elder 2% Rule: Never risk more than 2% of account equity on single trade. Stop placed 1.5x ATR from entry. Position sized so max loss = 2% of account. Professional risk management.',
    whitepaperTitle: 'The New Trading for a Living',
    whitepaperAuthor: 'Dr. Alexander Elder',
    whitepaperYear: 2014,
    positionSize: 10, // Default 10%, but actual size calculated dynamically by 2% rule
    positionSizeType: 'ELDER_2_PERCENT', // Position size = 2% account risk / (ATR * multiplier)
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
      exitLogic: 'ANY',
      profitTarget: null,
      stopLoss: null,
      stopLossType: 'ATR_FIXED', // ATR-based per Elder
      atrMultiplier: 1.5, // Elder recommends at least 1 ATR, we use 1.5 for swing
      atrPeriod: 14,
      accountRiskPercent: 2.0, // The 2% Rule
      maxHoldDays: 12
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
