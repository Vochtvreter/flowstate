# Flowstate — UI Spec

The interface as built. Numbers are the ones in the code (`src/ui/`, `src/style.css`, `src/styles/`); the file that holds a rule is named beside it. The [Flowstate UI canvas](https://claude.ai/artifact/HS1Kbgr7TKuNz9xPjpJ7Pg) holds early mockups from before the build, which the build has since moved past. Controls are listed in the [README](../README.md#controls); rules and prices in [CONTENT.md](./CONTENT.md). All of it has been seen only in headless Chromium, with touch emulated for the phone layouts: no real phone, Safari or Firefox has run it (see [what has been tested](../README.md#what-has-been-tested-and-what-has-not)).

---

## 1. Principles

1. **The board is the hero.** Bars and corner controls hug the edges. Over the board stand only the goal card with its chips at the top, the Expand button when it docks and, in passing, the build menu, the "Tap where…" line, toasts, celebration cards and the guiding hand. The camera keeps what matters out from under them.
2. **Quiet when healthy, loud when broken.** A working node shows a green ring. Only the *root cause* of a problem gets a label, and the label says what is wrong in plain words ("Needs more Copper", "Tar has no exit"); a node that merely suffers from trouble elsewhere turns its ring amber. A Drill is labelled only when its material has no exit.
3. **Every problem comes with its fix.** The inspector's status box offers the action (starved: "Upgrade source · 50¢", "Jump to source"; blocked: "Upgrade Lab · 50¢", "Show"; for a few seconds after its own button has raised that Speed it offers no second level, and says the Lab "has room now" until the node is no longer called blocked); the alert chip has **Show**.
4. **Colour is not the only signal** where there is room for another: materials are a colour and a shape, Data a colour and a letter, a problem a colour and a word. (The overview tier is the exception: see section 4.)
5. **Progress toward every price.** Buy buttons and build-bar slots fill as the credits come in.
6. **Why first; words for the pointer when asked how.** A goal card says what to bring about and why, in words that name no gesture. Where a gesture is named (the card's how, the "Tap where…" line), a finger is told to "tap" and never shown a key (`html[data-input]`, set from the last pointer used).
7. **Nothing pressable arrives under a press already on its way.** The build menu takes no press for its first 250 ms, the summary for 600 ms, the Expand button for 700 ms after an expansion, the build bar's slots for 600 ms after a chevron has moved it, and a second Claim within 500 ms is ignored.
8. **Nothing is on screen before it has a use.** The first screen is a Drill, a Market and the goal card; section 12 says when the rest arrives.

---

## 2. Layouts by screen size

The phone layout is on when the window is under 700 px wide, or is wider than tall and under 500 px tall (`src/ui/phone.ts`). Everything else is the desktop layout; a tablet gets it too.

| | Desktop (1440×900) | Phone upright (390×844) | Phone sideways (844×390) |
|---|---|---|---|
| Top bar | 56 px: logo, credits, Data chips, Undo, Redo, Pause, Tech tree, sound, gear | 52 px: logo mark, credits, Data as one block, Tech, gear | 46 px, the same |
| Build bar | 76 px rail down the left, key numbers in the corners | 72 px bar along the bottom, 60 px slots, scrolls sideways; a round chevron button (46 px wide, as tall as the bar) stands on an edge with more beyond it and moves the bar by a page | 68 px, the same |
| Goal card, order, alert | Card over the top of the board, order beside it, alert under it | One strip across the top of the board | Card at the top left, its hint folded away at the first press on the board; order and alert as pills beside it |
| Inspector | 320 px panel at the right; the board gets narrower | Bottom sheet | Sheet at the right, at most 340 px |
| Build menu | Fan round where the new card will stand (the pointer, unless the card has to stand elsewhere), with its outline | Bottom sheet, the card's outline on the board above it | Sheet at the right, the outline beside it |
| Zoom, Fit, Tidy, Wires | Buttons above the minimap, bottom right | Pinch; Fit, Undo and Tidy float above the build bar; Wires is in the gear menu | The same |
| Minimap | Shown | Not shown | Not shown |
| Undo, Redo, Pause, Sound | Top bar | Undo floats; all four in the gear menu | The same |
| Claim | On the goal card | In the thumb row, above the build bar | The same |

**Narrower desktop windows and tablets** keep the desktop layout and give things up in steps:

- Under 1596 px wide the minimap hides while the inspector is open, and the zoom buttons drop into its corner.
- On a stage under 1200 px wide (the inspector's width counts as stage) a machine is not selected when it is built, and the inspector closes when a port is armed, a wire is dragged out or a goal is claimed. Wider than that, with a mouse, a new machine is selected from goal 6 on.
- Where the stage beside an open inspector is under 794 px (always measured as if it were open, so the card never moves when it opens), the order and the alert go under the card (`#hud-strip.tight`). At 1024×768 this is the case.
- At 1240 px the logo loses its word; at 1100 px the Data chips lose their rates; at 900 px Data becomes one block and "Tech tree" becomes "Tech".
- A finger on this layout gets 44 px buttons, no key labels, and the "Tap where…" line under the goal card.

**Phone.** What a phone's screen is for is the board: between the top bar (52 px) and the build bar (64 px) it has all of it but one row. That row is the goal card folded to its count and its title ("16 / 22 · Hold 95% Flow…"), with its progress as a thin bar along its foot, and beside it the order folded to its picture and count ("8 / 8", with its own Claim when it is filled). A tap on either opens the card as it is on a desk: the why, the recipe, the progress in words, the row of guidance, the order in full. A press on the board folds it again; a new goal opens it by itself, and a game taken up where it was left starts with it folded. A chevron on the folded card is lit while the card has something for the player to do. Folded, the strip is 46 px tall. Measured on a 21-card board: at 390×844, 81% of the screen is board in play (it was 59%) and 41% with a card's sheet open (it was 21%); at 360×640, 75% (it was 45%) and 35% (it was 23%). Beside a filled order (its picture and its Claim) the folded card keeps its title; a goal that is done is its tick and its title; at 370 px or narrower the count gives way to the title. Before the build bar has anything on it (the first goal) it is not there. The inspector sheet takes at most 40% of the screen and, where it can, leaves 176 px of board under the strip; while it is up the floating buttons wait out of sight (they stood on the cards it is about); the build sheet may grow taller, keeping 120 px for the spot being built on. The thumb row holds, on the left, Claim when a goal is ready, or the "Tap where…" line with its ✕ while a port is armed or a card is in hand, or else the docked Expand button; on the right Fit and Undo, with Tidy above Undo.

**Phone sideways.** The board is a strip a few cards high, so the card always folds its hint. A newcomer who starts this way is told once, after goal 1, "Best played upright: turn your phone for more room."

---

## 3. The HUD

### Top bar (`panels.ts`, `hud-flow.ts`)

- **Credits pill:** the coin, the number (it rolls to a new value over 0.3 s) and the income per second. Once the Flow meter is unlocked (goal 15's reward) a ring round the coin shows Flow and the percentage stands beside the number. A press anywhere on the pill jumps to the Drill or machine holding Flow back, or says "Everything is flowing".
- **Data chips** α, β, γ: each appears when the player first has that kind of Data.
- **Flows** button, with the number of materials that are short or have no exit on an amber badge. It opens the Flows panel (section 13) and appears at goal 9. `L` opens and closes it.
- **Tech tree** button, with "N ready" when something can be researched without spending what the goal is saving. It appears with the Lab (goal 5's reward).
- **Undo** and **Redo** appear at goal 2.
- **Gear menu:** "New game…" (with a confirmation). On a phone also Flows (from goal 9, with "N in trouble"), Pause, Sound, Undo, Redo.

### Goal card (`hud.ts`, `advice-tip.ts`)

From the top: "Goal 15 / 22" and the reward as a chip; the title, which is an outcome ("Make your first Circuit"); the recipe, where the goal is about one; the why; a progress row; then up to two rows of guidance. (The row of pips that stood over it, one for each goal, is not shown: the count says it.) Its small labels are set as words are ("Goal 15 / 22", "Done", "While you wait · 1 of 2"), not in capitals.

| Row | What it shows |
|---|---|
| Recipe | Where the goal has the player make something: "Plastic + Copper → Circuit" as chips, each with the material's picture. Where several things are put together and the machine stands, an input that is wired in is ticked, one that is not stands dashed with a cross, and so does what comes out until it goes somewhere. (Goal 22 draws the recipe plain: its progress row says which inputs are wired.) |
| Why, or how | One paragraph. It says why (the same for a mouse and a finger), and ends in a word-sized **How?** button. Pressed, the how stands in the why's place, marked "HOW" and worded for the pointer in use, and the button reads **Why?**. The how also comes by itself once the goal has been within reach for 20 game seconds with the board left alone (never while the card is saving up, and not again on a goal where it was sent away). The paragraph is one element, so a phone folds it away as it folded the hint. |
| Progress | A bar and a count. While something is being saved for it says what for ("Saving for Assembly · 364 / 1,325α · about 7 min"); a phone held upright, and a desktop card on a stage under 520 px, set those words on a line of their own over the bar, and a phone held sideways leaves the name out. Then "Saved"; "nothing is being sold yet" where nothing comes in. The Flow goal shows "Flow 90% · 9 of 10 running" with a mark at the share to hold; the Phone goal shows which inputs are wired ("Screen ✓ · Circuit ✗"). |
| While you wait | A step from the goal itself: a tick box, "While you wait · 1 of 2", one sentence and **Show me**. It reads "Next step" when the step is the goal's own requirement (goal 22). When the step costs credits the card is keeping for its own purchase, **Show me** gives way to "Saving for this · 1,100¢ · about 40 s". A step that has been offered is not taken back for a passing dip in income: it stays until it has been out of reach for 10 s, or the player no longer has the credits for it (`ADVICE.lineHold` in `src/advice.ts`). Done, the box is ticked and the row says what the step bought. A line that was done before its goal came up is not shown at all. On goal 21 the line is the tune-up before the Fabricator: its sentence is its next step's own, a step is only on the card while it pays for itself before the Fabricator can be bought (it is never "Saving for this"), and when none is left the row is ticked if the player did some of it and closes if not ([CONTENT.md](./CONTENT.md), "While you wait"). |
| Tip | The adviser's one suggestion (`src/advice.ts`, run in a Worker). It appears after 6 s of waiting with the board left alone, never repeats the line's own step, and has its own **Show me**. A narrow card (phone, squeezed desktop) shows one of the two rows at a time, the line first. |

**The how follows the board.** Where the how has the player build a machine from a port and that machine already stands unfed (placed from the build bar), it names the wire instead ("Drag from a Drill's port to the Refiner.": goals 4 and 7), and at goal 4 the guiding hand acts that wire out.

**Show me** does nothing for the player: it frames what the step is about (and selects it where the step is a button in the inspector), puts a ring on the button to press, and a hand acts the gesture out twice (`advice-show.ts`, `hand.ts`).

When the goal is done the card says "✓ Done", shows the reward and a green **Claim** button, the loudest thing on screen. The card itself never moves when a goal is claimed: the old text lifts away, the new rises, the pip pops. While the tech tree covers the board, a ready goal rides above it as a slim bar with Claim (on a phone the tree has its own "Goal complete · Claim" bar). In free play the card reads "Free play 1 / 4".

### Order chip

Beside the card from goal 12: "Deliver 13 / 19 Plastic", a bar, the time left at the present rate, and what it pays; a Claim button when filled. When none of the material is being sold it says so in words in place of the bar ("No Market is getting Plastic yet. Wire some to a Market.").

### Alert chip

One chip under the card that says one thing, in this order: the game is open in another tab ("Reload"); the game is paused ("Resume"); or one problem on the board, in words that say what to do ("Refiner (Plastic): give its Tar somewhere to go"), with **Show**. Show jumps to the node and puts that problem away until it changes. The chip names nothing before the first wire, nothing the card's hint, line or tip is already about, and for the first 20 s of a goal nothing about the nodes that goal is about (`status.ts`).

### Toasts (`hud-toasts.ts`)

For what nothing else on screen says: refusals, refunds, "Tidied. Ctrl Z puts it back.", a tech the queue researched. Bottom left of the board on a desktop, under the strip on a phone, clear of every control. At most three at once (two on a phone).

---

## 4. The board (`board.ts`, `fx.ts`)

A faint dot grid (24 px) with the plot as a faint dashed outline from the goal that brings the Expand button (before that there is nothing to say about the plot's edge, and its dashes crossed a phone's first screen); its label, "Board · 2 plots", is not shown: the Expand button is where plots are counted. Cards and wires are DOM and SVG; wire dots, particles and floating gains are drawn on one canvas above them.

- **Card:** 172 px wide and 72, 92 or 112 px tall by its number of ports (a Router, Merger or Dump is 136×60 px). A card is a flat tile with no outline at rest, and wears the colour of what it makes: the glyph stands on a disc of that colour (a Market's is the coin's gold, a Lab's the Data's violet). An outline means something: blue for selected, amber or red for trouble; a card that is not at work stands back, faded. On a Drill or a machine, a ring round the glyph shows utilisation; then the name ("Sand Drill"; a machine by what it makes, its kind after it in small type: "Glass Refiner"), a second line (for a machine, its recipe in words, or "makes Circuit" where the recipe is too long for the line) and a rate line ("0.50/s": how hard it is working is the ring, and a number in its inspector). On a phone a card is set a size up (its name 17 px and its rate 16 px on the board, 12.6 and 11.8 px on the glass at the phone's opening zoom of 0.74), a machine is named by what it makes alone ("Glass"), and its picture is drawn larger. Positions snap to a 20 px grid, and cards never overlap.
- **Ports:** 16 px dots (28 px for a finger: 21 px on the glass at a phone's opening zoom) on the card's sides, inputs left and outputs right, in the material's colour. An output with no wire pulses. A machine with two outputs labels them until they are wired: after that the wire's colour says which is which, and the wire ran through the word.
- **Wire:** a line in the material's colour (a curve, or right angles with rounded corners: "Cable management" in section 5), a solid line 3 to 7 px wide by its rate, with dots in the material's shape and a lighter tint of its colour travelling along it. A full wire is at full strength with a soft glow; a wire carrying nothing is a thin grey line with no dots (in its material's colour it read as an alarm: Copper is red; as a row of dashes it was noise). While something is selected, wires that are not its own are drawn faint.
- **Rate chip:** on a wire only when it has something to say: the wire is selected or runs to the selected card, is full ("MAX"), was made in the last 3 s, or is under the mouse. (A wire that carries nothing had a "0/s" chip: the thin grey line says it.)
- **Deposit:** a dashed tile the size of a card ("Sand deposit · empty · place a Drill"; "Unknown deposit · needs research"). Until there is a Lab a locked deposit is a faint outline with a lock and no words, and until the Drill has its slot in the build bar a free deposit says only "empty".
- **Gains:** once a second "+5¢" floats above each Market and "+1α" above each Lab, and coins fly to the credits pill.

### Status

| State | Ring | Border | Label |
|---|---|---|---|
| Working | green | plain | none |
| Output full, the port has no wire | amber | amber | "Tar has no exit" (the material by name; on a Drill too) |
| Output full, the port is wired | amber | amber | "Backed up" (not on a Drill) |
| An input short | red | red | "Needs more Copper"; "Needs Copper" when nothing wired in brings any |
| An input a little short: at work 60% of its time or more, and under 88% (until back over 92%) | amber | plain | "Short of Ore", in amber: no problem, no alert |
| No recipe, or nothing wired in | grey | dashed | "No input" |
| Suffering from a problem elsewhere | amber | plain | none |
| Working flat out while a machine it feeds needs more, or is short | green | blue | "Can't keep up" |

The label is set in sentence case at 10.5 px (14 px in the larger type), on the card's top edge; none is longer than 20 characters (`pillFor` in `status.ts`, where the words are tested). The simulation's own words (blocked, starved, idle) are not shown anywhere. A Drill that is ahead of what it feeds changes only its ring. A machine is called starved only when it works less than 60% of its time, averaged over 3 s, and stays so until it is back over 65% (`status.ts`). Between that and full speed it is drawn as working; its inspector says how short it is in one amber line ("Receiving 0.80 of 1.00 Ore/s") with the fix under it. A node the player has just changed gets a moment's grace before it is judged.

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

- **Fit** (`F`) shows everything built, as large as fits up to 100%, clear of the goal card and the corner controls; a factory too big to read that way is shown in the overview. Fit always fits, with one exception: a second press straight after the player's own Fit into the overview, with the camera and the board untouched in between, returns to the view they had. While a press would do that, the button's title (on a phone, its label) reads "Back to the last view". After a fit the game made itself (the opening view, an expansion), Fit fits.
- **Tidy** (`T`, offered once six cards stand) lays the board out again so that no wire runs behind a card it does not end at, and wires are short and cross little: bringing a wire out from behind a card comes first, and may cost some wire or a crossing. A board with nothing to mend is left as it is ("Already tidy."). The layout is worked out in a Worker (`layout.ts`); cards glide to their places over 400 ms, each with its wires at its ports at every frame; Drills stay on their deposits; the camera stays on what the player was looking at; one undo puts every card back. After the layout, cards come level with the wire that feeds them where that takes under half a grid step (see "Move" in section 5); pressed again on a board it has tidied, it says "Already tidy."
- **Minimap** (desktop): 160×106 px, each card in its status colour (Markets gold, Labs violet) and the camera's frame. It is a picture only; it takes no clicks. It appears at goal 9, or once eight cards stand; the zoom buttons and Fit at goal 4.
- **Expand** appears from goal 14. Its home is just under the plot ("Expand board 500¢ · New plot · reveals deposits"). When that place is off screen or covered, it docks as a one-line button in the free part of the board (on a phone: in the thumb row). It turns gold when affordable and pulses when the card asks for it. It stands back, faint and deaf to presses, while a port is armed, a wire is drawn, a card is in hand or the build menu is open. After an expansion the camera glides out to show the new plot, and its deposits pop in one after another.

---

## 5. Building and wiring

**Dragging a wire.** Press on an output port and drag. (A finger has to come down on the port's dot itself, within 16 px of its centre: from further off, where a tap still arms the port, a swipe moves the board. A swipe that began beside a port used to draw a wire and make it wherever it ended.) Cards that cannot take the wire, or have no use for what it carries, are dimmed (for a finger the possible ends also glow). A mouse's wire attaches to the card under the pointer, or to one whose port is within 12 px; a finger's snaps to the nearest valid card within 40 px. A card with no use for the material refuses with the reason ("The Glass Refiner cannot use Plastic"). Dragging from an *input* port works backwards: onto a source, or into empty space for the machines that make that material.

**Tap to arm.** A tap or click on an output port arms it: the port stays lit and waits. A tap on a card makes the wire; a tap on empty board opens the build menu there; a tap on the armed port, `Esc`, or the ✕ on the "Tap where the Sand should go" line lets go. This is how a finger wires across a board too big for one screen.

**How a finger is matched** (by distance on screen, whatever the zoom; `touchHit`): a port within 26 px (22 px for an input port); else the card under the finger; else a free deposit; else a pin within 22 px; else a wire within 16 px; else the nearest output port within 44 px; else a card missed by under 10 px. Only the first of these starts a wire when the finger drags: a drag that starts on a wire or in a gap pans. With a port armed, a tap on a wire counts as a tap on the board under it. In the overview a finger's drag always pans; a port is armed by a tap within 16 px of its dot (12 px for a mouse, which can also drag from it).

**Build menu** (`openRadial`). Let go of a wire on empty board, clear of its port (about 36 px).

- *Desktop:* a fan of up to eight slots round a hub that names the material. The hub stands on the middle of the new card's dashed outline: where the wire was let go, unless the card has to stand elsewhere. The slots sit on the side away from the wire, kept on screen and clear of the goal card (the board slides down if the spot was under it, and back when the menu closes). The outline and a line from the port to it are drawn with the fan; with the pointer resting on another option, that option's outline shows. A slot shows the machine, what it does and its price, and its key (`1`–`8`).
- *Phone:* a bottom sheet ("Send Sand to a new…") of large rows. The new card's dashed outline, with its name and the wire from the port, is drawn on the board where the card will stand. The board slides, as little as it can, so the outline shows above the sheet: up or down only, unless the outline lies off the stage across. When the sheet closes, by a pick or a cancel, the slide is taken back unless the player moved the camera meanwhile; after a pick the camera then moves only if the new card cannot be seen whole.
- *Options:* up to three recipes that use the material, then Market, Lab and Dump (for a by-product: Dump, then Market), then Router and Silo, as far as they are unlocked; one option still to research is shown locked ("needs Refining").
- *The suggested option* is the one the goal card asks for, else the first. With a mouse the order is fixed, so a key always builds the same machine; the suggestion is highlighted and focused, and `Enter` builds it. For a finger it is listed first. An option whose card has no room in the outline (a taller card in a tight spot) shows its own outline at the first press ("No room for the Refiner there: it would stand here. Pick it again to build.") and builds at the second.
- An option out of reach is dimmed with its price in red. A press outside the menu closes it.

**Where the new machine stands** (`buildSite` in `geom.ts`). It is settled when the menu opens, shown as the outline, and the pick builds there; it is found again only if the board changed meanwhile. A point outside the plot, or under something that covers the stage, counts as the nearest point inside the plot and clear. The card is centred on that point when it has room there: 16 px from every other card (more across, for the ports) and from a free deposit. Otherwise it takes the nearest free spot, where a spot with a shortcoming counts as 100 px further off (20 px more for each further one). The shortcomings are: less than 40 px of air; not seen whole from the camera as it stands (on the stage, under nothing, and, on a desktop wide enough that a new machine is selected, not where the inspector will open); and, only when the card has to move, standing on the far side of another card from the port. A spot whose new wire would pass behind a card counts as 30 px further. A spot under a cover is used only when the plot has no other. With no room at all: "No room left on the board. Expand it, or clear a space." The machine arrives wired, with its recipe set.

**From the build bar.** A ghost of the card follows the pointer and shows where it will stand and what it costs; a Drill's ghost sits on the nearest free deposit. A finger's ghost starts in the middle of the view and a tap places it. A slot fills from below while it is out of reach and pulses once when it comes within reach. One locked slot is shown as a silhouette with the name of the tech that opens it. Over a deposit and in the overview the ghost is only an outline; its words ("Quartz Drill · 31¢ · tap to place") then stand beside it on the screen, the same size at every zoom, under or above it, clear of the goal card and the build bar.

**Splice.** A machine placed on a wire, or an unwired card dropped on one, is spliced into it (the wire has to pass within about 16 px of the spot). **Branch.** With a mouse, dragging off the middle of a wire starts a second wire from the same port. **Move.** A card follows a mouse after 4 px. Under a finger it has to be held first: after 200 ms it lifts (it grows a little and is ringed, with a short buzz) and then goes with the finger; a swipe that begins on a card before that moves the board, because on a phone a busy board is mostly cards and a finger that set out to look round it kept carrying one off. Dropped on another card it glides to the nearest free spot. **Level.** Cards stand on the grid and their ports do not, so a wire between cards of different shapes was never straight. A card dragged within 9 px (on screen) of the height at which one of its wires would run dead straight stands at that height, a whole number of pixels and a few off the grid; the wire lights up and a soft click plays as it comes level (`levelY` in `geom.ts`). The wire only lights where the card may stay: level, it may stand half the usual gap (8 px) from another card. Let go there, it stays; across, it keeps to the grid. **Block** (mouse). `Shift` and a click on a card puts it in a block of cards that move together, or takes it out; a double click on a card takes its whole line (the card and all it feeds, without Drills and without a Market, Lab or Dump that another line feeds too). The block is ringed and has no inspector. A drag on any card of it moves them all, keeping their places among themselves and inside the plot; the card under the pointer comes level as it does alone. Let go where every card of it is clear of the cards that are not in it, the block stays, as one undo step; otherwise all of it goes back ("No room for all of them there."). A click on a card or on the empty board, or `Esc`, lets the block go. A Drill cannot be part of one. A wire or a card dragged within 52 px of the edge scrolls the board.

**Cut.** `Shift`+drag draws a red dashed line and cuts every wire it crosses (mouse only). Or select the wire and press `Del`, or **Cut wire** in the inspector.

**Cable management** (`wires.ts`; from six cards, with Tidy).

- *Style.* Wires are **squared** unless the player chooses otherwise. The Wires button beside Tidy (`W`; **Wires** in a phone's gear menu) switches every wire between squared and **curved** (one curve from port to port, as wires were at first: they pass behind cards). The button draws the style the board is in. The choice is kept in the browser, not in the save, and a board that is curved always has the switch, however few cards stand on it.
- *Squared.* A wire leaves its port level and comes level into the port it ends at, with a 20 px stub at each end and corners rounded by 10 px. It takes the first of its plain ways that has no card in its way (behind a run of it, or within 6 px of one): one turn just before the card it ends at, or just after the one it leaves, or halfway; for a card under 40 px ahead, one turn in the gap between the two cards; for a wire that ends behind its port, out by the stub, across (halfway between the two ports where they are 112 px apart in height, else 70 px under or over them) and in by the stub.
- *Round the cards.* With a card in the way of every plain way, the wire finds its own (`wayRound`: a shortest-path search over the lines a wire would run along to pass a card, 20 px out from its sides and 14 px above and below it, and the heights and stubs of its own two ports). It takes the way with the least length, a corner counting as 36 px, that comes within 6 px of no card, its own two included; of ways as good as each other, the one that runs level first and turns late. It looks within 100 px of its ends first, then 320 px, then the whole board. The way is found again whenever a port or a card near it moves, so wires step aside as a card is dragged through them; a way is kept while nothing near it has moved, and so are a wire's plain way and the line it was drawn as, so that a step of a drag works out only what the moved card can reach. Nothing is rounded in telling whether a card has moved, and nothing that is kept ever shows: however a board came to be as it is (a drag, a glide, Tidy), it is drawn as a page that has just loaded it draws it (`wires.test.ts` plays boards through all of those and compares). A wire with no way at all (a port walled in, cards on top of each other) takes the plain way that passes behind the fewest cards.
- *Side by side.* Wires that end up on one line, or on lines under 8 px apart, and run beside each other there are each given a track of their own, 8 px from the next: wires that turn in before the same card, wires that pass the same side of one. The tracks are set in the room beside the line (no nearer a card than the line was, where there is room for that; never nearer than 6 px; closer together where there is not room for all), in the order in which the fewest of the wires cross, so a bundle turns a corner as nested lanes. Wires out of one port are one cable until they part. The run out of a port and the run into one stay where they are.
- *Pins.* A pin is a point the wire is drawn through: a small ring in the wire's colour, on a 10 px grid inside the plot, up to four a wire. With a mouse, a double click on a wire sets a pin there and a double click on a pin takes it off; a wire's inspector has **Add a pin** (in the middle of its longest stretch without one; the camera brings the pin clear of the sheet) and **Remove pins**. A pin is dragged like a card (after 4 px, or 10 for a finger; `Esc` puts it back), and each change is one undo step. A curved wire bends smoothly through its pins. A squared one runs level to above or below each pin and turns up or down through it, so every pin is a corner or lies on an upright run; where a card is in the way of that, it finds its way round the cards from pin to pin instead, still through every pin in turn (a pin set on top of a card has no clear way to it, and the wire keeps the plain shape). A pinned wire is not moved aside for others. Pins stay where they were set when a card at either end moves; the pins of a wire between two cards of a block move with the block. Tidy takes every pin off (the same undo step puts them back). Cutting a wire, deleting a card at its end or splicing a machine into it loses its pins. Pins are saved with the game and are not drawn in the overview.
- Whatever the style and the pins, the dots, the rate chip, a tap, the cutting line and the light of the ending follow the wire as it is drawn, and the wire carries the same: nothing about cable management is read by the rules.

**Undo.** Each edit is one step: a build with its wire, a move with its splice, a pin set or moved, a whole Tidy, an expansion. Undo takes back what was paid or refunded, and refuses when a refund has been spent. 200 steps are kept, back to the last claimed goal. Deleting refunds in full; the last Drill cannot be deleted.

---

## 6. The camera

A press on the board stops any camera move under way. The game moves the camera by itself only as follows, and then by the smallest move that works.

| When | What the camera does |
|---|---|
| A game opens (new, loaded, or the layout changed) | The whole factory, when it can be read at once. Otherwise what the goal is about, at a readable zoom; failing that the overview. |
| A goal comes up; its saving is done; the tech tree closes | The nodes (or the deposit) the card is about are brought into view if any is off screen or covered. Nothing moves if they can be seen. |
| **Show me** | Frames what the step is about; for a step that builds from a port, the port and the empty spot the hand points at, together, in the overview if need be. The dashed card is drawn where the card would be built. |
| A machine is built, a wire is made, a card is selected | Moves only if the new card, the wire's far end or the selected card cannot be seen whole. |
| A finger arms a port | Moves only when the wire's other end could not be tapped otherwise: on a phone when the card the goal names is out of reach, elsewhere when no possible end is in reach. It then frames both ends, in the overview if need be. Never for a mouse, and never when the card asks for something to be built from that port. A card is in reach when a part of it 44 px each way (its whole width or height where it is drawn smaller) is on the stage and under nothing; a tap on whatever shows of a lit card makes the wire. |
| A Drill is taken up | The free deposits are brought into view. |
| The build menu opens | Desktop, under the goal card: the board slides down so menu, wire and outline stay together. Phone: the board slides, as little as it can, so the outline shows above the sheet. The slide is taken back when the menu closes, unless the player moved the camera. |
| Fit, Tidy, Expand, the alert's Show, the Flow ring, "Jump to source" | As asked. |
| The first Phone | The line that feeds the Phone is slid into view without zooming in. On a phone the factory is then framed above the summary sheet. |
| A phone is turned | Zoom and centre are kept; a selected card or armed port is brought back if the turn hid it. |
| The window is resized | The middle of the view stays in the middle. |

It never moves while a button or finger is down on the board, a port is armed, a card is in hand or the build menu is open (except to show the outline of an option pressed whose card has no room in the first one); never under a celebration card (it waits for the card to go); and never because the inspector or a sheet other than the build menu closes (a move that came due while a phone's sheet was up is made once it has gone). When the build menu closes, the slide it made is taken back, as above. With reduced motion every move is a jump.

---

## 7. The inspector (`panels.ts`)

Opens when a card or a wire is selected: a 320 px panel beside the board on a desktop, a bottom sheet on a phone (swipe it down by its handle or header, or press ✕). On opening it scrolls to what the player most likely came for: the button **Show me** ringed, the warning, a Router's wire rows, or the first upgrade they can afford; a warning taller than a short phone's sheet is scrolled so that its buttons stand clear of the sheet's foot.

| Section | Contents |
|---|---|
| Header | Icon, name, one line on what the node does, ✕ |
| (Until goal 6) | A card's inspector holds the header, the status and the body only: nothing to buy. Duplicate and Delete come at goal 4. |
| Status | Only for a problem: a box with what is wrong and its fix, titled in plain words ("Not enough Copper", "Tar has no exit", "Glass is backed up", "Nothing is coming in"); the amber line for a machine that is merely short; and for a machine whose card says "Can't keep up", a blue box that names who is waiting and for what, with Speed in one press and "Show who waits" |
| Body, by type | *Machine:* the recipe as chips, with **Change** when it has a choice; Flow bars for each input (received / needed) and output; utilisation. *Drill:* extraction rate. *Router:* mode (Even, Ratio, Priority, Filter; a locked mode leads to its tech), one row per wire with its share and its control, and **Favour** to send one wire the bigger share. *Market:* what sells here and what it earns; after the first sale over demand, a demand gauge per material. *Lab:* what it studies and what each item gives. *Silo:* what it holds |
| Upgrades | One row per track: level, effect, and a buy button that fills as credits come in. With the Bulk Upgrade tech each row also has a second buy button with the price of one press on it ("Upgrade all · 819¢"): it raises every node of that type by one level, lowest level first. Where the credits reach only some it says how many ("Upgrade 6 of 9 · 512¢"); a press that would buy more than the button said buys nothing and asks for a second press |
| Footer | **Duplicate** (not for a Drill) and **Delete · +refund** |

A wire's inspector shows what it carries against its capacity, "At capacity" when it is the bottleneck, the next pipe tier with its price, **Upgrade every full wire**, from six cards a **Route** part (how many pins of four, **Add a pin**, **Remove pins**, and a line on how a pin is set and dragged), and **Cut wire · +refund**.

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

**Start screen.** A card over the dimmed, still board: the logo with dots running along its wire, "Flowstate", "Build a phone out of sand. Wire it up and watch it flow.", a **Start** button and "About 20 minutes · best with sound". With a save it reads **Continue**, with **New game** under it. Nothing runs and nothing is saved until the button is pressed.

**The ending**, when the first Phone is made:

1. A pulse runs along the wires from the Drills to the Phone, lighting each card it passes.
2. The "First Phone · Demo complete · free play is open" card comes up. No press sends it away.
3. After 6.5 s the summary opens: a card at the foot of the screen (a bottom sheet on a phone) with the factory still running behind it. It gives the time to the first Phone, four numbers (things built, share of income from sales, orders filled, longest Flow streak), the four things free play has the player make, and **Keep playing**, **Copy result** (two lines of text) and **Start over**. It takes no press for its first 600 ms.

**Keep playing** (or `Esc`) starts free play. From the Phone until then the goal card shows goal 22 done with no Claim, and the board reports no problems.

**Time away.** After the first Phone only: a "While you were away" card with what the line earned and **Collect**.

---

## 10. Celebrations and sound, in outline (`celebrate.ts`, `feel.ts`, `audio.ts`)

- **Big moments** (seven: first Glass, the Lab, first Copper, first Circuit, the first Flow State, first Screen, first Phone): a colour wash, a card in the middle of the screen, particles, a fanfare. About two seconds; a press anywhere sends it on (the Phone card stays until the summary).
- **Every claim:** the reward flies as coins from the Claim button to its counters, which roll. Smaller cards mark a research the goal was saving for and the first β.
- **Wiring and building:** the new wire swells, its target flashes, a new card pops in.
- **Flow State** (100% Flow for 10 s, with six or more producers): the board's edge glows and a hum plays under it.
- **Sound** is synthesised with Web Audio; there are no sound files. There are cues for a wire, a build, a card coming level, sales, a slot coming within reach, a goal turning ready, a claim, a payout, a tip, a line ticked, an error, the first surplus, an expansion and research. No more than eight cues start in a second (twelve for the important ones), and a limiter caps the level. Sound starts with the first press and stops while the tab is hidden. The mute control is the speaker button (the gear menu on a phone) and is remembered.
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

## 12. What is on screen when (`reveal.ts`)

The first screen is a Drill, a Market, the goal card, the credits, Pause, Sound and the menu. Each other part comes with the goal that first gives it a use, so that what is new on screen is what the card is talking about. A save that is further on shows all it has reached at once.

| From | What arrives |
|---|---|
| Goal 2, "Dig up more Sand" | The Drill's slot in the build bar; Undo and Redo |
| Goal 4, "Turn Sand into Glass" | The zoom buttons and Fit; Duplicate and Delete in a card's inspector |
| The Lab (goal 5's reward) | The Tech tree button; locked deposits say "needs research" |
| Goal 6, "Speed up a Drill" | The Market's slot (sooner, the moment a second Market can be paid for); the upgrades in a card's inspector (sooner, once anything has been upgraded) |
| Goal 9, "Turn Oil into Plastic" | The Flows button; the minimap (sooner, once eight cards stand) |
| Six cards | Tidy; cable management: the Wires button, and pins on a wire (the Route part of its inspector, a double click on it) |
| Goal 11's reward | The order chip |
| Goal 14, "Open up more land" | The Expand button |
| Goal 15's reward | The Flow ring |

A machine's slot appears when it is unlocked; one locked machine is shown as a silhouette. On a phone the floating Fit and Undo keep their places and are only made visible, so the row beside them does not move.

## 13. The Flows panel (`ui/flows.ts`, `src/flows.ts`)

Opened from the top bar (`L`; on a phone from the gear menu), it stands where the inspector stands: a 320 px panel beside the board, a bottom sheet on a phone. It is a selection like a card's, so whatever closes the inspector closes it.

- **A row a material**, in the order of the recipes, for everything the board makes or uses: its picture and name, how much is made a second, a bar, and a line of numbers ("2.50 studied · 1.00 to machines · 0.75 sold").
- **The bar** is where what is made goes, in one grey-blue from light to dark: to machines, sold, studied, dumped (none of them a material's colour); and after it, hatched red, what machines wanted and did not get.
- **A word** on a row that needs one: **Short** (a machine stands waiting for it: "Machines want 1.00/s and get 0.80."), **No exit** (a port that gives it has no wire and its maker has stopped), **To spare** (more could be made than is taken: no fault). Short and No exit rows have a **Show** button that goes to the Drill or machine to look at and opens it.
- **A press on a row traces the material:** what makes it, what uses it and the wires that carry it stay as they are, with their rate chips; every other card and wire stands back. The camera frames what is traced. A second press, or closing the panel, ends it.
- The amounts are read off the wires (each wire's rate is measured over whole deliveries), not off the machines, whose own rates swing as they work in bursts.

## 14. Tokens (`:root` in `src/style.css`)

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

**The look** (`src/styles/clean.css`, loaded last: the other stylesheets lay the interface out, this one says what it looks like). Clean and minimal, by four rules. The board is what the screen is for: bars and panels take as little of it as they can. A surface is told from what is behind it by its fill and a soft shadow, not by an outline: nothing at rest has a border, and a border means something (selected, in trouble, asked for). One face, **Inter**, at a few sizes: numbers are set in it too, with even-width figures (a row of mono type read as a console), labels are set as words are and not in spaced capitals, and no key cap is printed on a button (a key is in its button's tooltip, and a build-bar slot shows its number while the pointer is on the bar). Colour belongs to the materials: a card wears the colour of what it makes and a wire the colour of what it carries; everything else is grey until it has something to say. The font loads after the first paint; until then the system font shows. Material colours and shapes are in `src/content.ts` and `src/ui/icons.ts`.

---

## 15. What the earlier spec asked, and how the build answered

- **Inspector docked or floating?** Docked: a panel at the right on a desktop, a bottom sheet on a phone.
- **Build bar left or bottom?** Left on a desktop, bottom on a phone.
- **Tech tree as overlay or drawer?** A full overlay; on a phone its detail is a sheet over it.

Drawn in the earlier spec and not built: a trash drop-target in the build bar (the tile there only recalls the `Del` key), a heat tint on wires when zoomed out, alternating dot colours for mixed wires, "owned / total" counts on the tree's branches, and double-click or `Q` in the tree.
