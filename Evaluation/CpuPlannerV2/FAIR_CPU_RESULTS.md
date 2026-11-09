# CPU v2 with equal campaign rules

The final fresh evaluation **did not meet** the >70% offensive-win gate on all
three difficulties: Easy 41/60 (68.3%), Medium 43/60 (71.7%), Hard 41/60 (68.3%).
Development rates were higher and are not pooled with fresh results. The
implementation is frozen; no further tuning followed this run.

The initial integrated candidate was `36ed6f9` (production fingerprint
`0e7283ba5cad9ede8e679c9a51fd70fe7b28b644104948f18013fe5a2337e35a`).
The final frozen candidate is `8252ae3`; raw files record its production and
harness fingerprints. No production or opponent changes were made after starting its fresh cohort.

| Stage | Easy offensive wins | Medium offensive wins | Hard offensive wins |
|---|---:|---:|---:|
| Before parity, old CPU inventory/rules | 16/30 (53.3%) | 15/30 (50%) | 15/30 (50%) |
| Equal opening/rules only, `dcff2b1` | 21/30 (70%) | 21/30 (70%) | 21/30 (70%) |
| Collection refinements, before integration, `490bde3` | 23/30 (76.7%) | 23/30 (76.7%) | 22/30 (73.3%) |
| Integrated current engine, `36ed6f9` | 24/30 (80%) | 23/30 (76.7%) | 23/30 (76.7%) |

Every row in the table above uses the same six development seeds and unchanged `competitive-v1`
player scripts. These are separate rules/candidate cohorts, not pooled samples.
The parity-only comparison isolates the combined correction to opening forces,
condition, authorization and joint-force planning. Later integration retains
main's AAA bursts, returning-fighter gun passes, and equipment/airframe catalog;
its results must not be attributed solely to planner scoring.

An offensive victory requires exclusive player-base destruction. Deadline
survival and mutual destruction are draws. Force-elimination wins do not count.
The five attacking policies contribute 30 campaigns per difficulty; recon-denial
is a separate non-attacking control. Integrated control results are 6/6 base
kills on each difficulty. All 108 integrated development rows are retained in
`integrated-development-results.json`; all 108 pre-integration rows are in
`pre-integration-results.json`. `PARITY_RESULTS.md` records the parity-only and
rejected first-contact retreat comparisons without hiding adverse outcomes.

## What changed

- Equal opening: two four-aircraft fighters and four recon aircraft per side,
  matching condition, 10 Logistics, three reserves, full-health base/radar/SAM/
  AAA, and no opening decoy. Both sides require recovered coordinates for strikes.
- Shared fighter capabilities produce legal joint orders: coordinated strikes,
  attack plus defense, separate scouting regions, escort and actual staging.
  Package value includes its own post-purchase inventory; discovery gains value
  from the strike capability a returned report can enable before round six.
- Escort confidence discounts air threats according to feasible coverage while
  preserving ground-defense risk. A locally observed incoming fighter shot can
  trigger recon RTB before impact without reading its future hit/damage roll.
- Known-defense estimates use shared equipment definitions and actual operating
  fields/ranges. Placement values count shots that arrive before strike release.
  A forward field can serve either surviving fighter; real Transit and recovery
  must precede its use. SAM damage remains permanent for both sides.
- Readiness/ammunition depletion, construction prices, income, recovery and
  once-only settlement use the same rules. Legacy inventories remain unchanged
  on load; compatible old deadline endings normalize to symmetric results.

## Validation and limitations

The final frozen build passes **373 tests across 52 files** and the production
build. Executed scenarios cover discovery/strike, direct/flank defensive
placement, useful SAMs, known-SAM avoidance, measurable suppression advantage,
objective changes, both fighters' forward-field lifecycle, save/load, equal
opening/condition, hidden-information invariance and repeated settlement.
The simplified returned-report probability matches an exhaustive subset oracle.
Browser control was not used.

Campaigns execute the real deployment, fixed-tick combat, recovery, economy and
six-round outcomes. CPU orders precede player order edits. Player policies use
their own authorized intelligence and finite resources. Every complete CPU and
player package is validated; CPU save/load and duplicate settlement/Adapt are
checked. Each independent difficulty batch repeats its first campaign. All
integrated development rows have zero invalid CPU packages.

The >70% target is met on development, but these scripts remain limited.
Player strike orders and launches occurred in only 1/30 Easy, 1/30 Medium and
2/30 Hard campaigns. CPU offensive wins in those launched-attack campaigns were
1/1, 0/1 and 1/2 respectively. Most offensive wins occurred before the scripts
could attack. This measures rapid completion and intelligence denial against
fixed policies; it does not establish a human win rate. Policy/difficulty rows
share campaign seeds and are correlated; 90 matches are not 90 independent
world layouts.

## First fresh validation and exposed experiments

`validation-1-results.json` retains all 216 rows for `36ed6f9`, seeds 263, 307,
349, 401, 443, 487, 541, 599, 647, 701, 751, 809. This was untouched for that
candidate. Easy **missed** the strict gate; after it informed further development,
these seeds became exposed and are not fresh validation for the final candidate.

| First fresh cohort, `36ed6f9` | Base destruction | Force win | Draw | Defeat |
|---|---:|---:|---:|---:|
| Easy | 42/60 (70%) | 9 | 3 | 6 |
| Medium | 46/60 (76.7%) | 4 | 5 | 5 |
| Hard | 44/60 (73.3%) | 5 | 4 | 7 |

The separate control recorded 35 base kills and one force win across 36 rows.
Player strike orders occurred in 11/60 Easy, 9/60 Medium and 13/60 Hard matches;
CPU offensive wins among those were 5/11, 5/9 and 4/13. All CPU packages were
legal. These attacking subsets are selected by match progress, not randomized
comparisons of combat ability.

All completed subsequent Easy experiments on this exposed 12-seed cohort are
retained: impact timing alone scored 41/60 (68.3%); timing plus highest-score
Easy selection scored 42/60 (70%). The corresponding JSON and patches reproduce
the alternatives from `36ed6f9`. Neither variant passed; highest-score Easy was
not adopted. The final candidate retains the original seeded near-best Easy
selection. A separate 96-expansion/six-sector Easy effort experiment was
cancelled when the user requested avoiding overfitting. Its incomplete progress
log is retained, not counted as a complete rate; production remains 64 expansions
and four sectors on Easy, 180/eight on Medium, 420/twelve on Hard.

The final general-mechanics corrections count known SAM/AAA impacts that can
arrive before release, preserve fast strike candidates before joint evaluation,
and distinguish a forecast immediate base finisher from operations needing
future recovery and intelligence. Engine damage, odds and weapon timing are
unchanged. A forecast finisher is still uncertain; the campaign evaluation
records its actual outcome rather than treating its forecast as success.

## Final frozen evaluation

Expanded development and fresh cohort 2 are reported separately below. Following
the user's anti-overfitting instruction, fresh cohort 2 is run once without
further tuning, regardless of whether it passes. No difficulty budgets, opponent
scripts, resources, or seed lists were adjusted to reach a target. The final
release-timing/terminal-package changes leave aggregate base-kill totals
unchanged from `36ed6f9` on the exposed 18-seed cohort; no campaign-rate gain
is claimed for those last fixes alone.


### Expanded exposed development

Candidate `8252ae3`, production fingerprint `048455c6c5f76ef23701ec5113db3fb72f5d810e496160df8274762759475fae`.

Seeds: 3, 11, 29, 47, 71, 89, 263, 307, 349, 401, 443, 487, 541, 599, 647, 701, 751, 809.

| Difficulty | Offensive wins | Force wins | Draws | Defeats | Player strikes ordered / launched | CPU offensive wins when player launched |
|---|---:|---:|---:|---:|---:|---:|
| Easy | 66/90 (73.3%) | 12 | 6 | 6 | 12/90 / 12/90 | 6/12 |
| Medium | 69/90 (76.7%) | 7 | 8 | 6 | 10/90 / 10/90 | 5/10 |
| Hard | 67/90 (74.4%) | 7 | 8 | 8 | 15/90 / 15/90 | 5/15 |

**Strict >70% on every difficulty: passed in this cohort.**

All CPU packages legal. The non-attacking recon-denial control is excluded above: {'home-base-destroyed': 53, 'forces-lost': 1}.

Per-policy offensive wins (all seed rows retained):

| Policy | Easy | Medium | Hard |
|---|---:|---:|---:|
| direct-rush | 16/18 | 17/18 | 14/18 |
| flank | 18/18 | 16/18 | 16/18 |
| recon-strike | 11/18 | 13/18 | 14/18 |
| heavy-sam | 5/18 | 6/18 | 7/18 |
| forward-fob | 16/18 | 17/18 | 16/18 |

Per-seed offensive wins across the five attacking policies:

| Seed | Easy | Medium | Hard |
|---|---:|---:|---:|
| 3 | 5/5 | 5/5 | 5/5 |
| 11 | 3/5 | 4/5 | 3/5 |
| 29 | 4/5 | 4/5 | 3/5 |
| 47 | 5/5 | 4/5 | 5/5 |
| 71 | 3/5 | 3/5 | 4/5 |
| 89 | 4/5 | 3/5 | 3/5 |
| 263 | 5/5 | 5/5 | 5/5 |
| 307 | 4/5 | 5/5 | 5/5 |
| 349 | 3/5 | 4/5 | 3/5 |
| 401 | 3/5 | 4/5 | 2/5 |
| 443 | 1/5 | 1/5 | 1/5 |
| 487 | 4/5 | 4/5 | 4/5 |
| 541 | 3/5 | 4/5 | 4/5 |
| 599 | 3/5 | 4/5 | 4/5 |
| 647 | 5/5 | 5/5 | 5/5 |
| 701 | 4/5 | 2/5 | 2/5 |
| 751 | 3/5 | 3/5 | 4/5 |
| 809 | 4/5 | 5/5 | 5/5 |

These policy rows share world seeds and are correlated. The table reports empirical rates; no statistical or human-strength guarantee is inferred. Each of the six batches repeats its first campaign; every row checks save/load and once-only settlement/Adapt.

### Fresh cohort 2: single frozen run

Candidate `8252ae3`, production fingerprint `048455c6c5f76ef23701ec5113db3fb72f5d810e496160df8274762759475fae`.

Seeds: 853, 907, 953, 1009, 1061, 1109, 1153, 1201, 1259, 1307, 1361, 1409.

| Difficulty | Offensive wins | Force wins | Draws | Defeats | Player strikes ordered / launched | CPU offensive wins when player launched |
|---|---:|---:|---:|---:|---:|---:|
| Easy | 41/60 (68.3%) | 8 | 5 | 6 | 14/60 / 12/60 | 6/12 |
| Medium | 43/60 (71.7%) | 5 | 5 | 7 | 17/60 / 13/60 | 7/13 |
| Hard | 41/60 (68.3%) | 3 | 8 | 8 | 13/60 / 12/60 | 3/12 |

**Strict >70% on every difficulty: not met in this cohort.**

All CPU packages legal. The non-attacking recon-denial control is excluded above: {'home-base-destroyed': 33, 'deadline': 3}.

Per-policy offensive wins (all seed rows retained):

| Policy | Easy | Medium | Hard |
|---|---:|---:|---:|
| direct-rush | 12/12 | 10/12 | 9/12 |
| flank | 10/12 | 11/12 | 10/12 |
| recon-strike | 4/12 | 6/12 | 8/12 |
| heavy-sam | 3/12 | 5/12 | 4/12 |
| forward-fob | 12/12 | 11/12 | 10/12 |

Per-seed offensive wins across the five attacking policies:

| Seed | Easy | Medium | Hard |
|---|---:|---:|---:|
| 853 | 4/5 | 3/5 | 3/5 |
| 907 | 3/5 | 4/5 | 4/5 |
| 953 | 5/5 | 5/5 | 5/5 |
| 1009 | 3/5 | 4/5 | 5/5 |
| 1061 | 4/5 | 5/5 | 5/5 |
| 1109 | 3/5 | 3/5 | 2/5 |
| 1153 | 3/5 | 4/5 | 4/5 |
| 1201 | 4/5 | 3/5 | 2/5 |
| 1259 | 3/5 | 3/5 | 2/5 |
| 1307 | 2/5 | 0/5 | 0/5 |
| 1361 | 2/5 | 4/5 | 5/5 |
| 1409 | 5/5 | 5/5 | 4/5 |

These policy rows share world seeds and are correlated. The table reports empirical rates; no statistical or human-strength guarantee is inferred. Each of the six batches repeats its first campaign; every row checks save/load and once-only settlement/Adapt.


### Remaining measured weaknesses

The heavy-SAM policy produced only 3/12, 5/12 and 4/12 offensive wins on
Easy/Medium/Hard. Recon-strike produced 4/12, 6/12 and 8/12. These outcomes
identify a broad defensive/counterattack weakness, not proof of one particular
causal bug. In the fresh attacking-policy cohort, 33 Easy, 33 Medium and 37 Hard
base kills occurred without any player strike order. Even among matches with
a launched player missile, offensive wins were only 6/12, 7/13 and 3/12. That
subset is selected by match progress, but it plainly does not support claiming
a >70% competitive human win rate.

Useful SAM/FOB behavior, route avoidance, suppression, adaptation, legal
packages and deterministic settlement have executed scenario evidence. Those
capabilities and equal starting conditions do not establish the stronger
campaign target. No new candidate, policy adjustment, or rerun was used to
turn the final missed gate into a pass.
