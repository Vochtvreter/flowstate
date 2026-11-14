// Feel: sound, haptics, celebrations and the guiding hand.
// Owned by the feel track. Nothing here is called by the board or the panels: it listens to the
// hooks in ui.ts (simulation events, interface signals, the frame and the beat) and answers with
// sound (audio.ts), particles (fx.ts), the big celebrations (celebrate.ts) and the hand (hand.ts).
import { DATA_COLORS, DataTier, NODE_DEFS, NodeType } from '../content';
import { materialsAt, nodeById } from '../actions';
import { fmt } from '../economy';
import { inFlowState } from '../flow';
import { Game, GameEvent, GoalReward } from '../state';
import {
  audioState, buzz, cueAfford, cueClaim, cueConnect, cueError, cueFlowIn, cuePayout, cuePlace, cueReady, cueSales, initAudio,
  isMuted, setDrone, setMuted,
} from './audio';
import { boardRect, toClient } from './board';
import { celebrateEnd, celebrateFlow, celebrateGoal, cancelCelebrations, celebrating, initCelebrate } from './celebrate';
import { anchorPt, el, pulseAnchor, setAttr, setClass, setHTML } from './dom';
import { Overlay, addOverlay, burst, floater, fly, pop, ring, setMood } from './fx';
import { Pt, bezierAt, matColor, nodeSize, wireEnds } from './geom';
import { handState, initHand } from './hand';
import { addTopItem } from './panels';
import { onBeat, onFrame, onGame, onNewGame, onPress, onSignal, ui } from './ui';

const GOLD = '#FFC857';
const UNLOCK = '#9DB8FF';

// ---------- recorder (for test scripts) ----------

interface LogEntry { t: number; kind: 'cue' | 'haptic' | 'celebrate' | 'hand'; name: string; detail?: string | number }
/** The last 200 things that sounded, buzzed, celebrated or pointed, oldest first. */
const log: LogEntry[] = [];

function record(kind: LogEntry['kind'], name: string, detail?: string | number) {
  log.push(detail === undefined ? { t: Math.round(performance.now()), kind, name } : { t: Math.round(performance.now()), kind, name, detail });
  if (log.length > 200) log.shift();
}

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!reducedQuery?.matches;

// ---------- where things are ----------

let app: HTMLElement;

const centre = (): Pt => {
  const r = app.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

const centreOf = (selector: string): Pt | null => {
  const e = app.querySelector(selector);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
};

const creditsPt = (): Pt => anchorPt('credits') ?? centreOf('[data-testid="credits"]') ?? { x: 60, y: 28 };
/** A Data counter: the HUD's anchor if it has one, else the chip itself, else the credits counter. */
const dataPt = (k: DataTier): Pt => anchorPt(`data-${k}`) ?? centreOf(`[data-testid="data-${k}"] .sym`) ?? creditsPt();

// ---------- payouts ----------

/** How many coins to send for a sum: a few for a few, more for more, never a swarm. */
const coinCount = (amount: number) => Math.max(3, Math.min(9, 2 + Math.round(Math.log10(Math.max(1, amount)) * 2.2)));

/**
 * Send a reward from where it was earned to where it is counted: coins to the credits counter,
 * Data to its chip, and a spark to each hotbar button a new tech has just added. Each lands with a
 * pulse on the counter and a short rising run of ticks. The amount is written `lift` px above `from`.
 */
function payout(from: Pt, r: GoalReward, lift = 10) {
  if (reduced()) return;
  let ticked = false;
  const land = (anchor: string, n: number) => () => {
    pulseAnchor(anchor);
    if (!ticked) cuePayout(Math.min(6, n));
    ticked = true;
  };
  const quick = { ttl: 0.3, stagger: 0.035 };
  let line = 0;
  const say = (text: string, color: string) => floater({ x: from.x, y: from.y - lift - 22 * line++ }, text, color, 15, { top: true, life: 1.2, rise: 30 });
  if (r.credits) {
    const n = coinCount(r.credits);
    fly(from, creditsPt(), GOLD, n, land('credits', n), quick);
    say(`+${fmt(r.credits)}¢`, GOLD);
  }
  for (const k of ['a', 'b', 'g'] as DataTier[]) {
    const amount = r[k];
    if (!amount) continue;
    const n = coinCount(amount);
    fly(from, dataPt(k), DATA_COLORS[k], n, land(`data-${k}`, n), { ...quick, shape: 'diamond', size: 4.6 });
    say(`+${fmt(amount)}${k === 'a' ? 'α' : k === 'b' ? 'β' : 'γ'}`, DATA_COLORS[k]);
  }
  // A new machine in the hotbar: show the player where it has appeared.
  for (const id of r.techs ?? []) {
    for (const type of Object.keys(NODE_DEFS) as NodeType[]) {
      if (NODE_DEFS[type].tech !== id) continue;
      const to = centreOf(`[data-testid="hot-${type}"]`);
      if (to) fly(from, to, UNLOCK, 5, () => ring(to, UNLOCK, { top: true, size: 36 }), { ttl: 0.42, stagger: 0.04, shape: 'star', size: 5 });
    }
  }
}

/** The quick celebration: a reward flies off, a chime, a light buzz. About a third of a second, and nothing is blocked. */
function smallCelebration(name: string, from: Pt, r: GoalReward, color = GOLD) {
  record('celebrate', 'small:' + name);
  cueClaim();
  buzz('claim', 15);
  if (reduced()) return;
  burst(from, color, 8, { top: true });
  ring(from, color, { top: true });
  payout(from, r);
}

// ---------- simulation events ----------

const batch: GameEvent[] = [];
let lastPress: Pt | null = null;

/** The game whose first Lens has been celebrated in this session (the bow and the Lens card). */
let bowedFor: Game | null = null;

/** Everything the simulation raised this frame, together: a claim brings its unlocks with it, and they are one moment, not three. */
function handleEvents(events: GameEvent[]) {
  // The Lens being made is a big moment in its own right: the goal turning ready beside it needs no sound of its own.
  const ended = events.some((e) => e.kind === 'demo-end');
  let claimed: 'big' | 'small' | null = ended ? 'big' : null;
  for (const ev of events) {
    switch (ev.kind) {
      case 'goal-claimed':
        if (ev.big && ev.goal === 'make-lens' && (ended || bowedFor === ui.g)) {
          // The Lens is celebrated when it is made ('demo-end'). Claiming its goal afterwards (the summary's
          // "Keep playing" does it for the player) is a quiet tick, or nothing while that celebration is still up.
          claimed = 'big';
          if (!ended && !celebrating()) smallCelebration('goal', anchorPt('goal') ?? centre(), ev.reward);
        } else if (ev.big) {
          claimed = 'big';
          celebrateGoal(ev.goal, ev.reward);
        } else {
          claimed = claimed ?? 'small';
          smallCelebration('goal', anchorPt('goal') ?? centre(), ev.reward);
        }
        break;
      case 'order-claimed':
        claimed = claimed ?? 'small';
        smallCelebration('order', anchorPt('order') ?? centre(), ev.reward);
        break;
      case 'tech':
        // Granted by the goal just claimed: part of that celebration. Researched: its own small one, where the player pressed.
        if (!claimed) smallCelebration('tech', lastPress ?? centre(), {}, DATA_COLORS.a);
        break;
      case 'unlock':
        if (!claimed) smallCelebration('unlock', anchorPt(ev.what === 'flow' ? 'flow' : 'order') ?? centre(), {}, UNLOCK);
        break;
      case 'goal-ready':
      case 'order-ready': {
        const anchor = ev.kind === 'goal-ready' ? 'goal' : 'order';
        // Straight after a claim the chime is still ringing: a big one says enough, a small one gets its "ready" a beat later.
        if (claimed === 'big') break;
        const ready = () => {
          cueReady();
          const at = anchorPt(anchor);
          if (at && !reduced()) ring(at, ev.kind === 'goal-ready' ? '#4ADE80' : GOLD, { top: true, size: 40 });
        };
        if (claimed) setTimeout(ready, 450);
        else ready();
        break;
      }
      case 'flow-state':
        record('celebrate', ev.first ? 'flow:first' : 'flow');
        if (ev.first) celebrateFlow();
        else {
          cueFlowIn();
          const at = anchorPt('flow');
          if (at && !reduced()) ring(at, '#5CE1FF', { top: true, size: 48, life: 0.8 });
        }
        break;
      case 'demo-end':
        bowedFor = ui.g;
        celebrateEnd();
        break;
      case 'toast':
        cueError();
        break;
      default:
        break;
    }
  }
}

// ---------- interface signals ----------

/** Credits each Market earned in the second just gone; played as one soft run of ticks. */
const sales: number[] = [];
/**
 * Each Market's takings, smoothed. Items arrive in bursts, so one second's takings jump about even
 * when the line is steady; the tick's pitch follows the smoothed figure and stays put.
 */
const takings = new Map<number, number>();

function onSale(d: { id: number; amount: number }) {
  const before = takings.get(d.id);
  const smooth = before == null ? d.amount : before + (d.amount - before) * 0.3;
  takings.set(d.id, smooth);
  sales.push(smooth);
  if (reduced() || ui.techOpen) return;
  // The Market's coin pops. (The floating "+N¢" and the coins to the counter are the board's.)
  const n = nodeById(ui.g, d.id);
  if (!n) return;
  const p = toClient({ x: n.x + 29, y: n.y + nodeSize(n).h / 2 });
  const r = boardRect();
  if (p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom) pop(p, GOLD, 13 * ui.view.k);
}

// A streak of light that runs along a wire the moment it is connected, from the source to the
// target, and ends in a burst there. Drawn in world space so it stays on the wire.
interface Racer { a: Pt; b: Pt; color: string; t: number }
const racers: Racer[] = [];
const RACE = 0.26;

const racerOverlay: Overlay = {
  active: () => racers.length > 0,
  draw(c, dt) {
    const k = ui.view.k;
    c.lineCap = 'round';
    for (let i = racers.length - 1; i >= 0; i--) {
      const r = racers[i];
      r.t += dt;
      const u = r.t / RACE;
      if (u >= 1) {
        racers.splice(i, 1);
        burst(toClient(r.b), r.color, 9);
        ring(toClient(r.b), '#ffffff');
        continue;
      }
      const head = u * u * (3 - 2 * u);
      const tail = Math.max(0, head - 0.3);
      c.beginPath();
      for (let s = 0; s <= 8; s++) {
        const p = toClient(bezierAt(r.a, r.b, tail + ((head - tail) * s) / 8));
        if (s) c.lineTo(p.x, p.y);
        else c.moveTo(p.x, p.y);
      }
      c.globalAlpha = 0.35;
      c.strokeStyle = r.color;
      c.lineWidth = Math.max(5, 11 * k);
      c.stroke();
      c.globalAlpha = 0.9;
      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(2.5, 5 * k);
      c.stroke();
    }
    c.globalAlpha = 1;
  },
};

function onConnect(d: { from: number; to: number; at: Pt }) {
  cueConnect();
  buzz('connect', 8);
  if (reduced()) return;
  const g = ui.g;
  let wire = null;
  for (let i = g.wires.length - 1; i >= 0 && !wire; i--) if (g.wires[i].from === d.from && g.wires[i].to === d.to) wire = g.wires[i];
  const ends = wire && wireEnds(g, wire);
  const color = matColor(wire ? materialsAt(g, wire.from, wire.port)[0] ?? null : null);
  if (ends) racers.push({ a: ends.a, b: ends.b, color, t: 0 });
  else {
    burst(d.at, color, 9);
    ring(d.at, '#ffffff');
  }
}

function onPlace(d: { id: number }) {
  cuePlace();
  if (reduced()) return;
  // The card drops in and squashes (feel.css); a puff of dust leaves its feet as it lands.
  setTimeout(() => {
    const n = nodeById(ui.g, d.id);
    if (!n) return;
    const { w, h } = nodeSize(n);
    const k = ui.view.k;
    const foot = toClient({ x: n.x + w / 2, y: n.y + h });
    burst({ x: foot.x - w * k * 0.32, y: foot.y }, '#8C97AD', 4, { power: 0.55 });
    burst({ x: foot.x + w * k * 0.32, y: foot.y }, '#8C97AD', 4, { power: 0.55 });
  }, 120);
}

// ---------- Flow State ----------

let inFlow = false;

function tickFlow() {
  const g = ui.g;
  const on = inFlowState(g) && !g.paused;
  if (on !== inFlow) {
    inFlow = on;
    setMood(on ? 1 : 0);
  }
  // Asked for on every beat: it starts as soon as there is sound to start it with, and a second call is free.
  setDrone(on, on ? 0.7 : 0.9);
}

// ---------- mute button ----------

const SPEAKER = '<path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" class="ic"/>';
const ICON_ON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${SPEAKER}<path d="M14.5 9.2a4 4 0 0 1 0 5.6M17 6.8a7.4 7.4 0 0 1 0 10.4" class="ic"/></svg>`;
const ICON_OFF = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${SPEAKER}<path d="M15 9.5l5 5M20 9.5l-5 5" class="ic"/></svg>`;

function addMuteButton() {
  const btn = el<HTMLButtonElement>(`<button class="ibtn" data-testid="mute" type="button"></button>`);
  const paint = () => {
    const off = isMuted();
    const label = off ? 'Sound is off' : 'Sound is on';
    setClass(btn, 'off', off);
    setAttr(btn, 'aria-pressed', off ? 'true' : 'false');
    setAttr(btn, 'aria-label', label);
    setAttr(btn, 'title', label);
    setHTML(btn, off ? ICON_OFF : ICON_ON);
  };
  onPress(btn, () => {
    setMuted(!isMuted());
    paint();
    // Switching it on answers with a sound, so the player hears that it worked.
    if (!isMuted()) cueAfford();
  });
  addTopItem('actions', { el: btn, update: paint }, document.querySelector('#top .menuwrap'));
}

// ---------- init ----------

let creditsGame: Game | null = null;
let lastCredits = 0;

export function initFeel() {
  app = document.getElementById('app') ?? document.body;
  initAudio(record);
  initCelebrate({ record, payout });
  initHand({ record, busy: celebrating });
  addOverlay(racerOverlay);
  addMuteButton();

  // The glow around the board's edge in Flow State. It sits in the stage, above the board and under the HUD.
  const stage = document.getElementById('stage');
  if (stage) stage.appendChild(el(`<div id="feel-edge" aria-hidden="true"></div>`));

  window.addEventListener('pointerdown', (e) => (lastPress = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });

  onGame((ev) => void batch.push(ev));
  onSignal('sale', onSale);
  onSignal('connect', onConnect);
  onSignal('place', onPlace);
  onSignal('afford', (d) => {
    cueAfford();
    if (!reduced()) ring(d.at, GOLD, { top: true, size: 34 });
  });

  onFrame(() => {
    if (batch.length) handleEvents(batch.splice(0));
    if (sales.length) {
      cueSales(sales);
      sales.length = 0;
    }
    // Credits going down means something was bought (an upgrade, a wire, an expansion): the same thump as placing a node.
    const g = ui.g;
    if (g !== creditsGame) creditsGame = g;
    else if (g.credits < lastCredits - 0.5) cuePlace();
    lastCredits = g.credits;
  });
  onBeat(tickFlow);
  onNewGame(() => {
    batch.length = 0;
    sales.length = 0;
    takings.clear();
    bowedFor = null;
    racers.length = 0;
    cancelCelebrations();
  });

  // A refusal shows as a red toast, whoever raised it: knock once for each.
  const toasts = document.getElementById('toasts');
  if (toasts && typeof MutationObserver !== 'undefined') {
    new MutationObserver((changes) => {
      for (const ch of changes) {
        for (const n of ch.addedNodes) if (n instanceof HTMLElement && n.classList.contains('toast') && n.classList.contains('bad')) cueError();
      }
    }).observe(toasts, { childList: true });
  }

  // main.ts builds window.flowstate after the modules have started, so the recorder joins it a moment later.
  const attach = () => {
    const hook = (window as unknown as { flowstate?: Record<string, unknown> }).flowstate;
    if (!hook) return false;
    hook.feel ??= { log, audioState, hand: handState, celebrating, muted: isMuted, setMuted };
    return true;
  };
  queueMicrotask(() => {
    if (!attach()) setTimeout(attach, 0);
  });
}
