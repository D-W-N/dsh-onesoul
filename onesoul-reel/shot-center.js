// shot-center.js — 第 2 镜 · 控制中心
// The sidebar tab lights up, the dashboard assembles, then three quick pushes into three cards:
// 房间/心情 → 服务在线 → 最近的对话. Copy is the real string set from the dashboard source.
//
// SCALE NOTE: this mock is drawn at ~1.35× the type size a real dashboard would use, because a
// 1080p frame is viewed on a phone. Anything below 16U is unreadable there, so the dense rows
// (9 services, 4 conversations) are sized at 16–17U and the three push-ins carry the rest.
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, roundRect } from './theme.js';
import { at, shot } from './timeline.js';
import { clamp, lerp, ease, snap, glide, spring, springTo, seg } from './motion.js';
import { glassCard, herDot, sectionLabel, textW, clip } from './ui.js';

const S = shot('center');

// real strings: client.js:1854-1858 / 1598-1702 (docs/video-facts.md §4)
const NAV = ['总览', '对话', '记忆', 'QQ', 'B站', '表情包', '模型'];
const ROOMS = ['客厅', '书房', '阳台', '餐厅', '厨房', '次卧', '玄关'];
const SERVICES = ['QQ 桥接', 'QQ 客户端', '人格 anima', '耳朵 · 小爱', 'B站', '表情包', '侧面栏', '对话记录', '模型链路'];
const RECENT = [
  { ch: 'QQ', s: '今天降温了，记得穿外套' },
  { ch: '小爱', s: '阿音，明天几点出门' },
  { ch: 'B站', s: '第 2 轮（00:44）· 3 条' },
  { ch: '控制中心', s: '把阳台那把椅子写进记忆' },
];

export function drawCenter(ctx, W, H, t) {
  const U = Math.min(W, H) / 1080;
  // The dashboard is sized to clear the caption scrim even at the deepest push-in: the caption
  // band starts around y = 0.77 H, and a 1.2× push on a top card would drag the bottom row to
  // y ≈ 0.74 H. Keep the frame below 0.72 H so no card can ever slide under the capsule.
  const appX = W * 0.030, appY = H * 0.098, appW = W * 0.940, appH = H * 0.612;

  // ── layout first, so the camera can target real card centres instead of guessed ratios ──
  const sbW = appW * 0.190;
  const px0 = appX + sbW + 40 * U;
  const pw = appW - sbW - 80 * U;
  const navY = appY + 46 * U;
  const bodyY = navY + 46 * U;
  const rowH = appH * 0.355;
  const c1 = { x: px0, y: bodyY + 14 * U, w: pw * 0.385, h: rowH };
  const c2 = { x: px0 + pw * 0.415, y: bodyY + 14 * U, w: pw * 0.585, h: rowH };
  const c3 = { x: px0, y: bodyY + 14 * U + rowH + 34 * U, w: pw * 0.385, h: rowH };
  const c4 = { x: c2.x, y: c3.y, w: c2.w, h: rowH };
  const mid = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  // ── camera: establish → card1 → card2 → card3 → pull back ──
  // Two rules keep the pushes from looking like a bug:
  //   · horizontally, clamp the target so the app frame still covers the whole viewport —
  //     leaning onto a left card must not leave a dead strip of background at the edge;
  //   · vertically, keep the frame centre: centring on a top card drags the lower row into
  //     the caption band.
  const m1 = mid(c1), m2 = mid(c2), m3 = mid(c3), m4 = mid(c4);
  const cyFrame = appY + appH * 0.42;
  const edgeX = (z, halfW) => halfW / z;   // viewport half-width in world units at zoom z
  const clampCx = (want, z) => {
    const halfW = W / (2 * z);
    return clamp(want, appX + halfW, appX + appW - halfW);
  };
  const stops = [
    { t: at('center', 0.00), z: 1.00, cx: W * 0.5, cy: H * 0.5 },
    { t: at('center', 1.30), z: 1.00, cx: W * 0.5, cy: H * 0.5 },
    { t: at('center', 2.55), z: 1.19, cx: clampCx(m1.x, 1.19), cy: cyFrame },
    { t: at('center', 4.25), z: 1.15, cx: clampCx(m2.x, 1.15), cy: cyFrame },
    { t: at('center', 5.70), z: 1.16, cx: clampCx(m4.x, 1.16), cy: cyFrame },
    { t: at('center', 6.40), z: 1.02, cx: W * 0.5, cy: H * 0.5 },
  ];
  const zoom = springTo(t, stops.map(s => [s.t, s.z]), { freq: 2.0, damp: 0.90 });
  const cx = springTo(t, stops.map(s => [s.t, s.cx]), { freq: 2.0, damp: 0.90 });
  const cy = springTo(t, stops.map(s => [s.t, s.cy]), { freq: 2.0, damp: 0.90 });

  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-cx, -cy);

  // ── frame ──
  ctx.save(); ctx.globalAlpha = clamp(spring(t - at('center', 0.05), { freq: 2.6, damp: 0.9 }));
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.66)'; ctx.shadowBlur = 60 * U; ctx.shadowOffsetY = 19 * U;
  fillRR(ctx, appX, appY, appW, appH, 16 * U, '#0f1317');
  ctx.restore();
  strokeRR(ctx, appX, appY, appW, appH, 16 * U, C.lineHi, 1);

  // ── sidebar ──
  ctx.save(); roundRect(ctx, appX, appY, appW, appH, 16 * U); ctx.clip();
  ctx.fillStyle = '#0b0e12'; ctx.fillRect(appX, appY, sbW, appH);
  ctx.fillStyle = C.line; ctx.fillRect(appX + sbW, appY, 1, appH);

  sectionLabel(ctx, 'OPTIONS', appX + 28 * U, appY + 40 * U, { px: 13 * U, color: C.faint, ls: 2.8 });

  // the one tab this bundle registers: 「控制中心」 (client.js:1906)
  const tabY = appY + 70 * U, tabH = 54 * U;
  const tabAt = at('center', 0.45);
  const plateK = t >= tabAt ? spring(t - tabAt, { freq: 3.2, damp: 0.70 }) : 0;
  if (plateK > 0) {
    fillRR(ctx, appX + 14 * U, tabY, (sbW - 28 * U) * clamp(plateK), tabH, 10 * U, '#252c35');
    ctx.fillStyle = C.her;
    ctx.fillRect(appX + 14 * U, tabY + 9 * U, 3 * U, (tabH - 18 * U) * clamp(plateK));
  }
  cjk(ctx, 23 * U, 500);
  ctx.fillStyle = t >= tabAt ? C.textHi : C.dim;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText('控制中心', appX + 36 * U, tabY + tabH * 0.63);

  ['设置', '扩展', '日志'].forEach((s, i) => {
    cjk(ctx, 21 * U); ctx.fillStyle = C.ghost;
    ctx.fillText(s, appX + 36 * U, tabY + tabH + 48 * U + i * 40 * U);
  });
  ctx.restore();

  // ── nav chips ──
  let ncx = px0;
  NAV.forEach((n, i) => {
    const k = clamp((t - at('center', 0.22) - i * 0.028) / 0.24);
    cjk(ctx, 19 * U, i === 0 ? 500 : 400);
    const tw = ctx.measureText(n).width, cw = tw + 30 * U, chh = 36 * U;
    if (k > 0) {
      ctx.save(); ctx.globalAlpha = k;
      if (i === 0) fillRR(ctx, ncx, navY - chh * 0.72, cw, chh, 8 * U, '#2a3139');
      ctx.fillStyle = i === 0 ? C.textHi : C.faint;
      ctx.fillText(n, ncx + 15 * U, navY);
      ctx.restore();
    }
    ncx += cw + 10 * U;
  });

  // ══ HOME / LIVE ══
  sectionLabel(ctx, 'HOME / LIVE', px0, bodyY, { px: 13 * U, color: C.faint, ls: 2.6 });
  const k1 = clamp((t - at('center', 0.45)) / 0.34);
  glassCard(ctx, c1.x, c1.y, c1.w, c1.h, { k: k1 });
  if (k1 > 0) {
    ctx.save(); ctx.globalAlpha = k1;
    cjk(ctx, 17 * U); ctx.fillStyle = C.dim; ctx.fillText('此刻在', c1.x + 26 * U, c1.y + 38 * U);
    cjk(ctx, 46 * U, 500); ctx.fillStyle = C.textHi;
    ctx.fillText('客厅', c1.x + 26 * U, c1.y + 88 * U);
    ctx.fillStyle = C.her; ctx.fillRect(c1.x + 26 * U, c1.y + 100 * U, 28 * U, 2.5 * U);

    mono(ctx, 15 * U, 500); ctx.fillStyle = C.faint;
    ctx.fillText('心情', c1.x + 26 * U, c1.y + 134 * U);
    cjk(ctx, 19 * U); ctx.fillStyle = C.text;
    ctx.fillText('安静 · 想被找', c1.x + 78 * U, c1.y + 134 * U);
    mono(ctx, 15 * U, 500); ctx.fillStyle = C.faint;
    ctx.fillText('活动', c1.x + 26 * U, c1.y + 164 * U);
    cjk(ctx, 19 * U); ctx.fillStyle = C.text;
    ctx.fillText('在看书', c1.x + 78 * U, c1.y + 164 * U);

    // the 7 real rooms — the current one is marked in amber, the rest stay cool
    const gy = c1.y + c1.h - 26 * U, cell = (c1.w - 52 * U) / 7;
    ROOMS.forEach((r, i) => {
      const rx = c1.x + 26 * U + i * cell;
      cjk(ctx, 14 * U);
      ctx.fillStyle = r === '客厅' ? C.textHi : C.ghost;
      ctx.fillText(r, rx, gy);
      if (r === '客厅') { ctx.fillStyle = C.her; ctx.fillRect(rx, gy + 7 * U, 20 * U, 2 * U); }
    });
    ctx.restore();
  }

  // ══ SYSTEM ══
  sectionLabel(ctx, 'SYSTEM', c2.x, bodyY, { px: 13 * U, color: C.faint, ls: 2.6 });
  mono(ctx, 13 * U); ctx.fillStyle = C.ghost; ctx.textAlign = 'right';
  ctx.fillText('点一行进对应页', c2.x + c2.w, bodyY);
  ctx.textAlign = 'left';
  const k2 = clamp((t - at('center', 0.60)) / 0.34);
  glassCard(ctx, c2.x, c2.y, c2.w, c2.h, { k: k2 });
  if (k2 > 0) {
    ctx.save(); ctx.globalAlpha = k2;
    SERVICES.forEach((name, i) => {
      const col = i % 3, row = (i / 3) | 0;
      const sx = c2.x + 26 * U + col * (c2.w - 52 * U) / 3;
      const sy = c2.y + 46 * U + row * 34 * U;
      const kk = clamp((t - at('center', 0.75) - i * 0.022) / 0.20);
      if (kk <= 0) return;
      ctx.save(); ctx.globalAlpha = k2 * kk;
      ctx.beginPath(); ctx.arc(sx + 5 * U, sy - 5 * U, 4 * U, 0, Math.PI * 2);
      ctx.fillStyle = C.ok; ctx.fill();
      cjk(ctx, 16 * U); ctx.fillStyle = C.text;
      ctx.fillText(name, sx + 18 * U, sy);
      ctx.restore();
    });
    mono(ctx, 13 * U); ctx.fillStyle = C.ghost;
    ctx.fillText('ON-LINE  9 / 9', c2.x + 26 * U, c2.y + c2.h - 22 * U);
    ctx.restore();
  }

  // ══ MEMORY ══
  sectionLabel(ctx, 'MEMORY', c3.x, c3.y - 16 * U, { px: 13 * U, color: C.faint, ls: 2.6 });
  const k3 = clamp((t - at('center', 0.75)) / 0.34);
  glassCard(ctx, c3.x, c3.y, c3.w, c3.h, { k: k3 });
  if (k3 > 0) {
    ctx.save(); ctx.globalAlpha = k3;
    [['候选', '3', C.her], ['已确认', '128', C.textHi], ['已撤销', '2', C.dim]].forEach(([label, v, col], i) => {
      const sx = c3.x + 26 * U + i * (c3.w - 52 * U) / 3;
      cjk(ctx, 15 * U); ctx.fillStyle = C.faint; ctx.fillText(label, sx, c3.y + 50 * U);
      mono(ctx, 38 * U, 500); ctx.fillStyle = col;
      ctx.fillText(v, sx, c3.y + 96 * U);
    });
    mono(ctx, 13 * U); ctx.fillStyle = C.ghost;
    ctx.fillText('账本哈希链 · 未被改动', c3.x + 26 * U, c3.y + c3.h - 22 * U);
    ctx.restore();
  }

  // ══ 最近的对话 ══
  const k4 = clamp((t - at('center', 0.90)) / 0.34);
  glassCard(ctx, c4.x, c4.y, c4.w, c4.h, { k: k4 });
  if (k4 > 0) {
    ctx.save(); ctx.globalAlpha = k4;
    cjk(ctx, 19 * U, 500); ctx.fillStyle = C.textHi;
    ctx.fillText('最近的对话', c4.x + 26 * U, c4.y + 40 * U);
    RECENT.forEach((r, i) => {
      const kk = clamp((t - at('center', 1.05) - i * 0.05) / 0.24);
      if (kk <= 0) return;
      const ry = c4.y + 82 * U + i * 34 * U;
      ctx.save(); ctx.globalAlpha = k4 * kk;
      mono(ctx, 13 * U, 500);
      const tagW = ctx.measureText(r.ch).width + 18 * U;
      fillRR(ctx, c4.x + 26 * U, ry - 17 * U, tagW, 24 * U, 5 * U, '#2b333c');
      ctx.fillStyle = C.dim; ctx.textAlign = 'left';
      ctx.fillText(r.ch, c4.x + 35 * U, ry);
      cjk(ctx, 16 * U); ctx.fillStyle = C.text;
      ctx.fillText(clip(ctx, r.s, 16 * U, c4.w - tagW - 80 * U), c4.x + 26 * U + tagW + 12 * U, ry);
      ctx.restore();
    });
    ctx.restore();
  }

  // her dot, top-right of the whole app
  const dotK = clamp((t - at('center', 1.30)) / 0.35);
  if (dotK > 0) herDot(ctx, appX + appW - 30 * U, appY + 30 * U, 4.2 * U, dotK, 1);

  ctx.restore(); // frame alpha
  ctx.restore(); // camera
}