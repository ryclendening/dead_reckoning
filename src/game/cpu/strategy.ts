import type { CpuPlanningView } from './planningView'
import type { CpuDecisionTrace, CpuIntent, TacticalPackage } from './types'

const intentions:CpuIntent[]=['discover','protect-base','expand-defense','forward-position','suppress-defenses','strike-base','contest-air']
function advances(view:CpuPlanningView,intent:CpuIntent,p:TacticalPackage):boolean {
  const e=p.predicted, c=contribution(view,p)
  switch(intent) {
    case 'discover':return e.informationGain>0&&e.baseDamage===0&&e.futureStrikeAccessGain===0&&c.survival<c.discovery
    case 'protect-base':return e.ownBaseRiskReduced>0&&c.survival>=c.discovery&&e.baseDamage===0
    case 'expand-defense':return e.defenseCoverageGain>0
    case 'forward-position':return e.futureStrikeAccessGain>0&&(p.orders.some(o=>o.mission==='transit'&&o.sortieOrdered!==false)||p.purchases.some(c=>c.actionId==='build-fob'||c.actionId==='repair-fob'))
    case 'suppress-defenses':return e.futureStrikeAccessGain>0&&p.orders.some(o=>o.mission==='base-strike'&&e.baseDamage===0)
    case 'strike-base':return e.baseDamage>0
    case 'contest-air':return p.orders.some(o=>o.mission==='forward-patrol'&&o.sortieOrdered!==false)
  }
}
/** All goals use the same measured effects and common campaign contribution scale. */
export function contribution(view:CpuPlanningView,p:TacticalPackage):Record<string,number> {
  const e=p.predicted,remaining=7-view.round, horizon=Math.max(0,(remaining-e.roundsUntilPayoff)/remaining)
  const base=view.cpu.sites.find(s=>s.kind==='base'&&s.health>0)
  const health=view.homeHealth, danger=health<=60?1.4:1
  const decisive=base&&e.baseDamage>=.99?1.5:1
  const components = {
    strike:e.baseDamage*decisive,
    survival:e.ownBaseRiskReduced*danger,
    discovery:e.informationGain*.38*horizon,
    access:e.futureStrikeAccessGain*.85*horizon,
    attrition:-e.expectedAircraftLoss*(view.round===6?.12:.26),
    spending:-e.logisticsSpent/Math.max(10,view.cpu.logistics)*.18,
    delay:-e.roundsUntilPayoff/Math.max(1,remaining)*.04,
  }
  return Object.fromEntries(Object.entries(components).map(([k,v])=>[k,v===0?0:v]))
}
export function choosePackage(view:CpuPlanningView,packages:TacticalPackage[],rejected:string[],expansions:number):{package:TacticalPackage;intent:CpuIntent;trace:CpuDecisionTrace} {
  const score=(p:TacticalPackage)=>Object.values(contribution(view,p)).reduce((a,b)=>a+b,0)
  const alternatives=intentions.flatMap(intent=>{
    const options=packages.filter(p=>advances(view,intent,p)).sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id))
    const best=options[0];return best?[{intent,package:best,score:score(best),components:contribution(view,best)}]:[]
  })
  const prior=view.cpu.intent??view.cpu.plan?.intent
  const validPrior=alternatives.find(c=>c.intent===prior)
  // Friction is bounded to 3 contribution points; impossible/completed goals have no entry.
  alternatives.sort((a,b)=>(b.score+(validPrior&&b.intent===prior?.03:0))-(a.score+(validPrior&&a.intent===prior?.03:0))||a.intent.localeCompare(b.intent))
  const saving=packages.find(p=>p.id==='save')??packages[0]
  const top=alternatives[0]
  const near=alternatives.filter(c=>top.score-c.score<=.06)
  const chosen=view.cpu.difficulty==='easy'&&near.length?near[Math.abs(Math.imul(view.cpu.seed+view.round,31))%near.length]:top
  const selected=chosen&&chosen.score>score(saving)?chosen:{intent:'protect-base' as const,package:saving,score:score(saving),components:contribution(view,saving)}
  return {package:selected.package,intent:selected.intent,trace:{round:view.round,
    observedEvidenceIds:[...view.cpu.sites.map(s=>`site:${s.id}:r${s.observedRound}`),...view.cpu.traffic.map((t,i)=>`traffic:r${t.observedRound}:${t.sector??i}`),...(view.homeHealth<100?[`own-base-health:${view.homeHealth}`]:[])],
    alternatives:alternatives.map(c=>({intent:c.intent,bestPackageScore:c.score,reason:c.package.summary,components:c.components})),selected:selected.intent,previous:prior,scoreDelta:selected.score-(validPrior?.score??0),switchReason:prior===selected.intent?'Continue feasible intent.':!validPrior?'Previous intent completed or has no feasible payoff.':'A stronger achievable package exceeds commitment friction.',chosenEffects:selected.package.predicted,chosenChecks:selected.package.checks,
    chosenPackageSummary:selected.package.summary,rejected:[...new Set(rejected)].slice(0,24),work:{packages:packages.length,routeExpansions:expansions}}}
}
