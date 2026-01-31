const CONFIG = { API_BASE_URL: 'https://backend-api-choc88.vercel.app/api', SHEET_ID: '1F2bTvP1ySUT1q6fzRPQu7UpKNW_ze8GtKkd2rmRUjkI', SHEET_NAME_SUMMARY: 'SUM' };
const ui = {
    funnelStatsGrid: document.getElementById('funnelStatsGrid'),
    adsStatsGrid: document.getElementById('adsStatsGrid'),
    salesOverviewStatsGrid: document.getElementById('salesOverviewStatsGrid'),
    salesRevenueStatsGrid: document.getElementById('salesRevenueStatsGrid'),
    salesBillStatsGrid: document.getElementById('salesBillStatsGrid'),
    campaignsTableBody: document.getElementById('campaignsTableBody'),
    aiSummaryContent: document.getElementById('aiSummaryContent'),
    loading: document.getElementById('loading'),
    modal: document.getElementById('detailsModal'),
    modalBody: document.getElementById('modalBody'),
    modalTitle: document.getElementById('modalTitle'),
    adSearchInput: document.getElementById('adSearchInput'),
    startDate: document.getElementById('startDate'),
    endDate: document.getElementById('endDate'),
    refreshBtn: document.getElementById('refreshBtn'),
    compareToggle: document.getElementById('compareToggle'),
    compareControls: document.getElementById('compareControls'),
    compareStartDate: document.getElementById('compareStartDate'),
    compareEndDate: document.getElementById('compareEndDate'),
    errorMessage: document.getElementById('errorMessage')
};

let charts = {}, latestCampaignData = [], currentPopupAds = [], allSalesDataCache = [];

const formatCurrency = (n) => `฿${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
const formatCurrencyShort = (n) => `฿${parseInt(n || 0).toLocaleString('en-US')}`;
const formatNumber = (n) => parseInt(n || 0).toLocaleString('en-US');
const toNumber = (v) => v ? parseFloat(String(v).replace(/[^0-9.-]+/g, "")) || 0 : 0;
const parseGvizDate = (d) => { if(!d) return null; const m = d.match(/Date\((\d+),(\d+),(\d+)/); return m ? new Date(m[1], m[2], m[3]) : new Date(d); };
const parseCategories = (s) => (s && typeof s === 'string') ? s.split(',').map(c => c.trim()) : [];
const isNewCustomer = (r) => ['true','✔','1'].includes(String(r['ลูกค้าใหม่']||'').toLowerCase());

async function fetchData(url) { const res = await fetch(url); if(!res.ok) throw new Error("API Error"); return res.json(); }

function calculateGrowth(cur, prev) {
    if(!prev) return { percent: '0%', class: '' };
    const p = ((cur - prev) / prev) * 100;
    return { percent: `${p > 0 ? '+' : ''}${p.toFixed(1)}%`, class: p > 0 ? 'positive' : 'negative' };
}

function processSales(rows, start, end) {
    const filtered = rows.filter(r => { const d = parseGvizDate(r['วันที่']); return d && d >= start && d <= end; });
    const s = { totalRevenue: 0, totalBills: 0, newCustomers: 0, p1Revenue: 0, upP1Revenue: 0, upP2Revenue: 0, p1Bills: 0, p2Leads: 0, upP1Bills: 0, upP2Bills: 0 };
    const channels = {};
    filtered.forEach(r => {
        const p1 = toNumber(r['P1']), upP1 = toNumber(r['ยอดอัพ P1']), upP2 = toNumber(r['ยอดอัพ P2']), p2 = r['P2'];
        const rev = p1 + upP1 + upP2;
        if(rev > 0) { s.totalBills++; s.totalRevenue += rev; }
        s.p1Revenue += p1; s.upP1Revenue += upP1; s.upP2Revenue += upP2;
        if(p1 > 0) s.p1Bills++; if(upP1 > 0) s.upP1Bills++; if(upP2 > 0) s.upP2Bills++; if(p2) s.p2Leads++;
        if(isNewCustomer(r)) s.newCustomers++;
        const chan = r['ช่องทาง'];
        if(chan) {
            if(!channels[chan]) channels[chan] = { revenue: 0, p1: 0, p2: 0, upP2: 0 };
            channels[chan].revenue += rev; if(p1>0) channels[chan].p1++; if(p2) channels[chan].p2++; if(upP2>0) channels[chan].upP2++;
        }
    });
    return { summary: s, channels, rows: filtered };
}

function renderAISummary(sales) {
    const s = sales.summary;
    let html = `<div class="ai-analysis-grid"><div><ul class="ai-list">
        <li>ยอดรวม: <span class="ai-highlight">${formatCurrency(s.totalRevenue)}</span></li>
        <li>บิลรวม: ${s.totalBills} | ลูกค้าใหม่: ${s.newCustomers}</li>
        <li>สัดส่วน: P1(${formatCurrencyShort(s.p1Revenue)}) | UP P1(${formatCurrencyShort(s.upP1Revenue)}) | UP P2(${formatCurrencyShort(s.upP2Revenue)})</li>
    </ul></div></div><div class="ai-channel-grid">`;
    Object.entries(sales.channels).sort((a,b)=>b[1].revenue-a[1].revenue).forEach(([name, data]) => {
        html += `<div class="ai-channel-card"><strong>${name}</strong><br><span class="ai-highlight">${formatCurrencyShort(data.revenue)}</span><br><small>P1: ${data.p1} | P2: ${data.p2}</small></div>`;
    });
    ui.aiSummaryContent.innerHTML = html + "</div>";
}

function showAdDetails(id) {
    const camp = latestCampaignData.find(c => c.id === id);
    if(!camp) return;
    ui.modalTitle.textContent = `Ads in: ${camp.name}`;
    ui.adSearchInput.style.display = 'block';
    currentPopupAds = camp.ads || [];
    renderAdsList(currentPopupAds);
    ui.modal.classList.add('show');
}

function renderAdsList(ads) {
    ui.modalBody.innerHTML = ads.map(ad => `
        <div class="ad-card">
            <img src="${ad.thumbnail_url || ''}" onerror="this.src='https://placehold.co/80x80?text=No+Img'">
            <div>
                <h4 style="color:var(--neon-cyan)">${ad.name}</h4>
                <small>Spend: ${formatCurrency(ad.insights.spend)} | Purchases: ${ad.insights.purchases}</small>
            </div>
        </div>
    `).join('');
}

async function main() {
    ui.loading.classList.add('show');
    try {
        const start = new Date(ui.startDate.value + 'T00:00:00'), end = new Date(ui.endDate.value + 'T23:59:59');
        const [ads, salesRaw] = await Promise.all([
            fetchData(`${CONFIG.API_BASE_URL}/databillChoc?since=${ui.startDate.value.split('-').reverse().join('-')}&until=${ui.endDate.value.split('-').reverse().join('-')}`),
            fetchSalesData()
        ]);
        const sales = processSales(salesRaw, start, end);
        latestCampaignData = ads.data.campaigns;
        renderAISummary(sales);
        ui.campaignsTableBody.innerHTML = ads.data.campaigns.map(c => `
            <tr>
                <td><a href="#" onclick="showAdDetails('${c.id}'); return false;" style="color:var(--neon-cyan); text-decoration:none;">${c.name}</a></td>
                <td>${c.status}</td>
                <td class="revenue-cell">${formatCurrency(c.insights.spend)}</td>
                <td>${formatNumber(c.insights.impressions)}</td>
                <td>${formatNumber(c.insights.purchases)}</td>
                <td>${formatNumber(c.insights.messaging_conversations)}</td>
                <td>${formatCurrency(c.insights.cpm)}</td>
            </tr>
        `).join('');
        // Render other stats cards...
        ui.adsStatsGrid.innerHTML = `<div class="stat-card"><div class="stat-number">${formatNumber(ads.totals.impressions)}</div><div class="stat-label">Impressions</div></div>
                                     <div class="stat-card"><div class="stat-number">${formatNumber(ads.totals.messaging_conversations)}</div><div class="stat-label">Messaging</div></div>`;
        ui.salesOverviewStatsGrid.innerHTML = `<div class="stat-card"><div class="stat-number">${formatCurrency(sales.summary.totalRevenue)}</div><div class="stat-label">Total Revenue</div></div>`;
    } catch(e) { ui.errorMessage.textContent = e.message; ui.errorMessage.classList.add('show'); }
    ui.loading.classList.remove('show');
}

async function fetchSalesData() {
    if(allSalesDataCache.length) return allSalesDataCache;
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&sheet=${CONFIG.SHEET_NAME_SUMMARY}`);
    const text = await res.text();
    const data = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const cols = data.table.cols.map(c => c.label || '');
    allSalesDataCache = data.table.rows.map(r => { const o = {}; cols.forEach((c, i) => o[c] = r.c[i] ? r.c[i].v : null); return o; });
    return allSalesDataCache;
}

document.addEventListener('DOMContentLoaded', () => {
    const now = new Date(); ui.startDate.value = new Date(now.getFullYear(), now.getMonth(), 2).toISOString().split('T')[0]; ui.endDate.value = now.toISOString().split('T')[0];
    ui.refreshBtn.onclick = main;
    document.getElementById('modalCloseBtn').onclick = () => ui.modal.classList.remove('show');
    main();
});
