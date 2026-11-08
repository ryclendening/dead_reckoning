# Threat-aware shortest-route implementation

Candidate: `78ad0d4`, implemented on `work/cpu-planner-v2`. Not integrated or
deployed. The broader >70% base-destruction target remains unpassed.

## Algorithm and limits

A* minimizes **distance + weighted known-threat exposure**, including the
engine's direct recovery leg. Exact segment/circle intersection measures
exposure. Ground threats come from recovered reports; fighter sectors come from
authorized observed traffic. The solver receives no hidden sites, player orders,
player resources, world seed or true boundaries.

Strike endpoints are the profile's sampled legal release points, searched
together. Fuel and waypoint count are hard constraints. Cost/fuel Pareto labels
prevent cheap long detours from pruning shorter feasible paths. Collinear route
compression preserves distance and exposure. Every admitted CPU order still
passes the shared strike/recovery validators.

The search reports a proved minimum weighted cost **within its graph**, or a
best-found route after its expansion budget. It does not prove the optimal
continuous path/release point or predict combat outcomes. Easy/Medium/Hard use
64/180/420 expansions per planning decision. The cache is local to that decision;
new evidence and actual basing generate a new query next round. Existing quick
paths remain candidates, and the optimizer's route is explicitly retained for
strategic/tactical comparison.

## Deterministic validation

- Clear map: exact shortest round trip, 32 units, zero expansions, optimality
  proved.
- Known threat: lower-cost detour while accounting for the unavoidable direct
  recovery leg.
- Exact fuel boundary: retains an exposed 32-unit route when no detour fits.
- One- and two-bend constrained cases: matches exhaustive candidate enumeration.
- Work cutoff: flags the result as unproven, retains a legal candidate, respects
  expansion/fuel/waypoint limits and repeats identically.
- Destroyed/trapped formations produce no optimized strike; repeated identical
  queries reuse geometry without consuming more expansions.

The executed two-SAM scenario has home `(0, 0)`, recovered base `(20, 0)`, and
known SAMs `(5, 2)` and `(9, -2)`. The optimized route is:

`(0,0) -> (3.3775,5.8500) -> (14.7345,2.8766) -> recover home`

| Measure | Result |
| --- | ---: |
| Best existing direct/flank weighted cost | 46.5046 |
| Optimized weighted cost | 42.9896 |
| Cost reduction | 7.6% |
| Full movement including recovery | 33.5075 |
| Expansions | 122 |
| Graph optimum proved | Yes |
| Modeled ingress exposure | Zero |
| Actual engine base damage | 60 |

Return exposure remains in the cost; this is not a claim of a threat-free sortie.
The full 354-test suite passed, followed by the final 7 route-oracle cases and
23 behavioral cases after adding an additional exhaustive case and stricter
execution assertions. Production build and save/settlement checks pass.

## Campaign comparison

The separately versioned `competitive-v1` scripts and all six development seeds
are retained. The pre-routing checkpoint is `da225f6`, recorded in
`rapid-base-results.json`. These remain reused development observations, not a
holdout or evidence against human players. Force elimination, deadline survival
and non-attacking recon-denial are excluded from base-destruction percentages.

Reproduce the routing candidate from `78ad0d4`:

```sh
CPU_BENCHMARK=full CPU_OPPONENTS=competitive CPU_V2_ONLY=1 CPU_SEEDS=3,11,29,47,71,89 CPU_OUTPUT=/tmp/cpu-routing.json node node_modules/vitest/vitest.mjs run Evaluation/CpuPlannerV2/benchmark.test.ts --disableConsoleIntercept
```


Completed paired development comparison (same scripts, seeds, engine and
resources):

| Difficulty | Before A* base kills | After A* base kills |
| --- | ---: | ---: |
| Easy | 16/30 (53.3%) | 16/30 (53.3%) |
| Medium | 15/30 (50.0%) | 15/30 (50.0%) |
| Hard | 15/30 (50.0%) | 15/30 (50.0%) |

All 108 campaign records, including the separate recon-denial controls, pass
legal-order, saved-plan and once-only settlement checks. The harness repeats
its first campaign and verifies identical results. Raw
records and source/harness fingerprints are in `route-search-results.json`.
This routing improvement **did not improve base-destruction win rates** in this
cohort. It is a verified tactical capability, not evidence that CPU v2 has met
the competitive objective. Twelve of the thirty attacking-policy matches per
difficulty issued player strike orders; these scripts still leave substantial
coverage gaps. The registered fresh cohort remains unused.

Hard mean enemy-base damage increased from 59.13 to 61.13 HP; Easy and Medium
mean damage was unchanged. No campaign outcome changed in this development run.
