// shot-chain.js — 第 6 镜 · 模型链自动切换（慢 20%）
// model-chain.json; the cursor parks on onFail and the camera pushes in. Then the chain itself:
// node 1 errors, goes red, dies; the amber light travels to node 2 and the rail relights.
// The JSON is verbatim from the storyboard.
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, roundRect } from './theme.js';
import { at, shot } from './timeline.js';
import { clamp, lerp, ease, snap, glide, spring, springTo, seg, pulse } from './motion.js';
import { herDot, textW, sectionLabel, drawCursor, cursorOn } from './ui.js';

const S = shot('chain');

const J = [
  '{',
  '  "chain": [',
  '    { "provider": "buddy", "model": "hy4free" },',
  '    { "provider": "buddy", "model": "hy3" }',
  '  ],',
  '  "onFail": { "advance": true, "restart": true }',
  '}',
];

function jsonLine(ctx, s, x, y, px, alpha = 1) {
  mono(ctx, px);
  let cx = x;
  const push = (t, col) => { ctx.fillStyle = col; ctx.fillText(t, cx, y); cx += ctx.measureText(t).width; };
  const re = /("(?:[^"\\]|\\.)*")(\s*:\s*)?|(\{|\}|\[|\]|,|:)|([a-z]+)|(\s+)|(.)/g;
  let m;
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'left';
  while ((m = re.exec(s))) {
    if (m[1] && m[2]) { push(m[1], C.fn); push(m[2], C.dim); }
    else if (m[1]) push(m[1], C.string);
    else if (m[3]) push(m[3], C.dim);
    else if (m[4]) push(m[4], C.keyword);
    else push(m[0], C.text);
  }
  ctx.globalAlpha = 1;
  return cx;
}

const hex = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixTo = (a, b, k) => { const pa = hex(a), pb = hex(b), kk = clamp(k); return `rgb(${Math.round(lerp(pa[0], pb[0], kk))},${Math.round(lerp(pa[1], pb[1], kk))},${Math.round(lerp(pa[2], pb[2], kk))})`; };

export function drawChain(ctx, W, H, t) {
  const U = Math.min(W, H) / 1080;
  const px = 26 * U;

  const failAt = at('chain', 3.55), dieAt = at('chain', 4.10);
  const travelAt = at('chain', 4.60), relitAt = at('chain', 6.40);

  // ── camera: hold → push onto onFail → pull back for the chain ──
  const z = springTo(t, [
    [at('chain', 0.0), 1.0], [at('chain', 0.7), 1.0],
    [at('chain', 1.20), 1.0], [at('chain', 2.05), 1.075], [at('chain', 3.10), 1.05], [at('chain', 4.20), 1.0],
  ], { freq: 1.8, damp: 0.88 });
  const ty = springTo(t, [
    [at('chain', 0.0), H * 0.5], [at('chain', 2.05), H * 0.5 + 30 * U], [at('chain', 4.20), H * 0.5],
  ], { freq: 1.8, damp: 0.88 });

  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -ty);

  // ══ JSON editor ══
  const ew = W * 0.66, eh = H * 0.365;
  const ex = (W - ew) / 2, ey = H * 0.105;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.64)'; ctx.shadowBlur = 54 * U; ctx.shadowOffsetY = 16 * U;
  fillRR(ctx, ex, ey, ew, eh, 13 * U, '#111519');
  ctx.restore();
  strokeRR(ctx, ex, ey, ew, eh, 13 * U, C.lineHi, 1);

  fillRR(ctx, ex, ey, ew, 40 * U, 13 * U, C.panel);
  ctx.save(); ctx.beginPath(); ctx.rect(ex, ey, ew, 40 * U); ctx.clip();
  ctx.fillStyle = C.panel; ctx.fillRect(ex, ey, ew, 40 * U); ctx.restore();
  ctx.fillStyle = C.line; ctx.fillRect(ex, ey + 40 * U, ew, 1);
  [0, 1, 2].forEach(i => { ctx.beginPath(); ctx.arc(ex + 23 * U + i * 18 * U, ey + 20 * U, 5.2 * U, 0, Math.PI * 2); ctx.fillStyle = '#3c434d'; ctx.fill(); });
  mono(ctx, 15.5 * U); ctx.fillStyle = C.faint; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('model-chain.json', ex + 86 * U, ey + 25 * U);
  mono(ctx, 12 * U); ctx.fillStyle = C.ghost; ctx.textAlign = 'right';
  ctx.fillText('~/.dsh/anima/model-chain.json', ex + ew - 20 * U, ey + 25 * U);
  ctx.textAlign = 'left';

  const gutW = 48 * U;
  ctx.save(); ctx.beginPath(); ctx.rect(ex, ey + 41 * U, ew, eh - 40 * U); ctx.clip();
  ctx.fillStyle = C.gutter; ctx.fillRect(ex, ey + 41 * U, gutW, eh);
  ctx.fillStyle = C.line; ctx.fillRect(ex + gutW, ey + 41 * U, 1, eh);

  const codeX = ex + gutW + 22 * U;
  const y0 = ey + 41 * U + 44 * U, lh = px * 1.74;
  J.forEach((s, i) => {
    const a = at('chain', 0.05) + i * 0.055;
    if (t < a) return;
    const k = clamp((t - a) / 0.15);
    mono(ctx, 13.5 * U); ctx.fillStyle = C.ghost; ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), ex + gutW - 14 * U, y0 + i * lh);
    ctx.textAlign = 'left';
    jsonLine(ctx, s, codeX, y0 + i * lh, px, k);
  });

  // cursor parks on onFail (line 6) — the camera's push-in target
  const onFailY = y0 + 5 * lh;
  if (t >= at('chain', 1.05)) {
    mono(ctx, px);
    const lineX = codeX + textW(ctx, J[5], px);
    const boxK = clamp((t - at('chain', 1.20)) / 0.3) * (1 - clamp((t - at('chain', 4.0)) / 0.3));
    if (boxK > 0) {
      const kw = '"onFail"';
      const bx = codeX + textW(ctx, '  ', px);
      const bw = textW(ctx, kw, px) + 6 * U;
      ctx.save(); ctx.globalAlpha = boxK;
      fillRR(ctx, bx - 4 * U, onFailY - px * 0.84, bw + 4 * U, px * 1.14, 4 * U, withA(C.her, 0.10));
      strokeRR(ctx, bx - 4 * U, onFailY - px * 0.84, bw + 4 * U, px * 1.14, 4 * U, withA(C.her, 0.32), 1);
      ctx.restore();
    }
    if (t < failAt && cursorOn(t)) drawCursor(ctx, lineX + 3 * U, onFailY, px, 1, { color: C.her });
  }
  ctx.restore();

  // ══ the chain rail ══
  const railCy = ey + eh + 104 * U;
  const n1 = { x: lerp(W * 0.175, W * 0.825, 0.24) };
  const n2 = { x: lerp(W * 0.175, W * 0.825, 0.76) };
  const railK = clamp((t - at('chain', 0.85)) / 0.4);

  if (railK > 0) {
    ctx.save(); ctx.globalAlpha = railK;
    ctx.strokeStyle = withA('#ffffff', 0.09); ctx.lineWidth = 2 * U;
    ctx.beginPath(); ctx.moveTo(n1.x, railCy); ctx.lineTo(n2.x, railCy); ctx.stroke();
    ctx.restore();

    const failPulse = pulse(t, failAt, 0.22);
    const deadK = clamp((t - dieAt) / 0.45);
    const n1r = 9 * U * (1 + (t >= failAt && t < dieAt ? 0.3 * failPulse : 0)) * (1 - deadK * 0.32);
    const n1col = t < failAt ? '#8ea0b8' : mixTo(C.err, '#2a2f36', t < dieAt ? 0 : deadK);

    // node 1
    if (t >= failAt && t < dieAt) bloom(ctx, n1.x, railCy, 46 * U, C.err, 0.35 * failPulse);
    ctx.beginPath(); ctx.arc(n1.x, railCy, n1r, 0, Math.PI * 2);
    ctx.fillStyle = n1col; ctx.globalAlpha = railK; ctx.fill(); ctx.globalAlpha = 1;
    if (t >= failAt && t < failAt + 0.8) {
      const rk = clamp((t - failAt) / 0.8);
      ctx.save(); ctx.globalAlpha = (1 - rk) * 0.7 * railK;
      ctx.strokeStyle = C.err; ctx.lineWidth = 2.4 * U;
      ctx.beginPath(); ctx.arc(n1.x, railCy, 9 * U + rk * 66 * U, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // node 2
    const n2lit = clamp((t - relitAt) / 0.42);
    const n2col = t < travelAt ? '#39414b' : mixTo('#39414b', '#ccd4e0', clamp((t - travelAt) / 0.5));
    ctx.globalAlpha = railK;
    ctx.beginPath(); ctx.arc(n2.x, railCy, 9 * U * (1 + 0.18 * n2lit), 0, Math.PI * 2);
    ctx.fillStyle = n2col; ctx.fill();
    ctx.globalAlpha = 1;
    if (t >= travelAt) bloom(ctx, n2.x, railCy, 86 * U, C.her, 0.38 * n2lit * railK);

    // the travelling amber light
    if (t >= travelAt && t < relitAt + 0.25) {
      const tk = ease.inOutCubic(clamp((t - travelAt) / (relitAt - travelAt - 0.12)));
      const lx = lerp(n1.x, n2.x, tk);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) {
        const back = i / 9;
        bloom(ctx, lerp(n1.x, lx, back), railCy, (24 - i * 2) * U, C.her, (0.30 - back * 0.26) * railK);
      }
      bloom(ctx, lx, railCy, 62 * U, C.her, 0.72 * railK);
      ctx.restore();
      ctx.beginPath(); ctx.arc(lx, railCy, 7.5 * U, 0, Math.PI * 2); ctx.fillStyle = C.herHi; ctx.fill();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withA(C.her, 0.46); ctx.lineWidth = 2.4 * U;
      ctx.beginPath(); ctx.moveTo(n1.x, railCy); ctx.lineTo(lx, railCy); ctx.stroke();
      ctx.restore();
    }
    if (t >= relitAt) {
      const kk = clamp((t - relitAt) / 0.5);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = withA(C.her, 0.26 * kk); ctx.lineWidth = 2 * U;
      ctx.beginPath(); ctx.moveTo(n1.x, railCy); ctx.lineTo(n2.x, railCy); ctx.stroke();
      ctx.restore();
    }

    // labels
    ctx.save(); ctx.globalAlpha = railK;
    [[n1, 0], [n2, 1]].forEach(([nd, i]) => {
      const isDead = i === 0 && deadK > 0.5;
      const isLive = i === 1 && t >= relitAt;
      mono(ctx, 16 * U, 500); ctx.textAlign = 'center';
      ctx.fillStyle = isDead ? C.ghost : isLive ? C.textHi : C.dim;
      ctx.fillText(i === 0 ? 'buddy / hy4free' : 'buddy / hy3', nd.x, railCy + 46 * U);
      mono(ctx, 13 * U);
      ctx.fillStyle = isDead ? withA(C.err, 0.65) : isLive ? C.her : C.ghost;
      ctx.fillText(isDead ? 'timeout · 已摘除' : isLive ? '当前 · 承接会话' : `node ${i + 1}`, nd.x, railCy + 70 * U);
      ctx.textAlign = 'left';
    });
    ctx.restore();
  }

  // ══ log strip ══
  const logY = railCy + 118 * U;
  if (t >= failAt) {
    const lx = W * 0.175;
    mono(ctx, 13 * U); ctx.fillStyle = C.faint; ctx.textAlign = 'left';
    ctx.fillText('dsh-anima › model-chain', lx, logY);
    const rows = [
      { a: failAt, s: 'hy4free  ·  request failed (timeout 30s)  →  advance=true', c: C.err },
      { a: at('chain', 4.15), s: 'chain[1]  buddy / hy3  ·  已切换', c: C.dim },
      { a: relitAt + 0.15, s: 'onFail.restart  →  会话已用新模型重跑  ✓', c: C.ok },
    ];
    rows.forEach((r, i) => {
      if (t < r.a) return;
      ctx.save(); ctx.globalAlpha = clamp((t - r.a) / 0.2);
      mono(ctx, 15 * U); ctx.fillStyle = r.c;
      ctx.fillText(r.s, lx, logY + 32 * U + i * 28 * U);
      ctx.restore();
    });
  }

  ctx.restore(); // camera
}