# Tiers: a proposal

Status: **a proposal, not built.** Nothing in this document is in the game yet. It describes where the game could go next and the decisions that have to be made before any of it is built. The build as it stands is in [DESIGN.md](./DESIGN.md) and [CONTENT.md](./CONTENT.md); the numbers quoted from it here were measured with the pacing tool on order seeds 0–7 or 0–14, by scripted players, not people.

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
