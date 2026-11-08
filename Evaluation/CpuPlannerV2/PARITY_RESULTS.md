# Equal opening and campaign rules — 2026-11-08

The parity-only candidate is `dcff2b1`. This comparison measures the combined
change to starting inventory/condition, intelligence eligibility, outcomes and
use of both fighters. Strategic weights and `competitive-v1` player scripts
were unchanged. It is not an isolated test of strategic scoring quality.

| Difficulty | Before: CPU base-destruction wins | Equal rules: CPU base-destruction wins | Draws | CPU defeats | CPU force-elimination wins |
|---|---:|---:|---:|---:|---:|
| Easy | 16/30 (53.3%) | 21/30 (70%) | 6 | 3 | 0 |
| Medium | 15/30 (50%) | 21/30 (70%) | 4 | 3 | 2 |
| Hard | 15/30 (50%) | 21/30 (70%) | 5 | 4 | 0 |

Only exclusive player-base destruction counts as an offensive win. Deadline
survival and mutual destruction are draws; losing every formation with no
reserves is now symmetric. The old cohort had no mutual base destruction, so
its offensive count requires no retrospective tie correction. Force-elimination
wins remain excluded. **Exactly 70% does not pass the strict >70% gate.**

Both cohorts use seeds **3, 11, 29, 47, 71, 89**, each against all five attacking
policies on all three difficulties. The non-attacking recon-denial control is
separate: 18/18 parity base-destruction wins. All 108 new rows are retained in
`parity-results.json`; the unchanged old cohort is `route-search-results.json`.
Do not pool the `symmetric-current` and `shared-current` rulesets.

The opponent limitation is substantial. Attacking-policy scripts actually
issued strike orders in only 3/30 Easy, 3/30 Medium and 6/30 Hard campaigns;
20/21, 21/21 and 20/21 offensive wins, respectively, occurred before the player
issued any strike. Correcting the forces helped offensive completion and
intelligence denial. The player actually launched missiles in 2/30 Easy, 3/30
Medium and 5/30 Hard campaigns; the CPU scored zero offensive wins in those
ten campaigns. These totals do not establish strong play against a
human who obtains coordinates and attacks effectively. The policies are fixed
and correlated across seeds/difficulties, not independent human opponents.

Validation: 362 tests across 52 files and production build passed. New behavior
checks execute both CPU fighters at zero legacy pressure, destroy a full-health
base through the real resolver, preserve all orders through save/load and settle
once. Equal opening condition/assets/resources, legacy inventories, draw endings,
symmetric force elimination, spatial/behavior gates and hidden-state invariance
are covered. The campaign harness checks complete recovery packages, finite
budgets, save/load, duplicate settlement/Adapt, and repeats its first campaign
for deterministic equality. Every parity row had zero invalid CPU packages.
The registered fresh cohort remains untouched at this parity-only checkpoint.

Reproduce the parity checkpoint in a clean checkout of `dcff2b1`:

```sh
CPU_BENCHMARK=full CPU_OPPONENTS=competitive CPU_V2_ONLY=1 CPU_SEEDS=3,11,29,47,71,89 CPU_OUTPUT=/tmp/cpu-parity-results.json node node_modules/vitest/vitest.mjs run Evaluation/CpuPlannerV2/benchmark.test.ts --disableConsoleIntercept
```

This is an isolated feature-branch result. Main has subsequent combat/equipment
work that requires integration and a separate evaluation; these numbers must
not be presented as measurements of that later integrated engine.
