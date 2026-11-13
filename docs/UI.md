# Flowstate — UI Spec (v0.1)

Visual mockups: **[Flowstate UI canvas](https://claude.ai/artifact/HS1Kbgr7TKuNz9xPjpJ7Pg)** (4 artboards: main screen, tech tree, build-from-wire menu, components & states). This doc is the written companion: layout, behaviors and tokens an implementation needs.

---

## 1. Principles

1. **The canvas is the hero.** ~73% of a 1440×900 screen. All chrome hugs the edges and nothing floats over the middle of the board except transient things (radial menu, toasts).
2. **Quiet when healthy, loud when broken.** Working nodes show only a green ring. Problems get a ring color + a pill + a word. Only the *root cause* of a problem gets a pill; nodes upstream that are merely backed up just turn their ring amber.
3. **Every problem comes with its fix.** The inspector's status block always offers a one-click action ("Upgrade source · 5¢", "Jump to source").
4. **Never colour alone.** Materials = colour + shape. Status = colour + icon + word.
5. **Show progress toward every price.** Buy buttons and hotbar slots fill up as you save, so "almost affordable" reads without numbers.

---

## 2. Main screen layout (1440 × 900)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ logo │ ¢ 1,284 +3.3/s │ α 186 │ β 12 │ γ (locked)      undo redo ⏸ │ Tech tree [5 ready] R │ ⚙ │  56px
├────┬──────────────────────────────────────────────────────┬──────────────┤
│ 1  │                      [toast]                         │  INSPECTOR   │
│ 2  │                                                      │  header      │
│ 3  │                 B O A R D   (pan / zoom)             │  status+fix  │
│ …  │                                                      │  recipe      │
│ 9  │                                                      │  flow bars   │
│    │                  [ + Expand board 2,420¢ ]   zoom    │  upgrades    │
│ 🗑 │  hints                                      minimap  │  dup │ delete│
└────┴──────────────────────────────────────────────────────┴──────────────┘
 72px                         1048px                           320px
```

| Region | Contents | Notes |
|---|---|---|
| **Top bar** | Logo · Credits (with income/s) · Data α β γ (with rate/s; unearned tiers dashed with a hint) · Undo/Redo · Pause · **Tech tree** button with "N ready" badge · Settings | Currency pills are the two progression systems at a glance. |
| **Hotbar** (left) | Nodes on keys 1–9 with live price · trash drop-target at bottom | Unaffordable = dimmed and filling from below; locked = dashed with tech cost. |
| **Board** | Dot grid, plot boundary (dashed), nodes, wires, rate chips, empty deposits, "Expand board" tile, gesture hints, zoom + minimap | Minimap shows node status colours, so a red dot is findable from anywhere. |
| **Inspector** (right) | Only when something is selected. Header · status block with fix · recipe chips + Change · flow bars (have / need) + 60s utilization · upgrade tracks · Duplicate / Delete (shows full refund) | Collapses away when nothing is selected, giving the board the full width. |

### Board elements

- **Node card**: utilization ring around the output material's glyph; title; recipe in words; rate + utilization in mono. Ports are 12px dots in the material's colour on the card edges.
- **Status pill** (top-right of card): `BLOCKED` (amber, pause icon), `STARVED` (red, ! icon), `IDLE` (grey, dashed card). No pill when working.
- **Wire**: bezier. Base stroke at 30% opacity, width ∝ throughput, plus animated dots in the material colour. Saturated = glow; stalled = dashed and still; mixed = alternating dot colours.
- **Rate chip** on each wire's midpoint (`0.40/s`). Hidden below 60% zoom; replaced by heat tint.
- **Floating gains** above Markets / Labs (`+20.6¢`, `+5β`): rise 24px, fade over 0.8s.
- **Toast** (top centre of board): the single worst bottleneck, with **Jump**. Max one at a time.

---

## 3. Build-from-wire radial menu

Triggered by dragging from any port and releasing on empty board.

- Centre hub shows the material + rate being dragged.
- Up to **5 slots** on a 150px radius, at −120°, −60°, 0°, 60°, 120° relative to the drag direction. The slice the wire comes *from* stays empty so the menu never covers the wire.
- Slot = icon, name, verb + price ("sell · 0.5¢", "destroy · free", "split · 25¢"). Number key 1–5 in the corner.
- **Best fit** is pre-highlighted (slot 1): the cheapest consumer that resolves the current block, or the highest-value recipe otherwise.
- Locked options still show, dashed, with the tech + cost, which teaches what's coming.
- Pick → node is placed at the release point, wired, recipe set. Zero further clicks.
- Dragging from an **input** port shows *producers* instead.

Related gestures (always available, never gated): drop node on wire → splice; drag from wire middle → branch; Shift-drag → knife cut; Ctrl+Z → undo with credit restore.

---

## 4. Tech tree screen

Full overlay (`R` to open, `Esc` to close); top bar stays, credits dim, Data pills highlight.

- **Five horizontal lanes** (Processing, Logistics, Commerce, Research, Scale tools), each with "owned / total". Read left → right by prerequisite depth.
- **Tile states**: Owned (filled, check) · **Ready** (mint border + glow, "ready") · Saving up (progress bar along bottom + ETA) · Locked (dashed, lock + cost).
- Edges: owned→owned muted solid, →ready mint, →locked dashed.
- **Detail panel** (right): branch tag, name, one-sentence purpose tied to the player's current pain ("…the byproduct clogging your Ink line"), unlocks as real recipe chips with NEW tags, requirements with checks, per-currency cost bars with ETA, **Research automatically when affordable** checkbox, primary button.
- Click = details, double-click = research, Q = queue.

---

## 5. Tokens

| Token | Value | Use |
|---|---|---|
| canvas | `#0B0F17` | Board background (dot grid `#1B2436`, 24px) |
| chrome | `#0E1320` | Top bar, hotbar, panels |
| node | `#131A2A` | Node cards |
| border | `#27324A` | Default borders |
| text / muted | `#E6EBF5` / `#94A0B8` | |
| select | `#7AA2FF` | Selection outline, focus, primary info |
| credits | `#FFC857` | ¢, buy buttons |
| data α / β / γ | `#5EEAD4` / `#C4A1FF` / `#FF8FB1` | Research currencies |
| working / blocked / starved / idle | `#4ADE80` / `#FBBF24` / `#F87171` / `#64748B` | Always paired with icon + word |

Type: **Space Grotesk** (display, 18–30px), **Inter** (UI, 11–15px), **JetBrains Mono** (every number, tabular).

Material colours and shapes: see the Components artboard and [CONTENT.md](./CONTENT.md#materials).

---

## 6. Open UI questions

1. Should the inspector **dock** (as drawn) or **float** next to the selected node? Docked is steadier; floating keeps eyes on the board.
2. Hotbar on the **left** (as drawn, like a tool palette) or **bottom** (like a game hotbar)?
3. Tech tree as a full overlay (as drawn) or a slide-up drawer that keeps half the board visible?
