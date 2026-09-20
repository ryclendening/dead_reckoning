# Dead Reckoning: Current Gameplay State

Last verified against the implementation and tests: 2026-09-20

This is the source of truth for behavior implemented in the current build. It records the net gameplay state, not the sequence of designs that led to it. Use git history for superseded mechanics and earlier implementation notes.

## Core Loop

1. **Deploy** — A new campaign selects exactly three formations from the four available, including at least one fighter and one recon formation. The main airfield and radar are required; exactly two of the decoy, SAM, and AAA are also selected. Every selected asset is placed inside friendly territory before the package is confirmed. Unselected formations and assets are removed from that campaign.
2. **Plan** — Select an airfield and explicitly confirm a valid mission route and recovery field for every surviving, launchable formation. Commit unlocks only when the entire package has been reviewed.
3. **Execute / Observe** — The deterministic simulation advances at 20 Hz and can be viewed at 1× or 2×. The only live player command is an irreversible recon `ORDER RTB`, applied on the next simulation tick. There is no skip-to-debrief control.
4. **Debrief** — Review friendly losses, confirmed enemy losses, and one page for each newly recovered fixed-asset report.
5. **Adapt** — Spend Logistics on repairs, replacement aircraft, one main-airfield upgrade, or new assets, then begin the next round.

The nominal sortie window is 22 simulated seconds. Execution continues while recovery is unresolved, normally to a 60-second cap. A stranded friendly formation may extend the round to at most 82 seconds while it exhausts its remaining range.

## Forces

### Friendly formation pool

The setup pool contains four formations, each with four aircraft and 100 maximum strength:

- `VIPER 1` — fighter.
- `FALCON 2` — fighter.
- `RAVEN 3` — reconnaissance.
- `GHOST 4` — reconnaissance.

A normal campaign keeps the three formations chosen during Deploy. Debug scenarios can bypass setup and use a different active subset.

Only two roles are playable:

- **Fighter** — flies Defensive CAP or Forward Patrol and may intercept current contacts inside its committed responsibility area.
- **Recon** — flies the fixed Search Area mission, maps terrain, observes enemy fixed assets, and must recover to preserve provisional collection.

### Enemy flights

An ordinary round generates two deterministic enemy formations:

- `BOGEY 1` — four-aircraft MiG-23 fighter formation.
- `SPECTER` — two-aircraft recon formation.

Enemy air formations are generated for the current round; their attrition is reported but does not persist as a campaign force inventory. Debug scenarios may disable or replace these flights.

### Fixed assets

Asset kinds are main base, FOB, decoy, radar, SAM, and AAA. Enemy fixed assets start unknown and hidden. Friendly selected assets start known. Constructed friendly assets persist between rounds.

Current ranges, in map units:

- Ground-radar detection: `6.4`.
- Radar track distribution: `11` from the friendly radar to the receiving formation.
- SAM engagement: `3.2`.
- AAA engagement: `1.9`.
- Fighter visual detection at full strength: `4.2`.
- Recon visual detection at full strength: `4.9`.
- Recon fixed-asset observation: `3.8`.

Aircraft visual range is multiplied by `0.68 + 0.32 × strength fraction`; destroyed formations produce no contacts.

## Planning, Routes, Fuel, and Basing

- Route drawing creates a player ingress and then appends the selected role-aware pattern. Generated routes use the launch field, drawn ingress, knowledge-derived planning envelope, role range, and recovery requirement; they do not inspect hidden assets or unknown world edges.
- Fighters choose **Defensive CAP** or **Forward Patrol**. Recon is locked to **Search Area**.
- Defensive CAP appends a 4.5-unit-radius orbit around the final ingress point. Forward Patrol appends a compact patrol loop. Search Area appends a five-pass sweep.
- If a full pattern does not fit known bounds and fuel, the pattern shrinks to 25% scale before the ingress is shortened. The orders surface reports any adjustment.
- Fighter maximum mission distance is `40`; recon maximum mission distance is `48`. Each role moves at a fixed speed derived from that allowance over the nominal 22-second sortie window. Drawing a longer route does not increase speed.
- A route that does not end at another friendly airfield reserves the direct return distance to its launch field. Execution appends the intended recovery field to the route when needed.
- The first operational FOB whose 0.6-unit landing area is crossed becomes the intended recovery field and truncates later waypoints. A route ending within 0.6 units of any friendly airfield also becomes a landing order.
- Plan shows the intended field and nearest reachable operational alternate. The main base has unlimited capacity; a baseline FOB has one formation slot. Confirmed recovery orders reserve that slot, and an occupant keeps its slot until its departure is confirmed.
- Every launchable formation must have a valid route and confirmed recovery field before Commit. Destroyed and trapped formations are excluded from the planning queue.
- If the intended field becomes unusable during execution, the formation diverts to the nearest reachable operational field with capacity, with asset ID as the stable distance tie-breaker.
- With no reachable alternate, a formation enters a visible holding circle and is destroyed only when its normal mission-distance allowance is exhausted.
- A successful landing changes the formation's operating field. A formation based at an unusable FOB is trapped and cannot launch until the FOB is repaired.
- Friendly territory is the union of the starting 4.5-unit home region and a 3-unit influence circle around each operational, undamaged friendly FOB. Disabled or destroyed FOBs provide no territory influence until repaired.
- Dogfighting pauses movement and route-distance accumulation. Interception and pursuit distance count against the same mission allowance.

## Mission Responsibility and Reactions

Mission selection is the only fighter tasking control. There is no separate aggression, posture, target-priority, or selected-target order.

### Fighters

- **Defensive CAP** owns an inclusive 4.5-unit circle centered on the final player ingress point.
- **Forward Patrol** owns an inclusive 2.5-unit corridor around the complete committed route, including segment ends and joints.
- Responsibility is active from launch; reaching the patrol station is not required.
- A voluntary intercept requires a current visual contact or a friendly-radar receipt, a current target position inside responsibility, and enough remaining range to reach the target and recover.
- The nearest valid contact wins; exact-distance ties use target ID. Aircraft role is not prioritized.
- Once selected, a target remains valid outside the responsibility boundary while the contact stays current and recovery remains feasible. Lost or destroyed contacts are cleared; fighters never fly toward stale last-known positions.
- Opposing fighters that come within the 1.2-unit direct-combat range are forced into combat regardless of voluntary-intercept responsibility.
- Fighter-versus-recon contact creates a one-sided pursuit rather than a dogfight orbit.

### Recon

- Recon has no air-interception responsibility and ignores radar-only contacts.
- Visual contact with a hostile fighter and any SAM or AAA launch create a threat alert but do not automatically change the recon route.
- Without player input, recon continues its mission through a threat. `ORDER RTB` remains authoritative once accepted, including during an existing pursuit.
- A recovered recon commits its executed mapping, boundary observations, and newly observed fixed assets. Destroyed, stranded, or otherwise unrecovered recon loses all provisional collection.

### Shared reaction priority

Airborne formations are reassessed from current state in this order:

1. Destroyed.
2. Direct fighter combat.
3. Commanded or required recovery.
4. Fuel-valid, mission-authorized intercept.
5. Assigned mission.

Direct fighter combat interrupts a fighter's recon pursuit. When combat or pursuit ends, survivors are evaluated again from current contacts, fuel, command state, and mission responsibility; no historical target order is restored. The engine can run independent engagements concurrently, but a formation can belong to only one engagement at a time.

## Air Combat

### Fighter versus fighter

- Combat begins when opposing fighters close to `1.2` map units. Eligible late arrivals join only after their normal sensor, responsibility, fuel, intercept, and merge checks succeed.
- The engagement records friendly and hostile participants, join and exit times, initial and final strength and aircraft counts, disposition, phases, positional assessments, exchanges, probability inputs, and seeded rolls.
- Immediately before merge, approach vectors produce Dominant, Favorable, Neutral, or Disadvantaged positional assessments. The higher score takes opening initiative; an exact tie uses a seeded choice.
- The opening attacker fires one missile: 58% base hit chance, modified by position by +18, +10, 0, or -12 percentage points, then clamped to 10–90%. A hit deals 32 strength damage. A lethal hit ends the engagement before merge.
- Merged attacks alternate by side every 0.35 simulated seconds. Attackers rotate within their side; the weakest opponent is targeted first, with join time and identity as tie-breakers.
- A merged gun attack has a 69% base chance and deals 22 strength on a hit. Numerical modifiers are +10, +5, 0, -5, or -10 percentage points at force-ratio tiers of at least 1.75×, at least 1.25×, above 0.8×, above 0.57×, or otherwise. Final chance is clamped to 10–90%.
- Formation-condition probability slots exist in the record schema but are not active. Morale changes are recorded but do not cause disengagement.
- There is no guaranteed-kill exchange. Combat continues until one side has no surviving formation.
- Fighter aircraft pips do not decrement during the dogfight; a destroyed participant loses all pips, and surviving formations reconcile pips to remaining strength after leaving combat.

### Fighter versus recon

- A pursuit begins within `1.2` map units. The fighter follows the recon while the recon continues its mission or commanded recovery.
- While still in close range, the fighter attacks every 0.5 seconds for at most four exchanges, alternating missile and gun.
- Each pursuit attack has a 68% hit chance. Because damage is rounded from seeded continuous values, missile hits deal 26–38 strength and gun hits deal 12–19.
- The pursuit ends when the recon is destroyed, four exchanges resolve, the recon opens beyond the attacker's effective sensor range, or the fighter is interrupted. The fighter is then reassessed from current state.

## Ground-Based Air Defense

- Each SAM or AAA site can engage each opposing formation once per round when it first enters range.
- The live SAM shot has a 64% hit chance and deals 38 strength.
- The live AAA shot has a 52% hit chance and deals 13 strength. Its renderer presents the single resolution as a tracer burst.
- Friendly and enemy sites use the same ownership rule: friendly defenses target hostile aircraft and enemy defenses target friendly aircraft.
- Launches and projectiles are visible during execution. A launch does not itself create persistent intelligence for an unknown enemy site.
- Current limitation: the live engagement loop does not gate firing on the site's health, even though damaged/destroyed presentation and defense repair state exist.

## Reconnaissance, Sensors, and Fog of War

- The deterministic world is `28 × 36` map units. The player starts in one of four seeded central regions. A six-unit generic terrain apron hides the true boundary from the initial camera and terrain presentation.
- Planning and camera limits derive from recovered knowledge plus an exploration margin, not from hidden world bounds.
- Friendly territory is initially known. Most other terrain is obscured by a continuous, feathered haze, while generic terrain remains faintly visible.
- During execution, living friendly formations reveal terrain around their rendered positions; recon's live terrain reveal is larger than a fighter's. Recon mapping is accumulated from its executed route, not revealed at Commit.
- A recon that reaches a true world edge turns home and provisionally records the nearby exact segment. The segment becomes persistent only after recovery.
- The Known World view contains only friendly territory, persistent mapped areas, known fixed assets, and recovered boundary segments. It receives neither hidden bounds nor live aircraft positions.
- Ground-radar-only contacts appear as amber uncertainty markers. Visual contact reveals callsign, role, aircraft pips, action, and strength.
- A visual identification remains identity knowledge for the rest of that sortie. It does not preserve a live position after all current detection is lost.
- Only the friendly ground radar creates radar receipts, and only when the target is inside its 6.4-unit detection range and the receiving friendly formation is within the 11-unit communication range. There is no aircraft relay or global track network. Hostile radar never creates a friendly receipt.
- Losing visual contact returns a still-radar-detected aircraft to an uncertainty marker. Losing every current detection removes its tactical representation and exact position.
- Live hostile contact projection uses absolute simulated time: current radar/visual contact controls whether a hostile track may be shown, while any earlier visual contact preserves identity knowledge for the rest of the sortie without preserving an exact position through a detection gap.
- Enemy fixed assets within 3.8 units of a recon's executed path are collected provisionally. The current UI promotes them to persistent confirmed intelligence only after recovery; re-observing an already-known asset does not create another report.

## Presentation and Phase Surfaces

- Deploy and Plan use a true top-down orthographic command-map camera fitted to the known friendly territory. Their pan and zoom preserve equal scale in every map direction; Execute retains the angled battlefield camera and formation-follow presentation.
- Plan shows the selected aircraft's LOS, fighter responsibility areas, friendly radar detection and communications, weapon ranges, generated routes, recovery intent, and per-airfield formation queues.
- Execute hides general radar coverage. It shows the followed formation's route and responsibility, current sensor-authorized enemy air contacts, relevant active weapon coverage, weapon effects, a compact event navigator, an airfield sortie rail, and a selected-formation status shelf.
- Friendly formation glyphs distinguish intercept, combat, recon pursuit, recovery, selection, and friendly-radar receipt. The radar receipt fades for 0.8 simulated seconds after it ends.
- During Execute, aircraft markers, strength and aircraft state, selected-formation details, camera follow, live terrain reveal, and active coverage all sample the same authoritative `UnitTrack` at the current simulated time. Original mission routes do not reconstruct live aircraft positions.
- Dogfight ornamentation remains centered on the recorded engagement, but it does not displace aircraft tactical anchors from their authoritative tracks.
- Friendly fighters use the F-16 model; visually identified enemy fighters use the MiG-23 model. Recon uses a top-down role rendering. A formation renders one aircraft per current pip.
- Debrief is a bottom click-through deck. Adapt keeps the battlefield visible and uses contextual targets plus a separate Build catalog.

## Economy and Between-Round State

A new match starts with 10 Logistics and three reserve aircraft. A completed round credits Logistics exactly once:

- `+6` base income.
- `+2` per newly recovered fixed-asset report.
- `+1` per confirmed enemy aircraft lost.
- A Supply Depot adds `+2` to base income beginning with later completed rounds.

Current Adapt actions:

- Repair formation strength by up to 25 for `2` Logistics, capped by the current aircraft count (`25` strength capacity per aircraft).
- Replace one aircraft for `4` Logistics plus one reserve aircraft, restoring 25 strength. A formation rebuilt from zero is based at the main airfield.
- Repair friendly radar, SAM, or AAA by up to 25 health for `2` Logistics.
- Restore an unusable FOB to full health and operational status for `4` Logistics.
- Buy exactly one main-airfield upgrade for `12` Logistics: **Maintenance Wing** reduces formation repair and replacement costs by one, or **Supply Depot** adds the recurring income above.
- Build a decoy for `4`, AAA for `6`, SAM for `8`, or one-slot FOB for `8` Logistics.

Construction must be inside the current friendly territory union or persistent recovered mapping and at least 1.5 units from every friendly asset. Operational FOBs extend that territory by a 3-unit influence circle; disabled or destroyed FOBs do not. Validation intentionally ignores hidden enemy positions and unrecovered world bounds. New SAM and AAA sites immediately participate in air defense. Decoys persist visually, but enemy strike and dynamic decoy-targeting gameplay are inactive.

At round resolution, every non-trapped friendly formation loses readiness and ammunition (fighter: 12 readiness and 28 ammo; recon: 7 readiness and 8 ammo, with readiness floored at 25). This currently includes formations that did not launch or were destroyed. The values are displayed state but have no current authoritative effect and cannot be serviced through Adapt.

Campaign score is displayed and accumulates from selected combat/intelligence events, but it has no victory or spending effect. Command points, reinforcement helpers, base health, and base exposure remain in state without a current player-facing loop.

## Persistence and Debug Scenarios

- Local storage key: `dead-reckoning-mvp-v27`. Listed older save keys are cleared by Reboot rather than migrated.
- A compatible save made during Execute restarts at Plan because an in-progress simulation is not serialized.
- Known persistence defect: campaign setup keeps three formations, but save normalization currently requires the original four-formation roster. Reloading a normal campaign after setup therefore resets it to a fresh deployment draft. This is implemented behavior, not intended design.
- Selecting a deterministic debug scenario immediately resets into that fixture. Reboot rebuilds the selected fixture or starts a fresh campaign draft.

Available fixtures:

- Campaign.
- Fighter vs Fighter.
- Fighter 2 vs 1.
- Fighter Tail Aspect.
- Fighter Head-On.
- Fighter Reversed.
- Fighter vs Recon.
- Neutral LOS.
- Radar Intercept.
- Pursuit Interruption.
- Parallel Engagements.
- Recon Pursuit Control.
- Recon Recovery.
- Recon Edge.
- Recon Loss.
- FOB Recovery.
- FOB Diversion.
- FOB Stranded.
- FOB Trapped.

## Implemented State Without a Complete Gameplay Loop

- There are no player-controlled strike aircraft, bombers, UAVs, strike missions, or attacks against fixed ground targets.
- Base damage resolves to zero, so the ordinary engine cannot reach the defined victory or defeat phases.
- Base exposure and defense-cue fields do not change in the current resolver.
- Enemy recon flies and can be engaged but does not collect or recover intelligence.
- Friendly fixed assets cannot be attacked in ordinary campaign play; FOB disablement is exercised only by deterministic fixtures.
- Reinforcement, legacy service, rearm, readiness-restoration, runway-repair, and separate defense-repair helpers exist in code or tests but are not connected to the current UI flow. The Adapt actions listed above are authoritative.
- Multiplayer start-placement utilities exist, but multiplayer is not enabled.
- The README contains older and aspirational mechanics. This document takes precedence for current gameplay.

## Running Change Log

This log keeps only current net changes. Superseded intermediate states belong in git history.

### 2026-09-20

- Changed Deploy and Plan to a true top-down command-map camera so placement geometry, route direction, and range circles use an undistorted equal-scale presentation. Execute keeps its angled follow camera.
- Added one shared friendly-territory union model: the starting home region plus 3-unit influence circles for operational FOBs. Placement validation, fog coverage, known-world bounds, camera framing, and battlefield overlays now reflect FOB expansion and remove disabled/destroyed FOB influence.
- Verified the document against the live engine, route, basing, economy, setup, fog, UI, and deterministic tests. Removed superseded historical entries and corrected campaign force selection, live fighter damage, pursuit resolution, ground-defense resolution, inactive systems, and the current persistence defect.
- Added the shared real-time aircraft reaction lifecycle: direct fighter combat interrupts recon pursuit; survivors are reassessed from current state without restoring hidden target intent; independent engagements can overlap without duplicate formation ownership; and accepted recon RTB commands remain authoritative during pursuit.
- Removed the execution skip. Rounds now reach Debrief only through normal fixed-tick completion; 1× and 2× remain available.
- Unified live execution presentation around a visibility-safe `UnitTrack` projection. Friendly and detected-hostile markers, status, camera follow, fog reveal, coverage, contact counts, and sortie identity memory now share absolute simulated time; UI-only dogfight choreography no longer overrides tactical world positions.
