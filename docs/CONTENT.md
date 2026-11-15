# Flowstate — Content & Numbers

Every number in the pitch build, as tuned with the pacing bot (`npm run pacing`). The source of truth is the code: tables and `RULES` in `src/content.ts`, goals in `src/goals.ts`, the adviser's own tunables in `ADVICE` (`src/advice.ts`). The rules these numbers plug into are in [PITCH_PLAN.md](./PITCH_PLAN.md) section 2, as amended by the decisions noted below (fan-out, Flow, orders, the adviser). `DESIGN.md` and `README.md` still describe the older build.

**State of the tuning:** tuned for the newcomer who does what the goal cards say, their "while you wait" lines included. Every wait of more than a minute has a sequence of two or three lines (one for the Flow goal, whose wait the line ends), shown one at a time, so the card has something to do in most of a wait: the player who reads the cards and takes no tip has nothing to do for 35–38% of the time to the first Lens, never for more than 85 s at a stretch (it was 42–50% and up to 138 s). The adviser's tips have become rarer still: the newcomer who follows the cards is offered at most one in a demo and follows none, because the lines do what the tips used to. Every target holds on order seeds 0–14 for all six players of the pacing tool, and `tests/pacing.test.ts` pins them on seeds 0–3; the last section has the numbers.

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

The first time a material keeps selling over its demand for 3 seconds, the game sets `seenSurplus` (saved) and raises a one-off `surplus` event naming it, so the demand gauge can be introduced when the rule first bites. **Since this round it bites during the demo, for most players.** The card players (newcomer, card-only, newcomer10) first sell Glint over demand at 17:32–18:05 (newcomer10 19:47–20:27), two to three minutes before their first Lens, in all 45 runs: it is the line of the Fabricator card that wires each Well with a Lab of its own to the Market too (`sell-raw`; left out, nothing sells over demand before the Lens). A fast player first sells over demand at 12:35–20:50, before the first Lens in 23 of 30 runs (Glint in 22 of them, Murk once), each of those after the press of Upgrade all that goal 20 asks for (every Well one level faster). Before this round that was 0 of 45 and 2 of 30. The player who reads no line never sells over demand before the Lens. This was left as it is: the moment was built to introduce demand whenever it comes, and the lines are worth their seconds measured at the surplus price; whether Market Lens and the Commerce branch should appear at minute 13–20 of the demo is a call for the design. When it happens during a wait for credits, the adviser's sentence says so and Wider Demand joins its candidates.

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

**Which recipe a machine takes.** A machine built from a port, or wired into, takes the unlocked recipe that gets the largest share of its inputs from what is wired in, then the one with the fewest inputs, then the first in the table above (`pickRecipe` in `src/economy.ts`). So an Assembler fed Spark makes Glyph even after Reclamation (Coil wants Spark and Clay: half its inputs), and a Fabricator fed Prism makes Lens after Dynamo research. It used to take the recipe with the dearest output among all that used any of its inputs, and after Reclamation the Assembler of the Glyph card made Coil. A machine still without a recipe takes one as soon as research gives it one for what is wired in: at once when the research is bought or granted (`grantTech` calls `adoptRecipes`), and on the next tick when the tech arrives any other way, a save among them (`tests/recipes.test.ts`).

## Nodes

The nth node of a type costs `base × growth^(n-1)`, rounded. Deleting a node refunds what it would cost to buy back, plus its upgrades. A node from a save of the public version, which charged less for upgrades, refunds no more than it cost there and since (`GNode.legacyPaid`, set when such a save is loaded; see "Saves" below): a Well with ten levels of Speed bought there refunded ten times what it had cost.

| Node | Base ¢ | Growth | Needs | Rate |
|---|---|---|---|---|
| Well | 10 | ×1.15 | a free deposit | 1.0/s (Ember, Breeze: 0.8/s) |
| Refiner | 50 | ×1.15 | Refining | one craft per recipe time |
| Assembler | 600 | ×2.5 | Assembly | one craft per recipe time |
| Fabricator | 7,250 | ×1.15 | Fabrication | one craft per recipe time |
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

An expansion is one undo step like any other (pressed by mistake, it was 200–7,800¢ gone for good): undo refunds it in full and takes the plot and its deposits away again, and redo buys the same plot back. Anything placed on the new plot since is a later step and comes off first.

### Undo

- **Undo stops at the last claim.** Claiming a goal clears the undo history, so nothing that earned a reward can be taken back after it is paid (undoing the Well of "Place a second Well" after its claim left the 10¢ and the next goal met for nothing; undoing the level of "Upgrade a Well" gave back 50¢ on top of the reward). Claiming an order does not clear it.
- **Before the claim, an undo that takes away what a ready goal stands on takes its Claim too** (`unready` in `src/actions.ts`); a redo gives it back. Goals counted by events (a Lens made, seconds of Flow held, orders filled) keep their Claim. This goes a little beyond what was asked for: without it, a player could undo the very thing a ready card was about and still claim it.
- `tests/undo.test.ts` holds all three.

## Data

A Lab turns each item into Data by tier: T0 → 1 α, T1 → 3 α, T2 → 5 β, T3 → 8 γ (×1.5 with Deep Analysis). Silt is the exception: a by-product is worth 1 α, not 3 (`MATERIALS.silt.study`; three Silt make one Clay, which is worth 3 α, so reclaiming it neither gains nor loses Data). One β is worth 4 α and one γ 12 α when an order's pay is converted.

## Flow

Wells and machines count once they are at least 20 s old and some path of wires leads from them to a Market or a Lab (six Wells into a Void are not a supply line); one is *flowing* at 90% utilisation or more. Cutting a weak producer off still hides it, at the price of everything it made. Flow is the flowing share, smoothed over 3 s. Once the goal chain unlocks the meter, every sale is multiplied by `1 + 0.2 × Flow`. 100% for 10 s with six or more producers is Flow State.

**The Flow goal asks for 95% for 10 seconds** (`RULES.flow.holdShare`, `holdSeconds`). On a board of fewer than nineteen producers that is every one of them. It has to be earned: when the meter unlocks, a card player usually has one or two producers short. The Spark Refiner is short of Ember (an Ember Well makes 0.8/s, the Refiner wants 1), and on most seeds the Ink Refiner is short of Murk. Each is one fix, named by the card's line (below: "The Spark Refiner needs more Ember: buy Speed on its Ember Well."). The first Flow State arrives with the goal. At the old 75% the goal completed with no action in every run; at 90% it still did for a newcomer with ten producers. A fast player has usually fixed everything already and passes in a quarter of a minute.

**The valve.** Once the goal has been on the card for 90 s (`RULES.flow.valveAfter`; `goalAge(g)`, from the saved `Game.goalAt`), all but one producer flowing, held for the same 10 s, also completes it. The bar itself does not move. The ten seconds are counted from the moment the valve opens, however long the board has been at "all but one" before: the goal's count starts at 0 at second 90 and the goal is ready at second 100, never sooner. (Until two rounds ago the seconds held before the valve counted, and the goal completed the instant it opened, with nothing on the card to show for it.) If the board drops under "all but one" the count stops, and starts from nothing when it is back.

The valve is for the board with one producer nobody can honestly fix: a machine fed through a Router that favours a Lab (goal 13's card asked for that Router, and no tip turns it back) dips under 90% however its Wells are upgraded. The adviser says nothing about such a board, because a Flow tip has to get the producer it names flowing and keep it so; the valve passes it at 100 s (tested in `tests/advice.test.ts` and `tests/goals.test.ts`). The 90 s run on game time, so a pause or time away does not open it, and they are saved with the game: a save made at second 80 completes 20 s after it is loaded, a save made while the count is running picks it up where it was, and a save from before this rule starts its 90 s when it is loaded.

**The valve's second step: all but two, from 180 s** (`RULES.flow.valveAfter2`; `flowSlack(g)` is 0, 1 or 2; the count is `Game.flowNear2`, saved). A player who builds ahead, a second Glyph Assembler bought with the credits in hand as the goal comes up, leaves two or three producers short that no single change puts right: with "all but one" alone the chain stopped there for good (the rules review's failing test, now `tests/holdflow.test.ts`). Its ten seconds are counted from second 180 in the same way. That board, left alone, has three producers short, so even the second step does not pass it: the player has to act, and the card's line names the one fix there is (the Spark Refiner short of Ember). A player who does the line's step, and any tip after it, meets the goal under the second step, 190 s after it came up (the test allows up to 205 s). So does the review's own script, which reads no line and looks at the tips every 16 s: on the Flow goal the adviser names the line's fix after all when the goal would not complete without it within its look-ahead (the valve's steps included), and that board gets one tip (Speed on an Ember Well) and completes at 190 s. Deleting the extra Assembler again lets it complete within a minute, as before.

**The later steps: one more short every 120 s, to one producer flowing** (`RULES.flow.valveEvery`; `valveSlack(age)`: 0, 1 at 90 s, 2 at 180 s, 3 at 300 s, 4 at 420 s...; `flowSlack(g)` holds it to the producers counted less one). Every board on which anything flows passes in the end. The case it is for: a save from the public version, migrated, played on by a player who follows only the tips, arrives three producers short (after the tips' Breeze Well wire, the Mist Refiner starved and the two Glyph Assemblers short), one of them needing two changes; the adviser offers only fixes that get a producer flowing by themselves, so with two steps that player stayed on the goal for good. Now it passes at 310 s (`tests/holdflow.test.ts`, from the fixture in `tests/fixtures/public-version.ts`); a reader of the line still passes at 191 s, and the review's built-ahead board left alone at 310 s. The steps from the third on share one count, `Game.flowNearLate` (saved; `tickValve(g, dt)` after Flow each tick): it starts at the third step's opening, starts again from nothing when the board drops under the bar, and runs on when the next step lowers the bar under a board already holding it. A board of six producers with one flowing passes at 550 s. The look-ahead of the adviser's Flow tips is unchanged (it sees the first two steps only), so a tip that fixes a board three short is still given rather than left to a valve minutes away; the scripted players never stay 300 s on the goal, and every number of the pacing tables for seeds 0–14 is unchanged.

**The Flow goal has a line**, in words that name the node its step acts on (`Meanwhile.say`, `flowLineWords(g)`): "The Spark Refiner needs more Ember: buy Speed on its Ember Well." (the same for touch; "its Ember Well" where several Ember Wells stand and one of them feeds the Refiner, as the step's own sentence says it), or, for a port with nowhere to send its goods, "The Mist Refiner makes more Mist than is taken: wire its port to the Market.". It used to say "Click the Flow ring, then give the machine it picks what it lacks", but the ring jumps to the producer furthest from flowing, and the one change that helps can be for another (on the review's built-ahead board the ring picks a Glyph Assembler and the step is Speed on the Ember Well, for the Spark Refiner). Once done, it reads its own words: "Click the Flow ring to find what holds Flow back, and give it what it lacks." (touch: "Tap the Flow ring…"). Its step is the one change that gets the short producer flowing (`flowFix(g)`): a level of Speed on the Well or machine that feeds it, when that supplier runs flat out and one level is enough, or its port wired to a Market. It shows only while there is such a change, waits 10 s after a Speed level for the rates to settle (`FLOW_SETTLE`), and is ticked off once everything flows. The card-only player used to sit through the valve doing nothing (108–116 s on the goal); with the line it buys one level of Speed on an Ember Well for 50¢, on all fifteen seeds, and spends 30–40 s on the goal. A player who reads no line is offered no Flow tip either (the adviser's tip and the line are the same step, and a tip never repeats a line), except on a board the valve cannot pass (see the second step above): the valve takes them through in 109–115 s on the seeds where a producer is short.

**What the card can show.** `goalView(g).flow` is `{ pct, running, of, need, valve?, slack? }` while the Flow goal is active: the smoothed Flow, how many producers are flowing out of how many counted, the share needed right now (0.95, "all but one" once the valve is open, "all but two" from 180 s), `valve: true` from the moment the valve opens (absent before), and `slack`, how many producers may be short once it has (absent before 90 s; then a whole number from 0 to the producers counted less one: 1, 2, then one more every 120 s; 0 on a board of one producer, whose bar the valve cannot lower). `goalView(g).progress` is the count itself, `[held, 10, 's']`: under the valve it runs from 0 to 10 between second 90 and second 100, or second 180 and 190.

## Orders

Unlocked by the Spark goal. One order at a time: "deliver N of X", counted from sales at any Market, no timer.

- **X:** something refined that the player makes right now. What reaches a Market comes first, then what does not; within each, the newest first. "Reaches a Market" means sold at 0.08 items/s or more (`RULES.orders.marketRate`; the smallest order fills in 100 s at that rate). It used to be 0.02, the bar for "is produced" (`minRate`, unchanged): a trickle of Mist past a busy Assembler then counted as selling, an order for eight of it took minutes or went stale, and a fast player saving for the Fabricator sat with free hands for up to 157 s. The first, second and third on that list are picked with chances 55 / 30 / 15%, never the same material twice running.
- **N:** 45–90 s of what currently reaches Markets of that material (not of what is made), at least 8. "Currently reaches" is measured on a copy of the game run forward for 40 s (`src/forecast.ts`), so a line built a moment ago counts for what it will sell. That forecast is what a new order costs on the page: 2–3 ms, up to 47 ms under a 4× CPU throttle. It was left as it is: a coarser step (0.5 s for 0.25 s) halves the cost and changes what orders ask for on the pinned seeds (mainline on seed 1 reached the Lens at 15:40 instead of 17:00), and no measurement the game already keeps gives the same numbers.
- **The first order** (until one has been filled) only asks for something already selling, sized to 32–37 s of it, at least 3: it counts from the moment it appears and fills in 30–40 s with nothing rerouted.
- **Reaching no Market:** an order can ask for something the player makes but does not sell (N is then 8). `orderView(g).reachesMarket` is false, with `rate` and `eta` beside it, and the adviser says where to reroute.
- **Pay:** credits worth half the items at full price, plus Data in the tier the player is shortest of. In the items' own tier that is what a Lab would have made from them. Converted into another tier (Glyph is β in a Lab; an order that pays α for it converts) only a quarter survives (`RULES.orders.convertShare`): ten Glyph pay 50 β, or 50 α rather than 200 α. At full conversion one Glyph order paid 400 α in a lump, and which material the next order happened to ask for moved the first Lens by up to three minutes.
- An order with no delivery for 120 s is quietly replaced (`staleSeconds`).
- **So is an order that cannot be filled any more.** At the rate its material sells right now, an order that would take more than 5 minutes to fill (`RULES.orders.retire.eta`) for 20 s running (`hold`), once it is 30 s old (`after`: a new order's material may only just be starting to sell), is quietly replaced by one for something else (`hopeless` in `src/orders.ts`; the moment it first fell behind is saved as `Order.slowSince`). A machine built on the line that feeds the Market takes the material first: the Spark an order was counting goes into the Glyph Assembler, the Shard into the Prism Assembler, and the order read "about 24 min", then "over an hour", with a trickle still arriving so that the 120 s rule never fired. An order with steady deliveries that keep it within five minutes is never swapped, however long it takes (`tests/orders.test.ts`). In practice this rule now does most of what `staleSeconds` did.

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
| 13 | Route more to a Lab than to the Market (a Router on the Spark Refiner, one press of Favour on the Lab's wire; judged by what the Router sends) | 30α |
| 14 | Expand the board | 60¢ |
| 15 | Assemble your first Glyph | Flow meter + 150¢ ★ |
| 16 | Hold 95% Flow for 10 seconds (after 90 s: all but one producer; after 180 s: all but two; then one more every 120 s, to one flowing; 10 s counted from then) | 150¢ |
| 17 | Study Glyph for β (40 β in hand) | 50α |
| 18 | Make your first Mist | 50α |
| 19 | Assemble your first Prism | Bulk Upgrade + 600¢ + 40β ★ |
| 20 | Upgrade all your Wells at once | 1,200¢ + 60β |
| 21 | Build a Fabricator | 40β |
| 22 | Make your first Lens | demo complete ★ |
| free play | Clay · Coil · Dynamo · Paradox | 200¢ · 600¢ · 1,800¢ · 7,500¢ |

★ = big celebration (`Goal.big`, and `big: true` on the goal's `goal-claimed` event): six goals, and the seventh is the first Flow State. The first Spark and the first Prism were added to fill the two longest stretches without one. Where the peaks fall for the newcomer on seed 0 (claims): Shard 1:41, Lab 2:22, Spark 5:43, Glyph 10:52, the Flow goal 11:24 (the first Flow State comes with it), Prism 16:35, the Lens 20:46. For a fast player (mainline, seed 0): Spark 3:05, Glyph 7:02, Prism 12:07, the Lens 15:32. The longest stretch between two is a little over five minutes (Spark to Glyph for the newcomer, and Flow to Prism); without the two new ones it was eight and a half (Lab to Glyph) and seven and a half (Flow State to Lens).

**Goal 20 is "Upgrade all your Wells at once"** (id `bulk-upgrade`; mouse: "Select a Well and press Upgrade all beside Speed: every Well gets one level more.", touch: "Tap a Well and tap Upgrade all beside Speed: every Well gets one level more."). It was "Fill three orders", which the orders filled on the way had always met by the time it came up: it showed Claim and nothing else. Bulk Upgrade now comes with the first Prism (S1 is granted with goal 19's reward, the tech tree says "Reward for the goal “Assemble your first Prism”"), and goal 20 is done by one press of Upgrade all on the Wells made after it came up (`bulkSince`: `Game.bulkAt`, set only by a press that raised Wells, at or after `goalAt.t`). Upgrade all on Refiners or Labs does not count, and an undo of the press takes the goal's readiness back with its refund (`Game.bulkAt` is part of the undo step, `Snapshot.bulkAt`), as an undo does for the other goals; a redo makes it ready again. Its progress saves toward the cheapest Well's next level (`cheapestWellSpeed`); the reward is unchanged, so the chain is still 22 goals and pays the same. The newcomer spends 15–23 s on it, the fast players 10–90 s (they press it when their own habits say so). A save from the older build that arrives with goal 20 ready is checked again once on load, so an old "three orders" Claim is not handed out for the new goal.

**Goal 13 is judged by what the Router sends** (`routerSendsLab`): it favours a Lab by its settings, and the wires from it to Markets carry no more than its wires to Labs. A Router turned toward a full Lab spills to the Market, and the card said "more to a Lab" while more went to the Market. On a board where nothing has passed the Router yet, the settings decide.

**Every card that has the player make something new also says to sell it, and goals 11 and 18 complete on the sale.** Goals 11 and 18 end "…and sell the Spark", "…sell the Mist"; goals 15 and 19 say "…wire it to the Market, then wire Spark into it to make Glyph" (goal 10 already said so for Ink). A newcomer does what the card says to the letter: without those words Spark, Glyph and Prism were never sold, the Spark Refiner sat blocked for minutes, and the Fabricator had to be paid for out of Shard and Ink. Goals 11 and 18 now complete on the first Spark (Mist) sold, not made: the sale is the last gesture of the hint, and a card that is ready shows Claim and no hint, so made, the card turned with the sale still to do, and the first order (which asks for what is selling, the Spark most of all) waited on a Spark nobody sold. The titles stay "Make your first Spark", "Make your first Mist" (the tech tree's tests find the goals by title). Goals 15 and 19 still complete on the first Glyph (Prism) made: their hints put the Market first, so the wire to it is already there.

**The Assembler and Fabricator cards say where to build from, and put the Market before the wire that completes the goal.** The hints of goals 15, 19 and 21 used to say "build an Assembler" and leave the place to the player. They now read:

| Goal | Hint (the same for mouse and touch) |
|---|---|
| 15 | "Research Assembly, build an Assembler from the Ink Refiner's Ink port, wire it to the Market, then wire Spark into it to make Glyph." |
| 19 | "Build another Assembler from the Mist Refiner's port, wire it to the Market, then wire Shard into it to make Prism (two for every Mist)." |
| 21 | "Research Fabrication, then save up and build a Fabricator from the Prism Assembler's port: orders and a high Flow get you there faster." |

Built from the named port (dragged into empty space, or tapped on a phone), the machine is the first choice on the menu, arrives wired and set to its recipe, and costs one gesture less than placing it and wiring it. The Market comes second in the sentence on purpose. A goal completes with the first Glyph (or Prism), and a card that is ready shows Claim and no hint: with "…wire Spark into it too and sell its Glyph" the gesture still to come when the card turned was the sale. The pacing tool's newcomer at 10 s an action left it out on three seeds of fifteen (an order's Claim took the turn), sold no Glyph for six minutes until a tip said so, and spent 214–220 s on the Fabricator goal instead of 95–129 s. In the new order the goal cannot complete before the wire to the Market exists. Goal 22's hint is unchanged ("Feed the Fabricator one Prism and two Glyph for every Lens."): the Prism is wired by then, and the Glyph wire is what is left; its lines now name the wire or wires still missing, and its progress counts the inputs wired (see "While you wait"). The three hints are 131–135 characters; the longest in the game are 141 (goal 13, mouse) and 148 (goal 10, touch), and they take the same number of lines on the card at every size tried (two at 1440 px and on a phone held sideways, three at 390 and 360 px). The scripted card players (`tests/cardPlayer.ts`, the pacing tool's `cardStep`) build and wire in the order the hints give.

**A goal that asks for a research and then a machine says so to the adviser.** `Goal.step(g)` returns `{ tech, then }`, where `then` is the price of what the card has the player buy straight after the research: the Assembler for goal 15, a Well and a Refiner for goals 11 and 18, the Fabricator for goal 21. What the card shows is unchanged (Data toward the research). A step also names what the credits are for (`what`, `thenWhat`: "the Fabricator", "the expansion"), and `waitInfo(g).name` passes that on, so a card or a tip can say what is being saved for.

**Goal 13 names the Spark Refiner** as the place for the Router ("Build a Router from the Spark Refiner's port and wire it to a Lab and to a Market, then select the Router and press Favour on the Lab's wire."). Shard is studied since goal 7 and Ink by the line of goal 11; Spark is the one refined material nothing studies yet, so that is where a Router toward a Lab earns Data.

**Goal 2 names the build bar** ("Pick the Well in the build bar and click the free Glint deposit."; touch: "Tap Well in the build bar, then tap the free Glint deposit."). It said "hotbar" (mouse) and "bottom bar" (touch); the bar sits down the side on a desktop, and every touch hint calls it the build bar.

**What a card is about: `goalFocus(g)`** in `src/goals.ts` returns the ids of the nodes the card is about, for the interface to frame: the nodes its hint names, by goal (the port it starts from, then where it goes: the Ink Refiner for goals 10 and 15, the Spark Refiner for goal 13, the Mist Refiner for goal 19, the Prism Assembler for goal 21, the maker of what the Fabricator lacks and the Fabricator for goal 22, and so on); while the goal is a wait, or its hint names no node, the nodes of the line's next step (`lineFocus` in `src/advice.ts`: the port the gesture starts from, then where it goes; for the Flow line the short producer, then what feeds it). It is empty when the step is a Well on a free deposit or the board's expansion, which are not nodes; `lineAdvice(g).deposit` names the deposit. `tests/meanwhile.test.ts` checks it at every goal on the card players' boards (every id a node on the board, and the node the hint or line means).

### While you wait

Seven goals carry "while you wait" lines (`Goal.meanwhile`, a list now: `Meanwhile[]`, each line with an `id`), shown one at a time: the first line that applies and is not done yet, or the last one, ticked, once all are done (`meanwhileAt(g)` is `{ line, step, of }`, `meanwhileOf(g)` the line). `goalView(g, touch).meanwhile` is `{ text, done, step?, of? }`, with `step` and `of` ("2 of 2") when the goal has more than one line; it is absent when the goal has none, is ready to claim, or no line applies to the board right now. A line is one sentence of at most 90 characters (`RULES.tips.maxLength`); touch wording names no click, drag, hover or key, and mouse wording no tap. Each is true in the real game on the card player's own board, and nothing it asks for is undone by a later card or by a tip (`tests/meanwhile.test.ts`). `lineAdvice(g)` and `goalFocus(g)` always follow the line the card shows.

| Goal | Lines, in order (id: sentence) | Done when | Worth to the card-only player |
|---|---|---|---|
| 11 Make your first Spark | 1. `ink-lab`: "Drag from the Ink Refiner's Ink port to the Lab too: studied Ink is 3 α each." (touch: "Tap the Ink Refiner's Ink port, then tap the Lab too: …") | Ink reaches a Lab (straight, or through a Router, Merger or Silo) | 108–126 s |
| | 2. `glint-lab`: "Build a Lab from the port of the Glint Well that only sells: studied Glint is 1 α each." | a Glint Well reaches a Lab | 15–29 s |
| 15 Assemble your first Glyph | 1. `well-labs`: "Give each new deposit a Well and a Lab built from its port: each pair is 1 α a second." | two pairs on the first expansion's deposits, or three in all | 88–115 s |
| | 2. `expand-labs`: "Expand the board again and give both new deposits a Well and a Lab of its own." | two pairs on deposits of the second expansion or later, or five in all | 113–157 s (goals 15 and 18 together) |
| 16 Hold 95% Flow | `flow-fix`: "The Spark Refiner needs more Ember: buy Speed on its Ember Well." (names the node the step acts on; once done: "Click the Flow ring to find what holds Flow back, and give it what it lacks.") | every counted producer flows | 71–84 s |
| 18 Make your first Mist | 1. `expand-labs`: what is left of it | as above | (above) |
| | 2. `speed-pairs`: "Buy Speed on each Well with a Lab of its own, and on that Lab when it is full." | every pair has its level where it counts | 11–29 s |
| 19 Assemble your first Prism | `cut-glyph`: "You have the β you need: cut the wire from the Glyph Assembler to the Lab." | no wire takes Glyph into a Lab | 93–114 s (goals 19 and 21 together) |
| 21 Build a Fabricator | 1. `cut-glyph`, if it is still to do | as above | (above) |
| | 2. `sell-raw`: "Fabrication is researched: wire each Well with a Lab of its own to the Market too." | every Well with a Lab of its own also reaches a Market | 22–49 s |
| 22 Make your first Lens | 1. `prism-fab`: "Wire the Prism Assembler's port to the Fabricator: a Lens takes one Prism." 2. `glyph-fab`: "Wire the Glyph Assembler's port to the Fabricator: a Lens takes two Glyph." | the Fabricator is fed that input | not a wait: the hint's two wires, one at a time |

"Worth" is measured on the pacing tool's card-only player (no tips, claims 8–16 s late) on order seeds 0–14: the seconds on the goals a line stands on, in a whole run with the line and in one that leaves that line alone (`npm run pacing -- --summary --policies=cardonly --skipLine=<id> --seeds=0,1,…,14`). `tests/meanwhile.test.ts` holds every line at 15 s or more on seeds 0–3.

- **Waits a player can work in.** Every wait of more than a minute now has two or three lines in sequence (the Flow goal has one: it ends the wait). The measure is "nothing to do" (the last section): for the card-only player it was 42–50% of the time to the first Lens, with stretches of up to 138 s; it is now 35–38%, and never more than 85 s at a stretch, on all fifteen seeds (the targets are 40% and 90 s).
- **One line is worth less than 15 s on one seed:** `speed-pairs`, 11 s on seed 6 (11–29 s, median 22). It stays: without it the card-only player has nothing to do for 39–43% of the time, over the 40% target on three seeds. `glint-lab` is worth exactly 15 s on two seeds.
- **A line spends only what the card is not saving for.** A line's step keeps back the credits for the card's own next purchase: the Assembler after Assembly, the Well and Refiner after a deposit research, the Fabricator (`ADVICE.lineReserve`, `cardReserve` in `src/advice.ts`; `--lineReserve=0` in the pacing tool turns it off). Without it, `expand-labs` on goal 15 spent the Assembler's 600¢ on the expansion and that goal took 350 s.
- **The total was re-tuned to stay where it was.** The new lines are worth α and credits: at the old prices the card-only player reached the Lens at 19:04–20:07 and a fast player at 14:46. Assembly is 1,250α (was 1,140), Breeze Deposits 1,850α (was 1,420), the Fabricator 7,250¢ (was 7,100): the card-only player's Lens is 20:19–20:59 (it was 19:58–21:03), the fast players' 15:26–16:42 (14:55–17:00).
- **The last ten minutes are bound by credits.** What they wait for is the Fabricator. A line that spends credits early (`glint-lab`, `speed-pairs`) shortens its own goal and gives some of it back later: the Lens is no sooner with them (a few seconds later on most seeds). They are there for the waits, which is what they were asked for.
- **A Well gets a Lab of its own.** A Lab studies one item a second and takes its inbox in the order the materials first arrived there. A raw material wired into the Lab the player already has pushes the dearer Shard and Ink out of it, and a late arrival can be starved for a quarter of an hour (Glyph: see "Glyph in a crowded Lab" under the adviser). A Well with its own Lab is a plain 1 α a second.
- **A pair is one Well and one Lab.** One Well wired into two Labs has 1 α a second to give, not 2; Glyph that reaches a Lab through a Router is still studied. Pairs are matched one Well to one Lab, and "studied" follows the material through Routers, Mergers and Silos. `Meanwhile.cuts(g)` lists the wire into the Lab in that case (the Router's), which is the one to cut.
- **The Glyph line is the only place a wire into a Lab is cut, and it is the card that says so.** It shows only while Fabrication's β is covered (in hand, or still to come from the rewards of goals 19 and 20), no Fabricator stands and the credits for one are short (`Meanwhile.when`); `Meanwhile.cuts(g)` names the wires. It comes on goal 19 now, where the Prism Assembler is saved for in credits, and stays on goal 21 if it is still to do. The word is "cut" everywhere, as on the inspector's button ("Cut wire").
- **After the demo the β is needed again.** Dynamo and Paradox cost 300 and 250 β. A player who has cut the Glyph wire and runs out of β there is told "Wire the Glyph Assembler's port to a Lab: Glyph is 5 β each in a Lab." (a wait that would never end is never met with silence). That is the one tip that goes against a card's line, and only in free play.
- **A line read late or left out** costs what the table says and not much more (card-only player, seeds 0–14; first Lens): as judged 20:19–20:59; each line read 60 s after it appears 21:32–22:30, 120 s after 22:00–22:55; leaving out `ink-lab` 21:11–22:08, `glint-lab` 20:06–20:45, `well-labs` 23:01–24:13 (and up to 401 s on the Mist goal), `expand-labs` 20:42–21:38 (up to 357 s on the Mist goal), `flow-fix` 20:24–21:08 (the valve then: 109–116 s on that goal), `speed-pairs` 20:15–20:56, `cut-glyph` 21:59–22:44 (289–334 s on the Fabricator goal), `sell-raw` 20:53–21:38. Leaving out every line is the game without lines: 50:09–55:04, with up to 1,242 s on the Mist goal (`--noMeanwhile --minutes=75`).
- **What was tried and dropped:** a Lab of its own for the Shard on goal 11 (worth too much: the Lens near 19:00 even at the new prices); a third expansion on goal 18 (its Murk deposit needs a Lab of 400¢ more, the research often came first, and the 1,250¢ bought a plot nothing stood on); `expand-labs` without the reserve (above).
- The card players (`tests/cardPlayer.ts`, the pacing tool's newcomers) follow a line like a hint, one gesture at a time, before any tip, and they do it through `lineAdvice` and `applyAdvice`: the step they take is the one the card's "Show me" acts out.

**The line's next step: `lineAdvice(g)`.** So that the card can put a "Show me" on the line, `lineAdvice(g)` in `src/advice.ts` returns the next concrete step of the line the card shows, as an `Advice`, the shape a tip has: something the interface can point at and `applyAdvice(g, a)` can carry out. One step at a time, read to the letter (`text.mouse === text.touch`):

| Line | Steps, in order | Sentences (examples) | What the `Advice` carries |
|---|---|---|---|
| `ink-lab` | the Ink Refiner's Ink port to the Lab (the one with the most room, if there are several) | "Wire the Ink Refiner's Ink port to the Lab: Ink is 3 α each in a Lab." | `wire { from, to, port }`, `node` = from |
| `glint-lab` | a Lab from the port of the Glint Well that only sells | "Build a Lab from the Glint Well's port (130¢): Glint is 1 α each in a Lab." | `build: 'lab'`, `node` = the Well, `port: 0` |
| `well-labs` | a Well that stands unwired gets a Lab from its port; otherwise the first free deposit gets a Well | "Place a Well on the free Glint deposit (17¢), then build a Lab from its port." then "Build a Lab from the new Glint Well's port (130¢): a Lab of its own is 1 α a second." | `build: 'well'`, `deposit` (no `to`); then `build: 'lab'`, `node` = the Well, `port: 0` |
| `expand-labs` | the same on deposits of the second expansion or later; when none of those is free, the board first | "Expand the board (500¢): it brings new deposits for a Well and a Lab of its own." then the two above | `expand: true`, `cost` = the expansion's price; then as above |
| `flow-fix` | the one change that gets the short producer flowing: a level of Speed on what feeds it, or its port wired to a Market | "The Spark Refiner needs more Ember: buy Speed on its Ember Well (50¢)." | `upgrade: 'speed'`, `node` = the supplier, `culprit` = the short producer; or a `wire` |
| `speed-pairs` | the first pair still at its old pace: a level on the Well when what its Wells give is at or under what the Lab studies, otherwise on the Lab | "Buy Speed on the Glint Well (50¢): its Lab of its own then gets more to study." / "Buy Speed on the Glint Well's own Lab (50¢): the pair then gives more α." | `upgrade: 'speed'`, `node` |
| `cut-glyph` | the first wire that still takes Glyph into a Lab | "Cut the wire from the Glyph Assembler to the Lab: sold, each Glyph is 20¢." | `cut { wire, from, to }`, `node` = from |
| `sell-raw` | the first Well with a Lab of its own and no wire to a Market | "Wire the Murk Well's port to the Market too: half its Murk is then sold, not studied." | `wire`, `node` = the Well |
| `prism-fab`, `glyph-fab` | the maker's port (the one with the most to spare) to the Fabricator | "Wire the Glyph Assembler's port to the Fabricator: a Lens takes two Glyph." | `wire`, `node` = the maker |

- It is `null` when the goal has no line, the line is done or does not apply, the goal is ready, or the step cannot be paid for right now (it is back the moment the credits are there, the reserve above kept).
- `Advice.expand` only ever comes from here: no tip expands the board. `applyAdvice` presses Expand for it.
- It promises nothing: `saves` is absent and `eta` is 0, because nothing is measured. It runs no copy of the game and leaves the game untouched (microseconds a call; `tests/meanwhile.test.ts` times it), so it can be asked on the page at every refresh. It is not held back by the 20 s of quiet after a change.
- Followed from the card players' boards (the tests' player with and without tips, and the pacing tool's card-only player and newcomer, seeds 0–3), every line ends done in a bounded number of steps, every step could be paid for and done when it was given, and through whole runs it never gives a step without a line or for a line that is done.
- **Goal 22's lines and progress.** A Fabricator built from the Prism Assembler's port, as goal 21 says, has its Prism and no Glyph: the card shows "2 of 2" and asks for the Glyph wire. One built anywhere else gets the Prism line first. `goalView(g).progress` counts the inputs wired, `[fed, 2, 'inputs wired']`, then `[0, 1, 'Lens']`, and `goalView(g).inputs` lists them (`{ mat, name, fed }`, goal 22 only). The Lens follows within 30 s of the last wire either way.
- **A tip never says what the line is saying.** While a step is on offer here, `advice(g)` does not give it as a tip (the same action, or the same sentence about another node of the same name), nor another ending to its first gesture: a Well on the deposit the line wants a Well on, wired into the Lab the player already has, or a wire from the Well the line wants a Lab on. The Flow line and the adviser's Flow tip are the same step, so a player who reads the Flow line gets no Flow tip, and one who reads no line gets neither (the valve then; see Flow), with one exception: where the goal would not complete without that step within the adviser's look-ahead, valve steps included, the Flow tip is given all the same (a candidate the line names is marked `line` and kept by `judgeFlow` only then). The card's own "one voice" rule (src/ui/advice-tip.ts) still hides a tip that asks for the line's next step while the line is up, so on the page the line says it once.

## Tech tree

| ID | Tech | Cost | Requires | Gives |
|---|---|---|---|---|
| **Processing** | | | | |
| P1 | Refining | goal 3 | — | Refiner, Shard |
| P2 | Murk Deposits | 45α | Lab | Murk Wells, Ink + Silt, Void |
| P3 | Ember Deposits | 215α | P2 | Ember Wells, Spark |
| P4 | Assembly | 1,250α | P3 | Assembler, Glyph |
| P5 | Breeze Deposits | 1,850α | P4 | Breeze Wells, Mist, Prism |
| P7 | Fabrication | 720α + 100β | P5 | Fabricator, Lens |
| P6 | Reclamation | 300α + 25γ | P4 | Clay, Coil |
| P8 | Dynamo | 1,200α + 300β + 100γ | P6, P7 | Dynamo |
| P9 | Paradox | 2,500α + 250β + 450γ | P8 | Paradox |
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
| S1 | Bulk Upgrade | goal 19 | L1 | "Upgrade all" button |
| S3 | Auto-balance | 50β | S1, L4 | one-click Router weights |

How the prices are meant to work:

- **The spine (P2 → P3 → P4 → P5 → P7)** is what the goal chain asks for, and it is priced for the newcomer who does what the cards say, their "while you wait" lines included: each of its waits is about three and a half minutes for that player and never four (the longest goal 203–216 s). The lines are what makes that player's α (the Ink and the Glint studied, then up to five Wells each with a Lab of its own, then Speed on those pairs). This round's lines made more of it, and Assembly (1,140 → 1,250α) and Breeze Deposits (1,420 → 1,850α) went up to keep the Lens where it was (see "While you wait"). Without the lines the same prices are far too dear: the cards alone, no line and no tip, reach the Lens at 50:09–55:04, and a player who reads the tips but no line at 24:28–28:55.
- **Paradox is 250β** (it was 500β): free play's last research was a 37-minute save of the Data a player has least of after the demo.
- **Fabrication is 720α, below the curve** (it was 1,180α; its 100β are unchanged). By then the Assemblers take most of the Shard, Ink and Spark the Labs lived on, and a card player's α income drops. The card's line for the last wait (stop studying Glyph, sell it) is only true when that wait is for the Fabricator's price (7,250¢ now, 7,100¢ when this was measured), and what a wait is for depends on who is playing. The numbers that follow are from the round that set the 720α. At 1,180α it was for α for every card player. At 900α it was for credits for the tests' card player and for the newcomer who takes tips, but the pacing tool's card-only player held 7,565–8,466¢ when the research came through, on all fifteen seeds: from the board that player had when the line came up, taking the wire away ended the wait sooner in 10 of 45 trials, at the same moment in 32 and later in 3. At 720α it ends sooner in 45 of 45 for the card-only player (11–32 s) and for the newcomer (15–48 s); on that round's boards, which differ by a gesture here and there, `tests/meanwhile.test.ts` measured 12–31 s and 25–36 s on seeds 0–3, and in whole runs the card-only player's Fabricator goal is 5–41 s shorter with the line on all fifteen seeds. The fast players research Fabrication with 1,000–3,500¢ in hand and wait for credits whatever it costs: over 30 order seeds their Lens is 14:49–17:00 at 720α and 14:42–16:51 at 900α. Ember Deposits, Assembly, Breeze Deposits and the Fabricator's price were left alone then: lowering any of them brings a fast player's Lens toward the 14:30 limit (this round raised three of them, above).
- **Efficiency Tuning needs Assembly** (P1 and P4): it is priced in β, and before Assembly there is no β to pay with, so it only stood in the tree as something that could not be bought.
- **Ember Deposits is the cheap one** because a fast player has nothing else to do while saving for it: above about 220α their hands are idle for more than a minute, which the plan does not allow before minute 10.
- **Side techs are impulse buys.** Each is small next to the spine tech it competes with, so every kind of player picks them up along the way: α for what helps before the first Glyph (Lab Speed, Merger, Pipes Mk II: 150α together), β after it. Wider Demand is β for that reason: nothing sells over demand before the first Glyph, and at 200α it cost a fast player most of a minute there (it is hidden until the first surplus now). Luxury Buyers is the exception: dearer than Fabrication's β, so it comes after.
- **γ does not exist before the first Lens,** so anything priced in γ is free-play content. The late Processing techs need all three kinds of Data, which keeps Tier 1 items worth studying to the end.

## The adviser

`src/advice.ts`. When the active goal is a wait, the adviser may name one thing worth doing meanwhile. It is measured, not assumed: each candidate is tried on a copy of the game against an untouched copy, with the real rules, and tips are ranked by the seconds they save. The structural advice is on the goal cards now ("While you wait" above), so the adviser says little: the newcomer who follows the cards is offered at most one tip in the whole demo (none on six seeds of fifteen), and followed none in fifteen runs. Silence is its normal state. The player who reads the tips and no line is offered six to nine in a demo and follows six to nine.

- **For the tech tree:** `savingFor(g)` is the research the card is saving for right now (its step's tech, `'P4'` while "Assemble your first Glyph" waits for Assembly), or `null` (no such step, the card ready to claim, or the tech owned). `researchDelay(g, id)` is the seconds by which researching `id` now would push that research back, at the income the card's own count uses: what it spends of the Data that research still lacks, divided by how fast that Data comes in. It is 0 when it would not delay it (no such research, the same tech, Data of another kind or to spare) and `Infinity` when the Data it spends has nothing coming in. Both read the board only and run no copy of the game (`tests/advice.test.ts`).
- **"The Lab is full" says which Lab:** "the Lab you have" when there is one, "the Lab it feeds" when the port already feeds a full one, "every Lab studying β" when all that study that tier are full (`SAY.labFull`).
- **The order wait is the first order's only.** An order is a wait for the adviser on "Fill your first order" alone; later orders run beside the cards and are not something the card asks for.

- **A wait** is a goal whose next step is a purchase the player cannot pay for yet (credits or Data), the Flow goal, or an order goal whose order is still filling. `waitInfo(g)` gives `{ unit, have, need, eta, name }` for the first kind (`name` is what is being saved for: "Assembly", "the Fabricator"); `waitKind(g)` names any of them.
- **A research and the machine after it are one wait.** Where the card asks for both (goals 11, 15, 18, 21), the wait is for whichever is further off, the Data or the credits, and `waitInfo` and the tips are about that one.
- **A tip is offered for one of three reasons only.** It saves at least 15 s of the wait (`ADVICE.minSaves`; when the wait outlasts the 300 s look-ahead its end is an estimate, and the tip must also save 4% of it: `estSaves`, `estShare`). Or it ends a wait that would otherwise never end. Or it is a Flow tip that gets the producer it names flowing and keeps it flowing for 20 s more (`flowWatch`). A move that only brings the Flow goal "closer" is not a tip.
- **The share of the wait a measured tip must save stays at 1%** (`ADVICE.minShare`). Raising it to 8% was tried, on the idea that a promise of 15 or 20 s in a wait of five minutes is inside what the orders' lumps of pay move the real outcome by. Replayed in the real game on seeds 0–14 (see "Measured against the real game" below): the card-following players are offered and follow exactly the same tips at either share. For the player who follows tips and ignores the lines the worse timings did not reliably drop (6 of 688 at 1% against 13 of 650 at 8% at 6 s an action; 10 of 644 against 4 of 632 at 10 s; a commit earlier, with the hints of goals 15 and 19 in their first new order, 14 of 730 against 5 of 708 and 6 of 634 against 1 of 614), while a tenth of that player's tips went, true ones among them, and their slowest Lens moved from 26:20 to 28:50 (27:49 to 31:00 at 10 s). On a twenty-minute save with no orders, 8% heard three tips instead of nine and took three minutes longer. `npm run pacing -- --minShare=0.08` tries a share; `tests/advice.test.ts` holds the 1% and shows what 8% costs.
- **Every tip carries `saves`:** seconds, or `Infinity` when the wait would not have ended without it.
- **Quiet after a change.** For 20 s after the player changes the board in any way, following a tip included, there is no tip (`RULES.tips.quiet`; `adviceQuiet(g)` is what is left of it). The same request is not made twice within 60 s (`repeatAfter`): after Speed was bought on a Lab, no tip asks for Speed on a Lab until a minute has passed. Both read the game's own log of the last changes (`Game.edits`, written by every action and by research, saved with the game), so they hold wherever the adviser is asked.
- **A tip that left does not come back** while the board, the goal and the kind of wait are the same: no A, B, A. Checked on the twenty mid-game saves on which "buy Speed on the Lab" and "build a second Lab" had been seen to take turns (at 91, 123 and 137 s of one wait): the adviser of two rounds ago does it on those saves, at those seconds; this one says each thing once, asked directly or through the worker's long-lived copy, with the order's Claim pressed or left. `tests/advice.test.ts` pins it on the boards of the scripted player who follows tips and no lines, 20 s and 60 s into the three long waits.
- **A tip never says what the card's line is saying.** While `lineAdvice(g)` has a step on offer, that step is not a tip, nor is another ending to its first gesture (see "The line's next step" above). The card-following players never met the overlap (they do the line before a tip can come). The player who follows tips and never reads a line loses those tips, by design: over seeds 0–14 that player's Lens was 22:20–26:20 with the overlap allowed, 23:55–26:31 without the very step, 24:33–26:31 without the other endings either (measured before the hints of goals 15 and 19 were reordered; 24:23–26:20 on the rules of the round before this one, 24:28–28:55 now that Assembly and Breeze Deposits are dearer), and no goal takes them longer than it did (the longest 252–422 s before, 279–424 s after). They are slower by half a minute to two minutes at the fast end and not at all at the slow end, and not stranded.
- **No tip reverses a card.** A Router that favours a Lab is never turned away from it (goal 13 asked for it). A wire into a Lab is only cut where the card's own line says so (`Meanwhile.cuts`, goals 19 and 21), and there it is the line's own step that says which ("Cut the wire from the Glyph Assembler to the Lab: sold, each Glyph is 20¢."); as a tip that sentence can only appear for a second such wire that reads differently. Nothing a hint or a line had the player build is sold, cut or rerouted by a tip.
- **Glyph in a crowded Lab.** A Lab takes its inbox in first-arrival order (the rule stands). A player who has wired raw Wells into the one Lab before goal 17 ("Study Glyph for β") and then wires the Glyph in, as that card says, gets next to no β: on the card players' boards bent that way (their Wells' own Labs removed and the Wells wired into the shared Lab; or every Well wired into it as well), 0 to 5 β of the 40 came in four minutes, and the goal took from four minutes to more than fifteen (never within fifteen in 21 of 96 trials on the pacing tool's boards, seeds 0–3). What the game says: the card's wait line reads "nothing is bringing in β yet" from the first second; there is no alert chip (nothing is starved or blocked: the Assembler sells what the Lab does not take); and 21 s after the Glyph wire, when the quiet after the player's own change is over, the tip is "Build a Lab from the Glyph Assembler's port (130¢): the Lab you have is full." in 90 of the 96 trials and "Research Lab Speed (50α): your Lab is full, and Labs then study twice as fast." in the other six. Followed, the goal is done 47–54 s later (for the Lab Speed tip, 97–111 s after the wire). That is said in time and is enough, so nothing was added; `tests/advice.test.ts` pins the tip, its timing and the outcome on eight such boards.
- **A tip does not blink.** Once given, it stays on offer while the board does not change and it still saves 15 s (the same bar as for a new tip: one that falls below it is gone until the board changes); another tip takes its place only by ending the wait 3 s and 5% sooner (`keepWithin`, `keepShare`).
- **Savings near the bar are checked twice.** The look-ahead runs at half-second steps. When the end of the wait was reached in the look-ahead and the tip saves less than a fifth of it, the tip is tried once more against doing nothing at a tenth of a second (`ADVICE.fine`, `checkShare`), and is only given if the saving is still there; that second measurement is the saving it is given with.
- **What it can say** (the sentences are built by `SAY`, one builder per kind; three more builders are the steps of a line, used by `lineAdvice` only): wire something into a Lab, or something better; speed up a full Lab, or all full Labs with Bulk Upgrade; speed up a Well or machine that runs flat out on the way to what is short; build a second Lab; put a Well on a free deposit and wire it to a Lab, a Market or a machine short of that material; sell what backs up or is not sold at all; build a Refiner on a Well that sells raw; press Favour on a Router (never away from a Lab); research Lab Speed, Deep Analysis or Wider Demand when they pay for themselves inside the wait; send the ordered material to a Market; and for the Flow goal, the producer furthest from flowing and its fix.
- **No sentence is longer than 90 characters** (`RULES.tips.maxLength`): `tests/advice.test.ts` runs every builder of `SAY` over every material, node and tech name in the content with eight-digit prices. The wording no longer depends on the input (`text.mouse === text.touch`): a sentence names the thing and the button ("buy Speed on the Ember Well (50¢)"), never a click, a drag or a key.
- **Flow tips fix one producer at a time.** A Flow tip names the Well or machine that holds Flow back (`Advice.culprit`) and what to do about it (`Advice.node`). It is true when that producer flows with the fix, stays flowing, and would not have without it; `saves` is how much sooner the goal completes (it can be 0 on a board with more than one thing wrong, which takes a tip for each). A fix after which the goal would complete later than by doing nothing is dropped; where no fix passes, the goal's valve does.
- **What it never says:** anything the player cannot afford, anything that does not pass the tests above, or anything for a wait that ends within 12 s anyway. When something sells over demand the tip says so, and making more of that material is never worth saying because it is measured at the surplus price.
- **In the copies nobody plays,** but orders still pay. Nothing is bought; the order the game has is claimed 10 s after it fills (`claimAfter`); no new order is rolled. From then on the copy is paid what the orders to come are worth on its own sales (`ordersWorth` in `src/orders.ts`: the first three candidates at 55/30/15%, sized from what the copy sells). Before this, a tip that sold less looked better than it is and one that sold more looked worse: orders are a third of a card player's α in a long wait.
- **Measured against the real game.** Every tip a card player is offered on order seeds 0–14 is replayed in a plain copy of the game (orders rolling and claimed 10–12 s late) with the tip done and with nothing done, when it first appears and every 5 s while it stays on the card; a Flow tip is timed to the goal completing. Numbers of the round before this one, on the pacing tool's players (the harness is the independent checker's, pointed at that build). They were not measured again: the newcomer is now offered almost no tips, and the player who ignores the lines plays at dearer prices (24:28–28:55 to the Lens now):
  - *The players the targets judge:* the newcomer is offered 30 tips in fifteen runs and follows 29; 416 timings under four order sequences are all better, none the same, none worse. At 10 s an action: 30 offered, 15 followed, 164 timings under two sequences, all better. No tip left the card and came back on an untouched board, none appeared within 20 s of a change, none promised under 15 s; they delivered 84–85% of the promise at the least (about 14 s against 16–18 promised) and 94–95% at the median.
  - *A player who ignores the lines* and follows hints and tips is offered far more: 111 tips in fifteen runs, 102 followed (seven a run), and the Lens at 24:23–26:20; at 10 s an action 110 and 96, and 25:55–27:49. Timed under two order sequences: 688 timings, 678 better, 4 the same and 6 worse (by 3 to 10 s); at 10 s an action 644 timings, 623 better, 11 the same and 10 worse (by 2 to 10 s). The worse ones are a handful of tips counted several times over: Ink or Silt wired into the Lab the player already has during the Glyph or the Mist wait ("…it gives more Data than Glint", "…you are throwing away 1 α each"), a wait of five to eight minutes in which a promise of 16–56 s came out 2–10 s short of nothing under one of the two order sequences. About one timing in nine delivered under 15 s. Order pay comes in lumps, the look-ahead pays the copy their average, and which order comes next is luck: for that player a promise is an average, not a guarantee. It cannot be made exact without changing how orders pay, and a higher bar on the share of the wait did not do it either (above).
- **Cost:** a fresh verdict takes 14–17 ms at the median, 37–48 ms at the 90th percentile and up to 155 ms on a card player's boards (measured in Node on a deserialised copy, 1,685 verdicts). It is kept for 15 game seconds while the board does not change, and for no more than 15% of the wait it was worked out for (`ADVICE.refresh`, `refreshShare`), so every other call is free. That cache, and the memory of tips that left the card, belong to the Game object asked: a caller that hands over a freshly deserialised copy each time gets neither (the quiet and the 60 s rule still hold, they are in the game).

## Time away

Nothing before the first Lens. After it: 50% of the live rate, measured on a copy of the game, for up to 2 hours (8 with Long Absence).

## Saves

`deserialize` in `src/state.ts` loads what it can and gives every field a sound value, rather than refusing a whole save over one part it cannot use (`tests/saves-old.test.ts`, which brings in the rules review's tests):

- **A save from the public version** (it has no `goal` field) charged less for everything. Each of its nodes gets `legacyPaid` = what it cost there, and never refunds more than that plus what is spent on it here (`refundOf`). Deleting its three Assemblers refunded 5,850¢ for 1,389¢ paid, and a Well with ten levels of Speed 9,091¢: the Fabricator for the price of a few deletes. The cap survives a save and load of this version; a node bought here has none. A player who does what the cards say plays such a save to the Lens with no goal standing for good.
- **A damaged save loads and plays.** A node of a kind this version does not know (a later version's) is dropped with its wires and the rest of the board is kept; a `null` entry, a second node with an id already in use and a wire from a port the machine does not have are dropped; a pipe tier this version does not have becomes the best it has; missing or broken fields (a node's levels, its position, the board, the deposits, the stats, `nextId`, numbers that JSON wrote as `null` or that are infinite) get the new-game value, and `nextId` is always above every id in use. Twenty-one kinds of damage are tested: each loads, plays a minute, survives a second save and load, and leaves no NaN, no infinity and no duplicate id.
- **A save that cannot be read at all is copied aside** to `flowstate-save-v1.bak` (`BACKUP_KEY`) before the new game the start screen offers can overwrite it. A readable one leaves no copy.
- **Old saves and the new goal 20.** A save of the round before this one that arrives with "Fill three orders" ready is checked again once, so its Claim is not handed out for "Upgrade all your Wells at once".

## Where the pacing lands

`npm run pacing` plays six players on order seeds 0–3 (seed 0 is the order sequence every real new game starts with) and checks each run against the targets; `-- --summary --seeds=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14` gives the tables below. `tests/pacing.test.ts` pins every target for all six on seeds 0–3, so `npm test` notices a change that moves the pacing.

- **mainline, greedy:** fast players who know the game: one action per 3–4 s. From the moment a new machine cannot be paid for they bank half of what comes in and may spend the other half on upgrades; once they own Bulk Upgrade, nodes of a kind that want the same upgrade get one press of "Upgrade all" when they are at least half of that kind.
- **newcomer:** does only what the goal card says, hint and "while you wait" lines, one action per 6 s, claims 8–16 s late, and follows a tip once it has been on offer for 15 s of a wait. Never builds a Router, upgrades or wires anything unprompted.
- **newcomer10:** the same person at 10 s per action.
- **cardonly:** the newcomer who never follows a tip. The cards have to carry the game alone, so this player has targets too, among them the "nothing to do" measure.
- **nolines:** the newcomer who never reads a "while you wait" line: the hints and the tips only. Slower, never stranded.

**Nothing to do** (the NOTHING TO DO table, `Bot.nothing` in `tools/pacing.ts`): up to the first Lens, the time in which the player's hands are free, the goal is not ready to claim, no order is, and the card's line has no step that can be done now (`lineAdvice(g)` is null). A tip on offer does not count as something to do. A line the player leaves alone still does, so the measure only compares runs that read the same lines.

| Seeds 0–14 | Before this round | Now | Target |
|---|---|---|---|
| cardonly: nothing to do, share of the time to the Lens | 42–50% (521–616 s) | 35–38% (431–463 s) | at most 40% |
| cardonly: longest stretch of nothing to do | 89–138 s | 63–85 s | at most 90 s |
| newcomer | 40–47%, up to 105 s | 35–38%, up to 85 s | — |
| newcomer10 | 28–33%, up to 80 s | 17–23%, up to 78 s | — |
| fast players | 9–13%, up to 52 s | 8–10%, up to 52 s | — |
| nolines (the hints and the tips) | — | 8–12%, up to 84 s | — |

The newcomer and the card-only player play the same game now, to the second: the one tip the newcomer is offered on nine seeds is never followed.

| Fast players (30 runs, seeds 0–14) | Before this round | Now | Target |
|---|---|---|---|
| First machine / Lab / research | 0:21–0:23 / 0:37–0:40 / 1:03–1:07 | the same | by 0:45 / 1:30 / 2:30 |
| Longest wait in the first 2 min | 6–8 s | 6–8 s | 10 s |
| First Glyph | 6:37–7:41 | 6:59–7:36 | 6:00–8:00 |
| First Lens | 14:55–17:00 | 15:26–16:42 | 14:30–18:00 |
| Time on "Build a Fabricator" | 161–281 s | 133–195 s | 300 s |
| First Paradox | 25:00–29:07 | 24:52–27:42 | not before 24:00, by 30:00 |
| Longest stretch with free hands before 10:00 / before the Lens | 46–52 s / 48–85 s | 46–52 s / 47–111 s | 60 s / 120 s |
| Credits from sales and orders at the Lens | 80–85% | 83–85% | 65% |
| Presses of an Upgrade button before the Lens | 23–54 | 29–49, of them 2–5 "Upgrade all" | — |

| The card players (15 runs each, seeds 0–14) | Before this round | Now | Target |
|---|---|---|---|
| **newcomer:** first Lens | 19:03–20:06 | 20:19–20:59 | 19:00–23:00 |
| longest time on any one goal | 194–220 s | 203–216 s (Glyph, Mist or Fabricator) | 240 s |
| time on "Build a Fabricator" | 118–172 s | 190–216 s | 240 s |
| tips offered / followed in a run | 2 / 1–2 | 0–1 / 0 | — |
| longest stretch with free hands | 63–105 s | 63–85 s | — |
| credits from sales and orders at the Lens | 77% | 80–81% | 65% |
| **newcomer10:** first Lens | 21:26–22:14 | 21:58–22:41 | by 30:00 |
| longest time on any one goal | 212–237 s | 201–220 s | 300 s |
| time on "Build a Fabricator" | 94–129 s | 186–211 s | (300 s) |
| **cardonly:** first Lens | 19:58–21:03 | 20:19–20:59 | 20:00–23:00 |
| longest time on any one goal | 208–230 s (Glyph) | 203–216 s | 360 s |
| time on "Build a Fabricator" | 107–142 s | 190–216 s | (360 s) |
| time on the Flow goal | 108–116 s (the valve) | 30–40 s (its line) | 45 s on seeds 0–3 (pinned) |
| **nolines:** first Lens | 24:23–26:20 | 24:28–28:55 | by 32:00 |
| longest time on any one goal | 332–401 s (Mist) | 359–514 s (Mist) | — |
| tips offered / followed in a run | 111 / 102 in fifteen runs | 6–9 / 6–9 a run | — |

Where the time goes (seed 0, seconds on each goal; claims 8–16 s late are in the goal they follow):

| | goals 1–10 | Spark | first order | Router | expand | Glyph | Flow | β | Mist | Prism | Upgrade all | Fabricator | Lens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| newcomer, cardonly | 3:49 | 115 | 58 | 35 | 16 | 202 | 32 | 69 | 206 | 35 | 22 | 196 | 32 |
| newcomer10 | 4:29 | 125 | 57 | 51 | 20 | 220 | 37 | 85 | 186 | 63 | 26 | 203 | 34 |
| nolines | 3:49 | 157 | 56 | 36 | 16 | 319 | 109 | 67 | 377 | 34 | 19 | 133 | 32 |
| mainline | 1:32 | 94 | 62 | 38 | 6 | 131 | 18 | 90 | 141 | 56 | 15 | 172 | 19 |

Things to know before changing a number:

- **The cards carry the game, and most of that is their lines.** The card-only player who reads no line at all reaches the Lens at 50:09–55:04 (`npm run pacing -- --policies=cardonly --noMeanwhile --minutes=75`), with up to 1,242 s on the Mist goal; with the lines at 20:19–20:59. The player who reads the tips and no line is at 24:28–28:55 (28:25–30:24 at 10 s an action). That player's slow end moved by two and a half minutes this round: Assembly and Breeze Deposits are dearer, and the lines that pay for that are what this player does not read.
- **The fast players moved with the prices.** At the old prices and with the new lines a fast player reached the Lens at 14:46 and the card-only player at 19:04 (`--set=tech.P4=a1140,tech.P5=a1420,node.fabricator.base=7100`). The new prices put both back in their windows. The fast players' Fabricator goal is shorter than it was (133–195 s, was 161–281 s).
- **The Fabricator wait is now one of the card player's longest** (190–216 s, was 107–142 s): the lines before it spend credits on Labs, Wells and Speed that the Fabricator used to get, and its price went up by 150¢. The `sell-raw` line is what keeps it under four minutes; the Glyph and Mist waits are 203–216 s.
- **The window is narrow by construction.** A fast player may not be kept from the first Glyph past 8:00 (which caps Ember Deposits and Assembly) nor reach the Lens before 14:30 (which keeps Assembly, Breeze Deposits and the Fabricator's price up), and no goal may take the newcomer four minutes.
- **The fast players are noisy.** Their habits (bank half while saving, upgrade with the rest) make a run's Lens move by a minute for no reason a person would notice. Over 30 runs the range is what counts; a margin of under half a minute on one seed is inside that noise. Their longest stretch with free hands before the Lens reached 111 s on one run (mainline, seed 5), under the 120 s target.
- **A less obedient card player** (card-only, seeds 0–14; none of this has a target): at 10 s per action 21:58–22:41; reading each line 60 s after it appears 21:32–22:30, 120 s after 22:00–22:55; leaving out one line, see "While you wait". The newcomer's tip what-ifs (`--tipDelay`, `--tipEvery`) no longer change anything: that player follows no tip.
