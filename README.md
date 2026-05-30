# 美股與債市每日監測儀表板 (US Market Daily Dashboard)

一個精美、互動式的本地數據儀表板，專為追蹤美國前一交易日的股市（指數、漲跌幅、日區間、成交量）、債市（公債殖利率曲線、利差變動）、以及聯準會政策公告與市場焦點新聞而設計。

## 🌟 特色
- **雙模式運作**：
  - **雲端資料庫模式 (Supabase)**：將數據永久儲存於雲端，並支援多裝置或多用戶間的數據即時分享與同步。
  - **離線快取模式 (Offline Mode)**：若未設定雲端金鑰，程式會自動將數據儲存於本地 `market_history.json` 與 `data.js`，無須任何設定即可雙擊網頁瀏覽。
- **三大專業視覺化圖表**：
  - **殖利率曲線 (Yield Curve)**：視覺化公債期限結構（2Y、5Y、10Y、30Y），並在發生「倒掛」時自動發出警示。
  - **指數歷史走勢**：展示各股指相對於基準日的累計百分比漲跌幅。
  - **10Y-2Y 殖利率利差 (Spread)**：追蹤利差走勢（著名的經濟衰退預警指標）。
- **極致美學**：採用 Glassmorphism（玻璃擬態）暗色調風格、平滑微動畫與完全響應式設計。

---

## 🛠️ 安裝與準備工作

本專案使用 Python 採集數據，網頁前端為純靜態 HTML/CSS/JS。

### 1. 初始化 Python 環境
請在專案目錄下建立並啟動虛擬環境，隨後安裝依賴：
```bash
# 建立虛擬環境
python3 -m venv venv

# 啟動虛擬環境 (macOS/Linux)
source venv/bin/activate

# 安裝所需套件
pip install yfinance python-dotenv supabase beautifulsoup4 requests
```

### 2. 資料庫設定 (Supabase - 選擇性)
如果您希望使用雲端共享模式：
1. 前往 [Supabase 官網](https://supabase.com) 免費註冊並建立一個新專案 (Project)。
2. 在左側導覽列進入 **SQL Editor**，點擊 **New Query**，貼上並執行以下 SQL 來建立資料表與 RLS 規則：
    ```sql
    -- 1. 建立每日詳細報告資料表
    create table if not exists public.market_history (
      date date primary key,
      indices jsonb not null,
      yields jsonb not null,
      fed_announcements jsonb not null,
      news_summary jsonb not null,
      updated_at timestamptz default timezone('utc'::text, now()) not null
    );

    -- 啟用 RLS
    alter table public.market_history enable row level security;

    -- 建立公開讀取安全政策
    create policy "Allow public read access"
    on public.market_history
    for select
    using (true);

    -- 2. 建立 10 年歷史趨勢資料表
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

    -- 啟用 10y RLS
    alter table public.market_history_10y enable row level security;

    -- 建立 10y 公開讀取安全政策
    create policy "Allow public read access on 10y"
    on public.market_history_10y
    for select
    using (true);
    ```
3. 在 Supabase 控制台的 **Settings -> API** 中取得您的 `Project URL`、`Anon Public Key` 與 `Service Role Key` (秘密寫入金鑰)。

### 3. 使用者登入權限設定 (Supabase Auth)
為了只允許特定人士存取此儀表板，請依以下步驟進行設定：
1. **關閉公開註冊（防範外人註冊帳號）**：
   - 登入 [Supabase 官網控制台](https://supabase.com)。
   - 在左側選單選擇 **Authentication** -> **Settings**。
   - 在 **User Sign Up** 區塊中，**關閉「Allow new users to sign up」** (允許新用戶註冊) 開關。
   - 點擊頁面右上方 **Save** 儲存設定。
2. **手動建立被允許的帳號**：
   - 進入 **Authentication** -> **Users** 頁面。
   - 點擊右上角 **「Add user」** -> **「Create user」**。
   - 輸入您要授權人士的 Email 與密碼，並建議維持勾選「Auto-confirm User」（自動驗證信箱）。
   - 點擊 **Save**。此帳號即可立即登入！

### 4. 設定金鑰檔
1. **後端金鑰**：複製 `.env.example` 並命名為 `.env`，填入您的金鑰資訊（供 Python 寫入數據使用）：
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key-never-share-this
   ```
2. **前端金鑰**：修改 `config.js` 檔案，填入公開金鑰資訊（供網頁讀取數據使用）：
   ```javascript
   window.SUPABASE_CONFIG = {
     url: "https://your-project-id.supabase.co",
     anonKey: "your-anon-public-key"
   };
   ```

---

## 🚀 使用說明

### 1. 抓取最新數據
每當美股收盤後，或是您想更新最新數據時，執行以下指令：
```bash
venv/bin/python fetch_data.py
```
* **若有設定 Supabase**：數據會自動 Upsert (更新或覆蓋) 到雲端資料表，並自動下載歷史數據至本地快取 `data.js` 中。
* **若未設定 Supabase**：數據會直接更新至本地的 `market_history.json` 與 `data.js` 中（離線模式）。

### 2. 開啟儀表板
直接雙擊專案目錄下的 **`index.html`**，即可直接在瀏覽器中開啟並觀看您收集到的每日數據與歷史趨勢！不需要啟動任何本地 HTTP 伺服器。
