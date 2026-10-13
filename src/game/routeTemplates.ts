import type { MatchState, MissionId, Point, Role, Squadron } from './types'
import { missionDistance } from './engine'
import { BASE_STRIKE_RANGE, confirmedStrikeTarget } from './campaign'
import { formationField, snapRouteToRecoveryField } from './forwardBasing'

export interface RouteBounds { minX:number; maxX:number; minZ:number; maxZ:number }
export interface RouteTemplateDefinition { id:MissionId; label:string; shortLabel:string; description:string; roles:Role[]; requiresTarget:boolean }
export type RouteAdjustment = 'none' | 'pattern-shrunk' | 'ingress-shortened' | 'ingress-clamped'
export interface RouteGenerationResult { route:Point[]; ingress:Point[]; requestedIngress:Point[]; adjustment:RouteAdjustment }

export const ROUTE_TEMPLATES:RouteTemplateDefinition[]=[
  {id:'base-strike',label:'Base Strike',shortLabel:'BASE STRIKE',description:'Approach a confirmed enemy base and release one air-to-ground missile inside 6 units.',roles:['fighter'],requiresTarget:true},
  {id:'transit',label:'Transit',shortLabel:'TRANSIT',description:'Fly to a friendly airfield without diverting to intercept contacts.',roles:['fighter'],requiresTarget:true},
  {id:'defensive-cap',label:'Protect',shortLabel:'PROTECT',description:'Choose a friendly site, flight, or map point. Intercept threats inside the moving or fixed cover circle; break off at its marked edge.',roles:['fighter'],requiresTarget:true},
  {id:'forward-patrol',label:'Forward Patrol',shortLabel:'FORWARD PATROL',description:'Hunt inside the corridor around the patrol route, then break pursuit at its marked edge. Shots +10 points; incoming hits +6 points.',roles:['fighter'],requiresTarget:true},
  {id:'search-area',label:'Search Area',shortLabel:'SEARCH AREA',description:'Fixed search pattern appended at the chosen location.',roles:['recon'],requiresTarget:true},
]

export const templatesForRole=(role:Role)=>ROUTE_TEMPLATES.filter(template=>template.roles.includes(role))
export const templateFor=(id:MissionId)=>ROUTE_TEMPLATES.find(template=>template.id===id)??ROUTE_TEMPLATES[0]

export function buildBaseStrikeRoute(state:MatchState,squadronId:string):Point[]|undefined{
  const squadron=state.squadrons.find(item=>item.id===squadronId),target=confirmedStrikeTarget(state)
  if(!squadron||squadron.role!=='fighter'||squadron.aircraft<=0||!target)return undefined
  const launch=formationField(state.playerAssets,squadron.id)
  if(!launch||!launch.health||launch.health<=0||(launch.kind==='fob'&&launch.operational===false))return undefined
  const origin=launch.position,d=distance(origin,target.position)
  if(d<=BASE_STRIKE_RANGE){
    const waypoint:Point=d>.001?[origin[0]+(target.position[0]-origin[0])*Math.min(.25,d)/d,origin[1]+(target.position[1]-origin[1])*Math.min(.25,d)/d]:[origin[0]+.05,origin[1]]
    return [origin,waypoint]
  }
  const approachDistance=Math.min(BASE_STRIKE_RANGE-.1,d)
  const approach:Point=[target.position[0]+(origin[0]-target.position[0])*approachDistance/d,target.position[1]+(origin[1]-target.position[1])*approachDistance/d]
  const route=snapRouteToRecoveryField([origin,approach],state.playerAssets)
  if(missionDistance(route,origin)>40+.001||distance(route.at(-1)!,target.position)>BASE_STRIKE_RANGE+.001)return undefined
  return route
}

function closestRouteDistance(route:Point[],target:Point):number{
  if(!route.length)return Infinity
  if(route.length===1)return distance(route[0],target)
  let closest=Infinity
  for(let index=1;index<route.length;index++){
    const from=route[index-1],to=route[index],dx=to[0]-from[0],dz=to[1]-from[1],lengthSquared=dx*dx+dz*dz
    const progress=lengthSquared<1e-9?0:clamp(((target[0]-from[0])*dx+(target[1]-from[1])*dz)/lengthSquared,0,1)
    closest=Math.min(closest,distance(target,[from[0]+dx*progress,from[1]+dz*progress]))
  }
  return closest
}

export function validateBaseStrikeOrder(state:MatchState,squadron:Squadron):string|undefined{
  if(squadron.mission!=='base-strike')return undefined
  const target=confirmedStrikeTarget(state)
  if(!target)return 'CONFIRM THE ENEMY BASE BEFORE STRIKING'
  if(squadron.role!=='fighter')return 'BASE STRIKE REQUIRES A FIGHTER'
  const launch=formationField(state.playerAssets,squadron.id)
  if(!launch)return 'NO OPERATIONAL LAUNCH FIELD'
  const route=snapRouteToRecoveryField([[...launch.position],...squadron.route.slice(1)],state.playerAssets)
  if(route.length<2||missionDistance(route,launch.position)>40+.001)return 'BASE STRIKE ROUTE EXCEEDS AVAILABLE RANGE'
  if(closestRouteDistance(route,target.position)>BASE_STRIKE_RANGE+.001)return 'ROUTE MUST APPROACH WITHIN 6 UNITS OF THE ENEMY BASE'
  return undefined
}

const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value))
const add=(a:Point,b:Point)=>[a[0]+b[0],a[1]+b[1]] as Point
const scale=(a:Point,value:number)=>[a[0]*value,a[1]*value] as Point
const within=(point:Point,bounds:RouteBounds)=>point[0]>=bounds.minX&&point[0]<=bounds.maxX&&point[1]>=bounds.minZ&&point[1]<=bounds.maxZ
const clampPoint=(point:Point,bounds:RouteBounds):Point=>[clamp(point[0],bounds.minX,bounds.maxX),clamp(point[1],bounds.minZ,bounds.maxZ)]

function basis(base:Point,target:Point){
  const length=distance(base,target)
  const forward=length<.001?[0,1] as Point:scale([target[0]-base[0],target[1]-base[1]],1/length)
  return {forward,side:[-forward[1],forward[0]] as Point}
}

function offset(center:Point,forward:Point,side:Point,forwardAmount:number,sideAmount:number):Point{
  return add(center,add(scale(forward,forwardAmount),scale(side,sideAmount)))
}

function patrolLoop(center:Point,forward:Point,side:Point,sideRadius:number,forwardRadius:number):Point[]{
  return Array.from({length:33},(_,index)=>{
    const angle=-Math.PI/2+index*Math.PI*2/32
    return offset(center,forward,side,Math.sin(angle)*forwardRadius,Math.cos(angle)*sideRadius)
  })
}

function searchSweep(center:Point,forward:Point,side:Point,sideRadius:number,forwardRadius:number):Point[]{
  const passes:Point[]=[]
  for(let index=0;index<5;index++){
    const depth=-forwardRadius+(forwardRadius*2)*(index/4)
    const left=offset(center,forward,side,depth,-sideRadius)
    const right=offset(center,forward,side,depth,sideRadius)
    passes.push(index%2===0?left:right,index%2===0?right:left)
  }
  return passes
}

function build(template:MissionId,ingress:Point[],patternScale:number):Point[]{
  if(template==='base-strike'||template==='transit')return ingress
  const base=ingress[0]
  const target=ingress.at(-1)!
  const {forward,side}=basis(base,target)
  if(template==='defensive-cap')return [...ingress,...patrolLoop(target,forward,side,4.5*patternScale,4.5*patternScale)]
  if(template==='forward-patrol'){
    const patrolCenter=add(target,scale(forward,.55*patternScale))
    return [...ingress,...patrolLoop(patrolCenter,forward,side,1.55*patternScale,.42*patternScale)]
  }
  return [...ingress,...searchSweep(target,forward,side,2.2*patternScale,2*patternScale)]
}

function valid(route:Point[],base:Point,maxDistance:number,bounds:RouteBounds){return route.every(point=>within(point,bounds))&&missionDistance(route,base)<=maxDistance+.001}

function prefixAtRatio(route:Point[],ratio:number):Point[]{
  if(route.length<2)return route
  const total=route.slice(1).reduce((sum,point,index)=>sum+distance(route[index],point),0)
  let remaining=total*ratio
  const prefix:Point[]=[route[0]]
  for(let index=1;index<route.length;index++){
    const from=route[index-1],to=route[index],segment=distance(from,to)
    if(remaining>=segment){prefix.push(to);remaining-=segment;continue}
    if(remaining>.001)prefix.push([from[0]+(to[0]-from[0])*remaining/segment,from[1]+(to[1]-from[1])*remaining/segment])
    break
  }
  return prefix
}

export function generateRouteTemplate({template,ingress,maxDistance,bounds}:{template:MissionId;ingress:Point[];maxDistance:number;bounds:RouteBounds}):RouteGenerationResult{
  const safeIngress=ingress.map(point=>clampPoint(point,bounds))
  const clampedIngress=safeIngress.some((point,index)=>point[0]!==ingress[index]?.[0]||point[1]!==ingress[index]?.[1])
  const base=safeIngress[0]??[0,0] as Point
  if(safeIngress.length<2)return {route:safeIngress,ingress:safeIngress,requestedIngress:ingress,adjustment:clampedIngress?'ingress-clamped':'none'}
  const initial=build(template,safeIngress,1)
  if(valid(initial,base,maxDistance,bounds))return {route:initial,ingress:safeIngress,requestedIngress:ingress,adjustment:clampedIngress?'ingress-clamped':'none'}

  let low=.25,high=1
  for(let index=0;index<24;index++){
    const midpoint=(low+high)/2
    if(valid(build(template,safeIngress,midpoint),base,maxDistance,bounds))low=midpoint
    else high=midpoint
  }
  if(low>.25+.0001){
    return {route:build(template,safeIngress,low),ingress:safeIngress,requestedIngress:ingress,adjustment:clampedIngress?'ingress-clamped':'pattern-shrunk'}
  }
  low=0;high=1
  for(let index=0;index<24;index++){
    const midpoint=(low+high)/2
    const shortened=prefixAtRatio(safeIngress,midpoint)
    if(valid(build(template,shortened,.25),base,maxDistance,bounds))low=midpoint
    else high=midpoint
  }
  const shortened=prefixAtRatio(safeIngress,low)
  return {route:build(template,shortened,.25),ingress:shortened,requestedIngress:ingress,adjustment:clampedIngress?'ingress-clamped':'ingress-shortened'}
}
