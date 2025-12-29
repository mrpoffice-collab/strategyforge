#!/usr/bin/env python3
"""
TradingView Screener - Pre-filters stocks for StrategyForge strategies.
Runs via GitHub Actions cron, writes results to Neon PostgreSQL.
"""

import os
import json
from datetime import datetime
import psycopg2
from tradingview_screener import Query, col

DATABASE_URL = os.environ.get('DATABASE_URL')

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
            col('BB.width') < 15,  # Low volatility (squeeze)
            col('close') > col('BB.upper'),  # Breaking out
            col('Mom') > 0,  # Positive momentum
            col('volume') > 500000,
        ],
        'columns': ['name', 'close', 'BB.upper', 'BB.lower', 'BB.width', 'Mom', 'volume', 'change']
    },
    'macd_bb_volume': {
        'name': 'MACD-BB-Volume Triple Filter',
        'filters': [
            col('close').between(25, 100),
            col('MACD.macd') > col('MACD.signal'),  # MACD bullish
            col('close') > col('BB.middle'),  # Above middle BB
            col('RSI').between(40, 70),  # Healthy RSI range
            col('volume') > 500000,
        ],
        'columns': ['name', 'close', 'MACD.macd', 'MACD.signal', 'BB.middle', 'RSI', 'volume', 'change']
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
            col('close') > col('price_52_week_high') * 0.95,  # Near 52-week high
            col('volume') > 1000000,
        ],
        'columns': ['name', 'close', 'relative_volume_10d_calc', 'price_52_week_high', 'volume', 'change']
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
    cur = conn.cursor()

    # Create screener results table if not exists
    cur.execute("""
        CREATE TABLE IF NOT EXISTS "ScreenerSignal" (
            id SERIAL PRIMARY KEY,
            symbol VARCHAR(20) NOT NULL,
            strategy_key VARCHAR(100) NOT NULL,
            strategy_name VARCHAR(200),
            price DECIMAL(10, 2),
            indicators JSONB,
            scanned_at TIMESTAMP DEFAULT NOW(),
            processed BOOLEAN DEFAULT FALSE,
            UNIQUE(symbol, strategy_key, DATE(scanned_at))
        )
    """)

    # Clear old signals (older than 1 day)
    cur.execute("""
        DELETE FROM "ScreenerSignal"
        WHERE scanned_at < NOW() - INTERVAL '1 day'
    """)

    # Insert new signals
    for signal in signals:
        try:
            cur.execute("""
                INSERT INTO "ScreenerSignal" (symbol, strategy_key, strategy_name, price, indicators, scanned_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (symbol, strategy_key, DATE(scanned_at))
                DO UPDATE SET price = EXCLUDED.price, indicators = EXCLUDED.indicators, scanned_at = NOW()
            """, (
                signal['symbol'],
                signal['strategy_key'],
                signal['strategy_name'],
                signal['price'],
                json.dumps(signal['indicators'])
            ))
        except Exception as e:
            print(f"  Error saving {signal['symbol']}: {e}")

    conn.commit()
    cur.close()
    conn.close()

    print(f"Saved {len(signals)} signals to database")


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
