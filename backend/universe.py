"""
Curated stock universes for the Opportunities scan.

These are large, liquid, generally high-quality companies — a sensible starting
pool to run the intrinsic-value screen against. Keep tickers as bare symbols;
Indian names get the ".NS" (NSE) suffix appended in `iter_universe`.

Expand these lists (or swap in full index constituents) as needed.
"""

# US large caps across sectors
US_UNIVERSE = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "V", "MA", "JNJ", "PG",
    "KO", "PEP", "HD", "UNH", "JPM", "ADBE", "CRM", "ORCL", "CSCO", "PFE",
    "ABBV", "MRK", "WMT", "DIS", "NKE", "COST", "MCD", "INTU", "TXN", "QCOM",
]

# India (NSE) large caps — Nifty constituents (bare symbols; ".NS" added on scan)
IN_UNIVERSE = [
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "HINDUNILVR", "ITC",
    "SBIN", "BHARTIARTL", "KOTAKBANK", "LT", "HCLTECH", "ASIANPAINT", "MARUTI",
    "AXISBANK", "SUNPHARMA", "TITAN", "WIPRO", "ULTRACEMCO", "NESTLEIND",
    "BAJFINANCE", "TATAMOTORS", "TATASTEEL", "POWERGRID", "NTPC",
]


def iter_universe():
    """Yield (market, resolved_symbol) pairs for the full universe."""
    for sym in US_UNIVERSE:
        yield "US", sym
    for sym in IN_UNIVERSE:
        yield "IN", f"{sym}.NS"
