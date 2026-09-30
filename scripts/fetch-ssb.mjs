#!/usr/bin/env node
/**
 * Fylkesbarometeret — automatisk datahenting fra SSB
 *
 * Henter tall fra SSBs JSON-stat2 API (data.ssb.no) og skriver:
 *   data/ssb.json     — rådata/overlegg som JSON (diff-bar i git)
 *   data/ssb-data.js  — samme innhold som window.SSB_DATA for nettleseren
 *
 * Selve hentingen ligger i ../ssb-tabeller.mjs, som deles med
 * «Oppdater fra SSB»-knappen i nettleseren. Dette skriptet er Node-delen:
 * kommandolinje, filskriving og fletting mot forrige kjøring.
 *
 * Kjøres månedlig av cron på hjemmeserveren (oppdater_fylkesbarometeret.sh),
 * som også publiserer siden. Workflowen i .github/ kan startes manuelt.
 * Lokal kjøring: node scripts/fetch-ssb.mjs [--probe]
 *   --probe: skriv kun ut metadata (dimensjoner og koder) for alle tabeller.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hentAlt, ssbGet, TABELLER } from '../ssb-tabeller.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = process.argv.includes('--probe');

// ── Probe-modus ───────────────────────────────────────────────────

async function probe() {
    for (const [navn] of TABELLER) {
        const t = navn.split(' ')[0];
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

    const { data, ok, antall } = await hentAlt({
        pause: 2000,
        onProgress: (i, n, navn) => console.log(`Henter ${navn} …`),
    });

    if (ok === 0) {
        console.error('Alle tabellhentinger feilet — skriver ingen filer.');
        process.exit(1);
    }

    // Flett over forrige kjøring så delvise feil ikke sletter gode data
    const jsonPath = join(ROOT, 'data', 'ssb.json');
    let merged = data;
    try {
        const prev = JSON.parse(readFileSync(jsonPath, 'utf8'));
        merged = deepMerge(prev, data);
    } catch { /* første kjøring */ }

    mkdirSync(join(ROOT, 'data'), { recursive: true });
    const json = JSON.stringify(merged, null, 1);
    writeFileSync(jsonPath, json + '\n');
    writeFileSync(join(ROOT, 'data', 'ssb-data.js'),
        '// Generert av scripts/fetch-ssb.mjs — ikke rediger manuelt.\n' +
        'window.SSB_DATA = ' + json + ';\n');
    console.log(`\nSkrev data/ssb.json og data/ssb-data.js (${ok}/${antall} tabeller OK)`);
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
