/**
 * Fylkesbarometeret — «Oppdater fra SSB»-knappen og rangeringsmotoren
 *
 * Knappen henter alle åtte SSB-tabellene på nytt, i nettleseren, ved hjelp av
 * den samme modulen den månedlige jobben bruker (../ssb-tabeller.mjs — samme
 * mappe, lastes ved klikk). Tallene legges oppå de innebygde med
 * applySsbOverlay() i data.js, og lever bare i denne fanen: ved reload er de
 * genererte månedstallene tilbake.
 */

// ── Fetch status ──
let lastFetchTime = null;
let fetchStatus = 'idle'; // 'idle' | 'fetching' | 'done' | 'error'
let fetchError = null;
let fetchProgress = '';   // «3/8 tabeller» mens hentingen pågår

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
        status.textContent = fetchProgress;
        status.className = 'refresh-status';
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
        status.textContent = (typeof SSB_FETCHED_AT !== 'undefined' && SSB_FETCHED_AT)
            ? 'Grunndata fra SSB (oppdateres månedlig)'
            : 'Statiske data (innebygd)';
        status.className = 'refresh-status';
    }
}

// ══════════════════════════════════════
// OPPDATER FRA SSB
// Henter alle tabellene på nytt via fellesmodulen, og legger dem oppå de
// innebygde tallene. Resultatet lever i denne fanen — ingenting lagres.
// ══════════════════════════════════════
async function refreshFromSSB() {
    if (fetchStatus === 'fetching') return;
    fetchProgress = '';
    setFetchStatus('fetching');

    try {
        // Lastes ved klikk, ikke ved sidelast: modulen trengs bare her.
        // ?v= følger script-taggene i index.html — hold tallene i takt.
        const { hentAlt } = await import('./ssb-tabeller.mjs?v=15');

        // Kortere pause enn den månedlige jobben, siden noen står og venter.
        // Åtte tabeller er 16 kall — fortsatt godt under SSBs 30 per minutt.
        const { data, ok, antall, feil } = await hentAlt({
            pause: 900,
            onProgress: (i, n, navn) => {
                fetchProgress = `${i + 1}/${n} — ${navn.replace(/^\d+ /, '')} …`;
                updateFetchUI();
            },
        });

        if (ok === 0) throw new Error(feil[0] || 'Alle tabellhentinger feilet');

        // Samme overlegg som ved sidelast, nå med ferske tall.
        applySsbOverlay(data);
        lastFetchTime = new Date();
        fetchProgress = '';
        setFetchStatus('done');

        updateAllCharts();
        updateHeader();
        updateTable();
        updateOsloBadges();
        if (typeof updateRanking === 'function') updateRanking();

        if (feil.length) {
            console.warn('SSB: delvis henting —', feil.join('; '));
            const status = document.getElementById('refresh-status');
            if (status) status.textContent = `Hentet ${ok} av ${antall} tabeller`;
        }
        console.log(`SSB: ${ok}/${antall} tabeller hentet`);
        return { ok, antall, feil };

    } catch (err) {
        console.error('SSB-oppdatering feilet:', err);
        fetchProgress = '';
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
    { id: 'befolkningsvekst5y', label: 'Befolkningsvekst siste 5 år', unit: '%', fmt: v => `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`, yearBased: false, higherBetter: true, yearLabel: '2019–2025' },
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
