import type { Point, Role, Squadron } from './types'

export const DEFENSIVE_CAP_RESPONSIBILITY_RADIUS=4.5
export const DEFENSIVE_CAP_PURSUIT_BUFFER=.35
export const FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH=2.5

export function protectTargetSelectionFor(action:'mission'|'formation'|'exit',mission?:Squadron['mission']){
  return action==='mission'&&mission==='defensive-cap'
}

export function protectThreatPriority({protectsHomeBase,escortsFlight,identifiedByVisual,role}:{protectsHomeBase:boolean;escortsFlight:boolean;identifiedByVisual:boolean;role?:Role}){
  if(!identifiedByVisual)return 0
  if(protectsHomeBase&&role==='recon')return 2
  if(escortsFlight&&role==='fighter')return 2
  return 0
}

export function preferredObjectiveThreat<T extends {id:string;position:Point;source:'visual'|'radar';role:Role}>({contacts,protectsHomeBase,escortsFlight,from,isResponsible,isReachable}:{contacts:T[];protectsHomeBase:boolean;escortsFlight:boolean;from:Point;isResponsible:(contact:T)=>boolean;isReachable:(contact:T)=>boolean}):T|undefined{
  return contacts.filter(contact=>contact.source==='visual'&&isResponsible(contact)&&isReachable(contact)
    &&protectThreatPriority({protectsHomeBase,escortsFlight,identifiedByVisual:true,role:contact.role})>0)
    .sort((left,right)=>distance(from,left.position)-distance(from,right.position)||left.id.localeCompare(right.id))[0]
}

export function escortCoverageLabel(percent:number){
  const covered=Math.max(0,Math.min(100,Math.round(percent)))
  return covered>=99?'FULL COVER · 100%':`PARTIAL COVER · ${covered}% · ${100-covered}% UNCOVERED`
}

export type FighterResponsibility=
  | {kind:'circle';center:Point;radius:number}
  | {kind:'corridor';path:Point[];halfWidth:number}

const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])

function distanceToSegment(point:Point,start:Point,end:Point){
  const dx=end[0]-start[0],dz=end[1]-start[1],lengthSquared=dx*dx+dz*dz
  if(lengthSquared<=1e-9)return distance(point,start)
  const t=Math.max(0,Math.min(1,((point[0]-start[0])*dx+(point[1]-start[1])*dz)/lengthSquared))
  return distance(point,[start[0]+dx*t,start[1]+dz*t])
}

/** Derives player-visible fighter responsibility from committed mission geometry only. */
export function fighterResponsibilityFor(squadron:Squadron,protectedPosition?:Point):FighterResponsibility|undefined{
  if(squadron.role!=='fighter')return undefined
  if(squadron.mission==='defensive-cap'){
    const center=protectedPosition??(squadron.protectedTargetId?undefined:squadron.protectedPoint??squadron.routeIngress.at(-1)??squadron.route.at(-1))
    return center?{kind:'circle',center:[...center],radius:DEFENSIVE_CAP_RESPONSIBILITY_RADIUS}:undefined
  }
  if(squadron.mission==='forward-patrol'&&squadron.route.length>=2){
    // The route's ingress ends at routeIngress.at(-1); only the patrol pattern
    // is the mission's responsibility area. Recovery is appended at execution.
    const start=Math.max(0,Math.min(squadron.route.length-1,squadron.routeIngress.length-1))
    const path=squadron.route.slice(start).map(point=>[...point] as Point)
    return {kind:'corridor',path:path.length>1?path:squadron.route.map(point=>[...point] as Point),halfWidth:FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH}
  }
  return undefined
}

export function responsibilityContains(responsibility:FighterResponsibility,point:Point){
  if(responsibility.kind==='circle')return distance(responsibility.center,point)<=responsibility.radius+1e-9
  return responsibility.path.slice(1).some((end,index)=>distanceToSegment(point,responsibility.path[index],end)<=responsibility.halfWidth+1e-9)
}

export function fighterIsResponsibleFor(squadron:Squadron,point:Point,protectedPosition?:Point){
  const responsibility=fighterResponsibilityFor(squadron,protectedPosition)
  return responsibility?responsibilityContains(responsibility,point):false
}

/** An acquired CAP contact gets a small edge buffer to avoid chattering at the boundary. */
export function capMayContinuePursuit(squadron:Squadron,point:Point){
  const area=fighterResponsibilityFor(squadron)
  return area?.kind==='circle'&&distance(area.center,point)<=area.radius+DEFENSIVE_CAP_PURSUIT_BUFFER+1e-9
}

/** Shared marked-edge leash for Protect and Patrol pursuits. */
export function mayContinueMissionPursuit(squadron:Squadron,point:Point,protectedPosition?:Point){
  const area=fighterResponsibilityFor(squadron,protectedPosition)
  if(area?.kind==='circle')return distance(area.center,point)<=area.radius+DEFENSIVE_CAP_PURSUIT_BUFFER+1e-9
  if(area?.kind==='corridor')return responsibilityContains(area,point)
  return false
}

export interface EscortCoverageEstimate { percent:number; fullyCovered:boolean; recoveryFeasible:boolean }

function routePosition(route:Point[],distanceAlong:number):Point{
  let remaining=distanceAlong
  for(let index=1;index<route.length;index++){
    const from=route[index-1],to=route[index],length=distance(from,to)
    if(remaining<=length||index===route.length-1){const ratio=length<1e-9?0:Math.max(0,Math.min(1,remaining/length));return [from[0]+(to[0]-from[0])*ratio,from[1]+(to[1]-from[1])*ratio]}
    remaining-=length
  }
  return route.at(-1)??[0,0]
}

/** Predicts overlap when a fighter follows a friendly flight at its actual fixed speed. */
export function estimateEscortCoverage({escortRoute,protectedRoute,escortSpeed,protectedSpeed,recoveryPoint,maxDistance,radius=DEFENSIVE_CAP_RESPONSIBILITY_RADIUS}:{escortRoute:Point[];protectedRoute:Point[];escortSpeed:number;protectedSpeed:number;recoveryPoint:Point;maxDistance:number;radius?:number}):EscortCoverageEstimate{
  if(escortRoute.length<1||protectedRoute.length<2||escortSpeed<=0||protectedSpeed<=0)return {percent:0,fullyCovered:false,recoveryFeasible:false}
  const protectedDistance=protectedRoute.slice(1).reduce((total,point,index)=>total+distance(protectedRoute[index],point),0)
  const duration=protectedDistance/protectedSpeed,step=.25
  const plannedSteps=Math.max(1,Math.ceil(duration/step))
  let escortPosition=[...escortRoute[0]] as Point,escortTravel=0,covered=0,feasible=true
  for(let index=0;index<=plannedSteps;index++){
    const time=Math.min(duration,index*step)
    const protectedPosition=routePosition(protectedRoute,protectedSpeed*time)
    const separation=distance(escortPosition,protectedPosition)
    if(escortTravel+distance(escortPosition,recoveryPoint)<=maxDistance+.001){if(separation<=radius+.001)covered++}
    else feasible=false
    if(index===plannedSteps)break
    const nextProtected=routePosition(protectedRoute,protectedSpeed*Math.min(duration,(index+1)*step))
    const moved=Math.min(escortSpeed*step,distance(escortPosition,nextProtected))
    const nextDistance=distance(escortPosition,nextProtected)
    if(nextDistance>0){escortPosition=[escortPosition[0]+(nextProtected[0]-escortPosition[0])*moved/nextDistance,escortPosition[1]+(nextProtected[1]-escortPosition[1])*moved/nextDistance];escortTravel+=moved}
  }
  const percent=Math.round(covered/(plannedSteps+1)*100)
  return {percent,fullyCovered:percent>=99,recoveryFeasible:feasible&&escortTravel+distance(escortPosition,recoveryPoint)<=maxDistance+.001}
}

export function nearestResponsibleContact<T extends {id:string;position:Point;identifiedRole?:Role}>(squadron:Squadron,from:Point,contacts:T[],isReachable:(contact:T)=>boolean,protectedPosition?:Point){
  const responsibility=fighterResponsibilityFor(squadron,protectedPosition)
  return contacts
    .filter(contact=>responsibility&&responsibilityContains(responsibility,contact.position)&&isReachable(contact))
    .sort((left,right)=>{
      if(squadron.mission==='forward-patrol'){
        const fighterPriority=Number(right.identifiedRole==='fighter')-Number(left.identifiedRole==='fighter')
        if(fighterPriority)return fighterPriority
      }
      if(squadron.mission==='defensive-cap'&&responsibility?.kind==='circle'){
        const protectedDistance=distance(responsibility.center,left.position)-distance(responsibility.center,right.position)
        if(Math.abs(protectedDistance)>1e-9)return protectedDistance
      }
      return distance(from,left.position)-distance(from,right.position)||left.id.localeCompare(right.id)
    })[0]
}
