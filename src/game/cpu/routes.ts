import { SAM_MISSILES_PER_ROUND, SAM_COOLDOWN_SECONDS } from '../airDefense'
import { BASE_STRIKE_RANGE } from '../campaign'
import { FLIGHT_SPEED, MAX_FLIGHT_DISTANCE, routeDistance } from '../flightRules'
import { deriveRecoveryPlanningView, formationField, isOperationalAirfield } from '../forwardBasing'
import { generateRouteTemplate, validateStrikeGeometry } from '../routeTemplates'
import { axialToPoint, snapToHex } from '../hex'
import type { Point, Squadron } from '../types'
import type { CpuPlanningView } from './planningView'
import type { CpuDifficulty, CpuSiteReport } from './types'
export const distance = (a: Point, b: Point) => Math.hypot(a[0]-b[0], a[1]-b[1])
export const CPU_PROFILES = {
  easy: { offsets: [0, 2, -2, 4, -4, 7, -7], releases: [0, .3, -.3, .7, -.7], expansions: 0, sectors: 4, purchases: 4 },
  medium: { offsets: [0, 2, -2, 4, -4, 7, -7], releases: [0, .3, -.3, .7, -.7, 1.3, -1.3], expansions: 180, sectors: 8, purchases: 4 },
  hard: { offsets: [0, 2, -2, 4, -4, 7, -7, 10, -10], releases: [0, .25, -.25, .5, -.5, 1, -1, 1.6, -1.6, 2.2, -2.2], expansions: 420, sectors: 12, purchases: 4 },
} satisfies Record<CpuDifficulty, { offsets: number[]; releases: number[]; expansions: number; sectors: number; purchases: number }>
/** Expected damage integrated along every segment, including the recovery reserve. */
export function cpuRouteRisk(route: Point[], role: Squadron['role'], sites: CpuSiteReport[]): number {
  let risk = 0
  for (const site of sites.filter(s => s.health > 0 && ['sam','aaa','radar'].includes(s.kind))) {
    const radius = site.kind === 'sam' ? 3.2 : site.kind === 'aaa' ? 1.9 : 6.4
    let inside = 0
    for (let i=1;i<route.length;i++) {
      const a=route[i-1], b=route[i], length=distance(a,b), samples=Math.max(1,Math.ceil(length/.35))
      for (let j=0;j<samples;j++) { const t=(j+.5)/samples; if(distance([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],site.position)<=radius) inside+=length/samples }
    }
    const seconds=inside/FLIGHT_SPEED[role]
    // Three available rounds, site-wide cooldown; stale ammunition is conservatively replenished.
    risk += site.kind === 'sam' ? (seconds>0 ? Math.min(SAM_MISSILES_PER_ROUND,1+seconds/SAM_COOLDOWN_SECONDS)*.64*38 : 0) : site.kind === 'aaa' ? (inside>0?.52*13:0) : seconds*1.5
  }
  return risk
}
export interface RouteWork { expansions: number; rejected: string[] }
export function recoveryView(view: CpuPlanningView, order: Squadron, orders = view.cpu.formations) {
  return deriveRecoveryPlanningView({ playerAssets: view.assets, squadrons: orders.map(s=>s.id===order.id?order:s) }, order.id, order.route, MAX_FLIGHT_DISTANCE[order.role])
}
export function hold(view: CpuPlanningView, formation: Squadron): Squadron {
  const field=formationField(view.assets,formation.id)
  return { ...formation, sortieOrdered:false, route:[[...(field?.position??view.home)]], routeIngress:[[...(field?.position??view.home)]], plannedRecoveryFieldId:undefined, protectedTargetId:undefined, strikeTargetId:undefined }
}
function alternatives(from: Point, to: Point, offsets: number[]): Point[][] {
  const d=Math.max(.001,distance(from,to)), side:Point=[-(to[1]-from[1])/d,(to[0]-from[0])/d]
  return offsets.map(o=>o===0?[[...from],[...to]]:[from,[(from[0]+to[0])/2+side[0]*o,(from[1]+to[1])/2+side[1]*o],to]) as Point[][]
}
/** Bounded weighted hex search. No world seed, true bounds, or hidden defense input. */
function searched(view: CpuPlanningView, from: Point, to: Point, role: Squadron['role'], work: RouteWork): Point[] | undefined {
  const budget=Math.max(0,CPU_PROFILES[view.cpu.difficulty].expansions-work.expansions)
  if(!budget) return undefined
  const start=snapToHex(from), key=(p:Point)=>`${p[0].toFixed(3)},${p[1].toFixed(3)}`
  type Node={p:Point;g:number;path:Point[]}
  const open:Node[]=[{p:start,g:distance(from,start),path:[from,start]}], seen=new Map<string,number>()
  const steps=[[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]].map(([q,r])=>axialToPoint(q,r))
  let expanded=0
  while(open.length&&expanded<budget) {
    open.sort((a,b)=>(a.g+distance(a.p,to))-(b.g+distance(b.p,to))||key(a.p).localeCompare(key(b.p)))
    const node=open.shift()!, k=key(node.p)
    if((seen.get(k)??Infinity)<=node.g)continue
    seen.set(k,node.g);expanded++;work.expansions++
    if(distance(node.p,to)<1.5) {
      const raw=[...node.path,to], simple:Point[]=[from]
      let i=0
      while(i<raw.length-1) {
        let next=i+1
        for(let j=raw.length-1;j>i+1;j--) if(cpuRouteRisk([raw[i],raw[j]],role,view.cpu.sites)<=cpuRouteRisk(raw.slice(i,j+1),role,view.cpu.sites)+.01) {next=j;break}
        simple.push(raw[next]);i=next
      }
      return simple.length<=7?simple:undefined
    }
    for(const step of steps) {
      const p:Point=[node.p[0]+step[0],node.p[1]+step[1]]
      if(distance(from,p)+distance(p,to)>MAX_FLIGHT_DISTANCE[role])continue
      const g=node.g+distance(node.p,p)+cpuRouteRisk([node.p,p],role,view.cpu.sites)*.35
      if((seen.get(key(p))??Infinity)>g)open.push({p,g,path:[...node.path,p]})
    }
  }
  return undefined
}
export function missionOrders(view: CpuPlanningView, formation: Squadron, mission: Squadron['mission'], station: Point, work: RouteWork, budget=MAX_FLIGHT_DISTANCE[formation.role]): Squadron[] {
  const field=formationField(view.assets,formation.id)
  if(!field||!isOperationalAirfield(field)||formation.aircraft<=0)return []
  const from=field.position, profile=CPU_PROFILES[view.cpu.difficulty]
  const ingress=alternatives(from,station,mission==='base-strike'?profile.offsets:profile.offsets.filter(o=>o===0||Math.abs(o)>=4))
  // Search only when simple paths expose the formation to known defenses.
  if(Math.min(...ingress.map(r=>cpuRouteRisk([...r,from],formation.role,view.cpu.sites)))>12) {
    const path=searched(view,from,station,formation.role,work); if(path)ingress.push(path)
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
    const latest=[...new Map(sectors.sort((a,b)=>(a.observedAt??0)-(b.observedAt??0)).map(t=>[t.identity??t.trackId??t.position.join(','),t])).values()]
    const power=latest.length?latest.reduce((n,t)=>n+Math.min(1,((t.strength??100)+25*Math.max(0,view.round-t.observedRound))/100),0)/latest.length:1
    airRisk=Math.max(airRisk,Math.min(1,exposed/4)*65*power)
  }
  let uncertainty=0
  const outcome=(view.cpu.outcomes??[]).filter(o=>o.formationId===order.id).at(-1)
  const failed=outcome&&view.cpu.plan?.round===outcome.round?view.cpu.plan.orders.find(o=>o.id===order.id):undefined
  if(outcome&&!outcome.recovered&&view.round-outcome.round<=1&&failed) {
    // A failed assigned corridor is a reason to compare another approach, not
    // evidence of an invented enemy SAM or an exact loss position.
    const key=(p:Point)=>`${Math.round(p[0]/2)},${Math.round(p[1]/2)}`
    const cells=(path:Point[])=>{const result=new Set<string>();for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],n=Math.max(1,Math.ceil(distance(a,b)));for(let j=0;j<n;j++){const t=(j+.5)/n,p:Point=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];if(distance(p,view.home)>5)result.add(key(p))}}return result}
    const old=cells(failed.route),next=cells(order.route)
    uncertainty=2*[...next].filter(c=>old.has(c)).length/Math.max(1,next.size)
  }
  return cpuRouteRisk(route,order.role,sites)+Math.min(85,airRisk)+uncertainty
}
export function strikeOrders(view: CpuPlanningView, fighter: Squadron, target: CpuSiteReport, work: RouteWork): Squadron[] {
  const field=formationField(view.assets,fighter.id);if(!field)return []
  const from=field.position, length=distance(from,target.position), angle=Math.atan2(from[1]-target.position[1],from[0]-target.position[0])
  const releases:Point[]=length<BASE_STRIKE_RANGE?[[from[0]+(target.position[0]-from[0])*.02,from[1]+(target.position[1]-from[1])*.02]]:CPU_PROFILES[view.cpu.difficulty].releases.map(a=>[target.position[0]+Math.cos(angle+a)*5.9,target.position[1]+Math.sin(angle+a)*5.9])
  if(length<.01)releases[0]=[from[0]+.05,from[1]]
  const all=releases.flatMap(p=>missionOrders(view,fighter,'base-strike',p,work)).map(o=>({...o,strikeTargetId:target.id})).filter(o=>validateStrikeGeometry(o,field,target)===undefined)
  const safe=[...all].sort((a,b)=>orderRisk(view,a)-orderRisk(view,b)||routeDistance(a.route)-routeDistance(b.route))
  const fast=[...all].sort((a,b)=>routeDistance(a.route)-routeDistance(b.route)||orderRisk(view,a)-orderRisk(view,b))
  return [...new Set([...safe.slice(0,2),...fast.slice(0,2),...safe])].slice(0,4)
}
