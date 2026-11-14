// Fetch self-hosted fonts: JetBrains Mono (latin, OFL) + Noto Sans SC subset by exact glyph set.
// Usage: node scripts/fetch-fonts.mjs <charsFile>
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'fonts';
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function get(url, asText = true) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return asText ? r.text() : Buffer.from(await r.arrayBuffer());
}

// ── JetBrains Mono: grab the latin (and latin-ext) woff2 for each weight ──
const jbCss = await get('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
const jbBlocks = [...jbCss.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face\s*\{([^}]+)\}/g)].map(m => ({ subset: m[1], body: m[2] }));
console.log('JBMono blocks:', jbBlocks.map(b => b.subset).join(','));
for (const { subset, body } of jbBlocks) {
  if (!['latin', 'latin-ext'].includes(subset)) continue;
  const w = /font-weight:\s*(\d+)/.exec(body)?.[1];
  const url = /url\(([^)]+)\)/.exec(body)?.[1];
  const buf = await get(url, false);
  const file = path.join(OUT, `JetBrainsMono-${w}-${subset}.woff2`);
  fs.writeFileSync(file, buf);
  console.log('  ✓', file, buf.length, 'bytes');
}

// ── Noto Sans SC: one subset containing exactly the glyphs the film needs ──
const chars = [...new Set(fs.readFileSync(process.argv[2] || 'scripts/chars.txt', 'utf8').replace(/\s+/g, ''))].join('');
console.log('CJK/Unicode chars to subset:', [...chars].length);
const scUrl = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&text=' + encodeURIComponent(chars) + '&display=swap';
const scCss = await get(scUrl);
const scFaces = [...scCss.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(m => m[1]);
console.log('NotoSansSC faces returned:', scFaces.length);
let i = 0;
for (const body of scFaces) {
  const w = /font-weight:\s*(\d+)/.exec(body)?.[1] || '400';
  const url = /url\(([^)]+)\)/.exec(body)?.[1];
  const buf = await get(url, false);
  const file = path.join(OUT, `NotoSansSC-${w}-subset-${i++}.woff2`);
  fs.writeFileSync(file, buf);
  console.log('  ✓', file, buf.length, 'bytes');
}
console.log('done');
