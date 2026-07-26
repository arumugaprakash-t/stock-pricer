"""
Precompute the Opportunities board.

Scans the curated universe (backend/universe.py), runs each name through the
existing intrinsic-value engine, applies value-trap guardrails, ranks by
margin-of-safety upside, and writes backend/data/opportunities.json.

This is intentionally a BATCH job: yfinance is too slow / rate-limited to scan a
universe on a page load, so we precompute here (run on a schedule or manually)
and the API just serves the resulting artifact.

Usage:
    python precompute_opportunities.py [--limit N] [--sleep SECONDS]
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

from stock_service import get_stock_data
from universe import iter_universe

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
OUTPUT_PATH = os.path.join(DATA_DIR, "opportunities.json")

# Value-trap guardrails
MIN_YEARS = 3            # need at least this many annual data points
MIN_POSITIVE_RATIO = 0.6  # this fraction of years must have positive owner earnings


def evaluate(symbol, market):
    """Return a ranked-opportunity dict for a symbol, or None if it fails quality checks."""
    data = get_stock_data(symbol)
    if data.get("status") != "success":
        return None

    price = data.get("current_price") or 0
    shares = data.get("shares_outstanding") or 0
    trends = data.get("annual_trends") or []
    baseline = data.get("baseline_valuation") or {}
    intrinsic = baseline.get("intrinsic_value_per_share") or 0

    # --- Quality / value-trap filters ---
    if price <= 0 or shares <= 0 or intrinsic <= 0:
        return None
    if len(trends) < MIN_YEARS:
        return None
    latest_oe = trends[0].get("owner_earnings", 0)
    if latest_oe <= 0:  # must currently generate real owner earnings
        return None
    positive_years = sum(1 for t in trends if t.get("owner_earnings", 0) > 0)
    if positive_years / len(trends) < MIN_POSITIVE_RATIO:
        return None

    upside_pct = (intrinsic - price) / price * 100

    return {
        "symbol": symbol,
        "market": market,
        "name": data.get("name"),
        "sector": data.get("sector"),
        "currency": data.get("currency"),
        "price": round(price, 2),
        "intrinsic_value": round(intrinsic, 2),
        "buy_target": round(baseline.get("buy_target_price", 0), 2),
        "upside_pct": round(upside_pct, 1),
        "recommendation": baseline.get("recommendation"),
        "pe_ratio": data.get("pe_ratio"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Only scan the first N symbols (for quick tests)")
    parser.add_argument("--sleep", type=float, default=0.5, help="Seconds to pause between symbols (rate-limit friendliness)")
    args = parser.parse_args()

    targets = list(iter_universe())
    if args.limit:
        targets = targets[: args.limit]

    results = []
    failures = []
    total = len(targets)
    for idx, (market, symbol) in enumerate(targets, 1):
        try:
            row = evaluate(symbol, market)
            if row:
                results.append(row)
                print(f"[{idx}/{total}] OK   {symbol:14} upside {row['upside_pct']:+.1f}%")
            else:
                failures.append(symbol)
                print(f"[{idx}/{total}] SKIP {symbol:14} (failed quality/data checks)")
        except Exception as e:  # never let one bad ticker kill the whole scan
            failures.append(symbol)
            print(f"[{idx}/{total}] ERR  {symbol:14} {e}")
        time.sleep(args.sleep)

    # Rank most undervalued first
    results.sort(key=lambda r: r["upside_pct"], reverse=True)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "universe_size": total,
        "evaluated": len(results),
        "skipped": len(failures),
        "results": results,
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"\nWrote {len(results)} opportunities (skipped {len(failures)}) -> {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
