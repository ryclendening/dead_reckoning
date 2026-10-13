# Dead Reckoning: Current Gameplay State

Last verified against the implementation and tests: 2026-10-12

This is the source of truth for behavior implemented in the current build. It records the net gameplay state, not the sequence of designs that led to it. Use git history for superseded mechanics and earlier implementation notes.

## Core Loop

1. **Deploy** — A new campaign starts with a fixed force of two fighters (VIPER 1 and FALCON 2) and one recon formation (RAVEN 3), with no formation-selection step. The main airfield and radar are required; exactly two of the decoy, SAM, and AAA are still selected. Every selected asset is placed inside friendly territory before the package is confirmed. Unselected assets are removed from that campaign.
2. **Plan** — Flat aircraft pips hover above their home airfields, marked with callsign and role. Select a fighter task to open route building directly. Selecting another formation saves a valid route automatically. Closing a valid route also saves it. **Commit Round** appears after at least one order is ready and starts execution. Confirmed pips show a green check. Only confirmed formations fly that round.
3. **Execute / Observe** — The deterministic simulation advances at 20 Hz and can be viewed at 1× or 2×. The only live player command is an irreversible recon `ORDER RTB`, applied on the next simulation tick. RTB sends recon to the home base if it has enough remaining range, otherwise to its planned recovery field. There is no skip-to-debrief control.
4. **Debrief** — Review friendly losses, confirmed enemy losses, and one page for each newly recovered fixed-asset report.
5. **Adapt / Conclude** — Review the campaign outcome after Debrief. If the campaign continues, spend Logistics on repairs, replacement aircraft, one main-airfield upgrade, or new assets, then begin the next round.

## Campaign Objective

- The campaign is a six-round reconnaissance-and-strike operation. Recover enemy base coordinates, assign fighters to Base Strike, and destroy the enemy base while preserving the home base.
- Base Strike unlocks only for confirmed, recovered base intelligence. Provisional recon observations do not authorize a strike in the same sortie.
- Each strike formation carries one air-to-ground missile payload per sortie. It must physically reach 6 map units of the target while following its mission; it cannot launch while fighting, returning, or destroyed. Full-strength payload damage is 60, scaled by strength at launch. Damage persists between rounds.
- Strikes are deterministic hits once launched. Damage occurs at impact, 0.6 simulated seconds after launch; an already-launched missile survives destruction of its launcher. Multiple impacts cannot reduce target health below zero.
- Strike fighters do not voluntarily intercept air contacts. Direct fighter combat still interrupts them, so fighter allocation and route choice affect whether they reach launch range.
- Enemy recon observes the real base and decoy through its executed movement within 3.8 map units. Only successful recovery preserves those observations. A recovered base observation adds 40 targeting pressure; observing a live decoy on that sortie subtracts 20 from the base-observation gain. Pressure is bounded from 0 to 100.
- At 60 targeting pressure at the start of a round, the enemy fighter can execute a physical base strike. Intelligence recovered this round cannot authorize an attack retroactively in the same round.
- Enemy base destruction wins; home base destruction loses, including mutual destruction. If neither base is destroyed by the end of round six, the deadline is a defeat. Losing all formations with no reserve aircraft also ends the campaign.
- Debrief precedes the end screen and explains base damage and targeting-pressure changes. Debug tactical fixtures do not use campaign strikes, pressure progression, or the round deadline.
- These values are initial tuning parameters, not a completed balance pass.

The nominal sortie window is 22 simulated seconds. Execution continues while recovery is unresolved, normally to a 60-second cap. A stranded friendly formation may extend the round to at most 82 seconds while it exhausts its remaining range.

## Forces

### Friendly formation pool

The initial data contains four formations, each with four aircraft and 100 maximum strength:

- `VIPER 1` — fighter.
- `FALCON 2` — fighter.
- `RAVEN 3` — reconnaissance.
- `GHOST 4` — reconnaissance.

A new normal campaign uses VIPER 1, FALCON 2, and RAVEN 3. GHOST 4 is available only in debug scenarios or older valid saved campaigns. Older saved deployment drafts retain their selected roster rather than being silently replaced. Debug scenarios can bypass setup and use a different active subset.

Only two roles are playable:

- **Fighter** — flies Protect, Forward Patrol, Transit, or Base Strike. Protect uses Defensive CAP internally and defends a chosen friendly site, map point, or confirmed friendly flight. Forward Patrol hunts along its patrol pattern. These missions change contact priority and fighter-combat odds as well as interception geometry. Transit flies the assigned route to a friendly recovery field without voluntary interceptions; direct fighter contact still triggers combat. Strike is a dedicated ground-attack mission.
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
- SAM engagement: `3.2`.
- AAA engagement: `1.9`.
- Fighter visual detection at full strength: `4.2`.
- Recon visual detection at full strength: `4.9`.
- Recon fixed-asset observation: `3.8`.

Aircraft visual range is multiplied by `0.68 + 0.32 × strength fraction`; destroyed formations produce no contacts.

## Planning, Routes, Fuel, and Basing

- Route planning uses up to five map taps as ingress waypoints; aircraft fly straight between the waypoints before the selected role-aware pattern is appended. Tap a numbered waypoint to select it, then tap the map to move it without changing the remaining waypoints. Tap elsewhere to add a waypoint; dragging pans the map. Generated routes use the launch field, tapped ingress, knowledge-derived planning envelope, role range, and recovery requirement; they do not inspect hidden assets or unknown world edges.
- Fighters choose **Protect**, **Forward Patrol**, or an intelligence-gated **Base Strike**. **Transit** is available for airfield staging. Recon is locked to **Search Area**. Protect asks for one friendly site, confirmed friendly flight, or map point; selecting a flight creates a moving escort order. Selecting Base Strike generates a direct approach to missile range with recovery fuel reserved; edited strike routes must still reach weapon range and pass recovery validation.
- Protect appends a 4.5-unit-radius orbit around its selected station. Forward Patrol appends a compact patrol loop. Search Area appends a five-pass sweep. An escort fighter follows its selected friendly flight's live position instead of flying its generated orbit while that flight remains on mission.
- If a full pattern does not fit known bounds and fuel, the pattern shrinks to 25% scale before the ingress is shortened. The orders surface reports any adjustment.
- Fighter maximum mission distance is `40`; recon maximum mission distance is `48`. Each role moves at a fixed speed derived from that allowance over the nominal 22-second sortie window. Tapping a longer route does not increase speed.
- A route that does not end at another friendly airfield reserves the direct return distance to its launch field. Execution appends the intended recovery field to the route when needed. Formations without a confirmed order stay grounded and preserve aircraft, readiness, and ammunition for the next round.
- The first operational FOB whose 0.6-unit landing area is crossed becomes the intended recovery field and truncates later waypoints. A route ending within 0.6 units of any friendly airfield also becomes a landing order. During route planning, tapping an airfield ends the ingress there as a direct recovery route instead of selecting that airfield's based aircraft; it also assigns Transit to fighters. Airfield selection remains available from the planning roster or when route planning is closed.
- Plan opens route building as soon as a fighter task is selected, then shows one remaining-range readout. Selecting the already-selected aircraft while the shelf is idle also opens its task or route. Selecting another formation or closing a valid route auto-confirms the current order; an invalid route stays selected with its error. Selecting a formation with a saved order reopens its existing route without clearing its confirmed status or recovery choice. Formation selection is the way to move through the planning queue; there is no **Next Aircraft** button. **Commit Round** appears once an order is ready and starts execution. The underlying ingress, pattern, and recovery calculation remains the canonical distance used by execution. The main base has unlimited capacity; a baseline FOB holds two formations, so recon and a fighter can share it. Confirmed recovery orders reserve a slot, and an occupant keeps its slot until its departure is confirmed. Existing one-slot FOB saves normalize to two slots.
- Every formation with a confirmed order must have a valid route and recovery field before Commit. Other surviving formations may remain grounded. Destroyed and trapped formations cannot be ordered.
- If the intended field becomes unusable during execution, the formation diverts to the nearest reachable operational field with capacity, with asset ID as the stable distance tie-breaker.
- With no reachable alternate, a formation enters a visible holding circle and is destroyed only when its normal mission-distance allowance is exhausted.
- A successful landing changes the formation's operating field. A formation at a FOB can use **RECOVER HOME** during Plan, or tap the home airfield, to route back and free its FOB slot after recovery. A formation based at an unusable FOB is trapped and cannot launch until the FOB is repaired.
- Friendly territory is the union of the starting 4.5-unit home region and a 3-unit influence circle around each operational, undamaged friendly FOB. Disabled or destroyed FOBs provide no territory influence until repaired. During routing, the first crossed operational FOB landing area receives a visible transit/latch cue and remains the authoritative recovery destination.
- Dogfighting pauses movement and route-distance accumulation. Interception and pursuit distance count against the same mission allowance.

## Mission Responsibility and Reactions

Mission selection is the fighter tasking and combat-posture control. Base Strike targets the confirmed enemy base. There is no separate aggression, responsibility-width, pursuit-leash, or air-target-priority order.

### Fighters

- **Protect** owns an inclusive 4.5-unit circle centered on a selected friendly site or map point, or on the current authoritative position of a selected friendly flight. When protecting the home base, it prioritizes visually identified hostile recon inside responsibility; when escorting a friendly flight, it prioritizes visually identified hostile fighters inside responsibility. These priorities use current contact role, not hidden enemy destination. Otherwise it chooses a valid contact closest to the defended center. It breaks pursuit when a target moves more than 0.35 units beyond the circle and resumes its assigned task; a dogfight already underway finishes. When the fighter itself fights inside this area, hostile fighter shots against it lose 12 percentage points of hit chance.
- A friendly-flight Protect order requires that flight to have a confirmed order first. Planning estimates the percentage of the protected flight's planned route within the fighter's moving cover circle using existing fixed speeds and recovery range. Orders with less than 30% predicted coverage or infeasible recovery are rejected. The selected fighter follows the protected flight's live position while it remains on mission and recovers when that flight lands, is destroyed, or begins recovery. Combat diversions can change actual coverage from the estimate.
- **Forward Patrol** owns an inclusive 2.5-unit corridor around its generated patrol pattern, excluding ingress and recovery legs. It prioritizes visually identified hostile fighters over other contacts, then chooses the nearest valid contact. It breaks pursuit when its target leaves the corridor. Its fighter shots gain 10 percentage points of hit chance, but hostile fighter shots against it gain 6 points. Radar-only tracks do not disclose aircraft role for this priority.
- Responsibility is active from launch; reaching the patrol station is not required.
- A voluntary intercept requires a current visual contact or a friendly-radar receipt, a current target position inside responsibility, and enough remaining range to reach the target and recover.
- After mission-specific priority, the nearest valid contact wins; exact-distance ties use target ID.
- Once selected, a target remains valid only while the contact stays current, recovery remains feasible, and it stays inside the mission's pursuit limit. Protect has the 0.35-unit buffer above, including during fighter-versus-recon pursuit; Forward Patrol uses its corridor edge. Lost or destroyed contacts are cleared; fighters never fly toward stale last-known positions.
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
- The opening attacker fires one missile: 58% base hit chance, modified by position by +18, +10, 0, or -12 percentage points and by any active fighter mission posture, then clamped to 10–90%. A hit deals 32 strength damage. A lethal hit ends the engagement before merge.
- Merged attacks alternate by side every 0.35 simulated seconds. Attackers rotate within their side; the weakest opponent is targeted first, with join time and identity as tie-breakers.
- A merged gun attack has a 69% base chance and deals 22 strength on a hit. Numerical modifiers are +10, +5, 0, -5, or -10 percentage points at force-ratio tiers of at least 1.75×, at least 1.25×, above 0.8×, above 0.57×, or otherwise. The same mission-posture modifiers apply to merged shots. Final chance is clamped to 10–90%, and each modifier is recorded with the exchange.
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
- Destroyed or inoperative defense sites cannot fire. Damage resolves at the queued impact time; misses report zero applied damage.

## Reconnaissance, Sensors, and Fog of War

- The deterministic world is `28 × 36` map units. The player starts in one of four seeded central regions. A six-unit generic terrain apron hides the true boundary from the initial camera and terrain presentation.
- Planning and camera limits derive from recovered knowledge plus an exploration margin, not from hidden world bounds.
- Friendly territory is initially known. Most other terrain is obscured by a continuous, feathered haze, while generic terrain remains faintly visible.
- During execution, living friendly formations reveal terrain around their rendered positions; recon's live terrain reveal is larger than a fighter's. Recon mapping is accumulated from its executed route, not revealed at Commit.
- A recon that reaches a true world edge turns home and provisionally records the nearby exact segment. The segment becomes persistent only after recovery.
- The Known World view contains only friendly territory, persistent mapped areas, known fixed assets, and recovered boundary segments. It receives neither hidden bounds nor live aircraft positions.
- Ground-radar-only contacts appear as amber uncertainty markers. Visual contact reveals callsign, role, aircraft pips, action, and strength.
- A visual identification remains identity knowledge for the rest of that sortie. It does not preserve a live position after all current detection is lost.
- An operational friendly ground radar distributes every track inside its 6.4-unit detection range to all friendly fighters. Fighter mission responsibility and recovery feasibility still determine whether a radar track can trigger an intercept. Recon ignores radar-only contacts, and hostile radar never creates a friendly track.
- Losing visual contact returns a still-radar-detected aircraft to an uncertainty marker. Losing every current detection removes its tactical representation and exact position.
- Live hostile contact projection uses absolute simulated time: current radar/visual contact controls whether a hostile track may be shown, while any earlier visual contact preserves identity knowledge for the rest of the sortie without preserving an exact position through a detection gap.
- Enemy fixed assets within 3.8 units of a recon's executed path are collected provisionally. The current UI promotes them to persistent confirmed intelligence only after recovery; re-observing an already-known asset does not create another report.

## Presentation and Phase Surfaces

- Deploy, Plan, Execute, Debrief, and Adapt use the same angled orthographic 3D battlefield camera and world-space pan/zoom limits. Planning overlays and aircraft paths stay in one spatial presentation across phase changes; their range values are Euclidean map-unit distances, not screen-space distances.
- Plan opens fighter route building as soon as the player chooses Protect, Forward Patrol, Transit, or an intelligence-gated Base Strike. Recon starts at route building for its fixed Search Area task; it has no selectable posture or search-pattern settings, but retains waypoint routing, recovery selection, and an in-flight **Order RTB** command. Up to five numbered ingress waypoints can be added or moved by tapping the map; dragging pans the map. Only the selected route's ingress is drawn during this step, with waypoint count and one remaining-range readout in the shelf. Selecting another formation saves the current valid order and opens that formation's task or route. Closing a valid route also saves it. **Commit Round** appears after at least one valid order is ready; no bottom **Build Route** or **Next Aircraft** action is shown while editing. Protect defaults to defending the final route waypoint; moving that waypoint changes the defended point. Its route screen has explicit **Defend Site or Point** and **Escort a Flight** actions; the escort action lists eligible flights with confirmed orders, and the checked airfield pip also works during map target selection. If no eligible flight exists, the control explains that another flight must be confirmed first. The route step previews the selected formation's responsibility area or strike release zone and recovery intent. Static Protect uses one area outline; its 0.35-unit pursuit buffer remains a rule but is not drawn separately. A moving escort previews the protected flight route and reports predicted covered and uncovered percentages, including in the collapsed shelf after confirmation; its circle follows the flight's live position during Execute. Patrol previews its corridor. Plan hides aircraft LOS, ground radar and weapon range rings, confirmed formations' route overlays, the range legend, and the stem below airfield formation pips. Friendly territory stays visible across phases with a bold solid home boundary and separately labeled dashed FOB influence boundaries. Callsign-and-role pips retain green checks for confirmed orders.
- Execute hides general radar and aircraft LOS coverage. It shows the followed formation's route and responsibility, current sensor-authorized enemy air contacts, relevant active weapon coverage, weapon effects, a compact event navigator only after an event occurs, an airfield sortie rail, and a selected-formation status shelf. Objectives default to a one-line disclosure in Plan and Execute; detailed campaign guidance and base health open on demand.
- Friendly formation glyphs distinguish intercept, combat, recon pursuit, and recovery with one status disc. The selected formation is identified in the status shelf and route rather than an extra marker ring.
- Execute keeps assigned fighter mission separate from live activity in the selected formation details. The followed Protect fighter's circle tracks its selected friendly flight's authoritative position. Short events report pursuit breakoff and escort completion once, distinguishing a protected flight's recovery from its destruction.
- During Execute, aircraft position and facing interpolate from authoritative `UnitTrack` snapshots on one shared scene clock capped at the latest snapshot. Strength, aircraft count, action, selected-formation details, camera follow, live terrain reveal, and active coverage remain on the current authoritative snapshot. Hostile interpolation requires a current contact and starts no earlier than that contact window; no exact hostile position is rendered before detection. Original mission routes do not reconstruct live aircraft positions.
- Dogfight replay shows a compact cue and recent shot damage and chance above the live participants, with missile and gun streaks following their recorded shot paths. Stable local orbit geometry rotates between simulation snapshots; weapon transforms and cue opacity use frame-rate interpolation capped at authoritative time. A minimal current-only active dogfight summary provides a cue before the completed sequence is recorded and disappears when that sequence takes over. Visually identified hostile aircraft use one raised callsign-and-aircraft health card. These cues do not displace aircraft tactical anchors or alter contact authorization. The followed fighter's route and responsibility are hidden while it is dogfighting. Forward Patrol's responsibility preview lightly marks the actual 2.5-unit corridor; static Protect shows one area outline.
- Friendly fighters use the F-16 model; visually identified enemy fighters use the MiG-23 model. Recon uses a top-down role rendering. A formation renders one aircraft per current pip.
- Debrief is a single bottom summary for losses, recovered intelligence, Logistics, campaign status, and each ordered formation's purpose and result. A strike that never launched shows a concrete failure reason; home-base Protect reports home damage or exposure, and an escort reports whether its protected flight recovered or was lost. Formation/intel detail remains optional. Adapt keeps the battlefield visible and uses contextual targets plus a separate Build catalog.

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
- Build a decoy for `4`, AAA for `6`, SAM for `8`, or two-slot FOB for `8` Logistics.

Construction must be inside the current friendly territory union or persistent recovered mapping and at least 1.5 units from every friendly asset. Operational FOBs extend that territory by a 3-unit influence circle; disabled or destroyed FOBs do not. Validation intentionally ignores hidden enemy positions and unrecovered world bounds. New SAM and AAA sites immediately participate in air defense. Decoys can reduce enemy targeting progress when observed alongside the real base; enemy attacks do not dynamically target decoys.

At round resolution, every ordered, non-trapped friendly formation loses readiness and ammunition (fighter: 12 readiness and 28 ammo; recon: 7 readiness and 8 ammo, with readiness floored at 25). Unordered formations remain grounded and retain both values. The values are displayed state but have no current authoritative effect and cannot be serviced through Adapt.

Campaign score is displayed and accumulates from selected combat/intelligence events, but it has no victory or spending effect. Base health and base exposure drive the campaign objective and enemy pressure. Command points and reinforcement helpers remain outside the current player-facing loop.

## Persistence and Debug Scenarios

- Local storage key: `dead-reckoning-mvp-v27`. Listed older save keys are cleared by Reboot rather than migrated.
- A compatible save made during Execute restarts at Plan because an in-progress simulation is not serialized.
- Save normalization accepts a structurally valid campaign roster, including the fixed three formations in new campaigns and older valid selected rosters. Round, intelligence, base damage, targeting pressure, economy, and campaign conclusion persist through reload. Invalid saves fall back to a fresh deployment draft.
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

## Inactive or Incomplete Systems

- There are no dedicated strike aircraft, bombers, or UAVs. Existing fighters perform the base-only strike mission; strikes against other fixed assets are not implemented.
- Defense-cue fields do not change in the current resolver.
- Enemy recon targeting pressure is a compact campaign model, not a general enemy intelligence database or dynamic targeting AI.
- Friendly assets other than the main base cannot be attacked in ordinary campaign play; FOB disablement is exercised only by deterministic fixtures.
- Reinforcement, legacy service, rearm, readiness-restoration, runway-repair, and separate defense-repair helpers exist in code or tests but are not connected to the current UI flow. The Adapt actions listed above are authoritative.
- Multiplayer start-placement utilities exist, but multiplayer is not enabled.
- The README contains older and aspirational mechanics. This document takes precedence for current gameplay.

## Running Change Log

This log keeps only current net changes. Superseded intermediate states belong in git history.

### 2026-10-12

- Removed the route-step **Next Aircraft** and **Build Route** buttons and the segmented four-part route-budget display. Selecting a fighter task opens its route, and selecting another formation saves the current valid order. Reselecting a planned formation reopens its saved route without clearing its planned status; clicking the already-selected aircraft while idle opens its planning controls. The shelf retains a single remaining-range readout and waypoint count; **Commit Round** remains available after at least one order is ready.
- Simplified Plan to a task-first fighter flow. Fighters choose one task, then build a route with a segmented range gauge for ingress, mission pattern, return, and range remaining; recon starts with its fixed route directly. Protect route planning now offers explicit site/point and confirmed-flight escort controls, including a visible list of eligible flights. Valid routes auto-confirm when switching aircraft; **Commit Round** saves the final active route and starts execution directly. Protect uses the route endpoint by default, with an optional site or escort-flight target action. Planning shows only the selected ingress during route editing, reveals the selected task area during route building, and removes routine LOS, radar, weapon, background-route, and legend overlays. Static Protect now has one visible area boundary; the pursuit buffer remains simulated but is no longer a second drawn circle. Removed the airfield pip stem, routine Execute aircraft LOS ring, nested status-glyph rings, and the aircraft ground halo.
- Clarified territory on the battlefield map with a high-contrast solid home boundary labeled **HOME TERRITORY** and distinct dashed, labeled FOB influence boundaries. Territory outlines remain visible during Plan; discovered and undiscovered fog shading is unchanged. The Known World map also outlines home and FOB regions separately in its key.
- Added Protect selection for a friendly site, map point, or confirmed friendly flight. An escort follows the flight's live position and shows predicted full or partial coverage, covered/uncovered percentages, and minimum useful-overlap and recovery checks. Narrowed Forward Patrol responsibility to the station pattern and ended its unlimited pursuit outside the visible corridor. Protect now prefers visually identified recon when guarding home and visually identified fighters when escorting a flight, without reading hidden enemy intent. Planning marks one static Protect boundary, the protected flight's planned route coverage, and the Base Strike release zone; execution shows moving cover and one-time pursuit-break/escort-end events. Debrief adds concise per-order results, protected-flight and home-base outcomes, and strike failure reasons. Fighter mission choice remains the only posture control.
- Fixed the new-campaign opening force to VIPER 1, FALCON 2, and RAVEN 3 and removed formation choice from Deploy. Existing saved deployment selections remain intact; support-asset selection and placement are unchanged.
- Replaced continuous route drawing with tap-to-place ingress waypoints, capped at five. Aircraft follow straight segments between waypoints before the mission pattern; waypoint markers can be selected and repositioned independently, and map dragging remains available for panning. The planning shelf shows the waypoint count and editing instructions.
- Changed dogfight orbit rendering to use stable local line geometry with per-frame group rotation, avoiding time-dependent point reconstruction on each 20 Hz React update.
- Added a current-only active dogfight summary for live execution. It contains the current participants, sides, location, start, and merge time, has no exchanges or outcome data, is gated by current hostile visibility, and disappears when the completed sequence replaces it.
- Smoothed friendly and currently detected hostile aircraft motion, weapon transforms, and dogfight cue opacity between 20 Hz snapshots. The shared scene clock never advances beyond authoritative track data; hostile interpolation is clamped to the active contact window. Status, selection, camera, fog, coverage, and combat remain snapshot-authoritative.
- Raised the dogfight cue above contact cards with a dark backdrop and render priority; raised and shortened the hostile health card to reduce label crowding while preserving the callsign, aircraft count, and action.

### 2026-10-10

- Added fighter Transit orders for airfield staging. Transit routes have no patrol pattern or voluntary radar/visual intercept; direct fighter combat remains active. Airfield taps and **RECOVER HOME** select Transit for fighters. Collapsed routine campaign objectives and range legend, removed empty execution statuses and duplicate formation strength, reduced the live event panel by default, and replaced the paginated Debrief deck with one summary and optional detail.
- Increased FOB capacity to two, including existing saved FOBs; made planning clicks on airfields set a recovery route; added a direct **RECOVER HOME** order for FOB-based formations; and made recon RTB favor home when remaining range allows it.
- Connected recovered base intelligence to fighter strike planning, physical missile launch and impact, persistent base damage, and campaign victory/defeat.
- Added recovered enemy recon targeting pressure, a decoy reduction, next-round enemy strike eligibility, and a six-round campaign deadline with causal briefing/debrief/end-state text.
- Corrected defense firing eligibility and impact timing, preserved selected campaign rosters across reload, and guarded round settlement against duplicate application.

### 2026-09-20

- Removed the separate communication-range mechanic. An operational friendly radar now distributes detected tracks to all friendly fighters; mission responsibility and recovery feasibility remain the intercept gates. Removed the communications ring, radar-link glyph, receipt timeline, and duplicate result schema.
- Added the live route budget readout for ingress, generated pattern, recovery reserve, and remaining range. The planner now reports map-limit clamping explicitly and shows the first crossed operational FOB as a transit/latch candidate before commitment; the budget reuses recovery validation's canonical mission distance.
- Restored the shared angled 3D battlefield camera across Deploy and Plan so planning geometry matches the live execution view. Route and coverage measurements remain world-space Euclidean distances; the camera is presentation-only and does not change aircraft travel distance.
- Added one shared friendly-territory union model: the starting home region plus 3-unit influence circles for operational FOBs. Placement validation, fog coverage, known-world bounds, camera framing, and battlefield overlays now reflect FOB expansion and remove disabled/destroyed FOB influence.
- Verified the document against the live engine, route, basing, economy, setup, fog, UI, and deterministic tests. Removed superseded historical entries and corrected campaign force selection, live fighter damage, pursuit resolution, ground-defense resolution, inactive systems, and the current persistence defect.
- Added the shared real-time aircraft reaction lifecycle: direct fighter combat interrupts recon pursuit; survivors are reassessed from current state without restoring hidden target intent; independent engagements can overlap without duplicate formation ownership; and accepted recon RTB commands remain authoritative during pursuit.
- Removed the execution skip. Rounds now reach Debrief only through normal fixed-tick completion; 1× and 2× remain available.
- Unified live execution presentation around a visibility-safe `UnitTrack` projection. Friendly and detected-hostile markers, status, camera follow, fog reveal, coverage, contact counts, and sortie identity memory now share absolute simulated time; UI-only dogfight choreography no longer overrides tactical world positions.

### 2026-10-11

- Gave Protect (then labeled Defensive CAP) a hard pursuit limit 0.35 units beyond its defended circle. Fighters break off intercepts and recon pursuits at that edge and resume their assigned task, while already merged fighter dogfights finish. Planning copy describes the leash.
- Made fighter mission choice affect air combat: CAP prioritizes threats near its defended center and reduces incoming fighter hit chance by 12 points while fighting inside it; Forward Patrol hunts identified fighters first and gains 10 offensive points at the cost of 6 incoming points. Shot records and replay now expose the resulting chance, and planning cards and map labels state each posture's effect. Reduced the corridor fill so the route and tactical choice remain legible.
- Simplified air-to-air attack rendering: removed detached dogfight orbit rings and stacked context labels, positioned the engagement cue over live fighters, aligned missile and gun streaks with shot travel, limited hit flashes to actual impacts, and suppressed route/sensor overlays and a duplicate enemy label during combat. Replaced distorted Forward Patrol corridor edge offsets with one continuous filled coverage preview matching the intercept area's 2.5-unit width.
- Added selectable callsign-and-role pips above each friendly airfield for direct per-formation planning. Confirmed orders show a green check; unplanned formations remain grounded without spending readiness or ammunition, and Commit requires at least one valid order rather than the whole force. Planning routes and coverage overlays appear only for confirmed formations or the formation currently being edited. The pips use flat screen-facing controls rather than ground models.
- Fixed the blank planning screen when selecting a formation with a cleared one-point route. Flight and responsibility previews now wait for a drawable route; the formation puck and route controls remain usable so a new route can be drawn.
