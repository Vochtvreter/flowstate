# Flowstate — pitch build plan

This is the plan the pitch build was made to. It is kept as it was written, with what happened added: the outcome first, a line marked **Built** wherever the build differs from the plan, and at the end the defects that were found and left.

## Outcome

The plan was carried out. What the build is, system by system, is in [DESIGN.md](./DESIGN.md); every number is in [CONTENT.md](./CONTENT.md).

**What the build is now.** A browser game that leads a new player through 22 goals to the first Lens, with free play after. Scripted players who follow the goal card get there in 16 to 20 minutes. It has a phone layout with touch controls, sound, seven big celebrations, an overview zoom, a Tidy button, and an adviser that suggests what to do while waiting.

**Against the criteria of section 1.** Pacing is from `npm run pacing` on order seeds 0–14 (the slow bot: seeds 0–3). Speed was measured in headless Chromium on a 4-core virtual machine that draws on the CPU, on a 47-node board.

| Criterion | Target | Measured | Result |
|---|---|---|---|
| First two minutes (fast bot) | an action at least every 10 s; machine by 0:45; Lab by 1:30 | longest wait 3–8 s; 0:21–0:23; 0:37–0:40 | met |
| First Glyph (fast bot) | 6–8 min | 7:04–7:45 | met |
| First Lens (fast bot) | 16–19 min | 14:30–15:39 | **not met**: sooner than planned |
| Content after the capstone (fast bot) | not exhausted before minute 24 | the last free-play goal, the Paradox, at 24:17–27:55 | met, by 17 s on the quickest run |
| Slow bot | Lens by 28 min; never over 4 min on one goal | Lens at 21:40–22:38; 4:48–7:11 on "Make your first Mist" | Lens met; **4 minutes not met** |
| Dead stretches (fast bot) | none over 60 s before minute 10, none over 120 s before the capstone | 38–44 s; 38–56 s | met |
| Where credits come from | at least 65% from sales and orders by the capstone | 80–82% (fast bots), 75–76% (card followers) | met |
| Phone | every goal completable by touch at 360×740; primary targets ≥ 44px | a scripted touch player reached the first Lens at 390×844. At 360×740, goals 1–14 were played from a new game; of the later goals only parts were tried, from prepared saves. On the screens measured, every button is 44 px or has a 44 px press area. | **shown in part** |
| Frame rate | ≥ 50 fps at 45 nodes under 4× CPU throttle | at rest 57–58 fps at 1440×900 and 60 at 390×844. While panning at 1440×900: 54 fps at 100% zoom, 50 at 70% (single runs 41–55); on the phone 60 frames are drawn but the camera moves in only about 50 of them | met at rest; **at the line** while panning the desktop board at 70% |
| Quality | no page errors; `tsc` clean; tests pass | `tsc` clean; 502 tests pass; no page error in the scripted sessions | met |

At normal CPU speed the same board holds 60 fps at rest and 58–60 while panning, on both sizes. The shipped JavaScript and CSS are about 224 kB gzipped. Over 15 minutes at rest the heap went from 4.9 to 5.2 MB, nearly all of it in the first two and a half minutes, and the page's element count stayed flat.

**The player the plan did not have.** The plan tuned for a fast bot and a slow one. The build is tuned for a third: a scripted newcomer who does only what the goal card says, one action every 6 seconds, and claims 8–16 seconds after Claim lights. Its targets were set during the work, and it meets them on all fifteen seeds, some by little:

| Card follower | Target | Measured |
|---|---|---|
| First Lens | 17:30–21:00 | 17:36–18:11 |
| First Lens at 10 s an action | by 24:00 | 19:43–20:22 |
| Longest time on one goal | 4 min | 3:01–3:17 ("Assemble your first Glyph") |
| Nothing to do, share of the time to the Lens | at most 30% | 23–27% |
| Longest stretch with nothing to do | at most 60 s | 51–58 s |
| Most time with nothing to do on one goal | at most 75 s | 51–70 s |
| Offered a tip by the adviser | — | never in fifteen runs: the card's own lines carry the waits |

**Not met, and what was decided.**

1. **The fast bot's Lens comes too soon** (14:30–15:39 against 16–19 min). Prices were set to keep the card follower's waits short, which brings a fast player's Lens forward too; the fast bot's target was moved to 14:00–18:00.
2. **The slow bot spends up to seven minutes on one goal.** It reads no "while you wait" line, and the prices assume the lines. It was dropped from the regular runs; the card followers above took its place as the floor.
3. **The waiting targets hold only for a player who takes 8–16 seconds to notice a finished goal.** A scripted player who claims at once reaches the Lens at 16:15–16:40, under the 17:30 floor, with nothing to do for 34–37% of that time. "Assemble your first Glyph" holds 81–105 seconds of it, in stretches of up to 42. This was accepted for the pitch build: cheaper prices would bring the fast bot's Lens under 14 minutes. "Build a Fabricator" held 83–104 seconds earlier; its card now has a tune-up to do while saving, and 42–52 seconds are left, never more than 41 at a stretch.
4. **The phone criterion is shown only in part** (see the table).

**How it was tested.** Only by scripts, only in headless Chromium.

- `npm test`: 502 tests of the rules, exploits, saves, the adviser and the pacing targets (seeds 0–3).
- `npm run pacing`: six scripted players on the real rules.
- Scripted players and scripted reviewers drove the real interface with a mouse (1440×900, 1024×768) and by touch (390×844, 360×740, 844×390, 768×1024). Runs from a new game to the first Lens were made on the build before the last fixes. What those fixes changed was checked again on the final build, from prepared saves.
- Speed, as above.

**Never tested.** A real phone or tablet. Safari and Firefox. A machine with a GPU (the frame rates above are without one). The sound by ear, and the vibrations. A real first-time player: the plan's "a real newcomer is roughly 1.5–2× slower" is still an assumption.

## The plan, as written

The proof of concept works but does not yet hold a first-time player. This plan turns it into a build we can pitch: **at least 20 minutes of active, well-paced play, in the browser, comfortable on a phone.** It is based on five audits of the proof of concept (game feel, pacing, the phone, the first 20 minutes, the code) and was revised once after review.

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

**Built:** measured against each line in "Outcome" above. The slow bot is no longer part of the regular runs, and the "1.5–2× slower" newcomer is still an assumption: no person has been timed.

## 2. Rule changes

### 2.1 Machines are fed first
When one output port feeds several wires (a plain fan-out, not a Router), machines and pass-through nodes are served first; Markets, Labs and Voids share whatever is left. A Router in Even mode still splits evenly across everything. This matches intent ("feed my machine, sell the rest") and removes the starved-machine trap.

**Built**, with one addition: a Router, Merger or Silo on the same port is served with the machines only when some path from it leads to a machine. One that leads only to Markets, Labs or Voids waits with them.

### 2.2 Demand: two prices
Each material sells at full price up to its demand rate; anything beyond that sells at a flat 25%. The Market inspector shows it literally: "2.0/s at 1¢ · 0.6/s surplus at 0.25¢". The first Well earns a clean 1¢/s.

**Built**, with two changes. Unused demand is banked for 8 seconds, so a machine that delivers in bursts is paid in full. And demand is not shown until something first sells over it: the game then says so once, grants Market Lens and reveals the Commerce branch, and the Market inspector gets a gauge per material ("full price 1¢ up to 2.0/s, then 0.25¢"). Scripted players who follow the goal card never sell over demand before the first Lens; the fast bots do in 13 of 30 runs.

### 2.3 Flow (the game's namesake, unlocked mid-session)
- Producers are Wells and machines that have at least one wire and are older than 20 s, so building and rewiring never lower Flow.
- A producer is *flowing* when its utilisation is at least 90%. `Flow` is the share of producers that are flowing, smoothed over ~3 s.
- Once unlocked (by the Glyph goal), Market prices are multiplied by `1 + 0.2 × Flow`. Before the unlock the multiplier is 1.
- 100% for 10 s with at least six producers is **Flow State**: a celebration, and a streak that is tracked for the end screen.
- Tapping the Flow ring jumps to the worst producer that is not flowing.

**Built**, with one change: a producer counts when it is at least 20 s old and some path of wires leads from it to a Market or a Lab. Having a wire is not enough.

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

**Built:** 22 goals as planned; these differ (the full table is in [CONTENT.md](./CONTENT.md#goal-chain)).

| # | As built |
|---|---|
| 5 | Reward: Lab + 70¢. |
| 6 | Reward: 50¢. |
| 11 | Done when the first Spark is sold, not made. Reward: Orders + 25α. A big celebration. |
| 12 | Reward: Routing + 200¢. Market Lens is not a goal reward: it comes with the first sale over demand. |
| 13 | Judged by what the Router sends, not only by how it is set. One press of **Favour** on the Lab's wire does it. |
| 15 | Reward: Flow meter + 150¢. |
| 16 | "Hold 95% Flow for 10 seconds". Reward: 150¢. After 90 s on the card, all but one producer flowing is enough; after 180 s, all but two; then one more every 120 s, so the goal cannot stall for good. |
| 17 | Done at 40 β in hand. |
| 18 | Done when the first Mist is sold. |
| 19 | Reward: Bulk Upgrade + 600¢ + 40β. A big celebration. |
| 20 | "Upgrade all your Wells at once": one press of Upgrade all. Reward: 1,200¢ + 60β. "Fill three orders" was always met already when it came up. |
| 23+ | Four free-play goals: Clay 200¢, Coil 600¢, Dynamo 1,800¢, Paradox 7,500¢. |

- Seven big celebrations, not five: first Shard, the Lab, first Spark, first Glyph, the first Flow State, first Prism, first Lens.
- The goal-granted techs are Refining, Lab, Routing and Bulk Upgrade.
- Claiming a goal also clears the undo history.
- Not in the plan: seven goals carry "while you wait" lines on the card, and an adviser offers tips during waits ([DESIGN.md](./DESIGN.md) section 9.1).

### 2.5 Orders
Unlocked by goal 11. **One** order at a time, shown beside the goal: "Deliver N of X", counted from items sold at any Market after the order appeared. No timer and no failure. It asks for something the player currently makes, preferring the newest material. A filled order is claimed with a tap and replaced; an order that sees no progress for two minutes quietly swaps for another. Pay is mostly **Data** of the tier the player needs next (the scarce currency), plus some credits. N is sized to 45–90 s of that item's output.

**Built**, with these changes. N is 25–50 s of what reaches Markets of that item, at least 8; the first order is 32–37 s of something already selling. The item is picked from what the player makes, a raw material only as a last resort, what already sells first and the newest first. Besides the two-minute rule, an order that would take more than five minutes at the current rate is replaced too.

### 2.6 Numbers
- Wires carry 4 / 8 / 16 / 32 per second (base raised from 2 so capacity is not an early surprise).
- Shard becomes lime so the first refined material is visibly different from Glint.
- Start from the pacing bot's `proposed` profile (rising tech prices, Fabricator 3,000¢), then tune against the real rules until section 1 is met on both the fast and the slow policy. Data prices must not wall the slow policy.

**Built:** wires and Shard as planned. The Fabricator costs 5,000¢. Prices were tuned against the fast bots and against scripted players who follow the goal card, not against the slow policy (see "Outcome").

### 2.7 Smaller rule fixes
- **Refunds are truly free:** deleting a node refunds what it would cost to buy it back, plus its upgrades.
- **Time away:** pays nothing before the capstone (a pitch is one sitting). After it, the estimate runs on a copy of the game, pays 50% of the live rate, capped at 2 h (8 h with Long Absence, which is hidden until then).
- **No soft-lock:** the last Well cannot be deleted.
- **Demo end:** the first Lens sets an `ended` flag once and raises an event; stats are tracked for the summary (time, credits earned, nodes built, orders filled, best Flow streak).
- **Starting board:** the Market starts close to the Well (diagonally below-right) so both fit on a phone at a readable zoom.

**Built** as planned.

## 3. Interface

- **Goal card** replaces the objective line: "Goal 4 / 22", title, one-line hint worded for the input in use ("tap" on touch, no key names), progress when the goal is numeric (including "saving 7 / 12¢"), reward chips, and a Claim button that is the loudest thing on screen when ready. The current order sits beside it as a compact chip. The bottleneck alert becomes a small chip under it rather than replacing it.
- **Flow ring** around the credits coin with "+12%" beside it; board-edge glow in Flow State.
- **Tech tree shows less:** only owned techs, techs that can be researched now, and the next step beyond those as locked silhouettes. Empty branches are hidden.
- **Calmer board:** Wells never show a pill; nothing is flagged before the first wire; new or rewired machines get a grace period; rate chips show only for the selection and for wires at capacity; nodes cannot overlap; zoom never drops below a readable size on any device.
- **Guiding hand:** an animated pointer demonstrates the first drag (port → Market) and the first build-from-wire, and returns after a few idle seconds.
- **Start screen** (title, one line, Start / Continue; also unlocks audio) and **end-of-demo summary** (6–8 s capstone sequence, then stats and "Keep playing").

**Built**, with these differences ([UI.md](./UI.md) has the detail).

- The goal card also carries a strip of 22 pips, the "while you wait" line with a **Show me** button, the adviser's tip, and, for a wait, a line such as "Saving 64 / 195α · about 3 min".
- The Flow ring's label is the Flow percentage; the bonus is in its tooltip.
- The tech tree also leaves out any tech priced in a kind of Data the player has not had yet.
- Zoom does go below a readable size. The readable view stops at 70% (74% on a phone); below that the cards become small tiles, an overview in which wiring still works. It goes out only as far as the factory needs, and never past 15%.
- Rate chips also show under the mouse, on wires with nothing flowing, and for three seconds on a new wire.
- The guiding hand also acts out every **Show me**.
- The summary comes 6.5 s after the Lens and also offers "Copy result" and "Start over".

## 4. Phone

Applies below ~700px wide (and to short landscape screens).

1. **Shell:** `100dvh`, safe-area padding, no page zoom or scroll. Top bar: credits with Flow ring, one compact Data chip, Tech (with badge), menu. Hotbar becomes a bottom bar with labelled 60px buttons, scrolling sideways. The Claim button appears just above it, in thumb reach. Undo and Fit become floating 44px buttons. Minimap, zoom buttons and key hints are hidden.
2. **Sheets:** inspector, tech detail and the build menu are bottom sheets (max ~45% height) over a board that never resizes. Panels patch values in place and never rebuild while a finger is down.
3. **Camera:** pinch zoom and two-finger pan; zoom clamped to a readable range; opens framed on Well and Market; auto-pans at the edge while dragging a wire or node.
4. **Wiring by tap:** tap a port (nearest port within 44px) → valid targets glow → tap a target to connect, or tap empty space to open the build sheet there. Dragging still works. Wires get a wider hit area; node drag needs 10px of movement.
5. **Tech tree:** branch tabs and 56px rows, detail as a sheet with a sticky Research button.
6. **One strip** for goal, order, alert and toasts, full width.

**Built**, with these differences.

- The floating buttons are Fit, Undo and Tidy, and from goal 14 Expand. Redo, Pause and Sound are in the gear menu.
- Zoom is not held to a readable range: the readable view stops at 74% and a pinch goes on into the overview, as far as the factory needs.
- A phone held sideways gets the same layout. It is cramped (see "Known and left") and the game suggests holding the phone upright, once.

## 5. Feel

Three moments must land: the first wire and sale, the first machine and Lab reveal, and two streams joining into Glyph. In priority order:

1. **Wiring:** visible elastic wire while dragging, snap from 40px, on connect the wire thickens briefly, the target flashes, the first dots race.
2. **Sound:** synthesised, six cues (connect, sale, buy, claim/unlock, error, big celebration), rate-limited, with a mute toggle. Light haptics where supported.
3. **Selling:** the Market coin pops per sale with a soft tick; bold floaters; the credits counter rolls; coins fly to the counter on payouts.
4. **Buying:** a hotbar slot pulses (with a chime) the moment it becomes affordable; nodes drop in with a squash.
5. **Celebrations, in two tiers:** five big beats (first Shard, Lab, Glyph, first Flow State, Lens) get a colour wash and a centre card; every other claim or unlock gets a 300 ms coin-fly and a chime. Glyph is bigger than Shard; Lens is biggest.
6. **Flow State:** the board edge glows, wires brighten, a rising tone; it should feel like the machine humming.
7. **Board:** particles drawn in each material's shape and colour, a soft glow under flowing wires, locked deposits shown as dim coloured seams.

**Built**, with these differences.

- Wiring: a finger's drag snaps on from 40 px. A mouse must let go over the card or within 12 px of its port; a release beside a card opens the build menu.
- Sound: about twenty cues, not six, among them a fanfare for each big celebration. Nobody has heard them: levels were checked by rendering the cues offline.
- Celebrations: seven big beats, not five (section 2.4).
- A locked deposit reads "Unknown deposit · needs research". It is not a coloured seam.

## 6. Performance and structure

- Wire dots and particles are drawn on one canvas (culled to the viewport) instead of animating SVG dashes.
- The board is patched by key; selecting something toggles a class instead of rebuilding every node.
- Top bar elements persist and are updated in place; other panels skip unchanged output.
- Controls act on `click` for touch and on `pointerdown` for mouse.

**Built**, with one difference: wire dots and particles are drawn on three canvases, not one. Also built, and not in the plan: the adviser and the Tidy layout each run in a Web Worker, so neither holds up a frame. Measured speed is in "Outcome".

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

**Built:** all ten are fixed. Tests hold 1, 2, 4, 5 and 6 (`tests/editing.test.ts`, `tests/save.test.ts`, `tests/exploits.test.ts`). 3 and 9 are in `src/main.ts` and `src/state.ts`. 7, 8 and 10 were seen fixed in the running build.

## 8. Out of scope

New materials or machines, timed contracts, blueprints, multi-select, prestige, accounts, a renderer rewrite, real-device testing (emulation only).

**Built:** none of these. All are still out.

## Known and left

Found during the work and left for after the pitch. Each is stated as a player would meet it.

1. A player who presses Claim the moment it lights has nothing to do for about a third of the run, most of all on "Assemble your first Glyph" (80 to 105 seconds). On "Build a Fabricator" 42 to 52 seconds are left, at the end of the wait, once the card's tune-up is done.
2. When "Assemble your first Glyph" comes up, the card says "about 6 min" or "about 7 min" for a wait that takes about three once the player follows its line.
3. A "while you wait" step that has just come up can read "Saving for this · about 3 min" and be offered a few seconds later.
4. A step stays on the card for up to 10 seconds after the player has spent credits elsewhere. Taken then, it puts off the card's own purchase.
5. On a phone held sideways (844×390) the goal card covers 45% of the board's height and 58% of its width at goals 15 and 21.
6. After a reload during "Make your first Spark" or "Make your first Mist", with the deposit's research already bought, the view opens on the factory and the new deposit can be off screen.
7. A new machine keeps clear of cards, ports and deposits, but not of wires: it can land on top of one.
8. At 1024 px wide, Tidy on a large factory can leave the leftmost column cut off at the edge of the screen.
9. If the first Lens is made before "Build a Fabricator" has been claimed, Keep playing leads through two more Claims before free play starts.
10. Free play opens with the Fabricator blocked: no goal card says to wire the Lens to a Market, only the alert chip does.
11. Tidy pressed from the overview at 1440×900 can stutter for one frame of about a tenth of a second.
12. The tune-up on "Build a Fabricator" has the player wire a new Refiner to the Market, which can be a plot away. On a phone the board zooms out to the overview for that tap, and stays there.
13. What the tune-up remembers (which of its steps have stopped paying) is not saved: after a reload in the last minute of that wait, a step that had left the card can be offered once more for a few seconds.
