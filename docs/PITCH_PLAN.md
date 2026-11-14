# Flowstate — pitch build plan

The proof of concept works but does not yet hold a first-time player. This plan turns it into a build we can pitch: **at least 20 minutes of active, well-paced play, in the browser, comfortable on a phone.** It is based on five audits of the current build (game-feel consultant, pacing bot, phone audit, first-20-minutes audit, code review) and revised after the consultant's critique of the first draft.

## 0. What the audits found

- The first minute is three actions and ~50 seconds of waiting. The wire you drag is invisible (a CSS bug). Rewards are small text with no sound.
- Following the tutorial literally produces a red STARVED machine, because a fan-out splits evenly between a machine and the Market.
- Guidance stops at 2:12. Unguided players stall; expert players exhaust all content by minute 23. One 5,000¢ purchase causes a 90–190 s wait.
- More than half of all credits come from one-off "first X" bonuses rather than from the factory the player built.
- On a phone the game is unplayable: no pinch zoom, the inspector replaces the board, the tech tree gets a 70px column, the top bar overflows.
- At 75 nodes the frame rate drops to ~20–30 fps, mostly from per-frame SVG dash updates and panels rebuilt five times a second.

## 1. Success criteria

The pacing bot (`npm run pacing`) acts every 3–4 seconds and never hesitates; a real newcomer is roughly 1.5–2× slower. Targets are therefore set on the bot's clock so that a real player lands on 20–30 minutes, and a deliberately slow bot policy guards the floor.

| Criterion | Target |
|---|---|
| First two minutes (fast bot) | an action available at least every 10 s; first machine by 0:45; Lab by 1:30 |
| Tier 2, first Glyph (fast bot) | 6–8 min |
| Capstone, first Lens (fast bot) | 16–19 min |
| Content after the capstone (fast bot) | not exhausted before minute 24 |
| Slow bot (acts every 8–10 s, ignores amber, never upgrades Labs) | Lens by 28 min; never stuck on one goal for more than 4 min |
| Dead stretches (fast bot) | none over 60 s before minute 10, none over 120 s before the capstone |
| Where credits come from | at least 65% from sales and orders by the capstone |
| Phone | every goal completable by touch at 360×740; primary targets ≥ 44px |
| Frame rate | ≥ 50 fps at 45 nodes under 4× CPU throttle |
| Quality | no page errors; `tsc` clean; tests pass |

## 2. Rule changes

### 2.1 Machines are fed first
When one output port feeds several wires (a plain fan-out, not a Router), machines and pass-through nodes are served first; Markets, Labs and Voids share whatever is left. A Router in Even mode still splits evenly across everything. This matches intent ("feed my machine, sell the rest") and removes the starved-machine trap.

### 2.2 Demand: two prices
Each material sells at full price up to its demand rate; anything beyond that sells at a flat 25%. The Market inspector shows it literally: "2.0/s at 1¢ · 0.6/s surplus at 0.25¢". The first Well earns a clean 1¢/s.

### 2.3 Flow (the game's namesake, unlocked mid-session)
- Producers are Wells and machines that have at least one wire and are older than 20 s, so building and rewiring never lower Flow.
- A producer is *flowing* when its utilisation is at least 90%. `Flow` is the share of producers that are flowing, smoothed over ~3 s.
- Once unlocked (by the Glyph goal), Market prices are multiplied by `1 + 0.2 × Flow`. Before the unlock the multiplier is 1.
- 100% for 10 s with at least six producers is **Flow State**: a celebration, and a streak that is tracked for the end screen.
- Tapping the Flow ring jumps to the worst producer that is not flowing.

### 2.4 Goal chain
One active goal at a time on a goal card. A goal completes when its condition holds (immediately, if the player got there early) and then waits for one tap on **Claim**. Rewards are credits, Data, tech grants or feature unlocks; the old automatic "first X" credit bonuses are folded into them, so one event is one celebration. Goals are not undoable. Reward sizes below are a first pass for the bot to tune.

| # | Goal | Done when | Teaches | Reward |
|---|---|---|---|---|
| 1 | Wire the Well to the Market | a Well→Market wire exists | wiring | 12¢ |
| 2 | Place a second Well | Wells ≥ 2 | hotbar, deposits | 10¢ |
| 3 | Wire it to the Market too | every Well has a wire out | fan-in | Refining + 50¢ |
| 4 | Build a Refiner from a Well's port | a Refiner has a wire in | build-from-wire | 20¢ |
| 5 | Sell your first Shard | Shard sold ≥ 1 | outputs | Lab + 60¢ ★ |
| 6 | Upgrade a Well | any Well speed ≥ 1 | inspector, upgrades, surplus | 30¢ |
| 7 | Build a Lab and feed it | α > 0 | sell vs study | 15α ★ |
| 8 | Research Murk Deposits | Murk Deposits owned | tech tree | 40¢ |
| 9 | Refine Murk into Ink | Ink made | repeat the build menu | 40¢ |
| 10 | Give the Silt somewhere to go | an Ink Refiner's Silt port is wired and it is running | byproducts, Blocked | 20α |
| 11 | Make your first Spark | Spark made (research Ember Deposits first) | research → build rhythm | 25α + Orders |
| 12 | Fill your first order | orders filled ≥ 1 | orders | Routing + Market Lens |
| 13 | Route more to a Lab than to the Market | a Router favours a Lab over a Market (ratio or priority) | Router, growing Data | 30α |
| 14 | Expand the board | expansions ≥ 1 | expansion | 60¢ |
| 15 | Assemble your first Glyph | Glyph made (research Assembly first) | two inputs | Flow meter + credits ★ |
| 16 | Hold 75% Flow for 10 seconds | Flow ≥ 0.75 for 10 s | tuning the line | 300¢ |
| 17 | Study Glyph for β | β ≥ 10 | Data tiers | 50α |
| 18 | Make your first Mist | Mist made (research Breeze Deposits first) | repeat | 50α |
| 19 | Assemble your first Prism | Prism made | cross-line recipe | 20β + credits |
| 20 | Fill three orders | orders filled ≥ 3 | loop | 300¢ + 30β |
| 21 | Build a Fabricator | Fabricators ≥ 1 (research Fabrication first) | saving for a big buy | 40β |
| 22 | Make your first Lens | Lens made | **capstone** | demo complete ★ |
| 23+ | Free play: Clay, Coil, Dynamo, Paradox | | | credits |

★ = one of the five big celebrations (the fifth is the first Flow State). Every other claim is a quick coin-fly.

Refining, Lab, Routing and Market Lens are granted by goals instead of bought, so Data is spent on the Processing line and on real choices.

### 2.5 Orders
Unlocked by goal 11. **One** order at a time, shown beside the goal: "Deliver N of X", counted from items sold at any Market after the order appeared. No timer and no failure. It asks for something the player currently makes, preferring the newest material. A filled order is claimed with a tap and replaced; an order that sees no progress for two minutes quietly swaps for another. Pay is mostly **Data** of the tier the player needs next (the scarce currency), plus some credits. N is sized to 45–90 s of that item's output.

### 2.6 Numbers
- Wires carry 4 / 8 / 16 / 32 per second (base raised from 2 so capacity is not an early surprise).
- Shard becomes lime so the first refined material is visibly different from Glint.
- Start from the pacing bot's `proposed` profile (rising tech prices, Fabricator 3,000¢), then tune against the real rules until section 1 is met on both the fast and the slow policy. Data prices must not wall the slow policy.

### 2.7 Smaller rule fixes
- **Refunds are truly free:** deleting a node refunds what it would cost to buy it back, plus its upgrades.
- **Time away:** pays nothing before the capstone (a pitch is one sitting). After it, the estimate runs on a copy of the game, pays 50% of the live rate, capped at 2 h (8 h with Long Absence, which is hidden until then).
- **No soft-lock:** the last Well cannot be deleted.
- **Demo end:** the first Lens sets an `ended` flag once and raises an event; stats are tracked for the summary (time, credits earned, nodes built, orders filled, best Flow streak).
- **Starting board:** the Market starts close to the Well (diagonally below-right) so both fit on a phone at a readable zoom.

## 3. Interface

- **Goal card** replaces the objective line: "Goal 4 / 22", title, one-line hint worded for the input in use ("tap" on touch, no key names), progress when the goal is numeric (including "saving 7 / 12¢"), reward chips, and a Claim button that is the loudest thing on screen when ready. The current order sits beside it as a compact chip. The bottleneck alert becomes a small chip under it rather than replacing it.
- **Flow ring** around the credits coin with "+12%" beside it; board-edge glow in Flow State.
- **Tech tree shows less:** only owned techs, techs that can be researched now, and the next step beyond those as locked silhouettes. Empty branches are hidden.
- **Calmer board:** Wells never show a pill; nothing is flagged before the first wire; new or rewired machines get a grace period; rate chips show only for the selection and for wires at capacity; nodes cannot overlap; zoom never drops below a readable size on any device.
- **Guiding hand:** an animated pointer demonstrates the first drag (port → Market) and the first build-from-wire, and returns after a few idle seconds.
- **Start screen** (title, one line, Start / Continue; also unlocks audio) and **end-of-demo summary** (6–8 s capstone sequence, then stats and "Keep playing").

## 4. Phone

Applies below ~700px wide (and to short landscape screens).

1. **Shell:** `100dvh`, safe-area padding, no page zoom or scroll. Top bar: credits with Flow ring, one compact Data chip, Tech (with badge), menu. Hotbar becomes a bottom bar with labelled 60px buttons, scrolling sideways. The Claim button appears just above it, in thumb reach. Undo and Fit become floating 44px buttons. Minimap, zoom buttons and key hints are hidden.
2. **Sheets:** inspector, tech detail and the build menu are bottom sheets (max ~45% height) over a board that never resizes. Panels patch values in place and never rebuild while a finger is down.
3. **Camera:** pinch zoom and two-finger pan; zoom clamped to a readable range; opens framed on Well and Market; auto-pans at the edge while dragging a wire or node.
4. **Wiring by tap:** tap a port (nearest port within 44px) → valid targets glow → tap a target to connect, or tap empty space to open the build sheet there. Dragging still works. Wires get a wider hit area; node drag needs 10px of movement.
5. **Tech tree:** branch tabs and 56px rows, detail as a sheet with a sticky Research button.
6. **One strip** for goal, order, alert and toasts, full width.

## 5. Feel

Three moments must land: the first wire and sale, the first machine and Lab reveal, and two streams joining into Glyph. In priority order:

1. **Wiring:** visible elastic wire while dragging, snap from 40px, on connect the wire thickens briefly, the target flashes, the first dots race.
2. **Sound:** synthesised, six cues (connect, sale, buy, claim/unlock, error, big celebration), rate-limited, with a mute toggle. Light haptics where supported.
3. **Selling:** the Market coin pops per sale with a soft tick; bold floaters; the credits counter rolls; coins fly to the counter on payouts.
4. **Buying:** a hotbar slot pulses (with a chime) the moment it becomes affordable; nodes drop in with a squash.
5. **Celebrations, in two tiers:** five big beats (first Shard, Lab, Glyph, first Flow State, Lens) get a colour wash and a centre card; every other claim or unlock gets a 300 ms coin-fly and a chime. Glyph is bigger than Shard; Lens is biggest.
6. **Flow State:** the board edge glows, wires brighten, a rising tone; it should feel like the machine humming.
7. **Board:** particles drawn in each material's shape and colour, a soft glow under flowing wires, locked deposits shown as dim coloured seams.

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
9. Autosave stamps the save time while the tab is hidden.
10. The dragged wire and the cut line are never drawn; material glyphs sit off-centre in their rings.

## 8. Out of scope

New materials or machines, timed contracts, blueprints, multi-select, prestige, accounts, a renderer rewrite, real-device testing (emulation only).
