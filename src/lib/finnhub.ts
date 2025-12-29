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

interface StockSymbol {
  symbol: string
  description: string
  type: string
  displaySymbol: string
}

// Fetch ALL US stock symbols from Finnhub
export async function getAllUSSymbols(): Promise<StockSymbol[]> {
  try {
    const response = await axios.get(`${BASE_URL}/stock/symbol`, {
      params: {
        exchange: 'US',
        token: FINNHUB_API_KEY,
      },
    })
    // Filter to common stocks only (no ETFs, warrants, etc.)
    return response.data.filter((s: StockSymbol) =>
      s.type === 'Common Stock' &&
      !s.symbol.includes('.') &&  // No preferred shares
      !s.symbol.includes('-')     // No special classes
    )
  } catch (error) {
    console.error('Error fetching US symbols:', error)
    return []
  }
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

// Fallback list of known liquid stocks typically in $25-100 range
const KNOWN_LIQUID_STOCKS = [
  // Tech
  'AMD', 'INTC', 'MU', 'QCOM', 'AMAT', 'LRCX', 'MRVL', 'ON', 'SWKS', 'QRVO',
  'PYPL', 'SQ', 'AFRM', 'SOFI', 'UPST', 'LC', 'HOOD', 'COIN',
  'UBER', 'LYFT', 'DASH', 'ABNB', 'RBLX', 'SNAP', 'PINS', 'MTCH',
  'NET', 'CRWD', 'ZS', 'OKTA', 'DDOG', 'MDB', 'ESTC', 'GTLB',
  // Consumer
  'NKE', 'LULU', 'UAA', 'DECK', 'SKX', 'CROX',
  'SBUX', 'CMG', 'DPZ', 'YUM', 'QSR', 'WING',
  'TGT', 'COST', 'WMT', 'DG', 'DLTR', 'FIVE',
  // Industrial
  'F', 'GM', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI',
  'BA', 'LMT', 'RTX', 'NOC', 'GD',
  'CAT', 'DE', 'CNH', 'AGCO',
  // Healthcare
  'PFE', 'MRK', 'BMY', 'ABBV', 'GILD', 'BIIB', 'REGN', 'VRTX',
  'CVS', 'WBA', 'CI', 'HUM', 'UNH',
  // Energy
  'XOM', 'CVX', 'COP', 'EOG', 'PXD', 'DVN', 'OXY',
  // Financial
  'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW',
  // Media/Telecom
  'DIS', 'NFLX', 'WBD', 'PARA', 'FOX',
  'T', 'VZ', 'TMUS',
  // Travel
  'UAL', 'DAL', 'LUV', 'AAL', 'JBLU',
  'MAR', 'HLT', 'H', 'WH',
  'CCL', 'RCL', 'NCLH'
]

// Cache for all US symbols (refreshed periodically)
let cachedSymbols: string[] = []
let symbolsCacheTime = 0
const SYMBOLS_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

// Get all tradeable symbols (cached, with fallback)
export async function getTradeableSymbols(): Promise<string[]> {
  const now = Date.now()

  // Return cached if still valid
  if (cachedSymbols.length > 0 && (now - symbolsCacheTime) < SYMBOLS_CACHE_TTL) {
    return cachedSymbols
  }

  // Try to fetch fresh list, but use fallback if it fails
  try {
    const allSymbols = await getAllUSSymbols()
    if (allSymbols.length > 100) {
      // Combine API results with known liquid stocks for better coverage
      const apiSymbols = allSymbols.map(s => s.symbol)
      cachedSymbols = [...new Set([...KNOWN_LIQUID_STOCKS, ...apiSymbols])]
      symbolsCacheTime = now
      console.log(`Loaded ${cachedSymbols.length} symbols (${KNOWN_LIQUID_STOCKS.length} known + ${apiSymbols.length} from API)`)
      return cachedSymbols
    }
  } catch (error) {
    console.error('Failed to fetch US symbols, using fallback list:', error)
  }

  // Use fallback list
  cachedSymbols = KNOWN_LIQUID_STOCKS
  symbolsCacheTime = now
  console.log(`Using fallback list of ${cachedSymbols.length} known liquid stocks`)
  return cachedSymbols
}

// Get multiple quotes with rate limiting (1 per second = 60/min)
export async function getMultipleQuotes(
  symbols: string[],
  delayMs: number = 1000 // 1 second between calls = 60/min rate limit
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

// Scan stocks in batches and find eligible ones
export async function scanForEligibleStocks(
  minPrice: number = 25,
  maxPrice: number = 100,
  batchSize: number = 50,
  startIndex: number = 0
): Promise<{
  eligible: Array<{ symbol: string; price: number; change: number; changePercent: number }>
  nextIndex: number
  totalSymbols: number
  scanned: number
}> {
  const allSymbols = await getTradeableSymbols()
  const batch = allSymbols.slice(startIndex, startIndex + batchSize)

  const eligible: Array<{ symbol: string; price: number; change: number; changePercent: number }> = []

  for (const symbol of batch) {
    const quote = await getQuote(symbol)
    if (quote && quote.c >= minPrice && quote.c <= maxPrice) {
      eligible.push({
        symbol,
        price: quote.c,
        change: quote.d || 0,
        changePercent: quote.dp || 0,
      })
    }
    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  const nextIndex = startIndex + batchSize >= allSymbols.length ? 0 : startIndex + batchSize

  return {
    eligible: eligible.sort((a, b) => b.changePercent - a.changePercent),
    nextIndex,
    totalSymbols: allSymbols.length,
    scanned: batch.length,
  }
}

// Quick scan of random sample for faster results
export async function quickScanEligibleStocks(
  minPrice: number = 25,
  maxPrice: number = 100,
  sampleSize: number = 100
): Promise<Array<{ symbol: string; price: number; change: number; changePercent: number }>> {
  const allSymbols = await getTradeableSymbols()

  // Random sample
  const shuffled = [...allSymbols].sort(() => Math.random() - 0.5)
  const sample = shuffled.slice(0, sampleSize)

  const eligible: Array<{ symbol: string; price: number; change: number; changePercent: number }> = []

  for (const symbol of sample) {
    const quote = await getQuote(symbol)
    if (quote && quote.c >= minPrice && quote.c <= maxPrice) {
      eligible.push({
        symbol,
        price: quote.c,
        change: quote.d || 0,
        changePercent: quote.dp || 0,
      })
    }
    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  return eligible.sort((a, b) => b.changePercent - a.changePercent)
}
