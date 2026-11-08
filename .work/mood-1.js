// packages/dsh-anima/lib/mood.js
export const MOOD_LABELS = ['很好', '不错', '平静', '低落', '很差'];
export const BASELINE = { valence: 0.1, arousal: 0.35 };

const POSITIVE_WORDS = [
  '开心', '喜欢', '谢谢', '好棒', '抱抱', '想你', '太好了', '嘿嘿', '哈哈',
];
const NEGATIVE_WORDS = [
  '累', '烦', '难过', '生气', '讨厌', '失望', '疼', '加班', '崩溃', '不想说话',
];
const CALM_WORDS = [
  '睡', '安静', '慢慢', '没事', '还好',
];
const NEGATION_PREFIXES = ['不', '没', '别', '不太'];

function clamp(value, min = -1, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function normalizeArousal(value) {
  return Math.min(Math.max(value, 0), 1);
}

function parseText(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [];
  }
  
  const cleanText = text.trim();
  const hits = [];
  
  const positiveRegex = new RegExp(`(${POSITIVE_WORDS.join('|')})`, 'g');
  const negativeRegex = new RegExp(`(${NEGATIVE_WORDS.join('|')})`, 'g');
  const calmRegex = new RegExp(`(${CALM_WORDS.join('|')})`, 'g');
  
  let match;
  
  while ((match = positiveRegex.exec(cleanText)) !== null) {
    const word = match[1];
    const prefix = getNegationPrefix(cleanText, match.index);
    const kind = prefix ? 'negative' : 'positive';
    const weight = 0.2;
    hits.push({ word, kind, weight, index: match.index });
  }
  
  while ((match = negativeRegex.exec(cleanText)) !== null) {
    const word = match[1];
    const prefix = getNegationPrefix(cleanText, match.index);
    const kind = prefix ? 'positive' : 'negative';
    const weight = 0.2;
    hits.push({ word, kind, weight, index: match.index });
  }
  
  while ((match = calmRegex.exec(cleanText)) !== null) {
    const word = match[1];
    const prefix = getNegationPrefix(cleanText, match.index);
    const kind = prefix ? 'positive' : 'calm';
    const weight = 0.1;
    hits.push({ word, kind, weight, index: match.index });
  }
  
  const exclamationCount = (cleanText.match(/!+/g) || []).reduce((sum, seq) => sum + seq.length, 0);
  const questionCount = (cleanText.match(/\\?+/g) || []).reduce((sum, seq) => sum + seq.length, 0);
  const totalPunct = exclamationCount + questionCount;
  const arousalBoost = Math.min(totalPunct * 0.05, 0.3);
  
  return { hits, arousalBoost };
}

function getNegationPrefix(text, wordIndex) {
  const prefixLength = 2;
  const start = Math.max(0, wordIndex - prefixLength);
  const prefix = text.slice(start, wordIndex);
  
  return NEGATION_PREFIXES.includes(prefix) ? prefix : null;
}

export function analyzeMessage(text, opts = {}) {
  const { repeatCount = 1 } = opts;
  const { hits, arousalBoost } = parseText(text);
  
  let valence = 0;
  let arousal = arousalBoost;
  
  hits.forEach(hit => {
    const { kind, weight } = hit;
    let effect = weight;
    
    if (kind === 'negative') {
      effect = -weight;
      arousal += weight * 0.1;
    } else if (kind === 'calm') {
      effect = -weight * 0.5;
      arousal -= weight * 0.05;
    }
    
    if (hit.kind === 'negative' && repeatCount > 1) {
      const multiplier = Math.min(repeatCount, 3);
      effect *= multiplier;
    }
    
    valence += effect;
  });
  
  valence = clamp(valence);
  arousal = normalizeArousal(arousal);
  
  return { valence, arousal, hits: hits.map(({ word, kind, weight }) => ({ word, kind, weight })) };
}

export function emptyMood(nowIso) {
  const now = new Date(nowIso);
  return {
    valence: BASELINE.valence,
    arousal: BASELINE.arousal,
    since: nowIso,
    lastAt: nowIso,
    lastReason: '',
    topHits: [],
  };
}

function updateLastReason(state, hits) {
  if (hits.length === 0) {
    return '最近没什么特别的话';
  }
  
  const maxHit = hits.reduce((max, hit) => {
    const absWeight = Math.abs(hit.weight);
    return absWeight > Math.abs(max.weight) ? hit : max;
  }, hits[0]);
  
  return `因为你说到「${maxHit.word}」`;
}

export function reduceMood(state, event, nowIso) {
  const newState = { ...state };
  
  switch (event.type) {
    case 'message': {
      const signal = analyzeMessage(event.text, { repeatCount: 1 });
      const timeDiff = calculateMinuteDiff(state.lastAt, nowIso);
      
      let newValence = state.valence * 0.7 + signal.valence * 0.6 + BASELINE.valence * 0.15;
      let newArousal = state.arousal * 0.7 + Math.max(signal.arousal, 0) * 0.6 + BASELINE.arousal * 0.15;
      
      if (timeDiff > 30) {
        newArousal -= 0.05;
      }
      
      newValence = clamp(newValence);
      newArousal = normalizeArousal(newArousal);
      
      newState.valence = newValence;
      newState.arousal = newArousal;
      newState.lastAt = nowIso;
      newState.lastReason = updateLastReason(state, signal.hits);
      newState.topHits = signal.hits.slice(0, 3);
      break;
    }
    
    case 'reply': {
      newState.arousal = newState.arousal * 0.9 + BASELINE.arousal * 0.1;
      break;
    }
    
    case 'tick': {
      const timeDiff = calculateMinuteDiff(state.lastAt, nowIso);
      if (timeDiff > 0) {
        const decayRate = Math.min(timeDiff * 0.03, 0.5);
        newState.valence = state.valence + (BASELINE.valence - state.valence) * decayRate;
        newState.arousal = state.arousal + (BASELINE.arousal - state.arousal) * decayRate;
        newState.lastAt = nowIso;
      }
      break;
    }
    
    case 'goodnight': {
      newState.valence = clamp(state.valence + 0.05);
      newState.arousal = 0.15;
      break;
    }
    
    case 'goodmorning': {
      newState.arousal = BASELINE.arousal + 0.05;
      break;
    }
    
    default: {
      return state;
    }
  }
  
  return newState;
}

function calculateMinuteDiff(prevTime, nowTime) {
  try {
    const prev = new Date(prevTime);
    const now = new Date(nowTime);
    const diffMs = now - prev;
    return Math.floor(diffMs / (1000 * 60));
  } catch (e) {
    return 0;
  }
}

export function valenceLabel(valence) {
  if (typeof valence !== 'number') return MOOD_LABELS[4];
  
  if (valence >= 0.5) return MOOD_LABELS[0];
  if (valence >= 0.15) return MOOD_LABELS[1];
  if (valence > -0.15) return MOOD_LABELS[2];
  if (valence > -0.5) return MOOD_LABELS[3];
  return MOOD_LABELS[4];
}

export function describeMood(state, nowIso) {
  const label = valenceLabel(state.valence);
  let arousalDesc = '';
  
  if (state.arousal >= 0.7) {
    arousalDesc = '心跳有点快';
  } else if (state.arousal >= 0.45) {
    arousalDesc = '还算有精神';
  } else {
    arousalDesc = '感觉很安静';
  }
  
  const reason = state.lastReason ? `——${state.lastReason}` : '——最近没什么特别的话';
  return `她心情${label}，${arousalDesc}${reason}`;
}

export function suggestMusic(state, nowIso) {
  let tag = '日常';
  let why = '平常';
  
  if (state.valence < -0.15 && state.arousal >= 0.5) {
    tag = '宣泄';
    why = '她这会儿需要一点响的，先把情绪放出去';
  } else if (state.valence < -0.15 && state.arousal <  0_5) {
    tag = '安静';
    why = '不想吵';
  } else if (state.valence >= 0.3 && state.arousal >= 0.5) {
    tag = '轻快';
    why = '高兴';
  } else if (state.valence >= 0.3 && state.arousal < 0.5) {
    tag = '温暖';
    why = '慢一点';
  }
  
  return { tag, why };
}
