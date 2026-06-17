// Web Audio 程式合成的音效與背景音樂（無外部素材、可商用）。
// node 測試不會載入此檔；所有 API 皆在瀏覽器端、首次互動才建立 AudioContext。

let ctx = null;
let master = null;
let musicGain = null;
let muted = false;
let musicTimer = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.18;
  musicGain.connect(master);
  try { muted = JSON.parse(localStorage.getItem('kd-muted')) ?? false; } catch {}
  master.gain.value = muted ? 0 : 0.9;
  return ctx;
}

// 瀏覽器自動播放政策：首次使用者互動時恢復 context
export function resumeAudio() {
  ensure();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

// ---- 合成基本元件 ----
function tone(freq, t0, dur, { type = 'sine', vol = 0.3, to = freq, glide = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (to !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + (glide || dur));
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(t0, dur, { vol = 0.3, filt = 1200, type = 'lowpass', q = 1 } = {}) {
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = filt; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur + 0.02);
}

// ---- 各音效 ----
const SFX = {
  arrow(t) { tone(880, t, 0.12, { type: 'triangle', vol: 0.18, to: 1500, glide: 0.05 }); noise(t, 0.05, { vol: 0.06, filt: 4000, type: 'highpass' }); },
  cannon(t) { noise(t, 0.28, { vol: 0.45, filt: 700 }); tone(90, t, 0.22, { type: 'sine', vol: 0.4, to: 45 }); },
  magic(t) { tone(520, t, 0.22, { type: 'sine', vol: 0.22, to: 1040, glide: 0.18 }); tone(780, t, 0.22, { type: 'sine', vol: 0.12, to: 1560, glide: 0.18 }); },
  tesla(t) { noise(t, 0.16, { vol: 0.28, filt: 5000, type: 'bandpass', q: 6 }); tone(1600, t, 0.1, { type: 'sawtooth', vol: 0.1, to: 600 }); },
  poison(t) { tone(300, t, 0.2, { type: 'sine', vol: 0.18, to: 160 }); noise(t, 0.18, { vol: 0.07, filt: 900 }); },
  hit(t) { noise(t, 0.04, { vol: 0.12, filt: 2500, type: 'highpass' }); },
  death(t) { tone(420, t, 0.22, { type: 'square', vol: 0.16, to: 90 }); noise(t, 0.18, { vol: 0.18, filt: 1400 }); },
  coin(t) { tone(1320, t, 0.07, { type: 'square', vol: 0.12 }); tone(1760, t + 0.06, 0.1, { type: 'square', vol: 0.12 }); },
  build(t) { tone(180, t, 0.12, { type: 'square', vol: 0.3, to: 120 }); noise(t, 0.08, { vol: 0.12, filt: 600 }); },
  upgrade(t) { [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.05, 0.18, { type: 'triangle', vol: 0.18 })); },
  sell(t) { [784, 587, 392].forEach((f, i) => tone(f, t + i * 0.05, 0.16, { type: 'triangle', vol: 0.16 })); },
  click(t) { tone(660, t, 0.05, { type: 'square', vol: 0.14 }); },
  wave(t) { tone(330, t, 0.4, { type: 'sawtooth', vol: 0.16, to: 415, glide: 0.3 }); tone(247, t, 0.4, { type: 'sawtooth', vol: 0.12, to: 311, glide: 0.3 }); },
  lifeLost(t) { tone(200, t, 0.3, { type: 'sine', vol: 0.28, to: 120 }); },
  win(t) { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.11, 0.4, { type: 'triangle', vol: 0.22 })); },
  lose(t) { [392, 330, 262, 196].forEach((f, i) => tone(f, t + i * 0.16, 0.5, { type: 'sine', vol: 0.26 })); },
};

let lastFire = 0;
export function sfx(name) {
  if (!ensure() || muted) return;
  if (ctx.state === 'suspended') ctx.resume();
  // 同類射擊音效節流，避免一波齊射爆音
  const t = ctx.currentTime;
  if (['arrow', 'cannon', 'magic', 'tesla', 'poison', 'hit'].includes(name)) {
    if (t - lastFire < 0.035) return;
    lastFire = t;
  }
  const fn = SFX[name];
  if (fn) try { fn(t + 0.005); } catch {}
}

// ---- 背景音樂：輕柔循環和弦 ----
const PROG = [ [220, 277, 330], [196, 247, 294], [165, 220, 262], [247, 311, 370] ]; // Am G F Em-ish
let bar = 0;
function scheduleBar() {
  if (!ctx || muted) return;
  const t = ctx.currentTime + 0.1;
  const chord = PROG[bar % PROG.length];
  chord.forEach(f => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + 2.4);
    o.connect(g); g.connect(musicGain);
    o.start(t); o.stop(t + 2.5);
  });
  // 簡單琶音點綴
  const arp = [chord[0] * 2, chord[2] * 2, chord[1] * 2, chord[2] * 2];
  arp.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    const tt = t + 0.3 + i * 0.55;
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(0.22, tt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.5);
    o.connect(g); g.connect(musicGain);
    o.start(tt); o.stop(tt + 0.55);
  });
  bar++;
}

export function startMusic() {
  if (!ensure() || musicTimer) return;
  if (ctx.state === 'suspended') ctx.resume();
  scheduleBar();
  musicTimer = setInterval(scheduleBar, 2400);
}
export function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

export function toggleMute() {
  ensure();
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.9;
  try { localStorage.setItem('kd-muted', JSON.stringify(muted)); } catch {}
  return muted;
}
export function isMuted() {
  try { return JSON.parse(localStorage.getItem('kd-muted')) ?? false; } catch { return false; }
}
