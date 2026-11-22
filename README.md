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
| Wire two machines | Drag from an output port onto a card, or click the port and then the card | Tap the port, then tap the card (dragging works too, from the port's dot itself) |
| Build at the end of a new wire | Drag from a port into empty space (or click the port, then empty space) and pick from the menu: click, `1`–`8`, or `Enter` for the highlighted one | Tap the port, tap empty space, pick from the sheet |
| Place from the build bar | Click a slot or press its key (`1`–`9`, `0`), then click the board; `Shift`+click keeps placing | Tap a slot, then tap the board |
| Place a Drill | Click a free deposit, then click it again (or pick Drill in the build bar first) | Tap a free deposit, then tap it again |
| Branch a wire | Drag off the middle of a wire | Wire again from the same port |
| Splice into a wire | Place a machine on the wire, or drop an unwired card on it | The same |
| Cut a wire | `Shift`+drag across wires; or click the wire, then `Del` or **Cut wire** | Tap the wire, then **Cut wire** |
| Select and inspect | Click a card or a wire | Tap it |
| Move a card | Drag it (a Drill stays on its deposit) | Hold it for a moment until it lifts, then drag (a quick swipe on a card moves the board) |
| Delete, with a full refund | Select, then `Del` or `Backspace`, or **Delete** in the inspector | **Delete** in the inspector sheet |
| Duplicate | `Ctrl+D`, or **Duplicate** in the inspector | **Duplicate** in the sheet |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`, or the top-bar buttons | Undo button above the build bar; Redo in the gear menu |
| Pan | Drag empty board (the middle and right buttons pan from anywhere) | Drag empty board with one finger |
| Zoom | Mouse wheel, or the − and + buttons | Pinch |
| Set cards in a row | Drag a card near level with a card it is wired to: it comes level by itself and the wire runs straight | The same |
| Move several cards | `Shift`+click cards to put them in a block (a double click on a card takes its whole line), then drag any one of them; `Esc` or a click elsewhere lets the block go | — |
| Fit / Tidy | `F` / `T`, or the buttons above the minimap | The Fit and Tidy buttons above the build bar |
| Wire style: squared or curved | `W`, or the Wires button beside Tidy | **Wires** in the gear menu |
| Route a wire by hand | Double-click a wire to set a pin there, then drag the pin; double-click a pin to take it off. Or select the wire and use **Add a pin** / **Remove pins** | Tap the wire, **Add a pin** in the sheet, then drag the pin |
| Flows | `L` or the Flows button; a press on a row traces that material on the board | **Flows** in the gear menu |
| Tech tree | `R` or the Tech tree button; `Enter` researches, `Esc` or `R` goes back | Tech button; **Research** in the sheet |
| Pause, sound | `P` or the pause button; the speaker button | Gear menu |
| Back out | `Esc` (a drag, the menu, a card in hand, the selection); right-click drops a card in hand | ✕ on the "Tap where…" line; swipe a sheet down |

The first screen has none of this on it: a Drill, a Market and the goal card. Each control arrives with the goal that first gives it a use (the build bar and Undo at goal 2, zoom at goal 4, upgrades in a card's inspector at goal 6, Flows and the minimap at goal 9; `src/ui/reveal.ts` has the list). Tidy appears once six cards stand on the board, and the wire style and pins with it; the Tech tree once the Lab is unlocked (goal 5's reward). Every board edit is one undo step, and undo stops at the last claimed goal.

## What's in this build

- **A guided session:** a goal card with 22 goals, each with an outcome for a title, a sentence on why, the recipe drawn where there is one, progress, a reward and a Claim button; the gesture behind **How?**; "while you wait" steps with a **Show me** that points at what to do; an adviser that suggests a move during long waits; orders ("deliver N of X") from goal 12; the Flow meter from goal 16; an ending with a summary, then four free-play goals.
- **Things everyone knows:** 16 materials from Sand to the Phone (then Rubber, Cable, Laptop and Robot in free play), each with a picture of the thing itself, and 11 recipes a player can guess: a Circuit is Plastic and Copper, a Screen two Glass and a Silicon, a Phone a Screen and two Circuits.
- **Simulation:** Drills, Refiners, Assemblers, Fabricators, Routers (even, ratio, priority, filter), Mergers, Silos, Markets, Labs and Dumps; buffers with backpressure; four wire tiers; a status for every node (working, blocked, starved, idle).
- **Reading the line:** a card in trouble says what is wrong in plain words ("Needs more Copper", "Tar has no exit", "Backed up"), one that runs a little short says "Short of Ore" in amber, and the Drill or machine it is waiting on says "Can't keep up". The **Flows** panel lists every material with how much is made and where it goes, marks the ones that are short or have no exit, and traces a material on the board.
- **Economy:** credits from sales, orders and goals, with a demand limit per material on sales; three kinds of Data; node, upgrade and expansion prices that rise; board expansion that reveals deposits; 29 techs in five branches, with "research it for me when ready".
- **Editing:** everything in the Controls table, full refunds, 200 steps of undo, cards that come level with what they are wired to, several cards moved as one block, Tidy (lays the board out again), cable management (below) and an overview zoom in which a large factory still fits the screen and can still be wired.
- **Cable management:** wires are drawn squared, or curved if the player prefers (kept in the browser, not in the save). Squared wires run in right angles with rounded corners and find their own way round the cards: a wire takes a plain single turn where nothing is in its way, and otherwise the shortest way with the fewest corners that keeps clear of every card, found afresh as cards are moved. Wires that end up on one line (they turn in before the same card, or pass the same side of one) are set side by side, each on a track of its own, in the order in which the fewest cross. Any wire can be routed by hand with up to four pins, points it is drawn through; a squared wire still finds its way round cards from pin to pin. Pins are dragged, saved with the game, undone like any edit, moved along with a block of cards, and taken off by Tidy. Dots, the rate chip, the cutting line and a tap all follow the wire as drawn. Pins and style change how a wire looks and nothing else: a wire carries the same however it runs.
- **Phone layout:** the board has the screen. The goal card is one row (its count, its title, its progress along its foot) with the order beside it as a count, and opens at a tap; build bar and thumb-reach Claim, Fit and Undo at the bottom; bottom sheets for the inspector, the build menu and the tech tree's detail, two fifths of the screen at most; 44 px touch targets, ports and card labels drawn larger for a finger, wiring by tap, and a card that moves only once it has been held (a swipe across a card moves the board).
- **Look:** clean and minimal. No outlines at rest (a border means selected, in trouble or asked for), one typeface with no monospace and no capitals-and-spacing labels, no key caps on buttons. Colour belongs to the materials: a card wears the colour of what it makes, a wire is a solid line in the colour of what it carries.
- **Feel:** synthesised sound with a mute control, light haptics where the device has them, celebrations for seven big moments, a guiding hand for the first wire and build. Reduced motion is honoured.
- **Saves:** in the browser, every 10 seconds and when the tab is hidden. After the first Phone the line earns at half rate while the game is closed (2 hours at most, 8 with a tech). Saves of the earlier public version load; a machine carried over from one refunds no more than was paid for it there.

## Not built

Box-select, a block of cards for a finger, copy/paste, named groups or frames round a line, blueprints, timed contracts, prestige, achievements, export and import of saves, accounts, and any goal beyond the four of free play. Tidy does not set cards in rows: it straightens only the wires its layout leaves nearly level. Squared wires go round cards, not round each other: they still cross, and the routing does not try to cross less. A wire with no way round (a port walled in by cards, a card dragged on top of another) passes behind a card until there is one. Where there is no room for a track each, wires stand closer than usual or on each other; two wires out of one port share their line until they part, and a pinned wire is not moved aside for another. Curved wires still pass behind cards. Tidy lays the board out for curved wires and takes every pin off. Clearing the browser's storage loses the game. The board cannot be worked from the keyboard alone: every button can be reached with `Tab`, but wiring, moving and selecting need a pointer.

## What has been tested, and what has not

- **Tested:** `npm test` (614 tests: the rules, saves, undo, the adviser, the cards' words, the ledger behind Flows, how wires are routed, pins, and the pacing targets below). The interface was played and reviewed only in headless Chromium, by scripted players and scripted reviewers: with a mouse at 1440×900 and 1024×768, and with emulated touch at 390×844, 360×740, 844×390 and 768×1024. The real-world names, the why-and-how card, the plain-word labels, Flows, cards coming level and the block of cards were seen there too: the first five goals played through the page with a mouse and with a finger, the card and the Flows panel looked at on all six sizes, and a block picked, dragged, undone and refused with a mouse at 1440×900. A scripted reviewer then played the build as a newcomer, and what it found was put right where that could be done at once: the how that follows the board, a level card that stays level, "Short of Ore", the small first inspector, grey idle wires, the block of cards. Left as it found them: Tidy does not set cards in rows, one Market takes a wire from every line, and from goal 11 the "while you wait" steps arrive faster than the first goals did. Cable management was seen there as well: both wire styles on a 21-card and a 28-card board at 1440×900; a pin set, dragged, backed out of with `Esc`, undone, redone, taken off, filled to four from the inspector, kept over a reload, carried by a block of cards and taken off by Tidy, with a mouse; and at 390×844 with a finger, the menu's Wires entry, a pin added from the sheet, dragged and removed. The automatic routing was measured on four boards played by the card (8, 21, 24 and 28 cards, up to 34 wires): squared, no wire passes behind a card or within 4 px of one, where curved 7, 12 and 17 wires of the three larger boards pass behind a card that is not their own; a card dragged across the 24-card board kept 60 frames a second in headless Chromium, the wires finding a new way at every step, and routing a whole board took about half a millisecond at rest and one and a half with a card moving. No scripted reviewer has looked at cable management, and nobody has judged by eye how squared wires read on a crowded board beyond those. The clean look and the phone's one-row goal card were seen in headless Chromium at 390×844, 360×640, 844×390 and 1440×900 (the start screen, the first goal, the build sheet, a mid and a late board, a card's sheet, the menu, Flows, the tech tree), and the first five goals were played again with a finger and with a mouse. Measured on a 21-card board at 390×844, 81% of the screen is board in play (it was 59%) and 41% with a card's sheet open (it was 21%). A scripted reviewer then played that look on the three phone sizes with real taps and drags. It passed the chrome (every bar and sheet control 44 px or more, 132 of 133 off-centre taps on ports landing) and found the board itself wanting: card labels of 11 px at the phone's opening zoom, a swipe that began on a card carrying the card off or wiring from a nearby port, cards that were "identical dark slabs", curved wires as the default. Put right after it: card labels of 12 to 13 px on the glass at that zoom and ports of 21 px, a card that lifts only after a hold and a wire that starts only from the port's dot, a wash of its colour on every card, squared wires from the start, the folded row keeping its title beside a filled order, floating buttons that wait while a sheet is up, a sheet at full height on a phone held sideways. Those were checked with scripted touches (a quick swipe on a card pans, a held card moves, a swipe beside a port pans, a drag from the port wires). Left as it found them: at the phone's opening zoom a card is still about 128×54 px, because two cards side by side are wider than a phone; a phone held sideways gives three bars 160 of its 390 px; Fit on a wide factory is a knot of icons a quarter of the screen high; the top bar still carries five numbers late in the game.
- **Not tested with people:** whether a newcomer finds the first wire from the why alone, and whether 20 seconds is the right wait before the how comes by itself, are guesses. No first-time player has been watched.
- **Not tested:** nothing has run on a real phone or tablet, or in Safari or Firefox: the phone layout has only ever been seen in an emulated one. Nobody has heard the sound or felt the haptics: the sound is checked only by what the code schedules and by a rendered peak level. No first-time player has been watched.
- **Speed** was measured only in headless Chromium on a 4-core virtual machine with software drawing: on a 47-node board, 60 fps at rest and 58 to 60 while panning, at 1440×900 and 390×844. Over 15 minutes at rest the page's element count stays flat and the heap settles after the first few minutes. The shipped JavaScript and CSS are about 272 kB gzipped. Real devices will differ.
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
                  Worker), wires.ts (how a wire runs: curved or squared, round cards, side by side, pins), audio.ts,
                  celebrate.ts, hand.ts
src/styles/       hud, advice, feel, phone and tech styles (base styles in src/style.css)
tests/            rules, saves, undo, adviser and pacing tests (interface unit tests sit beside src/ui/)
tools/pacing.ts   the pacing tool: scripted players on the real rules (what-if numbers in pacing-profiles.ts)
tools/bench.ts    what ticks, copies of the game, forecasts, the adviser and wire routing cost, on boards those players built
tools/perf.mjs    frame times of the built page in headless Chromium on a processor slowed four times
tools/baseline/   the numbers both gave before the work on speed, to compare against
```

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server; type-check and build to `dist/`; serve the build |
| `npm test` | All tests (Vitest), about two minutes |
| `npm run pacing` | Six scripted players on order seeds 0–3, checked against the pacing targets; `-- --summary` for the tables only, more flags at the top of `tools/pacing.ts` |
| `npm run baseline` | Prints the tests' own card player's time on each goal |
| `npm run bench` | Times the game's own work without a browser; `-- --digest` prints fingerprints that a change made only for speed must leave as they were; more at the top of `tools/bench.ts` |
| `node tools/perf.mjs` | Times frames of a built page while a script pans, zooms, drags a card and tidies; needs Playwright and a build (the steps are at the top of the file) |
| `npm run check:tools` | Type-checks the pacing tool and the bench |
