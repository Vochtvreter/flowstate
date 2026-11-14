# Flowstate — Content & Numbers

Every number in the pitch build, as tuned with the pacing bot (`npm run pacing`). The source of truth is the code: tables and `RULES` in `src/content.ts`, goals in `src/goals.ts`, the adviser's own tunables in `ADVICE` (`src/advice.ts`). The rules these numbers plug into are in [PITCH_PLAN.md](./PITCH_PLAN.md) section 2, as amended by the decisions noted below (fan-out, Flow, orders, the adviser). `DESIGN.md` and `README.md` still describe the older build.

**State of the tuning:** tuned for the newcomer who does what the goal card says and follows the adviser's tips. Every target holds on order seeds 0–3 for all four players of the pacing tool; the last section has the numbers, what happens on other seeds, and what the tuning costs a player who ignores the tips.

## Materials

| Material | Tier | Value ¢ | Demand /s | Made by |
|---|---|---|---|---|
| Glint | T0 | 1 | 2.0 | Well |
| Murk | T0 | 1 | 2.0 | Well (Murk Deposits) |
| Ember | T0 | 2 | 1.5 | Well (Ember Deposits) |
| Breeze | T0 | 2 | 1.5 | Well (Breeze Deposits) |
| Shard | T1 | 3 | 1.5 | Refiner |
| Ink | T1 | 4 | 1.2 | Refiner |
| Silt | T1 | 0.5 | 0.5 | Refiner (by-product of Ink; worth only 1 α in a Lab) |
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

The first time a material keeps selling over its demand for 3 seconds, the game sets `seenSurplus` (saved) and raises a one-off `surplus` event naming it, so the demand gauge can be introduced when the rule first bites. It does not bite during the demo: in 60 pacing runs (four players, order seeds 0–14) nothing sold over demand before the first Lens, the newcomer's save for the Fabricator included. Even in thirty minutes of fast play it happened in one run of thirty (Shard, at 29:35). When it does happen during a wait for credits, the adviser's sentence says so and Wider Demand joins its candidates.

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
| Assembler | 600 | ×2.5 | Assembly | one craft per recipe time |
| Fabricator | 7,100 | ×1.15 | Fabrication | one craft per recipe time |
| Router | 25 | ×1.10 | Routing | splits evenly, by ratio, by priority or by filter |
| Merger | 25 | ×1.10 | Merger | — |
| Silo | 200 | ×1.20 | Silo | holds 200 items |
| Market | first free, then 150 | ×1.50 | — | sells anything |
| Lab | 100 | ×1.30 | Lab | studies 1 item/s (2 with Lab Speed) |
| Void | free | — | Murk Deposits | destroys anything |

The second Assembler (for Prism) costs 1,500¢ and the third 3,750¢. That is on purpose: part of what the Fabricator used to ask for is paid before its goal begins, by whoever has the credits then. A player who arrives rich pays it out of the bank; one who arrives poor waits for it on the Prism goal instead of on the Fabricator's.

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

A Lab turns each item into Data by tier: T0 → 1 α, T1 → 3 α, T2 → 5 β, T3 → 8 γ (×1.5 with Deep Analysis). Silt is the exception: a by-product is worth 1 α, not 3 (`MATERIALS.silt.study`; three Silt make one Clay, which is worth 3 α, so reclaiming it neither gains nor loses Data). One β is worth 4 α and one γ 12 α when an order's pay is converted.

## Flow

Wells and machines count once they are at least 20 s old and some path of wires leads from them to a Market or a Lab (six Wells into a Void are not a supply line); one is *flowing* at 90% utilisation or more. Cutting a weak producer off still hides it, at the price of everything it made. Flow is the flowing share, smoothed over 3 s. Once the goal chain unlocks the meter, every sale is multiplied by `1 + 0.2 × Flow`. 100% for 10 s with six or more producers is Flow State.

**The Flow goal asks for 95% for 10 seconds** (`RULES.flow.holdShare`, `holdSeconds`). On a board of fewer than nineteen producers that is every one of them. It has to be earned: when the meter unlocks, the newcomer has seven of nine or nine of ten producers flowing (77–90%). The Spark Refiner is short of Ember (an Ember Well makes 0.8/s, the Refiner wants 1), and on most seeds the Ink Refiner is short of Murk. The goal takes one or two fixes, each named by the adviser ("The Spark Refiner is holding Flow back because it is short of Ember: click the Ember Well and buy Speed (50¢)"), and 47–74 s. The first Flow State arrives with it. At the old 75% the goal completed with no action in every run; at 90% it still did for a newcomer with ten producers. A fast player has usually fixed everything already and passes in a quarter of a minute.

## Orders

Unlocked by the Spark goal. One order at a time: "deliver N of X", counted from sales at any Market, no timer.

- **X:** something refined that the player makes right now. What reaches a Market comes first, then what does not; within each, the newest first. The first, second and third on that list are picked with chances 55 / 30 / 15%, never the same material twice running.
- **N:** 45–90 s of what currently reaches Markets of that material (not of what is made), at least 8. "Currently reaches" is measured on a copy of the game run forward for 40 s (`src/forecast.ts`), so a line built a moment ago counts for what it will sell.
- **The first order** (until one has been filled) only asks for something already selling, sized to 32–37 s of it, at least 3: it counts from the moment it appears and fills in 30–40 s with nothing rerouted.
- **Reaching no Market:** an order can ask for something the player makes but does not sell (N is then 8). `orderView(g).reachesMarket` is false, with `rate` and `eta` beside it, and the adviser says where to reroute.
- **Pay:** credits worth half the items at full price, plus Data in the tier the player is shortest of. In the items' own tier that is what a Lab would have made from them. Converted into another tier (Glyph is β in a Lab; an order that pays α for it converts) only a quarter survives (`RULES.orders.convertShare`): ten Glyph pay 50 β, or 50 α rather than 200 α. At full conversion one Glyph order paid 400 α in a lump, and which material the next order happened to ask for moved the first Lens by up to three minutes.
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
| 15 | Assemble your first Glyph | Flow meter + 150¢ ★ |
| 16 | Hold 95% Flow for 10 seconds | 150¢ |
| 17 | Study Glyph for β (40 β in hand) | 50α |
| 18 | Make your first Mist | 50α |
| 19 | Assemble your first Prism | 600¢ + 40β |
| 20 | Fill three orders | Bulk Upgrade + 1,200¢ + 60β |
| 21 | Build a Fabricator | 40β |
| 22 | Make your first Lens | demo complete ★ |
| free play | Clay · Coil · Dynamo · Paradox | 200¢ · 600¢ · 1,800¢ · 7,500¢ |

★ = big celebration; the fifth is the first Flow State.

**Every card that has the player make something new also says to sell it.** Goals 11, 15, 18 and 19 end "…and sell the Spark", "…sell its Glyph at the Market", "…sell the Mist", "…sell its Prism at the Market" (goal 10 already said so for Ink). A newcomer does what the card says to the letter: without those words Spark, Glyph and Prism were never sold, the Spark Refiner sat blocked for minutes, and the Fabricator had to be paid for out of Shard and Ink.

**A goal that asks for a research and then a machine says so to the adviser.** `Goal.step(g)` returns `{ tech, then }`, where `then` is the price of what the card has the player buy straight after the research: the Assembler for goal 15, a Well and a Refiner for goals 11 and 18, the Fabricator for goal 21. What the card shows is unchanged (Data toward the research).

## Tech tree

| ID | Tech | Cost | Requires | Gives |
|---|---|---|---|---|
| **Processing** | | | | |
| P1 | Refining | goal 3 | — | Refiner, Shard |
| P2 | Murk Deposits | 45α | Lab | Murk Wells, Ink + Silt, Void |
| P3 | Ember Deposits | 215α | P2 | Ember Wells, Spark |
| P4 | Assembly | 1,140α | P3 | Assembler, Glyph |
| P5 | Breeze Deposits | 1,420α | P4 | Breeze Wells, Mist, Prism |
| P7 | Fabrication | 1,180α + 100β | P5 | Fabricator, Lens |
| P6 | Reclamation | 300α + 25γ | P4 | Clay, Coil |
| P8 | Dynamo | 1,200α + 300β + 100γ | P6, P7 | Dynamo |
| P9 | Paradox | 2,500α + 500β + 450γ | P8 | Paradox |
| U1 | Efficiency Tuning | 40β | P1, P4 | Efficiency upgrades |
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
| C2 | Wider Demand | 40β | C1 | +50% demand |
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

- **The spine (P2 → P3 → P4 → P5 → P7)** is what the goal chain asks for, and it is priced for the newcomer who follows the adviser: each of its waits is about three and a half minutes for that player and never four, and together they put the first Lens between 20 and 25 minutes. The tips roughly double that player's α (raw Wells into Labs, more Labs, everything refined studied as well as sold), so the same prices are far too dear for a player who ignores them: seven minutes for Assembly, thirteen for Breeze Deposits, about twenty on the Fabricator's goal.
- **Ember Deposits is the cheap one** because a fast player has nothing else to do while saving for it: above about 220α their hands are idle for more than a minute, which the plan does not allow before minute 10.
- **Side techs are impulse buys.** Each is small next to the spine tech it competes with, so every kind of player picks them up along the way: α for what helps before the first Glyph (Lab Speed, Merger, Pipes Mk II: 150α together), β after it. Wider Demand is β for that reason: nothing sells over demand before the first Glyph, and at 200α it cost a fast player most of a minute there. Luxury Buyers is the exception: dearer than Fabrication's β, so it comes after.
- **γ does not exist before the first Lens,** so anything priced in γ is free-play content. The late Processing techs need all three kinds of Data, which keeps Tier 1 items worth studying to the end.

## The adviser

`src/advice.ts`. When the active goal is a wait, the adviser names one thing to do meanwhile. It is measured, not assumed: each candidate is tried on a copy of the game against an untouched copy, with the real rules, and is only given if the wait ends sooner with it; tips are ranked by the seconds they save.

- **A wait** is a goal whose next step is a purchase the player cannot pay for yet (credits or Data), the Flow goal, or an order goal whose order is still filling. `waitInfo(g)` gives `{ unit, have, need, eta }` for the first kind; `waitKind(g)` names any of them.
- **A research and the machine after it are one wait.** Where the card asks for both (goals 11, 15, 18, 21), the wait is for whichever is further off, the Data or the credits, and `waitInfo` and the tips are about that one. On "Build a Fabricator" a newcomer starts 3,500–4,800¢ short of the price with the research two and a half minutes away: the tips are about credits from the first seconds of the goal, while the card is still counting α. (Before, selling was only mentioned once the research was done, and the goal took that player four minutes longer.)
- **What it can say:** wire something (better) into a Lab; speed up a full Lab, or all full Labs with Bulk Upgrade; speed up a Well or machine that runs flat out on the way to what is short (one, or all of a kind with Bulk Upgrade); build a second Lab; put a Well on a free deposit and wire it to a Lab, a Market or a machine short of that material; sell what backs up or is not sold at all; build a Refiner on a Well that sells raw; press Favour on a Router; research Lab Speed, Deep Analysis or Wider Demand when they pay for themselves inside the wait; remove a wire into a Lab when the Market would buy the material and no tech needs that Data right now; send the ordered material to a Market; and for the Flow goal, the producer furthest from flowing and its fix.
- **Flow tips fix one producer at a time.** A Flow tip names the Well or machine that holds Flow back (`Advice.culprit`) and what to do about it (`Advice.node`). It is true when that producer flows with the fix and would not have without it. It does not have to finish the goal on its own (`saves` is then absent): a board with three things wrong takes a tip for each. Among fixes, the one that completes the goal comes first, then the one that leaves the fewest producers short.
- **How small a saving is worth saying:** 2 s and 1% of the wait (`ADVICE.minSaves`, `minShare`) when the end of the wait was reached in the look-ahead, with the tip and without. A newcomer with credits to spare is better off told about a small true gain than left with nothing to do. When the wait outlasts the look-ahead (300 s) its end is an estimate, good to a few per cent, and a tip must save 5 s and 4% (`estSaves`, `estShare`).
- **Small savings are checked twice.** The look-ahead runs at half-second steps, where a saving of a few seconds can be an artefact of the step. Unless a tip saves 10 s and a fifth of the wait, it is tried once more against doing nothing at a tenth of a second (`ADVICE.fine`, `checkBelow`, `checkShare`), and is only given if the saving is still there; that second measurement is the saving it is given with.
- **A tip does not blink.** Once given, it stays on offer while the board does not change and it still saves at least 1 s (`ADVICE.keepSaves`).
- **What it never says:** anything the player cannot afford, anything that does not pass the tests above, or anything for a wait that ends within 12 s anyway. When something sells over demand the tip says so, and making more of that material is never worth saying because it is measured at the surplus price.
- **In the copies nobody plays:** nothing is bought, the order the game has is claimed when it fills, and no new order is rolled.
- **Cost:** a fresh verdict takes 21 ms at the median, 65 ms at the 90th percentile and up to 130 ms on a newcomer's boards (measured in Node; the second look at a small saving is what the slow ones pay for). It is kept for 15 game seconds while the board does not change, and for no more than 15% of the wait it was worked out for (`ADVICE.refresh`, `refreshShare`), so every other call is free. The interface shows a tip only after about 15 s in a wait.

## Time away

Nothing before the first Lens. After it: 50% of the live rate, measured on a copy of the game, for up to 2 hours (8 with Long Absence).

## Where the pacing lands

`npm run pacing` plays four players on order seeds 0–3 (seed 0 is the order sequence every real new game starts with) and checks each run against the targets. `tests/pacing.test.ts` pins seed 0 of all four, so `npm test` notices a change that moves the pacing.

- **mainline, greedy:** fast players who know the game: one action per 3–4 s. From the moment a new machine cannot be paid for they bank half of what comes in and may spend the other half on upgrades; once they own Bulk Upgrade, nodes of a kind that want the same upgrade get one press of "Upgrade all" when they are at least half of that kind.
- **newcomer:** does only what the goal card says, one action per 6 s, claims 8–16 s late, and follows a tip once it has been on offer for 15 s of a wait. Never builds a Router, upgrades or wires anything unprompted.
- **newcomer10:** the same person at 10 s per action.

Every target holds on seeds 0–3. Measured (seeds 0–3, then the range over seeds 4–14):

| Fast players (16 + 44 runs) | Seeds 0–3 | Seeds 4–14 | Target |
|---|---|---|---|
| First machine / Lab / research | 0:21–0:22 / 0:39–0:40 / 1:05–1:06 | 0:21–0:23 / 0:37–0:40 / 1:03–1:07 | by 0:45 / 1:30 / 2:30 |
| Longest wait in the first 2 min | 6–8 s | 6–8 s | 10 s |
| First Glyph | 6:41–7:36 | 6:46–7:34 | 6:00–8:00 |
| First Lens | 15:41–16:47 | 15:01–16:29 | 14:30–19:00 |
| Time on "Build a Fabricator" | 220–265 s | 221–276 s | 300 s |
| First Paradox | 25:36–27:17 | 24:55–28:41 | not before 24:00 |
| Longest dead stretch before 10:00 / before the Lens | 47–52 s / 47–89 s | 46–52 s / 48–115 s | 60 s / 120 s |
| Credits from sales and orders at the Lens | 82–84% | 81–84% | 65% |
| Presses of an Upgrade button before the Lens | 22–35, of them 1–2 "Upgrade all" | 20–41 | — |

| The newcomer (4 + 11 runs) | Seeds 0–3 | Seeds 4–14 | Target |
|---|---|---|---|
| First Lens | 20:32–21:06 | 20:04–21:17 | 20:00–25:00 |
| Longest time on any one goal | 202–218 s | 200–223 s | 240 s |
| Time on "Build a Fabricator" | 189–218 s | 168–223 s | 240 s |
| Longest wait with no tip and nothing the card asks | 40–52 s | 43–112 s, **over 60 s on six of eleven seeds** | 60 s |
| Tips followed / presses of an Upgrade button | 17–20 / 6–9 | 15–21 / 3–9 | — |
| Credits from sales and orders at the Lens | 78–79% | 77–80% | 65% |
| At 10 s per action: first Lens | 21:45–22:53 | 22:14–23:10 | by 32:00 |
| At 10 s per action: longest time on one goal | 202–216 s | 197–260 s | 300 s |

Where the newcomer's time goes (seed 0): the opening, goals 1–10, 3:49; Spark 121 s; first order, Router and expansion 117 s; Glyph 196 s; Flow 47 s; β 66 s; Mist 171 s; Prism and three orders 45 s; the Fabricator 218 s; the Lens 37 s.

Three things to know before changing a number:

- **The window is narrow by construction.** The newcomer's hands take about seven and a half minutes of the run whatever the prices are, a fast player may not be kept from the first Glyph past 8:00 (which caps Ember Deposits and Assembly), and no goal may take the newcomer four minutes. A Lens after 20:00 then needs every one of the four long waits (Glyph, Mist, the Fabricator, and Spark as far as the fast player allows) at three to three and a half minutes. There is little room to move one without another.
- **The waits end with nothing to say.** In the last minute or so of a wait for α the board is doing all it cheaply can, and nothing the adviser can honestly offer saves even two seconds. On seeds 0–3 that stretch is 40–52 s; on six of eleven other seeds it is 62–112 s, at the end of the Mist wait or of the Fabricator's. The Fabricator's is the stubborn one: with the research a minute away and the credits just enough, anything that brings α sooner costs credits and anything that brings credits costs α.
- **Without the tips the same game takes 51–56 minutes to the Lens:** 7 minutes for Assembly, 13–14 for Breeze Deposits, 18–22 on the Fabricator's goal (`npm run pacing -- --policy=newcomer --noTips`). The spine is priced for a player whose α the tips have doubled. Before this tuning that player took 38 minutes, most of it saving for the Fabricator with Prism unsold. Cards that also said to study each new material (as they now say to sell it) would close much of the gap; so would a first Lens allowed a few minutes earlier.

The tests' own newcomer (`tests/cardPlayer.ts`, `npm run baseline`) claims after one action instead of 8–16 s late and reaches the Lens at 19:31–20:02.
