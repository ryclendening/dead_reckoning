import { BASE_STRIKE_DAMAGE, BASE_STRIKE_RANGE } from '../campaign'
import { FLIGHT_SPEED, MAX_FLIGHT_DISTANCE, flightRangeFor, flightSpeedFor, routeDistance } from '../flightRules'
import { formationField, isOperationalAirfield, validateRecoveryPackage } from '../forwardBasing'
import { estimateEscortCoverage } from '../missionResponsibility'
import type { Squadron, Point } from '../types'
import type { CpuPlanningView } from './planningView'
import type { BaseAttackEstimate, CpuSiteReport, PredictedEffects, TacticalPackage } from './types'
import { CPU_PROFILES, cpuRouteRisk, distance, hold, missionOrders, orderRisk, recoveryView, strikeOrders, type RouteWork } from './routes'
import { searchPrior, collectionScorer, covers } from './search'
import { contribution, discoveryAttackValue } from './strategy'
import { observedThreat, residualApproachRisk, forwardValue } from './placement'
export const emptyEffects = (): PredictedEffects => ({ informationGain:0,baseDamage:0,ownBaseRiskReduced:0,defenseCoverageGain:0,futureStrikeAccessGain:0,expectedAircraftLoss:0,logisticsSpent:0,roundsUntilPayoff:0 })
export const SEARCH_SECTORS:Point[]=[[0,0],[-6,8],[0,8],[6,8],[-6,0],[6,0],[-6,-8],[0,-8],[6,-8],[-10,12],[0,12],[10,12],[-10,0],[10,0],[-10,-12],[0,-12],[10,-12]]
export function estimateBaseAttack(view:CpuPlanningView,order:Squadron,sites:CpuSiteReport[]=view.cpu.sites):BaseAttackEstimate {
  const strength=order.strength??100,ingress=orderRisk(view,order,sites,false),whole=orderRisk(view,order,sites)
  const delivered=(condition:number)=>Math.round(BASE_STRIKE_DAMAGE*condition/100)*Math.max(0,1-ingress/Math.max(1,condition))
  return {damageNow:delivered(strength),followupDamage:delivered(Math.max(0,strength-whole)),preparationRounds:0,releaseSeconds:routeDistance(order.route)/flightSpeedFor(order)}
}
/** Escort coverage reduces the air-threat part of collection risk, never SAM
 * exposure. Both single and joint packages use this same capability estimate. */
function protectedRisks(view:CpuPlanningView,orders:Squadron[],riskOf:(o:Squadron)=>number):(o:Squadron)=>number {
  const adjusted=new Map<Squadron,number>()
  for(const escort of orders.filter(o=>o.sortieOrdered!==false&&o.protectedTargetId)) {
    const target=orders.find(o=>o.id===escort.protectedTargetId&&o.sortieOrdered!==false)
    if(!target)continue
    const field=view.assets.find(a=>a.id===escort.plannedRecoveryFieldId),recovery=view.assets.find(a=>a.id===target.plannedRecoveryFieldId)
    if(!field)continue
    const coverage=estimateEscortCoverage({escortRoute:escort.route,protectedRoute:[...target.route,recovery?.position??view.home],escortSpeed:flightSpeedFor(escort),protectedSpeed:flightSpeedFor(target),recoveryPoint:field.position,maxDistance:flightRangeFor(escort)})
    const ground=cpuRouteRisk([...target.route,recovery?.position??view.home],target.role,view.cpu.sites,target)
    const risk=riskOf(target),protectedRisk=risk-Math.max(0,risk-ground)*coverage.percent/100*.6
    adjusted.set(target,Math.min(adjusted.get(target)??risk,protectedRisk))
  }
  return o=>adjusted.get(o)??riskOf(o)
}
function fighterActions(view: CpuPlanningView, work: RouteWork, fighter: Squadron): TacticalPackage[] {
  const cpu=view.cpu, recon=cpu.formations.find(f=>f.role==='recon')!, profile=CPU_PROFILES[cpu.difficulty]
  const packages:TacticalPackage[]=[],base=cpu.sites.find(s=>s.kind==='base'&&s.health>0),threat=observedThreat(view)*residualApproachRisk(view), remaining=7-view.round
  const prospectiveBaseOrders=base?strikeOrders(view,fighter,base,work):[]
  const earlyBaseOrders=prospectiveBaseOrders
  const prior=searchPrior(view),collect=collectionScorer(view,prior),risks=new WeakMap<Squadron,number>()
  const priorWeight=prior.reduce((n,p)=>n+p.weight,0)
  const militaryRegion=base?[{point:base.position,weight:1}]:prior
  const militaryWeight=base?1:priorWeight
  const witnessedFighters=cpu.traffic.some(t=>t.role==='fighter'&&view.round-t.observedRound<=2)
  const riskOf=(o:Squadron)=>{let risk=risks.get(o);if(risk===undefined){
    // Public opening forces can defend an unobserved operating region. This
    // uncertainty is not a hidden contact and disappears into observed risk.
    const uncertain=o.sortieOrdered!==false&&!witnessedFighters&&militaryWeight?militaryRegion.reduce((n,p)=>n+(covers(o.route,p.point,4.5)?p.weight:0),0)/militaryWeight*(o.role==='fighter'?60:25):0
    risk=orderRisk(view,o)+uncertain;risks.set(o,risk)
  }return risk}
  const confidence=(o:Squadron)=>Math.max(0,1-riskOf(o)/Math.max(25,(o.strength??100)+20))

  const sectors=SEARCH_SECTORS.filter(p=>distance(p,view.home)>=10)
  const clusters=cpu.sites.filter(s=>s.health>0&&s.kind!=='base'&&s.kind!=='decoy').map(s=>s.position)
  const candidates=[...sectors,...prior.filter(p=>p.weight>.15).map(p=>p.point),...clusters]
  const interest=new Map(candidates.map(p=>[p,prior.reduce((n,c)=>n+(distance(p,c.point)<5.5?c.weight:0),0)]))
  const searches=base
    ? Array.from({length:8},(_,i)=>[base.position[0]+Math.cos((i+cpu.searchIndex)*Math.PI/4)*3.4,base.position[1]+Math.sin((i+cpu.searchIndex)*Math.PI/4)*3.4] as Point)
    : [] as Point[]
  if(!base)for(const point of candidates.sort((a,b)=>interest.get(b)!-interest.get(a)!||distance(a,view.home)-distance(b,view.home))) {
    // Rejected neighboring grid points must not suppress later alternatives.
    if(searches.every(selected=>distance(point,selected)>3.5))searches.push(point)
    if(searches.length>=profile.sectors)break
  }
  const reconOptions=[hold(view,recon),...searches.slice(0,profile.sectors).flatMap(p=>[...missionOrders(view,recon,'search-area',p,work,cpu.lastReconLost?Math.min(48,flightRangeFor(recon)):flightRangeFor(recon)),...(cpu.traffic.some(t=>t.role==='fighter')?missionOrders(view,recon,'search-area',p,work,36):[])])]
  function information(order:Squadron):number {
    if(order.sortieOrdered===false)return 0
    return collect([order],confidence)*Math.min(1,(remaining-1)/2)
  }
  const rankedRecon=reconOptions.sort((a,b)=>information(b)-information(a)||riskOf(a)-riskOf(b)||routeDistance(a.route)-routeDistance(b.route))
  const sortedRecon:Squadron[]=[]
  for(const order of rankedRecon)if(sortedRecon.every(o=>distance(o.routeIngress.at(-1)!,order.routeIngress.at(-1)!)>2.5)){sortedRecon.push(order);if(sortedRecon.length===3)break}
  const usefulRecon=sortedRecon[0]??hold(view,recon)
  const add=(id:string,summary:string,order:Squadron,predicted:Partial<PredictedEffects>,reconOrder?:Squadron,baseAttack?:BaseAttackEstimate):void=>{
    if(!reconOrder){add(id+':recon-hold',summary,order,predicted,hold(view,recon),baseAttack);reconOrder=usefulRecon}
    const orders=cpu.formations.map(f=>f.id===order.id?order:f.id===reconOrder.id?reconOrder:hold(view,f)),ids=new Set(orders.filter(o=>o.sortieOrdered!==false).map(o=>o.id))
    const check=validateRecoveryPackage({playerAssets:view.assets,squadrons:orders},flightRangeFor,ids)
    if(!check.valid){work.rejected.push(`${id}: ${check.reason}`);return}
    const protectedRisk=protectedRisks(view,orders,riskOf),returnConfidence=(o:Squadron)=>Math.max(0,1-protectedRisk(o)/Math.max(25,(o.strength??100)+20))
    const effects={...emptyEffects(),informationGain:Math.min(1,collect(orders,returnConfidence))*Math.min(1,(remaining-1)/2),expectedAircraftLoss:orders.reduce((n,o)=>n+(o.sortieOrdered===false?0:Math.min(o.aircraft,protectedRisk(o)/100*o.maxAircraft)),0),...predicted}
    packages.push({id,summary,orders,purchases:[],baseAttack,predicted:effects,checks:['shared recovery / capacity / fuel','recovered targets','one order per formation']})
  }
  add('save','Hold aircraft and preserve cash.',hold(view,fighter),{},hold(view,recon))
  add('search','Collect actionable reconnaissance.',hold(view,fighter),{})
  if(!base) {
    for(const point of searches.slice(0,profile.sectors)) {
      const origin=formationField(view.assets,fighter.id)?.position??view.home
      const length=Math.max(.01,distance(origin,point)), scale=Math.min(1,18/length)
      const station:Point=[origin[0]+(point[0]-origin[0])*scale,origin[1]+(point[1]-origin[1])*scale]
      for(const order of missionOrders(view,fighter,'transit',station,work))for(const r of sortedRecon)
        add(`collect:${station}:${r.route.at(-1)}`,'Collect actionable base intelligence and return to the operating field.',order,{},r)
    }
  }
  const traffic=cpu.traffic.filter(t=>view.round-t.observedRound<=2)
  const points=[view.home,...(base?[[view.home[0]+(base.position[0]-view.home[0])/distance(base.position,view.home)*8,view.home[1]+(base.position[1]-view.home[1])/distance(base.position,view.home)*8] as Point]:[]),...view.assets.filter(a=>a.kind==='sam'&&a.health>0).map(a=>a.position),...traffic.filter(t=>distance(t.position,view.home)<12).slice(-2).map(t=>{
    const angle=t.bearing??Math.atan2(t.position[1]-view.home[1],t.position[0]-view.home[0]);return [view.home[0]+Math.cos(angle)*8,view.home[1]+Math.sin(angle)*8] as Point
  })]
  const nearbyBearings=traffic.filter(t=>distance(t.position,view.home)<14).map(t=>t.bearing??Math.atan2(t.position[1]-view.home[1],t.position[0]-view.home[0]))
  if(nearbyBearings.length){const angle=Math.atan2(nearbyBearings.reduce((n,a)=>n+Math.sin(a),0),nearbyBearings.reduce((n,a)=>n+Math.cos(a),0));points.push([view.home[0]+Math.cos(angle)*8,view.home[1]+Math.sin(angle)*8])}
  for(const point of points)for(const order of missionOrders(view,fighter,'defensive-cap',point,work)) {
    const nearby=traffic.filter(t=>distance(t.position,view.home)<14)
    const coverage=nearby.length?nearby.reduce((n,t)=>{const a=t.bearing??Math.atan2(t.position[1]-view.home[1],t.position[0]-view.home[0]);return n+Math.exp(-((distance([view.home[0]+Math.cos(a)*7,view.home[1]+Math.sin(a)*7],point)/4)**2))},0)/nearby.length:1
    add(`protect:${point}`,'Protect home and the observed approach.',order,{ownBaseRiskReduced:Math.min(1,threat*.35+.02)*coverage*Math.min(1,(fighter.strength??100)/100)})
  }
  for(const contact of traffic.slice(-2))for(const order of missionOrders(view,fighter,'forward-patrol',contact.position,work))add(`patrol:${contact.position}`,'Contest a recently observed traffic sector.',order,{ownBaseRiskReduced:threat*.2,futureStrikeAccessGain:0})
  for(const r of sortedRecon.filter(o=>o.sortieOrdered!==false)) {
    const field=formationField(view.assets,fighter.id),rfield=view.assets.find(a=>a.id===r.plannedRecoveryFieldId)
    if(!field)continue
    const coverage=estimateEscortCoverage({escortRoute:[field.position],protectedRoute:[...r.route,rfield?.position??view.home],escortSpeed:flightSpeedFor(fighter),protectedSpeed:flightSpeedFor(r),recoveryPoint:field.position,maxDistance:flightRangeFor(fighter)})
    if(coverage.recoveryFeasible&&coverage.percent>0) {
      // Draw the canonical feasible escort extent, never assign the longer recon sweep as a fighter route.
      const route:Point[]=[field.position,...r.route.slice(1)]
      const escort={...fighter,mission:'defensive-cap' as const,route,routeIngress:route,protectedTargetId:recon.id,protectedPoint:undefined,strikeTargetId:undefined,sortieOrdered:true,plannedRecoveryFieldId:field.id}
      if(recoveryView(view,escort)?.valid)add(`escort:${r.route.at(-1)}`,'Cover collection against observed or uncertain public fighter capability.',escort,{},r)
    }
  }
  const baseOrders=earlyBaseOrders
  const bestBaseRisk=baseOrders.length?Math.min(...baseOrders.map(o=>orderRisk(view,o))):0
  for(const site of cpu.sites.filter(s=>s.health>0&&s.kind!=='decoy')) {
    const after=cpu.sites.filter(s=>s.id!==site.id)
    const followups=base&&site.kind!=='base'&&baseOrders.length?baseOrders.map(o=>estimateBaseAttack(view,o,after)):[]
    const followup=followups.sort((a,b)=>b.damageNow-a.damageNow||a.releaseSeconds-b.releaseSeconds)[0]
    for(const order of site.kind==='base'?earlyBaseOrders:strikeOrders(view,fighter,site,work)) {
      const attack=estimateBaseAttack(view,order),payload=Math.round(BASE_STRIKE_DAMAGE*(fighter.strength??100)/100)
      const survive=payload?attack.damageNow/payload:0
      // A late release loses its operating field if an observed strike threat
      // can finish home first. Compare public travel bounds, not future orders.
      const witnessed=traffic.some(t=>t.role==='fighter')
      const urgency=witnessed?observedThreat(view):0
      const threatTime=base?Math.max(0,distance(view.home,base.position)-BASE_STRIKE_RANGE)/FLIGHT_SPEED.fighter+.6:Infinity
      const releaseTime=routeDistance(order.route)/flightSpeedFor(order)
      const timely=1-urgency+urgency/(1+Math.exp((releaseTime-threatTime)/.5))
      const baseDamage=site.kind==='base'?Math.min(1,attack.damageNow/site.health)*timely:0
      const suppressionTurns=Math.ceil(site.health/Math.max(1,attack.damageNow)), payoff=suppressionTurns+1
      const reduction=baseOrders.length?Math.max(0,bestBaseRisk-Math.min(...baseOrders.map(o=>orderRisk(view,o,cpu.sites.filter(s=>s.id!==site.id)))))/100:0
      const suppression=base&&remaining>=payoff?reduction*survive/suppressionTurns:0
      const operation=site.kind==='base'?{...attack,damageNow:attack.damageNow*timely}
        :suppression>0&&followup?{damageNow:0,followupDamage:followup.damageNow*Math.max(0,1-orderRisk(view,order)/Math.max(1,fighter.strength??100)),preparationRounds:suppressionTurns,releaseSeconds:followup.releaseSeconds}:undefined
      add(`strike:${site.id}:${order.route.at(-1)}`,`Strike recovered ${site.kind} ${site.id}; expected ${Math.round(survive*payload)} damage.`,order,{baseDamage,futureStrikeAccessGain:suppression,roundsUntilPayoff:site.kind==='base'?0:suppressionTurns},undefined,operation)
    }
  }
  for(const field of view.assets.filter(a=>a.kind==='fob'&&isOperationalAirfield(a))) {
    const origin=formationField(view.assets,fighter.id)
    if(!origin||origin.id===field.id||view.round>=6)continue
    const value=forwardValue(view,field.position)
    // Existing field staging still pays off on r6 after a r5 transit.
    const target=base?.position,current=target?Math.max(0,distance(origin.position,target)-BASE_STRIKE_RANGE)*2:0,next=target?Math.max(0,distance(field.position,target)-BASE_STRIKE_RANGE)*2:0
    const gain=value?.gain??(target&&current>40&&next<=40?Math.min(1,60*(fighter.strength??100)/100/Math.max(1,base!.health)):0)
    if(gain<=0)continue
    for(const order of missionOrders(view,fighter,'transit',field.position,work))if(order.plannedRecoveryFieldId===field.id)add(`transit:${field.id}`,`Transit to ${field.id} to improve strike access to ${base?.id}.`,order,{futureStrikeAccessGain:gain,roundsUntilPayoff:1})
  }
  return packages
}

/** One shared capability library per fighter, then compatible joint packages.
 * Retain diverse single-actor options before the bounded Cartesian product;
 * a second fighter can strike, screen, collect or stage independently. */
export function generateActions(view:CpuPlanningView,work:RouteWork):TacticalPackage[] {
  const fighters=view.cpu.formations.filter(f=>f.role==='fighter')
  const discoveryPayoff=discoveryAttackValue(view)
  const libraries=fighters.map(f=>fighterActions(view,work,f).map(p=>({...p,discoveryPayoff})))
  if(libraries.length===1)return libraries[0]
  const result=libraries.flatMap((library,i)=>library.map(p=>({...p,id:i===0&&p.id==='save'?'save':fighters[i].id+':'+p.id})))
  const reconKey=(p:TacticalPackage)=>JSON.stringify(p.orders.find(o=>o.role==='recon'))
  const scores=new WeakMap<TacticalPackage,number>()
  const score=(p:TacticalPackage)=>{let value=scores.get(p);if(value===undefined){value=Object.values(contribution(view,p)).reduce((n,v)=>n+v,0);scores.set(p,value)}return value}
  const scoutingStation=(o:Squadron)=>o.routeIngress.reduce((best,p)=>distance(p,o.routeIngress[0])>distance(best,o.routeIngress[0])?p:best,o.routeIngress[0])
  const shortlist=(library:TacticalPackage[],fighter:Squadron,key:string)=>{
    const ranked=library.filter(p=>reconKey(p)===key).sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id))
    const categories=new Map<string,TacticalPackage>()
    for(const p of ranked){
      const o=p.orders.find(o=>o.id===fighter.id)!
      const category=o.sortieOrdered===false?'hold':o.protectedTargetId?'escort':o.mission+':'+(o.strikeTargetId??o.plannedRecoveryFieldId??'')
      if(!categories.has(category))categories.set(category,p)
    }
    const diverse=[...categories.values()].sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id)).slice(0,8)
    // Independent scouts can cover different regions. Keep spatial alternatives
    // until joint collection is evaluated instead of collapsing all Transit
    // scouting routes into the same single-actor mission category.
    for(const p of ranked){
      const o=p.orders.find(o=>o.id===fighter.id)!
      if(diverse.length>=8)break
      if(o.sortieOrdered===false||o.mission!=='transit')continue
      if(diverse.every(q=>{const other=q.orders.find(o=>o.id===fighter.id)!;return other.mission!=='transit'||distance(scoutingStation(other),scoutingStation(o))>3.5}))diverse.push(p)
    }
    return diverse
  }
  const collect=collectionScorer(view),base=view.cpu.sites.find(s=>s.kind==='base'&&s.health>0)
  // Same conservative, authorized-information uncertainty as the single-actor library.
  const prior=base?[{point:base.position,weight:1}]:searchPrior(view),total=prior.reduce((n,p)=>n+p.weight,0)
  const witnessed=view.cpu.traffic.some(t=>t.role==='fighter'&&view.round-t.observedRound<=2)
  const risks=new WeakMap<Squadron,number>()
  const risk=(o:Squadron)=>{let value=risks.get(o);if(value===undefined){value=orderRisk(view,o)+(o.sortieOrdered!==false&&!witnessed&&total?prior.reduce((n,p)=>n+(covers(o.route,p.point,4.5)?p.weight:0),0)/total*(o.role==='fighter'?60:25):0);risks.set(o,value)}return value}
  const keys=[...new Set(libraries[0].map(reconKey))]
  for(const key of keys)for(const a of shortlist(libraries[0],fighters[0],key))for(const b of shortlist(libraries[1],fighters[1],key)) {
    const orders=a.orders.map(o=>o.id===fighters[1].id?b.orders.find(f=>f.id===o.id)!:o)
    const ids=new Set(orders.filter(o=>o.sortieOrdered!==false).map(o=>o.id))
    if(!validateRecoveryPackage({playerAssets:view.assets,squadrons:orders},flightRangeFor,ids).valid)continue
    const protectedRisk=protectedRisks(view,orders,risk),confidence=(o:Squadron)=>Math.max(0,1-protectedRisk(o)/Math.max(25,(o.strength??100)+20))
    const attacks=[a.baseAttack,b.baseAttack].filter((v):v is BaseAttackEstimate=>!!v)
    const cap=base?.health??100
    const baseAttack=attacks.length?{damageNow:Math.min(cap,attacks.reduce((n,v)=>n+v.damageNow,0)),followupDamage:Math.min(cap,attacks.reduce((n,v)=>n+v.followupDamage,0)),preparationRounds:Math.max(...attacks.map(v=>v.preparationRounds)),releaseSeconds:Math.max(...attacks.map(v=>v.releaseSeconds))}:undefined
    result.push({id:`joint:${a.id}|${b.id}`,summary:`${fighters[0].callsign}: ${a.summary} ${fighters[1].callsign}: ${b.summary}`,orders,purchases:[],baseAttack,discoveryPayoff,
      predicted:{...emptyEffects(),informationGain:Math.min(1,collect(orders,confidence))*Math.min(1,(6-view.round)/2),baseDamage:Math.min(1,a.predicted.baseDamage+b.predicted.baseDamage),
        ownBaseRiskReduced:Math.min(1,a.predicted.ownBaseRiskReduced+b.predicted.ownBaseRiskReduced),futureStrikeAccessGain:Math.min(1,a.predicted.futureStrikeAccessGain+b.predicted.futureStrikeAccessGain),
        expectedAircraftLoss:orders.reduce((n,o)=>n+(o.sortieOrdered===false?0:Math.min(o.aircraft,protectedRisk(o)/100*o.maxAircraft)),0),roundsUntilPayoff:Math.max(a.predicted.roundsUntilPayoff,b.predicted.roundsUntilPayoff)},checks:a.checks})
  }
  return result
}
