> Latest equal-rules, frozen-candidate results: [FAIR_CPU_RESULTS.md](FAIR_CPU_RESULTS.md).
> This file preserves an earlier candidate and ruleset.

# Offensive tuning checkpoint — 2026-11-08

The >70% base-destruction target on **each** difficulty is **not achieved**.
This is a validated work-in-progress checkpoint, not a completed competitive gate.

Production game SHA-256: `e0d44801dc4a40a72b089633aa352fc61b851d699d3372ff6900a1b8075a52e5`.
Harness SHA-256: `a5d27b8d5ab4c1ad44e01920e6f1c28e2725796c3dad9db7e53bd105af59d54b`.
Raw records, production source list and preserved-baseline hash:
`offensive-results.json`. The historical evaluation remains in `results.json`.

This run pairs v1 and v2 on the same current engine, layouts and scripted policies,
using development seeds 3, 11, 29, 47, 71, 89. Each version has 30 attacking-policy
matches per difficulty; recon-denial is a separate control. These are **six reused
world seeds**, not 90 independent worlds or fresh validation. Every seed/policy
result, including failures, is retained.

| Difficulty | v1 base destruction | v2 base destruction | v2 force elimination | v2 deadline survival | v2 losses |
| --- | ---: | ---: | ---: | ---: | ---: |
| Easy | 3/30 | 17/30 (56.7%) | 10/30 | 1/30 | 2/30 |
| Medium | 3/30 | 19/30 (63.3%) | 8/30 | 1/30 | 2/30 |
| Hard | 1/30 | 18/30 (60.0%) | 8/30 | 0/30 | 4/30 |

Base destruction and force elimination together are 27/30, 27/30 and 26/30.
They remain separate from the stricter base-destruction gate. Mean player-base
damage, v1/v2: Easy 28.0/61.7, Medium 16.0/70.9, Hard 19.3/68.9.

Policy version: `fixed-policies-v2-compatible-recovery`. Both sides' complete recovery packages
were validated. The older scripts could overbook a FOB because they checked
orders individually. The corrected policy selects the highest-priority legal
hold/order subset when necessary. One package was adjusted for each version on
each difficulty; headline win totals were unchanged. Older reports without the
collective player check are historical, provisional evidence.

Opponent pressure is measured rather than assumed. Against v2, player scripts
attempted a strike in 15/30 Easy, 13/30 Medium and 13/30 Hard matches, and launched
in 11/30, 11/30 and 10/30. Of v2's base-destruction wins, 13 Easy, 15 Medium and
15 Hard occurred before any player strike order. Seven, nine and nine of those
matches respectively included a lost player base report. No-strike matches are
not automatically labeled intelligence denial: fixed search, default deployment,
losses and policy limitations also matter. The scripts make no midflight RTB
decisions and do not adapt like a human. These results do not establish a human
win rate or guarantee a difficulty ordering.

Every v2 campaign checked save/load order preservation, legal recovery, and
once-only settlement/Adapt; the first campaign was replayed identically. A second
complete run reproduced all 216 rows exactly. The 340-test suite and production
build passed. Normal-layout CPU FOB usage remains absent in this cohort;
build -> Transit -> improved strike is demonstrated by the long-range behavior
scenario, not claimed as a campaign-benchmark achievement.

Current limitations include estimating contested air routes, preserving and
restoring strike capability, and finishing before force elimination ends the
campaign. CPU FOB valuation covers known-base reach and known ground-threat
improvement; broader observed-air and reconnaissance staging value is incomplete.
Fuel-limited partial escort prefixes are also not enumerated. The preregistered
fresh validation cohort remains unrun.

Reproduce from this worktree:

```sh
CPU_BENCHMARK=full CPU_SEEDS=3,11,29,47,71,89 CPU_OUTPUT=/tmp/cpu-campaigns.json node node_modules/vitest/vitest.mjs run Evaluation/CpuPlannerV2/benchmark.test.ts --disableConsoleIntercept
```
