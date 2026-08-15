# Dead Reckoning — Project Progress and Maturity Assessment

**Assessment date:** August 15, 2026  
**Design source of truth:** Original *Cold War Air Strategy Game — Implementation Brief*  
**Current product:** Browser-first, portrait-mobile, single-player prototype against AI

This is a living scorecard for measuring the project against the original design—not merely tracking whether code exists. Ratings consider whether a system is understandable, strategically meaningful, balanced, visually communicated, and ready for repeated play.

## Maturity scale

| Level | Name | Meaning |
|---:|---|---|
| 0 | Not started | No meaningful implementation exists. |
| 1 | Concept | The idea is documented or architecturally anticipated. |
| 2 | Early prototype | A partial implementation demonstrates the idea, but it is shallow or unreliable. |
| 3 | Playable MVP | The system works in the complete game loop and can be evaluated through play. |
| 4 | Beta quality | The system has meaningful depth, clear feedback, tuning, and broad edge-case coverage. |
| 5 | Production quality | Polished, balanced, tested, content-complete, and ready for players. |

Progress bars use five blocks: `█` is achieved maturity and `░` is remaining maturity.

## Executive assessment

| Product dimension | Rating | Progress | Assessment |
|---|---:|:---:|---|
| Core playable MVP | **3.3 / 5** | ███░░ | A credible end-to-end prototype exists and demonstrates the intended command loop. |
| Strategic gameplay depth | **2.7 / 5** | ███░░ | Doctrine, detection, attrition, logistics, and defense interact, but the solution space is still relatively narrow. |
| Graphics and presentation | **2.7 / 5** | ███░░ | The angled 3D diorama has a strong identity; combat effects and environmental polish remain early. |
| Mobile interaction and UX | **2.9 / 5** | ███░░ | Portrait layout and touch routing work, but device testing, accessibility, and interaction refinement remain. |
| Technical foundation | **3.5 / 5** | ████░ | Simulation and rendering are separated and state is serializable, providing a good base for future multiplayer. |
| Production readiness | **1.8 / 5** | ██░░░ | The project needs extensive balancing, automated testing, audio, content, onboarding, and device validation. |

### Overall judgment

The prototype has crossed the line from a visual demonstration into a **playable systems MVP**. Its strongest achievement is that the complete loop now exists:

> **Deploy → Plan → Commit → Observe → Learn → Repair → Adapt**

The next milestone should not be adding a large quantity of new content. It should be proving, through repeated playtests, that information, doctrine, attrition, and deception produce distinct and understandable decisions across several rounds.

## Original-plan coverage by category

### A. Product identity and core experience

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Objective and product identity | 3.5 | ████░ | The game clearly reads as hidden-information Cold War air command rather than direct piloting. | Confirm through external playtests that deduction and deception—not route optimization alone—drive the experience. |
| Plan → Commit → Observe → Learn → Adapt | 3.5 | ████░ | All phases exist and flow into one another in a persistent match. | Improve pacing, transition clarity, and causal feedback through repeated full-match testing. |
| Operational command over twitch control | 3.5 | ████░ | Player influence is concentrated in pre-launch orders with limited execution intervention. | Add only carefully constrained emergency commands and ensure they do not turn the game into an RTS. |
| Match pacing and 5–10 round arc | 2.5 | ███░░ | Multiple persistent rounds and base-destruction end states work. | Balance discovery, defense degradation, losses, and victory timing across many simulated matches. |

### B. Hidden information, intelligence, and deduction

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Hidden enemy assets | 3.0 | ███░░ | Enemy base and defenses begin hidden; known assets render according to intelligence state. | Add region-level uncertainty and stronger false or ambiguous signals before a model is revealed. |
| Unknown → suspected → probable → confirmed | 3.2 | ███░░ | Confidence values and all four states are implemented and improved through reconnaissance. | Support repeated observations from more sources, confidence decay, and stale mobile intelligence. |
| Enemy aircraft visibility | 3.3 | ███░░ | Aircraft appear only during radar, CAP visual, or shared-network detection windows. | Improve track uncertainty, intermittent position estimates, identification progression, and reacquisition feedback. |
| Deduction rather than random guessing | 2.5 | ███░░ | Recon routes, detection windows, asset reveals, and debrief history provide evidence. | Add richer evidence: emissions, scramble bearings, strike reports, probable regions, and competing interpretations. |
| Route-origin intelligence | 1.0 | █░░░░ | Indirect routing is possible, but observed departures and returns do not yet reveal likely base regions. | Implement confidence accumulation from repeated vectors and allow deceptive routing to counter it. |
| Intelligence staleness and relocation | 0.5 | █░░░░ | Fixed assets retain their learned state. | Add age, decay, relocation rules for mobile defenses, and last-known-position presentation. |

### C. Route planning and map interaction

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Manual route drawing | 3.8 | ████░ | Freehand routes are continuous, persist between rounds, and map accurately from touch/mouse into 3D space. | Add route editing, waypoint deletion/repositioning, and stronger touch ergonomics. |
| Ground-placement hex overlay | 3.2 | ███░░ | Continuous terrain uses a subtle deployment-only hex overlay; ground assets snap to hex centers. | Add placement validity, overlap warnings, and clearer preview of the integrated defense network. |
| Route presets | 2.6 | ███░░ | Three presets exist and can be applied to any selected squadron. | Add mission-specific presets such as racetrack CAP, defensive orbit, recon sweep, escort, direct strike, and flanking strike. |
| Waypoints and route visualization | 2.8 | ███░░ | Selected routes show waypoints and observation rings. | Add directional arrows, editable segments, ingress/egress distinction, and target assignment markers. |
| Battlefield scale and readable sectors | 2.5 | ███░░ | One enlarged continuous battlefield supports meaningful route geometry and defense placement. | Create named/legible regions, improve distance comprehension, and validate that the map supports multiple viable corridors. |
| Map and level variety | 1.0 | █░░░░ | One battlefield exists, as intended for MVP. | After the core loop is proven, add maps with strategically different terrain, corridors, radar sightlines, and defensive problems. |

### D. Squadron roster, missions, and doctrine

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Four core player squadron roles | 3.2 | ███░░ | Interceptor, fighter/escort, strike, and reconnaissance squadrons are playable and differentiated. | Deepen role asymmetry and separate heavy bomber behavior if it creates a distinct decision. |
| Mission assignment | 2.8 | ███░░ | CAP, escort, strike, and recon missions are available according to role. | Add fighter sweep, intercept, reserve, and clearer role-specific target priorities. |
| Aggression settings | 3.4 | ███░░ | Cautious, balanced, and aggressive postures change CAP pursuit, escort behavior, coverage, and attrition. | Tune behavior thresholds and expose just enough predictive information for informed choices. |
| Risk posture | 3.3 | ███░░ | Preserve, normal, and press-attack settings affect aborts, threat exposure, damage, and strike commitment. | Test compounding interactions across every mission and eliminate dominant posture combinations. |
| Doctrine interactions | 3.2 | ███░░ | Cautious CAP can cue defenses; aggressive CAP can chase, open coverage gaps, consume readiness, and suffer unsupported losses. | Expand the behavior matrix and add target priority, pursuit limit, and explicit abort threshold where they create meaningful choices. |
| Autonomous behavior | 3.0 | ███░░ | A rendering-independent rules engine alters routes and resolves reactions from mission, aggression, risk, readiness, and detection. | Replace several broad hard-coded cases with a more extensible decision model and improve AI-vs-AI consistency. |
| Reserve interceptors and rotation | 1.0 | █░░░░ | Persistent readiness creates a reason to preserve squadrons, but no true reserve state exists. | Add held-back units, scramble conditions, and opportunity costs without increasing micromanagement. |

### E. Detection, defense, and combat resolution

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Radar detection | 3.1 | ███░░ | Radar range, health, placement, intermittent aircraft tracks, and detection windows affect execution. | Add emissions policy, passive clues, radar shutdown, identification quality, and counter-detection. |
| CAP visual detection and shared awareness | 3.4 | ███░░ | CAP observation can identify aircraft and cue radar/SAM/AAA, extending tracks and reducing raid effectiveness. | Improve visualization of who sees what, when the network is sharing it, and when the cue expires. |
| SAM and AAA engagement layers | 3.0 | ███░░ | Placement and route-ring intersection affect threat exposure and defensive shots. | Differentiate acquisition, launch, missile flight, evasion, altitude, ammunition, and suppression. |
| Defensive deception | 2.2 | ██░░░ | A real base and decoy can be positioned, and AI initially favors the decoy. | Make enemy targeting evidence-driven; add false emitters, silent systems, and decoy credibility. |
| Basic air combat | 2.7 | ███░░ | Intercepts, kills, damage, losses, escort benefits, and readiness/formation effects resolve. | Add engagement quality, matchup differences, disengagement, uncertainty in claims, and stronger visual causality. |
| Strike resolution | 2.8 | ███░░ | Strike aircraft require ammunition, choose reachable fixed assets, apply damage, and can destroy the real base. | Add explicit targeting, weapon selection at a high level, suppression, coordinated packages, and clearer miss/abort outcomes. |
| Limited emergency commands | 1.8 | ██░░░ | Abort and 1×/2× execution controls exist. | Add command-point-based recall or reserve scramble; consider pause only for accessibility/testing. |

### F. Defensive setup and force construction

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Pre-match defensive placement | 3.3 | ███░░ | Player places the real base, decoy, radar, SAM, and AAA in friendly territory before locking deployment. | Add placement costs, terrain/coverage consequences, validation, and stronger deception tradeoffs. |
| Integrated air-defense design | 3.0 | ███░░ | Overlapping sensors and engagement ranges influence detection and raid defense. | Ensure multiple viable network shapes exist and avoid an obvious mathematically optimal cluster. |
| Pre-match force budget | 0.8 | █░░░░ | The MVP uses a fixed roster and fixed defensive inventory. | Add force points only after core unit values are stable enough to support meaningful composition choices. |
| Initial force-package construction | 1.0 | █░░░░ | Four required squadron roles are supplied automatically. | Later allow a constrained roster choice without undermining tutorial clarity or balance. |

### G. Attrition, readiness, logistics, and momentum

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Persistent aircraft losses | 3.4 | ███░░ | Destroyed and damaged aircraft persist, reduce formation strength, and affect sensor/combat performance. | Tune severity to prevent both trivial replacement and irreversible early death spirals. |
| Squadron readiness | 3.2 | ███░░ | Readiness falls with use and risk; it affects combat and can be restored between rounds. | Make sortie availability and rotation pressure more visible and mechanically distinct. |
| Ammunition and rearm | 3.0 | ███░░ | Missions consume ammunition; under-armed strike packages cannot attack; rearm costs logistics. | Add clearer pre-commit warnings and tune ammunition consumption by mission/engagement. |
| Between-round logistics | 3.3 | ███░░ | Limited points repair aircraft, replace losses, restore readiness, rearm, and repair runway/defenses. | Balance the budget across full matches and improve comparison of competing repair choices. |
| Limited reinforcements | 2.8 | ███░░ | A scarce three-aircraft replacement pool exists in addition to logistics cost. | Decide whether and how replacements replenish, and communicate their campaign value more strongly. |
| Breakthrough momentum | 2.5 | ███░░ | Intel gains, destroyed defenses, depleted squadrons, and damaged bases produce emergent momentum. | Strengthen early/mid/breakthrough/end-game pacing and let network collapse create unmistakable strategic openings. |

### H. Round execution, debrief, and victory

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Autonomous 15–30 second execution | 3.2 | ███░░ | An 18-second phase animates friendly packages and only currently observed hostile aircraft. | Improve event spacing, simultaneous action readability, and the relationship between animation and resolution timing. |
| Execution readability | 2.9 | ███░░ | Contact state, event cards, rings, route changes, unit strength, and defense cueing are visible. | Add missile/weapon visualization and make cause → response → consequence legible without relying on text alone. |
| After-action debrief | 3.5 | ████░ | Losses, kills, damage, intelligence, causal doctrine lessons, route history, markers, readiness, and logistics are shown. | Add per-squadron mission outcomes, probable enemy losses, timeline filtering, and clearer next-round recommendations. |
| Base-destruction victory | 3.2 | ███░░ | Hidden enemy-base damage and destruction lead to victory; loss of the home base leads to defeat. | Tune target confirmation requirements, strike difficulty, and late-game pacing. |
| Secondary end conditions | 0.5 | █░░░░ | Not implemented, appropriately for MVP. | Consider round-limit score or combat-ineffective surrender only after the primary victory loop is balanced. |

### I. Graphics, presentation, and atmosphere

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Angled top-down 3D diorama | 3.2 | ███░░ | Orthographic Three.js terrain, lighting, fog, shadows, low-poly aircraft, airfields, radar, and defenses establish the intended command-table identity. | Improve composition, terrain artistry, asset silhouettes, lighting, and depth without sacrificing tactical clarity. |
| Premium portrait-mobile HUD | 3.1 | ███░░ | Strong typography, phase structure, squadron cards, doctrine controls, resource display, and debrief styling exist. | Refine spacing and hierarchy on physical phones and handle shorter/taller viewports gracefully. |
| Tactical overlays | 3.3 | ███░░ | Radar/SAM/AAA rings, LOS rings, continuous routes, deployment hexes, intel labels, and history overlays are implemented. | Add directional arrows, uncertainty regions, altitude/mission encoding, and selective overlay controls. |
| Fog and uncertainty presentation | 2.0 | ██░░░ | Unknown enemy models are withheld and contacts disappear outside observation. | Add atmospheric enemy-territory uncertainty, ghost tracks, probable regions, and visual confidence transitions. |
| Combat effects | 1.7 | ██░░░ | Pulses and moving aircraft communicate activity. | Add contrails, missile trails, SAM launches, tracer/AAA fire, flak bursts, strike release, impacts, smoke, and damage states. |
| Aircraft and ground models | 2.0 | ██░░░ | Readable procedural low-poly placeholders distinguish broad unit classes. | Replace with authored stylized models, improve animation, and establish faction silhouettes. |
| Audio and haptics | 0.0 | ░░░░░ | No meaningful soundscape or haptic layer exists. | Add restrained radar, radio, launch, impact, warning, and phase-transition feedback after visual causality is stable. |
| Late Cold War atmosphere | 2.5 | ███░░ | Terminology, colors, silhouettes, radar, SAMs, and command presentation support the setting. | Add stronger faction personality, period-inspired sound/design language, and environmental storytelling without requiring strict simulation. |

### J. Screens, usability, and technical foundation

| Original brief area | Rating | Progress | Current state | Main gap to next level |
|---|---:|:---:|---|---|
| Planning screen | 3.4 | ███░░ | Map, assets, intel, routes, coverage, squadron selection, doctrine, presets, and commit action are present. | Add target assignment, route editing, warnings, and a better summary of all squadron orders before commitment. |
| Execution screen | 3.0 | ███░░ | Autonomous movement, detection-limited hostile rendering, event feed, status, and limited controls are present. | Improve combat animation, simultaneous-event comprehension, and intervention design. |
| Debrief/adapt screen | 3.5 | ████░ | Results, lessons, route history, readiness, repairs, defenses, and next-round transition are integrated. | Make tradeoffs easier to compare and connect every logistics action to likely next-round capability. |
| Save and resume | 2.8 | ███░░ | Match state persists locally and an interrupted execution safely returns to planning. | Add versioned migration, explicit reset controls before end-state, and resilience testing. |
| Portrait browser responsiveness | 2.8 | ███░░ | The product is designed around an iPhone-like portrait viewport. | Test multiple physical-device dimensions, notches/safe areas, browser chrome, orientation, and touch cancellation. |
| Accessibility and onboarding | 1.2 | █░░░░ | Labels and explanatory doctrine text provide a small foundation. | Add tutorialization, keyboard/focus review, color-independent cues, reduced motion, text scaling, and accessible controls. |
| Simulation/rendering separation | 4.0 | ████░ | Serializable types and a rendering-independent TypeScript round resolver keep rules outside Three.js. | Add tests, explicit order/result contracts, deterministic replay, and server-safe validation. |
| Automated testing and balance tooling | 1.0 | █░░░░ | Production builds and manual browser tests pass, but systematic gameplay tests are minimal. | Add unit tests for doctrine/detection/logistics and batch match simulation for balance analysis. |
| Performance and bundle discipline | 2.0 | ██░░░ | The MVP runs in-browser with bounded 3D content. | Profile physical phones, reduce the large initial bundle, and measure frame time, memory, and battery impact. |
| Multiplayer readiness | 1.5 | ██░░░ | State separation supports a future authoritative 1v1 server conceptually. | Define hidden-state ownership, simultaneous order commitment, deterministic resolution, reconnection, anti-cheat, and networking. |

## Gameplay-complexity assessment

The current game has several interacting systems, but the number of truly distinct strategic decisions is still below the ambition of the original brief.

| Complexity layer | Maturity | What the player currently reasons about | What would deepen it |
|---|---:|---|---|
| Spatial | 3.0 | Route geometry, radar/weapon rings, base/decoy placement, friendly territory | Terrain effects, corridors, altitude bands, emissions, editable waypoints |
| Informational | 2.8 | Hidden assets, confidence levels, intermittent aircraft observation | Competing hypotheses, bearings, stale tracks, repeated route-origin inference |
| Doctrinal | 3.2 | Mission × aggression × risk interactions | Target priorities, pursuit limits, reserve triggers, matchup-aware behavior |
| Operational | 3.0 | Readiness, ammunition, damage, aircraft losses, repairs | Rotation, sortie availability, package timing, scarce command interventions |
| Defensive | 2.8 | Radar coverage, shared tracks, SAM/AAA overlap, decoy targeting | Emission control, mobile/silent assets, false emitters, suppression corridors |
| Economic | 2.7 | Limited logistics and scarce replacements | Better long-horizon tradeoffs without adding routine bookkeeping |
| Adversarial | 2.0 | Scripted enemy flights and probabilistic target choice | AI plans that scout, infer, deceive, preserve forces, and adapt over rounds |
| Content/levels | 1.0 | One fixed battlefield and one opposing force layout | Multiple maps and AI doctrines only after the core system is balanced |

## What is already credible for MVP review

- One complete battlefield and a persistent multi-round match
- Player defensive deployment with real base, decoy, radar, SAM, and AAA
- Four distinct player squadron roles
- Continuous manual flight routes independent of the deployment hex grid
- Route presets, visible waypoints, and line-of-sight rings
- Mission, aggression, and risk controls with compound autonomous effects
- Detection-limited enemy aircraft visibility
- Radar, visual CAP, and shared defensive-network tracking
- Basic interception, strike, SAM/AAA, damage, and attrition resolution
- Unknown, suspected, probable, and confirmed fixed-asset intelligence
- Autonomous execution with a readable event feed
- Causal post-round command findings and observed route history
- Persistent aircraft, readiness, ammunition, runway, and defense damage
- Limited logistics and scarce aircraft replacements
- Hidden-base destruction victory and home-base defeat
- A distinct portrait 3D Cold War command-diorama presentation

## Highest-priority gaps

### Priority 1 — Prove and tune the core loop

Run structured multi-round playtests and record whether players can predict doctrine, interpret execution, learn from intelligence, and form a better next-round plan. Fix unclear causal feedback before adding major systems.

### Priority 2 — Deepen deception and intelligence

Add route-origin inference, scramble bearings, radar emissions, uncertain regions, and decoy credibility. These systems are central to the product identity and will create more strategic value than additional aircraft types.

### Priority 3 — Balance attrition and logistics

Batch-test aggressive, cautious, preserve, and press-attack strategies. Establish whether losses are painful but recoverable and whether logistics creates difficult choices without producing an early death spiral.

### Priority 4 — Improve execution readability and effects

Add a minimal effects pass: contrails, SAM/missile launches, AAA bursts, strike release, impacts, and smoke. Each effect should communicate a simulation event rather than exist only as decoration.

### Priority 5 — Strengthen the opponent

Replace the current narrow enemy flight script with an AI commander that chooses reconnaissance, deception, pressure, and decisive strikes from the same kinds of information available to the player.

## Recommended milestone ladder

### Milestone 1 — Core-loop validation

**Exit criteria:** Five complete internal matches and at least three outside playtests; players can explain why major outcomes occurred and identify a meaningful adaptation for the next round.

### Milestone 2 — Strategic alpha

**Exit criteria:** Deception, route-origin inference, explicit targeting, reserve decisions, and balanced logistics create multiple viable approaches over a 5–10 round match.

### Milestone 3 — Presentation alpha

**Exit criteria:** Combat events are visually understandable without reading every event card; effects, audio, uncertainty, and models support the premium diorama identity.

### Milestone 4 — Content beta

**Exit criteria:** Multiple battlefields and enemy doctrines produce different planning problems; onboarding, accessibility, saving, and mobile-device performance are reliable.

### Milestone 5 — Multiplayer prototype

**Exit criteria:** Server-authoritative hidden state, simultaneous planning, reconnection, deterministic resolution, and secure information boundaries support a complete 1v1 match.

## Deliberately deferred scope

The following remain intentionally outside the current MVP and should not reduce confidence in the prototype’s present purpose:

- Campaign map
- Historical faction trees and exact aircraft statistics
- Full technology tree
- Detailed fuel simulation
- Pilot progression
- Electronic warfare beyond later foundational hooks
- Dozens of aircraft types
- Multiplayer networking

These should be reconsidered only after the hidden-information route-planning loop demonstrates durable replay value.

## Next review trigger

Update this document after either:

1. A major mechanic is added or materially redesigned, or
2. A structured playtest produces evidence that changes one or more maturity ratings.

For each update, adjust the rating, summarize the evidence, and identify the next gap. A feature should not advance to Level 4 merely because it exists; it should advance only when it is clear, balanced, and reliable through repeated play.
