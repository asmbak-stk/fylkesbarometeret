# Fylkesbarometeret

Sammenlign norske fylkeskommuner på økonomi, befolkning, sektorutgifter, struktur og resultater.
Statisk side (GitHub Pages) — ingen byggverktøy, ingen server. Laget med
[Claude Code](https://claude.ai/code).

## Arkitektur

| Fil | Rolle |
|---|---|
| `index.html` | All markup, inkl. «Datagrunnlag»- og «Om»-modalene |
| `style.css` | Styling |
| `data.js` | Innebygd grunndatasett + SSB-overlegg (`applySsbOverlay`) |
| `api.js` | «Oppdater fra SSB»-knappen (live henting i nettleseren) + rangeringsmotor |
| `charts.js` | Chart.js-rendering, sammenligningstabell, rangering |
| `data/ssb-data.js` | **Generert** — ferske SSB-tall som `window.SSB_DATA` |
| `data/ssb.json` | **Generert** — samme innhold som ren JSON (diff-bar rådata) |
| `scripts/fetch-ssb.mjs` | Henter fra SSB JSON-stat2 API og skriver `data/`-filene |
| `.github/workflows/update-data.yml` | Kjører skriptet månedlig og committer endringer |

### Dataflyt

1. `data.js` inneholder hele grunndatasettet (alle 15 fylker, 2015–2025).
2. `data/ssb-data.js` lastes først; `data.js` legger disse tallene **oppå** de
   innebygde ved sidelast. Innebygde verdier beholdes for år API-et ikke dekker
   (estimater 2015–2019 og sammenslåingsperioder 2020–2023).
3. GitHub Actions kjører `scripts/fetch-ssb.mjs` den 3. hver måned (og ved
   manuell `workflow_dispatch`) og committer nye datafiler ved endringer.
4. «Oppdater fra SSB»-knappen henter i tillegg befolkning og sektorutgifter
   direkte i nettleseren (kun i minnet, forsvinner ved reload).

## Datakilder (SSB-tabeller)

| Tabell | Innhold |
|---|---|
| 11342 | Areal og befolkning — folkemengde per fylke |
| 12163 | KOSTRA netto driftsutgifter per sektor (FGF7 VGO, FGF4 samferdsel, FGF8 tannhelse, FGF1b administrasjon, FGF3 kultur) |
| 13561 | Finansielle nøkkeltall fylkeskommunekonsern (netto driftsresultat, frie inntekter, disposisjonsfond, netto lånegjeld, skatteinntekter) |
| 09280 | Landareal |
| 11842 | Fylkesveier: lengde, vegdekke-tilstand |
| 11961 | Tannhelse: andel barn 3–18 år undersøkt/behandlet |
| 11844 | Kollektivtransport: busspassasjerer |
| 12971 | Gjennomføring i videregående opplæring (fullført og bestått innen 5 år) |

## Kjente begrensninger

- **Økonomital 2015–2019 er estimater.** SSB-tabell 13561 dekker bare 2020 og
  senere; eldre år er estimert fra historiske trender og merket i
  «Datagrunnlag». For Oslo vises økonomiserier kun fra 2020 (estimatene var
  ikke på sammenlignbar skala).
- **Oslo er både kommune og fylkeskommune.** Økonomiindikatorene omfatter hele
  Oslo kommune og er ikke direkte sammenlignbare med rene fylkeskommuner; de
  merkes i UI-et. Sektorutgifter per innbygger (KOSTRA-funksjoner) er
  sammenlignbare. Landssnitt-referanselinjen bruker SSBs aggregat «landet uten
  Oslo» der det er tilgjengelig.
- **Sammenslåingsperioder 2020–2023**: Viken, Vestfold og Telemark samt Troms
  og Finnmark rapporteres som sammenslåtte enheter i disse årene (markert ★
  og dempet farge i grafene).
- **Årsverk** og alders-/sektorfordeling er estimater som vedlikeholdes
  manuelt i `data.js`.
- Årsaksen (`YEARS`) er fastsatt til 2015–2025; nye årganger krever en liten
  manuell utvidelse i `data.js`.

## Utvikling

Lokal kjøring krever en HTTP-server (pga. `data/`-filene):

```bash
python3 -m http.server 8000
# åpne http://localhost:8000
```

Manuell datahenting (krever nett-tilgang til data.ssb.no):

```bash
node scripts/fetch-ssb.mjs          # hent og skriv data/
node scripts/fetch-ssb.mjs --probe  # vis kun tabell-metadata (dimensjoner/koder)
```
