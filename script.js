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
    // AI
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
let latestUpsellPaths = [];
let latestFilteredSalesRows = [];
let latestSalesSummary = null;
let latestChannelBreakdown = null;
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
const isNewCustomer = (row) => {
    const val = String(row['ลูกค้าใหม่'] || '').trim().toLowerCase();
    return val === 'true' || val === '✔' || val === '1' || val === 'ใช่';
};

// ================================================================
// 5. DATA FETCHING
// ================================================================
async function fetchAdsData(startDate, endDate) {
    const since = startDate.split('-').reverse().join('-');
    const until = endDate.split('-').reverse().join('-');
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/databillChoc?since=${since}&until=${until}`);
        if (!response.ok) throw new Error(`Ads API error (${response.status})`);
        return response.json();
    } catch (error) { throw error; }
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
function processSalesDataForPeriod(allSalesRows, startDate, endDate) {
    const filteredRows = allSalesRows.filter(row => {
        const d = parseGvizDate(row['วันที่']);
        return d && d >= startDate && d <= endDate;
    });

    const summary = { totalBills: 0, totalCustomers: 0, totalRevenue: 0, newCustomers: 0, oldCustomers: 0, p1Revenue: 0, upP1Revenue: 0, upP2Revenue: 0, p1Bills: 0, p2Leads: 0, upP1Bills: 0, upP2Bills: 0 };
    const channelBreakdown = {};

    filteredRows.forEach(row => {
        const p1 = toNumber(row['P1']);
        const upP1 = toNumber(row['ยอดอัพ P1']);
        const upP2 = toNumber(row['ยอดอัพ P2']);
        const p2 = row['P2'];
        const rowRevenue = p1 + upP1 + upP2;

        if (rowRevenue > 0) summary.totalBills++;
        if (p1 > 0) summary.p1Bills++;
        if (upP1 > 0) summary.upP1Bills++;
        if (upP2 > 0) summary.upP2Bills++;
        if (p2) summary.p2Leads++;

        summary.p1Revenue += p1;
        summary.upP1Revenue += upP1;
        summary.upP2Revenue += upP2;
        summary.totalRevenue += rowRevenue;

        if (isNewCustomer(row)) summary.newCustomers++;
        else if (rowRevenue > 0) summary.oldCustomers++;

        const channel = row['ช่องทาง'];
        if (channel) {
            if (!channelBreakdown[channel]) channelBreakdown[channel] = { p1: 0, p2: 0, upP2: 0, newCustomers: 0, revenue: 0 };
            if (p1 > 0) channelBreakdown[channel].p1++;
            if (p2) channelBreakdown[channel].p2++;
            if (upP2 > 0) channelBreakdown[channel].upP2++;
            if (isNewCustomer(row)) channelBreakdown[channel].newCustomers++;
            channelBreakdown[channel].revenue += rowRevenue;
        }
    });

    summary.totalCustomers = summary.p1Bills + summary.upP2Bills;
    const categoryDetails = calculateCategoryDetails(filteredRows);
    const upsellPaths = calculateUpsellPaths(linkP1AndUpP1(filteredRows));

    return { summary, categoryDetails, filteredRows, channelBreakdown, upsellPaths };
}

function calculateCategoryDetails(filteredRows) {
    const categoryMap = {};
    filteredRows.forEach(row => {
        const p1 = toNumber(row['P1']), upP1 = toNumber(row['ยอดอัพ P1']), upP2 = toNumber(row['ยอดอัพ P2']);
        const categories = parseCategories(row['หมวดหมู่']);
        if ((p1+upP1+upP2) > 0 && categories.length > 0) {
            categories.forEach(catName => {
                if (!categoryMap[catName]) categoryMap[catName] = { name: catName, p1Revenue: 0, upP1Revenue: 0, upP2Revenue: 0, p1Bills: 0, upP1Bills: 0, upP2Bills: 0, totalRevenue: 0, transactions: [] };
                const cat = categoryMap[catName];
                cat.p1Revenue += p1/categories.length; cat.upP1Revenue += upP1/categories.length; cat.upP2Revenue += upP2/categories.length;
                cat.totalRevenue += (p1+upP1+upP2)/categories.length;
                if (p1 > 0) cat.p1Bills++; if (upP1 > 0) cat.upP1Bills++; if (upP2 > 0) cat.upP2Bills++;
                cat.transactions.push(row);
            });
        }
    });
    return Object.values(categoryMap).sort((a,b) => b.totalRevenue - a.totalRevenue);
}

function linkP1AndUpP1(rows) {
    const p1Lookup = new Map();
    rows.forEach(row => {
        const phone = row['เบอร์ติดต่อ'], p1 = toNumber(row['P1']), date = parseGvizDate(row['วันที่']);
        if (phone && p1 > 0 && date) {
            if (!p1Lookup.has(phone) || date < p1Lookup.get(phone).p1Date) p1Lookup.set(phone, { p1Date: date, p1Categories: row['หมวดหมู่'] });
        }
    });
    return rows.map(row => {
        const phone = row['เบอร์ติดต่อ'], upP1 = toNumber(row['ยอดอัพ P1']), date = parseGvizDate(row['วันที่']);
        if (phone && upP1 > 0 && date && p1Lookup.has(phone) && date >= p1Lookup.get(phone).p1Date) return { ...row, linkedP1Categories: p1Lookup.get(phone).p1Categories };
        return row;
    });
}

function calculateUpsellPaths(linkedRows) {
    const paths = {};
    linkedRows.forEach(row => {
        if (toNumber(row['ยอดอัพ P1']) > 0 && row.linkedP1Categories) {
            const froms = parseCategories(row.linkedP1Categories), tos = parseCategories(row['หมวดหมู่']);
            const rev = toNumber(row['ยอดอัพ P1']) / (froms.length * tos.length);
            froms.forEach(f => tos.forEach(t => {
                const k = `${f} -> ${t}`;
                if (!paths[k]) paths[k] = { from: f, to: t, count: 0, totalUpP1Revenue: 0, transactions: [] };
                paths[k].count++; paths[k].totalUpP1Revenue += rev; paths[k].transactions.push(row);
            }));
        }
    });
    return Object.values(paths).sort((a,b) => b.totalUpP1Revenue - a.totalUpP1Revenue);
}

// ================================================================
// 7. RENDERING
// ================================================================
function renderChannelTable(channelData) {
    const sorted = Object.keys(channelData).sort((a, b) => channelData[b].revenue - channelData[a].revenue);
    ui.channelTableBody.innerHTML = sorted.map(ch => {
        const d = channelData[ch];
        const safeCh = ch.replace(/'/g, "\\'");
        return `<tr>
            <td><strong>${ch}</strong></td>
            <td><span class="clickable-cell" onclick="showChannelDetailsPopup('${safeCh}', 'P1_BILLS')">${formatNumber(d.p1)}</span></td>
            <td><span class="clickable-cell" onclick="showChannelDetailsPopup('${safeCh}', 'P2_LEADS')">${formatNumber(d.p2)}</span></td>
            <td><span class="clickable-cell" onclick="showChannelDetailsPopup('${safeCh}', 'UP_P2_BILLS')">${formatNumber(d.upP2)}</span></td>
            <td><span class="clickable-cell" onclick="showChannelDetailsPopup('${safeCh}', 'NEW_CUSTOMERS')">${formatNumber(d.newCustomers)}</span></td>
            <td class="revenue-cell"><span class="clickable-cell" onclick="showChannelDetailsPopup('${safeCh}', 'REVENUE')">${formatCurrencyShort(d.revenue)}</span></td>
        </tr>`;
    }).join('');
}

function renderCategoryDetailTable(categoryDetails) {
    const rankClasses = ['gold', 'silver', 'bronze'];
    ui.categoryDetailTableBody.innerHTML = categoryDetails.map((cat, index) => {
        const safeCat = cat.name.replace(/'/g, "\\'");
        return `<tr class="clickable-row" onclick="showCategoryDetailsPopup('${safeCat}', 'ALL')">
            <td class="rank-column"><span class="rank-badge ${index < 3 ? rankClasses[index] : ''}">${index + 1}</span></td>
            <td><strong>${cat.name}</strong></td>
            <td><span class="clickable-cell" onclick="event.stopPropagation(); showCategoryDetailsPopup('${safeCat}', 'P1')">${formatNumber(cat.p1Bills)}</span></td>
            <td><span class="clickable-cell" onclick="event.stopPropagation(); showCategoryDetailsPopup('${safeCat}', 'UP_P1')">${formatNumber(cat.upP1Bills)}</span></td>
            <td><span class="clickable-cell" onclick="event.stopPropagation(); showCategoryDetailsPopup('${safeCat}', 'UP_P2')">${formatNumber(cat.upP2Bills)}</span></td>
            <td class="revenue-cell">${formatCurrency(cat.totalRevenue)}</td>
        </tr>`;
    }).join('');
}

// AI Summary Text
function generateAiSummaryText() {
    if (!latestSalesSummary) return "กรุณารอโหลดข้อมูล...";
    const s = latestSalesSummary;
    const top5Total = [...latestCategoryDetails].sort((a,b) => b.totalRevenue - a.totalRevenue).slice(0, 5);
    const top5P1 = [...latestCategoryDetails].sort((a,b) => b.p1Revenue - a.p1Revenue).slice(0, 5);
    const top5UpP1 = [...latestCategoryDetails].sort((a,b) => b.upP1Revenue - a.upP1Revenue).slice(0, 5);

    let t = `* สาขา: Online Choc\n* ช่วงเวลา: ${ui.startDate.value} ถึง ${ui.endDate.value}\n\n`;
    t += `--- [ข้อมูลช่วงเวลาปัจจุบัน] ---\n`;
    t += `* ยอดขายรวม: ${formatCurrencyShort(s.totalRevenue)} บาท\n* จำนวนบิลทั้งหมด: ${formatNumber(s.totalBills)} บิล\n`;
    t += `* ยอดขาย P1: ${formatCurrencyShort(s.p1Revenue)} บาท\n* ยอดขาย UP P1: ${formatCurrencyShort(s.upP1Revenue)} บาท\n* ยอดขาย UP P2: ${formatCurrencyShort(s.upP2Revenue)} บาท\n`;
    t += `* 5 หมวดหมู่รายได้สูงสุด: ${top5Total.map(c => c.name).join(', ')}\n`;
    t += `* 5 หมวดหมู่ P1 ขายดี: ${top5P1.map(c => c.name).join(', ')}\n`;
    t += `* 5 หมวดหมู่ UP P1 ขายดี: ${top5UpP1.map(c => c.name).join(', ')}\n\n`;
    
    t += `--- [สรุปประสิทธิภาพตามช่องทาง] ---\n`;
    Object.keys(latestChannelBreakdown).forEach(ch => {
        const d = latestChannelBreakdown[ch];
        t += `* ${ch}:\n  - จำนวนบิล P1: ${formatNumber(d.p1)}\n  - P2 Leads: ${formatNumber(d.p2)}\n  - จำนวนบิล UP P2: ${formatNumber(d.upP2)}\n  - ยอดขาย: ${formatCurrencyShort(d.revenue)} บาท\n`;
    });
    return t;
}

// ================================================================
// 8. POPUPS & MODALS
// ================================================================
function showChannelDetailsPopup(channelName, metricType) {
    const transactions = latestFilteredSalesRows.filter(r => r['ช่องทาง'] === channelName);
    let filtered = transactions;
    if (metricType === 'P1_BILLS') filtered = transactions.filter(r => toNumber(r['P1']) > 0);
    else if (metricType === 'P2_LEADS') filtered = transactions.filter(r => r['P2']);
    else if (metricType === 'UP_P2_BILLS') filtered = transactions.filter(r => toNumber(r['ยอดอัพ P2']) > 0);
    else if (metricType === 'NEW_CUSTOMERS') filtered = transactions.filter(r => isNewCustomer(r));

    renderTableModal(`Channel: ${channelName} (${metricType})`, filtered);
}

function showCategoryDetailsPopup(catName, filterType) {
    const catData = latestCategoryDetails.find(c => c.name === catName);
    if (!catData) return;
    let filtered = catData.transactions;
    if (filterType === 'P1') filtered = catData.transactions.filter(r => toNumber(r['P1']) > 0);
    else if (filterType === 'UP_P1') filtered = catData.transactions.filter(r => toNumber(r['ยอดอัพ P1']) > 0);
    else if (filterType === 'UP_P2') filtered = catData.transactions.filter(r => toNumber(r['ยอดอัพ P2']) > 0);

    renderTableModal(`Category: ${catName}`, filtered);
}

function renderTableModal(title, rows) {
    ui.modalTitle.textContent = title;
    ui.modalBody.innerHTML = `
        <div class="top-categories-table">
            <table>
                <thead><tr><th>วันที่</th><th>ชื่อลูกค้า</th><th>หมวดหมู่</th><th>ยอดรวม</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${new Date(parseGvizDate(r['วันที่'])).toLocaleDateString('th-TH')}</td>
                    <td>${r['ชื่อลูกค้า'] || '-'}</td>
                    <td>${r['หมวดหมู่'] || '-'}</td>
                    <td class="revenue-cell">${formatCurrency(toNumber(r['P1'])+toNumber(r['ยอดอัพ P1'])+toNumber(r['ยอดอัพ P2']))}</td>
                </tr>`).join('')}</tbody>
            </table>
        </div>`;
    ui.modalBody.className = "modal-body table-view";
    ui.modal.classList.add('show');
}

// ================================================================
// 9. CORE (OTHER FUNCTIONS SAME AS ORIGINAL)
// ================================================================
// ฟังก์ชัน renderFunnelOverview, renderAdsOverview, renderSalesOverview, etc. ให้ใช้ code เดิมจากที่คุณมี
// (ข้ามส่วนที่ซ้ำซ้อนเพื่อให้ประหยัดพื้นที่ แต่ในไฟล์จริงต้องมีครบ)

async function main() {
    ui.loading.classList.add('show');
    try {
        const ads = await fetchAdsData(ui.startDate.value, ui.endDate.value);
        const allSales = await fetchSalesData();
        const sales = processSalesDataForPeriod(allSales, new Date(ui.startDate.value), new Date(ui.endDate.value));

        latestSalesSummary = sales.summary;
        latestChannelBreakdown = sales.channelBreakdown;
        latestCategoryDetails = sales.categoryDetails;
        latestFilteredSalesRows = sales.filteredRows;

        renderChannelTable(sales.channelBreakdown);
        renderCategoryDetailTable(sales.categoryDetails);
        // ... call other renderers ...
    } catch (e) { showError(e.message); }
    ui.loading.classList.remove('show');
}

// Listeners
document.addEventListener('DOMContentLoaded', () => {
    ui.refreshBtn.onclick = main;
    ui.aiSummaryBtn.onclick = () => {
        ui.aiModalBody.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit;">${generateAiSummaryText()}</pre>`;
        ui.aiModal.classList.add('show');
    };
    ui.aiModalClose.onclick = () => ui.aiModal.classList.remove('show');
    ui.modalCloseBtn.onclick = () => ui.modal.classList.remove('show');
    ui.copyAiText.onclick = () => {
        navigator.clipboard.writeText(generateAiSummaryText());
        ui.copyAiText.textContent = "คัดลอกแล้ว!";
        setTimeout(() => ui.copyAiText.textContent = "คัดลอกข้อความ", 2000);
    };
});
