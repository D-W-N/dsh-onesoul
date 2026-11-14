// shot-install.js — 第 1 镜 · 安装
// A clean Windows terminal. The command types itself, ⏎ runs it, dependencies stream,
// a green ✓ lands. The camera pushes in slightly on the ✓ and only the cursor is amber.
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, drawCode } from './theme.js';
import { at, typedCount, shot, TYPING, typing } from './timeline.js';
import { clamp, lerp, ease, snap, glide, spring, seg } from './motion.js';
import { drawCursor, cursorOn, prompt, textW } from './ui.js';

const S = shot('install');
const CMD = 'dsh plugin add dsh-onesoul';
const T = typing('install', 0);

// Dependencies from packages/dsh-onesoul/package.json v0.2.6 — but the film deliberately shows
// only five of the seven upstream packages: `dsh-deepseek-web-login` and `dsh-our-free-model` are
// dropped at the user's request (they are the login/free-model plumbing, not the soul).
const DEPS = [
  ['dsh-better-sidebar', '^0.26.1'],
  ['dsh-onebot-qq', '^0.9.9'],
  ['dsh-napcat-keeper', '^2.8.2'],
  ['dsh-bili-pond', '^1.3.14'],
  ['dsh-meme', '^0.1.71'],
  ['dsh-anima', 'bundled'],
  ['dsh-companion-dashboard', 'bundled'],
];

export function drawInstall(ctx, W, H, t) {
  const U = Math.min(W, H) / 1080;
  const winW = W * 0.755, winH = H * 0.685;
  const wx = (W - winW) / 2, wy = (H - winH) / 2 - 24 * U;
  const px = 28 * U, lh = 1.95, rowLh = 1.44;

  // ── camera: still, then a slow push that starts on the ✓ ──
  const pushK = glide(clamp((t - at('install', 6.0)) / 1.6));
  const zoom = 1 + 0.075 * pushK;
  const camY = H * 0.5 + 22 * U * pushK;
  ctx.save();
  ctx.translate(W / 2, camY); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -camY);

  // window
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.66)'; ctx.shadowBlur = 64 * U; ctx.shadowOffsetY = 20 * U;
  fillRR(ctx, wx, wy, winW, winH, 14 * U, C.bg1);
  ctx.restore();
  strokeRR(ctx, wx, wy, winW, winH, 14 * U, C.lineHi, 1);

  // chrome strip
  fillRR(ctx, wx, wy, winW, 46 * U, 14 * U, C.panel);
  ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, winW, 46 * U); ctx.clip();
  ctx.fillStyle = C.panel; ctx.fillRect(wx, wy, winW, 46 * U); ctx.restore();
  ctx.fillStyle = C.line; ctx.fillRect(wx, wy + 46 * U, winW, 1);
  [0, 1, 2].forEach(i => { ctx.beginPath(); ctx.arc(wx + 26 * U + i * 21 * U, wy + 23 * U, 6 * U, 0, Math.PI * 2); ctx.fillStyle = '#3c434d'; ctx.fill(); });
  mono(ctx, 18 * U); ctx.fillStyle = C.faint; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Windows PowerShell', wx + 96 * U, wy + 29 * U);

  const bodyTop = wy + 46 * U, bodyBot = wy + winH;
  const leftPad = wx + 36 * U;
  const rightPad = wx + winW - 36 * U;

  ctx.save(); ctx.beginPath(); ctx.rect(wx, bodyTop, winW, bodyBot - bodyTop); ctx.clip();

  // ── line 1: the command ──
  const y1 = bodyTop + 76 * U;
  const afterPrompt = prompt(ctx, leftPad, y1, px);
  const shown = typedCount(CMD, T.t0, T.t1, t, T.seed);
  mono(ctx, px);
  ctx.fillStyle = C.textHi; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(CMD.slice(0, shown), afterPrompt, y1);
  const cmdEndX = afterPrompt + textW(ctx, CMD.slice(0, shown), px);

  const enterAt = at('install', 3.30);
  const typingNow = t >= T.t0 && t < T.t1;
  if (t < enterAt) {
    const on = typingNow ? 1 : (cursorOn(t) ? 1 : 0);
    drawCursor(ctx, cmdEndX + 2 * U, y1, px, on, { color: C.her });
  }

  // ── line 2 onward: the install output ──
  if (t >= enterAt) {
    const y2 = y1 + px * lh * 1.05;
    const doneAt = at('install', 6.10);
    // spinner → done: the line states a fact, it does not contradict the ✓ below it
    const spinSet = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
    const spinning = t < doneAt;
    const spin = spinning ? spinSet[Math.floor(t * 13) % 10] : '·';
    mono(ctx, px * 0.94);
    ctx.fillStyle = spinning ? C.dim : C.faint;
    ctx.fillText(`${spin}  resolving dependencies  ·  registry.npmjs.org`, leftPad, y2);

    // rows stream in on a tight stagger
    const rowT0 = at('install', 3.52), per = (doneAt - rowT0 - 0.45) / DEPS.length;
    const listTop = y2 + px * rowLh * 1.30;
    DEPS.forEach(([name, ver], i) => {
      const rt = rowT0 + i * per;
      if (t < rt) return;
      const k = clamp((t - rt) / 0.15);
      const ry = listTop + i * px * rowLh + (1 - k) * 7 * U;
      ctx.save(); ctx.globalAlpha = k;
      mono(ctx, px * 0.88);
      ctx.fillStyle = C.ok; ctx.textAlign = 'left';
      ctx.fillText('+', leftPad + 2 * U, ry);
      ctx.fillStyle = C.text;
      ctx.fillText(name, leftPad + px * 1.15, ry);
      ctx.fillStyle = C.faint; ctx.textAlign = 'right';
      ctx.fillText(ver, rightPad, ry);
      ctx.textAlign = 'left';
      ctx.restore();
    });

    // ── the ✓ line ──
    if (t >= doneAt) {
      const k = spring(t - doneAt, { freq: 3.4, damp: 0.64 });
      const pk = Math.max(0, 1 - (t - doneAt) / 1.3);
      const okY = listTop + DEPS.length * px * rowLh + px * 0.55;
      ctx.save();
      ctx.globalAlpha = clamp(k);
      bloom(ctx, leftPad + px * 0.48, okY - px * 0.28, px * (4.2 + pk * 2.4), C.ok, 0.26 + pk * 0.30);
      mono(ctx, px, 700);
      ctx.fillStyle = C.ok; ctx.textAlign = 'left';
      ctx.fillText('✓', leftPad, okY);
      mono(ctx, px * 0.95, 500);
      ctx.fillStyle = C.textHi;
      ctx.fillText('dsh-onesoul', leftPad + px * 1.4, okY);
      mono(ctx, px * 0.86);
      ctx.fillStyle = C.faint;
      ctx.fillText('v0.2.6  ·  7 packages  ·  plugins enabled',
        leftPad + px * 1.4 + textW(ctx, 'dsh-onesoul', px * 0.95) + px * 1.0, okY);
      ctx.restore();

      // idle prompt with her blinking caret — the film comes back to exactly this
      const afterY = okY + px * 1.9;
      const p2 = prompt(ctx, leftPad, afterY, px);
      if (cursorOn(t)) drawCursor(ctx, p2, afterY, px, 1, { color: C.her });
    }
  }
  ctx.restore(); // body clip

  // window-wide lift when the green ✓ lands
  const doneAt = at('install', 6.10);
  if (t >= doneAt) {
    const pk = Math.max(0, 1 - (t - doneAt) / 1.1);
    if (pk > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      bloom(ctx, wx + winW * 0.5, wy + winH * 0.5, Math.max(W, H) * 0.50, C.ok, 0.085 * pk);
      ctx.restore();
    }
  }
  ctx.restore(); // camera
}