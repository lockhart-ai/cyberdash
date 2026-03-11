# CyberDash - Codex Guidelines

## Project Overview
CyberDash is a cyberpunk courier action game. The player is a cybernetically enhanced courier navigating a dystopian future. Isometric 2.5D with pixel art style.

## Tech Stack
- **Engine**: Phaser 3
- **Language**: TypeScript (strict mode)
- **Build**: Vite
- **Package Manager**: npm

## Project Structure
- `src/main.ts` - Entry point
- `src/config/` - Game configuration
- `src/scenes/` - Phaser scenes
- `src/entities/` - Game entities (player, NPCs, etc.)
- `public/assets/sprites/` - Sprite sheets and images
- `public/assets/tilemaps/` - Tilemap data and tilesets
- `public/assets/audio/` - Sound effects and music

## Asset Pipeline

### Purchased Asset Packs (primary source)
- **27 isometric packs** (~6700 PNGs) stored at `/tmp/cyberdash_asset_packs/`
- Symlinked into project at `public/asset_packs/` (gitignored)
- Key packs: Cyberpunk City, Cyberpunk Buildings, Cyberpunk Streets, Cyberpunk Interior, Roads and Cars

### STRICT Asset Rules
1. **Never modify originals.** Asset packs stay untouched in their source location. Copy/cut assets into the project when needed.
2. **Zero post-processing.** No resizing, no shearing, no smoothing, no color correction, no scaling, no modifications of any kind. Preserve exact pixel-perfect originals.
3. **Only cutting is allowed.** Splitting sprite strips into individual tiles is OK. Everything else is off-limits.
4. **Project copies live in `public/assets/tiles/`** (organized by pack/category).

### Characters/Sprites — PixelLab
- Player character sprites in `public/assets/sprites/player/`
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
