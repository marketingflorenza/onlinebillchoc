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
    // AI Elements
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
let latestSalesSummary = null; // สำหรับ AI
let latestChannelBreakdown = null; // สำหรับ AI
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
    if (match) {
        return new Date(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
    }
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

// ================================================================
// 5. DATA FETCHING
// ================================================================
async function fetchAdsData(startDate, endDate) {
    const since = startDate.split('-').reverse().join('-');
    const until = endDate.split('-').reverse().join('-');
    const apiUrl = `${CONFIG.API_BASE_URL}/databillChoc?since=${since}&until=${until}`;
    try {
        const response = await fetch(apiUrl);
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
        const rowRevenue = p1 + upP1 + upP2;
        if (rowRevenue > 0) {
            const categories = parseCategories(row['หมวดหมู่']);
            if (categories.length > 0) {
                const p1Portion = p1 / categories.length;
                const upP1Portion = upP1 / categories.length;
                const upP2Portion = upP2 / categories.length;
                categories.forEach(catName => {
                    if (!categoryMap[catName]) {
                        categoryMap[catName] = { name: catName, p1Revenue: 0, upP1Revenue: 0, upP2Revenue: 0, p1Bills: 0, upP1Bills: 0, upP2Bills: 0, newCustomers: 0, totalRevenue: 0, transactions: [] };
                    }
                    const category = categoryMap[catName];
                    category.p1Revenue += p1Portion;
                    category.upP1Revenue += upP1Portion;
                    category.upP2Revenue += upP2Portion;
                    category.totalRevenue += (p1Portion + upP1Portion + upP2Portion);
                    if (p1 > 0) category.p1Bills++;
                    if (upP1 > 0) category.upP1Bills++;
                    if (upP2 > 0) category.upP2Bills++;
                    if (isNewCustomer(row)) category.newCustomers++;
                    category.transactions.push(row);
                });
            }
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
        const p1 = toNumber(row['P1']);
        const upP1 = toNumber(row['ยอดอัพ P1']);
        const upP2 = toNumber(row['ยอดอัพ P2']);
        const p2 = row['P2'];
        const rowRevenue = p1 + upP1 + upP2;
        if (rowRevenue > 0) summary.totalBills++;
        if (p1 > 0) summary.p1Bills++;
        if (upP1 > 0) summary.upP1Bills++;
        if (upP2 > 0) summary.upP2Bills++;
        if (p2 !== null && p2 !== '') summary.p2Leads++;
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
    const linkedRows = linkP1AndUpP1(filteredRows);
    const upsellPaths = calculateUpsellPaths(linkedRows);
    const categoryDetails = calculateCategoryDetails(filteredRows);
    return { summary, categoryDetails, filteredRows, channelBreakdown, upsellPaths };
}

// ================================================================
// 7. AI SUMMARY LOGIC
// ================================================================
function generateAiSummaryText() {
    if (!latestSalesSummary) return "กรุณารอให้ข้อมูลโหลดเสร็จก่อน...";
    
    const s = latestSalesSummary;
    const startDate = ui.startDate.value;
    const endDate = ui.endDate.value;
    const top5Revenue = [...latestCategoryDetails].sort((a,b) => b.totalRevenue - a.totalRevenue).slice(0, 5);
    const top5P1 = [...latestCategoryDetails].sort((a,b) => b.p1Revenue - a.p1Revenue).slice(0, 5);
    const top5UpP1 = [...latestCategoryDetails].sort((a,b) => b.upP1Revenue - a.upP1Revenue).slice(0, 5);

    let text = `* สาขา: Online Choc\n`;
    text += `* ช่วงเวลาปัจจุบัน: ${startDate} ถึง ${endDate}\n\n`;
    text += `--- [ข้อมูลช่วงเวลาปัจจุบัน] ---\n`;
    text += `* ยอดขายรวม: ${formatCurrencyShort(s.totalRevenue)} บาท\n`;
    text += `* จำนวนบิลทั้งหมด: ${formatNumber(s.totalBills)} บิล\n`;
    text += `* ยอดขาย P1: ${formatCurrencyShort(s.p1Revenue)} บาท\n`;
    text += `* ยอดขาย UP P1: ${formatCurrencyShort(s.upP1Revenue)} บาท\n`;
    text += `* ยอดขาย UP P2: ${formatCurrencyShort(s.upP2Revenue)} บาท\n`;
    text += `* 5 หมวดหมู่ที่ทำรายได้สูงสุด:\n${top5Revenue.map(c => `  - ${c.name}: ${formatCurrencyShort(c.totalRevenue)}`).join('\n')}\n`;
    text += `* 5 หมวดหมู่ P1 ขายดีที่สุด:\n${top5P1.map(c => `  - ${c.name}: ${formatCurrencyShort(c.p1Revenue)}`).join('\n')}\n`;
    text += `* 5 หมวดหมู่ UP P1 ขายดีที่สุด:\n${top5UpP1.map(c => `  - ${c.name}: ${formatCurrencyShort(c.upP1Revenue)}`).join('\n')}\n\n`;
    
    text += `--- [สรุปประสิทธิภาพตามช่องทาง] ---\n`;
    Object.keys(latestChannelBreakdown).sort((a,b) => latestChannelBreakdown[b].revenue - latestChannelBreakdown[a].revenue).forEach(ch => {
        const d = latestChannelBreakdown[ch];
        text += `* ${ch}:\n`;
        text += `  - จำนวนบิล P1: ${formatNumber(d.p1)}\n`;
        text += `  - P2 Leads: ${formatNumber(d.p2)}\n`;
        text += `  - จำนวนบิล UP P2: ${formatNumber(d.upP2)}\n`;
        text += `  - ลูกค้าใหม่: ${formatNumber(d.newCustomers)}\n`;
        text += `  - ยอดขาย: ${formatCurrencyShort(d.revenue)} บาท\n`;
    });
    return text;
}

// ================================================================
// 8. RENDERING FUNCTIONS (KEEP ORIGINAL)
// ================================================================
function renderFunnelOverview(adsTotals, salesSummary, comparisonAdsTotals = null, comparisonSalesSummary = null) {
    const createStatCard = (label, currentVal, prevVal, isCurrency = false, isROAS = false) => {
        const displayVal = isROAS ? `${currentVal.toFixed(2)}x` : (isCurrency ? formatCurrency(currentVal) : formatNumber(currentVal));
        let comparisonHtml = '';
        if (comparisonAdsTotals || comparisonSalesSummary) {
            const growth = calculateGrowth(currentVal, prevVal);
            const prevDisplay = isROAS ? `${prevVal.toFixed(2)}x` : (isCurrency ? formatCurrency(prevVal) : formatNumber(prevVal));
            comparisonHtml = `<span class="growth-indicator ${growth.class}">${growth.percent}</span><div class="stat-comparison">vs ${prevDisplay}</div>`;
        }
        return `<div class="stat-card"><div class="stat-number"><span>${displayVal}</span>${comparisonHtml}</div><div class="stat-label">${label}</div></div>`;
    };
    const spend = adsTotals.spend || 0;
    const revenue = salesSummary.totalRevenue || 0;
    const roas = spend > 0 ? revenue / spend : 0;
    const newCustomers = salesSummary.newCustomers || 0;
    const cpa = newCustomers > 0 ? spend / newCustomers : 0;
    const prevSpend = comparisonAdsTotals?.spend || 0;
    const prevRevenue = comparisonSalesSummary?.summary.totalRevenue || 0;
    const prevRoas = prevSpend > 0 ? prevRevenue / prevSpend : 0;
    const prevNewCustomers = comparisonSalesSummary?.summary.newCustomers || 0;
    const prevCpa = prevNewCustomers > 0 ? prevSpend / prevNewCustomers : 0;

    ui.funnelStatsGrid.innerHTML = [
        createStatCard('Ad Spend', spend, prevSpend, true),
        createStatCard('Total Revenue', revenue, prevRevenue, true),
        createStatCard('ROAS', roas, prevRoas, false, true),
        createStatCard('Purchases', adsTotals.purchases, comparisonAdsTotals?.purchases || 0),
        createStatCard('Cost Per Acquisition', cpa, prevCpa, true),
    ].join('');
}

function renderAdsOverview(totals) {
    const createStatCard = (label, value) => `<div class="stat-card"><div class="stat-number">${value}</div><div class="stat-label">${label}</div></div>`;
    ui.adsStatsGrid.innerHTML = [
        createStatCard('Impressions', formatNumber(totals.impressions)),
        createStatCard('Messaging Started', formatNumber(totals.messaging_conversations)),
        createStatCard('Avg. CPM', formatCurrency(totals.cpm)),
        createStatCard('Avg. CTR', `${parseFloat(totals.ctr || 0).toFixed(2)}%`)
    ].join('');
}

function renderSalesOverview(summary, comparisonSummary = null) {
    const createStatCard = (label, currentVal, prevVal, isCurrency = false) => {
        const displayVal = isCurrency ? formatCurrency(currentVal) : formatNumber(currentVal);
        let comparisonHtml = '';
        if (comparisonSummary) {
            const growth = calculateGrowth(currentVal, prevVal);
            const prevDisplay = isCurrency ? formatCurrency(prevVal) : formatNumber(prevVal);
            comparisonHtml = `<span class="growth-indicator ${growth.class}">${growth.percent}</span><div class="stat-comparison">vs ${prevDisplay}</div>`;
        }
        return `<div class="stat-card"><div class="stat-number"><span>${displayVal}</span>${comparisonHtml}</div><div class="stat-label">${label}</div></div>`;
    };
    ui.salesOverviewStatsGrid.innerHTML = [
        createStatCard('Total Bills', summary.totalBills, comparisonSummary?.totalBills || 0),
        createStatCard('Total Sales Revenue', summary.totalRevenue, comparisonSummary?.totalRevenue || 0, true),
        createStatCard('Total Customers', summary.totalCustomers, comparisonSummary?.totalCustomers || 0),
        createStatCard('New Customers', summary.newCustomers, comparisonSummary?.newCustomers || 0),
    ].join('');
}

function renderSalesRevenueBreakdown(summary, comparisonSummary = null) {
    const createStatCard = (label, currentVal, prevVal) => {
        const displayVal = formatCurrency(currentVal);
        let comparisonHtml = '';
        if (comparisonSummary) {
            const growth = calculateGrowth(currentVal, prevVal);
            const prevDisplay = formatCurrency(prevVal);
            comparisonHtml = `<span class="growth-indicator ${growth.class}">${growth.percent}</span><div class="stat-comparison">vs ${prevDisplay}</div>`;
        }
        return `<div class="stat-card"><div class="stat-number"><span>${displayVal}</span>${comparisonHtml}</div><div class="stat-label">${label}</div></div>`;
    };
    ui.salesRevenueStatsGrid.innerHTML = [
        createStatCard('P1 Revenue', summary.p1Revenue, comparisonSummary?.p1Revenue || 0),
        createStatCard('UP P1 Revenue', summary.upP1Revenue, comparisonSummary?.upP1Revenue || 0),
        createStatCard('UP P2 Revenue', summary.upP2Revenue, comparisonSummary?.upP2Revenue || 0),
    ].join('');
    charts.revenue.data.datasets[0].data = [summary.p1Revenue, summary.upP1Revenue, summary.upP2Revenue];
    charts.customer.data.datasets[0].data = [summary.newCustomers, summary.oldCustomers];
    charts.revenue.update();
    charts.customer.update();
}

function renderSalesBillStats(summary, comparisonSummary = null) {
    const createStatCard = (label, currentVal, prevVal, isRate = false) => {
        const displayVal = isRate ? `${currentVal.toFixed(1)}%` : formatNumber(currentVal);
        let comparisonHtml = '';
        if (comparisonSummary) {
            const growth = calculateGrowth(currentVal, prevVal);
            const prevDisplay = isRate ? `${prevVal.toFixed(1)}%` : formatNumber(prevVal);
            comparisonHtml = `<span class="growth-indicator ${growth.class}">${growth.percent}</span><div class="stat-comparison">vs ${prevDisplay}</div>`;
        }
         return `<div class="stat-card"><div class="stat-number"><span>${displayVal}</span>${comparisonHtml}</div><div class="stat-label">${label}</div></div>`;
    };
    const p1ToUpP1Rate = summary.p1Bills > 0 ? (summary.upP1Bills / summary.p1Bills) * 100 : 0;
    const p2ConversionRate = summary.p2Leads > 0 ? (summary.upP2Bills / summary.p2Leads) * 100 : 0;
    let prevP1ToUpP1Rate = 0, prevP2ConversionRate = 0;
    if(comparisonSummary){
        prevP1ToUpP1Rate = comparisonSummary.p1Bills > 0 ? (comparisonSummary.upP1Bills / comparisonSummary.p1Bills) * 100 : 0;
        prevP2ConversionRate = comparisonSummary.p2Leads > 0 ? (comparisonSummary.upP2Bills / comparisonSummary.p2Leads) * 100 : 0;
    }
    ui.salesBillStatsGrid.innerHTML = [
        createStatCard('P1 Bills', summary.p1Bills, comparisonSummary?.p1Bills || 0),
        createStatCard('P2 Leads', summary.p2Leads, comparisonSummary?.p2Leads || 0),
        createStatCard('UP P1 Bills', summary.upP1Bills, comparisonSummary?.upP1Bills || 0),
        createStatCard('UP P2 Bills', summary.upP2Bills, comparisonSummary?.upP2Bills || 0),
        createStatCard('P1 → UP P1 Rate', p1ToUpP1Rate, prevP1ToUpP1Rate, true),
        createStatCard('P2 Conversion Rate', p2ConversionRate, prevP2ConversionRate, true),
    ].join('');
}

function renderChannelTable(channelData) {
    const tableBody = ui.channelTableBody;
    if (!channelData || Object.keys(channelData).length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">ไม่พบข้อมูลช่องทาง</td></tr>`;
        return;
    }
    const sortedChannels = Object.keys(channelData).sort((a, b) => (channelData[b].revenue || 0) - (channelData[a].revenue || 0));
    let tableHtml = sortedChannels.map(channel => {
        const data = channelData[channel];
        return `<tr>
            <td><strong>${channel}</strong></td>
            <td>${formatNumber(data.p1)}</td>
            <td>${formatNumber(data.p2)}</td>
            <td>${formatNumber(data.upP2)}</td>
            <td>${formatNumber(data.newCustomers)}</td>
            <td class="revenue-cell">${formatCurrencyShort(data.revenue)}</td>
        </tr>`;
    }).join('');
    tableBody.innerHTML = tableHtml;
}

function renderCampaignsTable(campaigns) {
    if (!campaigns || campaigns.length === 0) {
        ui.campaignsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No campaign data found</td></tr>`;
        return;
    }
    ui.campaignsTableBody.innerHTML = campaigns.map(c => {
        const insights = c.insights || {};
        return `<tr>
            <td><a href="#" onclick="showAdDetails('${c.id}'); return false;"><strong>${c.name || 'N/A'}</strong></a></td>
            <td><span style="color:${c.status === 'ACTIVE' ? 'var(--color-positive)' : 'var(--text-secondary)'}">${c.status || 'N/A'}</span></td>
            <td class="revenue-cell">${formatCurrency(insights.spend)}</td>
            <td>${formatNumber(insights.impressions)}</td>
            <td>${formatNumber(insights.purchases)}</td>
            <td>${formatNumber(insights.messaging_conversations)}</td>
            <td>${formatCurrency(insights.cpm)}</td>
        </tr>`;
    }).join('');
}

function renderCategoryChart(categoryData) {
    const chart = charts.categoryRevenue;
    const topData = categoryData.slice(0, 15);
    chart.data.labels = topData.map(d => d.name);
    chart.data.datasets[0].data = topData.map(d => d.totalRevenue);
    chart.update();
}

function renderCategoryDetailTable(categoryDetails) {
    const rankClasses = ['gold', 'silver', 'bronze'];
    ui.categoryDetailTableBody.innerHTML = categoryDetails.map((cat, index) => `
        <tr class="clickable-row">
            <td class="rank-column"><span class="rank-badge ${index < 3 ? rankClasses[index] : ''}">${index + 1}</span></td>
            <td><strong>${cat.name}</strong></td>
            <td>${formatNumber(cat.p1Bills)}</td>
            <td>${formatNumber(cat.upP1Bills)}</td>
            <td>${formatNumber(cat.upP2Bills)}</td>
            <td>${formatNumber(cat.newCustomers)}</td>
            <td class="revenue-cell">${formatCurrency(cat.totalRevenue)}</td>
        </tr>`).join('');
}

function renderUpsellPaths(paths) {
    if (!paths || paths.length === 0) {
        ui.upsellPathsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">ไม่พบข้อมูล Upsell ในช่วงเวลานี้</td></tr>`;
        return;
    }
    const rankClasses = ['gold', 'silver', 'bronze'];
    ui.upsellPathsTableBody.innerHTML = paths.map((path, index) => `
        <tr>
            <td class="rank-column"><span class="rank-badge ${index < 3 ? rankClasses[index] : ''}">${index+1}</span></td>
            <td>${path.from}</td>
            <td>${path.to}</td>
            <td>${formatNumber(path.count)}</td>
            <td class="revenue-cell">${formatCurrency(path.totalUpP1Revenue)}</td>
            <td><button class="btn" style="padding: 4px 12px; font-size: 0.8em;" onclick="showUpsellPathDetails('${path.from} -> ${path.to}')">ดู</button></td>
        </tr>`).join('');
}

// ================================================================
// 9. MODALS & CHARTS INITIALIZATION
// ================================================================
function initializeCharts() {
    const textColor = '#e0e0e0';
    const gridColor = 'rgba(224, 224, 224, 0.1)';
    const categoryColors = ['#3B82F6', '#EC4899', '#84CC16', '#F59E0B', '#10B981', '#6366F1', '#D946EF', '#F97316', '#06B6D4', '#EAB308'].map(c => c + 'CC');
    
    charts.dailySpend = new Chart(document.getElementById('dailySpendChart').getContext('2d'), {
        type: 'line', data: { labels: [], datasets: [{ label: 'Spend (THB)', data: [], borderColor: '#00f2fe', backgroundColor: 'rgba(0, 242, 254, 0.1)', fill: true, tension: 0.3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: textColor }, grid: { color: gridColor } }, y: { beginAtZero: true, ticks: { color: textColor, callback: v => '฿' + v.toLocaleString() }, grid: { color: gridColor } } } }
    });
    charts.revenue = new Chart(document.getElementById('revenueChart').getContext('2d'), {
        type: 'bar', data: { labels: ['P1', 'UP P1', 'UP P2'], datasets: [{ label: 'Sales (THB)', data: [], backgroundColor: ['#3B82F6', '#EC4899', '#84CC16'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } }, x: { ticks: { color: textColor }, grid: { color: 'transparent' } } } }
    });
    charts.customer = new Chart(document.getElementById('customerChart').getContext('2d'), {
        type: 'doughnut', data: { labels:['New','Old'], datasets:[{ data:[], backgroundColor: ['#F59E0B', '#10B981'], borderColor: '#0d0c1d' }] },
        options: { responsive:true, maintainAspectRatio:false, plugins: { legend: { position: 'right', labels: { color: textColor } } } }
    });
    charts.categoryRevenue = new Chart(ui.categoryRevenueChart.getContext('2d'), {
        type: 'bar', data: { labels: [], datasets: [{ label: 'Revenue', data: [], backgroundColor: categoryColors }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: textColor, autoSkip: false, maxRotation: 45, minRotation: 45 } }, y: { beginAtZero: true, ticks: { color: textColor, callback: v => '฿' + (v / 1000) + 'K' } } } }
    });
}

function initializeModals() {
    const closeMain = () => ui.modal.classList.remove('show');
    ui.modalCloseBtn.addEventListener('click', closeMain);
    ui.modal.addEventListener('click', (e) => { if (e.target === ui.modal) closeMain(); });
    
    ui.aiModalClose.addEventListener('click', () => ui.aiModal.classList.remove('show'));
    ui.aiModal.addEventListener('click', (e) => { if (e.target === ui.aiModal) ui.aiModal.classList.remove('show'); });
}

// ================================================================
// 10. MAIN APP LOGIC
// ================================================================
async function main() {
    ui.loading.classList.add('show');
    hideError();
    try {
        const startDateStr = ui.startDate.value;
        const endDateStr = ui.endDate.value;
        const isCompareMode = ui.compareToggle.checked;
        const fetchPromises = [fetchAdsData(startDateStr, endDateStr), fetchSalesData()];
        if (isCompareMode) fetchPromises.push(fetchAdsData(ui.compareStartDate.value, ui.compareEndDate.value));
        
        const results = await Promise.all(fetchPromises);
        const adsResponse = results[0];
        const allSalesRows = results[1];
        const comparisonAdsResponse = isCompareMode ? results[2] : null;

        const currentStartDate = new Date(startDateStr + 'T00:00:00');
        const currentEndDate = new Date(endDateStr + 'T23:59:59');
        const salesData = processSalesDataForPeriod(allSalesRows, currentStartDate, currentEndDate);
        
        // Save to Global State for AI
        latestSalesSummary = salesData.summary;
        latestChannelBreakdown = salesData.channelBreakdown;
        latestCategoryDetails = salesData.categoryDetails;
        latestUpsellPaths = salesData.upsellPaths;
        latestFilteredSalesRows = salesData.filteredRows;

        if (adsResponse.success) {
            latestCampaignData = adsResponse.data.campaigns;
            let comparisonSalesData = null;
            if (isCompareMode && comparisonAdsResponse?.success) {
                comparisonSalesData = processSalesDataForPeriod(allSalesRows, new Date(ui.compareStartDate.value), new Date(ui.compareEndDate.value));
            }
            renderFunnelOverview(adsResponse.totals, salesData.summary, comparisonAdsResponse?.totals, comparisonSalesData);
            renderAdsOverview(adsResponse.totals);
            renderSalesOverview(salesData.summary, comparisonSalesData?.summary);
            renderSalesRevenueBreakdown(salesData.summary, comparisonSalesData?.summary);
            renderSalesBillStats(salesData.summary, comparisonSalesData?.summary);
            renderChannelTable(salesData.channelBreakdown);
            renderCampaignsTable(latestCampaignData);
            renderCategoryChart(salesData.categoryDetails);
            renderCategoryDetailTable(salesData.categoryDetails);
            renderUpsellPaths(salesData.upsellPaths);
            charts.dailySpend.data.labels = adsResponse.data.dailySpend.map(d => `${new Date(d.date).getDate()}/${new Date(d.date).getMonth() + 1}`);
            charts.dailySpend.data.datasets[0].data = adsResponse.data.dailySpend.map(d => d.spend);
            charts.dailySpend.update();
        }
    } catch (err) {
        showError(err.message);
    } finally {
        ui.loading.classList.remove('show');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializeCharts();
    initializeModals();
    const today = new Date();
    ui.endDate.value = today.toISOString().split('T')[0];
    ui.startDate.value = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    
    main();
    ui.refreshBtn.addEventListener('click', main);
    ui.compareToggle.addEventListener('change', () => ui.compareControls.classList.toggle('show', ui.compareToggle.checked));
    
    // AI Listeners
    ui.aiSummaryBtn.addEventListener('click', () => {
        const text = generateAiSummaryText();
        ui.aiModalBody.innerHTML = `<pre style="white-space: pre-wrap; font-family: inherit;">${text}</pre>`;
        ui.aiModal.classList.add('show');
    });
    ui.copyAiText.addEventListener('click', () => {
        const text = generateAiSummaryText();
        navigator.clipboard.writeText(text).then(() => {
            ui.copyAiText.innerText = 'คัดลอกแล้ว! ✅';
            setTimeout(() => ui.copyAiText.innerText = 'คัดลอกข้อความ', 2000);
        });
    });
});
