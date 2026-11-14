# Flowstate

An incremental node-graph game: wire up a *theoretical supply line* of fictional materials, route them through recipes and splitters, sell the output for credits, and research your way to bigger, cleaner flows.

## Play

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` writes a static site to `dist/` (relative paths, so it can be hosted anywhere). `npm test` runs the simulation tests.

## Controls

| Action | How |
|---|---|
| Connect | Drag from a port onto another node |
| Build from a wire | Drag from a port into empty space, pick from the menu (or keys `1`–`8`) |
| Branch | Drag off the middle of a wire |
| Splice | Place or drop a loose node on a wire |
| Cut | `Shift` + drag across wires |
| Place | Hotbar or keys `1`–`0`; `Shift`+click keeps placing |
| Delete | Select, then `Del` (full refund) |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Duplicate | `Ctrl+D` |
| Tech tree | `R` |
| Pause / fit board | `P` / `F` |
| Pan / zoom | Drag empty space / mouse wheel |

## What's in this build

- Simulation: wells on deposits, refiners, assemblers, fabricators, routers (even / ratio / priority / filter), mergers, silos, markets, labs and voids; buffers with backpressure; wire capacity tiers; per-node status (working, blocked, starved, idle).
- Economy: credits with market saturation, three tiers of Data, escalating node and upgrade costs, milestone bonuses, board expansion that reveals deposits.
- Tech tree: 29 techs across five branches, with an auto-research queue.
- Editing: everything in the Controls table, with full refunds and undo that restores credits.
- Saves to the browser every 10 seconds, with earnings for time away (2h cap, 8h with a tech).

Not built yet: multi-select and copy/paste, contracts, blueprints, ghost planner, sound, touch controls, prestige.

## Docs

- [Game design document](docs/DESIGN.md): pillars, core loop, the two progression systems, simulation, economy, and the editing spec.
- [UI spec](docs/UI.md): layout, interaction and visual tokens. Mockups are on the [Flowstate UI canvas](https://claude.ai/artifact/HS1Kbgr7TKuNz9xPjpJ7Pg).
- [Content & numbers](docs/CONTENT.md): materials, recipes, node costs, Data and the tech tree. The game reads these from `src/content.ts`.

## Code layout

```
src/content.ts    materials, recipes, nodes, techs (data only)
src/state.ts      game state, save/load, undo snapshots
src/sim.ts        deterministic tick: production, transfers, status
src/economy.ts    costs, prices, tech rules, formatting
src/actions.ts    every board edit, all undoable
src/ui/           board (DOM + SVG), radial menu, panels, tech tree
tests/            simulation and editing tests
```
