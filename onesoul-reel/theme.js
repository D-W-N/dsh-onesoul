// theme.js — the one visual system for the film. Everything else imports from here.
// Cool One Dark: every hue in the terminal/IDE is pushed to the cold side of the spectrum,
// so the single warm signal in the whole film can be hers (#dca765) and nothing else competes.

export const C = {
  // ── stage & surfaces ──
  bg0: '#0d0f12',
  bg1: '#14171b',
  bg2: '#191d22',
  panel: '#1e2329',
  panelHi: '#262c33',
  gutter: '#16191e',
  line: 'rgba(255,255,255,0.075)',
  lineHi: 'rgba(255,255,255,0.14)',

  // ── One Dark, cooled ──
  text: '#c3cad6',
  textHi: '#e6ebf2',
  dim: '#7d8694',
  faint: '#525b68',
  ghost: '#39414d',
  comment: '#5f6875',
  string: '#8ec99b',
  number: '#9fb0d0',
  keyword: '#c0a0dd',
  fn: '#7cb8f0',
  type: '#7fd0dc',
  var: '#df8b94',
  op: '#6fc0cc',

  // ── semantic (terminal output) ──
  ok: '#8ec99b',
  warn: '#a8b6cc',
  err: '#df8b94',

  // ── HERS. The only warm colour in the film. Cursor, dots, ripples, node light. ──
  her: '#dca765',
  herHi: '#f2cd97',
  herDim: 'rgba(220,167,101,0.42)',
  herGlow: 'rgba(220,167,101,0.20)',
};

export const F = {
  mono: '"JetBrains Mono", "JetBrainsMono", "Cascadia Mono", Consolas, monospace',
  cjk: '"Noto Sans SC", "JetBrains Mono", "Microsoft YaHei", sans-serif',
};

export const mono = (ctx, px, weight = 400) => { ctx.font = `${weight} ${px}px ${F.mono}`; };
export const cjk = (ctx, px, weight = 400) => { ctx.font = `${weight} ${px}px ${F.cjk}`; };

// ── small geometry helpers ──
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, Math.max(w, 0.01), Math.max(h, 0.01), rr);
  else {
    ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
  }
  return ctx;
}
export const fillRR = (ctx, x, y, w, h, r, col) => { roundRect(ctx, x, y, w, h, r); ctx.fillStyle = col; ctx.fill(); };
export const strokeRR = (ctx, x, y, w, h, r, col, lw = 1) => { roundRect(ctx, x, y, w, h, r); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); };

/** Soft radial bloom — drawn with a cached gradient so it stays cheap. */
export function bloom(ctx, x, y, r, color, alpha = 1) {
  if (alpha <= 0.002 || r <= 0.5) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, withA(color, 0.55 * alpha));
  g.addColorStop(0.42, withA(color, 0.16 * alpha));
  g.addColorStop(1, withA(color, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export function withA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Text with a subtle warm/cool halo — used sparingly, only on lit things. */
export function glowText(ctx, s, x, y, color, blur = 18, alpha = 0.55) {
  ctx.save();
  ctx.shadowColor = withA(color, alpha);
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.restore();
}

// ── syntax highlighting ───────────────────────────────────────────────────────────────
// A tiny deterministic tokenizer. It only has to cover what the film actually shows:
// JS calls, a JSON config, shell command lines and log lines. No dependencies, no surprises.
const KEYWORDS = new Set(['const', 'let', 'var', 'await', 'async', 'return', 'if', 'else', 'true', 'false', 'null', 'new', 'import', 'from', 'export']);

/** tokenize(code, lang) → [{ t, c }] where c is a colour from C */
export function tokenize(code, lang = 'js') {
  const out = [];
  const push = (t, c) => { if (t) out.push({ t, c }); };
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[1]) { push(m[1], C.comment); continue; }
    if (m[2]) { push(m[2], C.string); continue; }
    if (m[3]) { push(m[3], C.number); continue; }
    if (m[4]) {
      const w = m[4];
      const next = code[re.lastIndex];
      if (KEYWORDS.has(w)) push(w, C.keyword);
      else if (next === '(') push(w, C.fn);
      else if (next === ':') push(w, lang === 'json' ? C.fn : C.type);
      else if (lang === 'json') push(w, C.text);
      else push(w, C.text);
      continue;
    }
    if (m[5]) { push(m[5], C.text); continue; }
    if (m[6]) {
      const ch = m[6];
      push(ch, '{}[]'.includes(ch) ? C.dim : '=:,'.includes(ch) ? C.op : C.dim);
      continue;
    }
  }
  return out;
}

/** Draw highlighted code. `limit` = how many characters are visible (typing). */
export function drawCode(ctx, code, x, y, px, { limit = Infinity, lineH = 1.62, lang = 'js', cjkPx = null } = {}) {
  const tokens = tokenize(code, lang);
  let i = 0, cx = x, cy = y;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  mono(ctx, px);
  const cjkFont = cjkPx ? `${400} ${cjkPx}px ${F.cjk}` : null;
  for (const tok of tokens) {
    const chars = [...tok.t];
    for (const ch of chars) {
      if (i >= limit) return { x: cx, y: cy, i };
      if (ch === '\n') { cx = x; cy += px * lineH; i++; continue; }
      const isCJK = /[\u3000-\u9fff\uff00-\uffef]/.test(ch);
      if (isCJK && cjkFont) ctx.font = cjkFont; else mono(ctx, px);
      ctx.fillStyle = tok.c;
      ctx.fillText(ch, cx, cy);
      cx += ctx.measureText(ch).width;
      i++;
    }
  }
  mono(ctx, px);
  return { x: cx, y: cy, i };
}

/** Measure the pixel width of a code string at a given size (for layout / fit checks). */
export function measureCode(ctx, code, px, { cjkPx = null } = {}) {
  mono(ctx, px);
  const cjkFont = cjkPx ? `400 ${cjkPx}px ${F.cjk}` : null;
  let w = 0;
  for (const ch of code) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) && cjkFont) ctx.font = cjkFont; else mono(ctx, px);
    w += ctx.measureText(ch).width;
  }
  mono(ctx, px);
  return w;
}

// ── the film's shared UI furniture ────────────────────────────────────────────────────
/** The glass window body used by every shot: same radius, same border, same shadow. */
export function windowBody(ctx, x, y, w, h, { r = 14, fill = C.panel, alpha = 1, border = C.line, shadow = 0 } = {}) {
  ctx.save();
  if (shadow > 0) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = shadow; ctx.shadowOffsetY = shadow * 0.35; }
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = withA(fill, alpha); ctx.fill();
  ctx.restore();
  strokeRR(ctx, x, y, w, h, r, border, 1);
}

/** Traffic lights + tab strip: the chrome that carries over between shots. */
export function chrome(ctx, x, y, w, { h = 42, title = '', tabs = null, active = 0, tint = C.panelHi } = {}) {
  fillRR(ctx, x, y, w, h, 0, withA(tint, 0.72));
  ctx.save(); roundRect(ctx, x, y, w, h, 0); ctx.clip();
  ctx.fillStyle = withA(tint, 0.72); ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C.line; ctx.fillRect(x, y + h - 1, w, 1);
  ctx.restore();
  const dots = ['#3c434d', '#3c434d', '#3c434d'];
  dots.forEach((d, i) => { ctx.beginPath(); ctx.arc(x + 22 + i * 19, y + h / 2, 5.5, 0, Math.PI * 2); ctx.fillStyle = d; ctx.fill(); });
  if (tabs) {
    mono(ctx, 20);
    let tx = x + 92;
    tabs.forEach((tab, i) => {
      const tw = ctx.measureText(tab).width;
      if (i === active) {
        fillRR(ctx, tx - 12, y + 7, tw + 24, h - 14, 7, withA(C.panelHi, 1));
        ctx.fillStyle = C.line; ctx.fillRect(tx - 12, y + h - 8, tw + 24, 1);
      }
      ctx.fillStyle = i === active ? C.textHi : C.faint;
      ctx.fillText(tab, tx, y + h / 2 + 7);
      tx += tw + 38;
    });
  } else if (title) {
    mono(ctx, 19); ctx.fillStyle = C.faint;
    ctx.fillText(title, x + 92, y + h / 2 + 6.5);
  }
}

/** Bottom caption capsule: mono, white on grey, exactly as specced. */
export function caption(ctx, W, H, text, k, { px = 34 } = {}) {
  if (k <= 0.001 || !text) return;
  const U = H / 1080;
  mono(ctx, px * U, 500);
  const tw = ctx.measureText(text).width;
  const padX = 34 * U, hh = px * U + 30 * U;
  const cx = W / 2, by = H - 74 * U;
  const rise = (1 - k) * 12 * U;
  ctx.save();
  ctx.globalAlpha = k;
  // A soft scrim: the caption sits over live UI, so without its own floor the text underneath
  // reads as smeared letters leaking around the capsule edge.
  const scTop = by - hh - 96 * U;
  const sc = ctx.createLinearGradient(0, scTop, 0, H);
  sc.addColorStop(0, 'rgba(9,11,14,0)');
  sc.addColorStop(0.52, 'rgba(9,11,14,0.74)');
  sc.addColorStop(1, 'rgba(9,11,14,0.94)');
  ctx.fillStyle = sc;
  ctx.fillRect(0, scTop, W, H - scTop);
  // capsule: grey plate, hairline, no drop shadow — it must read as part of the UI
  const bw = tw + padX * 2;
  fillRR(ctx, cx - bw / 2, by - hh + rise, bw, hh, hh / 2, 'rgba(52,58,67,0.97)');
  strokeRR(ctx, cx - bw / 2, by - hh + rise, bw, hh, hh / 2, 'rgba(255,255,255,0.13)', 1);
  ctx.fillStyle = '#f6f8fa'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, by - hh / 2 + rise + px * U * 0.02);
  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/** Background wash shared by every shot so the film feels like one continuous take. */
export function backdrop(ctx, W, H, t, { cx = 0.5, cy = 0.5, warm = 0 } = {}) {
  ctx.fillStyle = C.bg0; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * cx, H * cy, 0, W * cx, H * cy, Math.max(W, H) * 0.78);
  g.addColorStop(0, '#1a1e24');
  g.addColorStop(0.55, '#13161a');
  g.addColorStop(1, '#0b0d10');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (warm > 0.002) bloom(ctx, W * cx, H * cy, Math.max(W, H) * 0.42, C.her, warm * 0.5);
  // a whisper of scanline texture, static (never per-frame noise — that kills compression)
  ctx.save(); ctx.globalAlpha = 0.028; ctx.fillStyle = '#ffffff';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}
