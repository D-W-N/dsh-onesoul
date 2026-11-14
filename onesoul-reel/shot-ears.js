// shot-ears.js — 第 5 镜 · 耳朵（惊喜点，慢 20%）
// Log lines scroll. The amber line lands, her turn opens, then a hard cut:
// top = the speaker's own assistant going silent; bottom = her reply lighting up.
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, roundRect } from './theme.js';
import { at, shot } from './timeline.js';
import { clamp, lerp, ease, snap, glide, spring, springTo, seg } from './motion.js';
import { herDot, textW, sectionLabel, drawCursor, cursorOn, chip } from './ui.js';

const S = shot('ears');

// Real format strings: index.js:1326 (log line), 1217 (turn id), 1303 (trigger).
const LOG = [
  { s: 'dsh-anima: 小爱 语音助手 收到提问 · 唤醒词=阿音', t: at('ears', 0.10), c: C.dim },
  { s: 'dsh-anima: 取 带最近 90 秒内的新消息', t: at('ears', 0.62), c: C.faint },
  { s: 'dsh-anima: 问答判定 …', t: at('ears', 1.14), c: C.dim },
  { s: 'dsh-anima: 耳朵收到 1 条；reply=true；判定=答不上', t: at('ears', 2.40), c: C.her },
  { s: 'dsh-anima: 开回合 anima-ears-m3x8k1（同一会话内复用）', t: at('ears', 3.40), c: C.dim },
  { s: 'dsh-anima: 注入 人格 + 记忆 128 条 + 此刻状态', t: at('ears', 3.95), c: C.dim },
  { s: 'dsh-anima: 回复已发送 · 通道=小爱', t: at('ears', 4.70), c: C.ok },
];

export function drawEars(ctx, W, H, t) {
  const U = Math.min(W, H) / 1080;
  const px = 28 * U;
  const cutAt = at('ears', 5.20);

  // 切点前的「抽取」时长：日志退场与分屏进场共享这 0.7 s
  const HAND = 0.70;
  const handK = clamp((t - (cutAt - HAND)) / HAND);       // 0 → 1，1 时正好是切点

  if (t < cutAt) {
    // ══ A. the runtime log ══
    const zA = springTo(t, [[at('ears', 0), 1.0], [at('ears', 2.25), 1.0], [at('ears', 2.9), 1.05], [cutAt, 1.045]],
      { freq: 1.9, damp: 0.88 });
    const winW = W * 0.82, winH = H * 0.445;
    const wx = (W - winW) / 2, wy = (H - winH) / 2 - 30 * U;
    ctx.save();
    // 让位：整块日志在 HAND 窗口里向上退、缩小一点、压暗 —— 给分屏腾出舞台
    const handEase = ease.inCubic(handK);
    const hz = zA * (1 - 0.055 * handEase);
    ctx.globalAlpha = 1 - 0.55 * handEase;
    ctx.translate(W / 2, H * 0.5 - 26 * U * handEase);
    ctx.scale(hz, hz); ctx.translate(-W / 2, -H * 0.5);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.64)'; ctx.shadowBlur = 56 * U; ctx.shadowOffsetY = 17 * U;
    fillRR(ctx, wx, wy, winW, winH, 14 * U, '#0e1216');
    ctx.restore();
    strokeRR(ctx, wx, wy, winW, winH, 14 * U, C.lineHi, 1);

    fillRR(ctx, wx, wy, winW, 42 * U, 14 * U, C.panel);
    ctx.save(); ctx.beginPath(); ctx.rect(wx, wy, winW, 42 * U); ctx.clip();
    ctx.fillStyle = C.panel; ctx.fillRect(wx, wy, winW, 42 * U); ctx.restore();
    ctx.fillStyle = C.line; ctx.fillRect(wx, wy + 42 * U, winW, 1);
    [0, 1, 2].forEach(i => { ctx.beginPath(); ctx.arc(wx + 24 * U + i * 19 * U, wy + 21 * U, 5.4 * U, 0, Math.PI * 2); ctx.fillStyle = '#3c434d'; ctx.fill(); });
    mono(ctx, 16 * U); ctx.fillStyle = C.faint; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('dsh — runtime log', wx + 90 * U, wy + 26 * U);
    if (cursorOn(t)) herDot(ctx, wx + winW - 40 * U, wy + 21 * U, 3.4 * U, 1, 1);
    mono(ctx, 12.5 * U); ctx.fillStyle = C.ghost; ctx.textAlign = 'right';
    ctx.fillText('tail -f', wx + winW - 62 * U, wy + 26 * U);
    ctx.textAlign = 'left';

    // rows: a real `tail -f` — new lines grow UP from the bottom of the pane, never from the top
    const rowH = px * 1.98;
    const x0 = wx + 34 * U;
    const bottomY = wy + winH - 58 * U;
    ctx.save(); ctx.beginPath(); ctx.rect(wx + 1, wy + 43 * U, winW - 2, winH - 44 * U); ctx.clip();
    LOG.forEach((r, i) => {
      if (t < r.t) return;
      const y = bottomY - (LOG.length - 1 - i) * rowH;
      const age = t - r.t;
      const isLast = i === LOG.length - 1;
      const shown = isLast && age < 1.0 ? Math.min([...r.s].length, Math.floor(age * 95)) : [...r.s].length;
      ctx.globalAlpha = clamp(age / 0.15);
      mono(ctx, px, r.c === C.her ? 500 : 400);
      ctx.fillStyle = r.c;
      ctx.fillText(r.s.slice(0, shown), x0, y);
      if (r.c === C.her) {
        const fullW = textW(ctx, r.s, px);
        bloom(ctx, x0 + fullW * 0.46, y - px * 0.30, fullW * 0.60, C.her, 0.14);
      }
      if (isLast && shown < [...r.s].length) drawCursor(ctx, x0 + textW(ctx, r.s.slice(0, shown), px) + 2 * U, y, px, 1, { color: C.her });
      ctx.globalAlpha = 1;
    });
    ctx.restore();

    // status strip: the actual trigger condition
    ctx.fillStyle = C.line; ctx.fillRect(wx, wy + winH - 42 * U, winW, 1);
    mono(ctx, 12.5 * U); ctx.fillStyle = C.faint;
    ctx.fillText('ears.reply=true · isFresh(<90s) · (byName || stuck)', x0, wy + winH - 16 * U);
    if (t >= at('ears', 3.40)) chip(ctx, wx + winW - 128 * U, wy + winH - 23 * U, 'anima-ears', { px: 11 * U, fg: C.her, bg: withA(C.her, 0.12), dot: true });

    ctx.restore();

  } else {
    // ══ B. hard cut: before / after ══
    const k = clamp((t - cutAt) / 0.20);
    const splitY = H * 0.5;

    // ── top: 小爱原生 · 答不上 ──
    ctx.fillStyle = '#090c0f'; ctx.fillRect(0, 0, W, splitY - 2);
    const cxs = W * 0.5;

    // the speaker's own screen, seen close: a big listening state that resolves into nothing
    const scrW = W * 0.265, scrH = H * 0.345;
    const scrX = cxs - scrW / 2, scrY = splitY * 0.115;
    fillRR(ctx, scrX, scrY, scrW, scrH, 20 * U, '#12171c');
    strokeRR(ctx, scrX, scrY, scrW, scrH, 20 * U, withA('#ffffff', 0.11), 1.5 * U);

    const scx = cxs, scy = scrY + scrH * 0.40;
    // three rings, still and cool — a listening state with no answer behind it
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.6 * U;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(scx, scy, (44 + i * 30) * U, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); ctx.arc(scx, scy, 15 * U, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill();

    mono(ctx, 12 * U, 500); ctx.fillStyle = C.faint; ctx.textAlign = 'center';
    ctx.fillText('NO-REPLY', scx, scrY + 30 * U);
    mono(ctx, 16 * U, 500); ctx.fillStyle = C.dim;
    ctx.fillText('小爱 · 原生助手', scx, scrY + scrH - 78 * U);
    mono(ctx, 14 * U); ctx.fillStyle = C.ghost;
    ctx.fillText('·  ·  ·', scx, scrY + scrH - 52 * U);
    // the answer that never comes, in the same cold grey — empty, not angry
    cjk(ctx, 32 * U, 500); ctx.fillStyle = C.warn;
    ctx.fillText('答不上来', scx, scrY + scrH - 14 * U);

    // dim the top so the comparison is physical
    const dimK = clamp((t - at('ears', 5.75)) / 0.5);
    if (dimK > 0) { ctx.fillStyle = `rgba(6,8,10,${0.34 * dimK})`; ctx.fillRect(0, 0, W, splitY - 2); }

    // ── seam ──
    const seamK = clamp((t - cutAt) / 0.3);
    ctx.fillStyle = withA(C.her, 0.34 * seamK); ctx.fillRect(0, splitY - 1.5 * U, W, 1.5 * U);

    // ── bottom: her reply ──
    ctx.save();
    ctx.beginPath(); ctx.rect(0, splitY, W, H - splitY); ctx.clip();
    const bg2 = ctx.createLinearGradient(0, splitY, 0, H);
    bg2.addColorStop(0, '#121a21'); bg2.addColorStop(1, '#0a0e12');
    ctx.fillStyle = bg2; ctx.fillRect(0, splitY, W, H - splitY);

    const bx = W * 0.145, by = splitY + 74 * U;
    herDot(ctx, bx, by - 5 * U, 5.4 * U, clamp((t - cutAt) / 0.3), 1.2);
    mono(ctx, 14 * U, 500); ctx.fillStyle = C.her; ctx.textAlign = 'left';
    ctx.fillText('anima-ears-m3x8k1', bx + 24 * U, by);
    mono(ctx, 12.5 * U); ctx.fillStyle = C.faint;
    ctx.fillText('回合 · 人格 + 记忆 + 此刻状态', bx + 24 * U + 210 * U, by);

    const REPLY = '我在。刚才那句我听见了——明天十一点前出门就行，外面五点起风。';
    const rAt = at('ears', 5.75);
    if (t >= rAt) {
      const rk = clamp((t - rAt) / 1.05);
      const n = [...REPLY].length;
      const shownN = Math.floor(n * clamp(rk * 1.3));
      const bwX = bx, bwY = by + 34 * U, bwW = W * 0.72, bwH = 96 * U;
      fillRR(ctx, bwX, bwY, bwW, bwH, 14 * U, '#1d242c');
      strokeRR(ctx, bwX, bwY, bwW, bwH, 14 * U, withA(C.her, 0.24), 1.2 * U);
      ctx.fillStyle = withA(C.her, 0.9);
      ctx.fillRect(bwX, bwY + 14 * U, 3 * U, bwH - 28 * U);
      const cut = [...REPLY].slice(0, shownN).join('');
      cjk(ctx, 30 * U); ctx.fillStyle = C.textHi; ctx.textAlign = 'left';
      ctx.fillText(cut, bwX + 28 * U, bwY + 58 * U);
      if (shownN < n && cursorOn(t)) {
        drawCursor(ctx, bwX + 28 * U + ctx.measureText(cut).width + 3 * U, bwY + 58 * U, 30 * U, 1, { color: C.her });
      }
      mono(ctx, 12.5 * U); ctx.fillStyle = C.faint;
      ctx.fillText('通道 小爱 · 记忆 128 条 · 人格 anima · 延迟 1.8s', bwX, bwY + bwH + 26 * U);
    }
    ctx.restore();
    ctx.textAlign = 'left';

    // split labels
    ctx.save(); ctx.globalAlpha = k;
    mono(ctx, 13 * U, 500); ctx.fillStyle = C.dim; ctx.textAlign = 'left';
    ctx.fillText('BEFORE — 小爱原生', W * 0.045, H * 0.062);
    ctx.fillStyle = C.her;
    ctx.fillText('AFTER — dsh-onesoul 接住', W * 0.045, splitY + 34 * U);
    ctx.restore();
  }
}