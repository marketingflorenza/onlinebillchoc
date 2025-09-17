// ================================================================
// 1. CONFIGURATION
// ================================================================
const CONFIG = {
    API_BASE_URL: 'https://backend-api-choc88.vercel.app/api',
    SHEET_ID: '1F2bTvP1ySUT1q6fzRPQu7UpKNW_ze8GtKkd2rmRUjkI',
    SHEET_NAME_SUMMARY: 'SUM',
};

// ================================================================
// 2. UI ELEMENTS (Cleaned up to match final HTML)
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
    modal: document.getElementById('adDetailsModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalCloseBtn: document.querySelector('.modal-close-btn'),
    campaignSearchInput: document.getElementById('campaignSearchInput'),
    adSearchInput: document.getElementById('adSearchInput'),
    categoryRevenueChart: document.getElementById('categoryRevenueChart'),
    categoryDetailTableBody: document.getElementById('categoryDetailTableBody'),
};

// ================================================================
// 3. GLOBAL STATE
// ================================================================
let charts = {};
let latestCampaignData = [];
let latestCategoryDetails = [];
let currentPopupAds = [];
let currentSort = { key: 'spend', direction: 'desc' };

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

function parseCategories(categoryStr) {
    if (!categoryStr || typeof categoryStr !== 'string') return [];
    return categoryStr.split(',').map(c => c.trim()).filter(Boolean);
}

// START: Helper to check if a customer is new
const isNewCustomer = (row) => String(row['ลูกค้าใหม่'] || '').trim().toLowerCase() === 'true' || String(row['ลูกค้าใหม่'] || '').trim() === '✔' || String(row['ลูกค้าใหม่'] || '').trim() === '1';
// END: Helper

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
                        categoryMap[catName] = {
                            name: catName,
                            p1Revenue: 0, upP1Revenue: 0, upP2Revenue: 0,
                            p1Bills: 0, upP1Bills: 0, upP2Bills: 0,
                            newCustomers: 0, totalRevenue: 0,
                            transactions: []
                        };
                    }
                    const category = categoryMap[catName];
                    category.p1Revenue += p1Portion;
                    category.upP1Revenue += upP1Portion;
                    category.upP2Revenue += upP2Portion;
                    category.totalRevenue += (p1Portion + upP1Portion + upP2Portion);

                    if (p1 > 0) category.p1Bills++;
                    if (upP1 > 0) category.upP1Bills++;
                    if (upP2 > 0) category.upP2Bills++;
                    if (isNewCustomer(row)) {
                        category.newCustomers++;
                    }
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
        
        if (isNewCustomer(row)) {
            summary.newCustomers++;
        } else if (rowRevenue > 0) {
            summary.oldCustomers++;
        }
    });
    summary.totalCustomers = summary.newCustomers + summary.oldCustomers;
    
    const categoryDetails = calculateCategoryDetails(filteredRows);
    return { summary, categoryDetails };
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
        ui.campaignsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;">No campaign data found</td></tr>`;
        return;
    }
    ui.campaignsTableBody.innerHTML = campaigns.map(c => {
            const insights = c.insights || {};
            return `
                <tr>
                    <td><a href="#" onclick="showAdDetails('${c.id}'); return false;"><strong>${c.name || 'N/A'}</strong></a></td>
                    <td><span style="color:${c.status === 'ACTIVE' ? '#34d399' : '#a0a0b0'}">${c.status || 'N/A'}</span></td>
                    <td class="revenue-cell">${formatCurrency(insights.spend)}</td>
                    <td>${formatNumber(insights.impressions)}</td>
                    <td>${formatNumber(insights.purchases)}</td>
                    <td>${formatNumber(insights.messaging_conversations)}</td>
                    <td>${formatCurrency(insights.cpm)}</td>
                </tr>
            `;
        }).join('');
}

function renderCategoryChart(categoryData) {
    const chart = charts.categoryRevenue;
    const topData = categoryData.slice(0, 15);

    chart.data.labels = topData.map(d => d.name);
    chart.data.datasets[0].data = topData.map(d => d.totalRevenue);
    chart.update();
}

// START: Updated function to render table with clickable cells
function renderCategoryDetailTable(categoryDetails) {
    const rankClasses = ['gold', 'silver', 'bronze'];
    ui.categoryDetailTableBody.innerHTML = categoryDetails.map((cat, index) => `
        <tr>
            <td class="rank-column"><span class="rank-badge ${index < 3 ? rankClasses[index] : ''}">${index + 1}</span></td>
            <td><strong>${cat.name}</strong></td>
            <td><span class="clickable-cell" onclick="showCategoryDetailsPopup('${cat.name}', 'P1')">${formatNumber(cat.p1Bills)}</span></td>
            <td><span class="clickable-cell" onclick="showCategoryDetailsPopup('${cat.name}', 'UP_P1')">${formatNumber(cat.upP1Bills)}</span></td>
            <td><span class="clickable-cell" onclick="showCategoryDetailsPopup('${cat.name}', 'UP_P2')">${formatNumber(cat.upP2Bills)}</span></td>
            <td><span class="clickable-cell" onclick="showCategoryDetailsPopup('${cat.name}', 'NEW_CUSTOMER')">${formatNumber(cat.newCustomers)}</span></td>
            <td class="revenue-cell">${formatCurrency(cat.totalRevenue)}</td>
        </tr>
    `).join('');
}
// END: Updated function

// START: Updated popup function to filter transactions
function showCategoryDetailsPopup(categoryName, filterType = 'ALL') {
    const categoryData = latestCategoryDetails.find(cat => cat.name === categoryName);
    if (!categoryData) return;

    let filteredTransactions = categoryData.transactions;
    let title = `All Transactions for: ${categoryName}`;

    switch (filterType) {
        case 'P1':
            title = `P1 Bills for: ${categoryName}`;
            filteredTransactions = categoryData.transactions.filter(row => toNumber(row['P1']) > 0);
            break;
        case 'UP_P1':
            title = `UP P1 Bills for: ${categoryName}`;
            filteredTransactions = categoryData.transactions.filter(row => toNumber(row['ยอดอัพ P1']) > 0);
            break;
        case 'UP_P2':
            title = `UP P2 Bills for: ${categoryName}`;
            filteredTransactions = categoryData.transactions.filter(row => toNumber(row['ยอดอัพ P2']) > 0);
            break;
        case 'NEW_CUSTOMER':
            title = `New Customers for: ${categoryName}`;
            filteredTransactions = categoryData.transactions.filter(row => isNewCustomer(row));
            break;
    }

    ui.modalTitle.textContent = title;
    
    if (filteredTransactions.length === 0) {
        ui.modalBody.innerHTML = '<p style="text-align:center;">No matching transactions found.</p>';
    } else {
        const tableRows = filteredTransactions
            .sort((a,b) => parseGvizDate(b['วันที่']) - parseGvizDate(a['วันที่']))
            .map((row, index) => {
                const p1 = toNumber(row['P1']);
                const upP1 = toNumber(row['ยอดอัพ P1']);
                const upP2 = toNumber(row['ยอดอัพ P2']);
                
                let billTypes = [];
                if (p1 > 0) billTypes.push('P1');
                if (upP1 > 0) billTypes.push('UP P1');
                if (upP2 > 0) billTypes.push('UP P2');

                return `
                <tr>
                    <td>${index + 1}</td>
                    <td>${new Date(parseGvizDate(row['วันที่'])).toLocaleDateString('th-TH')}</td>
                    <td>${row['ชื่อลูกค้า'] || 'N/A'}</td>
                    <td>${row['หมวดหมู่'] || 'N/A'}</td>
                    <td>${billTypes.join(', ') || 'N/A'}</td>
                    <td class="revenue-cell">${formatCurrency(p1+upP1+upP2)}</td>
                </tr>
                `;
        }).join('');
        ui.modalBody.innerHTML = `
            <div class="ad-card-details" style="padding:0;">
                <table class="popup-table">
                    <thead>
                        <tr>
                            <th>ลำดับ</th>
                            <th>Date</th>
                            <th>Customer Name</th>
                            <th>รายการ</th>
                            <th>ประเภทบิล</th>
                            <th>Total Revenue</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        `;
    }
    ui.modal.classList.add('show');
}
// END: Updated popup function

function sortAndRenderCampaigns() {
    const { key, direction } = currentSort;
    const searchTerm = ui.campaignSearchInput.value.toLowerCase();
    
    let filteredData = latestCampaignData.filter(campaign => 
        campaign.name.toLowerCase().includes(searchTerm)
    );

    filteredData.sort((a, b) => {
        let valA, valB;
        if (key === 'name' || key === 'status') {
            valA = a[key]?.toLowerCase() || '';
            valB = b[key]?.toLowerCase() || '';
        } else {
            valA = parseFloat(a.insights?.[key] || 0);
            valB = parseFloat(b.insights?.[key] || 0);
        }
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    document.querySelectorAll('.sort-link').forEach(link => {
        link.classList.remove('asc', 'desc');
        if (link.dataset.sort === key) {
            link.classList.add(direction);
        }
    });

    renderCampaignsTable(filteredData);
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
    ui.adSearchInput.value = '';
    currentPopupAds = campaign.ads || [];
    renderPopupAds(currentPopupAds);
    ui.modal.classList.add('show');
}

function renderPopupAds(ads) {
     if (!ads || ads.length === 0) {
        ui.modalBody.innerHTML = `<p style="text-align: center;">No ads found for this campaign.</p>`;
    } else {
        ui.modalBody.innerHTML = ads
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
                        <div>CPM: <span>${formatCurrency(ad.insights.cpm)}</span></div>
                    </div>
                </div>
            </div>
        `).join('');
    }
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
        type: 'doughnut', data: { labels:['New Customers','Old Customers'], datasets:[{ data:[], backgroundColor: ['#F59E0B', '#10B981'], borderColor: '#0d0c1d' }] },
        options: { responsive:true, maintainAspectRatio:false, plugins: { legend: { position: 'right', labels: { color: textColor } } } }
    });

    charts.categoryRevenue = new Chart(ui.categoryRevenueChart.getContext('2d'), {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Revenue (THB)',
                data: [],
                backgroundColor: categoryColors
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: textColor, autoSkip: false, maxRotation: 45, minRotation: 45 },
                    grid: { color: 'transparent' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: textColor, callback: v => '฿' + (v / 1000) + 'K' },
                    grid: { color: gridColor }
                }
            }
        }
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
            
            latestCategoryDetails = salesData.categoryDetails;
            
            renderFunnelOverview(adsResponse.totals, salesData.summary);
            renderAdsOverview(adsResponse.totals);
            renderSalesOverview(salesData.summary);
            renderSalesRevenueBreakdown(salesData.summary);
            renderSalesBillStats(salesData.summary);
            sortAndRenderCampaigns();
            renderDailySpendChart(adsResponse.data.dailySpend);
            renderCategoryChart(salesData.categoryDetails);
            renderCategoryDetailTable(salesData.categoryDetails);

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
}

document.addEventListener('DOMContentLoaded', () => {
    initializeCharts();
    initializeModal();
    setDefaultDates();
    main();

    ui.refreshBtn.addEventListener('click', main);
    ui.startDate.addEventListener('change', main);
    ui.endDate.addEventListener('change', main);
    ui.campaignSearchInput.addEventListener('input', sortAndRenderCampaigns);
    ui.adSearchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredAds = currentPopupAds.filter(ad => ad.name.toLowerCase().includes(searchTerm));
        renderPopupAds(filteredAds);
    });
    ui.campaignsTableHeader.addEventListener('click', (e) => {
        e.preventDefault();
        const link = e.target.closest('.sort-link');
        if (!link) return;
        const sortKey = link.dataset.sort;
        if (currentSort.key === sortKey) {
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.key = sortKey;
            currentSort.direction = 'desc';
        }
        sortAndRenderCampaigns();
    });
});