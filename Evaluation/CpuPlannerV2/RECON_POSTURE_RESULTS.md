# Shared recon posture validation — 2026-11-09

CPU recon now commits Aggressive or Conservative before execution and uses the
same engine reactions as the player. The former CPU collection, low-strength,
pending-fire and home-field overrides are removed. Missing conditions on old
committed orders use the shared Aggressive default; existing orders are not
silently replanned on reload.

The tactical library offers both conditions and holding recon. Expected
returned observations and aircraft losses use mutually exclusive turnback
forecasts for Conservative recon, including the initiating defense shot and
the direct return to its committed field. Stationary recovered defense
locations can imply a launch opportunity; coarse recent fighter sightings
remain uncertain. Radar-only tracks do not acquire a hidden role. Forecasts
never replace executable routes or inspect actual opponent orders/inventory.
Posture has no fixed score bonus. Search budgets and combat values are unchanged.

## Executed checks

- Mirrored player/CPU SAM, AAA and visual-fighter triggers give equal Conservative
  return times; Aggressive recon continues farther on the same committed route.
- Both sides retain their planned FOB recovery rather than receiving a CPU-only
  home redirect. CPU-specific contact/RTB events are not added to player alerts.
- CPU base collection, low strength and radar alone do not cause an extra RTB.
- Known early launch geometry removes credit for observations beyond turnback,
  while retaining the triggering projectile's expected damage. Uncertain fighter
  branches are alternatives for one observer, not extra independent scouts.
- Shared scoring prefers Conservative when the route collects useful information
  before its known threat. Quiet full planning selects Aggressive; both conditions
  are available in the shared library. Decisions, selected-condition traces,
  legacy orders, save/load and once-only settlement remain compatible.
- The dedicated asynchronous smoke test runs Easy, Medium and Hard against
  preselected Aggressive and Conservative player recon on exposed seeds 3 and 11:
  six unique campaigns and three complete determinism repeats. Every round locks
  CPU orders before player planning, validates both packages, reloads the save,
  resolves without live commands and checks once-only settlement. No private
  benchmark RTB adapter is used by this test.

After merging committed RTB interface cleanup from `129d556`, **405 tests across
56 files pass**, as does `npm run build`. No browser control was used.

These are behavior, compatibility and legality checks. There is no new offensive
win-rate claim, fresh holdout run or tuning against the earlier campaign cases.
The historical online-RTB evaluation remains a historical diagnostic and does not
establish competitive rates under these new shared asynchronous conditions.
