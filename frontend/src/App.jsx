import React, { useState, useEffect } from 'react';

// Format numbers nicely (e.g., Millions, Billions, Crores for Indian currency)
const formatCurrency = (val, currency = 'USD') => {
  if (val === null || val === undefined) return 'N/A';
  
  if (currency === 'INR') {
    // Standard Indian numbering format (Lakhs, Crores)
    // 1 Crore = 10,000,000
    const absVal = Math.abs(val);
    if (absVal >= 10000000) {
      return `₹${(val / 10000000).toFixed(2)} Cr`;
    } else if (absVal >= 100000) {
      return `₹${(val / 100000).toFixed(2)} L`;
    }
    return `₹${val.toLocaleString('en-IN')}`;
  } else {
    // US formatting (Millions, Billions)
    const absVal = Math.abs(val);
    if (absVal >= 1000000000) {
      return `$${(val / 1000000000).toFixed(2)}B`;
    } else if (absVal >= 1000000) {
      return `$${(val / 1000000).toFixed(2)}M`;
    }
    return `$${val.toLocaleString('en-US')}`;
  }
};

const formatPrice = (val, currency = 'USD') => {
  if (val === null || val === undefined) return 'N/A';
  return currency === 'INR'
    ? `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Render an ISO timestamp in the viewer's local timezone, e.g. "Jul 20, 2026, 10:19 PM IST"
const formatTimestamp = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
};

function App() {
  const [query, setQuery] = useState('');
  const [stockData, setStockData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('modeler'); // modeler, financials, explainer
  const [financialSubTab, setFinancialSubTab] = useState('annual_trends'); // annual_trends, income_stmt, balance_sht, cash_flow
  const [financialPeriodType, setFinancialPeriodType] = useState('annual'); // annual or quarterly

  // Sliders State for DCF Modeler
  const [growthRate15, setGrowthRate15] = useState(0.08);
  const [growthRate610, setGrowthRate610] = useState(0.06);
  const [discountRate, setDiscountRate] = useState(0.10);
  const [terminalGrowthRate, setTerminalGrowthRate] = useState(0.025);
  const [marginOfSafety, setMarginOfSafety] = useState(0.30);
  const [maintenanceCapexPct, setMaintenanceCapexPct] = useState(100); // Slider 0 - 100%

  // Local calculation result state
  const [valuationResult, setValuationResult] = useState(null);

  // Selected market: 'US' or 'IN'. Drives ticker resolution and quick picks.
  const [market, setMarket] = useState('US');

  // Per-market config: quick picks use bare tickers; suffix is added on resolve.
  const MARKETS = {
    US: {
      label: '🇺🇸 US',
      placeholder: 'Enter a US ticker (e.g. AAPL, MSFT, TSLA)',
      popular: ['AAPL', 'MSFT', 'TSLA', 'GOOGL', 'AMZN', 'NVDA'],
    },
    IN: {
      label: '🇮🇳 India',
      placeholder: 'Enter an Indian ticker (e.g. INFY, RELIANCE, TCS)',
      popular: ['INFY', 'RELIANCE', 'TCS', 'HDFCBANK', 'ITC', 'TATAMOTORS'],
    },
  };

  // Resolve a user-entered symbol to what Yahoo Finance expects.
  // India: append .NS (NSE) unless the user already typed an exchange suffix.
  const resolveSymbol = (raw) => {
    const clean = raw.trim().toUpperCase();
    if (market === 'IN' && !clean.endsWith('.NS') && !clean.endsWith('.BO')) {
      return `${clean}.NS`;
    }
    return clean;
  };

  // Handle stock fetch (accepts a bare, user-entered symbol; resolves it first)
  const fetchStock = async (rawSymbol) => {
    setLoading(true);
    setError('');
    setStockData(null);
    try {
      const cleanSymbol = resolveSymbol(rawSymbol);
      const apiBaseUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '');
      const response = await fetch(`${apiBaseUrl}/api/stock/${cleanSymbol}`);
      if (!response.ok) {
        const errDetail = await response.json();
        throw new Error(errDetail.detail || 'Stock not found');
      }
      const data = await response.json();
      setStockData(data);
      
      // Initialize sliders based on backend baseline
      const baseGrowth = data.calculated_growth_rate || 0.08;
      setGrowthRate15(baseGrowth);
      setGrowthRate610(Number((baseGrowth * 0.8).toFixed(4))); // 80% of phase 1 growth
      setDiscountRate(0.10);
      setTerminalGrowthRate(0.025);
      setMarginOfSafety(0.30);
      setMaintenanceCapexPct(100);
      
    } catch (err) {
      setError(err.message || 'Failed to fetch stock data. Make sure backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (query) {
      fetchStock(query);
    }
  };

  // Recalculate DCF locally when sliders change
  useEffect(() => {
    if (!stockData) return;
    
    const shares = stockData.shares_outstanding;
    const balanceInfo = stockData.balance_sheet_latest;
    const currentPrice = stockData.current_price;
    
    if (!shares || shares <= 0) {
      setValuationResult({
        status: 'error',
        message: 'Missing shares outstanding information.'
      });
      return;
    }

    const latestAnnual = stockData.annual_trends && stockData.annual_trends.length > 0 
      ? stockData.annual_trends[0] 
      : null;

    if (!latestAnnual) {
      setValuationResult({
        status: 'error',
        message: 'Missing annual financial trends.'
      });
      return;
    }

    const netIncome = latestAnnual.net_income;
    const depreciation = latestAnnual.depreciation;
    const capex = Math.abs(latestAnnual.capex);
    
    // Scale CapEx based on Maintenance CapEx slider
    const scaledCapex = capex * (maintenanceCapexPct / 100);
    let ownerEarningsBase = netIncome + depreciation - scaledCapex;
    
    let fallbackUsed = '';
    // If owner earnings base is negative, fallback to Free Cash Flow
    if (ownerEarningsBase <= 0) {
      ownerEarningsBase = Math.max(0, latestAnnual.free_cash_flow);
      fallbackUsed = 'Free Cash Flow fallback (Owner earnings negative)';
    }
    // If FCF is also negative, fallback to Net Income
    if (ownerEarningsBase <= 0) {
      ownerEarningsBase = Math.max(0, netIncome);
      fallbackUsed = 'Net Income fallback (Owner earnings & FCF negative)';
    }

    // Project Cash Flows (Years 1-10)
    const projectedFlows = [];
    let currentFlow = ownerEarningsBase;

    // Years 1 to 5
    for (let yr = 1; yr <= 5; yr++) {
      currentFlow = currentFlow * (1 + growthRate15);
      projectedFlows.push(currentFlow);
    }
    // Years 6 to 10
    for (let yr = 6; yr <= 10; yr++) {
      currentFlow = currentFlow * (1 + growthRate610);
      projectedFlows.push(currentFlow);
    }

    // Discount factors and Present Values
    const pvFactors = [];
    const pvFlows = [];
    for (let yr = 1; yr <= 10; yr++) {
      const factor = 1 / Math.pow(1 + discountRate, yr);
      pvFactors.push(factor);
      pvFlows.push(projectedFlows[yr - 1] * factor);
    }
    const sumPvFlows = pvFlows.reduce((sum, val) => sum + val, 0);

    // Terminal Value at Year 10
    const cf10 = projectedFlows[9];
    let diff = discountRate - terminalGrowthRate;
    if (diff <= 0) diff = 0.01; // Avoid division by zero/negative
    
    const terminalValue = (cf10 * (1 + terminalGrowthRate)) / diff;
    const pvTerminalValue = terminalValue * pvFactors[9];

    // Enterprise Value
    const intrinsicValueCompany = sumPvFlows + pvTerminalValue;
    const cash = balanceInfo.cash_and_equivalents || 0;
    const debt = balanceInfo.total_debt || 0;

    // Intrinsic Value of Equity
    const intrinsicValueEquity = intrinsicValueCompany + cash - debt;
    
    // Per Share Value
    const intrinsicValuePerShare = intrinsicValueEquity / shares;
    
    // Target price with margin of safety
    const buyTargetPrice = intrinsicValuePerShare * (1 - marginOfSafety);

    // Recommendation logic
    let recommendation = 'OVERVALUED';
    let recClass = 'sell';
    if (currentPrice <= buyTargetPrice) {
      recommendation = 'BUY';
      recClass = 'buy';
    } else if (currentPrice <= intrinsicValuePerShare) {
      recommendation = 'FAIR VALUE / HOLD';
      recClass = 'hold';
    }

    const upsideDownsidePct = currentPrice > 0 
      ? ((intrinsicValuePerShare - currentPrice) / currentPrice) * 100 
      : 0;

    const projections = [];
    for (let yr = 1; yr <= 10; yr++) {
      projections.push({
        year: yr,
        projectedCashFlow: projectedFlows[yr - 1],
        presentValue: pvFlows[yr - 1]
      });
    }

    setValuationResult({
      status: 'success',
      intrinsicValueCompany,
      intrinsicValueEquity,
      intrinsicValuePerShare,
      buyTargetPrice,
      upsideDownsidePct,
      recommendation,
      recClass,
      projections,
      sumPvFlows,
      terminalValue,
      pvTerminalValue,
      ownerEarningsBase,
      fallbackUsed
    });

  }, [stockData, growthRate15, growthRate610, discountRate, terminalGrowthRate, marginOfSafety, maintenanceCapexPct]);

  // Handle key metric labels mapping
  const getStatementData = () => {
    if (!stockData || !stockData.financials_statements) return [];
    
    const { financials_statements } = stockData;
    switch (financialSubTab) {
      case 'income_stmt':
        return financialPeriodType === 'annual' 
          ? financials_statements.income_statement_annual 
          : financials_statements.income_statement_quarterly;
      case 'balance_sht':
        return financialPeriodType === 'annual' 
          ? financials_statements.balance_sheet_annual 
          : financials_statements.balance_sheet_quarterly;
      case 'cash_flow':
        return financialPeriodType === 'annual' 
          ? financials_statements.cash_flow_annual 
          : financials_statements.cash_flow_quarterly;
      default:
        return [];
    }
  };

  const getStatementKeys = (dataList) => {
    if (!dataList || dataList.length === 0) return [];
    // Extract keys, but make sure "date" is excluded
    const keys = Object.keys(dataList[0]).filter(k => k !== 'date');
    return keys;
  };

  return (
    <div className="app-container">
      <header>
        <div className="logo">
          🚀 Stock<span>Pricer</span>
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Warren Buffett Intrinsic Value Model (US & India)
        </div>
      </header>

      <main>
        {/* Search Widget */}
        <div className="search-container">
          {/* Market toggle: US vs India */}
          <div className="market-toggle">
            {Object.keys(MARKETS).map((key) => (
              <button
                key={key}
                type="button"
                className={`market-toggle-btn ${market === key ? 'active' : ''}`}
                onClick={() => setMarket(key)}
              >
                {MARKETS[key].label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSearchSubmit} className="search-box">
            <input
              type="text"
              placeholder={MARKETS[market].placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="search-input"
            />
            <button type="submit" className="search-button" disabled={loading}>
              {loading ? 'Fetching...' : 'Analyze'}
            </button>
          </form>
          <div className="popular-searches">
            <span>Quick {market === 'IN' ? 'Indian' : 'US'} Stocks:</span>
            {MARKETS[market].popular.map((ticker) => (
              <span
                key={ticker}
                className="popular-tag"
                onClick={() => {
                  setQuery(ticker);
                  fetchStock(ticker);
                }}
              >
                {ticker}
              </span>
            ))}
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}
        {loading && <div className="spinner"></div>}

        {stockData && (
          <>
            {/* Overview Card */}
            <div className="card">
              <div className="company-header">
                <div className="company-title-area">
                  <h2>
                    {stockData.name}
                    <span className="ticker-badge">{stockData.symbol}</span>
                  </h2>
                  <div className="sector-tag">
                    {stockData.sector} • {stockData.industry}
                  </div>
                </div>
                <div className="price-display">
                  <div className="price-amount">
                    {formatPrice(stockData.current_price, stockData.currency)}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Price ({stockData.currency})
                  </div>
                  {stockData.market_data && formatTimestamp(stockData.market_data.quote_time) && (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                      Quote as of {formatTimestamp(stockData.market_data.quote_time)}
                    </div>
                  )}
                </div>
              </div>

              <div className="metadata-grid">
                <div className="metadata-item">
                  <div className="metadata-label">Market Cap</div>
                  <div className="metadata-value">{formatCurrency(stockData.market_cap, stockData.currency)}</div>
                </div>
                <div className="metadata-item">
                  <div className="metadata-label">Shares Outstanding</div>
                  <div className="metadata-value">{(stockData.shares_outstanding / 1e9).toFixed(3)} Billion</div>
                </div>
                <div className="metadata-item">
                  <div className="metadata-label">PE Ratio</div>
                  <div className="metadata-value">{stockData.pe_ratio ? stockData.pe_ratio.toFixed(2) : 'N/A'}</div>
                </div>
                <div className="metadata-item">
                  <div className="metadata-label">PB Ratio</div>
                  <div className="metadata-value">{stockData.pb_ratio ? stockData.pb_ratio.toFixed(2) : 'N/A'}</div>
                </div>
                {stockData.market_data && (stockData.market_data.fifty_two_week_low || stockData.market_data.fifty_two_week_high) && (
                  <div className="metadata-item">
                    <div className="metadata-label">52-Week Range</div>
                    <div className="metadata-value">
                      {formatPrice(stockData.market_data.fifty_two_week_low, stockData.currency)} – {formatPrice(stockData.market_data.fifty_two_week_high, stockData.currency)}
                    </div>
                  </div>
                )}
              </div>

              {stockData.market_data && stockData.market_data.performance && (
                <div className="metadata-grid" style={{ marginTop: '1rem' }}>
                  {[
                    { key: '1M', label: '1-Month Return' },
                    { key: '6M', label: '6-Month Return' },
                    { key: '1Y', label: '1-Year Return' },
                    { key: 'YTD', label: 'YTD Return' },
                  ].map(({ key, label }) => {
                    const val = stockData.market_data.performance[key];
                    const has = val !== null && val !== undefined;
                    return (
                      <div className="metadata-item" key={key}>
                        <div className="metadata-label">{label}</div>
                        <div className="metadata-value" style={{ color: !has ? 'var(--text-muted)' : (val >= 0 ? 'var(--color-buy)' : 'var(--color-sell)') }}>
                          {has ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}%` : 'N/A'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Source: {stockData.data_source || 'Yahoo Finance'}
                {stockData.market_data && stockData.market_data.exchange && <> • {stockData.market_data.exchange}</>}
                {' '}• Live prices may be delayed up to ~15 min. Financial statements reflect the latest reported filings.
                {stockData.fx_rate_applied && (
                  <> • Financials reported in {stockData.financial_currency}, converted to {stockData.currency} at {stockData.fx_rate_applied.toFixed(2)}.</>
                )}
                {formatTimestamp(stockData.fetched_at) && <> • Fetched {formatTimestamp(stockData.fetched_at)}</>}
              </div>
            </div>

            {/* Main Tabs Navigation */}
            <div className="tab-container">
              <div className="tab-header">
                <button
                  className={`tab-btn ${activeTab === 'modeler' ? 'active' : ''}`}
                  onClick={() => setActiveTab('modeler')}
                >
                  📊 Intrinsic Value Modeler
                </button>
                <button
                  className={`tab-btn ${activeTab === 'financials' ? 'active' : ''}`}
                  onClick={() => setActiveTab('financials')}
                >
                  📁 Financial Statements
                </button>
                <button
                  className={`tab-btn ${activeTab === 'explainer' ? 'active' : ''}`}
                  onClick={() => setActiveTab('explainer')}
                >
                  📖 Buffett's Formula Explained
                </button>
              </div>

              {/* MODELER TAB */}
              {activeTab === 'modeler' && valuationResult && valuationResult.status === 'error' && (
                <div className="card">
                  <div className="error-message">
                    ⚠️ Unable to build a valuation model for this stock. {valuationResult.message}
                    {' '}Yahoo Finance may not expose enough financial history for this ticker.
                    Try a large-cap ticker (e.g. AAPL, MSFT, RELIANCE.NS), or check the Financial Statements tab.
                  </div>
                </div>
              )}

              {activeTab === 'modeler' && valuationResult && valuationResult.status === 'success' && (
                <div className="dashboard-grid">
                  {/* Left Column: Sliders & Adjustments */}
                  <div className="card">
                    <div className="card-title">Valuation Model Parameters</div>
                    
                    <div className="calculator-panel">
                      {/* Slider 1: Growth Years 1-5 */}
                      <div className="slider-group">
                        <div className="slider-header">
                          <span className="slider-label">Yr 1–5 Growth Rate</span>
                          <span className="slider-value">{(growthRate15 * 100).toFixed(1)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="0.4"
                          step="0.005"
                          value={growthRate15}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setGrowthRate15(val);
                            // Scale year 6-10 growth down proportionally as a convenience
                            setGrowthRate610(Number((val * 0.8).toFixed(4)));
                          }}
                          className="slider-input"
                        />
                      </div>

                      {/* Slider 2: Growth Years 6-10 */}
                      <div className="slider-group">
                        <div className="slider-header">
                          <span className="slider-label">Yr 6–10 Growth Rate</span>
                          <span className="slider-value">{(growthRate610 * 100).toFixed(1)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="0.3"
                          step="0.005"
                          value={growthRate610}
                          onChange={(e) => setGrowthRate610(parseFloat(e.target.value))}
                          className="slider-input"
                        />
                      </div>

                      {/* Slider 3: Discount Rate */}
                      <div className="slider-group">
                        <div className="slider-header">
                          <span className="slider-label">Required Return (Discount Rate)</span>
                          <span className="slider-value">{(discountRate * 100).toFixed(1)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="0.25"
                          step="0.005"
                          value={discountRate}
                          onChange={(e) => setDiscountRate(parseFloat(e.target.value))}
                          className="slider-input"
                        />
                      </div>

                      {/* Slider 4: Terminal Growth Rate */}
                      <div className="slider-group">
                        <div className="slider-header">
                          <span className="slider-label">Terminal Growth Rate (GDP cap)</span>
                          <span className="slider-value">{(terminalGrowthRate * 100).toFixed(1)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="0.06"
                          step="0.002"
                          value={terminalGrowthRate}
                          onChange={(e) => setTerminalGrowthRate(parseFloat(e.target.value))}
                          className="slider-input"
                        />
                      </div>

                      {/* Slider 5: Margin of Safety */}
                      <div className="slider-group">
                        <div className="slider-header">
                          <span className="slider-label">Margin of Safety</span>
                          <span className="slider-value">{(marginOfSafety * 100).toFixed(0)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.1"
                          max="0.5"
                          step="0.05"
                          value={marginOfSafety}
                          onChange={(e) => setMarginOfSafety(parseFloat(e.target.value))}
                          className="slider-input"
                        />
                      </div>

                      {/* Slider 6: Maintenance CapEx Slider */}
                      <div className="slider-group">
                        <div className="slider-header">
                          <span className="slider-label">Maintenance Capital Expenditure Scale</span>
                          <span className="slider-value">{maintenanceCapexPct}%</span>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.2rem' }}>
                          Buffett subtracts only the Capital Expenditure needed to maintain competitive position (Maintenance CapEx). 100% means total CapEx is subtracted. Lowering this increases Owner Earnings.
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="100"
                          step="5"
                          value={maintenanceCapexPct}
                          onChange={(e) => setMaintenanceCapexPct(parseInt(e.target.value))}
                          className="slider-input"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Valuation Results */}
                  <div className="calculator-panel">
                    <div className="card results-card">
                      <div className="card-title" style={{ justifyContent: 'center' }}>Buffett Valuation Decision</div>
                      
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Recommendation:</div>
                      <div className={`badge-recommendation ${valuationResult.recClass}`}>
                        {valuationResult.recommendation}
                      </div>

                      <div className="results-grid">
                        <div className="result-box">
                          <div className="metadata-label" style={{ color: 'var(--color-buy)' }}>Target Buy Price</div>
                          <div className="result-val buy-val">
                            {formatPrice(valuationResult.buyTargetPrice, stockData.currency)}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            With {marginOfSafety * 100}% Margin of Safety
                          </div>
                        </div>
                        <div className="result-box">
                          <div className="metadata-label">Intrinsic Value</div>
                          <div className="result-val intrinsic-val">
                            {formatPrice(valuationResult.intrinsicValuePerShare, stockData.currency)}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Base OE: {formatCurrency(valuationResult.ownerEarningsBase, stockData.currency)}
                          </div>
                        </div>
                      </div>

                      <div style={{ fontSize: '1rem', fontWeight: 600 }}>
                        Current Price is {' '}
                        <span style={{ color: valuationResult.upsideDownsidePct > 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                          {Math.abs(valuationResult.upsideDownsidePct).toFixed(1)}% 
                          {valuationResult.upsideDownsidePct > 0 ? ' below ' : ' above '}
                        </span>
                        the calculated Intrinsic Value.
                      </div>
                      
                      {valuationResult.fallbackUsed && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-hold)', marginTop: '0.8rem', fontStyle: 'italic' }}>
                          ⚠️ {valuationResult.fallbackUsed}
                        </div>
                      )}
                    </div>

                    {/* Projected Cash Flow visual Chart */}
                    <div className="card">
                      <div className="card-title">10-Year Projected Owner Earnings (PV)</div>
                      <div className="chart-bar-container">
                        {valuationResult.projections.map((p) => {
                          // Find max present value to scale height
                          const maxPv = Math.max(...valuationResult.projections.map(x => x.presentValue));
                          const heightPct = maxPv > 0 ? (p.presentValue / maxPv) * 100 : 0;
                          return (
                            <div key={p.year} className="chart-bar-group">
                              <div 
                                className="chart-bar" 
                                style={{ height: `${Math.max(5, heightPct)}%` }}
                                title={`Yr ${p.year}: OE: ${formatCurrency(p.projectedCashFlow, stockData.currency)} (PV: ${formatCurrency(p.presentValue, stockData.currency)})`}
                              />
                              <div className="chart-label">Yr {p.year}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                        <span>Sum of 10-Yr PV: {formatCurrency(valuationResult.sumPvFlows, stockData.currency)}</span>
                        <span>PV of Terminal Value: {formatCurrency(valuationResult.pvTerminalValue, stockData.currency)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* FINANCIAL STATEMENTS TAB */}
              {activeTab === 'financials' && (
                <div className="card">
                  <div className="card-title" style={{ borderBottom: 'none' }}>
                    Financial Statement Explorer
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className={`popular-tag ${financialPeriodType === 'annual' ? 'active' : ''}`}
                        style={{ background: financialPeriodType === 'annual' ? 'var(--accent-blue-glow)' : '', borderColor: financialPeriodType === 'annual' ? 'var(--accent-blue)' : '' }}
                        onClick={() => setFinancialPeriodType('annual')}
                      >
                        Annual
                      </button>
                      <button
                        className={`popular-tag ${financialPeriodType === 'quarterly' ? 'active' : ''}`}
                        style={{ background: financialPeriodType === 'quarterly' ? 'var(--accent-blue-glow)' : '', borderColor: financialPeriodType === 'quarterly' ? 'var(--accent-blue)' : '' }}
                        onClick={() => setFinancialPeriodType('quarterly')}
                      >
                        Quarterly
                      </button>
                    </div>
                  </div>

                  <div className="tab-header" style={{ marginBottom: '1.5rem' }}>
                    <button
                      className={`tab-btn ${financialSubTab === 'annual_trends' ? 'active' : ''}`}
                      onClick={() => setFinancialSubTab('annual_trends')}
                    >
                      📈 Owner Earnings & FCF Trends
                    </button>
                    <button
                      className={`tab-btn ${financialSubTab === 'income_stmt' ? 'active' : ''}`}
                      onClick={() => setFinancialSubTab('income_stmt')}
                    >
                      Income Statement
                    </button>
                    <button
                      className={`tab-btn ${financialSubTab === 'balance_sht' ? 'active' : ''}`}
                      onClick={() => setFinancialSubTab('balance_sht')}
                    >
                      Balance Sheet
                    </button>
                    <button
                      className={`tab-btn ${financialSubTab === 'cash_flow' ? 'active' : ''}`}
                      onClick={() => setFinancialSubTab('cash_flow')}
                    >
                      Cash Flow Statement
                    </button>
                  </div>

                  {financialSubTab === 'annual_trends' ? (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Period Ending</th>
                            <th>Net Income</th>
                            <th>Depreciation & Amortization</th>
                            <th>Capital Expenditure</th>
                            <th>Free Cash Flow</th>
                            <th>Owner Earnings</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockData.annual_trends.map((item) => (
                            <tr key={item.date}>
                              <td><strong>{item.date}</strong></td>
                              <td>{formatCurrency(item.net_income, stockData.currency)}</td>
                              <td>{formatCurrency(item.depreciation, stockData.currency)}</td>
                              <td style={{ color: 'var(--color-sell)' }}>
                                {formatCurrency(item.capex, stockData.currency)}
                              </td>
                              <td style={{ color: 'var(--color-buy)', fontWeight: 600 }}>
                                {formatCurrency(item.free_cash_flow, stockData.currency)}
                              </td>
                              <td style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>
                                {formatCurrency(item.owner_earnings, stockData.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      {getStatementData().length === 0 ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                          No quarterly cash flow statements available in Yahoo Finance for this ticker. 
                          {stockData.currency === 'INR' && ' Indian exchanges usually restrict quarterly cash flow publications to annual disclosures.'}
                        </div>
                      ) : (
                        <table>
                          <thead>
                            <tr>
                              <th>Metric</th>
                              {getStatementData().map((col) => (
                                <th key={col.date}>{col.date}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {getStatementKeys(getStatementData()).map((key) => (
                              <tr key={key}>
                                <td><strong>{key}</strong></td>
                                {getStatementData().map((col) => (
                                  <td key={col.date}>
                                    {col[key] !== null ? formatCurrency(col[key], stockData.currency) : '-'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* EXPLAINER TAB */}
              {activeTab === 'explainer' && (
                <div className="card">
                  <div className="card-title">Warren Buffett's Intrinsic Value Calculation</div>
                  <div className="explainer-content">
                    <p>
                      Intrinsic value represents the true economic value of a business, based on the cash flow it is projected to generate over its lifespan, discounted back to the present.
                    </p>
                    
                    <h4>1. Owner Earnings: The Core Input</h4>
                    <p>
                      Unlike normal accounting earnings (Net Income), Warren Buffett created "Owner Earnings" to reflect the actual cash flows distributable to shareholders.
                    </p>
                    <div className="formula-box">
                      Owner Earnings = Net Income + Depreciation & Amortization - Capital Expenditures (Maintenance) +/- Changes in Working Capital
                    </div>
                    <p>
                      <strong>Capital Expenditures (Maintenance):</strong> This is the cash required to maintain the company's competitive position and volume. Often, standard financial statements only report Total CapEx (including growth CapEx). In this application, you can use the slider to scale down CapEx to estimate maintenance CapEx.
                    </p>
                    
                    <h4>2. The Discount Rate (Required Return)</h4>
                    <p>
                      Money in the future is worth less than money today. Buffett uses a "risk-free rate" (like the 10-year US Treasury bond yield) when evaluating high-quality moat businesses, but usually applies a margin of safety or requires a baseline return (e.g. 10%) as a required discount rate.
                    </p>
                    
                    <h4>3. Terminal Value</h4>
                    <p>
                      Since we cannot project cash flows infinitely, we assume that after Year 10, the company grows at a stable rate equal to the rate of long-term economic growth (GDP, typically 2% to 3%).
                    </p>

                    <h4>4. Margin of Safety</h4>
                    <p>
                      Warren Buffett's mentor Benjamin Graham famously taught the "Margin of Safety". By buying the stock only if it is trading 20% to 30% below the intrinsic value, investors protect themselves against forecasting errors and market downturns.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Home Intro (Initial screen before search) */}
        {!stockData && !loading && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Evaluate Stocks like Warren Buffett</h3>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '700px', margin: '0 auto 2rem auto', lineHeight: '1.6' }}>
              Search for US companies (e.g., Apple, Microsoft, Tesla) or Indian companies (e.g., Reliance Industries, Tata Consultancy Services, Infosys) to view their quarterly/annual financial statements, play with growth sliders, and instantly calculate their intrinsic value using an interactive Discounted Cash Flow (DCF) model.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginTop: '2rem' }}>
              <div style={{ background: 'rgba(10, 12, 16, 0.4)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🇺🇸</div>
                <h4 style={{ marginBottom: '0.5rem' }}>US Exchanges</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Analyzes Nasdaq and NYSE symbols directly with full quarterly cash flow tracking.</p>
              </div>
              <div style={{ background: 'rgba(10, 12, 16, 0.4)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🇮🇳</div>
                <h4 style={{ marginBottom: '0.5rem' }}>Indian Exchanges</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Supports NSE/BSE tickers (append with .NS or .BO) utilizing annual cash flow profiles.</p>
              </div>
              <div style={{ background: 'rgba(10, 12, 16, 0.4)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚖️</div>
                <h4 style={{ marginBottom: '0.5rem' }}>Margin of Safety</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Interactive sliders recalculate targets in real-time, matching intrinsic valuations.</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
