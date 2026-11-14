# Flowstate — Content & Numbers

Every number in the pitch build, as tuned with the pacing bot (`npm run pacing`). The source of truth is the code: tables and `RULES` in `src/content.ts`, goals in `src/goals.ts`, the adviser's own tunables in `ADVICE` (`src/advice.ts`). The rules these numbers plug into are in [PITCH_PLAN.md](./PITCH_PLAN.md) section 2, as amended by the decisions noted below (fan-out, Flow, orders, the adviser). `DESIGN.md` and `README.md` still describe the older build.

**State of the tuning:** the rules below are in; the prices have not been retuned for them yet. The last section says where the pacing stands and what is known to miss.

## Materials

| Material | Tier | Value ¢ | Demand /s | Made by |
|---|---|---|---|---|
| Glint | T0 | 1 | 2.0 | Well |
| Murk | T0 | 1 | 2.0 | Well (Murk Deposits) |
| Ember | T0 | 2 | 1.5 | Well (Ember Deposits) |
| Breeze | T0 | 2 | 1.5 | Well (Breeze Deposits) |
| Shard | T1 | 3 | 1.5 | Refiner |
| Ink | T1 | 4 | 1.2 | Refiner |
| Silt | T1 | 0.5 | 0.5 | Refiner (byproduct of Ink) |
| Spark | T1 | 6 | 1.0 | Refiner |
| Mist | T1 | 6 | 1.0 | Refiner |
| Clay | T1 | 3 | 0.8 | Refiner |
| Prism | T2 | 24 | 0.6 | Assembler |
| Glyph | T2 | 20 | 0.6 | Assembler |
| Coil | T2 | 22 | 0.5 | Assembler |
| Lens | T3 | 130 | 0.25 | Fabricator (ends the demo) |
| Dynamo | T3 | 180 | 0.2 | Fabricator |
| Paradox | T3 | 750 | 0.1 | Fabricator |

**Demand: two prices.** Markets buy each material at full price up to its demand rate; anything beyond that sells at a flat 25%. Unused demand is banked for 8 seconds (at least one item), so a machine that delivers whole items in bursts is still paid in full. Wider Demand multiplies every demand rate by 1.5, Exports by 2; Luxury Buyers adds 25% to the value of T2 and T3.

The first time a material keeps selling over its demand for 3 seconds, the game sets `seenSurplus` (saved) and raises a one-off `surplus` event naming it, so the demand gauge can be introduced when the rule first bites. In the bots' runs and for the scripted newcomer (with or without tips) nothing sells over demand before the first Lens; it happens once enough raw Glint is sold, typically from a third Glint Well.

## Recipes

| Recipe | Machine | Inputs | Outputs | Time | Tech |
|---|---|---|---|---|---|
| Shard | Refiner | 2 Glint | 1 Shard | 2 s | Refining |
| Ink | Refiner | 2 Murk | 1 Ink + 1 Silt | 2 s | Murk Deposits |
| Spark | Refiner | 2 Ember | 1 Spark | 2 s | Ember Deposits |
| Mist | Refiner | 2 Breeze | 1 Mist | 2 s | Breeze Deposits |
| Clay | Refiner | 3 Silt | 1 Clay | 3 s | Reclamation |
| Glyph | Assembler | 1 Ink + 1 Spark | 1 Glyph | 3 s | Assembly |
| Prism | Assembler | 2 Shard + 1 Mist | 1 Prism | 4 s | Breeze Deposits |
| Coil | Assembler | 1 Spark + 2 Clay | 1 Coil | 4 s | Reclamation |
| Lens | Fabricator | 1 Prism + 2 Glyph | 1 Lens | 6 s | Fabrication |
| Dynamo | Fabricator | 2 Coil + 1 Glyph + 1 Prism | 1 Dynamo | 8 s | Dynamo |
| Paradox | Fabricator | 1 Lens + 1 Dynamo + 4 Breeze | 1 Paradox | 12 s | Paradox |

## Nodes

The nth node of a type costs `base × growth^(n-1)`, rounded. Deleting a node refunds what it would cost to buy back, plus its upgrades.

| Node | Base ¢ | Growth | Needs | Rate |
|---|---|---|---|---|
| Well | 10 | ×1.15 | a free deposit | 1.0/s (Ember, Breeze: 0.8/s) |
| Refiner | 50 | ×1.15 | Refining | one craft per recipe time |
| Assembler | 600 | ×1.15 | Assembly | one craft per recipe time |
| Fabricator | 7,800 | ×1.15 | Fabrication | one craft per recipe time |
| Router | 25 | ×1.10 | Routing | splits evenly, by ratio, by priority or by filter |
| Merger | 25 | ×1.10 | Merger | — |
| Silo | 200 | ×1.20 | Silo | holds 200 items |
| Market | first free, then 150 | ×1.50 | — | sells anything |
| Lab | 100 | ×1.30 | Lab | studies 1 item/s (2 with Lab Speed) |
| Void | free | — | Murk Deposits | destroys anything |

**Fan-out: machines are fed first; what is left goes on to selling and study.** When one port feeds several wires, machines are served first, evenly. A Router, Merger or Silo counts as a machine when some path from it leads to one; a junction whose every path ends at Markets, Labs, Voids or nowhere waits with the Markets, Labs and Voids, and they share what is left. (So the Router to a Lab and a Market that goal 13 asks for never takes from an Assembler on the same port.) A Router follows its own mode, and its Even mode is truly even. `RULES.fanOut.deadEndJunctionsLast` switches the junction clause off for what-if runs.

**Favour** is the one-press Router preset: `favour(g, routerId, wireId)` puts the Router in Ratio mode weighted 3 : 1 toward that wire (`RULES.router`), as one undo step.

### Upgrades

Level L of a track costs `first level × 1.6^(L-1)`, rounded.

| | Speed, first level ¢ | then | Efficiency ¢ | Buffer ¢ |
|---|---|---|---|---|
| Well | 50 | 80, 128, 205… | — | — |
| Refiner | 32 | 51, 82, 131… | 75 | 20 |
| Assembler | 100 | 160, 256… | 300 | 80 |
| Fabricator | 400 | 640, 1,024… | 1,200 | 320 |
| Lab | 50 | 80, 128… | — | — |
| Silo | — | — | — | 80 |

- **Speed:** +25% per level for a Well or Lab, −15% craft time for a machine. Cap 10 levels (25 with Overclock).
- **Efficiency** (needs Efficiency Tuning): every 6th, then 5th, 4th, 3rd craft uses no inputs. Cap 4.
- **Buffer:** +100% internal storage per level. Cap 5.

Speed is priced so that a first or second level pays for itself in one to three minutes when the extra input exists: 83–171 s for a Well whose output is refined, 60–164 s for a machine whose input was backing up. If that input was selling at full price instead, a machine takes two to three times as long.

### Wires

| Tier | Carries | Upgrade ¢ per wire | Tech |
|---|---|---|---|
| Mk I | 4/s | — | — |
| Mk II | 8/s | 20 | Pipes Mk II |
| Mk III | 16/s | 300 | Pipes Mk III |
| Mk IV | 32/s | 4,000 | Pipes Mk IV |

A wire's capacity is items per second averaged over one second (`RULES.wires.burstSeconds`), so a machine that hands over whole items still feeds the next machine first.

The rate shown on a wire (`wire.rate`) is display only. Steady flow is smoothed over 1.5 s. Flow that comes in gulps (a machine taking two inputs per craft, a Refiner handing over one item) is measured from one start of flow to the next, over one whole round of its pattern, so the number is exact and does not flicker; it lets go when the next gulp is overdue (`RULES.wires.rate`).

### Board

Five deposits at the start: 2 Glint, Murk, Ember, Breeze. Expansion n costs `200 × 2.5^(n-1)`: 200, 500, 1,250, 3,125, 7,813… Each reveals two or three deposits from a fixed cycle: Glint + Murk, Ember + Glint, Breeze + Murk, Glint + Ember, Breeze + Glint, Murk + Ember + Breeze.

## Data

A Lab turns each item into Data by tier: T0 → 1 α, T1 → 3 α, T2 → 5 β, T3 → 8 γ (×1.5 with Deep Analysis). One β is worth 4 α and one γ 12 α when an order's pay is converted.

## Flow

Wells and machines count once they are at least 20 s old and some path of wires leads from them to a Market or a Lab (six Wells into a Void are not a supply line); one is *flowing* at 90% utilisation or more. Cutting a weak producer off still hides it, at the price of everything it made. Flow is the flowing share, smoothed over 3 s. Once the goal chain unlocks the meter, every sale is multiplied by `1 + 0.2 × Flow`. 100% for 10 s with six or more producers is Flow State.

## Orders

Unlocked by the Spark goal. One order at a time: "deliver N of X", counted from sales at any Market, no timer.

- **X:** something refined that the player makes right now. What reaches a Market comes first, then what does not; within each, the newest first. The first, second and third on that list are picked with chances 55 / 30 / 15%, never the same material twice running.
- **N:** 45–90 s of what currently reaches Markets of that material (not of what is made), at least 8. "Currently reaches" is measured on a copy of the game run forward for 40 s (`src/forecast.ts`), so a line built a moment ago counts for what it will sell.
- **The first order** (until one has been filled) only asks for something already selling, sized to 32–37 s of it, at least 3: it counts from the moment it appears and fills in 30–40 s with nothing rerouted.
- **Reaching no Market:** an order can ask for something the player makes but does not sell (N is then 8). `orderView(g).reachesMarket` is false, with `rate` and `eta` beside it, and the adviser says where to reroute.
- **Pay:** credits worth half the items at full price, plus the Data a Lab would have made from them, paid in the tier the player is shortest of.
- An order with no delivery for 120 s is quietly replaced.

## Goal chain

One goal at a time; a finished goal waits for Claim. Rewards are the only source of Refining, Lab, Routing, Market Lens, Bulk Upgrade, Orders and the Flow meter. Through goal 7 the credits paid so far always cover the next purchase the card asks for.

| # | Goal | Reward |
|---|---|---|
| 1 | Wire the Well to the Market | 12¢ |
| 2 | Place a second Well | 10¢ |
| 3 | Wire it to the Market too | Refining + 50¢ |
| 4 | Build a Refiner from a Well's port | 20¢ |
| 5 | Sell your first Shard | Lab + 70¢ ★ |
| 6 | Upgrade a Well | 50¢ |
| 7 | Build a Lab and feed it | 15α ★ |
| 8 | Research Murk Deposits | 40¢ |
| 9 | Refine Murk into Ink | 40¢ |
| 10 | Give the Silt somewhere to go | 20α |
| 11 | Make your first Spark | Orders + 25α |
| 12 | Fill your first order | Routing + Market Lens |
| 13 | Route more to a Lab than to the Market (one press of Favour on the Lab's wire) | 30α |
| 14 | Expand the board | 60¢ |
| 15 | Assemble your first Glyph | Flow meter + 300¢ ★ |
| 16 | Hold 75% Flow for 10 seconds | 300¢ |
| 17 | Study Glyph for β (10 β) | 50α |
| 18 | Make your first Mist | 50α |
| 19 | Assemble your first Prism | 600¢ + 40β |
| 20 | Fill three orders | Bulk Upgrade + 1,200¢ + 60β |
| 21 | Build a Fabricator | 40β |
| 22 | Make your first Lens | demo complete ★ |
| free play | Clay · Coil · Dynamo · Paradox | 200¢ · 600¢ · 1,800¢ · 7,500¢ |

★ = big celebration; the fifth is the first Flow State.

## Tech tree

| ID | Tech | Cost | Requires | Gives |
|---|---|---|---|---|
| **Processing** | | | | |
| P1 | Refining | goal 3 | — | Refiner, Shard |
| P2 | Murk Deposits | 45α | Lab | Murk Wells, Ink + Silt, Void |
| P3 | Ember Deposits | 180α | P2 | Ember Wells, Spark |
| P4 | Assembly | 800α | P3 | Assembler, Glyph |
| P5 | Breeze Deposits | 850α | P4 | Breeze Wells, Mist, Prism |
| P7 | Fabrication | 700α + 100β | P5 | Fabricator, Lens |
| P6 | Reclamation | 300α + 25γ | P4 | Clay, Coil |
| P8 | Dynamo | 1,200α + 300β + 100γ | P6, P7 | Dynamo |
| P9 | Paradox | 2,500α + 500β + 450γ | P8 | Paradox |
| U1 | Efficiency Tuning | 40β | P1 | Efficiency upgrades |
| U2 | Overclock | 60γ | U1 | Speed cap 10 → 25 |
| **Logistics** | | | | |
| L1 | Routing | goal 12 | Lab | Router, Ratio mode |
| L2 | Merger | 40α | L1 | Merger |
| L3 | Pipes Mk II | 60α | L1 | 8/s wires |
| L4 | Priority Routing | 20β | L1 | Router Priority mode |
| L5 | Silo | 15β | L2 | Silo |
| L6 | Filter Routing | 30β | L4 | Router Filter mode |
| L7 | Pipes Mk III | 60β | L3 | 16/s wires |
| L8 | Pipes Mk IV | 150γ | L7 | 32/s wires |
| **Commerce** | | | | |
| C1 | Market Lens | goal 12 | Lab | price gauges on Markets |
| C2 | Wider Demand | 200α | C1 | +50% demand |
| C4 | Luxury Buyers | 300β | C2 | +25% value on T2 and T3 |
| C5 | Exports | 80γ | C4 | +100% demand |
| **Research** | | | | |
| R1 | Lab | goal 5 | — | Lab, tech tree |
| R2 | Lab Speed | 50α | R1 | Labs study 2 items/s |
| R3 | Deep Analysis | 80β | R2 | +50% Data per item |
| R4 | Long Absence | 210α, hidden until the demo ends | R1 | time away capped at 8 h instead of 2 h |
| **Scale tools** | | | | |
| S1 | Bulk Upgrade | goal 20 | L1 | "Upgrade all" button |
| S3 | Auto-balance | 50β | S1, L4 | one-click Router weights |

How the prices are meant to work:

- **The spine (P2 → P3 → P4 → P5 → P7)** is what the goal chain asks for. No step costs more than about three minutes of what a slow player's un-upgraded Labs bring in at that point.
- **Side techs are impulse buys.** Each is small next to the spine tech it competes with, so every kind of player picks them up along the way: α for what helps before the first Glyph, β after it. Luxury Buyers is the exception: dearer than Fabrication's β, so it comes after.
- **γ does not exist before the first Lens,** so anything priced in γ is free-play content. The late Processing techs need all three kinds of Data, which keeps Tier 1 items worth studying to the end.

## The adviser

`src/advice.ts`. When the active goal is a wait, the adviser names one thing to do meanwhile. It is measured, not assumed: each candidate is tried on a copy of the game against an untouched copy, with the real rules, and is only given if the wait ends sooner with it; tips are ranked by the seconds they save.

- **A wait** is a goal whose next step is a purchase the player cannot pay for yet (credits or Data), the Flow goal, or an order goal whose order is still filling. `waitInfo(g)` gives `{ unit, have, need, eta }` for the first kind; `waitKind(g)` names any of them.
- **What it can say:** wire something (better) into a Lab; speed up a full Lab; speed up a Well or machine that runs flat out on the way to what is short (one, or all of a kind with Bulk Upgrade); build a second Lab; put a Well on a free deposit and wire it to a Lab, a Market or a machine short of that material; sell what backs up or is not sold at all; build a Refiner on a Well that sells raw; press Favour on a Router; research Lab Speed, Deep Analysis or Wider Demand when they pay for themselves inside the wait; remove a wire into a Lab when the Market would buy the material and no tech needs that Data right now; send the ordered material to a Market; and for the Flow goal, the producer furthest from flowing and its fix.
- **What it never says:** anything the player cannot afford, anything that does not shorten the wait by at least 5 s and 3% (`ADVICE.minSaves`, `minShare`), or anything for a wait that ends within 12 s anyway. When something sells over demand the tip says so, and making more of that material is never worth saying because it is measured at the surplus price.
- **In the copies nobody plays:** nothing is bought, the order the game has is claimed when it fills, and no new order is rolled.
- **Cost:** a fresh verdict takes 20–40 ms on a mid-game board; it is kept for 15 game seconds while the board does not change (`ADVICE.refresh`), so every other call is free. The interface shows a tip only after about 15 s in a wait.

## Time away

Nothing before the first Lens. After it: 50% of the live rate, measured on a copy of the game, for up to 2 hours (8 with Long Absence).

## Where the pacing lands

Measured after the rule changes above (dead-end junctions, Flow, orders, Bulk Upgrade, the adviser) and **before** the retune that follows them. Prices are unchanged from the last tuned build.

**Pacing bots** (`npm run pacing`, seeds 1–3, on the bot's clock). The fast policies act every 3–4 s; the slow one every 8–10 s, claims late, ignores amber rings and never upgrades a Lab. None of them follows tips yet, and the slow policy is due to be replaced by a newcomer who does.

| | fast (mainline, greedy) | slow | target |
|---|---|---|---|
| First machine / Lab / research | 0:21–0:22 / 0:39–0:40 / 1:05–1:06 | 1:07–1:13 / 2:11–2:17 / 2:46–2:53 | fast: by 0:45 / 1:30 / 2:30 |
| First Glyph | 7:17–7:28 | 9:46–10:30 | fast: 6:00–8:00 |
| First Lens | 18:11–19:04 (one run 4 s late) | 18:34–20:36 | fast: 16:00–19:00 |
| First Paradox | 26:38–27:11 | 35:51 or later | fast: not before 24:00 |
| Longest dead stretch before the Lens | 34–39 s | none | fast: 60 s before 10:00, 120 s after |
| Time on "Build a Fabricator" | 464–490 s | 46–227 s | new: 300 s for fast, 240 s for the newcomer |
| Longest on one goal | 464–490 s (Build a Fabricator) | 227–325 s (Make your first Mist on two seeds of three) | 240 s |
| Dearest spine tech, in Data income | — | 214–256 s (Breeze Deposits) | about 180 s |
| Orders filled in 30 min, median time to fill | 17–22, 53–73 s | 15–16, 67–86 s | — |
| Credits from sales and orders at the Lens | 87–88% | 76–78% | 65% |

Orders now pay less α in total before the first Glyph (they are sized from what is sold, and the bots sell about half of what they make), which is why Glyph and Lens came about 50 s later for the fast bots and the slow bot's α waits grew.

**The scripted newcomer** (`tests/cardPlayer.ts`; `npm run baseline` prints the full table, goal by goal): does only what the goal card says, one action every 6 s, and follows a tip once it has been on offer for 15 s of a wait.

| | card only | card + tips, order seeds 0–3 | card + tips, 10 s per action |
|---|---|---|---|
| First Lens | 38:33 | 18:32–19:55 | 21:36 |
| Make your first Spark | 185 s | 82 s | 111 s |
| Assemble your first Glyph | 297 s | 142–160 s | 136 s |
| Make your first Mist | 576 s | 161–193 s | 198 s |
| Build a Fabricator | 896 s | 346–425 s | 318 s |
| Longest wait with no tip on offer | 200 s | 77–114 s | 71 s |
| Tips followed | — | 13–15 | 11 |
| First sale over demand | never | never | never |

Two things to know before changing a number:

- **The Fabricator is the one goal over four minutes for everyone.** At 7,800¢ the newcomer saves for six to seven minutes even after selling Prism and no longer studying Glyph, and the tips run out a minute or more before the end: at 13–17¢ a second nothing affordable pays for itself in the time left.
- **Goal 16 (Hold 75% Flow) still completes by itself.** When it arrives the newcomer has six of seven producers flowing (86%); the seventh is the Spark Refiner, short of Ember because an Ember Well makes 0.8/s. A threshold that needs that one fix would be met by the tip the adviser already gives for it.
