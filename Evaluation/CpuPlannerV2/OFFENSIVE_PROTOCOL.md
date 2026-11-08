# Offensive campaign evaluation

The completion gate is **greater than 70% base-destruction victories on each of
Easy, Medium and Hard** against the five attacking policies. A victory requires
both CPU victory under the existing campaign rules and player base health zero.
Deadline and aircraft-elimination victories are separate; recon-denial is a
non-attacking control and is excluded from the denominator.

Development seeds: 3, 11, 29, 47, 71, 89. Previously evaluated comparison seeds:
103, 127, 151, 173, 197, 229. Neither group is an untouched holdout.

The next fresh validation cohort is registered before running it: **263, 307,
349, 401, 443, 487, 541, 599, 647, 701, 751, 809**. Run it only after freezing
the candidate. Report every seed and every attacking policy, including failures.
If it informs further tuning it becomes development data; do not describe it as
an untouched holdout afterward. Repeated execution of unchanged code cannot
improve the deterministic result. No filtering seeds, weakening opponents,
changing combat odds/forces, or counting survival as offensive success.

Campaigns use the real deployment, order validation, fixed-tick combat, recovery,
intelligence, settlement, finite economy, and six-round conclusion. CPU orders
are committed before scripted player orders. Scripts consume authorized player
knowledge, never hidden CPU positions. Their limitations remain material: they
are fixed policies, not human or search-based opponents. They do not establish
human competitive strength.

The raw records include attempted strikes and launched missiles for both sides,
base damage, recovered intelligence, construction, budgets, recovery, illegal
orders and strategic decisions. They also distinguish player recon sorties,
recoveries, lost base reports and whether the player ever confirmed the CPU base;
absence of a strike is not automatically labeled successful intelligence denial.
Every v2 campaign checks repeated settlement and Adapt are no-ops. Source hashes
cover all production game TypeScript, the harness, and the preserved baseline. The preserved v1 planner and maintenance policy provide paired-seed
comparisons through the same current engine by default. This isolates planning
from shared engine corrections. `CPU_BASELINE_ENGINE=historical` separately
reproduces the original-engine comparison; do not pool the two rulesets. Raw
rows label their ruleset and outputs identify both production and harness hashes. Uncertainty must be calculated across campaign seeds, not by
treating all policy/difficulty matches as independent observations.

The original v2 evaluation remains in `results.json`; new runs write
`offensive-results.json` by default. `CPU_SEEDS`, `CPU_DIFFICULTY`, `CPU_POLICY`,
and `CPU_V2_ONLY` permit explicitly labeled diagnostic subsets. `CPU_TRACE=1`
prints post-resolution diagnostic state and decision traces. No diagnostic
state is fed into the CPU planning snapshot.

## Script compatibility correction — 2026-11-08

Policy version `fixed-policies-v2-compatible-recovery` validates all player orders
as a package. The original scripts validated individual orders and could
overbook a FOB. When their proposed orders conflict, the corrected script
enumerates at most eight hold/order subsets and retains the highest-priority
legal combination: unknown-base reconnaissance, strikes, staging, then patrol.
It adds no information or resources. Both v1 and v2 face the corrected scripts,
and raw rows count package adjustments. Older policy-version results that did
not check collective player capacity remain historical, provisional evidence.
The scripts still do not make midflight RTB decisions or adapt like a human.


## Competitive opponent revision — 2026-11-08

The user has reaffirmed **rapid destruction of the enemy base** as the objective;
force elimination and deadline survival remain separate outcomes. The old
`fixed-policies-v2-compatible-recovery` suite remains a historical comparison.
Its intended attacking policies frequently never attacked and cannot establish
a competitive win rate. Do not pool it with the stronger suite.

`CPU_OPPONENTS=competitive` selects `competitive-v1` on the current shared engine:

- Direct/flank policies collect with two fighters plus recon until confirmation,
  then assign both fighters legal base strikes.
- Recon-strike/heavy-SAM policies put one fighter on the collection corridor and
  use the other to collect; forward-FOB can physically stage before confirmation.
- Strike candidates compare alternate legal releases and one-bend routes against
  only confirmed SAM/AAA coordinates. No hidden CPU plan enters the script.
- Player recon uses real next-tick RTB commands after a legitimate live base
  sighting, critical own condition, or a sensed threat. The sensor adapter uses
  the engine's exact fixed-site observation radius; remote hidden sites have no
  effect on commands.
- Paid SAM construction ranks legal sites on observed/confirmed inbound
  approaches. Resources, recovery, combat and six-round limits are unchanged.

This suite remains scripted. Report how many campaigns actually issued strikes
and launched missiles, and how many CPU base kills occurred with no player
strike. Intelligence denial can prevent attacks, but such matches alone do not
establish strength against an attacking human. Keep all policy/seed failures.
Run both the original v1 and the immediately previous CPU v2 (`f7f9998`) against
the same new opponents when assessing this revision. The registered fresh seeds
remain untouched until the candidate passes development validation.
