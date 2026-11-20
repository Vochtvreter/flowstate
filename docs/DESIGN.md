# Flowstate — Game Design Document

> An incremental game about building and tuning a supply line that turns sand into a phone: draw wires between machines, turn Sand, Oil, Ore and Quartz into Glass, Plastic, Copper and Silicon, those into Screens and Circuits and those into a Phone; sell what you make for credits, and research your way to bigger, cleaner, faster flows.

Status: **describes the pitch build as it stands.** Numbers live in [CONTENT.md](./CONTENT.md), the interface in [UI.md](./UI.md), and the plan for this build, with how it came out, in [PITCH_PLAN.md](./PITCH_PLAN.md). Where a design in this document is not built, it says so.

Everything here was checked in headless Chromium only, by scripted players. Nobody has heard the sound, and nothing has run on a real phone, in Safari or in Firefox.

---

## 1. Pillars

Every design decision should serve one of these. If it serves none, cut it.

1. **Wiring is the toy.** Connecting nodes must feel as good as popping bubble wrap: snappy, forgiving, instantly readable. The player should never fight the editor. A card that is moved comes level with what it is wired to, so a tidy row is a matter of a nudge.
2. **The flow tells you what's wrong.** You never need a spreadsheet. A card in trouble says what is wrong in plain words with the material by name ("Needs more Copper", "Tar has no exit"), and the Drill or machine it is waiting on says "Can't keep up". A wire shows its rate when that answers a question: when it is selected or under the mouse, when nothing flows on it, when it is full, and for three seconds after it is made. The Flows panel asks the same of each material in turn (§7.3).
3. **Experimenting is free.** Deleting, moving and rewiring cost nothing: a deleted node refunds what it would cost to buy back, with its upgrades, and undo goes back up to 200 steps, as far as the last goal claimed. The only "cost" of a bad layout is lost time — which makes optimization a choice, not a punishment.
4. **Always a next number.** A goal card always names the next thing to bring about, and why. Where that thing has to be saved for, the card says how long it will take and, on seven goals, what to do meanwhile. The build meets this pillar only in part: see section 6.5.

5. **It makes sense before it is explained.** The things are real (a Phone is a Screen and two Circuits; a Circuit is Plastic and Copper), so a player can guess what a recipe needs and see why a line stands still. A card says what to bring about and why, never where to click (§9), and the screen starts with a Drill, a Market and one sentence: every other control arrives with the goal that first gives it a use (§12).

---

## 2. Core loop

```
 ┌──────────────┐   items   ┌──────────────┐  credits  ┌─────────────────────┐
 │ Build / wire │ ────────▶ │  Flow runs   │ ────────▶ │ Buy & upgrade nodes │──┐
 └──────────────┘           │ (sell / lab) │   data    │ Research tech       │  │
        ▲                   └──────────────┘ ────────▶ └─────────────────────┘  │
        └──────────────── new nodes, recipes, router modes, space ◀─────────────┘
```

- **Seconds:** watch items move, see `+credits` pop at the Market, spot a red node, fix it.
- **Minutes:** save up for the next node, upgrade or research; claim a goal or an order; rebalance a chain after an upgrade shifted the ratios.
- **The session:** about twenty minutes from the first wire to the first Phone, which ends the demo. That is the time of scripted players who follow the goal cards (§6.5); no person has been timed. Free play goes on through four more goals, to the Robot. Nothing is built for the hours beyond that (section 12).

---

## 3. The two progression systems

The game has exactly two progression systems, each with **its own currency** so they don't cannibalize each other and so the player has a meaningful routing decision: *sell it or study it?*

| | **Board** (the interface you build on) | **Tech Tree** |
|---|---|---|
| Currency | **Credits** ¢ — earned by selling at Markets | **Data** (α, β, γ) — earned by feeding items to a Lab |
| Answers | "How *much* can I build?" | "What *kinds* of things can I build?" |
| Buys | Nodes, node upgrades, wire tiers, board space | Materials, recipes, node types, Router modes, scale tools |
| Curve | Exponential per-type costs (endless) | Finite, hand-authored tree of 29 techs |

### 3.1 Board progression (credits)

- **Buying nodes.** Each node type has its own escalating price: `cost = base × growth^owned`. Growth is between ×1.10 and ×1.50, except for the Assembler at ×2.5. The first Market and every Dump are free. Deleting a node refunds what it would cost to buy back, so there is no buy/sell exploit and delete-then-rebuild nets to zero.
- **Upgrading nodes.** Up to three tracks; level L costs `first level × 1.6^(L−1)`:
  - **Speed** — −15% craft time per level for a machine, +25% rate for a Drill or a Lab. 10 levels (25 with Overclock).
  - **Efficiency** (machines, needs Efficiency Tuning) — every 6th craft uses no inputs, then every 5th, 4th, 3rd. 4 levels.
  - **Buffer** (machines and Silos) — +100% internal storage per level. 5 levels.
  - With Bulk Upgrade, "Upgrade all" raises every node of the same kind by one level.
- **Wire tiers.** A wire carries 4 items a second. Researched tiers carry 8, 16 and 32, bought per wire. A wire's inspector has "Upgrade every full wire".
- **Board space.** The board starts as one plot with five **Deposits**: two Sand, Oil, Ore and Quartz. One button, **Expand board**, buys the next strip of land, alternately to the right and below. Each strip brings two or three deposits from a fixed cycle and costs 2.5 times the one before (200¢, 500¢, 1,250¢…). Deposits are the only places Drills can go — the hard constraint that keeps raw input scarce and makes optimization matter. The player does not choose which plot to buy.

### 3.2 Tech tree (Data)

A hand-authored tree with five branches (full list in [CONTENT.md](./CONTENT.md#tech-tree)):

- **Processing** — new materials, recipes and machines; Efficiency and Overclock.
- **Logistics** — the Router with its Ratio mode, Priority and Filter modes, Merger, Silo, wire tiers.
- **Commerce** — Market Lens (price gauges), Wider Demand, Luxury Buyers, Exports. Hidden until something first sells over its demand. *Contracts are not built.*
- **Research** — Lab Speed, Deep Analysis, Long Absence (hidden until the demo ends).
- **Scale tools** — Bulk Upgrade, Auto-balance. *Blueprints are not built.*

**Data comes in three kinds.** A Lab turns a raw item into 1 α, a refined one into 3 α (Tar, a byproduct: 1 α), a Tier 2 item into 5 β and a Tier 3 item into 8 γ. Later techs cost β and γ, so you can't skip a tier by grinding raw Sand. This is the natural "gate" that pushes the player up the material chain.

Five techs cannot be bought. Refining, Lab, Routing and Bulk Upgrade are goal rewards, and Market Lens is granted the first time something sells over its demand.

The tree shows only what is owned, what can be researched now, and one step beyond that as locked outlines. A tech priced in a kind of Data the player has not had yet stays hidden. A tech can be marked "Research it for me when ready".

> **Rule:** the tech tree never gates *basic editing comfort*. Dragging, cutting, undo, duplicate and fan-out wiring are available from minute one. Only tools that matter at *scale* (Bulk Upgrade, Auto-balance) are unlocks. *Multi-select, copy/paste and blueprints are not built.*

---

## 4. World model

### 4.1 Materials

Sixteen materials in four tiers, all things everyone knows, each with a picture of the thing itself (a heap of sand, a drop of oil, a pane of glass, a chip with its legs, a phone) and a **color + shape** pair for its dots on a wire (shape so it's colorblind-safe). They were first given invented names (Glint, Murk, Ember…): a player had to learn what each was before a recipe could mean anything. The ids in the code and in saves are still those; the table is at the top of `src/content.ts`.

- **T0 raw** come from Drills on Deposits: *Sand* ◆, *Oil* ●, *Ore* ▲, *Quartz* ≈
- **T1 refined** (*Glass*, *Plastic*, *Copper*, *Silicon*, *Rubber*), **T2 assembled parts** (*Screen*, *Circuit*, *Cable*), **T3 finished products** (*Phone*, *Laptop*, *Robot*): a refined item sells for one and a half to two times what went into it, an assembled or fabricated one for about twice. The game never says "Tier 2": it says "an assembled part".
- One recipe has a **byproduct**: refining Oil yields Plastic + Tar. Tar needs somewhere to go (a Dump, a Market, later a Refiner that makes Rubber), or the Plastic Refiner stops. Byproducts are the reason Dumps, Routers and filters exist.

### 4.2 Node types

| Node | Ports | Behavior |
|---|---|---|
| **Drill** | 0 in → 1 out | Placed on a Deposit; emits that raw material at 1 a second (Ore and Quartz: 0.8). |
| **Refiner** | 1 in → 1–2 out | Single-input recipes. |
| **Assembler** | 2 in → 1 out | Two-input recipes. |
| **Fabricator** | 2–3 in → 1 out | Recipes with two or three inputs (T3). |
| **Router** | 1 in → N out | Splits its stream across its wires: Even, Ratio, Priority, Filter. **Favour** sets Ratio 3 : 1 toward one wire in one press. |
| **Merger** | N in → 1 out | A junction: many wires in, one stream out. It has no modes. |
| **Silo** | 1 in → 1 out | Big buffer: 200 of each material. Shows how much it holds. |
| **Market** | N in → 0 out | Sells anything for credits, at two prices (see §6.1). |
| **Lab** | N in → 0 out | Studies 1 item a second (2 with Lab Speed) into Data. Takes materials in the order they first arrived. |
| **Dump** | N in → 0 out | Destroys items. Free. The "I just need this byproduct gone" button. |

### 4.3 Wires and ports — "1 or more to 1 or more"

- Any **output port can fan out** to several wires. **Machines are fed first**, evenly; Markets, Labs and Dumps share what is left. A Router, Merger or Silo on the same port is served with the machines when some path from it leads to one, and with the Markets when none does. So "feed my machine, sell the rest" needs no Router.
- Any **input can fan in** from several wires.
- A **Router** is for the split a plain port does not give: Even (truly even, whatever is at the other end), Ratio by weights, Priority (fill the first wire, overflow to the next), Filter (one material per wire).
- A wire carries whatever its source emits. Merging different materials onto one wire creates a **mixed stream** — legal: machines pull only what their recipe needs, and junctions hold each material separately, so a surplus of one cannot block the others. Filter Routers sort a mixed stream back out.
- A wire's capacity is items per second averaged over one second, so a machine that hands over whole items still feeds the next machine in full.

---

## 5. Simulation

Kept deliberately simple, deterministic and free of the DOM, so it is unit-tested and can be run ahead on copies of the game. The order generator, the adviser and the time-away estimate all do that.

- **Fixed tick:** 20 ticks/sec.
- **Buffers, not belts.** A machine holds up to two crafts' worth of each input and of each output (more with Buffer upgrades). Wires move items from an output buffer to the next node's input buffer, up to the wire's capacity. Machines take and hand over whole items.
- **Backpressure emerges naturally:** if a downstream buffer is full, the wire stalls, the upstream output fills, the upstream machine stops.
- **Node status** is derived each tick and drives all the visual feedback:
  - 🟢 **Working** — crafting.
  - 🟡 **Blocked** — output full (downstream can't keep up, or the port has no wire).
  - 🔴 **Starved** — missing an input.
  - ⚪ **Idle** — no recipe, or nothing wired in.

  A new or rewired node gets a few seconds' grace before anything is reported. The interface calls a machine starved only when it works less than 60% of the time (averaged over 3 seconds, cleared at 65%). Above that it is "short", which the inspector says in amber.
- **Utilization** = share of time Working, smoothed over about 3 seconds. Shown as the ring around each node's icon.

### 5.1 Time away

- **Before the first Phone, time away pays nothing**, and a hidden or closed tab does not advance the game. A pitch is one sitting.
- **After it**, a copy of the game is run until it settles and then measured. The live game is paid 50% of that rate for the time away, up to 2 hours (8 with Long Absence). A save that is continued after more than half a minute away shows a "While you were away" card when something was earned.

### 5.2 Saves

- One save, in the browser's local storage. It is written every 10 seconds, when the tab is hidden and when the page closes. Nothing is saved before Start is pressed.
- A save that is damaged in part still loads: what cannot be read gets a sound value. One that cannot be read at all is copied aside before a new game can overwrite it.
- With the game open in two tabs, the one not being played stops saving and says so.
- *Not built:* export and import of a save, accounts. Clearing the browser's storage loses the game.

---

## 6. Economy

### 6.1 Selling: two prices

- Each material has a **demand** rate. Markets buy it at full price up to that rate; anything beyond sells at a flat 25%. Unused demand is banked for 8 seconds, so a machine that delivers in bursts is still paid in full. Demand is counted across all Markets together.
- Wider Demand multiplies every demand by 1.5 and Exports by 2. Luxury Buyers adds 25% to the value of T2 and T3.
- **Demand stays out of sight until it bites.** The first time a material sells over its demand for 3 seconds, the game says so once, grants Market Lens (a gauge per material in the Market's inspector) and reveals the Commerce branch. Scripted players who follow the goal cards never get there before the first Phone; the fast ones, who upgrade on their own, do in 13 of 30 runs.

Effect: flooding the Markets with one product stops paying, so diversifying and climbing tiers is the better move.

### 6.2 Sell vs. study

Every item can go to a Market (credits) or a Lab (Data). Routing that split is the player's core strategic dial. Goal 13 teaches it with a Router and one press of Favour.

### 6.3 Flow

The game's namesake, unlocked by goal 15.

- **Counted:** Drills and machines that are at least 20 seconds old and whose output can reach a Market or a Lab along some path of wires. A machine just built does not lower Flow, and six Drills into a Dump are not a supply line.
- A counted producer is **flowing** at 90% utilization or more. **Flow** is the share that is flowing, smoothed over 3 seconds.
- Once unlocked, every sale pays `× (1 + 0.2 × Flow)`: up to 20% more.
- **Flow State** is 100% held for 10 seconds with six or more producers. The first one is a celebration; the longest streak is on the end summary.
- A ring around the credits coin shows Flow. Pressing it jumps to the producer furthest from flowing.

### 6.4 Orders

Unlocked by goal 11. **One** order at a time: "Deliver N of X", counted from items sold at any Market after the order appeared. No timer and no failure.

- It asks for something the player makes, a raw material only as a last resort, preferring what already sells and what is newest.
- N is 25–50 seconds of what reaches Markets (the first order: about half a minute).
- It pays credits, half the items' full price, plus Data of the kind the player is shortest of.
- A filled order waits for Claim. One with no delivery for two minutes, or that would take more than five at the current rate, is quietly replaced.

*Timed contracts ("deliver 3.0 Circuit/s for 2 minutes") were the earlier design and are not built.*

### 6.5 Pacing

Measured with scripted players on the real rules (`npm run pacing`, 15 order sequences). No person has been timed.

| Scripted player | First Phone |
|---|---|
| Knows the game, one action every 3–4 s | 14:30–15:39 |
| Does only what the goal card says, 6 s an action, claims 8–16 s after Claim lights | 17:36–18:11 |
| The same at 10 s an action | 19:43–20:22 |
| The same at 6 s, but claims at once (1–3 s) | 16:15–16:40 |
| Reads the hints and the tips, never a "while you wait" line | 22:25–29:26 |

The fast players make the first Circuit at 7:04–7:45 and the Robot, the last free-play goal, at 24:17–27:55.

**Waiting.** "Nothing to do" means free hands, no goal or order to claim, and no step of the card's line that can be done now.

- The card follower who claims 8–16 s late has nothing to do for 23–27% of the time to the first Phone, never for more than 58 seconds at a stretch. The build is tuned for this player.
- The one who claims at once has nothing to do for 34–37% of it. "Make your first Circuit" holds 81–105 seconds of that, in stretches of up to 42. This was accepted for the pitch build: cheaper prices would let the fast players finish in under 14 minutes.
- "Build a Fabricator", the last wait, held 83–104 seconds of it earlier. Its card now has a tune-up to do while saving (§9.1), and 42–52 seconds are left, never more than 41 at a stretch.

More in [CONTENT.md](./CONTENT.md#where-the-pacing-lands).

---

## 7. Frictionless building — the interaction spec

This is the most important section. The editor *is* the game. Sizes, layouts and the phone's controls are in [UI.md](./UI.md).

### 7.1 Gestures

| Action | Mouse and keys | Touch |
|---|---|---|
| Connect | Drag from a port and let go over a node's card, or within 12 px of its port. An input port can be dragged backwards to a source. | Tap a port, then tap the target. Dragging works too, and snaps on from 40 px. |
| **Build-from-wire** | Drag from a port into empty space and release → **build menu** of machines and other nodes that can take that material (or make it, from an input port). Where the card will stand is shown as an outline while the menu is open; the pick is placed there, wired and set to its recipe. Options keep a fixed order with numbers; the one the goal card asks for is highlighted and Enter builds it. | Tap a port, tap an empty spot → the same options in a bottom sheet, the suggested one first. |
| Place | Pick in the build bar or press its number, then click the board. Shift-click places several. A Drill goes on a free deposit; clicking the deposit takes one up. | Tap in the build bar, tap the board. |
| Splice | Drop an unwired node onto a wire → it's inserted inline. A Market, Lab or Dump becomes a branch instead. | The same. |
| Branch | Drag from the *middle of a wire* → a new wire from that wire's source port. | — (a drag on a wire pans) |
| Cut | Hold `Shift` and drag across wires. Or select a wire and press `Del`. | Tap the wire, then "Cut wire". |
| Move | Drag a node. It settles on a 20 px grid, clear of other cards. | Drag, after 10 px. |
| Move several | `Shift`+click cards into a block (double-click one for its whole line), then drag any of them: they move together, as one undo step. | — |
| Delete | `Del` or `Backspace`, or Delete in the inspector. Always full refund, except for a node from a save of the earlier public version, which refunds no more than was paid for it. The last Drill cannot be deleted. | Delete in the inspector. |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` or `Ctrl+Y`. Restores credits. Up to 200 steps, back to the last goal claimed. | Undo button; Redo in the gear menu. |
| Duplicate | `Ctrl+D`: another node of the same type and recipe to place, at the normal price. | Duplicate in the inspector. |
| Inspect | Click a node or wire → inspector with recipe, in/out rates, utilization, upgrades, and what is wrong with a one-press fix ("Receiving 0.80 of 1.00 Ore/s", with an "Upgrade source · 50¢" button). Hovering shows the rates on its wires. | Tap → the inspector as a bottom sheet. |
| Camera | Wheel zooms; drag empty board (or middle or right drag) pans; `F` fits; `T` tidies. | Pinch zooms; drag empty board pans; Fit and Tidy buttons. |
| Cables | `W` or the Wires button: curved or squared wires. Double-click a wire to pin it, drag the pin, double-click the pin to take it off. | Wires in the gear menu; Add a pin in a wire's sheet, then drag the pin. |
| Other keys | `1`–`9`, `0` build bar or menu option · `R` tech tree · `P` pause · `Esc` backs out | |

*Not built:* box-select, a block of cards for a finger, named groups or frames round a line, copy/paste of a selection, a trash target, a grid toggle, right-drag cutting, a node tooltip on hover.

### 7.2 Auto-behaviors

- **Auto-recipe:** a machine built from a port, or wired into, takes the unlocked recipe that best fits what is wired in.
- **Machines first:** a fan-out feeds machines before Markets, Labs and Dumps (§4.3).
- **Placement:** a machine built from the menu stands in the outline the menu shows while it is open. That is centred on the point the player chose (or the nearest point inside the plot and clear) when it has room there. Otherwise it is the nearest free spot, preferring, within about 100 px, one with air round it, one the player can see whole, one on the near side of other cards from its port, and one whose new wire passes behind no card.
- **Level:** cards stand on a 20 px grid and their ports do not (a card with one port has it 36 px down, one with two 31 and 61, a small card 30), so a wire between two cards of different shapes never ran straight. A card that is dragged within 9 px of the height at which one of its wires would be a straight line comes level by itself: the wire lights up, a soft click says so, and the card stays there, a few pixels off the grid, when it is let go.
- **Block:** several cards can be put in a block and moved as one (§7.1): the way to set a whole line in a row, or to make room for one, without a drag a card.
- **Tidy** (`T`, from six nodes): lays the whole board out again so that no wire runs behind a card it does not end at, and wires are short and cross little. Then cards come level as under the hand, where that takes under half a grid step. Drills stay on their deposits, the cards glide to their places, and one undo puts everything back. *The layout does not set cards in rows:* on two boards played by the card, Tidy left 2 of 22 and 4 of 34 wires straight. A row is made by hand.
- **Cable management** (from six nodes): how a wire runs is the player's to arrange, and never part of the rules. Wires are drawn curved, or squared: right angles, the turn that passes behind the fewest cards, and a lane of its own for each wire that turns in before the same card. A wire can be given up to four pins, points it is drawn through, to lead it round a card or along a path of the player's own. The style is a setting of the browser; pins are part of the board (saved, undone, moved with a block, taken off by Tidy). *Squared wires do not route themselves round cards:* where each of the three turns passes behind one, a pin is the way out.
- *Not built:* a ratio hint while placing ("needs 2.0/s Sand · 1.4/s spare upstream").

### 7.3 Readability

- **Wires** are smooth curves, thicker with throughput, with dots in the material's color and shape travelling along them. A wire with nothing flowing turns dashed and still.
- **Rate labels** show when they answer a question (pillar 2), never in the overview.
- **Node rings** show utilization; status color is unmistakable.
- **Labels in plain words.** A card with a problem of its own carries a label that says it as a person would: "Needs more Copper" ("Needs Copper" when nothing wired in brings any), "Tar has no exit" for a port with no wire, "Backed up" for an output that is wired and still full, "No input". A Drill says only that its material has no exit. A machine that runs a little short but works most of its time (60% or more, and under 88%) is no problem and raises no alert; it carries "Short of Ore" in amber, so that the card, the Flow meter and the Flows panel agree. The Drill or machine that a starved one is waiting on, when it works flat out, says "Can't keep up", and its inspector names who is waiting and offers Speed: it used to stand in healthy green beside the red one. (The simulation's own words, blocked, starved and idle, are not shown anywhere.)
- **Flows.** A panel that lists every material on the board, from Sand down to the Phone: how much is made a second, and a bar of where it goes (to machines, sold, studied, dumped, and hatched, what machines wanted and did not get). A material is *short* (a machine stands waiting for it), has *no exit*, has some *to spare* (more could be made than is taken: no fault), or is fine. A row that is short or has no exit has a Show button that goes to the Drill or machine to look at, and the button in the top bar counts those rows. A press on a row traces the material: what makes it, what uses it and the wires that carry it stay lit, with their rates, and the rest stands back. The amounts are read off the wires, which stand still where a machine's own rate swings with its bursts. It arrives with the second raw material (goal 9).
- **One alert chip** under the goal card names one problem at a time: the one the goal card is about first, otherwise the worst. Its Show button jumps there.
- **Overview:** below 70% zoom (74% on a phone) cards become small tiles with an icon and a status ring. The camera goes out only as far as it takes to show the whole factory (on a desktop, the whole plot) with a margin, and never past 15%. Wiring still works there: ports show as dots.

---

## 8. Look & feel

- **Aesthetic:** dark "blueprint at night" canvas with a dot grid; materials glow in saturated neon. Nodes are rounded cards with an icon in a utilization ring and port dots. Think circuit-board-meets-lava-lamp.
- **Juice:**
  - Wire connect: the wire snaps on and thickens for a moment, the target flashes.
  - Market sale: `+¢` numbers float up.
  - Purchase: the node drops in with a squash.
  - Claim: coins fly to the credits counter.
  - Seven big moments get a color wash, a card, particles and a fanfare: first Glass, the Lab, first Copper, first Circuit, the first Flow State, first Screen, first Phone.
  - Flow State: the board's edge glows and the wires brighten.
- **Sound:** every cue is synthesised in the browser; there are no audio files. A sale's pitch follows its worth, and connections made in a run climb a scale. Cues are rate-limited and held under a fixed ceiling. There is a sound switch (top bar; gear menu on a phone), and short vibrations where the browser offers them. **Levels were checked by rendering the cues offline, not by ear.**
- **Zoom:** in to 200% (150% on a phone); out as far as the factory needs, at most to 15%. Fit frames the factory.
- **Reduced motion** is honoured: camera moves jump and effects only fade.

---

## 9. The goal chain (onboarding by doing)

One goal at a time, on a card: a title, a sentence or two, progress, and the reward.

**A card says what to bring about and why, not where to click.** The title is an outcome in the game's world ("Sell your Sand", "Turn Sand into Glass"), and the sentence under it is the why: "Two Sand sell for 2¢. Melted into one Glass they sell for 3¢. A Refiner does the melting." It names no gesture, so it is the same for a mouse and a finger. A goal about a recipe has it drawn on the card, and where several things are put together each input is ticked as it is wired in. A player who knows why a wire is wanted finds where it goes: the port without a wire pulses, and the machine says what it lacks. The gesture, worded for the pointer in use ("Drag from a Drill's port into empty space, let go, and pick Refiner."), is behind the card's **How?** button, and comes out by itself once the goal has been within reach for 20 seconds with the board left alone. Sent away with **Why?**, it does not come back on that goal. The how follows the board: with a Refiner already placed from the build bar and fed by nothing, it names the wire into it, not a second Refiner. *Whether a newcomer finds the first wire from the why alone, and whether 20 seconds is the right wait, has not been tried with a person.*
 A goal completes when its condition holds, at once if the player got there early, and then waits for one press on **Claim**. Rewards are credits, Data, techs and features. 22 goals lead to the first Phone (table in [CONTENT.md](./CONTENT.md#goal-chain)):

| Goals | The player… | Lesson, and what it unlocks |
|---|---|---|
| 1–3 | sells the Sand, digs up more, sells that too | wiring, the build bar, fan-in → Refining |
| 4–5 | turns Sand into Glass, sells the Glass | build-from-wire → the Lab ★ |
| 6–7 | speeds up a Drill, studies Glass in a Lab | the inspector, sell vs. study ★ |
| 8–11 | opens up the Oil deposit, turns Oil into Plastic, gives the Tar somewhere to go, makes and sells Copper | the tech tree, byproducts, a machine that is full → Orders ★ |
| 12–14 | fills an order, routes more to a Lab than to the Market, opens up more land | orders, the Router, expansion → Routing |
| 15–17 | makes a Circuit, holds 95% Flow for 10 seconds, studies Circuits for β | two inputs ★, Flow, Data tiers |
| 18–20 | makes Silicon, makes a Screen, speeds up every Drill at once | a cross-line recipe ★, Bulk Upgrade |
| 21–22 | builds a Fabricator, makes the first Phone | saving for a big buy; the end of the demo ★ |

★ = one of the big celebrations.

- Through goal 7 the rewards paid so far always cover the next purchase the card asks for.
- Every card that has the player make something new also says to sell it: in its title or its why, and in its how.
- Claiming a goal clears the undo history, so nothing that earned a reward can be taken back.
- The Flow goal cannot stall for good: after 90 seconds on the card, all but one producer flowing is enough; after 180, all but two; then one more every 120.
- A **guiding hand** acts out the first wire and the first build-from-wire when the player has done nothing for five seconds.

No text walls: a card is a title and a sentence or two.

### 9.1 While you wait, and the adviser

Several goals have a wait in them: Data to save for a research, credits for a machine.

- **Lines on the card.** Seven goals (11, 15, 16, 18, 19, 21, 22) carry up to three "while you wait" lines, shown one at a time ("While you wait · 1 of 2"). **Show me** acts the line's next step out on the board, and a done line is ticked. A line that was done before its goal came up is left out, and not counted. On goal 21 the line is a tune-up for the wait before the Fabricator: a level of Speed on the machine a Drill outruns, then a Refiner on a Drill that only feeds a Lab, its goods sold. Its words are its next step's own, each step is only on the card while it pays for itself before the Fabricator can be bought, and the line leaves when none does. On goal 22 the lines are the goal's own two wires and read "Next step". When the line's next step costs credits that the card's own purchase needs, the card says "Saving for this" with the price and about how long, instead of offering it.
- **The adviser.** While a goal is a wait, the adviser may offer one tip. Every candidate is tried on a copy of the game against an untouched copy, with the real rules. A tip is given only if it saves at least 15 seconds of the wait, ends a wait that would never end, or (on the Flow goal) gets the producer it names flowing. It keeps quiet for 20 seconds after any change to the board, never reverses a goal card, and does not repeat the card's line (one exception, on the Flow goal, is in CONTENT.md). It runs in a Web Worker.
- The lines carry the game; tips are rare. A scripted player who follows the cards is offered none in fifteen runs. One who ignores the lines is offered seven to ten.

### 9.2 The ending and free play

- **The first Phone ends the demo.** A pulse runs along the wires from the Drills to the Phone, a "First Phone" card comes up, and 6.5 seconds after the Phone a summary: the time to the first Phone, things built, the share of income from sales, orders filled, the longest Flow streak. Its buttons are Keep playing, Copy result and Start over. It ignores presses for its first 0.6 seconds.
- **Keep playing** starts free play: four more goals (Rubber, Cable, Laptop, Robot), γ Data from studying Phone, Long Absence in the tech tree, and pay for time away.

---

## 10. Technical: what was built

- **Platform:** the browser. A desktop layout for mouse and keyboard, and a phone layout for touch (under 700 px wide, or a short screen held sideways). Tested in headless Chromium only.
- **Stack:** TypeScript + Vite, with no framework and no rendering library. Node cards are DOM elements and wires are SVG paths. Everything that moves every frame (wire dots, particles) is drawn on canvases. Panels are HTML patched in place.
- **Workers:** the adviser and the Tidy layout each run in a Web Worker, so neither holds up a frame.
- **Architecture:**
  ```
  src/
    content.ts   materials, recipes, nodes, techs, and every tunable number (RULES)
    state.ts     the game state, save and load, undo snapshots
    sim.ts       the tick: production, transfers, status, selling, time away
    economy.ts   costs, prices, demand, tech rules
    flow.ts      Flow and Flow State
    flows.ts     the ledger behind the Flows panel: what is made of each material and where it goes
    orders.ts    orders
    goals.ts     the goal chain and its "while you wait" lines
    advice.ts    the adviser
    forecast.ts  copies of the game run ahead
    actions.ts   every change a player can make, all undoable
    ui/          board, panels, tech tree, goal card, phone layout, sound, celebrations
  tests/         rules, exploits, saves, the adviser, the pacing targets
  tools/         pacing.ts: the scripted players
  ```
- **Undo** keeps a snapshot of the board's structure and the credits spent for each step, up to 200.
- **Tests:** `npm test` runs 578 tests, among them the pacing targets on four order sequences. `npm run pacing` plays six scripted players and checks each run against the pacing targets.
- **Size and speed:** the shipped JavaScript and CSS are about 260 kB gzipped. Frame rates are in [PITCH_PLAN.md](./PITCH_PLAN.md#outcome).
- **Outside requests:** the page loads its typefaces from Google Fonts and shows system fonts until they arrive. Nothing else leaves the page.
- **Publishing:** `.github/workflows/deploy.yml` runs the tests and the build on every push to `main` and deploys the result to GitHub Pages.

---

## 11. What the pitch build contains

**In:** Drill, Refiner, Assembler, Fabricator, Router (Even/Ratio/Priority/Filter), Merger, Silo, Market, Lab, Dump · 16 materials and 11 recipes, T0–T3 · the tech tree of 29 · deposits and board expansion · node upgrades · wire tiers · 22 goals and four free-play goals · orders · Flow · "while you wait" lines and the adviser · the gestures of §7.1 · saving and time away · the phone layout · sound · celebrations · the overview · Tidy · real-world materials with a why-and-how goal card · plain-word labels and the Flows panel · cards that come level · a first screen that starts with a Drill and a Market.

**Not built:** prestige ("Reflow"), timed contracts, box-select and copy/paste, named groups round a line, a layout that sets cards in rows, blueprints, achievements, events/modifiers, T4+ content, export and import of saves, accounts.

---

## 12. Open questions

Settled by the build:

1. **Interface progression.** Parts of the interface appear when the goals reach them: the Tech tree button with the Lab, the order chip with Orders, the Flow ring with the Flow meter, Expand at goal 14, build-bar slots as their nodes unlock. There is no third system. The first screen holds only what the first goal needs, a Drill, a Market and the card: the build bar's slots, Undo and Redo, the zoom buttons, the row of keys, the minimap, the Flows button and the plot's label each arrive with the goal that first gives them a use, and until the Lab a locked deposit is an outline with a lock (`src/ui/reveal.ts` has the list). A save that is further on shows all it has reached.
2. **Two currencies.** Credits and Data, with Data in three kinds.
3. **Board constraint.** Deposits, and expansions bought one strip at a time.
4. **Platform.** Browser, with a phone layout and touch controls built.

Still open:

1. **The waits.** A player who claims at once has nothing to do for about a third of the run (§6.5). Only real players can say whether that hurts.
2. **Real players and real devices.** No first-time player has been watched. Nothing has run on a real phone, in Safari or in Firefox, and nobody has heard the sound.
3. **After the demo.** Free play is four goals, and a fast scripted player has made the last of them, the Robot, by minute 24 to 27. What holds a player for hours is not designed.
4. **Prestige.** Not designed. The numbers are tuned for the demo alone.
5. **Demand.** A scripted player who follows the cards never sells over demand before the first Phone, so for that player the Commerce branch is free-play content. Whether demand should bite sooner is undecided.
