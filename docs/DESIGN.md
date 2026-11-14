# Flowstate — Game Design Document

> An incremental game about building and tuning a *theoretical supply line*: draw wires between nodes, turn strange raw materials into ever-stranger products, sell them for credits, and research your way to bigger, cleaner, faster flows.

Status: **draft v0.1**. Content numbers live in [CONTENT.md](./CONTENT.md).

---

## 1. Pillars

Every design decision should serve one of these. If it serves none, cut it.

1. **Wiring is the toy.** Connecting nodes must feel as good as popping bubble wrap: snappy, forgiving, instantly readable. The player should never fight the editor.
2. **The flow tells you what's wrong.** You never need a spreadsheet. Starved, blocked and idle nodes are visible at a glance, and every wire shows its rate.
3. **Experimenting is free.** Deleting, moving and rewiring cost nothing (100% refunds, unlimited undo). The only "cost" of a bad layout is lost time — which makes optimization a choice, not a punishment.
4. **Always a next number.** Classic incremental loop: there's always something affordable within the next ~30–90 seconds early on, stretching to a few minutes later.

---

## 2. Core loop

```
 ┌──────────────┐   items   ┌──────────────┐  credits  ┌─────────────────────┐
 │ Build / wire │ ────────▶ │  Flow runs   │ ────────▶ │ Buy & upgrade nodes │──┐
 └──────────────┘           │ (sell / lab) │   data    │ Research tech       │  │
        ▲                   └──────────────┘ ────────▶ └─────────────────────┘  │
        └──────────────── new nodes, recipes, splitter modes, space ◀──────────┘
```

- **Seconds:** watch items move, see `+credits` pop at the Market, spot a red node, fix it.
- **Minutes:** save up for the next node/upgrade; rebalance a chain after an upgrade shifted the ratios.
- **Hours:** climb tiers of materials, unlock new node types, expand the board, chase the next tech.

---

## 3. The two progression systems

The game ships with exactly two progression systems, each with **its own currency** so they don't cannibalize each other and so the player has a meaningful routing decision: *sell it or study it?*

| | **Board** (the interface you build on) | **Tech Tree** |
|---|---|---|
| Currency | **Credits** ¢ — earned by selling at Markets | **Data** — earned by feeding items to a Lab |
| Answers | "How *much* can I build?" | "What *kinds* of things can I build?" |
| Buys | Nodes, node upgrades, pipe tiers, board space | Materials, recipes, node types, router modes, scale tools |
| Curve | Exponential per-type costs (endless) | Finite, hand-authored tree (~30 nodes for MVP) |

### 3.1 Board progression (credits)

The board is the canvas the player builds on. It starts small and grows.

- **Buying nodes.** Each node type has its own escalating price: `cost = base × 1.15^owned`. Deleting a node refunds what you paid for *that* node (no buy/sell exploit, because the next purchase still costs the escalated price).
- **Upgrading nodes.** Each node has 2–3 upgrade tracks, levels cost `base × 1.6^level`:
  - **Speed** — −15% cycle time per level (processors) / +25% rate (wells).
  - **Efficiency** — every N-th cycle consumes no input (processors, unlocked mid-game).
  - **Buffer** — larger internal storage, smooths bursty supply.
- **Pipe tiers.** Wires have capacity. Upgrading a wire costs credits once its tier is researched. One-click *"Upgrade all saturated pipes"* button keeps this frictionless.
- **Board space.** The board is a grid of *plots*. You start with a 3×3 plot area; buying adjacent plots expands it. New plots can reveal **Deposits** (the only places Wells can go) — this is the hard constraint that keeps raw input scarce and makes optimization matter.

### 3.2 Tech tree (data)

A hand-authored tree with five branches (full list in [CONTENT.md](./CONTENT.md#tech-tree)):

- **Processing** — new materials, recipes and machine classes.
- **Logistics** — router modes (ratio, priority, overflow, filter), pipe tiers, silos.
- **Commerce** — market info, contracts, more demand.
- **Research** — better Labs, Data tiers.
- **Scale tools** — blueprints, bulk upgrades, auto-balance.

**Data is tiered.** A Lab turns any item into Data of that item's tier (T1 item → T1 Data). Higher techs require higher-tier Data, so you can't skip a tier by grinding raw Glint. This is the natural "gate" that pushes the player up the material chain.

> **Rule:** the tech tree never gates *basic editing comfort*. Dragging, cutting, undo, multi-select, copy/paste, fan-out wiring and rate labels are available from minute one. Only tools that matter at *scale* (blueprints, bulk ops, auto-balance) are unlocks.

---

## 4. World model

### 4.1 Materials

Fictional, tiered, each with a **color + shape** pair (shape so it's colorblind-safe):

- **T0 raw** come from Wells on Deposits: *Glint* ◆, *Murk* ●, *Ember* ▲, *Breeze* ≈
- **T1 refined**, **T2 assembled**, **T3 fabricated** … each tier roughly doubles value-per-input.
- Some recipes produce **byproducts** (e.g. refining Murk yields Ink + Silt). Byproducts are the main reason splitters, filters and sinks exist — they create plumbing puzzles.

### 4.2 Node types

| Node | Ports | Behavior |
|---|---|---|
| **Well** | 0 in → 1 out | Placed on a Deposit; emits that raw material at a rate. |
| **Refiner** | 1 in → 1–2 out | Single-input recipes. |
| **Assembler** | 2 in → 1–2 out | Two-input recipes. |
| **Fabricator** | 3 in → 1 out | Three-input recipes (T3). |
| **Router** | 1 in → N out | Splitter with modes: Even, Ratio, Priority/Overflow, Filter. |
| **Merger** | N in → 1 out | Fair (round-robin) or Priority. |
| **Silo** | 1 in → 1 out | Big buffer. Smooths bursts, shows fill level. |
| **Market** | N in → 0 out | Sells anything for credits; prices saturate (see §6). |
| **Lab** | N in → 0 out | Consumes items, produces tiered Data. |
| **Void** | N in → 0 out | Destroys items. Free. The "I just need this byproduct gone" button. |

### 4.3 Wires and ports — "1 or more to 1 or more"

- Any **output port can fan out** to several wires: it behaves as an *Even* splitter that skips blocked outputs.
- Any **input port can fan in** from several wires: it behaves as a *fair* merger.
- Explicit **Router / Merger** nodes exist for *non-default behavior* (ratios, priority, overflow, filtering). This keeps the simple case zero-effort while leaving depth for optimizers.
- A wire carries whatever its source emits. Merging different materials onto one wire creates a **mixed stream** — legal: machines pull only what their recipe needs, and anything nobody takes backs up to its own source without blocking the other materials. Filter Routers (tech) sort a mixed stream back out.

---

## 5. Simulation

Kept deliberately simple, deterministic and headless so it can be unit-tested and fast-forwarded for offline progress.

- **Fixed tick:** 20 ticks/sec. Rendering interpolates.
- **Buffers, not belts.** Each node has small per-material input buffers and an output buffer (default capacity ≈ 2 crafting cycles). Items are integers in buffers; wires move items from an output buffer to a downstream input buffer, limited by `capacity × dt` (with fractional carry).
- **Backpressure emerges naturally:** if a downstream buffer is full, the wire stalls, the upstream output fills, the upstream machine stops.
- **Node status** is derived each tick and drives all the visual feedback:
  - 🟢 **Working** — crafting.
  - 🟡 **Blocked** — output full (downstream can't keep up).
  - 🔴 **Starved** — missing an input.
  - ⚪ **Idle** — no recipe / not connected.
- **Utilization** = rolling % of time Working. Shown as the ring around each node.
- **Offline progress:** on load, run the sim headless in large steps (or solve steady-state rates) for elapsed time, capped at 2h (raised by tech). Show a "While you were away" summary.

---

## 6. Economy

- **Market saturation.** Each material's sell price drops as you flood it:
  `price = baseValue × 1 / (1 + sellRate / demand)` where `demand` is per-material and slowly grows over time / via Commerce tech.
  Effect: spamming one product hits diminishing returns, so diversifying and climbing tiers is always the better move. The Market node shows a small price-vs-rate gauge for each material it's receiving.
- **Sell vs. study.** Every item can go to a Market (credits) or a Lab (Data). Routing that split is the player's core strategic dial.
- **Contracts** (Commerce tech): "Deliver 3.0 Glyph/s for 2 minutes → 5,000¢ + T2 Data". Gives short-term goals and rewards building a *stable* throughput, not just a big one.
- **Milestones:** first time producing each material gives a one-time reward and a little fanfare. Doubles as the tutorial for each new material.

Target pacing (to tune via playtest):

| Time played | Expected state |
|---|---|
| 0:30 | First extra Well bought. |
| 2:00 | First Refiner; first fan-out split. |
| 5:00 | First Lab, first tech purchased. |
| 20:00 | T2 materials, routers with ratios. |
| 1:30:00 | T3 (Lens), filter routers, contracts. |
| 3–5h | MVP content exhausted → prestige hook (post-MVP). |

---

## 7. Frictionless building — the interaction spec

This is the most important section. The editor *is* the game.

### 7.1 Gestures

| Action | Gesture |
|---|---|
| Connect | Drag from a port to a port. Port snaps within a generous radius (~24px). Incompatible ports dim while dragging. |
| **Build-from-wire** | Drag from a port into empty space and release → **radial menu** of everything that can consume (or produce, if dragging from an input) that material. Pick one → node is placed *and* wired, recipe pre-selected. This is the #1 frictionless feature. |
| Splice | Drop a node onto an existing wire → it's inserted inline (if ports fit). |
| Branch | Drag from the *middle of a wire* → creates a fan-out branch from that wire's source. |
| Cut | Hold `Shift` (or right-drag) and swipe across wires → knife cuts them. |
| Move | Drag node. Box-select + drag moves groups. Snap to grid, toggle with `Alt`. |
| Delete | `Del` / drag to trash. Always full refund. |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z`, unlimited for the session, also restores credits. |
| Copy / paste | `Ctrl+C` / `Ctrl+V` a selection, including wires and upgrades; paste shows total cost ghosted before confirming. |
| Quick-build | Number keys `1–9` hotbar; node attaches to cursor, click to place. |
| Inspect | Hover a node → tooltip with recipe, in/out rates, status reason ("Needs 2.0 Glint/s, receiving 1.3/s"). |

### 7.2 Auto-behaviors

- **Auto-recipe:** when a machine's first input is connected and only one recipe fits, it's selected automatically.
- **Ratio hint:** while placing a machine, a ghost label shows "needs 2.0/s Glint · 1.4/s spare upstream".
- **Smart even split:** fan-out skips blocked outputs instead of stalling the whole branch.
- **Auto-tidy** (`T`): re-routes wire curves to avoid overlapping nodes. Never moves nodes without asking.

### 7.3 Readability

- **Wires** are smooth bezier curves. **Thickness ∝ throughput**, **particles** flow along them in the material's color/shape, spaced by rate. A saturated wire glows; a stalled one turns dashed and still.
- **Rate labels** on every wire (`1.2/s`), hidden when zoomed out, replaced by a heatmap tint.
- **Node rings** show utilization; status color is unmistakable.
- **Bottleneck pulse:** the single worst bottleneck in the network gets a gentle pulse + a toast ("Refiner #3 is starved of Glint"). Click the toast to jump there.

---

## 8. Look & feel

- **Aesthetic:** dark, slightly grainy "blueprint at night" canvas; materials glow in saturated neon. Nodes are rounded cards with an icon, a utilization ring and port dots. Think circuit-board-meets-lava-lamp.
- **Juice:**
  - Wire connect: elastic snap + soft *plink*, first particles race down the wire.
  - Market sale: `+¢` numbers float up, coin-stack tick sound with pitch rising during combos.
  - Purchase: node drops in with a squash-and-stretch.
  - Tech unlock: the new node/recipe flies from the tech tree into the hotbar.
  - Milestone: brief full-screen color wash in the new material's color.
- **Sound:** soft, musical, pentatonic so overlapping events never clash. Each material has its own note; a busy factory becomes ambient music.
- **Zoom:** smooth from a single node to the whole board. Zoomed out, the board reads as a glowing river map.

---

## 9. First five minutes (onboarding by doing)

1. Board shows one **Glint Well** and one **Market**, unconnected. A pulsing port says "drag me". Player connects → particles flow → `+1¢` pops. *(Lesson: wiring.)*
2. At 10¢: "Buy another Well" glows. Player buys it, drags it to the Market → two wires fan-in. *(Lesson: fan-in.)*
3. At 50¢: **Refiner** unlocks (free starter tech). Player drags from a Well into empty space → radial menu → Refiner (Shard). Shard sells for more. *(Lesson: build-from-wire.)*
4. Refiner is starved (needs 2 Glint/s). Status ring turns red, tooltip explains. Player upgrades Well speed. *(Lesson: ratios & status.)*
5. Lab unlocks. Player fans out Shard to Market + Lab → first Data → opens Tech Tree. *(Lesson: sell vs. study.)*

No text walls; one sentence per step, attached to the thing it describes.

---

## 10. Technical direction (proposal)

- **Platform:** browser first (desktop, mouse + keyboard). Touch later.
- **Stack:** TypeScript + Vite. Rendering with **PixiJS** (WebGL — needed for thousands of flowing particles). Panels (tech tree, inspector, shop) in a light DOM layer (Preact or Svelte).
- **Architecture:**
  ```
  src/
    content/   materials, recipes, nodes, techs — plain data (TS/JSON)
    sim/       pure, deterministic, no DOM. tick(state, dt) → state
    economy/   prices, costs, saturation
    editor/    gestures, selection, undo stack (command pattern)
    render/    Pixi scene: nodes, wires, particles
    ui/        panels, tooltips, toasts
    save/      versioned JSON → localStorage, export/import string
  ```
- **Undo** via command pattern over the graph (AddNode, Connect, Upgrade…), each command carries its credit delta.
- **Tests:** sim and economy are unit-tested headless (ratios, backpressure, saturation, offline catch-up).

---

## 11. MVP scope

**In:** Wells, Refiner, Assembler, Fabricator, Router (Even/Ratio/Priority/Filter), Merger, Silo, Market, Lab, Void · materials T0–T3 from CONTENT.md · full tech tree v1 · board plots & deposits · node upgrades · pipe tiers · all §7 gestures · saving + offline progress · milestones.

**Out (later):** prestige ("Reflow"), contracts v2, touch controls, achievements, blueprints library sharing, events/modifiers, T4+ content.

---

## 12. Open questions

1. **Interface progression** — this doc reads "the actual interface" as *the board* (space, nodes, upgrades). Did you instead mean the *UI itself* unlocks over time (e.g. the stats panel, inspector, minimap appear as you progress)? That could be layered on as a third, diegetic system.
2. **Two currencies (Credits + Data) vs. one?** Two keeps the systems separate and creates the sell-vs-study decision; one is simpler to read.
3. **Board constraint:** deposits + plots (proposed) vs. a global node/power cap vs. no hard cap (cost curves only).
4. **Prestige:** should we design the reset loop now so MVP numbers anticipate it, or tune MVP standalone first?
5. **Platform:** browser-first OK, or is mobile/touch a day-one target? (It changes the gesture set a lot.)
