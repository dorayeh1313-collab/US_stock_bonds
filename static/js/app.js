// State variables
let marketHistoryData = [];
let selectedDateRecord = null;
let chartInstance = null;
let themeChartInstance = null;
let activeThemeName = null;
let activeTab = 'yield-history';
let selectedTimeframe = '10Y'; // Default timeframe for history charts
let selectedThemeTimeframe = '10Y'; // Default timeframe for AI theme stocks chart
let selectedThemeTicker = null; // Currently selected stock ticker for AI theme chart
let supabaseClient = null;

// AI Themes Configuration
const AI_THEMES = {
  "ASIC & Cloud Giants ⚡": ["AMZN", "AVGO", "MRVL", "GOOGL"],
  "AI Power & Grid 🔋": ["CEG", "VST", "ETN", "GE"],
  "Optics & Connectivity 🌐": ["COHR", "LITE", "NVDA"],
  "AI Industry & Copper 🔩": ["VRT", "FCX", "CAT"],
  "AI Software & Agents 🧠": ["PLTR", "MSFT", "CRM"],
  "Advanced Packaging & HBM 🧪": ["MU", "ASML", "AMAT"],
  "Cyber Security & Defense 🛡️": ["CRWD", "PANW", "PLTR"],
  "GLP-1 & Biotech 💊": ["LLY", "NVO"]
};

// Idle Auto-logout Configuration (10 minutes)
let idleTimer = null;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await initData();
});

// Setup UI Interaction Event Listeners
function setupEventListeners() {
  // Nav Tab Switching
  const navBtns = document.querySelectorAll('.nav-tab-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('.nav-tab-btn');
      if (!targetBtn) return;
      
      navBtns.forEach(b => b.classList.remove('active'));
      targetBtn.classList.add('active');
      
      const selectedTab = targetBtn.dataset.tab;
      
      if (selectedTab === 'macro') {
        document.querySelectorAll('.macro-tab-content').forEach(el => el.classList.remove('hidden'));
        document.querySelectorAll('.ai-stocks-tab-content').forEach(el => el.classList.add('hidden'));
      } else if (selectedTab === 'ai-stocks') {
        document.querySelectorAll('.macro-tab-content').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.ai-stocks-tab-content').forEach(el => el.classList.remove('hidden'));
        renderAiStocksTab();
      }
    });
  });

  // Date Selector Change
  document.getElementById('date-select').addEventListener('change', (e) => {
    const selectedDate = e.target.value;
    loadDateData(selectedDate);
  });

  // Chart Tab Toggles
  const tabBtns = document.querySelectorAll('.chart-tab-btn');
  const timeframeSelector = document.getElementById('timeframe-selector');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Find the button (handling potential icon click inside)
      const targetBtn = e.target.closest('.chart-tab-btn');
      if (!targetBtn) return;
      
      tabBtns.forEach(b => b.classList.remove('active'));
      targetBtn.classList.add('active');
      
      activeTab = targetBtn.dataset.tab;
      

      
      renderChart();
    });
  });

  // Timeframe Selector Clicks (Macro Charts)
  const macroTimeframeBtns = document.querySelectorAll('#timeframe-selector .timeframe-btn');
  macroTimeframeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      macroTimeframeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      selectedTimeframe = btn.dataset.range;
      renderChart();
    });
  });

  // Timeframe Selector Clicks (AI Theme Stocks Chart)
  const themeTimeframeBtns = document.querySelectorAll('#theme-timeframe-selector .timeframe-btn');
  themeTimeframeBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      themeTimeframeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      selectedThemeTimeframe = btn.dataset.range;
      if (activeThemeName) {
        renderThemeStocksChart(activeThemeName);
      }
    });
  });

  // Login Form Submission
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const errorEl = document.getElementById('login-error-msg');
      const submitBtn = document.getElementById('login-submit-btn');
      const btnText = document.getElementById('login-btn-text');

      errorEl.classList.add('hidden');
      submitBtn.disabled = true;
      btnText.innerText = '驗證中...';

      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
          if (error) {
            errorEl.innerText = '登入失敗：' + translateAuthError(error.message);
            errorEl.classList.remove('hidden');
          }
        } catch (err) {
          errorEl.innerText = '系統錯誤：' + err.message;
          errorEl.classList.remove('hidden');
        }
      } else {
        errorEl.innerText = '資料庫未連結，無法驗證。';
        errorEl.classList.remove('hidden');
      }

      submitBtn.disabled = false;
      btnText.innerText = '登入系統';
    });
  }

  // Bypass Login Button
  const bypassBtn = document.getElementById('bypass-login-btn');
  if (bypassBtn) {
    bypassBtn.addEventListener('click', () => {
      loadOfflineMode();
    });
  }

  // Logout Button Click
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (supabaseClient) {
        await supabaseClient.auth.signOut();
      }
    });
  }
}

// Translate Supabase Auth Error messages to Chinese
function translateAuthError(msg) {
  if (msg.includes('Invalid login credentials')) return '電子信箱或密碼錯誤。';
  if (msg.includes('Email not confirmed')) return '電子信箱尚未進行確認驗證。';
  return msg;
}

// Check Supabase Settings and Initialize Data
async function initData() {
  // Verify if Supabase is configured
  const hasConfig = window.SUPABASE_CONFIG && 
                    window.SUPABASE_CONFIG.url && 
                    window.SUPABASE_CONFIG.anonKey &&
                    !window.SUPABASE_CONFIG.url.includes('your-project-id') &&
                    !window.SUPABASE_CONFIG.anonKey.includes('your-anon-public-key');

  if (hasConfig) {
    try {
      // Create Supabase Client using sessionStorage to log out on tab close
      supabaseClient = supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey, {
        auth: {
          persistSession: true,
          storage: window.sessionStorage
        }
      });
      
      const handleSignIn = async (session) => {
        updateDbStatus(true);
        document.getElementById('logout-btn').classList.remove('hidden');
        
        // Start tracking inactivity when logged in
        setupIdleTracker();

        // Fetch data from database
        const success = await fetchDatabaseData();
        if (success) {
          document.getElementById('login-overlay').classList.add('hidden');
          document.getElementById('main-dashboard').classList.remove('hidden');
        } else {
          console.warn("Failed to fetch database data, falling back to offline cache.");
          loadOfflineMode();
        }
      };

      const handleSignOut = () => {
        document.getElementById('main-dashboard').classList.add('hidden');
        document.getElementById('login-overlay').classList.remove('hidden');
        
        // Stop tracking inactivity when logged out
        removeIdleTracker();
      };

      // Get initial session to guarantee UI state updates immediately
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;

      if (session) {
        await handleSignIn(session);
      } else {
        handleSignOut();
      }

      // Listen to subsequent authentication state changes
      supabaseClient.auth.onAuthStateChange(async (event, newSession) => {
        if (newSession) {
          await handleSignIn(newSession);
        } else {
          handleSignOut();
        }
      });
      
    } catch (e) {
      console.error("Failed to initialize Supabase. Falling back to offline cache:", e);
      loadOfflineMode();
    }
  } else {
    // Bypassing auth in offline mode
    loadOfflineMode();
  }
}

// Fetch data from Supabase
async function fetchDatabaseData() {
  try {
    const { data, error } = await supabaseClient
      .from('market_history')
      .select('*')
      .order('date', { ascending: false });
      
    if (error) throw error;
    
    if (data && data.length > 0) {
      marketHistoryData = data;
      
      // Fetch 10y history from Supabase (paginated to bypass 1000-row limit)
      try {
        let allData10y = [];
        let from = 0;
        let to = 999;
        let keepFetching = true;
        
        while (keepFetching) {
          const { data: batch, error: error10y } = await supabaseClient
            .from('market_history_10y')
            .select('*')
            .order('date', { ascending: true })
            .range(from, to);
            
          if (error10y) throw error10y;
          
          if (batch && batch.length > 0) {
            allData10y = allData10y.concat(batch);
            if (batch.length < 1000) {
              keepFetching = false;
            } else {
              from += 1000;
              to += 1000;
            }
          } else {
            keepFetching = false;
          }
        }
        window.HISTORICAL_10Y = allData10y;
      } catch (err10y) {
        console.error("Failed to fetch 10y history from Supabase:", err10y);
      }
      
      // Populate date select and render latest
      populateDateDropdown();
      if (marketHistoryData.length > 0) {
        const latestDate = marketHistoryData[0].date;
        document.getElementById('date-select').value = latestDate;
        loadDateData(latestDate);
      }
      return true;
    }
    return false;
  } catch (e) {
    console.error("Error loading database content:", e);
    return false;
  }
}

// Load local backup cache files (Offline Mode)
function loadOfflineMode() {
  updateDbStatus(false);
  
  // Hide logout button in offline mode since there's no auth session
  document.getElementById('logout-btn').classList.add('hidden');
  
  if (window.MARKET_HISTORY && window.MARKET_HISTORY.length > 0) {
    marketHistoryData = window.MARKET_HISTORY;
    populateDateDropdown();
    if (marketHistoryData.length > 0) {
      const latestDate = marketHistoryData[0].date;
      document.getElementById('date-select').value = latestDate;
      loadDateData(latestDate);
    }
    // Show dashboard immediately bypassing auth
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('main-dashboard').classList.remove('hidden');
  } else {
    console.error("No offline market history cache found.");
    showEmptyState();
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('main-dashboard').classList.remove('hidden');
  }
}

// Update DB Status indicator badge in top header
function updateDbStatus(isOnline) {
  const badge = document.getElementById('db-status-badge');
  const text = document.getElementById('db-status-text');
  
  if (isOnline) {
    badge.className = 'badge badge-online';
    text.innerText = '雲端資料庫模式';
  } else {
    badge.className = 'badge badge-offline';
    text.innerText = '離線快取模式';
  }
}

// Populate Date Selector
function populateDateDropdown() {
  const select = document.getElementById('date-select');
  select.innerHTML = ''; // clear dropdown
  
  marketHistoryData.forEach(record => {
    const opt = document.createElement('option');
    opt.value = record.date;
    opt.innerText = record.date;
    select.appendChild(opt);
  });
}

// Load data for a specific date and update the UI components
function loadDateData(dateString) {
  selectedDateRecord = marketHistoryData.find(r => r.date === dateString);
  if (!selectedDateRecord) return;
  
  // Update section timestamps
  document.getElementById('stock-date').innerText = selectedDateRecord.date;
  document.getElementById('bond-date').innerText = selectedDateRecord.date;
  
  if (selectedDateRecord.updated_at) {
    const dt = new Date(selectedDateRecord.updated_at);
    document.getElementById('last-update-time').innerText = dt.toLocaleString('zh-TW');
  } else {
    document.getElementById('last-update-time').innerText = '--';
  }
  
  // Render sub-sections
  renderStockCards();
  renderYieldCards();
  renderFedAnnouncements();
  renderMarketNews();
  renderChart();
  
  // Render AI Summary Highlights
  const summaryEl = document.getElementById('ai-summary-text');
  if (summaryEl) {
    const rawSummary = generateMarketSummary(selectedDateRecord);
    summaryEl.innerHTML = formatMarkdown(rawSummary);
  }
  
  // Render AI Stocks tab content
  renderAiStocksTab();
}

// Format numbers with commas and decimals
function formatNum(val, decimals = 2) {
  if (val === undefined || val === null || isNaN(val)) return '--';
  return Number(val).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// Helper to format short volume (e.g. 1.2B, 350M)
function formatVolume(vol) {
  if (vol === undefined || vol === null || isNaN(vol)) return '--';
  const v = Number(vol);
  if (v >= 1e9) return (v / 1e9).toFixed(2) + ' B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + ' M';
  return v.toLocaleString('en-US');
}

// Render Stock Cards (S&P, Nasdaq, Dow, Russell)
function renderStockCards() {
  const stockContainer = document.getElementById('stock-cards');
  const indices = selectedDateRecord.indices || {};
  
  const indexConfig = [
    { id: 'card-sp500', name: 'S&P 500 指數', key: 'S&P 500' },
    { id: 'card-nasdaq', name: 'Nasdaq 綜合指數', key: 'Nasdaq' },
    { id: 'card-dow', name: 'Dow Jones 工業指數', key: 'Dow Jones' },
    { id: 'card-russell', name: 'Russell 2000 小型股', key: 'Russell 2000' }
  ];
  
  indexConfig.forEach(cfg => {
    const cardEl = document.getElementById(cfg.id);
    const data = indices[cfg.key];
    
    if (!data) {
      cardEl.innerHTML = `<div class="empty-list-msg">無 ${cfg.name} 數據</div>`;
      return;
    }
    
    const isUp = data.change >= 0;
    const directionClass = isUp ? 'up' : 'down';
    const trendIcon = isUp ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
    const sign = isUp ? '+' : '';
    
    cardEl.innerHTML = `
      <div class="stock-card-header">
        <div class="stock-name-symbol">
          <h3>${cfg.name}</h3>
          <p>${data.symbol}</p>
        </div>
        <span class="trend-mini-icon ${directionClass}">
          <i class="fa-solid ${trendIcon}"></i>
        </span>
      </div>
      <div class="stock-value-area">
        <div class="stock-price">${formatNum(data.close, 2)}</div>
        <div class="stock-change-area ${directionClass}">
          <span>${sign}${formatNum(data.change, 2)}</span>
          <span>(${sign}${formatNum(data.percent, 2)}%)</span>
        </div>
      </div>
      <div class="stock-range-area">
        <div>日低: <span class="stock-range-val">${formatNum(data.low, 2)}</span></div>
        <div>日高: <span class="stock-range-val">${formatNum(data.high, 2)}</span></div>
      </div>
      <div class="stock-range-area" style="border: none; padding-top: 6px; margin-top: 0;">
        <div>量: <span class="stock-range-val">${formatVolume(data.volume)}</span></div>
      </div>
    `;
  });
}

// Render Bond Yield Cards (2Y, 5Y, 10Y, 30Y)
function renderYieldCards() {
  const yields = selectedDateRecord.yields || {};
  
  const yieldConfig = [
    { id: 'card-yield-2y', term: '2Y 國債殖利率', key: '2Y', desc: '二年期公債 (反映利率預期)' },
    { id: 'card-yield-5y', term: '5Y 國債殖利率', key: '5Y', desc: '五年期公債 (中期融資指標)' },
    { id: 'card-yield-10y', term: '10Y 國債殖利率', key: '10Y', desc: '十年期公債 (全球資產定價之錨)' },
    { id: 'card-yield-30y', term: '30Y 國債殖利率', key: '30Y', desc: '三十年期公債 (長期房貸基準)' }
  ];
  
  yieldConfig.forEach(cfg => {
    const cardEl = document.getElementById(cfg.id);
    const data = yields[cfg.key];
    
    if (!data) {
      cardEl.innerHTML = `<div class="empty-list-msg">無 ${cfg.key} 數據</div>`;
      return;
    }
    
    const isUp = data.change >= 0;
    const directionClass = isUp ? 'up' : 'down';
    const trendIcon = isUp ? 'fa-caret-up' : 'fa-caret-down';
    const sign = isUp ? '+' : '';
    
    cardEl.innerHTML = `
      <div class="yield-card-header">
        <span class="yield-label">${cfg.term}</span>
        <span class="yield-sub">${cfg.key}</span>
      </div>
      <div class="yield-rate">${formatNum(data.yield, 3)}<span>%</span></div>
      <div class="yield-change-bps ${directionClass}">
        <i class="fa-solid ${trendIcon}"></i>
        <span>${sign}${formatNum(data.bps, 1)} bps</span>
        <span style="color: var(--text-muted); font-size: 0.72rem; font-weight: normal; margin-left: 4px;">(日變動)</span>
      </div>
      <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.04); padding-top: 8px;">
        ${cfg.desc}
      </div>
    `;
  });
}

// Render Federal Reserve Announcements
function renderFedAnnouncements() {
  const listEl = document.getElementById('fed-list');
  
  let items = selectedDateRecord.fed_announcements || [];
  let isFallback = false;
  let sourceDate = selectedDateRecord.date;
  
  if (items.length === 0) {
    const fallbackRecord = findClosestRecordWithKey(selectedDateRecord.date, 'fed_announcements');
    if (fallbackRecord) {
      items = fallbackRecord.fed_announcements;
      isFallback = true;
      sourceDate = fallbackRecord.date;
    }
  }
  
  const sectionContainer = listEl.closest('.fed-policy-section');
  if (sectionContainer) {
    const headerEl = sectionContainer.querySelector('.section-header');
    if (headerEl) {
      let badge = headerEl.querySelector('.section-date-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'section-date-badge';
        headerEl.appendChild(badge);
      }
      badge.innerText = isFallback ? `${sourceDate} (最新)` : sourceDate;
    }
  }
  
  if (items.length === 0) {
    listEl.innerHTML = '<li class="empty-list-msg">今日無聯邦準會政策公告</li>';
    return;
  }
  
  listEl.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'announcement-item';
    li.innerHTML = `
      <div class="announcement-meta">
        <span class="announcement-date"><i class="fa-regular fa-clock"></i> ${item.date}</span>
        <span class="announcement-source">FOMC</span>
      </div>
      <a href="${item.link}" target="_blank" class="announcement-title-link">
        ${item.title} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.75rem; margin-left: 2px;"></i>
      </a>
    `;
    listEl.appendChild(li);
  });
}

// Render Market News Recaps
function renderMarketNews() {
  const listEl = document.getElementById('news-list');
  
  let items = selectedDateRecord.news_summary || [];
  let isFallback = false;
  let sourceDate = selectedDateRecord.date;
  
  if (items.length === 0) {
    const fallbackRecord = findClosestRecordWithKey(selectedDateRecord.date, 'news_summary');
    if (fallbackRecord) {
      items = fallbackRecord.news_summary;
      isFallback = true;
      sourceDate = fallbackRecord.date;
    }
  }
  
  const sectionContainer = listEl.closest('.market-news-section');
  if (sectionContainer) {
    const headerEl = sectionContainer.querySelector('.section-header');
    if (headerEl) {
      let badge = headerEl.querySelector('.section-date-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'section-date-badge';
        headerEl.appendChild(badge);
      }
      badge.innerText = isFallback ? `${sourceDate} (最新)` : sourceDate;
    }
  }
  
  if (items.length === 0) {
    listEl.innerHTML = '<li class="empty-list-msg">無今日焦點新聞</li>';
    return;
  }
  
  listEl.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'announcement-item';
    li.innerHTML = `
      <div class="announcement-meta">
        <span class="announcement-date"><i class="fa-regular fa-clock"></i> ${item.date}</span>
        <span class="announcement-source">${item.source || '新聞'}</span>
      </div>
      <a href="${item.link}" target="_blank" class="announcement-title-link">
        ${item.title} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 0.75rem; margin-left: 2px;"></i>
      </a>
    `;
    listEl.appendChild(li);
  });
}

// Render Chart depending on selected tab
function renderChart() {
  const ctx = document.getElementById('marketChart').getContext('2d');
  
  // Destroy existing chart to prevent drawing bugs
  if (chartInstance) {
    chartInstance.destroy();
  }
  
  // Custom font options matching styling
  const chartFont = {
    family: "'Inter', sans-serif",
    size: 11
  };
  
  if (activeTab === 'yield-history') {
    // Plot Treasury Yield trends for selected timeframe
    const use10y = window.HISTORICAL_10Y && window.HISTORICAL_10Y.length > 0;
    const allRecords = use10y ? window.HISTORICAL_10Y : [...marketHistoryData].reverse();
    
    // Filter records to only include dates up to selectedDateRecord.date
    const targetEndDateStr = selectedDateRecord ? selectedDateRecord.date : (allRecords.length > 0 ? allRecords[allRecords.length - 1].date : null);
    const recordsCapped = targetEndDateStr ? allRecords.filter(r => r.date <= targetEndDateStr) : allRecords;
    
    // Filter records based on selectedTimeframe relative to selected date
    let cronRecords = recordsCapped;
    if (recordsCapped.length > 0 && targetEndDateStr) {
      const cutoff = getCutoffDate(targetEndDateStr, selectedTimeframe);
      cronRecords = recordsCapped.filter(r => new Date(r.date) >= cutoff);
    }
    const dates = cronRecords.map(r => r.date);
    
    const datasets = [];
    const yieldConfigs = [
      { name: '2-Year Yield', prop: 'y2', color: '#00f2fe' },
      { name: '5-Year Yield', prop: 'y5', color: '#8a2be2' },
      { name: '10-Year Yield', prop: 'y10', color: '#ffb703' },
      { name: '30-Year Yield', prop: 'y30', color: '#ff3366' }
    ];
    
    yieldConfigs.forEach(cfg => {
      const yData = cronRecords.map(r => {
        if (use10y) {
          return r[cfg.prop];
        } else {
          const yields = r.yields || {};
          const termKey = cfg.name.split('-')[0]; // '2', '5', '10', '30'
          const formattedTerm = termKey + 'Y'; // '2Y', '5Y', etc.
          return yields[formattedTerm] ? yields[formattedTerm].yield : null;
        }
      });
      
      datasets.push({
        label: cfg.name,
        data: yData,
        borderColor: cfg.color,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 6,
        tension: 0.1
      });
    });
    
    if (datasets.every(ds => ds.data.every(x => x === null))) {
      drawEmptyChartMessage(ctx, "無足夠殖利率歷史數據");
      return;
    }

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#f1f5f9', font: chartFont }
          },
          tooltip: {
            backgroundColor: '#1e293b',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return ` ${context.dataset.label}: ${context.raw.toFixed(3)}%`;
              }
            }
          }
        },
        scales: {
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#94a3b8',
              font: chartFont,
              callback: function(value) { return value.toFixed(2) + '%'; }
            },
            title: {
              display: true,
              text: '殖利率 %',
              color: '#94a3b8',
              font: chartFont
            }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: chartFont }
          }
        }
      }
    });

  } else if (activeTab === 'index-history') {
    // Plot stock index historical normalized percent change
    // Use 10-year compact history if available, otherwise fallback to 30-day records
    const use10y = window.HISTORICAL_10Y && window.HISTORICAL_10Y.length > 0;
    const allRecords = use10y ? window.HISTORICAL_10Y : [...marketHistoryData].reverse();
    
    // Filter records to only include dates up to selectedDateRecord.date
    const targetEndDateStr = selectedDateRecord ? selectedDateRecord.date : (allRecords.length > 0 ? allRecords[allRecords.length - 1].date : null);
    const recordsCapped = targetEndDateStr ? allRecords.filter(r => r.date <= targetEndDateStr) : allRecords;
    
    // Filter records based on selectedTimeframe relative to selected date
    let cronRecords = recordsCapped;
    if (recordsCapped.length > 0 && targetEndDateStr) {
      const cutoff = getCutoffDate(targetEndDateStr, selectedTimeframe);
      cronRecords = recordsCapped.filter(r => new Date(r.date) >= cutoff);
    }
    const dates = cronRecords.map(r => r.date);
    
    // We normalize all indices relative to the oldest date in history (100% baseline)
    const datasets = [];
    
    if (use10y) {
      const indexConfigs = [
        { name: 'S&P 500', prop: 'sp500', color: '#00f2fe' },
        { name: 'Nasdaq', prop: 'nasdaq', color: '#8a2be2' },
        { name: 'Dow Jones', prop: 'dow', color: '#ffb703' },
        { name: 'Russell 2000', prop: 'russell', color: '#ff3366' }
      ];
      
      indexConfigs.forEach(cfg => {
        let baseline = null;
        const pctData = cronRecords.map(r => {
          const val = r[cfg.prop];
          if (val === null || val === undefined) return null;
          if (baseline === null) {
            baseline = val;
          }
          return ((val - baseline) / baseline) * 100;
        });
        
        if (baseline !== null) {
          datasets.push({
            label: cfg.name,
            data: pctData,
            borderColor: cfg.color,
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 6,
            tension: 0.1
          });
        }
      });
    } else {
      const indexConfigs = [
        { key: 'S&P 500', color: '#00f2fe' },
        { key: 'Nasdaq', color: '#8a2be2' },
        { key: 'Dow Jones', color: '#ffb703' },
        { key: 'Russell 2000', color: '#ff3366' }
      ];
      
      indexConfigs.forEach(cfg => {
        let baseline = null;
        const pctData = cronRecords.map(r => {
          const ind = r.indices && r.indices[cfg.key];
          if (!ind) return null;
          if (baseline === null) {
            baseline = ind.close;
          }
          return ((ind.close - baseline) / baseline) * 100;
        });
        
        if (baseline !== null) {
          datasets.push({
            label: cfg.key,
            data: pctData,
            borderColor: cfg.color,
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: dates.length > 20 ? 1 : 3,
            pointHoverRadius: 6,
            tension: 0.1
          });
        }
      });
    }
    
    if (datasets.length === 0) {
      drawEmptyChartMessage(ctx, "無足夠歷史數據繪製趨勢圖");
      return;
    }

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#f1f5f9', font: chartFont }
          },
          tooltip: {
            backgroundColor: '#1e293b',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                const label = context.dataset.label;
                const record = cronRecords[context.dataIndex];
                let actualVal = 0;
                if (use10y) {
                  const propMap = { 'S&P 500': 'sp500', 'Nasdaq': 'nasdaq', 'Dow Jones': 'dow', 'Russell 2000': 'russell' };
                  actualVal = record[propMap[label]] || 0;
                } else {
                  actualVal = record.indices && record.indices[label] ? record.indices[label].close : 0;
                }
                return ` ${label}: ${context.raw >= 0 ? '+' : ''}${context.raw.toFixed(2)}% (收盤: ${actualVal.toLocaleString()})`;
              }
            }
          }
        },
        scales: {
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#94a3b8',
              font: chartFont,
              callback: function(value) { return (value >= 0 ? '+' : '') + value.toFixed(1) + '%'; }
            },
            title: {
              display: true,
              text: '相較基準日之累計漲跌幅 %',
              color: '#94a3b8',
              font: chartFont
            }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: chartFont }
          }
        }
      }
    });
    
  } else if (activeTab === 'spread-history') {
    // 10Y-2Y Spread history: 10Y Yield - 2Y Yield
    const use10y = window.HISTORICAL_10Y && window.HISTORICAL_10Y.length > 0;
    const allRecords = use10y ? window.HISTORICAL_10Y : [...marketHistoryData].reverse();
    
    // Filter records to only include dates up to selectedDateRecord.date
    const targetEndDateStr = selectedDateRecord ? selectedDateRecord.date : (allRecords.length > 0 ? allRecords[allRecords.length - 1].date : null);
    const recordsCapped = targetEndDateStr ? allRecords.filter(r => r.date <= targetEndDateStr) : allRecords;
    
    // Filter records based on selectedTimeframe relative to selected date
    let cronRecords = recordsCapped;
    if (recordsCapped.length > 0 && targetEndDateStr) {
      const cutoff = getCutoffDate(targetEndDateStr, selectedTimeframe);
      cronRecords = recordsCapped.filter(r => new Date(r.date) >= cutoff);
    }
    const dates = cronRecords.map(r => r.date);
    
    const spreadData = cronRecords.map(r => {
      if (use10y) {
        if (r.y10 !== null && r.y2 !== null) {
          return r.y10 - r.y2;
        }
      } else {
        const yields = r.yields || {};
        if (yields['10Y'] && yields['2Y']) {
          return yields['10Y'].yield - yields['2Y'].yield;
        }
      }
      return null;
    });
    
    if (spreadData.every(x => x === null)) {
      drawEmptyChartMessage(ctx, "無公債殖利率利差數據");
      return;
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(0, 242, 254, 0.15)');
    gradient.addColorStop(1, 'rgba(255, 51, 102, 0.15)');

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: '10Y - 2Y 債券殖利率利差 (Spread)',
          data: spreadData,
          borderColor: '#a855f7',
          backgroundColor: gradient,
          fill: true,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#f1f5f9', font: chartFont }
          },
          tooltip: {
            backgroundColor: '#1e293b',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                const val = context.raw;
                const statusStr = val < 0 ? ' (殖利率倒掛⚠️)' : '';
                return ` 利差: ${val.toFixed(3)}%${statusStr}`;
              }
            }
          }
        },
        scales: {
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#94a3b8',
              font: chartFont,
              callback: function(value) { return value.toFixed(2) + '%'; }
            }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: chartFont }
          }
        }
      }
    });
  }
}

// Display simple text in canvas when no data is available
function drawEmptyChartMessage(ctx, message) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = '#94a3b8';
  ctx.font = "14px 'Inter', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, ctx.canvas.width / 2, ctx.canvas.height / 2);
}

// Calculate the cutoff date based on a given latest date and a timeframe string
function getCutoffDate(latestDateStr, timeframe) {
  const latestDate = new Date(latestDateStr);
  let cutoffDate = new Date(latestDate);
  
  if (timeframe === '1M') {
    cutoffDate.setMonth(cutoffDate.getMonth() - 1);
  } else if (timeframe === '6M') {
    cutoffDate.setMonth(cutoffDate.getMonth() - 6);
  } else if (timeframe === '1Y') {
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  } else if (timeframe === '5Y') {
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 5);
  } else { // '10Y'
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 10);
  }
  return cutoffDate;
}

// Find closest record in marketHistoryData to a given target date string (within 7 days)
function findClosestRecord(targetDateStr) {
  if (!marketHistoryData || marketHistoryData.length === 0) return null;
  
  const targetTime = new Date(targetDateStr).getTime();
  let closestRecord = null;
  let minDiff = Infinity;
  
  for (const record of marketHistoryData) {
    const recordTime = new Date(record.date).getTime();
    const diff = Math.abs(recordTime - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      closestRecord = record;
    }
  }
  
  const maxAllowedDiff = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  if (minDiff > maxAllowedDiff) {
    return null;
  }
  
  return closestRecord;
}

// Show standard empty screen when no data is available
function showEmptyState() {
  document.getElementById('stock-cards').innerHTML = '<div class="empty-list-msg">查無數據，請先執行 fetch_data.py 抓取最新資料！</div>';
  document.getElementById('yield-cards').innerHTML = '<div class="empty-list-msg">查無數據</div>';
  document.getElementById('fed-list').innerHTML = '<li class="empty-list-msg">無數據</li>';
  document.getElementById('news-list').innerHTML = '<li class="empty-list-msg">無數據</li>';
}

// Setup Idle Inactivity Tracker (Auto logout after 10 mins)
function setupIdleTracker() {
  const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
  events.forEach(event => {
    window.addEventListener(event, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

// Remove Idle Inactivity Tracker
function removeIdleTracker() {
  const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
  events.forEach(event => {
    window.removeEventListener(event, resetIdleTimer);
  });
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

// Reset the inactivity countdown
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(handleIdleLogout, IDLE_TIMEOUT_MS);
}

// Trigger logout on 10 minutes of idle inactivity
async function handleIdleLogout() {
  if (supabaseClient) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      console.log("User idle for 10 minutes. Logging out...");
      await supabaseClient.auth.signOut();
      alert("由於您閒置超過 10 分鐘，系統已自動登出。");
    }
  }
}

// Generate an analytical summary of the market conditions and policy changes
function generateMarketSummary(record) {
  if (!record) return '無此日期的數據可以進行總結。';
  
  // If the record already has a pre-generated AI summary in the payload, use it
  if (record.indices && record.indices.ai_summary) {
    return record.indices.ai_summary;
  }
  
  const indices = record.indices || {};
  const yields = record.yields || {};
  
  // 1. Fed Announcements: ONLY show if there is an announcement on the selected date (no fallback!)
  let feds = record.fed_announcements || [];
  
  // 2. Focus News: fallback to past dates if empty
  let news = record.news_summary || [];
  if (news.length === 0) {
    const fallbackNewsRecord = findLatestRecordOnOrBeforeDateWithKey(record.date, 'news_summary');
    if (fallbackNewsRecord) {
      news = fallbackNewsRecord.news_summary;
    }
  }
  
  let stockParts = [];
  const names = ['S&P 500', 'Nasdaq', 'Dow Jones', 'Russell 2000'];
  let upIndices = [];
  let downIndices = [];
  let validIndicesCount = 0;
  
  names.forEach(name => {
    const data = indices[name];
    if (data) {
      validIndicesCount++;
      const changePct = data.percent;
      if (changePct >= 0) {
        upIndices.push(`${name}(+${changePct.toFixed(2)}%)`);
      } else {
        downIndices.push(`${name}(${changePct.toFixed(2)}%)`);
      }
    }
  });
  
  if (validIndicesCount > 0) {
    if (upIndices.length === validIndicesCount) {
      stockParts.push(`美股主要指數全線上揚，包括 ${upIndices.join('、')}，市場多頭氣勢強勁。`);
    } else if (downIndices.length === validIndicesCount) {
      stockParts.push(`美股主要指數全線下跌，包括 ${downIndices.join('、')}，市場避險情緒升溫。`);
    } else {
      let part = '美股走勢分化，';
      if (upIndices.length > 0) {
        part += `上漲的有 ${upIndices.join('、')}`;
      }
      if (downIndices.length > 0) {
        if (upIndices.length > 0) part += '；';
        part += `下跌的有 ${downIndices.join('、')}`;
      }
      stockParts.push(part + '。');
    }
  }
  
  let yieldParts = [];
  const y2 = yields['2Y'] ? yields['2Y'].yield : null;
  const y10 = yields['10Y'] ? yields['10Y'].yield : null;
  if (y2 !== null && y10 !== null) {
    const spread = y10 - y2;
    const inversionText = spread < 0 
      ? `債券殖利率曲線呈現<strong>倒掛 (Inversion) ⚠️</strong>，利差為 ${spread.toFixed(3)}%，顯示市場對中長期經濟增長仍存隱憂。` 
      : `債券市場利差正常，10Y-2Y 利差為 ${spread.toFixed(3)}%。`;
    yieldParts.push(`2年期公債殖利率報 ${y2.toFixed(3)}%，10年期公債殖利率報 ${y10.toFixed(3)}%，${inversionText}`);
  }
  
  let fedPart = '';
  if (feds.length > 0) {
    const firstFed = feds[0];
    const titleZh = firstFed.title_zh || firstFed.title;
    const contentZh = firstFed.content_zh;
    fedPart = `🏛️ <strong>聯準會政策 (當日動態)</strong>：`;
    if (contentZh && contentZh !== '貼現率或貨幣政策會議資訊發布。') {
      fedPart += `\n• <strong>${titleZh}</strong>：${contentZh}`;
    } else {
      fedPart += `\n• <strong>${titleZh}</strong> (發布貼現率會議紀錄或貨幣政策聲明。)`;
    }
  }
  
  let newsPart = '';
  if (news.length > 0) {
    newsPart = `📰 <strong>焦點新聞 (當日)</strong>：`;
    const newsLines = [];
    news.slice(0, 3).forEach(n => {
      const titleZh = n.title_zh || n.title;
      const descZh = n.description_zh || n.summary_zh || n.description || n.summary || '';
      if (descZh) {
        newsLines.push(`• <strong>${titleZh}</strong>：${descZh}`);
      } else {
        newsLines.push(`• <strong>${titleZh}</strong>`);
      }
    });
    if (newsLines.length > 0) {
      newsPart += `\n` + newsLines.join('\n');
    }
  }
  
  let summary = '';
  if (stockParts.length > 0) {
    summary += `📈 <strong>股市概況</strong>：${stockParts.join('')}\n`;
  }
  if (yieldParts.length > 0) {
    summary += `💵 <strong>債市與利率</strong>：${yieldParts.join('')}\n`;
  }
  if (fedPart) {
    summary += `${fedPart}\n`;
  }
  if (newsPart) {
    summary += `${newsPart}`;
  }
  
  return summary || '今日市場交投清淡，無重大指數及殖利率變動。';
}

// Format markdown bold (**text**) to HTML <strong> with collapsible sections
function formatMarkdown(text) {
  if (!text) return '';
  
  // Replace **bold** with <strong>bold</strong>
  let html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  const lines = html.split('\n');
  let resultHtml = '';
  let inDetails = false;
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    if (trimmed.includes('🏛️ <strong>聯準會政策')) {
      if (inDetails) {
        resultHtml += '</div></details>';
        inDetails = false;
      }
      resultHtml += `<details class="ai-summary-accordion">
        <summary class="ai-summary-accordion-header">
          <span>${trimmed}</span>
        </summary>
        <div class="accordion-content">`;
      inDetails = true;
    } else if (trimmed.includes('📰 <strong>焦點新聞')) {
      if (inDetails) {
        resultHtml += '</div></details>';
        inDetails = false;
      }
      resultHtml += `<details class="ai-summary-accordion">
        <summary class="ai-summary-accordion-header">
          <span>${trimmed}</span>
        </summary>
        <div class="accordion-content">`;
      inDetails = true;
    } else if (trimmed.startsWith('📈') || trimmed.startsWith('💵')) {
      if (inDetails) {
        resultHtml += '</div></details>';
        inDetails = false;
      }
      resultHtml += `<p class="ai-summary-para">${trimmed}</p>`;
    } else {
      if (inDetails) {
        resultHtml += `<p class="accordion-item-line">${trimmed}</p>`;
      } else {
        resultHtml += `<p class="ai-summary-para">${trimmed}</p>`;
      }
    }
  });
  
  if (inDetails) {
    resultHtml += '</div></details>';
  }
  
  return resultHtml;
}

// AI Theme Concept Stocks & Market Vibe Score Card rendering logic
function renderAiStocksTab() {
  if (!selectedDateRecord) return;
  
  // Update date displays
  document.querySelectorAll('.select-date-display').forEach(el => {
    el.innerText = selectedDateRecord.date;
  });
  
  const indices = selectedDateRecord.indices || {};
  const yields = selectedDateRecord.yields || {};
  
  // Retrieve vibe and sentiment score (calculate dynamically if missing from older logs)
  let vibeScore = indices.vibe_score;
  let sentimentScore = indices.sentiment_score;
  if (vibeScore === undefined || vibeScore === null) {
    sentimentScore = 55.0; // Default sentiment score
    
    let indexPcts = [];
    const names = ['S&P 500', 'Nasdaq', 'Dow Jones', 'Russell 2000'];
    names.forEach(name => {
      if (indices[name]) indexPcts.push(indices[name].percent || 0);
    });
    const avgIndex = indexPcts.length ? (indexPcts.reduce((a,b)=>a+b, 0) / indexPcts.length) : 0;
    const indexScore = Math.max(0, Math.min(100, 50 + (avgIndex * 25)));
    
    const y2 = yields['2Y'] ? yields['2Y'].yield : null;
    const y10 = yields['10Y'] ? yields['10Y'].yield : null;
    let bondScore = 50;
    if (y2 !== null && y10 !== null) {
      const spread = y10 - y2;
      const spreadScore = 50 + (spread * 50);
      const y2_ch = Math.abs(yields['2Y'].change || 0);
      const y10_ch = Math.abs(yields['10Y'].change || 0);
      const vol = (y2_ch + y10_ch) / 2;
      const volScore = Math.max(0, 100 - (vol * 1000));
      bondScore = Math.max(0, Math.min(100, (spreadScore * 0.7) + (volScore * 0.3)));
    }
    
    vibeScore = Math.round(((indexScore * 0.4) + (bondScore * 0.3) + (sentimentScore * 0.3)) * 10) / 10;
  }
  
  renderVibeCard(vibeScore, sentimentScore);
  renderConceptCards(indices.ai_stocks || {});
  
  // Render theme stocks chart if active theme is selected
  if (activeThemeName) {
    renderThemeStocksChart(activeThemeName);
  } else {
    const chartContainer = document.getElementById('theme-stocks-chart-container');
    if (chartContainer) {
      chartContainer.classList.add('hidden');
    }
    if (themeChartInstance) {
      themeChartInstance.destroy();
      themeChartInstance = null;
    }
  }
}

function renderVibeCard(score, sentiment) {
  const container = document.getElementById('vibe-score-card-section');
  if (!container) return;
  
  let label = 'Meh Vibe 😐';
  let className = 'vibe-meh';
  let desc = '市場情緒中立，波動幅度有限，建議觀望大盤阻力區間。';
  
  if (score >= 80) {
    label = 'Extreme Bullish Vibe 🚀';
    className = 'vibe-extreme-bullish';
    desc = '市場極度樂觀，買盤強勁且公債殖利率曲線與大盤上漲形成共振，多頭氣勢如虹！';
  } else if (score >= 60) {
    label = 'Chill Vibe 📈';
    className = 'vibe-chill';
    desc = '市場氛圍溫和偏多，大盤走勢平穩，適合佈局成長型標的。';
  } else if (score >= 41) {
    label = 'Meh Vibe 😐';
    className = 'vibe-meh';
    desc = '市場情緒中立，波動幅度有限，建議觀望大盤阻力區間。';
  } else if (score >= 20) {
    label = 'Spooky Vibe 👻';
    className = 'vibe-spooky';
    desc = '市場氣氛有些詭譎，美債利差緊繃或指數下跌，請留意資金控管與避險防守。';
  } else {
    label = 'Doom Vibe 🚨';
    className = 'vibe-doom';
    desc = '市場面臨極端賣壓與避險警訊，恐慌情緒高漲，美債曲線警示，建議保留現金！';
  }
  
  container.innerHTML = `
    <div class="vibe-card ${className}-bg">
      <div class="vibe-left">
        <div class="vibe-title-row">
          <h2>今日市場 Vibe 分數</h2>
          <span class="vibe-badge-label ${className}">${label}</span>
        </div>
        <p class="vibe-desc">${desc}</p>
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 6px;">
          <i class="fa-solid fa-calculator"></i> 計算權重：大盤表現 (40%) + 美債殖利率與波動 (30%) + AI 輿情情緒 (30%)。目前新聞情緒指數：${sentiment || 50} 分。
        </div>
      </div>
      <div class="vibe-right">
        <div class="vibe-score-circle ${className}">
          <span class="vibe-score-val">${score.toFixed(1)}</span>
          <span class="vibe-score-lbl">Vibe Score</span>
        </div>
      </div>
    </div>
  `;
}

function renderConceptCards(aiStocksData) {
  const gridContainer = document.getElementById('ai-stocks-grid-container');
  if (!gridContainer) return;
  
  const hasData = aiStocksData && Object.keys(aiStocksData).length > 0;
  gridContainer.innerHTML = '';
  
  Object.entries(AI_THEMES).forEach(([themeName, tickers]) => {
    let sumPct = 0;
    let count = 0;
    let tooltipListHtml = '';
    let tickerPreviewHtml = '';
    
    tickers.forEach(ticker => {
      tickerPreviewHtml += `<span class="mini-ticker-tag">${ticker}</span>`;
      
      let pct = null;
      let closePrice = null;
      if (hasData && aiStocksData[ticker]) {
        pct = aiStocksData[ticker].percent;
        closePrice = aiStocksData[ticker].close;
      }
      
      if (pct !== null && pct !== undefined) {
        sumPct += pct;
        count++;
        const sign = pct >= 0 ? '+' : '';
        const trendClass = pct >= 0 ? 'up' : 'down';
        tooltipListHtml += `
          <div class="tooltip-stock-row">
            <span class="tooltip-stock-ticker">${ticker}</span>
            <span style="color: var(--text-muted); font-size: 0.75rem;">$${closePrice}</span>
            <span class="tooltip-stock-change ${trendClass}">${sign}${pct.toFixed(2)}%</span>
          </div>
        `;
      } else {
        tooltipListHtml += `
          <div class="tooltip-stock-row">
            <span class="tooltip-stock-ticker">${ticker}</span>
            <span class="tooltip-stock-change" style="color: var(--text-muted);">無當日數據</span>
          </div>
        `;
      }
    });
    
    const avgChange = count > 0 ? (sumPct / count) : null;
    const displayChange = avgChange !== null ? (avgChange >= 0 ? '+' : '') + avgChange.toFixed(2) + '%' : '--%';
    const directionClass = avgChange !== null ? (avgChange >= 0 ? 'up' : 'down') : 'meh';
    
    const card = document.createElement('div');
    card.className = 'ai-concept-card';
    if (activeThemeName === themeName) {
      card.classList.add('active');
    }
    
    card.innerHTML = `
      <div class="ai-concept-header">
        <span class="ai-concept-title">${themeName}</span>
        <span class="trend-mini-icon ${directionClass}">
          <i class="fa-solid ${avgChange >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
        </span>
      </div>
      <div class="ai-concept-change ${directionClass}">${displayChange}</div>
      <div class="ai-concept-ticker-preview">
        ${tickerPreviewHtml}
      </div>
      <div class="tooltip-content">
        <div class="tooltip-title">
          <span>成分股清單</span>
          <span>日變動 %</span>
        </div>
        <div class="tooltip-stock-list">
          ${tooltipListHtml}
        </div>
      </div>
    `;
    
    // Bind click event listener to card
    card.addEventListener('click', () => {
      if (activeThemeName === themeName) {
        // Toggle/Deselect
        activeThemeName = null;
        card.classList.remove('active');
        const chartContainer = document.getElementById('theme-stocks-chart-container');
        if (chartContainer) {
          chartContainer.classList.add('hidden');
        }
        if (themeChartInstance) {
          themeChartInstance.destroy();
          themeChartInstance = null;
        }
      } else {
        // Select
        activeThemeName = themeName;
        selectedThemeTicker = 'COMPARE'; // Reset selection so it defaults to the comparison view of the category
        document.querySelectorAll('.ai-concept-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        renderThemeStocksChart(themeName);
      }
    });
    
    gridContainer.appendChild(card);
  });
}

// Helper to calculate Moving Average from window.AI_STOCKS_10Y
function getMovingAverage(fullIdx, ticker, period) {
  if (fullIdx < 0) return null;
  // If current price is null, MA is null (pre-IPO)
  if (!window.AI_STOCKS_10Y[fullIdx] || window.AI_STOCKS_10Y[fullIdx][ticker] === null || window.AI_STOCKS_10Y[fullIdx][ticker] === undefined) {
    return null;
  }
  
  let sum = 0;
  let count = 0;
  for (let i = 0; i < period; i++) {
    const idx = fullIdx - i;
    if (idx < 0) break;
    const val = window.AI_STOCKS_10Y[idx][ticker];
    if (val !== null && val !== undefined) {
      sum += val;
      count++;
    }
  }
  
  // Require exactly 'period' non-null prices to start plotting
  if (count < period) return null;
  return sum / period;
}

// Fallback helper to calculate Moving Average from simulated local walk prices array
function getFallbackMA(prices, idx, period) {
  if (idx < 0 || idx >= prices.length) return null;
  if (prices[idx] === null || prices[idx] === undefined) return null;
  if (idx < period - 1) return null;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < period; i++) {
    const val = prices[idx - i];
    if (val !== null && val !== undefined) {
      sum += val;
      count++;
    }
  }
  if (count < period) return null;
  return sum / period;
}

// Render theme components comparison line chart using deterministic random walk walkback
function renderThemeStocksChart(themeName) {
  const container = document.getElementById('theme-stocks-chart-container');
  if (!container) return;
  
  const titleEl = document.getElementById('theme-chart-title');
  if (titleEl) {
    titleEl.innerHTML = `<i class="fa-solid fa-chart-line-up"></i> ${themeName} 成分股技術指標對比`;
  }
  
  // Show chart container block
  container.classList.remove('hidden');
  
  const ctx = document.getElementById('themeStocksChart').getContext('2d');
  
  if (themeChartInstance) {
    themeChartInstance.destroy();
  }
  
  const tickers = AI_THEMES[themeName];
  if (!tickers || tickers.length === 0) return;
  
  // If selected theme ticker is not in this theme and is not 'COMPARE', default to COMPARE
  if (!selectedThemeTicker || (selectedThemeTicker !== 'COMPARE' && !tickers.includes(selectedThemeTicker))) {
    selectedThemeTicker = 'COMPARE';
  }
  
  // Dynamically generate small, beautiful stock selector buttons (tabs)
  const selectorContainer = document.getElementById('theme-stock-selector-container');
  if (selectorContainer) {
    selectorContainer.innerHTML = '';
    
    // 1. Generate the comparison button (at the far left)
    const compareBtn = document.createElement('button');
    compareBtn.className = `stock-tab-btn${selectedThemeTicker === 'COMPARE' ? ' active' : ''}`;
    compareBtn.innerText = '📊 個股比較';
    compareBtn.style.cssText = `
      background: ${selectedThemeTicker === 'COMPARE' ? 'rgba(0, 242, 254, 0.12)' : 'rgba(255, 255, 255, 0.03)'};
      color: ${selectedThemeTicker === 'COMPARE' ? '#00f2fe' : '#94a3b8'};
      border: 1px solid ${selectedThemeTicker === 'COMPARE' ? '#00f2fe' : 'rgba(255, 255, 255, 0.1)'};
      padding: 5px 14px;
      font-size: 0.8rem;
      font-weight: 600;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.2s ease;
      outline: none;
      font-family: 'Inter', sans-serif;
      margin-right: 12px;
    `;
    compareBtn.addEventListener('mouseenter', () => {
      if (selectedThemeTicker !== 'COMPARE') {
        compareBtn.style.background = 'rgba(255, 255, 255, 0.08)';
        compareBtn.style.color = '#f1f5f9';
      }
    });
    compareBtn.addEventListener('mouseleave', () => {
      if (selectedThemeTicker !== 'COMPARE') {
        compareBtn.style.background = 'rgba(255, 255, 255, 0.03)';
        compareBtn.style.color = '#94a3b8';
      }
    });
    compareBtn.addEventListener('click', () => {
      selectedThemeTicker = 'COMPARE';
      renderThemeStocksChart(themeName);
    });
    selectorContainer.appendChild(compareBtn);

    // 2. Generate the individual stock buttons
    tickers.forEach(ticker => {
      const btn = document.createElement('button');
      btn.className = `stock-tab-btn${ticker === selectedThemeTicker ? ' active' : ''}`;
      btn.innerText = ticker;
      btn.style.cssText = `
        background: ${ticker === selectedThemeTicker ? 'rgba(0, 242, 254, 0.12)' : 'rgba(255, 255, 255, 0.03)'};
        color: ${ticker === selectedThemeTicker ? '#00f2fe' : '#94a3b8'};
        border: 1px solid ${ticker === selectedThemeTicker ? '#00f2fe' : 'rgba(255, 255, 255, 0.1)'};
        padding: 5px 14px;
        font-size: 0.8rem;
        font-weight: 500;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.2s ease;
        outline: none;
        font-family: 'Inter', sans-serif;
        margin-right: 6px;
      `;
      
      // Hover effects
      btn.addEventListener('mouseenter', () => {
        if (ticker !== selectedThemeTicker) {
          btn.style.background = 'rgba(255, 255, 255, 0.08)';
          btn.style.color = '#f1f5f9';
        }
      });
      btn.addEventListener('mouseleave', () => {
        if (ticker !== selectedThemeTicker) {
          btn.style.background = 'rgba(255, 255, 255, 0.03)';
          btn.style.color = '#94a3b8';
        }
      });
      
      btn.addEventListener('click', () => {
        selectedThemeTicker = ticker;
        renderThemeStocksChart(themeName);
      });
      
      selectorContainer.appendChild(btn);
    });
  }
  
  let dates = [];
  let datasets = [];
  let allPrices = [];
  let ma5Data = [];
  let ma20Data = [];
  let filteredRecords = [];
  
  const has10y = window.AI_STOCKS_10Y && window.AI_STOCKS_10Y.length > 0;
  
  let closeVal = null;
  let ma5Val = null;
  let ma20Val = null;
  
  const colors = ['#00f2fe', '#8a2be2', '#ffb703', '#ff3366'];

  if (has10y) {
    const targetEndDateStr = selectedDateRecord ? selectedDateRecord.date : (window.AI_STOCKS_10Y.length > 0 ? window.AI_STOCKS_10Y[window.AI_STOCKS_10Y.length - 1].date : null);
    const recordsCapped = targetEndDateStr ? window.AI_STOCKS_10Y.filter(r => r.date <= targetEndDateStr) : window.AI_STOCKS_10Y;
    
    filteredRecords = recordsCapped;
    if (recordsCapped.length > 0 && targetEndDateStr) {
      const cutoff = getCutoffDate(targetEndDateStr, selectedThemeTimeframe);
      filteredRecords = recordsCapped.filter(r => new Date(r.date) >= cutoff);
    }
    
    dates = filteredRecords.map(r => r.date);
    
    if (selectedThemeTicker === 'COMPARE') {
      tickers.forEach((t, idx) => {
        const tPrices = filteredRecords.map(r => r[t]);
        
        // Find first non-null available price for baseline normalization
        let firstValidIdx = -1;
        for (let i = 0; i < tPrices.length; i++) {
          if (tPrices[i] !== null && tPrices[i] !== undefined) {
            firstValidIdx = i;
            break;
          }
        }
        
        let pctData = [];
        let baseline = null;
        if (firstValidIdx !== -1) {
          baseline = tPrices[firstValidIdx];
          pctData = tPrices.map(p => {
            if (p === null || p === undefined) return null;
            return ((p - baseline) / baseline) * 100;
          });
        } else {
          pctData = tPrices.map(() => null);
        }
        
        datasets.push({
          label: t,
          data: pctData,
          borderColor: colors[idx % colors.length],
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 6,
          tension: 0.1,
          rawPrices: tPrices
        });
      });
    } else {
      allPrices = filteredRecords.map(r => r[selectedThemeTicker]);
      
      filteredRecords.forEach(r => {
        const fullIdx = window.AI_STOCKS_10Y.findIndex(item => item.date === r.date);
        ma5Data.push(getMovingAverage(fullIdx, selectedThemeTicker, 5));
        ma20Data.push(getMovingAverage(fullIdx, selectedThemeTicker, 20));
      });
      
      // Status values corresponding to the targetEndDateStr (last point)
      if (allPrices.length > 0) {
        closeVal = allPrices[allPrices.length - 1];
        ma5Val = ma5Data[ma5Data.length - 1];
        ma20Val = ma20Data[ma20Data.length - 1];
      }
      
      datasets.push({
        label: `${selectedThemeTicker} 收盤價`,
        data: allPrices,
        borderColor: '#00f2fe',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 6,
        tension: 0.1
      });
      
      datasets.push({
        label: 'MA5 (週線)',
        data: ma5Data,
        borderColor: '#60a5fa',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.1
      });

      datasets.push({
        label: 'MA20 (月線)',
        data: ma20Data,
        borderColor: '#fbbf24',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.1
      });
    }
    
  } else {
    // Fallback to random walk simulation (old behavior)
    dates = getRecentDatesForRecord(selectedDateRecord ? selectedDateRecord.date : new Date().toISOString().split('T')[0], 15);
    const hasData = selectedDateRecord && selectedDateRecord.indices && selectedDateRecord.indices.ai_stocks;
    
    if (selectedThemeTicker === 'COMPARE') {
      tickers.forEach((t, idx) => {
        let finalPrice = 100;
        let finalChange = 0;
        if (hasData && selectedDateRecord.indices.ai_stocks[t]) {
          finalPrice = selectedDateRecord.indices.ai_stocks[t].close;
          finalChange = selectedDateRecord.indices.ai_stocks[t].change || 0;
        }
        
        const tPrices = new Array(dates.length);
        tPrices[dates.length - 1] = finalPrice;
        if (dates.length > 1) {
          tPrices[dates.length - 2] = finalPrice - finalChange;
        }
        
        const seed = getTickerSeed(t);
        for (let i = dates.length - 3; i >= 0; i--) {
          const rand = seededRandom(seed + i);
          const pct = (rand - 0.5) * 0.05;
          tPrices[i] = tPrices[i + 1] / (1 + pct);
        }
        
        const baseline = tPrices[0];
        const pctData = tPrices.map(p => ((p - baseline) / baseline) * 100);
        
        datasets.push({
          label: t,
          data: pctData,
          borderColor: colors[idx % colors.length],
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          tension: 0.1,
          rawPrices: tPrices
        });
      });
    } else {
      let finalPrice = 100;
      let finalChange = 0;
      if (hasData && selectedDateRecord.indices.ai_stocks[selectedThemeTicker]) {
        finalPrice = selectedDateRecord.indices.ai_stocks[selectedThemeTicker].close;
        finalChange = selectedDateRecord.indices.ai_stocks[selectedThemeTicker].change || 0;
      }
      
      allPrices = new Array(dates.length);
      allPrices[dates.length - 1] = finalPrice;
      if (dates.length > 1) {
        allPrices[dates.length - 2] = finalPrice - finalChange;
      }
      
      const seed = getTickerSeed(selectedThemeTicker);
      for (let i = dates.length - 3; i >= 0; i--) {
        const rand = seededRandom(seed + i);
        const pct = (rand - 0.5) * 0.05;
        allPrices[i] = allPrices[i + 1] / (1 + pct);
      }
      
      for (let i = 0; i < allPrices.length; i++) {
        ma5Data.push(getFallbackMA(allPrices, i, 5));
        ma20Data.push(getFallbackMA(allPrices, i, 20));
      }
      
      if (allPrices.length > 0) {
        closeVal = allPrices[allPrices.length - 1];
        ma5Val = ma5Data[ma5Data.length - 1];
        ma20Val = ma20Data[ma20Data.length - 1];
      }
      
      datasets.push({
        label: `${selectedThemeTicker} 收盤價`,
        data: allPrices,
        borderColor: '#00f2fe',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 6,
        tension: 0.1
      });
      
      datasets.push({
        label: 'MA5 (週線)',
        data: ma5Data,
        borderColor: '#60a5fa',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.1
      });

      datasets.push({
        label: 'MA20 (月線)',
        data: ma20Data,
        borderColor: '#fbbf24',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.1
      });
    }
  }
  
  // Update Yahoo Finance-style status display
  const statusBar = document.getElementById('theme-stock-status-bar');
  if (statusBar) {
    if (selectedThemeTicker === 'COMPARE') {
      let statusHtml = `<strong style="color: #f1f5f9; font-size: 0.95rem; margin-right: 12px;">個股比較 (累積報酬率)</strong>`;
      
      tickers.forEach((t, idx) => {
        let returnVal = null;
        let lastPrice = null;
        
        if (has10y) {
          const tPrices = filteredRecords.map(r => r[t]);
          let firstValidIdx = tPrices.findIndex(p => p !== null && p !== undefined);
          if (firstValidIdx !== -1 && tPrices.length > 0) {
            const baseline = tPrices[firstValidIdx];
            lastPrice = tPrices[tPrices.length - 1];
            if (lastPrice !== null && lastPrice !== undefined) {
              returnVal = ((lastPrice - baseline) / baseline) * 100;
            }
          }
        } else {
          // Fallback walkback simulated prices array recreation for target status
          const simulatedDates = getRecentDatesForRecord(selectedDateRecord ? selectedDateRecord.date : new Date().toISOString().split('T')[0], 15);
          const hasData = selectedDateRecord && selectedDateRecord.indices && selectedDateRecord.indices.ai_stocks;
          
          let finalPrice = 100;
          let finalChange = 0;
          if (hasData && selectedDateRecord.indices.ai_stocks[t]) {
            finalPrice = selectedDateRecord.indices.ai_stocks[t].close;
            finalChange = selectedDateRecord.indices.ai_stocks[t].change || 0;
          }
          
          const tPrices = new Array(simulatedDates.length);
          tPrices[simulatedDates.length - 1] = finalPrice;
          if (simulatedDates.length > 1) {
            tPrices[simulatedDates.length - 2] = finalPrice - finalChange;
          }
          
          const seed = getTickerSeed(t);
          for (let i = simulatedDates.length - 3; i >= 0; i--) {
            const rand = seededRandom(seed + i);
            const pct = (rand - 0.5) * 0.05;
            tPrices[i] = tPrices[i + 1] / (1 + pct);
          }
          
          const baseline = tPrices[0];
          lastPrice = tPrices[tPrices.length - 1];
          returnVal = ((lastPrice - baseline) / baseline) * 100;
        }
        
        statusHtml += `
          <span style="margin-right: 12px; color: #cbd5e1;">
            ${t}: <span style="font-weight: 600; color: ${colors[idx % colors.length]};">${returnVal !== null ? (returnVal >= 0 ? '+' : '') + returnVal.toFixed(1) + '%' : '--'}</span>
          </span>
        `;
      });
      
      statusBar.style.display = 'block';
      statusBar.innerHTML = statusHtml;
      
    } else {
      if (closeVal !== null && closeVal !== undefined) {
        statusBar.style.display = 'block';
        statusBar.innerHTML = `
          <strong style="color: #f1f5f9; font-size: 0.95rem; margin-right: 8px;">${selectedThemeTicker}</strong> 
          <span style="color: #cbd5e1; margin-right: 12px;">收盤價: <span style="font-weight: 600; color: #00f2fe;">$${closeVal.toFixed(2)}</span></span>
          <span style="color: #60a5fa; margin-right: 12px;">MA5: <span style="font-weight: 500;">${ma5Val !== null ? '$' + ma5Val.toFixed(2) : '--'}</span></span>
          <span style="color: #fbbf24;">MA20: <span style="font-weight: 500;">${ma20Val !== null ? '$' + ma20Val.toFixed(2) : '--'}</span></span>
        `;
      } else {
        statusBar.style.display = 'block';
        statusBar.innerHTML = `
          <strong style="color: #f1f5f9; font-size: 0.95rem; margin-right: 8px;">${selectedThemeTicker}</strong> 
          <span style="color: #94a3b8;">(無交易資料)</span>
        `;
      }
    }
  }
  
  const chartFont = {
    family: "'Inter', sans-serif",
    size: 11
  };
  
  // Calculate dynamic min/max values for Y-axis scaling
  let minVal = 0;
  let maxVal = 100;
  if (selectedThemeTicker === 'COMPARE') {
    let allVals = [];
    datasets.forEach(d => {
      allVals = [...allVals, ...d.data];
    });
    allVals = allVals.filter(v => v !== null && v !== undefined);
    minVal = allVals.length > 0 ? Math.min(...allVals) : 0;
    maxVal = allVals.length > 0 ? Math.max(...allVals) : 100;
  } else {
    const allVals = [...allPrices, ...ma5Data, ...ma20Data].filter(v => v !== null && v !== undefined);
    minVal = allVals.length > 0 ? Math.min(...allVals) : 0;
    maxVal = allVals.length > 0 ? Math.max(...allVals) : 100;
  }
  
  let yMin = minVal < 0 ? minVal * 1.1 : minVal * 0.9;
  let yMax = maxVal < 0 ? maxVal * 0.9 : maxVal * 1.1;
  
  // Safety guard: if min and max values are too close or equal, add a buffer to prevent blank chart renders
  if (Math.abs(yMax - yMin) < 0.0001) {
    yMin = yMin - 10;
    yMax = yMax + 10;
  }

  themeChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          labels: { color: '#f1f5f9', font: chartFont }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: '#1e293b',
          titleColor: '#f1f5f9',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              const label = context.dataset.label;
              const val = context.raw;
              if (val === null || val === undefined) {
                return ` ${label}: --`;
              }
              if (selectedThemeTicker === 'COMPARE') {
                const rawPrice = context.dataset.rawPrices ? context.dataset.rawPrices[context.dataIndex] : null;
                if (rawPrice !== null && rawPrice !== undefined) {
                  return ` ${label}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}% (價格: $${rawPrice.toFixed(2)})`;
                }
                return ` ${label}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
              } else {
                return ` ${label}: $${val.toFixed(2)}`;
              }
            }
          }
        }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          min: yMin,
          max: yMax,
          ticks: {
            color: '#94a3b8',
            font: chartFont,
            callback: function(value) {
              if (selectedThemeTicker === 'COMPARE') {
                return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
              } else {
                return '$' + value.toFixed(2);
              }
            }
          },
          title: {
            display: true,
            text: selectedThemeTicker === 'COMPARE' ? '累積漲跌幅 (%)' : '收盤價 (USD)',
            color: '#94a3b8',
            font: chartFont
          }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: chartFont }
        }
      }
    }
  });
}

// Unique seed generation helper for tickers
function getTickerSeed(ticker) {
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) {
    hash = ticker.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

// Seeded deterministic pseudorandom helper
function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Retrieve recent trading dates leading up to the selected date
function getRecentDatesForRecord(selectedDate, count = 15) {
  const dates = [];
  const startIdx = marketHistoryData.findIndex(r => r.date === selectedDate);
  
  if (startIdx === -1) {
    let curr = new Date(selectedDate);
    for (let i = 0; i < count; i++) {
      dates.unshift(curr.toISOString().split('T')[0]);
      curr.setDate(curr.getDate() - 1);
    }
    return dates;
  }
  
  for (let i = 0; i < count; i++) {
    if (marketHistoryData[startIdx + i]) {
      dates.unshift(marketHistoryData[startIdx + i].date);
    } else {
      let lastDateStr = dates[0] || selectedDate;
      let curr = new Date(lastDateStr);
      curr.setDate(curr.getDate() - 1);
      dates.unshift(curr.toISOString().split('T')[0]);
    }
  }
  return dates;
}

// Find closest record in history with non-empty list for a given key (searches both directions)
function findClosestRecordWithKey(selectedDate, key) {
  if (!marketHistoryData || marketHistoryData.length === 0) return null;
  
  const selectedIdx = marketHistoryData.findIndex(r => r.date === selectedDate);
  if (selectedIdx === -1) return null;
  
  let left = selectedIdx;
  let right = selectedIdx;
  
  while (left >= 0 || right < marketHistoryData.length) {
    if (left >= 0) {
      const r = marketHistoryData[left];
      if (r[key] && r[key].length > 0) {
        return r;
      }
      left--;
    }
    if (right < marketHistoryData.length) {
      const r = marketHistoryData[right];
      if (r[key] && r[key].length > 0) {
        return r;
      }
      right++;
    }
  }
  
  return null;
}

// Find latest record in history with non-empty list for a given key on or before selectedDate
function findLatestRecordOnOrBeforeDateWithKey(selectedDate, key) {
  if (!marketHistoryData || marketHistoryData.length === 0) return null;
  
  const selectedIdx = marketHistoryData.findIndex(r => r.date === selectedDate);
  if (selectedIdx === -1) return null;
  
  for (let i = selectedIdx; i < marketHistoryData.length; i++) {
    const r = marketHistoryData[i];
    if (r[key] && r[key].length > 0) {
      return r;
    }
  }
  return null;
}
