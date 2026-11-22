/**
 * Perf: how smoothly the built page runs a big board, in a real browser, on a processor slowed four times.
 *
 *   npx vite build --minify false --outDir <dir> && npx vite preview --outDir <dir> --port 4173
 *   npm run bench -- --digest --save=<board.json>
 *   node tools/perf.mjs --url=http://localhost:4173/ --save=<board.json> [--json=<out.json>]
 *
 *   other flags: --only=drag,tidy     only these scenarios (rest, pan, zoom, first, drag, hub, tidy, place, toasts)
 *                --rates=1,4          the processor slow-downs to measure at (4 is the page's budget)
 *                --sizes=desktop      only this window (desktop: 1440x900 with a mouse; phone: 390x844 with fingers)
 *                --noProfile          skip the pass that says where the time goes
 *
 * It needs Playwright with its Chromium, and takes it from wherever Node finds it (a global install with
 * NODE_PATH set will do): it is not one of the project's dependencies.
 *
 * Every scenario starts from the same save, loaded afresh, and plays one input a frame, as a hand does:
 *   rest    nothing is touched
 *   pan     the board is dragged across and back (middle button; one finger)
 *   zoom    the wheel out and in again (a pinch)
 *   first   the first drag after the page has loaded: a card with a handful of wires is carried round a square,
 *           let go, and glides to rest. The browser has not yet made fast code of the routing, and it shows
 *   drag    the same drag once the card has been round twice already: what carrying a card costs for the rest of a sitting
 *   hub     that, with the card that has the most wires (late in a game, a Market that half the board sells to)
 *   tidy    Tidy: every card it moves glides to its new place at once
 *   place   a card picked from the build bar is carried over the board (mouse only)
 *   toasts  three toasts are up while nothing else happens
 *
 * Two passes. The first times frames: the gap from one animation frame to the next, the long tasks, and the
 * browser's own count of time in script, style and layout. The second runs the same scenario under the
 * profiler and adds up, for each of the page's functions, the time spent in it and in what it called: that is
 * why the build must not be minified (the names have to be there to read). The profiler slows the page a
 * little, so its frames are not the ones reported.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (name, dflt = null) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const flag = (name) => args.includes(`--${name}`);

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright was not found. Install it where Node can see it (npm i -g playwright, with NODE_PATH set).');
  process.exit(1);
}

const url = opt('url');
const savePath = opt('save');
if (!url || !savePath) {
  console.error('usage: node tools/perf.mjs --url=<the built page> --save=<a board from npm run bench -- --save=...>');
  process.exit(1);
}
const save = JSON.parse(readFileSync(savePath, 'utf8'));
const only = opt('only')?.split(',') ?? null;
const rates = (opt('rates', '1,4')).split(',').map(Number);
const sizes = (opt('sizes', 'desktop,phone')).split(',');

const SIZES = {
  desktop: { viewport: { width: 1440, height: 900 }, touch: false },
  phone: { viewport: { width: 390, height: 844 }, touch: true },
};

// ---------- the page, loaded with the board ----------

async function open(browser, size) {
  const context = await browser.newContext({ viewport: size.viewport, deviceScaleFactor: 1, hasTouch: size.touch, isMobile: size.touch });
  // The save as a game saved a moment ago (no time away), its summary already seen; and a note of every frame.
  await context.addInitScript((game) => {
    localStorage.setItem('flowstate-save-v1', JSON.stringify({ ...game, savedAt: Date.now() }));
    localStorage.setItem('flowstate-hud-v1', JSON.stringify({ summaryDone: true }));
    const perf = { on: false, frames: [], long: [] };
    window.__perf = perf;
    const loop = (t) => {
      if (perf.on) perf.frames.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
      new PerformanceObserver((l) => {
        if (perf.on) for (const e of l.getEntries()) perf.long.push(e.duration);
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* no long-task timing here */ }
  }, save);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}play&nosummary`);
  await page.waitForFunction(() => window.flowstate?.ui?.g?.nodes?.length > 0);
  const cdp = await context.newCDPSession(page);
  await page.waitForTimeout(1200);
  return { context, page, cdp, errors, touch: size.touch };
}

const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
async function frames(page, n) {
  for (let i = 0; i < n; i++) await frame(page);
}

/** The middle of the stage, and where the card with the most wires (not a Drill) is on screen once the camera has gone to it. */
async function stage(page) {
  return page.evaluate(() => {
    const r = document.getElementById('board').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  });
}

/** A card to carry: the one with the most wires (`hub`), or one with as many as cards usually have. Not a Drill: those stay on their deposits. */
async function cardToCarry(page, hub) {
  const id = await page.evaluate((most) => {
    const g = window.flowstate.ui.g;
    const deg = new Map();
    for (const w of g.wires) {
      deg.set(w.from, (deg.get(w.from) ?? 0) + 1);
      deg.set(w.to, (deg.get(w.to) ?? 0) + 1);
    }
    const list = g.nodes.filter((x) => x.type !== 'well' && (deg.get(x.id) ?? 0) >= 2).sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || a.id - b.id);
    const n = list[most ? 0 : Math.floor(list.length / 2)];
    window.flowstate.view.frame([n.id]);
    return n.id;
  }, hub);
  await page.waitForTimeout(900);
  const at = await page.evaluate((nid) => {
    const r = document.querySelector(`.node[data-id="${nid}"]`).getBoundingClientRect();
    // (On its name, clear of the ports at its sides.)
    return { x: r.left + r.width / 2, y: r.top + Math.min(18, r.height / 3) };
  }, id);
  const wires = await page.evaluate((nid) => window.flowstate.ui.g.wires.filter((w) => w.from === nid || w.to === nid).length, id);
  return { id, at, wires };
}

// ---------- hands ----------

function hands(s) {
  const { page, cdp } = s;
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i })) });
  return {
    /** Press at `from`, then one move a frame along `path` (steps relative to the last point), then let go. */
    async drag(from, path, { button = 'left', hold = 0 } = {}) {
      let x = from.x, y = from.y;
      if (s.touch) {
        await touch('touchStart', [{ x, y }]);
        if (hold) await page.waitForTimeout(hold);
        for (const [dx, dy] of path) {
          x += dx;
          y += dy;
          await touch('touchMove', [{ x, y }]);
          await frame(page);
        }
        await touch('touchEnd', []);
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down({ button });
        for (const [dx, dy] of path) {
          x += dx;
          y += dy;
          await page.mouse.move(x, y);
          await frame(page);
        }
        await page.mouse.up({ button });
      }
    },
    /** Two fingers on either side of `mid`, moved apart or together one step a frame. */
    async pinch(mid, gaps) {
      const pts = (gap) => [{ x: mid.x - gap / 2, y: mid.y - gap / 4 }, { x: mid.x + gap / 2, y: mid.y + gap / 4 }];
      await touch('touchStart', pts(gaps[0]));
      for (const gap of gaps) {
        await touch('touchMove', pts(gap));
        await frame(page);
      }
      await touch('touchEnd', []);
    },
  };
}

const line = (n, dx, dy) => Array.from({ length: n }, () => [dx, dy]);
const square = (n, d) => [...line(n, d, 0), ...line(n, 0, d), ...line(n, -d, 0), ...line(n, 0, -d)];

/** A card carried round a square, let go a little off the grid, and left to glide to rest; `laps` times round first, unmeasured. */
const carry = (hub, laps) => {
  const round = async (s, card) => {
    // (A finger has to rest on a card before it lifts: board.ts, HOLD_MS.)
    await hands(s).drag(card.at, [...square(18, s.touch ? 8 : 12), [5, 3]], { hold: 320 });
    await frames(s.page, 30);
  };
  return {
    before: async (s) => {
      const card = await cardToCarry(s.page, hub);
      for (let i = 0; i < laps; i++) {
        await round(s, card);
        // (Back where it was picked up, for the next lap to start from the same place.)
        await hands(s).drag({ x: card.at.x + 5, y: card.at.y + 3 }, [[-5, -3]], { hold: 320 });
        await frames(s.page, 30);
      }
      return { card };
    },
    run: async (s, { card }) => round(s, card),
    after: async (s, { card }) => ({ wires: card.wires, carried: await s.page.evaluate(() => document.querySelectorAll('.node.dragging').length === 0) }),
  };
};

// ---------- scenarios ----------
// `before` gets the page ready (not measured); `run` is what is measured.

const SCENARIOS = {
  rest: { run: async (s) => frames(s.page, 150) },
  pan: {
    run: async (s) => {
      const mid = await stage(s.page);
      const d = Math.min(8, mid.w / 60);
      const from = { x: mid.x + 20 * d, y: mid.y - 60 };
      await hands(s).drag(from, [...line(40, -d, 2), ...line(40, d, -2), ...line(40, -d, 2)], { button: 'middle' });
      await frames(s.page, 20);
    },
  },
  zoom: {
    run: async (s) => {
      const mid = await stage(s.page);
      if (s.touch) {
        const gaps = [];
        for (let i = 0; i < 40; i++) gaps.push(240 - i * 4);
        for (let i = 0; i < 40; i++) gaps.push(80 + i * 4);
        await hands(s).pinch(mid, gaps);
      } else {
        await s.page.mouse.move(mid.x, mid.y);
        for (const dy of [...Array(35).fill(40), ...Array(35).fill(-40)]) {
          await s.page.mouse.wheel(0, dy);
          await frame(s.page);
        }
      }
      await frames(s.page, 20);
    },
  },
  first: carry(false, 0),
  drag: carry(false, 2),
  hub: carry(true, 2),
  tidy: {
    before: async (s) => {
      await s.page.evaluate(() => window.flowstate.view.fit());
      await s.page.waitForTimeout(900);
      return { was: await s.page.evaluate(() => window.flowstate.ui.g.nodes.map((n) => `${n.id}:${n.x},${n.y}`).join(' ')) };
    },
    run: async (s) => {
      await s.page.evaluate(() => window.flowstate.view.tidy());
      await frames(s.page, 200);
    },
    after: async (s, { was }) => ({ moved: (await s.page.evaluate(() => window.flowstate.ui.g.nodes.map((n) => `${n.id}:${n.x},${n.y}`).join(' '))) !== was }),
  },
  place: {
    mouseOnly: true,
    before: async (s) => {
      // (A Market: it may stand anywhere, where a Drill wants a deposit.)
      await s.page.locator('#hot button.hb[data-act="place:market"]').click();
      return { placing: await s.page.evaluate(() => !!window.flowstate.ui.placing) };
    },
    run: async (s) => {
      const mid = await stage(s.page);
      let x = mid.x - 300, y = mid.y - 150;
      await s.page.mouse.move(x, y);
      for (const [dx, dy] of [...line(40, 12, 4), ...line(40, -12, 4)]) {
        x += dx;
        y += dy;
        await s.page.mouse.move(x, y);
        await frame(s.page);
      }
    },
    after: async (s, ctx) => {
      await s.page.keyboard.press('Escape');
      return { placing: ctx.placing };
    },
  },
  toasts: {
    before: async (s) => {
      await s.page.evaluate(() => {
        for (const text of ['One thing to say', 'A second thing, said at more length than the first', 'And a third']) window.flowstate.ui.g.events.push({ kind: 'toast', text });
      });
      await frames(s.page, 4);
      return { shown: await s.page.evaluate(() => document.querySelectorAll('.toast').length) };
    },
    run: async (s) => frames(s.page, 150),
    after: async (_s, ctx) => ({ shown: ctx.shown }),
  },
};

// ---------- measuring ----------

const sorted = (v) => [...v].sort((a, b) => a - b);
const q = (v, p) => {
  const s = sorted(v);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const r1 = (v) => Math.round(v * 10) / 10;

async function metrics(cdp) {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const get = (name) => m.find((x) => x.name === name)?.value ?? 0;
  return { script: get('ScriptDuration'), layout: get('LayoutDuration'), style: get('RecalcStyleDuration'), task: get('TaskDuration') };
}

/** One scenario from a fresh page: frame times, or (with `profile`) where the time went. */
async function measure(browser, size, name, rate, profile) {
  const sc = SCENARIOS[name];
  const s = await open(browser, size);
  try {
    const ctx = (await sc.before?.(s)) ?? {};
    await s.cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await s.page.waitForTimeout(300);
    await s.cdp.send('Performance.enable');
    if (profile) {
      await s.cdp.send('Profiler.enable');
      await s.cdp.send('Profiler.setSamplingInterval', { interval: 250 });
      await s.cdp.send('Profiler.start');
    }
    const m0 = await metrics(s.cdp);
    await s.page.evaluate(() => {
      window.__perf.frames = [];
      window.__perf.long = [];
      window.__perf.on = true;
    });
    await sc.run(s, ctx);
    const got = await s.page.evaluate(() => {
      window.__perf.on = false;
      return { frames: window.__perf.frames, long: window.__perf.long };
    });
    const m1 = await metrics(s.cdp);
    const prof = profile ? (await s.cdp.send('Profiler.stop')).profile : null;
    await s.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const check = (await sc.after?.(s, ctx)) ?? {};
    const gaps = [];
    for (let i = 1; i < got.frames.length; i++) gaps.push(got.frames[i] - got.frames[i - 1]);
    const n = Math.max(1, gaps.length);
    const out = {
      frames: gaps.length, median: r1(q(gaps, 0.5)), p95: r1(q(gaps, 0.95)), worst: r1(Math.max(0, ...gaps)),
      over33: gaps.filter((x) => x > 33.4).length, over50: gaps.filter((x) => x > 50).length,
      fps: r1(1000 / (gaps.reduce((a, b) => a + b, 0) / n)),
      longTasks: got.long.length, longest: r1(Math.max(0, ...got.long)),
      // The browser's own account, in ms a frame (already slowed by `rate`).
      script: r1(((m1.script - m0.script) * 1000) / n), style: r1(((m1.style - m0.style) * 1000) / n), layout: r1(((m1.layout - m0.layout) * 1000) / n),
      check, errors: s.errors,
    };
    if (prof) out.where = where(prof, n);
    return out;
  } finally {
    await s.context.close();
  }
}

/** From a profile: for each of the page's functions, ms a frame spent in it and in what it called; the heaviest first. */
function where(profile, frameCount) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const total = new Map();
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000;
    const seen = new Set();
    let first = true;
    for (let at = id; at != null; at = parent.get(at)) {
      const f = byId.get(at).callFrame;
      const name = f.functionName || '(anonymous)';
      if (first) self.set(name, (self.get(name) ?? 0) + dt);
      first = false;
      if (!f.url || !/^https?:/.test(f.url) || seen.has(name)) continue;
      seen.add(name);
      total.set(name, (total.get(name) ?? 0) + dt);
    }
  });
  const skip = new Set(['(anonymous)', 'frame', 'step', 'loop']);
  return [...total].filter(([name]) => !skip.has(name)).sort((a, b) => b[1] - a[1]).slice(0, 14)
    .map(([name, ms]) => ({ name, total: r1(ms / frameCount), self: r1((self.get(name) ?? 0) / frameCount) }));
}

// ---------- the report ----------

const pad = (s, n) => String(s).padStart(n);

const browser = await chromium.launch();
const report = { url, board: { cards: save.nodes.length, wires: save.wires.length }, runs: [] };
const t0 = Date.now();
try {
  for (const sizeName of sizes) {
    const size = SIZES[sizeName];
    console.log(`\n${sizeName.toUpperCase()} ${size.viewport.width}x${size.viewport.height}, ${save.nodes.length} cards and ${save.wires.length} wires`);
    console.log('scenario  slowed  frames  median    p95  worst  >33ms  >50ms    fps  long tasks   script  style  layout (ms a frame)');
    for (const name of Object.keys(SCENARIOS)) {
      if (only && !only.includes(name)) continue;
      if (SCENARIOS[name].mouseOnly && size.touch) continue;
      for (const rate of rates) {
        const m = await measure(browser, size, name, rate, false);
        report.runs.push({ size: sizeName, scenario: name, rate, ...m });
        console.log(`${name.padEnd(9)} ${pad(`${rate}x`, 6)} ${pad(m.frames, 7)} ${pad(m.median, 7)} ${pad(m.p95, 6)} ${pad(m.worst, 6)} ${pad(m.over33, 6)} ${pad(m.over50, 6)} ${pad(m.fps, 6)} ${pad(`${m.longTasks} (${m.longest})`, 11)} ${pad(m.script, 8)} ${pad(m.style, 6)} ${pad(m.layout, 7)}`
          + `   ${JSON.stringify(m.check)}${m.errors.length ? `   ERRORS ${m.errors.join('; ')}` : ''}`);
      }
      if (!flag('noProfile')) {
        const rate = Math.max(...rates);
        const m = await measure(browser, size, name, rate, true);
        report.runs.push({ size: sizeName, scenario: name, rate, profiled: true, where: m.where });
        console.log(`          where, ${rate}x: ${m.where.slice(0, 9).map((w) => `${w.name} ${w.total}`).join(', ')}`);
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${Math.round((Date.now() - t0) / 1000)} s`);
const json = opt('json');
if (json) {
  writeFileSync(json, JSON.stringify(report, null, 2) + '\n');
  console.log(`Written to ${json}.`);
}
