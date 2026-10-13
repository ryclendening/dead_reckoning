# Fighter mission design plan

Status: approved design and acceptance reference. `GAMEPLAY_STATE.md` is the authority for behavior implemented in the current build.

## Player decision

Keep one fighter task choice before route building. The planning surface should not add an aggression dial, area-size slider, or separate leash toggle. Show the chosen task first, then its route, one relevant task area, and recovery while building the route. Put secondary rules in a short detail disclosure.

| Mission choice | One selection after choosing it | Promise shown to the player |
| --- | --- | --- |
| Protect | Tap a friendly ground site or a friendly formation; optionally tap an empty map point for area defense | Intercept threats inside the visible circle around that target, then break pursuit at its marked edge. A formation target makes this a moving escort. |
| Forward Patrol | Place a patrol route with the existing tap-to-place waypoint interaction | Hunt contacts inside the visible corridor around the patrol portion of the route, then break pursuit at its marked edge. |
| Base Strike | Select the confirmed enemy base, then adjust ingress waypoints if desired | Reach the visible missile-release zone, launch one payload, and recover. No voluntary air intercepts; direct combat can interrupt the strike. |
| Transit | Select a friendly recovery airfield | Fly there without voluntary air intercepts. |

Recon keeps Search Area. It is a valid escort target. Protecting the home base, escorting recon, clearing a strike approach, and sending a fighter to strike should compete for the same two fighters.

## Responsibility and pursuit

- The displayed area has one meaning in both planning and execution: it is where a fighter may acquire a voluntary target. Protect has a visible 0.35-unit stability buffer beyond its circle for pursuit; Patrol breaks pursuit at its corridor edge. Direct fighter combat can still begin outside the area and completes once begun.
- Static protection uses a circle anchored to the selected friendly site or map point. Escort uses the same circle anchored to the protected formation's current authoritative position. The protected formation's loss, grounding, or landing ends the escort and sends the escort fighter to recovery. An escort cannot be ordered for itself or for an unconfirmed flight.
- A moving circle alone is an insufficient escort promise. The escort fighter must have a feasible route and fuel to stay with the protected flight. Plan should preview expected coverage, identify any uncovered portion, and reject an order labeled as continuous escort when useful proximity cannot be maintained. Recon currently travels farther than a fighter over the same sortie window, so a long recon route may be ineligible for continuous escort. Execution must use actual positions if the protected flight diverts or is interrupted. Retain the existing fixed aircraft speeds and recovery rules unless playtesting provides evidence for changing them.
- Patrol responsibility covers its patrol segment, not ingress and recovery. Its route preview visually separates these segments. An acquired contact does not retain unlimited pursuit outside the corridor.
- Target choice should serve the order: home-base Protect favors visually identified recon inside its circle, escort favors visually identified hostile fighters near the protected flight, and Patrol can favor identified hostile fighters. These choices must not read hidden enemy destinations. Do not expose a second target-priority control. Current visual/radar knowledge, recovery feasibility, and deterministic tie breaks remain gates.
- Keep CAP and Patrol combat probability modifiers initially so this change can be evaluated separately. Their effects should be explained in optional details and in debrief evidence. Tune or remove them only after full-campaign playtesting.

## Planning and execution presentation

1. **Select a fighter:** Show short Protect, Forward Patrol, Transit, and eligible Base Strike choices.
2. **Build its route:** Map taps place or move ingress waypoints; the shelf shows remaining range in one line. Protect defaults to the route endpoint and offers explicit site/point and confirmed-flight escort actions. Transit can also be set by tapping an airfield while routing.
3. **Continue the flight queue:** Selecting another aircraft saves a valid route. Choosing a fighter task opens its route directly, with no bottom **Build Route** or **Next Aircraft** button. Closing a valid route saves it; **Commit Round** appears after an order is ready. Keep the canonical ingress/pattern/recovery calculation for validation, but do not display its four-part budget by default. Make invalid orders state their concrete reason.
4. **Execute:** Keep assigned mission and current behavior separate: `PROTECT HOME · INTERCEPTING RECON`, `STRIKE · ON ROUTE`, `ESCORT RAVEN · RETURNING`. Show short event reasons when a fighter acquires a target, breaks pursuit, launches a strike, or loses its protected flight. Use authoritative tracks and respect contact visibility.
5. **Debrief:** Report whether each order met its purpose: protected target observed or damaged, escort coverage and recovery, patrol contact/escape, and strike launch or failure reason. Avoid a new dashboard.

The route step should show only the selected ingress, waypoint markers, chosen task area, and recovery choice. The route step may show one selected responsibility shape or strike release zone. Hide routine radar, weapon, LOS, and other formations' route overlays in Plan. Static Protect uses one visible circle; explain the pursuit buffer in text instead of drawing a second ring. Text remains readable without color alone. No browser-control verification may occur without explicit user permission under `AGENTS.md`.

## Fixed opening package

Every new campaign starts with VIPER 1 and FALCON 2 as fighters and RAVEN 3 as recon. There is no formation-selection step. The current asset selection and placement flow remains in scope for GitHub issue #54's broader Deploy/Plan/Adapt work; this role change only removes force-composition choice. New-game setup, review, confirmation, reboot, save/load normalization, and campaign tests must agree on the fixed roster. Existing saves should not silently lose a selected formation; define an explicit compatibility rule before changing persistence.

## Acceptance and validation

- A new player can choose Protect, Patrol, Strike, or Transit and immediately build its route without seeing every choice and range overlay at once; no independent area-size or leash control appears. Switching to another formation confirms a valid routed order; invalid orders stay selected and show why. **Commit Round** remains available after planning and starts execution.
- What the planning boundary promises matches acquisition and pursuit behavior in deterministic tests, including recon threats, contact loss, fuel limits, direct combat, and moving-target interruption/recovery.
- Escort orders never promise useful protection if the fighter cannot reach and recover from the protected flight's expected path. The planner explains any rejected pairing.
- A strike's release zone and outcome are visible without requiring a separate combat-stat panel.
- The fixed opening always contains exactly two fighters and one recon in new campaigns. Existing saves are handled deliberately.
- Run focused deterministic tests and a build. Full campaign and visual usability findings belong to #37; browser-control testing requires explicit permission.

## Issue alignment

- #32 is the umbrella for visible mission intent and a small reaction grammar; this plan specifies Protect, Escort, Patrol, and Strike under it.
- #31 is the execution vocabulary: mission and live behavior remain separate; escort and strike need no bespoke top-level glyph.
- #54 owns the larger Deploy/Plan/Adapt redesign. This plan implements only its fixed formation package, leaving its fixed starting asset set and broader control redesign open.
- #52 and #51 supply contextual coverage styling and canonical range/recovery feedback.
- #50 and #53 have been reconciled with the tap-to-place waypoint planner; freehand gesture requirements are superseded.
- #37 is the campaign playtest and balance gate before changing role odds, speed, or campaign thresholds.
