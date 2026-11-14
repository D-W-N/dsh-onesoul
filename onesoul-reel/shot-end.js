// shot-end.js — 第 8 镜 · 结尾
// Back to the terminal: the install command types again; the repo line and MIT badge float up
// beneath it. The picture dims a notch — never to black — and the cursor blinks three times,
// then the command+MIT lockup holds for 3.7 s.
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, roundRect } from './theme.js';
import { at, shot, TYPING, typedCount, DUR, BEAT, typing } from './timeline.js';
import { clamp, lerp, ease, snap, glide, spring, springTo, seg } from './motion.js';
import { drawCursor, cursorOn, prompt, textW } from './ui.js';

const S = shot('end');
const CMD = 'dsh plugin add dsh-onesoul';
const T = typing('end', 0);

// 第 8 镜 = 8.0 s (b76 → b88). Badge lands at 4.30 s, so the command + MIT lockup is on screen
// and settled for 3.7 s — comfortably past the 3 s the spec asks for.
const ENTER = 4.30, BADGE = 5.35, SETTLE = 6.05;

export function drawEnd(ctx, W, H, t) {
  const U = Math.min(W, H) / 1080;
  const px = 30 * U;

  const dimK = clamp((t - at('end', 6.45)) / 1.1);

  const zoom = 1 + 0.012 * (1 - clamp((t - at('end', 0)) / 7.4));
  ctx.save();
  ctx.translate(W / 2, H * 0.5); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H * 0.5);

  // ── terminal: same chrome as shot 1, so the film closes where it opened ──
  const winW = W * 0.70, winH = H * 0.325;
  const wx = (W - winW) / 2, wy = H * 0.205;

  ctx.save(); ctx.globalAlpha = 1 - dimK * 0.26;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.62)'; ctx.shadowBlur = 58 * U; ctx.shadowOffsetY = 17 * U;
  fillRR(ctx, wx, wy, winW, winH, 14 * U, '#101418');
  ctx.restore();
  strokeRR(ctx, wx, wy, winW, winH, 14 * U, C.lineHi, 1);

  fillRR(ctx, wx, wy, winW, 42 * U, 14 * U, C.panel);
  ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, winW, 42 * U); ctx.clip();
  ctx.fillStyle = C.panel; ctx.fillRect(wx, wy, winW, 42 * U); ctx.restore();
  ctx.fillStyle = C.line; ctx.fillRect(wx, wy + 42 * U, winW, 1);
  [0, 1, 2].forEach(i => { ctx.beginPath(); ctx.arc(wx + 24 * U + i * 19 * U, wy + 21 * U, 5.4 * U, 0, Math.PI * 2); ctx.fillStyle = '#3c434d'; ctx.fill(); });
  mono(ctx, 16.5 * U); ctx.fillStyle = C.faint; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Windows PowerShell', wx + 90 * U, wy + 26 * U);

  const codeY = wy + 42 * U + 74 * U;
  const cx0 = wx + 40 * U;
  const after = prompt(ctx, cx0, codeY, px);
  const shown = typedCount(CMD, T.t0, T.t1, t, T.seed);
  mono(ctx, px);
  ctx.fillStyle = C.textHi;
  ctx.fillText(CMD.slice(0, shown), after, codeY);
  const endX = after + textW(ctx, CMD.slice(0, shown), px);

  // the ✓ echo — the install from shot 1 is still true. It gets its own line and its own
  // indent so the caret line never sits on top of it.
  if (t >= at('end', ENTER)) {
    const k = clamp((t - at('end', ENTER)) / 0.28);
    ctx.save(); ctx.globalAlpha = (1 - dimK * 0.26) * k;
    mono(ctx, 17 * U, 500);
    ctx.fillStyle = C.ok;
    ctx.fillText('✓', cx0, codeY + 46 * U);
    mono(ctx, 16 * U, 500);
    ctx.fillStyle = C.dim;
    ctx.fillText('installed  ·  dsh-onesoul  v0.2.6', cx0 + 26 * U, codeY + 46 * U);
    ctx.restore();
  }

  // cursor: the last thing that moves. It lives on the line below the ✓, three blinks, then still.
  const caretLineY = codeY + 94 * U;
  let caretA = 0, caretX, caretY;
  if (t < T.t1) { caretA = 1; caretX = endX + 2 * U; caretY = codeY; }
  else if (t < at('end', SETTLE)) {
    caretA = cursorOn(t) ? 1 : 0;
    caretX = prompt(ctx, cx0, caretLineY, px); caretY = caretLineY;
  } else {
    const k = (t - at('end', SETTLE)) / 1.02;
    caretA = k < 3 ? ((k % 1) < 0.55 ? 1 : 0) : 0;
    caretX = prompt(ctx, cx0, caretLineY, px); caretY = caretLineY;
  }
  if (caretA > 0) drawCursor(ctx, caretX, caretY, px, caretA, { color: C.her });

  ctx.restore(); // dim

  // ── repo + MIT badge ──
  const rk = spring(t - at('end', BADGE), { freq: 1.9, damp: 0.90 });
  if (rk > 0.004) {
    ctx.save();
    ctx.globalAlpha = clamp(rk) * (1 - dimK * 0.08);
    const by = wy + winH + 84 * U;
    const repo = 'github.com/D-W-N/dsh-onesoul';
    mono(ctx, 24 * U, 500);
    const rw = textW(ctx, repo, 24 * U);
    const MIT_W = 88 * U, MIT_H = 36 * U, gap = 26 * U;
    const total = rw + gap + MIT_W;
    const rx = W / 2 - total / 2;

    ctx.strokeStyle = withA('#ffffff', 0.09); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2 - 240 * U, by - 42 * U); ctx.lineTo(W / 2 + 240 * U, by - 42 * U); ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.text;             // bright enough to be the last readable line
    ctx.textAlign = 'left';
    ctx.fillText(repo, rx, by);

    const bx = rx + rw + gap, byy = by - MIT_H / 2;
    fillRR(ctx, bx, byy, MIT_W, MIT_H, MIT_H / 2, withA('#ffffff', 0.06));
    strokeRR(ctx, bx, byy, MIT_W, MIT_H, MIT_H / 2, withA('#ffffff', 0.22), 1.2 * U);
    mono(ctx, 18 * U, 700); ctx.fillStyle = C.textHi; ctx.textAlign = 'center';
    ctx.fillText('MIT', bx + MIT_W / 2, by + 1 * U);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // one faint amber breath on the hold so the frame is never dead
  if (t >= at('end', SETTLE)) {
    const hk = clamp((t - at('end', SETTLE)) / 0.8);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    bloom(ctx, cx0 + 130 * U, codeY - 8 * U, 250 * U, C.her, 0.038 * hk);
    ctx.restore();
  }

  ctx.restore(); // camera
}