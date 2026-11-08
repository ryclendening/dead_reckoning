# Extension points

This note describes how to extend the current campaign model without changing its existing balance. New catalog entries are inert until assigned to a formation or installed through Adapt.

## Aircraft types

`src/game/aircraftTypes.ts` owns platform definitions. Each entry has a stable `id`, tactical `role`, display model, maximum formation size, speed, range, and sensor range. Assign `aircraftTypeId` when creating a squadron; the role continues to control mission choices and tactical responsibilities. Older saves without an ID are normalized to the existing default platform for their role.

Use `aircraftSpeed`, `aircraftRange`, and `aircraftSensorRange` to read platform values with installed modifiers. Route planning, fuel checks, execution movement, sensing, and CPU route planning use these helpers. Role-based `FLIGHT_SPEED` and `MAX_FLIGHT_DISTANCE` remain exported as compatibility defaults for existing callers.

The current renderer supports the existing `f16` and `atlas` display models. A new type can reuse either; adding a new visual asset requires extending the model renderer as well as registering the platform.

## Upgrades

`src/game/upgrades.ts` is the shared upgrade catalog. Add an `UpgradeDefinition` with a unique ID, cost, valid targets (`squadron`, `base`, `fob`, `radar`, `sam`, `aaa`, or `decoy`), and stat modifiers. Definitions targeting squadrons appear when a squadron is selected in Adapt; equipment definitions appear on eligible sites. Installed IDs persist on the target object.

`group` makes choices mutually exclusive within that group on one object. Current main-airfield choices share the `main-airfield` group. Ungrouped upgrades can be combined. Stat modifiers are additive or multiplicative and resolve through `modifiedStat`.

Add new stat keys to `UpgradeStat`, then read them through the owning domain's resolver:

- `aircraftTypes.ts` resolves aircraft speed, range, and sensor range.
- `equipmentRules.ts` resolves SAM, AAA, and radar profiles. Combat resolution and battlefield/inspector readouts use those same profiles.
- `economy.ts` resolves repair costs and recurring income.

For an effect that cannot be represented by a numeric modifier, add a named stat or capability to the relevant resolver and consume it from simulation rules. Keep purchase eligibility and installation in the shared economy command flow.

## Current scope

The existing Maintenance Wing and Supply Depot remain the only purchasable upgrades. No new aircraft type or gameplay upgrade is enabled by this refactor; it establishes the data and rule paths for later additions.
