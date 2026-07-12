/* =============================================
   BorsaAI — Aselsan Trading Dashboard
   Main Application Logic
   ============================================= */

// ==================== STATE MANAGEMENT ====================
const STATE = {
    // Portfolio
    initialCapital: 100000,
    cash: 100000,
    shares: 0,
    avgCost: 0,
    totalPnL: 0,
    trades: [],

    // Stock Data
    currentPrice: 370.00,
    previousClose: 358.72,
    dayHigh: 375.25,
    dayLow: 355.00,
    week52High: 450.00,
    week52Low: 151.40,

    // Commission
    commissionRate: 0.002, // %0.2

    // Tab
    activeTab: 'dashboard'
};

// Async load state from database.json (Cloud DB simulation)
async function loadState() {
    try {
        const response = await fetch('database.json?_=' + new Date().getTime());
        if (response.ok) {
            const parsed = await response.json();
            Object.assign(STATE, parsed);
            updateAllDisplays();
            drawPieChart();
            drawOwnershipPieChart();
        }
    } catch (e) {
        console.warn('Veritabanına bağlanılamadı, son lokal veri kullanılıyor:', e);
    }
}

// Bulut sisteminde saveState artık frontend'den yapılmıyor.
// İşlemleri sadece arka plandaki AI bot (bot.py) yapıyor ve database.json'u güncelliyor.
function saveState() {
    // Read-only modda olduğumuz için bu fonksiyon devre dışı bırakıldı.
    // Kullanıcı frontend'den işlem yapmak yerine AI'ı izleyecek.
}

// Her 15 saniyede bir veritabanını kontrol et (Canlı İzleme)
setInterval(loadState, 15000);

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    initLoadingScreen();
    initNavigation();
    initTrading();
    initDateTime();
    updateAllDisplays();
    initPriceRange();
    populateAIContent();
    drawPieChart();
    drawOwnershipPieChart();
    initAISuggestion();
});

// ==================== LOADING SCREEN ====================
function initLoadingScreen() {
    setTimeout(() => {
        const loadingScreen = document.getElementById('loading-screen');
        const app = document.getElementById('app');
        loadingScreen.classList.add('hidden');
        app.classList.remove('hidden');
    }, 2200);
}

// ==================== NAVIGATION ====================
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.getElementById('sidebar');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;
            switchTab(tab);
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Close mobile sidebar
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
            }
        });
    });

    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }
}

function switchTab(tabId) {
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(t => t.classList.remove('active'));
    const target = document.getElementById(`tab-${tabId}`);
    if (target) {
        target.classList.add('active');
        STATE.activeTab = tabId;

        // Redraw pie chart when portfolio tab is shown
        if (tabId === 'portfolio') {
            setTimeout(drawPieChart, 100);
        }
        if (tabId === 'institutions') {
            setTimeout(drawOwnershipPieChart, 100);
        }
    }
}

// ==================== DATE TIME ====================
function initDateTime() {
    function updateTime() {
        const now = new Date();
        const options = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        document.getElementById('datetime').textContent = now.toLocaleString('tr-TR', options);

        // Market status (BIST: 10:00 - 18:00 weekdays)
        const hour = now.getHours();
        const day = now.getDay();
        const isWeekday = day >= 1 && day <= 5;
        const isMarketHours = hour >= 10 && hour < 18;
        const isOpen = isWeekday && isMarketHours;

        const statusDot = document.getElementById('market-status-dot');
        const statusText = document.getElementById('market-status-text');

        if (isOpen) {
            statusDot.className = 'status-dot open';
            statusText.textContent = 'Piyasa Açık';
        } else {
            statusDot.className = 'status-dot closed';
            statusText.textContent = 'Piyasa Kapalı';
        }
    }

    updateTime();
    setInterval(updateTime, 1000);
}

// ==================== TRADING ====================
function initTrading() {
    // Buy inputs
    const buyPrice = document.getElementById('buy-price');
    const buyQuantity = document.getElementById('buy-quantity');
    const sellPrice = document.getElementById('sell-price');
    const sellQuantity = document.getElementById('sell-quantity');

    buyPrice.addEventListener('input', updateBuySummary);
    buyQuantity.addEventListener('input', updateBuySummary);
    sellPrice.addEventListener('input', updateSellSummary);
    sellQuantity.addEventListener('input', updateSellSummary);

    // Quick buy buttons
    document.querySelectorAll('.quick-buy-buttons .quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const percent = parseInt(btn.dataset.percent) / 100;
            const price = parseFloat(buyPrice.value) || STATE.currentPrice;
            const maxShares = Math.floor((STATE.cash * percent) / (price * (1 + STATE.commissionRate)));
            buyQuantity.value = Math.max(1, maxShares);
            updateBuySummary();
        });
    });

    // Quick sell buttons
    document.querySelectorAll('.quick-sell-buttons .quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const percent = parseInt(btn.dataset.percent) / 100;
            const maxShares = Math.floor(STATE.shares * percent);
            sellQuantity.value = Math.max(0, maxShares);
            updateSellSummary();
        });
    });

    // Execute buy
    document.getElementById('btn-execute-buy').addEventListener('click', () => {
        const price = parseFloat(buyPrice.value);
        const quantity = parseInt(buyQuantity.value);

        if (!price || !quantity || quantity <= 0) {
            showToast('Geçersiz alış parametreleri!', 'error');
            return;
        }

        const totalCost = price * quantity;
        const commission = totalCost * STATE.commissionRate;
        const grandTotal = totalCost + commission;

        if (grandTotal > STATE.cash) {
            showToast('Yetersiz bakiye! Nakit: ₺' + formatNumber(STATE.cash), 'error');
            return;
        }

        showTradeModal('buy', price, quantity, commission, grandTotal);
    });

    // Execute sell
    document.getElementById('btn-execute-sell').addEventListener('click', () => {
        const price = parseFloat(sellPrice.value);
        const quantity = parseInt(sellQuantity.value);

        if (!price || !quantity || quantity <= 0) {
            showToast('Geçersiz satış parametreleri!', 'error');
            return;
        }

        if (quantity > STATE.shares) {
            showToast('Yetersiz hisse! Eldeki: ' + STATE.shares + ' adet', 'error');
            return;
        }

        const totalRevenue = price * quantity;
        const commission = totalRevenue * STATE.commissionRate;
        const netRevenue = totalRevenue - commission;

        showTradeModal('sell', price, quantity, commission, netRevenue);
    });

    // Modal events
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });

    // Clear history
    document.getElementById('btn-clear-history').addEventListener('click', () => {
        STATE.trades = [];
        saveState();
        updateHistoryTable();
        showToast('İşlem geçmişi temizlendi', 'info');
    });

    updateBuySummary();
    updateSellSummary();
}

function updateBuySummary() {
    const price = parseFloat(document.getElementById('buy-price').value) || 0;
    const quantity = parseInt(document.getElementById('buy-quantity').value) || 0;
    const total = price * quantity;
    const commission = total * STATE.commissionRate;
    const grandTotal = total + commission;

    document.getElementById('buy-total').textContent = '₺' + formatNumber(total);
    document.getElementById('buy-commission').textContent = '₺' + formatNumber(commission);
    document.getElementById('buy-grand-total').textContent = '₺' + formatNumber(grandTotal);
    document.getElementById('buy-available').textContent = '₺' + formatNumber(STATE.cash);
}

function updateSellSummary() {
    const price = parseFloat(document.getElementById('sell-price').value) || 0;
    const quantity = parseInt(document.getElementById('sell-quantity').value) || 0;
    const total = price * quantity;
    const commission = total * STATE.commissionRate;
    const netTotal = total - commission;

    document.getElementById('sell-total').textContent = '₺' + formatNumber(total);
    document.getElementById('sell-commission').textContent = '₺' + formatNumber(commission);
    document.getElementById('sell-grand-total').textContent = '₺' + formatNumber(netTotal);
    document.getElementById('sell-available').textContent = STATE.shares + ' adet';
}

// ==================== TRADE EXECUTION ====================
let pendingTrade = null;

function showTradeModal(type, price, quantity, commission, total) {
    pendingTrade = { type, price, quantity, commission, total };

    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    const confirmBtn = document.getElementById('modal-confirm');

    if (type === 'buy') {
        title.textContent = '🟢 Alış Emri Onayı';
        confirmBtn.className = 'btn btn-buy';
        confirmBtn.textContent = 'Satın Al';
    } else {
        title.textContent = '🔴 Satış Emri Onayı';
        confirmBtn.className = 'btn btn-sell';
        confirmBtn.textContent = 'Sat';
    }

    body.innerHTML = `
        <div class="modal-detail">
            <span>Hisse</span>
            <span>ASELS</span>
        </div>
        <div class="modal-detail">
            <span>İşlem</span>
            <span>${type === 'buy' ? 'ALIŞ' : 'SATIŞ'}</span>
        </div>
        <div class="modal-detail">
            <span>Fiyat</span>
            <span>₺${formatNumber(price)}</span>
        </div>
        <div class="modal-detail">
            <span>Adet</span>
            <span>${quantity}</span>
        </div>
        <div class="modal-detail">
            <span>Komisyon (%0,2)</span>
            <span>₺${formatNumber(commission)}</span>
        </div>
        <div class="modal-detail" style="border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 8px;">
            <span style="font-weight: 700;">${type === 'buy' ? 'Toplam Maliyet' : 'Net Gelir'}</span>
            <span style="font-weight: 700; color: ${type === 'buy' ? 'var(--accent-green)' : 'var(--accent-red)'};">₺${formatNumber(total)}</span>
        </div>
    `;

    overlay.classList.add('active');

    // Confirm handler
    confirmBtn.onclick = () => {
        executeTrade(pendingTrade);
        closeModal();
    };
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    pendingTrade = null;
}

function executeTrade(trade) {
    const { type, price, quantity, commission, total } = trade;

    if (type === 'buy') {
        // Update average cost
        const currentValue = STATE.shares * STATE.avgCost;
        const newValue = price * quantity;
        STATE.avgCost = (currentValue + newValue) / (STATE.shares + quantity);
        STATE.shares += quantity;
        STATE.cash -= total;

        showToast(`✅ ${quantity} adet ASELS @₺${formatNumber(price)} alındı!`, 'success');
    } else {
        const costBasis = STATE.avgCost * quantity;
        const netRevenue = total;
        const tradePnL = netRevenue - costBasis;

        STATE.shares -= quantity;
        STATE.cash += total;
        STATE.totalPnL += tradePnL;

        if (STATE.shares === 0) {
            STATE.avgCost = 0;
        }

        const pnlText = tradePnL >= 0 ? `+₺${formatNumber(tradePnL)}` : `-₺${formatNumber(Math.abs(tradePnL))}`;
        showToast(`✅ ${quantity} adet ASELS @₺${formatNumber(price)} satıldı! (${pnlText})`, tradePnL >= 0 ? 'success' : 'error');
    }

    // Record trade
    STATE.trades.unshift({
        date: new Date().toLocaleString('tr-TR'),
        type,
        price,
        quantity,
        total,
        commission,
        status: 'Gerçekleşti'
    });

    saveState();
    updateAllDisplays();
    drawPieChart();
}

// ==================== DISPLAY UPDATES ====================
function updateAllDisplays() {
    const stockValue = STATE.shares * STATE.currentPrice;
    const portfolioTotal = STATE.cash + stockValue;
    const portfolioChange = ((portfolioTotal - STATE.initialCapital) / STATE.initialCapital) * 100;
    const unrealizedPnL = STATE.shares > 0 ? (STATE.currentPrice - STATE.avgCost) * STATE.shares : 0;
    const totalPnL = STATE.totalPnL + unrealizedPnL;

    // Dashboard metrics
    document.getElementById('portfolio-total').textContent = '₺' + formatNumber(portfolioTotal);
    document.getElementById('cash-amount').textContent = '₺' + formatNumber(STATE.cash);
    document.getElementById('shares-count').textContent = STATE.shares;
    document.getElementById('shares-value').textContent = '₺' + formatNumber(stockValue) + ' değerinde';

    const portfolioChangeEl = document.getElementById('portfolio-change');
    portfolioChangeEl.querySelector('span').textContent = (portfolioChange >= 0 ? '+' : '') + portfolioChange.toFixed(2) + '%';
    portfolioChangeEl.className = 'metric-change ' + (portfolioChange > 0 ? 'positive' : portfolioChange < 0 ? 'negative' : 'neutral');

    const totalPnLEl = document.getElementById('total-pnl');
    totalPnLEl.textContent = (totalPnL >= 0 ? '+' : '-') + '₺' + formatNumber(Math.abs(totalPnL));
    totalPnLEl.className = 'metric-value ' + (totalPnL > 0 ? 'positive' : totalPnL < 0 ? 'negative' : 'neutral');

    const pnlPercentEl = document.getElementById('pnl-percent');
    const pnlPercent = (totalPnL / STATE.initialCapital) * 100;
    pnlPercentEl.textContent = (pnlPercent >= 0 ? '+' : '') + pnlPercent.toFixed(2) + '%';
    pnlPercentEl.className = 'metric-change ' + (pnlPercent > 0 ? 'positive' : pnlPercent < 0 ? 'negative' : 'neutral');

    // Portfolio tab
    document.getElementById('port-total-value').textContent = '₺' + formatNumber(portfolioTotal);
    document.getElementById('port-cash').textContent = '₺' + formatNumber(STATE.cash);
    document.getElementById('port-stock-value').textContent = '₺' + formatNumber(stockValue);
    document.getElementById('port-avg-cost').textContent = STATE.avgCost > 0 ? '₺' + formatNumber(STATE.avgCost) : '—';
    document.getElementById('port-pnl').textContent = (totalPnL >= 0 ? '+' : '-') + '₺' + formatNumber(Math.abs(totalPnL));
    document.getElementById('port-pnl').style.color = totalPnL >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    document.getElementById('port-trade-count').textContent = STATE.trades.length;

    // Pie legend
    const cashPercent = ((STATE.cash / portfolioTotal) * 100).toFixed(1);
    const stockPercent = ((stockValue / portfolioTotal) * 100).toFixed(1);
    document.getElementById('legend-cash').textContent = '%' + cashPercent;
    document.getElementById('legend-asels').textContent = '%' + stockPercent;

    // Trading tab available
    updateBuySummary();
    updateSellSummary();

    // History
    updateHistoryTable();
}

function updateHistoryTable() {
    const tbody = document.getElementById('history-body');

    if (STATE.trades.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Henüz işlem yapılmadı</td></tr>';
        return;
    }

    tbody.innerHTML = STATE.trades.map(trade => `
        <tr class="${trade.type === 'buy' ? 'buy-row' : 'sell-row'}">
            <td>${trade.date}</td>
            <td>${trade.type === 'buy' ? '🟢 ALIŞ' : '🔴 SATIŞ'}</td>
            <td style="font-family: var(--font-mono);">₺${formatNumber(trade.price)}</td>
            <td>${trade.quantity}</td>
            <td style="font-family: var(--font-mono);">₺${formatNumber(trade.total)}</td>
            <td style="font-family: var(--font-mono);">₺${formatNumber(trade.commission)}</td>
            <td><span class="badge">${trade.status}</span></td>
        </tr>
    `).join('');
}

// ==================== PIE CHART ====================
function drawPieChart() {
    const canvas = document.getElementById('portfolio-pie');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const size = 300;
    canvas.width = size * 2;
    canvas.height = size * 2;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(2, 2);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 20;
    const innerRadius = radius * 0.6;

    const stockValue = STATE.shares * STATE.currentPrice;
    const total = STATE.cash + stockValue;
    const cashPct = STATE.cash / total;
    const stockPct = stockValue / total;

    ctx.clearRect(0, 0, size, size);

    // Draw donut
    const segments = [
        { pct: cashPct, color: '#00d4aa', label: 'Nakit' },
        { pct: stockPct, color: '#7c5cfc', label: 'ASELS' }
    ];

    let startAngle = -Math.PI / 2;

    segments.forEach(seg => {
        if (seg.pct <= 0) return;
        const endAngle = startAngle + seg.pct * Math.PI * 2;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
        ctx.closePath();

        ctx.fillStyle = seg.color;
        ctx.fill();

        // Add subtle shadow
        ctx.shadowColor = seg.color;
        ctx.shadowBlur = 15;
        ctx.fill();
        ctx.shadowBlur = 0;

        startAngle = endAngle;
    });

    // Center text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8edf5';
    ctx.font = '700 18px Inter';
    ctx.fillText('₺' + formatNumber(total), centerX, centerY - 8);
    ctx.fillStyle = '#5a6882';
    ctx.font = '500 11px Inter';
    ctx.fillText('Toplam Değer', centerX, centerY + 12);
}

function drawOwnershipPieChart() {
    const canvas = document.getElementById('ownership-pie');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const size = 280;
    canvas.width = size * 2;
    canvas.height = size * 2;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(2, 2);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2 - 20;
    const innerRadius = radius * 0.6;

    ctx.clearRect(0, 0, size, size);

    // TSKGV 74.20%, Yabancı 14%, Yerli 6.8%, Bireysel 5%
    const segments = [
        { pct: 0.7420, color: '#7c5cfc', label: 'TSKGV' },
        { pct: 0.1400, color: '#4da6ff', label: 'Yabancı' },
        { pct: 0.0680, color: '#00d4aa', label: 'Yerli' },
        { pct: 0.0500, color: '#ffc048', label: 'Bireysel' }
    ];

    let startAngle = -Math.PI / 2;

    segments.forEach(seg => {
        if (seg.pct <= 0) return;
        const endAngle = startAngle + seg.pct * Math.PI * 2;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
        ctx.closePath();

        ctx.fillStyle = seg.color;
        ctx.fill();

        // Add subtle shadow
        ctx.shadowColor = seg.color;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;

        startAngle = endAngle;
    });

    // Center text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8edf5';
    ctx.font = '700 18px Inter';
    ctx.fillText('ASELS', centerX, centerY - 8);
    ctx.fillStyle = '#5a6882';
    ctx.font = '500 11px Inter';
    ctx.fillText('Ortaklık', centerX, centerY + 12);
}

// ==================== PRICE RANGE ====================
function initPriceRange() {
    const min = STATE.week52Low;
    const max = STATE.week52High;
    const current = STATE.currentPrice;
    const percentage = ((current - min) / (max - min)) * 100;

    const fill = document.getElementById('price-range-fill');
    const marker = document.getElementById('price-range-marker');

    setTimeout(() => {
        fill.style.width = percentage + '%';
        marker.style.left = percentage + '%';
    }, 500);
}

// ==================== AI CONTENT ====================
function populateAIContent() {
    // AI Analysis
    const analysisEl = document.getElementById('ai-analysis-content');
    analysisEl.innerHTML = `
        <div class="ai-section">
            <h4>📊 Genel Piyasa Değerlendirmesi</h4>
            <p>Aselsan hissesi (ASELS), son 52 haftada <strong>%140'ın üzerinde</strong> bir performans göstererek 
            BIST'in en dikkat çekici hisselerinden biri oldu. 151,40 TL seviyelerinden 450,00 TL'ye kadar yükselen hisse, 
            şu anda 370,00 TL seviyesinde işlem görüyor. Bu, zirve noktasından yaklaşık <strong>%18'lik bir düzeltme</strong> 
            anlamına geliyor.</p>
            
            <div class="highlight-box">
                <p>💡 <strong>Kritik Tespitim:</strong> Hisse, 360 TL destek seviyesinin üzerinde tutunmayı başardı ve 
                kısa vadeli hareketli ortalamaların (MA5, MA10, MA20) üzerine çıktı. Bu, kısa vadede alıcıların hâlâ 
                güçlü olduğunu gösteriyor. Ancak MA50 (382 TL) ciddi bir direnç oluşturuyor.</p>
            </div>
        </div>

        <div class="ai-section">
            <h4>🏢 Temel Analiz Perspektifi</h4>
            <p>Aselsan'ın Q1 2026 sonuçları son derece etkileyici:</p>
            <p>• <strong>₺34,3 milyar gelir</strong> — %15 reel büyüme (enflasyonun üzerinde!)<br>
            • <strong>₺5,53 milyar net kâr</strong> — konsensüs beklentilerinin üzerinde<br>
            • <strong>$20,7 milyar sipariş bakiyesi</strong> — yıllık %39 artış<br>
            • <strong>%25,2 FAVÖK marjı</strong> — operasyonel verimlilik artıyor<br>
            • <strong>Net Borç/FAVÖK: 0,41</strong> — finansal yapı sağlam</p>
            
            <p>Bu rakamlar, şirketin sadece büyümediğini, aynı zamanda <strong>kârlı bir şekilde büyüdüğünü</strong> 
            gösteriyor. Seri üretim yatırımlarında %261'lik artış, gelecek yıllar için gelir beklentisini güçlendiriyor.</p>
            
            <div class="warning-box">
                <p>⚠️ <strong>Ancak dikkat:</strong> F/K oranı 67,27 ile tarihsel ortalamalarının oldukça üzerinde. 
                Bu, piyasanın gelecek büyümeyi fiyatladığını gösteriyor. Eğer büyüme beklentileri karşılanmazsa, 
                sert bir düzeltme riski var.</p>
            </div>
        </div>

        <div class="ai-section">
            <h4>⚡ Teknik Analiz Perspektifi</h4>
            <p>Teknik göstergeler <strong>karışık sinyaller</strong> veriyor — bu da benim açımdan "temkinli pozisyon al" anlamına geliyor:</p>
            <p>• <strong>RSI: 48</strong> — Ne aşırı alım ne aşırı satım bölgesinde. Nötr.<br>
            • <strong>MACD: Negatif</strong> — Momentum kısa vadede zayıf.<br>
            • <strong>Kısa vadeli MA'lar: AL sinyali</strong> — Yakın vadede alıcılar güçlü.<br>
            • <strong>Uzun vadeli MA'lar: SAT sinyali</strong> — Trend henüz tam dönmedi.</p>
            
            <p>Bu teknik tablo bana şunu söylüyor: <strong>Hisse bir karar noktasında.</strong> 360 TL destek kırılırsa 
            310 TL'ye kadar geri çekilme olabilir. 395 TL direnci aşılırsa 450 TL ve üzeri hedeflenebilir.</p>
        </div>

        <div class="ai-section">
            <h4>🎯 Benim Stratejik Değerlendirmem</h4>
            <p>Aselsan, Türkiye'nin savunma sanayiinin <strong>amiral gemisi</strong>. $20,7 milyarlık sipariş bakiyesi, 
            şirketin önümüzdeki yıllar için gelir görünürlüğünü son derece güçlü kılıyor. İhracatta %69'luk artış, 
            şirketin artık sadece iç pazar değil, <strong>küresel bir savunma oyuncusu</strong> olma yolunda ilerlediğini gösteriyor.</p>
            
            <div class="highlight-box">
                <p>🎯 <strong>Sonuç:</strong> Aselsan uzun vadede güçlü bir yatırım temasıdır. Ancak 370 TL'de 
                "acele etmeden" alım yapmak mantıklı olacaktır. Kademeli alım stratejisi ile risk yönetimi ön planda 
                tutulmalıdır. Analistlerin ortalama hedef fiyatı 428,70 TL ile güncel fiyattan ~%16 yukarıda.</p>
            </div>
        </div>
    `;

    // Money Management Philosophy
    const philosophyEl = document.getElementById('ai-philosophy-content');
    philosophyEl.innerHTML = `
        <div class="philosophy-quote">
            "Para yönetimi, borsada hayatta kalmanın tek yoludur. Ne kadar haklı olursanız olun, 
            risk yönetimi olmadan uzun vadede başarılı olamazsınız."
        </div>

        <div class="philosophy-section">
            <h4>1. 💰 Sermaye Koruma İlkesi</h4>
            <p>100.000 TL'lik sermayemiz bizim <strong>savaş sandığımız</strong>. İlk ve en önemli kuralım: 
            <strong>Asla tek bir işlemde sermayenin %20'sinden fazlasını riske atmam.</strong> Bu, herhangi bir 
            yanlış pozisyonda bile portföyün hayatta kalmasını sağlar. Warren Buffett'ın dediği gibi: 
            "Kural 1: Asla para kaybetme. Kural 2: Kural 1'i unutma."</p>
        </div>

        <div class="philosophy-section">
            <h4>2. 📊 Kademeli Pozisyon Alma (Scaling In)</h4>
            <p>Tüm sermayeyi tek seferde bir hisseye yatırmam. Bunun yerine <strong>3-4 kademe</strong> ile pozisyon 
            oluştururum. Örneğin, Aselsan için:</p>
            <p>• <strong>1. Kademe (%25):</strong> 370 TL civarında ilk alım — Piyasayı test etmek için<br>
            • <strong>2. Kademe (%25):</strong> 360 TL'ye düşerse — Destekte güçlendirme<br>
            • <strong>3. Kademe (%25):</strong> 395 TL direncini kırarsa — Trend onayında artırma<br>
            • <strong>4. Kademe (%25):</strong> Nakit olarak tutulur — Beklenmedik fırsatlar için</p>
        </div>

        <div class="philosophy-section">
            <h4>3. 🛡️ Stop-Loss Disiplini</h4>
            <p>Her alım işleminde <strong>zihinsel stop-loss</strong> belirlerim. Aselsan için şu anki stop-loss 
            seviyem <strong>340 TL</strong> civarı olurdu (yaklaşık %8 zarar). Bu seviye kırılırsa, pozisyonu 
            küçültür veya tamamen kapatırım. Ego ile değil, <strong>disiplinle</strong> işlem yaparım.</p>
        </div>

        <div class="philosophy-section">
            <h4>4. 🎯 Hedef Fiyat ve Kâr Alma</h4>
            <p>Kâr almak da en az alım kadar önemli. Stratejim:</p>
            <p>• <strong>İlk hedef (395 TL):</strong> Pozisyonun %30'unu sat, maliyeti düşür<br>
            • <strong>İkinci hedef (428 TL):</strong> Pozisyonun %30'unu daha sat<br>
            • <strong>Kalan %40:</strong> Trailing stop ile serbest bırak — Trendi sonuna kadar sür</p>
        </div>

        <div class="philosophy-section">
            <h4>5. 🧘 Duygusal Kontrol</h4>
            <p>Borsada en büyük düşman <strong>duygularınızdır</strong>. Korku ile satmak, açgözlülük ile almak 
            en sık yapılan hatalardır. Ben veri odaklı kararlar alırım:</p>
            <p>• FOMO (kaçırma korkusu) ile alım yapmam<br>
            • Panik ile satış yapmam<br>
            • Her işlem öncesi "Bu işlem yanlış giderse ne olur?" diye sorarım<br>
            • Planıma sadık kalırım — Plan yoksa işlem yoktur</p>
        </div>

        <div class="philosophy-section">
            <h4>6. 📈 Risk/Ödül Oranı</h4>
            <p>Her işlemde minimum <strong>1:2 risk/ödül oranı</strong> ararım. Yani 1 TL riske ediyorsam, 
            en az 2 TL kazanma potansiyeli olmalı. Aselsan örneğinde:</p>
            <p>• <strong>Risk:</strong> 370 → 340 = 30 TL kayıp (%8,1)<br>
            • <strong>Ödül:</strong> 370 → 428 = 58 TL kazanç (%15,7)<br>
            • <strong>R/R Oranı:</strong> 1:1,93 — Kabul edilebilir ama ideal değil</p>
        </div>

        <div class="philosophy-quote">
            "Piyasada en başarılı trader, en çok kazanan değil — en iyi risk yöneten kişidir. 
            Küçük kayıpları kabul et, büyük kârları yakala. Bu kadar basit, bu kadar zor."
        </div>
    `;
}

// ==================== AI SUGGESTION ====================
function initAISuggestion() {
    const verdict = document.getElementById('ai-verdict');
    const reasoning = document.getElementById('ai-reasoning');
    const strategy = document.getElementById('ai-strategy');

    // Current market analysis
    const priceTrend = STATE.currentPrice > STATE.previousClose ? 'positive' : 'negative';
    const distanceFromHigh = ((STATE.week52High - STATE.currentPrice) / STATE.week52High * 100).toFixed(1);
    const distanceFromLow = ((STATE.currentPrice - STATE.week52Low) / STATE.week52Low * 100).toFixed(1);

    let verdictIcon, verdictText, verdictColor;

    if (STATE.shares === 0) {
        // No position - suggest gradual buy
        verdictIcon = '🟡';
        verdictText = 'KADEMELİ AL';
        verdictColor = 'var(--accent-yellow)';

        reasoning.innerHTML = `
            <p><strong>Mevcut Durum:</strong> Portföyde henüz ASELS pozisyonu yok. Hisse 370 TL seviyesinde ve 
            52 haftalık zirvesinden %${distanceFromHigh} aşağıda. RSI nötr bölgede (48), kısa vadeli hareketli 
            ortalamalar al sinyali veriyor ancak uzun vadeli ortalamalar hâlâ sat sinyalinde.</p>
            <p><strong>Değerlendirmem:</strong> Temeller çok güçlü (rekor sipariş, %15 reel büyüme, güçlü kârlılık), 
            ancak teknik tablo net bir yön göstermiyor. Bu yüzden tam pozisyon almak yerine kademeli alım öneriyorum.</p>
        `;
    } else {
        const unrealized = (STATE.currentPrice - STATE.avgCost) * STATE.shares;
        const unrealizedPct = ((STATE.currentPrice - STATE.avgCost) / STATE.avgCost * 100).toFixed(2);

        if (STATE.currentPrice >= 395) {
            verdictIcon = '🟢';
            verdictText = 'KISMI KÂR AL';
            verdictColor = 'var(--accent-green)';
            reasoning.innerHTML = `<p>Hisse direnç bölgesine (395 TL) ulaştı. Pozisyonun %30'unu kâra dönüştürerek riski azalt.</p>`;
        } else if (STATE.currentPrice <= 340) {
            verdictIcon = '🔴';
            verdictText = 'STOP-LOSS!';
            verdictColor = 'var(--accent-red)';
            reasoning.innerHTML = `<p>⚠️ Hisse stop-loss seviyesinin altına indi! Pozisyonun en az yarısını sat, sermayeyi koru!</p>`;
        } else {
            verdictIcon = '⏸️';
            verdictText = 'BEKLE & TUT';
            verdictColor = 'var(--accent-blue)';
            reasoning.innerHTML = `
                <p><strong>Mevcut Pozisyon:</strong> ${STATE.shares} adet ASELS, ort. maliyet ₺${formatNumber(STATE.avgCost)}. 
                Gerçekleşmemiş kâr/zarar: ${unrealized >= 0 ? '+' : ''}₺${formatNumber(unrealized)} (${unrealizedPct}%)</p>
                <p>Hisse 360-395 TL bandında konsolide oluyor. Net bir kırılım olmadan ek işlem yapmayı önermiyorum. Sabırlı ol.</p>
            `;
        }
    }

    verdict.innerHTML = `
        <span class="verdict-icon">${verdictIcon}</span>
        <span class="verdict-text" style="color: ${verdictColor}">${verdictText}</span>
    `;

    strategy.innerHTML = `
        <h4>📋 Önerilen Strateji</h4>
        <ul>
            <li><strong>İlk Alım:</strong> ₺25.000'lık (sermayenin %25'i) kademeli alım @ 370 TL civarı (~67 adet)</li>
            <li><strong>Destek Alımı:</strong> 360 TL'ye çekilirse ₺25.000'lık ek alım</li>
            <li><strong>Direnç Kırılımı:</strong> 395 TL üzeri kapanışta ₺25.000 ek alım</li>
            <li><strong>Nakit Rezerv:</strong> ₺25.000 nakit tut — Her zaman savaş sandığın olsun</li>
            <li><strong>Stop-Loss:</strong> 340 TL altında pozisyonu küçült</li>
            <li><strong>Hedef:</strong> 428-470 TL bandı (analist konsensüsü)</li>
        </ul>
    `;
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;

    container.appendChild(toast);

    // Remove after animation
    setTimeout(() => {
        toast.remove();
    }, 3500);
}

// ==================== UTILITIES ====================
function formatNumber(num) {
    return num.toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// ==================== LIVE TRADING FEED ====================
const FEED_STATE = {
    entries: []
};

function initLiveFeed() {
    // Load saved feed
    const savedFeed = localStorage.getItem('borsaai_feed');
    if (savedFeed) {
        try {
            FEED_STATE.entries = JSON.parse(savedFeed);
            renderFeedEntries();
        } catch(e) {
            console.warn('Feed state yüklenemedi:', e);
        }
    }

    // Start countdown
    updateCountdown();
    setInterval(updateCountdown, 1000);
}

function updateCountdown() {
    const countdownEl = document.getElementById('feed-countdown');
    if (!countdownEl) return;

    // Next market open: Monday July 13, 2026 10:00 Turkey time
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const isWeekday = day >= 1 && day <= 5;
    const isMarketOpen = isWeekday && hour >= 10 && hour < 18;

    // Calculate next market open
    let nextOpen = new Date();
    
    if (isMarketOpen) {
        // Market is open right now
        countdownEl.textContent = '🟢 PİYASA AÇIK';
        countdownEl.style.color = 'var(--accent-green)';

        // Update live badge
        const liveBadge = document.getElementById('live-badge');
        if (liveBadge) liveBadge.classList.add('active');
        return;
    }

    // Find next weekday 10:00
    if (day === 0) { // Sunday
        nextOpen.setDate(nextOpen.getDate() + 1);
    } else if (day === 6) { // Saturday
        nextOpen.setDate(nextOpen.getDate() + 2);
    } else if (hour >= 18) { // After market close on weekday
        if (day === 5) { // Friday evening
            nextOpen.setDate(nextOpen.getDate() + 3);
        } else {
            nextOpen.setDate(nextOpen.getDate() + 1);
        }
    }
    // else: today before 10:00 - same day

    nextOpen.setHours(10, 0, 0, 0);

    const diff = nextOpen - now;
    if (diff <= 0) {
        countdownEl.textContent = '🟢 PİYASA AÇIK';
        return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    countdownEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Add a new feed entry
function addFeedEntry(entry) {
    /*
    entry = {
        time: "10:30",
        date: "13.07",
        type: "analysis" | "buy" | "sell" | "hold" | "alert",
        icon: "🔍" | "🟢" | "🔴" | "⏸️" | "⚡",
        title: "Piyasa Analizi",
        titleClass: "" | "buy-title" | "sell-title" | "alert-title",
        desc: "Description text...",
        tags: [{ text: "₺370,00", class: "price" }, ...]
    }
    */
    FEED_STATE.entries.unshift(entry);
    localStorage.setItem('borsaai_feed', JSON.stringify(FEED_STATE.entries));
    renderFeedEntries();
}

function renderFeedEntries() {
    const feedContainer = document.getElementById('trading-feed');
    if (!feedContainer) return;

    if (FEED_STATE.entries.length === 0) return;

    // Hide empty state
    const emptyEl = document.getElementById('feed-empty');
    if (emptyEl) emptyEl.style.display = 'none';

    // Build feed HTML
    const feedHTML = FEED_STATE.entries.map(entry => `
        <div class="feed-item">
            <div class="feed-time">
                <span class="feed-time-value">${entry.time}</span>
                <span class="feed-time-date">${entry.date}</span>
            </div>
            <div class="feed-icon ${entry.type}">
                ${entry.icon}
            </div>
            <div class="feed-body">
                <div class="feed-title ${entry.titleClass || ''}">${entry.title}</div>
                <div class="feed-desc">${entry.desc}</div>
                ${entry.tags ? `
                    <div class="feed-tags">
                        ${entry.tags.map(tag => `<span class="feed-tag ${tag.class}">${tag.text}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');

    // Keep the empty div but hidden, add feed items
    feedContainer.innerHTML = feedHTML;
}

// Clear feed
function clearFeed() {
    FEED_STATE.entries = [];
    localStorage.removeItem('borsaai_feed');
    const feedContainer = document.getElementById('trading-feed');
    if (feedContainer) {
        feedContainer.innerHTML = `
            <div class="feed-empty" id="feed-empty">
                <div class="feed-empty-icon">🕐</div>
                <p>Piyasa açılışı bekleniyor...</p>
                <p class="feed-empty-sub">13 Temmuz 2026 Pazartesi, saat 10:00'da trading başlayacak.</p>
                <div class="feed-countdown" id="feed-countdown"></div>
            </div>
        `;
    }
}

// Update current price (called by AI during trading)
function updateLivePrice(newPrice, changeAmount, changePercent) {
    STATE.currentPrice = newPrice;
    document.getElementById('current-price').textContent = formatNumber(newPrice);
    
    const changeEl = document.getElementById('price-change');
    const isPositive = changeAmount >= 0;
    changeEl.className = 'price-change ' + (isPositive ? 'positive' : 'negative');
    changeEl.innerHTML = `
        <span class="change-amount">${isPositive ? '+' : ''}${formatNumber(changeAmount)}</span>
        <span class="change-percent">(${isPositive ? '+' : ''}${changePercent}%)</span>
    `;

    saveState();
    updateAllDisplays();
}

// Initialize feed on load
document.addEventListener('DOMContentLoaded', () => {
    initLiveFeed();
});
