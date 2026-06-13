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

# Helper to get paths relative to backend script directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "../data")

def get_data_filepath(filename):
    os.makedirs(DATA_DIR, exist_ok=True)
    return os.path.join(DATA_DIR, filename)

# Configurable endpoints
FED_RSS_URL = "https://www.federalreserve.gov/feeds/press_monetary.xml"
NEWS_RSS_URL = "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664"

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

def translate_text(text, target_lang="en"):
    if not text:
        return ""
    if target_lang == "en":
        return text
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
        print(f"Translation error: {e}", file=sys.stderr)
    return text

def summarize_to_30_chars(text):
    if not text:
        return ""
    text = text.strip()
    is_english = all(ord(c) < 128 for c in text)
    limit = 100 if is_english else 30
    
    if len(text) <= limit:
        return text
        
    punctuations = ['.', ';', ',', '!', '?'] if is_english else ['。', '；', '，', '！', '？']
    end_char = '.' if is_english else '。'
    comma_char = ',' if is_english else '，'
    
    # Try to find standard sentence/clause boundary within the first limit chars
    for i in range(limit - 1, -1, -1):
        if text[i] in punctuations:
            sliced = text[:i+1]
            if sliced[-1] == comma_char:
                sliced = sliced[:-1] + end_char
            return sliced
            
    # Find the first punctuation in the entire text
    for i in range(len(text)):
        if text[i] in punctuations:
            sliced = text[:i+1]
            if sliced[-1] == comma_char:
                sliced = sliced[:-1] + end_char
            return sliced
            
    return text[:limit - 1] + end_char

def scrape_and_translate_fed_announcement(link, title):
    title_zh = translate_text(title)
    content_zh = ""
    try:
        r = requests.get(link, headers={"User-Agent": "Mozilla/5.0"}, timeout=8)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, 'html.parser')
            content_div = soup.find(id='article') or soup.find(id='content') or soup.find(class_='col-xs-12 col-sm-8 col-md-8')
            if content_div:
                paragraphs = content_div.find_all('p')
                meaningful_p = []
                for p in paragraphs:
                    text = p.text.strip()
                    if len(text) > 40 and not text.startswith("Share") and not text.startswith("For release"):
                        meaningful_p.append(text)
                        if len(meaningful_p) >= 2:
                            break
                if meaningful_p:
                    combined_text = " ".join(meaningful_p)
                    if len(combined_text) > 350:
                        combined_text = combined_text[:350] + "..."
                    content_zh = translate_text(combined_text)
                    content_zh = summarize_to_30_chars(content_zh)
    except Exception as e:
        print(f"Error scraping Fed announcement at {link}: {e}", file=sys.stderr)
        
    if not content_zh:
        content_zh = "Discount rate or monetary policy meeting information release."
        
    return title_zh, content_zh

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
                
                title_clean = title.strip()
                link_clean = link.strip()
                
                # Scrape and translate details for the top announcements
                if len(announcements) < 2:
                    title_zh, content_zh = scrape_and_translate_fed_announcement(link_clean, title_clean)
                else:
                    title_zh = translate_text(title_clean)
                    content_zh = ""
                    
                announcements.append({
                    "title": title_clean,
                    "title_zh": title_zh,
                    "content_zh": content_zh,
                    "link": link_clean,
                    "date": date_str
                })
        else:
            print(f"Fed RSS request failed with status {r.status_code}", file=sys.stderr)
    except Exception as e:
        print(f"Error parsing Fed RSS: {e}", file=sys.stderr)
    return announcements

def fetch_market_news():
    """Fetches top market recaps from CNBC RSS and translates them to Chinese."""
    print("Fetching market news recaps...")
    news_items = []
    try:
        r = requests.get(NEWS_RSS_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if r.status_code == 200:
            root = ET.fromstring(r.content)
            for idx, item in enumerate(root.findall(".//item")[:8]): # Top 8 news
                title = item.find("title").text if item.find("title") is not None else ""
                link = item.find("link").text if item.find("link") is not None else ""
                pub_date = item.find("pubDate").text if item.find("pubDate") is not None else ""
                description = item.find("description").text if item.find("description") is not None else ""
                
                title_clean = title.strip()
                link_clean = link.strip()
                desc_clean = description.strip()
                
                source = "CNBC"
                
                try:
                    # Parse standard RSS pubDate e.g. "Fri, 29 May 2026 19:40:00 GMT"
                    dt = datetime.strptime(pub_date.strip(), "%a, %d %b %Y %H:%M:%S %Z")
                    date_str = dt.strftime("%Y-%m-%d %H:%M")
                except:
                    date_str = pub_date.strip()
                
                # Translate title
                title_zh = translate_text(title_clean)
                
                # Translate description/summary for top 3 stories
                if idx < 3 and desc_clean:
                    description_zh = translate_text(desc_clean)
                    description_zh = summarize_to_30_chars(description_zh)
                else:
                    description_zh = ""
                
                news_items.append({
                    "title": title_clean,
                    "title_zh": title_zh,
                    "description": desc_clean,
                    "description_zh": description_zh,
                    "link": link_clean,
                    "date": date_str,
                    "source": source
                })
        else:
            print(f"News RSS request failed with status {r.status_code}", file=sys.stderr)
    except Exception as e:
        print(f"Error parsing News RSS: {e}", file=sys.stderr)
    return news_items

def generate_ai_summary(indices, yields, fed_announcements, news_summary):
    # Stock summary
    stock_parts = []
    if indices:
        names = ['S&P 500', 'Nasdaq', 'Dow Jones', 'Russell 2000']
        up_indices = []
        down_indices = []
        valid_indices = 0
        for name in names:
            if name in indices:
                data = indices[name]
                valid_indices += 1
                change_pct = data.get("percent", 0)
                if change_pct >= 0:
                    up_indices.append(f"{name}(+{change_pct}%)")
                else:
                    down_indices.append(f"{name}({change_pct}%)")
        
        if valid_indices > 0:
            if len(up_indices) == valid_indices:
                stock_parts.append("Major US stock indices rose across the board, including " + ", ".join(up_indices) + ", showing strong market bullish momentum.")
            elif len(down_indices) == valid_indices:
                stock_parts.append("Major US stock indices fell across the board, including " + ", ".join(down_indices) + ", showing increased market risk aversion.")
            else:
                stock_summary = "US stock performance diverged: "
                if up_indices:
                    stock_summary += "rising indices include " + ", ".join(up_indices)
                if down_indices:
                    if up_indices:
                        stock_summary += "; "
                    stock_summary += "falling indices include " + ", ".join(down_indices)
                stock_parts.append(stock_summary + ".")
            
    # Yields summary
    yields_parts = []
    if yields:
        y2 = yields.get("2Y", {}).get("yield")
        y10 = yields.get("10Y", {}).get("yield")
        if y2 is not None and y10 is not None:
            spread = y10 - y2
            inversion_status = "the treasury yield curve is **inverted (Inversion) ⚠️** with a spread of {:.3f}%, indicating market concerns over medium-to-long term economic growth.".format(spread) if spread < 0 else "the bond market spread is normal, with a 10Y-2Y spread of {:.3f}%.".format(spread)
            yields_parts.append("2Y Treasury yield was at {}%, 10Y Treasury yield was at {}%. {}".format(y2, y10, inversion_status))
            
    # Fed and News summary
    fed_part = ""
    if fed_announcements:
        first_ann = fed_announcements[0]
        title_zh = first_ann.get("title_zh")
        content_zh = first_ann.get("content_zh")
        if not title_zh:
            title_zh = translate_text(first_ann.get("title", ""))
            
        fed_part = "🏛️ **Fed Monetary Policy (Today)**:"
        if content_zh and content_zh != "Discount rate or monetary policy meeting information release.":
            fed_part += f"\n• **{title_zh}**: {content_zh}"
        else:
            fed_part += f"\n• **{title_zh}** (Fed released discount rate meeting minutes or monetary policy statements.)"
    
    news_part = ""
    if news_summary:
        news_part = "📰 **Focus News (Today)**:"
        news_lines = []
        for n in news_summary[:3]:
            title_zh = n.get("title") or n.get("title_zh") or ""
            desc_zh = n.get("description") or n.get("summary") or n.get("description_zh") or n.get("summary_zh") or ""
            
            if desc_zh:
                news_lines.append(f"• **{title_zh}**: {desc_zh}")
            else:
                news_lines.append(f"• **{title_zh}**")
        if news_lines:
            news_part += "\n" + "\n".join(news_lines)
        
    summary_text = ""
    if stock_parts:
        summary_text += "📈 **Stock Market Overview**: " + "".join(stock_parts) + "\n"
    if yields_parts:
        summary_text += "💵 **Treasury & Interest Rates**: " + "".join(yields_parts) + "\n"
    if fed_part:
        summary_text += fed_part + "\n"
    if news_part:
        summary_text += news_part
        
    return summary_text.strip()

def fetch_ai_stocks():
    print("Fetching AI theme stock tickers...")
    tickers = ["AMZN", "AVGO", "MRVL", "GOOGL", "CEG", "VST", "ETN", "GE", "COHR", "LITE", "NVDA", "VRT", "FCX", "CAT", "PLTR", "MSFT", "CRM", "MU", "ASML", "AMAT", "CRWD", "PANW", "SMCI", "ANET"]
    stock_data = {}
    
    try:
        # Fetch 5 days history to get the latest daily change
        data = yf.download(tickers, period="5d", group_by="ticker", progress=False)
        for ticker in tickers:
            if ticker in data.columns.levels[0]:
                ticker_df = data[ticker]
                ticker_df = ticker_df.dropna(subset=["Close"])
                if not ticker_df.empty:
                    latest = ticker_df.iloc[-1]
                    prev = ticker_df.iloc[-2] if len(ticker_df) > 1 else latest
                    
                    close_val = float(latest["Close"])
                    prev_close = float(prev["Close"])
                    change = close_val - prev_close
                    percent = (change / prev_close) * 100 if prev_close != 0 else 0
                    
                    stock_data[ticker] = {
                        "close": round(close_val, 2),
                        "change": round(change, 2),
                        "percent": round(percent, 2)
                    }
                else:
                    print(f"No data for ticker {ticker}")
            else:
                print(f"Ticker {ticker} not found in download columns")
    except Exception as e:
        print(f"Error downloading AI stocks: {e}", file=sys.stderr)
        
    return stock_data

def calculate_sentiment_score(news_items):
    pos_words = ['soar', 'rally', 'rise', 'gain', 'up', 'bull', 'record', 'high', 'growth', 'boost', 'jump', 'beat', 'climb', 'strong']
    neg_words = ['plunge', 'fall', 'drop', 'down', 'bear', 'fear', 'worry', 'decline', 'slide', 'sink', 'warn', 'low', 'hit', 'crash', 'spooky', 'doom']
    
    score = 50 # Neutral start
    for item in news_items:
        title = item.get("title", "").lower()
        desc = item.get("description", "").lower()
        content = title + " " + desc
        
        for w in pos_words:
            if w in content:
                score += 5
        for w in neg_words:
            if w in content:
                score -= 5
                
    score = max(0, min(100, score))
    return score

def calculate_market_vibe_score(indices, yields, sentiment_score):
    # 1. Stock indices score (40%)
    index_pcts = []
    for name in ['S&P 500', 'Nasdaq', 'Dow Jones', 'Russell 2000']:
        if name in indices:
            index_pcts.append(indices[name].get("percent", 0))
    avg_index_change = sum(index_pcts) / len(index_pcts) if index_pcts else 0
    index_score = 50 + (avg_index_change * 25)
    index_score = max(0, min(100, index_score))
    
    # 2. Bond score (30%)
    y2 = yields.get("2Y", {}).get("yield")
    y10 = yields.get("10Y", {}).get("yield")
    if y2 is not None and y10 is not None:
        spread = y10 - y2
        spread_score = 50 + (spread * 50)
        
        y2_ch = abs(yields.get("2Y", {}).get("change", 0))
        y10_ch = abs(yields.get("10Y", {}).get("change", 0))
        vol = (y2_ch + y10_ch) / 2
        vol_score = max(0, 100 - (vol * 1000))
        
        bond_score = (spread_score * 0.7) + (vol_score * 0.3)
        bond_score = max(0, min(100, bond_score))
    else:
        bond_score = 50
        
    # 3. Vibe score
    vibe_score = (index_score * 0.4) + (bond_score * 0.3) + (sentiment_score * 0.3)
    return round(vibe_score, 1)

def main():
    print(f"Starting data collection at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}...")
    
    indices, last_date = fetch_stock_indices()
    if not indices:
        print("Error: Could not retrieve stock market index data. Aborting.")
        return
        
    yields = fetch_bond_yields()
    fed_news = fetch_fed_policy()
    market_news = fetch_market_news()
    ai_stocks = fetch_ai_stocks()
    
    # Compute sentiment and vibe score
    sentiment_score = calculate_sentiment_score(market_news)
    vibe_score = calculate_market_vibe_score(indices, yields, sentiment_score)
    print(f"Calculated Vibe Score: {vibe_score} (Sentiment: {sentiment_score})")
    
    # Use the actual last trading date from yfinance if available, otherwise today
    report_date = last_date if last_date else get_trading_date()
    print(f"Generated market report date: {report_date}")
    
    # Generate AI market highlights summary
    indices["ai_summary"] = generate_ai_summary(indices, yields, fed_news, market_news)
    
    # Store AI stocks and vibe score inside indices for database backward compatibility
    indices["ai_stocks"] = ai_stocks
    indices["sentiment_score"] = sentiment_score
    indices["vibe_score"] = vibe_score
    
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
            
            print("Fetching complete history from Supabase to update local cache...")
            # Fetch detailed history (paginated)
            history_data = []
            offset = 0
            while True:
                res = supabase.table("market_history").select("*").order("date", desc=True).range(offset, offset + 999).execute()
                batch = res.data
                if not batch:
                    break
                history_data.extend(batch)
                if len(batch) < 1000:
                    break
                offset += 1000
                
            # Fetch 10y history (paginated)
            history_10y_data = []
            offset = 0
            while True:
                res = supabase.table("market_history_10y").select("*").order("date", desc=True).range(offset, offset + 999).execute()
                batch = res.data
                if not batch:
                    break
                history_10y_data.extend(batch)
                if len(batch) < 1000:
                    break
                offset += 1000
            history_10y_data.reverse() # sorted ascending for JavaScript charting
            
            # Load and update AI stocks 10y history
            ai_stocks_10y_list = []
            ai_stocks_json_path = get_data_filepath("ai_stocks_10y.json")
            if os.path.exists(ai_stocks_json_path):
                try:
                    with open(ai_stocks_json_path, "r", encoding="utf-8") as f:
                        ai_stocks_10y_list = json.load(f)
                except Exception as e:
                    print(f"Warning loading existing ai_stocks_10y.json: {e}", file=sys.stderr)
            
            new_ai_10y = {"date": report_date}
            for t in ["AMZN", "AVGO", "MRVL", "GOOGL", "CEG", "VST", "ETN", "GE", "COHR", "LITE", "NVDA", "VRT", "FCX", "CAT", "PLTR", "MSFT", "CRM", "MU", "ASML", "AMAT", "CRWD", "PANW", "SMCI", "ANET"]:
                new_ai_10y[t] = ai_stocks.get(t, {}).get("close")
                
            ai_stocks_10y_list = [r for r in ai_stocks_10y_list if r.get("date") != report_date]
            ai_stocks_10y_list.append(new_ai_10y)
            ai_stocks_10y_list.sort(key=lambda x: x.get("date", ""))
            
            try:
                with open(ai_stocks_json_path, "w", encoding="utf-8") as f:
                    json.dump(ai_stocks_10y_list, f, indent=2, ensure_ascii=False)
            except Exception as e:
                print(f"Warning saving ai_stocks_10y.json: {e}", file=sys.stderr)
            
            # Write to data.js
            with open(get_data_filepath("data.js"), "w", encoding="utf-8") as f:
                f.write(f"// Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
                f.write(f"window.MARKET_HISTORY = {json.dumps(history_data, indent=2, ensure_ascii=False)};\n\n")
                f.write(f"window.HISTORICAL_10Y = {json.dumps(history_10y_data, indent=2, ensure_ascii=False)};\n\n")
                f.write(f"window.AI_STOCKS_10Y = {json.dumps(ai_stocks_10y_list, indent=2, ensure_ascii=False)};\n")
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
    data_js_path = get_data_filepath("data.js")
    if os.path.exists(data_js_path):
        try:
            with open(data_js_path, "r", encoding="utf-8") as f:
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
        "y5": yields.get("5Y", {}).get("yield"),
        "y10": yields.get("10Y", {}).get("yield"),
        "y30": yields.get("30Y", {}).get("yield")
    }
    
    history_10y = [r for r in history_10y if r.get("date") != payload["date"]]
    history_10y.append(new_10y)
    history_10y.sort(key=lambda x: x.get("date", ""))
    
    # Load and update AI stocks 10y history
    ai_stocks = payload.get("indices", {}).get("ai_stocks", {})
    ai_stocks_10y_list = []
    ai_stocks_json_path = get_data_filepath("ai_stocks_10y.json")
    if os.path.exists(ai_stocks_json_path):
        try:
            with open(ai_stocks_json_path, "r", encoding="utf-8") as f:
                ai_stocks_10y_list = json.load(f)
        except:
            pass
            
    new_ai_10y = {"date": payload["date"]}
    for t in ["AMZN", "AVGO", "MRVL", "GOOGL", "CEG", "VST", "ETN", "GE", "COHR", "LITE", "NVDA", "VRT", "FCX", "CAT", "PLTR", "MSFT", "CRM", "MU", "ASML", "AMAT", "CRWD", "PANW", "SMCI", "ANET"]:
        new_ai_10y[t] = ai_stocks.get(t, {}).get("close")
        
    ai_stocks_10y_list = [r for r in ai_stocks_10y_list if r.get("date") != payload["date"]]
    ai_stocks_10y_list.append(new_ai_10y)
    ai_stocks_10y_list.sort(key=lambda x: x.get("date", ""))
    
    # Save back to data.js
    try:
        with open(get_data_filepath("data.js"), "w", encoding="utf-8") as f:
            f.write(f"// Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} (Offline Mode)\n")
            f.write(f"window.MARKET_HISTORY = {json.dumps(history, indent=2, ensure_ascii=False)};\n\n")
            f.write(f"window.HISTORICAL_10Y = {json.dumps(history_10y, indent=2, ensure_ascii=False)};\n\n")
            f.write(f"window.AI_STOCKS_10Y = {json.dumps(ai_stocks_10y_list, indent=2, ensure_ascii=False)};\n")
        print(f"Offline file data.js updated successfully with report for {payload['date']}!")
        
        # Also create local backup JSONs
        with open(get_data_filepath("market_history.json"), "w", encoding="utf-8") as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
            
        with open(get_data_filepath("market_history_10y.json"), "w", encoding="utf-8") as f:
            json.dump(history_10y, f, indent=2, ensure_ascii=False)
            
        with open(ai_stocks_json_path, "w", encoding="utf-8") as f:
            json.dump(ai_stocks_10y_list, f, indent=2, ensure_ascii=False)
            
    except Exception as e:
        print(f"Error writing to local files: {e}", file=sys.stderr)

if __name__ == "__main__":
    main()
