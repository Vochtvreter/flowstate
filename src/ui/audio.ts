// Sound and haptics. Every cue is synthesised with Web Audio when it is needed: there are no files.
//
// Signal path: each cue -> bus -> compressor -> master gain -> soft clipper -> speakers.
// Loudness is safe by construction, three times over:
//  - every cue's peak into the bus is small, and no more than MAX_VOICES oscillators and noise
//    bursts exist at any one time (a cue that would go over is simply not played);
//  - the compressor holds a pile-up of cues down and the master gain after it is low;
//  - the clipper at the end is a fixed curve that cannot put out more than CEILING, whatever goes in.
//    In ordinary play nothing reaches its bend: it is a guarantee, not an effect.
// renderPeak() at the foot of this file renders the worst pile-up on an offline copy of this graph
// and reports the level, so the claim can be checked without ears.
//
// The AudioContext is made on the first press or key (browsers refuse to start one earlier), is
// suspended while the tab is hidden, and is not made at all while the player has sound switched off.
//
// This file knows nothing about the game: feel.ts decides when a cue plays.

const MUTE_KEY = 'flowstate-mute';
/** Gain after the compressor. Cue peaks below are before it. */
const MASTER = 0.5;
/** The most the clipper lets through, of a full scale of 1. */
const CEILING = 0.9;
/** Below this the clipper leaves the signal exactly as it is. */
const CLIP_KNEE = 0.6;
/** No more cues than this may start in any one second; the important ones get a little headroom. */
const MAX_PER_SECOND = 8;
const MAX_PER_SECOND_HARD = 12;
/** Oscillators and noise bursts alive (sounding or scheduled) at once. The largest fanfare uses about 40. */
const MAX_VOICES = 64;

/** One signal path: the live one, or an offline copy of it for measuring. */
interface Graph { ctx: BaseAudioContext; bus: GainNode; master: GainNode; noise: AudioBuffer; voices: number }

let ac: AudioContext | null = null;
let live_: Graph | null = null;
let muted = false;
/** The player has pressed something, so a context may be started. */
let gesture = false;
let recorder: (kind: 'cue' | 'haptic', name: string, detail?: string | number) => void = () => {};
const muteFns: ((on: boolean) => void)[] = [];

// ---------- context ----------

/** The clipper's curve: straight up to CLIP_KNEE, then bending over to CEILING, which it reaches at full scale and never passes. */
function clipCurve() {
  const n = 2049;
  const curve = new Float32Array(n);
  const span = 1 - CLIP_KNEE, room = CEILING - CLIP_KNEE;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    // Above the knee: a curve that leaves it at slope 1 and flattens out toward the ceiling.
    const y = a <= CLIP_KNEE ? a : CLIP_KNEE + room * Math.tanh((a - CLIP_KNEE) / room) / Math.tanh(span / room);
    curve[i] = Math.sign(x) * Math.min(CEILING, y);
  }
  return curve;
}

/** Build the signal path on a context (the live one, or an offline one for renderPeak). */
function build(ctx: BaseAudioContext, clip = true): Graph {
  const bus = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 6;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  const master = ctx.createGain();
  master.gain.value = MASTER;
  bus.connect(comp);
  comp.connect(master);
  if (clip) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = clipCurve();
    master.connect(shaper);
    shaper.connect(ctx.destination);
  } else master.connect(ctx.destination);
  // One second of white noise, shared by every click and whoosh.
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return { ctx, bus, master, noise, voices: 0 };
}

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
  live_ = build(ac);
  wake();
  return ac;
}

/**
 * Resume a context the browser has parked (it starts suspended until a gesture; phones suspend it on a call).
 * Called on every press and key until it runs: some browsers only honour the call from particular
 * events (the end of a touch, not its start), so one attempt is not enough.
 */
function wake() {
  if (!ac || ac.state !== 'suspended' || document.hidden || muted) return;
  ac.resume().catch(() => {});
}

function onGesture() {
  gesture = true;
  if (!muted) ensure();
}

/**
 * The live signal path, if a cue started now would be heard. Nothing is ever scheduled on a context
 * that is not running: its clock stands still, and everything queued would sound at once when it restarted.
 */
function live(): Graph | null {
  return !muted && ac && live_ && !document.hidden && ac.state === 'running' ? live_ : null;
}

/** Run `fn` as soon as the context is running (at once if it is), or not at all if that takes more than half a second. */
function whenRunning(fn: () => void) {
  const ctx = ac;
  if (!ctx) return;
  if (ctx.state === 'running') return fn();
  const t0 = performance.now();
  const check = () => {
    ctx.removeEventListener('statechange', check);
    if (ctx.state === 'running' && performance.now() - t0 < 500) fn();
  };
  ctx.addEventListener('statechange', check);
}

export function initAudio(record: typeof recorder) {
  recorder = record;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    muted = false;
  }
  // Only the events a browser counts as the player acting may start sound: a mouse button going
  // down, a key, and the END of a touch (a finger landing is not one: a context made then stays
  // parked and the browser says so in the console). Capture phase, so nothing that stops the event
  // further down can keep the sound locked.
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') onGesture();
  }, { capture: true, passive: true });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') onGesture();
  }, { capture: true, passive: true });
  window.addEventListener('touchend', onGesture, { capture: true, passive: true });
  window.addEventListener('keydown', (e) => {
    // (Escape is the one key that does not count.)
    if (e.key !== 'Escape') onGesture();
  }, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!ac) return;
    if (document.hidden) {
      droneOff(0.05);
      void ac.suspend().catch(() => {});
    } else wake();
  });
}

export const isMuted = () => muted;

/** Be told whenever sound is switched on or off, whoever did it (the mute button, a menu, a script). */
export const onMuteChange = (fn: (on: boolean) => void) => void muteFns.push(fn);

export function setMuted(on: boolean) {
  const changed = on !== muted;
  muted = on;
  try {
    localStorage.setItem(MUTE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: the choice lasts until the page is closed */
  }
  if (on) {
    droneOff(0.05);
    if (ac && live_) {
      live_.master.gain.setTargetAtTime(0, ac.currentTime, 0.015);
      const ctx = ac;
      setTimeout(() => {
        if (muted) void ctx.suspend().catch(() => {});
      }, 120);
    }
  } else if (gesture) {
    const ctx = ensure();
    if (ctx && live_) {
      live_.master.gain.cancelScheduledValues(ctx.currentTime);
      live_.master.gain.setTargetAtTime(MASTER, ctx.currentTime, 0.015);
      // Switching sound on answers with a sound, so the player hears that it worked.
      if (changed) whenRunning(cueAfford);
    }
  }
  if (changed) for (const fn of muteFns) fn(on);
}

/** For tests: is there a context, is it running, how busy is it. */
export function audioState() {
  prune(performance.now());
  return {
    exists: !!ac, state: ac ? ac.state : 'none', muted, gesture, drone: droneOn,
    sampleRate: ac?.sampleRate ?? 0, cuesLastSecond: recent.length, master: MASTER,
    voices: live_?.voices ?? 0, maxVoices: MAX_VOICES, ceiling: CEILING,
    /** The hum's gain into the bus right now (it fades in to DRONE_LEVEL and out to nothing). */
    droneLevel: drone ? +drone.gain.gain.value.toFixed(4) : 0, droneMax: DRONE_LEVEL,
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
function admit(name: string, gap: number, important = false, detail?: string | number): Graph | null {
  const g = live();
  if (!g) return null;
  const now = performance.now();
  if (now - (lastAt[name] ?? -1e9) < gap) return null;
  prune(now);
  if (recent.length >= (important ? MAX_PER_SECOND_HARD : MAX_PER_SECOND)) return null;
  recent.push(now);
  lastAt[name] = now;
  recorder('cue', name, detail);
  return g;
}

/** Shortly after "now" on a signal path: when a cue that has just been let in starts. */
const soon = (g: Graph, lead = 0.004) => g.ctx.currentTime + lead;

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
function tone(gr: Graph, type: OscillatorType, freq: number, t: number, peak: number, attack: number, decay: number, o?: ToneOpts) {
  if (gr.voices >= MAX_VOICES) return;
  gr.voices++;
  const ctx = gr.ctx;
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
  out.connect(gr.bus);
  osc.start(t);
  osc.stop(t + attack + decay + 0.03);
  osc.onended = () => {
    gr.voices--;
    osc.disconnect();
    g.disconnect();
    if (out !== g) out.disconnect();
  };
}

/** A burst of filtered noise. */
function noise(gr: Graph, t: number, peak: number, attack: number, decay: number, filter: BiquadFilterType, freq: number, q = 0.8, sweepTo?: number) {
  if (gr.voices >= MAX_VOICES) return;
  gr.voices++;
  const ctx = gr.ctx;
  const src = ctx.createBufferSource();
  src.buffer = gr.noise;
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
  g.connect(gr.bus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + attack + decay + 0.03);
  src.onended = () => {
    gr.voices--;
    src.disconnect();
    f.disconnect();
    g.disconnect();
  };
}

/** A small bell: a sine with two quieter, shorter partials above it. */
function bell(g: Graph, freq: number, t: number, peak: number, decay: number, pan?: number) {
  tone(g, 'sine', freq, t, peak, 0.004, decay, { pan });
  tone(g, 'sine', freq * 2, t, peak * 0.25, 0.003, decay * 0.5, { pan });
  tone(g, 'triangle', freq * 3.01, t, peak * 0.08, 0.002, decay * 0.25, { pan });
}

/** A plucked note: triangle with a sine an octave up. */
function pluck(g: Graph, midi: number, t: number, peak: number, decay = 0.5, pan?: number) {
  tone(g, 'triangle', hz(midi), t, peak, 0.005, decay, { pan });
  tone(g, 'sine', hz(midi + 12), t, peak * 0.3, 0.004, decay * 0.6, { pan });
}

/** A soft chord of sines. */
function pad(g: Graph, midis: number[], t: number, peak: number, attack: number, decay: number) {
  for (const m of midis) tone(g, 'sine', hz(m), t, peak, attack, decay);
}

// ---------- everyday cues ----------
// Each cue is in two parts: `s…(g, t, …)` writes its notes onto a signal path at time `t`, and the
// exported `cue…()` decides whether it may play now (rate limits, mute, a running context) and
// calls it. renderPeak() uses the first part alone to pile them all up on an offline path.

/** Steps of a major scale, in semitones: each connection in a run sounds one step higher. */
const RUN = [0, 2, 4, 5, 7, 9, 11, 12];
const RUN_WINDOW = 4000;
let run = 0;
let lastConnect = -1e9;

function sConnect(g: Graph, t: number, step: number) {
  const k = 2 ** (RUN[step] / 12);
  noise(g, t, 0.09, 0.001, 0.018, 'highpass', 2500);
  tone(g, 'sine', 300 * k, t + 0.012, 0.22, 0.004, 0.13, { to: 130 * k, glide: 0.09 });
  tone(g, 'triangle', 880 * k, t + 0.012, 0.045, 0.002, 0.09);
}

/** A wire snapped on: a click, then a low "thock" with a faint high tap on top. Rises through a run of connections. */
export function cueConnect() {
  const now = performance.now();
  const next = now - lastConnect < RUN_WINDOW ? Math.min(run + 1, RUN.length - 1) : 0;
  const g = admit('connect', 50, false, next);
  if (!g) return;
  run = next;
  lastConnect = now;
  sConnect(g, soon(g), run);
}

/** Pentatonic steps above C5: whatever the mix of sales, the ticks are in tune with each other. */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const C5 = 523.25;

function tick(g: Graph, step: number, t: number, peak: number) {
  const f = C5 * 2 ** (PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12);
  tone(g, 'sine', f, t, peak, 0.003, 0.07);
  tone(g, 'triangle', f * 2, t, peak * 0.22, 0.002, 0.04);
}

/** Pitch step for a sale worth `amount` credits: about one step for every doubling. */
export const saleStep = (amount: number) => Math.max(0, Math.min(PENTA.length - 1, Math.round(Math.log2(1 + Math.max(0, amount)) * 1.25) - 1));

/** The most ticks one second of sales may make, however many Markets sold. */
const SALE_TICKS = 3;

/**
 * What the Markets sold in the last second, as credits per Market. However many Markets there are,
 * at most three soft ticks are played, low to high and a moment apart: a patter, never a buzz.
 */
export function cueSales(amounts: number[]) {
  if (!amounts.length || !live()) return;
  const steps = [...new Set(amounts.map(saleStep))].sort((a, b) => a - b);
  const picked = steps.length <= SALE_TICKS ? steps : [steps[0], steps[steps.length >> 1], steps[steps.length - 1]];
  const now = performance.now();
  // One batch a second: a second batch inside 600 ms (two games in one page, a test poking signals) is dropped.
  if (now - (lastAt.saleBatch ?? -1e9) < 600) return;
  lastAt.saleBatch = now;
  picked.forEach((step, i) => {
    const g = admit('sale', 0, false, step);
    if (g) tick(g, step, soon(g, 0.005) + i * 0.085, 0.05);
  });
}

function sPlace(g: Graph, t: number) {
  tone(g, 'sine', 150, t, 0.24, 0.005, 0.16, { to: 55, glide: 0.12 });
  noise(g, t, 0.06, 0.002, 0.05, 'lowpass', 500);
}

/** Something was bought or placed: a low thump. */
export function cuePlace() {
  const g = admit('place', 80);
  if (g) sPlace(g, soon(g));
}

function sClaim(g: Graph, t: number) {
  bell(g, hz(88), t, 0.1, 0.45);
  bell(g, hz(93), t + 0.09, 0.11, 0.6);
}

/** A reward claimed or something unlocked: a bright two-note chime, a fourth apart. */
export function cueClaim() {
  const g = admit('claim', 120, true);
  if (g) sClaim(g, soon(g));
}

function sAfford(g: Graph, t: number) {
  tone(g, 'sine', hz(84), t, 0.07, 0.005, 0.7);
  tone(g, 'sine', hz(84) * 2.76, t, 0.014, 0.003, 0.3);
}

/** Something on the hotbar can now be afforded: one soft bell. */
export function cueAfford() {
  const g = admit('afford', 400);
  if (g) sAfford(g, soon(g));
}

function sError(g: Graph, t: number) {
  tone(g, 'triangle', 120, t, 0.16, 0.003, 0.09, { to: 85 });
  noise(g, t, 0.05, 0.002, 0.04, 'lowpass', 300);
}

/** A refusal: a short dull knock. */
export function cueError() {
  const g = admit('error', 250);
  if (g) sError(g, soon(g));
}

function sReady(g: Graph, t: number) {
  bell(g, hz(79), t, 0.07, 0.4);
  bell(g, hz(84), t + 0.12, 0.08, 0.6);
}

/** A goal or an order is ready to claim: two soft rising notes, lower and rounder than the claim chime. */
export function cueReady() {
  const g = admit('ready', 500, true);
  if (g) sReady(g, soon(g));
}

function sPayout(g: Graph, t: number, n: number, from: number) {
  for (let i = 0; i < n; i++) tick(g, from + i, t + i * 0.045, 0.06);
}

/** Coins or Data landing on a counter: `n` quick ticks, each a step higher than the last. */
export function cuePayout(n: number, from = 3) {
  const g = admit('payout', 150, true, n);
  if (g) sPayout(g, soon(g), n, from);
}

/** The least time between two tip cues, in ms. */
const TIP_GAP = 20000;

function sTip(g: Graph, t: number) {
  tone(g, 'sine', hz(76), t, 0.04, 0.008, 0.2);
  tone(g, 'sine', hz(81), t + 0.11, 0.045, 0.008, 0.32);
}

/** A tip has appeared on the goal card: two soft notes, a tap on the shoulder. At most one every 20 seconds. */
export function cueTip() {
  const g = admit('tip', TIP_GAP);
  if (g) sTip(g, soon(g));
}

// ---------- celebrations ----------

export type Fanfare = 'shard' | 'lab' | 'glyph' | 'flow' | 'lens';

function sFanfare(g: Graph, t: number, kind: Fanfare) {
  switch (kind) {
    case 'shard':
      // C major, up the chord: about 1.5 s.
      [72, 76, 79, 84].forEach((m, i) => pluck(g, m, t + [0, 0.09, 0.18, 0.3][i], 0.09, 0.55));
      pluck(g, 88, t + 0.44, 0.05, 0.7);
      pad(g, [60, 67], t, 0.035, 0.05, 1.3);
      break;
    case 'lab':
      // The same shape a tone higher, with two more notes on top: about 1.9 s.
      [74, 78, 81, 86].forEach((m, i) => pluck(g, m, t + [0, 0.09, 0.18, 0.3][i], 0.09, 0.55));
      pluck(g, 90, t + 0.44, 0.06, 0.7);
      pluck(g, 93, t + 0.58, 0.05, 0.9);
      pad(g, [62, 69, 74], t, 0.033, 0.05, 1.7);
      break;
    case 'glyph': {
      // Two streams: one falls from the left, one climbs from the right; they meet on G and bloom. About 2.5 s.
      const fall = [88, 86, 84, 83, 81], climb = [67, 69, 71, 72, 74];
      for (let i = 0; i < 5; i++) {
        const pan = 0.7 - i * 0.15;
        pluck(g, fall[i], t + i * 0.11, 0.07, 0.3, -pan);
        pluck(g, climb[i], t + i * 0.11, 0.08, 0.3, pan);
      }
      const m = t + 0.62;
      pluck(g, 79, m, 0.12, 0.9);
      tone(g, 'sine', 98, m, 0.2, 0.006, 0.4, { to: 49 });
      pad(g, [55, 62, 67, 71, 74, 81], m, 0.04, 0.03, 1.8);
      [79, 83, 86, 91].forEach((n, i) => bell(g, hz(n), m + 0.16 + i * 0.105, 0.06, 0.8));
      break;
    }
    case 'flow':
      // No attack anywhere: two sines glide up an octave, a soft high chord opens over them, and a breath of air. About 2.5 s.
      tone(g, 'sine', 196, t, 0.07, 0.45, 1.9, { to: 392, glide: 1.2 });
      tone(g, 'sine', 293.66, t, 0.045, 0.5, 1.9, { to: 587.33, glide: 1.2 });
      pad(g, [74, 79, 81, 86], t + 0.9, 0.03, 0.35, 1.25);
      noise(g, t, 0.012, 0.7, 1.2, 'bandpass', 2000, 0.7, 4000);
      break;
    case 'lens':
      // The biggest: a low thump, a wide major ninth, bells running up it twice, and a shimmer of air.
      // About 2.9 s: it starts with the Lens card and has to be over before the summary screen opens.
      tone(g, 'sine', 110, t, 0.24, 0.008, 0.6, { to: 41 });
      pad(g, [48, 55, 60, 64, 67, 71, 74], t, 0.05, 0.06, 2.5);
      [84, 88, 91, 96].forEach((n, i) => bell(g, hz(n), t + 0.1 + i * 0.105, 0.07, 0.9));
      [91, 96, 100].forEach((n, i) => bell(g, hz(n), t + 0.8 + i * 0.13, 0.045, 1.1));
      pad(g, [60, 67, 72, 76], t + 1.0, 0.03, 0.4, 1.45);
      noise(g, t + 0.05, 0.02, 0.3, 1.6, 'highpass', 6000);
      break;
  }
}

/**
 * The big moments, in three sizes: small (first Shard, and the Lab a little longer), medium (first
 * Glyph: two lines, one falling and one rising, that meet on one note and open into a chord), and
 * large (the first Lens; see also cueBowNote, which plays while the factory lights up before it).
 * The first Flow State is not a fanfare at all but a slow swell.
 */
export function cueFanfare(kind: Fanfare) {
  const g = admit('fanfare-' + kind, 800, true);
  if (g) sFanfare(g, soon(g, 0.01), kind);
}

/** Notes for the factory's bow before the Lens fanfare: C major pentatonic, climbing. */
const BOW = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84];

function sBowNote(g: Graph, t: number, i: number, n: number) {
  const idx = Math.round((i / Math.max(1, n - 1)) * (BOW.length - 1));
  pluck(g, BOW[Math.max(0, Math.min(BOW.length - 1, idx))], t, 0.07, 0.4);
}

/** One step of the bow: `i` of `n` (0-based). Call as each row of the factory lights up. */
export function cueBowNote(i: number, n: number) {
  const g = admit('bow', 40, true, i);
  if (g) sBowNote(g, soon(g, 0.005), i, n);
}

function sWhoosh(g: Graph, t: number) {
  noise(g, t, 0.03, 0.35, 0.6, 'bandpass', 500, 1.2, 3500);
}

/** The start of the bow: a soft rush of air sweeping upwards. */
export function cueWhoosh() {
  const g = admit('whoosh', 500, true);
  if (g) sWhoosh(g, soon(g, 0.005));
}

// ---------- Flow State ----------

function sFlowIn(g: Graph, t: number) {
  tone(g, 'sine', 196, t, 0.05, 0.3, 1.0, { to: 293.66, glide: 0.9 });
  tone(g, 'sine', 293.66, t, 0.03, 0.3, 1.0, { to: 440, glide: 0.9 });
}

/** Entering Flow State (after the first time, which gets the 'flow' fanfare): a short rising tone. */
export function cueFlowIn() {
  const g = admit('flow-in', 2000, true);
  if (g) sFlowIn(g, soon(g, 0.01));
}

/** Peak gain of the whole drone into the bus. */
const DRONE_LEVEL = 0.03;
let droneOn = false;
let drone: { gain: GainNode; stop: () => void } | null = null;
let droneTimer = 0;

/** The drone's voices on a signal path, silent until its gain is raised. */
function makeDrone(g: Graph): { gain: GainNode; stop: () => void } {
  const ctx = g.ctx;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  const oscs: OscillatorNode[] = [];
  const voice = (type: OscillatorType, f: number, level: number) => {
    const o = ctx.createOscillator();
    const v = ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    v.gain.value = level;
    o.connect(v);
    v.connect(lp);
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
  gain.connect(g.bus);
  return {
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

/**
 * The hum of a factory in Flow State: G and the D above it, the low G doubled a hair sharp so it
 * beats slowly, through a low-pass, swelling and sinking a little every eight seconds.
 * Fades in over about two seconds and out over `fade` seconds (the time constant; three of them to silence).
 */
export function setDrone(on: boolean, fade = 0.8) {
  if (on === droneOn) return;
  if (!on) return droneOff(fade);
  const g = live();
  if (!g) return;
  droneOn = true;
  recorder('cue', 'drone-on');
  clearTimeout(droneTimer);
  drone ??= makeDrone(g);
  drone.gain.gain.cancelScheduledValues(g.ctx.currentTime);
  drone.gain.gain.setTargetAtTime(DRONE_LEVEL, g.ctx.currentTime, 0.7);
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

/** A new game: the hum stops, a run of connections starts again from its first note, and a tip may sound at once. */
export function resetAudio() {
  droneOff(0.08);
  run = 0;
  lastConnect = -1e9;
  delete lastAt.tip;
}

// ---------- haptics ----------

/**
 * A light buzz on devices that have one. The rule: only while the player is using a finger (the
 * last pointer was touch or pen, `html[data-input="touch"]`), never before the first press, and
 * never while sound is off (the mute button silences the phone's motor too). Every pattern is
 * short: 8 to 15 ms for a wire or a claim, under a quarter of a second in all for a big moment.
 */
export function buzz(name: string, pattern: number | number[]) {
  if (muted || !gesture || typeof navigator.vibrate !== 'function') return;
  if (document.documentElement.dataset.input !== 'touch') return;
  try {
    navigator.vibrate(pattern);
    recorder('haptic', name);
  } catch {
    /* not allowed here */
  }
}

// ---------- measuring without ears ----------

export interface PeakReport {
  /** Largest sample that would reach the speakers, of a full scale of 1. */
  peak: number;
  /** The same pile-up with the clipper taken out: how hard it is being asked to work (over 0.6 it bends, at 1 it would have clipped). */
  peakBeforeClip: number;
  /** Root mean square over the loudest 100 ms, after the clipper. */
  rms: number;
  /** Voices alive at the busiest moment, and how many notes the cap refused. */
  voices: number;
  seconds: number;
}

/** Every cue this file can make, for renderPeak. */
const ALL_CUES: ((g: Graph, t: number) => void)[] = [
  (g, t) => sConnect(g, t, 0), (g, t) => sPlace(g, t), (g, t) => sClaim(g, t), (g, t) => sAfford(g, t), (g, t) => sError(g, t),
  (g, t) => sReady(g, t), (g, t) => sPayout(g, t, 6, 3), (g, t) => sTip(g, t), (g, t) => sWhoosh(g, t), (g, t) => sFlowIn(g, t),
  (g, t) => sBowNote(g, t, 5, 6),
  // One second's sales at their loudest: three ticks together.
  (g, t) => [2, 5, 9].forEach((step, i) => tick(g, step, t + i * 0.085, 0.05)),
];

/**
 * Render a pile-up on an offline copy of the signal path and measure what comes out.
 *  - 'celebration': the worst that play can produce. One fanfare (`fanfare`, the Lens by default) at
 *    the same instant as a second's sales, a claim with its payout, a goal turning ready, a wire, a
 *    purchase, a refusal, a tip, the afford bell, and the Flow State hum at full level. The rate
 *    limiter lets at most 12 cues start in a second, and no cue twice within its own gap, so nothing
 *    louder than this can be asked for in play.
 *  - 'everything': every cue this file has, and all five fanfares, started on the same sample. The
 *    limiter and the voice cap never allow it; it shows what the clipper does with the impossible.
 */
export async function renderPeak(scene: 'celebration' | 'everything' = 'celebration', fanfare: Fanfare = 'lens'): Promise<PeakReport> {
  const Offline: typeof OfflineAudioContext | undefined = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) throw new Error('no OfflineAudioContext here');
  const rate = 44100, seconds = 4;
  let voices = 0;
  const render = async (clip: boolean) => {
    const ctx = new Offline(2, rate * seconds, rate);
    const g = build(ctx, clip);
    const t = 0.05;
    // The hum, already at its full level (in play it takes two seconds to get there).
    const d = makeDrone(g);
    d.gain.gain.value = DRONE_LEVEL;
    if (scene === 'everything') {
      // The cap is lifted for this one: the point is to see the clipper hold what the cap would have refused.
      g.voices = -1e6;
      for (const k of ['shard', 'lab', 'glyph', 'flow', 'lens'] as Fanfare[]) sFanfare(g, t, k);
      for (const cue of ALL_CUES) cue(g, t);
      voices = Math.max(voices, g.voices + 1e6);
    } else {
      sFanfare(g, t, fanfare);
      for (const cue of ALL_CUES) cue(g, t);
      voices = Math.max(voices, g.voices);
    }
    const out = await ctx.startRendering();
    let peak = 0, best = 0;
    const win = Math.round(rate * 0.1);
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const data = out.getChannelData(ch);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (Math.abs(v) > peak) peak = Math.abs(v);
        sum += v * v;
        if (i >= win) sum -= data[i - win] * data[i - win];
        if (i >= win - 1 && sum > best) best = sum;
      }
    }
    return { peak, rms: Math.sqrt(Math.max(0, best) / win) };
  };
  const clipped = await render(true);
  const raw = await render(false);
  return { peak: +clipped.peak.toFixed(4), peakBeforeClip: +raw.peak.toFixed(4), rms: +clipped.rms.toFixed(4), voices, seconds };
}
