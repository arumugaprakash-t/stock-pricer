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
        # Convert all statement-derived money into the price currency so the DCF is coherent.
        financial_currency = info.get("financialCurrency") or currency
        fx_rate = 1.0
        if financial_currency and financial_currency != currency:
            try:
                fx_info = yf.Ticker(f"{financial_currency}{currency}=X").info
                fx_rate = safe_float(fx_info.get("regularMarketPrice") or fx_info.get("previousClose"))
                if fx_rate <= 0:
                    fx_rate = 1.0
            except Exception:
                fx_rate = 1.0

        # Fetch statements
        annual_financials = ticker.financials
        annual_balance_sheet = ticker.balance_sheet
        annual_cashflow = ticker.cashflow
        
        q_financials = ticker.quarterly_financials
        q_balance_sheet = ticker.quarterly_balance_sheet
        q_cashflow = ticker.quarterly_cashflow
        
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
                
        # Latest Owner Earnings (Base for DCF)
        latest_owner_earnings = 0.0
        if annual_data_list:
            latest_owner_earnings = annual_data_list[0]["owner_earnings"]
            # If owner earnings is negative or zero, fall back to Net Income or FCF
            if latest_owner_earnings <= 0:
                latest_owner_earnings = max(0.0, annual_data_list[0]["free_cash_flow"])
            if latest_owner_earnings <= 0:
                latest_owner_earnings = max(0.0, annual_data_list[0]["net_income"])
                
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
