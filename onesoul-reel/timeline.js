// timeline.js — the single source of truth for time.
// Imported by the page (picture) AND score.mjs (sound), so every keystroke, cut and ripple
// lands on the same number. Plain ES module: no DOM, no Node APIs.
//
// 90 BPM lo-fi: one beat = 0.6667 s, one bar = 2.6667 s.
// Shot lengths are whole beats: the five "normal" shots are 10 beats (6.667 s), the four
// deliberately slower shots are 12 beats (8.000 s) = ×1.20, and the autonomy shot is 30 beats
// (20.000 s) split into its own four narrative beats (5 + 5 + 6 + 4 s).
//
// IMPORTANT UNIT RULE: shot boundaries are written in beats (b(n)). Everything *inside* a shot
// (typing ranges, cues) is written in SECONDS of local shot time through at(shotId, sec), so the
// picture and the score never have to think about tempo. at() returns absolute seconds.

export const BPM = 90;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
/** beat number → seconds */
export const b = n => n * BEAT;
/** When to START a transition so the new picture first shows ON the hit (a beat / bar time). */
export const revealOn = (hit, dur, reveal = 0) => hit - reveal * dur;

export const DUR = b(124); // 82.667 s — 9 shots, 124 beats (31 bars exactly)

// ── shots ────────────────────────────────────────────────────────────────────────────
export const SHOTS = [
  { id: 'install', t0: b(0),   t1: b(10),  kind: 'normal' }, // 0.000 – 6.667    一行命令
  { id: 'center',  t0: b(10),  t1: b(20),  kind: 'normal' }, // 6.667 – 13.333   控制中心
  { id: 'memory',  t0: b(20),  t1: b(36),  kind: 'slow'   }, // 13.333 – 24.000  记忆裁决（加长到 10.667 s）
  { id: 'voice',   t0: b(36),  t1: b(46),  kind: 'normal' }, // 24.000 – 30.667  她会说话
  { id: 'ears',    t0: b(46),  t1: b(58),  kind: 'slow'   }, // 30.667 – 38.667  耳朵
  { id: 'alive',   t0: b(58),  t1: b(88),  kind: 'slow'   }, // 38.667 – 58.667  你不在，她也活着
  { id: 'chain',   t0: b(88),  t1: b(100), kind: 'slow'   }, // 58.667 – 66.667  模型链
  { id: 'bodies',  t0: b(100), t1: b(110), kind: 'normal' }, // 66.667 – 73.333  多个身体
  { id: 'end',     t0: b(110), t1: b(124), kind: 'normal' }, // 73.333 – 82.667  结尾
];

export const shot = id => SHOTS.find(s => s.id === id);
export const SHOT_AT = t => SHOTS.find(s => t >= s.t0 && t < s.t1) || SHOTS[SHOTS.length - 1];

/** Absolute seconds for a local time (seconds) inside a shot. */
export const at = (id, sec) => shot(id).t0 + sec;

// ── the autonomy shot's four narrative beats (local seconds inside 'alive') ──────────
// 前两拍静（5 + 5），后两拍动（6 + 4）。整体比普通镜头慢，节奏在这里是「等」出来的。
export const ALIVE = {
  silence: { t0: 0.0,  t1: 5.0,  label: '沉默' },
  notice:  { t0: 5.0,  t1: 10.0, label: '察觉' },
  speak:   { t0: 10.0, t1: 16.0, label: '开口' },
  light:   { t0: 16.0, t1: 20.0, label: '开灯' },
};

// ── typing ───────────────────────────────────────────────────────────────────────────
const WEIGHT = ch =>
  '，、。；：？'.includes(ch) ? 3.0 :
  '，,;:'.includes(ch) ? 2.4 :
  '.。'.includes(ch) ? 2.0 :
  '(){}[]'.includes(ch) ? 1.2 :
  ' '.includes(ch) ? 0.85 :
  (ch === '"' || ch === "'") ? 1.1 :
  1;

function h01(n, seed = 0) {
  let h = Math.imul((n | 0) ^ Math.imul(seed | 0, 0x9E3779B1), 0x85EBCA6B);
  h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Deterministic per-character key times for `text` typed over [t0, t1] (absolute seconds). */
export function typeSchedule(text, t0, t1, seed = 1) {
  const chars = [...text], n = chars.length;
  const w = chars.map((ch, i) => WEIGHT(ch) * (0.86 + 0.28 * h01(i, seed)));
  const total = w.reduce((a, v) => a + v, 0) || 1;
  const span = Math.max(0, t1 - t0);
  const out = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += w[i]; out[i] = t0 + span * (acc / total); }
  if (n) out[0] = t0 + span * (w[0] * 0.5 / total);
  return out;
}

/** How many characters of `text` are visible at time t. */
export function typedCount(text, t0, t1, t, seed = 1) {
  if (t <= t0) return 0;
  const n = [...text].length;
  if (t >= t1) return n;
  const times = typeSchedule(text, t0, t1, seed);
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** All keystrokes in the film (absolute seconds). The score turns each one into a key click. */
export const TYPING = [
  // S1 · install — the command types 0.45→3.05, ⏎ at 3.30
  { shot: 'install', t0: at('install', 0.45), t1: at('install', 3.05), text: 'dsh plugin add dsh-onesoul', seed: 11 },
  // S3 · memory — starts just after the cut; the cross-shot transition bridges the join,
  // so no keystroke is allowed to leak into shot 2's tail.
  { shot: 'memory', t0: at('memory', 0.20), t1: at('memory', 2.05), text: 'anima_memory_capture({ text: "主人只喝美式，不加糖", source: "qq" })', seed: 31 },
  { shot: 'memory', t0: at('memory', 2.25), t1: at('memory', 3.20), text: 'anima_memory_pending()', seed: 32 },
  { shot: 'memory', t0: at('memory', 3.40), t1: at('memory', 5.70), text: 'anima_memory_decide({ id: "mem_xxx", decision: "approve" })', seed: 33 },
  { shot: 'memory', t0: at('memory', 6.30), t1: at('memory', 8.05), text: 'anima_memory_decide({ id: "mem_yyy", decision: "reject" })', seed: 34 },
  // S4 · voice
  { shot: 'voice', t0: at('voice', 0.15), t1: at('voice', 2.05), text: 'anima_speak({ text: "早安，主人" })', seed: 41 },
  // S6 · alive — B3 开口 / B4 开灯
  { shot: 'alive', t0: at('alive', 10.35), t1: at('alive', 12.60), text: 'xiaomi_say({ text: "主人，在忙吗？我在客厅。" })', seed: 61 },
  { shot: 'alive', t0: at('alive', 16.60), t1: at('alive', 18.40), text: 'smart_home.lights({ room: "living", on: true })', seed: 62 },
  // S9 · end — the command types again, then the lockup holds
  { shot: 'end', t0: at('end', 1.20), t1: at('end', 4.00), text: 'dsh plugin add dsh-onesoul', seed: 81 },
];

/**
 * Look up a typing range by (shot, line) instead of by array index.
 * Index-based lookup (TYPING[4]) silently breaks the moment a line is inserted above it —
 * that bug put shot 4's keystrokes inside shot 3's tail and gave shot 9 typing it never showed.
 */
export function typing(shotId, line = 0) {
  let n = 0;
  for (const t of TYPING) {
    if (t.shot !== shotId) continue;
    if (n === line) return t;
    n++;
  }
  throw new Error(`no TYPING entry for shot=${shotId} line=${line}`);
}

// ── picture cues that need a sound (absolute seconds) ────────────────────────────────
export const CUES = [
  // S1 · install
  { t: at('install', 0.20), sfx: 'power' },
  { t: at('install', 3.30), sfx: 'enter' },
  { t: at('install', 3.55), sfx: 'deps' },
  { t: at('install', 6.10), sfx: 'success' },
  // S2 · center
  { t: at('center', 0.45), sfx: 'tab' },
  { t: at('center', 1.00), sfx: 'blip' },
  { t: at('center', 2.55), sfx: 'tick' },
  { t: at('center', 4.25), sfx: 'tick' },
  { t: at('center', 5.70), sfx: 'tick' },
  // S3 · memory — 批准与驳回，两半都要听得见
  { t: at('memory', 0.10), sfx: 'blip' },
  { t: at('memory', 5.85), sfx: 'approve' },
  { t: at('memory', 6.05), sfx: 'shimmer' },
  { t: at('memory', 8.25), sfx: 'reject' },
  // S4 · voice
  { t: at('voice', 2.15), sfx: 'enter' },
  { t: at('voice', 2.40), sfx: 'wave' },
  { t: at('voice', 4.35), sfx: 'ripple' },
  { t: at('voice', 5.00), sfx: 'ripple' },
  // S5 · ears
  { t: at('ears', 0.20), sfx: 'blip' },
  { t: at('ears', 2.40), sfx: 'ear' },
  { t: at('ears', 3.90), sfx: 'turn' },
  { t: at('ears', 5.20), sfx: 'cut' },
  { t: at('ears', 5.75), sfx: 'reply' },
  // S6 · alive — B1 沉默：几乎无声，只有光标与时钟
  { t: at('alive', 0.30), sfx: 'blip' },
  { t: at('alive', 1.55), sfx: 'clock' },
  { t: at('alive', 2.75), sfx: 'clock' },
  { t: at('alive', 3.95), sfx: 'clock' },
  { t: at('alive', 4.75), sfx: 'clock' },
  // B2 察觉
  { t: at('alive', 5.10), sfx: 'blip' },
  { t: at('alive', 6.10), sfx: 'notice' },
  { t: at('alive', 7.35), sfx: 'decide' },
  { t: at('alive', 8.35), sfx: 'field' },
  { t: at('alive', 9.25), sfx: 'field' },
  // B3 开口
  { t: at('alive', 12.75), sfx: 'enter' },
  { t: at('alive', 13.05), sfx: 'speak' },
  { t: at('alive', 13.75), sfx: 'ripple' },
  { t: at('alive', 14.45), sfx: 'ripple' },
  { t: at('alive', 15.05), sfx: 'twin' },
  // B4 开灯
  { t: at('alive', 16.45), sfx: 'blip' },
  { t: at('alive', 18.55), sfx: 'enter' },
  { t: at('alive', 18.80), sfx: 'light' },
  { t: at('alive', 19.45), sfx: 'warm' },
  // S7 · chain
  { t: at('chain', 0.20), sfx: 'blip' },
  { t: at('chain', 1.30), sfx: 'tick' },
  { t: at('chain', 3.55), sfx: 'fail' },
  { t: at('chain', 4.10), sfx: 'nodeoff' },
  { t: at('chain', 4.60), sfx: 'travel' },
  { t: at('chain', 6.40), sfx: 'nodeon' },
  // S8 · bodies
  { t: at('bodies', 0.05), sfx: 'panel' },
  { t: at('bodies', 0.35), sfx: 'panel' },
  { t: at('bodies', 0.65), sfx: 'panel' },
  { t: at('bodies', 0.95), sfx: 'panel' },
  { t: at('bodies', 2.05), sfx: 'dot' },
  { t: at('bodies', 2.38), sfx: 'dot' },
  { t: at('bodies', 2.71), sfx: 'dot' },
  { t: at('bodies', 3.04), sfx: 'dot' },
  { t: at('bodies', 3.80), sfx: 'converge' },
  { t: at('bodies', 5.05), sfx: 'impact' },
  // S9 · end
  { t: at('end', 0.30), sfx: 'power' },
  { t: at('end', 4.10), sfx: 'enter' },
  { t: at('end', 4.85), sfx: 'badge' },
  { t: at('end', 5.95), sfx: 'fade' },
];

// ── shot transitions ────────────────────────────────────────────────────────────────
// A transition is centred on the cut: for `dur` seconds around it both shots are drawn, the
// outgoing one leaving and the incoming one arriving. This is what makes the joins feel like
// switching a tab rather than slamming two screens together.
//   kind: 'slide'  – IDE tab switch: outgoing slides out, incoming slides in from the other side
//         'rise'   – the next surface rises from the bottom edge (vertical context change)
//         'zoom'   – push through: outgoing scales up and fades, incoming settles from 1.08
export const TRANSITIONS = [
  { at: b(10),  dur: 0.44, kind: 'left'  },   // 1 → 2
  { at: b(20),  dur: 0.48, kind: 'left'  },   // 2 → 3
  { at: b(36),  dur: 0.44, kind: 'up'    },   // 3 → 4
  { at: b(46),  dur: 0.44, kind: 'left'  },   // 4 → 5
  { at: b(58),  dur: 0.46, kind: 'left'  },   // 5 → 6
  { at: b(88),  dur: 0.44, kind: 'up'    },   // 6 → 7
  { at: b(100), dur: 0.46, kind: 'left'  },   // 7 → 8
  { at: b(110), dur: 0.48, kind: 'up'    },   // 8 → 9
];

/** Active transition at time t, or null. */
export function transitionAt(t) {
  for (const tr of TRANSITIONS) {
    if (t >= tr.at - tr.dur / 2 && t <= tr.at + tr.dur / 2) return tr;
  }
  return null;
}

// ── what the QA tools should know you meant ──────────────────────────────────────────
// Deliberate still moments: the lit room at the end of the autonomy shot (≥2 s), and the end card (≥3 s).
export const HOLDS = [
  [at('alive', 18.80), at('alive', 20.0)],
  [at('end', 4.85), DUR],
];
// Big hits that should follow a breath. The autonomy shot's ⏎ is the one the drums land on.
export const DROPS = [
  at('memory', 5.85),
  at('ears', 5.20),
  at('alive', 12.75),
  at('bodies', 5.05),
];
