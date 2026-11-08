# CPU v2: strategic planner + tactical action planner

Status: **implementation plan**, 2026-11-07. This replaces the broad original CPU proposal with a smaller, outcome-driven architecture. The previous version remains available in Git history. **Not implemented by writing this plan.** `GAMEPLAY_STATE.md` is authoritative for shipped mechanics; update it only as code lands.

## Outcome and design constraints

Make the CPU a credible six-round opponent that (a) finds valuable enemy sites, (b) protects its own base as exposure grows, (c) expands SAM coverage when justified, (d) builds/stages at FOBs when they enable a concrete mission, and (e) attacks confirmed targets using routes that account for known SAM/AAA danger. It must respond to *observable* enemy behavior, including apparent direct and flank approaches, without reading the player's hidden orders or knowledge.

**Architecture: two decision layers, not separate playbooks.**
- **Strategic planner:** ranks a *small* set of candidate campaign intentions given an authorized observation snapshot, remaining rounds, economy, and *best available tactical opportunity*. Retain its chosen intention with bounded switching friction. Intentions are preferences, never gameplay modes or new combat rules.
- **Tactical planner:** enumerates and validates shared **action packages** (aircraft mission/routes, purchases/placements, recovery and staging). Scores their measurable effects relative to each intention, then returns a feasible package. All movement, combat, detection, construction and landing still resolve through the existing game engine.
- **World knowledge:** one compact persistent CPU record of recovered sites, observed tracks/approaches, own units/assets, attempts and outcomes. Recompute sector interest and threat coverage as derived views rather than persisting a second synthetic map.

Do **not** create special exceptions such as “strike aircraft ignore contacts when player spotted,” “CPU gets free SAMs after discovery,” or “FOB teleports a fighter.” Use the same side-aware rules as a human.

## Current code audit: what v2 replaces

| Current code on main | Problem / actual gap | v2 change |
| --- | --- | --- |
| `src/game/cpu/planner.ts:planCpu` | Flat fixed mission scores (defend/patrol/escort/strike); no campaign intent or explicit progress | Two-level strategy-to-package evaluation with campaign value and switching |
| `cpu/planner.ts:CPU_PROFILES` | Difficulty mainly changes offsets, risk weights, escort bonus; Hard can become merely conservative | Same actions/rules; vary search effort, evaluation accuracy and occasional suboptimal selection; verify via benchmarks |
| `ingressAlternatives` and `bestOrder` | Direct/one-bend flanks; fighter always starts/recovers at `e-base`; no multi-threat routing | Field-aware route candidate generator, real release/recovery checks, bounded search if simple candidates fail |
| `cpu/settlement.ts:maintainCpu` | Replaces/repairs in fixed order until money runs out; no construction, upgrade or save option | Compare a bounded set of legal purchase/placement packages and cash preservation against current strategic need |
| `cpu/types.ts` | Only two formations, recovered site reports, limited traffic, last-recon-lost flag | Add only necessary goal, basing, observed-approach, and decision-outcome memory; migrate saves once |
| `forwardBasing.ts`, `routeTemplates.ts`, economy / placement helpers | Player-centric functions and assumptions prevent real CPU FOB/construct/recover lifecycle | Extract explicit side-aware validators and commands; one shared mechanic implementation |
| `cpu/cpu.test.ts` | Deterministic capability tests, no meaningful competitive evaluation | Add behavioral scenarios and paired-seed campaign benchmarks |

Already working and **retain**: persistent CPU aircraft/losses; recovery-gated target intelligence; private sensing; fighter missions and recon RTB; support-site strike impact; deterministic saving/settlement. Do not rewrite these just to create a new abstraction.

## Planner contract

```ts
type Intent =
  | "discover" | "protect-base" | "expand-defense"
  | "forward-position" | "suppress-defenses"
  | "strike-base" | "contest-air";

interface StrategicCandidate {
  intent: Intent;
  goal: string;                 // measurable desired change, not script
  rationale: string[];
}
interface TacticalPackage {
  orders: CpuAircraftOrder[];   // one feasible action per available formation, or hold
  purchases: CpuEconomyCommand[]; // ordered, affordable, validated
  predicted: {
    informationGain: number;
    baseDamage: number;
    ownBaseRiskReduced: number;
    defenseCoverageGain: number;
    futureStrikeAccessGain: number;
    expectedAircraftLoss: number;
    logisticsSpent: number;
    roundsUntilPayoff: number;
  };
  checks: string[];             // canonical validators applied
}
interface CpuDecisionTrace {
  round: number;
  observedEvidenceIds: string[];
  alternatives: Array<{ intent: Intent; bestPackageScore: number; reason: string }>;
  selected: Intent;
  chosenPackageSummary: string;
}
```

This is a *conceptual interface*, not an instruction to introduce elaborate class hierarchies. Begin with plain functions and narrow data types. `strategy.ts` enumerates/ranks intentions; `actions.ts` generates packages; `routes.ts` and `placement.ts` generate spatial candidates; `planner.ts` orchestrates; `settlement.ts` records outcomes. A separate knowledge module is warranted only when it reduces duplicated logic. Avoid eight interdependent “agent” services, generic GOAP infrastructure, generic effect graphs and arbitrary per-strategy route implementations.

**Selection sequence each phase:**
1. Construct a sanitized CPU view: own inventory/assets, confirmed recovered sites, last *observed* tracks/approach sectors, actual own outcomes, public mechanics, and remaining rounds.
2. Enumerate 4–7 relevant intentions; prune those without a plausible payoff before deadline.
3. For each intention, generate a bounded set of *legal* tactical packages from the same action library. Include “hold/save” as a genuine candidate.
4. Score the **best achievable package in context** for each intention. No strategy wins merely because its label has a high base score.
5. Choose the best intention + package, with a small commitment/switch cost; drop that cost immediately if the current plan is completed, invalidated, or clearly dominated.
6. Commit spending once at Adapt, and immutable mission orders once before player Plan edits. Use the same settlement/phase idempotence and separate deterministic CPU random stream as v1. If purchase occurs at Adapt and flight at next Plan, save a provisional intent and re-evaluate the available route then.

Use a common estimated *campaign contribution* (survival probability, chance of completing a decisive strike, information that changes actionable options) as the primary utility. Normalize secondary costs such as expected losses, logistics, and time delay. Do not simply add arbitrary 72/54/35 mission bonuses. Approximate probabilities are fine; preserve score breakdowns so weights can be calibrated. A strategic plan with no legal tactical payoff must score poorly. Limit search by candidate/expansion count, not wall clock.

**Victory asymmetry to acknowledge:** the existing deadline awards the CPU victory if its base survives all six rounds. A pure win-probability optimizer may rationally turtle. Test whether that produces unfun behavior; require measurable offensive pressure in *benchmark design* instead of secretly inventing extra victory rules. Changing the win condition is a separate gameplay decision.

## Shared tactical actions and spatial generators

Use the real `ROUTE_TEMPLATES` mission IDs and canonical side-aware economy/recovery/placement validators. Tactical actions should be *instantiated candidates*, not independent strategic scripts:

| Action | Candidate generation | Preconditions and evaluation |
| --- | --- | --- |
| Recon Search Area | Prioritize reachable unexplored sectors and gaps along possible strike approaches | Search sweep, recovery and escort feasibility; expected *new actionable* information vs loss risk |
| Fighter Protect / escort | Home, important SAM/FOB, or actual recon route | Existing fixed/moving responsibility and range; time-on-station; actual overlap with threat/recon route |
| Fighter Forward Patrol | Recent *observed* inbound corridors, including off-axis/flank approaches | Existing corridor/pursuit/fuel rules; likely intercept opportunity; no pursuit outside mission rules |
| Fighter Ground Strike | Confirmed base, SAM, AAA, radar or FOB; candidate release points within 6 units | Recovered confirmation, base 60-pressure gate, fuel, launch and recovery; compare expected target effect and known risk |
| Fighter Transit | Every reachable operational owned field, including new FOBs | Field capacity, route and next-round value; changes *actual basing* only after recovery |
| SAM / AAA Build | Sample legal owned/recovered hexes; focus on base, FOB, and observed approach coverage | Shared placement rules and affordability; incremental coverage, overlap, reach, time to benefit; SAM 8 / AAA 6 Logistics |
| FOB Build | Sample legal reachable hexes between current field and valuable known/likely target sectors | Shared FOB reach (7 from territory edge), placement, cost 8, 2 slots; count build + transit time and improvement to a named future mission |
| Repair / Replace / Upgrade / Save | Available legal quotes; 0–2 step combinations before next mission | Compare restored capability and future value, reserves, scarce budget; no free replenishment or unsupported purchase |

For aircraft, evaluate **compatible packages** across the one fighter and one recon, not separate greedy winners (one fighter cannot escort and strike). For spending, compare only the few best options plus save; do not enumerate all purchase sequences or combinations of every placement hex. Generate top K spatial candidates, then validate each through the exact engine rules. Reserve enough resources for committed follow-on actions when they are legally affordable and likely to matter.

**Route search policy:** first test direct, lateral flanks, and alternate release points from the *actual operating field*. If those are blocked or clearly inferior, run a bounded weighted search over known traversable hexes/corridors and validate simplified paths. Use known SAM/AAA envelopes, observed fighter corridors, max distance, strike release range, waypoint cap, operating field and recovery. Treat threats as *expected cost*, not impassable walls; a risky direct strike may be correct near the deadline. Never access hidden SAMs or true boundaries for scoring. Use shared engine attack/reaction rules, not new tactical interceptions.

**FOB value is conditional:** prefer a FOB only if it enables a concrete subsequent search/strike/recovery/patrol that is infeasible or materially safer from current basing, after paying build+transit opportunity costs. Building a FOB does not stage a formation automatically. Existing player-side first-crossed-FOB and strike-recovery exception must be preserved, and new CPU-owned fields must support disabled, trapped and diversion outcomes.

## Context-specific behavior: evidence -> candidate effects, not scripted switches

These cases should materially change **scores and spatial candidates**, without hard-coding “if X, always Y.”

| Observable situation | Strategic pressure | Tactical candidates that should become more valuable | Avoid |
| --- | --- | --- | --- |
| Opponent has **not been observed** near CPU territory; base undamaged | Discovery + prudent baseline defense; keep strike options open | Recon useful sectors; protect recon when credible aircraft risk; save for SAM/FOB if no good placement yet | Dump all money into SAMs merely because round advanced |
| Opponent recon or fighter **visually/radar detected near base** | Increased protection and defensive coverage | Protect base, patrol observed ingress, SAM/AAA at legal high-coverage sites; alternative recon route | Treat a detected aircraft as proof opponent permanently knows base coordinates |
| Enemy **recon recovered after spotting CPU base** (hidden to CPU unless observed) | No omniscient discovery flag | Act only on CPU-witnessed flight/contact, weapon launch, or damage. Confidence can rise with repeated observed recon and survived departures, but never certainty from hidden enemy reports | Read player `knownWorld`, hidden reports, or `baseExposure` as “player has found us” unless that field is explicitly CPU-authored knowledge |
| Opponent **directly strikes or damages CPU base** | High protect/expand-defense urgency; later rounds especially urgent | Cover confirmed direct corridor, repair useful defenses, place SAM for incremental coverage, continue valid offensive options | Assume the same exact attack route next round or rebuild a destroyed base via nonexistent action |
| Opponent **attacks from a flank** (observed off-axis ingress) | Shift defense value to that sector | Place SAM/AAA covering vulnerable approach, patrol that corridor, shift protect point within mission envelope | Static defense forever pointed at center line; infer unseen future aircraft positions |
| CPU finds enemy **base with weak known defense** | Immediate strike-base value rises | Generate direct and alternate release routes; attack if authorized and expected payoff beats delay | Build FOB or suppress SAM without a concrete advantage |
| CPU finds enemy base **covered by confirmed SAM(s)** | Suppress-defenses or safe alternate strike route | Compare around-SAM release, strike SAM, flank, FOB staging if it improves reachable access | Always strike SAM; overfly target unnecessarily; ignore strike range |
| CPU knows useful enemy region but **cannot reach safely** | Forward-position value rises if sufficient rounds/funds | Candidate FOB placement -> build -> Transit -> strike, all with legal recovery | FOB construction with no achievable follow-on operation; teleporting units |
| CPU loses recon in unexplored area, **cause unknown** | Value alternate search and preservation, not imaginary SAM certainty | Explore another corridor, consider escort *only if fighter threat evidence supports it* | Assume exact SAM/loss location or obligatorily escort |
| CPU is low on aircraft, funds or rounds | Survival and near-term payoff weighted up | Repair/replace when action can be used, save or strike now rather than slow infrastructure | Spend on construction whose payoff arrives after round six |

**Base-discovery nuance:** there is presently no fair CPU-visible ground-truth signal that the *player's knowledge* contains the CPU base. A recon contact is only a clue; damage is hard evidence of targeting. If designers want an explicit “enemy base discovered” warning, first add a *symmetric, observable* event that a human player would also receive, rather than reading hidden player state.

**Defensive buildout:** “rapid SAM buildout once threatened” means promptly spending on **marginal coverage that protects relevant assets**, within actual income/placement limits. Starting CPU budget is 10 and a SAM costs 8; it cannot spam cost-free defenses. Prefer defense where attack risk and uncovered approach coincide; compare with needed fighter maintenance and offensive follow-through. No predetermined number of SAMs.

## Knowledge and memory: smallest sufficient record

Retain recovered stationary-site coordinates (and observation date), current authorized radar/visual tracks for in-sortie reactions, a bounded recent **observed approach** history (sector, bearing, observed time, source), own sortie success/failure, own inventory/resources/basing and current strategic intent. Derive threat/exploration coverage on demand. Treat stale aircraft traffic as *uncertain sector likelihood*, not exact current aircraft position. Update unconfirmed site health only through legitimate observations. A lost recon carries no unrecovered hidden target data. No persistent probabilistic 2-D belief grid, player-style classifier, or simulated opponent state for v2.

## Implementation slices (do not attempt all at once)

**Slice 1 — truthful side-aware infrastructure**
- Build explicit `SidePlanningContext` for economy, placement, airfield/recovery, route and sensor validation. Use the same rule functions for player and CPU; keep player UI visibility separate.
- Add CPU-owned FOB basing and construction/repair settlement and legal SAM/AAA construction with once-only economy application. Generalize enemy routes to start at actual formation fields and resolve normal landings. Maintain legacy saves, 2-aircraft recon strength, and tactical fixtures.
- **Gate:** CPU-built SAM engages like player SAM; CPU FOB construction and later Transit actually relocates a fighter; damage disables FOB and causes legitimate trap/diversion. No duplicated money, illegal sites, free aircraft or hidden world access.

**Slice 2 — strategic/tactical split**
- Replace flat `planCpu` score table with intention candidates + shared action-package evaluation; include protect, discovery, strikes, construction, save and transit options. Migrate v1 planning data conservatively, preserve deterministic commitment.
- Expose structured *developer-only* decision trace with observed evidence, top intentions, feasible packages, score components, selected option, and rejection reasons.
- **Gate:** confirmed base + weak defense leads to timely strike; damaged own base increases protective action value; no nearby opponent evidence does not force expensive build; a currently impossible FOB plan loses to an executable action.

**Slice 3 — spatial competence and forward sequence**
- Search and score placement hexes for incremental SAM coverage and feasible FOB *follow-on* missions. Add threat-aware release/route candidates; bounded hex/corridor search only when simple candidates are insufficient.
- **Gate:** known SAM is bypassed when safer valid release exists; if not, suppression can outrank immediate attack; FOB is built and occupied *only when it demonstrably expands a valuable sortie option*; fuel/recovery and landing validation hold for both sides.

**Slice 4 — adaptive behavior and measurable competition**
- Track only legitimately observed approach bearings/sectors and mission results. Re-score each round with switching friction and remaining-round urgency.
- Run reproducible paired-seed full six-round campaigns against scripted player policies: (i) direct base rush, (ii) flank attack, (iii) recon search then strike, (iv) heavy SAM defense, (v) FOB expansion, (vi) recon denial. Compare v1 vs v2 and Easy/Medium/Hard.
- **Gate:** zero invalid orders, hidden-information leaks and duplicate settlements; v2 improves CPU win rate or credible offensive pressure against agreed opponents without regressing badly against others. Report outcomes, enemy-base damage, own-base damage, intel gains, SAM marginal coverage, FOB use, sortie recovery, budgets, and action decisions. Do not claim superiority from a single seed.

## Explicit non-goals and code constraints

- No separate per-strategy tactical scripts, ML training, Monte Carlo opponent simulator, generic GOAP engine, continuously updated mid-flight campaign plan, or two-round game tree in v2.
- No extra missions, unit types, combat modifiers, free information, or changed victory rules to make AI look smart.
- No CPU decoy purchase until a symmetric in-engine benefit exists. Do not purchase Supply Depot for income-only ROI in a six-round game (cost 12; at most five subsequent +2 payouts after round one). Do not invent radar construction or base repair.
- Preserve existing base-pressure strike authorization at 60 pending a separately approved mechanics decision. All difficulties share information gates, costs and combat rules.
- Keep work isolated from unrelated development; run typecheck/unit tests after each slice and only claim a completed feature after a simulation test demonstrates its effect. Do not edit `GAMEPLAY_STATE.md` to describe planned work as shipped.

## Definition of done

A complete v2 CPU can combine reconnaissance, defense buildout, forward staging, known-threat avoidance and strikes *when those options are actually valuable*; it can counter observed direct/flank attacks; it never reads hidden player knowledge or violates the player's action constraints; it survives save/reload and six-round play; and its decisions and measured competitiveness are explainable from a compact developer trace. **Do not mark v2 complete for a difficulty dropdown, a set of score constants, or a list of new modules.**


## Implementation notes — 2026-11-08

The architecture is implemented; the user's subsequent >70% offensive-victory
target remains an explicit, unpassed validation gate while tuning continues.
`Evaluation/CpuPlannerV2/OFFENSIVE_PROTOCOL.md` defines that gate and the fresh
validation cohort. Do not count survival wins or non-attacking controls.

Material deviations from the original implementation bounds:

- Adapt evaluates up to four canonical purchase commands rather than two. The
  two-command bound excluded already-affordable combinations of construction,
  repair and replacement. The search remains a bounded beam over shared legal
  commands and removes equivalent purchase permutations. Costs, finite reserves
  and once-only execution are unchanged.
- Fighter collection can use a Transit route that returns to its owned field
  through a flank waypoint. This uses the existing player-legal waypoint,
  mission, fuel and recovery rules; it adds no mission or interception exception.
- CPU kill income now uses the same resolved-fire attrition confirmation as
  player income. The earlier recovered-observer-only implementation omitted
  legitimate ground-defense income. This does not grant hidden site reports.
- Private memory adds optional recovered visual strength/aircraft counts and
  bounded track-linked coarse samples. A derived public deployment prior and
  observed fighter corridors supplement tactical scoring. There is no persisted
  belief grid, opponent rollout, Monte Carlo policy, or campaign game tree.

Current selection is a bounded, analytic comparison of shared packages. It does
not estimate a calibrated probability of campaign victory. Return uncertainty
combines the two own observers' possible reports, and aircraft-loss cost uses
pips rather than equating a four-aircraft fighter with a two-aircraft recon.
Maintenance may value a concrete reachable strike after the next authorized
collection; it does not execute or simulate that future strike. Recovered own
damage survives repairs as attempt memory. Missing flights disclose no final
condition or hidden cause. Fuel-limited partial escort prefixes remain a CPU
candidate-generation gap; ordinary benchmark layouts have not demonstrated FOB
use, although the long-range build/Transit/strike acceptance scenario does.

FOB valuation currently covers known-base reach and known ground-threat cost.
Broader observed-air-route and reconnaissance staging value remains incomplete;
the ordinary scripted cohort has no CPU FOB use. These limitations are not
resolved by the successful long-range FOB capability fixture.


### Offensive priority revision — 2026-11-08

The subsequent user direction makes rapid enemy-base destruction the offensive
objective. Shared tactical packages now carry a compact optional base-attack
estimate: damage now, follow-up payload, preparation rounds, release time, and
collection confidence when another report must authorize the attack. The same
analytic discounted damage/completion calculation scores a direct strike,
suppression, and a named attack enabled by collection. It rewards earlier
completion before round six. A support site has no generic hit bonus.

Adapt evaluates these same packages after legal paid commands; the former
separate restoration-only bonus was removed. No hidden future orders, opponent
rollouts, invented repairs, or new combat/authorization rules are involved.
Forecasts are heuristic repeated-capability estimates, not calibrated outcome
probabilities or a simulation of future rounds. Current FOB utility still uses
its existing bounded access estimate; full offensive-clock valuation of FOB
staging and partial escort generation remain incomplete.

Evaluation adds `CPU_OPPONENTS=competitive`, version `competitive-v1`, separately
from the historical fixed scripts. It includes fighter collection, online player
recon RTB after legitimate local observation/threat, known-SAM strike avoidance,
and approach-oriented paid SAM placement. These remain scripts, and a no-strike
match is reported explicitly rather than assumed to prove competitive success.


Purchase search also seeds each formation's up-to-four-command legal restoration
sequence into the appropriate beam depths. These remain optional scored actions;
they prevent an initially weak replacement from pruning a fully affordable,
useful striker. Concrete attack estimates retain a reduced residual aircraft-loss
penalty because payload/return capability already accounts for damage risk.

Latest development results before the route-search revision: against
`competitive-v1`, base kills are Easy 16/30, Medium 15/30, Hard 15/30. The prior
v2 commit `f7f9998` scored 12/30, 11/30, 13/30 against the same opponents.
The historical fixed suite scores 18/30, 20/30, 16/30. **The >70% gate is not met.**
These are reused development seeds, not holdout evidence or human playtests.


### Threat-aware shortest-route revision — 2026-11-08

The user's route-algorithm request is implemented as a narrow resource-constrained
A* utility shared by the tactical generators. Its objective is Euclidean route
length plus additive exposure length inside recovered SAM/AAA/radar envelopes
and weighted coarse observed fighter sectors. Those weights are a route-ranking
surrogate, not actual combat damage probabilities. Strike searches compare all
profile-sampled legal release points together and include the actual direct
return to the launch field. Unknown defenses and true world boundaries are absent.

The graph connects the exact field to nearby public hex centers, six neighbors
per center, and exact candidate endpoints. Euclidean remaining distance plus
fixed endpoint recovery cost is an admissible heuristic. Separate labels for
heading/waypoint count retain the cost/fuel Pareto frontier, preserving shorter
paths that may be necessary to finish. Fuel, waypoint cap and canonical recovery
remain hard constraints. Exact collinear compression adds no unsafe shortcut.

Results distinguish a proved minimum weighted cost within this finite route
graph from a best-found result after exhausting the work allowance. This is not
a guarantee of the optimal continuous route, a globally optimal release point,
or an optimal combat outcome. The search allowance is 64/180/420 expansions on
Easy/Medium/Hard; a local cache shares results across isolated purchase copies.
The optimized candidate is retained alongside fast and low-risk candidates,
then the existing strategic/tactical valuation chooses an operation.

Independent exhaustive candidate enumeration checks one- and two-bend optima.
The two-SAM execution fixture reduces weighted route cost from 46.5046 to
42.9896 (33.5075-unit round trip), has zero modeled ingress exposure, launches
a full 60-damage payload, and remains within canonical fuel/recovery limits.
This capability result does not establish the >70% campaign target.
