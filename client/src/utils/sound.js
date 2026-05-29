// Procedural western sound effects using the Web Audio API — no asset files needed.
let ctx = null;
let enabled = true;

function getCtx() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setSoundEnabled(v) { enabled = v; }
export function isSoundEnabled() { return enabled; }

// Generic tone with envelope
function tone({ freq = 440, type = 'sine', dur = 0.2, gain = 0.2, slideTo = null, delay = 0 }) {
  const c = getCtx();
  if (!c || !enabled) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(c.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

// Noise burst (for gunshot)
function noiseBurst({ dur = 0.18, gain = 0.4, delay = 0, lowpass = 1800 }) {
  const c = getCtx();
  if (!c || !enabled) return;
  const t0 = c.currentTime + delay;
  const bufferSize = Math.floor(c.sampleRate * dur);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(lowpass, t0);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter); filter.connect(g); g.connect(c.destination);
  src.start(t0); src.stop(t0 + dur + 0.05);
}

export const sfx = {
  // Gunshot: sharp noise burst + low thump
  gunshot() {
    noiseBurst({ dur: 0.22, gain: 0.5, lowpass: 2200 });
    tone({ freq: 120, type: 'sine', dur: 0.18, gain: 0.35, slideTo: 40 });
  },
  // Click of an empty chamber
  click() {
    tone({ freq: 1200, type: 'square', dur: 0.04, gain: 0.15 });
    tone({ freq: 600, type: 'square', dur: 0.05, gain: 0.1, delay: 0.03 });
  },
  // Cylinder spin: rapid ticks
  spin() {
    for (let i = 0; i < 8; i++) {
      tone({ freq: 800 + i * 30, type: 'square', dur: 0.03, gain: 0.08, delay: i * 0.06 });
    }
  },
  // Coin / chime for a vote or selection
  chime() {
    tone({ freq: 880, type: 'triangle', dur: 0.15, gain: 0.18 });
    tone({ freq: 1320, type: 'triangle', dur: 0.2, gain: 0.12, delay: 0.05 });
  },
  // Soft tick for clock under 5s
  tick() {
    tone({ freq: 1000, type: 'square', dur: 0.03, gain: 0.08 });
  },
  // Day breaks: rising warm tone
  dawn() {
    tone({ freq: 330, type: 'sine', dur: 0.5, gain: 0.18, slideTo: 523 });
    tone({ freq: 392, type: 'sine', dur: 0.6, gain: 0.12, slideTo: 659, delay: 0.1 });
  },
  // Night falls: descending eerie tone
  dusk() {
    tone({ freq: 392, type: 'sine', dur: 0.6, gain: 0.16, slideTo: 196 });
    tone({ freq: 523, type: 'sine', dur: 0.7, gain: 0.1, slideTo: 262, delay: 0.1 });
  },
  // Victory fanfare
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, type: 'triangle', dur: 0.3, gain: 0.18, delay: i * 0.12 }));
  },
  // Loss: somber descending
  lose() {
    [392, 330, 262, 196].forEach((f, i) =>
      tone({ freq: f, type: 'sawtooth', dur: 0.35, gain: 0.14, delay: i * 0.15 }));
  },
  // Chat message blip
  blip() {
    tone({ freq: 660, type: 'sine', dur: 0.06, gain: 0.08 });
  },
  // Player joined
  hoof() {
    tone({ freq: 180, type: 'sine', dur: 0.08, gain: 0.15 });
    tone({ freq: 160, type: 'sine', dur: 0.08, gain: 0.12, delay: 0.1 });
  },
  // Showdown sting
  showdown() {
    tone({ freq: 220, type: 'sawtooth', dur: 0.8, gain: 0.2, slideTo: 440 });
    noiseBurst({ dur: 0.1, gain: 0.2, delay: 0.6 });
  },
};
