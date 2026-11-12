// 把 NapCat 启动日志里的 ASCII 二维码渲染成可扫的 PNG。
// 启动器用半块字符（█ 全黑 / ▀ 上半 / ▄ 下半 / 空格全白）画码，一行字符 = 两行像素。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const LOG_DIR = 'E:/dsh-onesoul/napcat/NapCat.Shell.Windows.Node/napcat/logs';
const KEEPER_DIR = 'D:/DSH/.dsh/dsh-napcat-keeper';

function newestLog() {
  const files = [];
  for (const dir of [KEEPER_DIR]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/^launch.*\.log$/i.test(n)) continue;
      const p = path.join(dir, n);
      try { files.push({ p, m: fs.statSync(p).mtimeMs }); } catch {}
    }
  }
  files.sort((a, b) => b.m - a.m);
  return files.length ? files[0].p : null;
}

// 找出最后一段只由半块字符构成的连续行
function extractAscii(lines) {
  const ok = (l) => l.length >= 15 && /^[█▀▄ ]+$/.test(l);
  let best = null, cur = [];
  for (const line of lines) {
    if (ok(line)) cur.push(line);
    else { if (cur.length > 3) best = cur.slice(); cur = []; }
  }
  if (cur.length > 3) best = cur;
  return best;
}

function renderPng(asciiLines, { scale = 8, quiet = 4 } = {}) {
  const w = Math.max(...asciiLines.map((l) => l.length));
  const h = asciiLines.length * 2;
  const W = (w + quiet * 2) * scale;
  const H = (h + quiet * 2) * scale;
  const px = Buffer.alloc(W * H, 0xff); // 白底
  for (let y = 0; y < asciiLines.length; y++) {
    const line = asciiLines[y];
    for (let x = 0; x < w; x++) {
      const ch = line[x] || ' ';
      const topDark = ch === '█' || ch === '▀';
      const botDark = ch === '█' || ch === '▄';
      if (topDark) fillRect(px, W, (x + quiet) * scale, (y * 2 + quiet) * scale, scale, scale, 0);
      if (botDark) fillRect(px, W, (x + quiet) * scale, (y * 2 + 1 + quiet) * scale, scale, scale, 0);
    }
  }
  return encodePng(px, W, H);
}

function fillRect(px, W, x0, y0, w, h, v) {
  for (let y = y0; y < y0 + h; y++) px.fill(v, y * W + x0, y * W + x0 + w);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(pxGray, W, H) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // grayscale
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W + 1)] = 0;
    pxGray.copy(raw, y * (W + 1) + 1, y * W, y * W + W);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderLiveQr(outFile, opts = {}) {
  const log = newestLog();
  if (!log) return { ok: false, reason: '找不到启动日志' };
  const text = fs.readFileSync(log, 'utf8');
  const ascii = extractAscii(text.split(/\r?\n/));
  if (!ascii) return { ok: false, reason: '日志里没找到 ASCII 二维码', log };
  const png = renderPng(ascii, opts);
  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, png);
  }
  return { ok: true, log, modules: ascii[0].length, lines: ascii.length, bytes: png.length, png };
}

if (process.argv[1] && process.argv[1].endsWith('qq-qr-render.mjs')) {
  const out = process.argv[2] || 'E:/dsh-onesoul/.local-preview/qq-live-qr.png';
  const r = renderLiveQr(out);
  console.log(r.ok ? `ok ${r.bytes} bytes, ${r.modules}x${r.lines * 2} modules -> ${out}` : `fail: ${r.reason}`);
  process.exit(r.ok ? 0 : 1);
}
