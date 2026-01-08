/**
 * Generates educational explanations for trading strategy rules
 * Written for 9th grade comprehension - explains what things mean and why they matter
 */

interface Indicator {
  type: string
  period?: number
  overbought?: number
  oversold?: number
  threshold?: number
  comparison?: string
  multiplier?: number
  min?: number
  max?: number
  band?: string
  direction?: string
  [key: string]: unknown
}

interface EntryConditions {
  indicators: Indicator[]
  priceRange?: { min: number; max: number }
}

interface ExitConditions {
  indicators: Indicator[]
  profitTarget?: number | null
  stopLoss?: number | null
  stopLossType?: string
  atrMultiplier?: number
  atrPeriod?: number
  maxHoldDays?: number
  exitLogic?: string
  accountRiskPercent?: number
}

interface WhitepaperInfo {
  title: string | null
  author: string | null
  year: number | null
}

export function explainEntry(conditions: EntryConditions, whitepaper: WhitepaperInfo): string[] {
  const explanations: string[] = []
  const author = whitepaper.author?.split(' ').pop() || 'The research'

  for (const ind of conditions.indicators) {
    const type = ind.type?.toUpperCase() || ''

    switch (type) {
      case 'RSI':
        if (ind.comparison === 'less_than' || ind.threshold) {
          const period = ind.period || 14
          const threshold = ind.threshold || 30
          if (period <= 2) {
            explanations.push(
              `**RSI(${period}) drops below ${threshold}** — This measures how much the stock fell in the last ${period} days. ` +
              `When it's this low, the stock dropped fast and hard. ${author} found these extreme drops often snap back up within days.`
            )
          } else {
            explanations.push(
              `**RSI below ${threshold}** — RSI measures if a stock has been falling too much, too fast. ` +
              `Below ${threshold} means it's "oversold" - like a rubber band stretched too far down. ${author} waits for this signal because oversold stocks often bounce back.`
            )
          }
        } else if (ind.comparison === 'between') {
          explanations.push(
            `**RSI between ${ind.min}-${ind.max}** — We want stocks that aren't too hot or too cold. ` +
            `This middle zone means the stock has room to move up without being overbought.`
          )
        }
        break

      case 'STOCHASTIC':
        if (ind.comparison === 'bullish_cross') {
          explanations.push(
            `**Stochastic crossover** — This shows when buyers are starting to take control from sellers. ` +
            `It's like watching the momentum shift in a tug-of-war - when the fast line crosses above the slow line, buyers are winning.`
          )
        } else if (ind.comparison === 'oversold') {
          explanations.push(
            `**Stochastic below ${ind.threshold || 20}** — This compares today's price to the range of prices over the past few weeks. ` +
            `A low reading means the stock is trading near its recent lows - potentially a good time to buy if we expect a bounce.`
          )
        }
        break

      case 'PRICE_VS_MA':
        if (ind.comparison === 'above') {
          explanations.push(
            `**Price above the ${ind.period}-day average** — We only buy stocks that are in an uptrend. ` +
            `If the price is above its ${ind.period}-day average, the overall direction is up. ${author} says: don't fight the trend.`
          )
        } else if (ind.comparison === 'pullback_to') {
          explanations.push(
            `**Price pulls back to ${ind.period}-day average** — Even in uptrends, stocks don't go straight up. ` +
            `They dip and recover. We buy when the stock "takes a breather" at its moving average - like catching a sale during an uptrend.`
          )
        }
        break

      case 'ADX':
        if (ind.comparison === 'strong_trend') {
          explanations.push(
            `**ADX above ${ind.threshold || 25}** — ADX measures trend strength (not direction). ` +
            `Above ${ind.threshold || 25} means there's a strong trend happening. ${author} only trades when trends are strong because weak trends are unpredictable.`
          )
        } else if (ind.comparison === 'bullish_di') {
          explanations.push(
            `**+DI above -DI** — This confirms buyers are in control. +DI measures buying pressure, -DI measures selling pressure. ` +
            `When +DI is higher, more people are buying than selling.`
          )
        }
        break

      case 'MA_ALIGNMENT':
        if (ind.direction === 'bullish') {
          explanations.push(
            `**Moving averages aligned up** — Short-term average is above long-term average. ` +
            `This is like checking that a car is moving forward, not backward. All timeframes agree: the trend is up.`
          )
        }
        break

      case 'MACD':
        if (ind.comparison === 'positive') {
          explanations.push(
            `**MACD is positive** — MACD shows if a stock is gaining or losing momentum. ` +
            `Positive means momentum is building upward - like a ball that's still rising, not falling yet.`
          )
        }
        break

      case 'BOLLINGER':
      case 'BB_WIDTH':
        if (ind.comparison === 'squeeze' || type === 'BB_WIDTH') {
          explanations.push(
            `**Bollinger Bands are tight** — The bands measure how much a stock is moving around. ` +
            `When they squeeze together, the stock has been calm. ${author} found that calm periods are often followed by big moves - we want to catch the breakout.`
          )
        } else if (ind.comparison === 'price_above' && ind.band === 'upper') {
          explanations.push(
            `**Price breaks above upper band** — The upper band shows where "expensive" is for this stock. ` +
            `Breaking above it means buyers are so eager they're paying premium prices - a sign of strong demand.`
          )
        } else if (ind.comparison === 'near_lower') {
          explanations.push(
            `**Price near lower band** — The lower band shows where "cheap" is for this stock. ` +
            `${author} buys here expecting the price to return to normal (the middle band).`
          )
        } else if (ind.comparison === 'above_middle') {
          explanations.push(
            `**Price above middle band** — The middle band is the 20-day average. ` +
            `Being above it confirms the short-term trend is up.`
          )
        }
        break

      case 'ROC':
        explanations.push(
          `**Rate of Change above ${ind.threshold}%** — This measures how fast the price is rising. ` +
          `We want stocks with momentum behind them, not ones that are barely moving.`
        )
        break

      case 'RSI_DIVERGENCE':
        explanations.push(
          `**Bullish divergence** — The stock made a lower low, but RSI made a higher low. ` +
          `This disconnect often signals the selling is exhausted. ${author} sees this as an early warning that the downtrend may reverse.`
        )
        break

      case 'VOLUME':
        if (ind.multiplier && ind.multiplier > 1) {
          explanations.push(
            `**Volume ${ind.multiplier}x higher than normal** — Volume is how many shares are being traded. ` +
            `High volume means big institutions are involved. ${author} wants to trade alongside the big money, not against it.`
          )
        } else {
          explanations.push(
            `**Volume above average** — We need enough trading activity to easily buy and sell. ` +
            `Low-volume stocks can trap you - hard to exit when you want to.`
          )
        }
        break
    }
  }

  if (conditions.priceRange) {
    explanations.push(
      `**Price between $${conditions.priceRange.min}-$${conditions.priceRange.max}** — Not too cheap (penny stocks are risky), not too expensive (limits how many shares we can buy). ` +
      `This sweet spot lets us take meaningful positions with our capital.`
    )
  }

  return explanations
}

export function explainExit(conditions: ExitConditions, whitepaper: WhitepaperInfo): string[] {
  const explanations: string[] = []
  const author = whitepaper.author?.split(' ').pop() || 'The research'

  // Handle whitepaper-specific stop loss types
  if (conditions.stopLossType) {
    switch (conditions.stopLossType) {
      case 'ATR_TRAILING':
        explanations.push(
          `**Trailing stop using ATR** — ATR measures how much a stock typically moves each day. ` +
          `Our stop is set ${conditions.atrMultiplier || 2}x that distance below the highest price reached. ` +
          `As the stock rises, our stop rises too - locking in gains while giving the stock room to breathe. ${author}'s method for "letting winners run."`
        )
        break
      case 'ATR_FIXED':
        explanations.push(
          `**Stop set at ${conditions.atrMultiplier || 2}x ATR below entry** — Instead of a fixed percentage, we use the stock's actual volatility. ` +
          `A jumpy stock gets a wider stop; a calm stock gets a tighter one. ${author}'s way of adapting to each stock's personality.`
        )
        break
      case 'BOLLINGER_MIDDLE':
        explanations.push(
          `**Exit when price drops to middle band** — The middle Bollinger Band is the 20-day average. ` +
          `${author} says if the price falls back to this level, the breakout failed and we should exit. The band itself is our stop - it moves with the stock.`
        )
        break
      case 'MACD_TROUGH':
        explanations.push(
          `**Exit when MACD falls below its prior low** — Before we bought, MACD was at a certain low point. ` +
          `If it drops back below that level, the momentum that triggered our buy has completely reversed. ${author} calls this a failed signal.`
        )
        break
    }
  }

  // Handle indicator-based exits
  for (const ind of conditions.indicators) {
    const type = ind.type?.toUpperCase() || ''

    switch (type) {
      case 'RSI':
        if (ind.comparison === 'greater_than' && (ind.threshold || 0) >= 50) {
          if ((ind.threshold || 0) >= 70) {
            explanations.push(
              `**Sell when RSI goes above ${ind.threshold}** — High RSI means the stock has risen fast. ` +
              `Above ${ind.threshold} it's "overbought" - stretched too far up. Time to take profits before gravity pulls it back.`
            )
          } else {
            explanations.push(
              `**Sell when RSI recovers above ${ind.threshold}** — We bought when RSI was super low (oversold). ` +
              `Once it bounces back above ${ind.threshold}, we've captured the mean reversion. ${author} says take the win.`
            )
          }
        }
        break
      case 'PRICE_VS_MA':
        if (ind.comparison === 'closes_above') {
          explanations.push(
            `**Sell when price closes above ${ind.period}-day average** — For mean reversion trades, "normal" is the target. ` +
            `The ${ind.period}-day average IS normal. Once price returns there, our trade worked - time to exit.`
          )
        }
        break
      case 'ADX':
        if (ind.comparison === 'less_than') {
          explanations.push(
            `**Exit when ADX drops below ${ind.threshold}** — ADX falling means the trend is weakening. ` +
            `${author} doesn't hold positions in weak trends - they're unpredictable and can reverse without warning.`
          )
        } else if (ind.comparison === 'bearish_di') {
          explanations.push(
            `**Exit when -DI crosses above +DI** — Sellers are now stronger than buyers. ` +
            `The power has shifted. Time to leave before the selling accelerates.`
          )
        }
        break
      case 'STOCHASTIC':
        if (ind.comparison === 'overbought') {
          explanations.push(
            `**Exit when Stochastic goes above ${ind.threshold || 80}** — The stock is now trading near its recent highs. ` +
            `It's stretched up like a rubber band. We take profits expecting it to pull back.`
          )
        }
        break
    }
  }

  // Only show fixed targets if they're actually set
  if (conditions.profitTarget && conditions.profitTarget > 0) {
    explanations.push(
      `**Take profit at +${conditions.profitTarget}%** — When we're up this much, we sell. ` +
      `It's tempting to hold for more, but ${author} says lock in the win. Greed turns winners into losers.`
    )
  }

  if (conditions.stopLoss && conditions.stopLoss > 0) {
    explanations.push(
      `**Stop loss at -${conditions.stopLoss}%** — If we're down this much, we're wrong. Sell. ` +
      `Losing ${conditions.stopLoss}% is painful but survivable. Hoping and holding can lead to losing 50%+ - account-killing losses.`
    )
  }

  // Note about no fixed stop
  if (!conditions.stopLoss && !conditions.stopLossType && conditions.indicators.length > 0) {
    explanations.push(
      `**No fixed stop loss** — ${author} found that fixed percentage stops hurt performance on this strategy. ` +
      `Instead, we exit based on signals. The trade thesis is either working or it's not - price action tells us.`
    )
  }

  // Time-based exit
  if (conditions.maxHoldDays) {
    explanations.push(
      `**Maximum hold: ${conditions.maxHoldDays} days** — If none of our exit signals trigger by day ${conditions.maxHoldDays}, we exit anyway. ` +
      `Money sitting in a trade that isn't working could be used elsewhere.`
    )
  }

  // Elder's 2% rule
  if (conditions.accountRiskPercent) {
    explanations.push(
      `**${conditions.accountRiskPercent}% account risk rule** — We size each position so that if our stop is hit, we lose only ${conditions.accountRiskPercent}% of our total account. ` +
      `Even 10 losing trades in a row only costs 20%. This keeps us in the game.`
    )
  }

  // Exit logic
  if (conditions.exitLogic === 'ANY' && explanations.length > 1) {
    explanations.push(
      `**First exit signal wins** — We don't wait for all conditions. Whichever happens first triggers our exit. ` +
      `In trading, fast exits preserve capital.`
    )
  }

  return explanations
}

export function explainStrategy(
  entry: EntryConditions,
  exit: ExitConditions,
  strategyName: string,
  whitepaper?: WhitepaperInfo
): { entryExplanations: string[]; exitExplanations: string[] } {
  const wp = whitepaper || { title: null, author: null, year: null }

  const entryExplanations = explainEntry(entry, wp)
  const exitExplanations = explainExit(exit, wp)

  return {
    entryExplanations,
    exitExplanations
  }
}
