import { SAM_MISSILES_PER_ROUND, SAM_COOLDOWN_SECONDS } from '../airDefense'
import { defenseProfile, radarRange, SAM_FLIGHT_SECONDS, AAA_FLIGHT_SECONDS, AAA_BURST_INTERVAL } from '../equipmentRules'
import { BASE_STRIKE_RANGE } from '../campaign'
import { FLIGHT_SPEED, MAX_FLIGHT_DISTANCE, flightRangeFor, flightSpeedFor, routeDistance } from '../flightRules'
import { deriveRecoveryPlanningView, formationField, isOperationalAirfield } from '../forwardBasing'
import { generateRouteTemplate, validateStrikeGeometry } from '../routeTemplates'
import { findThreatAwareRoute, type RouteThreat, type ThreatRouteResult } from './routeSearch'
import type { Point, Squadron } from '../types'
import type { CpuPlanningView } from './planningView'
import type { CpuDifficulty, CpuSiteReport } from './types'
export const distance = (a: Point, b: Point) => Math.hypot(a[0]-b[0], a[1]-b[1])
export const CPU_PROFILES = {
  easy: { offsets: [0, 2, -2, 4, -4, 7, -7], releases: [0, .3, -.3, .7, -.7], expansions: 64, sectors: 4, purchases: 4 },
  medium: { offsets: [0, 2, -2, 4, -4, 7, -7], releases: [0, .3, -.3, .7, -.7, 1.3, -1.3], expansions: 180, sectors: 8, purchases: 4 },
  hard: { offsets: [0, 2, -2, 4, -4, 7, -7, 10, -10], releases: [0, .25, -.25, .5, -.5, 1, -1, 1.6, -1.6, 2.2, -2.2], expansions: 420, sectors: 12, purchases: 4 },
} satisfies Record<CpuDifficulty, { offsets: number[]; releases: number[]; expansions: number; sectors: number; purchases: number }>
/** Expected known-site hits that can arrive by the chosen release time.
 * Geometry follows the planned ingress; no enemy orders or future rolls enter. */
function defenseDamageBy(route:Point[],speed:number,site:CpuSiteReport,deadline:number):number {
  const profile=defenseProfile(site)!
  const windows:Array<[number,number]>=[]
  let elapsed=0
  for(let i=1;i<route.length;i++) {
    const a=route[i-1],b=route[i],dx=b[0]-a[0],dy=b[1]-a[1],lengthSquared=dx*dx+dy*dy,duration=Math.sqrt(lengthSquared)/speed
    if(lengthSquared>1e-10) {
      const x=a[0]-site.position[0],y=a[1]-site.position[1],projection=x*dx+y*dy
      const discriminant=projection*projection-lengthSquared*(x*x+y*y-profile.range*profile.range)
      if(discriminant>0) {
        const root=Math.sqrt(discriminant),enter=Math.max(0,(-projection-root)/lengthSquared),exit=Math.min(1,(-projection+root)/lengthSquared)
        if(exit>enter)windows.push([elapsed+enter*duration,elapsed+exit*duration])
      }
    }
    elapsed+=duration
  }
  let hits=0
  if(site.kind==='aaa'&&windows.length) {
    for(let shot=0;shot<profile.burstShots;shot++)if(windows[0][0]+shot*AAA_BURST_INTERVAL+AAA_FLIGHT_SECONDS<=deadline+1e-8)hits++
  }else if(site.kind==='sam') {
    let nextFire=0,launched=0
    for(const [enter,exit] of windows) {
      let fire=Math.max(enter,nextFire)
      while(fire<=exit+1e-8&&launched<profile.magazine) {
        if(fire+SAM_FLIGHT_SECONDS<=deadline+1e-8)hits++
        launched++;nextFire=fire+Math.max(.01,profile.cooldown);fire=nextFire
      }
    }
  }
  return hits*profile.hitChance*profile.damage
}
/** Expected damage integrated along every segment, including the recovery reserve. */
export function cpuRouteRisk(route: Point[], role: Squadron['role'], sites: CpuSiteReport[], configuration?:Pick<Squadron,'aircraftTypeId'|'upgrades'>|string,impactBy?:number): number {
  let risk = 0
  for (const site of sites.filter(s => s.health > 0 && ['sam','aaa','radar'].includes(s.kind))) {
    const profile=defenseProfile(site),radius=profile?.range??radarRange(site)
    const speed=flightSpeedFor({role,...(typeof configuration==='string'?{aircraftTypeId:configuration}:configuration)})
    if(profile&&impactBy!==undefined){risk+=defenseDamageBy(route,speed,site,impactBy);continue}
    let inside = 0
    for (let i=1;i<route.length;i++) {
      const a=route[i-1], b=route[i], length=distance(a,b), samples=Math.max(1,Math.ceil(length/.35))
      for (let j=0;j<samples;j++) { const t=(j+.5)/samples; if(distance([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],site.position)<=radius) inside+=length/samples }
    }
    const seconds=inside/speed
    // Three available rounds, site-wide cooldown; stale ammunition is conservatively replenished.
    risk += site.kind === 'sam' ? (seconds>0 ? Math.min(profile!.magazine,1+seconds/Math.max(.01,profile!.cooldown))*profile!.hitChance*profile!.damage : 0) : site.kind === 'aaa' ? (inside>0?profile!.hitChance*profile!.damage*profile!.burstShots:0) : seconds*1.5
  }
  return risk
}
export interface RouteWork { expansions: number; rejected: string[]; routeCache?:Map<string,ThreatRouteResult|undefined> }
/** Additive route-ranking costs, not promises about combat damage. Actual
 * payload/loss estimates and mission choice still use the shared engine model. */
export function routeThreats(view:CpuPlanningView,role:Squadron['role'],formation?:Squadron):RouteThreat[] {
  const threats:RouteThreat[]=view.cpu.sites.filter(s=>s.health>0&&['sam','aaa','radar'].includes(s.kind)).map(s=>{const p=defenseProfile(s);return {position:s.position,
    radius:p?.range??radarRange(s),costPerUnit:s.kind==='sam'?.35*p!.hitChance*p!.damage/Math.max(.01,p!.cooldown)/flightSpeedFor(formation??{role}):s.kind==='aaa'?.35*p!.hitChance*p!.damage*p!.burstShots/(p!.range*2):.35*1.5/flightSpeedFor(formation??{role})}})
  const tracks=new Map<string,typeof view.cpu.traffic>()
  for(const contact of view.cpu.traffic.filter(t=>t.role==='fighter'&&view.round-t.observedRound<=2)) {
    const key=contact.identity??contact.trackId??contact.position.join(',')
    tracks.set(key,[...(tracks.get(key)??[]),contact])
  }
  for(const samples of tracks.values()) {
    const unique=[...new Map(samples.map(t=>[t.position.join(','),t])).values()]
    for(const t of unique)threats.push({position:t.position,radius:4.5,costPerUnit:.35*24/7/unique.length/(1+view.round-t.observedRound)*Math.min(1,((t.strength??100)+25*Math.max(0,view.round-t.observedRound))/100)})
  }
  return threats
}
export function recoveryView(view: CpuPlanningView, order: Squadron, orders = view.cpu.formations) {
  return deriveRecoveryPlanningView({ playerAssets: view.assets, squadrons: orders.map(s=>s.id===order.id?order:s) }, order.id, order.route, flightRangeFor(order))
}
export function hold(view: CpuPlanningView, formation: Squadron): Squadron {
  const field=formationField(view.assets,formation.id)
  return { ...formation, sortieOrdered:false, route:[[...(field?.position??view.home)]], routeIngress:[[...(field?.position??view.home)]], plannedRecoveryFieldId:undefined, protectedTargetId:undefined, strikeTargetId:undefined }
}
function alternatives(from: Point, to: Point, offsets: number[]): Point[][] {
  const d=Math.max(.001,distance(from,to)), side:Point=[-(to[1]-from[1])/d,(to[0]-from[0])/d]
  return offsets.map(o=>o===0?[[...from],[...to]]:[from,[(from[0]+to[0])/2+side[0]*o,(from[1]+to[1])/2+side[1]*o],to]) as Point[][]
}
/** One bounded A* query over all candidate endpoints. The cache is local to
 * this planning decision, including isolated purchase copies; no saved map. */
function searched(view:CpuPlanningView,from:Point,goals:Point[],role:Squadron['role'],work:RouteWork,formation:Squadron):Point[]|undefined {
  const threats=routeThreats(view,role,formation)
  if(!threats.length)return undefined
  const key=JSON.stringify([from,goals,role,flightRangeFor(formation),flightSpeedFor(formation),threats])
  const cache=work.routeCache??=new Map()
  if(cache.has(key))return cache.get(key)?.route
  const budget=Math.max(0,CPU_PROFILES[view.cpu.difficulty].expansions-work.expansions)
  if(!budget)return undefined
  const result=findThreatAwareRoute({from,goals,recovery:from,maxDistance:flightRangeFor(formation),maxWaypoints:7,threats,expansionBudget:budget})
  work.expansions+=result?.expansions??0
  cache.set(key,result)
  return result?.route
}
export function missionOrders(view: CpuPlanningView, formation: Squadron, mission: Squadron['mission'], station: Point, work: RouteWork, budget=flightRangeFor(formation)): Squadron[] {
  const field=formationField(view.assets,formation.id)
  if(!field||!isOperationalAirfield(field)||formation.aircraft<=0)return []
  const from=field.position, profile=CPU_PROFILES[view.cpu.difficulty]
  const ingress=alternatives(from,station,mission==='base-strike'?profile.offsets:profile.offsets.filter(o=>o===0||Math.abs(o)>=4))
  // Search only when simple paths expose the formation to known defenses.
  if(mission!=='base-strike'&&Math.min(...ingress.map(r=>cpuRouteRisk([...r,from],formation.role,view.cpu.sites,formation)))>12) {
    const path=searched(view,from,[station],formation.role,work,formation); if(path)ingress.push(path)
  }
  const scoutingReturn=mission==='transit'&&!view.assets.some(a=>isOperationalAirfield(a)&&distance(a.position,station)<.6)
  const paths=scoutingReturn?ingress.flatMap(path=>{const length=Math.max(.01,distance(from,station)),side:Point=[-(station[1]-from[1])/length,(station[0]-from[0])/length];return [-7,-4,4,7].map(offset=>[...path,[(from[0]+station[0])/2+side[0]*offset,(from[1]+station[1])/2+side[1]*offset] as Point,from])}):ingress
  const orders=paths.flatMap(path=> {
    const route=mission==='base-strike'||mission==='transit'?path:generateRouteTemplate({template:mission,ingress:path,maxDistance:budget,bounds:{minX:Math.min(from[0],station[0])-8,maxX:Math.max(from[0],station[0])+8,minZ:Math.min(from[1],station[1])-8,maxZ:Math.max(from[1],station[1])+8}}).route
    const order:Squadron={...formation,mission,route,routeIngress:path,sortieOrdered:true,protectedTargetId:undefined,strikeTargetId:undefined,protectedPoint:mission==='defensive-cap'?[...station]:undefined}
    const recovery=recoveryView(view,order)
    if(!recovery?.valid||recovery.missionDistance>budget+.001){work.rejected.push(recovery?.reason??'No recovery field');return []}
    // A search/patrol latched by a field cannot claim an unflown mission pattern.
    return [{...order,route:recovery.normalizedRoute,plannedRecoveryFieldId:recovery.intendedField.id}]
  }).sort((a,b)=>orderRisk(view,a)-orderRisk(view,b)||routeDistance(a.route)-routeDistance(b.route))
  if(mission!=='base-strike')return orders.slice(0,3)
  const fastest=[...orders].sort((a,b)=>routeDistance(a.route)-routeDistance(b.route)||orderRisk(view,a)-orderRisk(view,b))[0]
  return [...new Set([...orders.slice(0,2),...(fastest?[fastest]:[])])]
}
export function orderRisk(view: CpuPlanningView, order: Squadron, sites=view.cpu.sites, includeRecovery=true) {
  const recovery=view.assets.find(a=>a.id===order.plannedRecoveryFieldId)
  if(order.sortieOrdered===false)return 0
  const route=includeRecovery?[...order.route,recovery?.position??view.home]:order.route
  const sectors=[...new Map(view.cpu.traffic.filter(t=>t.role==='fighter'&&view.round-t.observedRound<=2).map(t=>[`${t.identity??t.trackId??''}:${t.position}`,t])).values()]
  let airRisk=0
  const trackRisk=new Map<string,number>()
  for(const sector of sectors) {
    let inside=0
    for(let i=1;i<route.length;i++) {const a=route[i-1],b=route[i],n=Math.max(1,Math.ceil(distance(a,b)/.5));for(let j=0;j<n;j++){const t=(j+.5)/n;if(distance([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],sector.position)<=4.5)inside+=distance(a,b)/n}}
    const key=sector.identity??sector.trackId??sector.position.join(',')
    trackRisk.set(key,Math.max(trackRisk.get(key)??0,Math.min(1,inside/7)*24/(1+view.round-sector.observedRound)*Math.min(1,((sector.strength??100)+25*Math.max(0,view.round-sector.observedRound))/100)))
  }
  airRisk=[...trackRisk.values()].reduce((n,r)=>n+r,0)
  const base=view.cpu.sites.find(s=>s.kind==='base'&&s.health>0)
  if(base&&(sectors.length||view.homeHealth<100)) {
    // A recovered airfield plus witnessed fighters makes its approach corridor
    // contested. This is a geometric risk envelope, never a future-order rollout.
    const dx=base.position[0]-view.home[0],dy=base.position[1]-view.home[1],length=Math.hypot(dx,dy)
    let exposed=0
    for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],n=Math.max(1,Math.ceil(distance(a,b)/.5));for(let j=0;j<n;j++){
      const t=(j+.5)/n,p:Point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]
      const along=((p[0]-view.home[0])*dx+(p[1]-view.home[1])*dy)/length,lateral=Math.abs((p[0]-view.home[0])*dy-(p[1]-view.home[1])*dx)/length
      if(along>4.5&&along<length-5.5&&lateral<1.7)exposed+=distance(a,b)/n
    }}
    const latest=[...new Map(sectors.sort((a,b)=>a.observedRound-b.observedRound||(a.observedAt??0)-(b.observedAt??0)).map(t=>[t.identity??t.trackId??t.position.join(','),t])).values()]
    const power=latest.length?latest.reduce((n,t)=>n+Math.min(1,((t.strength??100)+25*Math.max(0,view.round-t.observedRound))/100),0)/latest.length:1
    airRisk=Math.max(airRisk,Math.min(1,exposed/4)*65*power)
  }
  if(base) {
    // Coarse observed tracks can overlap a recovered operating field even when
    // their quantized point falls outside it. Price the witnessed defensive
    // capability there, rather than treating the quantized point as exact.
    const nearby=sectors.filter(t=>distance(t.position,base.position)<=4.5+2+distance(t.position,view.home)*Math.sin(Math.PI/8))
    const guards=[...new Map(nearby.sort((a,b)=>a.observedRound-b.observedRound||(a.observedAt??0)-(b.observedAt??0)).map(t=>[t.identity??t.trackId??t.position.join(','),t])).values()]
    const power=guards.reduce((n,t)=>n+Math.min(100,(t.strength??100)+25*Math.max(0,view.round-t.observedRound)),0)
    let exposed=0
    for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],n=Math.max(1,Math.ceil(distance(a,b)/.5));for(let j=0;j<n;j++){const t=(j+.5)/n;if(distance([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],base.position)<=4.5)exposed+=distance(a,b)/n}}
    airRisk=Math.max(airRisk,Math.min(1,exposed/3)*power*(order.role==='fighter'?.4:.2))
  }
  let uncertainty=0
  const outcome=(view.cpu.outcomes??[]).filter(o=>o.formationId===order.id).at(-1)
  const failed=outcome&&view.cpu.plan?.round===outcome.round?view.cpu.plan.orders.find(o=>o.id===order.id):undefined
  if(outcome&&view.round-outcome.round<=1&&failed&&(!outcome.recovered||(outcome.damage??0)>0&&failed.mission===order.mission&&failed.strikeTargetId===order.strikeTargetId)) {
    // A failed or damaging assigned corridor justifies another approach, not
    // evidence of an invented enemy SAM or an exact loss position.
    const key=(p:Point)=>`${Math.round(p[0]/2)},${Math.round(p[1]/2)}`
    const cells=(path:Point[])=>{const result=new Set<string>();for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],n=Math.max(1,Math.ceil(distance(a,b)));for(let j=0;j<n;j++){const t=(j+.5)/n,p:Point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];if(distance(p,view.home)>5)result.add(key(p))}}return result}
    const old=cells(failed.route),next=cells(order.route)
    uncertainty=(outcome.recovered?outcome.damage??0:2)*[...next].filter(c=>old.has(c)).length/Math.max(1,next.size)
  }
  return cpuRouteRisk(route,order.role,sites,order,includeRecovery?undefined:routeDistance(order.route)/flightSpeedFor(order))+Math.min(85,airRisk)+uncertainty
}
export function strikeOrders(view: CpuPlanningView, fighter: Squadron, target: CpuSiteReport, work: RouteWork): Squadron[] {
  const field=formationField(view.assets,fighter.id);if(!field||!isOperationalAirfield(field)||fighter.aircraft<=0||fighter.status==='trapped')return []
  const from=field.position, length=distance(from,target.position), angle=Math.atan2(from[1]-target.position[1],from[0]-target.position[0])
  const releases:Point[]=length<=BASE_STRIKE_RANGE?[[from[0]+(target.position[0]-from[0])*.02,from[1]+(target.position[1]-from[1])*.02]]:CPU_PROFILES[view.cpu.difficulty].releases.map(a=>[target.position[0]+Math.cos(angle+a)*BASE_STRIKE_RANGE,target.position[1]+Math.sin(angle+a)*BASE_STRIKE_RANGE])
  if(length<.01)releases[0]=[from[0]+.05,from[1]]
  const all:Squadron[]=releases.flatMap(p=>missionOrders(view,fighter,'base-strike',p,work)).map(o=>({...o,strikeTargetId:target.id})).filter(o=>validateStrikeGeometry(o,field,target)===undefined)
  const path=searched(view,from,releases,fighter.role,work,fighter)
  let optimized:Squadron|undefined
  if(path) {
    const order:Squadron={...fighter,mission:'base-strike',route:path,routeIngress:path,strikeTargetId:target.id,sortieOrdered:true,protectedTargetId:undefined,protectedPoint:undefined,plannedRecoveryFieldId:field.id}
    const recovery=recoveryView(view,order)
    if(recovery?.valid&&validateStrikeGeometry(order,field,target)===undefined){optimized={...order,route:recovery.normalizedRoute};all.push(optimized)}
    else work.rejected.push(recovery?.reason??'A* route failed canonical strike validation')
  }
  const safe=[...all].sort((a,b)=>orderRisk(view,a)-orderRisk(view,b)||routeDistance(a.route)-routeDistance(b.route))
  const fast=[...all].sort((a,b)=>routeDistance(a.route)-routeDistance(b.route)||orderRisk(view,a)-orderRisk(view,b))
  const retained=[...safe.slice(0,2),...fast.slice(0,2),...(optimized?[optimized]:[])]
  return [...new Map(retained.map(o=>[JSON.stringify([o.route,o.plannedRecoveryFieldId]),o])).values()]
}
