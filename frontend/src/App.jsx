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

// --- Quality score helpers ---
const PILLAR_LABELS = {
  profitability: 'Profitability & Returns',
  health: 'Financial Health',
  consistency: 'Consistency',
  growth: 'Growth',
};

// Map a letter grade to the app's signal palette (buy/hold/sell)
const gradeClass = (grade) => {
  if (grade === 'A' || grade === 'B') return 'buy';
  if (grade === 'C') return 'hold';
  if (grade === 'D' || grade === 'F') return 'sell';
  return 'hold';
};

// Map a 0-100 sub-score to a color
const scoreColor = (score) => {
  if (score === null || score === undefined) return 'var(--text-muted)';
  if (score >= 70) return 'var(--color-buy)';
  if (score >= 40) return 'var(--color-hold)';
  return 'var(--color-sell)';
};

const statusIcon = (status) =>
  status === 'good' ? '✅' : status === 'fair' ? '⚠️' : status === 'weak' ? '❌' : '—';

// Map a named-score band to a palette class
const bandClass = (band) => {
  if (band === 'strong' || band === 'safe') return 'buy';
  if (band === 'moderate' || band === 'grey') return 'hold';
  if (band === 'weak' || band === 'distress') return 'sell';
  return 'muted';
};

// Circular gauge for the composite quality score
const ScoreRing = ({ score, grade }) => {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const pct = score === null || score === undefined ? 0 : score;
  const color = scoreColor(score);
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" className="score-ring" role="img" aria-label={`Quality score ${score ?? 'not available'}`}>
      <circle cx="75" cy="75" r={r} fill="none" stroke="var(--border-color)" strokeWidth="11" />
      <circle
        cx="75" cy="75" r={r} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct / 100)}
        transform="rotate(-90 75 75)"
        style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.4,0,0.2,1)' }}
      />
      <text x="75" y="72" textAnchor="middle" className="score-ring-num">{score ?? '—'}</text>
      <text x="75" y="98" textAnchor="middle" className="score-ring-grade" fill={color}>{grade || 'N/A'}</text>
    </svg>
  );
};

function App() {
  const [query, setQuery] = useState('');
  const [stockData, setStockData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('quality'); // quality, modeler, financials, explainer
  const [qualityExpanded, setQualityExpanded] = useState(false); // show metric-level evidence
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

  // Opportunities board (precomputed screen)
  const [opportunities, setOpportunities] = useState(null);
  const [opportunitiesMeta, setOpportunitiesMeta] = useState(null);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(false);
  const [oppPage, setOppPage] = useState(0);
  const [oppSort, setOppSort] = useState('signal'); // signal | upside | quality
  const OPP_PAGE_SIZE = 10;

  const apiBaseUrl = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : '');

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
      const response = await fetch(`${apiBaseUrl}/api/stock/${cleanSymbol}`);

      // Read the body as text first so a non-JSON response (e.g. a plain "Not Found"
      // from a misconfigured/unreachable API) yields a clear message, not a JSON parse error.
      const raw = await response.text();
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }

      if (!response.ok) {
        throw new Error((parsed && parsed.detail) || `Stock not found (${response.status})`);
      }
      if (!parsed) {
        throw new Error('The API returned an unexpected response. The backend may be unreachable — check the API URL configuration.');
      }
      const data = parsed;
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

  // Load the Opportunities board when no stock is selected, per market filter
  useEffect(() => {
    let cancelled = false;
    const loadOpportunities = async () => {
      setOpportunitiesLoading(true);
      try {
        const res = await fetch(`${apiBaseUrl}/api/opportunities?market=${market}`);
        const data = await res.json();
        if (cancelled) return;
        setOpportunities(data.status === 'success' ? data.results : []);
        setOpportunitiesMeta(data);
        setOppPage(0);
      } catch {
        if (!cancelled) { setOpportunities([]); setOpportunitiesMeta(null); }
      } finally {
        if (!cancelled) setOpportunitiesLoading(false);
      }
    };
    loadOpportunities();
    return () => { cancelled = true; };
  }, [market, apiBaseUrl]);

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

    // Normalize the base over up to the last 3 years to smooth one-off spikes
    // (e.g. Amazon's capex surges). Average each component so the Maintenance
    // CapEx slider still applies to the normalized capex.
    const recentYears = (stockData.annual_trends || []).slice(0, 3);

    if (recentYears.length === 0) {
      setValuationResult({
        status: 'error',
        message: 'Missing annual financial trends.'
      });
      return;
    }

    const avgOf = (fn) => recentYears.reduce((sum, r) => sum + (fn(r) || 0), 0) / recentYears.length;
    const netIncome = avgOf((r) => r.net_income);
    const depreciation = avgOf((r) => r.depreciation);
    const capex = avgOf((r) => Math.abs(r.capex));

    // Scale CapEx based on Maintenance CapEx slider
    const scaledCapex = capex * (maintenanceCapexPct / 100);
    let ownerEarningsBase = netIncome + depreciation - scaledCapex;

    let fallbackUsed = '';
    // If owner earnings base is negative, fallback to Free Cash Flow (3-yr avg)
    if (ownerEarningsBase <= 0) {
      ownerEarningsBase = Math.max(0, avgOf((r) => r.free_cash_flow));
      fallbackUsed = 'Free Cash Flow fallback (Owner earnings negative)';
    }
    // If FCF is also negative, fallback to Net Income (3-yr avg)
    if (ownerEarningsBase <= 0) {
      ownerEarningsBase = Math.max(0, netIncome);
      fallbackUsed = 'Net Income fallback (Owner earnings & FCF negative)';
    }
    const yearsUsed = recentYears.length;

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
      fallbackUsed,
      yearsUsed
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

  // Board shows the full screen, sorted by recommendation (BUY → HOLD → OVERVALUED),
  // then by upside within each group. The user paginates and decides.
  const recRank = (rec) => (rec === 'BUY' ? 0 : rec && rec.startsWith('FAIR') ? 1 : 2);
  const oppComparators = {
    signal: (a, b) => (recRank(a.recommendation) - recRank(b.recommendation)) || (b.upside_pct - a.upside_pct),
    upside: (a, b) => b.upside_pct - a.upside_pct,
    quality: (a, b) => ((b.quality_score ?? -1) - (a.quality_score ?? -1)) || (b.upside_pct - a.upside_pct),
  };
  const rankedOpps = [...(opportunities || [])].sort(oppComparators[oppSort] || oppComparators.signal);
  const setOppSortKey = (key) => { setOppSort(key); setOppPage(0); };
  const oppPageCount = Math.ceil(rankedOpps.length / OPP_PAGE_SIZE);
  const oppPageRows = rankedOpps.slice(oppPage * OPP_PAGE_SIZE, oppPage * OPP_PAGE_SIZE + OPP_PAGE_SIZE);

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
                  className={`tab-btn ${activeTab === 'quality' ? 'active' : ''}`}
                  onClick={() => setActiveTab('quality')}
                >
                  🏆 Business Quality
                </button>
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

              {/* QUALITY TAB */}
              {activeTab === 'quality' && (
                <div className="card">
                  {(!stockData.quality || stockData.quality.composite_score === null || stockData.quality.composite_score === undefined) ? (
                    <>
                      <div className="card-title">Business Quality</div>
                      <div style={{ padding: '1.5rem', color: 'var(--text-secondary)' }}>
                        Not enough financial data from Yahoo Finance to grade this company's quality reliably.
                        {stockData.quality && stockData.quality.caveats && stockData.quality.caveats.map((c, i) => (
                          <div key={i} style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>• {c}</div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="card-title">Business Quality Scorecard</div>

                      {/* Header: composite ring + verdict + named-score badges */}
                      <div className="quality-header">
                        <ScoreRing score={stockData.quality.composite_score} grade={stockData.quality.grade} />
                        <div className="quality-header-info">
                          <div className={`badge-recommendation ${gradeClass(stockData.quality.grade)}`} style={{ margin: '0 0 0.5rem 0' }}>
                            {stockData.quality.verdict}
                          </div>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '460px', lineHeight: 1.5 }}>
                            A composite of profitability, financial health, consistency and growth — Buffett's
                            "wonderful business" test, judged independently of price. Higher is better.
                          </p>
                          <div className="quality-badges">
                            {stockData.quality.named_scores.piotroski_f && (
                              <div className={`quality-badge ${bandClass(stockData.quality.named_scores.piotroski_f.band)}`}>
                                Piotroski F-Score{' '}
                                <strong>
                                  {stockData.quality.named_scores.piotroski_f.value !== null
                                    ? `${stockData.quality.named_scores.piotroski_f.value}/9`
                                    : 'N/A'}
                                </strong>
                                <span className="quality-badge-band">{stockData.quality.named_scores.piotroski_f.band}</span>
                              </div>
                            )}
                            <div className={`quality-badge ${bandClass(stockData.quality.named_scores.altman_z.band)}`}>
                              Altman Z-Score{' '}
                              <strong>
                                {stockData.quality.named_scores.altman_z.value !== null
                                  ? stockData.quality.named_scores.altman_z.value
                                  : 'N/A'}
                              </strong>
                              <span className="quality-badge-band">{stockData.quality.named_scores.altman_z.band}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Pillar bars */}
                      <div className="quality-pillars">
                        {Object.entries(stockData.quality.pillars).map(([key, p]) => (
                          <div className="pillar-row" key={key}>
                            <div className="pillar-label">
                              {PILLAR_LABELS[key] || key}
                              <span className="pillar-weight">{Math.round(p.weight * 100)}%</span>
                            </div>
                            <div className="pillar-track">
                              <div
                                className="pillar-fill"
                                style={{ width: `${p.score ?? 0}%`, background: scoreColor(p.score) }}
                              />
                            </div>
                            <div className="pillar-score" style={{ color: scoreColor(p.score) }}>
                              {p.score ?? 'N/A'}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Evidence toggle */}
                      <button
                        type="button"
                        className="market-toggle-btn"
                        style={{ marginTop: '1.25rem' }}
                        onClick={() => setQualityExpanded((v) => !v)}
                      >
                        {qualityExpanded ? 'Hide metric detail ▲' : 'Show metric detail ▼'}
                      </button>

                      {qualityExpanded && (
                        <div className="table-wrapper" style={{ marginTop: '1rem' }}>
                          <table>
                            <thead>
                              <tr>
                                <th>Metric</th>
                                <th>Value</th>
                                <th>Score</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(stockData.quality.pillars).map(([key, p]) => (
                                <React.Fragment key={key}>
                                  <tr>
                                    <td colSpan={4} className="pillar-group-row">
                                      {PILLAR_LABELS[key] || key}
                                    </td>
                                  </tr>
                                  {p.metrics.map((m) => (
                                    <tr key={m.key}>
                                      <td>
                                        <strong>{m.label}</strong>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.detail}</div>
                                      </td>
                                      <td style={{ fontFamily: 'monospace' }}>{m.display}</td>
                                      <td style={{ color: scoreColor(m.score), fontWeight: 700 }}>{m.score ?? '—'}</td>
                                      <td>{statusIcon(m.status)}</td>
                                    </tr>
                                  ))}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Caveats & provenance */}
                      <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Based on {stockData.quality.years_used} years of statements • data completeness{' '}
                        {Math.round((stockData.quality.data_completeness || 0) * 100)}%
                        {stockData.quality.caveats && stockData.quality.caveats.map((c, i) => (
                          <div key={i} style={{ marginTop: '0.35rem' }}>• {c}</div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

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
                            Base OE ({valuationResult.yearsUsed}-yr avg): {formatCurrency(valuationResult.ownerEarningsBase, stockData.currency)}
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

        {/* Opportunities Board (home screen, before a stock is selected) */}
        {!stockData && !loading && (
          <div className="card">
            <div className="card-title">
              💡 Opportunities — {market === 'IN' ? 'Indian' : 'US'} screen, top recommendations first
              {opportunitiesMeta && opportunitiesMeta.generated_at && (
                <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                  {rankedOpps.length} stocks of {opportunitiesMeta.universe_size} screened • as of {formatTimestamp(opportunitiesMeta.generated_at)}
                </span>
              )}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
              Every screened stock, sorted by signal (BUY → HOLD → OVERVALUED) then by upside vs. our Buffett intrinsic-value estimate. A screen, not a recommendation — always analyze before buying.
            </p>

            {opportunitiesLoading ? (
              <div style={{ padding: '1.5rem', color: 'var(--text-secondary)' }}>Loading opportunities…</div>
            ) : rankedOpps.length === 0 ? (
              <div style={{ padding: '1.5rem', color: 'var(--text-secondary)' }}>
                No screened stocks available for this market yet. Try the other market, or search a specific ticker above.
              </div>
            ) : (
              <>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Company</th>
                        <th>Price</th>
                        <th>Intrinsic Value</th>
                        <th className="opp-sortable" onClick={() => setOppSortKey('upside')}>
                          Upside{oppSort === 'upside' ? ' ▼' : ''}
                        </th>
                        <th className="opp-sortable" onClick={() => setOppSortKey('quality')}>
                          Quality{oppSort === 'quality' ? ' ▼' : ''}
                        </th>
                        <th className="opp-sortable" onClick={() => setOppSortKey('signal')}>
                          Signal{oppSort === 'signal' ? ' ▼' : ''}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {oppPageRows.map((row, i) => (
                        <tr
                          key={row.symbol}
                          style={{ cursor: 'pointer' }}
                          onClick={() => { setQuery(row.symbol); fetchStock(row.symbol); }}
                        >
                          <td>{oppPage * OPP_PAGE_SIZE + i + 1}</td>
                          <td>
                            <strong>{row.name || row.symbol}</strong>
                            <span className="ticker-badge" style={{ marginLeft: '0.5rem' }}>{row.symbol}</span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{row.sector}</div>
                          </td>
                          <td>{formatPrice(row.price, row.currency)}</td>
                          <td>{formatPrice(row.intrinsic_value, row.currency)}</td>
                          <td style={{ color: row.upside_pct >= 0 ? 'var(--color-buy)' : 'var(--color-sell)', fontWeight: 700 }}>
                            {row.upside_pct >= 0 ? '+' : ''}{row.upside_pct.toFixed(1)}%
                          </td>
                          <td>
                            {row.quality_grade ? (
                              <span className={`quality-badge ${gradeClass(row.quality_grade)}`} style={{ padding: '0.15rem 0.55rem', fontSize: '0.72rem' }}>
                                <strong>{row.quality_grade}</strong> {row.quality_score}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge-recommendation ${row.recommendation === 'BUY' ? 'buy' : row.recommendation && row.recommendation.startsWith('FAIR') ? 'hold' : 'sell'}`} style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}>
                              {row.recommendation}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {oppPageCount > 1 && (
                  <div className="opp-pagination">
                    <button
                      type="button"
                      className="market-toggle-btn"
                      disabled={oppPage === 0}
                      onClick={() => setOppPage((p) => Math.max(0, p - 1))}
                    >
                      ← Prev
                    </button>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Page {oppPage + 1} of {oppPageCount}
                    </span>
                    <button
                      type="button"
                      className="market-toggle-btn"
                      disabled={oppPage >= oppPageCount - 1}
                      onClick={() => setOppPage((p) => Math.min(oppPageCount - 1, p + 1))}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
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
