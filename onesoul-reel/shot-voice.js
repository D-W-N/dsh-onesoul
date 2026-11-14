// shot-voice.js — 第 4 镜 · 她会说话
// Code types large on the left; ⏎ runs it and a waveform blooms straight out of the call.
// The camera then whips right to the speaker, where her voice leaves the device as ripples.
// No faces, only the device. The only warm light in the shot is the waveform, the dot and the ripples.
import { C, F, mono, cjk, fillRR, strokeRR, bloom, withA, roundRect, tokenize } from './theme.js';
import { at, shot, TYPING, typedCount, typing } from './timeline.js';
import { clamp, lerp, ease, snap, glide, spring, springTo, seg } from './motion.js';
import { drawCursor, cursorOn, waveform, ripple, herDot, textW } from './ui.js';

const S = shot('voice');
const T = typing('voice', 0);
const CODE = 'anima_speak({ text: "早安，主人" })';

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

export function drawVoice(ctx, W, H, t) {
  const U = Math.min(W, H) / 1080;
  const runAt = at('voice', 2.15);
  const px = 31 * U, cjkPx = 29 * U;

  // The editor owns the frame while the call runs, then hands over: it shrinks into a compact
  // card at upper-left (keeping the code + waveform on screen for continuity) while the speaker
  // arrives and grows into the hero. Two panels, one continuous take — no hard geometry break.
  const handK = ease.inOutCubic(clamp((t - at('voice', 3.70)) / 0.85));

  // ══ the editor ══
  {
    const ewFull = W * 0.640, ehFull = H * 0.375;
    const exFull = W * 0.042, eyFull = (H - ehFull) / 2 - 30 * U;
    const ewS = W * 0.395, ehS = H * 0.295;
    const exS = W * 0.052, eyS = H * 0.150;
    const ew = lerp(ewFull, ewS, handK), eh = lerp(ehFull, ehS, handK);
    const ex = lerp(exFull, exS, handK), ey = lerp(eyFull, eyS, handK);
    const s = lerp(1, 0.66, handK);         // content scales with the card

    ctx.save();
    ctx.translate(ex, ey); ctx.scale(s, s);

    const cw = ew / s, ch = eh / s;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.66)'; ctx.shadowBlur = 56 * U; ctx.shadowOffsetY = 17 * U;
    fillRR(ctx, 0, 0, cw, ch, 14 * U / s, '#111519');
    ctx.restore();
    strokeRR(ctx, 0, 0, cw, ch, 14 * U / s, C.lineHi, 1);

    const hh = 44 * U;
    fillRR(ctx, 0, 0, cw, hh, 14 * U / s, C.panel);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cw, hh); ctx.clip();
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, cw, hh); ctx.restore();
    ctx.fillStyle = C.line; ctx.fillRect(0, hh, cw, 1);
    [0, 1, 2].forEach(i => { ctx.beginPath(); ctx.arc(24 * U + i * 20 * U, hh / 2, 5.4 * U, 0, Math.PI * 2); ctx.fillStyle = '#3c434d'; ctx.fill(); });
    mono(ctx, 17 * U); ctx.fillStyle = C.faint; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('voice.js — dsh-anima', 96 * U, hh / 2 + 6 * U);

    const gutW = 56 * U;
    ctx.save(); ctx.beginPath(); ctx.rect(0, hh + 1, cw, ch - hh); ctx.clip();
    ctx.fillStyle = C.gutter; ctx.fillRect(0, hh + 1, gutW, ch);
    ctx.fillStyle = C.line; ctx.fillRect(gutW, hh + 1, 1, ch);

    const codeX = gutW + 28 * U, codeY = hh + 72 * U;
    mono(ctx, 15 * U); ctx.fillStyle = C.ghost; ctx.textAlign = 'left';
    ctx.fillText('1', 18 * U, codeY);

    const shown = typedCount(CODE, T.t0, T.t1, t, T.seed);
    const endX = colored(ctx, CODE, codeX, codeY, px, shown, cjkPx);
    const typing = t >= T.t0 && t <= T.t1 + 0.02;
    if (t < runAt && (typing || cursorOn(t))) drawCursor(ctx, endX + 2 * U, codeY, px, 1, { color: C.her });

    if (t >= runAt) {
      ctx.save(); ctx.globalAlpha *= clamp((t - runAt) / 0.24);
      mono(ctx, 17 * U); ctx.fillStyle = C.ok;
      ctx.fillText('▶', codeX, codeY + 50 * U);
      mono(ctx, 16 * U); ctx.fillStyle = C.dim;
      ctx.fillText('synthesizing · edge:zh-CN-XiaoxiaoNeural', codeX + 30 * U, codeY + 50 * U);
      mono(ctx, 14 * U); ctx.fillStyle = C.faint;
      ctx.fillText('→ ~/.dsh/anima/voice/tts-8f2c.mp3', codeX + 30 * U, codeY + 80 * U);

      const wk = clamp((t - at('voice', 2.40)) / 0.85);
      const ww = cw - gutW - 84 * U;
      waveform(ctx, codeX + 30 * U, codeY + 150 * U, ww, 66 * U, t, wk, { bars: 58, amp: 1, color: C.her });
      ctx.fillStyle = withA(C.her, 0.18 * wk);
      ctx.fillRect(codeX + 30 * U, codeY + 150 * U + 1 * U, ww * wk, 1);
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
  }

  // ══ the speaker ══
  const inK = clamp((t - at('voice', 3.70)) / 0.55);
  if (inK > 0) {
    const grow = spring(t - at('voice', 3.70), { freq: 2.1, damp: 0.86 });
    const spX = W * 0.700 + (1 - inK) * W * 0.09;
    const spY = H * 0.480;
    const spW = W * 0.132 * (0.80 + 0.20 * grow), spH = spW * 1.55;
    const bodyTop = spY - spH * 0.38, bodyH = spH * 0.76;
    const bodyBot = bodyTop + bodyH;

    ctx.save(); ctx.globalAlpha = inK;

    // ripple frame: a soft ring on the floor, plus the expanding rings behind the body
    const baseY = spY - spH * 0.04;
    if (t >= at('voice', 4.35)) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const st = at('voice', 4.35) + i * 0.70;
        if (t < st) continue;
        const k = ((t - st) / 1.65) % 1;
        ripple(ctx, spX, baseY, spW * 0.62, spW * 1.62, k, C.her, 2.2 * U, 0.78);
      }
      bloom(ctx, spX, spY, spW * 1.2, C.her, 0.10 * clamp((t - at('voice', 4.35)) / 0.6));
      ctx.restore();
    }

    // desk pool + contact shadow
    const dg = ctx.createRadialGradient(spX, bodyBot + 12 * U, 0, spX, bodyBot + 12 * U, spW * 2.2);
    dg.addColorStop(0, 'rgba(72,82,98,0.28)'); dg.addColorStop(1, 'rgba(10,12,15,0)');
    ctx.fillStyle = dg; ctx.fillRect(spX - spW * 2.5, spY, spW * 5, spH * 0.95);
    ctx.save();
    ctx.beginPath(); ctx.ellipse(spX, bodyBot + 10 * U, spW * 0.60, spW * 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.filter = 'blur(9px)'; ctx.fill();
    ctx.restore();

    // body
    const g = ctx.createLinearGradient(spX - spW / 2, 0, spX + spW / 2, 0);
    g.addColorStop(0, '#12161a'); g.addColorStop(0.16, '#2f3742');
    g.addColorStop(0.40, '#4b5661'); g.addColorStop(0.62, '#333c46');
    g.addColorStop(0.86, '#1c2229'); g.addColorStop(1, '#0e1114');
    ctx.beginPath();
    ctx.ellipse(spX, bodyTop, spW / 2, spW * 0.115, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#39424d'; ctx.fill();
    roundRect(ctx, spX - spW / 2, bodyTop, spW, bodyH, 0);
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); roundRect(ctx, spX - spW / 2, bodyTop, spW, bodyH, 0); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1;
    for (let yy = bodyTop + 8 * U; yy < bodyBot; yy += 7 * U) {
      ctx.beginPath(); ctx.moveTo(spX - spW / 2, yy); ctx.lineTo(spX + spW / 2, yy); ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath(); ctx.ellipse(spX, bodyTop, spW / 2, spW * 0.115, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)'; ctx.lineWidth = 1.5 * U; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(spX, bodyBot, spW / 2, spW * 0.115, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#171c22'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1; ctx.stroke();

    const litK = clamp((t - at('voice', 4.20)) / 0.40);
    if (litK > 0) herDot(ctx, spX, bodyTop + spW * 0.015, 4.4 * U * litK, litK, 1.25);

    // annotation, well below the device and clear of the rings
    const labK = clamp((t - at('voice', 4.70)) / 0.35);
    if (labK > 0) {
      ctx.save(); ctx.globalAlpha = inK * labK;
      const label = '晓晓音色 · 本机合成';
      mono(ctx, 16 * U, 500); ctx.fillStyle = C.her; ctx.textAlign = 'center';
      const ly = bodyBot + 96 * U;
      ctx.fillText(label, spX, ly);
      const tw = textW(ctx, label, 16 * U);
      ctx.strokeStyle = withA(C.her, 0.32); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(spX - tw / 2, ly + 13 * U); ctx.lineTo(spX + tw / 2, ly + 13 * U); ctx.stroke();
      mono(ctx, 13 * U); ctx.fillStyle = C.faint;
      ctx.fillText('xiaomi_say  →  局域网拉流播放', spX, ly + 38 * U);
      ctx.restore();
    }
    ctx.restore();
    ctx.textAlign = 'left';
  }
}