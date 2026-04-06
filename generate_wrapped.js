const fs = require('fs').promises;
const { createCanvas, loadImage, registerFont } = require('canvas');

registerFont('./fonts/Montserrat-Regular.ttf',   { family: 'Montserrat', weight: '400' });
registerFont('./fonts/Montserrat-SemiBold.ttf',  { family: 'Montserrat', weight: '600' });
registerFont('./fonts/Montserrat-Bold.ttf',      { family: 'Montserrat', weight: '700' });
registerFont('./fonts/Montserrat-ExtraBold.ttf', { family: 'Montserrat', weight: '800' });
registerFont('./fonts/Montserrat-Black.ttf',     { family: 'Montserrat', weight: '900' });
const twemoji = require('twemoji');

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

const createGradient = (ctx, colors) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, CONFIG.height);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    return gradient;
};

const createSlide = (colors) => {
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = createGradient(ctx, colors);
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
    
    return { canvas, ctx };
};

const drawText = (ctx, text, x, y, fontSize, fontWeight = 'normal', align = 'center') => {
    ctx.font = `${fontWeight} ${fontSize}px Montserrat`;
    ctx.fillStyle = 'white';
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
};

const drawEmoji = async (ctx, emoji, x, y, size) => {
    try {
        const codePoint = twemoji.convert.toCodePoint(emoji);
        const emojiUrl = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codePoint}.png`;
        
        const image = await loadImage(emojiUrl);
        ctx.drawImage(image, x - size/2, y - size/2, size, size);
    } catch (error) {
        console.log(`Could not load emoji ${emoji}:`, error.message);
        ctx.font = `${size}px Arial`;
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(emoji, x, y);
    }
};

const drawDecorations = async (ctx, items) => {
    for (const item of items) {
        ctx.save();
        ctx.globalAlpha = item.opacity;
        if (item.rotation) {
            ctx.translate(item.x, item.y);
            ctx.rotate(item.rotation);
            ctx.translate(-item.x, -item.y);
        }
        await drawEmoji(ctx, item.emoji, item.x, item.y, item.size);
        ctx.restore();
    }
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

const generateOverviewImage = async (stats, period) => {
    const { canvas, ctx } = createSlide(['#667eea', '#764ba2']);

    await drawDecorations(ctx, [
        // Upper side margins
        { emoji: '🚇', x: 75,   y: 490, size: 65, opacity: 0.10, rotation: -0.35 },
        { emoji: '🚌', x: 1005, y: 475, size: 60, opacity: 0.10, rotation:  0.3  },
        // Below card grid
        { emoji: '🚇', x: 155,  y: 1680, size: 68, opacity: 0.14, rotation: -0.3  },
        { emoji: '🎫', x: 390,  y: 1710, size: 58, opacity: 0.12, rotation:  0.2  },
        { emoji: '✨', x: 600,  y: 1690, size: 55, opacity: 0.18                  },
        { emoji: '🚌', x: 820,  y: 1700, size: 64, opacity: 0.13, rotation: -0.2  },
        { emoji: '⭐', x: 260,  y: 1840, size: 48, opacity: 0.13                  },
        { emoji: '⭐', x: 820,  y: 1855, size: 44, opacity: 0.11, rotation:  0.15 },
        { emoji: '✨', x: 540,  y: 1860, size: 52, opacity: 0.15                  },
    ]);

    // Header
    drawText(ctx, 'CTA Wrapped', CONFIG.width / 2, 260, 90, '900');
    drawText(ctx, period, CONFIG.width / 2, 370, 54);

    // Hero stat
    drawText(ctx, 'You took', CONFIG.width / 2, 560, 44);
    drawText(ctx, stats.overview.totalRides.toLocaleString(), CONFIG.width / 2, 730, 160, '900');
    drawText(ctx, 'CTA rides', CONFIG.width / 2, 830, 44);

    // Rail vs Bus split bar
    const barX = 90, barY = 940, barW = 900, barH = 28;
    const railFraction = stats.overview.railPercentage / 100;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRect(ctx, barX, barY, barW, barH, 14);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    roundRect(ctx, barX, barY, barW * railFraction, barH, 14);
    ctx.fill();
    await drawEmoji(ctx, '🚇', barX + 18, barY + 48, 30);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '26px Montserrat';
    ctx.textAlign = 'left';
    ctx.fillText(`Rail ${stats.overview.railPercentage.toFixed(0)}%`, barX + 42, barY + 60);

    await drawEmoji(ctx, '🚌', barX + barW - 18, barY + 48, 30);
    ctx.textAlign = 'right';
    ctx.fillText(`Bus ${stats.overview.busPercentage.toFixed(0)}%`, barX + barW - 42, barY + 60);

    // Cards 2x2
    const cards = [
        { label: 'Total Spent', value: `$${stats.overview.totalSpent.toFixed(2)}` },
        { label: 'Avg Per Ride', value: `$${stats.overview.averagePerRide.toFixed(2)}` },
        { label: 'Rail Rides', value: stats.rail.totalRides.toString() },
        { label: 'Bus Rides', value: stats.bus.totalRides.toString() }
    ];

    const cardWidth = 450;
    const cardHeight = 210;
    const spacing = 40;
    const startY = 1120;

    cards.forEach((card, i) => {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const x = 90 + col * (cardWidth + spacing);
        const y = startY + row * (cardHeight + spacing);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        roundRect(ctx, x, y, cardWidth, cardHeight, 24);
        ctx.fill();

        ctx.textAlign = 'center';
        drawText(ctx, card.label.toUpperCase(), x + cardWidth / 2, y + 62, 26, 'normal');
        drawText(ctx, card.value, x + cardWidth / 2, y + 145, 58, '900');
    });

    return canvas.toBuffer('image/png');
};

const generateRailImage = async (stats, insights) => {
    const { canvas, ctx } = createSlide(['#f093fb', '#f5576c']);

    await drawDecorations(ctx, [
        // Large watermark behind content
        { emoji: '🚇', x: 880, y: 370, size: 260, opacity: 0.07, rotation: 0.25 },
        // Bottom sparkles
        { emoji: '✨', x: 200,  y: 1868, size: 48, opacity: 0.25 },
        { emoji: '✨', x: 540,  y: 1878, size: 55, opacity: 0.22 },
        { emoji: '✨', x: 880,  y: 1865, size: 44, opacity: 0.24 },
    ]);

    await drawEmoji(ctx, '🚇', CONFIG.width / 2, 230, 80);
    drawText(ctx, 'Rail Journey', CONFIG.width / 2, 360, 70, '900');

    const railInsight = insights.find(i => i.title === 'Favorite Line' || i.title === 'Your Home Station');
    if (railInsight) {
        drawText(ctx, railInsight.title, CONFIG.width / 2, 480, 38);
        drawText(ctx, railInsight.value, CONFIG.width / 2, 600, 90, '900');
        drawText(ctx, railInsight.detail, CONFIG.width / 2, 668, 34);
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    roundRect(ctx, 90, 760, 900, 160, 24);
    ctx.fill();

    ctx.textAlign = 'left';
    drawText(ctx, 'Total Rail Rides', 140, 820, 32, 'normal', 'left');
    drawText(ctx, 'Unique Stations', 140, 885, 32, 'normal', 'left');
    ctx.textAlign = 'right';
    drawText(ctx, stats.rail.totalRides.toString(), 940, 820, 38, '900', 'right');
    drawText(ctx, stats.overview.uniqueRailStations.toString(), 940, 885, 38, '900', 'right');

    drawText(ctx, 'Top Starting Stations', CONFIG.width / 2, 1020, 42, '700');

    const topStations = stats.rail.stationVisits.slice(0, 5);
    const maxStationCount = topStations[0]?.count || 1;

    topStations.forEach((station, i) => {
        const y = 1080 + (i * 155);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        roundRect(ctx, 90, y, 900, 120, 16);
        ctx.fill();

        // Inline progress bar
        const barFill = station.count / maxStationCount;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        roundRect(ctx, 90, y + 100, 900, 7, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        roundRect(ctx, 90, y + 100, 900 * barFill, 7, 3);
        ctx.fill();

        ctx.textAlign = 'left';
        drawText(ctx, `${i + 1}.`, 130, y + 72, 40, '900', 'left');
        drawText(ctx, station.station, 195, y + 72, 38, 'normal', 'left');
        ctx.textAlign = 'right';
        drawText(ctx, rideLabel(station.count), 950, y + 72, 34, '700', 'right');
    });

    return canvas.toBuffer('image/png');
};

const generateBusImage = async (stats, insights) => {
    const { canvas, ctx } = createSlide(['#4facfe', '#00f2fe']);

    await drawDecorations(ctx, [
        // Large watermark behind content
        { emoji: '🚌', x: 860, y: 380, size: 260, opacity: 0.07, rotation: -0.2 },
        // Bottom sparkles
        { emoji: '✨', x: 200,  y: 1868, size: 48, opacity: 0.25 },
        { emoji: '✨', x: 540,  y: 1878, size: 55, opacity: 0.22 },
        { emoji: '✨', x: 880,  y: 1865, size: 44, opacity: 0.24 },
    ]);

    await drawEmoji(ctx, '🚌', CONFIG.width / 2, 230, 80);
    drawText(ctx, 'Bus Routes', CONFIG.width / 2, 360, 70, '900');

    const busInsight = insights.find(i => i.title === 'Go-To Bus');
    if (busInsight) {
        drawText(ctx, busInsight.title, CONFIG.width / 2, 480, 38);
        drawText(ctx, busInsight.value, CONFIG.width / 2, 600, 90, '900');
        drawText(ctx, busInsight.detail, CONFIG.width / 2, 668, 34);
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    roundRect(ctx, 90, 760, 900, 160, 24);
    ctx.fill();

    ctx.textAlign = 'left';
    drawText(ctx, 'Total Bus Rides', 140, 820, 32, 'normal', 'left');
    drawText(ctx, 'Unique Routes', 140, 885, 32, 'normal', 'left');
    ctx.textAlign = 'right';
    drawText(ctx, stats.bus.totalRides.toString(), 940, 820, 38, '900', 'right');
    drawText(ctx, stats.overview.uniqueBusRoutes.toString(), 940, 885, 38, '900', 'right');

    drawText(ctx, 'Top Routes', CONFIG.width / 2, 1020, 42, '700');

    const topRoutes = stats.bus.routeUsage.slice(0, 5);
    const maxRouteCount = topRoutes[0]?.count || 1;

    topRoutes.forEach((route, i) => {
        const y = 1080 + (i * 155);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        roundRect(ctx, 90, y, 900, 120, 16);
        ctx.fill();

        // Inline progress bar
        const barFill = route.count / maxRouteCount;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        roundRect(ctx, 90, y + 100, 900, 7, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        roundRect(ctx, 90, y + 100, 900 * barFill, 7, 3);
        ctx.fill();

        ctx.textAlign = 'left';
        drawText(ctx, `${i + 1}.`, 130, y + 72, 40, '900', 'left');
        drawText(ctx, `Route ${route.route}`, 195, y + 72, 38, 'normal', 'left');
        ctx.textAlign = 'right';
        drawText(ctx, rideLabel(route.count), 950, y + 72, 34, '700', 'right');
    });

    return canvas.toBuffer('image/png');
};

const generateTimeOfDayImage = async (stats) => {
    const { canvas, ctx } = createSlide(['#a8edea', '#fed6e3']);

    await drawDecorations(ctx, [
        // Left margin alongside the chart
        { emoji: '⭐', x: 90,  y: 980,  size: 50, opacity: 0.30, rotation:  0.2  },
        { emoji: '✨', x: 85,  y: 1220, size: 55, opacity: 0.28, rotation: -0.2  },
        { emoji: '⭐', x: 88,  y: 1480, size: 48, opacity: 0.26                  },
        // Right margin
        { emoji: '✨', x: 990, y: 1060, size: 52, opacity: 0.29, rotation:  0.3  },
        { emoji: '⭐', x: 992, y: 1320, size: 50, opacity: 0.27, rotation: -0.2  },
        { emoji: '✨', x: 988, y: 1580, size: 48, opacity: 0.25                  },
    ]);

    await drawEmoji(ctx, '⏰', CONFIG.width / 2, 150, 80);
    drawText(ctx, 'When You Ride', CONFIG.width / 2, 280, 70, '900');

    const peakHour = Object.entries(stats.temporal.byHour).sort((a, b) => b[1] - a[1])[0];
    if (peakHour) {
        const hour = parseInt(peakHour[0]);
        const timeLabel = hour === 0 ? '12AM' : hour < 12 ? `${hour}AM` : hour === 12 ? '12PM' : `${hour - 12}PM`;

        drawText(ctx, 'Most Active Hour', CONFIG.width / 2, 390, 38);
        drawText(ctx, timeLabel, CONFIG.width / 2, 560, 160, '900');
        drawText(ctx, rideLabel(peakHour[1]), CONFIG.width / 2, 640, 34);
    }

    drawText(ctx, '24-Hour Activity', CONFIG.width / 2, 740, 44, '700');

    const maxHourlyRides = Math.max(...Object.values(stats.temporal.byHour));
    const barWidth = 35;
    const barSpacing = 5;
    const baseY = 1840;
    const chartTopY = 800;
    const maxBarHeight = baseY - chartTopY;
    const startX = 65;

    for (let hour = 0; hour < 24; hour++) {
        const rides = stats.temporal.byHour[hour] || 0;
        const x = startX + (hour * (barWidth + barSpacing));

        // Ghost bar for all hours (gives the chart visual structure)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        roundRect(ctx, x, chartTopY, barWidth, maxBarHeight, 5);
        ctx.fill();

        if (rides > 0) {
            const barHeight = Math.max((rides / maxHourlyRides) * maxBarHeight, 10);
            const intensity = rides / maxHourlyRides;

            // Teal (low) to rose (high) — matches the slide gradient palette
            const r = Math.floor(100 + intensity * 155);
            const g = Math.floor(200 - intensity * 80);
            const b = Math.floor(210 - intensity * 120);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;

            roundRect(ctx, x, baseY - barHeight, barWidth, barHeight, 5);
            ctx.fill();
        }

        if (hour % 3 === 0) {
            const timeLabel = hour === 0 ? '12A' : hour < 12 ? `${hour}A` : hour === 12 ? '12P' : `${hour - 12}P`;
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.font = '20px Montserrat';
            ctx.textAlign = 'center';
            ctx.fillText(timeLabel, x + barWidth / 2, baseY + 30);
        }
    }

    return canvas.toBuffer('image/png');
};

const generateDayOfWeekImage = async (stats) => {
    const { canvas, ctx } = createSlide(['#ff9a9e', '#fecfef']);

    await drawDecorations(ctx, [
        // Side margins alongside the bar chart
        { emoji: '✨', x: 48,   y: 1200, size: 42, opacity: 0.16, rotation: -0.2  },
        { emoji: '⭐', x: 44,   y: 1450, size: 38, opacity: 0.14                  },
        { emoji: '✨', x: 1038, y: 1300, size: 40, opacity: 0.15, rotation:  0.25 },
        { emoji: '⭐', x: 1035, y: 1560, size: 36, opacity: 0.13, rotation: -0.1  },
        // Bottom
        { emoji: '🎉', x: 200,  y: 1868, size: 52, opacity: 0.15, rotation: -0.3  },
        { emoji: '✨', x: 540,  y: 1875, size: 50, opacity: 0.18                  },
        { emoji: '🎉', x: 880,  y: 1870, size: 50, opacity: 0.14, rotation:  0.25 },
    ]);

    await drawEmoji(ctx, '📅', CONFIG.width / 2, 230, 80);
    drawText(ctx, 'Your Week', CONFIG.width / 2, 360, 70, '900');

    const busiestDay = stats.overview.busiestDay;
    if (busiestDay) {
        drawText(ctx, 'Busiest Day', CONFIG.width / 2, 480, 38);
        drawText(ctx, busiestDay[0], CONFIG.width / 2, 640, 110, '900');
        drawText(ctx, rideLabel(busiestDay[1]), CONFIG.width / 2, 720, 34);
    }

    const daysOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayData = daysOrder.map(day => ({
        day,
        count: stats.temporal.byDayOfWeek[day] || 0
    }));

    const weekdayRides = dayData.slice(0, 5).reduce((sum, d) => sum + d.count, 0);
    const weekendRides = dayData.slice(5, 7).reduce((sum, d) => sum + d.count, 0);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    roundRect(ctx, 90, 800, 900, 160, 24);
    ctx.fill();

    ctx.textAlign = 'left';
    drawText(ctx, 'Weekday Rides', 140, 860, 32, 'normal', 'left');
    drawText(ctx, 'Weekend Rides', 140, 922, 32, 'normal', 'left');
    ctx.textAlign = 'right';
    drawText(ctx, weekdayRides.toString(), 940, 860, 38, '900', 'right');
    drawText(ctx, weekendRides.toString(), 940, 922, 38, '900', 'right');

    drawText(ctx, 'Daily Activity', CONFIG.width / 2, 1060, 42, '700');

    const maxDayRides = Math.max(...dayData.map(d => d.count));
    const barMaxWidth = 680;
    const barHeight = 72;
    const startY = 1110;
    const rowSpacing = 108;

    dayData.forEach((d, i) => {
        const y = startY + (i * rowSpacing);
        const barWidth = maxDayRides > 0 ? (d.count / maxDayRides) * barMaxWidth : 0;

        // Background track
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        roundRect(ctx, 240, y, barMaxWidth, barHeight, 10);
        ctx.fill();

        // Bar — white opacity scaled by intensity so the busiest day is brightest
        const intensity = maxDayRides > 0 ? d.count / maxDayRides : 0;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + intensity * 0.5})`;
        if (barWidth > 0) {
            roundRect(ctx, 240, y, barWidth, barHeight, 10);
            ctx.fill();
        }

        ctx.fillStyle = 'white';
        ctx.textAlign = 'left';
        ctx.font = 'bold 30px Montserrat';
        ctx.fillText(d.day.substring(0, 3), 90, y + 47);

        ctx.font = 'bold 28px Montserrat';
        if (barWidth > 90) {
            ctx.textAlign = 'right';
            ctx.fillText(d.count.toString(), 228 + barWidth, y + 47);
        } else {
            ctx.textAlign = 'left';
            ctx.fillText(d.count.toString(), 248 + barWidth, y + 47);
        }
    });

    return canvas.toBuffer('image/png');
};

const generatePersonalityImage = async (stats, insights) => {
    const { canvas, ctx } = createSlide(['#fa709a', '#fee140']);

    await drawDecorations(ctx, [
        // Side margins alongside the insight cards
        { emoji: '✨', x: 48,   y: 550,  size: 40, opacity: 0.18, rotation: -0.2  },
        { emoji: '⭐', x: 44,   y: 860,  size: 38, opacity: 0.15                  },
        { emoji: '✨', x: 46,   y: 1160, size: 42, opacity: 0.16, rotation:  0.2  },
        { emoji: '⭐', x: 1038, y: 660,  size: 38, opacity: 0.15, rotation: -0.15 },
        { emoji: '✨', x: 1035, y: 970,  size: 40, opacity: 0.17                  },
        { emoji: '⭐', x: 1037, y: 1270, size: 36, opacity: 0.14, rotation:  0.2  },
        // Between last card and footer
        { emoji: '🎉', x: 200,  y: 1730, size: 55, opacity: 0.15, rotation: -0.3  },
        { emoji: '✨', x: 540,  y: 1738, size: 58, opacity: 0.18                  },
        { emoji: '🎉', x: 880,  y: 1732, size: 52, opacity: 0.14, rotation:  0.3  },
    ]);

    drawText(ctx, 'Your Transit', CONFIG.width / 2, 200, 70, '900');
    drawText(ctx, 'Personality', CONFIG.width / 2, 290, 70, '900');

    // Show all 6 insights
    insights.forEach((insight, i) => {
        const y = 410 + (i * 218);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        roundRect(ctx, 90, y, 900, 182, 20);
        ctx.fill();

        ctx.textAlign = 'center';
        drawText(ctx, insight.title.toUpperCase(), CONFIG.width / 2, y + 48, 26, 'normal');
        drawText(ctx, insight.value, CONFIG.width / 2, y + 118, 54, '900');
        drawText(ctx, insight.detail, CONFIG.width / 2, y + 162, 28);
    });

    // Footer
    drawText(ctx, 'Thanks for riding!', CONFIG.width / 2, 1790, 46, '900');
    await drawEmoji(ctx, '🚇', CONFIG.width / 2 - 55, 1865, 52);
    await drawEmoji(ctx, '🚌', CONFIG.width / 2 + 55, 1865, 52);

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
            return;
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
            { name: '2-rail', fn: () => generateRailImage(stats, insights) },
            { name: '3-bus', fn: () => generateBusImage(stats, insights) },
            { name: '4-time-of-day', fn: () => generateTimeOfDayImage(stats) },
            { name: '5-day-of-week', fn: () => generateDayOfWeekImage(stats) },
            { name: '6-personality', fn: () => generatePersonalityImage(stats, insights) }
        ];
        
        for (const img of images) {
            const buffer = await img.fn();
            const filename = `${CONFIG.outputDir}/${filePrefix}-${img.name}.png`;
            await fs.writeFile(filename, buffer);
            console.log(`Generated ${filename}`);
        }
        
        console.log(`\nAll 6 images saved to ${CONFIG.outputDir}/`);
        
    } catch (error) {
        console.error('Error generating wrapped:', error);
    }
};

const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Usage:');
    console.log('  node generate_wrapped.js 2026          # Full year');
    console.log('  node generate_wrapped.js 2026 1        # Specific month (January)');
    console.log('  node generate_wrapped.js 2026 12       # December');
    console.log('  node generate_wrapped.js 2026 w14      # Week 14');
} else {
    const year = parseInt(args[0]);
    const arg2 = args[1] || null;

    if (arg2 && /^w\d+$/i.test(arg2)) {
        const week = parseInt(arg2.slice(1));
        generateWrapped(year, null, week);
    } else {
        const month = arg2 ? parseInt(arg2) : null;
        generateWrapped(year, month);
    }
}

module.exports = { generateWrapped, analyzeVentraData, generateInsights };