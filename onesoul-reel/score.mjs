// score.mjs — 配乐与音效，和画面读同一张时间表。
// Build: node <skill>/scripts/audio.mjs build score.mjs   →  audio/music.wav (−14 LUFS)
//
// 声音方向（brief.md · sound 一栏）：
//   克制的 lo-fi 电子氛围。对标 Bonobo / Nujabes 的器乐 lo-fi 底子 + 现代 UI 产品片的克制。
//   学「暖而不糊的低频、稀疏的打击、留白」；不学任何旋律、采样、歌词。
//   90 BPM · 直拍带轻微 swing · B minor 系（sus2 / min7 / maj7 色彩）· pad 铺底 + FM keys 主奏
//   + 轻 sub + hat 点缀 + tape 底噪。
//
// 三条纪律：
//   1. 键盘声是主角之一：每个字符一个真实按键音，取自 timeline 的 TYPING（typeSchedule 给出逐字符时刻），
//      音高/音量由字符索引与 seed 确定性地变化 —— 不用 Math.random，渲染两次必须一样。
//   2. 不在每个重拍上 impact + crash（sound.md §12 点名的默认味）。全片只在第 7 镜合并那一下用一次。
//   3. DROPS 的三个呼吸点之前把低频与打击抽薄，重拍上再回来。

import { DUR, BPM, CUES, SHOTS, TYPING, DROPS, typeSchedule, transitionAt } from './timeline.js';
export { DUR };

export default function score(S) {
  S.tempo(BPM);
  S.space({ room: 0.52, damp: 0.50, width: 0.86 });   // 中小房间，偏暗 —— lo-fi 的「近」

  const pad    = S.bus('pad',    { gain: 0.30, reverb: 0.34, lowpass: 2600 });
  const keys   = S.bus('keys',   { gain: 0.34, reverb: 0.40, delay: 0.14, duck: 0.42 });
  const lowb   = S.bus('low',    { gain: 0.40, duck: 0.42, lowpass: 420 });
  const bass   = S.bus('bass',   { gain: 0.34, duck: 0.40, lowpass: 700 });
  const perc   = S.bus('perc',   { gain: 0.72, reverb: 0.16, highpass: 220 });
  const tape   = S.bus('tape',   { gain: 0.55, wow: 0.22 });
  const sfx    = S.bus('sfx',    { gain: 0.62, reverb: 0.20 });
  const keysfx = S.bus('keysfx', { gain: 0.58, reverb: 0.06, highpass: 160 });

  // ── 和声：B minor 的一条循环，四小节一转，全部带 sus/min7/maj7 色彩 ──────────────────────
  //   Bm9 · Gmaj7 · D6/9 · F#m7  —— 冷而不悲，最后一格用 F#m7 托住而不落回主和弦
  const PROG = [
    { root: 'B2',  q: 'min7',  ext: ['F#4', 'A4', 'C#5'] },
    { root: 'G2',  q: 'maj7',  ext: ['D4', 'F#4', 'B4'] },
    { root: 'D3',  q: 'add9',  ext: ['A3', 'E4', 'F#4'] },
    { root: 'F#2', q: 'min7',  ext: ['C#4', 'E4', 'A4'] },
  ];

  // ── 段落推进：从 timeline 的 SHOTS 读，音乐密度跟着镜头走 ────────────────────────────
  const sec = id => SHOTS.find(s => s.id === id);
  const T = {
    install: sec('install'), center: sec('center'), memory: sec('memory'), voice: sec('voice'),
    ears: sec('ears'), alive: sec('alive'), chain: sec('chain'), bodies: sec('bodies'), end: sec('end'),
  };
  // 「薄」的段落：第 3 / 5 / 6 镜音乐要让位给拟音。0 = 最薄，1 = 满。
  const densityAt = t => {
    if (t < T.install.t0) return 0.18;
    if (t < T.center.t0) return 0.34;                          // 安装：只有底子
    if (t < T.memory.t0) return 0.66;                          // 控制中心：开始有 groove
    if (t < T.voice.t0) return 0.34;                           // 记忆裁决 ★慢：让位给键盘
    if (t < T.ears.t0) return 0.70;                            // 她会说话：扬起
    if (t < T.chain.t0) return 0.40;                           // 耳朵 ★慢：让位给日志
    if (t < T.bodies.t0) return 0.44;                          // 模型链 ★慢
    if (t < T.end.t0) return 1.0;                              // 多个身体：全片最饱满
    return 0.42;                                               // 结尾：收
  };

  // ── 呼吸：DROPS 之前半拍把音乐真正抽空 ─────────────────────────────────────────────
  // 不是「加一个 impact」，而是真的不打音：pad / keys / perc / low 全部在这个窗口里停手，
  // 只留 riser 的尾巴。音频检查量的就是这半拍相对前一节的电平差，所以必须真的安静下来。
  const HOLES = DROPS.map(drop => [drop - S.beat(1.5), drop]);
  const inHole = t => HOLES.some(([a, z]) => t >= a - 1e-6 && t < z - 1e-6);
  // 长尾声部（pad / keys）提前 1.3 s 收手，否则它们的余响会把呼吸窗填满
  const TAIL = 1.8;
  const tooCloseToHole = t => HOLES.some(([a, z]) => t >= a - TAIL - 1e-6 && t < z - 1e-6);
  // 返回 [窗口起点, 重拍] —— 重拍就是窗口终点。pad 必须在重拍那一刻才回来，
  // 不能在窗口内部重启，否则余响会把「呼吸」填满（这正是上一版 check 报警的原因）。
  const nextHole = t => {
    let best = null;
    for (const h of HOLES) if (h[0] > t && (!best || h[0] < best[0])) best = h;
    return best;
  };

  // ── pad：每小节一条，跟着 chord 走；薄的段落 cutoff 压得更低 ──────────────────────────
  const bars = Math.floor(DUR / S.bar(1)) + 1;
  for (let bar = 0; bar < bars; bar++) {
    const t = S.bar(bar);
    if (t >= DUR) break;
    if (inHole(t)) continue;
    const prog = PROG[bar % PROG.length];
    const d = densityAt(t);
    const root = S.midi(prog.root);
    const voicing = [root + 12, ...prog.ext.map(n => S.midi(n))];

    // 如果这一小节里有一个呼吸点，pad 必须在小节中间就收干净：
    // 分成 [t → holeStart] 一段短 pad，重拍之后再补一段，这样凹陷是听得见的。
    const hole = nextHole(t);
    const barEnd = t + S.bar(1);
    if (hole && hole[0] < barEnd) {
      const [hStart, hEnd] = hole;
      const len1 = Math.max(0.16, hStart - t - 0.01);
      pad.add(S.pad(voicing, len1, {
        cutoff: 620 + d * 1500, voices: 4, cents: 11,
        attack: Math.min(0.55, len1 * 0.4), release: 0.04, wobble: 0.18,
      }), t, { gain: 0.30 + d * 0.72 });
      // 重拍那一刻才回来
      const len2 = Math.max(0.2, barEnd - hEnd);
      if (hEnd < DUR) {
        pad.add(S.pad(voicing, len2, {
          cutoff: 1000 + d * 1500, voices: 4, cents: 11, attack: 0.02, release: 1.2, wobble: 0.18,
        }), hEnd, { gain: 0.30 + d * 0.72 });
      }
    } else {
      pad.add(S.pad(voicing, S.bar(1) * 1.02, {
        cutoff: 620 + d * 1500, voices: 4, cents: 11, attack: 0.55, release: 1.5, wobble: 0.18,
      }), t, { gain: 0.30 + d * 0.72 });
    }

    // 低频 pedal 与 tape 底噪都是「长音」：如果这一小节里有一个呼吸窗，它们的长度必须切到窗的起点，
    // 否则从 32.0 s 起头的亚低音会一直盖住 33.2 s 的重拍，呼吸就白做了（check 量的正是这半拍）。
    const longEnd = hole ? Math.min(barEnd, hole[0]) : barEnd;
    const longLen = longEnd - t;
    if (longLen > 0.12 && !inHole(t)) {
      lowb.add(S.sub(prog.root, longLen * 0.98, { harm: 0.16 }), t + S.beat(0.02), { gain: 0.46 });
      tape.add(S.ambience(Math.max(0.12, longLen), { kind: 'tape', amount: 0.9, seed: 300 + bar }), t, { gain: 0.16 });
    }
    // 重拍之后补回被切掉的长音
    if (hole && hole[1] < barEnd) {
      const restLen = barEnd - hole[1];
      if (restLen > 0.15) {
        lowb.add(S.sub(prog.root, restLen * 0.95, { harm: 0.16 }), hole[1] + S.beat(0.02), { gain: 0.46 });
        tape.add(S.ambience(restLen, { kind: 'tape', amount: 0.9, seed: 400 + bar }), hole[1], { gain: 0.16 });
      }
    }

    // bass 行进：lo-fi 的另一条腿。密度够的段落才走，薄的段落留给 sub 持续音。
    if (d > 0.5) {
      const steps = [0, 1.5, 2.5, 3.5];
      for (let i = 0; i < steps.length; i++) {
        const bt = t + S.beat(steps[i]);
        if (bt >= DUR || inHole(bt) || tooCloseToHole(bt + S.beat(0.62))) continue;
        const note = i === 3 ? S.midi(prog.ext[0]) - 12 : S.midi(prog.root);
        bass.add(S.bass(note, S.beat(0.62), { cutoff: 460, sub: 0.7, envAmt: 2.4, drive: 0.30 }), bt, {
          gain: 0.55 + d * 0.30,
        });
      }
    }
  }

  // ── FM keys：lo-fi 的主奏。稀疏、错拍、不落在每小节的第一拍上 ─────────────────────────
  // 用确定性的 hash 选音与时机，保证两次渲染一致。
  const h01 = (n, seed = 0) => {
    let h = Math.imul((n | 0) ^ Math.imul(seed | 0, 0x9E3779B1), 0x85EBCA6B);
    h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const KEY_GRID = 1.0;   // 以拍为单位排点
  const totalBeats = DUR / S.beat(1);
  for (let k = 0; k < totalBeats; k += KEY_GRID) {
    const t = S.beat(k);
    if (t >= DUR - 0.4) break;
    if (tooCloseToHole(t)) continue;
    const d = densityAt(t);
    // 密度决定有多少个八分位上有音符；薄的段落几乎不弹
    if (h01(k * 7, 5) > (0.16 + d * 0.42)) continue;
    const bar = Math.floor(k / 4);
    const prog = PROG[bar % PROG.length];
    const opts = [...prog.ext, prog.root];
    const pick = opts[Math.floor(h01(k * 13, 9) * opts.length)];
    const vel = 0.30 + d * 0.50 + h01(k * 17, 13) * 0.18;
    // 轻微的 swing 推后
    const swung = S.swing(k, 0.16, 0.5);
    keys.add(S.keys([S.midi(pick) + 12], 1.9, { decay: 1.5, index: 2.2 }), swung, { gain: vel });   // 尾巴靠 tooCloseToHole 掐
    // 偶尔补一个五度，只在满的段落
    if (d > 0.6 && h01(k * 19, 17) > 0.78) {
      keys.add(S.keys([S.midi(pick) + 19], 1.4, { decay: 1.1, index: 1.6 }), swung + S.beat(0.25), { gain: vel * 0.45 });
    }
  }

  // ── perc：hat / shaker 点缀。不做四踩 kick（那个默认味留给别人的片子）────────────────
  for (let bar = 0; bar < bars; bar++) {
    const t0 = S.bar(bar);
    if (t0 >= DUR) break;
    const d = densityAt(t0);
    if (d < 0.5 || inHole(t0)) continue;
    for (let step = 0; step < 8; step++) {
      const t = t0 + S.beat(step * 0.5);
      if (t >= DUR) break;
      if (inHole(t)) continue;          // 只跳过窗内的这一格，不能把整小节剩下的都丢掉
      const on = step % 2 === 1 ? h01(bar * 8 + step, 21) < 0.72 : h01(bar * 8 + step, 23) < 0.24;
      if (!on) continue;
      const swung = S.swing(step * 0.5, 0.16, 0.5) + t0;
      perc.add(S.hat({ decay: step % 2 ? 0.030 : 0.052, tone: 1.1 }), swung, {
        gain: (step % 2 ? 0.32 : 0.18) * d, pan: step % 2 ? 0.26 : -0.22,
      });
    }
    // 每两小节一个 shaker 弧，只在最饱满的第 7 镜
    if (d > 0.85 && bar % 2 === 1) {
      perc.add(S.shaker({ decay: 0.075, tone: 1.05 }), t0 + S.beat(3.5), { gain: 0.30, pan: -0.30 });
    }
  }

  // ── 呼吸：DROPS 之前半拍到一拍把音乐整体抽薄 ──────────────────────────────────────────
  // 做法不是「加一个 impact」，而是把 pad / keys / perc 在那个窗口里压掉：
  // 在重拍前 0.5 拍处安排一次短暂的 duck 触发（session 的 duck 是给 bus 的侧链读数）。
  for (const drop of DROPS) {
    // 呼吸窗内所有音乐声部都停（见 inHole）；这里只放一条在重拍前一瞬收干净的 riser 尾巴，
    // 让「抽空 → 砸下」有一个方向感。riser 结束在重拍上，尾巴不会把凹陷填满。
    sfx.add(S.riser(S.beat(0.5), { from: 900, to: 4200, noise: 0.35, seed: 401 }), drop - S.beat(1.0), { gain: 0.085 });
  }

  // ── 拟音：一次按键一个音 ────────────────────────────────────────────────────────────
  // typeSchedule 给出逐字符时刻；音高随字符类别变化，音量随打字速度微变。
  // 同一个字符重复出现时也不会完全一样，但仍然完全确定（seed 来自 step 的 seed 与字符索引）。
  for (const step of TYPING) {
    const times = typeSchedule(step.text, step.t0, step.t1, step.seed);
    const chars = [...step.text];
    const host = SHOTS.find(s => s.id === step.shot);
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (t < 0 || t >= DUR) continue;
      // A keystroke may only sound while its OWN shot owns the frame. Without this gate a
      // line that starts slightly early leaks its clicks into the previous shot's tail, and a
      // shot with no typing still appears to have typing in it.
      if (!host || t < host.t0 || t >= host.t1) continue;
      const ch = chars[i];
      const isSpace = ch === ' ';
      const isPunct = '{}()[]:,"\'.'.includes(ch);
      const r = h01(i * 31 + step.seed * 7, 61);
      // 空格轻一点、标点重一点、普通字符居中
      const g = (isSpace ? 0.16 : isPunct ? 0.46 : 0.34) * (0.82 + r * 0.36);
      // 音高：空格最低，标点最高，普通字符在中间散开
      const tone = isSpace ? 0.80 + r * 0.10 : isPunct ? 1.14 + r * 0.12 : 0.94 + r * 0.20;
      const pan = (r - 0.5) * 0.34;
      // 键帽落下的木头声 + 一点点金属
      keysfx.add(S.click({ tone, seed: 200 + i }), t, { gain: g, pan });
      if (!isSpace && r > 0.55) {
        keysfx.add(S.tick({ tone: tone * 1.25 }), t + 0.004, { gain: g * 0.34, pan: -pan });
      }
    }
  }

  // ── CUES：每个都单独设计，语义对得上 ──────────────────────────────────────────────────
  const cueSnd = {
    // 终端醒来：一声很低的推起，不要尖锐
    power: t => {
      // 通电 = 一个实体的开关声，不是淡入
      sfx.add(S.click({ tone: 0.52, seed: 501 }), t, { gain: 0.55 });
      sfx.add(S.sub('B1', 0.30, { harm: 0.12 }), t, { gain: 0.34 });
      sfx.add(S.highpass(S.noise(0.05, 502), 2600), t + 0.004, { gain: 0.10 });
      sfx.add(S.reverseCymbal(0.75, { dur: 0.9, seed: 503 }), t - 0.5, { gain: 0.07 });   // 只留一丝空气
    },
    // 回车：木头 + 一点点低频
    enter: t => {
      sfx.add(S.click({ tone: 0.72, seed: 511 }), t, { gain: 0.60 });
      sfx.add(S.sub('B1', 0.22, { harm: 0.06 }), t, { gain: 0.30 });
    },
    // 依赖列表流出：一串很短的上行 tick
    deps: t => { for (let i = 0; i < 7; i++) sfx.add(S.tick({ tone: 1.05 + i * 0.06 }), t + i * 0.085, { gain: 0.10, pan: (i / 6 - 0.5) * 0.5 }); },
    // 绿 ✓：温暖上扬的两个音（五度上行），这是全片第一个「肯定」
    success: t => {
      sfx.add(S.mallet('B5', 1.4, { material: 'vibes', bright: 0.5 }), t, { gain: 0.34 });
      sfx.add(S.mallet('F#6', 1.6, { material: 'vibes', bright: 0.45 }), t + 0.10, { gain: 0.26 });
      sfx.add(S.sub('B2', 0.4, { harm: 0.10 }), t, { gain: 0.20 });
    },
    // Tab 点亮
    tab: t => { sfx.add(S.click({ tone: 1.05, seed: 521 }), t, { gain: 0.42 }); sfx.add(S.pop('B5', { decay: 0.06 }), t + 0.01, { gain: 0.20 }); },
    blip: t => sfx.add(S.blip('D6', 0.055), t, { gain: 0.16, pan: 0.12 }),
    tick: t => sfx.add(S.tick({ tone: 1.2 }), t, { gain: 0.18, pan: -0.14 }),
    // 裁决通过：全片第二处「肯定」，比 success 更实
    approve: t => {
      sfx.add(S.mallet('F#5', 1.3, { material: 'vibes', bright: 0.55 }), t, { gain: 0.32 });
      sfx.add(S.mallet('B5', 1.6, { material: 'vibes', bright: 0.5 }), t + 0.09, { gain: 0.28 });
      keys.add(S.keys([S.midi('B5'), S.midi('D6')], 2.0, { decay: 1.7, index: 2.0 }), t, { gain: 0.24 });
    },
    shimmer: t => sfx.add(S.shimmer(1.5, { root: 'B6', seed: 531, count: 7 }), t, { gain: 0.13 }),
    // 波形起音：她的声音第一次出现，柔和的气声推起
    wave: t => { sfx.add(S.whoosh(0.7, { from: 400, to: 2600, peak: 0.55, seed: 541 }), t - 0.35, { gain: 0.24 }); },
    // 波纹：一次很轻的低频扩散
    ripple: t => {
      sfx.add(S.pop('F#4', { decay: 0.12 }), t, { gain: 0.20 });
      sfx.add(S.sub('F#2', 0.5, { harm: 0.08 }), t, { gain: 0.16 });
    },
    // 琥珀金日志行：一个干净的、温的提示音（不是错误音）
    ear: t => {
      sfx.add(S.mallet('D6', 1.0, { material: 'glock', bright: 0.42 }), t, { gain: 0.26 });
      sfx.add(S.blip('A5', 0.09), t + 0.02, { gain: 0.12 });
    },
    // 新回合开启
    turn: t => sfx.add(S.swipe(0.28, { up: true, seed: 551 }), t, { gain: 0.20 }),
    // 时钟：B1 里唯一在动的东西。干、短、不带音高
    clock: t => {
      sfx.add(S.tick({ tone: 0.62 }), t, { gain: 0.10, pan: 0.10 });
      sfx.add(S.click({ tone: 0.48, seed: 540 }), t + 0.002, { gain: 0.06 });
    },
    // 察觉：一条极轻的上行，表示「她注意到了」
    notice: t => {
      sfx.add(S.blip('B5', 0.07), t, { gain: 0.13 });
      sfx.add(S.blip('D6', 0.07), t + 0.09, { gain: 0.11 });
    },
    // 决定：比 notice 更实，但仍克制
    decide: t => {
      sfx.add(S.mallet('F#5', 0.9, { material: 'vibes', bright: 0.34 }), t, { gain: 0.17 });
      sfx.add(S.sub('B2', 0.35, { harm: 0.10 }), t, { gain: 0.14 });
    },
    // 字段变化：一声很短的高频点，落在琥珀金闪的那一下
    field: t => {
      sfx.add(S.pop('D6', { decay: 0.06 }), t, { gain: 0.15 });
      sfx.add(S.tick({ tone: 1.3 }), t + 0.01, { gain: 0.10, pan: -0.14 });
    },
    // 她开口：不是 impact，是一次「气声推起来」——她的声音第一次主动出现
    speak: t => {
      sfx.add(S.whoosh(0.85, { from: 380, to: 2800, peak: 0.55, seed: 541 }), t - 0.42, { gain: 0.22 });
      sfx.add(S.vox([S.midi('B4'), S.midi('D5')], 1.6, { vowel: 'a', voices: 3, breath: 0.16 }), t, { gain: 0.14 });
    },
    // 同一个她：一句话在两个身体上，两声一模一样的音，只隔一点点
    twin: t => {
      sfx.add(S.mallet('B5', 1.1, { material: 'vibes', bright: 0.42 }), t, { gain: 0.17 });
      sfx.add(S.mallet('B5', 1.1, { material: 'vibes', bright: 0.42 }), t + 0.16, { gain: 0.13, pan: 0.4 });
    },
    // 灯亮：温暖的上行两音 + 一层很轻的嗡声（电流通过灯丝）
    light: t => {
      sfx.add(S.mallet('D5', 1.5, { material: 'vibes', bright: 0.46 }), t, { gain: 0.24 });
      sfx.add(S.mallet('A5', 1.8, { material: 'vibes', bright: 0.40 }), t + 0.10, { gain: 0.20 });
      sfx.add(S.organ([S.midi('D4')], 1.4, { drawbars: '800000000', click: 0.2, leslie: 0.25 }), t, { gain: 0.10 });
    },
    // 收束：一句长音，把这一镜的情绪收住
    warm: t => {
      pad.add(S.pad([S.midi('D4'), S.midi('F#4'), S.midi('B4')], 2.4, { cutoff: 1500, attack: 0.4, release: 1.8 }), t, { gain: 0.24 });
      keys.add(S.keys([S.midi('B4')], 2.6, { decay: 2.4, index: 1.5 }), t, { gain: 0.16 });
    },
    // 驳回：冷的两声下行，和 approve 的暖上行正好相对。这就是「你说了算」的另一半。
    reject: t => {
      sfx.add(S.mallet('G5', 0.9, { material: 'vibes', bright: 0.28 }), t, { gain: 0.18 });
      sfx.add(S.mallet('D5', 1.1, { material: 'vibes', bright: 0.22 }), t + 0.13, { gain: 0.16 });
      sfx.add(S.sub('B1', 0.4, { harm: 0.08 }), t, { gain: 0.12 });
    },
    // 硬切：抽真空。低频短暂消失 + 一下反镲，制造前后对比
    cut: t => {
      // 呼吸窗（T-1.5 拍 → T）必须真的是空的，所以这里不放任何提前起音的反向声。
      // 硬切的对比由「真空 → 一记短金属 + 低频落点」构成，两者都从 T 才开始。
      sfx.add(S.crash({ dur: 0.9, seed: 561 }), t, { gain: 0.16 });
      sfx.add(S.impact({ size: 0.35, seed: 562 }), t, { gain: 0.26 });
      sfx.add(S.highpass(S.noise(0.06, 563), 1800), t, { gain: 0.05 });
    },
    // 她的回复亮起：一个温柔的上行三音
    reply: t => {
      sfx.add(S.mallet('F#5', 1.2, { material: 'vibes', bright: 0.40 }), t, { gain: 0.22 });
      sfx.add(S.mallet('A5', 1.3, { material: 'vibes', bright: 0.38 }), t + 0.11, { gain: 0.20 });
      sfx.add(S.mallet('C#6', 1.5, { material: 'vibes', bright: 0.36 }), t + 0.22, { gain: 0.18 });
    },
    // 模型报错：低沉下沉，不刺耳
    fail: t => {
      sfx.add(S.downlifter(0.9, { from: 900, to: 150, seed: 571 }), t - 0.05, { gain: 0.24 });
      sfx.add(S.sub('D2', 0.8, { harm: 0.32 }), t, { gain: 0.26 });   // 73 Hz + 谐波，小喇叭也听得见
    },
    // 节点熄灭
    nodeoff: t => {
      sfx.add(S.pop('G3', { decay: 0.16 }), t, { gain: 0.20 });
      sfx.add(S.highpass(S.noise(0.05, 581), 2400), t, { gain: 0.06 });
    },
    // 金光滑行：有方向感的上滑 whoosh
    travel: t => {
      sfx.add(S.whoosh(0.95, { from: 300, to: 5200, peak: 0.62, seed: 591 }), t, { gain: 0.30 });
      sfx.add(S.shimmer(1.1, { root: 'B6', seed: 592, count: 5 }), t + 0.5, { gain: 0.10 });
    },
    // 链路重亮：第三个「肯定」，比前两个更饱满
    nodeon: t => {
      sfx.add(S.mallet('B5', 1.8, { material: 'vibes', bright: 0.52 }), t, { gain: 0.30 });
      sfx.add(S.mallet('D6', 1.8, { material: 'vibes', bright: 0.48 }), t + 0.08, { gain: 0.26 });
      sfx.add(S.mallet('F#6', 2.0, { material: 'vibes', bright: 0.44 }), t + 0.16, { gain: 0.22 });
    },
    // 四屏进场：四声同族，音高依次上行
    panel: t => sfx.add(S.pop('D5', { decay: 0.09 }), t, { gain: 0.15, pan: -0.3 }),
    // 圆点：极短、极轻，就是「她在」的一声
    dot: t => {
      sfx.add(S.blip('B6', 0.05), t, { gain: 0.14 });
      sfx.add(S.pop('B4', { decay: 0.10 }), t, { gain: 0.14 });
    },
    // 四屏合并：收敛的上升
    converge: t => {
      // 这两条必须在呼吸窗起点（T-1.5 拍）之前收干净，否则窗内前 0.5 s 是满的。
      sfx.add(S.riser(0.90, { from: 200, to: 2400, noise: 0.45, seed: 601 }), t - 0.98, { gain: 0.22 });
      sfx.add(S.whoosh(0.85, { from: 500, to: 3000, peak: 0.55, seed: 602 }), t - 0.92, { gain: 0.16 });
    },
    // 全片唯一一次 impact —— 留给第 7 镜的「一颗大脑」
    impact: t => {
      sfx.add(S.impact({ size: 0.85, seed: 611 }), t, { gain: 0.34 });
      sfx.add(S.kick({ tone: 46, decay: 0.5, click: 0.4 }), t, { gain: 0.55 });
      sfx.add(S.sub('B1', 1.2, { harm: 0.14 }), t, { gain: 0.34 });
      pad.add(S.pad([S.midi('B4'), S.midi('D5'), S.midi('F#5')], 2.2, { cutoff: 1400, attack: 0.02, release: 1.6 }), t, { gain: 0.20 });
      S.duck(t, 0.8);
    },
    // MIT 徽章：最后一个「肯定」，比之前都轻、都暖
    badge: t => {
      sfx.add(S.mallet('B5', 2.0, { material: 'vibes', bright: 0.40 }), t, { gain: 0.24 });
      sfx.add(S.mallet('F#6', 2.2, { material: 'vibes', bright: 0.34 }), t + 0.12, { gain: 0.18 });
      keys.add(S.keys([S.midi('B5')], 2.6, { decay: 2.2, index: 1.6 }), t, { gain: 0.18 });
    },
    // 结尾压暗：一次很长的低频消退
    fade: t => sfx.add(S.ambience(2.4, { kind: 'room', amount: 0.7, seed: 621 }), t, { gain: 0.07 }),
  };

  // 三个 DROPS 的重拍都必须比前一节响 —— 这是「呼吸」的另一半：抽空之后要有东西落下来。
  // 已有的 cue（approve / cut / impact）各配一记低频落点，量出来才成立。
  for (const drop of DROPS) {
    lowb.add(S.kick({ tone: 42, decay: 0.40, click: 0.28 }), drop, { gain: 0.52 });
    lowb.add(S.sub('B1', 0.8, { harm: 0.18 }), drop, { gain: 0.44 });
    bass.add(S.bass(S.midi('B2'), S.beat(0.8), { cutoff: 520, sub: 0.8, envAmt: 2.8, drive: 0.34 }), drop, { gain: 0.50 });
  }

  for (const c of CUES) {
    const fn = cueSnd[c.sfx];
    if (fn) fn(c.t);
    else console.warn('[score] no sound designed for cue', c.sfx);
  }

  // 侧链：keys 与 low 跟着 low 的进入点轻轻避让，让键盘声始终清楚
  for (let bar = 0; bar < bars; bar++) {
    const t = S.bar(bar);
    if (t >= DUR) break;
    if (densityAt(t) > 0.55) S.duck(t, 0.34);
  }
}