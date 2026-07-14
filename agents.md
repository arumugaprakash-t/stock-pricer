# Agent Handbook & Repository Guide

Welcome! This document provides future AI agents and human developers with an overview of the codebase, recent changes, execution guides, and instructions for deploying the project to a free cloud hosting provider.

---

## 1. Project Overview & Architecture
This project is an interactive Warren Buffett Intrinsic Value (Owner Earnings DCF) calculator for both **US and Indian stock markets**.

### Directory Structure
```text
stock-pricer/
├── backend/
│   ├── main.py                 # FastAPI application server and endpoints
│   ├── stock_service.py        # yfinance scraper, clean data normalizer, and DCF math
│   └── requirements.txt        # Python backend package specifications
├── frontend/
│   ├── index.html              # HTML shell updated with SEO titles/descriptions
│   ├── package.json            # Node project configuration
│   ├── vite.config.js          # Vite config
│   └── src/
│       ├── main.jsx            # Entry point for React
│       ├── App.jsx             # Main dashboard container, local DCF engine, and UI tabs
│       └── index.css           # Custom dark cyber-theme variables, grids, and animations
├── project_plan.md             # Baseline project requirements and DCF math specifications
├── agents.md                   # This handbook
└── venv/                       # Python virtual environment (ignored in git)
```

---

## 2. Recent Changes & Completed Milestones
1. **Initial Setup:** Initialized python venv and Vite React scaffolding.
2. **Backend Engine:** 
   - Created a service that fetches ticker info, financials, balance sheets, and cash flows.
   - Built a parser that handles the difference between US and Indian stock disclosures (specifically falling back to annual cash flow statements for Indian NSE/BSE tickers where quarterly cash flow data is unavailable on Yahoo Finance).
   - Standardized currency signs and units (USD vs. INR Lakhs/Crores).
   - Created `/api/stock/{symbol}` and `/api/valuation` endpoints.
3. **Frontend Dashboard:**
   - Designed a premium, dark-themed cyber UI utilizing Vanilla CSS variables and glassmorphism.
   - Developed a zero-latency client-side DCF engine in `App.jsx` linked to interactive sliders (Years 1–5 growth, Years 6–10 growth, Discount rate, Terminal rate, Margin of Safety, and Maintenance CapEx percentage).
   - Created custom bar graphs representing the present values of projected cash flows.
   - Built a financial statement viewer for side-by-side quarterly vs. annual statement inspection.

---

## 3. How to Work in this Repo

### Running Locally
To launch the application locally, start both the backend and frontend servers in separate terminal instances:

#### Backend (FastAPI):
```bash
# Activate virtual environment and run the server
source venv/bin/activate
python backend/main.py
```
* Runs at: `http://localhost:8000`
* API docs: `http://localhost:8000/docs`

#### Frontend (Vite/React):
```bash
cd frontend
npm install   # If not already done
npm run dev
```
* Runs at: `http://localhost:5173`

### Editing Guidelines
* **Math Consistency:** If you adjust the DCF valuation calculation in the frontend (`App.jsx`), ensure it remains aligned with the Python calculation in the backend (`backend/stock_service.py` -> `calculate_dcf`).
* **Vanilla CSS:** Avoid introducing CSS utility libraries like TailwindCSS unless requested. Maintain the custom variable theme defined in `frontend/src/index.css`.
* **CORS Policy:** The backend CORS settings currently allow all origins (`allow_origins=["*"]`) for easy local development. Keep this in mind when making security edits.

---

## 4. Free Cloud Deployment Guide (Render Blueprints - Git-Ops)

Render supports **Blueprints**, allowing you to define your entire multi-service infrastructure (the FastAPI backend and Vite React frontend) in a single configuration file (`render.yaml`). This lets you manage and deploy your production stack entirely from the terminal via standard Git commands.

### Step A: Push Your Code to GitHub
Initialize Git, stage the code, commit, and push it to a remote GitHub repository:
```bash
git init
git add .
git commit -m "Initial commit with Render Blueprint configuration"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

---

### Step B: Launch the Blueprint on Render
1. Log in to [Render](https://render.com/).
2. Go to the **Blueprints** tab in the dashboard.
3. Click **New Blueprint Instance**.
4. Connect the GitHub repository you just pushed.
5. Render will automatically parse the [render.yaml](file:///Users/prakash/Desktop/Projects/stock-pricer/render.yaml) file:
   * It will create a **Web Service** for the FastAPI backend (`stock-pricer-backend`).
   * It will create a **Static Site** for the React frontend (`stock-pricer-frontend`).
   * It will automatically capture the backend's host and feed it to the frontend build environment as `VITE_API_URL`.
6. Click **Approve** or **Apply**.

---

### Step C: Git-Ops Continuous Deployment
Once the initial Blueprint is created, any changes you push to GitHub will automatically trigger builds and redeployments for both services in the background:
```bash
# To update your live app:
git add .
git commit -m "Updated DCF growth parameters"
git push
```
No need to log in to the Render dashboard again!

---

### Step D: Production Configuration Adjustments
* **Dynamic API URL:** In [frontend/src/App.jsx](file:///Users/prakash/Desktop/Projects/stock-pricer/frontend/src/App.jsx), the API URL is dynamically retrieved from `import.meta.env.VITE_API_URL` with a fallback to `http://localhost:8000` for local development. Render takes care of injecting this variable automatically during the build step.
* **CORS Restrictions:** For local development, the FastAPI backend allows all origins (`allow_origins=["*"]`). For a production app, you can modify `backend/main.py` to only allow your React static site domain for enhanced security:
  ```python
  app.add_middleware(
      CORSMiddleware,
      allow_origins=[
          "http://localhost:5173",
          "https://your-frontend-subdomain.onrender.com"
      ],
      allow_credentials=True,
      allow_methods=["*"],
      allow_headers=["*"],
  )
  ```

