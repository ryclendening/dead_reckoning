# Offensive tuning checkpoint — 2026-11-08

The >70% base-destruction target on **each** difficulty is **not achieved**.
This is a validated work-in-progress checkpoint, not a completed competitive gate.

Candidate production SHA-256:
`aaf59ebf3564f9b7893086d91af88743fdc111ea8ee944aabc4717e2ed4a000e`.
Raw records, production source list and harness hash: `offensive-results.json`.
The original historical-engine evaluation remains unchanged in `results.json`.

This run pairs v1 and v2 against the same current engine, layouts and player
policies, using development seeds 3, 11, 29, 47, 71, 89. Every difficulty has
30 attacking-policy matches per version; recon-denial is a separate control.
These seeds have repeatedly informed tuning. They provide diagnostic comparisons,
not fresh validation or evidence of human-level strength.

| Difficulty | v1 base destruction | v2 base destruction | v2 force elimination | v2 deadline survival | v2 losses |
| --- | ---: | ---: | ---: | ---: | ---: |
| Easy | 3/30 | 11/30 (36.7%) | 10/30 | 1/30 | 8/30 |
| Medium | 3/30 | 14/30 (46.7%) | 8/30 | 1/30 | 7/30 |
| Hard | 1/30 | 14/30 (46.7%) | 8/30 | 1/30 | 7/30 |

Mean damage to the player base: v1/v2 Easy 28.0/46.3, Medium 16.0/56.3,
Hard 19.3/57.3. All v2 recovery packages were legal, save/load preserved committed
orders, and the replay check reproduced the first campaign exactly. The full
suite passed 335 tests in 49 files; the production build passed.

Opponent pressure is recorded rather than assumed. Player scripts attempted at
least one strike in 25/30 Easy, 22/30 Medium and 23/30 Hard matches; they actually
launched in 21/30, 19/30 and 20/30. Of v2's base-destruction victories, 3 Easy,
6 Medium and 5 Hard occurred without an opposing strike order. These may include
successful intelligence denial or weak scripted search, and must not be presented
as wins against a human-quality attack. Fixed policies and default deployments
remain limitations. Normal-layout FOB usage is still absent in this cohort;
build -> Transit -> improved strike is demonstrated in the deterministic long-range
behavior scenario, not claimed as a campaign-benchmark achievement.

Current failure patterns include fighter losses during first-round collection,
insufficient returned observations for the unchanged 60-pressure gate, late
finishing strikes after home becomes vulnerable, and force-elimination victories
before two base payloads can be delivered. Capability tests alone do not resolve
these competitive failures. The registered fresh cohort remains unrun.
