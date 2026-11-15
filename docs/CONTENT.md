# Flowstate — Content & Numbers

Every number in the pitch build, as tuned with the pacing bot (`npm run pacing`). The source of truth is the code: tables and `RULES` in `src/content.ts`, goals in `src/goals.ts`, the adviser's own tunables in `ADVICE` (`src/advice.ts`). The rules these numbers plug into are in [PITCH_PLAN.md](./PITCH_PLAN.md) section 2, as amended by the decisions noted below (fan-out, Flow, orders, the adviser). `DESIGN.md` and `README.md` still describe the older build.

**State of the tuning:** tuned for the newcomer who does what the goal cards say, their "while you wait" lines included. The adviser's tips are few (two in a demo for the newcomer who follows the cards) and each is worth at least 15 s. Every target holds on order seeds 0–14 for all five players of the pacing tool, and `tests/pacing.test.ts` pins them on seeds 0–3; the last section has the numbers.

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

The first time a material keeps selling over its demand for 3 seconds, the game sets `seenSurplus` (saved) and raises a one-off `surplus` event naming it, so the demand gauge can be introduced when the rule first bites. It rarely bites during the demo: in 45 pacing runs of the three card players (order seeds 0–14) nothing sold over demand before the first Lens, the save for the Fabricator included. A fast player first sells over demand between 14:43 and 21:52 (Shard or Ink, in every one of 30 runs now that Wider Demand cannot be bought before it is needed), and in 2 of those 30 runs that is before their first Lens. When it does happen during a wait for credits, the adviser's sentence says so and Wider Demand joins its candidates.

**Demand is not shown until then.** The Commerce branch is hidden from the tech tree until `seenSurplus` is true (`Tech.needsSurplus`, `techHidden`), and `demandShown(g)` tells the interface whether to draw demand at all. Market Lens is not a goal reward any more: it is granted at that same moment (a `tech` event for C1 comes just before the `surplus` event), and Wider Demand, Luxury Buyers and Exports appear with it. A save from an older build that owns Market Lens or Wider Demand keeps them and sees the branch; one that has seen a surplus without owning Market Lens is given it on load. Nothing else a player reads names demand before that moment (`tests/rules.test.ts` goes through the goal cards, the node blurbs and the techs in view): the Market's blurb says "Sells anything for credits. Takes any number of wires.", and the adviser takes no notice of a glut until `demandShown(g)`, so the few seconds between a material first selling over its demand and the `surplus` event cannot produce a tip that says "over demand".

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

**The Flow goal asks for 95% for 10 seconds** (`RULES.flow.holdShare`, `holdSeconds`). On a board of fewer than nineteen producers that is every one of them. It has to be earned: when the meter unlocks, a card player usually has one or two producers short. The Spark Refiner is short of Ember (an Ember Well makes 0.8/s, the Refiner wants 1), and on most seeds the Ink Refiner is short of Murk. Each is one fix, named by the adviser ("The Spark Refiner needs more Ember: buy Speed on the Ember Well (50¢)."). The first Flow State arrives with the goal. At the old 75% the goal completed with no action in every run; at 90% it still did for a newcomer with ten producers. A fast player has usually fixed everything already and passes in a quarter of a minute.

**The valve.** Once the goal has been on the card for 90 s (`RULES.flow.valveAfter`; `goalAge(g)`, from the saved `Game.goalAt`), all but one producer flowing, held for the same 10 s, also completes it. The bar itself does not move. The ten seconds are counted from the moment the valve opens, however long the board has been at "all but one" before: the goal's count starts at 0 at second 90 and the goal is ready at second 100, never sooner. (Until this round the seconds held before the valve counted, and the goal completed the instant it opened, with nothing on the card to show for it.) If the board drops under "all but one" the count stops, and starts from nothing when it is back.

The valve is for the board with one producer nobody can honestly fix: a machine fed through a Router that favours a Lab (goal 13's card asked for that Router, and no tip turns it back) dips under 90% however its Wells are upgraded. The adviser says nothing about such a board, because a Flow tip has to get the producer it names flowing and keep it so; the valve passes it at 100 s (tested in `tests/advice.test.ts` and `tests/goals.test.ts`). It is also what carries a player who never follows a tip: the pacing tool's card-only player has nine of ten producers flowing when the meter unlocks, on all fifteen seeds, and spends 108–116 s on the goal doing nothing (100 s, and the Claim 8–16 s after; `tests/pacing.test.ts` pins 108–118 s on seeds 0–3). The valve is "all but one" and no more: with two producers short (five of nine flowing was tried for 400 s) the goal waits for a fix, and a player who takes no tip then has only the Flow ring to go by. The 90 s run on game time, so a pause or time away does not open it, and they are saved with the game: a save made at second 80 completes 20 s after it is loaded, a save made while the count is running picks it up where it was, and a save from before this rule starts its 90 s when it is loaded.

**What the card can show.** `goalView(g).flow` is `{ pct, running, of, need, valve? }` while the Flow goal is active: the smoothed Flow, how many producers are flowing out of how many counted, the share needed right now (0.95, or "all but one" once the valve is open), and `valve: true` from the moment the valve opens (absent before). `goalView(g).progress` is the count itself, `[held, 10, 's']`: under the valve it runs from 0 to 10 between second 90 and second 100.

## Orders

Unlocked by the Spark goal. One order at a time: "deliver N of X", counted from sales at any Market, no timer.

- **X:** something refined that the player makes right now. What reaches a Market comes first, then what does not; within each, the newest first. "Reaches a Market" means sold at 0.08 items/s or more (`RULES.orders.marketRate`; the smallest order fills in 100 s at that rate). It used to be 0.02, the bar for "is produced" (`minRate`, unchanged): a trickle of Mist past a busy Assembler then counted as selling, an order for eight of it took minutes or went stale, and a fast player saving for the Fabricator sat with free hands for up to 157 s. The first, second and third on that list are picked with chances 55 / 30 / 15%, never the same material twice running.
- **N:** 45–90 s of what currently reaches Markets of that material (not of what is made), at least 8. "Currently reaches" is measured on a copy of the game run forward for 40 s (`src/forecast.ts`), so a line built a moment ago counts for what it will sell.
- **The first order** (until one has been filled) only asks for something already selling, sized to 32–37 s of it, at least 3: it counts from the moment it appears and fills in 30–40 s with nothing rerouted.
- **Reaching no Market:** an order can ask for something the player makes but does not sell (N is then 8). `orderView(g).reachesMarket` is false, with `rate` and `eta` beside it, and the adviser says where to reroute.
- **Pay:** credits worth half the items at full price, plus Data in the tier the player is shortest of. In the items' own tier that is what a Lab would have made from them. Converted into another tier (Glyph is β in a Lab; an order that pays α for it converts) only a quarter survives (`RULES.orders.convertShare`): ten Glyph pay 50 β, or 50 α rather than 200 α. At full conversion one Glyph order paid 400 α in a lump, and which material the next order happened to ask for moved the first Lens by up to three minutes.
- An order with no delivery for 120 s is quietly replaced.

## Goal chain

One goal at a time; a finished goal waits for Claim. Rewards are the only source of Refining, Lab, Routing, Bulk Upgrade, Orders and the Flow meter (Market Lens comes with the first surplus, see Materials). Through goal 7 the credits paid so far always cover the next purchase the card asks for.

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
| 11 | Make your first Spark | Orders + 25α ★ |
| 12 | Fill your first order | Routing + 200¢ |
| 13 | Route more to a Lab than to the Market (a Router on the Spark Refiner, one press of Favour on the Lab's wire) | 30α |
| 14 | Expand the board | 60¢ |
| 15 | Assemble your first Glyph | Flow meter + 150¢ ★ |
| 16 | Hold 95% Flow for 10 seconds (after 90 s: all but one producer, for 10 s counted from then) | 150¢ |
| 17 | Study Glyph for β (40 β in hand) | 50α |
| 18 | Make your first Mist | 50α |
| 19 | Assemble your first Prism | 600¢ + 40β ★ |
| 20 | Fill three orders | Bulk Upgrade + 1,200¢ + 60β |
| 21 | Build a Fabricator | 40β |
| 22 | Make your first Lens | demo complete ★ |
| free play | Clay · Coil · Dynamo · Paradox | 200¢ · 600¢ · 1,800¢ · 7,500¢ |

★ = big celebration (`Goal.big`, and `big: true` on the goal's `goal-claimed` event): six goals, and the seventh is the first Flow State. The first Spark and the first Prism were added to fill the two longest stretches without one. Where the peaks fall for the newcomer on seed 0 (claims): Shard 1:42, Lab 2:23, Spark 5:42, Glyph 11:00, the first Flow State about 11:40, Prism 16:39, the Lens 19:15. For a fast player: Spark 3:06, Glyph 6:44, Prism 11:40, the Lens 15:03. The longest stretch between two is a little over five minutes (Spark to Glyph for the newcomer); without the two new ones it was eight and a half (Lab to Glyph) and seven and a half (Flow State to Lens).

**Every card that has the player make something new also says to sell it.** Goals 11 and 18 end "…and sell the Spark", "…sell the Mist"; goals 15 and 19 say "…wire it to the Market, then wire Spark into it to make Glyph" (goal 10 already said so for Ink). A newcomer does what the card says to the letter: without those words Spark, Glyph and Prism were never sold, the Spark Refiner sat blocked for minutes, and the Fabricator had to be paid for out of Shard and Ink.

**The Assembler and Fabricator cards say where to build from, and put the Market before the wire that completes the goal.** The hints of goals 15, 19 and 21 used to say "build an Assembler" and leave the place to the player. They now read:

| Goal | Hint (the same for mouse and touch) |
|---|---|
| 15 | "Research Assembly, build an Assembler from the Ink Refiner's Ink port, wire it to the Market, then wire Spark into it to make Glyph." |
| 19 | "Build another Assembler from the Mist Refiner's port, wire it to the Market, then wire Shard into it to make Prism (two for every Mist)." |
| 21 | "Research Fabrication, then save up and build a Fabricator from the Prism Assembler's port: orders and a high Flow get you there faster." |

Built from the named port (dragged into empty space, or tapped on a phone), the machine is the first choice on the menu, arrives wired and set to its recipe, and costs one gesture less than placing it and wiring it. The Market comes second in the sentence on purpose. A goal completes with the first Glyph (or Prism), and a card that is ready shows Claim and no hint: with "…wire Spark into it too and sell its Glyph" the gesture still to come when the card turned was the sale. The pacing tool's newcomer at 10 s an action left it out on three seeds of fifteen (an order's Claim took the turn), sold no Glyph for six minutes until a tip said so, and spent 214–220 s on the Fabricator goal instead of 95–129 s. In the new order the goal cannot complete before the wire to the Market exists. Goal 22's hint is unchanged ("Feed the Fabricator one Prism and two Glyph for every Lens."): the Prism is wired by then, and the Glyph wire is what is left. The three hints are 131–135 characters; the longest in the game are 141 (goal 13, mouse) and 148 (goal 10, touch), and they take the same number of lines on the card at every size tried (two at 1440 px and on a phone held sideways, three at 390 and 360 px). The scripted card players (`tests/cardPlayer.ts`, the pacing tool's `cardStep`) build and wire in the order the hints give.

**A goal that asks for a research and then a machine says so to the adviser.** `Goal.step(g)` returns `{ tech, then }`, where `then` is the price of what the card has the player buy straight after the research: the Assembler for goal 15, a Well and a Refiner for goals 11 and 18, the Fabricator for goal 21. What the card shows is unchanged (Data toward the research). A step also names what the credits are for (`what`, `thenWhat`: "the Fabricator", "the expansion"), and `waitInfo(g).name` passes that on, so a card or a tip can say what is being saved for.

**Goal 13 names the Spark Refiner** as the place for the Router ("Build a Router from the Spark Refiner's port and wire it to a Lab and to a Market, then select the Router and press Favour on the Lab's wire."). Shard is studied since goal 7 and Ink by the line of goal 11; Spark is the one refined material nothing studies yet, so that is where a Router toward a Lab earns Data.

### While you wait

Four goals have a wait of minutes. Each carries one standing line for that wait (`Goal.meanwhile`; `goalView(g, touch).meanwhile` is `{ text, done }`, absent when the goal has none, is ready to claim, or the line does not apply to the board right now; `meanwhileOf(g)` is the same for code). A line is at most 90 characters (`RULES.tips.maxLength`), is true in the real game on the card player's own board, and nothing it asks for is undone by a later card or by a tip (`tests/meanwhile.test.ts`).

| Goal | Line | Done when | Worth to the tests' card player | Worth to the pacing tool's card-only player |
|---|---|---|---|---|
| 11 Make Spark | "Drag from the Ink Refiner's Ink port to the Lab too: studied Ink is 3 α each." (touch: "Tap the Ink Refiner's Ink port, then tap the Lab too: studied Ink is 3 α each.") | Ink reaches a Lab: the Ink port is wired to one, or to a Router that is | 101 s of the wait | @SPARK@ |
| 15 Make Glyph | "Give each new deposit a Well and a Lab built from its port: each pair is 1 α a second." | two Wells have a Lab each (a pair is one Well and one Lab fed by Wells alone, each counted once) | 106–136 s | @GLYPH@ |
| 18 Make Mist | "Expand the board again, then give a new deposit a Well and a Lab of its own." | a deposit of the second expansion (or a later one) has a Well with a Lab of its own, or three Wells have a Lab each | 20–33 s | @MIST@ |
| 21 Build a Fabricator | "You have the β you need: cut the wire from the Glyph Assembler to the Lab." | no wire takes Glyph into a Lab, straight from the Assembler or through a Router, Merger or Silo | 31–47 s | @FAB@ |

The two columns are two players and two ways of measuring. The tests' card player (`tests/cardPlayer.ts`) claims at once; from the board it has when a line comes up, the wait is timed in the real game with the line done and with it left alone (two order sequences). The pacing tool's card-only player claims 8–16 s late and is the one the targets judge; its column is the time on that goal in a whole run with the line and in one that leaves it out (`npm run pacing -- --policies=cardonly --skipLine=make-glyph`), on order seeds 0–14. `tests/meanwhile.test.ts` holds both on seeds 0–3.

- **A Well gets a Lab of its own.** A Lab studies one item a second and takes its inbox in the order the materials first arrived there. A raw material wired into the Lab the player already has pushes the dearer Shard and Ink out of it, and a late arrival can be starved for a quarter of an hour (Glyph: see "Glyph in a crowded Lab" under the adviser). A Well with its own Lab is a plain 1 α a second.
- **A pair is one Well and one Lab.** One Well wired into two Labs has 1 α a second to give, not 2, and used to tick goal 15's line; so did Glyph that reached a Lab through a Router for goal 21's. Both are counted properly now: pairs are matched one Well to one Lab, and "studied" follows the material through Routers, Mergers and Silos. `Meanwhile.cuts(g)` lists the wire into the Lab in that case (the Router's), which is the one to cut.
- **The lines were found from data, not written from taste:** every single move a card could ask for was tried on the card player's board at the start of each long wait, then every pair of the best ones (360 combinations). What limits that player's α is Lab capacity and the crowding above, not Wells or Speed.
- **The Glyph line is the only place a wire into a Lab is cut, and it is the card that says so.** It shows only while Fabrication's β is covered, no Fabricator stands and the credits for one are short (`Meanwhile.when`); `Meanwhile.cuts(g)` names the wires. The line trades study for credits, so it is only true for a player whose wait is for the Fabricator's price and not for Fabrication's α: that is what Fabrication's price is set by (below). The word is "cut" everywhere, as on the inspector's button ("Cut wire").
- **After the demo the β is needed again.** Dynamo and Paradox cost 300 and 500 β. A player who has cut the Glyph wire and runs out of β there is told "Wire the Glyph Assembler's port to a Lab: Glyph is 5 β each in a Lab." (a wait that would never end is never met with silence). That is the one tip that goes against a card's line, and only in free play.
- **A line read late or left out** costs what the table says and no more: @LATE@
- The card players (`tests/cardPlayer.ts`, the pacing tool's newcomers) follow a line like a hint, one gesture at a time, before any tip.

**The line's next step: `lineAdvice(g)`.** So that the card can put a "Show me" on the line, `lineAdvice(g)` in `src/advice.ts` returns the next concrete step of the active goal's line as an `Advice`, the shape a tip has: something the interface can point at and `applyAdvice(g, a)` can carry out. One step at a time, read to the letter:

| Goal | Steps, in order | The sentence (`text.mouse === text.touch`) | What the `Advice` carries |
|---|---|---|---|
| 11 | the Ink Refiner's Ink port to the Lab (the one with the most room, if there are several) | "Wire the Ink Refiner's Ink port to the Lab: Ink is 3 α each in a Lab." | `wire { from, to, port }`, `node` = from |
| 15 | a Well that stands unwired gets a Lab from its port; otherwise the first free deposit gets a Well. Four steps for the two deposits | "Place a Well on the free Glint deposit (17¢), then build a Lab from its port." then "Build a Lab from the new Glint Well's port (130¢): a Lab of its own is 1 α a second." | `build: 'well'`, `deposit` (no `to`); then `build: 'lab'`, `node` = the Well, `port: 0` |
| 18 | the same on a deposit of the second expansion or a later one; when none of those is free, the board first. Three steps | "Expand the board (500¢): it brings new deposits for a Well and a Lab of its own." then the two above | `expand: true`, `cost` = the expansion's price; then as for goal 15 |
| 21 | the first wire that still takes Glyph into a Lab | "Cut the wire from the Glyph Assembler to the Lab: sold, each Glyph is 20¢." | `cut { wire, from, to }`, `node` = from |

- It is `null` when the goal has no line, the line is done or does not apply, the goal is ready, or the step cannot be paid for right now (it is back the moment the credits are there).
- `Advice.expand` is new and optional, and only ever comes from here: no tip expands the board. `applyAdvice` presses Expand for it.
- It promises nothing: `saves` is absent and `eta` is 0, because nothing is measured. It runs no copy of the game and leaves the game untouched: about 20 to 40 microseconds a call (`tests/meanwhile.test.ts` times it on 52 boards), so it can be asked on the page at every refresh. It is not held back by the 20 s of quiet after a change.
- Goal 18's step is the expansion even when a deposit of the first expansion is still free: that is what the line says, and it is the shortest way to the tick.
- Followed from the card players' boards (the tests' player with and without tips, and the pacing tool's card-only player and newcomer, seeds 0–3: 52 boards), every line ends done in exactly 1, 4, 3 and 1 steps, every step could be paid for and done when it was given, and the board that results is the board the scripted players build when they read the line themselves. Through whole runs it never gives a step without a line or for a line that is done.
- **A tip never says what the line is saying.** While a step is on offer here, `advice(g)` does not give it as a tip (the same action, or the same sentence about another node of the same name), nor another ending to its first gesture: a Well on the deposit the line wants a Well on, wired into the Lab the player already has (the adviser's own "Place a Well on the free Glint deposit (17¢), wired to the Lab: 1 α each." pointed at the same deposit as the line and said the opposite), or a wire from the Well the line wants a Lab on. What that does to the player who reads tips and never the lines is under "The adviser" below.

## Tech tree

| ID | Tech | Cost | Requires | Gives |
|---|---|---|---|---|
| **Processing** | | | | |
| P1 | Refining | goal 3 | — | Refiner, Shard |
| P2 | Murk Deposits | 45α | Lab | Murk Wells, Ink + Silt, Void |
| P3 | Ember Deposits | 215α | P2 | Ember Wells, Spark |
| P4 | Assembly | 1,140α | P3 | Assembler, Glyph |
| P5 | Breeze Deposits | 1,420α | P4 | Breeze Wells, Mist, Prism |
| P7 | Fabrication | 720α + 100β | P5 | Fabricator, Lens |
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
| C1 | Market Lens | given with the first surplus; hidden until then | Lab | price gauges on Markets |
| C2 | Wider Demand | 40β, hidden until the first surplus | C1 | +50% demand |
| C4 | Luxury Buyers | 300β, hidden until the first surplus | C2 | +25% value on T2 and T3 |
| C5 | Exports | 80γ, hidden until the first surplus | C4 | +100% demand |
| **Research** | | | | |
| R1 | Lab | goal 5 | — | Lab, tech tree |
| R2 | Lab Speed | 50α | R1 | Labs study 2 items/s |
| R3 | Deep Analysis | 80β | R2 | +50% Data per item |
| R4 | Long Absence | 210α, hidden until the demo ends | R1 | time away capped at 8 h instead of 2 h |
| **Scale tools** | | | | |
| S1 | Bulk Upgrade | goal 20 | L1 | "Upgrade all" button |
| S3 | Auto-balance | 50β | S1, L4 | one-click Router weights |

How the prices are meant to work:

- **The spine (P2 → P3 → P4 → P5 → P7)** is what the goal chain asks for, and it is priced for the newcomer who does what the cards say, their "while you wait" lines included: each of its waits is three to three and a half minutes for that player and never four. The lines are what makes that player's α (the Ink studied, then three Wells each with a Lab of its own); the adviser's tips add about a minute over the whole demo. Without the lines the same prices are far too dear: the hints alone reach the Lens at 46:40.
- **Fabrication is 720α, below the curve** (it was 1,180α; its 100β are unchanged). By then the Assemblers take most of the Shard, Ink and Spark the Labs lived on, and a card player's α income drops. The card's line for the last wait (stop studying Glyph, sell it) is only true when that wait is for the Fabricator's 7,100¢, and what a wait is for depends on who is playing. At 1,180α it was for α for every card player. At 900α it was for credits for the tests' card player and for the newcomer who takes tips, but the pacing tool's card-only player held 7,565–8,466¢ when the research came through, on all fifteen seeds: from the board that player had when the line came up, taking the wire away ended the wait sooner in 10 of 45 trials, at the same moment in 32 and later in 3. At 720α it ends sooner in 45 of 45 for the card-only player (11–32 s) and for the newcomer (15–48 s). The fast players research Fabrication with 1,000–3,500¢ in hand and wait for credits whatever it costs: over 30 order seeds their Lens is 14:49–17:00 at 720α and 14:42–16:51 at 900α. Ember Deposits, Assembly, Breeze Deposits and the Fabricator's price were left alone: lowering any of them brings a fast player's Lens toward the 14:30 limit.
- **Efficiency Tuning needs Assembly** (P1 and P4): it is priced in β, and before Assembly there is no β to pay with, so it only stood in the tree as something that could not be bought.
- **Ember Deposits is the cheap one** because a fast player has nothing else to do while saving for it: above about 220α their hands are idle for more than a minute, which the plan does not allow before minute 10.
- **Side techs are impulse buys.** Each is small next to the spine tech it competes with, so every kind of player picks them up along the way: α for what helps before the first Glyph (Lab Speed, Merger, Pipes Mk II: 150α together), β after it. Wider Demand is β for that reason: nothing sells over demand before the first Glyph, and at 200α it cost a fast player most of a minute there (it is hidden until the first surplus now). Luxury Buyers is the exception: dearer than Fabrication's β, so it comes after.
- **γ does not exist before the first Lens,** so anything priced in γ is free-play content. The late Processing techs need all three kinds of Data, which keeps Tier 1 items worth studying to the end.

## The adviser

`src/advice.ts`. When the active goal is a wait, the adviser may name one thing worth doing meanwhile. It is measured, not assumed: each candidate is tried on a copy of the game against an untouched copy, with the real rules, and tips are ranked by the seconds they save. The structural advice is on the goal cards now ("While you wait" above), so the adviser says little: the newcomer who follows the cards is offered two tips in the whole demo, one of them on the Flow goal. Silence is its normal state.

- **A wait** is a goal whose next step is a purchase the player cannot pay for yet (credits or Data), the Flow goal, or an order goal whose order is still filling. `waitInfo(g)` gives `{ unit, have, need, eta, name }` for the first kind (`name` is what is being saved for: "Assembly", "the Fabricator"); `waitKind(g)` names any of them.
- **A research and the machine after it are one wait.** Where the card asks for both (goals 11, 15, 18, 21), the wait is for whichever is further off, the Data or the credits, and `waitInfo` and the tips are about that one.
- **A tip is offered for one of three reasons only.** It saves at least 15 s of the wait (`ADVICE.minSaves`; when the wait outlasts the 300 s look-ahead its end is an estimate, and the tip must also save 4% of it: `estSaves`, `estShare`). Or it ends a wait that would otherwise never end. Or it is a Flow tip that gets the producer it names flowing and keeps it flowing for 20 s more (`flowWatch`). A move that only brings the Flow goal "closer" is not a tip.
- **Every tip carries `saves`:** seconds, or `Infinity` when the wait would not have ended without it.
- **Quiet after a change.** For 20 s after the player changes the board in any way, following a tip included, there is no tip (`RULES.tips.quiet`; `adviceQuiet(g)` is what is left of it). The same request is not made twice within 60 s (`repeatAfter`): after Speed was bought on a Lab, no tip asks for Speed on a Lab until a minute has passed. Both read the game's own log of the last changes (`Game.edits`, written by every action and by research, saved with the game), so they hold wherever the adviser is asked.
- **A tip that left does not come back** while the board, the goal and the kind of wait are the same: no A, B, A.
- **No tip reverses a card.** A Router that favours a Lab is never turned away from it (goal 13 asked for it). A wire into a Lab is only removed when the card's own line says so (`Meanwhile.cuts`, goal 21). Nothing a hint or a line had the player build is sold, cut or rerouted by a tip.
- **A tip does not blink.** Once given, it stays on offer while the board does not change and it still saves 15 s (the same bar as for a new tip: one that falls below it is gone until the board changes); another tip takes its place only by ending the wait 3 s and 5% sooner (`keepWithin`, `keepShare`).
- **Savings near the bar are checked twice.** The look-ahead runs at half-second steps. When the end of the wait was reached in the look-ahead and the tip saves less than a fifth of it, the tip is tried once more against doing nothing at a tenth of a second (`ADVICE.fine`, `checkShare`), and is only given if the saving is still there; that second measurement is the saving it is given with.
- **What it can say** (the sentences are built by `SAY`, one builder per kind): wire something into a Lab, or something better; speed up a full Lab, or all full Labs with Bulk Upgrade; speed up a Well or machine that runs flat out on the way to what is short; build a second Lab; put a Well on a free deposit and wire it to a Lab, a Market or a machine short of that material; sell what backs up or is not sold at all; build a Refiner on a Well that sells raw; press Favour on a Router (never away from a Lab); research Lab Speed, Deep Analysis or Wider Demand when they pay for themselves inside the wait; send the ordered material to a Market; and for the Flow goal, the producer furthest from flowing and its fix.
- **No sentence is longer than 90 characters** (`RULES.tips.maxLength`): `tests/advice.test.ts` runs every builder of `SAY` over every material, node and tech name in the content with eight-digit prices. The wording no longer depends on the input (`text.mouse === text.touch`): a sentence names the thing and the button ("buy Speed on the Ember Well (50¢)"), never a click, a drag or a key.
- **Flow tips fix one producer at a time.** A Flow tip names the Well or machine that holds Flow back (`Advice.culprit`) and what to do about it (`Advice.node`). It is true when that producer flows with the fix, stays flowing, and would not have without it; `saves` is how much sooner the goal completes (it can be 0 on a board with more than one thing wrong, which takes a tip for each). A fix after which the goal would complete later than by doing nothing is dropped; where no fix passes, the goal's valve does.
- **What it never says:** anything the player cannot afford, anything that does not pass the tests above, or anything for a wait that ends within 12 s anyway. When something sells over demand the tip says so, and making more of that material is never worth saying because it is measured at the surplus price.
- **In the copies nobody plays,** but orders still pay. Nothing is bought; the order the game has is claimed 10 s after it fills (`claimAfter`); no new order is rolled. From then on the copy is paid what the orders to come are worth on its own sales (`ordersWorth` in `src/orders.ts`: the first three candidates at 55/30/15%, sized from what the copy sells). Before this, a tip that sold less looked better than it is and one that sold more looked worse: orders are a third of a card player's α in a long wait.
- **Measured against the real game.** Every tip a card player is offered on order seeds 0–14 is replayed in a plain copy of the game (orders rolling and claimed 10–12 s late) with the tip done and with nothing done, when it first appears and every 5 s while it stays on the card; a Flow tip is timed to the goal completing. Two independent harnesses did this, one on the tests' card player and one on the pacing tool's players.
  - *The players the targets judge* (the pacing tool's newcomer; the same at 10 s an action; the same following a tip only after 45 s): 30 tips come on offer in fifteen runs, and 420, 168 and 412 timings (four or two order sequences each) are all better: none the same, none worse. No tip left the card and came back on an untouched board, none appeared within 20 s of a change, none promised under 15 s; they delivered 78% of the promise at the least (13–15 s against 15–18 promised) and 92–94% at the median. On the tests' card player: 30 timed, 30 better.
  - *A player who ignores the lines* and follows hints and tips is offered far more: 138 tips in fifteen runs, seven followed a run, one about every 36 s through the Mist wait (20 s of quiet, then 15 s on offer), and the Lens at 22:13–26:21. Timed under two order sequences: 846 timings, 845 better, one the same, none worse; for the same player at 10 s an action, 680 timings, 671 better and 9 worse, by 1 to 20 s in waits of three to nine minutes (six of the nine are one tip, a Glint Well wired into the Lab the player already has, the move the Glyph card's line avoids); under four sequences, 5 of 1,692 and 12 of 1,392 were worse. About one timing in seven delivered under 15 s. Order pay comes in lumps, the look-ahead pays the copy their average, and which order comes next is luck: for that player a promise is an average, not a guarantee. It cannot be made exact without changing how orders pay.
- **Cost:** a fresh verdict takes 14–17 ms at the median, 37–48 ms at the 90th percentile and up to 155 ms on a card player's boards (measured in Node on a deserialised copy, 1,685 verdicts). It is kept for 15 game seconds while the board does not change, and for no more than 15% of the wait it was worked out for (`ADVICE.refresh`, `refreshShare`), so every other call is free. That cache, and the memory of tips that left the card, belong to the Game object asked: a caller that hands over a freshly deserialised copy each time gets neither (the quiet and the 60 s rule still hold, they are in the game).

## Time away

Nothing before the first Lens. After it: 50% of the live rate, measured on a copy of the game, for up to 2 hours (8 with Long Absence).

## Where the pacing lands

`npm run pacing` plays five players on order seeds 0–3 (seed 0 is the order sequence every real new game starts with) and checks each run against the targets. `tests/pacing.test.ts` pins every target for all five on seeds 0–3, so `npm test` notices a change that moves the pacing.

- **mainline, greedy:** fast players who know the game: one action per 3–4 s. From the moment a new machine cannot be paid for they bank half of what comes in and may spend the other half on upgrades; once they own Bulk Upgrade, nodes of a kind that want the same upgrade get one press of "Upgrade all" when they are at least half of that kind.
- **newcomer:** does only what the goal card says, hint and "while you wait" line, one action per 6 s, claims 8–16 s late, and follows a tip once it has been on offer for 15 s of a wait. Never builds a Router, upgrades or wires anything unprompted.
- **newcomer10:** the same person at 10 s per action.
- **cardonly:** the newcomer who never follows a tip, not even on the Flow goal. The cards have to carry the game alone, so this player has targets too. Their Flow goal is passed by its valve: ready 100 s after it came up, claimed 8–16 s later.

Every target holds on all fifteen seeds. Measured (seeds 0–3, then the range over seeds 4–14):

| Fast players (8 + 22 runs) | Seeds 0–3 | Seeds 4–14 | Target |
|---|---|---|---|
| First machine / Lab / research | 0:21–0:22 / 0:39–0:40 / 1:05–1:06 | 0:21–0:23 / 0:37–0:40 / 1:03–1:07 | by 0:45 / 1:30 / 2:30 |
| Longest wait in the first 2 min | 6–8 s | 6–8 s | 10 s |
| First Glyph | 6:37–7:26 | 6:42–7:41 | 6:00–8:00 |
| First Lens | 15:03–17:00 | 14:55–16:24 | 14:30–19:00 |
| Time on "Build a Fabricator" | 161–281 s | 169–271 s | 300 s |
| First Paradox | 25:41–28:27 | 25:00–29:07 | not before 24:00 |
| Longest stretch with free hands before 10:00 / before the Lens | 47–52 s / 48–82 s | 46–52 s / 49–85 s | 60 s / 120 s |
| Credits from sales and orders at the Lens | 81–85% | 80–85% | 65% |
| Presses of an Upgrade button before the Lens | 25–42, of them 1–2 "Upgrade all" | 23–54 | — |

| The card players (4 + 11 runs each) | Seeds 0–3 | Seeds 4–14 | Target |
|---|---|---|---|
| **newcomer:** first Lens | 19:15–19:43 | 19:03–20:06 | 18:30–23:00 |
| longest time on any one goal | 200–214 s (Glyph; Mist on one seed) | 194–220 s (Glyph) | 240 s |
| time on "Build a Fabricator" | 139–154 s | 118–172 s | 240 s |
| tips offered / followed in a run | 2 / 2 | 2 / 1–2 | — |
| smallest / median saving of the tips followed | 16 s / 64–65 s | 15–66 s / 59–66 s | at least 15 s |
| longest stretch with free hands | 76–103 s | 63–105 s | — |
| credits from sales and orders at the Lens | 77% | 77% | 65% |
| **newcomer10:** first Lens | 21:26–21:36 | 21:27–22:14 | by 30:00 |
| longest time on any one goal | 216–237 s | 212–236 s | 300 s |
| time on "Build a Fabricator" | 94–124 s | 95–129 s | (300 s) |
| **cardonly:** first Lens | 20:18–20:28 | 19:58–21:03 | by 32:00 |
| longest time on any one goal | 208–230 s (Glyph) | 212–226 s (Glyph) | 360 s |
| time on "Build a Fabricator" | 112–140 s | 107–142 s | (360 s) |
| time on the Flow goal (no tip: the valve) | 114–116 s | 108–116 s | 108–118 s on seeds 0–3 (pinned) |
| longest stretch with free hands | 90–107 s | 89–138 s | — |

The fast players' numbers are, to the second, those of the round before: nothing in this round touches what they do.

Where the time goes (seed 0, seconds on each goal):

| | goals 1–10 | Spark | first order | Router | expand | Glyph | Flow | β | Mist | Prism | three orders | Fabricator | Lens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| newcomer | 3:51 | 111 | 56 | 35 | 16 | 211 | 51 | 97 | 151 | 40 | 14 | 139 | 34 |
| newcomer10 | 4:30 | 138 | 55 | 52 | 20 | 237 | 56 | 73 | 210 | 50 | 13 | 102 | 30 |
| cardonly | 3:51 | 130 | 56 | 36 | 16 | 230 | 114 | 69 | 143 | 40 | 9 | 140 | 34 |

The newcomer's two tips on seed 0: "Wire a Glint Well's port to the Lab: Glint is 1 α each in a Lab." during the Spark wait (16 s promised) and "The Spark Refiner needs more Ember: buy Speed on the Ember Well (50¢)." on the Flow goal.

Things to know before changing a number:

- **The cards carry the game, and most of that is their lines.** With hints alone (no "while you wait" lines, no tips) the tests' card player reaches the Lens at 44:13; with the lines at 19:21; with lines and tips at 18:35–18:55 (`tests/playthrough.test.ts`, which claims after one action instead of 8–16 s late; `npm run baseline`). That player still takes the one fix the Flow ring leads to even when it follows no other tip; the pacing tool's `cardonly` takes none at all, and without the lines reaches the Lens at 46:11–52:45 (`npm run pacing -- --policies=cardonly --noMeanwhile --minutes=75`). The lines are worth what the tips used to be worth: a player who reads the hint and never the line under it is back at three quarters of an hour.
- **The card players are obedient, and the tool can make them less so.** They follow a line the moment the hint has nothing left to ask, completely, and a tip exactly 15 s after it appears. What a less obedient person gets (seeds 0–14; none of this has a target):

  | Player | First Lens | Longest goal |
  |---|---|---|
  | cardonly, as judged | 20:04–21:22 | 208–230 s |
  | cardonly at 10 s per action (`--hands=10`) | 21:36–22:28 | 213–242 s |
  | cardonly, gets to each line 60 s late (`--lineDelay=60`) | 20:49–22:17 | 234–260 s |
  | cardonly, 120 s late | 22:08–23:35 | 259–278 s |
  | cardonly, leaves out the Glyph line (`--skipLine=make-glyph`) | 24:02–25:10 | 322–365 s |
  | cardonly, no lines at all (`--noMeanwhile`) | 46:11–52:45 | 765–1,019 s |
  | newcomer, as judged | 19:12–20:15 | 194–220 s |
  | newcomer, follows a tip after 45 s (`--tipDelay=45`) | 19:52–20:43 | 208–230 s |
  | newcomer, follows every second tip (`--tipEvery=2`, `--tipEvery=2,1`) | 19:46–20:49, 19:42–20:31 | 194–230 s |
  | newcomer10, follows a tip after 45 s | 21:18–22:33 | 213–242 s |

  Tips now move the Lens by about a minute, whoever follows them and however late.
- **The window is narrow by construction.** A fast player may not be kept from the first Glyph past 8:00 (which caps Ember Deposits and Assembly) nor reach the Lens before 14:30 (which keeps Assembly, Breeze Deposits and the Fabricator's price where they are), and no goal may take the newcomer four minutes. The Glyph wait is the newcomer's longest, 194–220 s, with both card lines followed.
- **The fast players are noisy.** Their habits (bank half while saving, upgrade with the rest) make a run's Lens move by a minute for no reason a person would notice: with Fabrication 180α cheaper, mainline on seed 1 researches it 22 s sooner and builds the Fabricator 58 s later. Over 30 order seeds the range is what counts (Lens 14:49–17:00, Fabricator goal 161–281 s, one run of 60 with free hands over 120 s before the Lens, at 720α and at 900α alike); a margin of under half a minute on one seed is inside that noise.
- **Free hands are normal now.** The target of never more than 60 s without a tip is gone with the small tips. The longest stretch in which the card asks nothing and no tip is on offer is 64–108 s for the newcomer, at the end of the Mist wait or of the Glyph wait; the cards' lines are done by then and nothing the adviser can honestly offer saves 15 s.
- **The fast players' free hands before the Lens** were at 120–157 s on a few seeds once Commerce was hidden (they used to research Wider Demand on impulse while saving for the Fabricator, and the order generator then asked for things sold at a trickle). `RULES.orders.marketRate` is what brought it back under 92 s.
