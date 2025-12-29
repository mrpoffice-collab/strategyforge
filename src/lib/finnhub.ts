import axios from 'axios'

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY
const BASE_URL = 'https://finnhub.io/api/v1'

interface StockQuote {
  c: number  // Current price
  d: number  // Change
  dp: number // Percent change
  h: number  // High
  l: number  // Low
  o: number  // Open
  pc: number // Previous close
  t: number  // Timestamp
}

interface StockCandle {
  c: number[]  // Close prices
  h: number[]  // High prices
  l: number[]  // Low prices
  o: number[]  // Open prices
  v: number[]  // Volumes
  t: number[]  // Timestamps
  s: string    // Status
}

interface CompanyProfile {
  ticker: string
  name: string
  exchange: string
  marketCapitalization: number
}

export async function getQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const response = await axios.get(`${BASE_URL}/quote`, {
      params: {
        symbol,
        token: FINNHUB_API_KEY,
      },
    })
    return response.data
  } catch (error) {
    console.error(`Error fetching quote for ${symbol}:`, error)
    return null
  }
}

export async function getCandles(
  symbol: string,
  resolution: '1' | '5' | '15' | '30' | '60' | 'D' | 'W' | 'M' = 'D',
  from: number,
  to: number
): Promise<StockCandle | null> {
  try {
    const response = await axios.get(`${BASE_URL}/stock/candle`, {
      params: {
        symbol,
        resolution,
        from,
        to,
        token: FINNHUB_API_KEY,
      },
    })
    return response.data
  } catch (error) {
    console.error(`Error fetching candles for ${symbol}:`, error)
    return null
  }
}

export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  try {
    const response = await axios.get(`${BASE_URL}/stock/profile2`, {
      params: {
        symbol,
        token: FINNHUB_API_KEY,
      },
    })
    return response.data
  } catch (error) {
    console.error(`Error fetching profile for ${symbol}:`, error)
    return null
  }
}

// Calculate RSI
export function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null

  let gains = 0
  let losses = 0

  // Calculate initial average gain and loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1]
    if (change >= 0) {
      gains += change
    } else {
      losses -= change
    }
  }

  let avgGain = gains / period
  let avgLoss = losses / period

  // Calculate subsequent values
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1]
    if (change >= 0) {
      avgGain = (avgGain * (period - 1) + change) / period
      avgLoss = (avgLoss * (period - 1)) / period
    } else {
      avgGain = (avgGain * (period - 1)) / period
      avgLoss = (avgLoss * (period - 1) - change) / period
    }
  }

  if (avgLoss === 0) return 100

  const rs = avgGain / avgLoss
  return 100 - (100 / (1 + rs))
}

// Calculate EMA
export function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return []

  const multiplier = 2 / (period + 1)
  const ema: number[] = []

  // First EMA is SMA
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += prices[i]
  }
  ema.push(sum / period)

  // Calculate subsequent EMAs
  for (let i = period; i < prices.length; i++) {
    ema.push((prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1])
  }

  return ema
}

// Calculate MACD
export function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } | null {
  if (prices.length < 26) return null

  const ema12 = calculateEMA(prices, 12)
  const ema26 = calculateEMA(prices, 26)

  if (ema12.length === 0 || ema26.length === 0) return null

  // MACD line is EMA12 - EMA26
  const macdLine: number[] = []
  const offset = ema12.length - ema26.length

  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i])
  }

  // Signal line is 9-period EMA of MACD
  const signalLine = calculateEMA(macdLine, 9)

  if (signalLine.length === 0) return null

  const macd = macdLine[macdLine.length - 1]
  const signal = signalLine[signalLine.length - 1]
  const histogram = macd - signal

  return { macd, signal, histogram }
}

// Calculate Bollinger Bands
export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number } | null {
  if (prices.length < period) return null

  const recentPrices = prices.slice(-period)
  const sma = recentPrices.reduce((a, b) => a + b, 0) / period

  const squaredDiffs = recentPrices.map((p) => Math.pow(p - sma, 2))
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period
  const standardDeviation = Math.sqrt(variance)

  return {
    upper: sma + stdDev * standardDeviation,
    middle: sma,
    lower: sma - stdDev * standardDeviation,
  }
}

// Calculate SMA
export function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null
  const recentPrices = prices.slice(-period)
  return recentPrices.reduce((a, b) => a + b, 0) / period
}

// List of eligible stock symbols to scan (NYSE/NASDAQ stocks $25-$100 range)
// This is a curated list of liquid mid-cap stocks
export const ELIGIBLE_SYMBOLS = [
  'AMD', 'PYPL', 'UBER', 'SNAP', 'SQ', 'ROKU', 'TWLO', 'NET', 'CRWD', 'DDOG',
  'ZS', 'OKTA', 'MDB', 'SNOW', 'PLTR', 'PATH', 'DOCN', 'CFLT', 'GTLB', 'BILL',
  'HUBS', 'WDAY', 'NOW', 'CRM', 'ADBE', 'PANW', 'FTNT', 'SPLK', 'ZM', 'DOCU',
  'PINS', 'ETSY', 'SHOP', 'SPOT', 'LYFT', 'ABNB', 'DASH', 'RBLX', 'HOOD', 'COIN',
  'AFRM', 'UPST', 'SOFI', 'LC', 'OPEN', 'CVNA', 'W', 'CHWY', 'PTON', 'RIVN',
  'LCID', 'NIO', 'XPEV', 'LI', 'FSR', 'PLUG', 'FCEL', 'BLNK', 'CHPT', 'EVGO',
  'F', 'GM', 'STLA', 'TSLA', 'RIVN', 'BA', 'UAL', 'DAL', 'LUV', 'AAL',
  'CCL', 'RCL', 'NCLH', 'MAR', 'HLT', 'MGM', 'LVS', 'WYNN', 'CZR', 'PENN',
  'DIS', 'NFLX', 'PARA', 'WBD', 'CMCSA', 'T', 'VZ', 'TMUS', 'CHTR', 'SIRI'
]

// Get multiple quotes in parallel with rate limiting
export async function getMultipleQuotes(
  symbols: string[],
  delayMs: number = 100
): Promise<Map<string, StockQuote>> {
  const quotes = new Map<string, StockQuote>()

  for (const symbol of symbols) {
    const quote = await getQuote(symbol)
    if (quote && quote.c > 0) {
      quotes.set(symbol, quote)
    }
    // Rate limit: Finnhub free tier allows 60 calls/minute
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return quotes
}

// Get eligible stocks in price range
export async function getEligibleStocks(
  minPrice: number = 25,
  maxPrice: number = 100,
  maxStocks: number = 50
): Promise<Array<{ symbol: string; price: number; change: number; changePercent: number }>> {
  const quotes = await getMultipleQuotes(ELIGIBLE_SYMBOLS.slice(0, maxStocks))
  const eligible: Array<{ symbol: string; price: number; change: number; changePercent: number }> = []

  quotes.forEach((quote, symbol) => {
    if (quote.c >= minPrice && quote.c <= maxPrice) {
      eligible.push({
        symbol,
        price: quote.c,
        change: quote.d,
        changePercent: quote.dp,
      })
    }
  })

  return eligible.sort((a, b) => b.changePercent - a.changePercent)
}
