# Flowstate — Content & Numbers

Every number in the pitch build, as tuned with the pacing bot (`npm run pacing`). The source of truth is the code: tables and `RULES` in `src/content.ts`, goals in `src/goals.ts`, the adviser's own tunables in `ADVICE` (`src/advice.ts`). The rules these numbers plug into are in [PITCH_PLAN.md](./PITCH_PLAN.md) section 2, as amended by the decisions noted below (fan-out, Flow, orders, the adviser). [DESIGN.md](./DESIGN.md) describes the build system by system.

**State of the tuning:** tuned to one rule of progression and one of pacing. *Progression: a new thing arrives only after the player has grown what they have.* Between the chapters the goal card asks for a rate ("Make 1 Glass a second"), which is reached with more Drills, more machines, Speed or more land, as the player likes, and the next step of the Processing spine cannot be researched until that goal is claimed ("Goal chain" below). The claim pays most of what that research costs, so the long waits for Data of the builds before are gone and the time is spent widening the line instead. *Pacing: waits in which the player has nothing to do are kept short.* The targets are set for the newcomer who does what the goal cards say and takes no tip: nothing to do for at most 25% of the time to the first Phone, never for more than 50 s at a stretch, never for more than 90 s on one goal, and the first Phone between 17:30 and 21:00; the fast players make it no sooner than 14:00. On order seeds 0–14 that player has nothing to do for 13–16% of the time (144–178 s), at most 27–45 s at a stretch and 54–80 s on one goal (the save for the Fabricator), and makes the Phone at 17:54–18:44. In the build before the growth goals the Phone came at 17:36–18:11 with nothing to do for 23–27% of that time: the demo is as long as it was, and a tenth of it went from waiting to building. By the first Phone that player has three lines of Glass, two each of Plastic and Copper, two Circuit Assemblers and two Screen Assemblers, on a board expanded twice; before, it was one Refiner of each and five Drills each with a Lab of its own. The adviser's tips stay rare: the newcomer who follows the cards is offered none in fifteen runs. Every target holds on order seeds 0–14 for all six players of the pacing tool, and `tests/pacing.test.ts` pins them on seeds 0–3; the last section has the numbers.

## Materials

The materials are things everyone knows, so that a recipe can be guessed and a line that stands still can be understood: a Phone is Sand, Oil, Ore and Quartz, by way of Glass, Plastic, Copper and Silicon, a Screen and two Circuits. They were first given invented names, and the ids in the code and in saves are those (`glint` Sand, `murk` Oil, `ember` Ore, `breeze` Quartz, `shard` Glass, `ink` Plastic, `silt` Tar, `spark` Copper, `mist` Silicon, `clay` Rubber, `prism` Screen, `glyph` Circuit, `coil` Cable, `lens` Phone, `dynamo` Laptop, `paradox` Robot; the node type `well` is the Drill, `void` the Dump). No name is longer than seven letters: the adviser's sentences are measured with the longest. T0 is raw, T1 refined, T2 an assembled part, T3 a finished product; the game says it in those words, never "Tier 2".

| Material | Tier | Value ¢ | Demand /s | Made by |
|---|---|---|---|---|
| Sand | T0 | 1 | 2.0 | Drill |
| Oil | T0 | 1 | 2.0 | Drill (Oil Deposits) |
| Ore | T0 | 2 | 1.5 | Drill (Ore Deposits) |
| Quartz | T0 | 2 | 1.5 | Drill (Quartz Deposits) |
| Glass | T1 | 3 | 1.5 | Refiner |
| Plastic | T1 | 4 | 1.2 | Refiner |
| Tar | T1 | 0.5 | 0.5 | Refiner (by-product of Plastic; worth only 1 α in a Lab) |
| Copper | T1 | 6 | 1.3 | Refiner |
| Silicon | T1 | 6 | 1.0 | Refiner |
| Rubber | T1 | 3 | 0.8 | Refiner |
| Screen | T2 | 24 | 0.6 | Assembler |
| Circuit | T2 | 20 | 0.8 | Assembler |
| Cable | T2 | 22 | 0.5 | Assembler |
| Phone | T3 | 130 | 0.25 | Fabricator (ends the demo) |
| Laptop | T3 | 180 | 0.2 | Fabricator |
| Robot | T3 | 750 | 0.1 | Fabricator |

**Demand: two prices.** Markets buy each material at full price up to its demand rate; anything beyond that sells at a flat 25%. Unused demand is banked for 8 seconds (at least one item), so a machine that delivers whole items in bursts is still paid in full. Wider Demand multiplies every demand rate by 1.5, Exports by 2; Luxury Buyers adds 25% to the value of T2 and T3. Copper and Circuit are bought a little faster than their tier's neighbours (1.3 and 0.8 a second): the growth goals ask for 1 Copper and 0.6 Circuits a second, and a goal must not be met by selling at a quarter of the price.

The first time a material keeps selling over its demand for 3 seconds, the game sets `seenSurplus` (saved) and raises a one-off `surplus` event naming it, so the demand gauge can be introduced when the rule first bites. **For the card players that is a moment of free play.** None of the card players (newcomer, card-only, newcomer10, and the player who reads no line) sells anything over its demand before the first Phone, in 60 runs on seeds 0–14 (the pacing tool checks it for each run): every growth goal's rate is under the demand for its material, and the Refiners that the Fabricator card's tune-up has the player build are only asked for while the Markets would still buy their product at full price. A fast player meets the rule early, at 4:44–8:23 in all 30 runs (Glass or Plastic): their own levels of Speed on two lines of each take them past 1.5 Glass or 1.2 Plastic a second. When it happens during a wait for credits, the adviser's sentence says so and Wider Demand joins its candidates.

**Demand is not shown until then.** The Commerce branch is hidden from the tech tree until `seenSurplus` is true (`Tech.needsSurplus`, `techHidden`), and `demandShown(g)` tells the interface whether to draw demand at all. Market Lens is not a goal reward any more: it is granted at that same moment (a `tech` event for C1 comes just before the `surplus` event), and Wider Demand, Luxury Buyers and Exports appear with it. A save from an older build that owns Market Lens or Wider Demand keeps them and sees the branch; one that has seen a surplus without owning Market Lens is given it on load. Nothing else a player reads names demand before that moment (`tests/rules.test.ts` goes through the goal cards, the node blurbs and the techs in view): the Market's blurb says "Sells anything for credits. Takes any number of wires.", and the adviser takes no notice of a glut until `demandShown(g)`, so the few seconds between a material first selling over its demand and the `surplus` event cannot produce a tip that says "over demand".

## Recipes

| Recipe | Machine | Inputs | Outputs | Time | Tech |
|---|---|---|---|---|---|
| Glass | Refiner | 2 Sand | 1 Glass | 2 s | Refining |
| Plastic | Refiner | 2 Oil | 1 Plastic + 1 Tar | 2 s | Oil Deposits |
| Copper | Refiner | 2 Ore | 1 Copper | 2 s | Ore Deposits |
| Silicon | Refiner | 2 Quartz | 1 Silicon | 2 s | Quartz Deposits |
| Rubber | Refiner | 3 Tar | 1 Rubber | 3 s | Reclamation |
| Circuit | Assembler | 1 Plastic + 1 Copper | 1 Circuit | 3 s | Assembly |
| Screen | Assembler | 2 Glass + 1 Silicon | 1 Screen | 4 s | Quartz Deposits |
| Cable | Assembler | 1 Copper + 2 Rubber | 1 Cable | 4 s | Reclamation |
| Phone | Fabricator | 1 Screen + 2 Circuit | 1 Phone | 6 s | Fabrication |
| Laptop | Fabricator | 2 Cable + 1 Circuit + 1 Screen | 1 Laptop | 8 s | Laptop |
| Robot | Fabricator | 1 Phone + 1 Laptop + 4 Quartz | 1 Robot | 12 s | Robot |

**Which recipe a machine takes.** A machine built from a port, or wired into, takes the unlocked recipe that gets the largest share of its inputs from what is wired in, then the one with the fewest inputs, then the first in the table above (`pickRecipe` in `src/economy.ts`). So an Assembler fed Copper makes Circuit even after Reclamation (Cable wants Copper and Rubber: half its inputs), and a Fabricator fed Screen makes Phone after Laptop research. It used to take the recipe with the dearest output among all that used any of its inputs, and after Reclamation the Assembler of the Circuit card made Cable. A machine still without a recipe takes one as soon as research gives it one for what is wired in: at once when the research is bought or granted (`grantTech` calls `adoptRecipes`), and on the next tick when the tech arrives any other way, a save among them (`tests/recipes.test.ts`).

## Nodes

The nth node of a type costs `base × growth^(n-1)`, rounded. Deleting a node refunds what it would cost to buy back, plus its upgrades. A node from a save of the public version, which charged less for upgrades, refunds no more than it cost there and since (`GNode.legacyPaid`, set when such a save is loaded; see "Saves" below): a Drill with ten levels of Speed bought there refunded ten times what it had cost.

| Node | Base ¢ | Growth | Needs | Rate |
|---|---|---|---|---|
| Drill | 10 | ×1.15 | a free deposit | 1.0/s (Ore, Quartz: 0.8/s) |
| Refiner | 50 | ×1.15 | Refining | one craft per recipe time |
| Assembler | 1,200 | ×1.5 | Assembly | one craft per recipe time |
| Fabricator | 8,500 | ×1.15 | Fabrication | one craft per recipe time |
| Router | 25 | ×1.10 | Routing | splits evenly, by ratio, by priority or by filter |
| Merger | 25 | ×1.10 | Merger | — |
| Silo | 200 | ×1.20 | Silo | holds 200 items |
| Market | first free, then 150 | ×1.50 | — | sells anything |
| Lab | 100 | ×1.10 | Lab | studies 1 item/s (2 with Lab Speed) |
| Dump | free | — | Oil Deposits | destroys anything |

**Assemblers are 1,200, 1,800, 2,700 and 4,050¢** (they were 600, 1,500, 3,750¢: ×2.5). The growth goals ask for a second Circuit Assembler and a second Screen Assembler, so a card player buys four before the Fabricator; at ×2.5 the fourth would have cost 9,375¢, more than the Fabricator, and a second Assembler was never a sane purchase. The first is dearer than it was because the research before it no longer has to be waited for: the claim of "Make 1 Copper a second" pays most of Assembly, and the 1,200¢ are what stands between that claim and the first Circuit. Speed is the other way to both rates (four levels on a Circuit Assembler, 926¢; five on a Screen Assembler, 1,581¢), and the card's how names both.

**The Fabricator is 8,500¢** (5,000¢ in the build before the growth goals, 7,250¢ before that). With four Assemblers and two lines of everything a card player earns about twice what the one-of-each board did, and the research before the Fabricator is paid for by a claim: at 5,000¢ the first Phone came at 15:30 for the card player and at 11–13 minutes for the fast ones. Its goal is the one long wait for credits left in the demo (183–195 s on the card for the card-only player, 54–80 s of them with nothing to do), and the card has the cut of the Circuit wire and a tune-up for it (see "The cards' lines"). The fast players are the floor: their first Phone is 14:43–17:37 (the target is 14:00 or later).

**Labs grow ×1.1**: 100, 110, 121, 133¢… A card player builds one (the goal cards no longer have every spare deposit given a Drill and a Lab of its own: spare deposits are for wider lines); a fast player builds one per kind of Data.

**Fan-out: machines are fed first; what is left goes on to selling and study.** When one port feeds several wires, machines are served first, evenly. A Router, Merger or Silo counts as a machine when some path from it leads to one; a junction whose every path ends at Markets, Labs, Dumps or nowhere waits with the Markets, Labs and Dumps, and they share what is left. (So a Router to a Lab and a Market never takes from an Assembler on the same port.) A Router follows its own mode, and its Even mode is truly even. `RULES.fanOut.deadEndJunctionsLast` switches the junction clause off for what-if runs.

**Favour** is the one-press Router preset: `favour(g, routerId, wireId)` puts the Router in Ratio mode weighted 3 : 1 toward that wire (`RULES.router`), as one undo step.

### Upgrades

Level L of a track costs `first level × 1.6^(L-1)`, rounded.

| | Speed, first level ¢ | then | Efficiency ¢ | Buffer ¢ |
|---|---|---|---|---|
| Drill | 50 | 80, 128, 205… | — | — |
| Refiner | 32 | 51, 82, 131… | 75 | 20 |
| Assembler | 100 | 160, 256… | 300 | 80 |
| Fabricator | 400 | 640, 1,024… | 1,200 | 320 |
| Lab | 50 | 80, 128… | — | — |
| Silo | — | — | — | 80 |

- **Speed:** +25% per level for a Drill or Lab, −15% craft time for a machine. Cap 10 levels (25 with Overclock).
- **Efficiency** (needs Efficiency Tuning): every 6th, then 5th, 4th, 3rd craft uses no inputs. Cap 4.
- **Buffer:** +100% internal storage per level. Cap 5.

Speed is priced so that a first or second level pays for itself in one to three minutes when the extra input exists: 83–171 s for a Drill whose output is refined, 60–164 s for a machine whose input was backing up. If that input was selling at full price instead, a machine takes two to three times as long.

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

Five deposits at the start: 2 Sand, Oil, Ore, Quartz. Expansion n costs `360 × 2.5^(n-1)`: 360, 900, 2,250, 5,625, 14,063… (it was 200, 500, 1,250…: the first two are now what the Plastic and the Copper growth goals ask for, a second Oil and a second Ore deposit, and are priced as the step of a goal, not as a side purchase). Each reveals two or three deposits from a fixed cycle: Sand + Oil, Ore + Sand, Quartz + Oil, Sand + Ore, Quartz + Sand, Oil + Ore + Quartz.

An expansion is one undo step like any other (pressed by mistake, it was hundreds or thousands of credits gone for good): undo refunds it in full and takes the plot and its deposits away again, and redo buys the same plot back. Anything placed on the new plot since is a later step and comes off first.

### Undo

- **Undo stops at the last claim.** Claiming a goal clears the undo history, so nothing that earned a reward can be taken back after it is paid (undoing the Drill of "Dig up more Sand" after its claim left the 10¢ and the next goal met for nothing; undoing the level that a card asked for gave back its price on top of the reward). Claiming an order does not clear it.
- **Before the claim, an undo that takes away what a ready goal stands on takes its Claim too** (`unready` in `src/actions.ts`); a redo gives it back. Goals counted by events (a Phone made, seconds of Flow held, orders filled) keep their Claim. Without this rule, a player could undo the very thing a ready card was about and still claim it.
- `tests/undo.test.ts` holds all three.

## Data

A Lab turns each item into Data by tier: T0 → 1 α, T1 → 3 α, T2 → 5 β, T3 → 8 γ (×1.5 with Deep Analysis). Tar is the exception: a by-product is worth 1 α, not 3 (`MATERIALS.silt.study`; three Tar make one Rubber, which is worth 3 α, so reclaiming it neither gains nor loses Data). One β is worth 4 α and one γ 12 α when an order's pay is converted.

## Flow

Drills and machines count once they are at least 20 s old and some path of wires leads from them to a Market or a Lab (six Drills into a Dump are not a supply line); one is *flowing* at 90% utilisation or more. Cutting a weak producer off still hides it, at the price of everything it made. Flow is the flowing share, smoothed over 3 s. Once the goal chain unlocks the meter, every sale is multiplied by `1 + 0.2 × Flow`. 100% for 10 s with six or more producers is Flow State.

**The Flow goal asks for 95% for 10 seconds** (`RULES.flow.holdShare`, `holdSeconds`). On a board of fewer than nineteen producers that is every one of them. The meter is the reward of "Make and sell Copper", and the goal comes straight after it, because that is where the lesson is: an Ore Drill makes 0.8 a second and its Refiner wants 1, so the Copper Refiner a card player has just built is short, and one level of Speed on the Ore Drill, which the card's line names (below), puts it right. (The meter used to arrive after the first Circuit, ten minutes in, on a board with one or two producers short for reasons a newcomer could not see.) The first Flow State arrives with the goal or soon after. A fast player has usually bought that level already and passes in under a minute.

**The seconds stand still while something is too young to judge** (`RULES.flow.holdAge`, 40 s; `flowUnsettled(g)` in `src/flow.ts`). A producer does not count toward Flow until it is 20 s old, and a machine just built runs flat out for a while on what stood in its feeder's buffer: when the meter unlocks, 15 s after the Copper line was built, a card player's Flow reads 100% with the Copper Refiner not yet counted, and the ten seconds were over before it began to starve. So while any Drill or machine that reaches a Market or a Lab is younger than 40 s, the counts of the goal (`flowHold`, `flowNear`, `flowNear2`) do not run, and the card's line is not ticked. Flow itself, its bonus and Flow State are unchanged. Building does not reset what was held; it pauses it.

**The valve.** Once the goal has been on the card for 90 s (`RULES.flow.valveAfter`; `goalAge(g)`, from the saved `Game.goalAt`), all but one producer flowing, held for the same 10 s, also completes it. The bar itself does not move. The ten seconds are counted from the moment the valve opens, however long the board has been at "all but one" before: the goal's count starts at 0 at second 90 and the goal is ready at second 100, never sooner. (In an earlier build the seconds held before the valve counted, and the goal completed the instant it opened, with nothing on the card to show for it.) If the board drops under "all but one" the count stops, and starts from nothing when it is back.

The valve is for the board with one producer nobody can honestly fix: a machine fed through a Router that favours a Lab (the player's own Router, and no tip turns it back) dips under 90% however its Drills are upgraded. The adviser says nothing about such a board, because a Flow tip has to get the producer it names flowing and keep it so; the valve passes it at 100 s (tested in `tests/advice.test.ts` and `tests/goals.test.ts`). The 90 s run on game time, so a pause or time away does not open it, and they are saved with the game: a save made at second 80 completes 20 s after it is loaded, a save made while the count is running picks it up where it was, and a save from before this rule starts its 90 s when it is loaded.

**The valve's second step: all but two, from 180 s** (`RULES.flow.valveAfter2`; `flowSlack(g)` is 0, 1 or 2; the count is `Game.flowNear2`, saved). A player who builds ahead, a second Copper Refiner on the one Ore Drill (the goal after next is "Make 1 Copper a second"), has two Refiners short that no single change gets flowing: the line has no step for that board and the adviser no tip, and with "all but one" alone the chain stopped there for good (`tests/holdflow.test.ts` plays this board). Its ten seconds are counted from second 180 in the same way. Deleting the extra Refiner again lets the goal complete with the line's step, as before.

**The later steps: one more short every 120 s, to one producer flowing** (`RULES.flow.valveEvery`; `valveSlack(age)`: 0, 1 at 90 s, 2 at 180 s, 3 at 300 s, 4 at 420 s...; `flowSlack(g)` holds it to the producers counted less one). Every board on which anything flows passes in the end. The case it is for: a save from the public version, migrated, played on by a player who follows only the tips, arrives three producers short (after the tips' Quartz Drill wire, the Silicon Refiner starved and the two Circuit Assemblers short), one of them needing two changes; the adviser offers only fixes that get a producer flowing by themselves, so with two steps that player stayed on the goal for good. It passes under one of those steps (`tests/holdflow.test.ts`, from the fixture in `tests/fixtures/public-version.ts`, played on by the growth goals' own way and the tips). The steps from the third on share one count, `Game.flowNearLate` (saved; `tickValve(g, dt)` after Flow each tick): it starts at the third step's opening, starts again from nothing when the board drops under the bar, and runs on when the next step lowers the bar under a board already holding it. A board of six producers with one flowing passes at 550 s. The look-ahead of the adviser's Flow tips is not stretched for the later steps (`flowHorizon` reaches the first two; otherwise 50 s, `ADVICE.flowScreen`), so a tip that fixes a board three short is still given rather than left to a valve minutes away, until the third step comes within those 50 s: the scripted players never stay 300 s on the goal.

**The Flow goal has a line**, in words that name the node its step acts on (`Meanwhile.say`, `flowLineWords(g)`): "The Copper Refiner needs more Ore: buy Speed on its Ore Drill." (the same for touch; "its Ore Drill" where several Ore Drills stand and one of them feeds the Refiner, as the step's own sentence says it), or, for a port with nowhere to send its goods, "The Silicon Refiner has Silicon to spare: wire its port to the Market.". It used to say "Click the Flow ring, then give the machine it picks what it lacks", but the ring jumps to the producer furthest from flowing, and the one change that helps can be for another (the ring picks the Copper Refiner, and the step is Speed on the Ore Drill that feeds it). Once done, it reads its own words: "Click the Flow ring to find what holds Flow back, and give it what it lacks." (touch: "Tap the Flow ring…"). Its step is the one change that gets the short producer flowing (`flowFix(g)`): a level of Speed on the Drill or machine that feeds it, when that supplier runs flat out and one level is enough, or its port wired to a Market. It shows only while there is such a change, waits 10 s after a Speed level for the rates to settle (`FLOW_SETTLE`), and is ticked off once everything flows and nothing on the board is too young to judge. With the line the card-only player buys one level of Speed on the Ore Drill for 50¢, on all fifteen seeds, and spends 34–50 s on the goal (the 40 s a new machine is too young are part of it). A player who reads no line is offered no Flow tip either (the adviser's tip and the line are the same step, and a tip never repeats a line), except on a board the valve cannot pass (see the second step above): the valve takes them through in 109–116 s.

**What the card can show.** `goalView(g).flow` is `{ pct, running, of, need, valve?, slack? }` while the Flow goal is active: the smoothed Flow, how many producers are flowing out of how many counted, the share needed right now (0.95, "all but one" once the valve is open, "all but two" from 180 s), `valve: true` from the moment the valve opens (absent before), and `slack`, how many producers may be short once it has (absent before 90 s; then a whole number from 0 to the producers counted less one: 1, 2, then one more every 120 s; 0 on a board of one producer, whose bar the valve cannot lower). `goalView(g).progress` is the count itself, `[held, 10, 's']`: under the valve it runs from 0 to 10 between second 90 and second 100, or second 180 and 190.

## Orders

Unlocked by "Give the Tar somewhere to go" (goal 11), so that the first order comes while the player has two things to sell and before the first growth goal that needs land. One order at a time: "deliver N of X", counted from sales at any Market, no timer.

- **X:** something the player makes right now that is not a raw material (Circuit and Screen too; a raw material only when nothing else qualifies). What reaches a Market comes first, then what does not; within each, the newest first. "Reaches a Market" means sold at 0.08 items/s or more (`RULES.orders.marketRate`; the smallest order fills in 100 s at that rate). It used to be 0.02, the bar for "is produced" (`minRate`, unchanged): a trickle of Silicon past a busy Assembler then counted as selling, an order for eight of it took minutes or went stale, and a fast player saving for the Fabricator sat with free hands for up to 157 s. The first, second and third on that list are picked with chances 55 / 30 / 15%, never the same material twice running.
- **N:** 25–50 s of what currently reaches Markets of that material (not of what is made), at least 8. (It was 45–90 s earlier. About half the size, an order comes and is claimed almost twice as often for the same pay a second: a Claim to press every minute or so through the long waits of the middle game, and a stretch of nothing to do broken more often. For the card players, who claim 8–16 s late, the time an order waits for its Claim is a bigger share of each, and orders pay them about a tenth less a second; that is in the pacing numbers.) "Currently reaches" is measured on a copy of the game run forward for 40 s (`src/forecast.ts`), so a line built a moment ago counts for what it will sell. That forecast is what a new order costs on the page: 2–3 ms, up to 47 ms under a 4× CPU throttle. It was left as it is: a coarser step (0.5 s for 0.25 s) halves the cost and changes what orders ask for on the pinned seeds (mainline on seed 1 reached the Phone at 15:40 instead of 17:00), and no measurement the game already keeps gives the same numbers.
- **The first order** (until one has been filled) only asks for something already selling, sized to 32–37 s of it, at least 3: it counts from the moment it appears and fills in 30–40 s with nothing rerouted.
- **Reaching no Market:** an order can ask for something the player makes but does not sell (N is then 8). `orderView(g).reachesMarket` is false, with `rate` and `eta` beside it, and the adviser says where to reroute.
- **Pay:** credits worth half the items at full price, plus Data in the tier the player is shortest of. In the items' own tier that is what a Lab would have made from them. Converted into another tier (Circuit is β in a Lab; an order that pays α for it converts) only a quarter survives (`RULES.orders.convertShare`): ten Circuit pay 50 β, or 50 α rather than 200 α. At full conversion one Circuit order paid 400 α in a lump, and which material the next order happened to ask for moved the first Phone by up to three minutes.
- An order with no delivery for 120 s is quietly replaced (`staleSeconds`).
- **So is an order that cannot be filled any more.** At the rate its material sells right now, an order that would take more than 5 minutes to fill (`RULES.orders.retire.eta`) for 20 s running (`hold`), once it is 30 s old (`after`: a new order's material may only just be starting to sell), is quietly replaced by one for something else (`hopeless` in `src/orders.ts`; the moment it first fell behind is saved as `Order.slowSince`). A machine built on the line that feeds the Market takes the material first: the Copper an order was counting goes into the Circuit Assembler, the Glass into the Screen Assembler, and the order read "about 24 min", then "over an hour", with a trickle still arriving so that the 120 s rule never fired. An order with steady deliveries that keep it within five minutes is never swapped, however long it takes (`tests/orders.test.ts`). In practice this rule now does most of what `staleSeconds` did.

## Goal chain

**The rule: a new thing arrives only after the player has grown what they have.** The chain alternates between two kinds of goal. A *chapter* brings something new: a machine, a material, a tool. A *growth goal* stands between two chapters and asks for a rate of what the last one brought ("Make 1 Plastic a second"); the next step of the Processing spine stays locked in the tech tree until it is claimed, and its claim pays most of what that research costs. In the build before, ten goals in three and a half minutes each handed over something new, nothing ever asked for a second Refiner, and the waits for research were filled by lines that had the player put a Drill and a Lab of its own on every spare deposit: Data farming, not a wider line.

### Growth goals

- **A rate, not a list of things to build** (`growth()` in `src/goals.ts`). "Make 1 Glass a second" is met by a second Refiner on the Drill that only sells, by a third Drill and Refiner, by Speed, or by any mix: the card counts what comes out. Its why says what holds the line back, its how names one route (two where there are two: "Build a second Assembler… Or buy Speed on the first, four times."), and nothing else is asked.
- **What counts** (`making(g, m)`): for every machine set to make the material, the smaller of what it makes (its flat-out rate times its utilisation) and what leaves its port along its wires. So a machine blocked with nowhere to send its goods counts for nothing, a level of Speed just bought counts only once the machine is really fed that fast, and a wire that reads high for a moment because a buffer is emptying is capped by what the machine can make. The goal is met at 97% of the rate (`GROW_SLACK`), because a line that makes exactly 1 a second reads 0.98–1.00 on any given tick. The card shows "0.5 / 1 Plastic a second" (`goalView(g).progress` is `[now, rate, 'Plastic a second']`); the noun is plural for things counted by the piece ("0.6 Circuits", `rateNoun`).
- **Every rate is under the demand for its material** (Glass 1.2 of 1.5, Plastic 1 of 1.2, Copper 1 of 1.3, Circuits 0.6 of 0.8, Screens 0.5 of 0.6): a growth goal is never met by selling at a quarter of the price, and it leaves room for the Speed a player buys along the way.
- **The claim opens the next research** (`GoalReward.opens`, kept in `Game.opened`; `Tech.locked`, `techLocked`, `techGated` in `src/economy.ts`). Ore Deposits, Assembly, Quartz Deposits and Fabrication are locked. A locked tech cannot be researched, whatever Data is in hand; the tree shows it in full, with its price, "Opens with “Make 1 Plastic a second”", and where the player stands ("You make 0.5 Plastic a second now."). It can be queued ("Research it for me when ready") and is then researched on the tick after the claim. The card's reward chip says "Opens Ore Deposits", and the celebration "Ore Deposits can be researched".
- **Claim, then research, is one beat.** The claims pay 120α toward Ore Deposits (195α), 400α toward Assembly (600α), 600α toward Quartz Deposits (900α) and 400α toward Fabrication (600α + 100β). With what the Lab has made meanwhile, a player who kept their Data has the research in hand at the claim on every seed: none of the scripted card players waits for a spine research after Oil Deposits. A player who spent their α on side techs waits, and that is where the adviser still has something to say (see "The adviser").
- **One line, behind "How?"** (`Meanwhile.way`, labelled "One way" on the card). Each growth goal has a single line whose words are its next step's own, with a Show me: "Build a Refiner from a Sand Drill's port (57¢): its Glass sells for 3¢ each.", "Every Oil deposit is in use: expand the board (360¢) for another.", "A Glass Refiner runs flat out: buy Speed (32¢) for more Glass." It is shown only while the card's how is open: the goal is the player's to solve, and the line is for whoever asks. See "While you wait" for its steps.
- **Six of them.** Glass twice: the first is the second Refiner (the Drill of goal 2 has only sold Sand until now), the second is where Speed is taught (goal 7, "Make 1.2 Glass a second": two Refiners at one level of Speed make 1.18, and a faster Refiner needs a faster Drill, which is the lesson), and its claim brings the Lab. Then Plastic (the one Oil deposit is in use, so this is where land is first bought), Copper (a second Ore deposit comes with the second expansion, and an Ore Drill needs Speed to keep a Refiner busy), Circuits and Screens (a second Assembler, or Speed on the first).

### What a card says

A card has a title that is an outcome, a **why** under it, and a **how** behind its "How?" button (`Goal.title`, `Goal.why`, `Goal.hint` in `src/goals.ts`). The why is about the game's world and names no click, drag, tap or key, so it is the same for a mouse and a finger; no why is longer than 125 characters (`tests/goals.test.ts`). The how is the gesture, worded for the pointer in use. It shows when the player presses "How?", and by itself once the goal has been within reach for 20 game seconds with the board left alone (`HOW_AFTER` in `src/ui/hud.ts`; not while the card is saving up for something). Sent away with "Why?", it does not come back on that goal. Where the how has the player build a machine from a port and one already stands unfed, placed from the build bar, it names the wire into it instead (`Goal.howNow`: goals 4 and 8). A goal about a recipe has it drawn on the card (`Goal.recipe`), and where several things are put together each input is ticked once it is wired into the machine, and what comes out once it goes somewhere (`recipeFeeds`).

| # | Title | Why | Recipe |
|---|---|---|---|
| 1 | Sell your Sand | The Drill brings up Sand, but the Sand has nowhere to go. The Market pays for whatever reaches it. | |
| 2 | Dig up more Sand | More Sand means more to sell. A Drill only works on a deposit, and one Sand deposit is still free. | |
| 3 | Sell that Sand too | A machine that cannot pass on what it makes fills up and stops. One Market takes any number of wires. | |
| 4 | Turn Sand into Glass | Two Sand sell for 2¢. Melted into one Glass they sell for 3¢. A Refiner does the melting. | 2 Sand → Glass |
| 5 | Sell your first Glass | The Refiner is making Glass, and the Glass is piling up inside it. It needs a way to the Market, as the Sand did. | |
| 6 | **Make 1 Glass a second** | One Refiner makes a Glass every two seconds, and half your Sand still sells raw. A second Refiner doubles your Glass. | |
| 7 | **Make 1.2 Glass a second** | Every machine can be made faster. But a faster Refiner needs more Sand, and a faster Drill needs a Refiner that keeps up. | |
| 8 | Study Glass in a Lab | A Lab studies what it is given and turns it into Data instead of credits. Data is what new technology is bought with. | |
| 9 | Open up the Oil deposit | One of the locked deposits holds Oil. Your Data can open it: a new raw material, and new things to make from it. | |
| 10 | Turn Oil into Plastic | Oil is refined as Sand is: two Oil make one Plastic. Refining Oil also leaves Tar behind. | 2 Oil → Plastic + Tar |
| 11 | Give the Tar somewhere to go | A machine stops when anything it makes has nowhere to go. Plastic sells; Tar is waste, and a Dump takes it for nothing. | |
| 12 | Fill your first order | Buyers ask for things you already sell. Deliver what an order asks for and it pays extra, in credits and in Data. | |
| 13 | **Make 1 Plastic a second** | Your one Oil deposit is in use. A new plot of land brings another, and room for a second line beside the first. | |
| 14 | Make and sell Copper | Copper is refined from Ore, the next deposit to open. Plastic and Copper together are what a Circuit is made of. | 2 Ore → Copper |
| 15 | Hold 95% Flow for 10 seconds | Flow is the share of your Drills and machines that run flat out. The higher it is, the more every sale pays. | |
| 16 | **Make 1 Copper a second** | A Circuit will take a Copper each, and one Refiner makes one every two seconds. A second Ore line doubles it. | |
| 17 | Make your first Circuit | A Circuit is Plastic and Copper put together, and sells for 20¢. That takes an Assembler: a machine with two inputs. | Plastic + Copper → Circuit |
| 18 | Study Circuits for β | Better things teach more. An assembled part gives β Data, a new kind, and the next technology costs some. | |
| 19 | **Make 0.6 Circuits a second** | A Phone will take two Circuits. A second Assembler doubles what you make; Speed on the one you have gets there too. | |
| 20 | Make and sell Silicon | Silicon is refined from Quartz, the last deposit to open. Silicon and Glass together make a Screen. | 2 Quartz → Silicon |
| 21 | Make your first Screen | A Screen is two Glass and one Silicon, and sells for 24¢: another Assembler, fed by two of your lines. | 2 Glass + Silicon → Screen |
| 22 | Speed up every Drill at once | A long line needs more raw material at its start. Upgrade all raises every machine of one kind at once. | |
| 23 | **Make 0.5 Screens a second** | One Assembler makes a Screen every four seconds, and your Glass and Silicon would do for two. A Phone will take a Screen. | |
| 24 | Build a Fabricator | A Phone is a Screen and two Circuits. Only a Fabricator puts three things together, and it is the dearest machine yet. | |
| 25 | Make your first Phone | Sand, Oil, Ore and Quartz, all in one thing. The Fabricator needs one Screen and two Circuits for every Phone. | Screen + 2 Circuit → Phone |

Growth goals in bold. The prices in the whys of goals 4, 17 and 21 are read from the content table, not written out. The hows are the sentences quoted in the rest of this section; other parts of the game still read them for what they name (the tech to research, the machine to build, the kind of node the card is about).

### The chain

One goal at a time; a finished goal waits for Claim. Rewards are the only source of Refining, Lab, Bulk Upgrade, Orders and the Flow meter, and the only thing that opens Ore Deposits, Assembly, Quartz Deposits and Fabrication for research (Market Lens comes with the first surplus, see Materials; Routing is a research of 50α now, behind Oil Deposits). Through goal 8 the credits paid so far always cover the next purchase the card asks for.

| # | Goal | Reward | New with it |
|---|---|---|---|
| 1 | Sell your Sand | 12¢ | wires, the Market |
| 2 | Dig up more Sand | 10¢ | placing a Drill |
| 3 | Sell that Sand too | Refining + 50¢ | |
| 4 | Turn Sand into Glass | 20¢ | the Refiner |
| 5 | Sell your first Glass | 70¢ ★ | |
| 6 | **Make 1 Glass a second** | 125¢ | *grow: a second Glass line* |
| 7 | **Make 1.2 Glass a second** | Lab + 100¢ ★ | *tune: Speed upgrades, the inspector* |
| 8 | Study Glass in a Lab | 20α ★ | the Lab, Data |
| 9 | Open up the Oil deposit (research Oil Deposits) | 40¢ | the tech tree |
| 10 | Turn Oil into Plastic | 40¢ | Oil, a by-product |
| 11 | Give the Tar somewhere to go | Orders + 20α | the Dump |
| 12 | Fill your first order | 200¢ | orders |
| 13 | **Make 1 Plastic a second** | opens Ore Deposits + 120α ★ | *grow: land (the first expansion)* |
| 14 | Make and sell Copper | Flow meter + 25α ★ | Ore |
| 15 | Hold 95% Flow for 10 seconds (the valve: see Flow) | 150¢ | Flow |
| 16 | **Make 1 Copper a second** | opens Assembly + 400α ★ | *grow: the second expansion* |
| 17 | Make your first Circuit | 150¢ ★ | the Assembler |
| 18 | Study Circuits for β (40 β in hand) | 50α | β |
| 19 | **Make 0.6 Circuits a second** | opens Quartz Deposits + 600α ★ | *grow: a second Assembler, or Speed* |
| 20 | Make and sell Silicon | 50α | Quartz |
| 21 | Make your first Screen | Bulk Upgrade + 600¢ + 40β ★ | a part from two lines |
| 22 | Speed up every Drill at once | 1,200¢ + 60β | Upgrade all |
| 23 | **Make 0.5 Screens a second** | opens Fabrication + 400α ★ | *grow: a second Screen Assembler, or Speed* |
| 24 | Build a Fabricator | 40β | the Fabricator |
| 25 | Make your first Phone | demo complete ★ | |
| free play | Rubber · Cable · Laptop · Robot | 200¢ · 600¢ · 1,800¢ · 7,500¢ | |

★ = big celebration (`Goal.big`, and `big: true` on the goal's `goal-claimed` event). A growth claim that opens a research is one: it is the moment the next chapter is earned ("1 Plastic a second · Ore Deposits can be researched · +120α", with the material's own glyph).

**When things arrive** (the card-only player, seeds 0–14, at the claim; in brackets the build before, seed 0): the first Glass 1:11–1:28, the Lab 3:13–3:29 (2:07), Oil Deposits 3:52–4:08 (2:58), orders 4:35–4:54 (5:26), the first expansion in goal 13, about 6:00 (7:04), Copper 7:24–7:50 (4:57), the Flow meter with it (10:20), the first Circuit 9:44–10:23 (10:08), Silicon 12:04–13:02, the first Screen 12:56–13:41 (about 15:00), the Fabricator 17:38–18:28, the Phone 17:54–18:44 (17:47). The first half is slower and the second quicker than it was: the Lab, Oil and Copper each come one to two and a half minutes later, with a goal of growing between them, and the two long waits for Data of the middle (Assembly, Quartz Deposits) are gone.

**What was taken out.** "Speed up a Drill" (goal 7 teaches Speed by asking for a rate that needs it), "Open up more land" (goal 13's only route is a second Oil deposit, so the land is bought there for a reason) and "Route more to a Lab than to the Market" (the Router is a research of 50α for whoever wants one; no goal builds a Router, so no later card or tip has to work around one). And the lines that had every spare deposit given a Drill and a Lab of its own, with Speed on the pairs and Deep Analysis after: spare deposits are for wider lines now, and a card player owns one Lab.

**Goal 22 is "Speed up every Drill at once"** (id `bulk-upgrade`; how, mouse: "Select a Drill and press Upgrade all beside Speed.", touch: "Tap a Drill and tap Upgrade all beside Speed."). Bulk Upgrade comes with the first Screen (S1 is granted with goal 21's reward, the tech tree says "Reward for the goal “Make your first Screen”"), and goal 22 is done by one press of Upgrade all on the Drills made after it came up (`bulkSince`: `Game.bulkAt`, set only by a press that raised Drills, at or after `goalAt.t`). Upgrade all on Refiners or Labs does not count, and an undo of the press takes the goal's readiness back with its refund (`Game.bulkAt` is part of the undo step, `Snapshot.bulkAt`), as an undo does for the other goals; a redo makes it ready again. Its progress saves toward the cheapest Drill's next level (`cheapestWellSpeed`). With seven or eight Drills on the board by then, it is the press that feeds the second Screen Assembler of the goal after it.

**Every card that has the player make something new also says to sell it, and goals 14 and 20 complete on the sale.** Goals 14 and 20 end "…and sell the Copper", "…sell the Silicon"; goals 17 and 21 say "…wire it to the Market, then wire Copper into it to make a Circuit" (goal 11 says so for Plastic). A newcomer does what the card says to the letter: without those words Copper, Circuit and Screen were never sold. Goals 14 and 20 complete on the first Copper (Silicon) sold, not made: the sale is the last gesture of the how, and a card that is ready shows Claim and no how. Goals 17 and 21 complete on the first Circuit (Screen) made: their hows put the Market first, so the wire to it is already there. A growth goal counts only what leaves the machine, so there too nothing is left unsold.

**The Assembler and Fabricator cards say where to build from, and put the Market before the wire that completes the goal.**

| Goal | How (the same for mouse and touch) |
|---|---|
| 17 | "Research Assembly, build an Assembler from a Refiner's Plastic port, wire it to the Market, then wire Copper into it to make a Circuit." |
| 21 | "Build another Assembler from the Silicon Refiner's port, wire it to the Market, then wire Glass into it to make a Screen." |
| 24 | "Research Fabrication, then save up and build a Fabricator from the Screen Assembler's port: orders and a high Flow get you there faster." |

Built from the named port (dragged into empty space, or tapped on a phone), the machine is the first choice on the menu, arrives wired and set to its recipe, and costs one gesture less than placing it and wiring it. The Market comes second in the sentence on purpose: a goal completes with the first Circuit (or Screen), and a card that is ready shows Claim and no how, so the goal must not be able to complete before the wire to the Market exists. Goal 25's how names the two wires ("Wire the Screen Assembler's port and the Circuit Assembler's port to the Fabricator."); how many of each a Phone takes is in its why and on the recipe drawn on the card; its lines name the wire or wires still missing, and its progress counts the inputs wired (see "The cards' lines"). The longest hows are the growth goals', about 150 characters (they name two ways). The scripted card players (`tests/cardPlayer.ts`, the pacing tool's `cardStep`) build and wire in the order the hows give.

**A goal that asks for a research and then a machine says so to the adviser.** `Goal.step(g)` returns `{ tech, then }`, where `then` is the price of what the card has the player buy straight after the research: the Assembler for goal 17, a Drill and a Refiner for goals 14 and 20, the Fabricator for goal 24. What the card shows is unchanged (Data toward the research). A step also names what the credits are for (`what`, `thenWhat`: "the Fabricator"), and `waitInfo(g).name` passes that on, so a card or a tip can say what is being saved for.

**Goal 2 names the build bar** ("Pick the Drill in the build bar and click the free Sand deposit."; touch: "Tap Drill in the build bar, then tap the free Sand deposit."). The bar sits down the side on a desktop, and every touch hint calls it the build bar.

**What a card is about: `goalFocus(g)`** in `src/goals.ts` returns the ids of the nodes the card is about, for the interface to frame: the nodes its how names, by goal (the port it starts from, then where it goes: a Plastic Refiner for goals 11 and 17, the Silicon Refiner for goal 21, the Screen Assembler for goal 24, the maker of what the Fabricator lacks and the Fabricator for goal 25, and so on); while the goal is a wait, or its how names no node, the nodes of the line's next step (`lineFocus` in `src/advice.ts`: the port the gesture starts from, then where it goes; for the Flow line the short producer, then what feeds it). It is empty when the step is a Drill on a free deposit or the board's expansion, which are not nodes; `lineAdvice(g).deposit` names the deposit. `tests/meanwhile.test.ts` checks it at every goal on the card players' boards (every id a node on the board, and the node the how or line means).

### The cards' lines

Ten goals carry a line (`Goal.meanwhile`, a list: `Meanwhile[]`, each line with an `id`), shown one at a time: the first line that applies and is not done yet, or the last one, ticked, once all are done (`meanwhileAt(g)` is `{ line, step, of }`, `meanwhileOf(g)` the line). `goalView(g, touch).meanwhile` is `{ text, done, step?, of?, required?, way?, held? }`, with `step` and `of` ("2 of 3") when more than one line is counted; it is absent when the goal has none, is ready to claim, or no line applies to the board right now. There are three kinds, and the card labels them differently:

- **"One way"** (`way`): the line of a growth goal. It names the next single step toward the rate and is shown only while the card's how is open (`setHowOpen` in `src/ui/advice-tip.ts`): the goal is the player's to solve.
- **"While you wait"**: something worth doing while the card saves up. Three are left: the Flow goal's fix, the cut of the Circuit wire, and the Fabricator card's tune-up.
- **"Next step"** (`required`): the goal's own requirement, one gesture at a time (the two wires of "Make your first Phone").

| Goal | Lines, in order (id: sentence) | Done when | Worth to the card-only player |
|---|---|---|---|
| 6 Make 1 Glass a second | `grow-shard` (one way): its next step's words, e.g. "Build a Refiner from a Sand Drill's port (57¢): its Glass sells for 3¢ each." | the rate is made | the goal: without the line this player does not finish it |
| 7 Make 1.2 Glass a second | `tune-shard` (one way, Speed first): "A Glass Refiner runs flat out: buy Speed (32¢) for more Glass.", then "A Glass Refiner needs more Sand: buy Speed on its Sand Drill (50¢)." | the rate is made | as above |
| 13 Make 1 Plastic a second | `grow-ink` (one way): "Every Oil deposit is in use: expand the board (360¢) for another.", then the Drill, the Refiner, its Plastic to the Market, its Tar to the Dump | the rate is made | as above |
| 15 Hold 95% Flow | `flow-fix`: "The Copper Refiner needs more Ore: buy Speed on its Ore Drill." (names the node the step acts on; once done: "Click the Flow ring to find what holds Flow back, and give it what it lacks.") | every counted producer flows, and none is too young to judge | 65–74 s |
| 16 Make 1 Copper a second | `grow-spark` (one way): "Every Ore deposit is in use: expand the board (900¢) for another.", then the Drill, its Refiner and the wire to the Market, then Speed on the Ore Drills | the rate is made | the goal |
| 19 Make 0.6 Circuits a second | `grow-glyph` (one way): "Build an Assembler from a Refiner's Plastic port (1800¢) for more Circuits.", then its Circuit to the Market and the Copper into it | the rate is made | the goal |
| 21 Make your first Screen | `cut-glyph`: "You have the β you need: cut the wire from the Circuit Assembler to the Lab." | no wire takes Circuit into a Lab | 36–44 s (goals 21 and 24 together) |
| 23 Make 0.5 Screens a second | `grow-prism` (one way): "Build an Assembler from a Glass Refiner's port (4050¢) for more Screens.", then its Screen to the Market and the Silicon into it | the rate is made | the goal |
| 24 Build a Fabricator | 1. `cut-glyph`, if it is still to do | as above | (above) |
| | 2. `tune-up`: its words are its next step's own: "An Oil Drill outruns its Refiner: buy Speed on the Refiner (32¢)."; "Place a Drill on the free Sand deposit (20¢), then build a Refiner from it."; "Build a Dump from the Refiner's Tar port: it stops when its Tar piles up." (once ticked: "Your line is tuned: nothing else pays for itself before the Fabricator.") | nothing is outrun, no Drill only feeds a Lab and no deposit that would pay is free; or the player has done some of it and no step pays for itself any more | 11–18 s |
| 25 Make your first Phone | 1. `prism-fab`: "Wire the Screen Assembler's port to the Fabricator: a Phone takes one Screen." 2. `glyph-fab`: "Wire the Circuit Assembler's port to the Fabricator: a Phone takes two Circuits." (`required`) | the Fabricator is fed that input | not a wait: the goal's own two wires, one at a time |

"Worth" is measured on the pacing tool's card-only player (no tips, claims 8–16 s late) on order seeds 0–3 (`tests/meanwhile.test.ts`, "the card-only player who leaves a line out"): the seconds on the goals a line stands on, in a whole run with the line and in one that leaves that line alone (`npm run pacing -- --policy=cardonly --seed=<n> --skipLine=<id>`). With the Flow line that player spends 40–48 s on the goal and 112–116 s without (the valve); 227–247 s against 263–287 s for the cut of the Circuit wire; 185–195 s against 197–208 s for the tune-up. The test holds the Flow line at 15 s, and the other two at never costing anything, the tune-up at 3 s on average.

**A line that is done when its goal comes up is not shown, and not counted.** The game notes those lines when the goal comes up (`Game.goalAt.had`, saved; a save from before this was kept has them noted on its first tick, and until then `meanwhileAt` takes the lines done at that moment), and `meanwhileAt` leaves them out for as long as they stay done: the card does not tick off, as if it had just been done, a wire that was cut two goals earlier. So "Build a Fabricator" does not open with the Circuit line of goal 21 standing ticked, and "Make your first Phone" shows the Circuit line alone when the Fabricator was built from the Screen Assembler's port. A line of that list that is undone again (the Circuit wired back into a Lab) is taken off it, and is a line like any other from then on. A line that only applies while its steps pay (`Meanwhile.closes`: the Fabricator card's tune-up) is counted once it applies. A line is one sentence of at most 90 characters (`RULES.tips.maxLength`); touch wording names no click, drag, hover or key, and mouse wording no tap. Each is true in the real game on the card player's own board, and nothing it asks for is undone by a later card or by a tip (`tests/meanwhile.test.ts`). `lineAdvice(g)` and `goalFocus(g)` always follow the line the card shows.

**The growth line's next step (`growNext` in `src/advice.ts`).** One gesture at a time, read off the board, in this order. Nothing is measured on a copy of the game, so the card can ask at every refresh.

1. *What a maker of the material still lacks.* Its product not wired anywhere: to the Market ("Wire a Glass Refiner's port to the Market: its Glass is not sold (3¢ each)."). A by-product with nowhere to go: to the Dump there is, or a Dump built from the port. An input not wired: from the port with the most to spare. So a machine built for the goal is always finished before anything else is asked for.
2. *A maker that is short of its input* (starved, under 90%, and past its first seconds): for a part, another port with that input to spare; for a raw material, a Drill that stands unwired; else a level of Speed on the feeder that runs flat out, the cheapest first ("A Copper Refiner needs more Ore: buy Speed on its Ore Drill (50¢)."); else, where the input is itself refined, this same list for that input; else a Drill on a free deposit ("A Glass Refiner needs more Sand: place a Drill on the free deposit (17¢)."). A maker that is blocked gets its product wired to the Market.
3. *More makers, only when what stands could not make the rate flat out.* On goal 7 (`tune`): a level of Speed on the cheapest maker. For a refined material: a Refiner from a Drill of its raw material that feeds no machine; else a Drill on a free deposit of it, offered when the Drill and its Refiner can both be paid for ("Place a Drill on the free Oil deposit (17¢), then build a Refiner from it."); else the board's expansion, when the next plot brings that raw material ("Every Oil deposit is in use: expand the board (360¢) for another."); else Speed. For a part: another Assembler from the port of its first input with the most to spare ("Build an Assembler from a Refiner's Plastic port (1800¢) for more Circuits."); else Speed.

A step waits while a machine just built is still starting up (its first craft, its feeder's buffer): the line does not answer a number that is about to change by itself with a purchase. Prices in sentences are plain digits ("1800¢"), as in every tip: a sentence has 90 characters and a level of Speed can cost eight digits.

**What a step that cannot be paid for yet is waiting for (`held`).** While the line's next step costs credits that are not in hand, `goalView(g).meanwhile.held` is `{ cost, sym: '¢', eta }` (`lineHeld(g)`): the credits to have in hand when the step is given, and about how many game seconds until then at the current income (`Infinity` when nothing brings credits in). The card says "Saving for this · 1,800¢ · about 40 s" in place of Show me. A step that has been given stays through the ripple of the income for ten seconds (`ADVICE.lineHold`, `lineGiven`), so it does not blink.

**The reserve** (`ADVICE.lineReserve`, `cardReserve`): a line's step that costs credits is only given from what the card's own next purchase does not need. In this chain no card has both a purchase of its own and a line that spends credits, except the Fabricator card, whose tune-up has a rule of its own (below); a growth goal has no purchase to protect, so its steps are given from the credits in hand. The reserve is still in the code for a line that would need it, and `--lineReserve=full` and `--lineReserve=0` in the pacing tool still switch it.

- **Goal 25's lines are the goal's own requirement** (`Meanwhile.required`, `goalView(g).meanwhile.required`): the card labels them "Next step", with no count. Where both are still to do, their `step` and `of` stay in the view (the card uses them to see one line take over from another).
- **The Fabricator card's tune-up (`tune-up`).** The wait for the Fabricator's price is the last wait of the demo and the one long wait for credits. By then the board has three kinds of slack, and the line asks for each, one step at a time:
  - *A Drill that outruns the one machine it feeds.* The press of Upgrade all that the card before asks for leaves a Drill that feeds one machine and nothing else making more than that machine takes (an Oil Drill at 1.25 a second into a Plastic Refiner that takes 1): it stands blocked a fifth of the time, and Flow, which every sale is paid by, is down. A level of Speed on the machine puts it right: "The Oil Drill outruns its Refiner: buy Speed on the Refiner (32¢)." (`outrun(g)` in `src/goals.ts`, worked out from what the machines can take at their levels, so that two Drills equally outrun do not take turns on the card). Where it is Labs that a Drill outruns and Lab Speed is not researched, that research is the step, from the α Fabrication does not need: "Your Drills outrun their Labs: research Lab Speed (50α) and they flow again." A port that also sells, or feeds a Lab with room, is never outrun, so this never asks for a raw Drill to be wired to the Market.
  - *A Drill that only feeds a Lab.* Fabrication is the demo's last research: once its α is in hand, what a Lab studies earns nothing toward the Fabricator. A Refiner built from such a Drill's port takes what it needs first (machines are fed before Labs), the Lab keeps the rest, and the product is sold: "Build a Refiner from the Ore Drill's port (87¢): its Copper sells for 6¢ each.", then "Wire the Copper Refiner's port to the Market: its Copper is not sold (6¢ each).", and for a Plastic Refiner "Build a Dump from the Refiner's Tar port: it stops when its Tar piles up." (`refineNext(g)`). The dearest product first: Copper, then Plastic, then Glass. A Drill is only offered a Refiner when it gives enough to keep it flowing and the Markets would still buy the product at full price, so nothing sells over its demand for it, and nothing raw is sold at all.
  - *A deposit nobody drills.* The board has been expanded twice by now and a Sand or an Oil deposit usually stands free. A Drill there with a Refiner from its port is one more line of something that sells: "Place a Drill on the free Sand deposit (20¢), then build a Refiner from it.", offered when the Drill and the Refiner can both be paid for and the pair earns its price back before the Fabricator (the same test as below, with twice the lead: two machines have to start). It is the widening step of the tune-up, and the reason the card player arrives at the Phone with three lines of Glass.
  - *One line, in the words of its next step* (`Meanwhile.say`, `tuneLineWords(g)`). While a level of Speed, the research or a Dump is the step, the card reads that step's own sentence; through the building of a Refiner and its wire to the Market it reads why and what, "You have enough α: build a Refiner from a Drill that only feeds a Lab, and sell its goods." What a Refiner built for it still lacks (the wire to the Market, the Dump) always comes first, so no Refiner is left blocked while the card asks for something else. (Two lines were tried, one for each kind of slack: played in the page, the second took the card while the first could not be paid for and then gave it back with a Refiner half wired.)
  - *Only while it pays for itself.* After Fabrication is researched the reserve is the Fabricator's whole price and holds every step that costs credits. A step of the tune-up is given past it while what it earns pays its price back before the Fabricator can be bought (`paysBack` in `src/advice.ts`): with the step earning `gain` credits a second from `lead` seconds after it is given, the Fabricator comes sooner exactly when `gain × (seconds left − lead)` is more than the price. The seconds left are the credits still short at the income from sales, steadied (`Game.creditRate`, a 3-second average that ripples by a quarter, averaged again over 20 s of looks: `ADVICE.payOver`), and only three quarters of them are counted on (`ADVICE.payShare`): orders pay in lumps that income does not show, and it is rising while the line's own steps take hold. `lead` is 4 s for a level of Speed and 14 s for a Refiner that still has to be wired (`ADVICE.payLead`). `gain` is read off the board: for a Refiner, its product at full price with Flow's bonus; for a level of Speed, the more the machine then makes, for the share of that port's leftovers that goes to a Market, plus what one more producer flowing adds to every sale. No copy of the game is run, so the card can ask at every refresh.
  - *It leaves, and does not come back.* A kind of step that has been on offer and, with work of its kind left, no longer pays (after the ten seconds a given step stays, `ADVICE.lineHold`) is shut for the rest of the goal: the seconds left only run down, and a step that came back on a ripple of the income would be a line that ticks, unticks and ticks again. When no step is on offer the line is ticked if the player has carried one out ("Your line is tuned: nothing else pays for itself before the Fabricator."), and is off the card if not (`tuneState(g)`: `open`, `done`, `none`). It is also off the card, not ticked, while what is left of it waits for α that Fabrication needs first. All of this is remembered beside the game, not in it: a copy, or the save loaded again, looks afresh. The card is never left showing a step with no Show me: there is no "Saving for this" on this line.
  - *Measured.* Every paid step of the tune-up given to the pacing tool's card-only player was tried in the real game from that very board, with the step and without it, nobody doing anything else (`tests/meanwhile.test.ts`, seeds 0–3, for the player who claims 8–16 s late and the one who claims at once): none made the Fabricator's price come later, each 0–4 s sooner. In whole runs with the line and without it (`--skipLine=tune-up`) the Fabricator goal is 11–18 s shorter on seeds 0–3. Looked at on every tick of those runs, the card's row on this goal never showed a step, took it back and showed it again on an untouched board, and no line of any goal is shown already ticked, or stands on the card with no step and no reason.
  - *What it is not.* Raw goods are never wired to the Market for it (an earlier build's `sell-raw` line had every card player selling Sand over its demand at minute 17). Speed on the Assemblers is not part of it: it pays back in about two minutes, which this wait does not reliably have.
- **The Circuit line is the only place a wire into a Lab is cut, and it is the card that says so.** It shows only while Fabrication's β is covered (in hand, or still to come from the rewards of goals 21 and 22), no Fabricator stands and the credits for one are short (`Meanwhile.when`); `Meanwhile.cuts(g)` names the wires. It comes on goal 21, and stays on goal 24 if it is still to do. The word is "cut" everywhere, as on the inspector's button ("Cut wire").
- **After the demo the β is needed again.** Laptop and Robot cost 300 and 250 β. A player who has cut the Circuit wire and runs out of β there is told "Wire the Circuit Assembler's port to a Lab: Circuit is 5 β each in a Lab." (a wait that would never end is never met with silence). That is the one tip that goes against a card's line, and only in free play.
- **Leaving out every line** leaves the growth goals to the player's own reading of the card. The pacing tool's players always read a growth goal's line (after looking at the card for 12 s, `CFG.wayDelay`): a scripted player has no other way to solve one, so "without the line" cannot be measured for them, and what a person does there is the first thing to watch in a playtest.
- **What was tried and dropped:** a card of its own for Speed ("Speed up a Drill") before the second Glass goal, and one for land before the Plastic goal (each was a new thing handed over with nothing to use it on; the growth goal that needs it teaches it better); rates measured from the wires alone (a third Refiner with no Sand to spare read 1.69 a second on a board making 1.09) and from utilisation alone (a level of Speed passed the goal the moment it was bought); growth steps of two gestures ("place and wire"), which a Show me cannot act out one at a time; a third growth goal on Glass after land (two beats on the first material are enough before something new).
- The card players (`tests/cardPlayer.ts`, the pacing tool's newcomers) follow a line like a how, one gesture at a time, before any tip, and they do it through `lineAdvice` and `applyAdvice`: the step they take is the one the card's "Show me" acts out.

**The line's next step: `lineAdvice(g)`.** So that the card can put a "Show me" on the line, `lineAdvice(g)` in `src/advice.ts` returns the next concrete step of the line the card shows, as an `Advice`, the shape a tip has: something the interface can point at and `applyAdvice(g, a)` can carry out. One step at a time, read to the letter (`text.mouse === text.touch`):

| Line | Steps, in order | What the `Advice` carries |
|---|---|---|
| the growth lines | `growNext`, above | `wire { from, to, port }`; `build` with `node` and `port` (a machine or a Dump from a port) or with `deposit` (a Drill); `upgrade: 'speed'`, `node`, and `culprit` where it is for a short maker; `expand: true` |
| `flow-fix` | the one change that gets the short producer flowing: a level of Speed on what feeds it, or its port wired to a Market | `upgrade: 'speed'`, `node` = the supplier, `culprit` = the short producer; or a `wire` |
| `cut-glyph` | the first wire that still takes Circuit into a Lab ("Cut the wire from the Circuit Assembler to the Lab: sold, each Circuit is 20¢.") | `cut { wire, from, to }`, `node` = from |
| `tune-up` | what a Refiner built for it still lacks (its product's wire to the Market, a Dump for a by-product); else Lab Speed where Drills outrun their Labs; else a level of Speed on the machine a Drill outruns; else a Refiner from a Drill that only feeds a Lab or stands unwired; else a Drill on a free deposit (the last three only while they pay for themselves) | `upgrade: 'speed'`, `node` = the machine, `culprit` = the Drill; `build: 'refiner'`, `node` = the Drill, `port: 0`, `recipe`; `build: 'well'`, `deposit`; `wire`; `build: 'void'`, `node` = the Refiner, `port`; `research`, `culprit` = the Drill |
| `prism-fab`, `glyph-fab` | the maker's port (the one with the most to spare) to the Fabricator | `wire`, `node` = the maker |

- It is `null` when the goal has no line, the line is done or does not apply, the goal is ready, or the step cannot be paid for right now (it is back the moment the credits are there; once given it stays through the ripple of the income, `ADVICE.lineHold` above); `lineHeld(g)` then says what it is waiting for.
- `Advice.expand` only ever comes from here: no tip expands the board. `applyAdvice` presses Expand for it.
- It promises nothing: `saves` is absent and `eta` is 0, because nothing is measured. It runs no copy of the game and leaves the game untouched (microseconds a call; `tests/meanwhile.test.ts` times it), so it can be asked on the page at every refresh. It is not held back by the 20 s of quiet after a change.
- Followed from the card players' boards (the tests' player with and without tips, and the pacing tool's card-only player and newcomer, seeds 0–3), every line ends done in a bounded number of steps (the tune-up may also end by leaving the card), every step could be paid for and done when it was given, and through whole runs it never gives a step without a line or for a line that is done.
- **Goal 25's lines and progress.** A Fabricator built from the Screen Assembler's port, as goal 24 says, has its Screen and no Circuit: the Screen line is done when the goal comes up and is left out, and the card asks for the Circuit wire (labelled "Next step" by the card, `required`). One built anywhere else gets the Screen line first, "1 of 2". `goalView(g).progress` counts the inputs wired, `[fed, 2, 'inputs wired']`, then `[0, 1, 'Phone']`, and `goalView(g).inputs` lists them (`{ mat, name, fed }`, goal 25 only). The Phone follows within 30 s of the last wire either way.
- **A tip never says what the line is saying.** While a step is on offer here, `advice(g)` does not give it as a tip (the same action, or the same sentence about another node of the same name), nor another ending to its first gesture. The Flow line and the adviser's Flow tip are the same step, in the same words, so a player who reads the Flow line gets no Flow tip, and one who reads no line gets neither (the valve then; see Flow), with one exception: where the goal would not complete without that step within the adviser's look-ahead, valve steps included, the Flow tip is given all the same (a candidate the line names is marked `line` and kept by `judgeFlow` only then). The card's own "one voice" rule (src/ui/advice-tip.ts) still hides a tip that asks for the line's next step while the line is up, so on the page the line says it once.

## Tech tree

| ID | Tech | Cost | Requires | Gives |
|---|---|---|---|---|
| **Processing** | | | | |
| P1 | Refining | goal 3 | — | Refiner, Glass |
| P2 | Oil Deposits | 40α | Lab | Oil Drills, Plastic + Tar, Dump |
| P3 | Ore Deposits | 195α, opens with goal 13 | P2 | Ore Drills, Copper |
| P4 | Assembly | 600α, opens with goal 16 | P3 | Assembler, Circuit |
| P5 | Quartz Deposits | 900α, opens with goal 19 | P4 | Quartz Drills, Silicon, Screen |
| P7 | Fabrication | 600α + 100β, opens with goal 23 | P5 | Fabricator, Phone |
| P6 | Reclamation | 300α + 25γ | P4 | Rubber, Cable |
| P8 | Laptop | 3,500α + 300β + 100γ | P6, P7 | Laptop |
| P9 | Robot | 8,000α + 250β + 450γ | P8 | Robot |
| U1 | Efficiency Tuning | 40β | P1, P4 | Efficiency upgrades |
| U2 | Overclock | 60γ | U1 | Speed cap 10 → 25 |
| **Logistics** | | | | |
| L1 | Routing | 50α | Lab, P2 | Router, Ratio mode |
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
| C4 | Luxury Buyers | 300β, hidden until the first surplus | C2 | +25% value on parts and products (T2 and T3) |
| C5 | Exports | 80γ, hidden until the first surplus | C4 | +100% demand |
| **Research** | | | | |
| R1 | Lab | goal 7 | — | Lab, tech tree |
| R2 | Lab Speed | 50α | R1 | Labs study 2 items/s |
| R3 | Deep Analysis | 80β | R2 | +50% Data per item |
| R4 | Long Absence | 210α, hidden until the demo ends | R1 | time away capped at 8 h instead of 2 h |
| **Scale tools** | | | | |
| S1 | Bulk Upgrade | goal 21 | P4 | "Upgrade all" button |
| S3 | Auto-balance | 50β | S1, L4 | one-click Router weights |
| S2 | Mobile Drills | 80α | P3 | a Drill can be moved like any card; its deposit goes with it |

How the prices are meant to work:

- **The spine (P2 → P3 → P4 → P5 → P7) is paced by the growth goals, not by its prices.** Each step after Oil Deposits is locked until the growth goal before it is claimed, and that claim pays about two thirds of it (120 of 195α, 400 of 600α, 600 of 900α, 400 of 600α): a player who kept their Data researches at the claim. So the prices are no longer the wall they were (Assembly was 1,325α and Quartz Deposits 1,875α, each a wait of two to three minutes that the cards' lines filled with Drill-and-Lab pairs). What a price still does is ask for a Lab that studies something: a player with no Lab at all, or one who spends every α on side techs, waits, and the adviser speaks to that wait. The fast players are the floor (no first Phone before 14:00), and what holds them there now is credits: the Assemblers (1,200¢, ×1.5), the land (360¢, ×2.5) and the Fabricator (8,500¢).
- **Laptop is 3,500α and Robot 8,000α** (1,200 and 2,800 before; their β and γ are unchanged). With the spine no longer a wall of α and two lines of everything behind the Phone, the old prices no longer held free play's last research back; they were raised so that the fast players' first Robot stays where the plan wants it. It is 24:02–29:11 on seeds 0–14 (the target: not before 24:00, by 30:00).
- **Fabrication is 600α + 100β.** The β is what goal 18 ("Study Circuits for β") and the rewards of goals 21 and 22 bring; the card's line for the last wait (stop studying Circuit, sell it) is true because that wait is for the Fabricator's price and not for Data, for every scripted player.
- **Efficiency Tuning needs Assembly** (P1 and P4): it is priced in β, and before Assembly there is no β to pay with, so it only stood in the tree as something that could not be bought.
- **Oil Deposits is the one research that is waited for** (40α, the first: its whole goal takes a card player 16–25 s, with a Lab just built and the 20α of the goal before in hand). It is where the tech tree is met, and a short wait with the tree open is part of that.
- **Side techs are impulse buys.** Each is small next to the spine tech it competes with, so every kind of player picks them up along the way: α for what helps before the first Circuit (Routing, Lab Speed, Merger, Pipes Mk II: 200α together), β after it. Routing is one of them now, 50α behind Oil Deposits: no goal asks for a Router, and a player who wants to split a stream between a Lab and the Market can from the Plastic chapter on. Wider Demand is β for that reason: nothing sells over demand before the first Circuit, and at 200α it cost a fast player most of a minute there (it is hidden until the first surplus now). Luxury Buyers is the exception: dearer than Fabrication's β, so it comes after.
- **Mobile Drills is 80α, behind Ore Deposits.** It is for the board and not for the line: a Drill can be moved, and nothing is made or sold any faster for it. It comes with Ore because by then the board has been expanded and where its Drills stand has begun to matter. The pacing players leave it alone (`techSkip` in `tools/pacing.ts`: a scripted player lays nothing out), and with it in the tree every pacing target is still met; its price counts, as any open tech's does, in which kind of Data an order pays.
- **γ does not exist before the first Phone,** so anything priced in γ is free-play content. The late Processing techs need all three kinds of Data, which keeps Tier 1 items worth studying to the end.
- **Bulk Upgrade stands behind Assembly** (it stood behind Routing, which is a side research now); it is the reward of goal 21 either way.

## The adviser

`src/advice.ts`. When the active goal is a wait, the adviser may name one thing worth doing meanwhile. It is measured, not assumed: each candidate is tried on a copy of the game against an untouched copy, with the real rules, and tips are ranked by the seconds they save. Silence is its normal state, and more so now: the growth goals are not waits (their own line names the next step), their claims pay for the research that follows, and the one long wait for credits has the card's tune-up. The scripted card players are offered no tip in a whole demo on seeds 0–14, whether they read the lines or not. The adviser speaks to the player the cards did not plan for: one who spent their α on side techs and now waits for a spine research (in the tests, the card player who has no α in hand at each research: a wait for Data at every one of the five, one to three minutes each after the first, and a handful of tips in a demo: Glass, Plastic or Tar wired into the Lab, a second Lab when the first is full, a Drill on a free deposit wired to a Lab), one whose order asks for something that reaches no Market, one whose Lab is crowded.

- **For the tech tree:** `savingFor(g)` is the research the card is saving for right now (its step's tech, `'P4'` while "Make your first Circuit" waits for Assembly's Data), or `null` (no such step, the card ready to claim, or the tech owned). `researchDelay(g, id)` is the seconds by which researching `id` now would push that research back, at the income the card's own count uses: what it spends of the Data that research still lacks, divided by how fast that Data comes in. It is 0 when it would not delay it (no such research, the same tech, Data of another kind or to spare) and `Infinity` when the Data it spends has nothing coming in. Both read the board only and run no copy of the game (`tests/advice.test.ts`).
- **"The Lab is full" says which Lab:** "the Lab you have" when there is one, "the Lab it feeds" when the port already feeds a full one, "every Lab studying β" when all that study that tier are full (`SAY.labFull`).
- **The order wait is the first order's only.** An order is a wait for the adviser on "Fill your first order" alone; later orders run beside the cards and are not something the card asks for.

- **A wait** is a goal whose next step is a purchase the player cannot pay for yet (credits or Data), the Flow goal, or an order goal whose order is still filling. `waitInfo(g)` gives `{ unit, have, need, eta, name }` for the first kind (`name` is what is being saved for: "Assembly", "the Fabricator"); `waitKind(g)` names any of them.
- **A research and the machine after it are one wait.** Where the card asks for both (goals 14, 17, 20, 24), the wait is for whichever is further off, the Data or the credits, and `waitInfo` and the tips are about that one.
- **A tip is offered for one of three reasons only.** It saves at least 15 s of the wait (`ADVICE.minSaves`; when the wait outlasts the 300 s look-ahead its end is an estimate, and the tip must also save 4% of it: `estSaves`, `estShare`). Or it ends a wait that would otherwise never end. Or it is a Flow tip that gets the producer it names flowing and keeps it flowing for 20 s more (`flowWatch`). A move that only brings the Flow goal "closer" is not a tip.
- **The share of the wait a measured tip must save stays at 1%** (`ADVICE.minShare`). Raising it to 8% was tried, on the idea that a promise of 15 or 20 s in a wait of five minutes is inside what the orders' lumps of pay move the real outcome by. Replayed in the real game on seeds 0–14 (see "Measured against the real game" below): the card-following players are offered and follow exactly the same tips at either share. For the player who follows tips and ignores the lines the worse timings did not reliably drop (6 of 688 at 1% against 13 of 650 at 8% at 6 s an action; 10 of 644 against 4 of 632 at 10 s; a commit earlier, with the hints of goals 15 and 19 in their first new order, 14 of 730 against 5 of 708 and 6 of 634 against 1 of 614), while a tenth of that player's tips went, true ones among them, and their slowest Phone moved from 26:20 to 28:50 (27:49 to 31:00 at 10 s). On a twenty-minute save with no orders, 8% heard three tips instead of nine and took three minutes longer. `npm run pacing -- --minShare=0.08` tries a share; `tests/advice.test.ts` holds the 1% and shows what 8% costs.
- **Every tip carries `saves`:** seconds, or `Infinity` when the wait would not have ended without it.
- **Quiet after a change.** For 20 s after the player changes the board in any way, following a tip included, there is no tip (`RULES.tips.quiet`; `adviceQuiet(g)` is what is left of it). The same request is not made twice within 60 s (`repeatAfter`): after Speed was bought on a Lab, no tip asks for Speed on a Lab until a minute has passed. Both read the game's own log of the last changes (`Game.edits`, written by every action and by research, saved with the game), so they hold wherever the adviser is asked.
- **A tip that left does not come back** while the board, the goal and the kind of wait are the same: no A, B, A. Checked on the twenty mid-game saves on which "buy Speed on the Lab" and "build a second Lab" had been seen to take turns (at 91, 123 and 137 s of one wait): an earlier build's adviser does it on those saves, at those seconds; this one says each thing once, asked directly or through the worker's long-lived copy, with the order's Claim pressed or left. `tests/advice.test.ts` pins it on the boards of the scripted player who follows tips and no lines, 20 s and 60 s into the three long waits.
- **A tip never says what the card's line is saying.** While `lineAdvice(g)` has a step on offer, that step is not a tip, nor is another ending to its first gesture (see "The line's next step" above). The card-following players never meet the overlap (they do the line before a tip can come).
- **No tip reverses a card.** A Router that favours a Lab is never turned away from it (the player set it so). A wire into a Lab is only cut where the card's own line says so (`Meanwhile.cuts`, goals 21 and 24), and there it is the line's own step that says which ("Cut the wire from the Circuit Assembler to the Lab: sold, each Circuit is 20¢."); as a tip that sentence can only appear for a second such wire that reads differently. Nothing a hint or a line had the player build is sold, cut or rerouted by a tip.
- **Circuit in a crowded Lab.** A Lab takes its inbox in first-arrival order (the rule stands). A player who has wired raw Drills into the one Lab before goal 18 ("Study Circuits for β") and then wires the Circuit in, as that card says, gets next to no β: on the card players' boards bent that way (every Drill wired into the Lab as well), next to none of the 40 β comes in for minutes. What the game says: the card's wait line reads "nothing is bringing in β yet" from the first second; there is no alert chip (nothing is starved or blocked: the Assembler sells what the Lab does not take); and once the quiet after the player's own change is over, the tip is a Lab built from the Circuit Assembler's port ("…the Lab you have is full.") or Lab Speed. Followed, the goal is done within a minute or two. That is said in time and is enough, so nothing was added; `tests/advice.test.ts` pins the tip, its timing and the outcome on such boards.
- **A tip does not blink.** Once given, it stays on offer while the board does not change and it still saves 15 s (the same bar as for a new tip: one that falls below it is gone until the board changes); another tip takes its place only by ending the wait 3 s and 5% sooner (`keepWithin`, `keepShare`).
- **Savings near the bar are checked twice.** The look-ahead runs at half-second steps. When the end of the wait was reached in the look-ahead and the tip saves less than a fifth of it, the tip is tried once more against doing nothing at a tenth of a second (`ADVICE.fine`, `checkShare`), and is only given if the saving is still there; that second measurement is the saving it is given with.
- **What it can say** (the sentences are built by `SAY`, one builder per kind; the builders whose names begin with `line` are the steps and words of the cards' lines, used by `lineAdvice` and the card only): wire something into a Lab, or something better; speed up a full Lab, or all full Labs with Bulk Upgrade; speed up a Drill or machine that runs flat out on the way to what is short; build a second Lab; put a Drill on a free deposit and wire it to a Lab, a Market or a machine short of that material; sell what backs up or is not sold at all; build a Refiner on a Drill that sells raw; press Favour on a Router (never away from a Lab); research Lab Speed, Deep Analysis or Wider Demand when they pay for themselves inside the wait; send the ordered material to a Market; and for the Flow goal, the producer furthest from flowing and its fix.
- **No sentence is longer than 90 characters** (`RULES.tips.maxLength`): `tests/advice.test.ts` runs every builder of `SAY` over every material, node and tech name in the content with eight-digit prices. The wording no longer depends on the input (`text.mouse === text.touch`): a sentence names the thing and the button ("buy Speed on the Ore Drill (50¢)"), never a click, a drag or a key.
- **Flow tips fix one producer at a time.** A Flow tip names the Drill or machine that holds Flow back (`Advice.culprit`) and what to do about it (`Advice.node`). It is true when that producer flows with the fix, stays flowing, and would not have without it; `saves` is how much sooner the goal completes (it can be 0 on a board with more than one thing wrong, which takes a tip for each). A fix after which the goal would complete later than by doing nothing is dropped; where no fix passes, the goal's valve does.
- **What it never says:** anything the player cannot afford, anything that does not pass the tests above, or anything for a wait that ends within 12 s anyway. When something sells over demand the tip says so, and making more of that material is never worth saying because it is measured at the surplus price.
- **In the copies nobody plays,** but orders still pay. Nothing is bought; the order the game has is claimed 10 s after it fills (`claimAfter`); no new order is rolled. From then on the copy is paid what the orders to come are worth on its own sales (`ordersWorth` in `src/orders.ts`: the first three candidates at 55/30/15%, sized from what the copy sells). Before this, a tip that sold less looked better than it is and one that sold more looked worse: orders are a third of a card player's α in a long wait.
- **Measured against the real game.** Every tip the tests' players are offered (the card players who spent their α elsewhere: 19 tips of five kinds) is replayed in a plain copy of the game with the tip done and with nothing done, under two order sequences (`tests/advice.test.ts`, "every tip on a real board…"): each can be afforded and done when it is given, none ends the wait later, and at least four in five end it sooner (the rest end it the same second: an order's lump of α ends the wait in both). The longer harness of the builds before (every tip of the pacing tool's players on seeds 0–14, timed every 5 s) has nothing to replay now: those players are offered no tip.
- **Cost:** a fresh verdict takes 14–17 ms at the median, 37–48 ms at the 90th percentile and up to 155 ms on a card player's boards (measured in Node on a deserialised copy, 1,685 verdicts). It is kept for 15 game seconds while the board does not change, and for no more than 15% of the wait it was worked out for (`ADVICE.refresh`, `refreshShare`), so every other call is free. That cache, and the memory of tips that left the card, belong to the Game object asked: a caller that hands over a freshly deserialised copy each time gets neither (the quiet and the 60 s rule still hold, they are in the game).

## Time away

Nothing before the first Phone. After it: 50% of the live rate, measured on a copy of the game, for up to 2 hours (8 with Long Absence).

## Saves

`deserialize` in `src/state.ts` loads what it can and gives every field a sound value, rather than refusing a whole save over one part it cannot use (`tests/saves-old.test.ts`):

- **A save from the public version** (it has no `goal` field) charged less for everything. Each of its nodes gets `legacyPaid` = what it cost there, and never refunds more than that plus what is spent on it here (`refundOf`). Deleting its three Assemblers refunded 5,850¢ for 1,389¢ paid, and a Drill with ten levels of Speed 9,091¢: the Fabricator for the price of a few deletes. The cap survives a save and load of this version; a node bought here has none. A player who does what the cards say plays such a save to the Phone with no goal standing for good.
- **A damaged save loads and plays.** A node of a kind this version does not know (a later version's) is dropped with its wires and the rest of the board is kept; a `null` entry, a second node with an id already in use and a wire from a port the machine does not have are dropped; a pipe tier this version does not have becomes the best it has; missing or broken fields (a node's levels, its position, the board, the deposits, the stats, `nextId`, numbers that JSON wrote as `null` or that are infinite) get the new-game value, and `nextId` is always above every id in use. Twenty-one kinds of damage are tested: each loads, plays a minute, survives a second save and load, and leaves no NaN, no infinity and no duplicate id.
- **A save that cannot be read at all is copied aside** to `flowstate-save-v1.bak` (`BACKUP_KEY`) before the new game the start screen offers can overwrite it. A readable one leaves no copy.
- **A save from before the done lines were noted** (`goalAt.had`): the lines that are done when it is loaded count as done when the goal came up, and are not shown.
- **A save from the chain before the growth goals** (`Game.chain`, absent or 1; `CHAIN` is 2; `migrateChain` in `src/goals.ts`, run on load and before anything reads the goal) is moved to the same card by its id, or, for the three cards that are gone, to the nearest that still stands: "Speed up a Drill" to "Make 1.2 Glass a second", "Route more to a Lab" and "Open up more land" to "Hold 95% Flow". A goal that was ready stays ready where it is the same goal. On the first tick the chain's repair unlocks what the goals before the card unlock and opens what they open (a save on "Make your first Circuit" can research Assembly), and pays no reward again. Such a player meets the growth goals from their card on; one whose board already makes a rate claims it at once. A save that owns a locked tech keeps it (`tests/save.test.ts`).
- **Old saves and "Speed up every Drill at once".** A save from an older build that arrives with "Fill three orders" ready is checked again once, so its Claim is not handed out for the goal that replaced it.

## Where the pacing lands

`npm run pacing` plays six players on order seeds 0–3 (seed 0 is the order sequence every real new game starts with) and checks each run against the targets; `-- --summary --seeds=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14` gives the tables below. `tests/pacing.test.ts` pins every target for all six on seeds 0–3, so `npm test` notices a change that moves the pacing.

- **mainline, greedy:** fast players who know the game: one action per 3–4 s. From the moment a new machine cannot be paid for they bank half of what comes in and may spend the other half on upgrades; once they own Bulk Upgrade, nodes of a kind that want the same upgrade get one press of "Upgrade all" when they are at least half of that kind. On a growth goal they take its line's step when they can pay for it.
- **newcomer:** does only what the goal card says, how and lines, one action per 6 s, claims 8–16 s late, and follows a tip once it has been on offer for 15 s of a wait. Never builds a Router, upgrades or wires anything unprompted. On a growth goal it looks at the card for 12 s (`CFG.wayDelay`), then opens the how and follows its line one step at a time.
- **newcomer10:** the same person at 10 s per action.
- **cardonly:** the newcomer who never follows a tip. The cards have to carry the game alone, so this player has targets too, among them the "nothing to do" measure.
- **nolines:** the newcomer who never reads a "while you wait" line (the Flow fix, the cut of the Circuit wire, the tune-up): the hows, the growth goals' lines and the tips only.

**What the scripted players cannot show.** A growth goal is a problem with several answers, and a scripted player has one: the card's own line. So these tables say that the chain can be played to the end by reading the cards, how long that takes and how much of it is waiting; they do not say whether a person finds a growth goal a pleasure or a chore, whether "0.5 / 1 Plastic a second" is read as an invitation, or how long someone looks at a board before opening "How?". Those are the first things to watch in a playtest.

**Nothing to do** (the NOTHING TO DO table, `Bot.nothing` in `tools/pacing.ts`): up to the first Phone, the time in which the player's hands are free, the goal is not ready to claim, no order is, and the card's line has no step that can be done now (`lineAdvice(g)` is null). A tip on offer does not count as something to do. A line the player leaves alone still does, so the measure only compares runs that read the same lines. The tool looks at the line's step on every tick, hands free or not, as the page looks whenever it draws the card. It is a measure of this player, who claims 8–16 s after Claim lights: a ready goal or order counts as something to do. For each goal the table gives the seconds and, in brackets, the longest stretch of them. The tool's checks for the card-only player: nothing to do for at most 25% of the time to the Phone, at most 50 s at a stretch, at most 90 s on any one goal (the pacing targets), and nothing sold over its demand before the Phone (every card player).

The tables compare two builds, all six players on order seeds 0–14: "Before" is the build before the growth goals, "Now" this one. Every target holds on every run.

| Seeds 0–14 | Before | Now | Target |
|---|---|---|---|
| cardonly: nothing to do, share of the time to the Phone | 23–27% (245–287 s) | 13–16% (144–178 s) | at most 25% |
| cardonly: longest stretch of nothing to do | 51–58 s | 27–45 s | at most 50 s |
| cardonly: most nothing to do on one goal | 51–70 s (Circuit) | 54–80 s (Fabricator) | at most 90 s |
| cardonly: nothing to do by goal | Oil 11–18 · Copper 51–56 · first order 24–30 · Circuit 47–70 · β 21–42 · Silicon 24–58 · Fabricator 20–43 s | first order 25–30 · β 19–34 · Fabricator 54–80 s; on some seeds Flow 10–17 and Screens 11–24 s | — |
| newcomer | the same as cardonly | the same as cardonly | — |
| newcomer10 | 9–13%, up to 40 s | 5–7%, up to 38 s | — |
| nolines | 6–10%, up to 71 s | 5–8%, up to 42 s | — |
| card players who sell over demand before the Phone | 0 of 60 | 0 of 60 | none |

The newcomer and the card-only player play the same game, to the second: the newcomer is offered no tip in fifteen runs. Where the waiting went: no research after Oil Deposits is waited for any more (the Copper, Circuit and Silicon cards held 51–56, 47–70 and 24–58 s of nothing to do), and what is left is the first order (it counts from when it appears), the 40 β of "Study Circuits for β", and the save for the Fabricator, which is dearer than it was and is now the one place a card player waits for long.

| Fast players (30 runs, seeds 0–14) | Before | Now | Target |
|---|---|---|---|
| First machine / Lab / research | 0:21–0:23 / 0:37–0:40 / 1:00–1:03 | 0:21–0:23 / 1:06–1:12 / 1:20–1:28 | by 0:45 / 1:30 / 2:30 |
| Longest wait in the first 2 min | 3–8 s | 3–5 s | 10 s |
| First Circuit | 7:04–7:45 | 6:25–8:53 | 6:00–10:00 (was 6:00–8:00) |
| First Phone | 14:30–15:39 | 14:43–17:37 | 14:00–19:00 (was 14:00–18:00) |
| Time on "Build a Fabricator" | 67–137 s | 60–90 s | 300 s |
| First Robot | 24:17–27:55 | 24:02–29:11 | not before 24:00, by 30:00 |
| Longest stretch with free hands before 10:00 / before the Phone | 38–44 s / 38–56 s | 18–37 s / 25–48 s | 60 s / 120 s |
| Credits from sales and orders at the Phone | 80–82% | 92–94% | 65% |
| Presses of an Upgrade button before the Phone | 22–37, of them 1 "Upgrade all" | 56–80, of them 5–8 "Upgrade all" | — |
| Orders filled before the Phone | 28–36 | 44–52 | — |
| First sale over demand | 12:53–22:21 | 4:44–8:23 (Glass or Plastic) | — |

The fast players spread out more than they did: a growth goal can take one of them 33 s and another, who arrives with less in hand, two and a half minutes ("Make 1 Plastic a second": 33–166 s; "Make 0.5 Screens a second", their longest goal: 130–235 s). They press Upgrade two to three times as often, because a rate is something Speed answers.

| The card players (15 runs each, seeds 0–14) | Before | Now | Target |
|---|---|---|---|
| **newcomer:** first Phone | 17:36–18:11 | 17:54–18:44 | 17:30–21:00 |
| longest time on any one goal | 181–197 s (Circuit) | 183–195 s (Fabricator) | 240 s |
| time on "Build a Fabricator" | 104–130 s | 183–195 s | 240 s |
| tips offered / followed in a run | 0 / 0 | 0 / 0 | — |
| credits from sales and orders at the Phone | 75–76% | 88% | 65% |
| **newcomer10:** first Phone | 19:43–20:22 | 21:15–22:02 | by 24:00 |
| longest time on any one goal | 194–217 s | 142–173 s (Fabricator) | 300 s |
| **cardonly:** first Phone | 17:36–18:11 | 17:54–18:44 | 17:30–21:00 |
| longest time on any one goal | 181–197 s | 183–195 s | 360 s |
| time on the Flow goal | 29–40 s (its line) | 34–50 s (its line) | 60 s on seeds 0–3 (pinned) |
| **nolines:** first Phone | 22:25–29:26 | 19:45–20:25 | by 30:00 |
| longest time on any one goal | 329–506 s (Silicon) | 211–238 s (Fabricator) | — |
| tips offered / followed in a run | 7–10 / 7–9 | 0 / 0 | — |

Where the time goes (seed 0, seconds on each goal; claims 8–16 s late are in the goal they follow; growth goals in bold):

| | goals 1–5 | **Glass 1** | **Glass 1.2** | Lab | Oil | Plastic | Tar | first order | **Plastic 1** | Copper | Flow | **Copper 1** | Circuit | β | **Circuits 0.6** | Silicon | Screen | Upgrade all | **Screens 0.5** | Fabricator | Phone |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| newcomer, cardonly | 1:41 | 40 | 58 | 24 | 16 | 26 | 17 | 55 | 71 | 39 | 47 | 63 | 44 | 64 | 53 | 37 | 53 | 21 | 60 | 195 | 29 |
| newcomer10 | 2:01 | 51 | 74 | 27 | 20 | 40 | 21 | 56 | 100 | 60 | 37 | 82 | 66 | 67 | 71 | 60 | 52 | 36 | 72 | 159 | 43 |
| nolines | 1:41 | 40 | 58 | 24 | 16 | 26 | 17 | 55 | 71 | 39 | 112 | 81 | 44 | 65 | 45 | 37 | 46 | 16 | 60 | 236 | 29 |
| mainline | 0:32 | 16 | 18 | 6 | 16 | 13 | 6 | 35 | 50 | 18 | 47 | 104 | 55 | 76 | 52 | 19 | 73 | 12 | 160 | 79 | 19 |

For the card player the six growth goals take 5:45 of the 18:33 to the claim of the Phone on seed 0, a little under a third of the demo, and no stretch between two new things is longer than the Fabricator's save.

Things to know before changing a number:

- **The growth goals are the pacing of the first three quarters; credits are the pacing of the end.** No spine research is waited for, so a spine price moves nothing for a player who kept their Data. What moves the first Phone is the price of what the growth goals have the player buy (Refiners, the two expansions, the Assemblers) and the Fabricator. With the Fabricator at 5,000¢ and the Assemblers at 600¢ ×2.5, the first Phone came at about 15:30 for the card player and at 11–13 minutes for the fast ones.
- **A rate that is hard to reach is a wait in disguise.** If a growth goal's cheapest route costs more than the player has when it comes up, the card shows "Saving for this" and the time on it is nothing to do. The two expansions (360 and 900¢) and the second Assemblers (1,800 and 4,050¢) are the purchases to watch: the card-only player has them in hand when the goal comes up, except the second Screen Assembler, which it saves 11–24 s for on eleven seeds of fifteen; a fast player, who has spent on Speed, saves 36–86 s for it and 10–41 s on the Copper goal.
- **The claim has to pay for the research.** A growth claim that leaves the player short of the research it opens puts a wait for Data straight after a celebration. The rewards are about two thirds of each price, and the tests' card player who has spent every α elsewhere shows what the wait is when they are not enough (one to three minutes, with the adviser's tips).
- **The fast players are noisy.** Their habits (bank half while saving, upgrade with the rest) make a run's Phone move by a minute for no reason a person would notice, and more now that a growth goal can catch them short. Over 30 runs the range is what counts; a margin of under half a minute on one seed is inside that noise.
- **A less obedient card player** (card-only, seeds 0–14; none of this has a target): at 10 s per action see newcomer10; leaving out one line, see "The cards' lines". The newcomer's tip what-ifs (`--tipDelay`, `--tipEvery`) change nothing: that player is offered no tip.
