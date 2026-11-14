import './style.css';
import { MATERIALS, TECHS } from './content';
import { clearHistory, cutWire, deleteNode, nodeById, redo, refundOf, undo } from './actions';
import { fmt, fmtTime, has, offlineCap } from './economy';
import { offlineGains, tick } from './sim';
import { clearSave, loadGame, newGame, saveGame } from './state';
import {
  cancelGesture, ensureVisible, fitView, initBoard, pickRadial, radialOpen, startPlacing, updateBoard, updateSlow,
} from './ui/board';
import { matGlyph } from './ui/icons';
import { hotbarTypes, initPanels, renderPanels } from './ui/panels';
import { closeTech, initTech, openTech, renderTech } from './ui/tech';
import { initToasts, select, toast, touch, ui } from './ui/ui';

const STEP = 0.05;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function showAway(seconds: number, gains: { credits: number; a: number; b: number; g: number }) {
  if (gains.credits < 1 && gains.a < 1) return;
  const modal = $('modal');
  const parts = [`<span style="color:#FFC857">+${fmt(gains.credits)}¢</span>`];
  if (gains.a >= 1) parts.push(`<span style="color:#5EEAD4">+${fmt(gains.a)}α</span>`);
  if (gains.b >= 1) parts.push(`<span style="color:#C4A1FF">+${fmt(gains.b)}β</span>`);
  if (gains.g >= 1) parts.push(`<span style="color:#FF8FB1">+${fmt(gains.g)}γ</span>`);
  modal.innerHTML = `<div class="card"><h2>While you were away</h2><p>Your supply line kept running for <b>${fmtTime(seconds)}</b>.</p>
    <div class="gains mono">${parts.join(' · ')}</div><button id="collect">Collect</button></div>`;
  modal.classList.add('open');
  $('collect').addEventListener('click', () => modal.classList.remove('open'));
}

function boot() {
  const loaded = loadGame();
  ui.g = loaded ?? newGame();
  initToasts($('toasts'));
  initBoard($('board'));
  initTech($('tech'));
  initPanels(
    { top: $('top'), hot: $('hot'), insp: $('insp'), obj: $('objective'), alert: $('alert'), mini: $<HTMLCanvasElement>('mini'), zoom: $('zoom') },
    {
      openTech,
      reset: () => {
        clearSave();
        ui.g = newGame();
        clearHistory();
        ui.menuOpen = false;
        ui.placing = null;
        select(null);
        fitView();
      },
    },
  );
  fitView();
  if (loaded) {
    const away = (Date.now() - loaded.savedAt) / 1000;
    if (away > 30 && !loaded.paused) {
      const secs = Math.min(away, offlineCap(ui.g));
      showAway(secs, offlineGains(ui.g, secs));
    }
  }
  ui.g.events.length = 0;
  renderPanels();
  window.addEventListener('resize', () => touch());
  window.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', () => saveGame(ui.g));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveGame(ui.g);
  });
  setInterval(() => saveGame(ui.g), 10000);
  (window as unknown as Record<string, unknown>).flowstate = { ui, tick };
  requestAnimationFrame(frame);
}

function drainEvents() {
  const g = ui.g;
  if (!g.events.length) return;
  for (const ev of g.events.splice(0)) {
    if (ev.kind === 'milestone') {
      toast(`${matGlyph(ev.mat, 18)}<span><b>First ${MATERIALS[ev.mat].name}!</b> Milestone bonus <span class="mono" style="color:#FFC857">+${fmt(ev.reward)}¢</span></span>`, 'good', 4500);
    } else if (ev.kind === 'tech') {
      const t = TECHS[ev.id];
      toast(`<span><b>${t.name}</b> unlocked: ${t.unlocks.join(', ')}</span>`, 'good', 5000);
    } else toast(ev.text, 'bad');
  }
}

let last = performance.now();
let acc = 0;
let slow = 0;
let techTimer = 0;
let seenUi = -1;
let seenRev = -1;
let seenSel = '';

function frame(now: number) {
  const g = ui.g;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 5) {
    // The tab was in the background: credit the time away in one go.
    if (!g.paused) {
      const secs = Math.min(dt, offlineCap(g));
      const gains = offlineGains(g, secs);
      if (gains.credits >= 1) toast(`Back after ${fmtTime(secs)}: <span class="mono" style="color:#FFC857">+${fmt(gains.credits)}¢</span>`, 'good', 5000);
    }
    dt = 0;
  }
  if (!g.paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 120) {
      tick(g, STEP);
      acc -= STEP;
      n++;
    }
    if (n >= 120) acc = 0;
  }
  drainEvents();
  if (ui.uiRev !== seenUi || g.rev !== seenRev) {
    // Something structural changed: refresh panels right away rather than on the slow timer.
    const selKey = ui.sel ? `${ui.sel.kind}${ui.sel.id}` : '';
    seenUi = ui.uiRev;
    seenRev = g.rev;
    renderPanels();
    if (selKey !== seenSel && ui.sel?.kind === 'node') ensureVisible(ui.sel.id);
    seenSel = selKey;
  }
  updateBoard(dt);
  slow += dt;
  techTimer += dt;
  if (slow >= 0.2) {
    slow = 0;
    updateSlow();
    renderPanels();
  }
  if (ui.techOpen && techTimer >= 0.5) {
    techTimer = 0;
    renderTech();
  }
  requestAnimationFrame(frame);
}

function onKey(e: KeyboardEvent) {
  const g = ui.g;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(g);
    else undo(g);
    return renderPanels();
  }
  if (mod && k === 'y') {
    e.preventDefault();
    redo(g);
    return renderPanels();
  }
  if (mod && k === 'd') {
    e.preventDefault();
    const n = ui.sel?.kind === 'node' ? nodeById(g, ui.sel.id) : null;
    if (n) startPlacing(n.type, n.recipe);
    return;
  }
  if (mod || e.altKey) return;
  if (k === 'escape') {
    if (radialOpen()) cancelGesture();
    else if (ui.techOpen) closeTech();
    else if (ui.menuOpen) { ui.menuOpen = false; touch(); }
    else if (ui.placing) { ui.placing = null; touch(); }
    else if (ui.sel) select(null);
    return renderPanels();
  }
  if (ui.techOpen) {
    if (k === 'r') closeTech();
    return;
  }
  if (/^[0-9]$/.test(k)) {
    const i = k === '0' ? 9 : Number(k) - 1;
    if (radialOpen()) pickRadial(i);
    else {
      const type = hotbarTypes(g)[i];
      if (type) startPlacing(type);
    }
    return renderPanels();
  }
  if (k === 'delete' || k === 'backspace') {
    e.preventDefault();
    if (ui.sel?.kind === 'node') {
      const n = nodeById(g, ui.sel.id);
      if (n) {
        const refund = refundOf(g, n);
        deleteNode(g, n.id);
        if (refund > 0) toast(`Refunded <b>${fmt(refund)}¢</b>`, 'good');
      }
    } else if (ui.sel?.kind === 'wire') cutWire(g, ui.sel.id);
    select(null);
    return renderPanels();
  }
  if (k === 'r' && has(g, 'R1')) openTech();
  else if (k === 'p') { g.paused = !g.paused; touch(); }
  else if (k === 'f') fitView();
}

boot();
