import type { Point } from './types'

export function headingAngle(position:Point,facing:Point,fallback=0){
  const dx=facing[0]-position[0],dz=facing[1]-position[1]
  return Math.hypot(dx,dz)<1e-5?fallback:Math.atan2(dx,dz)
}

export function shortestAngleLerp(from:number,to:number,t:number){
  const delta=Math.atan2(Math.sin(to-from),Math.cos(to-from))
  return from+delta*Math.max(0,Math.min(1,t))
}

/** Retains the last direction at rest, including exact waypoint arrivals. */
export function facingAfterMove(from:Point,to:Point,previousFacing:Point):Point{
  const angle=headingAngle(from,to,headingAngle(from,previousFacing))
  return [to[0]+Math.sin(angle),to[1]+Math.cos(angle)]
}
