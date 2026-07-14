# Project Plan: Stock Pricer (Warren Buffett Intrinsic Value Calculator)

This project is a web application that tracks stock prices and quarterly/annual financial results for US and Indian companies, calculates their intrinsic value using Warren Buffett's Owner Earnings Discounted Cash Flow (DCF) model, and indicates whether a stock is currently a reasonable buy.

---

## 1. Financial & Price Data Source Analysis
To support both US and Indian exchanges (NSE/BSE) without cost, we evaluated several options:

| Source / API | Free Tier | US Stocks | Indian Stocks | Financial Statements | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Alpha Vantage** | 25 calls/day | Yes | Limited / Premium | Yes (limited quarterly) | Good for US, limited for India |
| **Finnhub** | Limited | Yes | Yes | Yes (limited on free) | High limit risk |
| **yfinance (Yahoo Finance)** | **100% Free** | **Yes** | **Yes** (e.g. `.NS`, `.BO`) | **Yes** (Annual & Quarterly) | **Recommended** (No API keys needed, comprehensive) |

### Key Data Discovery
During technical verification of `yfinance`, we discovered a critical market difference:
* **US Stocks (e.g., AAPL):** Fully supports quarterly Income Statements, Balance Sheets, and Cash Flows.
* **Indian Stocks (e.g., RELIANCE.NS):** Supports quarterly Income Statements and Balance Sheets, but **quarterly Cash Flow statements are not available** (Yahoo Finance does not scrape/publish them). However, **annual Cash Flow statements are fully populated**.
* **Solution:** The application will use a hybrid model:
  - For US stocks: Fetch Trailing Twelve Months (TTM) or quarterly cash flow.
  - For Indian stocks: Fall back to the latest annual cash flow statement for Owner Earnings metrics, while using the latest quarterly Balance Sheets and Income Statements to monitor short-term performance.

---

## 2. Warren Buffett's Intrinsic Value Methodology
Warren Buffett defines intrinsic value as:
> *"The discounted value of the cash that can be taken out of a business during its remaining life."*

Our calculator will implement the **Owner Earnings Discounted Cash Flow (DCF)** model:

### Step A: Calculate Owner Earnings
$$\text{Owner Earnings} = \text{Net Income} + \text{Depreciation \& Amortization} - \text{Capital Expenditures} \pm \text{Changes in Working Capital}$$

*If D&A or Working Capital details are missing from quarterly filings, we default to standard Free Cash Flow (FCF) or allow manual overrides:*
$$\text{Free Cash Flow} = \text{Operating Cash Flow} - \text{Capital Expenditures}$$

### Step B: Project Future Cash Flows (Years 1–10)
Project the Owner Earnings (or FCF) for the next 10 years using a growth rate $g$ (e.g., historical growth rate capped conservatively at 15%):
$$\text{Cash Flow}_t = \text{Owner Earnings}_0 \times (1 + g)^t$$

### Step C: Discount to Present Value
Discount each future cash flow using a discount rate $r$ (historically the 10-year US Treasury yield, but practically 9%–12% for a required rate of return):
$$\text{PV of Cash Flow}_t = \frac{\text{Cash Flow}_t}{(1 + r)^t}$$

### Step D: Terminal Value (Year 10)
Apply a terminal growth rate $g_{terminal}$ (typically 2%–3% representing long-term GDP growth) or a terminal multiple:
$$\text{Terminal Value} = \frac{\text{Cash Flow}_{10} \times (1 + g_{terminal})}{r - g_{terminal}}$$
$$\text{PV of Terminal Value} = \frac{\text{Terminal Value}}{(1 + r)^{10}}$$

### Step E: Total Intrinsic Value & Per-Share Value
$$\text{Intrinsic Value of Equity} = \sum_{t=1}^{10} \text{PV of Cash Flow}_t + \text{PV of Terminal Value} + \text{Cash} - \text{Total Debt}$$
$$\text{Intrinsic Value Per Share} = \frac{\text{Intrinsic Value of Equity}}{\text{Shares Outstanding}}$$

### Step F: Margin of Safety
Apply a Margin of Safety (typically 20% to 30%) to get the **Buy Target Price**:
$$\text{Buy Target} = \text{Intrinsic Value Per Share} \times (1 - \text{Margin of Safety})$$

---

## 3. Technology Stack & Architecture

### Backend: Python FastAPI
* **Reasoning:** Python is ideal for financial data processing. `yfinance` is written in Python, and FastAPI provides high-performance asynchronous JSON endpoints with auto-generated OpenAPI docs.
* **Key Tasks:**
  - Create endpoints to fetch stock profile and historical prices.
  - Parse quarterly and annual financial statements.
  - Calculate intrinsic value based on baseline inputs.
  - Standardize exchange formats (handling USD/INR currencies).

### Frontend: React + Vite + Vanilla CSS
* **Reasoning:** Vite is fast and lightweight. React allows building a reactive dashboard where users can adjust variables (like growth rate, discount rate, or margins) and see the intrinsic value update in real-time. Vanilla CSS ensures a customized, premium look.
* **Key Components:**
  - **Search & Autocomplete:** Easy search for US (e.g. `TSLA`) and Indian (e.g. `INFY.NS`) companies.
  - **Company Overview Card:** Key financials, current price, exchange, and currency.
  - **Interactive DCF Widget:** Visual sliders for Growth Rate, Discount Rate, Margin of Safety.
  - **Valuation Gauge:** A beautiful dial or color-coded card indicating:
    - 🟢 **Buy (Under Target Price)**
    - 🟡 **Fair Value / Hold (Between Target and Intrinsic Value)**
    - 🔴 **Overvalued (Above Intrinsic Value)**
  - **Financial Statement Viewer:** Structured tables showing income, balance, and cashflow data over time.

---

## 4. Directory Structure
```text
stock-pricer/
├── backend/
│   ├── main.py                 # FastAPI application and routing
│   ├── stock_service.py        # Logic for yfinance fetching and calculations
│   └── requirements.txt        # Backend dependencies
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx             # Main Dashboard container
│   │   ├── components/         # Search, Statements Table, DCF Slider components
│   │   └── index.css           # Core styling and typography
└── venv/                       # Python virtual environment
```

---

## 5. Development Roadmap
1. **Phase 1: Backend Setup & Testing (API Integration)**
   - Initialize FastAPI and build `stock_service.py` to extract all required financial fields.
   - Standardize outputs for USD/INR.
2. **Phase 2: Frontend Setup & Core Styling**
   - Initialize React Vite template.
   - Build a dark-themed CSS styling system with clean typography.
3. **Phase 3: Financial Dashboard UI**
   - Implement the search interface.
   - Create tables displaying the financial statements.
4. **Phase 4: Interactive Valuation Calculator**
   - Build the interactive slider components.
   - Write the client-side calculator logic to sync with backend baseline inputs.
5. **Phase 5: UX Polish & Review**
   - Add micro-animations (hover transitions, loaders).
   - Validate performance and data handling.
