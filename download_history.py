import os
import json
import pandas as pd
import yfinance as yf
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def download_historical_data():
    print("Starting historical data download for the past month (approx. 30 days)...")
    
    # 1. Fetch Stock Indices history using yfinance
    tickers = {
        "S&P 500": "^GSPC",
        "Nasdaq": "^IXIC",
        "Dow Jones": "^DJI",
        "Russell 2000": "^RUT"
    }
    
    index_dfs = {}
    all_dates = set()
    
    for name, sym in tickers.items():
        print(f"Fetching history for {name} ({sym})...")
        t = yf.Ticker(sym)
        # Fetch 40 days to ensure we have at least 30 trading days of data after diffs
        df = t.history(period="40d")
        if df.empty:
            print(f"Warning: No data found for {name}")
            continue
            
        # Calculate daily change and percentage change
        df["Prev_Close"] = df["Close"].shift(1)
        df["Change"] = df["Close"] - df["Prev_Close"]
        df["Percent"] = (df["Change"] / df["Prev_Close"]) * 100
        
        # Drop the first row which won't have change calculations
        df = df.dropna(subset=["Prev_Close"])
        
        # Format index to string YYYY-MM-DD
        df.index = df.index.strftime('%Y-%m-%d')
        index_dfs[name] = df
        all_dates.update(df.index)
        
    # Sort dates in ascending order
    sorted_dates = sorted(list(all_dates))
    print(f"Identified {len(sorted_dates)} trading dates for stock indices.")

    # 2. Fetch Bond Yields from FRED CSVs
    # FRED is completely public and has perfect historical records
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
            # Filter out holiday empty values represented as '.'
            df = df[df[fred_id] != '.']
            df[fred_id] = pd.to_numeric(df[fred_id])
            
            # Calculate daily change and bps
            df["Prev_Yield"] = df[fred_id].shift(1)
            df["Change"] = df[fred_id] - df["Prev_Yield"]
            
            df = df.dropna(subset=["Prev_Yield"])
            df = df.rename(columns={"observation_date": "date"})
            df = df.set_index("date")
            yield_dfs[name] = df
        except Exception as e:
            print(f"Error fetching yield {name} from FRED: {e}")

    # 3. Merge Stock and Bond data daily
    historical_records = []
    
    # We take the last 30 trading dates
    target_dates = sorted_dates[-30:]
    
    for date_str in target_dates:
        # Construct indices structure
        indices_payload = {}
        has_indices = False
        for name, df in index_dfs.items():
            if date_str in df.index:
                row = df.loc[date_str]
                indices_payload[name] = {
                    "symbol": tickers[name],
                    "close": round(float(row["Close"]), 2),
                    "change": round(float(row["Change"]), 2),
                    "percent": round(float(row["Percent"]), 2),
                    "high": round(float(row["High"]), 2),
                    "low": round(float(row["Low"]), 2),
                    "volume": int(row["Volume"])
                }
                has_indices = True
                
        if not has_indices:
            continue
            
        # Construct yields structure
        yields_payload = {}
        for name, df in yield_dfs.items():
            # If the exact date is missing in FRED (e.g. slight lag or holiday mismatches),
            # fetch the closest preceding date available
            avail_date = date_str
            if avail_date not in df.index:
                # Find closest date before this date
                past_dates = [d for d in df.index if d <= date_str]
                if past_dates:
                    avail_date = past_dates[-1]
                    
            if avail_date in df.index:
                row = df.loc[avail_date]
                y_val = float(row[yield_ids[name]])
                change_val = float(row["Change"])
                yields_payload[name] = {
                    "yield": round(y_val, 3),
                    "change": round(change_val, 3),
                    "bps": round(change_val * 100, 1)
                }
        
        # Assemble complete payload
        # For historical dates, we leave news and Fed announcements empty
        record = {
            "date": date_str,
            "indices": indices_payload,
            "yields": yields_payload,
            "fed_announcements": [],
            "news_summary": [],
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }
        historical_records.append(record)

    # Sort descending by date
    historical_records.sort(key=lambda x: x["date"], reverse=True)
    print(f"Compiled {len(historical_records)} historical records successfully.")
    
    # 4. Save and Upload
    # Check Supabase connection credentials
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY")
    
    is_supabase_configured = (
        supabase_url and 
        supabase_key and 
        "your-project" not in supabase_url and 
        "your-service" not in supabase_key
    )
    
    if is_supabase_configured:
        print("Uploading historical records to Supabase...")
        try:
            from supabase import create_client, Client
            supabase: Client = create_client(supabase_url, supabase_key)
            
            # Upload record by record
            for record in historical_records:
                response = supabase.table("market_history").upsert(record).execute()
            print("All historical records successfully uploaded to Supabase!")
            
            # Fetch the complete sorted history from Supabase to write local cache
            history_response = supabase.table("market_history").select("*").order("date", desc=True).execute()
            full_history = history_response.data
            
            # Write to data.js
            with open("data.js", "w", encoding="utf-8") as f:
                f.write(f"// Generated history on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"window.MARKET_HISTORY = {json.dumps(full_history, indent=2, ensure_ascii=False)};\n")
            print("Local data.js updated with full cloud history.")
            
        except Exception as e:
            print(f"Error connecting/upserting to Supabase: {e}")
            print("Falling back to local offline files update...")
            update_local_files(historical_records)
    else:
        print("\nSupabase is not configured. Saving historical records to local cache...")
        update_local_files(historical_records)

def update_local_files(records):
    # Save back to data.js
    try:
        with open("data.js", "w", encoding="utf-8") as f:
            f.write(f"// Generated history on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} (Offline Mode)\n")
            f.write(f"window.MARKET_HISTORY = {json.dumps(records, indent=2, ensure_ascii=False)};\n")
        
        with open("market_history.json", "w", encoding="utf-8") as f:
            json.dump(records, f, indent=2, ensure_ascii=False)
            
        print("Offline files data.js and market_history.json populated with history successfully!")
    except Exception as e:
        print(f"Error writing local files: {e}")

if __name__ == "__main__":
    download_historical_data()
