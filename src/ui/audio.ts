// Sound and haptics. Every cue is synthesised with Web Audio when it is needed: there are no files.
//
// Signal path: each cue -> bus -> compressor (acts as a soft limiter) -> master gain -> speakers.
// The master gain is low and every cue's peak is small, so nothing here can be loud.
// The AudioContext is made on the first press or key (browsers refuse to start one earlier), is
// suspended while the tab is hidden, and is not made at all while the player has sound switched off.
//
// This file knows nothing about the game: feel.ts decides when a cue plays.

const MUTE_KEY = 'flowstate-mute';
/** Gain after the compressor. Cue peaks below are before it. */
const MASTER = 0.5;
/** No more cues than this may start in any one second; the important ones get a little headroom. */
const MAX_PER_SECOND = 8;
const MAX_PER_SECOND_HARD = 12;

let ac: AudioContext | null = null;
let bus: GainNode | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
/** The player has pressed something, so a context may be started. */
let gesture = false;
let resuming = false;
let recorder: (kind: 'cue' | 'haptic', name: string, detail?: string | number) => void = () => {};

// ---------- context ----------

function ensure(): AudioContext | null {
  if (ac) {
    wake();
    return ac;
  }
  const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ac = new AC({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
  bus = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 6;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  master = ac.createGain();
  master.gain.value = MASTER;
  bus.connect(comp);
  comp.connect(master);
  master.connect(ac.destination);
  // One second of white noise, shared by every click and whoosh.
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  wake();
  return ac;
}

/** Resume a context the browser has parked (it starts suspended until a gesture; phones suspend it on a call). */
function wake() {
  if (!ac || ac.state !== 'suspended' || resuming || document.hidden || muted) return;
  resuming = true;
  ac.resume().catch(() => {}).then(() => (resuming = false));
}

function onGesture() {
  gesture = true;
  if (!muted) ensure();
}

/** The context, if a cue started now would be heard. */
function live(): AudioContext | null {
  if (muted || !ac || document.hidden) return null;
  return ac.state === 'running' || (ac.state === 'suspended' && resuming) ? ac : null;
}

export function initAudio(record: typeof recorder) {
  recorder = record;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    muted = false;
  }
  // Capture phase, so nothing that stops the event further down can keep the sound locked.
  window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
  window.addEventListener('keydown', onGesture, { capture: true });
  // iOS only counts the end of a touch as the gesture that may start audio.
  window.addEventListener('touchend', onGesture, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) {
      droneOff(0.05);
      void ac.suspend().catch(() => {});
    } else wake();
  });
}

export const isMuted = () => muted;

export function setMuted(on: boolean) {
  muted = on;
  try {
    localStorage.setItem(MUTE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: the choice lasts until the page is closed */
  }
  if (on) {
    droneOff(0.05);
    if (ac && master) {
      master.gain.setTargetAtTime(0, ac.currentTime, 0.015);
      const ctx = ac;
      setTimeout(() => {
        if (muted) void ctx.suspend().catch(() => {});
      }, 120);
    }
  } else if (gesture) {
    const ctx = ensure();
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(MASTER, ctx.currentTime, 0.015);
    }
  }
}

/** For tests: is there a context, is it running, how busy is it. */
export function audioState() {
  prune(performance.now());
  return {
    exists: !!ac, state: ac ? ac.state : 'none', muted, gesture, drone: droneOn,
    sampleRate: ac?.sampleRate ?? 0, cuesLastSecond: recent.length, master: MASTER,
  };
}

// ---------- how often ----------

const recent: number[] = [];
const lastAt: Record<string, number> = {};

function prune(now: number) {
  while (recent.length && now - recent[0] > 1000) recent.shift();
}

/**
 * May this cue start now? `gap` is the least time (ms) since the same cue last started. Everyday cues
 * give way once the second is full; `important` ones (a claim, a celebration) may still squeeze in.
 */
function admit(name: string, gap: number, important = false, detail?: string | number): AudioContext | null {
  const ctx = live();
  if (!ctx) return null;
  const now = performance.now();
  if (now - (lastAt[name] ?? -1e9) < gap) return null;
  prune(now);
  if (recent.length >= (important ? MAX_PER_SECOND_HARD : MAX_PER_SECOND)) return null;
  recent.push(now);
  lastAt[name] = now;
  recorder('cue', name, detail);
  return ctx;
}

// ---------- building blocks ----------

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

interface ToneOpts {
  /** Glide to this frequency over `glide` seconds (default: the whole note). */
  to?: number;
  glide?: number;
  /** -1 (left) to 1 (right). */
  pan?: number;
}

/** One oscillator with a fast-attack, exponential-decay envelope. `peak` is its gain into the bus. */
function tone(ctx: AudioContext, type: OscillatorType, freq: number, t: number, peak: number, attack: number, decay: number, o?: ToneOpts) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (o?.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.glide ?? attack + decay));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  osc.connect(g);
  let out: AudioNode = g;
  if (o?.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    g.connect(p);
    out = p;
  }
  out.connect(bus!);
  osc.start(t);
  osc.stop(t + attack + decay + 0.03);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
    if (out !== g) out.disconnect();
  };
}

/** A burst of filtered noise. */
function noise(ctx: AudioContext, t: number, peak: number, attack: number, decay: number, filter: BiquadFilterType, freq: number, q = 0.8, sweepTo?: number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + decay);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  src.connect(f);
  f.connect(g);
  g.connect(bus!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + decay + 0.03);
  src.onended = () => {
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
}

/** A small bell: a sine with two quieter, shorter partials above it. */
function bell(ctx: AudioContext, freq: number, t: number, peak: number, decay: number, pan?: number) {
  tone(ctx, 'sine', freq, t, peak, 0.004, decay, { pan });
  tone(ctx, 'sine', freq * 2, t, peak * 0.25, 0.003, decay * 0.5, { pan });
  tone(ctx, 'triangle', freq * 3.01, t, peak * 0.08, 0.002, decay * 0.25, { pan });
}

/** A plucked note: triangle with a sine an octave up. */
function pluck(ctx: AudioContext, midi: number, t: number, peak: number, decay = 0.5, pan?: number) {
  tone(ctx, 'triangle', hz(midi), t, peak, 0.005, decay, { pan });
  tone(ctx, 'sine', hz(midi + 12), t, peak * 0.3, 0.004, decay * 0.6, { pan });
}

/** A soft chord of sines. */
function pad(ctx: AudioContext, midis: number[], t: number, peak: number, attack: number, decay: number) {
  for (const m of midis) tone(ctx, 'sine', hz(m), t, peak, attack, decay);
}

// ---------- everyday cues ----------

/** Steps of a major scale, in semitones: each connection in a run sounds one step higher. */
const RUN = [0, 2, 4, 5, 7, 9, 11, 12];
const RUN_WINDOW = 4000;
let run = 0;
let lastConnect = -1e9;

/** A wire snapped on: a click, then a low "thock" with a faint high tap on top. Rises through a run of connections. */
export function cueConnect() {
  const now = performance.now();
  const next = now - lastConnect < RUN_WINDOW ? Math.min(run + 1, RUN.length - 1) : 0;
  const ctx = admit('connect', 50, false, next);
  if (!ctx) return;
  run = next;
  lastConnect = now;
  const k = 2 ** (RUN[run] / 12);
  const t = ctx.currentTime + 0.004;
  noise(ctx, t, 0.09, 0.001, 0.018, 'highpass', 2500);
  tone(ctx, 'sine', 300 * k, t + 0.012, 0.22, 0.004, 0.13, { to: 130 * k, glide: 0.09 });
  tone(ctx, 'triangle', 880 * k, t + 0.012, 0.045, 0.002, 0.09);
}

/** Pentatonic steps above C5: whatever the mix of sales, the ticks are in tune with each other. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const C5 = 523.25;

function tick(ctx: AudioContext, step: number, t: number, peak: number) {
  const f = C5 * 2 ** (PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12);
  tone(ctx, 'sine', f, t, peak, 0.003, 0.07);
  tone(ctx, 'triangle', f * 2, t, peak * 0.22, 0.002, 0.04);
}

/** Pitch step for a sale worth `amount` credits: about one step for every doubling. */
export const saleStep = (amount: number) => Math.max(0, Math.min(PENTA.length - 1, Math.round(Math.log2(1 + Math.max(0, amount)) * 1.25) - 1));

/**
 * What the Markets sold in the last second, as credits per Market. However many Markets there are,
 * at most three soft ticks are played, low to high and a moment apart: a patter, never a buzz.
 */
export function cueSales(amounts: number[]) {
  if (!amounts.length || !live()) return;
  const steps = [...new Set(amounts.map(saleStep))].sort((a, b) => a - b);
  const picked = steps.length <= 3 ? steps : [steps[0], steps[steps.length >> 1], steps[steps.length - 1]];
  const now = performance.now();
  // One batch a second: a second batch inside 600 ms (two games in one page, a test poking signals) is dropped.
  if (now - (lastAt.saleBatch ?? -1e9) < 600) return;
  lastAt.saleBatch = now;
  picked.forEach((step, i) => {
    const ctx = admit('sale', 0, false, step);
    if (ctx) tick(ctx, step, ctx.currentTime + 0.005 + i * 0.085, 0.05);
  });
}

/** Something was bought or placed: a low thump. */
export function cuePlace() {
  const ctx = admit('place', 80);
  if (!ctx) return;
  const t = ctx.currentTime + 0.004;
  tone(ctx, 'sine', 150, t, 0.24, 0.005, 0.16, { to: 55, glide: 0.12 });
  noise(ctx, t, 0.06, 0.002, 0.05, 'lowpass', 500);
}

/** A reward claimed or something unlocked: a bright two-note chime, a fourth apart. */
export function cueClaim() {
  const ctx = admit('claim', 120, true);
  if (!ctx) return;
  const t = ctx.currentTime + 0.004;
  bell(ctx, hz(88), t, 0.1, 0.45);
  bell(ctx, hz(93), t + 0.09, 0.11, 0.6);
}

/** Something on the hotbar can now be afforded: one soft bell. */
export function cueAfford() {
  const ctx = admit('afford', 400);
  if (!ctx) return;
  const t = ctx.currentTime + 0.004;
  tone(ctx, 'sine', hz(84), t, 0.07, 0.005, 0.7);
  tone(ctx, 'sine', hz(84) * 2.76, t, 0.014, 0.003, 0.3);
}

/** A refusal: a short dull knock. */
export function cueError() {
  const ctx = admit('error', 250);
  if (!ctx) return;
  const t = ctx.currentTime + 0.004;
  tone(ctx, 'triangle', 120, t, 0.16, 0.003, 0.09, { to: 85 });
  noise(ctx, t, 0.05, 0.002, 0.04, 'lowpass', 300);
}

/** A goal or an order is ready to claim: two soft rising notes, lower and rounder than the claim chime. */
export function cueReady() {
  const ctx = admit('ready', 500, true);
  if (!ctx) return;
  const t = ctx.currentTime + 0.004;
  bell(ctx, hz(79), t, 0.07, 0.4);
  bell(ctx, hz(84), t + 0.12, 0.08, 0.6);
}

/** Coins or Data landing on a counter: `n` quick ticks, each a step higher than the last. */
export function cuePayout(n: number, from = 3) {
  const ctx = admit('payout', 150, true, n);
  if (!ctx) return;
  const t = ctx.currentTime + 0.004;
  for (let i = 0; i < n; i++) tick(ctx, from + i, t + i * 0.045, 0.06);
}

// ---------- celebrations ----------

export type Fanfare = 'shard' | 'lab' | 'glyph' | 'flow' | 'lens';

/**
 * The big moments, in three sizes: small (first Shard, and the Lab a little longer), medium (first
 * Glyph: two lines, one falling and one rising, that meet on one note and open into a chord), and
 * large (the first Lens; see also cueBowNote, which plays while the factory lights up before it).
 * The first Flow State is not a fanfare at all but a slow swell.
 */
export function cueFanfare(kind: Fanfare) {
  const ctx = admit('fanfare-' + kind, 800, true);
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  switch (kind) {
    case 'shard':
      // C major, up the chord: about 1.5 s.
      [72, 76, 79, 84].forEach((m, i) => pluck(ctx, m, t + [0, 0.09, 0.18, 0.3][i], 0.09, 0.55));
      pluck(ctx, 88, t + 0.44, 0.05, 0.7);
      pad(ctx, [60, 67], t, 0.035, 0.05, 1.3);
      break;
    case 'lab':
      // The same shape a tone higher, with two more notes on top: about 1.9 s.
      [74, 78, 81, 86].forEach((m, i) => pluck(ctx, m, t + [0, 0.09, 0.18, 0.3][i], 0.09, 0.55));
      pluck(ctx, 90, t + 0.44, 0.06, 0.7);
      pluck(ctx, 93, t + 0.58, 0.05, 0.9);
      pad(ctx, [62, 69, 74], t, 0.033, 0.05, 1.7);
      break;
    case 'glyph': {
      // Two streams: one falls from the left, one climbs from the right; they meet on G and bloom. About 2.7 s.
      const fall = [88, 86, 84, 83, 81], climb = [67, 69, 71, 72, 74];
      for (let i = 0; i < 5; i++) {
        const pan = 0.7 - i * 0.15;
        pluck(ctx, fall[i], t + i * 0.11, 0.07, 0.3, -pan);
        pluck(ctx, climb[i], t + i * 0.11, 0.08, 0.3, pan);
      }
      const m = t + 0.62;
      pluck(ctx, 79, m, 0.12, 0.9);
      tone(ctx, 'sine', 98, m, 0.2, 0.006, 0.4, { to: 49 });
      pad(ctx, [55, 62, 67, 71, 74, 81], m, 0.04, 0.03, 1.9);
      [79, 83, 86, 91].forEach((n, i) => bell(ctx, hz(n), m + 0.16 + i * 0.105, 0.06, 0.8));
      break;
    }
    case 'flow':
      // No attack anywhere: two sines glide up an octave, a soft high chord opens over them, and a breath of air. About 3 s.
      tone(ctx, 'sine', 196, t, 0.07, 0.5, 2.2, { to: 392, glide: 1.4 });
      tone(ctx, 'sine', 293.66, t, 0.045, 0.6, 2.2, { to: 587.33, glide: 1.4 });
      pad(ctx, [74, 79, 81, 86], t + 1.2, 0.03, 0.4, 1.8);
      noise(ctx, t, 0.012, 0.8, 1.4, 'bandpass', 2000, 0.7, 4000);
      break;
    case 'lens':
      // The biggest: a low thump, a wide major ninth, bells running up it twice, and a shimmer of air. About 3.5 s.
      tone(ctx, 'sine', 110, t, 0.24, 0.008, 0.6, { to: 41 });
      pad(ctx, [48, 55, 60, 64, 67, 71, 74], t, 0.05, 0.06, 2.8);
      [84, 88, 91, 96].forEach((n, i) => bell(ctx, hz(n), t + 0.1 + i * 0.105, 0.07, 0.9));
      [91, 96, 100].forEach((n, i) => bell(ctx, hz(n), t + 0.9 + i * 0.13, 0.045, 1.1));
      pad(ctx, [60, 67, 72, 76], t + 1.3, 0.03, 0.5, 2.0);
      noise(ctx, t + 0.05, 0.02, 0.3, 1.6, 'highpass', 6000);
      break;
  }
}

/** Notes for the factory's bow before the Lens fanfare: C major pentatonic, climbing. */
const BOW = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];

/** One step of the bow: `i` of `n` (0-based). Call as each row of the factory lights up. */
export function cueBowNote(i: number, n: number) {
  const ctx = admit('bow', 40, true, i);
  if (!ctx) return;
  const idx = Math.round((i / Math.max(1, n - 1)) * (BOW.length - 1));
  pluck(ctx, BOW[Math.max(0, Math.min(BOW.length - 1, idx))], ctx.currentTime + 0.005, 0.07, 0.4);
}

/** The start of the bow: a soft rush of air sweeping upwards. */
export function cueWhoosh() {
  const ctx = admit('whoosh', 500, true);
  if (ctx) noise(ctx, ctx.currentTime + 0.005, 0.03, 0.35, 0.6, 'bandpass', 500, 1.2, 3500);
}

// ---------- Flow State ----------

/** Entering Flow State (after the first time, which gets the 'flow' fanfare): a short rising tone. */
export function cueFlowIn() {
  const ctx = admit('flow-in', 2000, true);
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  tone(ctx, 'sine', 196, t, 0.05, 0.3, 1.0, { to: 293.66, glide: 0.9 });
  tone(ctx, 'sine', 293.66, t, 0.03, 0.3, 1.0, { to: 440, glide: 0.9 });
}

/** Peak gain of the whole drone into the bus. */
const DRONE_LEVEL = 0.03;
let droneOn = false;
let drone: { gain: GainNode; stop: () => void } | null = null;
let droneTimer = 0;

/**
 * The hum of a factory in Flow State: G and the D above it, the low G doubled a hair sharp so it
 * beats slowly, through a low-pass, swelling and sinking a little every eight seconds.
 * Fades in over about two seconds and out over `fade` seconds (the time constant; three of them to silence).
 */
export function setDrone(on: boolean, fade = 0.8) {
  if (on === droneOn) return;
  if (!on) return droneOff(fade);
  const ctx = live();
  if (!ctx) return;
  droneOn = true;
  recorder('cue', 'drone-on');
  clearTimeout(droneTimer);
  if (!drone) {
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const oscs: OscillatorNode[] = [];
    const voice = (type: OscillatorType, f: number, level: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.value = level;
      o.connect(g);
      g.connect(lp);
      o.start();
      oscs.push(o);
    };
    voice('sine', 98, 1);
    voice('sine', 98.45, 0.7);
    voice('sine', 146.83, 0.6);
    voice('triangle', 196, 0.18);
    // A very slow swell, so the hum breathes.
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.125;
    depth.gain.value = DRONE_LEVEL * 0.25;
    lfo.connect(depth);
    depth.connect(gain.gain);
    lfo.start();
    oscs.push(lfo);
    lp.connect(gain);
    gain.connect(bus!);
    drone = {
      gain,
      stop: () => {
        for (const o of oscs) {
          try {
            o.stop();
          } catch {
            /* already stopped */
          }
          o.disconnect();
        }
        lp.disconnect();
        depth.disconnect();
        gain.disconnect();
      },
    };
  }
  drone.gain.gain.cancelScheduledValues(ctx.currentTime);
  drone.gain.gain.setTargetAtTime(DRONE_LEVEL, ctx.currentTime, 0.7);
}

function droneOff(fade: number) {
  if (!droneOn) return;
  droneOn = false;
  recorder('cue', 'drone-off');
  const d = drone;
  if (!d || !ac) return;
  d.gain.gain.cancelScheduledValues(ac.currentTime);
  d.gain.gain.setTargetAtTime(0.0001, ac.currentTime, fade);
  clearTimeout(droneTimer);
  // Take the oscillators away once it can no longer be heard (unless it has been switched on again).
  droneTimer = window.setTimeout(() => {
    if (droneOn || drone !== d) return;
    d.stop();
    drone = null;
  }, fade * 5000 + 200);
}

// ---------- haptics ----------

/** A light buzz on devices that have one. Off when sound is off, and never before the first press. */
export function buzz(name: string, pattern: number | number[]) {
  if (muted || !gesture || typeof navigator.vibrate !== 'function') return;
  // Only where a finger is on the glass: a mouse has nothing to buzz.
  if (document.documentElement.dataset.input !== 'touch' && !matchMedia('(pointer: coarse)').matches) return;
  try {
    navigator.vibrate(pattern);
    recorder('haptic', name);
  } catch {
    /* not allowed here */
  }
}
