const fs = require('fs').promises;
const { createCanvas, registerFont } = require('canvas');

registerFont('./fonts/Montserrat-Bold.ttf',  { family: 'Montserrat', weight: '700' });
registerFont('./fonts/Montserrat-Black.ttf', { family: 'Montserrat', weight: '900' });

const CONFIG = {
    width: 1080,
    height: 1920,
    outputDir: 'wrapped_images'
};

const rideLabel = (count) => `${count} ${count === 1 ? 'ride' : 'rides'}`;

const cleanStationName = (raw) => {
    return raw
        .replace(/^(SS|DB)\s+/i, '')                  // Strip platform prefixes (SS = State St, DB = Dearborn)
        .replace(/_/g, ' ')                             // Underscores to spaces (e.g. Logan_Square → Logan Square)
        .replace(/\s+(O'Hare|Forest Park)$/i, '')      // Strip Blue line branch direction suffixes
        .replace(/([a-zA-Z])-([a-zA-Z])/g, '$1/$2')   // Hyphenated cross-streets to slash (Jackson-VanBuren → Jackson/VanBuren)
        .trim();
};

const getWeekNumber = (date) => {
    // Snap to local midnight so intra-day timestamps don't produce fractional day counts
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
    const pastDaysOfYear = Math.round((d - firstDayOfYear) / 86400000);
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
};

const analyzeVentraData = (data) => {
    const transactions = data.transactions;
    
    const stats = {
        overview: {},
        rail: {
            totalRides: 0,
            stations: {},
            lines: {},
            stationVisits: []
        },
        bus: {
            totalRides: 0,
            routes: {},
            routeUsage: []
        },
        temporal: {
            byMonth: {},
            byDayOfWeek: {},
            byHour: {},
            byWeek: {},
            byDate: {}
        },
        spending: {
            totalSpent: 0,
            byMonth: {},
            averagePerRide: 0
        }
    };

    transactions.forEach(t => {
        const date = new Date(t.timestamp);
        const month = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const dayOfWeek = date.toLocaleString('en-US', { weekday: 'long' });
        const hour = date.getHours();
        const weekNum = getWeekNumber(date);

        stats.temporal.byMonth[month] = (stats.temporal.byMonth[month] || 0) + 1;
        stats.temporal.byDayOfWeek[dayOfWeek] = (stats.temporal.byDayOfWeek[dayOfWeek] || 0) + 1;
        stats.temporal.byHour[hour] = (stats.temporal.byHour[hour] || 0) + 1;
        stats.temporal.byWeek[weekNum] = (stats.temporal.byWeek[weekNum] || 0) + 1;
        const dateKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        stats.temporal.byDate[dateKey] = (stats.temporal.byDate[dateKey] || 0) + 1;

        const amountDollars = Math.abs(t.amount / 100);
        stats.spending.totalSpent += amountDollars;
        stats.spending.byMonth[month] = (stats.spending.byMonth[month] || 0) + amountDollars;

        if (t.type === 'Rail') {
            stats.rail.totalRides++;

            const parts = t.locationRoute.split('-');
            if (parts.length >= 2) {
                const line = parts[0];
                const station = cleanStationName(parts.slice(1).join('-'));

                stats.rail.lines[line] = (stats.rail.lines[line] || 0) + 1;
                stats.rail.stations[station] = (stats.rail.stations[station] || 0) + 1;
            }
        } else if (t.type === 'Bus') {
            stats.bus.totalRides++;

            // Only aggregate named routes — skip unidentifiable entries (Deadhead, Default, route 0)
            const routeMatch = t.locationRoute.match(/^([1-9]\d*)/);
            if (routeMatch) {
                const route = routeMatch[1];
                stats.bus.routes[route] = (stats.bus.routes[route] || 0) + 1;
            }
        }
    });

    const totalRides = stats.rail.totalRides + stats.bus.totalRides;
    stats.overview = {
        totalRides,
        totalSpent: stats.spending.totalSpent,
        averagePerRide: totalRides > 0 ? stats.spending.totalSpent / totalRides : 0,
        railPercentage: totalRides > 0 ? (stats.rail.totalRides / totalRides * 100) : 0,
        busPercentage: totalRides > 0 ? (stats.bus.totalRides / totalRides * 100) : 0,
        uniqueRailStations: Object.keys(stats.rail.stations).length,
        uniqueBusRoutes: Object.keys(stats.bus.routes).length,
        busiestMonth: Object.entries(stats.temporal.byMonth).sort((a, b) => b[1] - a[1])[0],
        busiestDay: Object.entries(stats.temporal.byDayOfWeek).sort((a, b) => b[1] - a[1])[0],
        firstRide: transactions[transactions.length - 1],
        lastRide: transactions[0]
    };

    stats.rail.stationVisits = Object.entries(stats.rail.stations)
        .map(([station, count]) => ({ station, count }))
        .sort((a, b) => b.count - a.count);

    stats.bus.routeUsage = Object.entries(stats.bus.routes)
        .map(([route, count]) => ({ route, count }))
        .sort((a, b) => b.count - a.count);

    return stats;
};

const generateInsights = (stats, isMonthly = false) => {
    const insights = [];

    if (stats.rail.stationVisits.length > 0) {
        const topStation = stats.rail.stationVisits[0];
        insights.push({
            title: "Your Home Station",
            value: topStation.station,
            detail: rideLabel(topStation.count)
        });
    }

    const topLine = Object.entries(stats.rail.lines).sort((a, b) => b[1] - a[1])[0];
    if (topLine) {
        insights.push({
            title: "Favorite Line",
            value: `${topLine[0]} Line`,
            detail: rideLabel(topLine[1])
        });
    }

    if (stats.bus.routeUsage.length > 0) {
        const topRoute = stats.bus.routeUsage[0];
        insights.push({
            title: "Go-To Bus",
            value: `#${topRoute.route}`,
            detail: rideLabel(topRoute.count)
        });
    }

    const peakHour = Object.entries(stats.temporal.byHour).sort((a, b) => b[1] - a[1])[0];
    if (peakHour) {
        const hour = parseInt(peakHour[0]);
        const timeLabel = hour < 12 ? `${hour}AM` : hour === 12 ? '12PM' : `${hour - 12}PM`;
        insights.push({
            title: "Peak Hour",
            value: timeLabel,
            detail: rideLabel(peakHour[1])
        });
    }

    if (isMonthly) {
        const busiestDate = Object.entries(stats.temporal.byDate).sort((a, b) => b[1] - a[1])[0];
        if (busiestDate) {
            insights.push({
                title: "Most Active Day",
                value: busiestDate[0],
                detail: rideLabel(busiestDate[1])
            });
        }
    } else if (stats.overview.busiestMonth) {
        insights.push({
            title: "Busiest Month",
            value: stats.overview.busiestMonth[0],
            detail: rideLabel(stats.overview.busiestMonth[1])
        });
    }

    const preference = stats.overview.railPercentage > stats.overview.busPercentage ? 'Rail' : 'Bus';
    const percentage = Math.max(stats.overview.railPercentage, stats.overview.busPercentage);
    insights.push({
        title: "Your Transit Style",
        value: `${preference} Rider`,
        detail: `${percentage.toFixed(0)}% of rides`
    });

    return insights;
};

/** Returns the Monday and Sunday of the given week number in the given year */
const getWeekDateRange = (year, weekNum) => {
    const jan1 = new Date(year, 0, 1);
    const startWeek = getWeekNumber(jan1);
    const daysOffset = (weekNum - startWeek) * 7;
    const dayInWeek = new Date(year, 0, 1 + daysOffset);

    const dow = dayInWeek.getDay(); // 0 = Sun
    const toMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(dayInWeek);
    monday.setDate(dayInWeek.getDate() + toMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: monday, end: sunday };
};

const filterByPeriod = (transactions, year, month = null, week = null) => {
    return transactions.filter(t => {
        const date = new Date(t.timestamp);
        const txYear = date.getFullYear();

        if (week !== null) {
            return txYear === year && getWeekNumber(date) === week;
        } else if (month) {
            return txYear === year && date.getMonth() + 1 === month;
        } else {
            return txYear === year;
        }
    });
};

const roundRect = (ctx, x, y, width, height, radius) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
};

// ============================================================================
// Design system: Wrapped-style art
// ============================================================================

const PALETTES = [
    { name: 'acid',    bg: '#0E0E0E', primary: '#FAFF00', secondary: '#FF3B7C', accent: '#00E0FF', ink: '#FAFF00' },
    { name: 'plasma',  bg: '#1A0033', primary: '#FF006E', secondary: '#FFBE0B', accent: '#3A86FF', ink: '#FFFFFF' },
    { name: 'vapor',   bg: '#1B0033', primary: '#FF00C8', secondary: '#00FFE0', accent: '#FFE600', ink: '#FFFFFF' },
    { name: 'mint',    bg: '#2E1A47', primary: '#00FF88', secondary: '#FF4E50', accent: '#FFE7A0', ink: '#FFFFFF' },
    { name: 'solar',   bg: '#003566', primary: '#FFD60A', secondary: '#FF4500', accent: '#FFFFFF', ink: '#FFFFFF' },
    { name: 'noir',    bg: '#FAFF00', primary: '#0E0E0E', secondary: '#FF3B7C', accent: '#00E0FF', ink: '#0E0E0E' },
    { name: 'magma',   bg: '#FF4500', primary: '#1A1A1A', secondary: '#FFD60A', accent: '#FFFFFF', ink: '#1A1A1A' },
    { name: 'electric',bg: '#3A86FF', primary: '#FFE600', secondary: '#FF006E', accent: '#FFFFFF', ink: '#0E0E0E' },
];

const hashSeed = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
};

const seededRng = (seed) => {
    let a = seed | 0;
    return () => {
        a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const pickPalette = (seedStr) => PALETTES[hashSeed(seedStr) % PALETTES.length];

const fillBg = (ctx, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
};

/** Cheap film-grain via scattered semi-transparent specks */
const applyGrain = (ctx, count = 5500) => {
    for (let i = 0; i < count; i++) {
        const x = Math.random() * CONFIG.width;
        const y = Math.random() * CONFIG.height;
        const size = Math.random() * 1.8 + 0.4;
        const light = Math.random() > 0.5;
        const alpha = Math.random() * 0.18;
        ctx.fillStyle = light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
        ctx.fillRect(x, y, size, size);
    }
};

/** Organic blob shape — kept as an off-canvas corner accent so it never lands under body copy */
const drawBlob = (ctx, cx, cy, baseR, color, seed = 1) => {
    const rng = seededRng(seed);
    const points = 9;
    const angles = [];
    const radii = [];
    for (let i = 0; i < points; i++) {
        angles.push((i / points) * Math.PI * 2);
        radii.push(baseR * (0.78 + rng() * 0.42));
    }
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
        const cur = i % points;
        const next = (i + 1) % points;
        const x = cx + Math.cos(angles[cur]) * radii[cur];
        const y = cy + Math.sin(angles[cur]) * radii[cur];
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            const ma = (angles[cur] + angles[next]) / 2;
            const mr = (radii[cur] + radii[next]) / 2 * 1.08;
            ctx.quadraticCurveTo(
                cx + Math.cos(ma) * mr,
                cy + Math.sin(ma) * mr,
                cx + Math.cos(angles[next]) * radii[next],
                cy + Math.sin(angles[next]) * radii[next]
            );
        }
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
};

/** Star/burst shape (sticker) */
const drawStar = (ctx, cx, cy, points, outerR, innerR, color, rotation = 0) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
};

/** Sine-wave squiggle line */
const drawSquiggle = (ctx, x, y, length, amplitude, waves, color, lineWidth = 10) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= length; i += 2) {
        const wy = y + Math.sin((i / length) * Math.PI * 2 * waves) * amplitude;
        if (i === 0) ctx.moveTo(x + i, wy);
        else ctx.lineTo(x + i, wy);
    }
    ctx.stroke();
};

/** Rotated text with full styling control */
const drawRotated = (ctx, text, x, y, angle, fontSize, weight, color, align = 'center') => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = `${weight} ${fontSize}px Montserrat`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
};

/** Sticker tag: pill background with text inside */
const drawTag = (ctx, text, cx, cy, fontSize, weight, bgColor, fgColor, angle = 0, padding = 24) => {
    ctx.save();
    ctx.font = `${weight} ${fontSize}px Montserrat`;
    const m = ctx.measureText(text);
    const w = m.width + padding * 2;
    const h = fontSize * 1.35;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = bgColor;
    roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fgColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, fontSize * 0.05);
    ctx.restore();
};

/** Hero number/text that auto-fits to a max width */
const drawHero = (ctx, text, cx, cy, maxWidth, maxFontSize, weight, color, angle = 0) => {
    let fs = maxFontSize;
    ctx.font = `${weight} ${fs}px Montserrat`;
    while (ctx.measureText(text).width > maxWidth && fs > 60) {
        fs -= 10;
        ctx.font = `${weight} ${fs}px Montserrat`;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
    return fs;
};

/** Outlined hero text (stroke only) */
const drawHeroOutline = (ctx, text, cx, cy, maxWidth, maxFontSize, weight, color, lineWidth, angle = 0) => {
    let fs = maxFontSize;
    ctx.font = `${weight} ${fs}px Montserrat`;
    while (ctx.measureText(text).width > maxWidth && fs > 60) {
        fs -= 10;
        ctx.font = `${weight} ${fs}px Montserrat`;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(text, 0, 0);
    ctx.restore();
    return fs;
};

const generateOverviewImage = async (stats, period) => {
    const palette = pickPalette(period);
    const rng = seededRng(hashSeed(period));
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    const W = CONFIG.width, H = CONFIG.height;

    fillBg(ctx, palette.bg);

    // Backdrop blobs (off-canvas anchored)
    drawBlob(ctx, W * 1.26, H * 0.12, 340, palette.secondary, hashSeed(period + 'b1'));
    drawBlob(ctx, -W * 0.26, H * 0.82, 340, palette.accent, hashSeed(period + 'b2'));

    // Header tag
    drawTag(ctx, 'CTA WRAPPED', W / 2, 150, 44, '900', palette.primary, palette.bg, -0.04, 36);
    drawRotated(ctx, period.toUpperCase(), W / 2, 235, -0.04, 38, '700', palette.ink);

    // Hero ride count — fills the canvas
    const totalStr = stats.overview.totalRides.toLocaleString();
    drawHero(ctx, totalStr, W / 2 + 8, 720, W * 0.92, 820, '900', palette.primary, -0.025);
    drawHeroOutline(ctx, totalStr, W / 2 - 14, 712, W * 0.92, 820, '900', palette.secondary, 6, -0.025);

    // Below-hero label
    drawTag(ctx, 'RIDES', W / 2 - 160, 1110, 56, '900', palette.bg, palette.primary, 0.03, 40);
    drawTag(ctx, 'TAKEN', W / 2 + 170, 1110, 56, '900', palette.secondary, palette.bg, -0.03, 40);

    // Squiggle separator
    drawSquiggle(ctx, 100, 1240, 880, 14, 6, palette.accent, 8);

    // Hard color-block split bar (rail vs bus)
    const splitY = 1320, splitH = 240;
    const railFrac = Math.max(0.08, Math.min(0.92, stats.overview.railPercentage / 100));
    ctx.fillStyle = palette.primary;
    ctx.fillRect(0, splitY, W * railFrac, splitH);
    ctx.fillStyle = palette.secondary;
    ctx.fillRect(W * railFrac, splitY, W * (1 - railFrac), splitH);

    // Rail label inside primary block
    ctx.save();
    ctx.fillStyle = palette.bg;
    ctx.font = '900 36px Montserrat';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('RAIL', 38, splitY + 28);
    ctx.font = '900 110px Montserrat';
    ctx.fillText(`${stats.overview.railPercentage.toFixed(0)}%`, 32, splitY + 78);
    ctx.restore();

    // Bus label inside secondary block
    ctx.save();
    ctx.fillStyle = palette.bg;
    ctx.font = '900 36px Montserrat';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('BUS', W - 38, splitY + 28);
    ctx.font = '900 110px Montserrat';
    ctx.fillText(`${stats.overview.busPercentage.toFixed(0)}%`, W - 28, splitY + 78);
    ctx.restore();

    // Bottom: spend + avg as side-by-side bold blocks
    const blockY = 1620, blockH = 220;
    ctx.fillStyle = palette.accent;
    ctx.fillRect(0, blockY, W / 2, blockH);
    ctx.fillStyle = palette.primary;
    ctx.fillRect(W / 2, blockY, W / 2, blockH);

    ctx.fillStyle = palette.bg;
    ctx.font = '700 26px Montserrat';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('TOTAL SPENT', W / 4, blockY + 36);
    ctx.font = '900 92px Montserrat';
    ctx.fillText(`$${stats.overview.totalSpent.toFixed(0)}`, W / 4, blockY + 80);

    ctx.font = '700 26px Montserrat';
    ctx.fillText('AVG / RIDE', (W * 3) / 4, blockY + 36);
    ctx.font = '900 92px Montserrat';
    ctx.fillText(`$${stats.overview.averagePerRide.toFixed(2)}`, (W * 3) / 4, blockY + 80);

    // Decorative stickers/bursts
    drawStar(ctx, 130, 1180, 4, 56, 18, palette.primary, rng() * Math.PI);
    drawStar(ctx, W - 110, 1190, 5, 44, 16, palette.accent, rng() * Math.PI);
    drawStar(ctx, 90, 380, 6, 38, 14, palette.primary, rng() * Math.PI);
    drawStar(ctx, W - 80, 1560, 4, 50, 18, palette.bg, rng() * Math.PI);

    // Grain overlay
    applyGrain(ctx, 6500);

    return canvas.toBuffer('image/png');
};

const generateRailImage = async (stats, insights, period) => {
    const palette = pickPalette(period);
    const rng = seededRng(hashSeed(period + 'rail'));
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    const W = CONFIG.width, H = CONFIG.height;

    fillBg(ctx, palette.bg);
    drawBlob(ctx, -W * 0.26, H * 0.13, 330, palette.secondary, hashSeed(period + 'rail-b1'));
    drawBlob(ctx, W * 1.27, H * 0.14, 330, palette.accent, hashSeed(period + 'rail-b2'));

    drawTag(ctx, 'RAIL JOURNEY', W / 2, 130, 38, '900', palette.primary, palette.bg, -0.03, 32);

    const home = stats.rail.stationVisits[0];
    const homeName = home ? home.station.toUpperCase() : 'NO RIDES';
    drawRotated(ctx, 'HOME STATION', W / 2, 240, -0.02, 30, '700', palette.ink);
    drawHero(ctx, homeName, W / 2, 430, W * 0.94, 200, '900', palette.primary, -0.02);
    drawHeroOutline(ctx, homeName, W / 2 - 8, 422, W * 0.94, 200, '900', palette.secondary, 5, -0.02);
    if (home) {
        drawRotated(ctx, rideLabel(home.count).toUpperCase(), W / 2, 560, 0.04, 32, '700', palette.ink);
    }

    // Hard color-block stats strip
    const stripY = 640, stripH = 200;
    ctx.fillStyle = palette.primary;
    ctx.fillRect(0, stripY, W / 2, stripH);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(W / 2, stripY, W / 2, stripH);

    ctx.fillStyle = palette.bg;
    ctx.font = '700 26px Montserrat';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('TOTAL RIDES', W / 4, stripY + 32);
    ctx.font = '900 100px Montserrat';
    ctx.fillText(stats.rail.totalRides.toString(), W / 4, stripY + 72);

    ctx.font = '700 26px Montserrat';
    ctx.fillText('STATIONS', (W * 3) / 4, stripY + 32);
    ctx.font = '900 100px Montserrat';
    ctx.fillText(stats.overview.uniqueRailStations.toString(), (W * 3) / 4, stripY + 72);

    drawSquiggle(ctx, 80, 900, 920, 12, 5, palette.secondary, 7);
    drawTag(ctx, 'TOP STATIONS', W / 2, 970, 30, '900', palette.secondary, palette.bg, 0.03, 24);

    // Typographic stack: station names sized by rides
    const top = stats.rail.stationVisits.slice(0, 5);
    const maxCount = top[0]?.count || 1;
    // Alternate primary/secondary only — accent is white or near-white in several palettes
    const colors = [palette.primary, palette.secondary, palette.primary, palette.secondary, palette.primary];
    let yPos = 1080;
    top.forEach((s, i) => {
        const ratio = s.count / maxCount;
        const baseSize = 50 + ratio * 50;
        const angle = (rng() - 0.5) * 0.06;
        // Auto-fit to width
        const label = s.station.toUpperCase();
        let fs = baseSize;
        ctx.font = `900 ${fs}px Montserrat`;
        const countText = `  ${s.count}`;
        ctx.font = `700 ${Math.round(fs * 0.5)}px Montserrat`;
        const countW = ctx.measureText(countText).width;
        ctx.font = `900 ${fs}px Montserrat`;
        while (ctx.measureText(label).width + countW > W - 120 && fs > 28) {
            fs -= 4;
            ctx.font = `900 ${fs}px Montserrat`;
        }
        ctx.save();
        ctx.translate(60, yPos);
        ctx.rotate(angle);
        ctx.fillStyle = colors[i];
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = `900 ${fs}px Montserrat`;
        ctx.fillText(label, 0, 0);
        const labelW = ctx.measureText(label).width;
        ctx.font = `700 ${Math.round(fs * 0.5)}px Montserrat`;
        ctx.fillStyle = palette.ink;
        ctx.fillText(`  ${s.count}`, labelW, 0);
        ctx.restore();
        yPos += fs + 30;
    });

    drawStar(ctx, 90, 1010, 5, 36, 12, palette.accent, rng() * Math.PI);
    drawStar(ctx, W - 90, 1820, 4, 40, 14, palette.primary, rng() * Math.PI);

    applyGrain(ctx, 6500);
    return canvas.toBuffer('image/png');
};

const generateBusImage = async (stats, insights, period) => {
    const palette = pickPalette(period);
    const rng = seededRng(hashSeed(period + 'bus'));
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    const W = CONFIG.width, H = CONFIG.height;

    fillBg(ctx, palette.bg);
    drawBlob(ctx, -W * 0.26, H * 0.13, 330, palette.primary, hashSeed(period + 'bus-b1'));
    drawBlob(ctx, W * 1.27, H * 0.36, 330, palette.secondary, hashSeed(period + 'bus-b2'));

    drawTag(ctx, 'BUS ROUTES', W / 2, 130, 38, '900', palette.accent, palette.bg, -0.03, 32);

    const top = stats.bus.routeUsage[0];
    const goToLabel = top ? `#${top.route}` : 'N/A';
    drawRotated(ctx, 'GO-TO BUS', W / 2, 250, -0.02, 30, '700', palette.ink);
    drawHero(ctx, goToLabel, W / 2, 540, W * 0.85, 520, '900', palette.primary, -0.04);
    drawHeroOutline(ctx, goToLabel, W / 2 - 12, 530, W * 0.85, 520, '900', palette.secondary, 6, -0.04);
    if (top) {
        drawRotated(ctx, rideLabel(top.count).toUpperCase(), W / 2, 820, 0.04, 36, '700', palette.ink);
    }

    drawSquiggle(ctx, 80, 920, 920, 12, 5, palette.accent, 7);
    drawTag(ctx, 'ALSO RODE', W / 2, 990, 30, '900', palette.accent, palette.bg, 0.03, 24);

    // Scattered route stickers (circles with route number)
    const others = stats.bus.routeUsage.slice(1, 7);
    if (others.length > 0) {
        const cols = others.length <= 2 ? 2 : 3;
        const rows = Math.ceil(others.length / cols);
        const cellW = W / cols;
        const cellH = 600 / rows;
        const startY = 1100;
        // Skip palette.accent — often white and washes out on the bg
        const colors = [palette.primary, palette.secondary];
        const maxOtherCount = others[0].count;

        others.forEach((r, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const cx = (col + 0.5) * cellW + (rng() - 0.5) * 50;
            const cy = startY + (row + 0.5) * cellH + (rng() - 0.5) * 30;
            const sizeScale = 0.7 + (r.count / maxOtherCount) * 0.45;
            const size = Math.min(cellW * 0.78, cellH * 0.92) * sizeScale;
            const angle = (rng() - 0.5) * 0.4;
            const c = colors[i % colors.length];

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = palette.bg;
            ctx.font = `900 ${Math.round(size * 0.34)}px Montserrat`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`#${r.route}`, 0, -size * 0.07);
            ctx.font = `700 ${Math.round(size * 0.14)}px Montserrat`;
            ctx.fillText(rideLabel(r.count).toUpperCase(), 0, size * 0.22);
            ctx.restore();
        });
    }

    // Bottom stats hard-block strip
    const stripY = 1700, stripH = 200;
    ctx.fillStyle = palette.primary;
    ctx.fillRect(0, stripY, W / 2, stripH);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(W / 2, stripY, W / 2, stripH);

    ctx.fillStyle = palette.bg;
    ctx.font = '700 24px Montserrat';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('TOTAL RIDES', W / 4, stripY + 30);
    ctx.font = '900 92px Montserrat';
    ctx.fillText(stats.bus.totalRides.toString(), W / 4, stripY + 70);

    ctx.font = '700 24px Montserrat';
    ctx.fillText('UNIQUE', (W * 3) / 4, stripY + 30);
    ctx.font = '900 92px Montserrat';
    ctx.fillText(stats.overview.uniqueBusRoutes.toString(), (W * 3) / 4, stripY + 70);

    applyGrain(ctx, 6500);
    return canvas.toBuffer('image/png');
};

const generateTimeOfDayImage = async (stats, period) => {
    const palette = pickPalette(period);
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    const W = CONFIG.width, H = CONFIG.height;

    fillBg(ctx, palette.bg);
    drawBlob(ctx, W * 1.27, -170, 330, palette.accent, hashSeed(period + 'time-b1'));
    drawBlob(ctx, -W * 0.27, H * 0.5, 320, palette.secondary, hashSeed(period + 'time-b2'));

    drawTag(ctx, 'WHEN YOU RIDE', W / 2, 130, 38, '900', palette.primary, palette.bg, -0.03, 32);

    const peak = Object.entries(stats.temporal.byHour).sort((a, b) => b[1] - a[1])[0];
    const hour = peak ? parseInt(peak[0]) : 0;
    const timeLabel = hour === 0 ? '12AM' : hour < 12 ? `${hour}AM` : hour === 12 ? '12PM' : `${hour - 12}PM`;

    drawRotated(ctx, 'PEAK HOUR', W / 2, 250, -0.02, 30, '700', palette.ink);
    drawHero(ctx, timeLabel, W / 2, 540, W * 0.92, 480, '900', palette.primary, -0.03);
    drawHeroOutline(ctx, timeLabel, W / 2 - 12, 530, W * 0.92, 480, '900', palette.secondary, 6, -0.03);
    if (peak) {
        drawRotated(ctx, rideLabel(peak[1]).toUpperCase(), W / 2, 820, 0.04, 36, '700', palette.ink);
    }

    drawSquiggle(ctx, 80, 920, 920, 12, 5, palette.accent, 7);
    drawTag(ctx, '24 HOUR ACTIVITY', W / 2, 990, 28, '900', palette.accent, palette.bg, 0.03, 24);

    // Sculptural 24-bar chart — peak hour leads in primary
    const maxRides = Math.max(...Object.values(stats.temporal.byHour), 1);
    const peakHour = peak ? parseInt(peak[0]) : -1;
    const chartTop = 1100, chartBot = 1810;
    const chartH = chartBot - chartTop;
    const barW = 36, gap = 6;
    const totalW = 24 * barW + 23 * gap;
    const startX = (W - totalW) / 2;

    for (let h = 0; h < 24; h++) {
        const rides = stats.temporal.byHour[h] || 0;
        const x = startX + h * (barW + gap);
        // Ghost bar
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, chartTop, barW, chartH);
        if (rides > 0) {
            const bh = Math.max((rides / maxRides) * chartH, 14);
            ctx.fillStyle = h === peakHour ? palette.primary : palette.secondary;
            ctx.fillRect(x, chartBot - bh, barW, bh);
        }
        if (h % 3 === 0) {
            const lbl = h === 0 ? '12A' : h < 12 ? `${h}A` : h === 12 ? '12P' : `${h - 12}P`;
            ctx.fillStyle = palette.ink;
            ctx.font = '700 18px Montserrat';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(lbl, x + barW / 2, chartBot + 16);
        }
    }

    applyGrain(ctx, 6500);
    return canvas.toBuffer('image/png');
};

const generateDayOfWeekImage = async (stats, period) => {
    const palette = pickPalette(period);
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    const W = CONFIG.width, H = CONFIG.height;

    fillBg(ctx, palette.bg);
    drawBlob(ctx, -W * 0.26, H * 0.13, 330, palette.secondary, hashSeed(period + 'dow-b1'));
    drawBlob(ctx, W * 1.27, H * 0.13, 330, palette.accent, hashSeed(period + 'dow-b2'));

    drawTag(ctx, 'YOUR WEEK', W / 2, 130, 38, '900', palette.primary, palette.bg, -0.03, 32);

    const busiest = stats.overview.busiestDay;
    const busiestName = busiest ? busiest[0].toUpperCase() : 'NONE';
    drawRotated(ctx, 'BUSIEST DAY', W / 2, 240, -0.02, 30, '700', palette.ink);
    drawHero(ctx, busiestName, W / 2, 430, W * 0.94, 220, '900', palette.primary, -0.025);
    drawHeroOutline(ctx, busiestName, W / 2 - 8, 422, W * 0.94, 220, '900', palette.secondary, 5, -0.025);
    if (busiest) {
        drawRotated(ctx, rideLabel(busiest[1]).toUpperCase(), W / 2, 580, 0.04, 32, '700', palette.ink);
    }

    // Hard color split: weekday vs weekend
    const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayData = daysOrder.map(d => ({ day: d, count: stats.temporal.byDayOfWeek[d] || 0 }));
    const weekdayRides = dayData.slice(0, 5).reduce((s, d) => s + d.count, 0);
    const weekendRides = dayData.slice(5).reduce((s, d) => s + d.count, 0);

    const splitY = 660, splitH = 200;
    const totalRides = Math.max(weekdayRides + weekendRides, 1);
    const wdFrac = Math.max(0.18, Math.min(0.82, weekdayRides / totalRides));
    ctx.fillStyle = palette.primary;
    ctx.fillRect(0, splitY, W * wdFrac, splitH);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(W * wdFrac, splitY, W * (1 - wdFrac), splitH);

    ctx.fillStyle = palette.bg;
    ctx.font = '700 24px Montserrat';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('WEEKDAY', 30, splitY + 28);
    ctx.font = '900 100px Montserrat';
    ctx.fillText(weekdayRides.toString(), 24, splitY + 68);

    ctx.font = '700 24px Montserrat';
    ctx.textAlign = 'right';
    ctx.fillText('WEEKEND', W - 30, splitY + 28);
    ctx.font = '900 100px Montserrat';
    ctx.fillText(weekendRides.toString(), W - 24, splitY + 68);

    drawSquiggle(ctx, 80, 920, 920, 12, 5, palette.secondary, 7);
    drawTag(ctx, 'DAILY BREAKDOWN', W / 2, 990, 28, '900', palette.secondary, palette.bg, 0.03, 24);

    // 7-day horizontal bars — busiest in primary, others in muted secondary
    const maxDay = Math.max(...dayData.map(d => d.count), 1);
    const rowH = 92, rowGap = 8;
    const startY = 1080;
    const labelX = 60, barStart = 200;
    const barMaxW = W - barStart - 100;

    dayData.forEach((d, i) => {
        const y = startY + i * (rowH + rowGap);
        ctx.fillStyle = palette.ink;
        ctx.font = '900 38px Montserrat';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.day.substring(0, 3).toUpperCase(), labelX, y + rowH / 2);

        const bw = (d.count / maxDay) * barMaxW;
        const isMax = d.count === maxDay && d.count > 0;
        ctx.fillStyle = isMax ? palette.primary : palette.secondary;
        ctx.fillRect(barStart, y + rowH * 0.22, Math.max(bw, 8), rowH * 0.56);

        ctx.fillStyle = palette.ink;
        ctx.font = '700 32px Montserrat';
        ctx.textAlign = 'left';
        ctx.fillText(d.count.toString(), barStart + Math.max(bw, 8) + 18, y + rowH / 2);
    });

    applyGrain(ctx, 6500);
    return canvas.toBuffer('image/png');
};

const generatePersonalityImage = async (_stats, insights, period) => {
    const palette = pickPalette(period);
    const rng = seededRng(hashSeed(period + 'persona'));
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    const W = CONFIG.width, H = CONFIG.height;

    fillBg(ctx, palette.bg);
    drawBlob(ctx, W * 1.27, H * 0.12, 340, palette.secondary, hashSeed(period + 'p-b1'));
    drawBlob(ctx, -W * 0.26, H * 0.87, 340, palette.accent, hashSeed(period + 'p-b2'));

    drawTag(ctx, 'YOUR TRANSIT', W / 2, 130, 38, '900', palette.primary, palette.bg, -0.03, 32);

    const personality = insights.find(i => i.title === 'Your Transit Style');
    const personaLabel = personality ? personality.value.toUpperCase() : 'TRANSIT RIDER';
    drawRotated(ctx, 'PERSONALITY', W / 2, 240, -0.02, 32, '700', palette.ink);
    drawHero(ctx, personaLabel, W / 2, 470, W * 0.94, 220, '900', palette.primary, -0.025);
    drawHeroOutline(ctx, personaLabel, W / 2 - 10, 462, W * 0.94, 220, '900', palette.secondary, 5, -0.025);
    if (personality) {
        drawRotated(ctx, personality.detail.toUpperCase(), W / 2, 600, 0.04, 30, '700', palette.ink);
    }

    // Other insights as scattered bold tags. Odd count → last tag spans full width.
    const others = insights.filter(i => i.title !== 'Your Transit Style');
    const cols = 2;
    const lastSpansFull = others.length % 2 === 1;
    const gridCount = lastSpansFull ? others.length - 1 : others.length;
    const gridRows = gridCount / cols;
    const totalRows = gridRows + (lastSpansFull ? 1 : 0);
    const tagAreaTop = 700;
    const tagAreaBot = 1750;
    const cellW = (W - 80) / cols;
    const cellH = (tagAreaBot - tagAreaTop) / Math.max(totalRows, 1);
    const colors = [palette.primary, palette.accent];

    others.forEach((insight, i) => {
        const isLast = lastSpansFull && i === others.length - 1;
        let cx, cy, tagW, tagH;
        if (isLast) {
            cx = W / 2 + (rng() - 0.5) * 10;
            cy = tagAreaTop + (gridRows + 0.5) * cellH + (rng() - 0.5) * 10;
            tagW = W - 80;
            tagH = cellH * 0.78;
        } else {
            const col = i % cols;
            const row = Math.floor(i / cols);
            cx = 40 + (col + 0.5) * cellW + (rng() - 0.5) * 26;
            cy = tagAreaTop + (row + 0.5) * cellH + (rng() - 0.5) * 22;
            tagW = cellW - 24;
            tagH = cellH * 0.78;
        }
        const angle = (rng() - 0.5) * 0.16;
        const bgC = colors[i % colors.length];

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.fillStyle = bgC;
        roundRect(ctx, -tagW / 2, -tagH / 2, tagW, tagH, 28);
        ctx.fill();

        ctx.fillStyle = palette.bg;
        ctx.font = '700 22px Montserrat';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(insight.title.toUpperCase(), 0, -tagH / 2 + 36);

        // Auto-fit value
        let vfs = 60;
        const valueText = insight.value.toUpperCase();
        ctx.font = `900 ${vfs}px Montserrat`;
        while (ctx.measureText(valueText).width > tagW - 36 && vfs > 24) {
            vfs -= 4;
            ctx.font = `900 ${vfs}px Montserrat`;
        }
        ctx.fillText(valueText, 0, 4);

        ctx.font = '700 22px Montserrat';
        ctx.fillText(insight.detail, 0, tagH / 2 - 32);
        ctx.restore();
    });

    drawStar(ctx, 90, 720, 5, 38, 14, palette.accent, rng() * Math.PI);
    drawStar(ctx, W - 80, 1740, 4, 42, 16, palette.primary, rng() * Math.PI);

    applyGrain(ctx, 6500);
    return canvas.toBuffer('image/png');
};

const generateWrapped = async (year, month = null, week = null) => {
    try {
        await fs.mkdir(CONFIG.outputDir, { recursive: true });

        const rawData = JSON.parse(await fs.readFile('./ventra_transactions.json', 'utf-8'));
        const filteredTransactions = filterByPeriod(rawData.transactions, year, month, week);

        if (filteredTransactions.length === 0) {
            let label = year.toString();
            if (week !== null) label += `-w${week.toString().padStart(2, '0')}`;
            else if (month) label += `-${month.toString().padStart(2, '0')}`;
            console.log(`No transactions found for ${label}`);
            return null;
        }

        const data = { ...rawData, transactions: filteredTransactions };
        const stats = analyzeVentraData(data);
        const insights = generateInsights(stats, month !== null || week !== null);

        let period, filePrefix;
        if (week !== null) {
            const { start, end } = getWeekDateRange(year, week);
            const fmt = { month: 'short', day: 'numeric' };
            period = `${start.toLocaleDateString('en-US', fmt)} – ${end.toLocaleDateString('en-US', { ...fmt, year: 'numeric' })}`;
            filePrefix = `${year}-w${week.toString().padStart(2, '0')}`;
        } else if (month) {
            period = `${new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })} ${year}`;
            filePrefix = `${year}-${month.toString().padStart(2, '0')}`;
        } else {
            period = year.toString();
            filePrefix = `${year}`;
        }
        
        console.log(`\nGenerating CTA Wrapped for ${period}...`);
        console.log(`Total transactions: ${filteredTransactions.length}\n`);
        
        const images = [
            { name: '1-overview', fn: () => generateOverviewImage(stats, period) },
            { name: '2-rail', fn: () => generateRailImage(stats, insights, period) },
            { name: '3-bus', fn: () => generateBusImage(stats, insights, period) },
            { name: '4-time-of-day', fn: () => generateTimeOfDayImage(stats, period) },
            { name: '5-day-of-week', fn: () => generateDayOfWeekImage(stats, period) },
            { name: '6-personality', fn: () => generatePersonalityImage(stats, insights, period) }
        ];
        
        const filePaths = [];
        for (const img of images) {
            const buffer = await img.fn();
            const filename = `${CONFIG.outputDir}/${filePrefix}-${img.name}.png`;
            await fs.writeFile(filename, buffer);
            filePaths.push(filename);
            console.log(`Generated ${filename}`);
        }

        console.log(`\nAll 6 images saved to ${CONFIG.outputDir}/`);

        return { filePaths, period, filePrefix };

    } catch (error) {
        console.error('Error generating wrapped:', error);
        return null;
    }
};

const emailWrapped = async (result) => {
    if (!result) {
        console.log('Nothing to email');
        return;
    }
    const { sendMail } = require('./mailer.js');
    const path = require('path');
    await sendMail({
        subject: `🚇 CTA Wrapped: ${result.period}`,
        text: `Your CTA Wrapped for ${result.period} is attached.`,
        attachments: result.filePaths.map(p => ({ filename: path.basename(p), path: p }))
    });
};

const args = process.argv.slice(2);
const shouldEmail = args.includes('--email');
const positional = args.filter(a => !a.startsWith('--'));

const run = async () => {
    if (positional.length === 0) {
        console.log('Usage:');
        console.log('  node generate_wrapped.js 2026                # Full year');
        console.log('  node generate_wrapped.js 2026 1              # Specific month (January)');
        console.log('  node generate_wrapped.js 2026 12             # December');
        console.log('  node generate_wrapped.js 2026 w14            # Week 14');
        console.log('  node generate_wrapped.js last-month --email  # Previous month, emailed');
        console.log('  node generate_wrapped.js last-week --email   # Previous week, emailed');
        return;
    }

    let result;
    if (positional[0] === 'last-month') {
        const now = new Date();
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        result = await generateWrapped(prev.getFullYear(), prev.getMonth() + 1);
    } else if (positional[0] === 'last-week') {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        result = await generateWrapped(yesterday.getFullYear(), null, getWeekNumber(yesterday));
    } else {
        const year = parseInt(positional[0]);
        const arg2 = positional[1] || null;
        if (arg2 && /^w\d+$/i.test(arg2)) {
            result = await generateWrapped(year, null, parseInt(arg2.slice(1)));
        } else {
            const month = arg2 ? parseInt(arg2) : null;
            result = await generateWrapped(year, month);
        }
    }

    if (shouldEmail) await emailWrapped(result);
};

if (require.main === module) {
    run();
}

module.exports = { generateWrapped, emailWrapped, getWeekNumber, analyzeVentraData, generateInsights };