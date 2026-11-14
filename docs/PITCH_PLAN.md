# Flowstate — pitch build plan

The proof of concept works but does not yet hold a first-time player. This plan turns it into a build we can pitch: **at least 20 minutes of active, well-paced play, in the browser, comfortable on a phone.** It is based on five audits of the current build (game-feel consultant, pacing bot, phone audit, first-20-minutes audit, code review).

## 0. What the audits found

- The first minute is three actions and ~50 seconds of waiting. The wire you drag is invisible (a CSS bug). Rewards are small text with no sound.
- Following the tutorial literally produces a red STARVED machine, because a fan-out splits evenly between a machine and the Market.
- Guidance stops at 2:12. Unguided players stall; expert players exhaust all content by minute 23. One 5,000¢ purchase causes a 90–190 s wait.
- More than half of all credits come from one-off "first X" bonuses rather than from the factory the player built.
- On a phone the game is unplayable: no pinch zoom, the inspector replaces the board, the tech tree gets a 70px column, the top bar overflows.
- At 75 nodes the frame rate drops to ~20–30 fps, mostly from per-frame SVG dash updates and panels rebuilt five times a second.

## 1. Success criteria

Measured with `npm run pacing` (human-paced bot, `mainline` and `greedy` policies, seeds 1–3) and by play-tests in a desktop and a phone viewport.

| Criterion | Target |
|---|---|
| First two minutes | an action available at least every 10 s; first machine by 0:45; Lab by 1:30 |
| Tier 2 (first Glyph) | 7–10 min |
| Capstone (first Lens) | 20–24 min |
| Dead stretches | none over 60 s before minute 10, none over 120 s before the capstone |
| Where credits come from | at least 65% from sales and orders by the capstone |
| Phone | every step of the goal chain completable by touch at 360×740; primary targets ≥ 44px |
| Frame rate | ≥ 50 fps at 45 nodes under 4× CPU throttle |
| Quality | no page errors; `tsc` clean; tests pass |

## 2. Rule changes

### 2.1 Machines are fed first
When one output port feeds several wires (a plain fan-out, not a Router), machines and pass-through nodes are served first; Markets, Labs and Voids share whatever is left. A Router in Even mode still splits evenly across everything. This matches intent ("feed my machine, sell the rest") and removes the starved-machine trap.

### 2.2 Demand
Each material sells at full price up to its demand rate. Past that the price falls so that extra supply earns little:
`price = value × (rate ≤ demand ? 1 : (demand / rate)^0.65)`.
The first Well therefore earns a clean 1¢/s, and the Market inspector can show a plain "1.6 / 2.0 per second" gauge per material with a "Saturated" tag.

### 2.3 Flow (the game's namesake, unlocked mid-session)
- Producers are all Wells and machines. A producer is *flowing* when its utilisation is at least 90%.
- `Flow` = share of producers that are flowing, smoothed over ~3 s.
- Once unlocked (by a goal, around the first Glyph), Market prices are multiplied by `1 + 0.5 × Flow`. Before the unlock the multiplier is 1.
- At 100% for 10 s the board enters **Flow State** (visual and sound reward). The longest streak is tracked for the end screen.
- Tapping the Flow ring jumps to the worst producer that is not flowing.

### 2.4 Goal chain
One active goal at a time, shown on a goal card. A goal completes when its condition holds (immediately, if the player got there early) and then waits for the player to tap **Claim**. Rewards are credits, Data, tech grants or feature unlocks. Goals are not undoable.

| # | Goal | Done when | Teaches | Reward (first pass) |
|---|---|---|---|---|
| 1 | Wire the Well to the Market | a Well→Market wire exists | wiring | 12¢ |
| 2 | Place a second Well | Wells ≥ 2 | hotbar, deposits | 10¢ |
| 3 | Wire it to the Market too | every Well has a wire out | fan-in | Refining + 50¢ |
| 4 | Build a Refiner from a Well's port | a Refiner has a wire in | build-from-wire | 20¢ |
| 5 | Sell your first Shard | Shard sold ≥ 1 | outputs | Lab + 60¢ |
| 6 | Build a Lab and feed it | α > 0 | sell vs study | 15α |
| 7 | Research Murk Deposits | P2 owned | tech tree | 40¢ |
| 8 | Refine Murk into Ink | Ink made | repeat the build menu | 30¢ |
| 9 | Give the Silt somewhere to go | an Ink Refiner's Silt port is wired and it is not blocked | byproducts, Blocked | 20α |
| 10 | Upgrade a Well | any Well speed ≥ 1 | inspector, upgrades | 30¢ |
| 11 | Sell three different materials | 3 materials selling | demand | Market Lens + 50¢ |
| 12 | Research Ember Deposits | P3 owned | rhythm | 40¢ |
| 13 | Make your first Spark | Spark made | repeat | 25α + Orders |
| 14 | Fill your first order | orders filled ≥ 1 | orders | Routing |
| 15 | Split a stream with a Router | a Router with ≥ 2 wires out | Router | 30α |
| 16 | Expand the board | expansions ≥ 1 | expansion | 60¢ |
| 17 | Research Assembly | P4 owned | rhythm | 100¢ |
| 18 | Assemble your first Glyph | Glyph made | two inputs | Flow meter |
| 19 | Hold 90% Flow for 10 seconds | Flow ≥ 0.9 for 10 s | tuning the line | 300¢ |
| 20 | Study Glyph for β | β ≥ 10 | Data tiers | 50α |
| 21 | Research Breeze Deposits | P5 owned | rhythm | 100¢ |
| 22 | Make your first Mist | Mist made | repeat | 50α |
| 23 | Assemble your first Prism | Prism made | cross-line recipe | 20β + Pipes Mk II |
| 24 | Upgrade a wire | any wire at Mk II | wire capacity | 200¢ |
| 25 | Fill three orders | orders filled ≥ 3 | loop | 300¢ + 30β |
| 26 | Research Fabrication | P7 owned | rhythm | 800¢ |
| 27 | Build a Fabricator | Fabricators ≥ 1 | saving for a big buy | 40β |
| 28 | Make your first Lens | Lens made | **capstone** | demo complete |
| 29+ | Free play: Reclamation, Coil, Dynamo, Paradox | | | credits |

Refining (P1), Lab (R1), Market Lens (C1), Routing (L1) and Pipes Mk II (L3) are granted by goals instead of bought, so α is spent on the Processing line and on genuine choices.

### 2.5 Orders
Unlocked by goal 13. Two cards at a time: "Deliver N of X", counted from items sold at any Market after the order appeared. No timers and no failure. One card always asks for the newest material the player can make. Filled orders are claimed with a tap and replaced. An order can be swapped for a new one once every 30 s. Pay is roughly 1.5× the goods' base value plus some Data of the matching tier; size N to 45–90 s of that item's output.

### 2.6 Numbers
Start from the pacing bot's `proposed` profile (tech prices rising from 25α to 2,000α + 800β for Fabrication; Fabricator 3,000¢; "first X" bonuses ×30 for Tier 1, ×15 for Tier 2, ×10 for Tier 3), then re-tune against the real rules above until section 1 is met.

### 2.7 Smaller rule fixes
- **Refunds are truly free:** deleting a node refunds what it would cost to buy it back, plus its upgrades.
- **Time away:** estimated on a copy of the game (never the live one), paid at 50% of the live rate, capped at 2 h (8 h with Long Absence). Nothing is paid for less than 60 s away.
- **No soft-lock:** the last Well cannot be deleted.
- **Demo end:** the first Lens sets an `ended` flag once and raises an event; stats are tracked for the summary (time, credits earned, nodes built, orders filled, best Flow streak).
- **Starting board:** the Market starts close to the Well (diagonally below-right) so both fit on a phone at a readable zoom.

## 3. Interface

- **Goal card** replaces the objective line: "Goal 4 / 28", title, one-line hint worded for the input in use ("tap" on touch, no key names), progress bar when the goal is numeric (including "saving 7 / 12¢"), reward chips, and a large Claim button when ready. The bottleneck alert becomes a small chip under it rather than replacing it.
- **Orders:** two compact cards docked at the edge of the board on desktop; an Orders button with a badge opening a sheet on phones.
- **Flow ring** around the credits coin with "+40%" beside it; board-edge glow in Flow State.
- **Tech tree shows less:** only owned techs, techs that can be researched now, and the next step beyond those as locked silhouettes. Empty branches are hidden.
- **Calmer statuses:** Wells never show a pill; nothing is flagged before the first wire; new or rewired machines get a grace period.
- **Guiding hand:** an animated pointer demonstrates the first drag (port → Market) and the first build-from-wire, and returns after a few idle seconds.
- **Start screen** (title, one line, Start / Continue; also unlocks audio) and **end-of-demo summary** (6–8 s capstone sequence, then stats and "Keep playing").

## 4. Phone

Applies below ~700px wide (and to short landscape screens).

1. **Shell:** `100dvh`, safe-area padding, no page zoom or scroll. Top bar: credits with Flow ring, one compact Data chip, Orders, Tech (with badge), menu. Hotbar becomes a bottom bar with labelled 60px buttons, scrolling sideways. Undo and Fit become floating 44px buttons. Minimap, zoom buttons, key hints hidden.
2. **Sheets:** inspector, tech detail, orders and the build menu are bottom sheets (max ~45% height) over a board that never resizes. Panels patch values in place and never rebuild while a finger is down.
3. **Camera:** pinch zoom and two-finger pan; zoom clamped to a readable range; opens framed on Well and Market; auto-pans at the edge while dragging a wire or node.
4. **Wiring by tap:** tap a port (nearest port within 44px) → valid targets glow → tap a target to connect, or tap empty space to open the build sheet there. Dragging still works. Wires get a wider hit area; node drag needs 10px of movement.
5. **Tech tree:** branch tabs and 56px rows, detail as a sheet with a sticky Research button.
6. **One strip** for goal, alert and toasts, full width.

## 5. Feel

Three moments must land (consultant): the first wire and sale, the first machine and Lab reveal, and two streams joining into Glyph.

- **Wiring:** visible elastic wire while dragging, snap from 40px, on connect the wire thickens briefly, the target flashes, the first dots race.
- **Selling:** the Market coin pops per sale with a soft tick; bold floaters; the credits counter rolls; coins fly to the counter on big payouts.
- **Buying:** a hotbar slot pulses (with a chime) the moment it becomes affordable; nodes drop in with a squash.
- **Milestones, claims, unlocks:** colour wash, centre card, reward flying to its counter. Glyph bigger than Shard; Lens biggest.
- **Board:** particles drawn in each material's shape, a soft glow under flowing wires, locked deposits shown as dim coloured seams, nodes cannot overlap.
- **Sound:** synthesised, six cues (connect, sale, buy, unlock/claim, error, milestone), rate-limited, with a mute toggle. Light haptics where supported.

## 6. Performance and structure

- Wire dots and particles are drawn on one canvas (culled to the viewport) instead of animating SVG dashes.
- The board is patched by key; selecting something toggles a class instead of rebuilding every node.
- Top bar elements persist and are updated in place; other panels skip unchanged output.
- Controls act on `click` for touch and on `pointerdown` for mouse.

## 7. Bugs to fix

1. Dragging a node, deleting it mid-drag and undoing duplicates the refund (infinite credits).
2. The time-away estimate runs on the live game (free techs, negative Data, lost milestones).
3. Any exception in the frame loop freezes the game; unknown tech ids in a save crash the panels.
4. Deleting the only Well with no credits soft-locks the save.
5. Splicing a sink onto a wire replaces the destination; the second half of a spliced wire loses its tier.
6. Undo can push credits negative.
7. Toasts are hidden behind the tech tree.
8. The build menu is lopsided for even option counts.
9. Autosave stamps the save time while the tab is hidden, losing time away.
10. The dragged wire and the cut line are never drawn; material glyphs sit off-centre in their rings.

## 8. Out of scope

New materials or machines, contracts with timers, blueprints, multi-select, prestige, accounts, a renderer rewrite, real-device testing (emulation only).
