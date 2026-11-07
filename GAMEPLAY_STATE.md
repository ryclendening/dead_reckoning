# Dead Reckoning: Current Gameplay State

Last verified against the implementation and tests: 2026-11-07

This is the source of truth for behavior implemented in the current build. It records the net gameplay state, not the sequence of designs that led to it. Use git history for superseded mechanics and earlier implementation notes.

## Core Loop

1. **Deploy** — A new campaign starts with a fixed force of two fighters (VIPER 1 and FALCON 2), one recon formation (RAVEN 3), and four assets: main airfield, radar, SAM, and AAA. There is no force or asset selection step. Select each asset card and place it on a highlighted valid hex inside friendly territory; only legal hexes are outlined. Confirm the package after all four are placed. Decoys can be built later during Adapt.
2. **Plan** — Flat aircraft pips hover above their home airfields, marked with callsign and role. Select a fighter task to open route building; Ground Strike first requires selecting a confirmed enemy site. Selecting another formation saves a valid route automatically. Closing a valid route also saves it. **Commit Round** appears after at least one order is ready and starts execution. Confirmed pips show a green check. Only confirmed formations fly that round.
3. **Execute / Observe** — The deterministic simulation advances at 20 Hz and can be viewed at 1× or 2×. The only live player command is an irreversible recon `ORDER RTB`, applied on the next simulation tick. RTB sends recon to the home base if it has enough remaining range, otherwise to its planned recovery field. There is no skip-to-debrief control.
4. **Debrief** — Review friendly losses, confirmed enemy losses, and one page for each newly recovered fixed-asset report.
5. **Adapt / Conclude** — Review the campaign outcome after Debrief. If the campaign continues, spend Logistics on repairs, replacement aircraft, one main-airfield upgrade, or new assets, then begin the next round.

## Campaign Objective

- The campaign is a six-round reconnaissance-and-strike operation. Recover enemy base coordinates, assign fighters to Ground Strike, and destroy the enemy base while preserving the home base.
- Ground Strike requires explicit selection of a live, confirmed enemy fixed asset using recovered intelligence. Targets include the base, SAM, AAA, radar, FOB, and decoy sites. Select the target from the planning list or map; provisional observations cannot authorize a strike in the same sortie.
- Each strike formation carries one air-to-ground missile payload per sortie. It must physically reach its fixed strike point, generated within 6 map units of the selected target, while following its mission; it cannot launch while fighting, returning, or destroyed. Full-strength payload damage is 60, scaled by strength at launch. Damage persists between rounds.
- Strikes are deterministic hits once launched. Damage occurs at impact, 0.6 simulated seconds after launch; an already-launched missile survives destruction of its launcher. Multiple impacts cannot reduce target health below zero.
- Strike fighters do not voluntarily intercept air contacts. Direct fighter combat still interrupts them, so fighter allocation and route choice affect whether they reach launch range.
- Enemy recon observes the real base and decoy through its executed movement within 3.8 map units. Only successful recovery preserves those observations. A recovered base observation adds 40 targeting pressure; observing a live decoy on that sortie subtracts 20 from the base-observation gain. Pressure is bounded from 0 to 100.
- At 60 targeting pressure at the start of a round, the enemy fighter can execute a physical base strike. Intelligence recovered this round cannot authorize an attack retroactively in the same round.
- Enemy base destruction wins; home base destruction loses, including mutual destruction. If neither base is destroyed by the end of round six, the deadline is a defeat. Losing all formations with no reserve aircraft also ends the campaign.
- Debrief precedes the end screen and explains base damage and targeting-pressure changes. Debug tactical fixtures do not use enemy campaign pressure progression or the round deadline; explicit friendly Ground Strike orders use the same targeting rules.
- These values are initial tuning parameters, not a completed balance pass.

The nominal sortie window is 22 simulated seconds. Execution continues while recovery is unresolved, normally to a 60-second cap. A stranded friendly formation may extend the round to at most 82 seconds while it exhausts its remaining range.

## Forces

### Friendly formation pool

The initial data contains four formations, each with four aircraft and 100 maximum strength:

- `VIPER 1` — fighter.
- `FALCON 2` — fighter.
- `RAVEN 3` — reconnaissance.
- `GHOST 4` — reconnaissance.

A new normal campaign uses VIPER 1, FALCON 2, and RAVEN 3. GHOST 4 is available only in debug scenarios or older valid saved campaigns. Older deployment drafts with a valid three-formation mix retain their selected roster; incomplete or one-role drafts normalize to the fixed opening force so the player can continue setup. Legacy deployment drafts migrate to the fixed airfield, radar, SAM, and AAA package, retaining valid placements and continuing placement for missing assets. Debug scenarios can bypass setup and use a different active subset.

Only two roles are playable:

- **Fighter** — flies Protect, Forward Patrol, Transit, or Ground Strike. Protect uses Defensive CAP internally and defends a chosen friendly site, map point, or confirmed friendly flight. Forward Patrol hunts along its patrol pattern. These missions change contact priority and fighter-combat odds as well as interception geometry. Transit flies the assigned route to a friendly recovery field without voluntary interceptions; direct fighter contact still triggers combat. Strike is a dedicated ground-attack mission.
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

- Route planning uses up to five map taps as ingress waypoints; aircraft fly straight between the waypoints before the selected role-aware pattern is appended. Tap a numbered waypoint to select it, then tap the map to move it without changing the remaining waypoints. Tap elsewhere to add a waypoint; dragging pans the map. Every aircraft can pan and place waypoints across the generic map apron, beyond currently known mapping. Fighter and recon routes remain limited by their role-specific range; the actual world edge is reached during execution, where aircraft turn home and recon records newly observed boundaries.
- Fighters choose **Protect**, **Forward Patrol**, or an intelligence-gated **Ground Strike**. **Transit** is available for airfield staging. Recon is locked to **Search Area**. Protect asks for one friendly site, confirmed friendly flight, or map point; selecting a flight creates a moving escort order. Ground Strike opens **Choose Ground Target** first. Selecting a confirmed enemy site generates fixed takeoff and strike points, with direct recovery to the launch field reserved. Up to five intermediate waypoints can be added or moved; **Clear Waypoints** restores the direct ingress and **Change Target** reopens selection. Both anchors remain fixed and fuel/recovery validation applies. A crossed friendly FOB does not truncate a strike ingress or replace its recovery field.
- Protect appends a 4.5-unit-radius orbit around its selected station. Forward Patrol appends a compact patrol loop. Search Area appends a five-pass sweep. An escort fighter follows its selected friendly flight's live position instead of flying its generated orbit while that flight remains on mission.
- If a full pattern does not fit the visible map bounds and fuel, the pattern shrinks to 25% scale before the ingress is shortened. The orders surface reports any adjustment.
- Fighter maximum mission distance is `40`; recon maximum mission distance is `48`. Each role moves at a fixed speed derived from that allowance over the nominal 22-second sortie window. Tapping a longer route does not increase speed.
- A route that does not end at another friendly airfield reserves the direct return distance to its launch field. Execution appends the intended recovery field to the route when needed. Formations without a confirmed order stay grounded and preserve aircraft, readiness, and ammunition for the next round.
- For non-strike routes, the first operational FOB whose 0.6-unit landing area is crossed becomes the intended recovery field and truncates later waypoints. A route ending within 0.6 units of any friendly airfield also becomes a landing order. During route planning, tapping an airfield ends the ingress there as a direct recovery route instead of selecting that airfield's based aircraft; it also assigns Transit to fighters. Airfield selection remains available from the planning roster or when route planning is closed.
- Plan opens route building after a fighter task is selected (and a ground target is chosen for Ground Strike), then shows one remaining-range readout. Protect can be completed by tapping a friendly site or map point once; the planner generates and confirms its CAP route, then closes the route shelf. Selecting a confirmed friendly flight as an escort also generates and confirms the order, then closes the shelf; the protected flight's planned route and predicted coverage remain visible. Selecting the already-selected aircraft while the shelf is idle also opens its task or route. Selecting another formation or closing a valid route auto-confirms the current order; an invalid route stays selected with its error. Selecting a formation with a saved order reopens its existing route without clearing its confirmed status or recovery choice. Formation selection is the way to move through the planning queue; there is no **Next Aircraft** button. **Commit Round** appears once an order is ready and starts execution. The underlying ingress, pattern, and recovery calculation remains the canonical distance used by execution. The main base has unlimited capacity; a baseline FOB holds two formations, so recon and a fighter can share it. Confirmed recovery orders reserve a slot, and an occupant keeps its slot until its departure is confirmed. Existing one-slot FOB saves normalize to two slots.
- Every formation with a confirmed order must have a valid route and recovery field before Commit. Other surviving formations may remain grounded. Destroyed and trapped formations cannot be ordered.
- If the intended field becomes unusable during execution, the formation diverts to the nearest reachable operational field with capacity, with asset ID as the stable distance tie-breaker.
- With no reachable alternate, a formation enters a visible holding circle and is destroyed only when its normal mission-distance allowance is exhausted.
- A successful landing changes the formation's operating field. A formation at a FOB can use **RECOVER HOME** during Plan, or tap the home airfield, to route back and free its FOB slot after recovery. A formation based at an unusable FOB is trapped and cannot launch until the FOB is repaired.
- Friendly territory is the union of the starting 4.5-unit home region and a 3-unit influence circle around each operational, undamaged friendly FOB. Disabled or destroyed FOBs provide no territory influence until repaired. During routing, the first crossed operational FOB landing area receives a visible transit/latch cue and remains the authoritative recovery destination.
- Dogfighting pauses movement and route-distance accumulation. Interception and pursuit distance count against the same mission allowance.

## Mission Responsibility and Reactions

Mission selection is the fighter tasking and combat-posture control. Ground Strike targets the explicitly selected confirmed enemy ground site and never automatically retargets another site. There is no separate aggression, responsibility-width, pursuit-leash, or air-target-priority order.

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
- The compact formation shelf explains automatic recovery with its recorded cause, such as **ROUTE COMPLETE**, **FUEL RESERVE**, **WORLD EDGE**, or **AIRFIELD DIVERSION**; an accepted RTB command shows **PLAYER RTB ORDER**. Contact alone does not trigger recovery. A completed hostile four-shot volley is reported as **PURSUIT VOLLEY COMPLETE**, rather than claiming the recon turned away or escaped by maneuvering.
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
- Fighter aircraft pips do not decrement during the dogfight; a destroyed participant loses all pips, and surviving formations reconcile pips to remaining strength on the same tick they leave combat. The current dogfight summary counts only living participants; the completed record retains everyone who joined.

### Fighter versus recon

- A pursuit begins within `1.2` map units. The fighter follows the recon while the recon continues its mission or commanded recovery.
- While still in close range, the fighter fires every 0.5 seconds for at most four shots per pursuit, alternating missile and gun. Shot order is based on launches, including missiles still in flight.
- Each pursuit attack has a 68% hit chance, rolled once at launch. Because damage is rounded from seeded continuous values, missile hits roll 26–38 strength damage and gun hits deal 12–19; applied missile damage is capped at remaining target strength.
- Pursuit missiles launch on the current tick and resolve damage on the first fixed tick at or after their 0.62-second flight (currently 0.65 seconds after launch). Guns resolve immediately. An already-launched missile survives pursuit interruption, pursuit completion, and shooter loss. A target that has recovered or been destroyed before impact takes no further damage and produces no missile hit flash. Resolved missile exchanges remain attached to their originating pursuit, even when impact follows that pursuit's end.
- The pursuit ends when the recon is destroyed, four shots have launched, the recon opens beyond the attacker's effective sensor range, or the fighter is interrupted. The fighter is then reassessed from current state; pending missiles resolve independently.

## Ground-Based Air Defense

- Each operational SAM starts every round with **three missiles** and a **three simulated-second cooldown** shared across all targets. It selects the nearest airborne opposing formation in 3.2-unit range (formation IDs break exact ties), can repeatedly fire on the same formation, and spends a missile on every launch including misses. Once empty it cannot fire until the next round. Adapt and Plan show the automatically replenished 3/3 rack with no remaining cooldown; Debrief retains the historical count labeled **MISSILES AT ROUND END**. Health damage persists and still requires repair. A radar track is not required.
- AAA retains one shot per opposing formation per round when it enters range.
- The live SAM shot has a 64% hit chance and deals 38 strength.
- The live AAA shot has a 52% hit chance and deals 13 strength. Its renderer presents the single resolution as a tracer burst.
- Friendly and enemy sites use the same ownership rule: friendly defenses target hostile aircraft and enemy defenses target friendly aircraft.
- Launches and projectiles are visible during execution. A launch does not itself create persistent intelligence for an unknown enemy site.
- Destroyed or inoperative defense sites cannot fire. Damage resolves at the queued impact time; misses report zero applied damage. Already launched missiles survive destruction of their site.
- All friendly and known enemy fixed sites use one compact card with name/type, health over maximum, and operational status. SAMs add remaining missiles and readiness to that card and retain three launcher tubes; fired tubes shorten and darken as ammunition is spent. Clicking a site or its card opens the shared expanded unit inspector; SAM details include current-round missiles and cooldown. Selecting a SAM as a strike target also opens the inspector. Site health and smoke update at resolved ground-strike impact, with no future-impact health shown. Unknown sites remain unselectable until observed.

## Reconnaissance, Sensors, and Fog of War

- The deterministic world is `28 × 36` map units. The player starts in one of four seeded central regions. A six-unit generic terrain apron hides the true boundary from the initial camera and terrain presentation.
- Planning and camera limits derive from recovered knowledge plus an exploration margin, not from hidden world bounds.
- Friendly territory is initially known. Most other terrain is obscured by a continuous, feathered haze, while generic terrain remains faintly visible.
- During execution, living friendly formations reveal terrain around their rendered positions; recon's live terrain reveal is larger than a fighter's. Recon mapping is accumulated from its executed route, not revealed at Commit.
- A recon that reaches a true world edge turns home and provisionally records the nearby exact segment. The segment becomes persistent only after recovery.
- The Known World view contains only friendly territory, persistent mapped areas, known fixed assets, and recovered boundary segments. It receives neither hidden bounds nor live aircraft positions.
- Ground-radar-only contacts appear as amber uncertainty markers with stable, sortie-local IDs such as **TRACK 01 · UNKNOWN AIRCRAFT**. IDs are allocated from acquired contacts only and count formations, not individual aircraft; multiple sensors observing one formation do not create duplicate tracks. Visual contact identifies callsign and role and labels the current fighter type **MiG-23**; the generic recon has no named airframe and is labeled **RECON AIRCRAFT**. Visual models and health cards expose current aircraft counts and strength.
- A visual identification remains identity knowledge for the rest of that sortie. It does not preserve a live position after all current detection is lost.
- An operational friendly ground radar independently detects and publishes tracks inside its 6.4-unit detection range during execution, including while all friendly aircraft are grounded, recovered, or lost. Radar receipts are also distributed to airborne friendly formations; fighter mission responsibility and recovery feasibility still determine whether a track can trigger an intercept. Recon ignores radar-only contacts, and hostile, destroyed, or disabled radar never creates a friendly track. Aircraft sensor receipts close when the observer lands or is lost.
- Losing visual contact returns a still-radar-detected aircraft to an uncertainty marker with the same track ID and previously identified type. Losing every current detection removes its live tactical marker and exact current position. The expandable contact list retains a clearly labeled last-seen report and can focus that last-known position; it never follows hidden movement. Reacquisition retains the same ID for the sortie.
- The contact list reports separate visual/radar counts, type knowledge, current inbound/outbound/crossing course relative to home derived from detected motion, and aircraft count only during current visual contact. Recovery status does not replace the contact counts.
- Live hostile contact projection uses absolute simulated time: current radar/visual contact controls whether a hostile track may be shown, while any earlier visual contact preserves identity knowledge for the rest of the sortie without preserving an exact position through a detection gap.
- Enemy fixed assets within 3.8 units of a recon's executed path are collected provisionally. The current UI promotes them to persistent confirmed intelligence only after recovery; re-observing an already-known asset does not create another report.

## Presentation and Phase Surfaces

- Deploy, Plan, Execute, Debrief, and Adapt use the same angled orthographic 3D battlefield camera and world-space pan/zoom limits. Planning overlays and aircraft paths stay in one spatial presentation across phase changes; their range values are Euclidean map-unit distances, not screen-space distances.
- Plan opens fighter route building after choosing Protect, Forward Patrol, or Transit. Ground Strike first asks for an explicit confirmed enemy ground target, then opens optional ingress editing between labeled fixed takeoff/strike anchors. Recon starts at route building for its fixed Search Area task; it has no selectable posture or search-pattern settings, but retains waypoint routing, recovery selection, and an in-flight **Order RTB** command. Up to five numbered ingress waypoints can be added or moved by tapping the map; dragging pans the map. Only the selected route's ingress is drawn during this step, with waypoint count and one remaining-range readout in the shelf. Selecting another formation saves the current valid order and opens that formation's task or route. Closing a valid route also saves it. **Commit Round** appears after at least one valid order is ready; no bottom **Build Route** or **Next Aircraft** action is shown while editing. Protect defaults to defending the final route waypoint; moving that waypoint changes the defended point. Its route screen has explicit **Defend Site or Point** and **Escort a Flight** actions; the escort action lists eligible flights with confirmed orders, and the checked airfield pip also works during map target selection. If no eligible flight exists, the control explains that another flight must be confirmed first. The route step previews the selected formation's responsibility area or strike release zone and recovery intent. Static Protect uses one area outline; its 0.35-unit pursuit buffer remains a rule but is not drawn separately. A moving escort previews the protected flight route and reports predicted covered and uncovered percentages, including in the collapsed shelf after confirmation; its circle follows the flight's live position during Execute. Patrol previews its corridor. Plan hides routine aircraft LOS, ground radar and weapon range rings (a selected SAM shows its engagement ring), confirmed formations' route overlays, the range legend, and the stem below airfield formation pips. Friendly territory stays visible across phases with a bold solid home boundary and separately labeled dashed FOB influence boundaries. Callsign-and-role pips retain green checks for confirmed orders.
- Execute hides general radar and aircraft LOS coverage. It shows the followed formation's route and responsibility, current sensor-authorized enemy air contacts, relevant active weapon coverage, weapon effects, a compact event navigator only after an event occurs, an airfield sortie rail, and a selected-formation status shelf. Objectives default to a one-line disclosure in Plan and Execute; detailed campaign guidance and base health open on demand.
- Friendly formation glyphs distinguish intercept, combat, recon pursuit, and recovery with one status disc. A selected unit card has a tinted border and opens the common inspector; the existing formation status shelf and route remain available.
- Execute keeps assigned fighter mission separate from live activity in the selected formation details. The followed Protect fighter's circle tracks its selected friendly flight's authoritative position. Short events report pursuit breakoff and escort completion once, distinguishing a protected flight's recovery from its destruction.
- During Execute, aircraft position and facing interpolate from authoritative `UnitTrack` snapshots on one shared scene clock capped at the latest snapshot. Facing remains a valid direction through exact waypoint arrivals, zero-distance movement, holding, and recovery; interpolation retains the incoming heading when an older recorded arrival has zero-length facing. Strength, aircraft count, action, selected-formation details, camera follow, live terrain reveal, and active coverage remain on the current authoritative snapshot. Hostile interpolation requires a current contact and starts no earlier than that contact window; no exact hostile position is rendered before detection. Original mission routes do not reconstruct live aircraft positions.
- Debrief history draws friendly paths from recorded `UnitTrack` frames and hostile paths from those same tracks clipped to legitimate contact intervals. Hidden gaps remain blank, and radar versus visual portions retain distinct styling; original hostile mission routes are not used to construct history.
- Dogfight replay shows a compact cue and recent shot damage and chance above the live participants. Resolved merged gun exchanges publish one stable-ID hitscan effect at the authoritative shot time; its short tracer and hit-flash envelope follows after that time, and completed sequences retain the same effect without reconstructing duplicates. Aircraft heading interpolates by shortest angular direction from both world-axis components. During dogfights, each individual aircraft receives a small deterministic local maneuver and bounded bank/pitch that blends in before engagement and fades out over 0.55 seconds after the recorded exit while the formation's tactical track anchor, route distance, sensors, and combat state remain authoritative. Dogfight orbit rings are removed. Weapon bodies follow their trajectory tangent and update on the shared scene clock with reusable trail buffers; SAM launches rise from ground level, air-to-ground missiles descend from flight altitude, and misses pass beside the target without a hit flash. Moving-aircraft SAM/AAA and air-to-air missile guidance uses only current authorized tracks, clamps at authoritative time, and freezes at the impact-time position once available. Hit flashes begin only at the recorded effect end, ground launches have a separate brief plume, and expired effects are culled. A minimal current-only active dogfight summary provides a cue before the completed sequence is recorded and disappears when that sequence takes over. Friendly and currently visually identified hostile aircraft use the same raised card as ground assets, with callsign, role/type, current aircraft count, health over maximum, and activity. Selecting a card opens matching details. Radar-only contacts retain their uncertainty marker and identity rules, with no health or aircraft-count card; an expanded hostile card closes when visual contact ends. The shared health bar flashes and trails resolved damage; separate floating hit/damage/aircraft-loss labels are removed while smoke and weapon impact effects remain. These cues do not displace aircraft tactical anchors or alter contact authorization. The followed fighter's route and responsibility are hidden while it is dogfighting. Forward Patrol's responsibility preview lightly marks the actual 2.5-unit corridor; static Protect shows one area outline.
- Friendly fighters use the F-16 model; visually identified enemy fighters use the MiG-23 model. Recon uses a top-down role rendering. A formation renders one aircraft per current pip.
- Debrief is a single bottom summary for losses, recovered intelligence, Logistics, campaign status, and each ordered formation's purpose and result. A strike that never launched shows a concrete failure reason; home-base Protect reports home damage or exposure, and an escort reports whether its protected flight recovered or was lost. Formation/intel detail remains optional. Adapt keeps the battlefield visible and uses contextual targets plus a separate Build catalog. When no battlefield target is selected, the purchase list appears only in Build; the main Adapt panel does not duplicate construction options.

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

Construction must be inside the current friendly territory union or persistent recovered mapping and at least 1.5 units from every friendly asset. FOB placement uses the intersection of that known area and a 7-unit reach from the edge of current friendly territory. Once built, an operational FOB extends owned territory by its 3-unit influence circle; disabled or destroyed FOBs provide no influence until repaired. Validation intentionally ignores hidden enemy positions and unrecovered world bounds. New SAM and AAA sites immediately participate in air defense. Decoys can reduce enemy targeting progress when observed alongside the real base; enemy attacks do not dynamically target decoys.

During initial deployment and Adapt construction, the map outlines only legal hexes for the selected asset, using the same validation rules that govern placement. The grid appears only while an asset is being placed. In Adapt, choose an eligible asset from Build and tap a valid hex to complete its purchase immediately; invalid taps do not spend Logistics. The placement card shows the asset and cost, with a single tap-to-build instruction; there is no separate site confirmation step.

At round resolution, every ordered, non-trapped friendly formation loses readiness and ammunition (fighter: 12 readiness and 28 ammo; recon: 7 readiness and 8 ammo, with readiness floored at 25). Unordered formations remain grounded and retain both values. The values are displayed state but have no current authoritative effect and cannot be serviced through Adapt.

Campaign score is displayed and accumulates from selected combat/intelligence events, but it has no victory or spending effect. Base health and base exposure drive the campaign objective and enemy pressure. Command points and reinforcement helpers remain outside the current player-facing loop.

## Persistence and Debug Scenarios

- Ground Strike retains the internal `base-strike` mission ID for saved-game compatibility and adds `strikeTargetId`. Legacy strike orders without an explicit target remain loadable but must be retasked before launch. SAM ammunition derives from current-round launch history and resets without persisting a depleted rack into the next round.
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

- Flight remains a fixed-speed planar tactical model with no lift, energy, altitude, or turn-radius simulation. Rendered banking and combat-local aircraft maneuvers are cosmetic; tactical translation and route-distance accumulation still pause during dogfights.
- There are no dedicated strike aircraft, bombers, or UAVs. Existing fighters perform the Ground Strike mission against explicitly selected confirmed fixed assets.
- Defense-cue fields do not change in the current resolver.
- Enemy recon targeting pressure is a compact campaign model, not a general enemy intelligence database or dynamic targeting AI.
- Friendly assets other than the main base cannot be attacked in ordinary campaign play; FOB disablement is exercised only by deterministic fixtures.
- Reinforcement, legacy service, rearm, readiness-restoration, runway-repair, and separate defense-repair helpers exist in code or tests but are not connected to the current UI flow. The Adapt actions listed above are authoritative.
- Multiplayer start-placement utilities exist, but multiplayer is not enabled.
- The README contains older and aspirational mechanics. This document takes precedence for current gameplay.

## Running Change Log

This log keeps only current net changes. Superseded intermediate states belong in git history.

### 2026-11-07

- Unified damage presentation across all friendly/known ground sites and friendly/visually detected aircraft with one compact unit card and shared expanded inspector. Cards show name/type, current health over maximum, and status; aircraft retain current counts/activity and SAMs retain ammunition/cooldown. Removed percentage-only ground labels, duplicate ground identity labels, and floating hit/loss callouts. Kept smoke, damage banking, and weapon impact effects. Radar-only and lost hostile aircraft never expose health/count cards; selected hostile details require current visual contact. Damage animation consumes authoritative frame/impact health and does not change combat rules.

- Unified placement hex guidance across initial deployment and Adapt construction. Both placement flows now display only candidate hexes accepted by their existing validators, and hide the grid outside active placement, including legacy deployment drafts.

- During Adapt construction, show outlined placement hexes only where the active asset's existing placement validator allows a build. The grid appears only while placing and uses a distinct cyan cue; asset validity and purchase behavior are unchanged.

- Simplified Adapt by removing the unclear **Force Turnaround** title and duplicate construction list from the default campaign drawer. FOB, decoy, AAA, and SAM purchases remain available in the separate Build catalog, with placement completed on a valid map tap.

- Fixed SAM between-round presentation: Adapt and Plan now show replenished ammunition and cleared cooldown in both the inspector and launcher rack. Debrief explicitly labels historical round-end ammunition. Adapt inspection uses current asset health so repairs are no longer masked by the previous round result. The simulation already reset ammunition each round; firing rules are unchanged.

- Redesigned SAMs with health bars, three visible launcher tubes, clickable health/ammunition/cooldown inspection, three missiles per round, and a site-wide three-second launch cooldown. SAMs can repeatedly attack the same formation until ammunition is exhausted; nearest eligible target and stable identity determine each launch. Destroyed sites stop launching while missiles already in flight still resolve.
- Replaced base-only strike planning with Ground Strike → explicit confirmed-site selection → optional ingress edits between fixed takeoff/release anchors. Ground strikes can damage SAMs, radar, AAA, FOBs, decoys, and the campaign base; only base hits count toward base damage. Strike routes reserve recovery to their launch field and bypass incidental FOB landing latches. Strike fighters explicitly ignore voluntary air intercepts while direct fighter combat still interrupts them. Updated target-specific debrief and impact-time ground health presentation, and added deterministic engine, planning, persistence, and rendered-markup regressions.

- Simplified new-campaign Deploy to the fixed main-airfield, radar, SAM, and AAA package. Valid deployment hexes alone are highlighted; spacing checks consider assets already placed. Legacy drafts migrate to this package while retaining valid placed positions. Adapt construction now completes on a valid site tap after choosing an asset, removing the extra confirmation; the attention shortcut appears only when there are items needing attention.
- Decoupled ground-radar detection from airborne friendly observers, preserved fighter radar receipts, and closed stale aircraft contacts when their observer lands or is lost. Added unique per-formation track IDs, radar-only unknown labels, visual aircraft identification, persistent sortie identity, and last-seen contact reports without hidden live tracking. Corrected mixed visual/radar counts and exposed recon recovery reasons. Confirmed with deterministic path comparisons that first fighter contact does not divert friendly RAVEN; corrected four-shot pursuit completion copy that previously implied an escape maneuver.
- Fixed four confirmed flight/combat defects: preserved valid heading through waypoint arrival and stationary movement, removed destroyed participants from live dogfight counts while retaining history, reconciled aircraft counts on the combat-exit tick, and deferred pursuit missile damage to the same tick as visual impact. Pursuit missiles now use the pending-impact queue, survive shooter loss or interruption, and cancel damage/hit flashes against already recovered or destroyed targets. Moving air-to-air missile presentation uses the existing authorized-track guidance. This deliberately changes pursuit timing and can change outcomes; hit chances and damage rolls remain seeded.
- Added deterministic regressions for those defects, including pending missiles after recovery, prior target destruction, shooter loss, and direct-combat interruption. Takeoff/landing states, bounded turns, and moving tactical dogfights remain unimplemented.

### 2026-11-02

- Aligned pursuit gun effects with their actual resolved shot tick, so the short live burst is visible in full rather than mostly elapsing before the effect is published. This changes presentation timing only; pursuit damage and outcomes are unchanged.
- Made Protect area selection a one-tap order: selecting a friendly site or map point generates the fighter's CAP route, validates recovery, confirms the order, and closes the route shelf. Selecting an eligible escort flight now confirms and closes in the same way; its planned path and predicted coverage remain visible on the planning map.
- Fixed stale deployment drafts with incomplete or one-role formation selections by normalizing them to the current fixed opening force. Valid saved three-formation mixes remain intact, and regression coverage confirms the setup validator permits placement to continue.
- Changed Debrief battlefield history to derive friendly traces directly from recorded `UnitTrack` frames and hostile traces from those tracks only during legitimate contact intervals. Hidden gaps remain unconnected, radar and visual contact retain separate styling, and original enemy routes no longer affect debrief history. Added deterministic projection coverage for pursuit interruption, concurrent engagements, contact transitions, and recon RTB during pursuit.
- Improved flight and weapon presentation without changing tactical simulation: fixed hostile facing to use both world axes and shortest-angle interpolation, added bounded deterministic combat-local aircraft movement while preserving track anchors, and removed detached dogfight rings. Merged gun shots now publish exactly once with stable IDs while combat is active. Weapon trails use reusable geometry and shared-clock transforms; ground and air launch profiles rise and descend respectively, misses fly past without hit flashes, launch plumes are separate from exact-time impacts, and expired effects are culled. Seeded rolls, damage, fuel, route, sensing, and combat timing are unchanged.

### 2026-10-12

- Removed the knowledge-envelope route clamp for all aircraft. During Plan, every aircraft can pan and place waypoints across the generic map apron; fighter and recon fuel limits remain 40 and 48 map units, and the true world edge is encountered during execution.
- Expanded FOB placement reach to 7 map units from the edge of current friendly territory. The allowed area is the overlap of that reach and known terrain (friendly territory or persistent recovered mapping); while placing a FOB, a temporary dashed outline shows the maximum reach. A completed FOB still adds its existing 3-unit influence circle.
- Removed the route-step **Next Aircraft** and **Build Route** buttons and the segmented four-part route-budget display. Selecting a fighter task opens its route, and selecting another formation saves the current valid order. Reselecting a planned formation reopens its saved route without clearing its planned status; clicking the already-selected aircraft while idle opens its planning controls. The shelf retains a single remaining-range readout and waypoint count; **Commit Round** remains available after at least one order is ready.
- Simplified Plan to a task-first fighter flow. Fighters choose one task, then build a route with a segmented range gauge for ingress, mission pattern, return, and range remaining; recon starts with its fixed route directly. Protect route planning now offers explicit site/point and confirmed-flight escort controls, including a visible list of eligible flights. Valid routes auto-confirm when switching aircraft; **Commit Round** saves the final active route and starts execution directly. Protect uses the route endpoint by default, with an optional site or escort-flight target action. Planning shows only the selected ingress during route editing, reveals the selected task area during route building, and removes routine LOS, radar, weapon, background-route, and legend overlays. Static Protect now has one visible area boundary; the pursuit buffer remains simulated but is no longer a second drawn circle. Removed the airfield pip stem, routine Execute aircraft LOS ring, nested status-glyph rings, and the aircraft ground halo.
- Clarified territory on the battlefield map with a high-contrast solid home boundary labeled **HOME TERRITORY** and distinct dashed, labeled FOB influence boundaries. Territory outlines remain visible during Plan; discovered and undiscovered fog shading is unchanged. The Known World map also outlines home and FOB regions separately in its key.
- Added Protect selection for a friendly site, map point, or confirmed friendly flight. An escort follows the flight's live position and shows predicted full or partial coverage, covered/uncovered percentages, and minimum useful-overlap and recovery checks. Narrowed Forward Patrol responsibility to the station pattern and ended its unlimited pursuit outside the visible corridor. Protect now prefers visually identified recon when guarding home and visually identified fighters when escorting a flight, without reading hidden enemy intent. Planning marks one static Protect boundary, the protected flight's planned route coverage, and the Ground Strike release zone; execution shows moving cover and one-time pursuit-break/escort-end events. Debrief adds concise per-order results, protected-flight and home-base outcomes, and strike failure reasons. Fighter mission choice remains the only posture control.
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
