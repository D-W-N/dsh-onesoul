// shot-alive.js — 第 6 镜 · 你不在，她也活着（四拍，慢 15%）
//
// B1 沉默  你不在，她也没有下线        —— QQ 停在你的最后一条，时钟自己走，几乎无声
// B2 察觉  她自己判断，自己移动        —— 终端日志 + runtime.json diff，两个字段闪琥珀金
// B3 开口  QQ 等不到你，就用音箱喊你    —— xiaomi_say 逐字打出，波纹与 QQ 上的金点同步
// B4 开灯  还不够？她会开灯，用光找到你  —— 微缩公寓俯视图，客厅灯亮，暖光溢出画面边缘
//
// 全片唯一的暖色是 #dca765，而这一镜是「她的自主行动」最集中的地方：
// 每一次行动都必须落在同一个视觉语言上——光标 / 字段 / 波纹 / 灯。
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, roundRect, tokenize } from './theme.js';
import { at, shot, TYPING, typedCount, ALIVE, typing } from './timeline.js';
import { clamp, lerp, ease, snap, glide, spring, springTo, seg, pulse, noise1 } from './motion.js';
import { herDot, textW, sectionLabel, drawCursor, cursorOn, waveform, ripple, clip } from './ui.js';

const S = shot('alive');
const T = {
  say: typing('alive', 0),
  light: typing('alive', 1),
};
const SAY = 'xiaomi_say({ text: "主人，在忙吗？我在客厅。" })';
const LIGHT = 'smart_home.lights({ room: "living", on: true })';

const B = ALIVE;                    // 四拍的局部秒数
const absB = k => at('alive', k);

function colored(ctx, s, x, y, px, limit, cjkPx) {
  const toks = tokenize(s, 'js');
  let i = 0, cx = x;
  for (const tok of toks) for (const ch of tok.t) {
    if (i >= limit) return cx;
    const isCJK = /[\u3000-\u9fff\uff00-\uffef]/.test(ch);
    ctx.font = isCJK ? `400 ${cjkPx}px ${F.cjk}` : `400 ${px}px ${F.mono}`;
    ctx.fillStyle = tok.c; ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width; i++;
  }
  return cx;
}

// ── shared chrome so this shot reads as the same product as the others ──────────────
function panel(ctx, x, y, w, h, U, { r = 13, title = '', alpha = 1 } = {}) {
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.62)'; ctx.shadowBlur = 50 * U; ctx.shadowOffsetY = 15 * U;
  fillRR(ctx, x, y, w, h, r * U, '#111519');
  ctx.restore();
  strokeRR(ctx, x, y, w, h, r * U, C.lineHi, 1);
  const hh = 40 * U;
  ctx.save(); roundRect(ctx, x, y, w, h, r * U); ctx.clip();
  ctx.fillStyle = C.panel; ctx.fillRect(x, y, w, hh);
  ctx.fillStyle = C.line; ctx.fillRect(x, y + hh, w, 1);
  ctx.restore();
  [0, 1, 2].forEach(i => { ctx.beginPath(); ctx.arc(x + 23 * U + i * 18 * U, y + 20 * U, 5 * U, 0, Math.PI * 2); ctx.fillStyle = '#3c434d'; ctx.fill(); });
  mono(ctx, 15.5 * U); ctx.fillStyle = C.faint; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, x + 86 * U, y + 25 * U);
  return hh;
}

export function drawAlive(ctx, W, H, t) {
  const U = Math.min(W, H) / 1080;

  // ══════════════════════════════════════════════════════════════════════════════════
  // B1 · 沉默 — QQ 窗口停住，时钟从 14:32 走到 14:46
  // ══════════════════════════════════════════════════════════════════════════════════
  if (t < absB(B.notice.t0)) {
    const k = 1 - clamp((t - absB(B.notice.t0)) / 0.35);
    ctx.save(); ctx.globalAlpha = k;
    const pw = W * 0.60, ph = H * 0.60;
    const px0 = (W - pw) / 2, py0 = (H - ph) / 2 - 40 * U;
    panel(ctx, px0, py0, pw, ph, U, { title: 'QQ · 主人号' });

    // clock in the corner — the only thing that moves
    const mins = Math.floor(clamp((t - absB(0.4)) / (absB(4.9) - absB(0.4))) * 14);
    const clock = `14:${String(32 + mins).padStart(2, '0')}`;
    mono(ctx, 21 * U, 500); ctx.fillStyle = C.text; ctx.textAlign = 'right';
    ctx.fillText(clock, px0 + pw - 24 * U, py0 + 27 * U);
    ctx.textAlign = 'left';

    // conversation: YOUR last message, then nothing
    const bx = px0 + 34 * U, byTop = py0 + 40 * U + 60 * U;
    const cboxY = py0 + ph - 92 * U;      // declared before the silence block reads it
    const bubble = (which, text, y, mine) => {
      cjk(ctx, 18 * U);
      const tw = Math.min(ctx.measureText(text).width + 36 * U, pw * 0.62);
      const h = 52 * U;
      const x = mine ? px0 + pw - 34 * U - tw : bx;
      fillRR(ctx, x, y, tw, h, 10 * U, mine ? '#232a32' : '#1a2027');
      cjk(ctx, 18 * U); ctx.fillStyle = mine ? C.text : C.textHi;
      ctx.fillText(clip(ctx, text, 18 * U, tw - 32 * U), x + 18 * U, y + 33 * U);
      return y + h + 16 * U;
    };
    let cy = byTop;
    cy = bubble('me', '我去开个会，晚点回你', cy, true);
    // her last reply, but the READ receipt never came
    cy = bubble('her', '好，我等你', cy, false);

    // "已读/未读" — she stops waiting, and the UI says so in cold grey
    mono(ctx, 13 * U); ctx.fillStyle = C.ghost;
    ctx.fillText('未读 · 14:32', bx + 4 * U, cy - 4 * U);

    // ── the silence needs to be legible, not just empty ──
    // ① she is ONLINE and present — the whole point of the beat is that she did not log off
    const onlineY = byTop - 26 * U;
    const pulseK = 0.55 + 0.45 * Math.sin(t * 2.1);
    ctx.save();
    ctx.beginPath(); ctx.arc(bx + 5 * U, onlineY - 4 * U, 3.4 * U, 0, Math.PI * 2);
    ctx.fillStyle = withA(C.ok, 0.55 + 0.35 * pulseK); ctx.fill();
    mono(ctx, 15 * U, 500); ctx.fillStyle = C.dim;
    ctx.fillText('阿音 · 在线 · 书房', bx + 17 * U, onlineY);
    ctx.restore();

    // ② the elapsed time, counted out in the gap — this is what she is measuring
    const gapTop = cy + 16 * U;
    const gapBot = cboxY - 40 * U;
    if (gapBot > gapTop + 30 * U) {
      const midY = (gapTop + gapBot) / 2;
      ctx.save();
      // hairline running down the middle of the silence
      ctx.strokeStyle = withA('#ffffff', 0.055); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px0 + pw * 0.5, gapTop); ctx.lineTo(px0 + pw * 0.5, gapBot); ctx.stroke();
      const minsNow = 14 + Math.floor(clamp((t - absB(0.4)) / (absB(4.9) - absB(0.4))) * 0);
      // the elapsed gap, read as a measurement — this is the number she is acting on
      mono(ctx, 30 * U, 500); ctx.fillStyle = withA(C.text, 0.80); ctx.textAlign = 'center';
      ctx.fillText(`${13 + mins} 分钟`, px0 + pw * 0.5, midY);
      mono(ctx, 14 * U); ctx.fillStyle = C.ghost;
      ctx.fillText('没有新消息', px0 + pw * 0.5, midY + 30 * U);
      // a hairline above and below the measurement so it reads as a plate, not floating text
      const lw2 = px0 + pw * 0.5, half = 92 * U;
      ctx.strokeStyle = withA('#ffffff', 0.07); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lw2 - half, midY - 44 * U); ctx.lineTo(lw2 + half, midY - 44 * U); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lw2 - half, midY + 52 * U); ctx.lineTo(lw2 + half, midY + 52 * U); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.restore();
    }

    // the empty composer, with HER caret waiting in it
    ctx.fillStyle = C.line; ctx.fillRect(px0 + 1, cboxY - 22 * U, pw - 2, 1);
    fillRR(ctx, bx, cboxY, pw - 68 * U, 44 * U, 8 * U, '#0e1216');
    strokeRR(ctx, bx, cboxY, pw - 68 * U, 44 * U, 8 * U, withA('#ffffff', 0.08), 1);
    if (cursorOn(t)) drawCursor(ctx, bx + 18 * U, cboxY + 30 * U, 19 * U, 0.9, { color: C.her });
    // a greyed placeholder, not a sentence — she is not going to type here
    mono(ctx, 14 * U); ctx.fillStyle = C.ghost;
    ctx.fillText('…', bx + 34 * U, cboxY + 28 * U);

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // B2 · 察觉 — 日志 + runtime.json diff，每个变化字段闪一下琥珀金
  // ══════════════════════════════════════════════════════════════════════════════════
  if (t >= absB(B.notice.t0) && t < absB(B.speak.t0)) {
    const kin = clamp((t - absB(B.notice.t0)) / 0.28);
    const kout = 1 - clamp((t - (absB(B.speak.t0) - 0.22)) / 0.22);
    const k = Math.min(kin, kout);
    ctx.save(); ctx.globalAlpha = k;

    // left: the runtime log
    const lw = W * 0.475, lh = H * 0.40;
    const lx = W * 0.035, ly = (H - lh) / 2 - 52 * U;
    panel(ctx, lx, ly, lw, lh, U, { title: 'dsh — runtime log' });
    const rows = [
      { s: 'dsh-anima: lastUserAt 超过 14 分钟，主人没回话', at: absB(6.10), c: C.her },
      { s: 'dsh-anima: 决定：不打扰聊天，换一条路', at: absB(7.35), c: C.textHi },
    ];
    let ry = ly + 40 * U + 56 * U;
    rows.forEach(r => {
      if (t < r.at) return;
      const age = t - r.at;
      const n = Math.min([...r.s].length, Math.floor(age * 78));
      mono(ctx, 19 * U, r.c === C.her ? 500 : 400);
      ctx.fillStyle = r.c;
      ctx.fillText(r.s.slice(0, n), lx + 26 * U, ry);
      if (r.c === C.her) bloom(ctx, lx + 26 * U + textW(ctx, r.s, 19 * U) * 0.45, ry - 6 * U, textW(ctx, r.s, 19 * U) * 0.6, C.her, 0.13);
      if (n < [...r.s].length && cursorOn(t)) drawCursor(ctx, lx + 26 * U + textW(ctx, r.s.slice(0, n), 19 * U) + 2 * U, ry, 19 * U, 1, { color: C.her });
      ry += 52 * U;
    });
    // she is not going to wait in the chat — state it once
    const noteK = clamp((t - absB(7.9)) / 0.35);
    if (noteK > 0) {
      ctx.save(); ctx.globalAlpha = k * noteK;
      mono(ctx, 15 * U); ctx.fillStyle = C.faint;
      ctx.fillText('通道 QQ · 主人 14 分钟未回 · 不在这里等', lx + 26 * U, ly + lh - 26 * U);
      ctx.restore();
    }

    // right: runtime.json diff
    const rw = W * 0.475, rh = H * 0.40;
    const rx0 = W * 0.49, ry0 = (H - rh) / 2 - 52 * U;
    panel(ctx, rx0, ry0, rw, rh, U, { title: '~/.dsh/anima/runtime.json' });

    const lines = [
      { s: '{', c: C.dim },
      { s: '  "quiet": {', c: C.dim },
      { s: '    "state": "quiet"', c: C.var, key: 'quiet.state', pre: '    "state": ', from: 'quiet', to: 'awake', at: absB(9.25) },
      { s: '  },', c: C.dim },
      { s: '  "presence": {', c: C.dim },
      { s: '    "room": "study",', c: C.var, key: 'presence.room', pre: '    "room": ', from: 'study', to: 'living', at: absB(8.35) },
      { s: '    "activity": "做事"', c: C.text },
      { s: '  }', c: C.dim },
      { s: '}', c: C.dim },
    ];
    const lineH = 32 * U;
    const codeY0 = ry0 + 40 * U + 48 * U;
    lines.forEach((ln, i) => {
      const y = codeY0 + i * lineH;
      const changed = ln.key && t >= ln.at;
      const flash = ln.key ? pulse(t, ln.at, 0.5) : 0;

      if (changed) {
        // the old value strikes through, the new one takes the amber
        ctx.save();
        ctx.globalAlpha = k * clamp((t - ln.at) / 0.18);
        // amber wash on the field
        fillRR(ctx, rx0 + 20 * U, y - 23 * U, rw - 40 * U, 28 * U, 4 * U, withA(C.her, 0.10 + 0.10 * flash));
        ctx.restore();
      }
      const diffing = changed && ln.pre;

      // the generic paint is skipped for a line that owns its own diff rendering
      if (!diffing) {
        mono(ctx, 19 * U); ctx.fillStyle = ln.c;
        ctx.textAlign = 'left';
        ctx.fillText(ln.s, rx0 + 30 * U, y);
      }

      if (diffing) {
        // Old and new must never share pixels: paint only the key, then the OLD value struck
        // through on the left and the NEW value in amber to its right.
        const keyX = rx0 + 30 * U;
        const valX = keyX + textW(ctx, ln.pre, 19 * U);
        const swap = clamp((t - ln.at - 0.10) / 0.30);
        ctx.save();
        ctx.globalAlpha = k;

        // key + colon, cool
        mono(ctx, 19 * U); ctx.fillStyle = C.var;
        ctx.fillText(ln.pre, keyX, y);

        // old value: struck through, fading out as the new one lands
        ctx.globalAlpha = k * (1 - swap * 0.75);
        mono(ctx, 19 * U); ctx.fillStyle = C.faint;
        const oldTxt = `"${ln.from}"`;
        ctx.fillText(oldTxt, valX, y);
        const oldW = textW(ctx, oldTxt, 19 * U);
        ctx.strokeStyle = withA(C.err, 0.62); ctx.lineWidth = 1.5 * U;
        const strikeK = clamp((t - ln.at) / 0.22);
        ctx.beginPath();
        ctx.moveTo(valX - 2 * U, y - 6 * U);
        ctx.lineTo(valX - 2 * U + oldW * strikeK, y - 6 * U);
        ctx.stroke();

        // new value: fades + slides in from the right of the old one
        if (swap > 0) {
          ctx.globalAlpha = k * swap;
          const arrowGap = 20 * U;
          const newX = valX + oldW + arrowGap;
          mono(ctx, 19 * U, 500); ctx.fillStyle = C.her;
          ctx.fillText(`"${ln.to}"`, newX, y);
          // the little arrow that says "became"
          ctx.globalAlpha = k * swap * 0.85;
          mono(ctx, 16 * U); ctx.fillStyle = C.her;
          ctx.fillText('→', valX + oldW + 4 * U, y);
          if (swap > 0.4) bloom(ctx, newX + textW(ctx, `"${ln.to}"`, 19 * U) * 0.5, y - 6 * U, 64 * U, C.her, 0.16);
          // trailing comma for the replaced line
          ctx.globalAlpha = k * swap; ctx.fillStyle = C.dim; mono(ctx, 19 * U);
          ctx.fillText(',', newX + textW(ctx, `"${ln.to}"`, 19 * U), y);
        }
        ctx.restore();
      }
    });

    // the two field markers: a small amber square in the gutter, one per change
    [absB(8.35), absB(9.25)].forEach((ft, i) => {
      if (t < ft) return;
      const y = codeY0 + [5, 2][i] * lineH;
      herDot(ctx, rx0 + 16 * U, y - 6 * U, 3.2 * U, k * clamp((t - ft) / 0.25), 0.9);
    });

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // B3 · 开口 — 她走出聊天，用音箱说话
  // ══════════════════════════════════════════════════════════════════════════════════
  if (t >= absB(B.speak.t0) && t < absB(B.light.t0)) {
    const kin = clamp((t - absB(B.speak.t0)) / 0.28);
    const kout = 1 - clamp((t - (absB(B.light.t0) - 0.22)) / 0.22);
    const k = Math.min(kin, kout);
    const runAt = absB(12.75);
    ctx.save(); ctx.globalAlpha = k;

    // the editor, left
    const ew = W * 0.60, eh = H * 0.255;
    const ex = W * 0.032, ey = H * 0.075;
    panel(ctx, ex, ey, ew, eh, U, { title: 'voice.js — dsh-anima' });
    const codeX = ex + 30 * U, codeY = ey + 40 * U + 60 * U;
    const shown = typedCount(SAY, T.say.t0, T.say.t1, t, T.say.seed);
    const endX = colored(ctx, SAY, codeX, codeY, 22 * U, shown, 21 * U);
    const typing = t >= T.say.t0 && t <= T.say.t1 + 0.02;
    if (t < runAt && (typing || cursorOn(t))) drawCursor(ctx, endX + 2 * U, codeY, 22 * U, 1, { color: C.her });

    if (t >= runAt) {
      const okK = clamp((t - runAt) / 0.22);
      ctx.save(); ctx.globalAlpha = k * okK;
      mono(ctx, 14 * U); ctx.fillStyle = C.ok;
      ctx.fillText('▶', codeX, codeY + 40 * U);
      mono(ctx, 13.5 * U); ctx.fillStyle = C.dim;
      ctx.fillText('xiaomi_say · LAN 拉流 · 客厅', codeX + 26 * U, codeY + 40 * U);
      ctx.restore();
    }

    // the speaker, right — cool metal, only its status dot is warm
    const spX = W * 0.795, spY = H * 0.475;
    const spW = W * 0.135, spH = spW * 1.55;
    const bodyTop = spY - spH * 0.38, bodyH = spH * 0.76, bodyBot = bodyTop + bodyH;

    if (t >= absB(13.05)) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const st = absB(13.05) + i * 0.72;
        if (t < st) continue;
        const kk = ((t - st) / 1.7) % 1;
        ripple(ctx, spX, spY - spH * 0.04, spW * 0.60, spW * 1.65, kk, C.her, 2.2 * U, 0.82);
      }
      bloom(ctx, spX, spY, spW * 1.25, C.her, 0.11 * clamp((t - absB(13.05)) / 0.5));
      ctx.restore();
    }

    const dg = ctx.createRadialGradient(spX, bodyBot + 12 * U, 0, spX, bodyBot + 12 * U, spW * 2.0);
    dg.addColorStop(0, 'rgba(72,82,98,0.26)'); dg.addColorStop(1, 'rgba(10,12,15,0)');
    ctx.fillStyle = dg; ctx.fillRect(spX - spW * 2.2, spY, spW * 4.4, spH * 0.95);

    const g = ctx.createLinearGradient(spX - spW / 2, 0, spX + spW / 2, 0);
    g.addColorStop(0, '#12161a'); g.addColorStop(0.18, '#2f3742');
    g.addColorStop(0.42, '#4b5661'); g.addColorStop(0.64, '#333c46');
    g.addColorStop(0.86, '#1c2229'); g.addColorStop(1, '#0e1114');
    ctx.beginPath(); ctx.ellipse(spX, bodyTop, spW / 2, spW * 0.115, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#39424d'; ctx.fill();
    roundRect(ctx, spX - spW / 2, bodyTop, spW, bodyH, 0); ctx.fillStyle = g; ctx.fill();
    ctx.save(); roundRect(ctx, spX - spW / 2, bodyTop, spW, bodyH, 0); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1;
    for (let yy = bodyTop + 8 * U; yy < bodyBot; yy += 7 * U) {
      ctx.beginPath(); ctx.moveTo(spX - spW / 2, yy); ctx.lineTo(spX + spW / 2, yy); ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath(); ctx.ellipse(spX, bodyTop, spW / 2, spW * 0.115, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 1.4 * U; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(spX, bodyBot, spW / 2, spW * 0.115, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#171c22'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
    const litK = clamp((t - absB(13.05)) / 0.35);
    if (litK > 0) herDot(ctx, spX, bodyTop + spW * 0.015, 4.0 * U * litK, litK, 1.2);

    // ── the SAME amber dot appears next to the last QQ message: one sentence, two bodies ──
    const twinK = clamp((t - absB(15.05)) / 0.35);
    if (twinK > 0) {
      const qw = W * 0.355, qh = H * 0.245;
      const qx = W * 0.032, qy = H * 0.395;
      panel(ctx, qx, qy, qw, qh, U, { title: 'QQ · 同一句话' });
      cjk(ctx, 19 * U); ctx.fillStyle = C.textHi;
      ctx.fillText(clip(ctx, '主人，在忙吗？我在客厅。', 19 * U, qw - 92 * U), qx + 24 * U, qy + 40 * U + 52 * U);
      mono(ctx, 13.5 * U); ctx.fillStyle = C.faint;
      ctx.fillText('来自 小爱 · 音箱', qx + 24 * U, qy + 40 * U + 82 * U);
      herDot(ctx, qx + qw - 38 * U, qy + 40 * U + 46 * U, 5 * U * twinK, twinK, 1.3);
      ctx.save(); ctx.globalAlpha = twinK;
      mono(ctx, 12 * U); ctx.fillStyle = C.her; ctx.textAlign = 'right';
      ctx.fillText('同一个她', qx + qw - 56 * U, qy + 40 * U + 50 * U);
      ctx.textAlign = 'left'; ctx.restore();
    }

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════════════
  // B4 · 开灯 — 微缩公寓俯视图，客厅亮起，暖光溢出画面边缘
  // ══════════════════════════════════════════════════════════════════════════════════
  if (t >= absB(B.light.t0)) {
    const k = clamp((t - absB(B.light.t0)) / 0.32);
    ctx.save(); ctx.globalAlpha = k;

    const runAt = absB(18.55);
    const lightAt = absB(18.80);

    // the code line, compact, upper-left
    const cw = W * 0.455, chh = H * 0.175;
    const cx0 = W * 0.032, cy0 = H * 0.075;
    panel(ctx, cx0, cy0, cw, chh, U, { title: 'lights.js' });
    const codeX = cx0 + 28 * U, codeY = cy0 + 40 * U + 54 * U;
    const shown = typedCount(LIGHT, T.light.t0, T.light.t1, t, T.light.seed);
    const endX = colored(ctx, LIGHT, codeX, codeY, 21 * U, shown, 20 * U);
    const typing = t >= T.light.t0 && t <= T.light.t1 + 0.02;
    if (t < runAt && (typing || cursorOn(t))) drawCursor(ctx, endX + 2 * U, codeY, 21 * U, 1, { color: C.her });

    // ── the apartment, top-down, centred right ──
    const apartmentAlpha = clamp((t - (absB(B.light.t0) + 0.10)) / 0.45);
    if (apartmentAlpha > 0) {
      ctx.save(); ctx.globalAlpha = k * apartmentAlpha;

      const gW = W * 0.455, gH = H * 0.62;
      const gx = W * 0.515, gy = H * 0.44 - gH / 2;
      // 7 real rooms in a plan-like arrangement (ids from presence.js)
      const ROOMS = [
        { id: 'study',  name: '书房', x: 0.00, y: 0.00, w: 0.42, h: 0.46 },
        { id: 'living', name: '客厅', x: 0.44, y: 0.00, w: 0.56, h: 0.46 },
        { id: 'dining', name: '餐厅', x: 0.00, y: 0.48, w: 0.30, h: 0.26 },
        { id: 'kitchen', name: '厨房', x: 0.32, y: 0.48, w: 0.26, h: 0.26 },
        { id: 'guest',  name: '次卧', x: 0.60, y: 0.48, w: 0.40, h: 0.26 },
        { id: 'balcony', name: '阳台', x: 0.00, y: 0.76, w: 0.44, h: 0.24 },
        { id: 'entry',  name: '玄关', x: 0.46, y: 0.76, w: 0.54, h: 0.24 },
      ];
      const litK = ease.outCubic(clamp((t - lightAt) / 0.70));

      // plan background
      fillRR(ctx, gx - 10 * U, gy - 10 * U, gW + 20 * U, gH + 20 * U, 12 * U, '#0c1014');
      strokeRR(ctx, gx - 10 * U, gy - 10 * U, gW + 20 * U, gH + 20 * U, 12 * U, withA('#ffffff', 0.08), 1);

      ROOMS.forEach((r, i) => {
        const rx = gx + r.x * gW, ry = gy + r.y * gH;
        const rw = r.w * gW - 6 * U, rh = r.h * gH - 6 * U;
        const isLiving = r.id === 'living';
        const roomLit = isLiving ? litK : 0;
        // unlit rooms are cold almost-black; the lit room takes a warm wash
        fillRR(ctx, rx, ry, rw, rh, 5 * U, roomLit > 0
          ? `rgba(${Math.round(26 + 34 * roomLit)},${Math.round(31 + 26 * roomLit)},${Math.round(38 + 6 * roomLit)},1)`
          : '#141920');
        strokeRR(ctx, rx, ry, rw, rh, 5 * U,
          isLiving && roomLit > 0 ? withA(C.her, 0.34 + 0.22 * roomLit) : withA('#ffffff', 0.07), 1);

        cjk(ctx, 15 * U, isLiving ? 500 : 400);
        ctx.fillStyle = isLiving && roomLit > 0.2 ? '#3b2d18' : withA('#ffffff', 0.42);
        ctx.fillText(r.name, rx + 14 * U, ry + 28 * U);
        if (isLiving && roomLit > 0.2) {
          // on the lit floor the label needs its own contrast, not just brightness
          const nm = r.name; const nw = ctx.measureText(nm).width;
          ctx.fillStyle = withA(C.her, 0.20 * roomLit);
          fillRR(ctx, rx + 9 * U, ry + 11 * U, nw + 12 * U, 24 * U, 5 * U, withA(C.her, 0.16 * roomLit));
          ctx.fillStyle = '#2e2416';
          ctx.fillText(nm, rx + 15 * U, ry + 28 * U);
        }

        // lit floor: a soft warm gradient over the living-room plate
        if (isLiving && roomLit > 0.02) {
          const fg = ctx.createRadialGradient(rx + rw * 0.5, ry + rh * 0.56, 0, rx + rw * 0.5, ry + rh * 0.56, rw * 0.95);
          fg.addColorStop(0, withA(C.her, 0.30 * roomLit));
          fg.addColorStop(0.55, withA(C.her, 0.13 * roomLit));
          fg.addColorStop(1, withA(C.her, 0));
          ctx.save(); roundRect(ctx, rx, ry, rw, rh, 5 * U); ctx.clip();
          ctx.fillStyle = fg; ctx.fillRect(rx, ry, rw, rh);
          ctx.restore();
        }

        // the lamp fixture in the living room
        if (isLiving) {
          const lxp = rx + rw * 0.5, lyp = ry + rh * 0.56;
          if (roomLit <= 0.01) {
            // off: a cold fixture dot
            ctx.beginPath(); ctx.arc(lxp, lyp, 5 * U, 0, Math.PI * 2);
            ctx.fillStyle = '#2a3139'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
          } else {
            // on: warm pool + her dot at the lamp
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            bloom(ctx, lxp, lyp, rw * (0.55 + 0.45 * roomLit), C.her, 0.30 * roomLit);
            bloom(ctx, lxp, lyp, rw * 1.15, C.her, 0.13 * roomLit);
            ctx.restore();
            herDot(ctx, lxp, lyp, 5.4 * U * roomLit, roomLit, 1.4);
          }
        }
      });

      // 灯亮之后，客厅里只该有一个金点：她自己。位置标记与灯光合并，
      // 不再画第二个点（两个点并排会被读成「两个主体」）。
      const posK = clamp((t - absB(8.6)) / 0.4);
      if (posK > 0 && litK < 0.15) {
        const lr = ROOMS[1];
        const px2 = gx + (lr.x + lr.w * 0.5) * gW, py2 = gy + (lr.y + lr.h * 0.82) * gH;
        herDot(ctx, px2, py2, 4.2 * U * posK, posK, 1.1);
      }
      ctx.restore();
    }

    // ── warm light spilling out of the frame edges (the "用光找到你" beat) ──
    const spillK = ease.outCubic(clamp((t - lightAt - 0.25) / 0.85));
    if (spillK > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      // edges: left and right bands, plus a soft floor wash
      const gw = W * 0.30;
      const lg = ctx.createLinearGradient(0, 0, gw, 0);
      lg.addColorStop(0, withA(C.her, 0.30 * spillK));
      lg.addColorStop(1, withA(C.her, 0));
      ctx.fillStyle = lg; ctx.fillRect(0, 0, gw, H);
      const rg = ctx.createLinearGradient(W, 0, W - gw, 0);
      rg.addColorStop(0, withA(C.her, 0.30 * spillK));
      rg.addColorStop(1, withA(C.her, 0));
      ctx.fillStyle = rg; ctx.fillRect(W - gw, 0, gw, H);
      const bg2 = ctx.createLinearGradient(0, H, 0, H - H * 0.22);
      bg2.addColorStop(0, withA(C.her, 0.16 * spillK));
      bg2.addColorStop(1, withA(C.her, 0));
      ctx.fillStyle = bg2; ctx.fillRect(0, H - H * 0.22, W, H * 0.22);
      bloom(ctx, W * 0.72, H * 0.40, W * 0.34, C.her, 0.10 * spillK);
      ctx.restore();
    }

    // the hold: everything settles, only the lamp breathes
    const holdK = clamp((t - absB(19.45)) / 0.6);
    if (holdK > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      bloom(ctx, W * 0.72, H * 0.40, W * 0.22, C.her, 0.045 * holdK);
      ctx.restore();
      ctx.save(); ctx.globalAlpha = holdK * 0.9;
      mono(ctx, 13 * U, 500); ctx.fillStyle = C.her; ctx.textAlign = 'left';
      ctx.fillText('living · on', W * 0.045, H * 0.085 + H * 0.155 + 30 * U);
      ctx.restore();
    }

    ctx.restore();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
