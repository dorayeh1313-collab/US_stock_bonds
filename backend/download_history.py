import os
import json
import pandas as pd
import yfinance as yf
import requests
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Helper to get paths relative to backend script directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "../data")

def get_data_filepath(filename):
    os.makedirs(DATA_DIR, exist_ok=True)
    return os.path.join(DATA_DIR, filename)

def clean_and_round(val, decimals=2):
    if val is None or pd.isna(val):
        return None
    try:
        return round(float(val), decimals)
    except:
        return None

def translate_text(text, target_lang="zh-TW"):
    if not text:
        return ""
    try:
        import urllib.parse
        encoded_text = urllib.parse.quote(text)
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={target_lang}&dt=t&q={encoded_text}"
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=5)
        if r.status_code == 200:
            res_json = r.json()
            translated = "".join([part[0] for part in res_json[0] if part[0]])
            return translated
    except Exception as e:
        print(f"Translation error: {e}")
    return text

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
        
    # Fetch 30-day history for AI theme stocks
    ai_tickers = [
        "AMZN", "AVGO", "MRVL", "GOOGL", "CEG", "VST", "ETN", "GE",
        "COHR", "LITE", "NVDA", "VRT", "FCX", "CAT", "PLTR", "MSFT",
        "CRM", "MU", "ASML", "AMAT", "CRWD", "PANW", "LLY", "NVO"
    ]
    ai_dfs = {}
    for ticker in ai_tickers:
        print(f"Fetching 30-day history for AI stock {ticker}...")
        try:
            t = yf.Ticker(ticker)
            df = t.history(period="45d") # fetch 45 days to ensure 30 trading days after shifting
            if df.empty:
                continue
            df["Prev_Close"] = df["Close"].shift(1)
            df["Change"] = df["Close"] - df["Prev_Close"]
            df["Percent"] = (df["Change"] / df["Prev_Close"]) * 100
            df = df.dropna(subset=["Prev_Close"])
            df.index = df.index.strftime('%Y-%m-%d')
            ai_dfs[ticker] = df
        except Exception as e:
            print(f"Error fetching {ticker}: {e}")
            
    sorted_dates = sorted(list(all_dates))
    target_dates = sorted_dates[-30:]

    # Yields from U.S. Treasury legacy XML feed
    yield_ids = {
        "2Y": "DGS2",
        "5Y": "DGS5",
        "10Y": "DGS10",
        "30Y": "DGS30"
    }
    
    print("Fetching historical Treasury yields from U.S. Treasury legacy XML feeds...")
    yield_data = []
    current_year = datetime.today().year
    
    # Fetch from 10 years ago to today
    for year in range(current_year - 10, current_year + 1):
        print(f"Fetching yield curve data for {year} from U.S. Treasury...")
        try:
            url = f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value={year}"
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            if r.status_code != 200:
                print(f"Error: Legacy Treasury XML feed returned {r.status_code} for {year}")
                continue
            
            import xml.etree.ElementTree as ET
            root = ET.fromstring(r.content)
            ns = {
                'atom': 'http://www.w3.org/2005/Atom',
                'm': 'http://schemas.microsoft.com/ado/2007/08/dataservices/metadata',
                'd': 'http://schemas.microsoft.com/ado/2007/08/dataservices'
            }
            
            entries = root.findall('.//atom:entry', ns)
            for entry in entries:
                properties = entry.find('.//m:properties', ns)
                if properties is not None:
                    date_el = properties.find('d:NEW_DATE', ns)
                    y2_el = properties.find('d:BC_2YEAR', ns)
                    y5_el = properties.find('d:BC_5YEAR', ns)
                    y10_el = properties.find('d:BC_10YEAR', ns)
                    y30_el = properties.find('d:BC_30YEAR', ns)
                    
                    if date_el is not None and date_el.text:
                        date_str = date_el.text.split('T')[0]
                        
                        def parse_val(el):
                            if el is None or el.text is None:
                                return None
                            try:
                                return float(el.text)
                            except:
                                return None
                        
                        yield_data.append({
                            "date": date_str,
                            "2Y": parse_val(y2_el),
                            "5Y": parse_val(y5_el),
                            "10Y": parse_val(y10_el),
                            "30Y": parse_val(y30_el)
                        })
        except Exception as e:
            print(f"Error fetching/parsing yield curve for {year}: {e}")
            
    yield_dfs = {}
    if yield_data:
        full_df = pd.DataFrame(yield_data).dropna(subset=["date"])
        full_df = full_df.drop_duplicates(subset=["date"]).sort_values("date")
        full_df = full_df.set_index("date")
        
        for name in ["2Y", "5Y", "10Y", "30Y"]:
            col_id = yield_ids[name]
            if name in full_df.columns:
                df = full_df[[name]].copy()
                df = df.rename(columns={name: col_id})
                df["Prev_Yield"] = df[col_id].shift(1)
                df["Change"] = df[col_id] - df["Prev_Yield"]
                df = df.dropna(subset=["Prev_Yield"])
                yield_dfs[name] = df

    # Fetch all Fed announcements from RSS for historical mapping
    print("Fetching Fed announcements for history mapping...")
    fed_announcements_map = {}
    try:
        fed_rss_url = "https://www.federalreserve.gov/feeds/press_monetary.xml"
        r = requests.get(fed_rss_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if r.status_code == 200:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(r.content)
            for item in root.findall(".//item"):
                title = item.find("title").text.strip()
                link = item.find("link").text.strip()
                pub_date = item.find("pubDate").text.strip()
                try:
                    dt = datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S %Z")
                    date_str = dt.strftime("%Y-%m-%d")
                except:
                    date_str = pub_date
                
                title_zh = translate_text(title)
                content_zh = "貼現率或貨幣政策會議資訊發布。"
                
                ann = {
                    "title": title,
                    "title_zh": title_zh,
                    "content_zh": content_zh,
                    "link": link,
                    "date": date_str
                }
                if date_str not in fed_announcements_map:
                    fed_announcements_map[date_str] = []
                fed_announcements_map[date_str].append(ann)
            print(f"Loaded {len(fed_announcements_map)} dates with Fed announcements from RSS.")
    except Exception as e:
        print(f"Error fetching historical Fed announcements: {e}")

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
                
        ai_stocks_payload = {}
        for ticker, df in ai_dfs.items():
            if date_str in df.index:
                row = df.loc[date_str]
                ai_stocks_payload[ticker] = {
                    "close": clean_and_round(row["Close"], 2),
                    "change": clean_and_round(row["Change"], 2),
                    "percent": clean_and_round(row["Percent"], 2)
                }
        indices_payload["ai_stocks"] = ai_stocks_payload
        
        # Calculate sentiment and vibe score
        sentiment_score = 50.0
        
        # 1. Stock indices score (40%)
        index_pcts = []
        for name in ['S&P 500', 'Nasdaq', 'Dow Jones', 'Russell 2000']:
            if name in indices_payload:
                index_pcts.append(indices_payload[name].get("percent", 0))
        avg_index_change = sum(index_pcts) / len(index_pcts) if index_pcts else 0
        index_score = 50 + (avg_index_change * 25)
        index_score = max(0, min(100, index_score))
        
        # 2. Bond score (30%)
        y2 = yields_payload.get("2Y", {}).get("yield")
        y10 = yields_payload.get("10Y", {}).get("yield")
        if y2 is not None and y10 is not None:
            spread = y10 - y2
            spread_score = 50 + (spread * 50)
            
            y2_ch = abs(yields_payload.get("2Y", {}).get("change", 0))
            y10_ch = abs(yields_payload.get("10Y", {}).get("change", 0))
            vol = (y2_ch + y10_ch) / 2
            vol_score = max(0, 100 - (vol * 1000))
            
            bond_score = (spread_score * 0.7) + (vol_score * 0.3)
            bond_score = max(0, min(100, bond_score))
        else:
            bond_score = 50.0
            
        vibe_score = round((index_score * 0.4) + (bond_score * 0.3) + (sentiment_score * 0.3), 1)
        
        indices_payload["sentiment_score"] = sentiment_score
        indices_payload["vibe_score"] = vibe_score
                
        record = {
            "date": date_str,
            "indices": indices_payload,
            "yields": yields_payload,
            "fed_announcements": fed_announcements_map.get(date_str, []),
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
                
    print("Fetching 10y history for AI theme stocks...")
    ai_10y_dfs = {}
    for ticker in ai_tickers:
        print(f"Downloading 10y history for {ticker}...")
        try:
            t = yf.Ticker(ticker)
            df = t.history(period="10y")
            if not df.empty:
                df.index = df.index.strftime('%Y-%m-%d')
                ai_10y_dfs[ticker] = df["Close"]
        except Exception as e:
            print(f"Error fetching 10y history for {ticker}: {e}")

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

    ai_stocks_10y_records = []
    for date_str in sorted_10y_dates:
        record_ai_10y = {"date": date_str}
        for ticker in ai_tickers:
            if ticker in ai_10y_dfs and date_str in ai_10y_dfs[ticker].index:
                val = float(ai_10y_dfs[ticker].loc[date_str])
                record_ai_10y[ticker] = clean_and_round(val, 2)
            else:
                record_ai_10y[ticker] = None
        ai_stocks_10y_records.append(record_ai_10y)
    print(f"Compiled {len(ai_stocks_10y_records)} AI stocks 10-year records.")

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
            
            # Fetch existing records for these dates to avoid overwriting news_summary/fed_announcements
            print("Fetching existing detailed records from Supabase to preserve populated data...")
            dates_list = [r["date"] for r in detailed_reports]
            res_existing = supabase.table("market_history").select("*").in_("date", dates_list).execute()
            existing_map = {item["date"]: item for item in res_existing.data} if res_existing.data else {}
            
            # Upsert detailed reports
            print("Upserting detailed reports to 'market_history'...")
            for r in detailed_reports:
                existing = existing_map.get(r["date"])
                if existing:
                    # Keep existing news_summary if populated
                    if existing.get("news_summary"):
                        r["news_summary"] = existing["news_summary"]
                    # Keep existing fed_announcements if populated and new is empty
                    if existing.get("fed_announcements") and not r["fed_announcements"]:
                        r["fed_announcements"] = existing["fed_announcements"]
                    # Keep existing index metadata
                    existing_indices = existing.get("indices") or {}
                    if "ai_summary" in existing_indices:
                        r["indices"]["ai_summary"] = existing_indices["ai_summary"]
                    if "vibe_score" in existing_indices:
                        r["indices"]["vibe_score"] = existing_indices["vibe_score"]
                    if "sentiment_score" in existing_indices:
                        r["indices"]["sentiment_score"] = existing_indices["sentiment_score"]
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
            # Fetch detailed history (paginated)
            full_history = []
            offset = 0
            while True:
                res = supabase.table("market_history").select("*").order("date", desc=True).range(offset, offset + 999).execute()
                batch = res.data
                if not batch:
                    break
                full_history.extend(batch)
                if len(batch) < 1000:
                    break
                offset += 1000
                
            # Fetch 10y history (paginated)
            full_history_10y = []
            offset = 0
            while True:
                res = supabase.table("market_history_10y").select("*").order("date", desc=True).range(offset, offset + 999).execute()
                batch = res.data
                if not batch:
                    break
                full_history_10y.extend(batch)
                if len(batch) < 1000:
                    break
                offset += 1000
            # Sort ascending for javascript processing if needed, but we keep order consistent
            full_history_10y.reverse() # sorted ascending
            
            write_local_js(full_history, full_history_10y, ai_stocks_10y_records)
            
        except Exception as e:
            print(f"Error communicating with Supabase: {e}")
            print("Falling back to local offline files update...")
            write_local_js(detailed_reports, historical_10y_records, ai_stocks_10y_records)
    else:
        print("\nSupabase is not configured. Saving locally...")
        write_local_js(detailed_reports, historical_10y_records, ai_stocks_10y_records)

def write_local_js(detailed, historical_10y, ai_stocks_10y):
    try:
        # Write to data.js
        with open(get_data_filepath("data.js"), "w", encoding="utf-8") as f:
            f.write(f"// Generated history on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"window.MARKET_HISTORY = {json.dumps(detailed, indent=2, ensure_ascii=False)};\n\n")
            f.write(f"window.HISTORICAL_10Y = {json.dumps(historical_10y, indent=2, ensure_ascii=False)};\n\n")
            f.write(f"window.AI_STOCKS_10Y = {json.dumps(ai_stocks_10y, indent=2, ensure_ascii=False)};\n")
            
        # Backups
        with open(get_data_filepath("market_history.json"), "w", encoding="utf-8") as f:
            json.dump(detailed, f, indent=2, ensure_ascii=False)
            
        with open(get_data_filepath("market_history_10y.json"), "w", encoding="utf-8") as f:
            json.dump(historical_10y, f, indent=2, ensure_ascii=False)
            
        with open(get_data_filepath("ai_stocks_10y.json"), "w", encoding="utf-8") as f:
            json.dump(ai_stocks_10y, f, indent=2, ensure_ascii=False)
            
        print("Offline files data.js, market_history.json, market_history_10y.json and ai_stocks_10y.json updated successfully!")
    except Exception as e:
        print(f"Error writing local files: {e}")

if __name__ == "__main__":
    download_historical_data()
