import os
import json
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def clean_and_round(val, decimals=2):
    if val is None or pd.isna(val):
        return None
    try:
        return round(float(val), decimals)
    except:
        return None

def download_historical_data():
    print("=== 1. Starting 30-Day Detailed Reports Download ===")
    
    # Stock Tickers
    tickers = {
        "S&P 500": "^GSPC",
        "Nasdaq": "^IXIC",
        "Dow Jones": "^DJI",
        "Russell 2000": "^RUT"
    }
    
    index_dfs = {}
    all_dates = set()
    
    for name, sym in tickers.items():
        print(f"Fetching 30-day history for {name} ({sym})...")
        t = yf.Ticker(sym)
        df = t.history(period="45d") # fetch 45 days to ensure 30 trading days after shifting
        if df.empty:
            continue
            
        df["Prev_Close"] = df["Close"].shift(1)
        df["Change"] = df["Close"] - df["Prev_Close"]
        df["Percent"] = (df["Change"] / df["Prev_Close"]) * 100
        df = df.dropna(subset=["Prev_Close"])
        df.index = df.index.strftime('%Y-%m-%d')
        index_dfs[name] = df
        all_dates.update(df.index)
        
    sorted_dates = sorted(list(all_dates))
    target_dates = sorted_dates[-30:]

    # Yields from FRED
    yield_ids = {
        "2Y": "DGS2",
        "5Y": "DGS5",
        "10Y": "DGS10",
        "30Y": "DGS30"
    }
    
    yield_dfs = {}
    for name, fred_id in yield_ids.items():
        print(f"Fetching history for {name} Yield ({fred_id}) from FRED...")
        try:
            url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={fred_id}"
            df = pd.read_csv(url)
            df = df[df[fred_id] != '.']
            df[fred_id] = pd.to_numeric(df[fred_id])
            df["Prev_Yield"] = df[fred_id].shift(1)
            df["Change"] = df[fred_id] - df["Prev_Yield"]
            df = df.dropna(subset=["Prev_Yield"])
            df = df.rename(columns={"observation_date": "date"}).set_index("date")
            yield_dfs[name] = df
        except Exception as e:
            print(f"Error fetching yield {name} from FRED: {e}")

    # Build 30-day detailed reports
    detailed_reports = []
    for date_str in target_dates:
        indices_payload = {}
        has_indices = False
        for name, df in index_dfs.items():
            if date_str in df.index:
                row = df.loc[date_str]
                indices_payload[name] = {
                    "symbol": tickers[name],
                    "close": clean_and_round(row["Close"], 2),
                    "change": clean_and_round(row["Change"], 2),
                    "percent": clean_and_round(row["Percent"], 2),
                    "high": clean_and_round(row["High"], 2),
                    "low": clean_and_round(row["Low"], 2),
                    "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else None
                }
                has_indices = True
                
        if not has_indices:
            continue
            
        yields_payload = {}
        for name, df in yield_dfs.items():
            avail_date = date_str
            if avail_date not in df.index:
                past_dates = [d for d in df.index if d <= date_str]
                if past_dates:
                    avail_date = past_dates[-1]
            if avail_date in df.index:
                row = df.loc[avail_date]
                y_val = float(row[yield_ids[name]])
                change_val = float(row["Change"])
                yields_payload[name] = {
                    "yield": clean_and_round(y_val, 3),
                    "change": clean_and_round(change_val, 3),
                    "bps": clean_and_round(change_val * 100, 1)
                }
                
        record = {
            "date": date_str,
            "indices": indices_payload,
            "yields": yields_payload,
            "fed_announcements": [],
            "news_summary": [],
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }
        detailed_reports.append(record)

    detailed_reports.sort(key=lambda x: x["date"], reverse=True)
    print(f"Compiled {len(detailed_reports)} daily detailed records.")

    print("\n=== 2. Starting 10-Year Trend Data Download ===")
    
    # 10-Year Index History
    index_10y_dfs = {}
    all_10y_dates = set()
    
    for name, sym in tickers.items():
        print(f"Fetching 10y history for {name} ({sym})...")
        t = yf.Ticker(sym)
        df = t.history(period="10y")
        if not df.empty:
            df.index = df.index.strftime('%Y-%m-%d')
            index_10y_dfs[name] = df["Close"]
            all_10y_dates.update(df.index)
            
    sorted_10y_dates = sorted(list(all_10y_dates))
    print(f"Found {len(sorted_10y_dates)} historical dates for 10-year indices.")
    
    # Filter FRED yields for last 10 years (from 10 years ago until today)
    start_date_10y = (datetime.today() - timedelta(days=3652)).strftime('%Y-%m-%d')
    yield_10y_dfs = {}
    for name, fred_id in yield_ids.items():
        if name in ["2Y", "5Y", "10Y", "30Y"]: # Fetch 10-year trend for all four yields
            print(f"Filtering 10y yield for {name} ({fred_id})...")
            if name in yield_dfs:
                df = yield_dfs[name]
                yield_10y_dfs[name] = df.loc[df.index >= start_date_10y, fred_id]
                
    # Build 10-year compact records
    historical_10y_records = []
    
    # To optimize chart performance, we take daily data
    for date_str in sorted_10y_dates:
        # Check if we have at least S&P 500 or Nasdaq close
        sp500_val = float(index_10y_dfs["S&P 500"].loc[date_str]) if "S&P 500" in index_10y_dfs and date_str in index_10y_dfs["S&P 500"].index else None
        nasdaq_val = float(index_10y_dfs["Nasdaq"].loc[date_str]) if "Nasdaq" in index_10y_dfs and date_str in index_10y_dfs["Nasdaq"].index else None
        dow_val = float(index_10y_dfs["Dow Jones"].loc[date_str]) if "Dow Jones" in index_10y_dfs and date_str in index_10y_dfs["Dow Jones"].index else None
        russell_val = float(index_10y_dfs["Russell 2000"].loc[date_str]) if "Russell 2000" in index_10y_dfs and date_str in index_10y_dfs["Russell 2000"].index else None
        
        if sp500_val is None and nasdaq_val is None:
            continue
            
        # Get yields matching date or closest past date
        y_vals = {}
        for name in ["2Y", "5Y", "10Y", "30Y"]:
            val = None
            if name in yield_10y_dfs:
                series = yield_10y_dfs[name]
                if date_str in series.index:
                    val = float(series.loc[date_str])
                else:
                    past_dates = [d for d in series.index if d <= date_str]
                    if past_dates:
                        val = float(series.loc[past_dates[-1]])
            y_vals[name] = val
                    
        historical_10y_records.append({
            "date": date_str,
            "sp500": clean_and_round(sp500_val, 2),
            "nasdaq": clean_and_round(nasdaq_val, 2),
            "dow": clean_and_round(dow_val, 2),
            "russell": clean_and_round(russell_val, 2),
            "y2": clean_and_round(y_vals["2Y"], 3),
            "y5": clean_and_round(y_vals["5Y"], 3),
            "y10": clean_and_round(y_vals["10Y"], 3),
            "y30": clean_and_round(y_vals["30Y"], 3)
        })
        
    print(f"Compiled {len(historical_10y_records)} compact 10-year records.")

    # 4. Save and Upload
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY")
    
    is_supabase_configured = (
        supabase_url and 
        supabase_key and 
        "your-project" not in supabase_url and 
        "your-service" not in supabase_key
    )
    
    if is_supabase_configured:
        print("\nUploading to Supabase...")
        try:
            from supabase import create_client, Client
            supabase: Client = create_client(supabase_url, supabase_key)
            
            # Upsert detailed reports
            print("Upserting detailed reports to 'market_history'...")
            for r in detailed_reports:
                supabase.table("market_history").upsert(r).execute()
                
            # Upsert 10y trend records
            print("Upserting 10y records to 'market_history_10y'...")
            # Supabase upsert handles batches or single elements
            # Upserting 2500 records is faster in batches of 100
            batch_size = 100
            for i in range(0, len(historical_10y_records), batch_size):
                batch = historical_10y_records[i:i+batch_size]
                supabase.table("market_history_10y").upsert(batch).execute()
                
            print("Upload complete!")
            
            # Fetch complete history to update local cache
            print("Updating local cache data.js from Supabase...")
            history_response = supabase.table("market_history").select("*").order("date", desc=True).execute()
            full_history = history_response.data
            
            history_10y_response = supabase.table("market_history_10y").select("*").order("date", desc=True).execute()
            full_history_10y = history_10y_response.data
            # Sort ascending for javascript processing if needed, but we keep order consistent
            full_history_10y.reverse() # sorted ascending
            
            write_local_js(full_history, full_history_10y)
            
        except Exception as e:
            print(f"Error communicating with Supabase: {e}")
            print("Falling back to local offline files update...")
            write_local_js(detailed_reports, historical_10y_records)
    else:
        print("\nSupabase is not configured. Saving locally...")
        write_local_js(detailed_reports, historical_10y_records)

def write_local_js(detailed, historical_10y):
    try:
        # Write to data.js
        with open("data.js", "w", encoding="utf-8") as f:
            f.write(f"// Generated history on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"window.MARKET_HISTORY = {json.dumps(detailed, indent=2, ensure_ascii=False)};\n\n")
            f.write(f"window.HISTORICAL_10Y = {json.dumps(historical_10y, indent=2, ensure_ascii=False)};\n")
            
        # Backups
        with open("market_history.json", "w", encoding="utf-8") as f:
            json.dump(detailed, f, indent=2, ensure_ascii=False)
            
        with open("market_history_10y.json", "w", encoding="utf-8") as f:
            json.dump(historical_10y, f, indent=2, ensure_ascii=False)
            
        print("Offline files data.js, market_history.json and market_history_10y.json updated successfully!")
    except Exception as e:
        print(f"Error writing local files: {e}")

if __name__ == "__main__":
    download_historical_data()
