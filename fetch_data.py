import os
import sys
import json
from datetime import datetime
import requests
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
import yfinance as yf
from dotenv import load_dotenv

# Load local environment variables from .env
load_dotenv()

# Configurable endpoints
FED_RSS_URL = "https://www.federalreserve.gov/feeds/press_monetary.xml"
NEWS_RSS_URL = "https://news.google.com/rss/search?q=US+stock+market+recap+when:1d&hl=en-US&gl=US&ceid=US:en"

def get_trading_date():
    """Returns today's date in YYYY-MM-DD format for local storage."""
    return datetime.today().strftime('%Y-%m-%d')

def fetch_stock_indices():
    """Fetches key stock indices using yfinance."""
    print("Fetching stock indices from Yahoo Finance...")
    tickers = {
        "S&P 500": "^GSPC",
        "Nasdaq": "^IXIC",
        "Dow Jones": "^DJI",
        "Russell 2000": "^RUT"
    }
    indices_data = {}
    last_trading_date = None
    
    for name, symbol in tickers.items():
        try:
            t = yf.Ticker(symbol)
            hist = t.history(period="5d")
            if not hist.empty:
                latest = hist.iloc[-1]
                prev = hist.iloc[-2]
                
                close_val = float(latest["Close"])
                prev_close = float(prev["Close"])
                change = close_val - prev_close
                percent = (change / prev_close) * 100
                
                # Retrieve the date of the last trading session
                trading_date = hist.index[-1].strftime('%Y-%m-%d')
                if not last_trading_date:
                    last_trading_date = trading_date
                
                indices_data[name] = {
                    "symbol": symbol,
                    "close": round(close_val, 2),
                    "change": round(change, 2),
                    "percent": round(percent, 2),
                    "high": round(float(latest["High"]), 2),
                    "low": round(float(latest["Low"]), 2),
                    "volume": int(latest["Volume"])
                }
            else:
                print(f"No history found for index {name} ({symbol})")
        except Exception as e:
            print(f"Error fetching index {name}: {e}", file=sys.stderr)
            
    return indices_data, last_trading_date

def fetch_cnbc_yield(symbol):
    """Scrapes US Treasury Bond Yield and daily change from CNBC."""
    url = f"https://www.cnbc.com/quotes/{symbol}"
    try:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"})
        if r.status_code != 200:
            return None
            
        soup = BeautifulSoup(r.text, 'html.parser')
        last_price_el = soup.find('span', class_='QuoteStrip-lastPrice')
        change_el = soup.find(class_='QuoteStrip-changeDown') or soup.find(class_='QuoteStrip-changeUp')
        
        if not last_price_el:
            return None
            
        last_price = last_price_el.text.strip().replace('%', '')
        yield_val = float(last_price)
        
        change_val = 0.0
        if change_el:
            val_el = change_el.find('span')
            change_text = val_el.text.strip() if val_el else change_el.text.strip()
            # Clean non-numeric characters like arrows
            change_text = ''.join(c for c in change_text if c.isdigit() or c in ['.', '-', '+'])
            if change_text:
                change_val = float(change_text)
                
            if 'QuoteStrip-changeDown' in str(change_el):
                if change_val > 0:
                    change_val = -change_val
            elif 'QuoteStrip-changeUp' in str(change_el):
                if change_val < 0:
                    change_val = -change_val
                    
        return {
            "yield": round(yield_val, 3),
            "change": round(change_val, 3),
            "bps": round(change_val * 100, 1)
        }
    except Exception as e:
        print(f"Error scraping yield for {symbol} from CNBC: {e}", file=sys.stderr)
        return None

def fetch_bond_yields():
    """Fetches key US Treasury Bond Yields."""
    print("Scraping bond yields from CNBC...")
    yields_to_fetch = {
        "2Y": "US2Y",
        "5Y": "US5Y",
        "10Y": "US10Y",
        "30Y": "US30Y"
    }
    yields_data = {}
    for name, symbol in yields_to_fetch.items():
        data = fetch_cnbc_yield(symbol)
        if data:
            yields_data[name] = data
            print(f"Bond Yield {name}: {data['yield']}% ({data['bps']} bps)")
        else:
            print(f"Failed to fetch bond yield {name} ({symbol})")
    return yields_data

def fetch_fed_policy():
    """Fetches Fed monetary policy announcements from official RSS feed."""
    print("Fetching Federal Reserve announcements...")
    announcements = []
    try:
        r = requests.get(FED_RSS_URL, headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code == 200:
            root = ET.fromstring(r.content)
            for item in root.findall(".//item")[:5]: # Take top 5 recent news
                title = item.find("title").text
                link = item.find("link").text
                pub_date = item.find("pubDate").text
                # Reformat date for display
                try:
                    dt = datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S %Z")
                    date_str = dt.strftime("%Y-%m-%d")
                except:
                    date_str = pub_date
                
                announcements.append({
                    "title": title.strip(),
                    "link": link.strip(),
                    "date": date_str
                })
        else:
            print(f"Fed RSS request failed with status {r.status_code}", file=sys.stderr)
    except Exception as e:
        print(f"Error parsing Fed RSS: {e}", file=sys.stderr)
    return announcements

def fetch_market_news():
    """Fetches top market recaps from Google News RSS."""
    print("Fetching market news recaps...")
    news_items = []
    try:
        r = requests.get(NEWS_RSS_URL, headers={"User-Agent": "Mozilla/5.0"})
        if r.status_code == 200:
            root = ET.fromstring(r.content)
            for item in root.findall(".//item")[:8]: # Top 8 news
                title = item.find("title").text
                link = item.find("link").text
                pub_date = item.find("pubDate").text
                
                source = "Google News"
                if " - " in title:
                    parts = title.split(" - ")
                    title = " - ".join(parts[:-1])
                    source = parts[-1]
                
                try:
                    # Parse standard RSS pubDate e.g. "Fri, 29 May 2026 19:40:00 GMT"
                    dt = datetime.strptime(pub_date, "%a, %d %b %Y %H:%M:%S %Z")
                    date_str = dt.strftime("%Y-%m-%d %H:%M")
                except:
                    date_str = pub_date
                
                news_items.append({
                    "title": title.strip(),
                    "link": link.strip(),
                    "date": date_str,
                    "source": source.strip()
                })
        else:
            print(f"News RSS request failed with status {r.status_code}", file=sys.stderr)
    except Exception as e:
        print(f"Error parsing News RSS: {e}", file=sys.stderr)
    return news_items

def main():
    print(f"Starting data collection at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}...")
    
    indices, last_date = fetch_stock_indices()
    if not indices:
        print("Error: Could not retrieve stock market index data. Aborting.")
        return
        
    yields = fetch_bond_yields()
    fed_news = fetch_fed_policy()
    market_news = fetch_market_news()
    
    # Use the actual last trading date from yfinance if available, otherwise today
    report_date = last_date if last_date else get_trading_date()
    print(f"Generated market report date: {report_date}")
    
    report_payload = {
        "date": report_date,
        "indices": indices,
        "yields": yields,
        "fed_announcements": fed_news,
        "news_summary": market_news,
        "updated_at": datetime.utcnow().isoformat() + "Z"
    }
    
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
        print("Supabase credentials detected. Uploading data to Cloud database...")
        try:
            from supabase import create_client, Client
            supabase: Client = create_client(supabase_url, supabase_key)
            
            # Upsert into market_history table
            # Row matches on the primary key 'date'
            response = supabase.table("market_history").upsert(report_payload).execute()
            print("Data successfully uploaded to Supabase detailed table!")
            
            # Upsert into market_history_10y table
            record_10y = {
                "date": report_date,
                "sp500": indices["S&P 500"]["close"] if "S&P 500" in indices else None,
                "nasdaq": indices["Nasdaq"]["close"] if "Nasdaq" in indices else None,
                "dow": indices["Dow Jones"]["close"] if "Dow Jones" in indices else None,
                "russell": indices["Russell 2000"]["close"] if "Russell 2000" in indices else None,
                "y2": yields["2Y"]["yield"] if yields and "2Y" in yields else None,
                "y5": yields["5Y"]["yield"] if yields and "5Y" in yields else None,
                "y10": yields["10Y"]["yield"] if yields and "10Y" in yields else None,
                "y30": yields["30Y"]["yield"] if yields and "30Y" in yields else None
            }
            supabase.table("market_history_10y").upsert(record_10y).execute()
            print("Data successfully uploaded to Supabase 10y table!")
            
            # To facilitate local viewing and double-clicking index.html without setting up 
            # credentials in the frontend config right away, we will also fetch the full history 
            # from Supabase and write it to data.js as a local cache.
            print("Fetching complete history from Supabase to update local cache...")
            history_response = supabase.table("market_history").select("*").order("date", desc=True).execute()
            history_data = history_response.data
            
            history_10y_response = supabase.table("market_history_10y").select("*").order("date", desc=True).execute()
            history_10y_data = history_10y_response.data
            history_10y_data.reverse() # sorted ascending for JavaScript charting
            
            # Write to data.js
            with open("data.js", "w", encoding="utf-8") as f:
                f.write(f"// Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"window.MARKET_HISTORY = {json.dumps(history_data, indent=2, ensure_ascii=False)};\n\n")
                f.write(f"window.HISTORICAL_10Y = {json.dumps(history_10y_data, indent=2, ensure_ascii=False)};\n")
            print("Local cache data.js updated successfully!")
            
        except Exception as e:
            print(f"Error communicating with Supabase: {e}", file=sys.stderr)
            print("Falling back to local data.js offline update...")
            update_local_js(report_payload)
    else:
        print("\n[WARNING] Supabase is not configured (or is using placeholders in .env).")
        print("To configure, update the '.env' file with your Supabase URL and Service Role Key.")
        print("Falling back to offline mode: updating local data.js directly...")
        update_local_js(report_payload)

def update_local_js(payload):
    """Updates the local data.js by appending or updating the record for this day."""
    history = []
    history_10y = []
    
    # Read existing history from data.js if it exists
    if os.path.exists("data.js"):
        try:
            with open("data.js", "r", encoding="utf-8") as f:
                content = f.read()
                # Find the JSON array parts
                if "window.MARKET_HISTORY = " in content:
                    parts = content.split("window.MARKET_HISTORY = ")
                    part_detailed = parts[1].split("window.HISTORICAL_10Y = ")
                    detailed_str = part_detailed[0].rstrip(";\n ")
                    history = json.loads(detailed_str)
                    
                    if len(part_detailed) > 1:
                        history_10y_str = part_detailed[1].rstrip(";\n ")
                        history_10y = json.loads(history_10y_str)
        except Exception as e:
            print(f"Warning: Could not parse existing data.js ({e}). Starting fresh.")
            
    # Remove existing record for the same date if it exists
    history = [record for record in history if record.get("date") != payload["date"]]
    
    # Insert new record at the beginning (sorted descending by date)
    history.insert(0, payload)
    history.sort(key=lambda x: x.get("date", ""), reverse=True)
    
    # Update 10y compact history list
    indices = payload.get("indices", {})
    yields = payload.get("yields", {})
    new_10y = {
        "date": payload["date"],
        "sp500": indices.get("S&P 500", {}).get("close"),
        "nasdaq": indices.get("Nasdaq", {}).get("close"),
        "dow": indices.get("Dow Jones", {}).get("close"),
        "russell": indices.get("Russell 2000", {}).get("close"),
        "y2": yields.get("2Y", {}).get("yield"),
        "y10": yields.get("10Y", {}).get("yield")
    }
    
    history_10y = [r for r in history_10y if r.get("date") != payload["date"]]
    history_10y.append(new_10y)
    history_10y.sort(key=lambda x: x.get("date", ""))
    
    # Save back to data.js
    try:
        with open("data.js", "w", encoding="utf-8") as f:
            f.write(f"// Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} (Offline Mode)\n")
            f.write(f"window.MARKET_HISTORY = {json.dumps(history, indent=2, ensure_ascii=False)};\n\n")
            f.write(f"window.HISTORICAL_10Y = {json.dumps(history_10y, indent=2, ensure_ascii=False)};\n")
        print(f"Offline file data.js updated successfully with report for {payload['date']}!")
        
        # Also create local backup JSONs
        with open("market_history.json", "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
            
        with open("market_history_10y.json", "w", encoding="utf-8") as f:
            json.dump(history_10y, f, indent=2, ensure_ascii=False)
            
    except Exception as e:
        print(f"Error writing to local files: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
