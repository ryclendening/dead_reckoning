# Territory-aware defensive CPU investment — 2026-11-08

The planner now values legal defensive construction after the territory correction in `731df29`. Combat, construction rights, costs, resources, difficulty budgets and opponent scripts are unchanged.

## Implemented behavior

- Separate pre-release damage from post-release fighter attrition and recon report-return denial. Late hits never claim to prevent the current missile. Future effects expire at round six and receive no bonus after a forecast immediate enemy-base kill.
- Use only own sites, recovered traffic/condition, observed approach bearings and own base damage. Recon is evidence of opportunity, not proof that the opponent recovered base coordinates. Repeated identified contacts are deduplicated; older observed strength may have been repaired.
- Compare complete, currently affordable FOB-plus-SAM/AAA expansions alongside direct construction, aircraft maintenance and saving. Preserve up to two full expansions before prefix pruning; spend both commands through shared rules, and give empty territory no speculative defensive reward. Ground sites do not require aircraft staging.

## Validation

All **392 tests across 54 files** and the production build pass. No browser control was used. New executed scenarios demonstrate:

- A home SAM can damage a returning striker while its already-launched 60-damage payload still lands; its forecast correctly reports zero pre-release protection.
- Starting with no FOB or recovered enemy base, observed direct and rotated flank approaches can select a paid FOB and legal weapon in its newly owned territory. Actual strikes inflict less base damage on all three tested bearings.
- A budget-eight home SAM reduces recovered base reports across four fixed recon combat seeds; it needs no illegal forward site.
- No-threat saving, insufficient expansion funding, overlap saturation, deadline and terminal-win valuation, radar/visual deduplication, hidden-state invariance, deterministic repeats, save/load and once-only spending/settlement.

## One paired campaign smoke comparison

Frozen before/after sources run Medium, seeds 3 and 11, against the unchanged six `competitive-v1` policies. These seeds were already exposed in earlier work. Each batch repeats its first campaign; all v2 rows check save/load and once-only settlement/Adapt. This is a regression smoke test, **not fresh validation, a >70% gate result, or evidence of a human win rate**. No changes followed these campaign results.

| Seed | Policy | Before `731df29` | After | CPU SAMs / FOBs after |
|---|---|---|---|---:|
| 3 | direct-rush | home-base-destroyed | home-base-destroyed | 1 / 1 |
| 3 | flank | home-base-destroyed | home-base-destroyed | 1 / 1 |
| 3 | recon-strike | enemy-base-destroyed | home-base-destroyed | 2 / 1 |
| 3 | heavy-sam | enemy-base-destroyed | home-base-destroyed | 2 / 1 |
| 3 | forward-fob | home-base-destroyed | home-base-destroyed | 1 / 1 |
| 3 | recon-denial | home-base-destroyed | home-base-destroyed | 1 / 1 |
| 11 | direct-rush | home-base-destroyed | home-base-destroyed | 2 / 1 |
| 11 | flank | enemy-base-destroyed | home-base-destroyed | 3 / 1 |
| 11 | recon-strike | enemy-base-destroyed | home-base-destroyed | 4 / 1 |
| 11 | heavy-sam | enemy-base-destroyed | deadline | 2 / 1 |
| 11 | forward-fob | home-base-destroyed | home-base-destroyed | 2 / 1 |
| 11 | recon-denial | home-base-destroyed | home-base-destroyed | 2 / 1 |

Outcome names are player-relative: `home-base-destroyed` is a CPU offensive victory; `enemy-base-destroyed` is a player victory; `deadline` is a draw. The five attacking policies yield **5/10 before and 9/10 after** offensive victories. The separate non-attacking recon-denial control is 2/2 CPU base kills in both. All 24 campaign rows report zero illegal CPU orders.

Every after-row built a FOB in this tiny cohort; that does not establish broad selectivity or an optimal investment policy. Negative scenarios separately verify that no-threat or unaffordable expansion is rejected. Wider campaign competitiveness remains unmeasured for this revision; historical fresh rates predate it.

Production fingerprints:

- Before: `40ccc5ba22be0099a544ae29b3bbd9ee9381620e9815ba0f018df42286f612e5`.
- After: `7822c1ab375d81b5ca397fddbfe2576f5ef8b9ff4610b5e26cd979ed4dae92a1`.
- Unchanged harness: `fcb6ae93a5d26055ed6bf4a86ee6858908ef53168e3bcc4e58b7c029cf187483`.

Complete records, source file lists and hashes are retained in `territory-defense-before.json` and `territory-defense-after.json`.
