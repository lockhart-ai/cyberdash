# CyberDash - Claude Code Guidelines

## Project Overview
CyberDash is a cyberpunk courier action game. The player is a cybernetically enhanced courier navigating a dystopian future. Isometric 2.5D with pixel art style.

## Tech Stack
- **Engine**: Phaser 4 (4.0.0-rc.6)
- **Language**: TypeScript (strict mode)
- **Build**: Vite
- **Package Manager**: npm

## Project Structure
- `src/main.ts` - Entry point
- `src/config/` - Game configuration (`assetCatalog.ts` is a reference list, not loaded by the game)
- `src/scenes/` - Phaser scenes (`BootScene` loads assets, `GameScene` builds the city and runs the game)
- `src/iso/` - Isometric geometry and city layout constants (no Phaser imports)
- `src/rendering/` - Building, street, sign and billboard drawing
- `src/utils/` - Shared helpers (PRNG, texture trimming)
- `src/entities/` - Game entities (player, NPCs, etc.)
- `public/assets/player/` - Player sprite sheets
- `public/assets/buildings/` - Building pieces (`city/`, `asian/`)
- `public/assets/sprites/` - Props, cars and billboards
- `public/assets/tilemaps/` - Street, sidewalk and wall tiles
- `public/assets/audio/` - Sound effects and music
- `scripts/` - One-off asset tooling, not part of the game

## Asset Pipeline

### Purchased Asset Packs (primary source)
- **27 isometric packs** (~5,000 PNGs, 157 MB) in `asset_packs/` at the repo root, extracted unchanged from the purchase zips; gitignored, never committed
- `public/asset_packs` is a relative symlink to `../asset_packs` (also gitignored) so the dev server can show them; the game never loads from it at runtime
- To restore on a new machine: unzip each purchase zip into `asset_packs/<Pack Name>/` (e.g. `asset_packs/Isometric Cyberpunk City/`), then `ln -s ../asset_packs public/asset_packs`
- Key packs: Cyberpunk City, Cyberpunk Buildings, Cyberpunk Streets, Cyberpunk Interior, Roads and Cars

### STRICT Asset Rules
1. **Never modify originals.** Asset packs stay untouched in their source location. Copy/cut assets into the project when needed.
2. **Zero post-processing.** No resizing, no shearing, no smoothing, no color correction, no scaling, no modifications of any kind. Preserve exact pixel-perfect originals.
3. **Only cutting is allowed.** Splitting sprite strips into individual tiles is OK. Everything else is off-limits.
4. **Project copies live under `public/assets/`** (`buildings/`, `sprites/`, `tilemaps/`), organized by category.

### Characters/Sprites — PixelLab
- Player character sprites in `public/assets/player/`
- 8 directions, walk (6 frames) and run (8 frames) animations
- 64x64 frame size

### Other tools
- **Aseprite** for cleanup/animation polish
- **Tiled** for isometric tilemap editing (exports JSON for Phaser)

## Rendering Rules
- **Always specify target render size in pixels.** Before placing any asset, decide its rendered dimensions (e.g. "64px tall"). Compute `scale = targetH / frame.height` from that. Never use arbitrary scale factors like `0.1` — always derive scale from an explicit pixel target.
- Source images stay at original resolution on disk. The renderer computes scale to hit the target.
- `pixelArt: true`, `roundPixels: true`, antialias disabled for crisp pixels.

## Conventions
- Use Phaser's scene system for game state management
- Keep game config in `src/config/game.ts`
- One class per file, filename matches class name
- Dev server runs on port 3000
- **Fail loudly; no silent fallbacks.** A fallback or degraded mode (a missing asset, a binary not found, a
  default used because something else wasn't available) warns clearly — in a log at minimum, in the game's own
  UI where the player would notice — saying what it fell back to and why. Ask of every fallback: how would
  anyone know this path was taken?

## How we work

See `docs/glade.md` for how this task runs in Glade, `docs/kittens.md` for how the supervisor and kittens split
work, and `docs/kitten-sop.md` for the issue-to-PR process.

- **Game dev** (gameplay, rendering, assets, levels): no issue, no PR, no branch. Commit straight to `main` with
  a sentence-case imperative summary (no issue number), and push. Work in the main checkout, not a worktree, one
  change at a time, so it hot-reloads in the dev server Jared and the supervisor are both watching.
- **Tooling/process** (CI, harness, scripts, docs, dependencies): the full flow — issue, `<issue>-<slug>` branch
  in a worktree, `<issue>: Summary` commits, a PR, CI green, then the supervisor reviews and merges.
- There's no test suite and no releases here — iterating straight in the repo replaces both. Checks are
  `npx tsc --noEmit`, `npx biome check src/` (`npm run lint:fix` to auto-fix) and `npm run build`; CI runs all
  three on every PR and push to `main`.
- To see the game: `npm run dev` (port 3000), or the supervisor's headless `npm run look` for a quick look
  without a browser — its FPS numbers are meaningless (software GL), so judge by what's on screen, not by that.
