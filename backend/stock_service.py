import yfinance as yf
import pandas as pd
import numpy as np
import traceback
from datetime import datetime, timezone, timedelta, date

def safe_float(val):
    if pd.isna(val) or val is None:
        return 0.0
    try:
        return float(val)
    except:
        return 0.0

def safe_int(val):
    if pd.isna(val) or val is None:
        return 0
    try:
        return int(val)
    except:
        return 0

def get_row_value(df, alternative_keys, col_idx=0):
    """
    Safely retrieves a value from a DataFrame row corresponding to alternative keys.
    Returns 0.0 if not found or if the value is NaN.
    """
    if df is None or df.empty:
        return 0.0
    for key in alternative_keys:
        if key in df.index:
            val = df.loc[key]
            if isinstance(val, pd.Series):
                # If it's a series, return the value at col_idx (latest column is usually first)
                if col_idx < len(val):
                    return safe_float(val.iloc[col_idx])
            else:
                return safe_float(val)
    return 0.0

# Row-name fragments that are NOT monetary and must not be FX-converted
_NON_MONETARY_ROWS = ("shares", "tax rate")

def extract_statement_data(df, fx=1.0):
    """
    Converts a pandas DataFrame statement to a dictionary structure friendly for JSON response.
    Transposes it so dates are keys, and keys contain the metrics.
    `fx` converts monetary values into the display currency (share-count / ratio rows are left as-is).
    """
    if df is None or df.empty:
        return []

    # Transpose so columns are metrics and index is Timestamp/Date
    df_t = df.T
    data = []
    for date, row in df_t.iterrows():
        date_str = str(date.date()) if hasattr(date, "date") else str(date)
        row_dict = {"date": date_str}
        for col in df_t.columns:
            val = row[col]
            if pd.isna(val):
                row_dict[col] = None
            else:
                v = float(val)
                if fx != 1.0 and not any(s in str(col).lower() for s in _NON_MONETARY_ROWS):
                    v = v * fx
                row_dict[col] = v
        data.append(row_dict)
    return data

def calculate_dcf(
    current_price,
    shares_outstanding,
    owner_earnings_base,
    growth_rate_1_5,
    growth_rate_6_10,
    discount_rate,
    terminal_growth_rate,
    cash,
    debt,
    margin_of_safety
):
    """
    Performs the Warren Buffett Owner Earnings Discounted Cash Flow (DCF) valuation.
    Rates should be provided as decimals (e.g. 0.10 for 10%).
    """
    if not shares_outstanding or shares_outstanding <= 0:
        return {
            "intrinsic_value_per_share": 0.0,
            "buy_target_price": 0.0,
            "status": "error",
            "message": "Invalid shares outstanding"
        }
    
    # Project cash flows
    projected_flows = []
    current_flow = owner_earnings_base
    
    # Year 1 to 5 growth
    for year in range(1, 6):
        current_flow = current_flow * (1 + growth_rate_1_5)
        projected_flows.append(current_flow)
        
    # Year 6 to 10 growth
    for year in range(6, 11):
        current_flow = current_flow * (1 + growth_rate_6_10)
        projected_flows.append(current_flow)
        
    # Discount back to present value
    pv_factors = [1 / ((1 + discount_rate) ** year) for year in range(1, 11)]
    pv_flows = [flow * factor for flow, factor in zip(projected_flows, pv_factors)]
    sum_pv_flows = sum(pv_flows)
    
    # Calculate Terminal Value at Year 10
    # Formula: CF10 * (1 + terminal_growth_rate) / (discount_rate - terminal_growth_rate)
    cf_10 = projected_flows[-1]
    
    # Avoid division by zero
    diff = discount_rate - terminal_growth_rate
    if diff <= 0:
        diff = 0.01  # safe fallback
        
    terminal_value = (cf_10 * (1 + terminal_growth_rate)) / diff
    pv_terminal_value = terminal_value * pv_factors[-1]
    
    # Total Intrinsic Value of the Business
    intrinsic_value_company = sum_pv_flows + pv_terminal_value
    
    # Equity value = Company Value + Cash - Debt
    intrinsic_value_equity = intrinsic_value_company + cash - debt
    
    # Value per share
    intrinsic_value_per_share = intrinsic_value_equity / shares_outstanding
    
    # Target Buy Price (with Margin of Safety)
    buy_target_price = intrinsic_value_per_share * (1 - margin_of_safety)
    
    # Calculate upside/downside based on current price
    margin = 0.0
    if current_price > 0:
        margin = (intrinsic_value_per_share - current_price) / current_price
        
    # Recommendation status
    recommendation = "OVERVALUED"
    if current_price <= buy_target_price:
        recommendation = "BUY"
    elif current_price <= intrinsic_value_per_share:
        recommendation = "FAIR VALUE / HOLD"
        
    # Package details of projection for visualization
    projections = []
    for yr in range(1, 11):
        projections.append({
            "year": yr,
            "projected_cash_flow": float(projected_flows[yr - 1]),
            "present_value": float(pv_flows[yr - 1])
        })
        
    return {
        "status": "success",
        "intrinsic_value_company": float(intrinsic_value_company),
        "intrinsic_value_equity": float(intrinsic_value_equity),
        "intrinsic_value_per_share": float(intrinsic_value_per_share),
        "buy_target_price": float(buy_target_price),
        "current_price": float(current_price),
        "upside_downside_pct": float(margin * 100),
        "recommendation": recommendation,
        "projections": projections,
        "terminal_value": float(terminal_value),
        "pv_terminal_value": float(pv_terminal_value),
        "sum_pv_flows": float(sum_pv_flows)
    }

def compute_performance(hist, current_price):
    """
    Compute trailing price return (%) over long horizons useful for periodic
    (weekly/monthly/quarterly) investors: 1 month, 6 months, 1 year, and YTD.
    `hist` is a yfinance history DataFrame (needs ~1y of daily closes).
    Returns a dict of {label: pct or None}.
    """
    perf = {"1M": None, "6M": None, "1Y": None, "YTD": None}
    if hist is None or hist.empty or not current_price:
        return perf
    closes = hist["Close"].dropna()
    if closes.empty:
        return perf

    idx_dates = [ts.date() if hasattr(ts, "date") else ts for ts in closes.index]
    prices = list(closes.values)
    today = datetime.now(timezone.utc).date()
    targets = {
        "1M": today - timedelta(days=30),
        "6M": today - timedelta(days=182),
        "1Y": today - timedelta(days=365),
        "YTD": date(today.year, 1, 1),
    }
    for label, tdate in targets.items():
        past_price = None
        # last available close on or before the target date
        for d, p in zip(idx_dates, prices):
            if d <= tdate:
                past_price = p
            else:
                break
        if past_price and past_price > 0:
            perf[label] = float((current_price - past_price) / past_price * 100)
    return perf


def _raw(df, keys, i=0):
    """
    Like get_row_value but returns None (not 0.0) when a row is missing or NaN,
    so quality metrics can distinguish "genuinely zero" from "unavailable".
    """
    if df is None or df.empty:
        return None
    for key in keys:
        if key in df.index:
            val = df.loc[key]
            if isinstance(val, pd.Series):
                if i < len(val):
                    x = val.iloc[i]
                else:
                    continue
            else:
                x = val
            if pd.isna(x):
                return None
            try:
                return float(x)
            except (TypeError, ValueError):
                return None
    return None


def _score_linear(value, anchors):
    """
    Map a raw metric value to a 0-100 sub-score via piecewise-linear interpolation
    between (value, points) anchors. Clamps outside the anchor range. Works for both
    higher-is-better and lower-is-better metrics (encode direction in the points).
    """
    if value is None:
        return None
    pts = sorted(anchors, key=lambda a: a[0])
    if value <= pts[0][0]:
        return float(pts[0][1])
    if value >= pts[-1][0]:
        return float(pts[-1][1])
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= value <= x1:
            if x1 == x0:
                return float(y1)
            frac = (value - x0) / (x1 - x0)
            return float(y0 + frac * (y1 - y0))
    return float(pts[-1][1])


def _cagr(begin, end, years):
    """Compound annual growth rate; None if not computable (needs positive endpoints)."""
    if begin is None or end is None or years is None or years <= 0:
        return None
    if begin <= 0 or end <= 0:
        return None
    return (end / begin) ** (1.0 / years) - 1.0


# Row-name alternatives (yfinance labels drift between tickers/versions)
_NI_KEYS = ["Net Income", "Net Income Common Stockholders", "Net Income From Continuing Operation Net Minority Interest"]
_REV_KEYS = ["Total Revenue", "Operating Revenue"]
_GP_KEYS = ["Gross Profit"]
_OPINC_KEYS = ["Operating Income", "Total Operating Income As Reported"]
_EBIT_KEYS = ["EBIT"]
_INT_KEYS = ["Interest Expense", "Interest Expense Non Operating"]
_TAX_KEYS = ["Tax Provision"]
_PRETAX_KEYS = ["Pretax Income"]
_EQUITY_KEYS = ["Common Stock Equity", "Stockholders Equity", "Total Equity Gross Minority Interest"]
_DEBT_KEYS = ["Total Debt"]
_CASH_KEYS = [
    "Cash Cash Equivalents And Short Term Investments",
    "Cash And Cash Equivalents",
    "Cash Financial",
]
_TA_KEYS = ["Total Assets"]
_TL_KEYS = ["Total Liabilities Net Minority Interest"]
_CA_KEYS = ["Current Assets"]
_CL_KEYS = ["Current Liabilities"]
_WC_KEYS = ["Working Capital"]
_RE_KEYS = ["Retained Earnings"]
_SHARES_KEYS = ["Ordinary Shares Number", "Share Issued", "Diluted Average Shares"]
_OCF_KEYS = ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"]


def _status_of(score):
    if score is None:
        return "na"
    if score >= 70:
        return "good"
    if score >= 40:
        return "fair"
    return "weak"


def _grade_of(composite):
    if composite is None:
        return None, "Insufficient data"
    if composite >= 80:
        return "A", "Wonderful business"
    if composite >= 65:
        return "B", "Good business"
    if composite >= 50:
        return "C", "Average business"
    if composite >= 35:
        return "D", "Weak business"
    return "F", "Poor — likely avoid"


def compute_quality_score(fin, bs, cf, annual_data_list, fx_rate, sector, market_cap):
    """
    Composite business-quality + financial-health score, independent of the DCF valuation.
    Returns a structured dict (see the `quality` object in the API response) or a
    minimal dict with grade=None when there isn't enough data.

    Buffett-flavored: profitability/returns and solvency are weighted highest, with a
    consistency (track-record) and growth pillar, plus the recognized Piotroski F-Score
    and Altman Z-Score surfaced as named badges. Banks/insurers use adjusted health
    metrics because Altman Z / current ratio / D-E are not meaningful for them.
    """
    fx = fx_rate if fx_rate and fx_rate > 0 else 1.0
    is_financial = (sector or "").strip().lower() == "financial services"
    profile = "financial" if is_financial else ("general" if sector else "unknown")

    def fmt_pct(v):
        return "N/A" if v is None else f"{v * 100:.1f}%"

    def fmt_num(v):
        return "N/A" if v is None else f"{v:.2f}"

    def metric(key, label, value, anchors, fmt, detail=""):
        s = _score_linear(value, anchors) if value is not None else None
        return {
            "key": key,
            "label": label,
            "value": value,
            "display": fmt(value),
            "score": None if s is None else round(s),
            "status": _status_of(s),
            "detail": detail,
        }

    def pillar(metrics, weight):
        scores = [m["score"] for m in metrics if m["score"] is not None]
        ps = round(sum(scores) / len(scores)) if scores else None
        return {"score": ps, "weight": weight, "metrics": metrics}

    # --- Latest-period statement values (col 0 = most recent) ---
    net_income = _raw(fin, _NI_KEYS, 0)
    revenue = _raw(fin, _REV_KEYS, 0)
    gross_profit = _raw(fin, _GP_KEYS, 0)
    op_income = _raw(fin, _OPINC_KEYS, 0)
    ebit = _raw(fin, _EBIT_KEYS, 0)
    if ebit is None:
        ebit = op_income
    pretax = _raw(fin, _PRETAX_KEYS, 0)
    tax = _raw(fin, _TAX_KEYS, 0)
    interest_exp = _raw(fin, _INT_KEYS, 0)

    equity = _raw(bs, _EQUITY_KEYS, 0)
    total_debt = _raw(bs, _DEBT_KEYS, 0)
    cash = _raw(bs, _CASH_KEYS, 0)
    total_assets = _raw(bs, _TA_KEYS, 0)
    total_liab = _raw(bs, _TL_KEYS, 0)
    current_assets = _raw(bs, _CA_KEYS, 0)
    current_liab = _raw(bs, _CL_KEYS, 0)
    working_capital = _raw(bs, _WC_KEYS, 0)
    if working_capital is None and current_assets is not None and current_liab is not None:
        working_capital = current_assets - current_liab
    retained = _raw(bs, _RE_KEYS, 0)

    # Effective tax rate for NOPAT (clamped to a sane band)
    if pretax and pretax > 0 and tax is not None:
        tax_rate = max(0.0, min(0.35, tax / pretax))
    else:
        tax_rate = 0.21
    nopat = ebit * (1 - tax_rate) if ebit is not None else None

    # ROIC = NOPAT / invested capital (Debt + Equity - Cash)
    invested_capital = None
    if total_debt is not None and equity is not None:
        invested_capital = total_debt + equity - (cash or 0.0)
    roic = (nopat / invested_capital) if (nopat is not None and invested_capital and invested_capital > 0) else None

    roe = (net_income / equity) if (net_income is not None and equity and equity > 0) else None
    gross_margin = (gross_profit / revenue) if (gross_profit is not None and revenue and revenue > 0) else None
    operating_margin = (op_income / revenue) if (op_income is not None and revenue and revenue > 0) else None
    net_margin = (net_income / revenue) if (net_income is not None and revenue and revenue > 0) else None
    roa = (net_income / total_assets) if (net_income is not None and total_assets and total_assets > 0) else None

    # --- Pillar A: Profitability & Returns ---
    profitability = pillar([
        metric("roic", "ROIC", roic, [(0, 0), (0.04, 25), (0.07, 50), (0.10, 75), (0.15, 100)], fmt_pct, "Return on invested capital; ≥15% is excellent."),
        metric("roe", "ROE", roe, [(0, 0), (0.05, 25), (0.10, 50), (0.15, 80), (0.20, 100)], fmt_pct, "Return on equity; ≥20% is excellent."),
        metric("gross_margin", "Gross Margin", gross_margin, [(0.10, 10), (0.20, 40), (0.40, 70), (0.60, 100)], fmt_pct, "Pricing power / moat signal."),
        metric("operating_margin", "Operating Margin", operating_margin, [(0, 0), (0.08, 40), (0.15, 70), (0.25, 100)], fmt_pct, "Core operating efficiency."),
        metric("net_margin", "Net Margin", net_margin, [(0, 0), (0.05, 30), (0.10, 60), (0.20, 100)], fmt_pct, "Bottom-line profitability."),
    ], 0.35)

    # --- Pillar B: Financial Health / Solvency ---
    if is_financial:
        equity_to_assets = (equity / total_assets) if (equity and total_assets and total_assets > 0) else None
        health = pillar([
            metric("roa", "Return on Assets", roa, [(0, 0), (0.005, 25), (0.01, 50), (0.015, 75), (0.02, 100)], fmt_pct, "Key profitability gauge for banks."),
            metric("net_margin_fin", "Net Margin", net_margin, [(0, 0), (0.10, 40), (0.20, 70), (0.30, 100)], fmt_pct, "Bank net profitability."),
            metric("equity_to_assets", "Equity / Assets", equity_to_assets, [(0.03, 10), (0.05, 40), (0.08, 70), (0.12, 100)], fmt_pct, "Capital cushion (leverage safety)."),
        ], 0.30)
    else:
        # Altman Z-Score (general/manufacturing form)
        altman_z = None
        if all(x is not None for x in (working_capital, retained, ebit, total_assets, total_liab)) and total_assets > 0 and total_liab and total_liab > 0 and market_cap and market_cap > 0 and revenue is not None:
            A = working_capital / total_assets
            B = retained / total_assets
            C = ebit / total_assets
            D = market_cap / (total_liab * fx)  # market cap is price-currency; liabilities are statement-currency
            E = revenue / total_assets
            altman_z = 1.2 * A + 1.4 * B + 3.3 * C + 0.6 * D + 1.0 * E

        debt_to_equity = (total_debt / equity) if (total_debt is not None and equity and equity > 0) else None
        interest_coverage = (ebit / interest_exp) if (ebit is not None and interest_exp and interest_exp > 0) else None
        current_ratio = (current_assets / current_liab) if (current_assets is not None and current_liab and current_liab > 0) else None

        health = pillar([
            metric("altman_z", "Altman Z-Score", altman_z, [(0.5, 0), (1.81, 40), (3.0, 100)], fmt_num, "Bankruptcy-risk score; >2.99 safe."),
            metric("debt_to_equity", "Debt / Equity", debt_to_equity, [(0.3, 100), (0.5, 80), (1.0, 50), (2.0, 20), (3.0, 0)], fmt_num, "Leverage; lower is safer."),
            metric("interest_coverage", "Interest Coverage", interest_coverage, [(1, 0), (1.5, 25), (3, 50), (5, 70), (10, 100)], fmt_num, "EBIT ÷ interest; ≥5 is comfortable."),
            metric("current_ratio", "Current Ratio", current_ratio, [(0.5, 0), (1, 50), (1.5, 75), (2, 100)], fmt_num, "Short-term liquidity."),
        ], 0.30)

    # --- Pillar C: Consistency / Track Record ---
    oe_series = [r.get("owner_earnings") for r in (annual_data_list or [])]
    ni_series = [r.get("net_income") for r in (annual_data_list or [])]
    pct_positive_oe = (sum(1 for x in oe_series if x and x > 0) / len(oe_series)) if oe_series else None
    earnings_stability = (sum(1 for x in ni_series if x and x > 0) / len(ni_series)) if ni_series else None

    # Piotroski F-Score (needs current + prior year, all 9 components computable)
    piotroski = _piotroski_f(fin, bs, cf)

    consistency_metrics = [
        metric("pct_positive_oe", "Positive Owner-Earnings Yrs", pct_positive_oe, [(0, 0), (1, 100)], fmt_pct, "Share of years with positive owner earnings."),
        metric("earnings_stability", "Profitable Years", earnings_stability, [(0, 0), (1, 100)], fmt_pct, "Share of years with positive net income."),
    ]
    if piotroski is not None:
        p_score = round(piotroski / 9.0 * 100)
        consistency_metrics.insert(0, {
            "key": "piotroski_f", "label": "Piotroski F-Score",
            "value": piotroski, "display": f"{piotroski}/9",
            "score": p_score, "status": _status_of(p_score),
            "detail": "9-point fundamental-strength check (higher is better).",
        })
    consistency = pillar(consistency_metrics, 0.20)

    # --- Pillar D: Growth ---
    # Use the first/last *valid* points (col 0 = newest). yfinance sometimes appends a
    # sparse trailing column (NaN revenue / ~0 owner earnings) that would poison a CAGR.
    def _series_cagr(series):
        # Keep positive points with their column position (0 = newest); CAGR needs
        # positive endpoints, and the year span is the gap between the positions used.
        pts = [(i, x) for i, x in enumerate(series) if x is not None and x > 0]
        if len(pts) < 2:
            return None
        newest_i, end = pts[0]
        oldest_i, begin = pts[-1]
        return _cagr(begin, end, oldest_i - newest_i)

    rev_series = []
    if fin is not None and not fin.empty:
        for i in range(len(fin.columns)):
            rev_series.append(_raw(fin, _REV_KEYS, i))
    rev_cagr = _series_cagr(rev_series)
    oe_cagr = _series_cagr(oe_series)
    g_anchors = [(-0.05, 0), (0, 25), (0.05, 50), (0.10, 75), (0.15, 100)]
    growth = pillar([
        metric("revenue_cagr", "Revenue CAGR", rev_cagr, g_anchors, fmt_pct, "Compound revenue growth over available years."),
        metric("owner_earnings_cagr", "Owner-Earnings CAGR", oe_cagr, g_anchors, fmt_pct, "Compound owner-earnings growth."),
    ], 0.15)

    pillars = {
        "profitability": profitability,
        "health": health,
        "consistency": consistency,
        "growth": growth,
    }

    # --- Composite (weighted over pillars that have a score) ---
    weighted = [(p["score"], p["weight"]) for p in pillars.values() if p["score"] is not None]
    total_w = sum(w for _, w in weighted)
    composite = round(sum(s * w for s, w in weighted) / total_w) if total_w > 0 else None

    # --- Data completeness ---
    all_metrics = [m for p in pillars.values() for m in p["metrics"]]
    attempted = len(all_metrics)
    available = sum(1 for m in all_metrics if m["score"] is not None)
    completeness = round(available / attempted, 2) if attempted else 0.0

    # Too little data to be honest about → withhold the grade
    if completeness < 0.4:
        composite = None

    grade, verdict = _grade_of(composite)

    # --- Named-score badges ---
    altman_metric = next((m for m in health["metrics"] if m["key"] == "altman_z"), None)
    altman_val = altman_metric["value"] if altman_metric else None
    if altman_val is None:
        altman_band = "n/a"
    elif altman_val > 2.99:
        altman_band = "safe"
    elif altman_val >= 1.81:
        altman_band = "grey"
    else:
        altman_band = "distress"

    if piotroski is None:
        piotroski_band = "n/a"
    elif piotroski >= 7:
        piotroski_band = "strong"
    elif piotroski >= 4:
        piotroski_band = "moderate"
    else:
        piotroski_band = "weak"

    caveats = []
    if is_financial:
        caveats.append("Financial-sector company: Altman Z, current ratio, D/E and interest coverage are replaced with bank-appropriate health metrics.")
    if not is_financial and altman_val is None:
        caveats.append("Altman Z-Score unavailable (missing balance-sheet items).")
    if piotroski is None:
        caveats.append("Piotroski F-Score unavailable (needs two years of complete statements).")
    if composite is None:
        caveats.append("Insufficient financial data to compute a reliable grade.")

    return {
        "composite_score": composite,
        "grade": grade,
        "verdict": verdict,
        "pillars": pillars,
        "named_scores": {
            "piotroski_f": {"value": piotroski, "max": 9, "band": piotroski_band},
            "altman_z": {"value": round(altman_val, 2) if altman_val is not None else None, "band": altman_band, "applicable": not is_financial},
        },
        "profile": profile,
        "data_completeness": completeness,
        "years_used": len(annual_data_list or []),
        "caveats": caveats,
    }


def _piotroski_f(fin, bs, cf):
    """
    Compute the 9-point Piotroski F-Score from current (col 0) vs prior (col 1) year.
    Returns an int 0-9, or None if any component cannot be computed.
    """
    ni0, ni1 = _raw(fin, _NI_KEYS, 0), _raw(fin, _NI_KEYS, 1)
    ta0, ta1 = _raw(bs, _TA_KEYS, 0), _raw(bs, _TA_KEYS, 1)
    ocf0 = _raw(cf, _OCF_KEYS, 0)
    debt0, debt1 = _raw(bs, _DEBT_KEYS, 0), _raw(bs, _DEBT_KEYS, 1)
    ca0, cl0 = _raw(bs, _CA_KEYS, 0), _raw(bs, _CL_KEYS, 0)
    ca1, cl1 = _raw(bs, _CA_KEYS, 1), _raw(bs, _CL_KEYS, 1)
    sh0, sh1 = _raw(bs, _SHARES_KEYS, 0), _raw(bs, _SHARES_KEYS, 1)
    gp0, gp1 = _raw(fin, _GP_KEYS, 0), _raw(fin, _GP_KEYS, 1)
    rev0, rev1 = _raw(fin, _REV_KEYS, 0), _raw(fin, _REV_KEYS, 1)

    # Guard denominators
    if not (ta0 and ta0 > 0 and ta1 and ta1 > 0 and rev0 and rev0 > 0 and rev1 and rev1 > 0
            and cl0 and cl0 > 0 and cl1 and cl1 > 0):
        return None
    if None in (ni0, ni1, ocf0, debt0, debt1, ca0, ca1, sh0, sh1, gp0, gp1):
        return None

    roa0, roa1 = ni0 / ta0, ni1 / ta1
    cr0, cr1 = ca0 / cl0, ca1 / cl1
    lev0, lev1 = debt0 / ta0, debt1 / ta1
    gm0, gm1 = gp0 / rev0, gp1 / rev1
    at0, at1 = rev0 / ta0, rev1 / ta1

    f = 0
    f += 1 if ni0 > 0 else 0            # 1. positive net income
    f += 1 if ocf0 > 0 else 0           # 2. positive operating cash flow
    f += 1 if roa0 > roa1 else 0        # 3. improving ROA
    f += 1 if ocf0 > ni0 else 0         # 4. accruals: OCF > net income
    f += 1 if lev0 < lev1 else 0        # 5. falling leverage
    f += 1 if cr0 > cr1 else 0          # 6. rising current ratio
    f += 1 if sh0 <= sh1 else 0         # 7. no dilution
    f += 1 if gm0 > gm1 else 0          # 8. rising gross margin
    f += 1 if at0 > at1 else 0          # 9. rising asset turnover
    return f


def get_stock_data(symbol: str):
    """
    Fetches full stock data from yfinance and performs standard preprocessing.
    """
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        
        # Safe info extraction
        name = info.get("longName") or info.get("shortName") or symbol
        
        # Fallback to history close if currentPrice isn't in info
        current_price = safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
        if current_price == 0.0:
            hist = ticker.history(period="1d")
            if not hist.empty:
                current_price = safe_float(hist["Close"].iloc[-1])
                
        currency = info.get("currency", "USD")
        # Deduce currency if possible
        if symbol.endswith(".NS") or symbol.endswith(".BO"):
            currency = "INR"
            
        shares_outstanding = safe_int(info.get("sharesOutstanding"))
        
        # If shares outstanding is missing from info, try getting from latest balance sheet
        if shares_outstanding == 0:
            bal_sheet = ticker.balance_sheet
            if not bal_sheet.empty and "Ordinary Shares Number" in bal_sheet.index:
                shares_outstanding = safe_int(bal_sheet.loc["Ordinary Shares Number"].iloc[0])
            elif not bal_sheet.empty and "Share Issued" in bal_sheet.index:
                shares_outstanding = safe_int(bal_sheet.loc["Share Issued"].iloc[0])
        
        market_cap = safe_float(info.get("marketCap") or (current_price * shares_outstanding))

        # yfinance returns an empty/placeholder object for unknown tickers instead of
        # raising. Detect that case and surface a proper "not found" error so the
        # frontend shows a clean message rather than rendering an empty, broken dashboard.
        if current_price == 0.0 and shares_outstanding == 0 and market_cap == 0.0:
            return {
                "status": "error",
                "message": f"No data found for '{symbol}'. Check the ticker symbol "
                           f"(US tickers e.g. AAPL; Indian tickers need a .NS or .BO suffix, e.g. RELIANCE.NS)."
            }

        # Currency reconciliation: some companies (e.g. Infosys/INFY.NS) report their
        # financial statements in a different currency (USD) than their share price (INR).
        # We may need to convert statement money into the price currency for a coherent DCF.
        financial_currency = info.get("financialCurrency") or currency
        fx_rate_candidate = 1.0
        if financial_currency and financial_currency != currency:
            try:
                fx_info = yf.Ticker(f"{financial_currency}{currency}=X").info
                fx_rate_candidate = safe_float(fx_info.get("regularMarketPrice") or fx_info.get("previousClose"))
                if fx_rate_candidate <= 0:
                    fx_rate_candidate = 1.0
            except Exception:
                fx_rate_candidate = 1.0
        fx_rate = 1.0  # decided below, after we can sanity-check magnitudes

        # Fetch statements
        annual_financials = ticker.financials
        annual_balance_sheet = ticker.balance_sheet
        annual_cashflow = ticker.cashflow

        q_financials = ticker.quarterly_financials
        q_balance_sheet = ticker.quarterly_balance_sheet
        q_cashflow = ticker.quarterly_cashflow

        # yfinance's `financialCurrency` is unreliable: some tickers (e.g. HCLTECH.NS)
        # are tagged USD but actually report INR-magnitude numbers, so blindly applying
        # the FX rate inflates the valuation ~80x. Verify empirically before converting:
        # compare implied P/E (market cap / net income) with and without conversion
        # against the reported trailing P/E, and only convert if it genuinely fits better.
        if fx_rate_candidate != 1.0:
            ni_raw = get_row_value(annual_financials, ["Net Income"], 0)
            if ni_raw and ni_raw > 0 and market_cap > 0:
                pe_raw = market_cap / ni_raw
                pe_fx = market_cap / (ni_raw * fx_rate_candidate)
                trailing_pe = safe_float(info.get("trailingPE"))
                if trailing_pe and trailing_pe > 0:
                    apply_fx = abs(pe_fx - trailing_pe) < abs(pe_raw - trailing_pe)
                else:
                    # No P/E to anchor on: convert only if it moves an absurd P/E into a plausible band
                    apply_fx = (2 <= pe_fx <= 150) and not (2 <= pe_raw <= 150)
                fx_rate = fx_rate_candidate if apply_fx else 1.0
            else:
                fx_rate = fx_rate_candidate  # cannot verify; fall back to the reported label

        # Extracted Balance Sheet items (Latest)
        # 1. Cash & Equivalents
        cash_keys = [
            "Cash Cash Equivalents And Short Term Investments",
            "Cash And Cash Equivalents",
            "Cash Financial",
            "Cash Cash Equivalents And Marketable Securities"
        ]
        cash = get_row_value(annual_balance_sheet, cash_keys)
        # If missing from annual, try quarterly balance sheet
        if cash == 0.0:
            cash = get_row_value(q_balance_sheet, cash_keys)
            
        # 2. Total Debt
        debt_keys = ["Total Debt", "Net Debt"]
        debt = get_row_value(annual_balance_sheet, debt_keys)
        if debt == 0.0:
            debt = get_row_value(q_balance_sheet, debt_keys)
            
        # 3. Book Value / Stockholders Equity
        equity_keys = ["Common Stock Equity", "Stockholders Equity", "Total Equity Gross Minority Interest"]
        equity = get_row_value(annual_balance_sheet, equity_keys)

        # Convert balance-sheet money into the price currency
        cash *= fx_rate
        debt *= fx_rate
        equity *= fx_rate

        # Extract annual trend for calculations (e.g. latest 4 years)
        annual_data_list = []
        if not annual_financials.empty:
            cols = annual_financials.columns
            for i, col in enumerate(cols):
                date_str = str(col.date()) if hasattr(col, "date") else str(col)
                
                # Fetch row metrics for this period (converted into the price currency)
                net_income = get_row_value(annual_financials, ["Net Income"], i) * fx_rate

                # Cashflow metrics
                operating_cash_flow = get_row_value(annual_cashflow, ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"], i) * fx_rate
                capex = get_row_value(annual_cashflow, ["Capital Expenditure", "Purchase Of PPE"], i) * fx_rate
                depreciation = get_row_value(annual_cashflow, ["Depreciation And Amortization", "Depreciation Amortization Depletion", "Depreciation"], i) * fx_rate

                # Calculate Free Cash Flow (Capex is negative in yfinance, so we use abs or verify sign)
                capex_val = abs(capex)
                fcf = operating_cash_flow - capex_val
                
                # Calculate Owner Earnings: Net Income + Depreciation - Capex
                owner_earnings = net_income + depreciation - capex_val
                
                annual_data_list.append({
                    "date": date_str,
                    "net_income": net_income,
                    "operating_cash_flow": operating_cash_flow,
                    "capex": capex,
                    "depreciation": depreciation,
                    "free_cash_flow": fcf,
                    "owner_earnings": owner_earnings
                })
                
        # Calculate growth averages if we have multiple years
        oe_growth = 0.08  # Default conservative growth rate (8%)
        if len(annual_data_list) >= 2:
            growths = []
            # Calculate year-over-year growth of Owner Earnings
            for idx in range(len(annual_data_list) - 1):
                prev = annual_data_list[idx + 1]["owner_earnings"]
                curr = annual_data_list[idx]["owner_earnings"]
                if prev > 0:
                    g = (curr - prev) / prev
                    growths.append(g)
            if growths:
                # Cap default calculated growth between 3% and 15% to be conservative
                avg_g = float(np.mean(growths))
                oe_growth = max(0.03, min(0.15, avg_g))
                
        # Owner Earnings base for DCF: normalize over up to the last 3 years to
        # smooth one-off spikes (e.g. Amazon's capex surges). Mirrors the frontend.
        latest_owner_earnings = 0.0
        if annual_data_list:
            recent = annual_data_list[:3]
            avg = lambda key: sum(r[key] for r in recent) / len(recent)
            latest_owner_earnings = avg("owner_earnings")
            # If normalized owner earnings is negative or zero, fall back to FCF, then Net Income
            if latest_owner_earnings <= 0:
                latest_owner_earnings = max(0.0, avg("free_cash_flow"))
            if latest_owner_earnings <= 0:
                latest_owner_earnings = max(0.0, avg("net_income"))
                
        # Default baseline calculation
        # 10% discount rate, 8% growth, 2.5% terminal growth, 30% margin of safety
        baseline_growth = oe_growth
        baseline_dcf = calculate_dcf(
            current_price=current_price,
            shares_outstanding=shares_outstanding,
            owner_earnings_base=latest_owner_earnings,
            growth_rate_1_5=baseline_growth,
            growth_rate_6_10=baseline_growth * 0.8, # slow down slightly in years 6-10
            discount_rate=0.10,
            terminal_growth_rate=0.025,
            cash=cash,
            debt=debt,
            margin_of_safety=0.30
        )
        
        # Quote timestamp from Yahoo (epoch seconds) -> ISO 8601 UTC
        quote_ts = info.get("regularMarketTime")
        quote_time_iso = None
        if isinstance(quote_ts, (int, float)) and quote_ts > 0:
            quote_time_iso = datetime.fromtimestamp(quote_ts, tz=timezone.utc).isoformat()

        # Trailing returns over long horizons (for periodic, long-term investors)
        try:
            # 2y so the 1-year anchor date always has a prior close available
            perf_hist = ticker.history(period="2y")
        except Exception:
            perf_hist = None
        performance = compute_performance(perf_hist, current_price)

        market_meta = {
            "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
            "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
            "performance": performance,
            "exchange": info.get("fullExchangeName") or info.get("exchange"),
            "quote_time": quote_time_iso,
        }

        # Package full response
        return {
            "status": "success",
            "data_source": "Yahoo Finance (yfinance)",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "market_data": market_meta,
            "financial_currency": financial_currency,
            "fx_rate_applied": fx_rate if fx_rate != 1.0 else None,
            "symbol": symbol,
            "name": name,
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "website": info.get("website"),
            "summary": info.get("longBusinessSummary"),
            "currency": currency,
            "current_price": current_price,
            "market_cap": market_cap,
            "pe_ratio": info.get("trailingPE"),
            "forward_pe": info.get("forwardPE"),
            "pb_ratio": info.get("priceToBook"),
            "dividend_yield": info.get("dividendYield"),
            "shares_outstanding": shares_outstanding,
            "balance_sheet_latest": {
                "cash_and_equivalents": cash,
                "total_debt": debt,
                "common_equity": equity
            },
            "annual_trends": annual_data_list,
            "quality": compute_quality_score(
                annual_financials,
                annual_balance_sheet,
                annual_cashflow,
                annual_data_list,
                fx_rate,
                info.get("sector"),
                market_cap,
            ),
            "financials_statements": {
                "income_statement_annual": extract_statement_data(annual_financials, fx_rate),
                "income_statement_quarterly": extract_statement_data(q_financials, fx_rate),
                "balance_sheet_annual": extract_statement_data(annual_balance_sheet, fx_rate),
                "balance_sheet_quarterly": extract_statement_data(q_balance_sheet, fx_rate),
                "cash_flow_annual": extract_statement_data(annual_cashflow, fx_rate),
                "cash_flow_quarterly": extract_statement_data(q_cashflow, fx_rate)
            },
            "baseline_valuation": baseline_dcf,
            "calculated_growth_rate": baseline_growth
        }
        
    except Exception as e:
        print(f"Error fetching data for {symbol}: {str(e)}")
        traceback.print_exc()
        return {
            "status": "error",
            "message": f"Error fetching stock data: {str(e)}"
        }

if __name__ == "__main__":
    # Test execution
    res = get_stock_data("AAPL")
    print("AAPL current price:", res.get("current_price"))
    print("AAPL baseline valuation intrinsic value per share:", res.get("baseline_valuation", {}).get("intrinsic_value_per_share"))
    
    res_in = get_stock_data("RELIANCE.NS")
    print("RELIANCE current price:", res_in.get("current_price"))
    print("RELIANCE baseline valuation intrinsic value per share:", res_in.get("baseline_valuation", {}).get("intrinsic_value_per_share"))
