# Flowstate

An incremental node-graph game for the browser. You wire up a supply line that turns sand into a phone: Drills on deposits bring up Sand, Oil, Ore and Quartz; Refiners make Glass, Plastic, Copper and Silicon of them; Assemblers put those together into Screens and Circuits, and a Fabricator into a Phone. Markets sell what arrives for credits, and Labs turn it into Data. Credits buy machines and upgrades; Data buys a tech tree. A goal card leads a new player through 22 goals to the first Phone, which ends the demo; free play goes on after it.

The card says what to bring about and why ("Turn Sand into Glass. Two Sand sell for 2¢. Melted into one Glass they sell for 3¢."), not where to click: the gesture is behind its **How?** button, and comes by itself when the player has not got anywhere for 20 seconds.

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
| Place a Drill | Click a free deposit, then click it again (or pick Drill in the build bar first) | Tap a free deposit, then tap it again |
| Branch a wire | Drag off the middle of a wire | Wire again from the same port |
| Splice into a wire | Place a machine on the wire, or drop an unwired card on it | The same |
| Cut a wire | `Shift`+drag across wires; or click the wire, then `Del` or **Cut wire** | Tap the wire, then **Cut wire** |
| Select and inspect | Click a card or a wire | Tap it |
| Move a card | Drag it (a Drill stays on its deposit) | Drag it |
| Delete, with a full refund | Select, then `Del` or `Backspace`, or **Delete** in the inspector | **Delete** in the inspector sheet |
| Duplicate | `Ctrl+D`, or **Duplicate** in the inspector | **Duplicate** in the sheet |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`, or the top-bar buttons | Undo button above the build bar; Redo in the gear menu |
| Pan | Drag empty board (the middle and right buttons pan from anywhere) | Drag empty board with one finger |
| Zoom | Mouse wheel, or the − and + buttons | Pinch |
| Set cards in a row | Drag a card near level with a card it is wired to: it comes level by itself and the wire runs straight | The same |
| Fit / Tidy | `F` / `T`, or the buttons above the minimap | The Fit and Tidy buttons above the build bar |
| Flows | `L` or the Flows button; a press on a row traces that material on the board | **Flows** in the gear menu |
| Tech tree | `R` or the Tech tree button; `Enter` researches, `Esc` or `R` goes back | Tech button; **Research** in the sheet |
| Pause, sound | `P` or the pause button; the speaker button | Gear menu |
| Back out | `Esc` (a drag, the menu, a card in hand, the selection); right-click drops a card in hand | ✕ on the "Tap where…" line; swipe a sheet down |

The first screen has none of this on it: a Drill, a Market and the goal card. Each control arrives with the goal that first gives it a use (the build bar and Undo at goal 2, zoom at goal 4, Flows and the minimap at goal 9; `src/ui/reveal.ts` has the list). Tidy appears once six cards stand on the board; the Tech tree once the Lab is unlocked (goal 5's reward). Every board edit is one undo step, and undo stops at the last claimed goal.

## What's in this build

- **A guided session:** a goal card with 22 goals, each with an outcome for a title, a sentence on why, the recipe drawn where there is one, progress, a reward and a Claim button; the gesture behind **How?**; "while you wait" steps with a **Show me** that points at what to do; an adviser that suggests a move during long waits; orders ("deliver N of X") from goal 12; the Flow meter from goal 16; an ending with a summary, then four free-play goals.
- **Things everyone knows:** 16 materials from Sand to the Phone (then Rubber, Cable, Laptop and Robot in free play), each with a picture of the thing itself, and 11 recipes a player can guess: a Circuit is Plastic and Copper, a Screen two Glass and a Silicon, a Phone a Screen and two Circuits.
- **Simulation:** Drills, Refiners, Assemblers, Fabricators, Routers (even, ratio, priority, filter), Mergers, Silos, Markets, Labs and Dumps; buffers with backpressure; four wire tiers; a status for every node (working, blocked, starved, idle).
- **Reading the line:** a card in trouble says what is wrong in plain words ("Needs more Copper", "Tar has no exit", "Backed up"), and the Drill or machine it is waiting on says "Can't keep up". The **Flows** panel lists every material with how much is made and where it goes, marks the ones that are short or have no exit, and traces a material on the board.
- **Economy:** credits from sales, orders and goals, with a demand limit per material on sales; three kinds of Data; node, upgrade and expansion prices that rise; board expansion that reveals deposits; 29 techs in five branches, with "research it for me when ready".
- **Editing:** everything in the Controls table, full refunds, 200 steps of undo, cards that come level with what they are wired to, Tidy (lays the board out again) and an overview zoom in which a large factory still fits the screen and can still be wired.
- **Phone layout:** build bar and thumb-reach Claim, Fit and Undo at the bottom, bottom sheets for the inspector, the build menu and the tech tree's detail, 44 px touch targets, wiring by tap.
- **Feel:** synthesised sound with a mute control, light haptics where the device has them, celebrations for seven big moments, a guiding hand for the first wire and build. Reduced motion is honoured.
- **Saves:** in the browser, every 10 seconds and when the tab is hidden. After the first Phone the line earns at half rate while the game is closed (2 hours at most, 8 with a tech). Saves of the earlier public version load; a machine carried over from one refunds no more than was paid for it there.

## Not built

Multi-select and copy/paste, named groups or frames round a line, blueprints, timed contracts, prestige, achievements, export and import of saves, accounts, and any goal beyond the four of free play. Tidy does not set cards in rows: it straightens only the wires its layout leaves nearly level. Clearing the browser's storage loses the game. The board cannot be worked from the keyboard alone: every button can be reached with `Tab`, but wiring, moving and selecting need a pointer.

## What has been tested, and what has not

- **Tested:** `npm test` (574 tests: the rules, saves, undo, the adviser, the cards' words, the ledger behind Flows, and the pacing targets below). The interface was played and reviewed only in headless Chromium, by scripted players and scripted reviewers: with a mouse at 1440×900 and 1024×768, and with emulated touch at 390×844, 360×740, 844×390 and 768×1024. The real-world names, the why-and-how card, the plain-word labels, Flows, and cards coming level were seen there too: the first five goals played through the page with a mouse and with a finger, and the card and the Flows panel looked at on all six sizes.
- **Not tested with people:** whether a newcomer finds the first wire from the why alone, and whether 20 seconds is the right wait before the how comes by itself, are guesses. No first-time player has been watched.
- **Not tested:** nothing has run on a real phone or tablet, or in Safari or Firefox. Nobody has heard the sound or felt the haptics: the sound is checked only by what the code schedules and by a rendered peak level. No first-time player has been watched.
- **Speed** was measured only in headless Chromium on a 4-core virtual machine with software drawing: on a 47-node board, 60 fps at rest and 58 to 60 while panning, at 1440×900 and 390×844. Over 15 minutes at rest the page's element count stays flat and the heap settles after the first few minutes. The shipped JavaScript and CSS are about 259 kB gzipped. Real devices will differ.
- **Pacing** is measured by scripted players (`npm run pacing`), not people. Players who do what the card says and press Claim 8 to 16 seconds after it lights reach the first Phone at about 17½ to 20½ minutes, with nothing to do for about a quarter of that time (the limit is 30%) and never for a minute at a stretch; the tool's targets are set for them and are all met. A player who claims at once reaches the Phone at about 16½ minutes and has nothing to do for about a third of it. On goal 15 the card offers nothing for 80 to 105 seconds in all, in stretches of up to about 40; this was accepted for the pitch build. On goal 21, where it was as much, the card has a tune-up to do while saving for the Fabricator, and 42 to 52 seconds are left. Played in the page by a script that claims at once and follows the guiding hand, goal 21 still has 76 to 82 seconds in which the card offers nothing, in stretches of up to 44 (114 before the tune-up).

## Docs

- [Content & numbers](docs/CONTENT.md): materials, recipes, prices, the goal chain, the adviser, and where the pacing lands. Kept current with `src/content.ts` and `src/goals.ts`.
- [UI spec](docs/UI.md): the interface as built. The [Flowstate UI canvas](https://claude.ai/artifact/HS1Kbgr7TKuNz9xPjpJ7Pg) holds early mockups from before the build, which the build has since moved past.
- [Game design document](docs/DESIGN.md): the design of this build, system by system, and what of the design is not built.
- [Pitch build plan](docs/PITCH_PLAN.md): the plan this build was made to, how it came out against its criteria, and the defects that were found and left.

## Code layout

```
src/content.ts    materials, recipes, nodes, techs, RULES (data only; ids are older than the names: the table is at its top)
src/state.ts      game state, save and load
src/sim.ts        the deterministic tick: production, transfers, status; time away
src/economy.ts    costs, prices, demand, tech rules, formatting
src/actions.ts    every board edit, all undoable
src/goals.ts      the goal chain: titles, the why and the how of each card, its "while you wait" lines
src/orders.ts     orders        src/flow.ts   the Flow meter
src/flows.ts      the ledger behind the Flows panel: made, wanted, sold, studied, dumped, for each material
src/advice.ts     the adviser (run in a Worker by src/advice.worker.ts)
src/main.ts       start-up, the frame loop, keyboard shortcuts
src/ui/           board.ts (DOM cards, SVG wires, every gesture), fx.ts (canvas: wire dots, particles),
                  panels.ts (top bar, build bar, inspector, minimap), hud*.ts (goal card, order, alert,
                  toasts, start and end screens), status.ts (what a card says is wrong), flows.ts (the Flows
                  panel), reveal.ts (what is on screen yet), tech.ts, phone.ts, layout.ts (Tidy, in a
                  Worker), audio.ts, celebrate.ts, hand.ts
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
