# Dead Reckoning

A playable mobile-first prototype of a hidden-information Cold War air-command game.

The battlefield is a continuous low-poly diorama with a subtle H3-style overlay shown only during ground deployment. Ground assets snap to hex centers; flight routes are drawn continuously and the hex lattice disappears after deployment is locked.

## Play

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` and use a portrait viewport.

## Core loop

1. Place the real base, decoy, radar, SAM, and AAA inside friendly territory.
2. Select one of four squadrons and set mission, aggression, and risk posture.
3. Tap or drag on the map to draw a route, or choose a route preset.
4. Commit all orders and watch the autonomous 18-second execution phase.
5. Read the causal command findings and detected route history.
6. Spend limited logistics on repair, rearm, readiness, runway, and defenses.
7. Preserve the three-aircraft reinforcement pool while locating and destroying the enemy's real airbase.

## Strategic depth additions

Routes now have an operational-security consequence. When several squadron ingress vectors cross the forward line on headings that backtrace toward the home base, **base exposure** rises and the AI becomes more likely to strike the real field instead of the decoy. Offset departure legs and deceptive approaches reduce exposure. The debrief explains the change and shows the new exposure level.

Strike squadrons also have a single high-level target-priority order: open a corridor by attacking SAM/AAA, blind the radar network, pursue a known airfield, or take the nearest known opportunity. Strike aircraft will not attack completely unknown fixed assets, so reconnaissance and target priority now work as a package.

During execution, battlefield achievements generate **authority**. Tracks, shared defense cues, intelligence gains, kills, and target damage increase round score; observed attrition provides emergency authority so a losing player is not locked out of support. The Reserve Desk offers two deliberately limited call-ins:

- **Alert Interceptors** spend authority, one Command Point, and one reserve aircraft to attack a currently observed inbound raid and reduce projected base damage.
- **Replacement Flight** unlocks only after an observed friendly loss and restores one aircraft to that formation for the next round.

Each option can be used once per round. Both draw from the same scarce reserve pool used for between-round replacements, forcing a choice between immediate battlefield intervention and long-term force recovery.

Enemy aircraft are hidden simulation objects. They appear only while inside a friendly radar or CAP observation window, and disappear again when the track is lost. Waypoint rings show each selected squadron's line-of-sight footprint. During execution, mission, aggression, and risk doctrine can cause autonomous intercepts, pursuit, escort peel-offs, threat aborts, and press-through attacks.

Cautious CAPs can shadow contacts and cue the defensive network, extending shared tracking and reducing the effectiveness of an incoming raid. Aggressive CAPs pursue farther but leave temporary coverage gaps, spend additional readiness and ammunition, and risk unsupported attrition. Formation losses reduce sensor and combat effectiveness; damaged aircraft cost 2 logistics to repair, while destroyed aircraft cost 4 logistics to replace.

Defensive positioning is simulation-relevant: radar health and placement determine detection, SAM/AAA rings must intersect an incoming route to engage, shared CAP tracks extend those engagement opportunities, and strikes can damage the runway or nearby defensive sites. After each round, the map displays friendly execution routes, only the observed portions of hostile tracks, and numbered engagement markers. The command findings explicitly connect doctrine selections to autonomous decisions.

Game state persists locally between reloads. **New Campaign** clears the save after a victory or defeat.

## Architecture

- `src/game/engine.ts` contains rendering-independent round resolution.
- `src/game/types.ts` defines serializable match, order, asset, and event state.
- `src/components/Battlefield.tsx` renders the Three.js diorama and route input.
- React owns the HUD, planning controls, debrief, logistics, and phase flow.

This keeps the simulation suitable for a future server-authoritative 1v1 transport without coupling game rules to the 3D renderer.
