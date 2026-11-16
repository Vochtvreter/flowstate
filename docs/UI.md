# Flowstate — UI Spec

The interface as built. Numbers are the ones in the code (`src/ui/`, `src/style.css`, `src/styles/`); the file that holds a rule is named beside it. The [Flowstate UI canvas](https://claude.ai/artifact/HS1Kbgr7TKuNz9xPjpJ7Pg) holds early mockups from before the build, which the build has since moved past. Controls are listed in the [README](../README.md#controls); rules and prices in [CONTENT.md](./CONTENT.md). All of it has been seen only in headless Chromium, with touch emulated for the phone layouts: no real phone, Safari or Firefox has run it (see [what has been tested](../README.md#what-has-been-tested-and-what-has-not)).

---

## 1. Principles

1. **The board is the hero.** Bars and corner controls hug the edges. Over the board stand only the goal card with its chips at the top, the Expand button when it docks and, in passing, the build menu, the "Tap where…" line, toasts, celebration cards and the guiding hand. The camera keeps what matters out from under them.
2. **Quiet when healthy, loud when broken.** A working node shows a green ring. Only the *root cause* of a problem gets a pill and a word; a node that merely suffers from trouble elsewhere turns its ring amber. Wells never get a pill.
3. **Every problem comes with its fix.** The inspector's status box offers the action ("Upgrade source · 50¢", "Jump to source"); the alert chip has **Show**.
4. **Colour is not the only signal** where there is room for another: materials are a colour and a shape, Data a colour and a letter, a problem a colour and a word. (The overview tier is the exception: see section 4.)
5. **Progress toward every price.** Buy buttons and build-bar slots fill as the credits come in.
6. **Words follow the pointer.** A finger is told to "tap" and never shown a key (`html[data-input]`, set from the last pointer used).
7. **Nothing pressable arrives under a press already on its way.** The build menu takes no press for its first 250 ms, the summary for 600 ms, the Expand button for 700 ms after an expansion, and a second Claim within 500 ms is ignored.

---

## 2. Layouts by screen size

The phone layout is on when the window is under 700 px wide, or is wider than tall and under 500 px tall (`src/ui/phone.ts`). Everything else is the desktop layout; a tablet gets it too.

| | Desktop (1440×900) | Phone upright (390×844) | Phone sideways (844×390) |
|---|---|---|---|
| Top bar | 56 px: logo, credits, Data chips, Undo, Redo, Pause, Tech tree, sound, gear | 52 px: logo mark, credits, Data as one block, Tech, gear | 46 px, the same |
| Build bar | 76 px rail down the left, key numbers in the corners | 72 px bar along the bottom, 60 px slots, scrolls sideways | 68 px, the same |
| Goal card, order, alert | Card over the top of the board, order beside it, alert under it | One strip across the top of the board | Card at the top left, its hint folded away at the first press on the board; order and alert as pills beside it |
| Inspector | 320 px panel at the right; the board gets narrower | Bottom sheet | Sheet at the right, at most 340 px |
| Build menu | Fan round the pointer | Bottom sheet | Sheet at the right |
| Zoom, Fit, Tidy | Buttons above the minimap, bottom right | Pinch; Fit, Undo and Tidy float above the build bar | The same |
| Minimap, key hints | Shown | Not shown | Not shown |
| Undo, Redo, Pause, Sound | Top bar | Undo floats; all four in the gear menu | The same |
| Claim | On the goal card | In the thumb row, above the build bar | The same |

**Narrower desktop windows and tablets** keep the desktop layout and give things up in steps:

- Under 1596 px wide the minimap hides while the inspector is open, and the zoom buttons drop into its corner.
- On a stage under 1200 px wide (the inspector's width counts as stage) a machine is not selected when it is built, and the inspector closes when a port is armed, a wire is dragged out or a goal is claimed. Wider than that, with a mouse, a new machine is selected from goal 6 on.
- Where the stage beside an open inspector is under 794 px (always measured as if it were open, so the card never moves when it opens), the order and the alert go under the card (`#hud-strip.tight`). At 1024×768 this is the case.
- At 1240 px the logo loses its word; at 1100 px the Data chips lose their rates; at 900 px the key hints go, Data becomes one block and "Tech tree" becomes "Tech".
- A finger on this layout gets 44 px buttons, no key labels, and the "Tap where…" line under the goal card.

**Phone.** The inspector sheet takes at most 45% of the screen and, where it can, leaves 176 px of board under the strip; the build sheet may grow taller, keeping 120 px for the spot being built on. The thumb row holds, on the left, Claim when a goal is ready, or the "Tap where…" line with its ✕ while a port is armed or a card is in hand, or else the docked Expand button; on the right Fit and Undo, with Tidy above Undo. The card folds its hint behind a tap when the strip would take more than 45% of the stage, and during a wait; a new goal always opens with its hint showing.

**Phone sideways.** The board is a strip a few cards high, so the card always folds its hint. A newcomer who starts this way is told once, after goal 1, "Best played upright: turn your phone for more room."

---

## 3. The HUD

### Top bar (`panels.ts`, `hud-flow.ts`)

- **Credits pill:** the coin, the number (it rolls to a new value over 0.3 s) and the income per second. Once the Flow meter is unlocked (goal 15's reward) a ring round the coin shows Flow and the percentage stands beside the number. A press anywhere on the pill jumps to the Well or machine holding Flow back, or says "Everything is flowing".
- **Data chips** α, β, γ: each appears when the player first has that kind of Data.
- **Tech tree** button, with "N ready" when something can be researched without spending what the goal is saving. It appears with the Lab (goal 5's reward).
- **Gear menu:** "New game…" (with a confirmation). On a phone also Pause, Sound, Undo, Redo.

### Goal card (`hud.ts`, `advice-tip.ts`)

From the top: a row of pips (one for each of the 22 goals, larger for the six big ones, filled when claimed); "Goal 15 / 22" and the reward as chips; the title; the hint, worded for mouse or touch; a progress row; then up to two rows of guidance. The card's small labels are drawn in capitals ("GOAL 15 / 22", "DONE", "WHILE YOU WAIT · 1 OF 2").

| Row | What it shows |
|---|---|
| Progress | A bar and a count ("Saving 364 / 1,325α · about 7 min"; "Saved"; "nothing is being sold yet"). The Flow goal shows "Flow 90% · 9 of 10 running" with a mark at the share to hold; the Lens goal shows which inputs are wired ("Prism ✓ · Glyph ✗"). |
| While you wait | A step from the goal itself: a tick box, "While you wait · 1 of 2", one sentence and **Show me**. It reads "Next step" when the step is the goal's own requirement (goal 22). When the step costs credits the card is keeping for its own purchase, **Show me** gives way to "Saving for this · 1,100¢ · about 40 s". A step that has been offered is not taken back for a passing dip in income: it stays until it has been out of reach for 10 s, or the player no longer has the credits for it (`ADVICE.lineHold` in `src/advice.ts`). Done, the box is ticked and the row says what the step bought. A line that was done before its goal came up is not shown at all. On goal 21 the line is the tune-up before the Fabricator: its sentence is its next step's own, a step is only on the card while it pays for itself before the Fabricator can be bought (it is never "Saving for this"), and when none is left the row is ticked if the player did some of it and closes if not ([CONTENT.md](./CONTENT.md), "While you wait"). |
| Tip | The adviser's one suggestion (`src/advice.ts`, run in a Worker). It appears after 6 s of waiting with the board left alone, never repeats the line's own step, and has its own **Show me**. A narrow card (phone, squeezed desktop) shows one of the two rows at a time, the line first. |

**Show me** does nothing for the player: it frames what the step is about (and selects it where the step is a button in the inspector), puts a ring on the button to press, and a hand acts the gesture out twice (`advice-show.ts`, `hand.ts`).

When the goal is done the card says "✓ Done", shows the reward and a green **Claim** button, the loudest thing on screen. The card itself never moves when a goal is claimed: the old text lifts away, the new rises, the pip pops. While the tech tree covers the board, a ready goal rides above it as a slim bar with Claim (on a phone the tree has its own "Goal complete · Claim" bar). In free play the card reads "Free play 1 / 4".

### Order chip

Beside the card from goal 12: "Deliver 13 / 19 Ink", a bar, the time left at the present rate, and what it pays; a Claim button when filled. When none of the material is being sold it says so in words in place of the bar ("No Market is getting Ink yet. Wire some to a Market.").

### Alert chip

One chip under the card that says one thing, in this order: the game is open in another tab ("Reload"); the game is paused ("Resume"); or one problem on the board, in words that say what to do ("Refiner (Ink): give its Silt somewhere to go"), with **Show**. Show jumps to the node and puts that problem away until it changes. The chip names nothing before the first wire, nothing the card's hint, line or tip is already about, and for the first 20 s of a goal nothing about the nodes that goal is about (`status.ts`).

### Toasts (`hud-toasts.ts`)

For what nothing else on screen says: refusals, refunds, "Tidied. Ctrl Z puts it back.", a tech the queue researched. Bottom left of the board on a desktop, under the strip on a phone, clear of every control. At most three at once (two on a phone).

---

## 4. The board (`board.ts`, `fx.ts`)

A dot grid (24 px) with the plot as a dashed outline labelled "Board · 2 plots". Cards and wires are DOM and SVG; wire dots, particles and floating gains are drawn on one canvas above them.

- **Card:** 172 px wide and 72, 92 or 112 px tall by its number of ports (a Router, Merger or Void is 136×60 px). On a Well or a machine, a ring round the glyph of what it makes shows utilisation; then the name, a second line (for a machine, its recipe in words) and a rate line ("0.50/s · 100%"). Positions snap to a 20 px grid, and cards never overlap.
- **Ports:** 14 px dots on the card's sides, inputs left and outputs right, in the material's colour. An output with no wire pulses. A machine with two outputs labels them.
- **Wire:** a curve in the material's colour, 2 to 7 px wide by its rate, with dots in the material's shape travelling along it. A full wire glows brighter; a wire carrying nothing is dashed and has no dots. While something is selected, wires that are not its own are drawn faint.
- **Rate chip:** on a wire only when it has something to say: the wire is selected or runs to the selected card, carries nothing ("0/s") or is full ("MAX"), was made in the last 3 s, or is under the mouse.
- **Deposit:** a dashed tile the size of a card ("Glint deposit · empty · place a Well"; "Unknown deposit · needs research").
- **Gains:** once a second "+5¢" floats above each Market and "+1α" above each Lab, and coins fly to the credits pill.

### Status

| State | Ring | Border | Pill |
|---|---|---|---|
| Working | green | plain | none |
| Blocked (output full) | amber | amber | `BLOCKED` |
| Starved (an input short) | red | red | `STARVED` |
| Idle (no recipe or nothing wired in) | grey | dashed | `IDLE` |
| Suffering from a problem elsewhere | amber | plain | none |

A Well changes only its ring. A machine is called starved only when it works less than 60% of its time, averaged over 3 s, and stays so until it is back over 65% (`status.ts`). Between that and full speed it is drawn as working; its inspector says how short it is in one amber line ("Receiving 0.80 of 1.00 Ember/s") with the fix under it. A node the player has just changed gets a moment's grace before it is judged.

### Two zoom tiers

| | Detailed | Overview |
|---|---|---|
| Zoom | 70% (74% on a phone) to 200% (150% on a phone) | Below that, as far out as the whole factory needs, never under 15% |
| Cards | Cards. Under 100% (on a phone always) the type is set larger (15 px) so it still reads at the floor; under 92% the second line is dropped | An icon and a status ring on a plain tile; no text, pills or rate chips |
| Wires | As above | Thin lines of one width; cannot be selected |
| Ports | Dots on the card | Smaller dots beside the icon, still usable |
| Status | Ring, border, pill | Colour alone: the whole ring and the tile's edge |

The camera goes only as far out as it takes to show everything, so a small factory has little or no overview. In the overview icons and wires are drawn larger in five steps as the camera pulls back, so an icon is never under 24 px on screen. A click or tap on a card in the overview brings the camera back in to it.

### Fit, Tidy, minimap, Expand

- **Fit** (`F`) shows everything built, as large as fits up to 100%, clear of the goal card and the corner controls. A factory too big to read that way is shown in the overview; Fit pressed again from there returns to the view the player had.
- **Tidy** (`T`, offered once six cards stand) lays the board out again so that no wire runs behind a card it does not end at, and wires are short and cross little: bringing a wire out from behind a card comes first, and may cost some wire or a crossing. A board with nothing to mend is left as it is ("Already tidy."). The layout is worked out in a Worker (`layout.ts`); cards glide to their places over 400 ms; Wells stay on their deposits; the camera stays on what the player was looking at; one undo puts every card back.
- **Minimap** (desktop): 160×106 px, each card in its status colour (Markets gold, Labs violet) and the camera's frame. It is a picture only; it takes no clicks.
- **Expand** appears from goal 14. Its home is just under the plot ("Expand board 500¢ · New plot · reveals deposits"). When that place is off screen or covered, it docks as a one-line button in the free part of the board (on a phone: in the thumb row). It turns gold when affordable and pulses when the card asks for it. It stands back, faint and deaf to presses, while a port is armed, a wire is drawn, a card is in hand or the build menu is open. After an expansion the camera glides out to show the new plot, and its deposits pop in one after another.
- **Key hints** (mouse on a desktop, until goal 5 is claimed): one row at the bottom left that names drag port, ⇧ drag, Del, Ctrl Z and T with what each does. It hides whenever a card lies under it.

---

## 5. Building and wiring

**Dragging a wire.** Press on an output port and drag. Cards that cannot take the wire, or have no use for what it carries, are dimmed (for a finger the possible ends also glow). A mouse's wire attaches to the card under the pointer, or to one whose port is within 12 px; a finger's snaps to the nearest valid card within 40 px. A card with no use for the material refuses with the reason ("The Shard Refiner cannot use Ink"). Dragging from an *input* port works backwards: onto a source, or into empty space for the machines that make that material.

**Tap to arm.** A tap or click on an output port arms it: the port stays lit and waits. A tap on a card makes the wire; a tap on empty board opens the build menu there; a tap on the armed port, `Esc`, or the ✕ on the "Tap where the Glint should go" line lets go. This is how a finger wires across a board too big for one screen.

**How a finger is matched** (by distance on screen, whatever the zoom; `touchHit`): a port within 22 px (18 px for an input port); else the card under the finger; else a free deposit; else a wire within 14 px; else the nearest output port within 44 px; else a card missed by under 10 px. Only the first of these starts a wire when the finger drags: a drag that starts on a wire or in a gap pans. With a port armed, a tap on a wire counts as a tap on the board under it. In the overview a finger's drag always pans; a port is armed by a tap within 16 px of its dot (12 px for a mouse, which can also drag from it).

**Build menu** (`openRadial`). Let go of a wire on empty board, clear of its port (about 36 px).

- *Desktop:* a fan of up to eight slots round a hub that names the material, on the side away from the wire, kept on screen and clear of the goal card (the board slides down if the spot was under it). A slot shows the machine, what it does and its price, and its key (`1`–`8`).
- *Phone:* a bottom sheet ("Send Glint to a new…") of large rows; the board slides so the chosen spot shows above it, and the half-drawn wire stays.
- *Options:* up to three recipes that use the material, then Market, Lab and Void (for a by-product: Void, then Market), then Router and Silo, as far as they are unlocked; one option still to research is shown locked ("needs Refining").
- *The suggested option* is the one the goal card asks for, else the first. With a mouse the order is fixed, so a key always builds the same machine; the suggestion is highlighted and focused, and `Enter` builds it. For a finger it is listed first.
- An option out of reach is dimmed with its price in red. A press outside the menu closes it.

**Where the new machine stands** (`buildSpot`). Centred on the chosen point when that leaves 40 px of air to every other card and port, 16 px to a free deposit, and 8 px to whatever covers the board (the strip, a sheet, the floating buttons, the corner controls). Otherwise the nearest spot that does; but if that is more than 100 px further off than the nearest spot with the usual 16 px gap, the nearer spot is taken. With no room at all: "No room left on the board. Expand it, or clear a space." The machine arrives wired, with its recipe set.

**From the build bar.** A ghost of the card follows the pointer and shows where it will stand and what it costs; a Well's ghost sits on the nearest free deposit. A finger's ghost starts in the middle of the view and a tap places it. A slot fills from below while it is out of reach and pulses once when it comes within reach. One locked slot is shown as a silhouette with the name of the tech that opens it.

**Splice.** A machine placed on a wire, or an unwired card dropped on one, is spliced into it (the wire has to pass within about 16 px of the spot). **Branch.** With a mouse, dragging off the middle of a wire starts a second wire from the same port. **Move.** A card follows after 4 px (mouse) or 10 px (finger); dropped on another card it glides to the nearest free spot. A wire or a card dragged within 52 px of the edge scrolls the board.

**Cut.** `Shift`+drag draws a red dashed line and cuts every wire it crosses (mouse only). Or select the wire and press `Del`, or **Cut wire** in the inspector.

**Undo.** Each edit is one step: a build with its wire, a move with its splice, a whole Tidy, an expansion. Undo takes back what was paid or refunded, and refuses when a refund has been spent. 200 steps are kept, back to the last claimed goal. Deleting refunds in full; the last Well cannot be deleted.

---

## 6. The camera

A press on the board stops any camera move under way. The game moves the camera by itself only as follows, and then by the smallest move that works.

| When | What the camera does |
|---|---|
| A game opens (new, loaded, or the layout changed) | The whole factory, when it can be read at once. Otherwise what the goal is about, at a readable zoom; failing that the overview. |
| A goal comes up; its saving is done; the tech tree closes | The nodes (or the deposit) the card is about are brought into view if any is off screen or covered. Nothing moves if they can be seen. |
| **Show me** | Frames what the step is about. |
| A machine is built, a wire is made, a card is selected | Moves only if the new card, the wire's far end or the selected card cannot be seen whole. |
| A finger arms a port | Moves only when the wire's other end could not be tapped otherwise: on a phone when the card the goal names is out of reach, elsewhere when no possible end is in reach. It then frames both ends, in the overview if need be. Never for a mouse, and never when the card asks for something to be built from that port. |
| A Well is taken up | The free deposits are brought into view. |
| The build menu opens under the goal card | The board slides down so menu, wire and spot stay together. |
| Fit, Tidy, Expand, the alert's Show, the Flow ring, "Jump to source" | As asked. |
| The first Lens | The line that feeds the Lens is slid into view without zooming in. On a phone the factory is then framed above the summary sheet. |
| A phone is turned | Zoom and centre are kept; a selected card or armed port is brought back if the turn hid it. |
| The window is resized | The middle of the view stays in the middle. |

It never moves while a button or finger is down on the board, a port is armed, a card is in hand or the build menu is open; never under a celebration card (it waits for the card to go); and never because a sheet or the inspector closes (a move that came due while a phone's sheet was up is made once it has gone). With reduced motion every move is a jump.

---

## 7. The inspector (`panels.ts`)

Opens when a card or a wire is selected: a 320 px panel beside the board on a desktop, a bottom sheet on a phone (swipe it down by its handle or header, or press ✕). On opening it scrolls to what the player most likely came for: the button **Show me** ringed, the warning, a Router's wire rows, or the first upgrade they can afford.

| Section | Contents |
|---|---|
| Header | Icon, name, one line on what the node does, ✕ |
| Status | Only for a problem: a box with what is wrong and its fix (see section 4), or the amber line for a machine that is merely short |
| Body, by type | *Machine:* the recipe as chips, with **Change** when it has a choice; Flow bars for each input (received / needed) and output; utilisation. *Well:* extraction rate. *Router:* mode (Even, Ratio, Priority, Filter; a locked mode leads to its tech), one row per wire with its share and its control, and **Favour** to send one wire the bigger share. *Market:* what sells here and what it earns; after the first sale over demand, a demand gauge per material. *Lab:* what it studies and what each item gives. *Silo:* what it holds |
| Upgrades | One row per track: level, effect, and a buy button that fills as credits come in. With the Bulk Upgrade tech each row also has **Upgrade all**, which raises every node of that type by one level |
| Footer | **Duplicate** (not for a Well) and **Delete · +refund** |

A wire's inspector shows what it carries against its capacity, "At capacity" when it is the bottleneck, the next pipe tier with its price, **Upgrade every full wire**, and **Cut wire · +refund**.

---

## 8. The tech tree (`tech.ts`)

A full overlay over the board, under the top bar (a full screen on a phone). The line keeps running behind it.

- It shows less than the whole tree: what is owned, what can be researched now, and one step beyond that as locked silhouettes without price or effect. A branch with nothing to show is left out; "More shows up as you research."
- *Desktop:* a row of tiles per branch (Processing, Logistics, Commerce, Research, Scale tools; Commerce appears with the first sale over demand) beside a 340 px detail column. *Phone:* a tab per branch, 56 px rows, and the detail as a bottom sheet with the Research button pinned to its foot.
- *A tile* says one of: "60α · Ready"; a progress bar and "about 6 min"; "Research Assembly first"; "From a goal: …"; "Owned" (on a desktop an owned tech is only a tick and its name).
- *The detail:* branch, name, one sentence, what it unlocks, the price with a bar and "You have 385α", a **Research** button (or "Ready in about 6 min"), and a switch "Research it for me when ready".
- While the goal is saving for a tech, the tree opens on it and marks it "Goal"; any other tech that would spend the same Data says "slows your goal".
- `Enter` or `Space` researches the selected tech; `Esc` or `R` goes back. What lies behind the tree cannot be focused or pressed.

---

## 9. Start, ending, time away (`hud-screens.ts`, `celebrate.ts`)

**Start screen.** A card over the dimmed, still board: the logo with dots running along its wire, "Flowstate", "Wire up a supply line. Watch it flow.", a **Start** button and "About 20 minutes · best with sound". With a save it reads **Continue**, with **New game** under it. Nothing runs and nothing is saved until the button is pressed.

**The ending**, when the first Lens is made:

1. A pulse runs along the wires from the Wells to the Lens, lighting each card it passes.
2. The "First Lens · Demo complete · free play is open" card comes up. No press sends it away.
3. After 6.5 s the summary opens: a card at the foot of the screen (a bottom sheet on a phone) with the factory still running behind it. It gives the time to the first Lens, four numbers (things built, share of income from sales, orders filled, longest Flow streak), the four things free play has the player make, and **Keep playing**, **Copy result** (two lines of text) and **Start over**. It takes no press for its first 600 ms.

**Keep playing** (or `Esc`) starts free play. From the Lens until then the goal card shows goal 22 done with no Claim, and the board reports no problems.

**Time away.** After the first Lens only: a "While you were away" card with what the line earned and **Collect**.

---

## 10. Celebrations and sound, in outline (`celebrate.ts`, `feel.ts`, `audio.ts`)

- **Big moments** (seven: first Shard, the Lab, first Spark, first Glyph, the first Flow State, first Prism, first Lens): a colour wash, a card in the middle of the screen, particles, a fanfare. About two seconds; a press anywhere sends it on (the Lens card stays until the summary).
- **Every claim:** the reward flies as coins from the Claim button to its counters, which roll. Smaller cards mark a research the goal was saving for and the first β.
- **Wiring and building:** the new wire swells, its target flashes, a new card pops in.
- **Flow State** (100% Flow for 10 s, with six or more producers): the board's edge glows and a hum plays under it.
- **Sound** is synthesised with Web Audio; there are no sound files. There are cues for a wire, a build, sales, a slot coming within reach, a goal turning ready, a claim, a payout, a tip, a line ticked, an error, the first surplus, an expansion and research. No more than eight cues start in a second (twelve for the important ones), and a limiter caps the level. Sound starts with the first press and stops while the tab is hidden. The mute control is the speaker button (the gear menu on a phone) and is remembered.
- **Haptics:** a short buzz with a wire, a claim and the big moments, for a finger on a device that has a motor; mute silences it too.

Nobody has heard any of this: the sound has been checked by what the code schedules and by a rendered peak level only.

---

## 11. Accessibility

- **Reduced motion** (`prefers-reduced-motion`): the camera jumps; wire dots stand still and show the rate by how densely they lie; cards, wires and rows appear without popping, sliding or pulsing; **Show me** leaves a still mark where the hand would have moved.
- **Target sizes:** for a finger, controls are sized to 44 px or given a 44 px reach round a smaller face; ports are matched by distance (section 5).
- **Keyboard:** every control off the board is a real button in the Tab order with a visible focus ring; the shortcuts are in the README. While the start screen, the summary or the tech tree is up, what lies behind it cannot be focused or pressed. *The board itself is not reachable by keyboard:* cards, ports and wires need a pointer.
- **Colour:** see principle 4. In the overview status is colour alone.
- **Labels:** icon buttons carry text labels, toasts are a polite live region, the alert is a status.
- **Not done:** no screen reader has been tried, and contrast has not been audited as a whole.

---

## 12. Tokens (`:root` in `src/style.css`)

| Token | Value | Use |
|---|---|---|
| canvas | `#0B0F17` | Board background (dot grid `#1B2436`, 24 px) |
| chrome | `#0E1320` | Top bar, build bar, inspector, sheets |
| node | `#131A2A` | Cards |
| border / line | `#27324A` / `#1E2740` | Borders, dividers |
| text / muted / dim | `#E6EBF5` / `#94A0B8` / `#7F8AA3` | |
| select | `#7AA2FF` | Selection, focus ring, the suggested option |
| credits | `#FFC857` | ¢, buy buttons |
| Data α / β / γ | `#5EEAD4` / `#C4A1FF` / `#FF8FB1` | Data chips, prices, gains (`DATA_COLORS` in `src/content.ts`, not `:root`) |
| working / blocked / starved / idle | `#4ADE80` / `#FBBF24` / `#F87171` / `#64748B` | Rings, pills, minimap |

Type: **Space Grotesk** (display), **Inter** (interface), **JetBrains Mono** (every number, tabular). The fonts load after the first paint; until then system fonts show. Material colours and shapes are in `src/content.ts` and `src/ui/icons.ts`.

---

## 13. What the earlier spec asked, and how the build answered

- **Inspector docked or floating?** Docked: a panel at the right on a desktop, a bottom sheet on a phone.
- **Build bar left or bottom?** Left on a desktop, bottom on a phone.
- **Tech tree as overlay or drawer?** A full overlay; on a phone its detail is a sheet over it.

Drawn in the earlier spec and not built: a trash drop-target in the build bar (the tile there only recalls the `Del` key), a heat tint on wires when zoomed out, alternating dot colours for mixed wires, "owned / total" counts on the tree's branches, and double-click or `Q` in the tree.
