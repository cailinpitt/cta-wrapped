const fs = require('fs').promises;

// Canonical CTA bus route catalog.
const names = {
    1: 'Bronzeville/Union Station',
    2: 'Hyde Park Express',
    3: 'King Drive',
    4: 'Cottage Grove',
    X4: 'Cottage Grove Express',
    N4: 'Cottage Grove Night Bus',
    N5: 'South Shore Night Bus',
    6: 'Jackson Park Express',
    7: 'Harrison',
    8: 'Halsted',
    '8A': 'South Halsted',
    9: 'Ashland',
    X9: 'Ashland Express',
    N9: 'Ashland Night Bus',
    10: 'Obama Presidential Center/Museum of Science & Industry',
    11: 'Lincoln',
    12: 'Roosevelt',
    J14: 'Jeffery Jump',
    15: 'Jeffery Local',
    18: '16th-18th',
    19: 'United Center Express',
    20: 'Madison',
    N20: 'Madison Night Bus',
    21: 'Cermak',
    22: 'Clark',
    N22: 'Clark Night Bus',
    24: 'Wentworth',
    26: 'South Shore Express',
    28: 'Stony Island',
    29: 'State',
    30: 'South Chicago',
    31: '31st',
    34: 'South Michigan',
    N34: 'South Michigan Night Bus',
    35: '31st/35th',
    36: 'Broadway',
    37: 'Sedgwick',
    39: 'Pershing',
    43: '43rd',
    44: 'Wallace/Racine',
    47: '47th',
    48: 'South Damen',
    49: 'Western',
    '49B': 'North Western',
    X49: 'Western Express',
    N49: 'Western Night Bus',
    50: 'Damen',
    51: '51st',
    52: 'Kedzie',
    '52A': 'South Kedzie',
    53: 'Pulaski',
    '53A': 'South Pulaski',
    N53: 'Pulaski Night Bus',
    54: 'Cicero',
    '54A': 'North Cicero/Skokie Blvd.',
    '54B': 'South Cicero',
    55: 'Garfield',
    '55A': '55th/Austin',
    '55N': '55th/Narragansett',
    N55: 'Garfield Night Bus',
    56: 'Milwaukee',
    57: 'Laramie',
    59: '59th/61st',
    60: 'Blue Island/26th',
    N60: 'Blue Island/26th Night Bus',
    62: 'Archer',
    '62H': 'Archer/Harlem',
    N62: 'Archer Night Bus',
    63: '63rd',
    '63W': 'West 63rd',
    N63: '63rd Night Bus',
    65: 'Grand',
    66: 'Chicago',
    N66: 'Chicago Night Bus',
    67: '67th-69th-71st',
    68: 'Northwest Highway',
    70: 'Division',
    71: '71st/South Shore',
    72: 'North',
    73: 'Armitage',
    74: 'Fullerton',
    75: '74th-75th',
    76: 'Diversey',
    77: 'Belmont',
    N77: 'Belmont Night Bus',
    78: 'Montrose',
    79: '79th',
    N79: '79th Night Bus',
    80: 'Irving Park',
    81: 'Lawrence',
    '81W': 'West Lawrence',
    N81: 'Lawrence Night Bus',
    82: 'Kimball-Homan',
    84: 'Peterson',
    85: 'Central',
    '85A': 'North Central',
    86: 'Narragansett/Ridgeland',
    87: '87th',
    N87: '87th Night Bus',
    88: 'Higgins',
    90: 'Harlem',
    91: 'Austin',
    92: 'Foster',
    93: 'California/Dodge',
    94: 'California',
    95: '95th',
    96: 'Lunt',
    97: 'Skokie',
    100: 'Jeffery Manor Express',
    103: 'West 103rd',
    106: 'East 103rd',
    108: 'Halsted/95th',
    111: '111th/King Drive',
    '111A': 'Pullman Shuttle',
    112: 'Vincennes/111th',
    115: 'Pullman/115th',
    119: 'Michigan/119th',
    120: 'Ogilvie/Streeterville Express',
    121: 'Union/Streeterville Express',
    124: 'Navy Pier',
    125: 'Water Tower Express',
    126: 'Jackson',
    128: 'Soldier Field Express',
    130: 'Museum Campus',
    134: 'Stockton/LaSalle Express',
    135: 'Clarendon/LaSalle Express',
    136: 'Sheridan/LaSalle Express',
    143: 'Stockton/Michigan Express',
    146: 'Inner Lake Shore/Michigan Express',
    147: 'Outer DuSable Lake Shore Express',
    148: 'Clarendon/Michigan Express',
    151: 'Sheridan',
    152: 'Addison',
    155: 'Devon',
    156: 'LaSalle',
    157: 'Streeterville/Taylor',
    165: 'West 65th',
    169: '69th/UPS Express',
    171: 'U. of Chicago/Hyde Park',
    172: 'U. of Chicago/Kenwood',
    192: 'U. of Chicago Hospitals Express',
    201: 'Central/Ridge',
    206: 'Evanston Circulator',
};

// Night Owl routes (N-prefixed) are excluded from `allRoutes` EXCEPT N5:
// Ventra reports overnight rides under the daytime route_id (a 3 AM 87-bus
// shows up as "87 87th", not "N87"), so a rider can never actually check
// off N87/N22/N66/etc. on the bingo card. N5 stays — no daytime "5" route
// exists, so CTA tracks it as its own route end-to-end. Names map keeps
// the full set so any unexpected Ventra "N87 87th Night Bus" string still
// resolves rather than getting silently dropped by extractRouteId.
// Group routes by their numeric part so variants sit next to the base route on
// the bingo grid (e.g. 49 · 49B · X49, J14 · 15). Object.keys would otherwise
// return all integer-like keys first in numeric order, then string keys in
// insertion order, scattering letter-prefixed routes to the end.
const parseRoute = (r) => {
    const m = String(r).match(/^([A-Z]*)(\d+)([A-Z]*)$/);
    return m ? { num: parseInt(m[2], 10), prefix: m[1], suffix: m[3] } : { num: 0, prefix: '', suffix: String(r) };
};
const allRoutes = Object.keys(names)
    .filter((r) => !/^N\d/.test(r) || r === 'N5')
    .sort((a, b) => {
        const pa = parseRoute(a), pb = parseRoute(b);
        if (pa.num !== pb.num) return pa.num - pb.num;
        // Base route (no prefix/suffix) first, then suffix variants, then prefix variants.
        const rank = (p) => (!p.prefix && !p.suffix ? 0 : p.suffix && !p.prefix ? 1 : 2);
        const ra = rank(pa), rb = rank(pb);
        if (ra !== rb) return ra - rb;
        return (pa.suffix || pa.prefix).localeCompare(pb.suffix || pb.prefix);
    });

/** Pull the route ID off a Ventra bus locationRoute like "67 67th-69th-71st" → "67". */
const extractRouteId = (locationRoute) => {
    if (!locationRoute) return null;
    const token = locationRoute.trim().split(/\s+/)[0];
    if (token === '0' || !token) return null;
    return Object.prototype.hasOwnProperty.call(names, token) ? token : null;
};

const loadRiddenFile = async (filePath) => {
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.ridden)) parsed.ridden = [];
        return parsed;
    } catch (err) {
        if (err.code === 'ENOENT') return { ridden: [], lastUpdated: null };
        throw err;
    }
};

/** Scan transactions for bus rides, append any newly-detected routes, preserve existing entries. */
const updateRiddenFromTransactions = async (transactions, filePath = 'bus_routes.json') => {
    const data = await loadRiddenFile(filePath);
    const existing = new Map(data.ridden.map(r => [String(r.route), r]));

    // Walk oldest→newest so the firstRiddenDate we record is genuinely the first.
    const ordered = [...transactions].sort((a, b) => a.timestamp - b.timestamp);

    const added = [];
    for (const t of ordered) {
        if (t.type !== 'Bus') continue;
        const route = extractRouteId(t.locationRoute);
        if (!route) continue;
        if (existing.has(route)) continue;
        const entry = {
            route,
            firstRiddenDate: new Date(t.timestamp).toISOString(),
            source: 'ventra',
        };
        existing.set(route, entry);
        added.push(entry);
    }

    data.ridden = [...existing.values()].sort((a, b) => {
        // Sort by route number primarily, letter-prefix routes interleave by their numeric part
        const an = parseInt(String(a.route).match(/\d+/)?.[0] ?? '0', 10);
        const bn = parseInt(String(b.route).match(/\d+/)?.[0] ?? '0', 10);
        if (an !== bn) return an - bn;
        return String(a.route).localeCompare(String(b.route));
    });
    data.lastUpdated = new Date().toISOString();

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { added, totalRidden: data.ridden.length, totalRoutes: allRoutes.length };
};

const getBingoData = async (filePath = 'bus_routes.json') => {
    const data = await loadRiddenFile(filePath);
    const riddenMap = new Map(data.ridden.map(r => [String(r.route), r]));
    const lastBingoGeneratedAt = data.lastBingoGeneratedAt || null;
    const cutoff = lastBingoGeneratedAt ? new Date(lastBingoGeneratedAt).getTime() : null;

    const ridden = [];
    const notRidden = [];
    const newlyRidden = [];
    for (const route of allRoutes) {
        const entry = riddenMap.get(route);
        if (!entry) { notRidden.push(route); continue; }
        ridden.push(route);
        if (cutoff && entry.firstRiddenDate) {
            const t = new Date(entry.firstRiddenDate).getTime();
            if (Number.isFinite(t) && t > cutoff) newlyRidden.push(route);
        }
    }
    return { ridden, notRidden, newlyRidden, total: allRoutes.length, lastBingoGeneratedAt };
};

const stampBingoGenerated = async (filePath = 'bus_routes.json') => {
    const data = await loadRiddenFile(filePath);
    data.lastBingoGeneratedAt = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

module.exports = {
    names,
    allRoutes,
    extractRouteId,
    loadRiddenFile,
    updateRiddenFromTransactions,
    getBingoData,
    stampBingoGenerated,
};
