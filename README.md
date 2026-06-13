# MacroVibe Intelligence: 美股與總經債市監測儀表板

MacroVibe Intelligence 是一個精美、互動式的數據監測儀表板，專為追蹤美股前一交易日的股市（各大指數、成分股）、債市（公債殖利率曲線、利差變動）、以及聯準會政策公告與焦點新聞而設計。

## 🌟 核心特色

- **雙模式運作**：
  - **雲端同步模式 (Supabase)**：將數據永久儲存於 Supabase 雲端資料庫，支援多裝置或多用戶間數據同步。
  - **本地離線模式**：若未設定雲端金鑰，程式會自動使用本地快取 `market_history.json` 與 `data/data.js`，雙擊網頁即可無縫瀏覽。
- **三大專業總經視覺化圖表**：
  - **殖利率曲線 (Yield Curve)**：視覺化公債期限結構（2Y、5Y、10Y、30Y），並在發生「倒掛」時自動發出警示。
  - **指數歷史走勢**：展示四大指數（S&P 500、Nasdaq、Dow Jones、Russell 2000）相對於基準日的累計百分比漲跌幅。
  - **10Y-2Y 殖利率利差 (Spread)**：追蹤著名的經濟衰退預警指標走勢。
- **AI 產業概念股分類監測與個股比較**：
  - **8 大 AI 產業板塊監測**：追蹤 ASIC晶片、AI電力電網、光通訊連接、軟體與代理等 8 大核心板塊的日平均漲跌幅與成分股。
  - **個股比較模式 (預設)**：點擊板塊卡片預設開啟此圖表，將選定時間區間第一天各成分股的收盤價設為基準點（從 `0%` 報酬率出發），方便對比各股的相對強弱表現，解決低價股波動被高價股壓縮的問題。
  - **單股技術指標圖表**：可切換查看單檔個股的真實收盤價 (USD)，並疊加 **MA5 (週線，淡藍)** 與 **MA20 (月線，橙黃)** 移動平均線。
  - **十字準星 (Crosshair) 模式**：滑鼠移至圖表時，在單一提示框同時對齊顯示當日價格、MA5 與 MA20 數值。
- **Yahoo 股市風格狀態欄**：動態展示當前圖表切換的個股狀態，如 `Close: $XXX | MA5: XXX | MA20: XX` 或個股比較回報率。
- **全英文國際化界面**：網頁端配合品牌名稱 `MacroVibe` 改版為全英文，後端數據採集器會自動生成全英文的 AI 市場導讀（Market Brief）。
- **極致視覺美學**：採用 Glassmorphism（玻璃擬態）暗色調風格、平滑微動畫與完全響應式設計。

---

## 🛠️ 安裝與準備工作

本專案使用 Python 採集數據，網頁前端為純靜態 HTML/CSS/JS。

### 1. 初始化 Python 環境
請在專案目錄下建立並啟動虛擬環境，隨後安裝依賴套件：
```bash
# 建立虛擬環境
python3 -m venv venv

# 啟動虛擬環境 (macOS/Linux)
source venv/bin/activate

# 安裝所需套件
pip install -r backend/requirements.txt
```

### 2. 資料庫設定 (Supabase - 選擇性)
如果您希望使用雲端同步模式：
1. 前往 [Supabase 官網](https://supabase.com) 註冊並建立一個新專案 (Project)。
2. 在左側導覽列進入 **SQL Editor**，點擊 **New Query**，貼上並執行以下 SQL 來建立資料表與讀取政策：
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
3. 在 Supabase 控制台的 **Settings -> API** 中取得您的 `Project URL`、`Anon Public Key` 與 `Service Role Key` (寫入金鑰)。

### 3. 使用者登入權限設定 (Supabase Auth)
為了只允許授權人士存取儀表板，請進行以下設定：
1. **關閉公開註冊（防範外人註冊帳號）**：
   - 登入 Supabase 控制台，選擇 **Authentication** -> **Settings**。
   - 在 **User Sign Up** 區塊中，**關閉「Allow new users to sign up」** 開關並儲存。
2. **手動新增授權帳號**：
   - 進入 **Authentication** -> **Users** 頁面。
   - 點擊 **「Add user」** -> **「Create user」**。
   - 輸入授權的 Email 與密碼，維持勾選「Auto-confirm User」後點擊 **Save**。

### 4. 設定金鑰與設定檔
1. **後端金鑰**：複製 `backend/.env.example` 並命名為 `backend/.env`，填入您的金鑰資訊（供 Python 寫入數據使用）：
   ```env
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key-never-share-this
   ```
2. **前端金鑰**：修改 `static/js/config.js` 檔案，填入公開金鑰資訊（供網頁讀取數據使用）：
   ```javascript
   window.SUPABASE_CONFIG = {
     url: "https://your-project-id.supabase.co",
     anonKey: "your-anon-public-key"
   };
   ```

---

## 🚀 使用說明

### 1. 抓取最新數據與更新快取
每當美股收盤後，或是您想更新最新數據時，執行以下指令：
```bash
venv/bin/python backend/fetch_data.py
```
* **若有設定 Supabase**：數據會自動 Upsert 到雲端資料庫，並自動下載歷史數據更新本地快取 `data/data.js`。
* **若未設定 Supabase**：數據會直接在 Offline 本地模式下運作，並更新至 `data/` 資料夾內。

如果您需要完整重新抓取過去 30 天詳細數據和 10 年歷史的趨勢快取，可以執行：
```bash
venv/bin/python backend/download_history.py
```

### 2. 開啟儀表板
直接雙擊專案目錄下的 **`index.html`**，即可直接在瀏覽器中開啟並觀看您收集到的每日數據與歷史趨勢！不需要啟動任何本地網頁伺服器。登入您的 Supabase 帳號，或是點擊下方「Browse in Local Offline Cache Mode」使用本地離線快取瀏覽。
