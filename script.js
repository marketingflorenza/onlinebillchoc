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
    aiSummaryBtn: document.getElementById('aiSummaryBtn'),
    aiModal: document.getElementById('aiModal'),
    aiModalBody: document.getElementById('aiModalBody'),
    aiModalClose: document.getElementById('aiModalClose'),
    copyAiText: document.getElementById('copyAiText')
};

// ================================================================
// 3. GLOBAL STATE
// ================================================================
let charts = {};
let latestCampaignData = [];
let latestCategoryDetails = [];
let latestFilteredSalesRows = [];
let latestSalesSummary = null;
let latestChannelBreakdown = null;
let currentPopupAds = [];
let currentSort = { key: 'spend', direction: 'desc' };
let allSalesDataCache = [];

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

const isNewCustomer = (row) => {
    const val = String(row['ลูกค้าใหม่'] || '').trim().toLowerCase();
    return val === 'true' || val === '✔' || val === '1' || val === 'ใช่';
};

function calculateGrowth(current, previous) {
    if (previous === 0) return current > 0 ? { percent: '∞', class: 'positive' } : { percent: '0.0%', class: '' };
    const percentage = ((current - previous) / previous) * 100;
    return { percent: `${percentage > 0 ? '+' : ''}${percentage.toFixed(1)}%`, class: percentage > 0 ? 'positive' : (percentage < 0 ? 'negative' : '') };
}

// ================================================================
// 5. DATA FETCHING
// ================================================================
async function fetchAdsData(startDate, endDate) {
    const since = startDate.split('-').reverse().join('-');
    const until = endDate.split('-').reverse().join('-');
    const response = await fetch(`${CONFIG.API_BASE_URL}/databillChoc?since=${since}&until=${until}`);
    if (!response.ok) throw new Error("Ads API Error");
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
    allSalesDataCache = gvizData.table.rows.map(r => {
        const obj = {};
        cols.forEach((col, i) => obj[col] = r.c && r.c[i] ? r.c[i].v : null);
        return obj;
    });
    return allSalesDataCache;
}

// ================================================================
// 6. PROCESSING
// ================================================================
function processData(allSalesRows, startDate, endDate) {
    const filtered = allSalesRows.filter(row => {
        const d = parseGvizDate(row['วันที่']);
        return d && d >= startDate && d <= endDate;
    });

    const summary = { totalBills: 0, totalRevenue: 0, newCustomers: 0, oldCustomers: 0, p1Revenue: 0, upP1Revenue: 0, upP2Revenue: 0, p1Bills: 0, p2Leads: 0, upP1Bills: 0, upP2Bills: 0 };
    const channels = {};
    const catMap = {};

    filtered.forEach(row => {
        const p1 = toNumber(row['P1']), upP1 = toNumber(row['ยอดอัพ P1']), upP2 = toNumber(row['ยอดอัพ P2']), rowRev = p1 + upP1 + upP2;
        const ch = row['ช่องทาง'] || 'Unknown';
        const cats = parseCategories(row['หมวดหมู่']);

        if (rowRev > 0) summary.totalBills++;
        if (p1 > 0) { summary.p1Bills++; summary.p1Revenue += p1; }
        if (upP1 > 0) { summary.upP1Bills++; summary.upP1Revenue += upP1; }
        if (upP2 > 0) { summary.upP2Bills++; summary.upP2Revenue += upP2; }
        if (row['P2']) summary.p2Leads++;
        summary.totalRevenue += rowRev;

        if (isNewCustomer(row)) summary.newCustomers++; else if (rowRev > 0) summary.oldCustomers++;

        // Channels
        if (!channels[ch]) channels[ch] = { p1: 0, p2: 0, upP2: 0, newCustomers: 0, revenue: 0 };
        if (p1 > 0) channels[ch].p1++;
        if (row['P2']) channels[ch].p2++;
        if (upP2 > 0) channels[ch].upP2++;
        if (isNewCustomer(row)) channels[ch].newCustomers++;
        channels[ch].revenue += rowRev;

        // Categories
        if (rowRev > 0 && cats.length > 0) {
            cats.forEach(c => {
                if (!catMap[c]) catMap[c] = { name: c, p1Bills: 0, upP1Bills: 0, upP2Bills: 0, totalRevenue: 0, transactions: [] };
                catMap[c].totalRevenue += rowRev / cats.length;
                if (p1 > 0) catMap[c].p1Bills++;
                if (upP1 > 0) catMap[c].upP1Bills++;
                if (upP2 > 0) catMap[c].upP2Bills++;
                catMap[c].transactions.push(row);
            });
        }
    });

    summary.totalCustomers = summary.p1Bills + summary.upP2Bills;
    return { summary, channels, categories: Object.values(catMap).sort((a,b) => b.totalRevenue - a.totalRevenue), filtered };
}

// ================================================================
// 7. RENDERING
// ================================================================
function renderAll(salesData, adsData) {
    // Stats Grids
    const s = salesData.summary;
    const a = adsData.totals;
    const roas = a.spend > 0 ? s.totalRevenue / a.spend : 0;

    ui.funnelStatsGrid.innerHTML = `
        <div class="stat-card"><div class="stat-number">${formatCurrency(a.spend)}</div><div class="stat-label">Ad Spend</div></div>
        <div class="stat-card"><div class="stat-number">${formatCurrency(s.totalRevenue)}</div><div class="stat-label">Total Revenue</div></div>
        <div class="stat-card"><div class="stat-number">${roas.toFixed(2)}x</div><div class="stat-label">ROAS</div></div>
        <div class="stat-card"><div class="stat-number">${formatNumber(s.newCustomers)}</div><div class="stat-label">New Customers</div></div>
    `;

    ui.salesOverviewStatsGrid.innerHTML = `
        <div class="stat-card"><div class="stat-number">${formatNumber(s.totalBills)}</div><div class="stat-label">Total Bills</div></div>
        <div class="stat-card"><div class="stat-number">${formatNumber(s.totalCustomers)}</div><div class="stat-label">Total Customers</div></div>
    `;

    // Channels Table
    ui.channelTableBody.innerHTML = Object.keys(salesData.channels).sort((x,y) => salesData.channels[y].revenue - salesData.channels[x].revenue).map(ch => {
        const d = salesData.channels[ch];
        const sc = ch.replace(/'/g, "\\'");
        return `<tr>
            <td><strong>${ch}</strong></td>
            <td><span class="clickable-cell" onclick="showPopup('Channel: ${sc}', 'P1', '${sc}')">${formatNumber(d.p1)}</span></td>
            <td><span class="clickable-cell" onclick="showPopup('Channel: ${sc}', 'P2', '${sc}')">${formatNumber(d.p2)}</span></td>
            <td><span class="clickable-cell" onclick="showPopup('Channel: ${sc}', 'UPP2', '${sc}')">${formatNumber(d.upP2)}</span></td>
            <td><span class="clickable-cell" onclick="showPopup('Channel: ${sc}', 'NEW', '${sc}')">${formatNumber(d.newCustomers)}</span></td>
            <td class="revenue-cell"><span class="clickable-cell" onclick="showPopup('Channel: ${sc}', 'ALL', '${sc}')">${formatCurrencyShort(d.revenue)}</span></td>
        </tr>`;
    }).join('');

    // Category Table
    ui.categoryDetailTableBody.innerHTML = salesData.categories.map((c, i) => {
        const sc = c.name.replace(/'/g, "\\'");
        return `<tr>
            <td>${i+1}</td>
            <td><strong>${c.name}</strong></td>
            <td><span class="clickable-cell" onclick="showCatPopup('${sc}', 'P1')">${formatNumber(c.p1Bills)}</span></td>
            <td><span class="clickable-cell" onclick="showCatPopup('${sc}', 'UPP1')">${formatNumber(c.upP1Bills)}</span></td>
            <td><span class="clickable-cell" onclick="showCatPopup('${sc}', 'UPP2')">${formatNumber(c.upP2Bills)}</span></td>
            <td class="revenue-cell">${formatCurrency(c.totalRevenue)}</td>
        </tr>`;
    }).join('');

    // Charts
    charts.revenue.data.datasets[0].data = [s.p1Revenue, s.upP1Revenue, s.upP2Revenue];
    charts.revenue.update();
    charts.customer.data.datasets[0].data = [s.newCustomers, s.oldCustomers];
    charts.customer.update();
    
    // Ads Table
    ui.campaignsTableBody.innerHTML = adsData.data.campaigns.map(c => `<tr>
        <td><strong>${c.name}</strong></td>
        <td>${c.status}</td>
        <td class="revenue-cell">${formatCurrency(c.insights.spend)}</td>
        <td>${formatNumber(c.insights.impressions)}</td>
        <td>${formatNumber(c.insights.purchases)}</td>
        <td>${formatNumber(c.insights.messaging_conversations)}</td>
        <td>${formatCurrency(c.insights.cpm)}</td>
    </tr>`).join('');
}

// ================================================================
// 8. POPUPS
// ================================================================
function showPopup(title, type, filterVal) {
    let rows = latestFilteredSalesRows.filter(r => r['ช่องทาง'] === filterVal);
    if (type === 'P1') rows = rows.filter(r => toNumber(r['P1']) > 0);
    else if (type === 'P2') rows = rows.filter(r => r['P2']);
    else if (type === 'UPP2') rows = rows.filter(r => toNumber(r['ยอดอัพ P2']) > 0);
    else if (type === 'NEW') rows = rows.filter(r => isNewCustomer(r));
    renderModal(title, rows);
}

function showCatPopup(catName, type) {
    const cat = latestCategoryDetails.find(c => c.name === catName);
    let rows = cat.transactions;
    if (type === 'P1') rows = rows.filter(r => toNumber(r['P1']) > 0);
    else if (type === 'UPP1') rows = rows.filter(r => toNumber(r['ยอดอัพ P1']) > 0);
    else if (type === 'UPP2') rows = rows.filter(r => toNumber(r['ยอดอัพ P2']) > 0);
    renderModal(`Category: ${catName}`, rows);
}

function renderModal(title, rows) {
    ui.modalTitle.textContent = title;
    ui.modalBody.innerHTML = `<div class="top-categories-table"><table><thead><tr><th>วันที่</th><th>ลูกค้า</th><th>หมวดหมู่</th><th>ยอด</th></tr></thead><tbody>
        ${rows.map(r => `<tr>
            <td>${new Date(parseGvizDate(r['วันที่'])).toLocaleDateString('th-TH')}</td>
            <td>${r['ชื่อลูกค้า'] || '-'}</td>
            <td>${r['หมวดหมู่'] || '-'}</td>
            <td class="revenue-cell">${formatCurrency(toNumber(r['P1'])+toNumber(r['ยอดอัพ P1'])+toNumber(r['ยอดอัพ P2']))}</td>
        </tr>`).join('')}
    </tbody></table></div>`;
    ui.modalBody.className = "modal-body table-view";
    ui.modal.classList.add('show');
}

// ================================================================
// 9. AI SUMMARY
// ================================================================
function getAiSummary() {
    const s = latestSalesSummary;
    const c = latestChannelBreakdown;
    let t = `--- [ข้อมูลช่วงเวลาปัจจุบัน] ---\n`;
    t += `* ยอดขายรวม: ${formatCurrencyShort(s.totalRevenue)} บาท\n* จำนวนบิล: ${formatNumber(s.totalBills)}\n`;
    t += `* P1: ${formatCurrencyShort(s.p1Revenue)} | UP P1: ${formatCurrencyShort(s.upP1Revenue)} | UP P2: ${formatCurrencyShort(s.upP2Revenue)}\n\n`;
    t += `--- [สรุปตามช่องทาง] ---\n`;
    Object.keys(c).forEach(ch => {
        const d = c[ch];
        t += `* ${ch}: P1=${d.p1}, P2=${d.p2}, UP P2=${d.upP2}, ยอด=${formatCurrencyShort(d.revenue)}\n`;
    });
    return t;
}

// ================================================================
// 10. INIT
// ================================================================
async function main() {
    ui.loading.classList.add('show');
    try {
        const [ads, sales] = await Promise.all([fetchAdsData(ui.startDate.value, ui.endDate.value), fetchSalesData()]);
        const processed = processData(sales, new Date(ui.startDate.value), new Date(ui.endDate.value));
        
        latestSalesSummary = processed.summary;
        latestChannelBreakdown = processed.channels;
        latestCategoryDetails = processed.categories;
        latestFilteredSalesRows = processed.filtered;

        renderAll(processed, ads);
    } catch (e) { showError(e.message); }
    ui.loading.classList.remove('show');
}

document.addEventListener('DOMContentLoaded', () => {
    // Chart Init
    charts.revenue = new Chart(document.getElementById('revenueChart'), { type: 'bar', data: { labels: ['P1', 'UP P1', 'UP P2'], datasets: [{ data: [], backgroundColor: ['#3B82F6', '#EC4899', '#84CC16'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    charts.customer = new Chart(document.getElementById('customerChart'), { type: 'doughnut', data: { labels: ['New', 'Old'], datasets: [{ data: [], backgroundColor: ['#F59E0B', '#10B981'] }] }, options: { responsive: true, maintainAspectRatio: false } });

    // Dates
    const d = new Date();
    ui.endDate.value = d.toISOString().split('T')[0];
    ui.startDate.value = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];

    ui.refreshBtn.onclick = main;
    ui.aiSummaryBtn.onclick = () => { ui.aiModalBody.innerHTML = `<pre>${getAiSummary()}</pre>`; ui.aiModal.classList.add('show'); };
    ui.aiModalClose.onclick = () => ui.aiModal.classList.remove('show');
    ui.modalCloseBtn.onclick = () => ui.modal.classList.remove('show');
    ui.copyAiText.onclick = () => { navigator.clipboard.writeText(getAiSummary()); ui.copyAiText.textContent = "คัดลอกแล้ว!"; setTimeout(()=>ui.copyAiText.textContent="คัดลอกข้อความ", 2000); };
    
    main();
});
