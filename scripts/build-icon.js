// Renders assets/icon.svg to assets/icon.png (256) and a multi-size assets/icon.ico.
// Run with: npm run build:icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

// ICO with embedded PNGs (supported since Windows Vista).
function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  await win.loadURL('data:text/html,<body></body>');
  const svg = fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf8');
  const urls = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    await img.decode();
    const out = {};
    for (const size of ${JSON.stringify(SIZES)}) {
      // draw large, then step down for clean small sizes
      let src = img, s = 1024;
      const big = document.createElement('canvas'); big.width = big.height = s;
      big.getContext('2d').drawImage(img, 0, 0, s, s); src = big;
      while (s / 2 >= size) {
        const c = document.createElement('canvas'); c.width = c.height = s / 2;
        const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, s / 2, s / 2); src = c; s /= 2;
      }
      const c = document.createElement('canvas'); c.width = c.height = size;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, size, size);
      out[size] = c.toDataURL('image/png');
    }
    return out;
  })()`);
  const pngs = SIZES.map((size) => ({ size, data: Buffer.from(urls[size].split(',')[1], 'base64') }));
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), pngs.find((p) => p.size === 256).data);
  fs.writeFileSync(path.join(ASSETS, 'tray.png'), pngs.find((p) => p.size === 32).data);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), packIco(pngs));
  console.log('wrote icon.png, tray.png, icon.ico (' + SIZES.join(', ') + ')');
  app.quit();
});
