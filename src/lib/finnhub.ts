import axios from 'axios'
import YahooFinance from 'yahoo-finance2'

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY
const BASE_URL = 'https://finnhub.io/api/v1'

// Initialize Yahoo Finance (required for v3+)
const yahooFinance = new YahooFinance()

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

// Yahoo historical data type
interface YahooHistoricalRow {
  date: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
  adjClose?: number
}

// In-memory cache for candles (survives within same serverless invocation)
const candleCache = new Map<string, { data: StockCandle; timestamp: number }>()
const CANDLE_CACHE_TTL = 60 * 60 * 1000 // 1 hour cache

// Use Yahoo Finance for historical candles with retry logic
export async function getCandles(
  symbol: string,
  resolution: '1' | '5' | '15' | '30' | '60' | 'D' | 'W' | 'M' = 'D',
  from: number,
  to: number
): Promise<StockCandle | null> {
  // Check cache first
  const cacheKey = `${symbol}-${resolution}`
  const cached = candleCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CANDLE_CACHE_TTL) {
    return cached.data
  }

  const maxRetries = 3
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add delay between retries (exponential backoff)
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
      }

      const fromDate = new Date(from * 1000)
      const toDate = new Date(to * 1000)

      const result = await yahooFinance.historical(symbol, {
        period1: fromDate,
        period2: toDate,
        interval: '1d',
      }) as YahooHistoricalRow[]

      if (!result || result.length === 0) {
        console.log(`No Yahoo data for ${symbol}`)
        return null
      }

      const validData = result.filter(q => q.close !== null && q.close !== undefined)

      const candles: StockCandle = {
        c: validData.map(q => q.close),
        h: validData.map(q => q.high),
        l: validData.map(q => q.low),
        o: validData.map(q => q.open),
        v: validData.map(q => q.volume),
        t: validData.map(q => Math.floor(new Date(q.date).getTime() / 1000)),
        s: 'ok',
      }

      // Cache successful result
      candleCache.set(cacheKey, { data: candles, timestamp: Date.now() })
      return candles
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      // Check if rate limited
      if (lastError.message.includes('Too Many Requests') || lastError.message.includes('429')) {
        console.log(`Yahoo rate limited for ${symbol}, attempt ${attempt + 1}/${maxRetries}`)
        continue
      }
      break // Don't retry non-rate-limit errors
    }
  }

  console.error(`Error fetching Yahoo candles for ${symbol}:`, lastError?.message)
  return null
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

// Calculate ATR (Average True Range) - volatility measure
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number | null {
  if (highs.length < period + 1) return null

  const trueRanges: number[] = []
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    )
    trueRanges.push(tr)
  }

  // First ATR is simple average
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period

  // Smooth subsequent ATRs
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period
  }

  return atr
}

// Calculate Stochastic Oscillator (%K and %D)
export function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: number; d: number } | null {
  if (closes.length < kPeriod + dPeriod) return null

  const kValues: number[] = []

  for (let i = kPeriod - 1; i < closes.length; i++) {
    const periodHighs = highs.slice(i - kPeriod + 1, i + 1)
    const periodLows = lows.slice(i - kPeriod + 1, i + 1)
    const highestHigh = Math.max(...periodHighs)
    const lowestLow = Math.min(...periodLows)
    const k = highestHigh === lowestLow ? 50 : ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100
    kValues.push(k)
  }

  // %D is SMA of %K
  const recentK = kValues.slice(-dPeriod)
  const d = recentK.reduce((a, b) => a + b, 0) / dPeriod

  return { k: kValues[kValues.length - 1], d }
}

// Calculate ADX (Average Directional Index) - trend strength
export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): { adx: number; plusDI: number; minusDI: number } | null {
  if (highs.length < period * 2) return null

  const plusDMs: number[] = []
  const minusDMs: number[] = []
  const trueRanges: number[] = []

  for (let i = 1; i < highs.length; i++) {
    const plusDM = Math.max(highs[i] - highs[i - 1], 0)
    const minusDM = Math.max(lows[i - 1] - lows[i], 0)

    if (plusDM > minusDM) {
      plusDMs.push(plusDM)
      minusDMs.push(0)
    } else if (minusDM > plusDM) {
      plusDMs.push(0)
      minusDMs.push(minusDM)
    } else {
      plusDMs.push(0)
      minusDMs.push(0)
    }

    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    )
    trueRanges.push(tr)
  }

  // Smoothed values
  let smoothedPlusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothedMinusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0)
  let smoothedTR = trueRanges.slice(0, period).reduce((a, b) => a + b, 0)

  for (let i = period; i < plusDMs.length; i++) {
    smoothedPlusDM = smoothedPlusDM - smoothedPlusDM / period + plusDMs[i]
    smoothedMinusDM = smoothedMinusDM - smoothedMinusDM / period + minusDMs[i]
    smoothedTR = smoothedTR - smoothedTR / period + trueRanges[i]
  }

  const plusDI = smoothedTR === 0 ? 0 : (smoothedPlusDM / smoothedTR) * 100
  const minusDI = smoothedTR === 0 ? 0 : (smoothedMinusDM / smoothedTR) * 100

  // Calculate DX and ADX
  const diSum = plusDI + minusDI
  const dx = diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100

  // For simplicity, return current DX as ADX estimate
  // (Full ADX would need smoothing over more periods)
  return { adx: dx, plusDI, minusDI }
}

// Calculate Bollinger Band Width (volatility squeeze indicator)
export function calculateBBWidth(
  prices: number[],
  period: number = 20,
  stdDev: number = 2
): number | null {
  const bands = calculateBollingerBands(prices, period, stdDev)
  if (!bands) return null
  return ((bands.upper - bands.lower) / bands.middle) * 100
}

// Detect RSI Divergence (bullish or bearish)
export function detectRSIDivergence(
  prices: number[],
  period: number = 14,
  lookback: number = 10
): 'bullish' | 'bearish' | null {
  if (prices.length < period + lookback) return null

  const rsiValues: number[] = []
  for (let i = period; i <= prices.length; i++) {
    const slice = prices.slice(i - period - 1, i)
    const rsi = calculateRSI(slice, period)
    if (rsi !== null) rsiValues.push(rsi)
  }

  if (rsiValues.length < lookback) return null

  const recentPrices = prices.slice(-lookback)
  const recentRSI = rsiValues.slice(-lookback)

  // Find lowest/highest points
  const priceMin1 = Math.min(...recentPrices.slice(0, Math.floor(lookback / 2)))
  const priceMin2 = Math.min(...recentPrices.slice(Math.floor(lookback / 2)))
  const rsiMin1 = Math.min(...recentRSI.slice(0, Math.floor(lookback / 2)))
  const rsiMin2 = Math.min(...recentRSI.slice(Math.floor(lookback / 2)))

  // Bullish divergence: price makes lower low, RSI makes higher low
  if (priceMin2 < priceMin1 && rsiMin2 > rsiMin1) {
    return 'bullish'
  }

  const priceMax1 = Math.max(...recentPrices.slice(0, Math.floor(lookback / 2)))
  const priceMax2 = Math.max(...recentPrices.slice(Math.floor(lookback / 2)))
  const rsiMax1 = Math.max(...recentRSI.slice(0, Math.floor(lookback / 2)))
  const rsiMax2 = Math.max(...recentRSI.slice(Math.floor(lookback / 2)))

  // Bearish divergence: price makes higher high, RSI makes lower high
  if (priceMax2 > priceMax1 && rsiMax2 < rsiMax1) {
    return 'bearish'
  }

  return null
}

// Calculate Rate of Change (ROC) - momentum indicator
export function calculateROC(prices: number[], period: number = 12): number | null {
  if (prices.length < period + 1) return null
  const currentPrice = prices[prices.length - 1]
  const pastPrice = prices[prices.length - 1 - period]
  return ((currentPrice - pastPrice) / pastPrice) * 100
}

// Detect MA Trend Alignment (all MAs stacked in order)
export function detectMAAlignment(
  prices: number[],
  shortPeriod: number = 10,
  mediumPeriod: number = 20,
  longPeriod: number = 50
): 'bullish' | 'bearish' | 'neutral' {
  const shortMA = calculateSMA(prices, shortPeriod)
  const mediumMA = calculateSMA(prices, mediumPeriod)
  const longMA = calculateSMA(prices, longPeriod)

  if (!shortMA || !mediumMA || !longMA) return 'neutral'

  // Bullish alignment: short > medium > long
  if (shortMA > mediumMA && mediumMA > longMA) return 'bullish'

  // Bearish alignment: short < medium < long
  if (shortMA < mediumMA && mediumMA < longMA) return 'bearish'

  return 'neutral'
}

// Expanded list of liquid US stocks - comprehensive coverage
const KNOWN_LIQUID_STOCKS = [
  // Semiconductors & Tech Hardware
  'AMD', 'INTC', 'MU', 'QCOM', 'AMAT', 'LRCX', 'MRVL', 'ON', 'SWKS', 'QRVO',
  'TXN', 'ADI', 'MCHP', 'NXPI', 'MPWR', 'WOLF', 'SLAB', 'CRUS', 'SMTC',
  'STM', 'KLAC', 'ENTG', 'MKSI', 'ACLS', 'FORM', 'UCTT', 'AEHR',
  // Fintech & Payments
  'PYPL', 'SQ', 'AFRM', 'SOFI', 'UPST', 'LC', 'HOOD', 'COIN', 'NU',
  'BILL', 'TOST', 'PAYO', 'RELY', 'FLYW', 'MQ', 'DLO', 'PSFE',
  // Software & Cloud
  'NET', 'CRWD', 'ZS', 'OKTA', 'DDOG', 'MDB', 'ESTC', 'GTLB',
  'PATH', 'DOCN', 'CFLT', 'SUMO', 'NEWR', 'SPT', 'ALTR', 'FRSH',
  'ASAN', 'MNDY', 'ZI', 'BRZE', 'PCTY', 'WDAY', 'HUBS', 'ZEN',
  // Internet & Social
  'UBER', 'LYFT', 'DASH', 'ABNB', 'RBLX', 'SNAP', 'PINS', 'MTCH',
  'BMBL', 'SPOT', 'ROKU', 'Z', 'ZG', 'OPEN', 'CVNA', 'CHWY',
  'ETSY', 'W', 'PTON', 'CHGG', 'UDMY', 'COUR', 'DUOL', 'LZ',
  // Consumer Discretionary
  'NKE', 'LULU', 'UAA', 'DECK', 'SKX', 'CROX', 'VFC', 'PVH',
  'GOOS', 'TPR', 'CPRI', 'RL', 'GIII', 'SHOO', 'SCVL', 'BOOT',
  // Restaurants & Food
  'SBUX', 'CMG', 'DPZ', 'YUM', 'QSR', 'WING', 'SHAK', 'CAVA',
  'WEN', 'JACK', 'PZZA', 'DNUT', 'BROS', 'SG', 'TXRH', 'CAKE',
  'DENN', 'EAT', 'DRI', 'BLMN', 'RUTH', 'BJRI', 'PLAY', 'ARCO',
  // Retail
  'TGT', 'COST', 'WMT', 'DG', 'DLTR', 'FIVE', 'OLLI', 'BIG',
  'BBY', 'WSM', 'RH', 'BURL', 'ROST', 'TJX', 'GPS', 'ANF',
  'AEO', 'URBN', 'EXPR', 'PLCE', 'VSCO', 'BBW', 'LE', 'CRI',
  // Automotive
  'F', 'GM', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'PSNY',
  'FSR', 'GOEV', 'WKHS', 'RIDE', 'BLNK', 'CHPT', 'EVGO', 'DCFC',
  'AAP', 'AZO', 'ORLY', 'GPC', 'AN', 'PAG', 'LAD', 'SAH',
  // Aerospace & Defense
  'BA', 'LMT', 'RTX', 'NOC', 'GD', 'LHX', 'TDG', 'HWM',
  'TXT', 'SPR', 'HXL', 'CW', 'KTOS', 'RKLB', 'ASTS', 'LUNR',
  // Industrial & Machinery
  'CAT', 'DE', 'CNH', 'AGCO', 'TEX', 'MTW', 'PCAR', 'OSK',
  'URI', 'GNRC', 'PWR', 'EME', 'TTC', 'FLR', 'J', 'ACM',
  // Pharma & Biotech
  'PFE', 'MRK', 'BMY', 'ABBV', 'GILD', 'BIIB', 'REGN', 'VRTX',
  'MRNA', 'BNTX', 'SGEN', 'ALNY', 'IONS', 'BMRN', 'INCY', 'EXEL',
  'NBIX', 'UTHR', 'HZNP', 'RARE', 'RCKT', 'BLUE', 'SRPT', 'QURE',
  // Healthcare Services
  'CVS', 'WBA', 'CI', 'HUM', 'UNH', 'CNC', 'MOH', 'OSCR',
  'TDOC', 'DOCS', 'HIMS', 'AMWL', 'TALK', 'LFST', 'ACCD', 'SDC',
  // Energy - Oil & Gas
  'XOM', 'CVX', 'COP', 'EOG', 'PXD', 'DVN', 'OXY', 'MRO',
  'HES', 'FANG', 'PR', 'CTRA', 'OVV', 'MGY', 'MTDR', 'CHRD',
  'SM', 'PDCE', 'CPE', 'SBOW', 'REI', 'TELL', 'RRC', 'SWN',
  // Renewables & Clean Energy
  'ENPH', 'SEDG', 'FSLR', 'RUN', 'NOVA', 'ARRY', 'MAXN', 'JKS',
  'CSIQ', 'DQ', 'SPWR', 'PLUG', 'BLDP', 'BE', 'STEM', 'GEVO',
  // Banks & Financial
  'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW', 'BK',
  'USB', 'PNC', 'TFC', 'MTB', 'FITB', 'HBAN', 'CFG', 'RF',
  'KEY', 'ZION', 'CMA', 'ALLY', 'COF', 'DFS', 'SYF', 'AXP',
  // Insurance
  'MET', 'PRU', 'AFL', 'AIG', 'TRV', 'ALL', 'PGR', 'CB',
  'HIG', 'LNC', 'UNM', 'GL', 'ORI', 'KMPR', 'SIGI', 'WRB',
  // Media/Telecom
  'DIS', 'NFLX', 'WBD', 'PARA', 'FOX', 'CMCSA', 'CHTR', 'LBRDA',
  'T', 'VZ', 'TMUS', 'LUMN', 'FTR', 'USM', 'ATUS', 'SIRI',
  // Travel
  'UAL', 'DAL', 'LUV', 'AAL', 'JBLU', 'SAVE', 'ALK', 'HA',
  'MAR', 'HLT', 'H', 'WH', 'IHG', 'CHH', 'PLYA', 'HTHT',
  'CCL', 'RCL', 'NCLH', 'EXPE', 'BKNG', 'TRIP', 'TRVG', 'MMYT',
  // REITs & Real Estate
  'SPG', 'PLD', 'AMT', 'CCI', 'EQIX', 'PSA', 'DLR', 'WELL',
  'VTR', 'AVB', 'EQR', 'MAA', 'UDR', 'CPT', 'ESS', 'AIV',
  'O', 'NNN', 'WPC', 'STORE', 'ADC', 'EPRT', 'STAG', 'IIPR',
  // Materials & Mining
  'FCX', 'NEM', 'GOLD', 'AA', 'CLF', 'X', 'NUE', 'STLD',
  'RS', 'CMC', 'ATI', 'HAYN', 'CRS', 'KALU', 'CENX', 'ARNC',
  'DOW', 'LYB', 'EMN', 'CE', 'HUN', 'OLN', 'WLK', 'TROX',
  // Utilities
  'NEE', 'DUK', 'SO', 'D', 'AEP', 'XEL', 'EXC', 'ED',
  'WEC', 'ES', 'DTE', 'EIX', 'FE', 'PPL', 'AES', 'NRG',
  // Gaming & Casinos
  'LVS', 'MGM', 'WYNN', 'CZR', 'BYD', 'PENN', 'DKNG', 'GENI',
  'RSI', 'RRR', 'BALY', 'CHDN', 'GDEN', 'IGT', 'SGMS', 'EVRI',
  // Consumer Staples
  'PG', 'KO', 'PEP', 'MDLZ', 'KHC', 'GIS', 'K', 'CPB',
  'SJM', 'HSY', 'MKC', 'HRL', 'TSN', 'CAG', 'POST', 'INGR',
  // Medical Devices
  'ABT', 'MDT', 'SYK', 'BSX', 'EW', 'ZBH', 'ISRG', 'DXCM',
  'HOLX', 'ALGN', 'ILMN', 'TFX', 'PODD', 'IRTC', 'LIVN', 'NVST',
  // Enterprise Tech
  'IBM', 'ORCL', 'SAP', 'ACN', 'INFY', 'WIT', 'CTSH', 'EPAM',
  'GLOB', 'GDYN', 'TASK', 'TTEC', 'VG', 'DXC', 'LDOS', 'SAIC',
  // Cybersecurity
  'PANW', 'FTNT', 'S', 'CYBR', 'TENB', 'VRNS', 'SAIL', 'RPD',
  'QLYS', 'FEYE', 'BB', 'NLOK', 'AVGO', 'CHKP', 'AKAM', 'FFIV',
  // E-commerce & Digital
  'AMZN', 'EBAY', 'MELI', 'SE', 'SHOP', 'WIX', 'BIGC', 'VTEX',
  'GDRX', 'HIMS', 'PRCH', 'CART', 'FVRR', 'UPWK', 'TASK', 'KNX',
  // Fitness & Wellness
  'PLNT', 'XPOF', 'GYM', 'CLUB', 'BODY', 'PTON',
  // Packaging
  'BALL', 'CCK', 'BERY', 'SEE', 'SLGN', 'SON', 'GPK', 'OI',
  // Transportation & Logistics
  'UPS', 'FDX', 'XPO', 'CHRW', 'JBHT', 'ODFL', 'SAIA', 'ARCB',
  'KNX', 'WERN', 'HUBG', 'SNDR', 'GXO', 'EXPD', 'FWRD', 'ECHO',
  // Homebuilders
  'DHI', 'LEN', 'PHM', 'NVR', 'TOL', 'KBH', 'MDC', 'MTH',
  'TMHC', 'MHO', 'CCS', 'GRBK', 'BLD', 'BLDR', 'BZH', 'SKY'
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
