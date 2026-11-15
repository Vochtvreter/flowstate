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
  /** Where it plays into, instead of the bus (a voice with a gain of its own). */
  out?: AudioNode;
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
  out.connect(o?.out ?? gr.bus);
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

/**
 * Pentatonic steps above C5: whatever the mix of sales, the ticks are in tune with each other.
 * (Twelve of them: a sale's step is one of the first ten, and its figure reaches two above it.)
 */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
const C5 = 523.25;
/** The highest step a sale or a payout starts from. */
const TOP_STEP = 9;

function tick(g: Graph, step: number, t: number, peak: number, out?: AudioNode) {
  const f = C5 * 2 ** (PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12);
  tone(g, 'sine', f, t, peak, 0.003, 0.07, { out });
  tone(g, 'triangle', f * 2, t, peak * 0.22, 0.002, 0.04, { out });
}

/** Where on the scale a sale worth `amount` credits lies, as a number: about one step for every doubling. */
export const saleLevel = (amount: number) => Math.log2(1 + Math.max(0, amount)) * 1.25 - 1;
/** The pitch step nearest to a level: a whole number from 0 to 9. */
export const saleStep = (level: number) => Math.max(0, Math.min(TOP_STEP, Math.round(level)));

/** The most ticks one second of sales may make, however many Markets sold. */
const SALE_TICKS = 3;
/** Seconds from one tick of a second's sales to the next. */
const SALE_GAP = 0.085;
/** The figure the sales walk, in steps above their own: one note of it for each second's sales. */
const SALE_FIGURE = [0, 1, 2, 1];
/** Each tick is moved by a random time up to this either way, in seconds, so the patter never falls into a grid. */
const SALE_JITTER = 0.015;
/** A tick is scheduled this far ahead on the audio clock, so that "a little early" is still in the future. */
const SALE_LEAD = 0.018;
/** The least time from a tick to the third tick after it, in seconds: a second, and a hair for safety. */
const SALE_APART = 1.002;
/** Peak of one sale tick into the sale voice. */
const SALE_PEAK = 0.05;
/** Seconds of nothing new before the sale voice steps back, how far it steps back, and how long that takes. */
const SALE_TIRE = 30;
const SALE_BACK = 0.5;
const SALE_FALL = 2;
/** Seconds the voice stays at full level after it has been brought back (a new step, or Flow State starting). */
const SALE_FRESH = 10;

/**
 * The sale voice on one signal path: its own gain (so it can step back without touching anything
 * else), where it is in the figure, which steps the ear has had lately, and when its last ticks were.
 * The live path has one, made with the context; renderSales() makes one on an offline path and
 * drives it with the same code, so what is measured is what plays.
 */
interface SaleVoice {
  gain: GainNode;
  /** Batches played: the figure's note is this modulo its length. */
  beat: number;
  /** When each step last sounded, in audio seconds (-Infinity: never). */
  heard: number[];
  /** When the voice steps back unless something new is heard first, and whether it has. */
  tireAt: number;
  back: boolean;
  everBack: boolean;
  lastBatch: number;
  /** Start times of the last three ticks, oldest first. */
  times: number[];
}

function makeSaleVoice(g: Graph): SaleVoice {
  const gain = g.ctx.createGain();
  gain.gain.value = 1;
  gain.connect(g.bus);
  return { gain, beat: 0, heard: PENTA.map(() => -Infinity), tireAt: Infinity, back: false, everBack: false, lastBatch: -Infinity, times: [] };
}

/** Bring the sale voice back to full level at audio time `t`, for SALE_FRESH seconds (SALE_TIRE the first time round). */
function freshen(v: SaleVoice, t: number) {
  v.tireAt = t + (v.everBack ? SALE_FRESH : SALE_TIRE);
  if (!v.back) return;
  v.back = false;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setTargetAtTime(1, t, 0.05);
}

/**
 * One second's sales on a signal path, at audio time `now`: `steps` are the pitch steps of the
 * Markets that sold. At most three ticks (lowest, middle, highest), SALE_GAP apart, each a little
 * early or late, all moved up by this second's note of the figure. Returns what was scheduled.
 *  - A step that has not sounded for SALE_TIRE seconds is news: the voice comes back to full level.
 *    With nothing new for that long it steps back to half over SALE_FALL seconds.
 *  - No tick starts less than a second after the tick three before it, so there are never more than
 *    three in any second, jitter and all. With three Markets' worth of ticks every second that means
 *    a tick may not come sooner after its counterpart of the second before than that one came after
 *    its own: its random place is moved later when it would. (The seconds are never quite a second
 *    apart: the board's timer overruns by part of a frame, and that is the room the jitter has to
 *    move back in.) A tick that would have to be more than the jitter late for this is left out.
 */
function saleBatch(g: Graph, v: SaleVoice, now: number, steps: number[], rand: () => number = Math.random): { t: number; step: number; due: number }[] {
  // One batch a second: a second batch inside 600 ms (two games in one page, a test poking signals) is dropped.
  if (!steps.length || now - v.lastBatch < 0.6) return [];
  v.lastBatch = now;
  const sorted = [...new Set(steps)].sort((a, b) => a - b);
  const picked = sorted.length <= SALE_TICKS ? sorted : [sorted[0], sorted[sorted.length >> 1], sorted[sorted.length - 1]];
  if (v.tireAt === Infinity) v.tireAt = now + SALE_TIRE;
  if (picked.some((step) => now - v.heard[step] > SALE_TIRE)) freshen(v, now);
  for (const step of picked) v.heard[step] = now;
  if (!v.back && now >= v.tireAt) {
    v.back = v.everBack = true;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(1, now);
    v.gain.gain.linearRampToValueAtTime(SALE_BACK, now + SALE_FALL);
  }
  const up = SALE_FIGURE[v.beat++ % SALE_FIGURE.length];
  const out: { t: number; step: number; due: number }[] = [];
  picked.forEach((step, i) => {
    const due = now + SALE_LEAD + i * SALE_GAP;
    let t = due + (rand() * 2 - 1) * SALE_JITTER;
    if (v.times.length >= SALE_TICKS) t = Math.max(t, v.times[v.times.length - SALE_TICKS] + SALE_APART);
    if (t > due + SALE_JITTER + 0.0005) return;
    v.times.push(t);
    if (v.times.length > SALE_TICKS) v.times.shift();
    tick(g, step + up, t, SALE_PEAK, v.gain);
    out.push({ t, step: step + up, due });
  });
  return out;
}

let saleVoice: SaleVoice | null = null;

/**
 * What the Markets sold in the last second, as one pitch step per Market (saleStep). However many
 * Markets there are, at most three soft ticks are played, low to high and a moment apart, and from
 * one second to the next they walk a four-note figure (the step, one up, two up, one up): a patter
 * with a tune in it, never a buzz and never a metronome. See saleBatch for the rest.
 */
export function cueSales(steps: number[]) {
  const g = live();
  if (!steps.length || !g) return;
  // Sales give way like any everyday cue: when the second is already full, this second's are left out.
  const now = performance.now();
  prune(now);
  if (recent.length >= MAX_PER_SECOND) return;
  saleVoice ??= makeSaleVoice(g);
  const played = saleBatch(g, saleVoice, g.ctx.currentTime, steps);
  for (const p of played) {
    recent.push(now);
    recorder('cue', 'sale', p.step);
  }
}

/** Something has changed that the player will want to hear the sales against (Flow State has started): full level again. */
export function freshenSales() {
  const g = live();
  if (g && saleVoice) freshen(saleVoice, g.ctx.currentTime);
}

/** The thump's tick: its pitch in Hz, and its peak into the bus. */
const THUMP_TICK = 2000;

function sPlace(g: Graph, t: number) {
  tone(g, 'sine', 150, t, 0.24, 0.005, 0.16, { to: 55, glide: 0.12 });
  noise(g, t, 0.06, 0.002, 0.05, 'lowpass', 500);
  // A phone's speaker gives back almost nothing under 300 Hz: this short tick is the part of the thump it can play.
  tone(g, 'triangle', THUMP_TICK, t, 0.05, 0.001, 0.028);
}

/** Something was bought or placed: a low thump, with a small tick on top of it. */
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

/** Seconds between two coins of a payout landing (feel.ts sends them this far apart). */
const PAYOUT_GAP = 0.04;

function sPayout(g: Graph, t: number, n: number) {
  // Six ticks climb from the fourth step; a longer run starts lower, so that it ends as high and no higher.
  const from = Math.max(0, Math.min(3, TOP_STEP + 1 - n));
  for (let i = 0; i < n; i++) tick(g, from + i, t + i * PAYOUT_GAP, 0.06);
}

/**
 * Coins or Data landing on a counter, one tick for each (at most ten), each a step higher than the
 * last. Call when the first one lands: the rest are scheduled on the audio clock, 40 ms apart, which
 * is how far apart the coins land.
 */
export function cuePayout(n: number) {
  const count = Math.max(1, Math.min(10, Math.round(n)));
  const g = admit('payout', 150, true, count);
  if (g) sPayout(g, soon(g), count);
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

function sStart(g: Graph, t: number) {
  tone(g, 'sine', 196, t, 0.075, 0.07, 0.55, { to: 293.66, glide: 0.32 });
  tone(g, 'triangle', 392, t + 0.02, 0.03, 0.08, 0.5, { to: 587.33, glide: 0.32 });
  tone(g, 'sine', hz(81), t + 0.3, 0.04, 0.012, 0.6);
}

/**
 * The press on Start (or Continue): the first sound of the game. A short warm rise, a fifth up, that
 * settles on one soft note. It is asked for inside the press that makes the audio context, so it
 * waits (at most half a second) for the context to be running.
 */
export function cueStart() {
  if (muted) return;
  whenRunning(() => {
    const g = admit('start', 1500, true);
    if (g) sStart(g, soon(g, 0.02));
  });
}

function sLineDone(g: Graph, t: number) {
  pluck(g, 81, t, 0.05, 0.14);
  pluck(g, 85, t + 0.065, 0.055, 0.3);
}

/** The goal card's "while you wait" line has been done: two quick notes, a third apart, like a pencil tick. */
export function cueLineDone() {
  const g = admit('line-done', 1000);
  if (g) sLineDone(g, soon(g));
}

function sSurplus(g: Graph, t: number) {
  // B falling to F: a tritone, neither a reward's fourth nor a refusal's knock. A quiet E under the F rubs against it.
  tone(g, 'triangle', hz(83), t, 0.06, 0.012, 0.3);
  tone(g, 'triangle', hz(77), t + 0.21, 0.065, 0.012, 0.55);
  tone(g, 'sine', hz(76), t + 0.21, 0.022, 0.03, 0.5);
}

/** Something is selling over its demand for the first time: two falling notes that do not quite resolve. News, not a reward and not a refusal. */
export function cueSurplus() {
  const g = admit('surplus', 2000, true);
  if (g) sSurplus(g, soon(g, 0.01));
}

function sExpand(g: Graph, t: number) {
  noise(g, t, 0.028, 0.22, 0.42, 'bandpass', 420, 1.1, 2600);
}

/** The board has grown and the camera is gliding out to show it: a soft rush of air, about as long as the glide (0.6 s). */
export function cueExpand() {
  const g = admit('expand', 500, true);
  if (g) sExpand(g, soon(g, 0.005));
}

function sExpandPop(g: Graph, t: number, i: number) {
  const f = C5 * 2 ** (PENTA[Math.max(0, Math.min(PENTA.length - 1, 2 + i))] / 12);
  tone(g, 'sine', f * 1.6, t, 0.1, 0.003, 0.1, { to: f, glide: 0.045 });
  tone(g, 'triangle', f * 2, t, 0.02, 0.002, 0.05);
}

/**
 * New deposits pop up one after another, `gap` seconds apart: a small bubble of a note for each, a
 * step higher each time. All of them are scheduled now, on the audio clock.
 */
export function cueExpandPops(count: number, gap: number) {
  const n = Math.max(0, Math.min(8, Math.round(count)));
  const g = n ? admit('expand-pop', 200, true, n) : null;
  if (!g) return;
  const t = soon(g, 0.006);
  for (let i = 0; i < n; i++) sExpandPop(g, t + i * gap, i);
}

function sResearch(g: Graph, t: number, kind: 'tech' | 'data') {
  // Three bells straight up a major chord, quick, and a soft fifth under them: about 0.9 s. The first β
  // is the same a fourth higher, with a fourth bell on top.
  const root = kind === 'data' ? 81 : 76;
  [0, 4, 7].forEach((step, i) => bell(g, hz(root + step), t + i * 0.075, 0.075, 0.55));
  if (kind === 'data') bell(g, hz(root + 12), t + 0.24, 0.05, 0.7);
  pad(g, [root - 12, root - 5], t, 0.028, 0.05, 0.8);
}

/**
 * The tech a goal was saving for has been researched (`tech`), or the first β has arrived (`data`):
 * a short rising run of bells, brighter than the ready chime and much smaller than a fanfare.
 */
export function cueResearch(kind: 'tech' | 'data' = 'tech') {
  const g = admit('research-' + kind, 1500, true);
  if (g) sResearch(g, soon(g, 0.01), kind);
}

// ---------- celebrations ----------

export type Fanfare = 'shard' | 'lab' | 'spark' | 'glyph' | 'flow' | 'prism' | 'lens';

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
    case 'spark':
      // A crackle, a strike that leaps two octaves, and E major straight up after it: about 1.6 s.
      noise(g, t, 0.035, 0.001, 0.022, 'highpass', 5200);
      noise(g, t + 0.07, 0.028, 0.001, 0.018, 'highpass', 6500);
      tone(g, 'sine', 329.63, t + 0.02, 0.08, 0.004, 0.17, { to: 1318.5, glide: 0.11 });
      [76, 80, 83, 88].forEach((m, i) => pluck(g, m, t + 0.14 + [0, 0.07, 0.14, 0.24][i], 0.085, 0.5));
      bell(g, hz(92), t + 0.52, 0.05, 0.8);
      pad(g, [64, 71], t + 0.14, 0.035, 0.04, 1.3);
      break;
    case 'prism':
      // One clear note goes in; a fan of five comes out, left to right and low to high, over an open A. About 2.1 s.
      bell(g, hz(81), t, 0.09, 0.5);
      [73, 76, 80, 83, 88].forEach((m, i) => bell(g, hz(m), t + 0.3 + i * 0.09, 0.06, 0.9, -0.8 + i * 0.4));
      pad(g, [57, 64, 69], t + 0.3, 0.035, 0.05, 1.6);
      noise(g, t + 0.28, 0.012, 0.2, 0.9, 'highpass', 7000);
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
 * The big moments, in three sizes: small (first Shard, the Lab a little longer, then the first Spark
 * and the first Prism, each with a shape of its own), medium (first Glyph: two lines, one falling and
 * one rising, that meet on one note and open into a chord), and large (the first Lens; see also
 * cueBowNote, which plays while the factory lights up before it).
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
/** The hum's highest voice, in Hz. */
const DRONE_HIGH = 392;
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
  // Two octaves up, quietly: what is left of the hum on a phone's speaker, which plays almost nothing under 300 Hz.
  voice('sine', DRONE_HIGH, 0.2);
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
 * beats slowly, and a quiet G two octaves up, through a low-pass, swelling and sinking a little every eight seconds.
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
  // The sale voice starts over: full level, the first note of its figure, nothing heard yet.
  if (saleVoice && live_) {
    saleVoice.gain.disconnect();
    saleVoice = makeSaleVoice(live_);
  }
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
  (g, t) => sReady(g, t), (g, t) => sPayout(g, t, 10), (g, t) => sTip(g, t), (g, t) => sWhoosh(g, t), (g, t) => sFlowIn(g, t),
  (g, t) => sBowNote(g, t, 5, 6), (g, t) => sStart(g, t), (g, t) => sLineDone(g, t), (g, t) => sSurplus(g, t), (g, t) => sExpand(g, t),
  (g, t) => [0, 1, 2, 3].forEach((i) => sExpandPop(g, t + i * 0.08, i)), (g, t) => sResearch(g, t, 'tech'),
  // One second's sales at their loudest: three ticks together, at the top of their figure.
  (g, t) => [4, 7, 11].forEach((step, i) => tick(g, step, t + i * SALE_GAP, SALE_PEAK)),
];

const FANFARES: Fanfare[] = ['shard', 'lab', 'spark', 'glyph', 'flow', 'prism', 'lens'];

const offlineCtx = (seconds: number, rate = 44100) => {
  const Offline: typeof OfflineAudioContext | undefined = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) throw new Error('no OfflineAudioContext here');
  return new Offline(2, Math.round(rate * seconds), rate);
};

/**
 * Render a pile-up on an offline copy of the signal path and measure what comes out.
 *  - 'celebration': the worst that play can produce. One fanfare (`fanfare`, the Lens by default) at
 *    the same instant as a second's sales, a claim with its payout of ten coins, a goal turning ready,
 *    a wire, a purchase, a refusal, a tip, the afford bell, the Start cue, a line ticked, the surplus
 *    cue, an expansion with four deposits, and the Flow State hum at full level. The rate limiter lets
 *    at most 12 cues start in a second, and no cue twice within its own gap, so nothing louder than
 *    this can be asked for in play.
 *  - 'everything': every cue this file has, and all seven fanfares, started on the same sample. The
 *    limiter and the voice cap never allow it; it shows what the clipper does with the impossible.
 */
export async function renderPeak(scene: 'celebration' | 'everything' = 'celebration', fanfare: Fanfare = 'lens'): Promise<PeakReport> {
  const rate = 44100, seconds = 4;
  let voices = 0;
  const render = async (clip: boolean) => {
    const ctx = offlineCtx(seconds, rate);
    const g = build(ctx, clip);
    const t = 0.05;
    // The hum, already at its full level (in play it takes two seconds to get there).
    const d = makeDrone(g);
    d.gain.gain.value = DRONE_LEVEL;
    if (scene === 'everything') {
      // The cap is lifted for this one: the point is to see the clipper hold what the cap would have refused.
      g.voices = -1e6;
      for (const k of FANFARES) sFanfare(g, t, k);
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

/** The cues that can be rendered alone, by the name they are logged under. */
const SOLO: Record<string, (g: Graph, t: number) => void> = {
  connect: (g, t) => sConnect(g, t, 0), place: sPlace, claim: sClaim, afford: sAfford, error: sError, ready: sReady,
  payout: (g, t) => sPayout(g, t, 10), tip: sTip, start: sStart, 'line-done': sLineDone, surplus: sSurplus, expand: sExpand,
  'expand-pop': (g, t) => sExpandPop(g, t, 0), whoosh: sWhoosh, 'flow-in': sFlowIn,
  'research-tech': (g, t) => sResearch(g, t, 'tech'), 'research-data': (g, t) => sResearch(g, t, 'data'),
  drone: (g) => void (makeDrone(g).gain.gain.value = DRONE_LEVEL),
  ...Object.fromEntries(FANFARES.map((k) => ['fanfare-' + k, (g: Graph, t: number) => sFanfare(g, t, k)])),
};

/** The amplitude of one frequency in a stretch of samples (a single-bin Fourier sum, Hann-windowed): 1 for a full-scale sine. */
function amplitudeAt(data: Float32Array, rate: number, hzAt: number, from: number, to: number): number {
  let re = 0, im = 0, norm = 0;
  const w = (2 * Math.PI * hzAt) / rate;
  const n = to - from;
  for (let i = from; i < to; i++) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - from)) / (n - 1));
    re += data[i] * hann * Math.cos(w * i);
    im += data[i] * hann * Math.sin(w * i);
    norm += hann;
  }
  return (2 * Math.hypot(re, im)) / norm;
}

export interface CueReport {
  /** Largest sample at the speakers, of a full scale of 1, and when it comes (s after the cue starts). */
  peak: number;
  peakAt: number;
  /** Root mean square over the whole render. */
  rms: number;
  /** Seconds until the sound has fallen to a hundredth of its peak for good. */
  length: number;
  /** For each frequency asked for: its amplitude in the window, of a full scale of 1. */
  at: Record<string, number>;
}

/**
 * Render one cue alone on an offline copy of the signal path (`name` as in the cue log: 'place',
 * 'drone', 'fanfare-spark', ...) and say how loud it is and how much of it lies at each of `freqs`
 * (Hz), measured over `window` (seconds from the start of the cue; by default the whole render).
 */
export async function renderCue(name: string, freqs: number[] = [], window?: [number, number], seconds = 3): Promise<CueReport> {
  const cue = SOLO[name];
  if (!cue) throw new Error(`no cue called ${name}: ${Object.keys(SOLO).join(', ')}`);
  const rate = 44100, t0 = 0.05;
  const ctx = offlineCtx(seconds, rate);
  const g = build(ctx);
  cue(g, t0);
  const out = await ctx.startRendering();
  const data = out.getChannelData(0), right = out.getChannelData(1);
  // (Both channels: a panned note is in one more than the other.)
  const mono = new Float32Array(data.length);
  let peak = 0, peakAt = 0, sum = 0;
  for (let i = 0; i < data.length; i++) {
    mono[i] = (data[i] + right[i]) / 2;
    const v = Math.max(Math.abs(data[i]), Math.abs(right[i]));
    if (v > peak) { peak = v; peakAt = i; }
    sum += mono[i] * mono[i];
  }
  let last = 0;
  for (let i = data.length - 1; i >= 0; i--) if (Math.max(Math.abs(data[i]), Math.abs(right[i])) > peak / 100) { last = i; break; }
  const from = Math.round((t0 + (window?.[0] ?? 0)) * rate), to = Math.min(data.length, Math.round((t0 + (window?.[1] ?? seconds)) * rate));
  const at: Record<string, number> = {};
  for (const f of freqs) at[String(f)] = +amplitudeAt(mono, rate, f, from, to).toFixed(5);
  return { peak: +peak.toFixed(4), peakAt: +(peakAt / rate - t0).toFixed(3), rms: +Math.sqrt(sum / data.length).toFixed(5), length: +(last / rate - t0).toFixed(3), at };
}

export interface SalesReport {
  /** Every tick as it was scheduled: when (s), and which step of the scale it played. */
  ticks: { t: number; step: number }[];
  /** Ticks found in the rendered sound itself (onsets of its envelope), in seconds. */
  onsets: number[];
  /** The most ticks in any one second, by the schedule and by the sound. */
  mostPerSecond: number;
  mostPerSecondHeard: number;
  /** How far each tick is from where it would be with no jitter, in ms: smallest and largest, and every one. */
  jitterMs: [number, number];
  offsets: number[];
  /** The peak of the rendered sound in each whole second. */
  peakBySecond: number[];
}

/**
 * Render `seconds` of sales on an offline copy of the signal path, driven by the code that drives
 * the live one: a batch of sales every `every` seconds plus a random overrun of up to `overrun`
 * seconds (in play the board sends one a second, late by part of a frame: 1 and 1/60), whose steps
 * `stepsAt(second)` gives; `freshAt` are the seconds at which Flow State starts. For checking,
 * without ears, that the figure cycles, that the voice steps back and comes back, and that there
 * are never more than three ticks in a second.
 */
export async function renderSales(seconds: number, stepsAt: (second: number) => number[], freshAt: number[] = [], every = 1, overrun = 1 / 60): Promise<SalesReport> {
  const rate = 22050;
  const ctx = offlineCtx(seconds + 1, rate);
  const g = build(ctx);
  // (Nothing ends on an offline path until it is rendered, so the cap on live voices would count every tick of the whole stretch.)
  g.voices = -1e9;
  const v = makeSaleVoice(g);
  const ticks: { t: number; step: number }[] = [];
  const offs: number[] = [];
  const fresh = freshAt.slice().sort((a, b) => a - b);
  for (let now = 0; now < seconds; now += every + Math.random() * overrun) {
    while (fresh.length && fresh[0] <= now) freshen(v, fresh.shift()!);
    for (const p of saleBatch(g, v, now, stepsAt(Math.floor(now)))) {
      ticks.push(p);
      offs.push(+((p.t - p.due) * 1000).toFixed(2));
    }
  }
  const out = await ctx.startRendering();
  const data = out.getChannelData(0);
  // Onsets: the first sample at which the sound is over a twentieth of the loudest tick after 6 ms under it.
  // (A tick is back under that 40 ms after it starts, and the next of its batch comes 55 ms after it at the soonest.)
  let top = 0;
  for (let i = 0; i < data.length; i++) top = Math.max(top, Math.abs(data[i]));
  const onsets: number[] = [];
  const hold = Math.round(rate * 0.006);
  let under = hold;
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > top / 20) {
      if (under >= hold) onsets.push(+(i / rate).toFixed(4));
      under = 0;
    } else under++;
  }
  const most = (times: number[]) => {
    let best = 0;
    for (let i = 0; i < times.length; i++) {
      let n = 0;
      for (let j = i; j < times.length && times[j] - times[i] < 1; j++) n++;
      best = Math.max(best, n);
    }
    return best;
  };
  const peakBySecond: number[] = [];
  for (let sec = 0; sec < seconds; sec++) {
    let m = 0;
    for (let i = sec * rate; i < (sec + 1) * rate && i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
    peakBySecond.push(+m.toFixed(4));
  }
  return {
    ticks: ticks.map((p) => ({ t: +p.t.toFixed(4), step: p.step })), onsets,
    mostPerSecond: most(ticks.map((p) => p.t)), mostPerSecondHeard: most(onsets),
    jitterMs: [+Math.min(...offs).toFixed(2), +Math.max(...offs).toFixed(2)], offsets: offs, peakBySecond,
  };
}
