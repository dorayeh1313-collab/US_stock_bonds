# MacroVibe Intelligence: US Macro Markets & AI Tech Supply Chain Dashboard

MacroVibe Intelligence is a premium, interactive dark-mode dashboard designed for tracking US macro market performance, Treasury yield curves, Federal Reserve policy announcements, yesterday's focus news, and thematic AI sector concepts.

## 🌟 Key Features

- **Dual-Mode Operation**:
  - **Cloud Sync Mode (Supabase)**: Stores and syncs historical data to a Supabase database, allowing data retrieval across multiple devices or user logins.
  - **Local Offline Mode**: Fallbacks seamlessly to local `market_history.json` and `data.js` caches if Supabase credentials are not provided.
- **Advanced Macro Visualization**:
  - **Yield Curve**: Visualizes US Treasury yields (2Y, 5Y, 10Y, 30Y) with automatic visual warning indicators when a yield curve inversion occurs.
  - **Index History**: Shows relative cumulative percentage returns for major US stock indices (S&P 500, Nasdaq, Dow Jones, Russell 2000).
  - **10Y-2Y Treasury Spread**: Tracks the famous economic recession warning indicator.
- **AI Concept Supply Chain Monitor**:
  - **8 Core AI Concept Sectors**: Tracks daily performance, changes, and stock constituents across 8 sectors (e.g., ASIC & Cloud Giants, Power & Grid, Optical Transceivers, etc.).
  - **Stock Comparison Mode (Default)**: Normalizes stock prices from a selected timeframe's starting date (anchored at `0%` return) to compare relative performance cleanly without low-price stocks being squeezed out.
  - **Single Stock Technical Chart**: Switch dynamically to individual stock views displaying real close prices in USD, overlaid with **MA5 (Weekly, light blue)** and **MA20 (Monthly, yellow/orange)** moving averages.
  - **Enhanced Crosshair & Tooltip**: Displays dates, closing prices, MA5, and MA20 values synchronously in a single crosshair tooltip.
- **Yahoo-style Status Bar**: Displays the currently selected ticker's real-time state (`Close: $XXX | MA5: XXX | MA20: XX`) or sector returns dynamically.
- **Fully English Localized (Internationalized)**: Cleanly formatted translations across UI labels, tooltips, chart legends, vibe scores, and automated market brief generators.
- **Premium Glassmorphism Design**: Elegant dark-themed user interface utilizing fluid animations,Outfit & Inter typography, and fully responsive layouts.

---

## 🛠️ Installation & Setup

This project uses Python to scrape data and format databases/js files. The frontend is a static HTML/CSS/JS dashboard.

### 1. Initialize Python Environment
Set up a python virtual environment in the project root folder and install dependencies:
```bash
# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install requirements
pip install -r backend/requirements.txt
```

### 2. Database Setup (Supabase - Optional)
If you want to run the application with database sync:
1. Register and create a project on [Supabase](https://supabase.com).
2. Open the **SQL Editor**, click **New Query**, and paste and execute the following SQL script to initialize tables and Row Level Security (RLS) rules:
    ```sql
    -- 1. Create market_history table
    create table if not exists public.market_history (
      date date primary key,
      indices jsonb not null,
      yields jsonb not null,
      fed_announcements jsonb not null,
      news_summary jsonb not null,
      updated_at timestamptz default timezone('utc'::text, now()) not null
    );

    -- Enable RLS
    alter table public.market_history enable row level security;

    -- Create public read access policy
    create policy "Allow public read access"
    on public.market_history
    for select
    using (true);

    -- 2. Create 10-year history table
    create table if not exists public.market_history_10y (
      date date primary key,
      sp500 numeric,
      nasdaq numeric,
      dow numeric,
      russell numeric,
      y2 numeric,
      y5 numeric,
      y10 numeric,
      y30 numeric
    );

    -- Enable RLS for 10y table
    alter table public.market_history_10y enable row level security;

    -- Create public read access policy for 10y table
    create policy "Allow public read access on 10y"
    on public.market_history_10y
    for select
    using (true);
    ```
3. Copy the `Project URL`, `Anon Public Key`, and `Service Role Key` from your Supabase **Settings -> API** panel.

### 3. User Credentials & Access Control (Supabase Auth)
To secure your dashboard so only authorized members can view the analytics:
1. **Disable Public Registration**:
   - Go to your Supabase Console, click **Authentication** -> **Settings**.
   - Under **User Sign Up**, turn **OFF** "Allow new users to sign up".
   - Click **Save**.
2. **Create Authorized Users**:
   - Go to **Authentication** -> **Users**.
   - Click **Add User** -> **Create User**.
   - Enter your email and password credentials, ensure "Auto-confirm User" is checked, and click **Save**.

### 4. Setup Secrets & Configurations
1. **Backend Credentials**: Copy `backend/.env.example` to `backend/.env` and fill in your Supabase project keys:
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   ```
2. **Frontend Config**: Update the `static/js/config.js` file with your public keys:
   ```javascript
   window.SUPABASE_CONFIG = {
     url: "https://your-project-id.supabase.co",
     anonKey: "your-anon-public-key"
   };
   ```

---

## 🚀 Execution & Usage

### 1. Fetching Daily Data
To fetch the latest daily macro, bond, and stock ticker movements, run:
```bash
venv/bin/python backend/fetch_data.py
```
* **With Supabase configured**: Fetched records are upserted into the remote database tables, and the history cache `data/data.js` is automatically updated.
* **Without Supabase**: Data runs in Offline Mode, writing updates directly to the local files.

### 2. View Dashboard
Simply open **`index.html`** in your browser. No web servers are required! Log in with your Supabase Auth credentials (or click "Browse in Local Offline Cache Mode" to view the local cached dataset).
