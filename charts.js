/**
 * Fylkesbarometeret — Dynamic multi-county chart engine
 */

// ── Chart.js defaults ──
Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#5f6b7a';
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
Chart.defaults.plugins.legend.labels.padding = 16;
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(26,29,35,0.92)';
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.padding = { top: 8, bottom: 8, left: 12, right: 12 };
Chart.defaults.plugins.tooltip.displayColors = true;
Chart.defaults.plugins.tooltip.boxPadding = 4;
Chart.defaults.elements.bar.borderRadius = 4;
Chart.defaults.elements.line.tension = 0.3;

const GRID_COLOR = 'rgba(0,0,0,0.05)';
const LANDSSNITT_STYLE = { label: 'Landssnitt', borderColor: '#94a3b8', borderDash: [4,3], borderWidth: 1.5, pointRadius: 0, fill: false };

// Sorted county IDs for chip rendering — computed once at load
const COUNTY_IDS_SORTED = Object.keys(COUNTY_COLORS).sort((a, b) =>
    COUNTIES[a]?.name.localeCompare(COUNTIES[b]?.name, 'nb') ?? 0);

// Merger offset for VGS chart: VGS_YEARS[0]=2018 sits at YEARS[3], so offset=3
// Precomputed here so updateAllCharts doesn't indexOf on every county toggle
const VGS_MERGER_OFFSET = YEARS.indexOf(VGS_YEARS[0]);

/**
 * Returns a Chart.js segment config that styles merged-period line segments
 * as dashed + muted so it's visually clear the data belongs to a fused entity.
 * @param {Object} county  — county object with isMerged[] array (11 entries, 2015-2025)
 * @param {number} offset  — YEARS.indexOf(firstChartYear), e.g. 0 for YEARS, 5 for OUTCOME_YEARS
 */
function makeMergedSegment(county, offset) {
    if (!county || !county.isMerged) return {};
    // Use the county's own mid-color (semi-transparent, solid) so merged periods
    // are visually distinct from dashed gray landssnitt lines
    const midColor = COUNTY_COLORS[county.id]?.mid;
    if (!midColor) return {};
    return {
        borderColor: ctx => {
            const i0 = ctx.p0DataIndex + offset;
            const i1 = ctx.p1DataIndex + offset;
            if (county.isMerged[i0] || county.isMerged[i1]) return midColor;
        },
    };
}

// ── Chart registry ──
const charts = {};

function destroyChart(id) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ── Build datasets for a metric ──
function makeLineDatasets(metric, unit, perInnb) {
    const counties = getSelectedCounties();
    return counties.map(c => {
        const colors = COUNTY_COLORS[c.id];
        return {
            label: c.name,
            data: c[metric],
            borderColor: colors.main,
            backgroundColor: colors.light,
            pointBackgroundColor: colors.main,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: counties.length > 2 ? 3 : 5,
            pointHoverRadius: 7,
            borderWidth: 2.5,
            fill: counties.length === 1,
            segment: makeMergedSegment(c, 0),
        };
    });
}

// Builds line datasets for outcome charts (vei-dekke, tannhelse-dekning, vgs-gjennomforing).
// offset = YEARS.indexOf(firstOutcomeYear) — used to map chart indices to isMerged indices.
function makeOutcomeLineDatasets(dataSource, mergerOffset) {
    const counties = getSelectedCounties();
    return counties.map(c => {
        const colors = COUNTY_COLORS[c.id];
        return {
            label: c.name,
            data: dataSource[c.id] || [],
            borderColor: colors.main,
            backgroundColor: colors.light,
            pointBackgroundColor: colors.main,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: counties.length > 2 ? 3 : 5,
            pointHoverRadius: 7,
            borderWidth: 2.5,
            fill: false,
            segment: makeMergedSegment(c, mergerOffset),
        };
    });
}

function makeBarDatasets(metric) {
    const counties = getSelectedCounties();
    return counties.map(c => {
        const colors = COUNTY_COLORS[c.id];
        // Per-bar colors: merged years (isMerged=true) get faded styling
        const bgColors = YEARS.map((_, i) => c.isMerged[i] ? colors.light : colors.mid);
        const borderColors = YEARS.map((_, i) => c.isMerged[i] ? colors.mid : colors.main);
        return {
            label: c.name,
            data: c[metric],
            backgroundColor: bgColors,
            borderColor: borderColors,
            borderWidth: 1.5,
        };
    });
}

// ── Tooltip title — just the year; merger indicated per-series in labels ──
function tooltipTitle(items) {
    return `${YEARS[items[0].dataIndex]}`;
}

// ── Returns ' ★' if the hovered county was merged at this data point ──
// offset: how many YEARS indices to skip before the chart's first year
// (0 for full YEARS charts, 5 for OUTCOME_YEARS charts starting at 2020)
function mergedStar(ctx, offset = 0) {
    const c = getSelectedCounties().find(cn => cn.name === ctx.dataset.label);
    return c?.isMerged[ctx.dataIndex + offset] ? ' ★' : '';
}

// ── Common scale configs ──
const scaleX = { grid: { display: false }, ticks: { font: { size: 11, weight: '500' } } };
const scaleY = (fmt) => ({
    grid: { color: GRID_COLOR },
    ticks: { font: { size: 11 }, callback: fmt },
    border: { display: false },
});

// ══════════════════════════════════════
// RENDER ALL CHARTS
// ══════════════════════════════════════
function updateOsloBadges() {
    const hasOslo = getSelectedCounties().some(c => c.isOslo);
    const hasOthers = getSelectedCounties().some(c => !c.isOslo);
    const showBadge = hasOslo && hasOthers;

    // Chart IDs that are incomparable for Oslo
    const incompCharts = ['chart-netto-drift', 'chart-frie-inntekter', 'chart-skatteinntekter', 'chart-disposisjonsfond', 'chart-lanegjeld', 'chart-drift', 'chart-ansatte'];
    incompCharts.forEach(id => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const card = canvas.closest('.card');
        if (!card) return;
        const existing = card.querySelector('.oslo-incomparable-badge');
        if (showBadge && !existing) {
            const badge = document.createElement('span');
            badge.className = 'oslo-incomparable-badge';
            badge.textContent = '⚠ Ikke sammenlignbart for Oslo';
            card.querySelector('.card-header').appendChild(badge);
        } else if (!showBadge && existing) {
            existing.remove();
        }
    });
}

function updateAllCharts() {
    const counties = getSelectedCounties();
    if (counties.length === 0) {
        Object.keys(charts).forEach(k => destroyChart(k));
        document.querySelectorAll('.card-body canvas').forEach(canvas => {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.fillStyle = '#94a3b8';
            ctx.font = '500 13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Velg et fylke for å se data', canvas.width / 2, canvas.height / 2);
            ctx.restore();
        });
        return;
    }
    const labels = getChartLabels();

    // --- Netto driftsresultat ---
    destroyChart('netto-drift');
    const ndrDatasets = makeLineDatasets('nettoDriftsresultat');
    ndrDatasets.push({
        label: 'Anbefalt min. (4%)',
        data: Array(YEARS.length).fill(4),
        borderColor: '#dc2626',
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
    });
    ndrDatasets.push({
        label: 'Landssnitt',
        data: NATIONAL_AVG.nettoDriftsresultat,
        borderColor: '#94a3b8',
        borderDash: [4, 3],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
    });
    charts['netto-drift'] = new Chart(document.getElementById('chart-netto-drift'), {
        type: 'line',
        data: { labels, datasets: ndrDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toFixed(1)} %` } } },
            scales: { x: scaleX, y: scaleY(v => `${v} %`) },
        }
    });

    // --- Frie inntekter ---
    destroyChart('frie-inntekter');
    const fiDatasets = makeBarDatasets('frieInntekterPerInnb');
    fiDatasets.push({ type: 'line', ...LANDSSNITT_STYLE, data: NATIONAL_AVG.frieInntekterPerInnb });
    charts['frie-inntekter'] = new Chart(document.getElementById('chart-frie-inntekter'), {
        type: 'bar',
        data: { labels, datasets: fiDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} kr` : '' } } },
            scales: { x: scaleX, y: scaleY(v => `${(v/1000).toFixed(0)}k`) },
        }
    });

    // --- Skatteinntekter per innbygger ---
    destroyChart('skatteinntekter');
    const skattDs = makeBarDatasets('skatteinntekterPerInnb');
    skattDs.push({ type: 'line', ...LANDSSNITT_STYLE, data: NATIONAL_AVG.skatteinntekterPerInnb });
    charts['skatteinntekter'] = new Chart(document.getElementById('chart-skatteinntekter'), {
        type: 'bar',
        data: { labels, datasets: skattDs },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} kr` : '' } } },
            scales: { x: scaleX, y: scaleY(v => `${(v/1000).toFixed(0)}k`) },
        }
    });

    // --- Disposisjonsfond ---
    destroyChart('disposisjonsfond');
    const dfDatasets = makeLineDatasets('disposisjonsfond');
    dfDatasets.push({
        label: 'Landssnitt',
        data: NATIONAL_AVG.disposisjonsfond,
        borderColor: '#94a3b8',
        borderDash: [4, 3],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
    });
    charts['disposisjonsfond'] = new Chart(document.getElementById('chart-disposisjonsfond'), {
        type: 'line',
        data: { labels, datasets: dfDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: getSelectedCounties().length > 1 }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toFixed(1)} %` } } },
            scales: { x: scaleX, y: { ...scaleY(v => `${v} %`), suggestedMin: 0 } },
        }
    });

    // --- Lånegjeld ---
    destroyChart('lanegjeld');
    const lgDatasets = makeBarDatasets('nettoLanegjeldPerInnb');
    lgDatasets.push({ type: 'line', ...LANDSSNITT_STYLE, data: NATIONAL_AVG.nettoLanegjeldPerInnb });
    charts['lanegjeld'] = new Chart(document.getElementById('chart-lanegjeld'), {
        type: 'bar',
        data: { labels, datasets: lgDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} kr` : '' } } },
            scales: { x: scaleX, y: scaleY(v => `${(v/1000).toFixed(0)}k`) },
        }
    });

    // --- Brutto driftsinntekter ---
    destroyChart('drift');
    charts['drift'] = new Chart(document.getElementById('chart-drift'), {
        type: 'bar',
        data: { labels, datasets: makeBarDatasets('bruttoDriftsinntekter') },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: getSelectedCounties().length > 1 }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} mill. kr` } } },
            scales: { x: scaleX, y: scaleY(v => v >= 1000 ? `${(v/1000).toFixed(0)} mrd` : v) },
        }
    });

    // --- Befolkning ---
    destroyChart('befolkning');
    charts['befolkning'] = new Chart(document.getElementById('chart-befolkning'), {
        type: 'line',
        data: { labels, datasets: makeLineDatasets('befolkning') },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: getSelectedCounties().length > 1, position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')}` } } },
            scales: { x: scaleX, y: scaleY(v => `${(v/1000).toFixed(0)}k`) },
        }
    });

    // --- Aldersfordeling ---
    destroyChart('alder');
    const ageLabels = counties[0].aldersfordeling.labels;
    const ageDatasets = counties.map(c => ({
        label: c.name,
        data: c.aldersfordeling.values,
        backgroundColor: COUNTY_COLORS[c.id].mid,
        borderColor: COUNTY_COLORS[c.id].main,
        borderWidth: 1.5,
    }));
    charts['alder'] = new Chart(document.getElementById('chart-alder'), {
        type: 'bar',
        data: { labels: ageLabels, datasets: ageDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: counties.length > 1 }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y} %` } } },
            scales: { x: scaleX, y: scaleY(v => `${v}%`) },
        }
    });

    // --- Befolkningsvekst ---
    destroyChart('befolkning-vekst');
    const vekstDatasets = counties.map(c => {
        const vekst = getBefolkningsvekst(c);
        const colors = COUNTY_COLORS[c.id];
        const bgColors = YEARS.map((_, i) => c.isMerged[i] ? colors.light : colors.mid);
        const borderColors = YEARS.map((_, i) => c.isMerged[i] ? colors.mid : colors.main);
        return {
            label: c.name,
            data: vekst,
            backgroundColor: bgColors,
            borderColor: borderColors,
            borderWidth: 1.5,
        };
    });
    charts['befolkning-vekst'] = new Chart(document.getElementById('chart-befolkning-vekst'), {
        type: 'bar',
        data: { labels, datasets: vekstDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: counties.length > 1 }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => ctx.parsed.y !== null ? `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toFixed(2)} %` : 'Ikke sammenlignbart' } } },
            scales: { x: scaleX, y: scaleY(v => `${+v.toFixed(2)} %`) },
        }
    });

    // --- VGO per innbygger ---
    destroyChart('vgo-per-innb');
    const vgoDs = makeLineDatasets('vgoPerInnb');
    vgoDs.push({ ...LANDSSNITT_STYLE, data: NATIONAL_AVG.vgoPerInnb });
    charts['vgo-per-innb'] = new Chart(document.getElementById('chart-vgo-per-innb'), {
        type: 'line',
        data: { labels, datasets: vgoDs },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} kr/innb.` : '' } } },
            scales: { x: scaleX, y: scaleY(v => `${v.toLocaleString('nb-NO')} kr`) },
        }
    });

    // --- Samferdsel per innbygger ---
    destroyChart('samferdsel-per-innb');
    const samDs = makeLineDatasets('samferdselPerInnb');
    samDs.push({ ...LANDSSNITT_STYLE, data: NATIONAL_AVG.samferdselPerInnb });
    charts['samferdsel-per-innb'] = new Chart(document.getElementById('chart-samferdsel-per-innb'), {
        type: 'line',
        data: { labels, datasets: samDs },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} kr/innb.` : '' } } },
            scales: { x: scaleX, y: scaleY(v => `${v.toLocaleString('nb-NO')} kr`) },
        }
    });

    // --- Tannhelse per innbygger ---
    destroyChart('tannhelse-per-innb');
    const thDs = makeLineDatasets('tannhelsePerInnb');
    thDs.push({ ...LANDSSNITT_STYLE, data: NATIONAL_AVG.tannhelsePerInnb });
    charts['tannhelse-per-innb'] = new Chart(document.getElementById('chart-tannhelse-per-innb'), {
        type: 'line',
        data: { labels, datasets: thDs },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} kr/innb.` : '' } } },
            scales: { x: scaleX, y: scaleY(v => `${v} kr`) },
        }
    });

    // --- Admin per innbygger ---
    destroyChart('admin-per-innb');
    const admDs = makeLineDatasets('adminPerInnb');
    admDs.push({ ...LANDSSNITT_STYLE, data: NATIONAL_AVG.adminPerInnb });
    charts['admin-per-innb'] = new Chart(document.getElementById('chart-admin-per-innb'), {
        type: 'line',
        data: { labels, datasets: admDs },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} kr/innb.` : '' } } },
            scales: { x: scaleX, y: scaleY(v => `${v} kr`) },
        }
    });

    // --- Kultur per innbygger ---
    destroyChart('kultur-per-innb');
    const kulDs = makeLineDatasets('kulturPerInnb');
    kulDs.push({ ...LANDSSNITT_STYLE, data: NATIONAL_AVG.kulturPerInnb });
    charts['kultur-per-innb'] = new Chart(document.getElementById('chart-kultur-per-innb'), {
        type: 'line',
        data: { labels, datasets: kulDs },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', align: 'end' }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} kr/innb.` : '' } } },
            scales: { x: scaleX, y: scaleY(v => `${v} kr`) },
        }
    });

    // ── STRUKTURELLE FORUTSETNINGER ──

    // --- Structural comparison table ---
    const structTable = document.getElementById('structural-table');
    if (structTable) {
        const metrics = counties.map(c => getStructuralMetrics(c.id)).filter(Boolean);
        let thtml = '<table class="structural-table"><thead><tr><th>Nøkkeltall</th>';
        counties.forEach(c => {
            thtml += `<th style="color:${COUNTY_COLORS[c.id].main}">${c.name}</th>`;
        });
        thtml += '</tr></thead><tbody>';

        const rows = [
            { label: 'Landareal (km²)', key: 'areal', fmt: v => v.toLocaleString('nb-NO') },
            { label: 'Befolkningstetthet (innb./km²)', key: 'befolkningstetthet', fmt: v => v.toLocaleString('nb-NO', {maximumFractionDigits:1}) },
            { label: 'Fylkesvei (km)', key: 'fylkesveiKm', fmt: v => v.toLocaleString('nb-NO') },
            { label: 'Fylkesvei per 1 000 innb. (km)', key: 'fylkesveiPer1000', fmt: v => v.toLocaleString('nb-NO', {maximumFractionDigits:1}) },
            { label: 'Bruer på fylkesvei', key: 'bruer', fmt: v => v.toLocaleString('nb-NO') },
            { label: 'Tunneler på fylkesvei (km)', key: 'tunnelerKm', fmt: v => v.toLocaleString('nb-NO') },
            { label: 'Fergesamband', key: 'fergesamband', fmt: v => v.toString() },
        ];

        rows.forEach(r => {
            thtml += `<tr><td>${r.label}</td>`;
            metrics.forEach(m => {
                const val = m[r.key];
                const isMax = metrics.length > 1 && val === Math.max(...metrics.map(x => x[r.key]));
                thtml += `<td${isMax ? ' class="highlight-cell"' : ''}>${r.fmt(val)}</td>`;
            });
            thtml += '</tr>';
        });
        thtml += '</tbody></table>';
        structTable.innerHTML = thtml;
    }

    // --- Befolkningstetthet (horizontal bar) ---
    destroyChart('tetthet');
    const tetthNames = counties.map(c => c.name);
    const tetthData = counties.map(c => {
        const m = getStructuralMetrics(c.id);
        return m ? m.befolkningstetthet : 0;
    });
    const tetthColors = counties.map(c => COUNTY_COLORS[c.id].mid);
    const tetthBorders = counties.map(c => COUNTY_COLORS[c.id].main);
    charts['tetthet'] = new Chart(document.getElementById('chart-tetthet'), {
        type: 'bar',
        data: {
            labels: tetthNames,
            datasets: [{ data: tetthData, backgroundColor: tetthColors, borderColor: tetthBorders, borderWidth: 1.5 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.x.toLocaleString('nb-NO')} innb./km²` } } },
            scales: {
                x: { grid: { color: GRID_COLOR }, ticks: { callback: v => v.toLocaleString('nb-NO') }, border: { display: false } },
                y: { grid: { display: false }, ticks: { font: { size: 11, weight: '500' } } },
            }
        }
    });

    // --- Fylkesvei per 1000 innb ---
    destroyChart('fvkm-per-innb');
    const fvNames = counties.map(c => c.name);
    const fvData = counties.map(c => {
        const m = getStructuralMetrics(c.id);
        return m ? m.fylkesveiPer1000 : 0;
    });
    charts['fvkm-per-innb'] = new Chart(document.getElementById('chart-fvkm-per-innb'), {
        type: 'bar',
        data: {
            labels: fvNames,
            datasets: [{ data: fvData, backgroundColor: tetthColors, borderColor: tetthBorders, borderWidth: 1.5 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.x.toFixed(1)} km per 1 000 innb.` } } },
            scales: {
                x: { grid: { color: GRID_COLOR }, ticks: { callback: v => `${v} km` }, border: { display: false } },
                y: { grid: { display: false }, ticks: { font: { size: 11, weight: '500' } } },
            }
        }
    });

    // --- Infrastruktur: tunneler + fergesamband (grouped bar) ---
    destroyChart('infrastruktur');
    const infraNames = counties.map(c => c.name);
    const tunnelData = counties.map(c => { const m = getStructuralMetrics(c.id); return m ? m.tunnelerKm : 0; });
    const fergeData = counties.map(c => { const m = getStructuralMetrics(c.id); return m ? m.fergesamband : 0; });
    charts['infrastruktur'] = new Chart(document.getElementById('chart-infrastruktur'), {
        type: 'bar',
        data: {
            labels: infraNames,
            datasets: [
                { label: 'Tunneler (km)', data: tunnelData, backgroundColor: 'rgba(37,99,235,0.5)', borderColor: '#2563eb', borderWidth: 1.5 },
                { label: 'Fergesamband', data: fergeData, backgroundColor: 'rgba(8,145,178,0.5)', borderColor: '#0891b2', borderWidth: 1.5 },
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.x}` } } },
            scales: {
                x: { grid: { color: GRID_COLOR }, border: { display: false } },
                y: { grid: { display: false }, ticks: { font: { size: 11, weight: '500' } } },
            }
        }
    });

    // ── RESULTATINDIKATORER ──

    // --- Fylkesvei dårlig dekke ---
    destroyChart('vei-dekke');
    const roadDatasets = makeOutcomeLineDatasets(ROAD_QUALITY, 5);
    roadDatasets.push({ label: 'Landssnitt', data: ROAD_QUALITY._landssnitt, borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
    charts['vei-dekke'] = new Chart(document.getElementById('chart-vei-dekke'), {
        type: 'line',
        data: { labels: OUTCOME_YEARS.map(String), datasets: roadDatasets },
        options: {
            responsive: true, maintainAspectRatio: false, spanGaps: true,
            plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} %` : '' } } },
            scales: { x: scaleX, y: { ...scaleY(v => `${v} %`), suggestedMin: 0, suggestedMax: 60 } },
        }
    });

    // --- Tannhelse dekning ---
    destroyChart('tannhelse-dekning');
    const dentalDatasets = makeOutcomeLineDatasets(DENTAL_COVERAGE, 5);
    dentalDatasets.push({ label: 'Landssnitt', data: DENTAL_COVERAGE._landssnitt, borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
    charts['tannhelse-dekning'] = new Chart(document.getElementById('chart-tannhelse-dekning'), {
        type: 'line',
        data: { labels: OUTCOME_YEARS.slice(0, 5).map(String), datasets: dentalDatasets },
        options: {
            responsive: true, maintainAspectRatio: false, spanGaps: true,
            plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} %` : '' } } },
            scales: { x: scaleX, y: { ...scaleY(v => `${v} %`), suggestedMin: 40, suggestedMax: 85 } },
        }
    });

    // --- Busspassasjerer ---
    destroyChart('buss-passasjerer');
    // OUTCOME_YEARS[0]=2020=YEARS[5], so isMerged offset for outcome = 5
    const busDatasets = counties.map(c => {
        const colors = COUNTY_COLORS[c.id];
        const raw = BUS_PASSENGERS[c.id] || [];
        const data = raw.map(v => v != null ? v / 1e6 : null);
        const bgColors = OUTCOME_YEARS.map((_, i) => c.isMerged[i + 5] ? colors.light : colors.mid);
        const borderColors = OUTCOME_YEARS.map((_, i) => c.isMerged[i + 5] ? colors.mid : colors.main);
        return { label: c.name, data, backgroundColor: bgColors, borderColor: borderColors, borderWidth: 1.5 };
    });
    charts['buss-passasjerer'] = new Chart(document.getElementById('chart-buss-passasjerer'), {
        type: 'bar',
        data: { labels: OUTCOME_YEARS.map(String), datasets: busDatasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: counties.length > 1 }, tooltip: { callbacks: { label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} mill.` : '' } } },
            scales: { x: scaleX, y: scaleY(v => `${v} mill.`) },
        }
    });

    // --- VGS gjennomføring ---
    destroyChart('vgs-gjennomforing');
    const vgsDatasets = makeOutcomeLineDatasets(VGS_COMPLETION, VGS_MERGER_OFFSET);
    vgsDatasets.push({ label: 'Landssnitt', data: VGS_COMPLETION._landssnitt, borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false });
    charts['vgs-gjennomforing'] = new Chart(document.getElementById('chart-vgs-gjennomforing'), {
        type: 'line',
        data: { labels: VGS_YEARS.map(String), datasets: vgsDatasets },
        options: {
            responsive: true, maintainAspectRatio: false, spanGaps: true,
            plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: ctx => ctx.parsed.y != null ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} %` : '' } } },
            scales: { x: scaleX, y: { ...scaleY(v => `${v} %`), suggestedMin: 60, suggestedMax: 90 } },
        }
    });

    // --- Årsverk ---
    destroyChart('ansatte');
    charts['ansatte'] = new Chart(document.getElementById('chart-ansatte'), {
        type: 'bar',
        data: { labels, datasets: makeBarDatasets('arsverk') },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: counties.length > 1 }, tooltip: { callbacks: { title: tooltipTitle, label: ctx => `${ctx.dataset.label}${mergedStar(ctx)}: ${ctx.parsed.y.toLocaleString('nb-NO')} årsverk` } } },
            scales: { x: scaleX, y: scaleY(v => v) },
        }
    });

    // --- Sektor (doughnut / grouped bar) ---
    destroyChart('sektor');
    if (counties.length === 1) {
        const c = counties[0];
        charts['sektor'] = new Chart(document.getElementById('chart-sektor'), {
            type: 'doughnut',
            data: {
                labels: c.sektorfordeling.labels,
                datasets: [{
                    data: c.sektorfordeling.values,
                    backgroundColor: ['#2563eb', '#0891b2', '#059669', '#d97706', '#8b5cf6', '#94a3b8'],
                    borderWidth: 2, borderColor: '#fff', hoverOffset: 6
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '55%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            font: { size: 11 }, padding: 8,
                            generateLabels: (chart) => chart.data.labels.map((l, i) => ({
                                text: `${l}  ${chart.data.datasets[0].data[i]}%`,
                                fillStyle: chart.data.datasets[0].backgroundColor[i],
                                strokeStyle: chart.data.datasets[0].backgroundColor[i],
                                pointStyle: 'rectRounded', index: i
                            }))
                        }
                    }
                }
            }
        });
    } else {
        const sektorLabels = counties[0].sektorfordeling.labels;
        const sektorDatasets = counties.map(c => ({
            label: c.name,
            data: c.sektorfordeling.values,
            backgroundColor: COUNTY_COLORS[c.id].mid,
            borderColor: COUNTY_COLORS[c.id].main,
            borderWidth: 1.5,
        }));
        charts['sektor'] = new Chart(document.getElementById('chart-sektor'), {
            type: 'bar',
            data: { labels: sektorLabels, datasets: sektorDatasets },
            options: {
                indexAxis: 'y',
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: true }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.x} %` } } },
                scales: {
                    x: { grid: { color: GRID_COLOR }, ticks: { callback: v => `${v}%` }, border: { display: false } },
                    y: { grid: { display: false }, ticks: { font: { size: 10 } } },
                }
            }
        });
    }
}

// ══════════════════════════════════════
// HEADER UPDATE
// ══════════════════════════════════════
function updateHeader() {
    const counties = getSelectedCounties();
    const header = document.getElementById('county-header');
    const html = `<div class="header-inner"><div class="header-counties">${counties.map(c => {
        const color = COUNTY_COLORS[c.id].main;
        const lastYear = YEARS[YEARS.length - 1];
        const pop = c.befolkning[c.befolkning.length - 1];
        const bdi = c.bruttoDriftsinntekter[c.bruttoDriftsinntekter.length - 1];
        const arsv = c.arsverk[c.arsverk.length - 1];
        const bdiStr = bdi != null
            ? `${(bdi/1000).toFixed(1).replace('.', ',')} mrd`
            : `<span class="missing-badge">Mangler ${lastYear}</span>`;
        const osloMeta = c.isOslo ? ' &middot; <span style="color:#d97706">kommune + fylke</span>' : '';
        const bdiLabel = c.isOslo ? 'Driftsinnt. (kommune+fylke)' : 'Driftsinntekter';
        return `<div class="header-county-card" style="--county-color:${color}">
            <div class="header-county-name">${c.name}</div>
            <div class="header-county-meta">Fylkesnr. ${c.code} &middot; ${c.municipalities} kommuner${osloMeta}</div>
            <div class="header-county-stats">
                <div><div class="hc-stat-value">${pop.toLocaleString('nb-NO')}</div><div class="hc-stat-label">Innbyggere ${lastYear}</div></div>
                <div><div class="hc-stat-value">${bdiStr}</div><div class="hc-stat-label">${bdiLabel}</div></div>
                <div><div class="hc-stat-value">~${arsv.toLocaleString('nb-NO')}</div><div class="hc-stat-label">Årsverk</div></div>
            </div>
        </div>`;
    }).join('')}</div></div>`;
    header.innerHTML = html;

    // Update merger banner
    const banner = document.getElementById('merger-banner');
    const mergedCounties = counties.filter(c => c.mergedPeriod.length > 0);
    if (mergedCounties.length > 0) {
        banner.style.display = '';
        const names = [...new Set(mergedCounties.map(c => c.mergedName))].join(', ');
        document.getElementById('merger-text').innerHTML = `<strong>Merk:</strong> Data for 2020–2023 er merket med <span class="merger-marker">★</span> og gjelder det sammenslåtte fylket (${names}). Per-innbygger-tall er mer sammenlignbare enn totaltall.`;
    } else {
        banner.style.display = 'none';
    }

    // Oslo banner
    const osloBanner = document.getElementById('oslo-banner');
    const hasOslo = counties.some(c => c.isOslo);
    const hasOthers = counties.some(c => !c.isOslo);
    if (hasOslo && hasOthers) {
        osloBanner.style.display = '';
        document.getElementById('oslo-text').innerHTML = `<strong>Oslo kommune = fylkeskommune:</strong> Oslo er både kommune og fylkeskommune. Økonomi-tallene (driftsinntekter, frie inntekter, lånegjeld, disposisjonsfond, netto driftsresultat) inkluderer <em>alle</em> kommunale tjenester og er derfor ikke direkte sammenlignbare med andre fylkeskommuner. Sektorutgifter per innbygger (VGO, samferdsel, tannhelse) er derimot sammenlignbare.`;
    } else if (hasOslo && !hasOthers) {
        osloBanner.style.display = '';
        document.getElementById('oslo-text').innerHTML = `<strong>Oslo kommune = fylkeskommune:</strong> Oslo er både kommune og fylkeskommune. Økonomi-tallene inkluderer alle kommunale tjenester (skole, helse, sosial, etc.) i tillegg til fylkeskommunale oppgaver, og er derfor betydelig høyere enn for rene fylkeskommuner.`;
    } else {
        osloBanner.style.display = 'none';
    }

    // Update title
    document.title = `Fylkesbarometeret — ${counties.map(c => c.name).join(' vs ')}`;
}

// ══════════════════════════════════════
// COMPARISON TABLE
// ══════════════════════════════════════
function updateTable() {
    const counties = getSelectedCounties();
    const wrapper = document.getElementById('comparison-table');
    const lastIdx = YEARS.length - 1;
    const lastYear = YEARS[lastIdx];
    const safeFmt = (fmt, v) => v == null ? '<span class="no-data">—</span>' : fmt(v);

    const indicators = [
        { label: `Innbyggere (${lastYear})`, key: 'befolkning', idx: lastIdx, fmt: v => v.toLocaleString('nb-NO') },
        { label: 'Brutto driftsinntekter (mill. kr)', key: 'bruttoDriftsinntekter', idx: lastIdx, fmt: v => v.toLocaleString('nb-NO') },
        { label: 'Netto driftsresultat (%)', key: 'nettoDriftsresultat', idx: lastIdx, fmt: v => `${v.toFixed(1)} %` },
        { label: 'Frie inntekter per innb. (kr)', key: 'frieInntekterPerInnb', idx: lastIdx, fmt: v => v.toLocaleString('nb-NO') },
        { label: 'Netto lånegjeld per innb. (kr)', key: 'nettoLanegjeldPerInnb', idx: lastIdx, fmt: v => v.toLocaleString('nb-NO') },
        { label: 'Disposisjonsfond (%)', key: 'disposisjonsfond', idx: lastIdx, fmt: v => `${v.toFixed(1)} %` },
        { label: 'VGO per innb. (kr)', key: 'vgoPerInnb', idx: lastIdx, fmt: v => v.toLocaleString('nb-NO') },
        { label: 'Samferdsel per innb. (kr)', key: 'samferdselPerInnb', idx: lastIdx, fmt: v => v.toLocaleString('nb-NO') },
        { label: 'Tannhelse per innb. (kr)', key: 'tannhelsePerInnb', idx: lastIdx, fmt: v => v.toLocaleString('nb-NO') },
        { label: 'Administrasjon per innb. (kr)', key: 'adminPerInnb', idx: lastIdx, fmt: v => v.toLocaleString('nb-NO') },
        { label: 'Kultur per innb. (kr)', key: 'kulturPerInnb', idx: lastIdx, fmt: v => v.toLocaleString('nb-NO') },
        { label: 'Årsverk', key: 'arsverk', idx: lastIdx, fmt: v => `~${v.toLocaleString('nb-NO')}` },
    ];

    let html = `<table class="kostra-table"><thead><tr><th>Indikator (${lastYear})</th>`;
    counties.forEach(c => {
        const color = COUNTY_COLORS[c.id].main;
        html += `<th style="color:${color}">${c.name}</th>`;
    });
    if (counties.length === 2) html += '<th>Differanse</th>';
    html += '</tr></thead><tbody>';

    const osloSelected = counties.some(c => c.isOslo);
    const multiWithOslo = osloSelected && counties.length > 1;

    indicators.forEach(ind => {
        const isIncomp = OSLO_INCOMPARABLE.includes(ind.key);
        html += '<tr>';
        html += `<td>${ind.label}${(isIncomp && osloSelected) ? ' <span class="oslo-incomparable-badge">⚠ Oslo</span>' : ''}</td>`;
        const vals = counties.map(c => c[ind.key][ind.idx]);
        vals.forEach((v, ci) => {
            const isOsloCell = counties[ci].isOslo && isIncomp && multiWithOslo;
            const style = isOsloCell ? ' style="opacity:0.45;font-style:italic" title="Ikke direkte sammenlignbart — Oslo inkluderer kommunale funksjoner"' : '';
            html += `<td${style}>${safeFmt(ind.fmt, v)}</td>`;
        });
        if (counties.length === 2) {
            const diff = (vals[0] != null && vals[1] != null) ? vals[0] - vals[1] : null;
            if (diff != null && !(isIncomp && multiWithOslo)) {
                const cls = diff > 0 ? 'diff-pos' : diff < 0 ? 'diff-neg' : '';
                const sign = diff > 0 ? '+' : '';
                html += `<td class="${cls}">${sign}${ind.fmt(diff)}</td>`;
            } else {
                html += `<td style="opacity:0.45;font-style:italic">${diff != null ? '—' : '—'}</td>`;
            }
        }
        html += '</tr>';
    });

    html += '</tbody></table>';
    wrapper.innerHTML = html;
}

// ══════════════════════════════════════
// COUNTY CHIPS (selector)
// ══════════════════════════════════════
function renderChips() {
    const container = document.getElementById('county-chips');
    const allIds = COUNTY_IDS_SORTED;
    const comingSoon = [];

    let html = '';
    allIds.forEach(id => {
        const c = COUNTIES[id];
        const colors = COUNTY_COLORS[id];
        const active = selectedCounties.includes(id) ? 'active' : '';
        html += `<button class="county-chip ${active}" data-id="${id}" style="--chip-color:${colors.main};--chip-bg:${colors.light}" onclick="toggleCounty('${id}')">
            <span class="chip-dot"></span>${c.name}
        </button>`;
    });
    comingSoon.forEach(c => {
        html += `<button class="county-chip disabled" disabled><span class="chip-dot"></span>${c.name} (kommer)</button>`;
    });
    container.innerHTML = html;
}

function updateChips() {
    document.querySelectorAll('.county-chip[data-id]').forEach(chip => {
        const id = chip.dataset.id;
        chip.classList.toggle('active', selectedCounties.includes(id));
    });
    const clearBtn = document.getElementById('clear-chips-btn');
    if (clearBtn) clearBtn.style.display = selectedCounties.length > 0 ? '' : 'none';
}

function clearAllCounties() {
    selectedCounties.length = 0;
    updateChips();
    updateAllCharts();
    updateHeader();
    updateTable();
    updateOsloBadges();
    updateRanking();
    updateSelectorSummary();
}

// Override toggleCounty to also update chips (allows 0 selected)
toggleCounty = function(id) {
    const idx = selectedCounties.indexOf(id);
    if (idx > -1) {
        selectedCounties.splice(idx, 1);
    } else {
        selectedCounties.push(id);
    }
    updateChips();
    updateAllCharts();
    updateHeader();
    updateTable();
    updateOsloBadges();
    updateRanking();
    updateSelectorSummary();
};

// ══════════════════════════════════════
// Add diff styling
// ══════════════════════════════════════
const diffStyle = document.createElement('style');
diffStyle.textContent = `
    .diff-pos { color: #059669; font-weight: 600; }
    .diff-neg { color: #dc2626; font-weight: 600; }
`;
document.head.appendChild(diffStyle);

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
// ══════════════════════════════════════
// RANKING CHART
// ══════════════════════════════════════
function updateRanking() {
    const select = document.getElementById('ranking-select');
    if (!select) return;
    const indicatorId = select.value;
    const indicator = RANKING_INDICATORS.find(i => i.id === indicatorId);
    if (!indicator) return;

    const data = getRankingData(indicatorId);
    if (!data.length) return;

    destroyChart('ranking');

    const labels = data.map(d => d.name);
    const values = data.map(d => d.value);
    const bgColors = data.map(d => {
        if (d.isIncomparable) return 'rgba(217,119,6,0.3)';
        return d.color;  // Always use county color
    });
    const borderColors = data.map(d => {
        if (d.isIncomparable) return '#d97706';
        return d.borderColor;
    });

    const lastYear = YEARS[YEARS.length - 1];
    const titleSuffix = indicator.yearLabel ? ` (${indicator.yearLabel})` : indicator.yearBased ? ` (${lastYear})` : '';

    charts['ranking'] = new Chart(document.getElementById('chart-ranking'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: bgColors, borderColor: borderColors, borderWidth: 1.5 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const d = data[ctx.dataIndex];
                            let label = `#${d.rank}  ${indicator.fmt(d.value)}`;
                            if (d.isIncomparable) label += ' (Oslo: ikke direkte sammenlignbart)';
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: { grid: { color: GRID_COLOR }, ticks: { callback: v => indicator.fmt(v) }, border: { display: false } },
                y: { grid: { display: false }, ticks: { font: { size: 11, weight: '500' } } },
            }
        }
    });
}

// ══════════════════════════════════════
// COLLAPSIBLE SELECTOR BAR
// ══════════════════════════════════════
function updateSelectorSummary() {
    const el = document.getElementById('selector-collapsed-summary');
    if (!el) return;
    const selected = getSelectedCounties();
    if (selected.length === 0) {
        el.textContent = 'Ingen fylker valgt';
    } else if (selected.length <= 3) {
        el.textContent = selected.map(c => c.name).join(', ');
    } else {
        el.textContent = `${selected.length} fylker valgt`;
    }
}

function toggleSelector() {
    const bar = document.getElementById('county-selector-bar');
    const isCollapsed = bar.classList.toggle('collapsed');
    localStorage.setItem('selectorCollapsed', isCollapsed);
    updateSelectorSummary();
}

// ══════════════════════════════════════
// EXPAND / SWAP CARD
// ══════════════════════════════════════
function expandCard(card) {
    const grid = card.closest('.card-grid');
    if (!grid) return;
    const currentWide = grid.querySelector('.card-wide');
    if (!currentWide || currentWide === card) return;

    currentWide.classList.remove('card-wide');
    card.classList.add('card-wide');

    // Trigger Chart.js resize on next animation frame
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function initExpandButtons() {
    document.querySelectorAll('.card-grid .card').forEach(card => {
        if (card.querySelector('.card-expand-btn')) return; // already initialised
        const btn = document.createElement('button');
        btn.className = 'card-expand-btn';
        btn.title = 'Byt til stor visning';
        btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 1H1v4M11 1h4v4M11 15h4v-4M5 15H1v-4"/></svg>`;
        btn.addEventListener('click', () => expandCard(card));
        card.querySelector('.card-header').appendChild(btn);
    });
}

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
renderChips();
updateHeader();
updateAllCharts();
updateTable();
updateOsloBadges();
updateRanking();
updateFetchUI();
initExpandButtons();

// Restore collapsed state from previous visit
if (localStorage.getItem('selectorCollapsed') === 'true') {
    document.getElementById('county-selector-bar')?.classList.add('collapsed');
}
updateSelectorSummary();
