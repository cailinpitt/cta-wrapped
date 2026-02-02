const fs = require('fs').promises;
const { createCanvas, loadImage } = require('canvas');
const twemoji = require('twemoji');

const CONFIG = {
    width: 1080,
    height: 1080,
    outputDir: 'wrapped_images'
};

const getWeekNumber = (date) => {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
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
            byWeek: {}
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

        const amountDollars = Math.abs(t.amount / 100);
        stats.spending.totalSpent += amountDollars;
        stats.spending.byMonth[month] = (stats.spending.byMonth[month] || 0) + amountDollars;

        if (t.type === 'Rail') {
            stats.rail.totalRides++;
            
            const parts = t.locationRoute.split('-');
            if (parts.length >= 2) {
                const line = parts[0];
                const station = parts.slice(1).join('-');
                
                stats.rail.lines[line] = (stats.rail.lines[line] || 0) + 1;
                stats.rail.stations[station] = (stats.rail.stations[station] || 0) + 1;
            }
        } else if (t.type === 'Bus') {
            stats.bus.totalRides++;
            
            const routeMatch = t.locationRoute.match(/^(\d+)/);
            const route = routeMatch ? routeMatch[1] : t.locationRoute;
            
            stats.bus.routes[route] = (stats.bus.routes[route] || 0) + 1;
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

const generateInsights = (stats) => {
    const insights = [];

    if (stats.rail.stationVisits.length > 0) {
        const topStation = stats.rail.stationVisits[0];
        insights.push({
            title: "Your Home Station",
            value: topStation.station,
            detail: `${topStation.count} rides`
        });
    }

    const topLine = Object.entries(stats.rail.lines).sort((a, b) => b[1] - a[1])[0];
    if (topLine) {
        insights.push({
            title: "Favorite Line",
            value: `${topLine[0]} Line`,
            detail: `${topLine[1]} rides`
        });
    }

    if (stats.bus.routeUsage.length > 0) {
        const topRoute = stats.bus.routeUsage[0];
        insights.push({
            title: "Go-To Bus",
            value: `#${topRoute.route}`,
            detail: `${topRoute.count} rides`
        });
    }

    const peakHour = Object.entries(stats.temporal.byHour).sort((a, b) => b[1] - a[1])[0];
    if (peakHour) {
        const hour = parseInt(peakHour[0]);
        const timeLabel = hour < 12 ? `${hour}AM` : hour === 12 ? '12PM' : `${hour - 12}PM`;
        insights.push({
            title: "Peak Hour",
            value: timeLabel,
            detail: `${peakHour[1]} rides`
        });
    }

    if (stats.overview.busiestMonth) {
        insights.push({
            title: "Busiest Month",
            value: stats.overview.busiestMonth[0],
            detail: `${stats.overview.busiestMonth[1]} rides`
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

const filterByPeriod = (transactions, year, month = null) => {
    return transactions.filter(t => {
        const date = new Date(t.timestamp);
        const txYear = date.getFullYear();
        const txMonth = date.getMonth() + 1;
        
        if (month) {
            return txYear === year && txMonth === month;
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
    ctx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
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
    
    drawText(ctx, 'Ventra Wrapped', CONFIG.width / 2, 180, 80, '900');
    drawText(ctx, period, CONFIG.width / 2, 270, 50);
    
    drawText(ctx, 'You took', CONFIG.width / 2, 400, 40);
    drawText(ctx, stats.overview.totalRides.toLocaleString(), CONFIG.width / 2, 520, 110, '900');
    drawText(ctx, 'CTA rides', CONFIG.width / 2, 610, 40);
    
    const cards = [
        { label: 'Total Spent', value: `$${stats.overview.totalSpent.toFixed(2)}` },
        { label: 'Avg Per Ride', value: `$${stats.overview.averagePerRide.toFixed(2)}` },
        { label: 'Rail Rides', value: stats.rail.totalRides.toString() },
        { label: 'Bus Rides', value: stats.bus.totalRides.toString() }
    ];
    
    const cardWidth = 450;
    const cardHeight = 160;
    const spacing = 40;
    const startY = 700;
    
    cards.forEach((card, i) => {
        const row = Math.floor(i / 2);
        const col = i % 2;
        const x = 90 + col * (cardWidth + spacing);
        const y = startY + row * (cardHeight + spacing);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        roundRect(ctx, x, y, cardWidth, cardHeight, 20);
        ctx.fill();
        
        ctx.textAlign = 'center';
        drawText(ctx, card.label.toUpperCase(), x + cardWidth / 2, y + 50, 24, 'normal');
        drawText(ctx, card.value, x + cardWidth / 2, y + 110, 50, '900');
    });
    
    return canvas.toBuffer('image/png');
};

const generateRailImage = async (stats, insights) => {
    const { canvas, ctx } = createSlide(['#f093fb', '#f5576c']);
    
    await drawEmoji(ctx, '🚇', CONFIG.width / 2, 85, 60);
    drawText(ctx, 'Rail Journey', CONFIG.width / 2, 170, 60, '900');
    
    const railInsight = insights.find(i => i.title === 'Favorite Line' || i.title === 'Your Home Station');
    if (railInsight) {
        drawText(ctx, railInsight.title, CONFIG.width / 2, 250, 35);
        drawText(ctx, railInsight.value, CONFIG.width / 2, 330, 70, '900');
        drawText(ctx, railInsight.detail, CONFIG.width / 2, 390, 30);
    }
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    roundRect(ctx, 90, 440, 900, 120, 20);
    ctx.fill();
    
    ctx.textAlign = 'left';
    drawText(ctx, 'Total Rail Rides', 140, 485, 30, 'normal', 'left');
    drawText(ctx, 'Unique Stations', 140, 535, 30, 'normal', 'left');
    
    ctx.textAlign = 'right';
    drawText(ctx, stats.rail.totalRides.toString(), 940, 485, 35, '900', 'right');
    drawText(ctx, stats.overview.uniqueRailStations.toString(), 940, 535, 35, '900', 'right');
    
    drawText(ctx, 'Top Starting Stations', CONFIG.width / 2, 620, 40, '700');
    
    const topStations = stats.rail.stationVisits.slice(0, 5);
    topStations.forEach((station, i) => {
        const y = 680 + (i * 80);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        roundRect(ctx, 90, y - 30, 900, 70, 12);
        ctx.fill();
        
        ctx.textAlign = 'left';
        drawText(ctx, `${i + 1}.`, 140, y + 8, 38, '900', 'left');
        drawText(ctx, station.station, 200, y + 8, 35, 'normal', 'left');
        
        ctx.textAlign = 'right';
        drawText(ctx, `${station.count}`, 940, y + 8, 35, '700', 'right');
    });
    
    return canvas.toBuffer('image/png');
};

const generateBusImage = async (stats, insights) => {
    const { canvas, ctx } = createSlide(['#4facfe', '#00f2fe']);
    
    await drawEmoji(ctx, '🚌', CONFIG.width / 2, 85, 60);
    drawText(ctx, 'Bus Routes', CONFIG.width / 2, 170, 60, '900');
    
    const busInsight = insights.find(i => i.title === 'Go-To Bus');
    if (busInsight) {
        drawText(ctx, busInsight.title, CONFIG.width / 2, 250, 35);
        drawText(ctx, busInsight.value, CONFIG.width / 2, 330, 70, '900');
        drawText(ctx, busInsight.detail, CONFIG.width / 2, 390, 30);
    }
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    roundRect(ctx, 90, 440, 900, 120, 20);
    ctx.fill();
    
    ctx.textAlign = 'left';
    drawText(ctx, 'Total Bus Rides', 140, 485, 30, 'normal', 'left');
    drawText(ctx, 'Unique Routes', 140, 535, 30, 'normal', 'left');
    
    ctx.textAlign = 'right';
    drawText(ctx, stats.bus.totalRides.toString(), 940, 485, 35, '900', 'right');
    drawText(ctx, stats.overview.uniqueBusRoutes.toString(), 940, 535, 35, '900', 'right');
    
    drawText(ctx, 'Top Routes', CONFIG.width / 2, 620, 40, '700');
    
    const topRoutes = stats.bus.routeUsage.slice(0, 5);
    topRoutes.forEach((route, i) => {
        const y = 680 + (i * 80);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        roundRect(ctx, 90, y - 30, 900, 70, 12);
        ctx.fill();
        
        ctx.textAlign = 'left';
        drawText(ctx, `${i + 1}.`, 140, y + 8, 38, '900', 'left');
        drawText(ctx, `Route ${route.route}`, 200, y + 8, 35, 'normal', 'left');
        
        ctx.textAlign = 'right';
        drawText(ctx, `${route.count}`, 940, y + 8, 35, '700', 'right');
    });
    
    return canvas.toBuffer('image/png');
};

const generatePersonalityImage = async (stats, insights) => {
    const { canvas, ctx } = createSlide(['#fa709a', '#fee140']);
    
    drawText(ctx, 'Your Transit Personality', CONFIG.width / 2, 120, 55, '900');
    
    const keyInsights = insights.slice(0, 3);
    keyInsights.forEach((insight, i) => {
        const y = 220 + (i * 190);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        roundRect(ctx, 90, y - 60, 900, 160, 20);
        ctx.fill();
        
        ctx.textAlign = 'center';
        drawText(ctx, insight.title.toUpperCase(), CONFIG.width / 2, y - 10, 28, 'normal');
        drawText(ctx, insight.value, CONFIG.width / 2, y + 45, 55, '900');
        drawText(ctx, insight.detail, CONFIG.width / 2, y + 90, 30);
    });
    
    const footerY = 820;
    drawText(ctx, 'Thanks for riding!', CONFIG.width / 2, footerY, 45, '900');
    await drawEmoji(ctx, '🚇', CONFIG.width / 2 - 50, footerY + 65, 50);
    await drawEmoji(ctx, '🚌', CONFIG.width / 2 + 50, footerY + 65, 50);
    
    const badges = [
        { emoji: '💰', text: `$${stats.overview.totalSpent.toFixed(0)}` },
        { emoji: '📍', text: `${stats.overview.uniqueRailStations}` },
        { emoji: '🚏', text: `${stats.overview.uniqueBusRoutes}` }
    ];
    
    const badgeY = footerY + 170;
    const badgeSpacing = 310;
    const badgeStartX = (CONFIG.width - (badges.length * badgeSpacing - 30)) / 2;
    
    for (let i = 0; i < badges.length; i++) {
        const badge = badges[i];
        const x = badgeStartX + (i * badgeSpacing);
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        roundRect(ctx, x, badgeY - 25, 280, 60, 30);
        ctx.fill();
        
        await drawEmoji(ctx, badge.emoji, x + 60, badgeY, 35);
        drawText(ctx, badge.text, x + 180, badgeY + 10, 28);
    }
    
    return canvas.toBuffer('image/png');
};

const generateWrapped = async (year, month = null) => {
    try {
        await fs.mkdir(CONFIG.outputDir, { recursive: true });
        
        const rawData = JSON.parse(await fs.readFile('./ventra_transactions.json', 'utf-8'));
        const filteredTransactions = filterByPeriod(rawData.transactions, year, month);
        
        if (filteredTransactions.length === 0) {
            console.log(`No transactions found for ${year}${month ? `-${month.toString().padStart(2, '0')}` : ''}`);
            return;
        }
        
        const data = { ...rawData, transactions: filteredTransactions };
        const stats = analyzeVentraData(data);
        const insights = generateInsights(stats);
        
        const period = month 
            ? `${new Date(year, month - 1).toLocaleString('en-US', { month: 'long' })} ${year}`
            : year.toString();
        
        const filePrefix = month 
            ? `${year}-${month.toString().padStart(2, '0')}`
            : `${year}`;
        
        console.log(`\nGenerating Ventra Wrapped for ${period}...`);
        console.log(`Total transactions: ${filteredTransactions.length}\n`);
        
        const images = [
            { name: '1-overview', fn: () => generateOverviewImage(stats, period) },
            { name: '2-rail', fn: () => generateRailImage(stats, insights) },
            { name: '3-bus', fn: () => generateBusImage(stats, insights) },
            { name: '4-insights', fn: () => generatePersonalityImage(stats, insights) }
        ];
        
        for (const img of images) {
            const buffer = await img.fn();
            const filename = `${CONFIG.outputDir}/${filePrefix}-${img.name}.png`;
            await fs.writeFile(filename, buffer);
            console.log(`Generated ${filename}`);
        }
        
        console.log(`\nAll 4 images saved to ${CONFIG.outputDir}/`);
        
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
} else {
    const year = parseInt(args[0]);
    const month = args[1] ? parseInt(args[1]) : null;
    generateWrapped(year, month);
}

module.exports = { generateWrapped, analyzeVentraData, generateInsights };