import { axialToPoint, HEX_RADIUS, snapToHex } from '../hex'
import type { CoverageCircle } from '../equipmentRules'
import type { Point } from '../types'

export interface RouteThreat extends CoverageCircle {
  costPerUnit: number
  additionalCircles?: readonly CoverageCircle[]
}
export interface ThreatRouteRequest {
  from:Point; goals:Point[]; recovery:Point; maxDistance:number; threats:RouteThreat[]
  maxWaypoints:number; expansionBudget:number
}
export interface ThreatRouteResult {
  route:Point[]; distance:number; cost:number; expansions:number; optimal:boolean
}
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const EPS=1e-8

function circleInterval(a:Point,b:Point,circle:CoverageCircle):[number,number]|undefined {
  const dx=b[0]-a[0],dy=b[1]-a[1],lengthSquared=dx*dx+dy*dy
  if(lengthSquared<1e-10)return undefined
  const x=a[0]-circle.position[0],y=a[1]-circle.position[1]
  const projection=x*dx+y*dy,discriminant=projection*projection-lengthSquared*(x*x+y*y-circle.radius*circle.radius)
  if(discriminant<=0)return undefined
  const root=Math.sqrt(discriminant)
  const enter=Math.max(0,(-projection-root)/lengthSquared),exit=Math.min(1,(-projection+root)/lengthSquared)
  return exit>enter?[enter,exit]:undefined
}

/** Merge overlapping intervals so one launcher contributes only once. */
export function coverageIntervals(a:Point,b:Point,circles:readonly CoverageCircle[]):[number,number][] {
  const intervals: [number,number][] = []
  for (const circle of circles) {
    const interval = circleInterval(a,b,circle)
    if (interval) intervals.push(interval)
  }
  if (intervals.length < 2) return intervals
  intervals.sort((a,b)=>a[0]-b[0])
  const union = [intervals[0]]
  for (const [enter,exit] of intervals.slice(1)) {
    const last = union.at(-1)!
    if (enter <= last[1]) last[1] = Math.max(last[1],exit)
    else union.push([enter,exit])
  }
  return union
}

/** Exact length of a segment inside one threat's firing area. */
export function threatExposure(a:Point,b:Point,threat:Omit<RouteThreat,'costPerUnit'>):number {
  if (threat.additionalCircles?.length) {
    return distance(a,b)*coverageIntervals(a,b,[threat,...threat.additionalCircles]).reduce((total,[enter,exit])=>total+exit-enter,0)
  }
  const interval = circleInterval(a,b,threat)
  return interval ? distance(a,b)*(interval[1]-interval[0]) : 0
}
export function threatSegmentCost(a:Point,b:Point,threats:RouteThreat[]):number {
  return distance(a,b)+threats.reduce((n,t)=>n+threatExposure(a,b,t)*t.costPerUnit,0)
}
export function threatRouteCost(route:Point[],recovery:Point,threats:RouteThreat[]):number {
  const path=[...route,recovery]
  return path.slice(1).reduce((n,p,i)=>n+threatSegmentCost(path[i],p,threats),0)
}
function append(path:Point[],point:Point):Point[] {
  if(distance(path.at(-1)!,point)<EPS)return path
  if(path.length>=2) {
    const a=path.at(-2)!,b=path.at(-1)!,ux=b[0]-a[0],uy=b[1]-a[1],vx=point[0]-b[0],vy=point[1]-b[1]
    if(Math.abs(ux*vy-uy*vx)<EPS&&ux*vx+uy*vy>0)return [...path.slice(0,-1),point]
  }
  return [...path,point]
}

/** Resource-constrained A* on the public hex lattice, with exact source/goal
 * connectors. Euclidean distance + the fixed recovery cost is admissible.
 * Each state keeps a Pareto frontier of cost and fuel, so a cheap long detour
 * cannot discard a shorter label needed to finish within the fuel allowance.
 * A budget-limited result is explicitly not a proof of optimality. */
export function findThreatAwareRoute(request:ThreatRouteRequest):ThreatRouteResult|undefined {
  const {from,recovery,maxDistance,maxWaypoints,expansionBudget}=request
  const threats=request.threats.filter(t=>t.radius>0&&t.costPerUnit>0)
  const goals=request.goals.filter(p=>distance(from,p)+distance(p,recovery)<=maxDistance+EPS)
  if(!goals.length||maxWaypoints<2)return undefined
  const returnCosts=goals.map(p=>threatSegmentCost(p,recovery,threats))
  const estimate=(p:Point)=>Math.min(...goals.map((g,i)=>distance(p,g)+returnCosts[i]))
  let best:ThreatRouteResult|undefined
  const finish=(path:Point[],flown:number,cost:number):void=>{
    const point=path.at(-1)!
    goals.forEach((goal,i)=>{
      const length=flown+distance(point,goal)+distance(goal,recovery),route=append(path,goal)
      if(length>maxDistance+EPS||route.length>maxWaypoints)return
      const value=cost+threatSegmentCost(point,goal,threats)+returnCosts[i]
      if(!best||value<best.cost-EPS||Math.abs(value-best.cost)<=EPS&&length<best.distance-EPS)
        best={route,distance:length,cost:value,expansions:0,optimal:false}
    })
  }
  finish([from],0,0)
  type Label={q:number;r:number;p:Point;path:Point[];g:number;flown:number;f:number;key:string;serial:number}
  const labels=new Map<string,Label[]>(),open:Label[]=[]
  let serial=0,expansions=0
  const directions:[[number,number],...Array<[number,number]>]=[[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]]
  const push=(q:number,r:number,path:Point[],flown:number,g:number):void=>{
    const p=axialToPoint(q,r)
    if(path.length>maxWaypoints||flown+Math.min(...goals.map(goal=>distance(p,goal)+distance(goal,recovery)))>maxDistance+EPS)return
    if(path.length===maxWaypoints&&goals.every(goal=>append(path,goal).length>maxWaypoints))return
    const f=g+estimate(p)
    if(best&&f>=best.cost-EPS)return
    const previous=path.at(-2)??from,length=Math.max(EPS,distance(previous,p))
    const heading=`${((p[0]-previous[0])/length).toFixed(7)},${((p[1]-previous[1])/length).toFixed(7)}`
    const key=`${q},${r}:${heading}:${path.length}`
    const prior=labels.get(key)??[]
    if(prior.some(l=>l.g<=g+EPS&&l.flown<=flown+EPS))return
    const label:Label={q,r,p,path,g,flown,f,key,serial:serial++}
    labels.set(key,[...prior.filter(l=>!(g<=l.g+EPS&&flown<=l.flown+EPS)),label])
    open.push(label)
  }
  const snapped=snapToHex(from),r=Math.round(snapped[1]/(1.5*HEX_RADIUS)),q=Math.round(snapped[0]/(Math.sqrt(3)*HEX_RADIUS)-r/2)
  for(const [dq,dr] of [[0,0],...directions]) {
    const p=axialToPoint(q+dq,r+dr)
    push(q+dq,r+dr,append([from],p),distance(from,p),threatSegmentCost(from,p,threats))
  }
  while(open.length&&expansions<expansionBudget) {
    open.sort((a,b)=>a.f-b.f||a.g-b.g||a.flown-b.flown||a.serial-b.serial)
    const label=open.shift()!
    if(!labels.get(label.key)?.includes(label))continue
    if(best&&label.f>=best.cost-EPS){open.unshift(label);break}
    expansions++
    finish(label.path,label.flown,label.g)
    for(const [dq,dr] of directions) {
      const nq=label.q+dq,nr=label.r+dr,p=axialToPoint(nq,nr)
      push(nq,nr,append(label.path,p),label.flown+distance(label.p,p),label.g+threatSegmentCost(label.p,p,threats))
    }
  }
  if(!best)return undefined
  const live=open.filter(l=>labels.get(l.key)?.includes(l))
  return {...best,expansions,optimal:live.every(l=>l.f>=best!.cost-EPS)}
}
