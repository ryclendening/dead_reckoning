# Dead Reckoning

A playable mobile-first prototype of a hidden-information Cold War air-command game.

The battlefield is a continuous low-poly diorama with a subtle H3-style overlay shown only during ground deployment. Ground assets snap to hex centers; flight routes are drawn continuously and the hex lattice disappears after deployment is locked.

## Play

```bash
npm install
npm run playtest
```

This runs the automated game checks, creates the production build, and serves
that exact build at `http://127.0.0.1:4173`. Use a portrait viewport.

For quick development iteration without the production gate, run `npm run dev`
and open `http://127.0.0.1:5173`.

## Play online with a friend

With Node.js 24 or newer, build and start the online server:

```bash
npm ci
npm run build:online
npm run start:online
```

The server listens on port 4173. On both devices, open the same server address.
On a shared Wi-Fi network, use the host computer's LAN address, such as
`http://192.168.1.10:4173`. Choose **Player vs Player → Create Match** on the
first device. Enter the one-use invite code under **Join** on the other device.
Each player deploys and locks their own orders. The server resolves after both
players lock. Use **Continue Online** in the same browser to resume.

Matches survive a server restart in `.online/matches.sqlite`. Set
`ONLINE_DB_PATH`, `ONLINE_HOST`, or `ONLINE_PORT` to override the defaults.
For devices on different networks, run the server behind an HTTPS host that
both devices can reach and keep the database on a persistent volume.

### Worker and D1 prototype

The online build includes a Worker at `dist/server/index.js` with `DB` and
`ASSETS` bindings. To exercise it with local Wrangler:

```bash
npx wrangler@4.92.0 d1 execute dead-reckoning-online-local --local --config scripts/online/wrangler.local.json --file scripts/online/schema.sql
npx wrangler@4.92.0 dev --local --config scripts/online/wrangler.local.json --port 8794
node scripts/online/smoke.mjs http://localhost:8794
```

The last command runs from a second terminal. It creates three concurrent
matches and verifies round resolution and duplicate command handling over HTTP.
The current managed Site still uses its static build. The Worker and D1
configuration is available for local testing and a separate hosting rollout.

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

The online server uses the same round simulation and sends each player a replay filtered by their own contacts and intelligence.
