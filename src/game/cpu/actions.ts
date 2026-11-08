import { ENEMY_TARGETING_THRESHOLD } from '../campaign'
import { FLIGHT_SPEED, MAX_FLIGHT_DISTANCE, routeDistance } from '../flightRules'
import { formationField, isOperationalAirfield, validateRecoveryPackage } from '../forwardBasing'
import { estimateEscortCoverage } from '../missionResponsibility'
import type { Squadron, Point } from '../types'
import type { CpuPlanningView } from './planningView'
import type { PredictedEffects, TacticalPackage } from './types'
import { CPU_PROFILES, distance, hold, missionOrders, orderRisk, recoveryView, strikeOrders, type RouteWork } from './routes'
import { searchPrior, collectionScorer } from './search'
import { observedThreat, residualApproachRisk, forwardValue } from './placement'
export const emptyEffects = (): PredictedEffects => ({ informationGain:0,baseDamage:0,ownBaseRiskReduced:0,defenseCoverageGain:0,futureStrikeAccessGain:0,expectedAircraftLoss:0,logisticsSpent:0,roundsUntilPayoff:0 })
export const SEARCH_SECTORS:Point[]=[[0,0],[-6,8],[0,8],[6,8],[-6,0],[6,0],[-6,-8],[0,-8],[6,-8],[-10,12],[0,12],[10,12],[-10,0],[10,0],[-10,-12],[0,-12],[10,-12]]
export function generateActions(view: CpuPlanningView, work: RouteWork): TacticalPackage[] {
  const cpu=view.cpu, fighter=cpu.formations.find(f=>f.role==='fighter')!, recon=cpu.formations.find(f=>f.role==='recon')!, profile=CPU_PROFILES[cpu.difficulty]
  const packages:TacticalPackage[]=[],base=cpu.sites.find(s=>s.kind==='base'&&s.health>0),threat=observedThreat(view)*residualApproachRisk(view), remaining=7-view.round
  const earlyBaseOrders=base&&view.exposure>=ENEMY_TARGETING_THRESHOLD?strikeOrders(view,fighter,base,work):[]
  const prior=searchPrior(view),collect=collectionScorer(view,prior),risks=new WeakMap<Squadron,number>()
  const riskOf=(o:Squadron)=>{let risk=risks.get(o);if(risk===undefined){risk=orderRisk(view,o);risks.set(o,risk)}return risk}
  const sectors=SEARCH_SECTORS.filter(p=>distance(p,view.home)>=10)
  const clusters=cpu.sites.filter(s=>s.health>0&&s.kind!=='base'&&s.kind!=='decoy').map(s=>s.position)
  const candidates=[...sectors,...prior.filter(p=>p.weight>.15).map(p=>p.point),...clusters]
  const interest=new Map(candidates.map(p=>[p,prior.reduce((n,c)=>n+(distance(p,c.point)<5.5?c.weight:0),0)]))
  const searches=base
    ? Array.from({length:8},(_,i)=>[base.position[0]+Math.cos((i+cpu.searchIndex)*Math.PI/4)*3.4,base.position[1]+Math.sin((i+cpu.searchIndex)*Math.PI/4)*3.4] as Point)
    : candidates.sort((a,b)=>{
      return interest.get(b)!-interest.get(a)!||distance(a,view.home)-distance(b,view.home)
    }).filter((p,i,all)=>all.slice(0,i).every(q=>distance(p,q)>3.5))
  const reconOptions=[hold(view,recon),...searches.slice(0,profile.sectors).flatMap(p=>[...missionOrders(view,recon,'search-area',p,work,cpu.lastReconLost?48:64),...(cpu.traffic.some(t=>t.role==='fighter')?missionOrders(view,recon,'search-area',p,work,36):[])])]
  function information(order:Squadron):number {
    if(order.sortieOrdered===false)return 0
    return collect([order])*Math.max(0,1-riskOf(order)/Math.max(25,(order.strength??100)+20))*Math.min(1,(remaining-1)/2)
  }
  const rankedRecon=reconOptions.sort((a,b)=>information(b)-information(a)||riskOf(a)-riskOf(b)||routeDistance(a.route)-routeDistance(b.route))
  const sortedRecon:Squadron[]=[]
  for(const order of rankedRecon)if(sortedRecon.every(o=>distance(o.routeIngress.at(-1)!,order.routeIngress.at(-1)!)>2.5)){sortedRecon.push(order);if(sortedRecon.length===3)break}
  const usefulRecon=sortedRecon[0]??hold(view,recon)
  const add=(id:string,summary:string,order:Squadron,predicted:Partial<PredictedEffects>,reconOrder=usefulRecon)=>{
    const orders=[order,reconOrder],ids=new Set(orders.filter(o=>o.sortieOrdered!==false).map(o=>o.id))
    const check=validateRecoveryPackage({playerAssets:view.assets,squadrons:orders},MAX_FLIGHT_DISTANCE,ids)
    if(!check.valid){work.rejected.push(`${id}: ${check.reason}`);return}
    packages.push({id,summary,orders,purchases:[],predicted:{...emptyEffects(),informationGain:Math.min(1,collect(orders))*Math.max(0,1-riskOf(reconOrder)/Math.max(25,(reconOrder.strength??100)+20))*Math.min(1,(remaining-1)/2),expectedAircraftLoss:riskOf(order)/Math.max(25,(order.strength??100)+20)+riskOf(reconOrder)/Math.max(25,(reconOrder.strength??100)+20),...predicted},checks:['shared recovery / capacity / fuel','recovered targets','one order per formation']})
  }
  add('save','Hold aircraft and preserve cash.',hold(view,fighter),{},hold(view,recon))
  add('search','Collect actionable reconnaissance.',hold(view,fighter),{})
  if(!base||view.exposure<ENEMY_TARGETING_THRESHOLD) {
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
  if(traffic.some(t=>t.role==='fighter'))for(const r of sortedRecon.filter(o=>o.sortieOrdered!==false)) {
    const field=formationField(view.assets,fighter.id),rfield=view.assets.find(a=>a.id===r.plannedRecoveryFieldId)
    if(!field)continue
    const coverage=estimateEscortCoverage({escortRoute:[field.position],protectedRoute:[...r.route,rfield?.position??view.home],escortSpeed:FLIGHT_SPEED.fighter,protectedSpeed:FLIGHT_SPEED.recon,recoveryPoint:field.position,maxDistance:40})
    if(coverage.recoveryFeasible&&coverage.percent>0) {
      // Draw the canonical feasible escort extent, never assign the longer recon sweep as a fighter route.
      const route:Point[]=[field.position,...r.route.slice(1)]
      const escort={...fighter,mission:'defensive-cap' as const,route,routeIngress:route,protectedTargetId:recon.id,protectedPoint:undefined,strikeTargetId:undefined,sortieOrdered:true,plannedRecoveryFieldId:field.id}
      if(recoveryView(view,escort)?.valid)add(`escort:${r.route.at(-1)}`,'Cover collection where fighter opposition was witnessed.',escort,{informationGain:Math.min(1,information(r)*(1+coverage.percent/100*.35)),expectedAircraftLoss:riskOf(escort)/100+riskOf(r)/150},r)
    }
  }
  const baseOrders=earlyBaseOrders
  const bestBaseRisk=baseOrders.length?Math.min(...baseOrders.map(o=>orderRisk(view,o))):0
  for(const site of cpu.sites.filter(s=>s.health>0&&s.kind!=='decoy'&&(s.kind!=='base'||view.exposure>=ENEMY_TARGETING_THRESHOLD))) {
    for(const order of site.kind==='base'?earlyBaseOrders:strikeOrders(view,fighter,site,work)) {
      const risk=orderRisk(view,order,cpu.sites,false), survive=Math.max(.05,1-risk/Math.max(25,(fighter.strength??100)+20)),payload=60*(fighter.strength??100)/100
      // A late release loses its operating field if an observed strike threat
      // can finish home first. Compare public travel bounds, not future orders.
      const witnessed=traffic.some(t=>t.role==='fighter')
      const urgency=witnessed&&view.homeHealth<=60?observedThreat(view):0
      const threatTime=base?Math.max(0,distance(view.home,base.position)-6)/FLIGHT_SPEED.fighter+.6:Infinity
      const releaseTime=routeDistance(order.route)/FLIGHT_SPEED.fighter
      const timely=1-urgency+urgency/(1+Math.exp((releaseTime-threatTime)/.5))
      const baseDamage=site.kind==='base'?Math.min(1,payload/site.health)*survive*timely/(1+routeDistance(order.route)/40*.3):0
      const suppressionTurns=Math.ceil(site.health/Math.max(1,payload)), payoff=suppressionTurns+1
      const reduction=baseOrders.length?Math.max(0,bestBaseRisk-Math.min(...baseOrders.map(o=>orderRisk(view,o,cpu.sites.filter(s=>s.id!==site.id)))))/100:0
      const suppression=site.kind==='sam'&&base&&remaining>=payoff?reduction*survive/suppressionTurns:0
      const support=site.kind==='radar'||site.kind==='fob'||site.kind==='aaa'?Math.min(.15,payload/site.health*.12)*survive:0
      add(`strike:${site.id}:${order.route.at(-1)}`,`Strike recovered ${site.kind} ${site.id}; expected ${Math.round(survive*payload)} damage.`,order,{baseDamage,futureStrikeAccessGain:suppression+support,roundsUntilPayoff:site.kind==='base'?0:suppressionTurns})
    }
  }
  for(const field of view.assets.filter(a=>a.kind==='fob'&&isOperationalAirfield(a))) {
    const origin=formationField(view.assets,fighter.id)
    if(!origin||origin.id===field.id||view.round>=6)continue
    const value=forwardValue(view,field.position)
    // Existing field staging still pays off on r6 after a r5 transit.
    const target=base?.position,current=target?Math.max(0,distance(origin.position,target)-5.9)*2:0,next=target?Math.max(0,distance(field.position,target)-5.9)*2:0
    const gain=value?.gain??(target&&current>40&&next<=40?Math.min(1,60*(fighter.strength??100)/100/Math.max(1,base!.health)):0)
    if(gain<=0)continue
    for(const order of missionOrders(view,fighter,'transit',field.position,work))if(order.plannedRecoveryFieldId===field.id)add(`transit:${field.id}`,`Transit to ${field.id} to improve strike access to ${base?.id}.`,order,{futureStrikeAccessGain:gain,roundsUntilPayoff:1})
  }
  return packages
}
