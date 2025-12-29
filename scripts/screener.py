#!/usr/bin/env python3
"""
TradingView Screener - Pre-filters stocks for StrategyForge strategies.
Runs via GitHub Actions cron, writes results to Neon PostgreSQL.
"""

import os
import json
import math
from datetime import datetime
import psycopg2
from tradingview_screener import Query, col


def clean_for_json(obj):
    """Replace NaN/Inf values with None for JSON serialization."""
    if isinstance(obj, dict):
        return {k: clean_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_for_json(v) for v in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    return obj

DATABASE_URL = os.environ.get('DATABASE_URL', '').strip().strip('"').strip("'")

# Strategy filter configurations
# Each strategy has specific indicator requirements for pre-filtering
STRATEGY_FILTERS = {
    'rsi_stochastic_oversold': {
        'name': 'RSI-Stochastic Double Oversold',
        'filters': [
            col('close').between(25, 100),
            col('RSI') < 40,  # Slightly relaxed from 35
            col('Stoch.K') < 30,  # Slightly relaxed from 25
            col('MACD.macd') > col('MACD.signal'),  # MACD bullish
            col('volume') > 500000,
        ],
        'columns': ['name', 'close', 'RSI', 'Stoch.K', 'Stoch.D', 'MACD.macd', 'MACD.signal', 'volume', 'change']
    },
    'adx_trend_pullback': {
        'name': 'ADX Trend + MA Pullback',
        'filters': [
            col('close').between(25, 100),
            col('ADX') > 20,  # Relaxed from 25
            col('ADX+DI') > col('ADX-DI'),  # Bullish DI
            col('close') > col('SMA50'),  # Above 50 MA (trend)
            col('volume') > 500000,
        ],
        'columns': ['name', 'close', 'ADX', 'ADX+DI', 'ADX-DI', 'SMA20', 'SMA50', 'volume', 'change']
    },
    'bollinger_squeeze': {
        'name': 'Bollinger Squeeze Breakout',
        'filters': [
            col('close').between(25, 100),
            col('Volatility.D') < 5,  # Low volatility
            col('close') > col('BB.upper'),  # Breaking out above upper band
            col('Mom') > 0,  # Positive momentum
            col('volume') > 500000,
        ],
        'columns': ['name', 'close', 'BB.upper', 'BB.lower', 'Volatility.D', 'Mom', 'volume', 'change']
    },
    'macd_bb_volume': {
        'name': 'MACD-BB-Volume Triple Filter',
        'filters': [
            col('close').between(25, 100),
            col('MACD.macd') > col('MACD.signal'),  # MACD bullish
            col('close') > col('SMA20'),  # Above 20 SMA (proxy for middle BB)
            col('RSI').between(40, 70),  # Healthy RSI range
            col('volume') > 500000,
        ],
        'columns': ['name', 'close', 'MACD.macd', 'MACD.signal', 'SMA20', 'RSI', 'volume', 'change']
    },
    'stochastic_rsi_sync': {
        'name': 'Stochastic-RSI Momentum Sync',
        'filters': [
            col('close').between(25, 100),
            col('Stoch.K') > col('Stoch.D'),  # Stochastic bullish cross
            col('RSI').between(30, 55),  # Recovering from oversold
            col('close') > col('SMA50'),  # Uptrend filter
            col('volume') > 500000,
        ],
        'columns': ['name', 'close', 'Stoch.K', 'Stoch.D', 'RSI', 'SMA50', 'volume', 'change']
    },
    'rsi_mean_reversion': {
        'name': 'RSI Mean Reversion',
        'filters': [
            col('close').between(25, 100),
            col('RSI') < 35,  # Oversold
            col('volume') > 500000,
        ],
        'columns': ['name', 'close', 'RSI', 'volume', 'change']
    },
    'macd_momentum': {
        'name': 'MACD Momentum Crossover',
        'filters': [
            col('close').between(25, 100),
            col('MACD.macd') > col('MACD.signal'),  # Bullish crossover
            col('close') > col('SMA50'),  # Above 50 MA
            col('volume') > 500000,
        ],
        'columns': ['name', 'close', 'MACD.macd', 'MACD.signal', 'SMA50', 'volume', 'change']
    },
    'volume_breakout': {
        'name': 'Volume Breakout Scanner',
        'filters': [
            col('close').between(25, 100),
            col('relative_volume_10d_calc') > 2.0,  # 2x average volume
            col('High.All') > 0,  # Has 52-week high data
            col('volume') > 1000000,
        ],
        'columns': ['name', 'close', 'relative_volume_10d_calc', 'High.All', 'volume', 'change']
    },
}


def run_screener(strategy_key: str, strategy_config: dict) -> list:
    """Run TradingView screener for a specific strategy."""
    try:
        query = Query().select(*strategy_config['columns']).set_markets('america')

        for filter_cond in strategy_config['filters']:
            query = query.where(filter_cond)

        query = query.limit(100)  # Top 100 matches per strategy

        count, results = query.get_scanner_data()

        print(f"  {strategy_config['name']}: {count} total matches, returning top {len(results)}")

        return results.to_dict('records') if len(results) > 0 else []
    except Exception as e:
        print(f"  Error running screener for {strategy_key}: {e}")
        return []


def save_to_database(signals: list):
    """Save screener signals to Neon PostgreSQL."""
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        return

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True  # Each insert is its own transaction
    cur = conn.cursor()

    # Table is managed by Prisma - just clear old signals
    try:
        cur.execute("""
            DELETE FROM "ScreenerSignal"
            WHERE scanned_at < NOW() - INTERVAL '1 day'
        """)
    except Exception as e:
        print(f"  Error clearing old signals: {e}")

    # Insert new signals
    saved_count = 0
    for signal in signals:
        try:
            # Clean indicators of NaN values
            clean_indicators = clean_for_json(signal['indicators'])

            cur.execute("""
                INSERT INTO "ScreenerSignal" (symbol, strategy_key, strategy_name, price, indicators, scanned_at, processed)
                VALUES (%s, %s, %s, %s, %s, NOW(), FALSE)
                ON CONFLICT DO NOTHING
            """, (
                signal['symbol'],
                signal['strategy_key'],
                signal['strategy_name'],
                signal['price'],
                json.dumps(clean_indicators)
            ))
            saved_count += 1
        except Exception as e:
            print(f"  Error saving {signal['symbol']}: {e}")

    cur.close()
    conn.close()

    print(f"Saved {saved_count}/{len(signals)} signals to database")


def main():
    print(f"TradingView Screener - {datetime.now().isoformat()}")
    print("=" * 50)

    all_signals = []

    for strategy_key, strategy_config in STRATEGY_FILTERS.items():
        print(f"\nScanning: {strategy_config['name']}")

        results = run_screener(strategy_key, strategy_config)

        for row in results:
            symbol = row.get('name', '').split(':')[-1]  # Extract symbol from "NASDAQ:AAPL"
            if not symbol:
                continue

            # Extract price and other indicators
            indicators = {k: v for k, v in row.items() if k != 'name'}
            price = row.get('close', 0)

            # Double-check price is in valid range (TradingView filter sometimes fails)
            if not price or price < 25 or price > 100:
                continue

            all_signals.append({
                'symbol': symbol,
                'strategy_key': strategy_key,
                'strategy_name': strategy_config['name'],
                'price': price,
                'indicators': indicators,
            })

    print(f"\n{'=' * 50}")
    print(f"Total signals found: {len(all_signals)}")

    if all_signals:
        save_to_database(all_signals)

    # Print summary by strategy
    print("\nSummary by strategy:")
    for strategy_key in STRATEGY_FILTERS:
        count = len([s for s in all_signals if s['strategy_key'] == strategy_key])
        print(f"  {STRATEGY_FILTERS[strategy_key]['name']}: {count} signals")


if __name__ == '__main__':
    main()
