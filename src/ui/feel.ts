// Feel: sound, haptics, celebrations and the guiding hand.
// Nothing here is called by the board or the panels: it listens to the
// hooks in ui.ts (simulation events, interface signals, the frame and the beat) and answers with
// sound (audio.ts), particles (fx.ts), the big celebrations (celebrate.ts) and the hand (hand.ts).
import { DATA_COLORS, DATA_NAMES, DataTier, MatId, NODE_DEFS, NodeType, TECHS } from '../content';
import { materialsAt, nodeById } from '../actions';
import { fmt } from '../economy';
import { inFlowState } from '../flow';
import { Meanwhile, activeGoal, goalView, meanwhileOf } from '../goals';
import { graph } from '../sim';
import { Game, GameEvent, GoalReward } from '../state';
import {
  audioState, buzz, cueAfford, cueClaim, cueConnect, cueError, cueExpand, cueExpandPops, cueFlowIn, cueLevel, cueLineDone, cuePayout, cuePlace,
  cueReady, cueSales, cueStart, cueSurplus, cueTip, freshenSales, initAudio, isMuted, onMuteChange, renderCue, renderPeak, renderSales,
  resetAudio, saleLevel, saleStep, setDrone, setMuted,
} from './audio';
import { boardRect, toClient, wireLine } from './board';
import { celebrateEnd, celebrateFirstData, celebrateFlow, celebrateGoal, celebrateResearch, cancelCelebrations, celebrating, initCelebrate } from './celebrate';
import { anchorPt, el, setAttr, setClass, setHTML } from './dom';
import { FlyOpts, Overlay, addOverlay, burst, clearParticles, fly, pop, ring, setMood, textWidth } from './fx';
import { Pt, bezierAt, matColor, nodeSize, outPorts, wireEnds } from './geom';
import { actOut, handState, initHand, tipSignal } from './hand';
import { lineAt } from './wires';
import { setResearchCard } from './hud-toasts';
import { addTopItem, renderPanels } from './panels';
import { onBeat, onFrame, onGame, onNewGame, onPress, onSignal, signal, ui } from './ui';

const GOLD = '#FFC857';
const UNLOCK = '#9DB8FF';
const AMBER = '#FFB020';

// ---------- recorder (for test scripts) ----------

interface LogEntry { t: number; kind: 'cue' | 'haptic' | 'celebrate' | 'hand' | 'pay'; name: string; detail?: string | number }
/**
 * The last 200 things that sounded, buzzed, celebrated, pointed or paid out, oldest first.
 * A payout is two entries for each counter it goes to: 'send' when the coins leave ("credits 12 from 720,116 to 202,28")
 * and 'land' when the first of them arrives ("credits 12").
 */
const log: LogEntry[] = [];

function record(kind: LogEntry['kind'], name: string, detail?: string | number) {
  log.push(detail === undefined ? { t: Math.round(performance.now()), kind, name } : { t: Math.round(performance.now()), kind, name, detail });
  if (log.length > 200) log.shift();
}

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reduced = () => !!reducedQuery?.matches;

// ---------- where things are ----------

let app: HTMLElement;

/** The middle of the screen: where a reward starts from when the HUD has not said where its button is. */
const centre = (): Pt => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

const centreOf = (selector: string): Pt | null => {
  const e = app.querySelector(selector);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return r.width || r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
};

const creditsPt = (): Pt => anchorPt('credits') ?? centreOf('[data-testid="credits"]') ?? { x: 60, y: 28 };
/** The top bar is what shows at this point: nothing (the tech tree on a phone, a full-screen card) lies over it. Reads layout: used once per payout. */
const inTopBar = (p: Pt): boolean => !!document.elementFromPoint(p.x, p.y)?.closest('#top');
/** A Data counter: the HUD's anchor if it has one, else the chip itself, else the credits counter. */
const dataPt = (k: DataTier): Pt => anchorPt(`data-${k}`) ?? centreOf(`[data-testid="data-${k}"] .sym`) ?? creditsPt();

// ---------- payouts ----------

/** How many coins a sum sends: six for a few credits, ten for a thousand. */
const coinCount = (amount: number) => Math.max(6, Math.min(10, 6 + Math.floor(Math.log10(Math.max(1, amount)) * 1.4)));
/**
 * A coin of a payout: 8 px across (`size` is its radius), 450 ms in the air, 40 ms after the one before.
 * It is seen above the panels around where it leaves from (the Claim button), so it comes out of the
 * button and not from under the goal card. (`small`: when the window above the panels is free it is
 * brought there at its small size, which costs a fifth of the full one to keep on screen; a payout
 * from a celebration card finds the full window already there.)
 */
const COIN: FlyOpts = { size: 4, ttl: 0.45, stagger: 0.04, jitter: 0, top: true, topAtStart: true, small: true };
/**
 * The amount beside its counter: 16 px bold in the counter's colour on a small dark plate, standing
 * 0.9 s and then fading over 0.3. It is an element of its own above the bar (.feel-amount, feel.css):
 * it pops in and fades by transform and opacity alone, so while it stands no canvas has to be redrawn
 * for it. The plate is the words plus LABEL_PAD px on each side, LABEL_H px high.
 */
const LABEL_PX = 16;
const LABEL_PAD = 7;
const LABEL_H = 26;
const LABEL_MS = 1200;
/** How long a counter carries the class `pop` after a coin has landed on it, in ms (the pop itself is 120 ms, feel.css). */
const POP_MS = 150;

const counterEl = (testid: string) => app.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const popTimers = new Map<string, number>();

/**
 * A coin has landed on a counter: its number and its symbol jump to 1.2 times their size and settle
 * back in 120 ms (feel.css, a transform on the two of them, so nothing in the bar moves). The class
 * `pop` is on the counter while that plays; `pop2` flips with every coin, which is what starts the
 * jump again while the last one is still settling.
 */
function popCounter(testid: string) {
  const e = counterEl(testid);
  if (!e) return;
  e.classList.add('pop');
  e.classList.toggle('pop2');
  clearTimeout(popTimers.get(testid));
  popTimers.set(testid, window.setTimeout(() => e.classList.remove('pop', 'pop2'), POP_MS));
}

/**
 * Where "+12¢" may stand, as the middle of its left edge (and how large it is): beside the counter
 * when nothing else is there; else inside it, right of its number and of its rate line (over its own
 * Flow bonus); otherwise just under the counter, below its rate line. It never covers the counter's
 * number or rate, another counter or a button, and never goes past the edge of the window. Reads
 * layout: called once for each counter a payout lands on.
 */
function labelSpot(testid: string, text: string): { at: Pt; where: 'beside' | 'inside' | 'under'; w: number; h: number } | null {
  const chip = counterEl(testid);
  const bar = document.getElementById('top');
  if (!chip || !bar) return null;
  const c = chip.getBoundingClientRect();
  if (!c.width || !c.height) return null;
  const w = Math.ceil(textWidth(text, LABEL_PX)) + LABEL_PAD * 2, h = LABEL_H;
  // The counter's own figures: its number and, when it shows one, its rate line ("+11.5/s").
  const own: DOMRect[] = [];
  for (const e of [chip.querySelector('.nums b'), chip.querySelector('.nums i')]) {
    const r = e?.getBoundingClientRect();
    if (r && r.width && r.height) own.push(r);
  }
  const others: DOMRect[] = [];
  for (const e of bar.querySelectorAll('.res, .datas, .techbtn, .ibtn')) {
    if (e === chip || chip.contains(e) || e.contains(chip)) continue;
    const r = e.getBoundingClientRect();
    if (r.width && r.height) others.push(r);
  }
  // Clear of everything by 3 px at rest, and not touching it while it pops in (a tenth larger each way for a moment).
  const m = Math.max(3, w * 0.1), mv = Math.max(2, h * 0.1);
  const fits = (x: number) => x >= m && x + w <= window.innerWidth - m;
  const hits = (rs: DOMRect[], x: number, y: number) => rs.some((r) => x < r.right + m && x + w > r.left - m && y - h / 2 - mv < r.bottom && y + h / 2 + mv > r.top);
  // The Data counters of a narrow bar are lines of one block: "beside" and "under" are then beside and under the block.
  const block = chip.parentElement?.classList.contains('datas') ? chip.parentElement.getBoundingClientRect() : null;
  const box = block && block.height > c.height ? block : c;
  // (Never so near the top of the window that its pop-in is cut off.)
  const y = Math.round(Math.max(h / 2 + mv + 2, c.top + c.height / 2));
  // Beside the counter, level with its middle.
  const besideX = Math.round(box.right + 5);
  if (fits(besideX) && !hits(others, besideX, y)) return { at: { x: besideX, y }, where: 'beside', w, h };
  // Inside it, right of its figures (over the Flow bonus, which is the counter's own).
  if (box === c && own.length) {
    const x = Math.round(Math.max(...own.map((r) => r.right)) + m + 3);
    if (fits(x) && !hits(others, x, y) && !hits(own, x, y)) return { at: { x, y }, where: 'inside', w, h };
  }
  // Under: centred under the counter, its top (at the height of its pop) just below the counter's foot,
  // so its rate line stays readable.
  const x = Math.round(Math.max(m, Math.min(window.innerWidth - m - w, box.left + box.width / 2 - w / 2)));
  return { at: { x, y: Math.round(box.bottom + 2 + mv + h / 2) }, where: 'under', w, h };
}

/** The amount standing at each counter right now: a second payout to the same counter adds to it instead of writing over it. */
const standing = new Map<string, { el: HTMLElement; amount: number; until: number; timer: number }>();

function showAmount(testid: string, amount: number, unit: string, color: string) {
  const now = performance.now();
  const was = standing.get(testid);
  let total = amount;
  if (was) {
    if (now < was.until) total += was.amount;
    clearTimeout(was.timer);
    was.el.remove();
    standing.delete(testid);
  }
  const text = `+${fmt(total)}${unit}`;
  const spot = labelSpot(testid, text);
  if (!spot) return;
  record('pay', 'label', `${testid} ${text} ${spot.where} ${spot.at.x},${spot.at.y} ${spot.w}x${spot.h}`);
  const a = app.getBoundingClientRect();
  const e = document.createElement('div');
  e.className = `feel-amount${reduced() ? ' calm' : ''}`;
  e.setAttribute('aria-hidden', 'true');
  e.textContent = text;
  e.style.cssText = `left:${spot.at.x - a.left}px;top:${spot.at.y - spot.h / 2 - a.top}px;width:${spot.w}px;height:${spot.h}px;--c:${color}`;
  app.appendChild(e);
  const timer = window.setTimeout(() => {
    e.remove();
    if (standing.get(testid)?.el === e) standing.delete(testid);
  }, LABEL_MS + 40);
  standing.set(testid, { el: e, amount: total, until: now + LABEL_MS * 0.75, timer });
}

/**
 * Send a reward from where it was earned to where it is counted: coins to the credits counter,
 * Data to its own counter, and a spark to each hotbar button a new tech has just added.
 * Six to ten coins by the size of the sum, 40 ms apart, each 450 ms in the air. Each one that lands
 * ticks (a rising run, scheduled on the audio clock when the first lands) and pops the counter; the
 * amount stands beside the counter from the first landing.
 * The coins are theatre: the game added the reward when it was claimed, and nothing here touches
 * what the counter reads.
 * With less motion asked for nothing flies and nothing pops: fx.fly() delivers at once, so the amount
 * appears beside the counter and fades, and the ticks play.
 */
function payout(from: Pt, r: GoalReward) {
  if (r.b) betaPaidAt = performance.now();
  let ticked = false;
  const at = (p: Pt) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const sends: (() => void)[] = [];
  let most = 0;
  // Each flight is noted when it leaves and when its first coin lands.
  // A counter that cannot be seen (on a phone the open tech tree lies over the top bar) gets the
  // ticks only: coins and a "+40¢" arriving on top of the tree would point at nothing.
  const send = (anchor: string, amount: number, to: Pt, unit: string, color: string, shape?: FlyOpts['shape']) => {
    const n = coinCount(amount);
    most = Math.max(most, n);
    sends.push(() => {
      record('pay', 'send', `${anchor} ${amount} from ${at(from)} to ${at(to)}`);
      const seen = inTopBar(to);
      const land = () => {
        record('pay', 'land', `${anchor} ${amount}`);
        if (seen) showAmount(anchor, amount, unit, color);
        if (!ticked) cuePayout(most);
        ticked = true;
      };
      const each = () => {
        record('pay', 'coin', anchor);
        popCounter(anchor);
      };
      if (seen) fly(from, to, color, n, land, { ...COIN, shape, each });
      else land();
    });
  };
  if (r.credits) send('credits', r.credits, creditsPt(), '¢', GOLD);
  for (const k of ['a', 'b', 'g'] as DataTier[]) {
    const amount = r[k];
    if (amount) send(`data-${k}`, amount, dataPt(k), DATA_NAMES[k], DATA_COLORS[k], 'diamond');
  }
  for (const go of sends) go();
  // A new machine in the hotbar: stars fly to where it has appeared. (They are drawn as far as the edge
  // of the stage, which the hotbar sits against.)
  for (const id of r.techs ?? []) {
    for (const type of Object.keys(NODE_DEFS) as NodeType[]) {
      if (NODE_DEFS[type].tech !== id) continue;
      const to = centreOf(`[data-testid="hot-${type}"]`);
      if (to) fly(from, to, UNLOCK, 5, undefined, { ttl: 0.42, stagger: 0.04, shape: 'star', size: 5 });
    }
  }
}

/**
 * The quick celebration: sparks and a ring where the player pressed, a chime, a light buzz, and the
 * reward on its way. Nothing is blocked. The sparks are above the panels, like the coins: the button
 * they come from is on the goal card.
 */
function smallCelebration(name: string, from: Pt, r: GoalReward, color = GOLD) {
  record('celebrate', 'small:' + name);
  cueClaim();
  buzz('claim', 15);
  // (With less motion asked for, fx draws neither sparks nor ring, and the reward arrives at once.)
  burst(from, color, 10, { top: true, small: true, power: 1.2 });
  ring(from, color, { top: true, small: true, size: 44 });
  payout(from, r);
}

// ---------- simulation events ----------

const batch: GameEvent[] = [];
let lastPress: Pt | null = null;
let lastPressAt = -1e9;

/**
 * Where an order's reward leaves from: where its Claim was pressed, if that was a moment ago and on
 * the order chip (the button is gone by the time the reward is sent); otherwise the middle of the chip.
 */
function orderFrom(): Pt {
  const chip = document.getElementById('order');
  if (lastPress && chip && performance.now() - lastPressAt < 600) {
    const r = chip.getBoundingClientRect();
    if (lastPress.x >= r.left && lastPress.x <= r.right && lastPress.y >= r.top && lastPress.y <= r.bottom) return lastPress;
  }
  return anchorPt('order') ?? centre();
}

/** The Market that takes the most of a material: where the first surplus is shown. */
function marketFor(g: Game, mat: MatId): number | null {
  let best: number | null = null, most = -1;
  const ins = graph(g).ins;
  for (const n of g.nodes) {
    if (n.type !== 'market') continue;
    let rate = -1;
    for (const w of ins.get(n.id) ?? []) if (w.mat === mat || materialsAt(g, w.from, w.port).includes(mat)) rate = Math.max(0, rate) + (w.mat === mat ? w.rate : 0);
    if (rate > most) { most = rate; best = n.id; }
  }
  return best;
}

// ---------- the end of a research wait ----------
// The tech the goal card is saving for (its step names it) is worked out at the end of every frame in
// which the goal or the board changed. When that tech is then researched, in the tree or by the queue,
// it gets a small card of its own (celebrateResearch): the end of the longest waits in the game.

/** The tech the active goal's step named at the end of the last frame, for this game. */
let saving: { g: Game; key: string; tech: string | null } | null = null;

function noteSaving(g: Game) {
  const key = `${g.goal.i}|${g.goal.ready ? 1 : 0}|${g.rev}`;
  if (saving && saving.g === g && saving.key === key) return;
  const goal = activeGoal(g);
  const step = goal && !g.goal.ready ? goal.step?.(g) ?? null : null;
  saving = { g, key, tech: step && 'tech' in step ? step.tech : null };
}

/**
 * The tech whose research now gets a card of its own (the one the goal card was saving for), or null.
 * A toast about researching it would say what the card says: the toasts read this to stay quiet.
 */
export const researchCardTech = (): string | null => (saving && saving.g === ui.g ? saving.tech : null);

// ---------- the first β ----------
// The first whole β of a game (a Lab has studied a Tier 2 item; the counter in the top bar has just
// turned from 0 to 1) gets the small card, unless a payout has just flown β to the counter, which says
// it already. A game that has had β before (or owns a tech priced in it) never gets it.

let betaSeen: { g: Game; seen: boolean } | null = null;
let betaPaidAt = -1e9;

const hasBeta = (g: Game) => g.data.b >= 1 || g.techs.some((t) => (TECHS[t]?.cost.b ?? 0) > 0);

function tickBeta() {
  const g = ui.g;
  const had = hasBeta(g);
  if (!betaSeen || betaSeen.g !== g) {
    betaSeen = { g, seen: had };
    return;
  }
  if (betaSeen.seen || !had) return;
  betaSeen.seen = true;
  if (performance.now() - betaPaidAt < 2500) return;
  celebrateFirstData();
}

/** Everything the simulation raised this frame, together: a claim brings its unlocks with it, and they are one moment, not three. */
function handleEvents(events: GameEvent[]) {
  // The Phone being made is a big moment in its own right: the goal turning ready beside it needs no sound of its own.
  const ended = events.some((e) => e.kind === 'demo-end');
  // The first surplus brings Market Lens with it ('tech', then 'surplus'): nobody pressed Research for
  // that one, so it gets no sparkle of its own.
  const surplus = events.some((e) => e.kind === 'surplus');
  // The tech the goal card was saving for has been researched (not granted with a claim): its own card.
  const goalTech = researchCardTech();
  const researched = !!goalTech && !events.some((e) => e.kind === 'goal-claimed') && events.some((e) => e.kind === 'tech' && e.id === goalTech);
  // β that comes with a claim is the claim's to announce, from the moment of the claim: a big card's payout
  // only flies a second later, and by then the beat has seen the counter turn (see tickBeta).
  if (events.some((e) => (e.kind === 'goal-claimed' || e.kind === 'order-claimed') && !!e.reward.b)) betaPaidAt = performance.now();
  let claimed: 'big' | 'small' | null = ended ? 'big' : null;
  for (const ev of events) {
    switch (ev.kind) {
      case 'goal-claimed':
        if (ev.big && ev.goal === 'make-lens') {
          // The Phone is celebrated at the moment it is made ('demo-end'), which always comes before its goal
          // can be claimed: in this batch, earlier in this session, or in a session before this save was
          // loaded. Claiming the goal afterwards (the summary's "Keep playing" does it for the player) is
          // a small celebration, or nothing while the big one is still up. It is never a second Phone card.
          claimed = 'big';
          if (!ended && !celebrating()) smallCelebration('goal', anchorPt('goal') ?? centre(), ev.reward);
        } else if (ev.big) {
          claimed = 'big';
          celebrateGoal(ev.goal, ev.reward);
        } else {
          claimed = claimed ?? 'small';
          // (Claimed from the slim bar over the open tech tree: the sparks go above the tree too.)
          smallCelebration('goal', anchorPt('goal') ?? centre(), ev.reward);
        }
        break;
      case 'order-claimed':
        claimed = claimed ?? 'small';
        smallCelebration('order', orderFrom(), ev.reward);
        break;
      case 'tech':
        // Granted by the goal just claimed: part of that celebration. The tech the goal was saving for: its
        // own card. Any other research: a small sparkle where the player pressed.
        if (researched && ev.id === goalTech) celebrateResearch(ev.id);
        else if (!claimed && !(surplus && ev.id === 'C1')) smallCelebration('tech', lastPress ?? centre(), {}, DATA_COLORS.a);
        break;
      case 'surplus': {
        // Something sells over its demand for the first time in this game: two uneasy notes, and one amber
        // ring at the Market that is taking it. (The toast and the gauges that explain it are the HUD's.)
        record('celebrate', 'surplus', ev.mat);
        cueSurplus();
        const market = marketFor(ui.g, ev.mat);
        const n = market == null ? null : nodeById(ui.g, market);
        if (n && !reduced()) {
          const { w, h } = nodeSize(n);
          worldRing({ x: n.x + w / 2, y: n.y + h / 2 }, AMBER, 96, 1.0, `market ${n.id}`);
        }
        break;
      }
      case 'unlock':
        if (!claimed) smallCelebration('unlock', anchorPt(ev.what === 'flow' ? 'flow' : 'order') ?? centre(), {}, UNLOCK);
        break;
      case 'goal-ready':
      case 'order-ready': {
        // The Claim button lighting up is the HUD's to show; this is only its sound. Straight after a claim
        // the chime is still ringing: a big one says enough, a small one gets its "ready" a beat later.
        if (claimed === 'big') break;
        // (Researching the goal's tech can finish the goal: the research card's run of bells goes first.)
        if (claimed || researched) setTimeout(cueReady, researched ? 900 : 450);
        else cueReady();
        break;
      }
      case 'flow-state':
        record('celebrate', ev.first ? 'flow:first' : 'flow');
        // (The sales are worth hearing again: they have just started paying more.)
        freshenSales();
        if (ev.first) celebrateFlow();
        else {
          // Every time after the first: a soft rising tone, a ring on the Flow meter, and a shimmer
          // that runs once around the board's edge. Two seconds, and nothing in the way.
          cueFlowIn();
          const at = anchorPt('flow');
          if (!reduced()) {
            if (at) ring(at, '#5CE1FF', { top: true, size: 48, life: 0.8 });
            shimmer = 0;
          }
        }
        break;
      case 'demo-end':
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

/** The pitch step of each Market that sold in the second just gone; played as one soft run of ticks. */
const sales: number[] = [];
/**
 * Each Market's takings, smoothed, and the pitch step they are held at. Items arrive in bursts (a
 * machine that makes one every two seconds pays every other second), so one second's takings jump
 * about even when the line is steady. The step follows the smoothed figure, and it holds: it moves
 * only when the takings are clearly on another step (three quarters of the way there), so the ticks'
 * figure is heard around one note instead of hopping between two.
 */
const takings = new Map<number, { smooth: number; n: number; step: number }>();

function onSale(d: { id: number; amount: number }) {
  let t = takings.get(d.id);
  if (!t) takings.set(d.id, (t = { smooth: d.amount, n: 0, step: saleStep(saleLevel(d.amount)) }));
  // A plain average over the first few seconds, then a slow follower.
  t.n++;
  t.smooth += (d.amount - t.smooth) * Math.max(0.15, 1 / t.n);
  const level = saleLevel(t.smooth);
  if (Math.abs(level - t.step) > 0.75) t.step = saleStep(level);
  sales.push(t.step);
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
interface Racer { a: Pt; b: Pt; color: string; t: number; wire: number }
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
      // (Along the wire as the board draws it, curved or squared, round its pins; the plain curve until it is drawn.)
      const line = wireLine(r.wire);
      c.beginPath();
      for (let s = 0; s <= 8; s++) {
        const at = tail + ((head - tail) * s) / 8;
        const p = toClient(line ? lineAt(line, at) : bezierAt(r.a, r.b, at));
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
  if (ends && wire) racers.push({ a: ends.a, b: ends.b, color, t: 0, wire: wire.id });
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

// Rings that belong to a spot on the board (a deposit popping up, the Market that oversold): kept in
// world space and drawn where that spot is on each frame, so they stay on it while the camera glides.
interface WorldRing { x: number; y: number; color: string; size: number; life: number; t: number }
const worldRings: WorldRing[] = [];

/** One ring opening on a point of the board. `size` is its final radius in world px. Noted in the log with where it started on screen. */
function worldRing(at: Pt, color: string, size: number, life: number, what: string) {
  if (reduced()) return;
  const p = toClient(at);
  record('celebrate', 'ring', `${what} ${Math.round(p.x)},${Math.round(p.y)}`);
  worldRings.push({ x: at.x, y: at.y, color, size, life, t: 0 });
}

const worldRingOverlay: Overlay = {
  active: () => worldRings.length > 0,
  draw(c, dt) {
    const k = ui.view.k;
    for (let i = worldRings.length - 1; i >= 0; i--) {
      const r = worldRings[i];
      r.t += dt;
      const u = r.t / r.life;
      if (u >= 1) {
        worldRings.splice(i, 1);
        continue;
      }
      const p = toClient(r);
      const e = 1 - (1 - u) * (1 - u);
      c.globalAlpha = (1 - u) * 0.9;
      c.strokeStyle = r.color;
      c.lineWidth = 3 * (1 - u) + 1;
      c.beginPath();
      c.arc(p.x, p.y, Math.max(6, (r.size * 0.25 + r.size * 0.75 * e) * k), 0, Math.PI * 2);
      c.stroke();
    }
    c.globalAlpha = 1;
  },
};

// The board has grown. The camera glides out for about 0.6 s (the board's doing) and the new deposits
// pop in one after another; here that gets a rush of air, and for each deposit, at the moment it
// appears, a small rising pop and one ring on it. Where the deposit is on screen is taken at that
// moment and followed from there, because the camera is still moving.
const expandTimers: number[] = [];

function onExpand(d: { deposits: number[]; stagger: number }) {
  for (const t of expandTimers.splice(0)) clearTimeout(t);
  record('celebrate', 'expand', d.deposits.join(','));
  const stagger = Math.max(0, d.stagger);
  cueExpand();
  // (The pops are put on the audio clock here and now, `stagger` apart: a busy frame cannot make them late.)
  cueExpandPops(d.deposits.length, stagger / 1000);
  buzz('expand', 15);
  const g = ui.g;
  d.deposits.forEach((id, i) => {
    expandTimers.push(window.setTimeout(() => {
      if (ui.g !== g) return;
      const dep = g.deposits.find((x) => x.id === id);
      if (dep) worldRing({ x: dep.x + 86, y: dep.y + 36 }, '#ffffff', 70, 0.55, `deposit ${id}`);
    }, i * stagger));
  });
}

// ---------- the goal card's "while you wait" lines ----------
// A goal may carry several lines, shown one at a time (goalView(g).meanwhile: the first not yet done, with
// its `step` of `of`). Looked at twice a second: when a line of the goal on the card turns from not done to
// done, a small cue says so (the card draws the tick), once for each line, keyed by the goal and the line's
// step. The line on the card moving on to the next one is not itself a tick: what is checked is the line
// that was on the card, by its own done(). Nothing plays when the game is loaded or replaced, when the
// goal changes, or for a line that was already done when it first showed.
let lineSeen: { g: Game; goal: number; line: Meanwhile; step: number; done: boolean } | null = null;
/** The lines whose tick has played in this game, as "goal:step". */
const linesTicked = new Set<string>();
let lineBeat = 0;

function lineTicked(goal: number, step: number) {
  const key = `${goal}:${step}`;
  if (linesTicked.has(key)) return;
  linesTicked.add(key);
  record('celebrate', 'line-done', key);
  cueLineDone();
  buzz('line', 8);
}

function tickLine() {
  if (++lineBeat % 2) return;
  const g = ui.g;
  const line = meanwhileOf(g);
  // (While the goal is ready to claim there is no line on the card: whatever was seen is kept for when it comes back.)
  if (!line) {
    if (lineSeen && (lineSeen.g !== g || lineSeen.goal !== g.goal.i)) lineSeen = null;
    return;
  }
  const step = goalView(g)?.meanwhile?.step ?? 1;
  const done = line.done(g);
  const was = lineSeen;
  lineSeen = { g, goal: g.goal.i, line, step, done };
  if (!was || was.g !== g || was.goal !== g.goal.i) return;
  // The line that was on the card has been done since the last look: on the card itself, or the card has
  // already moved on to the next line because of it.
  if (!was.done && (was.line === line ? done : was.line.done(g))) lineTicked(was.goal, was.step);
}

// ---------- Flow State ----------

let inFlow = false;
let edge: HTMLElement | null = null;
/** The glow around the board is wanted (Flow State is on), and how far its bright line has faded in, 0..1. */
let edgeOn = false;
let edgeLevel = 0;
let edgeClock = 0;
/** Seconds for one breath of the glow. */
const BREATH = 4.4;
/** Seconds the shimmer takes to run around the board's edge when Flow State comes back; `shimmer` is how far into it we are. */
const SHIMMER = 2;
let shimmer = SHIMMER;

// The bright line along the board's edge, which swells and sinks while the soft glow behind it
// (four still strips, feel.css) stays put. Drawn here because this canvas is redrawn every frame anyway.
const edgeOverlay: Overlay = {
  // (It stands still on the screen and changes slowly: a busy board may draw it about 30 times a second.)
  slow: true,
  active: () => edgeOn || edgeLevel > 0.01 || shimmer < SHIMMER,
  draw(c, dt) {
    edgeLevel += ((edgeOn ? 1 : 0) - edgeLevel) * (1 - Math.exp(-dt / (edgeOn ? 0.5 : 0.9)));
    edgeClock += dt;
    const breath = reduced() ? 0.5 : 0.5 - 0.5 * Math.cos((edgeClock / BREATH) * Math.PI * 2);
    const r = boardRect();
    c.strokeStyle = '#5CE1FF';
    c.globalAlpha = edgeLevel * (0.1 + 0.12 * breath);
    c.lineWidth = 10;
    c.strokeRect(r.left + 5, r.top + 5, r.width - 10, r.height - 10);
    c.globalAlpha = edgeLevel * (0.3 + 0.4 * breath);
    c.lineWidth = 2;
    c.strokeRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2);
    if (shimmer < SHIMMER) {
      // Two streaks of light, opposite each other, run once around the edge and fade as they go.
      shimmer += dt;
      const u = Math.min(1, shimmer / SHIMMER);
      const around = 2 * (r.width + r.height) - 12;
      const streak = around * 0.16;
      c.setLineDash([streak, around / 2 - streak]);
      c.lineDashOffset = -around * (u * u * (3 - 2 * u)) * 0.5;
      c.lineCap = 'round';
      const glow = Math.sin(Math.PI * u);
      c.strokeStyle = '#5CE1FF';
      c.globalAlpha = 0.35 * glow;
      c.lineWidth = 9;
      c.strokeRect(r.left + 3, r.top + 3, r.width - 6, r.height - 6);
      c.strokeStyle = '#ffffff';
      c.globalAlpha = 0.85 * glow;
      c.lineWidth = 2.5;
      c.strokeRect(r.left + 3, r.top + 3, r.width - 6, r.height - 6);
      c.setLineDash([]);
      c.lineDashOffset = 0;
      c.lineCap = 'butt';
    }
    c.globalAlpha = 1;
  },
};

function tickFlow() {
  const g = ui.g;
  const state = inFlowState(g);
  // The glow around the board: the strips fade in and out by themselves (feel.css), the line follows (above).
  if (state !== edgeOn) {
    edgeOn = state;
    if (state) edgeClock = 0;
    if (edge) setClass(edge, 'on', state);
  }
  // The hum and the quicker dots stop while the game is paused: a paused factory is not humming.
  const on = state && !g.paused;
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
  onPress(btn, () => setMuted(!isMuted()));
  // Painted whenever sound is switched, by this button or by anything else (the phone's gear menu
  // calls setMuted too), and again with every refresh of the top bar. The bar is refreshed at the same
  // moment, so the gear menu's Sound row (which a phone shows instead of this button) never lags behind.
  onMuteChange(() => {
    paint();
    renderPanels();
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
  // The research card says what a toast would: the toasts are told which research it covers.
  setResearchCard(researchCardTech);
  addOverlay(racerOverlay);
  addOverlay(edgeOverlay);
  addOverlay(worldRingOverlay);
  addMuteButton();

  // The glow around the board's edge in Flow State: four strips, one along each edge of the stage,
  // just above the board and under the HUD.
  const stage = document.getElementById('stage');
  if (stage) stage.appendChild((edge = el(`<div id="feel-edge" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`)));

  window.addEventListener('pointerdown', (e) => {
    lastPress = { x: e.clientX, y: e.clientY };
    lastPressAt = performance.now();
  }, { capture: true, passive: true });

  // The press on Start (or Continue) is the first sound of the game. #app is marked `started` by that
  // press; under ?play it is marked while the page loads, with no press, and then there is no sound
  // to make (audio.ts starts nothing before a press).
  if (typeof MutationObserver !== 'undefined') {
    let was = app.classList.contains('started');
    new MutationObserver(() => {
      const is = app.classList.contains('started');
      if (is && !was) cueStart();
      was = is;
    }).observe(app, { attributes: true, attributeFilter: ['class'] });
  }

  onGame((ev) => void batch.push(ev));
  onSignal('sale', onSale);
  onSignal('connect', onConnect);
  onSignal('place', onPlace);
  // A card came level with what it is wired to (board.ts): a soft click, and a tick under the finger.
  onSignal('level', () => {
    cueLevel();
    buzz('level', 6);
  });
  // (The hotbar button's own pulse is in phone.css; this is the bell that goes with it.)
  onSignal('afford', () => cueAfford());
  // The goal card's tip: a soft cue when one appears (audio.ts lets one through every 20 s), the hand
  // at its Show me button when it has gone stale, and the hand acting it out when Show me is pressed.
  onSignal('tip', (d) => {
    if (d.state === 'shown') cueTip();
    tipSignal(d);
  });
  onSignal('showme', actOut);
  onSignal('expand', onExpand);

  onFrame(() => {
    if (batch.length) handleEvents(batch.splice(0));
    // (After the events: what the goal is saving for as the frame ends, for a research in the next one.)
    noteSaving(ui.g);
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
  onBeat(tickLine);
  onBeat(tickBeta);
  onNewGame(() => {
    // Back to the beginning: nothing waiting, nothing flying, nothing humming, nothing glowing.
    // (No beat runs behind the start screen, so Flow State's hum and glow are put out here.)
    batch.length = 0;
    sales.length = 0;
    takings.clear();
    racers.length = 0;
    worldRings.length = 0;
    for (const t of expandTimers.splice(0)) clearTimeout(t);
    lineSeen = null;
    linesTicked.clear();
    saving = null;
    betaSeen = null;
    for (const st of standing.values()) {
      clearTimeout(st.timer);
      st.el.remove();
    }
    standing.clear();
    for (const [testid, t] of popTimers) {
      clearTimeout(t);
      counterEl(testid)?.classList.remove('pop', 'pop2');
    }
    popTimers.clear();
    cancelCelebrations();
    clearParticles();
    resetAudio();
    inFlow = edgeOn = false;
    edgeLevel = 0;
    shimmer = SHIMMER;
    setMood(0, true);
    if (edge) setClass(edge, 'on', false);
    creditsGame = null;
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
    hook.feel ??= {
      log, audioState, hand: handState, celebrating, muted: isMuted, setMuted,
      /** The tech whose research would get a card of its own right now (the one the goal card is saving for), or null. */
      researchTech: researchCardTech,
      /** Raise an interface signal as the HUD would: emit('tip', { state: 'stale', at }), emit('showme', { wire: { from, to } }). */
      emit: signal,
      /** Render the loudest pile-up of cues offline and report its peak (see renderPeak in audio.ts). */
      renderPeak,
      /** Render one cue alone, or a stretch of sales, offline (see renderCue and renderSales in audio.ts). */
      renderCue, renderSales,
      /** Where things are on screen, in client px: a node's output port, the middle of a node, the middle of a deposit. */
      where: {
        port: (id: number, i = 0) => {
          const n = nodeById(ui.g, id);
          const p = n && outPorts(ui.g, n)[i];
          return p ? toClient(p) : null;
        },
        node: (id: number) => {
          const n = nodeById(ui.g, id);
          if (!n) return null;
          const { w, h } = nodeSize(n);
          return toClient({ x: n.x + w / 2, y: n.y + h / 2 });
        },
        deposit: (id: number) => {
          const d = ui.g.deposits.find((x) => x.id === id);
          return d ? toClient({ x: d.x + 86, y: d.y + 36 }) : null;
        },
      },
    };
    return true;
  };
  queueMicrotask(() => {
    if (!attach()) setTimeout(attach, 0);
  });
}
