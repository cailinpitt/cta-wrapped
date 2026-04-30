const fs = require('fs').promises;
const path = require('path');
const { createCanvas, registerFont } = require('canvas');
const { allRoutes, getBingoData, stampBingoGenerated } = require('./bus_routes.js');

registerFont('./fonts/Montserrat-Bold.ttf',  { family: 'Montserrat', weight: '700' });
registerFont('./fonts/Montserrat-Black.ttf', { family: 'Montserrat', weight: '900' });

const CONFIG = {
    width: 1080,
    height: 1920,
    outputDir: 'wrapped_images',
};

const PALETTE = {
    bg: '#0E0E0E',
    primary: '#FAFF00',
    secondary: '#FF3B7C',
    accent: '#00E0FF',
    ridden: '#FAFF00',
    riddenInk: '#0E0E0E',
    newlyRidden: '#00E0FF',
    newlyRiddenInk: '#0E0E0E',
    notRidden: '#1F1F1F',
    notRiddenInk: '#5A5A5A',
    ink: '#FFFFFF',
};

const roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
};

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

const renderBingo = ({ ridden, notRidden, newlyRidden = [], total }) => {
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    const W = CONFIG.width, H = CONFIG.height;
    const riddenSet = new Set(ridden);
    const newSet = new Set(newlyRidden);

    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, W, H);

    // Header
    drawTag(ctx, 'EVERY CTA BUS', W / 2, 130, 42, '900', PALETTE.primary, PALETTE.bg, -0.03, 36);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '700 32px Montserrat';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A LIFETIME PROGRESS TRACKER', W / 2, 200);

    // Hero stat
    const pct = Math.round((ridden.length / total) * 100);
    ctx.fillStyle = PALETTE.primary;
    ctx.font = '900 280px Montserrat';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${ridden.length}`, W / 2 - 180, 420);

    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 90px Montserrat';
    ctx.fillText('/', W / 2, 420);

    ctx.fillStyle = PALETTE.secondary;
    ctx.font = '900 200px Montserrat';
    ctx.fillText(`${total}`, W / 2 + 180, 430);

    ctx.fillStyle = PALETTE.accent;
    ctx.font = '900 56px Montserrat';
    ctx.fillText(`${pct}% RIDDEN`, W / 2, 600);

    // Color-block split bar
    const splitY = 680, splitH = 28;
    const frac = Math.max(0.02, Math.min(0.98, ridden.length / total));
    ctx.fillStyle = PALETTE.primary;
    ctx.fillRect(0, splitY, W * frac, splitH);
    ctx.fillStyle = PALETTE.notRidden;
    ctx.fillRect(W * frac, splitY, W * (1 - frac), splitH);

    // Grid of all routes
    const gridTop = 770;
    const gridBottom = H - 200;
    const gridHeight = gridBottom - gridTop;
    const gridLeft = 40;
    const gridRight = W - 40;
    const gridWidth = gridRight - gridLeft;

    const cols = 8;
    const rows = Math.ceil(allRoutes.length / cols);
    const gap = 10;
    const cellW = (gridWidth - gap * (cols - 1)) / cols;
    const cellH = Math.min(cellW, (gridHeight - gap * (rows - 1)) / rows);

    allRoutes.forEach((route, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = gridLeft + col * (cellW + gap);
        const y = gridTop + row * (cellH + gap);
        const isRidden = riddenSet.has(route);
        const isNew = newSet.has(route);

        ctx.fillStyle = isNew ? PALETTE.newlyRidden : isRidden ? PALETTE.ridden : PALETTE.notRidden;
        roundRect(ctx, x, y, cellW, cellH, 12);
        ctx.fill();

        ctx.fillStyle = isNew ? PALETTE.newlyRiddenInk : isRidden ? PALETTE.riddenInk : PALETTE.notRiddenInk;
        // Auto-fit route label (e.g. "X49", "111A" need smaller font than "8")
        let fs = Math.round(cellH * 0.42);
        ctx.font = `900 ${fs}px Montserrat`;
        while (ctx.measureText(route).width > cellW * 0.85 && fs > 14) {
            fs -= 2;
            ctx.font = `900 ${fs}px Montserrat`;
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(route, x + cellW / 2, y + cellH / 2);
    });

    // Bottom legend
    const legendY = H - 110;
    const swatch = 36;
    const legendGap = 40;

    ctx.font = '900 26px Montserrat';
    ctx.textBaseline = 'middle';

    const items = [
        { color: PALETTE.ridden, label: `RIDDEN · ${ridden.length}` },
        ...(newlyRidden.length > 0 ? [{ color: PALETTE.newlyRidden, label: `NEW · ${newlyRidden.length}` }] : []),
        { color: PALETTE.notRidden, label: `TO GO · ${notRidden.length}`, outline: true },
    ];

    const widths = items.map(i => swatch + 14 + ctx.measureText(i.label).width);
    const totalW = widths.reduce((s, w) => s + w, 0) + legendGap * (items.length - 1);
    let x = (W - totalW) / 2;

    items.forEach((item, idx) => {
        ctx.fillStyle = item.color;
        roundRect(ctx, x, legendY - swatch / 2, swatch, swatch, 8);
        ctx.fill();
        if (item.outline) {
            ctx.strokeStyle = PALETTE.notRiddenInk;
            ctx.lineWidth = 2;
            roundRect(ctx, x, legendY - swatch / 2, swatch, swatch, 8);
            ctx.stroke();
        }
        ctx.fillStyle = PALETTE.ink;
        ctx.textAlign = 'left';
        ctx.fillText(item.label, x + swatch + 14, legendY);
        x += widths[idx] + legendGap;
    });

    applyGrain(ctx, 5000);
    return canvas.toBuffer('image/png');
};

const generateBusBingo = async (filePath = 'bus_routes.json', outputDir = CONFIG.outputDir) => {
    const data = await getBingoData(filePath);
    const buffer = renderBingo(data);
    await fs.mkdir(outputDir, { recursive: true });
    const outPath = path.join(outputDir, 'bus-bingo.png');
    await fs.writeFile(outPath, buffer);
    await stampBingoGenerated(filePath);
    return { filePath: outPath, ...data };
};

if (require.main === module) {
    generateBusBingo()
        .then(r => console.log(`Wrote ${r.filePath} — ${r.ridden.length}/${r.total} routes`))
        .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { generateBusBingo };
