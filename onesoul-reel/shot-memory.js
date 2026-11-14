// shot-memory.js — 第 3 镜 · 记忆裁决（核心卖点，慢 20%）
//
// 这一镜的论点是「她记得，但你说了算」，所以要证明的是**否决权**，不是「她会记」。
// 四个动作把这句话做实：
//   ① 候选池里有两条，都是她自作主张记下的（琥珀金 = 她的痕迹）
//   ② 你批准第一条 → 它离开池子，计数 128 → 129
//   ③ 你驳回第二条 → 它**没有**进系统提示词，而是落进「已拒绝」账本，计数仍然是 129
//   ④ 底部把边界写成一行字：什么进了提示词、什么只留在池里、什么被丢掉
// 如果只演「批准」，那和「她记得」没区别；驳回落空的那一下才是「你说了算」。
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, roundRect, tokenize } from './theme.js';
import { at, shot, TYPING, typedCount, typing } from './timeline.js';
import { clamp, lerp, ease, snap, glide, spring, springTo, seg } from './motion.js';
import { herDot, textW, sectionLabel, drawCursor, cursorOn, chip } from './ui.js';

const S = shot('memory');

// ── the four lines, verbatim from the storyboard (the 4th is the reject half of the ruling) ──
const L1 = { code: 'anima_memory_capture({ text: "主人只喝美式，不加糖", source: "qq" })', note: '// 先记进候选池', T: typing('memory', 0) };
const L2 = { code: 'anima_memory_pending()', note: '// 候选池，进不了提示词', T: typing('memory', 1) };
const L3 = { code: 'anima_memory_decide({ id: "mem_xxx", decision: "approve" })', note: '// 只有你点了头，才算数', T: typing('memory', 2) };
const L4 = { code: 'anima_memory_decide({ id: "mem_yyy", decision: "reject" })', note: '// 否掉，就不进提示词', T: typing('memory', 3) };

function coloredLine(ctx, s, x, y, px, limit, cjkPx) {
  const toks = tokenize(s, 'js');
  let i = 0, cx = x;
  for (const tok of toks) {
    for (const ch of tok.t) {
      if (i >= limit) return cx;
      const isCJK = /[\u3000-\u9fff\uff00-\uffef]/.test(ch);
      ctx.font = isCJK ? `400 ${cjkPx}px ${F.cjk}` : `400 ${px}px ${F.mono}`;
      ctx.fillStyle = tok.c;
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width;
      i++;
    }
  }
  return cx;
}

export function drawMemory(ctx, W, H, t) {
  const U = Math.min(W, H) / 1080;
  const px = 27 * U, cjkPx = 25 * U, lh = 1.90;

  const winW = W * 0.90, winH = H * 0.565;
  const wx = (W - winW) / 2, wy = (H - winH) / 2 - 26 * U;

  const approveAt = at('memory', 6.05);
  const rejectAt = at('memory', 7.00);

  // ── camera: settle, push into line 3 on the approve, hold through the reject ──
  const z = springTo(t, [
    [at('memory', 0.0), 1.0], [at('memory', 0.7), 1.0],
    [at('memory', 3.55), 1.0], [at('memory', 4.30), 1.075], [at('memory', 7.7), 1.06],
  ], { freq: 1.8, damp: 0.88 });
  const ty = springTo(t, [
    [at('memory', 0.0), H * 0.5], [at('memory', 4.30), H * 0.5 + winH * 0.10], [at('memory', 7.7), H * 0.5 + winH * 0.06],
  ], { freq: 1.8, damp: 0.88 });

  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -ty);

  // window
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.66)'; ctx.shadowBlur = 60 * U; ctx.shadowOffsetY = 18 * U;
  fillRR(ctx, wx, wy, winW, winH, 14 * U, '#111519');
  ctx.restore();
  strokeRR(ctx, wx, wy, winW, winH, 14 * U, C.lineHi, 1);

  fillRR(ctx, wx, wy, winW, 44 * U, 14 * U, C.panel);
  ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, winW, 44 * U); ctx.clip();
  ctx.fillStyle = C.panel; ctx.fillRect(wx, wy, winW, 44 * U); ctx.restore();
  ctx.fillStyle = C.line; ctx.fillRect(wx, wy + 44 * U, winW, 1);
  [0, 1, 2].forEach(i => { ctx.beginPath(); ctx.arc(wx + 25 * U + i * 20 * U, wy + 22 * U, 5.6 * U, 0, Math.PI * 2); ctx.fillStyle = '#3c434d'; ctx.fill(); });
  mono(ctx, 16.5 * U); ctx.fillStyle = C.faint; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillText('memory.js — dsh-anima', wx + 92 * U, wy + 27.5 * U);

  // gutter
  const gutW = 58 * U;
  ctx.save(); ctx.beginPath(); ctx.rect(wx, wy + 45 * U, winW, winH - 45 * U); ctx.clip();
  ctx.fillStyle = C.gutter; ctx.fillRect(wx, wy + 45 * U, gutW, winH);
  ctx.fillStyle = C.line; ctx.fillRect(wx + gutW, wy + 45 * U, 1, winH);

  const codeX = wx + gutW + 28 * U;
  const noteX = wx + winW - 34 * U;
  const y0 = wy + 45 * U + 54 * U;
  const lineYs = [y0, y0 + px * lh, y0 + px * lh * 2, y0 + px * lh * 3];

  const LINES = [L1, L2, L3, L4];
  LINES.forEach((L, i) => {
    if (t < L.T.t0 - 0.10) return;
    mono(ctx, 15.5 * U); ctx.fillStyle = C.ghost; ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), wx + gutW - 15 * U, lineYs[i]);
    ctx.textAlign = 'left';
  });

  LINES.forEach((L, i) => {
    const shown = typedCount(L.code, L.T.t0, L.T.t1, t, L.T.seed);
    if (shown <= 0) return;
    const y = lineYs[i];
    const endX = coloredLine(ctx, L.code, codeX, y, px, shown, cjkPx);

    const typing = t >= L.T.t0 && t <= L.T.t1 + 0.02;
    const lastTyped = LINES.filter(o => t >= o.T.t0).pop() === L;
    if (typing) drawCursor(ctx, endX + 2 * U, y, px, 1, { color: C.her });
    else if (lastTyped && cursorOn(t)) drawCursor(ctx, endX + 2 * U, y, px, 1, { color: C.her });

    const noteAt = L.T.t1 + 0.16;
    if (t >= noteAt) {
      const nk = clamp((t - noteAt) / 0.30);
      ctx.save(); ctx.globalAlpha = nk * 0.95;
      mono(ctx, 16 * U);
      const nw = textW(ctx, L.note, 16 * U);
      // the reject line's comment is the OTHER half of the promise — mark it, don't decorate it
      ctx.fillStyle = i === 3 ? withA(C.her, 0.72) : C.comment;
      ctx.fillText(L.note, noteX - nw + (1 - nk) * 12 * U, y);
      ctx.restore();
    }
  });

  // ══ the ledger: two candidates, two rulings, and what each one actually did ═══════════
  const stageY = wy + winH - 180 * U;
  ctx.fillStyle = C.line; ctx.fillRect(wx + gutW + 1, stageY - 34 * U, winW - gutW - 1, 1);

  const poolX = codeX;
  const colW = winW - gutW - 78 * U;

  // ── left: pending pool, two cards ──
  sectionLabel(ctx, 'PENDING POOL', poolX, stageY, { px: 11.5 * U, color: C.faint, ls: 2.4 });
  const cardW = colW * 0.44, cardH = 52 * U;
  const cards = [
    { id: 'cand_7f3a', text: '主人只喝美式，不加糖', y: stageY + 16 * U, at: approveAt, verdict: 'approve' },
    { id: 'cand_4c81', text: '主人周末会睡到十一点', y: stageY + 16 * U + cardH + 12 * U, at: rejectAt, verdict: 'reject' },
  ];
  const inK1 = clamp((t - (L1.T.t1 + 0.30)) / 0.38);
  const inK2 = clamp((t - (L2.T.t1 + 0.42)) / 0.38);

  cards.forEach((cd, i) => {
    const inK = i === 0 ? inK1 : inK2;
    if (inK <= 0) return;
    const done = t >= cd.at;
    const moveK = done ? ease.inOutCubic(clamp((t - cd.at) / 0.55)) : 0;
    // approve slides right into the ledger; reject slides right and GREYS OUT — it did not make it
    const cx2 = poolX + moveK * (colW * 0.075);
    ctx.save();
    ctx.globalAlpha = inK * (1 - moveK * (cd.verdict === 'reject' ? 0.52 : 0.24));
    fillRR(ctx, cx2, cd.y, cardW, cardH, 8 * U,
      done ? (cd.verdict === 'approve' ? '#1d2823' : '#231d1f') : '#1a2027');
    strokeRR(ctx, cx2, cd.y, cardW, cardH, 8 * U,
      done ? withA(cd.verdict === 'approve' ? C.ok : C.her, 0.38) : withA('#ffffff', 0.10), 1);
    // her amber rail: it is hers until you rule on it
    ctx.fillStyle = done ? (cd.verdict === 'approve' ? C.ok : C.dim) : C.her;
    ctx.fillRect(cx2, cd.y + 8 * U, 2.5 * U, cardH - 16 * U);
    mono(ctx, 12.5 * U); ctx.fillStyle = C.faint; ctx.textAlign = 'left';
    ctx.fillText(cd.id, cx2 + 16 * U, cd.y + 21 * U);
    cjk(ctx, 17 * U); ctx.fillStyle = done && cd.verdict === 'reject' ? C.dim : C.textHi;
    ctx.fillText(cd.text, cx2 + 16 * U, cd.y + 42 * U);
    chip(ctx, cx2 + cardW - 92 * U, cd.y + 15 * U,
      done ? (cd.verdict === 'approve' ? '已批准' : '已拒绝') : '待裁决',
      { px: 12.5 * U, fg: done ? (cd.verdict === 'approve' ? C.ok : C.her) : C.her,
        bg: withA(done ? (cd.verdict === 'approve' ? C.ok : C.her) : C.her, 0.12), dot: false });
    ctx.restore();
  });

  // ── right: the prompt-injection ledger. This is where "你说了算" is measurable. ──
  const cntX = poolX + colW * 0.565;
  sectionLabel(ctx, 'SYSTEM PROMPT', cntX, stageY, { px: 11.5 * U, color: C.faint, ls: 2.4 });

  const apprK = t >= approveAt ? spring(t - approveAt, { freq: 2.4, damp: 0.74 }) : 0;
  const injected = 128 + (t >= approveAt ? Math.round(apprK) : 0);
  // the reject must NOT move this number. That is the whole point of the shot.
  const rejK = t >= rejectAt ? spring(t - rejectAt, { freq: 2.4, damp: 0.74 }) : 0;

  mono(ctx, 30 * U, 500); ctx.fillStyle = C.textHi;
  ctx.fillText(String(injected), cntX, stageY + 40 * U);
  mono(ctx, 13.5 * U); ctx.fillStyle = C.faint;
  ctx.fillText('条已确认 · 永久注入', cntX + 66 * U, stageY + 39 * U);

  const pendNow = Math.max(0, 3 - (t >= approveAt ? 1 : 0) - (t >= rejectAt ? 1 : 0));
  mono(ctx, 13.5 * U); ctx.fillStyle = C.faint;
  ctx.fillText(`候选 ${pendNow} 条`, cntX, stageY + 64 * U);

  // rejected ledger — always visible once the reject lands, so the contrast is on screen
  const rejLedgerK = clamp((t - rejectAt - 0.25) / 0.35);
  if (rejLedgerK > 0) {
    ctx.save(); ctx.globalAlpha = rejLedgerK;
    const ry = stageY + 64 * U;
    ctx.beginPath(); ctx.arc(cntX + 92 * U, ry - 4.5 * U, 3.2 * U, 0, Math.PI * 2);
    ctx.fillStyle = C.dim; ctx.fill();
    mono(ctx, 13.5 * U); ctx.fillStyle = C.dim;
    ctx.fillText(`已拒绝 ${1} 条 · 未注入`, cntX + 102 * U, ry);
    ctx.restore();
  }

  // ── the two rulings' light: amber for the reject, green for the approve ──
  if (t >= approveAt) {
    const rk = clamp((t - approveAt) / 0.85);
    if (rk < 1) {
      ctx.save(); ctx.globalAlpha = (1 - rk) * 0.42;
      ctx.strokeStyle = C.ok; ctx.lineWidth = 2 * U;
      ctx.beginPath(); ctx.arc(cntX + 12 * U, stageY + 28 * U, 12 * U + rk * 78 * U, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    bloom(ctx, cntX + 12 * U, stageY + 28 * U, 90 * U * (1 - rk * 0.4), C.ok, 0.14 * (1 - rk));
  }
  if (t >= rejectAt) {
    const rk = clamp((t - rejectAt) / 0.85);
    if (rk < 1) {
      const ry = cards[1].y + cardH / 2;
      ctx.save(); ctx.globalAlpha = (1 - rk) * 0.40;
      ctx.strokeStyle = C.her; ctx.lineWidth = 2 * U;
      ctx.beginPath(); ctx.arc(poolX + cardW * 0.5, ry, 12 * U + rk * 76 * U, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      bloom(ctx, poolX + cardW * 0.5, ry, 100 * U * (1 - rk * 0.4), C.her, 0.12 * (1 - rk));
    }
  }

  // ── the boundary, stated as a rule, not a slogan ──
  const footK = clamp((t - rejectAt + 0.15) / 0.45);
  if (footK > 0) {
    ctx.save(); ctx.globalAlpha = footK * 0.92;
    const fy = wy + winH - 26 * U;
    ctx.fillStyle = C.line; ctx.fillRect(wx + gutW + 1, fy - 26 * U, winW - gutW - 1, 1);
    mono(ctx, 13 * U); ctx.fillStyle = C.ghost; ctx.textAlign = 'left';
    const segs = [
      ['候选正文', C.faint], [' 不进提示词', C.ghost], ['   ·   ', C.ghost],
      ['approve', C.ok], [' → 注入', C.ghost], ['   ·   ', C.ghost],
      ['reject', C.her], [' → 只记账，不注入', C.ghost],
    ];
    let fx = poolX;
    for (const [s, c] of segs) { ctx.fillStyle = c; ctx.fillText(s, fx, fy); fx += textW(ctx, s, 13 * U); }
    ctx.restore();
  }

  ctx.restore(); // body clip
  ctx.restore(); // camera
}
