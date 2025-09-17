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
    errorMessage: document.getElementById('errorMessage'),
    loading: document.getElementById('loading'),
    refreshBtn: document.getElementById('refreshBtn'),
    startDate: document.getElementById('startDate'),
    endDate: document.getElementById('endDate'),
    modal: document.getElementById('adDetailsModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalCloseBtn: document.querySelector('.modal-close-btn'),
};

// ================================================================
// 3. GLOBAL STATE
// ================================================================
let charts = {};
let latestCampaignData = [];

// ================================================================
// 4. HELPER FUNCTIONS
// ================================================================
function showError(message) { ui.errorMessage.innerHTML = message; ui.errorMessage.classList.add('show'); }
function hideError() { ui.errorMessage.classList.remove('show'); }
const formatCurrency = (num) => `฿${parseFloat(num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

// ================================================================
// 5. DATA FETCHING
// ================================================================
async function fetchAdsData(startDate, endDate) {
    const since = startDate.split('-').reverse().join('-');
    const until = endDate.split('-').reverse().join('-');
    const apiUrl = `${CONFIG.API_BASE_URL}/databillchoc?since=${since}&until=${until}`;
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error('Ads API error');
    return response.json();
}

async function fetchSalesData() {
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&sheet=${CONFIG.SHEET_NAME_SUMMARY}`;
    const response = await fetch(sheetUrl);
    const text = await response.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const gvizData = JSON.parse(jsonStr);
    const cols = gvizData.table.cols.map(c => c.label || c.id || '');
    return gvizData.table.rows.map(r => {
        const obj = {};
        cols.forEach((col, i) => obj[col] = r.c && r.c[i] ? r.c[i].v : null);
        return obj;
    });
}

// ================================================================
// 6. DATA PROCESSING
// ================================================================
function processSalesDataForPeriod(allSalesRows, startDate, endDate) {
    const filteredRows = allSalesRows.filter(row => {
        const d = parseGvizDate(row['วันที่']);
        return d && d >= startDate && d <= endDate;
    });
    
    const summary = { totalBills: 0, totalCustomers: 0, totalRevenue: 0, newCustomers: 0, oldCustomers: 0, p1Revenue: 0, upP1Revenue: 0, upP2Revenue: 0, p1Bills: 0, p2Leads: 0, upP1Bills: 0, upP2Bills: 0 };
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

        const isNew = String(row['ลูกค้าใหม่'] || '').trim().toLowerCase() === 'true' || String(row['ลูกค้าใหม่'] || '').trim() === '✔' || String(row['ลูกค้าใหม่'] || '').trim() === '1';
        if (isNew) {
            summary.newCustomers++;
        } else if (rowRevenue > 0) {
            summary.oldCustomers++;
        }
    });
    summary.totalCustomers = summary.newCustomers + summary.oldCustomers;
    return { summary };
}

// ================================================================
// 7. RENDERING & POPUP FUNCTIONS
// ================================================================
function renderFunnelOverview(adsTotals, salesSummary) {
    const createStatCard = (label, value) => `<div class="stat-card"><div class="stat-number"><span>${value}</span></div><div class="stat-label">${label}</div></div>`;
    const spend = adsTotals.spend || 0;
    const revenue = salesSummary.totalRevenue || 0;
    const newCustomers = salesSummary.newCustomers || 0;
    const roas = spend > 0 ? revenue / spend : 0;
    const cpa = newCustomers > 0 ? spend / newCustomers : 0;
    ui.funnelStatsGrid.innerHTML = [
        createStatCard('Ad Spend', formatCurrency(spend)),
        createStatCard('Total Revenue', formatCurrency(revenue)),
        createStatCard('ROAS', `${roas.toFixed(2)}x`),
        createStatCard('Purchases', formatNumber(adsTotals.purchases)),
        createStatCard('Cost Per Acquisition', formatCurrency(cpa)),
    ].join('');
}

function renderAdsOverview(totals) {
    const createStatCard = (label, value) => `<div class="stat-card"><div class="stat-number"><span>${value}</span></div><div class="stat-label">${label}</div></div>`;
    ui.adsStatsGrid.innerHTML = [
        createStatCard('Impressions', formatNumber(totals.impressions)),
        createStatCard('Messaging Started', formatNumber(totals.messaging_conversations)),
        createStatCard('Avg. CPM', formatCurrency(totals.cpm)),
        createStatCard('Avg. CTR', `${parseFloat(totals.ctr || 0).toFixed(2)}%`)
    ].join('');
}

function renderSalesOverview(summary) {
    const createStatCard = (label, value) => `<div class="stat-card"><div class="stat-number"><span>${value}</span></div><div class="stat-label">${label}</div></div>`;
    ui.salesOverviewStatsGrid.innerHTML = [
        createStatCard('Total Bills', formatNumber(summary.totalBills)),
        createStatCard('Total Sales Revenue', formatCurrency(summary.totalRevenue)),
        createStatCard('Total Customers', formatNumber(summary.totalCustomers)),
        createStatCard('New Customers', formatNumber(summary.newCustomers)),
    ].join('');
}

function renderSalesRevenueBreakdown(summary) {
    const createStatCard = (label, value) => `<div class="stat-card"><div class="stat-number"><span>${value}</span></div><div class="stat-label">${label}</div></div>`;
    ui.salesRevenueStatsGrid.innerHTML = [
        createStatCard('P1 Revenue', formatCurrency(summary.p1Revenue)),
        createStatCard('UP P1 Revenue', formatCurrency(summary.upP1Revenue)),
        createStatCard('UP P2 Revenue', formatCurrency(summary.upP2Revenue)),
    ].join('');
    charts.revenue.data.datasets[0].data = [summary.p1Revenue, summary.upP1Revenue, summary.upP2Revenue];
    charts.customer.data.datasets[0].data = [summary.newCustomers, summary.oldCustomers];
    charts.revenue.update();
    charts.customer.update();
}

function renderSalesBillStats(summary) {
    const createStatCard = (label, value) => `<div class="stat-card"><div class="stat-number"><span>${value}</span></div><div class="stat-label">${label}</div></div>`;
    const p1ToUpP1Rate = summary.p1Bills > 0 ? (summary.upP1Bills / summary.p1Bills) * 100 : 0;
    const p2ConversionRate = summary.p2Leads > 0 ? (summary.upP2Bills / summary.p2Leads) * 100 : 0;
    ui.salesBillStatsGrid.innerHTML = [
        createStatCard('P1 Bills', formatNumber(summary.p1Bills)),
        createStatCard('P2 Leads', formatNumber(summary.p2Leads)),
        createStatCard('UP P1 Bills', formatNumber(summary.upP1Bills)),
        createStatCard('UP P2 Bills', formatNumber(summary.upP2Bills)),
        createStatCard('P1 → UP P1 Rate', `${p1ToUpP1Rate.toFixed(1)}%`),
        createStatCard('P2 Conversion Rate', `${p2ConversionRate.toFixed(1)}%`),
    ].join('');
}

function renderCampaignsTable(campaigns) {
    if (!campaigns || campaigns.length === 0) {
        ui.campaignsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No campaign data</td></tr>`;
        return;
    }
    ui.campaignsTableBody.innerHTML = campaigns
        .sort((a, b) => parseFloat(b.insights?.spend || 0) - parseFloat(a.insights?.spend || 0))
        .map(c => {
            const insights = c.insights || {};
            return `
                <tr>
                    <td><a href="#" onclick="showAdDetails('${c.id}'); return false;"><strong>${c.name || 'N/A'}</strong></a></td>
                    <td><span style="color:${c.status === 'ACTIVE' ? '#34d399' : '#a0a0b0'}">${c.status || 'N/A'}</span></td>
                    <td class="revenue-cell">${formatCurrency(c.insights?.spend)}</td>
                    <td>${formatNumber(c.insights?.impressions)}</td>
                    <td>${formatNumber(c.insights?.purchases)}</td>
                    <td>${formatNumber(c.insights?.messaging_conversations)}</td>
                </tr>
            `;
        }).join('');
}

function renderDailySpendChart(dailySpendData) {
    const chart = charts.dailySpend;
    if (!dailySpendData || dailySpendData.length === 0) {
        chart.data.labels = []; chart.data.datasets[0].data = [];
    } else {
        chart.data.labels = dailySpendData.map(d => `${new Date(d.date).getDate()}/${new Date(d.date).getMonth() + 1}`);
        chart.data.datasets[0].data = dailySpendData.map(d => d.spend);
    }
    chart.update();
}

function showAdDetails(campaignId) {
    const campaign = latestCampaignData.find(c => c.id === campaignId);
    if (!campaign) return;
    ui.modalTitle.textContent = `Ads in: ${campaign.name}`;
    if (!campaign.ads || campaign.ads.length === 0) {
        ui.modalBody.innerHTML = `<p style="text-align: center;">No ads found for this campaign.</p>`;
    } else {
        ui.modalBody.innerHTML = campaign.ads
            .sort((a,b) => b.insights.purchases - a.insights.purchases)
            .map(ad => `
            <div class="ad-card">
                <div class="ad-card-image">
                    <img src="${ad.thumbnail_url}" alt="Ad thumbnail">
                </div>
                <div class="ad-card-details">
                    <h4>${ad.name}</h4>
                    <div class="ad-card-stats">
                        <div>Spend: <span>${formatCurrency(ad.insights.spend)}</span></div>
                        <div>Impressions: <span>${formatNumber(ad.insights.impressions)}</span></div>
                        <div>Purchases: <span>${formatNumber(ad.insights.purchases)}</span></div>
                        <div>Messaging Started: <span>${formatNumber(ad.insights.messaging_conversations)}</span></div>
                    </div>
                </div>
            </div>
        `).join('');
    }
    ui.modal.classList.add('show');
}

function initializeModal() {
    const closeModal = () => ui.modal.classList.remove('show');
    ui.modalCloseBtn.addEventListener('click', closeModal);
    ui.modal.addEventListener('click', (event) => {
        if (event.target === ui.modal) closeModal();
    });
}

function initializeCharts() {
    const textColor = '#e0e0e0';
    const gridColor = 'rgba(224, 224, 224, 0.1)';
    
    charts.dailySpend = new Chart(document.getElementById('dailySpendChart').getContext('2d'), {
        type: 'line', data: { labels: [], datasets: [{ label: 'Spend (THB)', data: [], borderColor: '#00f2fe', backgroundColor: 'rgba(0, 242, 254, 0.1)', fill: true, tension: 0.3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: textColor }, grid: { color: gridColor } }, y: { beginAtZero: true, ticks: { color: textColor, callback: v => '฿' + v.toLocaleString() }, grid: { color: gridColor } } } }
    });

    charts.revenue = new Chart(document.getElementById('revenueChart').getContext('2d'), {
        type: 'bar', data: { labels: ['P1', 'UP P1', 'UP P2'], datasets: [{ label: 'Sales (THB)', data: [], backgroundColor: ['#3B82F6', '#EC4899', '#84CC16'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } }, x: { ticks: { color: textColor }, grid: { color: 'transparent' } } } }
    });

    charts.customer = new Chart(document.getElementById('customerChart').getContext('2d'), {
        type: 'doughnut', data: { labels:['New Customers','Old Customers'], datasets:[{ data:[], backgroundColor: ['#F59E0B', '#10B981'], borderColor: '#0d0c1d' }] },
        options: { responsive:true, maintainAspectRatio:false, plugins: { legend: { position: 'right', labels: { color: textColor } } } }
    });
}

// ================================================================
// 8. MAIN LOGIC & EVENT LISTENERS
// ================================================================
async function main() {
    ui.loading.classList.add('show');
    hideError();
    try {
        const startDate = ui.startDate.value;
        const endDate = ui.endDate.value;
        
        const [adsResponse, allSalesRows] = await Promise.all([
            fetchAdsData(startDate, endDate),
            fetchSalesData()
        ]);

        if (adsResponse.success) {
            latestCampaignData = adsResponse.data.campaigns;
            const salesData = processSalesDataForPeriod(allSalesRows, new Date(startDate + 'T00:00:00'), new Date(endDate + 'T23:59:59'));
            
            renderFunnelOverview(adsResponse.totals, salesData.summary);
            renderAdsOverview(adsResponse.totals);
            renderSalesOverview(salesData.summary);
            renderSalesRevenueBreakdown(salesData.summary);
            renderSalesBillStats(salesData.summary);
            renderCampaignsTable(adsResponse.data.campaigns);
            renderDailySpendChart(adsResponse.data.dailySpend);
        } else {
            throw new Error(adsResponse.error || 'Unknown API error');
        }

    } catch (err) {
        showError(`Error: ${err.message}`);
        console.error(err);
    } finally {
        ui.loading.classList.remove('show');
    }
}

function setDefaultDates() {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 29);
    
    const toInputFormat = (date) => date.toISOString().split('T')[0];
    ui.endDate.value = toInputFormat(today);
    ui.startDate.value = toInputFormat(thirtyDaysAgo);
    
    const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    const firstDayLastMonth = new Date(lastDayLastMonth.getFullYear(), lastDayLastMonth.getMonth(), 1);
    // These elements might not exist in the final HTML, handle gracefully
    if (ui.compareEndDate) ui.compareEndDate.value = toInputFormat(lastDayLastMonth);
    if (ui.compareStartDate) ui.compareStartDate.value = toInputFormat(firstDayLastMonth);
}

document.addEventListener('DOMContentLoaded', () => {
    initializeCharts();
    initializeModal();
    setDefaultDates();
    main();

    ui.refreshBtn.addEventListener('click', main);
    ui.startDate.addEventListener('change', main);
    ui.endDate.addEventListener('change', main);
    // These elements might not exist, handle gracefully
    if (ui.compareToggle) {
        const inputs = [ui.compareStartDate, ui.compareEndDate, ui.compareToggle];
        inputs.forEach(input => input.addEventListener('change', main));
        ui.compareToggle.addEventListener('change', () => {
            ui.compareControls.classList.toggle('show', ui.compareToggle.checked);
        });
    }
});