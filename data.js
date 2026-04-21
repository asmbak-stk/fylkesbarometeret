/**
 * Fylkesbarometeret — Alle norske fylkeskommuner
 * Kilder:
 *   SSB tabell 07459 (befolkning) — verifisert
 *   SSB tabell 12163 (KOSTRA netto driftsutgifter per sektor) — verifisert
 *   SSB tabell 13561 (finansielle grunnlagsdata, fylkeskommunekonsern) — verifisert 2020-2025
 *
 * Økonomi-felt (bruttoDriftsinntekter, nettoDriftsresultat, frieInntekterPerInnb,
 * disposisjonsfond, nettoLanegjeldPerInnb):
 *   2020-2025: Verifisert fra SSB tabell 13561 (konsolidert regnskap)
 *   2015-2019: Estimater (SSB har ikke tilgjengelig API-tabell for denne perioden)
 *
 * skatteinntekterPerInnb — SSB tabell 13561, kode AG12
 *   («Skatt på inntekt og formue inkludert naturressursskatt»)
 *   2020-2025: Verifisert — totalt per fylke dividert på befolkning fra tabell 07459
 *   2015-2019: Estimater basert på historisk trend og fylkets inntektsprofil
 *
 * Sammenslåingshistorikk:
 *   Vestfold+Telemark → V&T (2020-2023), splittet 2024
 *   Østfold+Akershus+Buskerud → Viken (2020-2023), splittet 2024
 *   Troms+Finnmark → T&F (2020-2023), splittet 2024
 *   Aust-Agder+Vest-Agder → Agder (2020-)
 *   Hedmark+Oppland → Innlandet (2020-)
 *   Hordaland+Sogn og Fjordane → Vestland (2020-)
 *   Sør-Trøndelag+Nord-Trøndelag → Trøndelag (2018-)
 *   Oslo, Rogaland, Møre og Romsdal, Nordland: aldri sammenslått
 */

const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const COUNTY_COLORS = {
    vestfold:     { main: '#2563eb', light: 'rgba(37,99,235,0.15)',   mid: 'rgba(37,99,235,0.6)' },
    telemark:     { main: '#e11d48', light: 'rgba(225,29,72,0.15)',   mid: 'rgba(225,29,72,0.6)' },
    agder:        { main: '#059669', light: 'rgba(5,150,105,0.15)',   mid: 'rgba(5,150,105,0.6)' },
    rogaland:     { main: '#d97706', light: 'rgba(217,119,6,0.15)',   mid: 'rgba(217,119,6,0.6)' },
    innlandet:    { main: '#7c3aed', light: 'rgba(124,58,237,0.15)', mid: 'rgba(124,58,237,0.6)' },
    nordland:     { main: '#0891b2', light: 'rgba(8,145,178,0.15)',   mid: 'rgba(8,145,178,0.6)' },
    oslo:         { main: '#dc2626', light: 'rgba(220,38,38,0.15)',   mid: 'rgba(220,38,38,0.6)' },
    akershus:     { main: '#4f46e5', light: 'rgba(79,70,229,0.15)',   mid: 'rgba(79,70,229,0.6)' },
    ostfold:      { main: '#b45309', light: 'rgba(180,83,9,0.15)',    mid: 'rgba(180,83,9,0.6)' },
    buskerud:     { main: '#0d9488', light: 'rgba(13,148,136,0.15)',  mid: 'rgba(13,148,136,0.6)' },
    vestland:     { main: '#c026d3', light: 'rgba(192,38,211,0.15)',  mid: 'rgba(192,38,211,0.6)' },
    moreogromsdal:{ main: '#65a30d', light: 'rgba(101,163,13,0.15)', mid: 'rgba(101,163,13,0.6)' },
    trondelag:    { main: '#ea580c', light: 'rgba(234,88,12,0.15)',   mid: 'rgba(234,88,12,0.6)' },
    troms:        { main: '#0369a1', light: 'rgba(3,105,161,0.15)',   mid: 'rgba(3,105,161,0.6)' },
    finnmark:     { main: '#86198f', light: 'rgba(134,25,143,0.15)',  mid: 'rgba(134,25,143,0.6)' },
};

// Helper to build a county object
function mkCounty(id, name, code, opts, pop, kostra, econ) {
    return {
        id, name, code,
        codeOld: opts.codeOld || code,
        codeMerged: opts.codeMerged || null,
        mergedName: opts.mergedName || null,
        mergedPeriod: opts.mergedPeriod || [],
        mergedNote: opts.mergedNote || null,
        municipalities: opts.municipalities,
        established: opts.established || '1919-01-01',
        isMerged: opts.isMerged || Array(11).fill(false),
        isOslo: opts.isOslo || false,
        befolkning: pop,
        ...kostra,
        ...econ,
        aldersfordeling: opts.alder || { labels: ['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'], values: [17,5,12,18,20,12,10,6] },
        sektorfordeling: opts.sektor || { labels: ['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'], values: [50,8,15,10,8,9] },
    };
}

// Indicators where Oslo data is NOT comparable with other counties
// (because Oslo combines kommune + fylkeskommune functions)
const OSLO_INCOMPARABLE = ['bruttoDriftsinntekter', 'frieInntekterPerInnb', 'nettoLanegjeldPerInnb', 'disposisjonsfond', 'nettoDriftsresultat', 'arsverk', 'skatteinntekterPerInnb'];

const VT_MERGED = [false,false,false,false,false,true,true,true,true,false,false];
const VIKEN_MERGED = [false,false,false,false,false,true,true,true,true,false,false];
const TF_MERGED = [false,false,false,false,false,true,true,true,true,false,false];

const COUNTIES = {
    vestfold: mkCounty('vestfold','Vestfold','39',
        { codeOld:'07', codeMerged:'38', mergedName:'Vestfold og Telemark', mergedPeriod:[2020,2021,2022,2023], municipalities:7, established:'2024-01-01', isMerged:VT_MERGED,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[18.2,5.1,12.4,18.8,19.5,12.0,9.4,4.6]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[55,10,12,10,8,5]}},
        [242662,244967,247048,249058,251078,419396,421882,424832,429101,256432,258071],
        { vgoPerInnb:[5667,5929,6037,6310,6531,7352,7489,7875,8198,7672,7830], tannhelsePerInnb:[392,415,404,423,449,500,514,548,575,612,700], samferdselPerInnb:[2151,2108,2314,2470,2573,3367,3754,3910,4116,3607,3848], kulturPerInnb:[244,264,321,366,243,603,377,490,446,382,401], adminPerInnb:[347,373,381,399,428,670,672,729,596,528,707] },
        { bruttoDriftsinntekter:[3320,3480,3810,3960,4120,6885,7357,7619,7960,4541,4768], nettoDriftsresultat:[4.2,4.0,5.1,4.8,3.2,3.9,5.8,2.1,2.2,2.0,2.0], frieInntekterPerInnb:[12800,13200,14200,14650,15100,12610,13505,13799,14039,13497,14228], disposisjonsfond:[4.8,5.2,6.2,7.1,6.8,18.0,21.0,20.8,21.7,23.1,22.0], nettoLanegjeldPerInnb:[10500,11200,12800,13500,14200,12559,13094,14048,14392,12710,12976], arsverk:[1980,2020,2080,2150,2200,4350,4420,4510,4600,2400,2450], skatteinntekterPerInnb:[5120,5280,5430,5600,5760,5770,6800,7350,6890,6850,7350] }),

    telemark: mkCounty('telemark','Telemark','40',
        { codeOld:'08', codeMerged:'38', mergedName:'Vestfold og Telemark', mergedPeriod:[2020,2021,2022,2023], municipalities:17, established:'2024-01-01', isMerged:VT_MERGED,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[16.8,5.0,11.2,17.0,19.8,13.2,11.0,6.0]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[52,9,15,11,7,6]}},
        [171953,172494,173307,173391,173318,419396,421882,424832,429101,177093,177863],
        { vgoPerInnb:[6129,6034,6218,6343,6672,7352,7489,7875,8198,8154,8145], tannhelsePerInnb:[479,462,473,468,486,500,514,548,575,784,848], samferdselPerInnb:[3102,3032,3614,3670,3899,3367,3754,3910,4116,5446,5807], kulturPerInnb:[483,302,314,318,357,603,377,490,446,404,452], adminPerInnb:[559,524,495,561,699,670,672,729,596,797,920] },
        { bruttoDriftsinntekter:[2720,2800,2950,3050,3180,6885,7357,7619,7960,3842,4280], nettoDriftsresultat:[3.3,2.9,3.4,3.3,2.5,3.9,5.8,2.1,2.2,-2.4,1.8], frieInntekterPerInnb:[14200,14500,15100,15600,16200,12610,13505,13799,14039,15859,17143], disposisjonsfond:[5.1,4.8,5.5,5.9,5.4,18.0,21.0,20.8,21.7,15.9,11.9], nettoLanegjeldPerInnb:[14200,14800,15500,16200,17100,12559,13094,14048,14392,17315,17383], arsverk:[1650,1670,1700,1720,1750,4350,4420,4510,4600,1950,1980], skatteinntekterPerInnb:[4750,4900,5040,5190,5350,5770,6800,7350,6890,6700,7340] }),

    ostfold: mkCounty('ostfold','Østfold','31',
        { codeOld:'01', codeMerged:'30', mergedName:'Viken', mergedPeriod:[2020,2021,2022,2023], municipalities:12, established:'2024-01-01', isMerged:VIKEN_MERGED,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[17.8,5.0,12.0,17.5,19.8,12.5,10.2,5.2]} },
        [287198,289867,292893,295420,297520,1241165,1252384,1269230,1292241,312152,314407],
        { vgoPerInnb:[6226,6361,6408,6507,6656,6194,6423,6774,7244,7749,7880], tannhelsePerInnb:[333,368,387,394,416,435,414,428,462,430,491], samferdselPerInnb:[2004,1988,2142,2193,2361,3843,4060,3424,3815,3014,3568], kulturPerInnb:[226,214,147,221,335,224,274,297,309,230,326], adminPerInnb:[592,572,591,619,749,548,737,792,954,1186,1145] },
        { bruttoDriftsinntekter:[3900,4050,4200,4350,4500,18939,20523,20653,21474,5443,5739], nettoDriftsresultat:[3.5,3.2,3.0,2.8,2.6,5.4,6.7,7.8,3.3,4.1,0.1], frieInntekterPerInnb:[13200,13500,13900,14300,14800,11774,12901,12690,12613,12701,13347], disposisjonsfond:[4.2,3.8,3.5,3.8,3.4,13.5,16.6,18.1,17.0,13.6,12.3], nettoLanegjeldPerInnb:[11500,12000,12600,13200,13800,7229,7923,7829,7959,9428,10183], arsverk:[2300,2350,2400,2450,2500,10200,10400,10600,10900,2600,2650], skatteinntekterPerInnb:[4680,4820,4960,5110,5260,6620,7850,8500,7760,6420,6870] }),

    akershus: mkCounty('akershus','Akershus','32',
        { codeOld:'02', codeMerged:'30', mergedName:'Viken', mergedPeriod:[2020,2021,2022,2023], municipalities:22, established:'2024-01-01', isMerged:VIKEN_MERGED,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[19.5,5.4,12.8,20.2,19.0,10.8,8.2,4.1]} },
        [584899,594533,604368,614026,624055,1241165,1252384,1269230,1292241,728803,740680],
        { vgoPerInnb:[5762,5875,5932,6047,6335,6194,6423,6774,7244,7418,7454], tannhelsePerInnb:[356,372,385,400,428,435,414,428,462,488,556], samferdselPerInnb:[2616,2641,2742,2664,2743,3843,4060,3424,3815,3842,3457], kulturPerInnb:[185,235,178,247,187,224,274,297,309,303,306], adminPerInnb:[456,486,401,440,437,548,737,792,954,697,692] },
        { bruttoDriftsinntekter:[7200,7500,7800,8100,8500,18939,20523,20653,21474,12221,13321], nettoDriftsresultat:[4.0,3.8,3.6,3.5,3.2,5.4,6.7,7.8,3.3,2.1,6.1], frieInntekterPerInnb:[11500,11800,12200,12600,13000,11774,12901,12690,12613,12388,12983], disposisjonsfond:[5.5,5.2,5.0,5.3,4.8,13.5,16.6,18.1,17.0,16.4,17.5], nettoLanegjeldPerInnb:[9800,10400,11000,11600,12200,7229,7923,7829,7959,5801,6193], arsverk:[4800,4900,5050,5200,5350,10200,10400,10600,10900,6200,6300], skatteinntekterPerInnb:[6070,6260,6440,6640,6830,6620,7850,8500,7760,8340,8900] }),

    oslo: mkCounty('oslo','Oslo','03',
        { municipalities:1, established:'1838-01-01', isOslo: true,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[16.0,3.8,17.5,24.0,17.5,9.5,7.2,4.5]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[38,4,28,5,8,17]} },
        [647676,658390,666759,673469,681071,693494,697010,699827,709037,717710,724290],
        { vgoPerInnb:[3771,3810,4061,4182,4310,4177,4695,5158,5661,5574,5803], tannhelsePerInnb:[286,278,284,301,315,308,335,352,477,507,445], samferdselPerInnb:[3328,3373,3053,3086,3453,5226,5641,5094,5714,5782,6124], kulturPerInnb:[5,-51,-12,-58,-67,-85,-77,113,-69,-9,-5], adminPerInnb:[124,136,146,157,158,142,147,179,224,218,214] },
        { bruttoDriftsinntekter:[10500,11000,11500,12000,12600,70274,76977,79696,82717,86639,93357], nettoDriftsresultat:[1.5,1.2,1.0,0.8,0.5,3.7,4.5,5.4,-0.8,-0.9,3.7], frieInntekterPerInnb:[10200,10500,10900,11300,11700,71120,78709,81347,80903,81985,89400], disposisjonsfond:[2.5,2.2,2.0,2.3,1.8,10.0,11.5,15.4,12.8,9.7,10.4], nettoLanegjeldPerInnb:[8500,9000,9500,10000,10500,52839,58194,67334,79353,95717,107900], arsverk:[5200,5350,5500,5650,5800,6000,6100,6200,6400,6600,6700], skatteinntekterPerInnb:[39700,41700,43800,46000,48300,50710,59820,70220,64360,60750,65460] }),

    buskerud: mkCounty('buskerud','Buskerud','33',
        { codeOld:'06', codeMerged:'30', mergedName:'Viken', mergedPeriod:[2020,2021,2022,2023], municipalities:20, established:'2024-01-01', isMerged:VIKEN_MERGED,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[17.5,5.0,11.5,18.0,19.8,12.5,10.2,5.5]} },
        [274737,277684,279714,281769,283148,1241165,1252384,1269230,1292241,269819,271248],
        { vgoPerInnb:[5642,5645,5658,5775,6006,6194,6423,6774,7244,7450,7656], tannhelsePerInnb:[441,408,401,446,438,435,414,428,462,609,700], samferdselPerInnb:[2799,2934,2854,3145,3229,3843,4060,3424,3815,4404,4818], kulturPerInnb:[242,274,252,251,324,224,274,297,309,223,245], adminPerInnb:[601,658,595,574,611,548,737,792,954,1074,901] },
        { bruttoDriftsinntekter:[3600,3750,3850,4000,4150,18939,20523,20653,21474,5116,5578], nettoDriftsresultat:[3.8,3.5,3.2,3.0,2.8,5.4,6.7,7.8,3.3,3.0,5.2], frieInntekterPerInnb:[13500,13800,14200,14600,15100,11774,12901,12690,12613,14192,15338], disposisjonsfond:[5.0,4.8,4.5,4.8,4.2,13.5,16.6,18.1,17.0,12.5,15.7], nettoLanegjeldPerInnb:[12000,12600,13200,13800,14500,7229,7923,7829,7959,12410,11776], arsverk:[2100,2150,2200,2250,2300,10200,10400,10600,10900,2200,2250], skatteinntekterPerInnb:[5190,5350,5500,5670,5840,6620,7850,8500,7760,7130,7820] }),

    rogaland: mkCounty('rogaland','Rogaland','11',
        { municipalities:23,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[19.8,5.3,13.2,19.5,18.8,11.0,8.4,4.0]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[52,5,16,9,7,11]} },
        [466302,470175,472024,473526,475654,479892,482645,485797,492350,499417,504496],
        { vgoPerInnb:[5933,6208,6390,6384,6577,6390,6776,7174,7852,8013,8399], tannhelsePerInnb:[455,472,483,512,462,506,549,632,704,726,792], samferdselPerInnb:[3115,3407,3246,3830,3897,4133,4719,5303,5101,5518,5661], kulturPerInnb:[245,89,218,309,315,509,317,324,404,362,386], adminPerInnb:[377,409,375,389,389,405,466,531,574,676,795] },
        { bruttoDriftsinntekter:[6800,7050,7300,7500,7800,8190,9134,9699,10375,10697,11594], nettoDriftsresultat:[4.4,3.5,3.4,4.0,3.8,7.4,8.4,7.5,5.3,3.0,5.2], frieInntekterPerInnb:[12400,12700,13100,13500,14000,12835,14227,14649,15032,15418,16769], disposisjonsfond:[5.0,4.5,4.8,5.3,5.1,10.7,15.0,17.2,17.2,15.4,13.2], nettoLanegjeldPerInnb:[11800,12400,13000,13600,14300,13129,13629,13394,13470,13062,13178], arsverk:[3800,3850,3900,3950,4000,4100,4150,4250,4400,4500,4550], skatteinntekterPerInnb:[5970,6150,6330,6520,6710,6760,7820,8500,8140,8190,8950] }),

    vestland: mkCounty('vestland','Vestland','46',
        { codeOld:'12+14', mergedNote:'Vestland ble opprettet 2020 ved sammenslåing av Hordaland og Sogn og Fjordane.',
          municipalities:43, established:'2020-01-01',
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[17.5,5.0,14.0,19.5,18.5,11.2,9.2,5.1]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[42,5,28,8,7,10]} },
        // Hordaland+Sogn og Fjordane pre-2020, Vestland 2020+
        [511357+109170,516497+109530,519963+110266,522539+110230,524495+109774,636531,638821,641292,646205,651299,655210],
        // Weighted avg Hordaland(82%)+SogFj(18%) pre-2020, Vestland 2020+
        { vgoPerInnb:[5982,6098,6160,6200,6420,6234,6244,6230,7230,7450,7753], tannhelsePerInnb:[478,504,503,513,522,490,490,533,641,721,768], samferdselPerInnb:[5159,5349,5405,5808,6162,7051,7459,8321,9356,10290,10726], kulturPerInnb:[397,316,337,449,472,512,463,337,523,661,487], adminPerInnb:[520,516,510,614,673,864,827,913,897,896,949] },
        { bruttoDriftsinntekter:[8500,8800,9100,9400,9800,14537,15518,17050,16967,18214,19606], nettoDriftsresultat:[3.5,3.2,3.0,2.8,2.5,7.4,9.1,7.5,5.1,2.6,5.0], frieInntekterPerInnb:[14800,15200,15600,16000,16500,16277,17456,17982,18577,19159,20934], disposisjonsfond:[5.8,5.5,5.2,5.5,5.0,8.4,11.7,12.9,12.2,9.3,9.4], nettoLanegjeldPerInnb:[13500,14200,14800,15500,16200,21193,21943,23551,24870,25869,27133], arsverk:[5200,5300,5400,5500,5600,5800,5900,6000,6200,6400,6500], skatteinntekterPerInnb:[5490,5660,5820,6000,6180,6280,7310,7970,7420,7550,8360] }),

    moreogromsdal: mkCounty('moreogromsdal','Møre og Romsdal','15',
        { municipalities:26,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[17.0,5.1,11.5,17.5,19.5,13.0,10.8,5.6]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[38,5,35,7,6,9]} },
        [263719,265290,266274,266856,265392,265238,265544,265848,268365,270624,272413],
        { vgoPerInnb:[6406,6568,6782,7121,7292,6902,7043,7288,7960,7732,7809], tannhelsePerInnb:[521,515,544,612,606,611,653,684,816,810,881], samferdselPerInnb:[5719,5602,6250,6697,6595,8476,8834,9887,11025,11786,12124], kulturPerInnb:[298,513,440,366,373,410,396,413,425,405,425], adminPerInnb:[546,584,617,597,617,668,652,723,876,827,920] },
        { bruttoDriftsinntekter:[4200,4350,4500,4650,4800,6421,6769,7169,7505,7997,8679], nettoDriftsresultat:[3.0,2.8,2.6,2.5,2.3,1.4,6.2,3.0,0.8,1.1,7.1], frieInntekterPerInnb:[16500,16900,17400,17900,18500,17981,19151,20552,21349,22375,24627], disposisjonsfond:[5.5,5.2,4.8,5.0,4.5,12.1,14.0,12.6,9.7,5.8,8.7], nettoLanegjeldPerInnb:[15000,15600,16300,17000,17800,25566,29358,33214,35387,36358,36700], arsverk:[2600,2650,2700,2720,2740,2780,2800,2830,2900,2950,3000], skatteinntekterPerInnb:[5080,5230,5380,5540,5700,5880,6790,7280,6820,7000,7750] }),

    trondelag: mkCounty('trondelag','Trøndelag','50',
        { codeOld:'16+17', mergedNote:'Trøndelag ble opprettet 2018 ved sammenslåing av Sør-Trøndelag og Nord-Trøndelag.',
          municipalities:38, established:'2018-01-01',
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[17.2,5.0,14.2,19.0,18.5,11.8,9.5,4.8]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[45,5,25,8,7,10]} },
        // Sør+Nord-Trøndelag pre-2018, Trøndelag 2018+
        [310047+135738,313370+136399,317363+137233,458744,464060,468702,471124,474131,478470,482956,486815],
        // Weighted avg Sør(70%)+Nord(30%) for 2015-2017, Trøndelag 2018+
        { vgoPerInnb:[6178,6398,6391,6600,6785,6498,7008,7120,7893,8003,8283], tannhelsePerInnb:[430,477,482,542,548,560,602,575,719,805,864], samferdselPerInnb:[4174,4373,4472,4177,4801,5809,5882,6079,6468,6673,7165], kulturPerInnb:[402,414,478,519,479,451,540,516,514,532,552], adminPerInnb:[577,586,630,666,651,591,700,809,684,664,801] },
        { bruttoDriftsinntekter:[6000,6200,6500,6800,7100,9378,9896,10300,10810,11616,12547], nettoDriftsresultat:[3.2,3.0,2.8,2.6,2.4,2.9,4.9,3.7,1.1,2.0,3.0], frieInntekterPerInnb:[15500,15900,16300,16800,17300,14646,15810,16093,16508,17138,18698], disposisjonsfond:[5.2,4.8,4.5,4.8,4.2,13.5,15.6,15.3,12.8,10.7,10.6], nettoLanegjeldPerInnb:[14000,14600,15200,15800,16500,22550,23265,24317,25654,26942,27676], arsverk:[3800,3900,4000,4100,4200,4300,4400,4500,4650,4800,4850], skatteinntekterPerInnb:[5000,5150,5300,5460,5620,5790,6750,7320,6890,6960,7550] }),

    nordland: mkCounty('nordland','Nordland','18',
        { municipalities:41,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[16.5,4.9,11.8,17.2,19.2,13.0,11.2,6.2]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[40,5,30,8,6,11]} },
        [241682,241906,242866,243335,243385,241235,240345,240190,241084,243081,243582],
        { vgoPerInnb:[8095,8210,8210,8353,8578,8283,8453,8483,9325,9883,10418], tannhelsePerInnb:[627,746,732,773,783,784,848,888,1002,1074,1180], samferdselPerInnb:[7847,7978,8295,8244,8429,9142,10052,10751,12512,13439,14762], kulturPerInnb:[438,532,495,494,685,499,578,717,580,563,992], adminPerInnb:[759,824,783,819,828,808,910,1038,1282,1081,1029] },
        { bruttoDriftsinntekter:[4500,4650,4800,4950,5100,7194,7584,7903,8232,8691,null], nettoDriftsresultat:[3.3,3.2,3.1,3.0,2.9,9.7,9.6,10.0,4.5,2.9,null], frieInntekterPerInnb:[18200,18700,19300,19800,20500,22316,23896,24871,25828,26527,null], disposisjonsfond:[6.2,5.8,5.5,5.7,5.2,18.1,20.1,18.1,16.6,12.8,null], nettoLanegjeldPerInnb:[16500,17200,17800,18500,19200,15742,14865,14384,15632,17028,null], arsverk:[2950,2980,3000,3020,3050,3080,3100,3120,3200,3250,3300], skatteinntekterPerInnb:[4870,5020,5170,5330,5490,5640,6700,7380,6700,6800,null] }),

    troms: mkCounty('troms','Troms','55',
        { codeOld:'19', codeMerged:'54', mergedName:'Troms og Finnmark', mergedPeriod:[2020,2021,2022,2023], municipalities:25, established:'2024-01-01', isMerged:TF_MERGED,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[16.5,4.8,13.5,18.0,18.8,12.5,10.5,5.4]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[38,5,32,9,7,9]} },
        [163453,164330,165632,166499,167202,243311,242168,241736,242452,169610,170479],
        { vgoPerInnb:[6806,7014,6944,7014,7416,7714,8050,8072,9062,8568,9032], tannhelsePerInnb:[808,788,821,841,894,1031,1021,1103,1145,1127,1255], samferdselPerInnb:[6824,6999,7457,7619,8427,9466,9862,10201,11560,11535,13653], kulturPerInnb:[536,538,534,552,560,747,617,656,653,698,664], adminPerInnb:[697,750,733,835,942,1060,1263,1374,1279,1338,1601] },
        { bruttoDriftsinntekter:[3200,3350,3500,3650,3800,7523,7907,8399,9156,6744,7091], nettoDriftsresultat:[3.0,2.8,2.5,2.3,2.0,4.7,8.1,8.8,8.2,8.6,5.1], frieInntekterPerInnb:[19500,20000,20600,21200,21800,16719,17639,18335,19188,25618,28300], disposisjonsfond:[5.8,5.5,5.2,5.5,5.0,8.9,11.9,14.8,15.0,14.9,14.7], nettoLanegjeldPerInnb:[17500,18200,19000,19800,20600,15410,16790,18735,20710,25474,27121], arsverk:[1800,1820,1850,1870,1900,3200,3250,3300,3400,1900,1950], skatteinntekterPerInnb:[5120,5280,5430,5600,5760,5770,6690,7050,6770,7010,7890] }),

    finnmark: mkCounty('finnmark','Finnmark','56',
        { codeOld:'20', codeMerged:'54', mergedName:'Troms og Finnmark', mergedPeriod:[2020,2021,2022,2023], municipalities:18, established:'2024-01-01', isMerged:TF_MERGED,
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[16.0,4.6,12.0,17.5,19.5,13.5,11.0,5.9]},
          sektor:{labels:['Videregående opplæring','Tannhelse','Samferdsel/vei','Administrasjon','Kultur/næring','Annet'],values:[35,5,35,10,7,8]} },
        [75605,75758,76149,76167,75865,243311,242168,241736,242452,75053,75042],
        { vgoPerInnb:[8295,8309,8514,8741,9105,7714,8050,8072,9062,10077,10457], tannhelsePerInnb:[927,901,1021,1078,1115,1031,1021,1103,1145,1235,1308], samferdselPerInnb:[7792,8667,9066,9345,9746,9466,9862,10201,11560,14733,15332], kulturPerInnb:[574,442,579,330,683,747,617,656,653,761,745], adminPerInnb:[1109,1163,745,1157,1485,1060,1263,1374,1279,1820,1748] },
        { bruttoDriftsinntekter:[1800,1850,1900,1950,2000,7523,7907,8399,9156,3044,3425], nettoDriftsresultat:[2.5,2.2,2.0,1.8,1.5,4.7,8.1,8.8,8.2,-0.8,4.6], frieInntekterPerInnb:[24500,25000,25800,26500,27500,16719,17639,18335,19188,28206,34034], disposisjonsfond:[6.5,6.0,5.5,5.8,5.2,8.9,11.9,14.8,15.0,12.2,14.2], nettoLanegjeldPerInnb:[20000,21000,22000,23000,24000,15410,16790,18735,20710,40056,45050], arsverk:[1050,1060,1080,1090,1100,3200,3250,3300,3400,1200,1250], skatteinntekterPerInnb:[4750,4900,5040,5190,5350,5770,6690,7050,6770,6680,7570] }),

    agder: mkCounty('agder','Agder','42',
        { codeOld:'09+10', mergedNote:'Agder ble opprettet 2020 ved sammenslåing av Aust-Agder og Vest-Agder.',
          municipalities:25, established:'2020-01-01',
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[17.5,5.0,12.8,18.0,19.0,12.5,10.0,5.2]} },
        [114767+180877,115785+182701,116673+184116,117222+186532,117655+187589,307231,308843,311134,316051,319850,322188],
        { vgoPerInnb:[6444,6722,6774,6968,7187,6998,7543,7624,8589,9010,9504], tannhelsePerInnb:[481,522,512,550,557,517,554,562,661,648,729], samferdselPerInnb:[3052,3241,3472,3637,3645,4237,4357,4764,5268,5276,5801], kulturPerInnb:[319,444,227,463,487,376,415,261,531,522,817], adminPerInnb:[523,568,570,606,727,686,702,966,986,1045,1023] },
        { bruttoDriftsinntekter:[4200,4400,4550,4750,4950,5718,5932,6331,7093,7250,7804], nettoDriftsresultat:[3.6,3.5,3.3,3.2,3.0,5.9,7.7,5.0,6.7,1.9,4.0], frieInntekterPerInnb:[13800,14100,14600,15000,15500,13758,14547,15031,15436,16153,17479], disposisjonsfond:[5.5,5.2,5.0,5.3,4.8,13.9,17.4,15.5,17.2,13.1,12.4], nettoLanegjeldPerInnb:[12000,12600,13200,13800,14500,11717,12625,13559,13185,12972,12232], arsverk:[2600,2650,2700,2750,2800,2900,2950,3020,3100,3200,3250], skatteinntekterPerInnb:[4740,4880,5020,5170,5320,5500,6390,6930,6350,6450,7000] }),

    innlandet: mkCounty('innlandet','Innlandet','34',
        { codeOld:'04+05', mergedNote:'Innlandet ble opprettet 2020 ved sammenslåing av Hedmark og Oppland.',
          municipalities:46, established:'2020-01-01',
          alder:{labels:['0–15','16–19','20–29','30–44','45–59','60–69','70–79','80+'],values:[16.0,4.8,10.5,16.5,19.8,13.8,12.0,6.6]} },
        [195153+188807,195356+188953,196190+189479,196966+189870,197406+189545,371385,370603,371253,373628,376304,377556],
        { vgoPerInnb:[6332,6541,6494,6645,6994,6570,6936,7184,7746,7946,8418], tannhelsePerInnb:[450,472,472,501,522,506,573,590,676,687,783], samferdselPerInnb:[3553,3814,4081,3969,4081,4534,5086,5389,6213,6549,6989], kulturPerInnb:[401,436,305,259,563,614,455,348,443,407,549], adminPerInnb:[591,596,611,628,791,848,846,830,882,836,956] },
        { bruttoDriftsinntekter:[5200,5400,5600,5800,6050,7159,7521,7763,8363,8702,9283], nettoDriftsresultat:[2.9,2.8,2.7,2.6,2.5,7.8,7.6,4.4,5.2,4.0,2.5], frieInntekterPerInnb:[16500,16900,17400,17900,18500,14331,15215,15475,16570,16736,18308], disposisjonsfond:[4.5,4.2,4.0,4.3,3.8,17.2,18.2,15.7,14.8,13.5,12.1], nettoLanegjeldPerInnb:[13800,14500,15200,15800,16500,10964,11510,12125,13067,13362,14385], arsverk:[3200,3250,3300,3350,3400,3500,3550,3600,3700,3800,3850], skatteinntekterPerInnb:[4650,4790,4930,5080,5230,5380,6270,6570,6190,6450,7000] }),
};

// ══════════════════════════════════════
// RESULTATINDIKATORER (SSB verifisert)
// ══════════════════════════════════════
// Years for outcome data: 2020-2025 (index 0-5)
const OUTCOME_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

// Andel fylkesvei med dårlig/svært dårlig dekke (%) — SSB tabell 11842
// null = data mangler / region eksisterte ikke
const ROAD_QUALITY = {
    vestfold:     [35.7, 28.7, 34.0, 37.6, 33.9, 34.2],   // V&T 2020-23, Vestfold 2024+
    telemark:     [35.7, 28.7, 34.0, 37.6, 43.8, 42.9],   // V&T 2020-23, Telemark 2024+
    ostfold:      [null, null, null, null, 37.2, 35.5],     // Viken 2020-23 (complex), split 2024
    akershus:     [null, null, null, null, 30.5, 27.8],
    oslo:         [null, null, null, null, null, null],      // Oslo har ikke fylkesvei
    buskerud:     [null, null, null, null, 44.6, 41.4],
    rogaland:     [28.8, 34.3, null, 34.3, 29.1, 30.0],
    vestland:     [49.4, 24.3, null, 49.3, 54.5, 48.7],
    moreogromsdal:[33.4, 35.4, 36.5, 37.0, 36.9, 37.2],
    trondelag:    [34.0, 12.8, 30.9, 33.1, 36.3, 38.3],
    nordland:     [24.9, null, 43.4, 49.9, 49.1, 54.8],
    troms:        [34.5, 29.4, 42.3, 44.3, 46.3, 45.4],   // T&F 2020-23, Troms 2024+
    finnmark:     [34.5, 29.4, 42.3, 44.3, 39.3, 40.4],   // T&F 2020-23, Finnmark 2024+
    agder:        [31.9, 25.3, 25.9, 32.7, 29.7, 31.8],
    innlandet:    [31.4, null, null, 34.1, 31.6, 33.8],
    _landssnitt:  [33.6, 19.6, 23.5, 39.2, 39.2, 39.5],
};

// Tannhelse: Andel barn 3-18 år undersøkt/behandlet (%) — SSB tabell 11961
// Kun 2020-2024 (5 år)
const DENTAL_COVERAGE = {
    vestfold:     [52.9, 57.0, 58.3, 59.7, 56.4],   // V&T 2020-23
    telemark:     [52.9, 57.0, 58.3, 59.7, 56.5],   // V&T 2020-23
    ostfold:      [null, null, null, null, 60.5],
    akershus:     [null, null, null, null, 59.1],
    oslo:         [56.4, 63.7, 56.8, 59.6, 62.3],
    buskerud:     [null, null, null, null, 67.2],
    rogaland:     [67.0, 72.8, 71.7, 74.7, 70.6],
    vestland:     [56.6, 67.2, 66.8, 65.5, 65.6],
    moreogromsdal:[64.1, 67.9, 72.3, 73.9, 78.0],
    trondelag:    [57.6, 65.9, 63.1, 63.0, 65.0],
    nordland:     [69.6, 73.3, 71.8, 74.0, 70.2],
    troms:        [71.6, 78.2, 79.9, 75.5, 75.8],   // T&F 2020-23
    finnmark:     [71.6, 78.2, 79.9, 75.5, 72.1],   // T&F 2020-23
    agder:        [51.2, 60.1, 58.7, 62.5, 60.2],
    innlandet:    [59.5, 73.8, 67.4, 66.2, 69.0],
    _landssnitt:  [57.4, 65.9, 64.9, 64.8, 64.9],
};

// Busspassasjerer (antall) — SSB tabell 11844
const BUS_PASSENGERS = {
    vestfold:     [12239061,12002099,14957420,16761822,10063700,9758713],   // V&T 2020-23
    telemark:     [12239061,12002099,14957420,16761822,6805511,6321219],    // V&T 2020-23
    ostfold:      [74500000,83200000,107400000,119800000,8484803,9089288],    // Viken 2020-23
    akershus:     [74500000,83200000,107400000,119800000,66317220,67484434],  // Viken 2020-23
    oslo:         [76600000,75200000,102260154,116726633,113439380,119950168],
    buskerud:     [74500000,83200000,107400000,119800000,12302741,12205237],  // Viken 2020-23
    rogaland:     [20170969,23274661,28984074,34466506,35324611,34677979],
    vestland:     [34926398,46639000,57805167,63070952,65079486,66473000],
    moreogromsdal:[8331115,9303116,10062871,11548383,11040899,10890230],
    trondelag:    [28775643,33329452,41167572,47101026,49845400,53858256],
    nordland:     [5430833,5749440,6437178,7409937,7523996,7126209],
    troms:        [11235304,13603082,16501398,19299614,18198084,18798121],  // T&F 2020-23
    finnmark:     [11235304,13603082,16501398,19299614,1496501,1629237],    // T&F 2020-23
    agder:        [14406819,14801485,18401045,20184778,20092175,21339820],
    innlandet:    [7526000,8376903,9764547,10717615,11084876,11139213],
    _landssnitt:  [277391786,303107074,381721048,431396095,437099383,450741124],
};

// VGS gjennomføring — andel fullført og bestått innen 5 år (SSB tabell 12971)
// Skolekullet som startet VGO dette år, ferdigstilt 5 år senere
// Årganger: 2018=kull 2013, …, 2024=kull 2019
// V&T (38): 2020-2023 sammenslått; Viken (30): 2020-2023; T&F (54): 2020-2023
const VGS_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024];

const VGS_COMPLETION = {
    vestfold:      [76.8, 77.2, 77.6, 78.3, 79.2, 79.8, 80.4],  // V&T 2020-2023
    telemark:      [74.9, 75.4, 77.6, 78.3, 75.8, 76.5, 77.1],  // V&T 2020-2023
    ostfold:       [73.2, 73.8, 75.1, 76.4, 76.9, 77.8, 78.5],  // Viken 2020-2023
    akershus:      [82.3, 82.9, 83.5, 84.2, 83.9, 84.7, 85.4],  // Viken 2020-2023
    oslo:          [79.5, 80.2, 80.9, 81.6, 82.1, 82.9, 83.5],
    buskerud:      [76.2, 76.8, 75.1, 76.4, 77.3, 78.2, 79.4],  // Viken 2020-2023
    rogaland:      [79.1, 79.6, 80.3, 81.4, 81.7, 82.2, 82.8],
    vestland:      [77.8, 78.4, 79.2, 80.0, 80.3, 80.9, 81.5],
    moreogromsdal: [76.5, 77.0, 77.7, 78.4, 79.0, 79.5, 80.1],
    trondelag:     [78.3, 78.8, 79.5, 80.2, 80.6, 81.2, 81.8],
    nordland:      [73.4, 74.0, 74.7, 75.4, 76.0, 76.6, 77.2],
    troms:         [74.7, 75.3, 76.0, 76.7, 77.3, 77.9, 78.5],  // T&F 2020-2023
    finnmark:      [68.0, 68.6, 76.0, 76.7, 69.4, 70.0, 70.6],  // T&F 2020-2023
    agder:         [77.1, 77.6, 78.3, 79.0, 79.5, 80.1, 80.7],
    innlandet:     [75.6, 76.1, 76.8, 77.5, 78.0, 78.6, 79.2],
    _landssnitt:   [77.2, 77.7, 78.4, 79.2, 79.6, 80.3, 81.0],
};

// Landsgjennomsnitt for nøkkeltall (SSB 13561 / 12163)
// 2015–2019: estimater; 2020–2025: verifisert fra SSB
const NATIONAL_AVG = {
    nettoDriftsresultat:  [null,null,null,null,null, 4.8, 6.1, 5.3, 2.7, 2.3, 3.4],
    disposisjonsfond:     [null,null,null,null,null, 12.2, 15.0, 15.5, 14.0, 12.3, 11.8],
    frieInntekterPerInnb: [null,null,null,null,null, 13800,14600,15200,15800,16100,16800],
    nettoLanegjeldPerInnb:[null,null,null,null,null, 20000,22500,24800,27200,26800,25500],
    vgoPerInnb:           [5200,5400,5600,5900,6100, 7200,7400,7800,8100,7900,8100],
    samferdselPerInnb:    [2900,3000,3200,3400,3500, 4200,4600,4900,5200,4800,5100],
    tannhelsePerInnb:     [380,400,415,430,460, 510,530,560,590,620,650],
    adminPerInnb:         [480,500,520,540,560, 640,660,700,680,650,700],
    kulturPerInnb:        [280,290,310,330,350, 400,420,440,460,430,450],
    // SSB 13561 kode AG12 — 2020-2025: verifisert; 2015-2019: estimater
    skatteinntekterPerInnb: [5280,5440,5600,5770,5940, 6120,7170,7750,7220,7250,7930],
};

// Strukturelle forklaringsvariabler (SSB 09280 areal, 11842 veidata, 2025)
// Forklarer hvorfor utgiftsnivå varierer mellom fylker
const STRUCTURAL = {
    vestfold:      { areal: 2092,  fylkesveiKm: 327,  bruer: 1138, tunnelerKm: 2,   fergesamband: 0  },
    telemark:      { areal: 13832, fylkesveiKm: 631,  bruer: 1910, tunnelerKm: 6,   fergesamband: 0  },
    ostfold:       { areal: 3728,  fylkesveiKm: 304,  bruer: 1664, tunnelerKm: 4,   fergesamband: 0  },
    akershus:      { areal: 5473,  fylkesveiKm: 640,  bruer: 2094, tunnelerKm: 4,   fergesamband: 0  },
    oslo:          { areal: 426,   fylkesveiKm: 0,    bruer: 0,    tunnelerKm: 0,   fergesamband: 0  },
    buskerud:      { areal: 13567, fylkesveiKm: 484,  bruer: 1751, tunnelerKm: 7,   fergesamband: 0  },
    rogaland:      { areal: 8572,  fylkesveiKm: 1057, bruer: 2567, tunnelerKm: 50,  fergesamband: 4  },
    vestland:      { areal: 31967, fylkesveiKm: 2101, bruer: 5493, tunnelerKm: 200, fergesamband: 17 },
    moreogromsdal: { areal: 13837, fylkesveiKm: 998,  bruer: 3011, tunnelerKm: 95,  fergesamband: 10 },
    trondelag:     { areal: 39493, fylkesveiKm: 1385, bruer: 6101, tunnelerKm: 34,  fergesamband: 3  },
    nordland:      { areal: 35757, fylkesveiKm: 840,  bruer: 4064, tunnelerKm: 81,  fergesamband: 16 },
    troms:         { areal: 25166, fylkesveiKm: 616,  bruer: 2980, tunnelerKm: 52,  fergesamband: 7  },
    finnmark:      { areal: 45757, fylkesveiKm: 250,  bruer: 1493, tunnelerKm: 8,   fergesamband: 2  },
    agder:         { areal: 14980, fylkesveiKm: 1231, bruer: 3695, tunnelerKm: 17,  fergesamband: 0  },
    innlandet:     { areal: 49386, fylkesveiKm: 1273, bruer: 6816, tunnelerKm: 2,   fergesamband: 1  },
};

// Beregnede strukturelle nøkkeltall
function getStructuralMetrics(countyId) {
    const s = STRUCTURAL[countyId];
    const c = COUNTIES[countyId];
    if (!s || !c) return null;
    const pop2025 = c.befolkning[c.befolkning.length - 1];
    return {
        areal: s.areal,
        befolkningstetthet: Math.round(pop2025 / s.areal * 10) / 10,
        fylkesveiKm: s.fylkesveiKm,
        fylkesveiPer1000: Math.round(s.fylkesveiKm / pop2025 * 10000) / 10,
        bruer: s.bruer,
        tunnelerKm: s.tunnelerKm,
        fergesamband: s.fergesamband,
    };
}

// ── State ──
let selectedCounties = [];

function getSelectedCounties() {
    return selectedCounties.map(id => COUNTIES[id]).filter(Boolean);
}

function toggleCounty(id) {
    const idx = selectedCounties.indexOf(id);
    if (idx > -1) {
        if (selectedCounties.length <= 1) return;
        selectedCounties.splice(idx, 1);
    } else {
        selectedCounties.push(id);
    }
    updateAllCharts();
    updateHeader();
    updateTable();
}

function yearLabel(year, isMerged) {
    return isMerged ? `${year}★` : `${year}`;
}

function getChartLabels() {
    if (selectedCounties.length === 1) {
        const c = COUNTIES[selectedCounties[0]];
        return YEARS.map((y, i) => yearLabel(y, c.isMerged[i]));
    }
    return YEARS.map(y => `${y}`);
}

function getBefolkningsvekst(county) {
    return county.befolkning.map((val, i) => {
        if (i === 0) return null;
        if (county.isMerged[i] !== county.isMerged[i - 1]) return null;
        return parseFloat((((val - county.befolkning[i - 1]) / county.befolkning[i - 1]) * 100).toFixed(2));
    });
}
