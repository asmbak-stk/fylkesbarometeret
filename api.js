/**
 * Fylkesbarometeret — SSB API Fetch Layer
 * Henter ferske data direkte fra SSB JSON-stat2 API
 *
 * Tabeller:
 *   11342: Areal og befolkning (region, år) — befolkningstall
 *   12163: KOSTRA netto driftsutgifter per sektor (fylkeskommune)
 */

const SSB_API = 'https://data.ssb.no/api/v0/no/table';

// Map county id → SSB region codes
const SSB_CODES = {
    // Table 12163 uses 4-digit KOSTRA codes (current counties)
    kostra: {
        vestfold: '3900', telemark: '4000', ostfold: '3100', akershus: '3200',
        oslo: '0300', buskerud: '3300', rogaland: '1100', vestland: '4600',
        moreogromsdal: '1500', trondelag: '5000', nordland: '1800',
        troms: '5500', finnmark: '5600', agder: '4200', innlandet: '3400',
    },
    // Table 07459 uses 2-digit codes
    population: {
        vestfold: '39', telemark: '40', ostfold: '31', akershus: '32',
        oslo: '03', buskerud: '33', rogaland: '11', vestland: '46',
        moreogromsdal: '15', trondelag: '50', nordland: '18',
        troms: '55', finnmark: '56', agder: '42', innlandet: '34',
    }
};

// Reverse lookup: SSB code → county id
const KOSTRA_TO_ID = Object.fromEntries(Object.entries(SSB_CODES.kostra).map(([k,v]) => [v, k]));
const POP_TO_ID = Object.fromEntries(Object.entries(SSB_CODES.population).map(([k,v]) => [v, k]));

// ── Fetch status ──
let lastFetchTime = null;
let fetchStatus = 'idle'; // 'idle' | 'fetching' | 'done' | 'error'
let fetchError = null;

function setFetchStatus(status, error = null) {
    fetchStatus = status;
    fetchError = error;
    updateFetchUI();
}

function updateFetchUI() {
    const btn = document.getElementById('refresh-btn');
    const status = document.getElementById('refresh-status');
    if (!btn || !status) return;

    btn.disabled = fetchStatus === 'fetching';

    if (fetchStatus === 'fetching') {
        btn.innerHTML = '<span class="refresh-spinner"></span> Henter data …';
        status.textContent = '';
    } else if (fetchStatus === 'done') {
        btn.textContent = '↻ Oppdater fra SSB';
        const time = lastFetchTime ? lastFetchTime.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : '';
        status.textContent = `Sist oppdatert: ${time}`;
        status.className = 'refresh-status success';
    } else if (fetchStatus === 'error') {
        btn.textContent = '↻ Prøv igjen';
        status.textContent = `Feil: ${fetchError}`;
        status.className = 'refresh-status error';
    } else {
        btn.textContent = '↻ Oppdater fra SSB';
        status.textContent = 'Statiske data (innebygd)';
        status.className = 'refresh-status';
    }
}

// ── Generic SSB fetcher ──
async function fetchSSB(tableId, query) {
    const url = `${SSB_API}/${tableId}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, response: { format: 'json-stat2' } }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`SSB tabell ${tableId}: HTTP ${resp.status}${body ? ' — ' + body.substring(0, 100) : ''}`);
    }
    return resp.json();
}

// ══════════════════════════════════════
// FETCH POPULATION (table 11342 — Areal og befolkning)
// ══════════════════════════════════════
async function fetchPopulation() {
    const codes = Object.values(SSB_CODES.population);
    const result = await fetchSSB('11342', [
        { code: 'Region', selection: { filter: 'item', values: codes } },
        { code: 'ContentsCode', selection: { filter: 'item', values: ['Folkemengde'] } },
        { code: 'Tid', selection: { filter: 'top', values: ['5'] } },
    ]);

    const dims = result.dimension;
    const dimIds = result.id;
    const sizes = result.size;

    const mults = {};
    for (let i = dimIds.length - 1; i >= 0; i--) {
        mults[dimIds[i]] = i === dimIds.length - 1 ? 1 : mults[dimIds[i + 1]] * sizes[i + 1];
    }

    const regCat = dims['Region'].category;
    const timCat = dims['Tid'].category;

    let updatedCount = 0;
    for (const [regCode, regIdx] of Object.entries(regCat.index)) {
        const countyId = POP_TO_ID[regCode];
        if (!countyId || !COUNTIES[countyId]) continue;

        for (const [timCode, timIdx] of Object.entries(timCat.index)) {
            const yearIdx = YEARS.indexOf(parseInt(timCode));
            if (yearIdx < 0) continue;

            const idx = regIdx * mults['Region'] + timIdx * mults['Tid'];
            const val = result.value[idx];
            if (val != null) {
                COUNTIES[countyId].befolkning[yearIdx] = val;
                updatedCount++;
            }
        }
    }
    return updatedCount;
}

// ══════════════════════════════════════
// FETCH KOSTRA SECTOR DATA (table 12163)
// Per-innbygger netto driftsutgifter per sektor
// ══════════════════════════════════════
async function fetchSectorSpending() {
    const codes = Object.values(SSB_CODES.kostra);

    // Sector function codes → county data field
    const sectorMap = {
        'FGF7': 'vgoPerInnb',           // Videregående opplæring
        'FGF4': 'samferdselPerInnb',     // Samferdsel
        'FGF8': 'tannhelsePerInnb',      // Tannhelse
        'FGF1b': 'adminPerInnb',         // Administrasjon
        'FGF3': 'kulturPerInnb',         // Kultur
    };

    const result = await fetchSSB('12163', [
        { code: 'KOKfylkesregion0000', selection: { filter: 'item', values: codes } },
        { code: 'KOKfunksjon0000', selection: { filter: 'item', values: Object.keys(sectorMap) } },
        { code: 'KOKart0000', selection: { filter: 'item', values: ['AGD2'] } },  // Netto driftsutgifter
        { code: 'ContentsCode', selection: { filter: 'item', values: ['KOSbelopinnbygge0000'] } },  // Per innbygger
        { code: 'Tid', selection: { filter: 'top', values: ['3'] } },
    ]);

    const dims = result.dimension;
    const dimIds = result.id;
    const sizes = result.size;

    const mults = {};
    for (let i = dimIds.length - 1; i >= 0; i--) {
        mults[dimIds[i]] = i === dimIds.length - 1 ? 1 : mults[dimIds[i + 1]] * sizes[i + 1];
    }

    const regCat = dims['KOKfylkesregion0000'].category;
    const funCat = dims['KOKfunksjon0000'].category;
    const timCat = dims['Tid'].category;

    let updatedCount = 0;
    for (const [regCode, regIdx] of Object.entries(regCat.index)) {
        const countyId = KOSTRA_TO_ID[regCode];
        if (!countyId || !COUNTIES[countyId]) continue;

        for (const [funCode, funIdx] of Object.entries(funCat.index)) {
            const field = sectorMap[funCode];
            if (!field) continue;

            for (const [timCode, timIdx] of Object.entries(timCat.index)) {
                const yearIdx = YEARS.indexOf(parseInt(timCode));
                if (yearIdx < 0) continue;

                const idx = regIdx * mults['KOKfylkesregion0000']
                          + funIdx * mults['KOKfunksjon0000']
                          + timIdx * mults['Tid'];
                const val = result.value[idx];
                if (val != null && COUNTIES[countyId][field]) {
                    COUNTIES[countyId][field][yearIdx] = Math.round(val);
                    updatedCount++;
                }
            }
        }
    }
    return updatedCount;
}

// ══════════════════════════════════════
// MASTER REFRESH
// ══════════════════════════════════════
async function refreshFromSSB() {
    if (fetchStatus === 'fetching') return;
    setFetchStatus('fetching');

    try {
        const results = await Promise.allSettled([
            fetchPopulation(),
            fetchSectorSpending(),
        ]);

        const errors = results.filter(r => r.status === 'rejected');
        if (errors.length === results.length) {
            throw new Error(errors[0].reason.message || 'Alle API-kall feilet');
        }

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const totalUpdated = results
            .filter(r => r.status === 'fulfilled')
            .reduce((sum, r) => sum + r.value, 0);

        lastFetchTime = new Date();

        if (errors.length > 0) {
            const errMsg = errors.map(e => e.reason.message).join('; ');
            setFetchStatus('done'); // partial success
            console.warn('SSB partial refresh, errors:', errMsg);
        } else {
            setFetchStatus('done');
        }

        // Refresh all UI
        updateAllCharts();
        updateHeader();
        updateTable();
        updateOsloBadges();
        if (typeof updateRanking === 'function') updateRanking();

        console.log(`SSB refresh: ${successCount}/${results.length} API-kall OK, ${totalUpdated} datapunkter oppdatert`);
        return { success: successCount, errors: errors.length, updated: totalUpdated };

    } catch (err) {
        console.error('SSB refresh feilet:', err);
        setFetchStatus('error', err.message);
        throw err;
    }
}

// ══════════════════════════════════════
// RANKING ENGINE
// ══════════════════════════════════════
const RANKING_INDICATORS = [
    { id: 'befolkning', label: 'Innbyggertall', unit: '', fmt: v => v.toLocaleString('nb-NO'), yearBased: true },
    { id: 'nettoDriftsresultat', label: 'Netto driftsresultat', unit: '%', fmt: v => `${v.toFixed(1)} %`, yearBased: true, higherBetter: true, osloIncomp: true },
    { id: 'frieInntekterPerInnb', label: 'Frie inntekter per innb.', unit: 'kr', fmt: v => `${v.toLocaleString('nb-NO')} kr`, yearBased: true, osloIncomp: true },
    { id: 'skatteinntekterPerInnb', label: 'Skatteinntekter per innb.', unit: 'kr', fmt: v => `${v.toLocaleString('nb-NO')} kr`, yearBased: true, higherBetter: true, osloIncomp: true },
    { id: 'disposisjonsfond', label: 'Disposisjonsfond', unit: '% av BDI', fmt: v => `${v.toFixed(1)} %`, yearBased: true, higherBetter: true, osloIncomp: true },
    { id: 'nettoLanegjeldPerInnb', label: 'Netto lånegjeld per innb.', unit: 'kr', fmt: v => `${v.toLocaleString('nb-NO')} kr`, yearBased: true, lowerBetter: true, osloIncomp: true },
    { id: 'vgoPerInnb', label: 'VGO per innbygger', unit: 'kr', fmt: v => `${v.toLocaleString('nb-NO')} kr`, yearBased: true },
    { id: 'samferdselPerInnb', label: 'Samferdsel per innbygger', unit: 'kr', fmt: v => `${v.toLocaleString('nb-NO')} kr`, yearBased: true },
    { id: 'tannhelsePerInnb', label: 'Tannhelse per innbygger', unit: 'kr', fmt: v => `${v.toLocaleString('nb-NO')} kr`, yearBased: true },
    { id: 'adminPerInnb', label: 'Administrasjon per innbygger', unit: 'kr', fmt: v => `${v.toLocaleString('nb-NO')} kr`, yearBased: true },
    { id: 'kulturPerInnb', label: 'Kultur per innbygger', unit: 'kr', fmt: v => `${v.toLocaleString('nb-NO')} kr`, yearBased: true },
    { id: 'befolkningstetthet', label: 'Befolkningstetthet', unit: 'innb./km²', fmt: v => `${v.toLocaleString('nb-NO', {maximumFractionDigits:1})} innb./km²`, yearBased: false },
    { id: 'fylkesveiPer1000', label: 'Fylkesvei per 1 000 innb.', unit: 'km', fmt: v => `${v.toFixed(1)} km`, yearBased: false },
    {
        id: 'befolkningsvekst5y',
        label: 'Befolkningsvekst siste 5 år',
        unit: '%',
        fmt: v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`,
        yearBased: false,
        higherBetter: true,
        yearLabel: `${YEARS[YEARS.length - 6]}–${YEARS[YEARS.length - 1]}`,
        getValue: id => {
            const c = COUNTIES[id];
            if (!c) return null;
            const last = c.befolkning[YEARS.length - 1];
            const fiveBack = c.befolkning[YEARS.length - 6];
            if (last == null || fiveBack == null || fiveBack === 0) return null;
            return ((last - fiveBack) / fiveBack) * 100;
        },
    },
    {
        id: 'vgsGjennomforing',
        label: 'VGS fullført og bestått',
        unit: '%',
        fmt: v => `${v.toFixed(1)} %`,
        yearBased: false,
        higherBetter: true,
        yearLabel: VGS_YEARS[VGS_YEARS.length - 1],
        getValue: id => {
            const d = VGS_COMPLETION[id];
            return d ? d[d.length - 1] : null;
        },
    },
];

function getRankingData(indicatorId) {
    const indicator = RANKING_INDICATORS.find(i => i.id === indicatorId);
    if (!indicator) return [];

    const lastIdx = YEARS.length - 1;
    const entries = [];

    for (const [id, county] of Object.entries(COUNTIES)) {
        let value;
        if (indicator.getValue) {
            value = indicator.getValue(id);
        } else if (indicator.yearBased) {
            value = county[indicatorId] ? county[indicatorId][lastIdx] : null;
        } else {
            const m = getStructuralMetrics(id);
            value = m ? m[indicatorId] : null;
        }

        if (value == null) continue;

        entries.push({
            id,
            name: county.name,
            value,
            isOslo: county.isOslo,
            isIncomparable: county.isOslo && indicator.osloIncomp,
            color: COUNTY_COLORS[id].mid,
            borderColor: COUNTY_COLORS[id].main,
            isSelected: selectedCounties.includes(id),
        });
    }

    if (indicator.lowerBetter) {
        entries.sort((a, b) => a.value - b.value);
    } else {
        entries.sort((a, b) => b.value - a.value);
    }

    return entries.map((e, i) => ({ ...e, rank: i + 1 }));
}
