#!/usr/bin/env node
/**
 * Fylkesbarometeret — automatisk datahenting fra SSB
 *
 * Henter tall fra SSBs JSON-stat2 API (data.ssb.no) og skriver:
 *   data/ssb.json     — rådata/overlegg som JSON (diff-bar i git)
 *   data/ssb-data.js  — samme innhold som window.SSB_DATA for nettleseren
 *
 * Kjøres av .github/workflows/update-data.yml (månedlig + manuelt).
 * Lokal kjøring: node scripts/fetch-ssb.mjs [--probe]
 *   --probe: skriv kun ut metadata (dimensjoner og koder) for alle tabeller.
 *
 * Designprinsipper:
 *  - Metadata-drevet: variabler og koder finnes ved tekst-match mot SSBs
 *    metadata, ikke ved blind hardkoding. Endrer SSB en kode, logges det.
 *  - Feiltolerant: hver tabell hentes i try/catch. Delvis feilet kjøring
 *    flettes over forrige data/ssb.json og sletter aldri gode data.
 *  - Skånsom: sekvensielle kall med pause — godt under 40 kall/minutt.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://data.ssb.no/api/v0/no/table';
const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const PROBE = process.argv.includes('--probe');

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
let callCount = 0;

async function ssbGet(tableId) {
    await sleep(callCount++ ? 2000 : 0);
    const resp = await fetch(`${API}/${tableId}`);
    if (!resp.ok) throw new Error(`GET ${tableId}: HTTP ${resp.status}`);
    return resp.json();
}

async function ssbPost(tableId, query) {
    await sleep(callCount++ ? 2000 : 0);
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

const OUT = {
    fetchedAt: new Date().toISOString(),
    source: 'Statistisk sentralbyrå (SSB), JSON-stat2 API',
    generator: 'scripts/fetch-ssb.mjs',
    tables: {},        // tabellId → { title, ok, note }
    counties: {},      // countyId → felt → { år: verdi }
    nationalAvg: {},   // felt → { år: verdi }  (landet uten Oslo der tilgjengelig)
    nationalAvgScope: null, // 'uten-oslo' | 'landet' | null
    structural: {},    // countyId → { areal, fylkesveiKm, ... }
    roadQuality: {},   // countyId → { år: verdi }
    dentalCoverage: {},
    busPassengers: {},
    vgsCompletion: {},
    notes: [],
};

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
        { code: regionVar.code, selection: { filter: 'item', values: Object.values(FYLKE_2DIGIT) } },
        { code: contents.code, selection: { filter: 'item', values: [folkemengde.code] } },
        { code: tid.code, selection: { filter: 'item', values: years } },
    ]);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const id = ID_BY_2DIGIT[coord[regionVar.code]];
        if (!id) return;
        if (val <= 0) return; // SSB gir 0 for år der regionen ikke eksisterte
        setCounty('counties', id, 'befolkning', parseInt(coord[tid.code]), val);
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
    const regionVar = findVariable(meta, /region/i);
    const contents = findVariable(meta, /^ContentsCode$/i);
    const tid = findVariable(meta, /^Tid$/i);

    // Feltmapping: match mot innholds-tekster i metadata
    const fieldSpecs = [
        ['nettoDriftsresultat', /netto driftsresultat.*prosent/i],
        ['frieInntekterPerInnb', /frie inntekter.*per innbygg/i],
        ['disposisjonsfond', /disposisjonsfond.*prosent/i],
        ['nettoLanegjeldPerInnb', /netto lånegjeld.*per innbygg/i],
        ['bruttoDriftsinntekter', /brutto driftsinntekter/i],
        ['skatteinntekterPerInnb', /skatt på inntekt og formue.*per innbygg/i],
    ];
    const codeToField = {};
    const wanted = [];
    for (const [field, re] of fieldSpecs) {
        const hit = findCode(contents, re, field);
        if (hit) { codeToField[hit.code] = field; wanted.push(hit.code); }
    }
    if (wanted.length === 0) throw new Error('13561: ingen innholdskoder matchet');

    // Oslo-probe: finnes en egen region for fylkesdelen av Oslo?
    const osloRegions = regionVar.valueTexts
        .map((t, i) => ({ code: regionVar.values[i], text: t }))
        .filter(r => /oslo/i.test(r.text));
    OUT.notes.push(`13561 Oslo-regioner: ${osloRegions.map(r => `${r.code}=«${r.text}»`).join(', ') || 'ingen'}`);
    const utenOslo = findRegionAggregate(regionVar, /landet uten oslo/i);

    const regionCodes = [...Object.values(KOSTRA_4DIGIT), ...(utenOslo ? [utenOslo.code] : [])];
    const years = tid.values.filter(y => YEARS.includes(parseInt(y)));

    const result = await ssbPost('13561', [
        { code: regionVar.code, selection: { filter: 'item', values: regionCodes } },
        { code: contents.code, selection: { filter: 'item', values: wanted } },
        { code: tid.code, selection: { filter: 'item', values: years } },
    ]);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const field = codeToField[coord[contents.code]];
        if (!field) return;
        const year = parseInt(coord[tid.code]);
        const regCode = coord[regionVar.code];
        const v = ['nettoDriftsresultat', 'disposisjonsfond'].includes(field) ? val : Math.round(val);
        if (utenOslo && regCode === utenOslo.code) {
            (OUT.nationalAvg[field] ??= {})[year] = v;
        } else if (ID_BY_4DIGIT[regCode]) {
            setCounty('counties', ID_BY_4DIGIT[regCode], field, year, v);
        } else return;
        n++;
    });
    if (utenOslo) OUT.nationalAvgScope = 'uten-oslo';
    OUT.tables['13561'].ok = true;
    console.log(`  ✓ 13561 økonomi: ${n} datapunkter (felter: ${Object.values(codeToField).join(', ')})`);
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

    const fieldSpecs = [
        // fylkesveiKm: riktig innholdskode bekreftes via --probe før mapping aktiveres
        ['darligDekke', /dårlig.*dekke/i, 'roadQuality'],
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

    const result = await ssbPost('11842', [
        { code: regionVar.code, selection: { filter: 'item', values: Object.values(KOSTRA_4DIGIT) } },
        { code: contents.code, selection: { filter: 'item', values: wanted } },
        { code: tid.code, selection: { filter: 'item', values: years } },
    ]);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const spec = codeToSpec[coord[contents.code]];
        const id = ID_BY_4DIGIT[coord[regionVar.code]];
        if (!spec || !id) return;
        const year = parseInt(coord[tid.code]);
        if (spec.target === 'structuralLatest') {
            if (year === lastYear) { (OUT.structural[id] ??= {}).fylkesveiKm = Math.round(val); n++; }
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

    // Andel (prosent) undersøkt/behandlet — må matche «andel», ellers får vi antall
    const andel = findCode(contents, /andel.*(undersøkt|behandlet)/i, 'Andel undersøkt');
    if (!andel) throw new Error('11961: fant ikke andel-undersøkt-kode');

    // Pasientgruppe-dimensjon (barn 3–18 år), hvis den finnes
    const gruppeVar = meta.variables.find(v => /pasient|gruppe/i.test(v.code) || /pasient|gruppe/i.test(v.text));
    const query = [
        { code: regionVar.code, selection: { filter: 'item', values: Object.values(KOSTRA_4DIGIT) } },
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
        const id = ID_BY_4DIGIT[coord[regionVar.code]];
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
    const passasjerer = findCode(contents, /passasjerer/i, 'Passasjerer');
    if (!passasjerer) throw new Error('11844: fant ikke passasjer-kode');

    const result = await ssbPost('11844', [
        { code: regionVar.code, selection: { filter: 'item', values: Object.values(KOSTRA_4DIGIT) } },
        { code: contents.code, selection: { filter: 'item', values: [passasjerer.code] } },
        { code: tid.code, selection: { filter: 'item', values: tid.values.filter(y => parseInt(y) >= 2020) } },
    ]);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const id = ID_BY_4DIGIT[coord[regionVar.code]];
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

    const andel = findCode(contents, /andel/i, 'Andel');
    const fullfortVar = meta.variables.find(v => /fullf|gjennomf/i.test(v.code) || /fullf|gjennomf/i.test(v.text));
    OUT.notes.push(`12971 Tid-koder: ${tid.values.join(', ')}`);

    const query = [
        { code: regionVar.code, selection: { filter: 'item', values: Object.values(FYLKE_2DIGIT) } },
        { code: tid.code, selection: { filter: 'all', values: ['*'] } },
    ];
    if (andel) query.push({ code: contents.code, selection: { filter: 'item', values: [andel.code] } });
    if (fullfortVar) {
        const bestatt = findCode(fullfortVar, /fullført og bestått/i, 'Fullført og bestått');
        if (bestatt) query.push({ code: fullfortVar.code, selection: { filter: 'item', values: [bestatt.code] } });
    }
    const result = await ssbPost('12971', query);
    let n = 0;
    decodeJsonStat2(result, (coord, val) => {
        const id = ID_BY_2DIGIT[coord[regionVar.code]];
        if (!id) return;
        // Tid kan være kullets startår («2019») eller spenn («2019-2025»).
        // Publiseringsår i barometeret = startår + 5.
        const start = parseInt(String(coord[tid.code]).substring(0, 4));
        if (!Number.isFinite(start)) return;
        setCounty('vgsCompletion', id, null, start + 5, val);
        n++;
    });
    OUT.tables['12971'].ok = true;
    console.log(`  ✓ 12971 VGS gjennomføring: ${n} datapunkter`);
}

// ── Probe-modus ───────────────────────────────────────────────────

async function probe() {
    const tables = ['11342', '12163', '13561', '09280', '11842', '11961', '11844', '12971'];
    for (const t of tables) {
        try {
            const meta = await ssbGet(t);
            console.log(`\n═══ ${t}: ${meta.title}`);
            for (const v of meta.variables) {
                console.log(`  ${v.code} («${v.text}»), ${v.values.length} koder${v.elimination ? ' [kan utelates]' : ''}`);
                const show = Math.min(v.values.length, 120);
                for (let i = 0; i < show; i++) console.log(`      ${v.values[i]} = ${v.valueTexts[i]}`);
                if (v.values.length > show) console.log(`      … og ${v.values.length - show} til`);
            }
        } catch (e) {
            console.error(`  ✗ ${t}: ${e.message}`);
        }
    }
}

// ── Hovedløp ──────────────────────────────────────────────────────

async function main() {
    if (PROBE) return probe();

    const steps = [
        ['11342 befolkning', fetchBefolkning],
        ['12163 sektorutgifter', fetchSektorutgifter],
        ['13561 økonomi', fetchOkonomi],
        ['09280 areal', fetchAreal],
        ['11842 vei', fetchVei],
        ['11961 tannhelse dekning', fetchTannhelseDekning],
        ['11844 busspassasjerer', fetchBuss],
        ['12971 VGS gjennomføring', fetchVgsGjennomforing],
    ];
    let okCount = 0;
    for (const [name, fn] of steps) {
        console.log(`Henter ${name} …`);
        try {
            await fn();
            okCount++;
        } catch (e) {
            console.error(`  ✗ ${name}: ${e.message}`);
            OUT.notes.push(`FEILET: ${name}: ${e.message}`);
        }
    }

    if (okCount === 0) {
        console.error('Alle tabellhentinger feilet — skriver ingen filer.');
        process.exit(1);
    }

    // Flett over forrige kjøring så delvise feil ikke sletter gode data
    const jsonPath = join(ROOT, 'data', 'ssb.json');
    let merged = OUT;
    try {
        const prev = JSON.parse(readFileSync(jsonPath, 'utf8'));
        merged = deepMerge(prev, OUT);
    } catch { /* første kjøring */ }

    mkdirSync(join(ROOT, 'data'), { recursive: true });
    const json = JSON.stringify(merged, null, 1);
    writeFileSync(jsonPath, json + '\n');
    writeFileSync(join(ROOT, 'data', 'ssb-data.js'),
        '// Generert av scripts/fetch-ssb.mjs — ikke rediger manuelt.\n' +
        'window.SSB_DATA = ' + json + ';\n');
    console.log(`\nSkrev data/ssb.json og data/ssb-data.js (${okCount}/${steps.length} tabeller OK)`);
    if (merged.notes?.length) console.log('Merknader:\n  ' + merged.notes.join('\n  '));
}

function deepMerge(base, over) {
    if (Array.isArray(over) || typeof over !== 'object' || over === null) return over;
    if (typeof base !== 'object' || base === null || Array.isArray(base)) return over;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
        if (k === 'notes') { out[k] = v; continue; } // merknader gjelder siste kjøring
        out[k] = deepMerge(base[k], v);
    }
    return out;
}

main().catch(e => { console.error(e); process.exit(1); });
