/**
 * Fylkesbarometeret — henting av SSB-tabeller
 *
 * Felles modul for begge stedene tallene hentes fra:
 *   - scripts/fetch-ssb.mjs (Node) skriver data/ssb.json og data/ssb-data.js
 *   - «Oppdater fra SSB»-knappen i nettleseren (api.js, dynamisk import)
 *
 * Før dette lå de to første tabellene i to uavhengige implementasjoner, én i
 * api.js og én i fetch-ssb.mjs. Nå finnes hver tabellspørring én gang, og
 * knappen henter det samme som den månedlige jobben — alle åtte tabellene.
 *
 * Designprinsipper (uendret):
 *  - Metadata-drevet: variabler og koder finnes ved tekst-match mot SSBs
 *    metadata, ikke ved blind hardkoding. Endrer SSB en kode, logges det.
 *  - Feiltolerant: hver tabell hentes i try/catch. En tabell som feiler
 *    etterlater de andre urørt, og kalleren bestemmer hva som skal gjøres.
 *  - Skånsom: sekvensielle kall med pause — godt under 40 kall/minutt.
 *
 * Modulen er ren henting: ingen filskriving, ingen Node-API, ingen DOM.
 */

const API = 'https://data.ssb.no/api/v0/no/table';
const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

// Regionkoder (samme som api.js)
const FYLKE_2DIGIT = {
    vestfold: '39', telemark: '40', ostfold: '31', akershus: '32',
    oslo: '03', buskerud: '33', rogaland: '11', vestland: '46',
    moreogromsdal: '15', trondelag: '50', nordland: '18',
    troms: '55', finnmark: '56', agder: '42', innlandet: '34',
};
const KOSTRA_4DIGIT = Object.fromEntries(
    Object.entries(FYLKE_2DIGIT).map(([id, c]) => [id, c + '00'])
);
const ID_BY_2DIGIT = Object.fromEntries(Object.entries(FYLKE_2DIGIT).map(([k, v]) => [v, k]));
const ID_BY_4DIGIT = Object.fromEntries(Object.entries(KOSTRA_4DIGIT).map(([k, v]) => [v, k]));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Pause mellom kall. Node-skriptet bruker 2 s (rikelig under SSBs grense på
// 30 kall/minutt). Nettleseren kan sette den lavere, siden en bruker venter.
let pauseMs = 2000;
let callCount = 0;

async function ssbGet(tableId) {
    await sleep(callCount++ ? pauseMs : 0);
    const resp = await fetch(`${API}/${tableId}`);
    if (!resp.ok) throw new Error(`GET ${tableId}: HTTP ${resp.status}`);
    return resp.json();
}

async function ssbPost(tableId, query) {
    await sleep(callCount++ ? pauseMs : 0);
    const resp = await fetch(`${API}/${tableId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, response: { format: 'json-stat2' } }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`POST ${tableId}: HTTP ${resp.status} — ${body.substring(0, 300)}`);
    }
    return resp.json();
}

// ── Metadata-hjelpere ─────────────────────────────────────────────

function findVariable(meta, regex) {
    return meta.variables.find(v => regex.test(v.code) || regex.test(v.text));
}

// Finn kode i en variabel der valueText (eller kode) matcher regex.
// Returnerer { code, text } eller null. Logger ved flertydighet.
function findCode(variable, regex, label) {
    const hits = variable.values
        .map((code, i) => ({ code, text: variable.valueTexts[i] }))
        .filter(h => regex.test(h.text) || regex.test(h.code));
    if (hits.length === 0) {
        console.warn(`  ⚠ Fant ingen kode for «${label}» (${regex}) i ${variable.code}`);
        return null;
    }
    if (hits.length > 1) {
        console.warn(`  ⚠ Flere treff for «${label}»: ${hits.map(h => `${h.code}=«${h.text}»`).join(', ')} — bruker første`);
    }
    return hits[0];
}

function findRegionAggregate(regionVar, regex) {
    const i = regionVar.valueTexts.findIndex(t => regex.test(t));
    return i >= 0 ? { code: regionVar.values[i], text: regionVar.valueTexts[i] } : null;
}

// Generisk JSON-stat2-dekoder: kaller visit({dimCode: kategorikode, ...}, verdi)
function decodeJsonStat2(result, visit) {
    const ids = result.id;
    const sizes = result.size;
    const codesByDim = ids.map(dim => {
        const index = result.dimension[dim].category.index;
        const arr = new Array(Object.keys(index).length);
        for (const [code, i] of Object.entries(index)) arr[i] = code;
        return arr;
    });
    for (let flat = 0; flat < result.value.length; flat++) {
        const val = result.value[flat];
        if (val == null) continue;
        const coord = {};
        let rem = flat;
        for (let d = ids.length - 1; d >= 0; d--) {
            coord[ids[d]] = codesByDim[d][rem % sizes[d]];
            rem = Math.floor(rem / sizes[d]);
        }
        visit(coord, val);
    }
}

// ── Output-struktur ───────────────────────────────────────────────

function nyttResultat() {
    return {
    fetchedAt: new Date().toISOString(),
    source: 'Statistisk sentralbyrå (SSB), JSON-stat2 API',
    generator: 'scripts/fetch-ssb.mjs',
    tables: {},        // tabellId → { title, ok, note }
    counties: {},      // countyId → felt → { år: verdi }
    nationalPopulation: {}, // { år: verdi } — hele landet (til per-innb-beregninger)
    nationalAvg: {},   // felt → { år: verdi }  (landet uten Oslo der tilgjengelig)
    nationalAvgScope: null, // 'uten-oslo' | 'landet' | null
    structural: {},    // countyId → { areal, fylkesveiKm, ... }
    roadQuality: {},   // countyId → { år: verdi }
    dentalCoverage: {},
    busPassengers: {},
    vgsCompletion: {},
    notes: [],
    };
}

let OUT = nyttResultat();

function setCounty(bucket, countyId, field, year, value) {
    const b = OUT[bucket];
    if (bucket === 'counties') {
        ((b[countyId] ??= {})[field] ??= {})[year] = value;
    } else {
        (b[countyId] ??= {})[year] = value;
    }
}

// ── Tabellhentere ─────────────────────────────────────────────────

async function fetchBefolkning() {
    const meta = await ssbGet('11342');
    OUT.tables['11342'] = { title: meta.title, ok: false };
    const regionVar = findVariable(meta, /^Region$/i);
    const contents = findVariable(meta, /^ContentsCode$/i);
    const folkemengde = findCode(contents, /^folkemengde$/i, 'Folkemengde');
    const tid = findVariable(meta, /^Tid$/i);
    const years = tid.values.filter(y => YEARS.includes(parseInt(y)));

    const result = await ssbPost('11342', [
        { code: regionVar.code, selection: { filter: 'item', values: ['0', ...Object.values(FYLKE_2DIGIT)] } },
        { code: contents.code, selection: { filter: 'item', values: [folkemengde.code] } },
        { code: tid.code, selection: { filter: 'item', values: years } },
    ]);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        if (val <= 0) return; // SSB gir 0 for år der regionen ikke eksisterte
        const regCode = coord[regionVar.code];
        const year = parseInt(coord[tid.code]);
        if (regCode === '0') { OUT.nationalPopulation[year] = val; return; }
        const id = ID_BY_2DIGIT[regCode];
        if (!id) return;
        setCounty('counties', id, 'befolkning', year, val);
        n++;
    });
    OUT.tables['11342'].ok = true;
    console.log(`  ✓ 11342 befolkning: ${n} datapunkter`);
}

async function fetchSektorutgifter() {
    const meta = await ssbGet('12163');
    OUT.tables['12163'] = { title: meta.title, ok: false };
    const regionVar = findVariable(meta, /region/i);
    const funkVar = findVariable(meta, /funksjon/i);
    const artVar = findVariable(meta, /art/i);
    const contents = findVariable(meta, /^ContentsCode$/i);
    const tid = findVariable(meta, /^Tid$/i);

    const perInnb = findCode(contents, /per innbygg/i, 'Beløp per innbygger');
    const artNetto = findCode(artVar, /^AGD2$|^netto driftsutgifter$/i, 'Netto driftsutgifter');
    const utenOslo = findRegionAggregate(regionVar, /landet uten oslo/i);
    const sectorMap = { FGF7: 'vgoPerInnb', FGF4: 'samferdselPerInnb', FGF8: 'tannhelsePerInnb', FGF1b: 'adminPerInnb', FGF3: 'kulturPerInnb' };

    const regionCodes = [...Object.values(KOSTRA_4DIGIT), ...(utenOslo ? [utenOslo.code] : [])];
    const years = tid.values.filter(y => YEARS.includes(parseInt(y)));

    const result = await ssbPost('12163', [
        { code: regionVar.code, selection: { filter: 'item', values: regionCodes } },
        { code: funkVar.code, selection: { filter: 'item', values: Object.keys(sectorMap) } },
        { code: artVar.code, selection: { filter: 'item', values: [artNetto.code] } },
        { code: contents.code, selection: { filter: 'item', values: [perInnb.code] } },
        { code: tid.code, selection: { filter: 'item', values: years } },
    ]);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const field = sectorMap[coord[funkVar.code]];
        if (!field) return;
        const year = parseInt(coord[tid.code]);
        const regCode = coord[regionVar.code];
        if (utenOslo && regCode === utenOslo.code) {
            (OUT.nationalAvg[field] ??= {})[year] = Math.round(val);
        } else if (ID_BY_4DIGIT[regCode]) {
            setCounty('counties', ID_BY_4DIGIT[regCode], field, year, Math.round(val));
        } else return;
        n++;
    });
    if (utenOslo) OUT.nationalAvgScope = 'uten-oslo';
    OUT.tables['12163'].ok = true;
    console.log(`  ✓ 12163 sektorutgifter: ${n} datapunkter${utenOslo ? ` (landssnitt: ${utenOslo.text})` : ''}`);
}

async function fetchOkonomi() {
    const meta = await ssbGet('13561');
    OUT.tables['13561'] = { title: meta.title, ok: false };
    const regionVar = findVariable(meta, /fylkesregion|region/i);
    const begrepVar = findVariable(meta, /artkap|regnskapsbegrep/i);
    const omfangVar = findVariable(meta, /regnskapsomfa/i);
    const contents = findVariable(meta, /^ContentsCode$/i);
    const tid = findVariable(meta, /^Tid$/i);

    // 13561 gir beløp (1000 kr) per regnskapsbegrep — nøkkeltallene beregnes:
    //   AGD13 Brutto driftsinntekter i alt, AGD23 Netto driftsresultat,
    //   56 Disposisjonsfond, KG117 Netto lånegjeld, AG11 Frie inntekter,
    //   AG12 Skatt på inntekt og formue inkl. naturressursskatt
    const BEGREP = ['AGD13', 'AGD23', '56', 'KG117', 'AG11', 'AG12'];
    const wanted = BEGREP.filter(c => begrepVar.values.includes(c));
    if (wanted.length < BEGREP.length) {
        OUT.notes.push(`13561: mangler begrepskoder ${BEGREP.filter(c => !wanted.includes(c)).join(', ')}`);
    }
    const konsern = findCode(omfangVar, /konsolider/i, 'Konsolidert regnskap');
    if (!konsern) throw new Error('13561: fant ikke konsolidert regnskapsomfang');

    // Merk (undersøkt 2026-07): region-dimensjonen har verken egen kode for
    // fylkesdelen av Oslo eller «landet uten Oslo»-aggregat — 0300 er hele
    // Oslo kommune. Landssnitt uten Oslo beregnes derfor fra fylkessummene.
    const years = tid.values.filter(y => YEARS.includes(parseInt(y)));
    const result = await ssbPost('13561', [
        { code: regionVar.code, selection: { filter: 'item', values: regionVar.values } },
        { code: begrepVar.code, selection: { filter: 'item', values: wanted } },
        { code: omfangVar.code, selection: { filter: 'item', values: [konsern.code] } },
        { code: contents.code, selection: { filter: 'item', values: [contents.values[0]] } },
        { code: tid.code, selection: { filter: 'item', values: years } },
    ]);

    // raw[regionCode][år][begrep] = beløp (1000 kr)
    const raw = {};
    decodeJsonStat2(result, (coord, val) => {
        const reg = coord[regionVar.code];
        const year = parseInt(coord[tid.code]);
        ((raw[reg] ??= {})[year] ??= {})[coord[begrepVar.code]] = val;
    });

    const round1 = x => Math.round(x * 10) / 10;
    const deriveFields = (b, pop) => {
        const out = {};
        if (b.AGD13 > 0) {
            out.bruttoDriftsinntekter = Math.round(b.AGD13 / 1000); // mill. kr
            if (b.AGD23 != null) out.nettoDriftsresultat = round1(b.AGD23 / b.AGD13 * 100);
            if (b['56'] != null) out.disposisjonsfond = round1(b['56'] / b.AGD13 * 100);
        }
        if (pop > 0) {
            if (b.AG11 != null) out.frieInntekterPerInnb = Math.round(b.AG11 * 1000 / pop);
            if (b.KG117 != null) out.nettoLanegjeldPerInnb = Math.round(b.KG117 * 1000 / pop);
            if (b.AG12 != null) out.skatteinntekterPerInnb = Math.round(b.AG12 * 1000 / pop);
        }
        return out;
    };

    let n = 0;
    const sums = {}; // år → begrep → sum uten Oslo (inkl. sammenslåtte enheter — splittede er null da)
    for (const [reg, byYear] of Object.entries(raw)) {
        const id = ID_BY_4DIGIT[reg];
        for (const [yearStr, b] of Object.entries(byYear)) {
            const year = parseInt(yearStr);
            if (reg !== KOSTRA_4DIGIT.oslo) {
                const s = (sums[year] ??= {});
                for (const [code, val] of Object.entries(b)) s[code] = (s[code] ?? 0) + val;
            }
            if (!id) continue;
            const pop = OUT.counties[id]?.befolkning?.[year];
            for (const [field, val] of Object.entries(deriveFields(b, pop))) {
                setCounty('counties', id, field, year, val);
                n++;
            }
        }
    }

    // Landssnitt uten Oslo (befolkning: hele landet minus Oslo, fra 11342)
    for (const [yearStr, b] of Object.entries(sums)) {
        const year = parseInt(yearStr);
        const popUO = (OUT.nationalPopulation[year] ?? 0) - (OUT.counties.oslo?.befolkning?.[year] ?? 0);
        for (const [field, val] of Object.entries(deriveFields(b, popUO))) {
            if (field === 'bruttoDriftsinntekter') continue; // sum, ikke snitt — ikke relevant som referanselinje
            (OUT.nationalAvg[field] ??= {})[year] = val;
        }
    }
    OUT.nationalAvgScope = 'uten-oslo';
    OUT.notes.push('13561: ingen egen region for fylkesdelen av Oslo — 0300 er hele Oslo kommune. Landssnitt uten Oslo er beregnet fra fylkessummer.');
    OUT.tables['13561'].ok = true;
    console.log(`  ✓ 13561 økonomi: ${n} datapunkter (begreper: ${wanted.join(', ')})`);
}

async function fetchAreal() {
    const meta = await ssbGet('09280');
    OUT.tables['09280'] = { title: meta.title, ok: false };
    const regionVar = findVariable(meta, /^Region$/i);
    const contents = findVariable(meta, /^ContentsCode$/i);
    const tid = findVariable(meta, /^Tid$/i);
    const lastYear = tid.values[tid.values.length - 1];

    // Landareal ligger i egen arealtype-dimensjon; ContentsCode er «Areal (km²)»
    const arealtypeVar = meta.variables.find(v => /arealtype/i.test(v.code) || /arealtype/i.test(v.text));
    const query = [
        { code: regionVar.code, selection: { filter: 'item', values: Object.values(FYLKE_2DIGIT) } },
        { code: tid.code, selection: { filter: 'item', values: [lastYear] } },
    ];
    if (arealtypeVar) {
        const landareal = findCode(arealtypeVar, /^landareal$|landareal/i, 'Landareal');
        if (!landareal) throw new Error('09280: fant ikke landareal-kode i arealtype');
        query.push({ code: arealtypeVar.code, selection: { filter: 'item', values: [landareal.code] } });
    }
    if (contents.values.length === 1) {
        query.push({ code: contents.code, selection: { filter: 'item', values: [contents.values[0]] } });
    } else {
        const areal = findCode(contents, /areal/i, 'Areal');
        if (!areal) throw new Error('09280: fant ikke areal-innholdskode');
        query.push({ code: contents.code, selection: { filter: 'item', values: [areal.code] } });
    }
    const result = await ssbPost('09280', query);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const id = ID_BY_2DIGIT[coord[regionVar.code]];
        if (!id) return;
        (OUT.structural[id] ??= {}).areal = Math.round(val);
        n++;
    });
    OUT.tables['09280'].ok = true;
    console.log(`  ✓ 09280 areal (${lastYear}): ${n} fylker`);
}

async function fetchVei() {
    const meta = await ssbGet('11842');
    OUT.tables['11842'] = { title: meta.title, ok: false };
    const regionVar = findVariable(meta, /region/i);
    const contents = findVariable(meta, /^ContentsCode$/i);
    const tid = findVariable(meta, /^Tid$/i);

    // Eksakte innholdskoder (bekreftet via --probe 2026-07)
    const fieldSpecs = [
        ['fylkesveiKm', /^KOSfylkesveier0000$/, 'structuralLatest'],
        ['bruer', /^KOSbruertotalt0000$/, 'structuralLatest'],
        ['tunnelerKm', /^KOSkmtunneler0000$/, 'structuralLatest'],
        ['darligDekke', /^KOSandeldaarligd0000$/, 'roadQuality'],
    ];
    const codeToSpec = {};
    const wanted = [];
    for (const [field, re, target] of fieldSpecs) {
        const hit = findCode(contents, re, field);
        if (hit) { codeToSpec[hit.code] = { field, target }; wanted.push(hit.code); }
    }
    if (wanted.length === 0) throw new Error('11842: ingen innholdskoder matchet');
    const years = tid.values.filter(y => YEARS.includes(parseInt(y)));
    const lastYear = Math.max(...years.map(Number));
    const utenOslo = findRegionAggregate(regionVar, /landet uten oslo/i);

    const result = await ssbPost('11842', [
        { code: regionVar.code, selection: { filter: 'item', values: [...Object.values(KOSTRA_4DIGIT), ...(utenOslo ? [utenOslo.code] : [])] } },
        { code: contents.code, selection: { filter: 'item', values: wanted } },
        { code: tid.code, selection: { filter: 'item', values: years } },
    ]);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const spec = codeToSpec[coord[contents.code]];
        if (!spec) return;
        const regCode = coord[regionVar.code];
        const year = parseInt(coord[tid.code]);
        if (utenOslo && regCode === utenOslo.code) {
            if (spec.target === 'roadQuality') { setCounty('roadQuality', '_landssnitt', null, year, val); n++; }
            return;
        }
        const id = ID_BY_4DIGIT[regCode];
        if (!id) return;
        if (spec.target === 'structuralLatest') {
            if (year === lastYear) { (OUT.structural[id] ??= {})[spec.field] = Math.round(val); n++; }
        } else {
            setCounty('roadQuality', id, null, year, val);
            n++;
        }
    });
    OUT.tables['11842'].ok = true;
    console.log(`  ✓ 11842 vei: ${n} datapunkter`);
}

async function fetchTannhelseDekning() {
    const meta = await ssbGet('11961');
    OUT.tables['11961'] = { title: meta.title, ok: false };
    const regionVar = findVariable(meta, /region/i);
    const contents = findVariable(meta, /^ContentsCode$/i);
    const tid = findVariable(meta, /^Tid$/i);

    // «Andel undersøkt/behandlet (prosent)» — eksakt kode bekreftet via --probe
    const andel = findCode(contents, /^KOSandelundersok0000$/, 'Andel undersøkt');
    if (!andel) throw new Error('11961: fant ikke andel-undersøkt-kode');
    const utenOslo = findRegionAggregate(regionVar, /landet uten oslo/i);

    // Pasientgruppe-dimensjon (barn 3–18 år), hvis den finnes
    const gruppeVar = meta.variables.find(v => /pasient|gruppe/i.test(v.code) || /pasient|gruppe/i.test(v.text));
    const query = [
        { code: regionVar.code, selection: { filter: 'item', values: [...Object.values(KOSTRA_4DIGIT), ...(utenOslo ? [utenOslo.code] : [])] } },
        { code: contents.code, selection: { filter: 'item', values: [andel.code] } },
        { code: tid.code, selection: { filter: 'item', values: tid.values.filter(y => parseInt(y) >= 2020) } },
    ];
    if (gruppeVar) {
        const barn = findCode(gruppeVar, /3.?[-–].?18|barn og ung/i, 'Barn 3–18 år');
        if (barn) query.push({ code: gruppeVar.code, selection: { filter: 'item', values: [barn.code] } });
    }
    const result = await ssbPost('11961', query);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const regCode = coord[regionVar.code];
        const id = (utenOslo && regCode === utenOslo.code) ? '_landssnitt' : ID_BY_4DIGIT[regCode];
        if (!id) return;
        setCounty('dentalCoverage', id, null, parseInt(coord[tid.code]), val);
        n++;
    });
    OUT.tables['11961'].ok = true;
    console.log(`  ✓ 11961 tannhelse dekning: ${n} datapunkter`);
}

async function fetchBuss() {
    const meta = await ssbGet('11844');
    OUT.tables['11844'] = { title: meta.title, ok: false };
    const regionVar = findVariable(meta, /region/i);
    const contents = findVariable(meta, /^ContentsCode$/i);
    const tid = findVariable(meta, /^Tid$/i);
    // «Passasjerer, buss (antall)» — eksakt kode bekreftet via --probe
    const passasjerer = findCode(contents, /^KOSpassasjerbuss0000$/, 'Passasjerer buss');
    if (!passasjerer) throw new Error('11844: fant ikke passasjer-kode');
    // _landssnitt-serien er nasjonal totalsum (inkl. Oslo) → bruk «Landet»
    const landet = findRegionAggregate(regionVar, /^landet$/i);

    const result = await ssbPost('11844', [
        { code: regionVar.code, selection: { filter: 'item', values: [...Object.values(KOSTRA_4DIGIT), ...(landet ? [landet.code] : [])] } },
        { code: contents.code, selection: { filter: 'item', values: [passasjerer.code] } },
        { code: tid.code, selection: { filter: 'item', values: tid.values.filter(y => parseInt(y) >= 2020) } },
    ]);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const regCode = coord[regionVar.code];
        const id = (landet && regCode === landet.code) ? '_landssnitt' : ID_BY_4DIGIT[regCode];
        if (!id) return;
        setCounty('busPassengers', id, null, parseInt(coord[tid.code]), val);
        n++;
    });
    OUT.tables['11844'].ok = true;
    console.log(`  ✓ 11844 busspassasjerer: ${n} datapunkter`);
}

async function fetchVgsGjennomforing() {
    const meta = await ssbGet('12971');
    OUT.tables['12971'] = { title: meta.title, ok: false };
    const regionVar = findVariable(meta, /region/i);
    const contents = findVariable(meta, /^ContentsCode$/i);
    const tid = findVariable(meta, /^Tid$/i);

    // NB (undersøkt 2026-07): region-dimensjonen mangler de nye fylkene fra
    // 2024 (kun 03, 11, 15, 18, 50 av dagens fylker finnes). Vi henter det som
    // finnes; øvrige fylker beholder innebygde verdier (estimater).
    const regionCodes = Object.values(FYLKE_2DIGIT).filter(c => regionVar.values.includes(c));
    const iAlt = findRegionAggregate(regionVar, /^i alt$/i);
    const missing = Object.entries(FYLKE_2DIGIT).filter(([, c]) => !regionVar.values.includes(c)).map(([id]) => id);
    if (missing.length) OUT.notes.push(`12971: mangler regionkoder for ${missing.join(', ')} — beholder innebygde verdier der`);

    const andel = findCode(contents, /^Prosent$|andel/i, 'Andel (prosent)');
    // «Fullført og bestått innen 5/6 år» = fullført på normert tid + mer enn normert tid
    const fullfortVar = meta.variables.find(v => /fullf/i.test(v.code) || /fullføringsgrad/i.test(v.text));
    const bestatt = fullfortVar
        ? fullfortVar.values.filter((c, i) => /fullført med studie- eller yrkeskompetanse/i.test(fullfortVar.valueTexts[i]))
        : [];
    if (!andel || bestatt.length === 0) throw new Error('12971: fant ikke andel-/fullført-koder');

    const query = [
        { code: regionVar.code, selection: { filter: 'item', values: [...regionCodes, ...(iAlt ? [iAlt.code] : [])] } },
        { code: fullfortVar.code, selection: { filter: 'item', values: bestatt } },
        { code: contents.code, selection: { filter: 'item', values: [andel.code] } },
        { code: tid.code, selection: { filter: 'all', values: ['*'] } },
    ];
    // Aggregér over utdanningsprogram/kjønn ved å velge totalkategoriene
    for (const [re, label] of [[/utdprogram|utdanningsprogram/i, /^alle/i], [/^Kjonn$|kjønn/i, /^begge/i]]) {
        const v = meta.variables.find(x => re.test(x.code) || re.test(x.text));
        if (v) {
            const tot = findCode(v, label, `totalkategori ${v.code}`);
            if (tot) query.push({ code: v.code, selection: { filter: 'item', values: [tot.code] } });
        }
    }

    const result = await ssbPost('12971', query);
    // Summér de to fullført-kategoriene per region/år
    const acc = {};
    decodeJsonStat2(result, (coord, val) => {
        const regCode = coord[regionVar.code];
        const id = (iAlt && regCode === iAlt.code) ? '_landssnitt' : ID_BY_2DIGIT[regCode];
        if (!id) return;
        // Tid er kullets spenn («2019-2025»); barometerets årstall = startår + 5
        const start = parseInt(String(coord[tid.code]).substring(0, 4));
        if (!Number.isFinite(start)) return;
        const key = `${id}|${start + 5}`;
        acc[key] = (acc[key] ?? 0) + val;
    });
    let n = 0;
    for (const [key, val] of Object.entries(acc)) {
        const [id, year] = key.split('|');
        setCounty('vgsCompletion', id, null, parseInt(year), Math.round(val * 10) / 10);
        n++;
    }
    OUT.tables['12971'].ok = true;
    console.log(`  ✓ 12971 VGS gjennomføring: ${n} datapunkter (${regionCodes.length} fylker + landssnitt)`);
}
// ── Hovedløp ──────────────────────────────────────────────────────

export const TABELLER = [
    ['11342 befolkning', fetchBefolkning],
    ['12163 sektorutgifter', fetchSektorutgifter],
    ['13561 økonomi', fetchOkonomi],
    ['09280 areal', fetchAreal],
    ['11842 vei', fetchVei],
    ['11961 tannhelse dekning', fetchTannhelseDekning],
    ['11844 busspassasjerer', fetchBuss],
    ['12971 VGS gjennomføring', fetchVgsGjennomforing],
];

let pagar = false;

/**
 * Henter alle tabellene sekvensielt og returnerer resultatet.
 *
 * Rekkefølgen er ikke tilfeldig: fetchOkonomi regner per innbygger og leser
 * befolkningstallene fetchBefolkning la inn. Ikke gjør dette parallelt.
 *
 * @param {object}   [valg]
 * @param {number}   [valg.pause]      millisekunder mellom API-kall
 * @param {function} [valg.onProgress] (steg, antall, navn) — kalles før hver tabell
 * @returns {Promise<{data: object, ok: number, antall: number, feil: string[]}>}
 */
export async function hentAlt({ pause = 2000, onProgress } = {}) {
    if (pagar) throw new Error('En henting pågår allerede');
    pagar = true;
    pauseMs = pause;
    callCount = 0;
    OUT = nyttResultat();

    const feil = [];
    let ok = 0;
    try {
        for (let i = 0; i < TABELLER.length; i++) {
            const [navn, fn] = TABELLER[i];
            if (onProgress) onProgress(i, TABELLER.length, navn);
            try {
                await fn();
                ok++;
            } catch (e) {
                const melding = `${navn}: ${e.message}`;
                feil.push(melding);
                OUT.notes.push(`FEILET: ${melding}`);
                console.error(`  ✗ ${melding}`);
            }
        }
    } finally {
        pagar = false;
    }
    return { data: OUT, ok, antall: TABELLER.length, feil };
}

// Eksporteres for --probe i scripts/fetch-ssb.mjs.
export { ssbGet, YEARS };
