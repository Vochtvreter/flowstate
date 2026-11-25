# Tiers: a proposal

Status: **all three tiers are built** (§13–§16): the Dock, the guided start's first contract, Tiers 1, 2 and 3, and the Foundry, played with `?tiers` in the address, beside the goal chain, which is unchanged. In a game of tiers the demo ends with Tier 3's contract. The rest of this document is the proposal as it was written, with the decisions of §11 taken as recommended, and lever E of §5 (one better machine) taken after Tier 2.

---

## 1. What we want

The loop we are after, in one sentence: **the player gets a set of tools, plays with them, builds, scales up and tunes, and when they are ready they move up a tier, get new tools, and rebuild what they have into something more interesting and better.**

That loop has four parts, and each needs something from the game:

| Part of the loop | What the game has to give |
|---|---|
| Play with the tools | A set of tools handed over together, and time and room to try them without the next thing being pushed at the player |
| Build and scale | A reason for a bigger factory: more machines must always mean progress, not a lower price |
| Upgrade and tune | Problems that tuning solves: ratios that do not match, lines that are short, wires that are full |
| Move up, rebuild | A new tier that changes what a good factory looks like, so that what the player built is worth rethinking, not only extending |

The pillars stay as they are ([DESIGN.md §1](./DESIGN.md#1-pillars)). Two of them are this loop already: *wiring is the toy*, and *experimenting is free* (full refunds, undo). The loop above is what those two pillars are for.

---

## 2. Why the current build does not give it

The current build is a guided path, and it is a good one: 25 goals, one gesture at a time, the first Phone at about 18 minutes for a player who does what the card says. It was tuned for that player, and every pacing target measures that player. But it is not the loop above, and tuning its numbers will not make it so.

- **The card sets the pace, not the player.** Nearly every goal is one step ("build a Refiner from this port"), and each tool arrives with the goal that first uses it. There is no moment where the player is handed a set of tools and left to play.
- **The growth goals are checkpoints, not playgrounds.** The six of them take 40–70 s each for the card player, 3–5 gestures each, and each asks for about twice what the player has. The moment the rate is reached, Claim lights and the next card brings something new.
- **Building past a goal does not pay in time.** A scripted player who grows each growth goal to twice its rate before claiming it (`--scale=2` in the pacing tool) reaches the first Phone 3½ minutes later than the card player (21:49–22:41 against 18:07–18:43). Raising demand so that the extra is sold at full price (the prototype on this branch) wins back about 25 s of that. The reason is payback. A Drill and Refiner make half a Glass a second, 1.5¢ a second; a new line that needs a new plot costs about 430¢, nearly five minutes of that. A second Circuit Assembler (1,800¢) makes a third of a Circuit a second at 10¢ each over selling its Plastic and Copper: about nine minutes. The next chapter arrives in one or two.
- **The Assembler's price ladder punishes building more.** Every Assembler, Circuit or Screen, makes the next one 1.5 times dearer. On one seed the scaling player's extra Circuit Assemblers pushed the first Screen Assembler to 6,075¢ and the second to 9,113¢, and the Phone to 25:25.
- **The logistics tools have nothing to do.** A Mk I wire carries 4 items a second; the growth goals ask for 0.5 to 1.2. Routers, Mergers, Silos, priority and filter modes and three more wire tiers are all in the game, and nothing needs them ([DESIGN.md §6.2](./DESIGN.md#62-sell-vs-study): "No goal asks for a Router").
- **Demand is the limit, and it is a rule, not a puzzle.** Every growth rate sits at about 80% of what the Markets buy at full price; beyond that, items sell at 25%. A player cannot build their way past that, only research past it, and the research is hidden until it bites.
- **A new tier does not change the factory.** When Assembly opens, the Plastic and Copper lines are rewired from the Market to the Assembler, and that is all. Nothing the player built becomes a worse way of doing things, so there is nothing to rethink.

None of this is a fault in the tuning. It is what a guided path is.

---

## 3. The shape of the proposal

**Tiers instead of a chain.** The game is split into four tiers. A tier begins by handing over its tools all at once, and ends when the player has filled its **contract**: a list of things to deliver. How they fill it is up to them.

**The Dock.** Contracts are delivered to a node of their own, the Dock: wire anything into it and what the contract asks for is taken and counted. The Dock **consumes** what it takes and pays nothing for it. Everything else the player makes still goes to Markets (credits) and Labs (Data) as now.

This is the one mechanism the rest hangs on, and it fixes the problem the prototype measured:

- **A bigger factory always means sooner.** The time a contract takes is what it asks for divided by the rate the player delivers it at. Double the line, halve the time. Scaling pays by construction, not by tuning a payback.
- **The split is the decision.** Every item sent to the Dock is an item not sold. Early in a tier the player sells to build; later they turn the line toward the Dock. That is a Router's job, which gives the Router a reason to exist.
- **The card shows what building does.** The contract shows a time to finish at the current rate ("Glass 120 / 300 · 1.4 a second · 2:10 left"). Every machine added visibly takes time off it. Nothing else in the game rewards a bigger factory that directly.

---

## 4. The tiers

Every tool and recipe below is already in the game; only the Dock and the contracts are new. Contract sizes are first guesses, to be set by measurement (§9).

| Tier | New tools | Contract (first guess) | What changes in the factory |
|---|---|---|---|
| **0. First line** (guided, about 3 min) | Drill, Market, Refiner, Speed, the Dock | 40 Glass | Nothing yet: this is the tutorial |
| **1. Refining** | Oil and Ore deposits, the Dump, the Lab and Data, land (Expand), Router (even and ratio), Merger, Pipes Mk II, Mobile Drills | 300 Glass, 200 Plastic, 200 Copper | Three raw materials, not enough deposits for all of them, and a Market and a Dock that both want the same lines |
| **2. Parts** | Assembler (Circuit, Screen), Quartz deposits and Silicon, priority and filter routing, Silo, Pipes Mk III, Bulk Upgrade, Efficiency | 150 Circuits, 80 Screens | The Plastic, Copper and Glass lines stop being products and become inputs, in ratios they were not built for |
| **3. Devices** | Fabricator and the Phone, Reclamation (Tar to Rubber to Cable), Auto-balance, Overclock | 40 Phones | Three-input recipes; Tar stops going to the Dump |
| **4. Free play** | Laptop, Robot, the Commerce branch, Pipes Mk IV | Contracts that repeat and grow | The factory as a whole is the puzzle |

### 4.1 Tier 0: the guided start

What is guided today stays guided, but only up to the first Refiner and a level of Speed: about goals 1–7 now. The last guided step introduces the Dock with a small contract (40 Glass), so the player sees, before they are left alone, that the contract's time goes down when they build. From Tier 1 on there is no chain of goals.

### 4.2 Inside a tier

- **The contract panel takes the goal card's place.** Each line of the contract shows how many are delivered, the rate, and the time left at that rate. A line that nothing delivers says why ("No Copper reaches the Dock").
- **New tools are introduced, not assigned.** When a tier opens, each new tool gets a short card the player can open or dismiss: what it does, why it is useful, and a **How?** with the gesture, as today. These do not have to be done in order and nothing waits for them.
- **Research is the player's.** Data buys the tier's side techs in any order (Lab Speed, wire tiers, routing modes). The steps that today are locked behind growth goals (Ore Deposits, Assembly, Quartz Deposits, Fabrication) become what the tier hands over when it opens.
- **Help points at the bottleneck, not the next step.** The tools for that are built already: a card in trouble says what is wrong, the loss on a card says how much it is losing and why, and the Flows panel says which material is short. The adviser's job becomes "your Copper line is the slowest line on the contract: here is why", not "now build this".
- **Orders and the Flow meter stay**, as income and as a bonus for a tidy line.

### 4.3 Between tiers

When the contract is filled the tier ends with a celebration and the next tier's tools. The factory stays as it is: nothing is reset. What the next tier asks for, and the tools it brings, are what make the player want to change it (§5).

---

## 5. What makes a player rebuild

This is the part that most needs a decision. "Rebuild" means a new tier makes the old factory a worse way of doing things, so the player wants to rework it rather than add to it. There are several ways to get there; they differ in how much new content they need.

| | Lever | How it forces a rebuild | Needs |
|---|---|---|---|
| A | **New recipes eat old products** | A Glass line that sold to the Market now has to feed Screen Assemblers instead | Nothing: it is there now. On its own it is only rewiring |
| B | **Ratios that do not match** | A Screen takes 2 Glass and 1 Silicon; a Phone a Screen and 2 Circuits. One Drill, one Refiner, one wire no longer fits; lines have to be merged and split | Contracts sized so that the ratios bite; Routers in ratio mode and Mergers already exist |
| C | **Wires that fill up** | Tier 2 and 3 contracts need rates above 4 a second on some material, so one wire per line runs full and lines have to be gathered into trunks with Mergers and better wires | Contract sizes; the wire tiers already exist and are bought per wire |
| D | **Byproducts that find a use** | Tar goes to a Dump in Tier 1; in Tier 3 it is Rubber's input, so the Plastic line's waste end has to be rebuilt | Nothing: Reclamation exists, it only moves from free play into Tier 3 |
| E | **Better machines** | A tier brings a bigger, faster version of an old machine (a Drill Mk II on a deposit, a Refiner that takes two Drills). A row of small machines becomes worth replacing with a few big ones | New nodes, new art, new numbers |
| F | **Richer land** | New plots bring richer deposits, so the old Drills are worth moving there (Mobile Drills exists) | A deposit grade; a change to expansion |
| G | **Room** | Each plot has only so much space, so a new tier's machines only fit if the old lines are made tighter | A space limit; this is risky on a phone, where a crowded board is already hard to work |

**Recommendation:** A, B, C and D first. They need no new content, only contracts sized so that they bite, and together they give every tier a reason to rework something: B and C in Tier 2, B and D in Tier 3. Then add E for one machine in one tier and see whether a player who has it rebuilds more than one who does not. Leave G out.

**Missing tools that rebuilding needs.** Rebuilding is editing at scale, and some of the tools for that are not built: box-select, copy and paste, blueprints, and a block of cards for a finger. Deleting and rebuilding is free (full refunds), but slow without them. Blueprints fit naturally as a Tier 3 tool; box-select and copy and paste should be there from Tier 1.

---

## 6. Economy

- **Credits** still come from Markets and orders, and still buy machines, upgrades, wire tiers and land.
- **Data** still comes from Labs and buys the side techs of each tier. Sell or study stays the dial it is now.
- **The Dock pays nothing per item**, so there is no third income. Filling a contract pays a reward (credits and Data) and opens the tier.
- **Demand stops being the limit in Tiers 0–2.** Either the Markets' demand is set well above anything a contract implies, or the 25% surplus price is dropped until the Commerce branch appears in Tier 4. With the Dock as the sink, the Markets only have to pay for building. The prototype on this branch (demand raised to twice each growth goal's rate) is not needed if this is done, and should not be merged.
- **Price ladders per machine kind.** A Screen Assembler should not cost more because the player built Circuit Assemblers. Either each recipe has its own ladder, or the Assembler's growth comes down from 1.5 to about 1.15, as the Refiner's is.
- **Land** stays the limit on raw materials, as now: deposits are the only places Drills go, and expansions grow in price. That is a limit a player solves by building (expand, move Drills, speed them up), which is the kind we want.

---

## 7. Length

A guess, until it is measured: Tier 0 about 3 minutes, and Tiers 1–3 about 6–8 minutes each for a player who builds steadily, so the first Phone at about 25 minutes, against about 18 now. A player who builds more is quicker; one who builds less is slower but not stuck.

If the pitch has to stay at about 20 minutes, Tier 3 can be cut to a smaller contract (10 Phones), or the pitch can end at the end of Tier 2 with the Phone as the next thing to unlock.

---

## 8. What stays, what changes

**Stays as it is:** the board, wiring, clips and Tidy; the simulation; the materials and recipes; cards that say what is wrong, loss, Flows; the Flow meter; orders; Labs and Data; undo and full refunds; saves; the phone layout; the look.

**Changes:**

| | Now | Proposed |
|---|---|---|
| Goal chain | 25 goals, six growth goals among them | Tier 0's guided goals, then one contract per tier |
| Spine research | Locked until the growth goal before it is claimed | Handed over when the tier opens |
| What is revealed when | Each control with the goal that first uses it (`src/ui/reveal.ts`) | Each tool with its tier |
| Adviser and card lines | The next gesture of the card's line | The slowest line of the contract and why |
| Demand | The limit on every product from Glass on | Not a limit until Tier 4 |
| Undo | Stops at the last goal claimed | Stops at the last tier opened |
| Pacing targets and the tests that pin them | Measured on a player who follows the card | Measured on players who build in different ways (§9) |
| Saves | Moved between goal chains by `migrateChain` | Moved into a tier by what the save has unlocked |

---

## 9. How we will know it works

The pacing tool's players follow the card, and a tier has no card to follow. So the tool needs players that build in different ways, and new things to measure.

**Players** (the `--scale` player on this branch is a first step toward them):

- **Minimal:** builds one line of each thing the contract asks for and waits.
- **Wide:** keeps adding lines while it can pay for them.
- **Tuner:** buys Speed before it adds machines.
- **Rebuilder:** at the start of each tier, rebuilds its lines with the tier's new tools before adding to them.

**Measures:**

- **Every way works.** Each player fills every contract. The minimal player takes no more than about twice as long as the wide one, so nobody is stuck.
- **More building is faster.** Within a tier, a player who has invested more finishes sooner. If that ever fails, scaling has stopped paying.
- **No single best way.** No one player is fastest on every tier.
- **Rebuilding is worth it.** At the start of Tiers 2 and 3, the rebuilder delivers faster than a player who only adds on, by a clear margin.
- **Nothing to do.** Time with free hands, no affordable improvement and a contract more than a few minutes from done is kept short, as it is now.

**People.** All of the above says that the numbers work. Whether a person enjoys being handed a set of tools and a contract, how long they look at the board before trying something, and whether they rebuild when a tier opens can only be seen by watching people play. That is the first thing to do once Tier 1 is playable.

---

## 10. Risks

- **A newcomer left alone gets lost.** The guided path exists because no first-time player has been watched. Mitigations: Tier 0 stays guided, each new tool has its card and How?, and the contract always says what is short. But the risk is real, and only a playtest answers it.
- **A contract feels like a grind.** If the contract is too large, or the player's line is too small, the time on the panel is just a wait. It needs sizing by measurement, and possibly a first tranche that is small.
- **Bigger factories on a phone.** Rebuilding at scale needs box-select and copy and paste, which a finger does not have yet. A Tier 2 board will be bigger than anything played on a phone so far.
- **Speed.** Carrying a card on a 57-card board already drops to 26–43 frames a second on a slowed processor ([README](../README.md#what-has-been-tested-and-what-has-not)). Tiers 2 and 3 will have bigger boards.
- **The demo gets longer** (§7).

---

## 11. Decisions needed

1. **What forces a rebuild** (§5): A–D only, or A–D plus one better machine (E)? Richer land (F)?
2. **The Dock pays nothing per item**, only a reward at the end. Or should it pay something?
3. **Demand:** set it well above the contracts, or drop the surplus price until Tier 4?
4. **Length:** is a first Phone at about 25 minutes acceptable, or should the pitch end with Tier 2?
5. **How long Tier 0 is guided:** up to the first Refiner and Speed, as proposed, or also through the Lab?
6. **Editing tools:** are box-select and copy and paste part of this work, or after it?
7. **The current chain:** replaced by tiers, or kept as an option for the pitch while tiers are built beside it?

---

## 12. Order of work

1. **The Dock and the Tier 1 contract** on top of the current game, behind a switch, with the minimal and wide players in the pacing tool. The question this answers: does a bigger factory finish sooner, and does the minimal player still finish?
2. **Tier 0 cut down to the guided start**, the tool cards, and the contract panel. Then a playtest with people on Tiers 0 and 1.
3. **Tier 2**, with ratios and full wires (levers B and C) and per-kind Assembler prices, and the rebuilder player.
4. **Tier 3**, Reclamation moved into it, and lever E if decision 1 says so.
5. **Retire the goal chain and the growth goals**, rewrite the pacing targets and their tests, move saves, and bring DESIGN.md and CONTENT.md up to date.

---

## 13. Built: the Dock and Tier 1

Played with `?tiers` in the address (`Game.tiers`). Such a game is saved under a key of its own, so a game of the chain in the same browser is left alone. Without `?tiers` nothing has changed: the card players of the pacing tool reach the first Phone on the same second as before (18:21 on seed 0).

**The decisions of §11, as taken.** The rebuild levers are left for Tiers 2 and 3. The Dock pays nothing per item. Demand is four times every material's own in a game of tiers (`RULES.tiers.demandMult`), and the demand prototype that raised it with the growth goals is taken out again. The guided start runs to the first Refiner and Speed. Box-select and copy and paste are not part of this step. The tiers are built beside the chain.

**What a game of tiers is.**

| | Goal | Contract | Reward |
|---|---|---|---|
| 1–7 | the chain's first seven goals, as they are | | |
| 8 | Fill your first contract | 30 Glass | Oil Deposits, Ore Deposits, Routing, Merger, Orders, the Flow meter, 800¢ |
| 9 | Fill the Refining contract (Tier 1) | 400 Glass, 250 Plastic, 150 Copper | opens Assembly, 300¢, 400α |
| 10– | the chain from "Make your first Circuit" on | | |

The two contracts are goals of the chain's list marked `mode: 'tiers'`, and the chain's goals 8–16 are marked `mode: 'chain'`; each way of playing passes over the other's (`inMode`, `goalsOf` in `src/goals.ts`). So everything that comes with a goal by its place in the list (`src/ui/reveal.ts`) is there when Tier 1 opens: the Tech tree, Flows, the minimap, Expand. A save of the chain from before this (chain 2) is moved to the same goal by its id.

**The Dock** (`dock`, free, no tech: `Game.dockOn`, set when the first contract comes up). It takes from a wire only what the contract still wants of that material (`room` in `src/sim.ts`), counts it in `Game.contract.got`, and pays nothing. Where a port is wired to the Dock and a Market, the two share evenly, as any two sinks do; a Router sets another split. Once a material is delivered in full, the Dock takes no more of it, and a machine wired to nothing else backs up. A line that only feeds the Dock counts for Flow, and the Flows panel shows "to the Dock" beside "sold".

**On screen.** The goal card of a contract has a line for each material: delivered and asked, a bar, and the rate with the time left at that rate ("1.6/s · 1:27 left"), or "No Copper reaches the Dock". Under it, "New in this tier": a button for each tool Tier 1 hands over (Oil and Plastic, Ore and Copper, Land, Router, Merger, Lab and Data, Orders and Flow), which opens a sentence on what it is for and one on how to start. A phone's folded card keeps one bar for the whole contract. The build menu from a port offers the Dock first while the contract wants what that port gives. The Dock's inspector shows the contract.

**Land is cheaper in the tiers**: each plot costs 1.5 times the one before (360, 540, 810, 1,215¢), not 2.5 times (`RULES.tiers.expansionGrowth`). At 2.5 the players who build lines spent most of Tier 1 saving for land, and the one who built least was as quick as they were.

### Measured

`tools/tiers.ts` plays a new game of tiers on the real rules: the guided start by the card, then Tier 1 by one of five players (§9's four, and one who mixes). One action every 4 seconds; claims at once. Seeds 0–7 (they move only the orders):

| Player | What it does in Tier 1 | Tier 1 takes | Idle |
|---|---|---|---|
| minimal | one line of each material, wired to the Dock alone, then waits | 11:19 | 91% |
| wide | more lines for the material furthest from done, and land for them; each new line to the Dock and a Market | 6:40–6:43 | 66% |
| tuner | Speed on the slowest material first, lines and land after | 7:39–7:44 | 48% |
| sellfirst | three lines of each to the Market, then all of them to the Dock | 8:03–8:07 | 63% |
| mixed | wide, and Speed whenever no line or plot can be paid for | 5:51–5:58 | 18% |

The guided start ends at 2:26 for all of them. At one action every 6 s mixed takes 6:09–6:16 and minimal 11:19; at 10 s, 7:07–7:17 and 11:19.

What it says, against §9:

- **Every way works**: all five fill the contract on every seed. The minimal player takes 1.9 times as long as the quickest, inside the "about twice" of §9.
- **More building is faster**: each player who builds more than the minimal one is quicker, and the one who never runs out of things to buy is quickest.
- **No single best way**, with a caveat: mixed is the quickest because it does what the others do, whichever it can. Among the single-minded players, wide beats tuner. Selling first and delivering after loses to delivering half all along: with the Dock paying nothing, a line's credits buy the next line, and a line that delivers nothing does not shorten the contract.
- **Nothing to do**: a player with only one kind of move waits for most of Tier 1 (48–91%); one who mixes waits for 18% (none at 6 s an action). Tier 1 has enough to do for a player who uses all of its tools, and little for one who does not.

How the numbers were found: with the first draft (300 Glass, 200 Plastic, 200 Copper, 250¢ to start, land at 2.5×) the wide player took 9:26 and the minimal one 8:36: Copper set the pace for everyone, because Ore comes one deposit at a time. A contract weighted toward Glass, whose Sand deposits are many, makes building pay; land at 1.5× makes it affordable; 800¢ at the start lets the first lines be built at once. The first contract was 40 Glass from one Refiner and took 2:20; it is 30, and its how has both Glass Refiners wired to the Dock.

`tests/tiers.test.ts` pins the rules (the Dock, the contract, the skipping, the save) and, on seed 0, that every player fills the contract, that wide, tuner and mixed beat minimal, that minimal is within twice the quickest, and that a builder's Tier 1 is six to eight minutes.

**Seen in a browser.** In headless Chromium at 1440×900 and 390×844, from saves made by the mixed player: the first contract's card, the build menu offering the Dock first and building it with Enter, Tier 1's card with its lines and a tool opened, the Dock's inspector, Flows. No page error. Nobody has played it by hand from a new game, and no person has played it at all.

**Not built.** Tiers 2 and 3, and the rebuild levers of §5. Per-recipe Assembler prices. The tools are introduced on the card, not on the board (no Show me). After Tier 1 a Dock takes nothing more, and the chain's cards, prices and pacing after "Make your first Circuit" are the chain's: they were not tuned for a game of tiers, whose demand is four times higher and whose land is cheaper. The tiers' scripted players claim at once and read every card; the pacing tool's targets do not judge them.

---

## 14. Built: Tier 2

**What a game of tiers is now.**

| | Goal | Contract | Reward |
|---|---|---|---|
| 1–7 | the chain's first seven goals | | |
| 8 | Fill your first contract | 30 Glass | Tier 1's tools, 800¢ |
| 9 | Fill the Refining contract (Tier 1) | 400 Glass, 250 Plastic, 150 Copper | Assembly, Quartz Deposits, Priority Routing, Filter Routing, Silo, Bulk Upgrade (Upgrade all), 1,500¢ |
| 10 | Fill the Parts contract (Tier 2) | 200 Circuits, 100 Screens | opens Fabrication, 500¢, 400α, 100β |
| 11–12 | the chain's "Build a Fabricator" and "Make your first Phone" | | |

Tier 2 stands where the chain's goals from "Make your first Circuit" to "Make 0.5 Screens a second" stand, and a game of tiers passes those over (`mode: 'chain'`). A save of chain 3 (the build of §13) is moved to the same goal by its id.

**New in Tier 2, on the card**: Circuits, Quartz and Screens, Trunks (a Merger that gathers every line of one material and feeds the Assemblers wired from it, the rest going on to sell), Priority and Filter, Silo, Upgrade all, Wires (Pipes, as research).

**Assemblers go up by 1.15 in the tiers** (`RULES.tiers.assemblerGrowth`; 1.5 in the chain): 1,200, 1,380, 1,587, 1,825¢. A Screen Assembler is not dearer for the Circuit Assemblers before it by more than a Refiner would be. With 1.5 a player who built a third and fourth Circuit Assembler paid 6,075¢ for the first Screen Assembler.

### Measured

`tools/tiers.ts` now plays through both tiers, with a sixth player:

- **rebuilder**: mixed, but when Tier 2 opens it first rebuilds Tier 1's lines into trunks: a Merger for each of Glass, Plastic and Copper, every Refiner of it wired into the Merger, and the Merger wired to a Market and to every Assembler built after (a port feeds machines first, so the Assemblers take what they need and the rest is sold). New lines go into the trunk.

In Tier 2 the players differ in what they add: minimal builds one Assembler of each part and waits; wide adds Assemblers of whichever part is furthest from done, and a line for an input an Assembler waits for; tuner buys Speed on the slowest part's Assemblers, or on what starves them, before adding; mixed adds and buys Speed when it cannot add. Seeds 0–7, one action every 4 seconds:

| Player | Tier 1 | Tier 2 | Idle in Tier 2 |
|---|---|---|---|
| minimal | 11:19 | 10:12–10:16 | 82% |
| wide | 6:40–6:43 | 8:21–9:02 | 58% |
| tuner | 7:39–7:44 | 6:48–7:10 | 44% |
| sellfirst | 8:03–8:07 | 7:40–8:29 | 51% |
| mixed | 5:51–5:58 | 6:28–6:40 | 40% |
| rebuilder | 5:51–5:58 (as mixed) | 7:56–8:11 | 28% |

Against §9:

- **Every way works**: all six fill both contracts on every seed. The minimal player takes 1.6 times as long as the quickest in Tier 2 (1.9 in Tier 1).
- **More building is faster**: every player who builds beyond the minimal one is quicker. In Tier 2 Speed is worth more than width: the tuner, with three Assemblers and about thirty levels of Speed, beats the wide player, with eight Assemblers and none, by more than a minute. Assemblers that are added without the lines to feed them wait.
- **No single best way**: mixed is quickest in both tiers, as it does what the others do. Wide is second in Tier 1 and fifth in Tier 2; tuner the other way round.
- **Rebuilding is not worth it, yet.** The rebuilder is the slowest of the builders in Tier 2, 1½ minutes behind mixed, though it fills its Screens a minute sooner (5:29 against 6:35 on seed 0: a trunk gives a Screen Assembler its two Glass from every line at once). The rebuild costs about a dozen actions before the first Assembler, and pays back little: a port already feeds machines before Markets, so two or three Refiners wired straight into an Assembler pool their output as well as a trunk does, and no wire comes near its 4 a second (the busiest carries 2.3). Ratios (lever B) bite only where a recipe asks for two of one thing, and full wires (lever C) do not bite at all. What would make a rebuild pay is in §5: something that makes Tier 1's layout a worse way of doing Tier 2's work. That is the decision to take before Tier 3.

How the numbers were found: with the first guess, 150 Circuits and 80 Screens, everyone took 5:37–7:46 and the minimal player was only 1.4 times the quickest; 250 and 130 put the builders at 7:47–10:27, longer than a tier is meant to be (§7). 200 and 100 put them at 6:28–9:02. The 1,500¢ at Tier 2's start pays for the first Assembler at once. (The rebuilder at first also cut each Refiner's old wires to the Dock and the Market; that was twice the actions and changed nothing, as the Merger is fed first.)

`tests/tiers.test.ts` pins Tier 2's rules (the toolbox, the contract, the way on to the Fabricator, the Assembler's price, the move of a chain-3 save) and, on seed 0, for both tiers: every player fills the contract, mixed, tuner and wide beat minimal, minimal is within twice the quickest, and mixed takes five to eight minutes.

**Seen in a browser.** In headless Chromium at 1440×900 and 390×844, from a save the mixed player made in Tier 2: the card with its two lines and the Trunks note opened, and the phone's card opened. No page error. Nobody has played Tier 2 by hand.

**Not built.** Tier 3. A lever that makes rebuilding pay. The chain's "Build a Fabricator" asks for research the Tier 2 reward has opened; its card and its tune-up line were written for the chain's board, not for a game of tiers.

---

## 15. Built: the Foundry (lever E)

§14 found that nothing in Tier 2 made Tier 1's layout a worse one: a player who rebuilt was slower than one who only added on. The decision taken was lever E of §5, one better machine.

**The Foundry** (`foundry`, no tech: `Game.foundryOn`, handed over with Tier 2's tools, unlocked by Tier 1's claim). A big Refiner: **three** of a raw material make **two** (a Refiner's two make one), six of it a second at its first level, which is three or four Drills with some Speed. 300¢, each one 1.2 times the one before; Speed and Buffer upgrades. Recipes `f-shard`, `f-ink`, `f-spark`, `f-mist` (Glass, Plastic, Copper, Silicon). A Plastic Foundry leaves one Tar for every two Plastic, where a Refiner leaves one for every one.

Why this machine: deposits are the scarce thing (land is the only way to more of them), so a machine that gets a third more out of each Drill makes every row of Drill–Refiner pairs a worse way to use the same deposits, and nothing in Tier 1 (Speed included) does what it does. To use it, a player wires their Drills into it and deletes the Refiners they fed, for a full refund, with their upgrades: a rebuild.

It is on the card as Tier 2's first tool ("Foundry: ...wire up to four Drills of one material into it, and delete the Refiners they fed: Delete refunds them in full").

**Measured.** The rebuilder now rebuilds around Foundries when Tier 2 opens (each of Sand, Oil and Ore: a Foundry, its Drills into it, the old Refiners deleted), where in §14 it built Merger trunks. Seeds 0–7:

| Tier 2 | median | range | idle |
|---|---|---|---|
| mixed (adds on) | 6:39 | 6:34–6:52 | 40% |
| rebuilder, Merger trunks (§14) | 8:05 | 7:56–8:11 | 28% |
| rebuilder, Foundries | **6:31** | 6:23–6:42 | 4% |

The rebuild now pays, if only just: the rebuilder is the quickest player of Tier 2, and is almost never without something to do. Most of what it gains is not the third more Glass: Tier 2 is held back by Assemblers and the credits for them (every Assembler on the rebuilder's board runs flat out, and its Foundries sell their spare Glass and Plastic). It is the refund of the old Refiners and their Speed, and what the extra refined goods sell for, spent on Assemblers.

How the Foundry's numbers were found: at 500¢ (×1.3) and four Sand a second, five of them cost the rebuilder about 5,900¢ before its first Assembler, and it was 17 s to 77 s slower than mixed. At 300¢ (×1.2) and six a second, one or two of each do the work.

## 16. Built: Tier 3

| | Goal | Contract | Reward |
|---|---|---|---|
| 10 | Fill the Parts contract (Tier 2) | 200 Circuits, 100 Screens | Fabrication, Reclamation, Auto-balance, Overclock, 6,000¢ |
| 11 | Fill the Devices contract (Tier 3) | 60 Phones, 25 Cable | the end of the demo |
| free play | Build your first Laptop · Build your first Robot | | |

Tier 3 stands where the chain's "Build a Fabricator" and "Make your first Phone" stand, and a game of tiers passes those over, and the chain's free-play goals for Rubber and Cable (a game of tiers has made both by then). A save of chain 4 is moved to the same goal by its id.

**The demo ends with Tier 3's claim**, not with the first Phone (`markMade` in `src/sim.ts` ends it only in the chain): the celebration says "Devices delivered", then the summary, then free play.

**New in Tier 3, on the card**: Phones (the Fabricator: a Screen and two Circuits), Rubber (three Tar make one: a Refiner on a Plastic line's Tar port, in place of its Dump), Cable (one Copper and two Rubber), Auto-balance, Overclock.

**Lever D bites.** Tar was waste; now each Cable takes six of it, and the Plastic lines' Tar ports have to be rebuilt from Dumps to Rubber Refiners, while Copper is shared between Circuits and Cable. A player who rebuilt their Plastic around a Foundry in Tier 2 has half the Tar per Oil: the rebuilder fills its Cable later than mixed does (3:53 against 3:09 on seed 0), though its Phones sooner. What was the better layout in Tier 2 is a worse one for Tier 3, which is the loop §1 asks for; the scripted rebuilder does not rebuild a second time.

**A Fabricator is 4,000¢ in the tiers** (`RULES.tiers.fabricatorBase`; 8,500¢ in the chain, where one is built). At 8,500¢ the wide player, who only adds machines and sells half of what they make, was slower than the minimal one by more than a minute and a half.

**A line the Dock is done with backs up.** Once the 60 Phones are delivered the Dock takes no more, and a Fabricator wired to nothing else stops; behind it the Circuit Assembler stops, behind that the Plastic Refiner, and with it the Tar the Cable needs. The minimal player, whose lines go to the Dock alone, never filled its Cable that way. Now every scripted player wires a backed-up maker to a Market, as a person would at "Backed up", and the contract's line says so: "Delivered. Its makers are backed up: wire them to a Market".

### Measured

Seeds 0–7, one action every 4 seconds, medians (ranges in `tools/tiers.ts`' table):

| Player | Tier 1 | Tier 2 | Tier 3 | Idle in Tier 3 |
|---|---|---|---|---|
| rebuilder | 5:56 | 6:31 | **5:22** (4:10–5:35) | 25% |
| mixed | 5:56 | 6:39 | 5:30 (5:18–5:59) | 24% |
| tuner | 7:40 | 7:06 | 5:24 | 21% |
| sellfirst | 8:04 | 7:49 | 7:50 | 50% |
| wide | 6:41 | 8:26 | 8:00 (7:25–8:11) | 55% |
| minimal | 11:19 | 10:28 | 7:56 | 79% |

All six fill all three contracts on every seed. The minimal player takes 1.5 to 1.9 times as long as the quickest. A game of tiers for the mixed player: the guided start 2:26, then about 6, 6½ and 5½ minutes, so the demo ends at about 21 minutes (the card player of the chain makes the first Phone at 18:21, and that is unchanged).

Against §9:

- **Every way works**, in every tier.
- **More building is faster**, with one exception: in Tier 3 the wide player is no quicker than the minimal one. It sells half of every Phone while it saves for the next Fabricator, and a Phone sold is a Phone the contract waits for. Its fix is a tool Tier 2 hands over: a Router in Priority mode, the Dock first.
- **No single best way**: the rebuilder is quickest in Tiers 2 and 3, mixed in Tier 1; tuner is third in all three, and beats mixed on some seeds of Tier 3.
- **Rebuilding is worth it** from Tier 2 on, by a few seconds to a minute (§15), and what the Tier 2 rebuild did to the Tar makes Tier 3 ask for another.

`tests/tiers.test.ts` pins the Foundry (three for two, its rate), Tier 3's rules (the toolbox, the contract, that a Phone does not end the demo and the claim does, free play after) and, on seed 0 for all three tiers: every player fills the contract, mixed, tuner and rebuilder beat minimal (wide too, in Tiers 1 and 2), minimal is within twice the quickest, mixed takes five to eight minutes, and from Tier 2 on the rebuilder beats mixed.

**Seen in a browser.** In headless Chromium at 1440×900 and 390×844, from saves the scripted players made: Tier 2 with a board of Foundries and the Foundry note open, a Foundry's inspector (5.86 Sand in, 3.89 Glass out), Tier 3's card at both sizes, and the end: Claim on Tier 3, "Devices delivered", the summary, Keep playing, free play's "Build your first Laptop". No page error. Nobody has played any of it by hand.

**Not built.** The rebuilder that rebuilds a second time. Tiers beyond 3, and contracts that repeat. Box-select and copy and paste, which a rebuild by hand will want. Free play in the tiers is the chain's Laptop and Robot, with the chain's numbers.
