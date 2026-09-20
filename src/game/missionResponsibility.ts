import type { Point, Squadron } from './types'

export const DEFENSIVE_CAP_RESPONSIBILITY_RADIUS=4.5
export const FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH=2.5

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
export function fighterResponsibilityFor(squadron:Squadron):FighterResponsibility|undefined{
  if(squadron.role!=='fighter')return undefined
  if(squadron.mission==='defensive-cap'){
    const center=squadron.routeIngress.at(-1)??squadron.route.at(-1)
    return center?{kind:'circle',center:[...center],radius:DEFENSIVE_CAP_RESPONSIBILITY_RADIUS}:undefined
  }
  if(squadron.mission==='forward-patrol'&&squadron.route.length>=2)return {kind:'corridor',path:squadron.route.map(point=>[...point] as Point),halfWidth:FORWARD_PATROL_RESPONSIBILITY_HALF_WIDTH}
  return undefined
}

export function responsibilityContains(responsibility:FighterResponsibility,point:Point){
  if(responsibility.kind==='circle')return distance(responsibility.center,point)<=responsibility.radius+1e-9
  return responsibility.path.slice(1).some((end,index)=>distanceToSegment(point,responsibility.path[index],end)<=responsibility.halfWidth+1e-9)
}

export function fighterIsResponsibleFor(squadron:Squadron,point:Point){
  const responsibility=fighterResponsibilityFor(squadron)
  return responsibility?responsibilityContains(responsibility,point):false
}

export function nearestResponsibleContact<T extends {id:string;position:Point}>(squadron:Squadron,from:Point,contacts:T[],isReachable:(contact:T)=>boolean){
  return contacts
    .filter(contact=>fighterIsResponsibleFor(squadron,contact.position)&&isReachable(contact))
    .sort((left,right)=>distance(from,left.position)-distance(from,right.position)||left.id.localeCompare(right.id))[0]
}
