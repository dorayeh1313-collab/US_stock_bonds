// State variables
let marketHistoryData = [];
let selectedDateRecord = null;
let chartInstance = null;
let activeTab = 'yield-curve';
let supabaseClient = null;

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await initData();
});

// Setup UI Interaction Event Listeners
function setupEventListeners() {
  // Date Selector Change
  document.getElementById('date-select').addEventListener('change', (e) => {
    const selectedDate = e.target.value;
    loadDateData(selectedDate);
  });

  // Chart Tab Toggles
  const tabBtns = document.querySelectorAll('.chart-tab-btn');
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
      // Create Supabase Client
      supabaseClient = supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
      
      // Listen to authentication state changes
      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (session) {
          // User is signed in!
          updateDbStatus(true);
          document.getElementById('logout-btn').classList.remove('hidden');
          
          // Fetch data from database
          const success = await fetchDatabaseData();
          if (success) {
            document.getElementById('login-overlay').classList.add('hidden');
            document.getElementById('main-dashboard').classList.remove('hidden');
          } else {
            showEmptyState();
            document.getElementById('login-overlay').classList.add('hidden');
            document.getElementById('main-dashboard').classList.remove('hidden');
          }
        } else {
          // User is signed out!
          document.getElementById('main-dashboard').classList.add('hidden');
          document.getElementById('login-overlay').classList.remove('hidden');
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
      
      // Fetch 10y history from Supabase
      try {
        const { data: data10y, error: error10y } = await supabaseClient
          .from('market_history_10y')
          .select('*')
          .order('date', { ascending: true });
        if (!error10y && data10y) {
          window.HISTORICAL_10Y = data10y;
        }
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
  const items = selectedDateRecord.fed_announcements || [];
  
  if (items.length === 0) {
    listEl.innerHTML = '<li class="empty-list-msg">今日無聯聯準會政策公告</li>';
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
  const items = selectedDateRecord.news_summary || [];
  
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
  
  if (activeTab === 'yield-curve') {
    // Term structure chart: X = [2Y, 5Y, 10Y, 30Y], Y = yield value
    const yields = selectedDateRecord.yields || {};
    const terms = ['2Y', '5Y', '10Y', '30Y'];
    const dataPoints = terms.map(term => yields[term] ? yields[term].yield : null);
    
    // Check if we have yield curve data
    if (dataPoints.every(x => x === null)) {
      drawEmptyChartMessage(ctx, "無此日期的殖利率數據");
      return;
    }

    // Detect inversion (2Y > 10Y)
    const is2Y = yields['2Y'] ? yields['2Y'].yield : 0;
    const is10Y = yields['10Y'] ? yields['10Y'].yield : 0;
    const isInverted = is2Y > is10Y && is2Y > 0 && is10Y > 0;
    const strokeColor = isInverted ? '#ff3366' : '#00f2fe';
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, isInverted ? 'rgba(255, 51, 102, 0.25)' : 'rgba(0, 242, 254, 0.25)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: terms,
        datasets: [{
          label: `${selectedDateRecord.date} 公債殖利率曲線 ${isInverted ? '(倒掛⚠️)' : ''}`,
          data: dataPoints,
          borderColor: strokeColor,
          borderWidth: 3,
          pointBackgroundColor: strokeColor,
          pointHoverRadius: 7,
          pointRadius: 5,
          tension: 0.15,
          fill: true,
          backgroundColor: gradient
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
                return ` 殖利率: ${context.raw.toFixed(3)}%`;
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
    
  } else if (activeTab === 'yield-history') {
    // Plot 10-year Treasury Yield trends
    const use10y = window.HISTORICAL_10Y && window.HISTORICAL_10Y.length > 0;
    const cronRecords = use10y ? window.HISTORICAL_10Y : [...marketHistoryData].reverse();
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
    const cronRecords = use10y ? window.HISTORICAL_10Y : [...marketHistoryData].reverse();
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
    const cronRecords = use10y ? window.HISTORICAL_10Y : [...marketHistoryData].reverse();
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

// Show standard empty screen when no data is available
function showEmptyState() {
  document.getElementById('stock-cards').innerHTML = '<div class="empty-list-msg">查無數據，請先執行 fetch_data.py 抓取最新資料！</div>';
  document.getElementById('yield-cards').innerHTML = '<div class="empty-list-msg">查無數據</div>';
  document.getElementById('fed-list').innerHTML = '<li class="empty-list-msg">無數據</li>';
  document.getElementById('news-list').innerHTML = '<li class="empty-list-msg">無數據</li>';
}
