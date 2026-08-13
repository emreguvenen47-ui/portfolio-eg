# Quick Start Guide

## 🚀 Getting Started in 2 Minutes

The application is already running! Your portfolio management dashboard is live at:

**http://localhost:3000**

## 📋 What's Working Right Now

✅ All 20 pages loaded and functional  
✅ All 6 API routes working  
✅ Dashboard showing portfolio overview  
✅ Market data provider with mock (DEMO) data  
✅ Settings persisting in-memory  

## 📁 Import Your First Portfolio

1. **Navigate to Settings**
   - Click the Settings link in the sidebar
   - OR go to http://localhost:3000/settings

2. **Find the Excel Import Section**
   - Look for "Import Portfolio" section
   - Click to select your Excel file

3. **Supported Formats**
   - `.xlsx` (Excel 2007+) ✅
   - `.xlsm` (Excel with macros) ✅
   - `.xls` (Excel 97-2003) ✅
   - `.csv` (comma-separated) ✅

4. **Required Columns**
   Your Excel needs:
   - A "Ticker/Code" column
   - A "Weight/Ağırlık" column
   
   Optional but recommended:
   - Asset Name
   - Category
   - Expected Return
   - Volatility
   - Currency
   - Rationale (thesis)
   - Risks

5. **Preview Before Applying**
   - The app shows you exactly what will be imported
   - Check for warnings
   - Cancel if anything looks wrong
   - Apply when ready

## 🔑 Getting Live Market Data (Optional)

The app currently shows **DEMO** (generated) data. To use live prices:

### Step 1: Get an API Key
Visit: https://twelvedata.com/  
- Sign up for free
- Copy your API key

### Step 2: Set Environment Variable
```bash
export TWELVE_DATA_API_KEY="your_key_here"
```

### Step 3: Restart the Server
```bash
# Stop current server (Ctrl+C)
# Run again:
npm run dev
```

### Step 4: Check the Badge
Look at the top of any page - it should now show **LIVE** instead of **DEMO**

## 💾 Optional: Cloud Settings Backup

To save your settings in the cloud (survive restarts):

### Option A: Supabase (Recommended)
```bash
# Create account at https://supabase.com/
# Create a new project
# Get your URL and service key
# Set environment variables:

export NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your_key_here"

# Restart server
npm run dev
```

### Option B: No Setup (Current)
Settings persist during your session. They reset on server restart, which is fine for desktop use.

## 📊 Exploring the Dashboard

### Main Pages
- **Dashboard** (`/`) - Portfolio overview, performance, holdings
- **Positions** (`/positions`) - All holdings with weights and drift
- **Position Detail** (`/positions/TICKER`) - Deep dive on one position
- **Performance** (`/performance`) - Return analysis over time
- **Markets** (`/markets`) - Key indices and rates (SPX, BIST, VIX, DXY, USD/TRY, yields)
- **Currencies** (`/currencies`) - USD/TRY analysis + PPF Turkish money-market calculator
- **Watchlist** (`/watchlist`) - Track any symbol
- **Risk** (`/risk`) - Volatility, correlations, risk contribution
- **Stress** (`/stress`) - Scenario analysis (crisis, crash, correction, soft landing)
- **Rebalance** (`/rebalance`) - What to buy/sell to get back to targets
- **Theses** (`/theses`) - Position thesis with status (Green/Yellow/Red)
- **Alerts** (`/alerts`) - Configure alert rules
- **Settings** (`/settings`) - All configuration

### Key Metrics
- **Weight Drift** - How far actual % is from target %
- **Volatility** - Covariance-based (not naive sum)
- **VaR 95%** - Worst 5% loss (historical)
- **Sharpe Ratio** - Risk-adjusted return
- **Max Drawdown** - Peak-to-trough loss
- **Risk Contribution** - Which positions drive risk

## 📈 Example Portfolio Workflow

1. **Start** → Import your Excel portfolio
2. **Analyze** → Check dashboard, positions, risk metrics
3. **Monitor** → Refresh prices (queries market data)
4. **Plan** → Go to Rebalance page, see drift
5. **Stress Test** → Run scenarios
6. **Adjust** → Update settings on /settings page

## 🛠️ Behind the Scenes

### Calculation Engine
- All calculations are **deterministic** and **tested**
- Currency conversions explicit (USD, TRY, EUR, Mixed)
- PPF (Turkish money-market fund) accrues yield daily
- Covariance used for volatility, not weighted average
- All figures in USD unless otherwise noted

### Data Sources
- **Market Data**: Twelve Data API (live) or mock generator (DEMO)
- **Portfolio**: Excel file at `data/Portfoy_Tahsisi.xlsx`
- **Settings**: Supabase (if configured) or in-memory
- **Historical**: 800 trading days (3.3 years)

### Factor Model (Mock Provider)
The DEMO data generator uses 8 independent factors:
- USEQ (US Equity)
- GLEQ (Global Equity)
- EM (Emerging Markets)
- TRY (Turkish Lira)
- GOLD (Gold)
- INDMET (Industrial Metals)
- RATES (Interest Rates)
- TECH (Technology)

This ensures realistic correlations (SMH ↔ QQQ, GOLD independent, etc.)

## ⚡ Performance Tips

- **Queries are cached** for 60 seconds (quotes) or 15 minutes (history)
- **Pages render server-side** for speed
- **Only needed symbols are fetched** (holdings + core benchmarks)
- **Watchlist auto-polls** every 60 seconds

## 🆘 Troubleshooting

### App Won't Start
```bash
# Make sure port 3000 is free
lsof -i :3000

# If occupied, kill it or use different port
npm run dev -- -p 3001
```

### Portfolio Won't Import
- Check Excel has a "Ticker/Code" column
- Check it has a "Weight/Ağırlık" column
- Make sure weights sum close to 100%
- Check file size < 8MB
- Try CSV format as fallback

### No Market Data
- Check your internet connection
- If using live provider, verify API key is set
- Check `TWELVE_DATA_API_KEY` env var
- Look at /settings page for status

### Settings Not Saving
- Make sure you have write permissions in the directory
- If using Supabase, verify credentials
- Check browser console for errors

## 📚 Full Documentation

See `PROJECT_SUMMARY.md` for:
- Complete architecture
- All features explained
- Advanced customization
- Deployment options
- Financial calculation details

---

**You're all set!** 🎉

Visit http://localhost:3000 and start exploring your portfolio.
