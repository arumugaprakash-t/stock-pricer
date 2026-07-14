from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uvicorn

from stock_service import get_stock_data, calculate_dcf

app = FastAPI(
    title="Stock Pricer API",
    description="Backend API for Warren Buffett Intrinsic Value DCF Calculator",
    version="1.0.0"
)

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DCFRequest(BaseModel):
    current_price: float
    shares_outstanding: int
    owner_earnings_base: float
    growth_rate_1_5: float
    growth_rate_6_10: float
    discount_rate: float
    terminal_growth_rate: float
    cash: float
    debt: float
    margin_of_safety: float

@app.get("/")
def read_root():
    return {
        "status": "healthy",
        "message": "Stock Pricer API is running. Use /api/stock/{symbol} to fetch data."
    }

@app.get("/api/stock/{symbol}")
def get_stock(symbol: str):
    """
    Fetch stock details, financial statements, and baseline DCF valuation.
    """
    symbol_cleaned = symbol.strip().upper()
    if not symbol_cleaned:
        raise HTTPException(status_code=400, detail="Stock symbol cannot be empty")
        
    print(f"Fetching stock data for symbol: {symbol_cleaned}")
    data = get_stock_data(symbol_cleaned)
    
    if data.get("status") == "error":
        raise HTTPException(status_code=404, detail=data.get("message"))
        
    return data

@app.post("/api/valuation")
def post_valuation(req: DCFRequest):
    """
    Calculate DCF valuation based on custom user inputs.
    """
    result = calculate_dcf(
        current_price=req.current_price,
        shares_outstanding=req.shares_outstanding,
        owner_earnings_base=req.owner_earnings_base,
        growth_rate_1_5=req.growth_rate_1_5,
        growth_rate_6_10=req.growth_rate_6_10,
        discount_rate=req.discount_rate,
        terminal_growth_rate=req.terminal_growth_rate,
        cash=req.cash,
        debt=req.debt,
        margin_of_safety=req.margin_of_safety
    )
    return result

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
