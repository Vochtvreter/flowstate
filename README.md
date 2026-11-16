# Flowstate

An incremental node-graph game for the browser. You wire up a *theoretical supply line*: Wells on deposits feed Refiners, Assemblers and a Fabricator, Markets sell what arrives for credits, and Labs turn it into Data. Credits buy machines and upgrades; Data buys a tech tree. A goal card leads a new player through 22 goals to the first Lens, which ends the demo; free play goes on after it.

This is the pitch build: one guided session, for a mouse and keyboard or for a finger on a phone. Scripted players who follow the goal card take about 20 minutes over it; no person has been timed.

## Play

**Live:** <https://vochtvreter.github.io/flowstate/>. The site shows what is on the `main` branch: every push there runs the tests and deploys the build (`.github/workflows/deploy.yml`; GitHub Pages has to be set once to Source: **GitHub Actions**).

**Locally:**

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` writes a static site to `dist/` (relative paths, so it can be hosted anywhere). `?play` in the address skips the start screen. The game has no server: it saves to the browser's local storage every 10 seconds, and the only thing it loads from elsewhere is its web fonts.

## Controls

The game tells a finger to "tap" and shows keys only to a keyboard. `Cmd` works where `Ctrl` is written.

| Action | Mouse and keyboard | Touch |
|---|---|---|
| Wire two machines | Drag from an output port onto a card, or click the port and then the card | Tap the port, then tap the card (dragging from the port also works) |
| Build at the end of a new wire | Drag from a port into empty space (or click the port, then empty space) and pick from the menu: click, `1`–`8`, or `Enter` for the highlighted one | Tap the port, tap empty space, pick from the sheet |
| Place from the build bar | Click a slot or press its key (`1`–`9`, `0`), then click the board; `Shift`+click keeps placing | Tap a slot, then tap the board |
| Place a Well | Click a free deposit, then click it again (or pick Well in the build bar first) | Tap a free deposit, then tap it again |
| Branch a wire | Drag off the middle of a wire | Wire again from the same port |
| Splice into a wire | Place a machine on the wire, or drop an unwired card on it | The same |
| Cut a wire | `Shift`+drag across wires; or click the wire, then `Del` or **Cut wire** | Tap the wire, then **Cut wire** |
| Select and inspect | Click a card or a wire | Tap it |
| Move a card | Drag it (a Well stays on its deposit) | Drag it |
| Delete, with a full refund | Select, then `Del` or `Backspace`, or **Delete** in the inspector | **Delete** in the inspector sheet |
| Duplicate | `Ctrl+D`, or **Duplicate** in the inspector | **Duplicate** in the sheet |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`, or the top-bar buttons | Undo button above the build bar; Redo in the gear menu |
| Pan | Drag empty board (the middle and right buttons pan from anywhere) | Drag empty board with one finger |
| Zoom | Mouse wheel, or the − and + buttons | Pinch |
| Fit / Tidy | `F` / `T`, or the buttons above the minimap | The Fit and Tidy buttons above the build bar |
| Tech tree | `R` or the Tech tree button; `Enter` researches, `Esc` or `R` goes back | Tech button; **Research** in the sheet |
| Pause, sound | `P` or the pause button; the speaker button | Gear menu |
| Back out | `Esc` (a drag, the menu, a card in hand, the selection); right-click drops a card in hand | ✕ on the "Tap where…" line; swipe a sheet down |

Tidy appears once six cards stand on the board; the Tech tree once the Lab is unlocked (goal 5's reward). Every board edit is one undo step, and undo stops at the last claimed goal.

## What's in this build

- **A guided session:** a goal card with 22 goals, each with a hint, progress, a reward and a Claim button; "while you wait" steps with a **Show me** that points at what to do; an adviser that suggests a move during long waits; orders ("deliver N of X") from goal 12; the Flow meter from goal 16; an ending with a summary, then four free-play goals.
- **Simulation:** Wells, Refiners, Assemblers, Fabricators, Routers (even, ratio, priority, filter), Mergers, Silos, Markets, Labs and Voids; 16 materials and 11 recipes; buffers with backpressure; four wire tiers; a status for every node (working, blocked, starved, idle).
- **Economy:** credits from sales, orders and goals, with a demand limit per material on sales; three kinds of Data; node, upgrade and expansion prices that rise; board expansion that reveals deposits; 29 techs in five branches, with "research it for me when ready".
- **Editing:** everything in the Controls table, full refunds, 200 steps of undo, Tidy (lays the board out again) and an overview zoom in which a large factory still fits the screen and can still be wired.
- **Phone layout:** build bar and thumb-reach Claim, Fit and Undo at the bottom, bottom sheets for the inspector, the build menu and the tech tree's detail, 44 px touch targets, wiring by tap.
- **Feel:** synthesised sound with a mute control, light haptics where the device has them, celebrations for seven big moments, a guiding hand for the first wire and build. Reduced motion is honoured.
- **Saves:** in the browser, every 10 seconds and when the tab is hidden. After the first Lens the line earns at half rate while the game is closed (2 hours at most, 8 with a tech). Saves of the earlier public version load; a machine carried over from one refunds no more than was paid for it there.

## Not built

Multi-select and copy/paste, blueprints, timed contracts, prestige, achievements, export and import of saves, accounts, and any goal beyond the four of free play. Clearing the browser's storage loses the game. The board cannot be worked from the keyboard alone: every button can be reached with `Tab`, but wiring, moving and selecting need a pointer.

## What has been tested, and what has not

- **Tested:** `npm test` (502 tests: the rules, saves, undo, the adviser, and the pacing targets below). The interface was played and reviewed only in headless Chromium, by scripted players and scripted reviewers: with a mouse at 1440×900 and 1024×768, and with emulated touch at 390×844, 360×740, 844×390 and 768×1024.
- **Not tested:** nothing has run on a real phone or tablet, or in Safari or Firefox. Nobody has heard the sound or felt the haptics: the sound is checked only by what the code schedules and by a rendered peak level. No first-time player has been watched.
- **Speed** was measured only in headless Chromium on a 4-core virtual machine with software drawing: on a 47-node board, 60 fps at rest and 58 to 60 while panning, at 1440×900 and 390×844. Over 15 minutes at rest the page's element count stays flat and the heap settles after the first few minutes. The shipped JavaScript and CSS are about 224 kB gzipped. Real devices will differ.
- **Pacing** is measured by scripted players (`npm run pacing`), not people. Players who do what the card says and press Claim 8 to 16 seconds after it lights reach the first Lens at about 17½ to 20½ minutes, with nothing to do for about a quarter of that time (the limit is 30%) and never for a minute at a stretch; the tool's targets are set for them and are all met. A player who claims at once reaches the Lens at about 16½ minutes and has nothing to do for about a third of it. On goal 15 the card offers nothing for 80 to 105 seconds in all, in stretches of up to about 40; this was accepted for the pitch build. On goal 21, where it was as much, the card has a tune-up to do while saving for the Fabricator, and 42 to 52 seconds are left.

## Docs

- [Content & numbers](docs/CONTENT.md): materials, recipes, prices, the goal chain, the adviser, and where the pacing lands. Kept current with `src/content.ts` and `src/goals.ts`.
- [UI spec](docs/UI.md): the interface as built. The [Flowstate UI canvas](https://claude.ai/artifact/HS1Kbgr7TKuNz9xPjpJ7Pg) holds early mockups from before the build, which the build has since moved past.
- [Game design document](docs/DESIGN.md): the design of this build, system by system, and what of the design is not built.
- [Pitch build plan](docs/PITCH_PLAN.md): the plan this build was made to, how it came out against its criteria, and the defects that were found and left.

## Code layout

```
src/content.ts    materials, recipes, nodes, techs, RULES (data only)
src/state.ts      game state, save and load
src/sim.ts        the deterministic tick: production, transfers, status; time away
src/economy.ts    costs, prices, demand, tech rules, formatting
src/actions.ts    every board edit, all undoable
src/goals.ts      the goal chain and its "while you wait" lines
src/orders.ts     orders        src/flow.ts   the Flow meter
src/advice.ts     the adviser (run in a Worker by src/advice.worker.ts)
src/main.ts       start-up, the frame loop, keyboard shortcuts
src/ui/           board.ts (DOM cards, SVG wires, every gesture), fx.ts (canvas: wire dots, particles),
                  panels.ts (top bar, build bar, inspector, minimap), hud*.ts (goal card, order, alert,
                  toasts, start and end screens), tech.ts, phone.ts, layout.ts (Tidy, in a Worker),
                  audio.ts, celebrate.ts, hand.ts
src/styles/       hud, advice, feel, phone and tech styles (base styles in src/style.css)
tests/            rules, saves, undo, adviser and pacing tests (interface unit tests sit beside src/ui/)
tools/pacing.ts   the pacing tool: scripted players on the real rules (what-if numbers in pacing-profiles.ts)
```

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server; type-check and build to `dist/`; serve the build |
| `npm test` | All tests (Vitest), about two minutes |
| `npm run pacing` | Six scripted players on order seeds 0–3, checked against the pacing targets; `-- --summary` for the tables only, more flags at the top of `tools/pacing.ts` |
| `npm run baseline` | Prints the tests' own card player's time on each goal |
| `npm run check:tools` | Type-checks the pacing tool |
