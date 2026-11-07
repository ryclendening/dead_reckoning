# Focused graphics engine review

Reviewed and implemented 2026-11-02. Scope: flight presentation, dogfights, missiles, SAM and AAA fire in the existing Three.js / React Three Fiber renderer. Recommendations below were delegated to Luna, then reviewed and verified by the primary agent.

## Findings and recommended changes

| Priority | Evidence in the current code | Change and acceptance check |
| --- | --- | --- |
| P0 | `EnemyContact` looks at `facing[0]` and `position[1]`, discarding the heading's Z component. | Use both heading components and shortest-angle orientation interpolation. North/south, diagonal, wraparound and zero-length headings must remain finite and correct. |
| P0 | `updateDogfightEngagement` records merged exchanges but publishes no corresponding live weapon effects. `dogfightWeaponEffects` reconstructs them only from completed sequences. | Publish each resolved gun burst once in the live effect stream, with a stable ID. Use the same effects after completion and remove duplicate reconstruction. Verify a burst exists while its dogfight remains active. Preserve seeded damage and combat timing. |
| P1 | `Flight` and `EnemyContact` directly call `lookAt`; model roll and pitch are reserved for damage wobble. Dogfighting intentionally freezes tactical positions and route fuel. | Add shared, frame-independent attitude sampling with bounded banking. Introduce restrained, deterministic maneuvering of individual aircraft inside the formation footprint during combat, blended in and out without moving the tactical anchor. Preserve contact clipping, route distance, camera, fog and sensor positions. |
| P1 | Weapon JSX is reconstructed from the 20 Hz `seconds` prop. SAM bodies use a fixed orientation; SAM and strike flashes begin before impact; ground misses fly to the same endpoint as hits. | Sample weapon transforms on the shared scene clock using stable meshes and reusable trail buffers. Align missile bodies to trajectory tangents. Separate launch flash/plume, powered flight/trail, miss flyby, and impact. No hit flash before `effect.end`; no hit flash on a miss. SAM starts near ground and ends at aircraft altitude; strike does the reverse. |
| P1 | SAM/AAA `effect.to` is the aircraft position at launch, although impact resolves later while the aircraft moves. | Guide air-target graphics using only the target's currently authorized track up to the current scene time; freeze the terminal location at the impact-time track sample once available. Never read a future or hidden hostile position. Static ground-strike targets stay fixed. |
| P1 | `EngagementOrbit` draws rotating detached rings around stationary tactical anchors; `CombatEffect` can add a second fabricated falling projectile for an impact event. | Remove the combat rings and fabricated duplicate projectile. Let aircraft attitude, short gun bursts and weapon trajectories communicate action; keep the compact engagement label. |
| P2 | Every historical weapon effect remains mounted, even after its lifetime. Render callbacks allocate sampled frames and transient objects. | Filter effect lifetimes before mounting, keep active geometry stable, reuse Three.js scratch objects, and dispose owned GPU resources. Avoid adding a physics library or upgrading dependencies for this pass. |

## Design boundary

The existing game uses fixed-speed planar movement and pauses tactical translation during fighter dogfights. This pass improves rendered flight behavior; a true turn-radius, energy, altitude and maneuver simulation would change routing, fuel, sensing and combat balance and deserves a separate design. Do not disguise a displaced tactical position with an unrelated cinematic orbit. Ground and air weapon damage remain authoritative.

## Practices checked

- [React Three Fiber performance pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls): animate through refs in `useFrame`, use time deltas, reuse objects, and avoid needless geometry/material remounts.
- [Three.js Quaternion](https://threejs.org/docs/pages/Quaternion.html): normalized rotations, shortest-path spherical interpolation and bounded `rotateTowards` without overshoot.
- [Three.js BufferAttribute](https://threejs.org/docs/pages/BufferAttribute.html): update reusable dynamic attributes rather than replacing trail geometry every frame.

## Verification targets

Deterministic coverage: heading and bank bounds; contact-window clipping; stable combat-local motion and unchanged tactical anchor; every weapon kind's launch/end altitude, tangent, miss and exact impact boundaries; live dogfight effects without duplication or altered combat outcomes. Run the complete test suite and production build.

Browser permission was explicitly granted on 2026-11-02. Check fighter duel, 2v1, pursuit and SAM/AAA at 1x/2x where reachable, with desktop and a narrow viewport. Capture console health and actual rendered evidence; distinguish observed behavior from deterministic-only coverage.

## Implementation and validation

Implemented the recommendations above in `Battlefield.tsx`, shared graphics sampling helpers, shortest-angle track interpolation, and the live dogfight effect publisher. Gunfire is a hitscan burst at its authoritative shot time, including pursuit shots that previously published backdated effects; missile/AAA hit flashes are gated to their recorded impact times. Individual aircraft maneuver within their formation footprint and ease back after recorded combat exit. Tactical anchors remain unchanged.

Review corrected early-flash gating, reversed missile pitch, flat trail altitude, live combat exit blending, and contact-window handling before final verification. `GAMEPLAY_STATE.md` now describes actual behavior. Its earlier statement that weapon transforms interpolated at frame rate disagreed with the snapshot-driven JSX in the original renderer; the implementation now makes that behavior true.

| Check | Result |
| --- | --- |
| Full deterministic suite | 220/220 tests pass across 34 files. Updated one pre-existing stale Protect-copy assertion in `Hud.test.tsx`; the same failure was reproduced on untouched HEAD before that correction. |
| Production build / whitespace | `npm run build` and `git diff --check` pass. The existing large-bundle warning remains. |
| Original simulation comparison | Six fixtures compared against isolated HEAD: fighter duel, 2v1, head-on, fighter/recon, parallel engagements, recon recovery. Aircraft tracks, times, shot probabilities, damage, final dispositions and events match. Additional live gun effects are intentional. |
| Desktop / narrow browser | Headless Chrome through Playwright at `http://127.0.0.1:5173/`, 1440×1000 and 390×844. Scenario selection → task selection → order confirmation → Commit enters Execute; 1×/2× controls respond; no horizontal overflow or framework error overlay. |
| Ground-defense fixture | Isolated browser save with one SAM and AAA near a recon route: launch 0.05 s, SAM hit 1.10 s, AAA miss 0.39 s. Captured launch, in-flight and impact views. |
| Console | No uncaught application exceptions. Baseline-only issues remain: missing `favicon.ico` (404), Three.js clock deprecation, and software-renderer ReadPixels warnings. |

Browser plugin was unavailable; Playwright used temporary tooling and an isolated browser profile. QA scripts, snapshots and comparison data are under `/tmp/air-power-graphics-qa`, outside committed source. Captures include `final-merged.png`, `final-mobile.png`, `after-ground-launch.png`, `after-sam-flight.png`, and `after-sam-impact.png`.

Remaining limits: campaign strike graphics have deterministic path/lifecycle coverage but were not exercised in a complete browser campaign. Fighter/recon pursuit missiles retain the existing immediate damage resolver; a fully queued pursuit-missile flight would require a separate combat timing change. Hardware frame-rate performance, Safari/Firefox, physical mobile GPUs, energy management, lift, turn radius and authoritative 3D dogfight movement were not measured or implemented in this pass. If native in-app browser QA is desired for future passes, install/enable the Browser plugin.

## Next mechanics recommendation

The next substantial flight improvement should be authoritative, bounded turning rather than larger cosmetic offsets: add role-specific heading/turn-rate state, integrate movement at the fixed simulation tick, and charge actual curved distance to the mission allowance. Prototype it first in head-on, tail-aspect, pursuit-interruption and recovery fixtures. Then design spatial dogfight maneuvers whose recorded positions also drive sensors, defense targeting and debrief history. Keep energy/altitude tuning a later step until those systems agree. This is follow-up design work, not an implemented feature.
