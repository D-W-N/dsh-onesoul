// ui.js — the shared furniture every shot reuses. Same radius, same chrome, same cursor.
// Keeping this in one place is what makes eight different screens read as one film.
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, roundRect, glowText } from './theme.js';
import { clamp, lerp, ease, snap, glide, spring, seg, pulse, hash, noise1 } from './motion.js';

/** Block cursor. Period 0.53 s, half on / half off — driven by t only. */
export const cursorOn = t => ((t / 0.53) % 1) < 0.55;

/** A cursor that is *always* on for a moment after typing (so it never disappears mid-keystroke). */
export function typingCursorOn(t, lastTypeT) {
  if (t - lastTypeT < 0.18) return 1;
  return cursorOn(t) ? 1 : 0;
}

export function drawCursor(ctx, x, y, px, alpha = 1, { w = null, color = C.her, glow = true } = {}) {
  if (alpha <= 0.01) return;
  const bw = w ?? px * 0.56, bh = px * 1.02;
  if (glow) bloom(ctx, x + bw / 2, y - bh * 0.28, px * 1.5, color, 0.5 * alpha);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y - bh * 0.80, bw, bh);
  ctx.restore();
}

/** Split "code   // comment" so the comment can live in its own right-aligned column. */
export function splitComment(line) {
  const i = line.indexOf('//');
  if (i < 0) return [line, ''];
  return [line.slice(0, i).replace(/\s+$/, ''), line.slice(i)];
}

/**
 * One line of code, syntax-coloured, optionally typed.
 * Returns the x where the line ends (for cursor placement).
 */
export function codeLine(ctx, s, x, y, px, {
  limit = Infinity, cjkPx = px * 0.94, lang = 'js', color = null,
} = {}) {
  let cx = x, i = 0;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const src = [...s];
  const cjkFont = `400 ${cjkPx}px ${F.cjk}`, monoFont = `400 ${px}px ${F.mono}`;
  // tokenise crudely here: strings + comments + the rest, enough for these scripts
  for (const ch of src) {
    if (i >= limit) break;
    let col = color || C.text;
    if (ch === '/' ) col = C.comment;
    const isCJK = /[\u3000-\u9fff\uff00-\uffef]/.test(ch);
    ctx.font = isCJK ? cjkFont : monoFont;
    ctx.fillStyle = col;
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width;
    i++;
  }
  return cx;
}

/** Width of a mixed mono/CJK string. */
export function textW(ctx, s, px, cjkPx = px * 0.94) {
  let w = 0;
  const cjkFont = `400 ${cjkPx}px ${F.cjk}`, monoFont = `400 ${px}px ${F.mono}`;
  for (const ch of s) {
    const isCJK = /[\u3000-\u9fff\uff00-\uffef]/.test(ch);
    ctx.font = isCJK ? cjkFont : monoFont;
    w += ctx.measureText(ch).width;
  }
  return w;
}

/** Terminal prompt glyph — cool grey, never amber (only her cursor is amber). */
export function prompt(ctx, x, y, px, ch = '❯') {
  mono(ctx, px, 500);
  ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(ch, x, y);
  return x + ctx.measureText(ch).width + px * 0.55;
}

/** A progress / status chip: used for ON-LINE, ✓, MIT. */
export function chip(ctx, x, y, label, { px = 18, fg = C.ok, bg = null, dot = true, letter = 0.5 } = {}) {
  mono(ctx, px, 500);
  const tw = ctx.measureText(label).width;
  const padX = px * 0.72, h = px * 1.7;
  const w = tw + padX * 2 + (dot ? px * 0.92 : 0);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  if (bg) { fillRR(ctx, x, y - h / 2, w, h, h / 2, bg); }
  let tx = x + padX;
  if (dot) {
    ctx.beginPath(); ctx.arc(tx + px * 0.22, y, px * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = fg; ctx.globalAlpha = 1; ctx.fill();
    tx += px * 0.92;
  }
  ctx.fillStyle = fg;
  ctx.fillText(label, tx, y + px * 0.04);
  ctx.textBaseline = 'alphabetic';
  return w;
}

/**
 * Scrolling log list. `rows` = [{ s, t, color, indent }]; rows slide up by `scroll`
 * and the newest row is typed out over [t, t + dur].
 */
export function logRows(ctx, x, yTop, { px = 25, lh = 1.85, rows, t, scroll = 0, clipH = null, clipX = null, clipW = 0 }) {
  ctx.save();
  if (clipH != null) { ctx.beginPath(); ctx.rect(clipX, yTop - px, clipW, clipH); ctx.clip(); }
  const baseY = yTop - scroll * px * lh;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (t < r.t) continue;
    const yy = baseY + i * px * lh;
    if (clipH != null && (yy < yTop - px * 2 || yy > yTop + clipH + px * 2)) continue;
    ctx.globalAlpha = r.alpha ?? 1;
    if (r.typed != null) {
      codeLine(ctx, r.s, x + (r.indent || 0), yy, px, { limit: r.typed, color: r.color });
    } else {
      codeLine(ctx, r.s, x + (r.indent || 0), yy, px, { color: r.color });
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  return baseY;
}

/**
 * The waveform that appears when she speaks. Deterministic bars, amplitude envelope from t.
 * `k` = 0..1 reveal, `amp` = 0..1 loudness.
 */
export function waveform(ctx, x, y, w, h, t, k, { bars = 64, amp = 1, color = C.her, seed = 7, align = 'center' } = {}) {
  if (k <= 0.001) return;
  const bw = w / bars * 0.52, gap = w / bars;
  for (let i = 0; i < bars; i++) {
    const reveal = clamp(k * 1.35 - (i / bars) * 0.35);
    if (reveal <= 0.001) continue;
    // two noise octaves = a voice-like envelope, plus a slow swell so it breathes
    const n1 = noise1(i * 0.42 + t * 3.4, seed);
    const n2 = noise1(i * 0.11 - t * 0.9, seed + 5);
    const env = Math.pow(Math.sin(Math.PI * (i + 0.5) / bars), 0.65);
    const v = (0.22 + 0.78 * (0.55 * n1 + 0.45 * n2)) * env * amp * reveal;
    const bh = Math.max(2, v * h);
    const bx = x + i * gap + (gap - bw) / 2;
    const by = align === 'center' ? y - bh / 2 : y - bh;
    fillRR(ctx, bx, by, bw, bh, Math.min(bw / 2, 3), withA(color, 0.30 + 0.62 * reveal));
  }
}

/** Expanding ripple ring — the speaker's voice going out into the room. */
export function ripple(ctx, x, y, r0, r1, k, color = C.her, lw = 2.4, alpha = 1) {
  if (k <= 0 || k >= 1) return;
  const r = lerp(r0, r1, ease.outCubic(k));
  ctx.save();
  ctx.globalAlpha = (1 - k) * (1 - k) * alpha;
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** Frosted-glass card: the control centre's material. */
export function glassCard(ctx, x, y, w, h, { r = 16, k = 1, accent = 0, fill = 'rgba(38,44,52,0.72)' } = {}) {
  if (k <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = k;
  // frosted body: cool grey plate + a lighter top edge (the "glass" catch light)
  roundRect(ctx, x, y, w, h, r);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(44,51,60,0.86)');
  g.addColorStop(0.55, fill);
  g.addColorStop(1, 'rgba(26,31,37,0.90)');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = withA('#ffffff', 0.10 + accent * 0.16); ctx.lineWidth = 1; ctx.stroke();
  // top catch light
  ctx.beginPath(); ctx.moveTo(x + r, y + 0.5); ctx.lineTo(x + w - r, y + 0.5);
  ctx.strokeStyle = withA('#ffffff', 0.13); ctx.stroke();
  ctx.restore();
}

/** A tiny amber dot — her mark. Used in every shot at least once. */
export function herDot(ctx, x, y, r, alpha = 1, glowK = 1) {
  if (alpha <= 0.01 || r <= 0) return;
  if (glowK > 0) bloom(ctx, x, y, r * 7.5, C.her, 0.55 * alpha * glowK);
  ctx.save(); ctx.globalAlpha = clamp(alpha);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.her; ctx.fill();
  ctx.restore();
}

/** Section label used on the dashboard: wide letter-spacing, tiny, cool. */
export function sectionLabel(ctx, s, x, y, { px = 15, color = C.faint, ls = 3.2 } = {}) {
  mono(ctx, px, 500);
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  let cx = x;
  for (const ch of s) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + ls; }
  return cx;
}

/** Fit a string into a max width by truncating with an ellipsis (never overflows a card). */
export function clip(ctx, s, px, maxW, cjkPx = px * 0.94) {
  if (textW(ctx, s, px, cjkPx) <= maxW) return s;
  let out = '';
  for (const ch of s) {
    if (textW(ctx, out + ch + '…', px, cjkPx) > maxW) break;
    out += ch;
  }
  return out + '…';
}
