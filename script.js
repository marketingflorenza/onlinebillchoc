// ================================================================
// 1. CONFIGURATION
// ================================================================
const CONFIG = {
    API_BASE_URL: 'https://backend-api-choc88.vercel.app/api',
    SHEET_ID: '1F2bTvP1ySUT1q6fzRPQu7UpKNW_ze8GtKkd2rmRUjkI',
    SHEET_NAME_SUMMARY: 'SUM',
};

// ================================================================
// 2. UI ELEMENTS
// ================================================================
const ui = {
    funnelStatsGrid: document.getElementById('funnelStatsGrid'),
    adsStatsGrid: document.getElementById('adsStatsGrid'),
    salesOverviewStatsGrid: document.getElementById('salesOverviewStatsGrid'),
    salesRevenueStatsGrid: document.getElementById('salesRevenueStatsGrid'),
    salesBillStatsGrid: document.getElementById('salesBillStatsGrid'),
    campaignsTableBody: document.getElementById('campaignsTableBody'),
    campaignsTableHeader: document.getElementById('campaignsTableHeader'),
    errorMessage: document.getElementById('errorMessage'),
    loading: document.getElementById('loading'),
    refreshBtn: document.getElementById('refreshBtn'),
    startDate: document.getElementById('startDate'),
    endDate: document.getElementById('endDate'),
    compareToggle: document.getElementById('compareToggle'),
    compareControls: document.getElementById('compareControls'),
    compareStartDate: document.getElementById('compareStartDate'),
    compareEndDate: document.getElementById('compareEndDate'),
    modal: document.getElementById('detailsModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalCloseBtn: document.querySelector('#detailsModal .modal-close-btn'),
    campaignSearchInput: document.getElementById('campaignSearchInput'),
    adSearchInput: document.getElementById('adSearchInput'),
    categoryRevenueChart: document.getElementById('categoryRevenueChart'),
    categoryDetailTableBody: document.getElementById('categoryDetailTableBody'),
    channelTableBody: document.getElementById('channelTableBody'),
    upsellPathsTableBody: document.getElementById('upsellPathsTableBody'),
    aiSummaryContent: document.getElementById('aiSummaryContent'),
};

// ================================================================
// 3. GLOBAL STATE
// ================================================================
let charts = {};
let latestCampaignData = [];
let latestCategoryDetails = [];
let latestUpsellPaths = [];
let latestFilteredSalesRows = [];
let currentPopupAds = [];
let currentSort = { key: 'spend', direction: 'desc' };
let allSalesDataCache = [];
let latestComparisonData = null;

// ================================================================
// 4. HELPER FUNCTIONS
// ================================================================
function showError(message) { ui.errorMessage.innerHTML = message; ui.errorMessage.classList.add('show'); }
function hideError() { ui.errorMessage.classList.remove('show'); }
const formatCurrency = (num) => `฿${parseFloat(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatCurrencyShort = (num) => `฿${parseInt(num || 0).toLocaleString('en-US')}`;
const formatNumber = (num) => parseInt(num || 0).toLocaleString('en-US');
const toNumber = (val) => {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isFinite(val) ? val : 0;
    const n = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(n) ? 0 : n;
};
function parseGvizDate(gvizDate) {
    if (!gvizDate) return null;
    const match = gvizDate.match(/Date\((\d+),(\d+),(\d+)/);
    if (match) return new Date(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
    const d = new Date(gvizDate);
    return isNaN(d) ? null : d;
}
function parseCategories(categoryStr) {
    if (!categoryStr || typeof categoryStr !== 'string') return [];
    return categoryStr.split(',').map(c => c.trim()).filter(Boolean);
}
const isNewCustomer = (row) => String(row['ลูกค้าใหม่'] || '').trim().toLowerCase() === 'true' || String(row['ลูกค้าใหม่'] || '').trim() === '✔' || String(row['ลูกค้าใหม่'] || '').trim() === '1';

function calculateGrowth(current, previous) {
    if (previous === 0) return current > 0 ? { percent: '∞', class: 'positive' } : { percent: '0.0%', class: '' };
    const percentage = ((current - previous) / previous) * 100;
    return { percent: `${percentage > 0 ? '+' : ''}${percentage.toFixed(1)}%`, class: percentage > 0 ? 'positive' : (percentage < 0 ? 'negative' : '') };
}

// Helper for AI
function getTopCategoriesByMetric(rows, metricKey) {
    const map = {};
    rows.forEach(row => {
        const val = toNumber(row[metricKey]);
        if (val > 0) {
            const cats = parseCategories(row['หมวดหมู่']);
            cats.forEach(c => { map[c] = (map[c] || 0) + (val / cats.length); });
        }
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

// ================================================================
// 5. DATA FETCHING
// ================================================================
async function fetchAdsData(startDate, endDate) {
    const since = startDate.split('-').reverse().join('-');
    const until = endDate.split('-').reverse().join('-');
    const apiUrl = `${CONFIG.API_BASE_URL}/databillChoc?since=${since}&until=${until}`;
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`Ads API error (${response.status})`);
    return response.json();
}

async function fetchSalesData() {
    if (allSalesDataCache.length > 0) return allSalesDataCache;
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&sheet=${CONFIG.SHEET_NAME_SUMMARY}`;
    const response = await fetch(sheetUrl);
    const text = await response.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const gvizData = JSON.parse(jsonStr);
    const cols = gvizData.table.cols.map(c => c.label || c.id || '');
    const salesData = gvizData.table.rows.map(r => {
        const obj = {};
        cols.forEach((col, i) => obj[col] = r.c && r.c[i] ? r.c[i].v : null);
        return obj;
    });
    allSalesDataCache = salesData;
    return salesData;
}

// ================================================================
// 6. DATA PROCESSING
// ================================================================
function linkP1AndUpP1(rows) {
    const p1Lookup = new Map();
    rows.forEach(row => {
        const phone = row['เบอร์ติดต่อ'];
        const p1Value = toNumber(row['P1']);
        const date = parseGvizDate(row['วันที่']);
        if (phone && p1Value > 0 && date) {
            const existing = p1Lookup.get(phone);
            if (!existing || date < existing.p1Date) p1Lookup.set(phone, { p1Date: date, p1Categories: row['หมวดหมู่'] });
        }
    });
    return rows.map(row => {
        const phone = row['เบอร์ติดต่อ'];
        const upP1Value = toNumber(row['ยอดอัพ P1']);
        const date = parseGvizDate(row['วันที่']);
        if (phone && upP1Value > 0 && date) {
            const p1Origin = p1Lookup.get(phone);
            if (p1Origin && date >= p1Origin.p1Date) return { ...row, linkedP1Categories: p1Origin.p1Categories };
        }
        return row;
    });
}

function calculateUpsellPaths(linkedRows) {
    const paths = {};
    linkedRows.forEach(row => {
        if (toNumber(row['ยอดอัพ P1']) > 0 && row.linkedP1Categories) {
            const fromCats = parseCategories(row.linkedP1Categories);
            const toCats = parseCategories(row['หมวดหมู่']);
            const upP1Revenue = toNumber(row['ยอดอัพ P1']);
            if (fromCats.length > 0 && toCats.length > 0) {
                const revenuePortion = upP1Revenue / (fromCats.length * toCats.length);
                fromCats.forEach(fromCat => {
                    toCats.forEach(toCat => {
                        const key = `${fromCat} -> ${toCat}`;
                        if (!paths[key]) paths[key] = { from: fromCat, to: toCat, count: 0, totalUpP1Revenue: 0, transactions: [] };
                        paths[key].count++;
                        paths[key].totalUpP1Revenue += revenuePortion;
                        paths[key].transactions.push(row);
                    });
                });
            }
        }
    });
    return Object.values(paths).sort((a, b) => b.totalUpP1Revenue - a.totalUpP1Revenue);
}

function calculateCategoryDetails(filteredRows) {
    const categoryMap = {};
    filteredRows.forEach(row => {
        const p1 = toNumber(row['P1']);
        const upP1 = toNumber(row['ยอดอัพ P1']);
        const upP2 = toNumber(row['ยอดอัพ P2']);
        const categories = parseCategories(row['หมวดหมู่']);
        if (categories.length > 0) {
            categories.forEach(catName => {
                if (!categoryMap[catName]) categoryMap[catName] = { name: catName, p1Revenue: 0, upP1Revenue: 0, upP2Revenue: 0, p1Bills: 0, upP1Bills: 0, upP2Bills: 0, newCustomers: 0, totalRevenue: 0, transactions: [] };
                const cat = categoryMap[catName];
                cat.p1Revenue += p1 / categories.length;
                cat.upP1Revenue += upP1 / categories.length;
                cat.upP2Revenue += upP2 / categories.length;
                cat.totalRevenue += (p1 + upP1 + upP2) / categories.length;
                if (p1 > 0) cat.p1Bills++;
                if (upP1 > 0) cat.upP1Bills++;
                if (upP2 > 0) cat.upP2Bills++;
                if (isNewCustomer(row)) cat.newCustomers++;
                cat.transactions.push(row);
            });
        }
    });
    return Object.values(categoryMap).sort((a, b) => b.totalRevenue - a.totalRevenue);
}

function processSalesDataForPeriod(allSalesRows, startDate, endDate) {
    const filteredRows = allSalesRows.filter(row => {
        const d = parseGvizDate(row['วันที่']);
        return d && d >= startDate && d <= endDate;
    });
    const summary = { totalBills: 0, totalCustomers: 0, totalRevenue: 0, newCustomers: 0, oldCustomers: 0, p1Revenue: 0, upP1Revenue: 0, upP2Revenue: 0, p1Bills: 0, p2Leads: 0, upP1Bills: 0, upP2Bills: 0 };
    const channelBreakdown = {};
    filteredRows.forEach(row => {
        const p1 = toNumber(row['P1']), upP1 = toNumber(row['ยอดอัพ P1']), upP2 = toNumber(row['ยอดอัพ P2']), p2 = row['P2'];
        const rowRev = p1 + upP1 + upP2;
        if (rowRev > 0) summary.totalBills++;
        if (p1 > 0) summary.p1Bills++;
        if (upP1 > 0) summary.upP1Bills++;
        if (upP2 > 0) summary.upP2Bills++;
        if (p2) summary.p2Leads++;
        summary.p1Revenue += p1; summary.upP1Revenue += upP1; summary.upP2Revenue += upP2; summary.totalRevenue += rowRev;
        if (isNewCustomer(row)) summary.newCustomers++; else if (rowRev > 0) summary.oldCustomers++;
        const channel = row['ช่องทาง'];
        if (channel) {
            if (!channelBreakdown[channel]) channelBreakdown[channel] = { p1: 0, p2: 0, upP2: 0, newCustomers: 0, revenue: 0 };
            const cb = channelBreakdown[channel];
            if (p1 > 0) cb.p1++; if (p2) cb.p2++; if (upP2 > 0) cb.upP2++; if (isNewCustomer(row)) cb.newCustomers++;
            cb.revenue += rowRev;
        }
    });
    summary.totalCustomers = summary.p1Bills + summary.upP2Bills;
    return { summary, categoryDetails: calculateCategoryDetails(filteredRows), filteredRows, channelBreakdown, upsellPaths: calculateUpsellPaths(linkP1AndUpP1(filteredRows)) };
}

// ================================================================
// 7. RENDERING & AI FUNCTIONS
// ================================================================
function renderAISummary(salesData) {
    const { summary, filteredRows, channelBreakdown, categoryDetails } = salesData;
    const topOverall = categoryDetails.slice(0, 5);
    const topP1 = getTopCategoriesByMetric(filteredRows, 'P1');
    const topUPP1 = getTopCategoriesByMetric(filteredRows, 'ยอดอัพ P1');
    const topUPP2 = getTopCategoriesByMetric(filteredRows, 'ยอดอัพ P2');

    let html = `
        <div class="ai-analysis-grid">
            <div>
                <div class="ai-section-title">📊 สรุปข้อมูลปัจจุบัน</div>
                <ul class="ai-list">
                    <li>ยอดขายรวม: <span class="ai-highlight">${formatCurrency(summary.totalRevenue)}</span></li>
                    <li>จำนวนบิล: <strong>${summary.totalBills}</strong> | ลูกค้าใหม่: <span class="ai-highlight">${summary.newCustomers}</span></li>
                    <li>ยอด P1: ${formatCurrencyShort(summary.p1Revenue)}</li>
                    <li>ยอด UP P1: ${formatCurrencyShort(summary.upP1Revenue)} | UP P2: ${formatCurrencyShort(summary.upP2Revenue)}</li>
                </ul>
            </div>
            <div>
                <div class="ai-section-title">🏆 Top 5 หมวดหมู่</div>
                <ul class="ai-list">
                    <li><strong>ยอดรวม:</strong> ${topOverall.map(c => c.name).join(', ') || '-'}</li>
                    <li><strong>P1 ขายดี:</strong> ${topP1.map(c => c[0]).join(', ') || '-'}</li>
                    <li><strong>UP P1:</strong> ${topUPP1.map(c => c[0]).join(', ') || '-'}</li>
                    <li><strong>UP P2:</strong> ${topUPP2.map(c => c[0]).join(', ') || '-'}</li>
                </ul>
            </div>
        </div>
        <div class="ai-section-title">📡 ประสิทธิภาพรายช่องทาง</div>
        <div class="ai-channel-grid">
    `;
    Object.entries(channelBreakdown).sort((a,b) => b[1].revenue - a[1].revenue).forEach(([name, data]) => {
        html += `<div class="ai-channel-card"><div class="channel-name">${name}</div><div class="channel-rev">${formatCurrencyShort(data.revenue)}</div><div class="channel-meta">P1: ${data.p1} | P2: ${data.p2} | UP P2: ${data.upP2}</div></div>`;
    });
    html += `</div>`;
    const best = Object.entries(channelBreakdown).sort((a,b) => b[1].revenue - a[1].revenue)[0];
    if (best) html += `<div class="ai-insight-box">💡 <strong>AI Insight:</strong> ช่องทาง <span class="ai-highlight">${best[0]}</span> ทำผลงานดีที่สุด แนะนำโฟกัสบริการ <span class="ai-highlight">${topOverall[0]?.name || 'หลัก'}</span> เพื่อกระตุ้นยอดขายต่อเนื่อง</div>`;
    ui.aiSummaryContent.innerHTML = html;
}

// (รวมฟังก์ชัน Render เดิมทั้งหมดที่คุณมีในโค้ดตั้งต้น)
function renderFunnelOverview(ads, sales, compAds, compSales) {
    const createCard = (label, cur, prev, isCurr = false, isRoas = false) => {
        const growth = calculateGrowth(cur, prev || 0);
        const display = isRoas ? `${cur.toFixed(2)}x` : (isCurr ? formatCurrency(cur) : formatNumber(cur));
        const prevDisp = isRoas ? `${(prev||0).toFixed(2)}x` : (isCurr ? formatCurrency(prev||0) : formatNumber(prev||0));
        return `<div class="stat-card"><div class="stat-number"><span>${display}</span>${compAds || compSales ? `<span class="growth-indicator ${growth.class}">${growth.percent}</span>` : ''}</div>${compAds || compSales ? `<div class="stat-comparison">vs ${prevDisp}</div>` : ''}<div class="stat-label">${label}</div></div>`;
    };
    const spend = ads.spend || 0, revenue = sales.totalRevenue || 0, roas = spend > 0 ? revenue / spend : 0, cpa = sales.newCustomers > 0 ? spend / sales.newCustomers : 0;
    const pSpend = compAds?.spend || 0, pRevenue = compSales?.summary.totalRevenue || 0, pRoas = pSpend > 0 ? pRevenue / pSpend : 0, pCpa = compSales?.summary.newCustomers > 0 ? pSpend / compSales.summary.newCustomers : 0;
    ui.funnelStatsGrid.innerHTML = [createCard('Ad Spend', spend, pSpend, true), createCard('Total Revenue', revenue, pRevenue, true), createCard('ROAS', roas, pRoas, false, true), createCard('Purchases', ads.purchases, compAds?.purchases || 0), createCard('CPA', cpa, pCpa, true)].join('');
}

function renderAdsOverview(t) {
    ui.adsStatsGrid.innerHTML = [`Impressions: ${formatNumber(t.impressions)}`, `Messaging: ${formatNumber(t.messaging_conversations)}`, `Avg. CPM: ${formatCurrency(t.cpm)}`, `Avg. CTR: ${parseFloat(t.ctr||0).toFixed(2)}%`].map(v => `<div class="stat-card"><div class="stat-number">${v.split(': ')[1]}</div><div class="stat-label">${v.split(': ')[0]}</div></div>`).join('');
}

function renderSalesOverview(s, c) {
    const card = (l, cur, prev, isCurr = false) => {
        const growth = calculateGrowth(cur, prev || 0);
        return `<div class="stat-card"><div class="stat-number"><span>${isCurr ? formatCurrency(cur) : formatNumber(cur)}</span>${c ? `<span class="growth-indicator ${growth.class}">${growth.percent}</span>` : ''}</div><div class="stat-label">${l}</div></div>`;
    };
    ui.salesOverviewStatsGrid.innerHTML = [card('Total Bills', s.totalBills, c?.totalBills), card('Revenue', s.totalRevenue, c?.totalRevenue, true), card('Total Customers', s.totalCustomers, c?.totalCustomers), card('New Customers', s.newCustomers, c?.newCustomers)].join('');
}

function renderSalesRevenueBreakdown(s, c) {
    const card = (l, cur, prev) => `<div class="stat-card"><div class="stat-number"><span>${formatCurrency(cur)}</span>${c ? `<span class="growth-indicator ${calculateGrowth(cur, prev).class}">${calculateGrowth(cur, prev).percent}</span>` : ''}</div><div class="stat-label">${l}</div></div>`;
    ui.salesRevenueStatsGrid.innerHTML = [card('P1 Revenue', s.p1Revenue, c?.p1Revenue), card('UP P1 Revenue', s.upP1Revenue, c?.upP1Revenue), card('UP P2 Revenue', s.upP2Revenue, c?.upP2Revenue)].join('');
    charts.revenue.data.datasets[0].data = [s.p1Revenue, s.upP1Revenue, s.upP2Revenue]; charts.customer.data.datasets[0].data = [s.newCustomers, s.oldCustomers];
    charts.revenue.update(); charts.customer.update();
}

function renderSalesBillStats(s, c) {
    const card = (l, cur, prev, isRate = false) => `<div class="stat-card"><div class="stat-number"><span>${isRate ? cur.toFixed(1) + '%' : formatNumber(cur)}</span>${c ? `<span class="growth-indicator ${calculateGrowth(cur, prev).class}">${calculateGrowth(cur, prev).percent}</span>` : ''}</div><div class="stat-label">${l}</div></div>`;
    const rate1 = s.p1Bills > 0 ? (s.upP1Bills / s.p1Bills) * 100 : 0, pRate1 = (c?.p1Bills > 0) ? (c.upP1Bills / c.p1Bills) * 100 : 0;
    const rate2 = s.p2Leads > 0 ? (s.upP2Bills / s.p2Leads) * 100 : 0, pRate2 = (c?.p2Leads > 0) ? (c.upP2Bills / c.p2Leads) * 100 : 0;
    ui.salesBillStatsGrid.innerHTML = [card('P1 Bills', s.p1Bills, c?.p1Bills), card('P2 Leads', s.p2Leads, c?.p2Leads), card('UP P1 Bills', s.upP1Bills, c?.upP1Bills), card('UP P2 Bills', s.upP2Bills, c?.upP2Bills), card('P1→UP P1', rate1, pRate1, true), card('P2 Conv', rate2, pRate2, true)].join('');
}

function renderChannelTable(data) {
    const sorted = Object.keys(data).sort((a, b) => data[b].revenue - data[a].revenue);
    ui.channelTableBody.innerHTML = sorted.map(ch => `<tr><td><strong>${ch}</strong></td><td>${formatNumber(data[ch].p1)}</td><td>${formatNumber(data[ch].p2)}</td><td>${formatNumber(data[ch].upP2)}</td><td>${formatNumber(data[ch].newCustomers)}</td><td class="revenue-cell">${formatCurrency(data[ch].revenue)}</td></tr>`).join('');
}

function renderCampaignsTable(data) {
    ui.campaignsTableBody.innerHTML = data.map(c => `<tr><td><strong>${c.name}</strong></td><td>${c.status}</td><td class="revenue-cell">${formatCurrency(c.insights.spend)}</td><td>${formatNumber(c.insights.impressions)}</td><td>${formatNumber(c.insights.purchases)}</td><td>${formatNumber(c.insights.messaging_conversations)}</td><td>${formatCurrency(c.insights.cpm)}</td></tr>`).join('');
}

function renderCategoryChart(data) {
    const top = data.slice(0, 15);
    charts.categoryRevenue.data.labels = top.map(d => d.name);
    charts.categoryRevenue.data.datasets[0].data = top.map(d => d.totalRevenue);
    charts.categoryRevenue.update();
}

function renderCategoryDetailTable(data) {
    ui.categoryDetailTableBody.innerHTML = data.map((c, i) => `<tr><td class="rank-column"><span class="rank-badge ${i<3?['gold','silver','bronze'][i]:''}">${i+1}</span></td><td><strong>${c.name}</strong></td><td>${formatNumber(c.p1Bills)}</td><td>${formatNumber(c.upP1Bills)}</td><td>${formatNumber(c.upP2Bills)}</td><td>${formatNumber(c.newCustomers)}</td><td class="revenue-cell">${formatCurrency(c.totalRevenue)}</td></tr>`).join('');
}

function renderUpsellPaths(paths) {
    ui.upsellPathsTableBody.innerHTML = paths.map((p, i) => `<tr><td class="rank-column"><span class="rank-badge ${i<3?['gold','silver','bronze'][i]:''}">${i+1}</span></td><td>${p.from}</td><td>${p.to}</td><td>${formatNumber(p.count)}</td><td class="revenue-cell">${formatCurrency(p.totalUpP1Revenue)}</td><td><button class="btn" style="padding:4px 10px; font-size:0.8em;">ดู</button></td></tr>`).join('');
}

// ================================================================
// 8. INITIALIZATION & MAIN LOGIC
// ================================================================
function initializeCharts() {
    const text = '#e0e0e0', grid = 'rgba(224,224,224,0.1)';
    const ctx1 = document.getElementById('dailySpendChart').getContext('2d');
    charts.dailySpend = new Chart(ctx1, { type: 'line', data: { labels: [], datasets: [{ label: 'Spend', data: [], borderColor: '#00f2fe', fill: true, backgroundColor: 'rgba(0,242,254,0.1)' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: text } }, y: { ticks: { color: text } } } } });
    const ctx2 = document.getElementById('revenueChart').getContext('2d');
    charts.revenue = new Chart(ctx2, { type: 'bar', data: { labels: ['P1', 'UP P1', 'UP P2'], datasets: [{ data: [], backgroundColor: ['#3B82F6', '#EC4899', '#84CC16'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    const ctx3 = document.getElementById('customerChart').getContext('2d');
    charts.customer = new Chart(ctx3, { type: 'doughnut', data: { labels: ['New', 'Old'], datasets: [{ data: [], backgroundColor: ['#F59E0B', '#10B981'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    const ctx4 = document.getElementById('categoryRevenueChart').getContext('2d');
    charts.categoryRevenue = new Chart(ctx4, { type: 'bar', data: { labels: [], datasets: [{ data: [], backgroundColor: '#3B82F6' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: text } }, y: { ticks: { color: text } } } } });
}

async function main() {
    ui.loading.classList.add('show'); hideError();
    try {
        const startStr = ui.startDate.value, endStr = ui.endDate.value, isComp = ui.compareToggle.checked;
        const promises = [fetchAdsData(startStr, endStr), fetchSalesData()];
        if (isComp) promises.push(fetchAdsData(ui.compareStartDate.value, ui.compareEndDate.value));
        const [ads, allSales, compAds] = await Promise.all(promises);
        
        const currentSales = processSalesDataForPeriod(allSales, new Date(startStr+'T00:00:00'), new Date(endStr+'T23:59:59'));
        let compSales = null;
        if (isComp) compSales = processSalesDataForPeriod(allSales, new Date(ui.compareStartDate.value+'T00:00:00'), new Date(ui.compareEndDate.value+'T23:59:59'));
        
        latestCampaignData = ads.data.campaigns;
        renderAISummary(currentSales);
        renderFunnelOverview(ads.totals, currentSales.summary, compAds?.totals, compSales);
        renderAdsOverview(ads.totals);
        renderSalesOverview(currentSales.summary, compSales?.summary);
        renderSalesRevenueBreakdown(currentSales.summary, compSales?.summary);
        renderSalesBillStats(currentSales.summary, compSales?.summary);
        renderChannelTable(currentSales.channelBreakdown);
        renderCampaignsTable(ads.data.campaigns);
        renderCategoryChart(currentSales.categoryDetails);
        renderCategoryDetailTable(currentSales.categoryDetails);
        renderUpsellPaths(currentSales.upsellPaths);
        
        charts.dailySpend.data.labels = ads.data.dailySpend.map(d => d.date.split('-').slice(1).reverse().join('/'));
        charts.dailySpend.data.datasets[0].data = ads.data.dailySpend.map(d => d.spend);
        charts.dailySpend.update();
    } catch (e) { showError(e.message); console.error(e); } finally { ui.loading.classList.remove('show'); }
}

function setDefaultDates() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const toStr = (d) => d.toISOString().split('T')[0];
    ui.startDate.value = toStr(firstDay); ui.endDate.value = toStr(now);
    ui.compareStartDate.value = toStr(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    ui.compareEndDate.value = toStr(new Date(now.getFullYear(), now.getMonth(), 0));
}

document.addEventListener('DOMContentLoaded', () => {
    initializeCharts(); setDefaultDates();
    ui.refreshBtn.onclick = main;
    ui.compareToggle.onchange = () => ui.compareControls.classList.toggle('show', ui.compareToggle.checked);
    [ui.startDate, ui.endDate, ui.compareStartDate, ui.compareEndDate].forEach(i => i.onchange = main);
    main();
});
