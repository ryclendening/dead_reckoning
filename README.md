# Dead Reckoning

A playable mobile-first prototype of a hidden-information Cold War air-command game.

The battlefield is a continuous low-poly diorama with a subtle H3-style overlay shown only during ground deployment. Ground assets snap to hex centers; flight routes are drawn continuously and the hex lattice disappears after deployment is locked.

## Play

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` and use a portrait viewport.

## Current playable loop

The detailed, current source of truth is [GAMEPLAY_STATE.md](./GAMEPLAY_STATE.md). This README intentionally summarizes only the active prototype loop.

1. Select one of four friendly formations: two fighters and two reconnaissance flights.
2. Choose squadron aggression, then draw a route within its fuel range. Return fuel is reserved automatically.
3. Commit the order and watch a deterministic 22-second execution phase.
4. Fighters that encounter hostile fighters merge into a visible dogfight until one formation is destroyed.
5. Recon aircraft reveal terrain progressively while flying. A surviving recon formation that returns home permanently maps its explored corridor; a lost formation does not.
6. Radar-only enemy aircraft are uncertain tracks. Visual contact reveals the correct aircraft model and combat information.
7. Use the debrief to review losses, recovered intelligence, and mapped terrain before adapting the next route.

Enemy ground assets begin hidden. Reconnaissance is the route to persistent ground intelligence; mapped terrain and live airborne contact are separate information layers.

Some legacy campaign/economy state remains in the code while the core loop is being tested. It is documented accurately in [GAMEPLAY_STATE.md](./GAMEPLAY_STATE.md), including which systems are inactive or incomplete.

## Architecture

- `src/game/engine.ts` contains rendering-independent round resolution.
- `src/game/types.ts` defines serializable match, order, asset, and event state.
- `src/components/Battlefield.tsx` renders the Three.js diorama and route input.
- React owns the HUD, planning controls, debrief, logistics, and phase flow.

This keeps the simulation suitable for a future server-authoritative 1v1 transport without coupling game rules to the 3D renderer.
