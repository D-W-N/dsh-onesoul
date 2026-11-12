// 从 NapCat 启动日志里的 ASCII 二维码渲染出真 PNG。
// 为什么需要：这台机器上 NapCat 只把码画在启动器日志里（字符画），
// cache/qrcode.png 常年不更新，keeper 的 qrCopyPath 也从没生成过。
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';

const BLOCK_CHARS = /^[█▀▄ ]+$/;

function newestLaunchLog(keeperDir) {
  let names = [];
  try {
    names = readdirSync(keeperDir);
  } catch {
    return '';
  }
  let best = '';
  let bestAt = 0;
  for (const name of names) {
    if (!/^launch.*\.log$/i.test(name)) continue;
    const file = join(keeperDir, name);
    try {
      const at = statSync(file).mtimeMs;
      if (at > bestAt) {
        bestAt = at;
        best = file;
      }
    } catch {}
  }
  return best;
}

// 半块字符一格 = 两行像素：█ 全黑、▀ 上半黑、▄ 下半黑、空格全白
function extractAscii(text) {
  let best = null;
  let cur = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (line.length >= 15 && BLOCK_CHARS.test(line)) cur.push(line);
    else {
      if (cur.length > 3) best = cur.slice();
      cur = [];
    }
  }
  if (cur.length > 3) best = cur;
  return best;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(gray, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    gray.copy(raw, y * (width + 1) + 1, y * width, y * width + width);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function qrPngFromAscii(asciiLines, options) {
  const scale = (options && options.scale) || 8;
  const quiet = (options && options.quiet) == null ? 4 : options.quiet;
  const cols = Math.max(...asciiLines.map((line) => line.length));
  const rows = asciiLines.length * 2;
  const width = (cols + quiet * 2) * scale;
  const height = (rows + quiet * 2) * scale;
  const gray = Buffer.alloc(width * height, 0xff);
  const dark = (x, y) => {
    const x0 = (x + quiet) * scale;
    const y0 = (y + quiet) * scale;
    for (let dy = 0; dy < scale; dy++) gray.fill(0, (y0 + dy) * width + x0, (y0 + dy) * width + x0 + scale);
  };
  for (let row = 0; row < asciiLines.length; row++) {
    const line = asciiLines[row];
    for (let col = 0; col < cols; col++) {
      const ch = line[col] || ' ';
      if (ch === '█' || ch === '▀') dark(col, row * 2);
      if (ch === '█' || ch === '▄') dark(col, row * 2 + 1);
    }
  }
  return { png: encodePng(gray, width, height), cols, rows };
}

/** 读启动日志里最后一段 ASCII 码，渲染成 PNG；失败返回 null。 */
export function renderQrFromLog(logFile) {
  if (!logFile || !existsSync(logFile)) return null;
  let text = '';
  try {
    text = readFileSync(logFile, 'utf8');
  } catch {
    return null;
  }
  const ascii = extractAscii(text);
  if (!ascii) return null;
  const out = qrPngFromAscii(ascii);
  let decodeUrl = '';
  const matches = [...text.matchAll(/二维码解码URL[:：]\s*(\S+)/g)];
  if (matches.length) decodeUrl = matches[matches.length - 1][1];
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(logFile).mtimeMs;
  } catch {}
  return { png: out.png, cols: out.cols, rows: out.rows, logFile, decodeUrl, mtimeMs };
}

/**
 * 找到一份能用的二维码 PNG 路径：先看现成的缓存文件新不新，
 * 不新就从启动日志现渲染一份写到 outDir 下。
 */
export function resolveQrFile(candidates, keeperDir, options) {
  const maxAgeMs = (options && options.maxAgeMs) || 150000;
  let newest = '';
  let newestAt = 0;
  for (const file of candidates) {
    if (!file || !existsSync(file)) continue;
    try {
      const at = statSync(file).mtimeMs;
      if (at > newestAt) {
        newestAt = at;
        newest = file;
      }
    } catch {}
  }
  if (newest && Date.now() - newestAt < maxAgeMs) return { file: newest, rendered: false };
  const log = newestLaunchLog(keeperDir);
  const rendered = renderQrFromLog(log);
  if (rendered) {
    const outDir = (options && options.outDir) || keeperDir;
    const outFile = join(outDir, 'qr-rendered.png');
    try {
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, rendered.png);
      return { file: outFile, rendered: true, decodeUrl: rendered.decodeUrl, logFile: log };
    } catch {}
    return { file: '', rendered: true, png: rendered.png, decodeUrl: rendered.decodeUrl };
  }
  return { file: newest, rendered: false };
}
