// transitions.js — draws the join between two shots.
//
// A film of dense, full-bleed UIs must never show two screens on top of each other: the moment
// they alpha-blend, two sets of code are legible in the same pixel and it reads as a broken
// frame. So every boundary here is a single planned PUSH — both screens translate together in
// the same direction, the outgoing one leaving as the incoming one lands. Because a full-width
// screen moving left by `e·W` is followed by the next one entering at `(1−e)·W`, the two occupy
// complementary columns and never overlap. Nothing scales (scaling a full-bleed UI exposes the
// un-rendered edge), nothing fades (fading ghosts the screen behind it).
//
//   kind 'left'  — push horizontally: defaults, reads as "advance to the next screen"
//   kind 'up'    — push vertically: reads as "pull the next panel up over the stack"
//
// The outgoing screen is drawn first, then the incoming one covers it. At the exact cut they are
// side by side momentarily; because there is only ever one screen per column there is no moiré.

import { transitionAt, SHOTS } from './timeline.js';
import { clamp, snap } from './motion.js';

/** Everything the render loop needs to draw one frame, transition applied or not. */
export function resolveFrame(t, copyT) {
  const tr = transitionAt(t);
  if (!tr) {
    const cur = SHOTS.find(s => copyT >= s.t0 && copyT < s.t1) || SHOTS[SHOTS.length - 1];
    return { tr: null, a: cur, b: null, k: 0 };
  }
  const a = SHOTS.find(s => tr.at > s.t0 && tr.at <= s.t1) || SHOTS[0];   // outgoing
  const b = SHOTS[SHOTS.indexOf(a) + 1] || a;                              // incoming
  const up = tr.kind === 'up';
  const raw = clamp((t - (tr.at - tr.dur / 2)) / tr.dur);
  return { tr, a, b, k: raw, up };
}

/**
 * Draw one shot into the transition. The outgoing shot is translated off the stage
 * (outOffset), the incoming shot is translated in from the opposite fold (inOffset).
 * Pixels are complementary, never blended.
 */
export function drawSide(ctx, W, H, t, side, spec, fn) {
  const { tr, up, k } = spec;
  if (!tr) { fn(); return; }

  const kl = snap(k);                       // hard-start, glide to a rest — a screen sliding
  ctx.save();
  if (side === 'out') {
    // leaving screen: slides all the way off; cover the fold so no hairline shows behind it
    const o = (up ? -H : -W) * kl;
    ctx.translate(up ? 0 : o, up ? o : 0);
    // a solid edge under the outgoing column so the fold reads as a clean edge, never a gap
    const edgeX = up ? 0 : W - o;           // where the outgoing column's trailing edge sits
    const edgeY = up ? H - o : 0;
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(up ? 0 : edgeX, up ? edgeY : 0, up ? W : W * 0.03, up ? H * 0.03 : H);
  } else {
    // arriving screen: enters from the opposite fold, from off-frame so it covers fully
    const i = (up ? H : W) * (1 - kl);
    ctx.translate(up ? 0 : i, up ? i : 0);
  }
  fn();
  ctx.restore();
}

/** The incoming screen always draws on top of the outgoing one. */
export const drawOrder = tr => [null, null];