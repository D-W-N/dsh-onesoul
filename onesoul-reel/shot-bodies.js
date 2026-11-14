// shot-bodies.js — 第 7 镜 · 一个灵魂，多个身体
// Four panes: QQ / B站 / 控制台 / 小爱. Each lights the SAME amber dot in its corner, one per
// beat — the rhythm is the argument. Then the four panes converge into one panel with four
// channel rows still live inside it: one brain, four mouths.
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, roundRect } from './theme.js';
import { at, shot } from './timeline.js';
import { clamp, lerp, ease, snap, glide, spring, springTo, seg } from './motion.js';
import { herDot, textW, clip, drawCursor, cursorOn } from './ui.js';

const S = shot('bodies');

const DOT_AT = [at('bodies', 2.05), at('bodies', 2.38), at('bodies', 2.71), at('bodies', 3.04)];
const CONV_T0 = at('bodies', 3.80), CONV_T1 = at('bodies', 4.75);
const MERGE_AT = at('bodies', 4.55);

const PANES = [
  { id: 'qq', tag: 'QQ', title: '主人号', lines: [
      ['主人', '今天几点下班'],
      ['阿音', '六点四十到站，外套提醒放这儿了'],
      ['主人', '记得给我留一盏灯'],
      ['阿音', '客厅那盏，给你留着'],
    ] },
  { id: 'bili', tag: 'B站', title: '值班报告', lines: [
      ['2026-11-14 第 2 轮（00:44）', ''],
      ['### BV1xx411c7mD', ''],
      ['**为什么值得**', '本地模型链'],
      ['**播放**', '12.4 万'],
    ] },
  { id: 'console', tag: '控制台', title: '控制中心', lines: [
      ['主人', '把阳台那把椅子写进记忆'],
      ['阿音', '已记进候选池，等你点头'],
      ['主人', 'approve'],
      ['阿音', '已生效 · 进永久记忆'],
    ] },
  { id: 'xiaoai', tag: '小爱', title: '语音', lines: [
      ['主人', '阿音，明天几点出门'],
      ['判定', '点名 · 答不上'],
      ['阿音', '我在。十一点前出门就行'],
      ['', ''],
    ] },
];

export function drawBodies(ctx, W, H, t) {
  const U = Math.min(W, H) / 1080;
  const conv = ease.inOutCubic(clamp((t - CONV_T0) / (CONV_T1 - CONV_T0)));

  const gapX = 26 * U, gapY = 26 * U;
  const gridW = W * 0.815, gridH = H * 0.615;
  const gridX = (W - gridW) / 2, gridY = (H - gridH) / 2 - 30 * U;
  const pw = (gridW - gapX) / 2, ph = (gridH - gapY) / 2;

  const mergedX = W * 0.5 - W * 0.245, mergedY = H * 0.5 - H * 0.175;
  const mergedW = W * 0.49, mergedH = H * 0.35;

  PANES.forEach((pane, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x0 = gridX + col * (pw + gapX), y0 = gridY + row * (ph + gapY);

    const inK = spring(t - at('bodies', -0.30 + i * 0.26), { freq: 2.6, damp: 0.86 });
    const fromX = (col === 0 ? -1 : 1) * 66 * U, fromY = (row === 0 ? -1 : 1) * 44 * U;

    const x = lerp(x0 + fromX * (1 - inK), mergedX, conv);
    const y = lerp(y0 + fromY * (1 - inK), mergedY, conv);
    const w = lerp(pw, mergedW, conv), h = lerp(ph, mergedH, conv);
    const alpha = clamp(inK) * (1 - clamp((conv - 0.5) / 0.5) * 0.90);

    if (alpha <= 0.004) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    fillRR(ctx, x, y, w, h, 13 * U, '#0f1317');
    strokeRR(ctx, x, y, w, h, 13 * U, withA('#ffffff', 0.10), 1);
    const hh = 40 * U;
    ctx.save(); roundRect(ctx, x, y, w, h, 13 * U); ctx.clip();
    ctx.fillStyle = '#1a1f26'; ctx.fillRect(x, y, w, hh);
    ctx.fillStyle = C.line; ctx.fillRect(x, y + hh, w, 1);
    ctx.restore();

    if (conv < 0.62) {
      const ca = 1 - clamp((conv - 0.1) / 0.5);
      ctx.save(); ctx.globalAlpha = alpha * ca;
      mono(ctx, 15 * U, 500); ctx.fillStyle = C.text; ctx.textAlign = 'left';
      ctx.fillText(pane.tag, x + 20 * U, y + 26 * U);
      const tagW = textW(ctx, pane.tag, 15 * U);
      mono(ctx, 13.5 * U); ctx.fillStyle = C.faint;
      ctx.fillText(clip(ctx, pane.title, 13.5 * U, w - tagW - 100 * U), x + 20 * U + tagW + 12 * U, y + 26 * U);

      // the same amber dot in every corner
      const dk = clamp((t - DOT_AT[i]) / 0.22);
      if (dk > 0) {
        herDot(ctx, x + w - 26 * U, y + 20 * U, 4.4 * U * (0.6 + 0.4 * dk), dk, 1.2);
        const rk = clamp((t - DOT_AT[i]) / 0.62);
        if (rk < 1) {
          ctx.save(); ctx.globalAlpha = (1 - rk) * 0.6;
          ctx.strokeStyle = C.her; ctx.lineWidth = 2 * U;
          ctx.beginPath(); ctx.arc(x + w - 26 * U, y + 20 * U, 5 * U + rk * 36 * U, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      }

      const lx = x + 20 * U, lyTop = y + hh + 34 * U, rowH = 31 * U;
      const isChat = pane.id !== 'bili';
      pane.lines.forEach((ln, k) => {
        const a = at('bodies', 0.30) + k * 0.12 + i * 0.04;
        const kk = clamp((t - a) / 0.24);
        if (kk <= 0) return;
        const yy = lyTop + k * rowH;
        if (yy > y + h - 14 * U) return;
        ctx.globalAlpha = alpha * ca * kk;
        if (isChat) {
          const isHer = ln[0] === '阿音';
          const isSys = pane.id === 'xiaoai' && ln[0] === '判定';
          mono(ctx, 12.5 * U, 500);
          if (!isSys) { ctx.fillStyle = isHer ? C.her : C.faint; ctx.fillText(ln[0], lx, yy); }
          else { ctx.fillStyle = C.err; ctx.fillText('✗', lx, yy); }
          cjk(ctx, 16 * U);
          ctx.fillStyle = isSys ? C.her : isHer ? C.textHi : C.text;
          const ox = isSys ? 26 * U : 52 * U;
          ctx.fillText(clip(ctx, ln[1], 16 * U, w - ox - 34 * U), lx + ox, yy);
        } else {
          mono(ctx, 14 * U);
          ctx.fillStyle = ln[0].startsWith('###') ? C.fn : ln[0].startsWith('**') ? C.dim : C.text;
          ctx.fillText(clip(ctx, ln[0], 14 * U, w - 40 * U), lx, yy);
          if (ln[1]) { ctx.fillStyle = C.faint; ctx.fillText(ln[1], lx + 132 * U, yy); }
        }
        ctx.globalAlpha = alpha * ca;
      });
      ctx.restore();
    }
    ctx.restore();
  });

  // ── the merged panel: four channels, one brain ──
  const mk = clamp((t - MERGE_AT) / 0.45);
  if (mk > 0) {
    ctx.save();
    ctx.globalAlpha = mk;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.60)'; ctx.shadowBlur = 50 * U; ctx.shadowOffsetY = 14 * U;
    fillRR(ctx, mergedX, mergedY, mergedW, mergedH, 14 * U, '#131a20');
    ctx.restore();
    strokeRR(ctx, mergedX, mergedY, mergedW, mergedH, 14 * U, withA(C.her, 0.22), 1.4 * U);

    // header line: same four channels, now inside one frame
    const innerX = mergedX + 30 * U;
    const colW = (mergedW - 60 * U) / 4;
    mono(ctx, 13 * U, 500); ctx.fillStyle = C.ghost; ctx.textAlign = 'left';
    ctx.fillText('一个灵魂 · 四个通道', innerX, mergedY + 34 * U);
    // her dot in the panel's own corner — the same mark as the four panes, now singular
    const hk0 = clamp((t - MERGE_AT - 0.45) / 0.3);
    if (hk0 > 0) herDot(ctx, mergedX + mergedW - 30 * U, mergedY + 28 * U, 4.4 * U * hk0, hk0, 1.3);

    ['QQ', 'B站', '控制台', '小爱'].forEach((L, i) => {
      const lx = innerX + i * colW;
      const kk = clamp((t - MERGE_AT - 0.12 - i * 0.06) / 0.28);
      ctx.save(); ctx.globalAlpha = mk * kk;
      herDot(ctx, lx + 6 * U, mergedY + 92 * U, 4 * U, 1, 1.0);
      mono(ctx, 16 * U, 500); ctx.fillStyle = C.textHi;
      ctx.fillText(L, lx + 20 * U, mergedY + 98 * U);
      // a live feed line under each, so the panels still feel inhabited
      const feeds = [
        '今天几点下班',
        '第 2 轮 · 3 条',
        'approve',
        '明天几点出门',
      ];
      cjk(ctx, 13.5 * U); ctx.fillStyle = C.dim;
      ctx.fillText(clip(ctx, feeds[i], 13.5 * U, colW - 26 * U), lx + 6 * U, mergedY + 134 * U);
      mono(ctx, 11.5 * U); ctx.fillStyle = C.ghost;
      ctx.fillText('ON-LINE', lx + 6 * U, mergedY + 160 * U);
      ctx.fillStyle = withA('#ffffff', 0.08);
      ctx.fillRect(lx, mergedY + 116 * U, colW - 22 * U, 1);
      ctx.restore();
    });

    // the single line that states the theme
    cjk(ctx, 27 * U, 500); ctx.fillStyle = C.textHi; ctx.textAlign = 'center';
    ctx.fillText('同一人格 · 同一记忆', mergedX + mergedW / 2, mergedY + mergedH - 44 * U);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}