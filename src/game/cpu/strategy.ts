import { BASE_STRIKE_DAMAGE } from '../campaign'
import { formationField, isOperationalAirfield } from '../forwardBasing'
import type { CpuPlanningView } from './planningView'
import type { CpuDecisionTrace, CpuIntent, TacticalPackage } from './types'

const intentions:CpuIntent[]=['discover','protect-base','expand-defense','forward-position','suppress-defenses','strike-base','contest-air']
/** Discounted base HP removed by a repeated, currently achievable capability.
 * Preparation consumes real campaign rounds. No invented repairs, opponent
 * actions, or future observations are included in this estimate. */
export function baseAttackValue(view:CpuPlanningView,p:TacticalPackage):number {
  const base=view.cpu.sites.find(s=>s.kind==='base'&&s.health>0),attack=p.baseAttack
  if(!base||!attack)return p.predicted.baseDamage
  const remaining=7-view.round,discount=.72
  let health=base.health,value=0
  for(let offset=0;offset<remaining;offset++) {
    const available=offset===0?attack.damageNow:offset>=Math.max(1,attack.preparationRounds)?attack.followupDamage:0
    const damage=Math.min(health,Math.max(0,available))
    value+=damage/base.health*discount**offset
    health-=damage
    if(health<=.001){value+=.75*discount**offset;break}
  }
  // Among otherwise equivalent strikes, prefer releasing earlier. A lengthy
  // recovery does not delay the current payload; ingress time does.
  return value*(attack.confidence??1)/(1+attack.releaseSeconds/100)
}
/** Value a recovered discovery by the currently owned strike capability it
 * could enable next round. Public opening geography is within fighter reach;
 * a subsequently recovered outlying target still needs real routes/staging. */
export function discoveryAttackValue(view:CpuPlanningView):number {
  const payload=view.cpu.formations.filter(f=>f.role==='fighter'&&f.aircraft>0&&f.status!=='trapped'&&view.assets.some(a=>a.id===formationField(view.assets,f.id)?.id&&isOperationalAirfield(a)))
    .reduce((n,f)=>n+Math.round(BASE_STRIKE_DAMAGE*(f.strength??100)/100),0)
  let health=100,value=0
  for(let offset=1;offset<7-view.round;offset++) {
    const damage=Math.min(health,payload)
    value+=damage/100*.72**offset;health-=damage
    if(health<=0){value+=.75*.72**offset;break}
  }
  return value
}
function advances(intent:CpuIntent,p:TacticalPackage,c:Record<string,number>):boolean {
  const e=p.predicted
  switch(intent) {
    case 'discover':return e.informationGain>0&&e.baseDamage===0&&c.survival<c.discovery&&c.discovery>=c.access
    case 'protect-base':return e.ownBaseRiskReduced>0&&c.survival>=c.discovery&&e.baseDamage===0
    case 'expand-defense':return e.defenseCoverageGain>0
    case 'forward-position':return e.futureStrikeAccessGain>0&&(p.orders.some(o=>o.mission==='transit'&&o.sortieOrdered!==false)||p.purchases.some(c=>c.actionId==='build-fob'||c.actionId==='repair-fob'))
    case 'suppress-defenses':return e.futureStrikeAccessGain>0&&p.orders.some(o=>o.mission==='base-strike'&&e.baseDamage===0)
    case 'strike-base':return e.baseDamage>0
    case 'contest-air':return e.baseDamage===0&&p.orders.some(o=>o.mission==='forward-patrol'&&o.sortieOrdered!==false)
  }
}
/** All goals use the same measured effects and common campaign contribution scale. */
export function contribution(view:CpuPlanningView,p:TacticalPackage):Record<string,number> {
  const e=p.predicted,remaining=7-view.round, horizon=Math.max(0,(remaining-e.roundsUntilPayoff)/remaining)
  const health=view.homeHealth
  // The second useful defensive layer can matter; saturation prevents spending
  // every remaining Logistics point on capacity beyond the immediate need.
  const protection=(1-Math.exp(-3*e.ownBaseRiskReduced))*(.6+.4*(100-health)/100)
  const operation=baseAttackValue(view,p)
  const collecting=p.baseAttack&&e.baseDamage===0&&!p.orders.some(o=>o.mission==='base-strike'&&o.sortieOrdered!==false)
  const components = {
    strike:e.baseDamage>0?operation:0,
    survival:protection,
    discovery:e.informationGain*(view.cpu.sites.some(s=>s.kind==='base'&&s.health>0)?.85:(p.discoveryPayoff??discoveryAttackValue(view)))*horizon,
    // A concrete base operation already includes the follow-through. Do not
    // count suppression's risk reduction again as an independent reward.
    access:p.baseAttack?collecting||e.baseDamage>0?0:operation:e.futureStrikeAccessGain*.85*horizon,
    // Concrete operations already lose value through ingress damage, reduced
    // follow-up capability or failed report recovery. Keep a residual resource
    // cost without charging the old full penalty a second time.
    attrition:-e.expectedAircraftLoss*(p.baseAttack||view.round===6?.12:.26),
    spending:-e.logisticsSpent/Math.max(10,view.cpu.logistics)*.18,
    delay:-e.roundsUntilPayoff/Math.max(1,remaining)*.04,
  }
  return Object.fromEntries(Object.entries(components).map(([k,v])=>[k,v===0?0:v]))
}
export function choosePackage(view:CpuPlanningView,packages:TacticalPackage[],rejected:string[],expansions:number,searches:Iterable<{optimal:boolean}|undefined>=[]):{package:TacticalPackage;intent:CpuIntent;trace:CpuDecisionTrace} {
  const searchResults=[...searches].filter((s):s is {optimal:boolean}=>!!s)
  const evaluations=new WeakMap<TacticalPackage,{components:Record<string,number>;score:number}>()
  const evaluate=(p:TacticalPackage)=>{let result=evaluations.get(p);if(!result){const components=contribution(view,p);result={components,score:Object.values(components).reduce((a,b)=>a+b,0)};evaluations.set(p,result)}return result}
  const score=(p:TacticalPackage)=>evaluate(p).score
  const alternatives=intentions.flatMap(intent=>{
    const options=packages.filter(p=>advances(intent,p,evaluate(p).components)).sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id))
    const best=options[0];return best?[{intent,package:best,score:score(best),components:evaluate(best).components}]:[]
  })
  const prior=view.cpu.intent??view.cpu.plan?.intent
  const validPrior=alternatives.find(c=>c.intent===prior)
  // Friction is bounded to 3 contribution points; impossible/completed goals have no entry.
  alternatives.sort((a,b)=>(b.score+(validPrior&&b.intent===prior?.03:0))-(a.score+(validPrior&&a.intent===prior?.03:0))||a.intent.localeCompare(b.intent))
  const saving=packages.find(p=>p.id==='save')??packages[0]
  const top=alternatives[0]
  const near=alternatives.filter(c=>top.score-c.score<=.06)
  const chosen=view.cpu.difficulty==='easy'&&near.length?near[Math.abs(Math.imul(view.cpu.seed+view.round,31))%near.length]:top
  const selected=chosen&&chosen.score>score(saving)?chosen:{intent:'protect-base' as const,package:saving,score:score(saving),components:evaluate(saving).components}
  return {package:selected.package,intent:selected.intent,trace:{round:view.round,
    observedEvidenceIds:[...view.cpu.sites.map(s=>`site:${s.id}:r${s.observedRound}`),...view.cpu.traffic.map((t,i)=>`traffic:r${t.observedRound}:${t.sector??i}`),...(view.homeHealth<100?[`own-base-health:${view.homeHealth}`]:[])],
    alternatives:alternatives.map(c=>({intent:c.intent,bestPackageScore:c.score,reason:c.package.summary,components:c.components,baseAttack:c.package.baseAttack})),selected:selected.intent,previous:prior,scoreDelta:selected.score-(validPrior?.score??0),switchReason:prior===selected.intent?'Continue feasible intent.':!validPrior?'Previous intent completed or has no feasible payoff.':'A stronger achievable package exceeds commitment friction.',chosenEffects:selected.package.predicted,chosenBaseAttack:selected.package.baseAttack,chosenChecks:selected.package.checks,
    chosenPackageSummary:selected.package.summary,rejected:[...new Set(rejected)].slice(0,24),work:{packages:packages.length,routeExpansions:expansions,routeSearches:searchResults.length,optimalRouteSearches:searchResults.filter(s=>s.optimal).length}}}
}
