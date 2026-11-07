import { ENEMY_TARGETING_THRESHOLD } from '../campaign'
import { FLIGHT_SPEED, MAX_FLIGHT_DISTANCE, routeDistance } from '../flightRules'
import { formationField, isOperationalAirfield, validateRecoveryPackage } from '../forwardBasing'
import { estimateEscortCoverage } from '../missionResponsibility'
import type { Squadron, Point } from '../types'
import type { CpuPlanningView } from './planningView'
import type { PredictedEffects, TacticalPackage } from './types'
import { CPU_PROFILES, distance, hold, missionOrders, orderRisk, recoveryView, strikeOrders, type RouteWork } from './routes'
import { observedThreat, residualApproachRisk, forwardValue } from './placement'
export const emptyEffects = (): PredictedEffects => ({ informationGain:0,baseDamage:0,ownBaseRiskReduced:0,defenseCoverageGain:0,futureStrikeAccessGain:0,expectedAircraftLoss:0,logisticsSpent:0,roundsUntilPayoff:0 })
export const SEARCH_SECTORS:Point[]=[[0,0],[-6,8],[0,8],[6,8],[-6,0],[6,0],[-6,-8],[0,-8],[6,-8],[-10,12],[0,12],[10,12],[-10,0],[10,0],[-10,-12],[0,-12],[10,-12]]
export function generateActions(view: CpuPlanningView, work: RouteWork): TacticalPackage[] {
  const cpu=view.cpu, fighter=cpu.formations.find(f=>f.role==='fighter')!, recon=cpu.formations.find(f=>f.role==='recon')!, profile=CPU_PROFILES[cpu.difficulty]
  const packages:TacticalPackage[]=[],base=cpu.sites.find(s=>s.kind==='base'&&s.health>0),threat=observedThreat(view)*residualApproachRisk(view), remaining=7-view.round
  const sectors=SEARCH_SECTORS.filter(p=>distance(p,view.home)>=10).sort((a,b)=>{
    const known=(p:Point)=>(cpu.mappedAreas??[]).some(m=>distance(p,m)<3)?1:0
    return known(a)-known(b)||Math.abs(distance(a,view.home)-18)-Math.abs(distance(b,view.home)-18)
  })
  const rotated=sectors.map((_,i)=>sectors[(i+cpu.searchIndex)%sectors.length])
  const clusters=cpu.sites.filter(s=>s.health>0&&s.kind!=='base'&&s.kind!=='decoy').flatMap(s=>{const d=Math.max(.01,distance(view.home,s.position));return [s.position,[s.position[0]+(s.position[0]-view.home[0])/d*4,s.position[1]+(s.position[1]-view.home[1])/d*4] as Point]})
  const searches=base&&(view.exposure<ENEMY_TARGETING_THRESHOLD||view.round-base.observedRound>=1)?[base.position,...rotated]:[...clusters,...rotated]
  const reconOptions=[hold(view,recon),...searches.slice(0,profile.sectors).flatMap(p=>[...missionOrders(view,recon,'search-area',p,work,cpu.lastReconLost?48:64),...(cpu.traffic.some(t=>t.role==='fighter')?missionOrders(view,recon,'search-area',p,work,36):[])])]
  function information(order:Squadron):number {
    if(order.sortieOrdered===false)return 0
    const traveled=order.route.slice(1), fresh=traveled.filter(p=>!(cpu.mappedAreas??[]).some(m=>distance(m,p)<2.65)).length/Math.max(1,traveled.length)
    const refresh=base&&view.exposure<60&&order.route.some(p=>distance(p,base.position)<3.8)
    const clusterInterest=!base&&clusters.some(c=>order.route.some(p=>distance(p,c)<3.8))?.25:0
    const covered=SEARCH_SECTORS.filter(p=>!(cpu.mappedAreas??[]).some(m=>distance(m,p)<2.65)&&order.route.some(r=>distance(r,p)<4)).length
    return (refresh?1:Math.min(1,fresh*.35+covered*.16+clusterInterest))*Math.max(0,1-orderRisk(view,order)/Math.max(25,(order.strength??100)+20))*Math.min(1,(remaining-1)/2)
  }
  const sortedRecon=reconOptions.sort((a,b)=>information(b)-information(a)||orderRisk(view,a)-orderRisk(view,b)||routeDistance(a.route)-routeDistance(b.route)).slice(0,3)
  const usefulRecon=sortedRecon[0]??hold(view,recon)
  const add=(id:string,summary:string,order:Squadron,predicted:Partial<PredictedEffects>,reconOrder=usefulRecon)=>{
    const orders=[order,reconOrder],ids=new Set(orders.filter(o=>o.sortieOrdered!==false).map(o=>o.id))
    const check=validateRecoveryPackage({playerAssets:view.assets,squadrons:orders},MAX_FLIGHT_DISTANCE,ids)
    if(!check.valid){work.rejected.push(`${id}: ${check.reason}`);return}
    packages.push({id,summary,orders,purchases:[],predicted:{...emptyEffects(),informationGain:information(reconOrder),expectedAircraftLoss:orderRisk(view,order)/Math.max(25,(order.strength??100)+20)+orderRisk(view,reconOrder)/Math.max(25,(reconOrder.strength??100)+20),...predicted},checks:['shared recovery / capacity / fuel','recovered targets','one order per formation']})
  }
  add('save','Hold aircraft and preserve cash.',hold(view,fighter),{},hold(view,recon))
  add('search','Collect actionable reconnaissance.',hold(view,fighter),{})
  const traffic=cpu.traffic.filter(t=>view.round-t.observedRound<=2)
  const points=[view.home,...traffic.filter(t=>distance(t.position,view.home)<12).slice(-2).map(t=>{
    const angle=t.bearing??Math.atan2(t.position[1]-view.home[1],t.position[0]-view.home[0]);return [view.home[0]+Math.cos(angle)*2,view.home[1]+Math.sin(angle)*2] as Point
  })]
  for(const point of points)for(const order of missionOrders(view,fighter,'defensive-cap',point,work)) {
    const coverage=traffic.length?traffic.reduce((n,t)=>n+(distance(t.position,point)<=8?1:0),0)/traffic.length:1
    add(`protect:${point}`,'Protect home and the observed approach.',order,{ownBaseRiskReduced:Math.min(1,threat*.45+.06)*coverage*Math.min(1,(fighter.strength??100)/100)})
  }
  for(const contact of traffic.slice(-2))for(const order of missionOrders(view,fighter,'forward-patrol',contact.position,work))add(`patrol:${contact.position}`,'Contest a recently observed traffic sector.',order,{ownBaseRiskReduced:threat*.45*.7,futureStrikeAccessGain:contact.role==='fighter'?.12:0})
  if(traffic.some(t=>t.role==='fighter'))for(const r of sortedRecon.filter(o=>o.sortieOrdered!==false)) {
    const field=formationField(view.assets,fighter.id),rfield=view.assets.find(a=>a.id===r.plannedRecoveryFieldId)
    if(!field)continue
    const coverage=estimateEscortCoverage({escortRoute:[field.position],protectedRoute:[...r.route,rfield?.position??view.home],escortSpeed:FLIGHT_SPEED.fighter,protectedSpeed:FLIGHT_SPEED.recon,recoveryPoint:field.position,maxDistance:40})
    if(coverage.recoveryFeasible&&coverage.percent>0) {
      // Draw the canonical feasible escort extent, never assign the longer recon sweep as a fighter route.
      const route:Point[]=[field.position,...r.route.slice(1)]
      const escort={...fighter,mission:'defensive-cap' as const,route,routeIngress:route,protectedTargetId:recon.id,protectedPoint:undefined,strikeTargetId:undefined,sortieOrdered:true,plannedRecoveryFieldId:field.id}
      if(recoveryView(view,escort)?.valid)add(`escort:${r.route.at(-1)}`,'Cover collection where fighter opposition was witnessed.',escort,{informationGain:Math.min(1,information(r)+coverage.percent/100*.35),expectedAircraftLoss:orderRisk(view,escort)/100+orderRisk(view,r)/150},r)
    }
  }
  const baseOrders=base&&view.exposure>=60?strikeOrders(view,fighter,base,work):[]
  const bestBaseRisk=baseOrders.length?Math.min(...baseOrders.map(o=>orderRisk(view,o))):0
  for(const site of cpu.sites.filter(s=>s.health>0&&s.kind!=='decoy'&&(s.kind!=='base'||view.exposure>=ENEMY_TARGETING_THRESHOLD))) {
    for(const order of strikeOrders(view,fighter,site,work)) {
      const risk=orderRisk(view,order), survive=Math.max(.05,1-risk/Math.max(25,(fighter.strength??100)+20)),payload=60*(fighter.strength??100)/100
      const baseDamage=site.kind==='base'?Math.min(1,payload/site.health)*survive:0
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
