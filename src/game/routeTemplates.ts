import type { Point, Role, RouteTemplateId } from './types'
import { missionDistance } from './engine'

export interface RouteBounds { minX:number; maxX:number; minZ:number; maxZ:number }
export interface RouteTemplateDefinition { id:RouteTemplateId; label:string; shortLabel:string; description:string; roles:Role[]; requiresTarget:boolean }
export type RouteAdjustment = 'none' | 'pattern-shrunk' | 'ingress-shortened'
export interface RouteGenerationResult { route:Point[]; ingress:Point[]; adjustment:RouteAdjustment }

export const ROUTE_TEMPLATES:RouteTemplateDefinition[]=[
  {id:'custom',label:'Custom',shortLabel:'CUSTOM',description:'Draw a route freely on the map.',roles:['fighter','recon'],requiresTarget:false},
  {id:'defensive-cap',label:'Defensive CAP',shortLabel:'DEFENSIVE CAP',description:'Append a compact patrol station at the end of the drawn ingress.',roles:['fighter'],requiresTarget:true},
  {id:'forward-patrol',label:'Forward Patrol',shortLabel:'FORWARD PATROL',description:'Append a wider forward patrol at the end of the drawn ingress.',roles:['fighter'],requiresTarget:true},
  {id:'search-area',label:'Search Area',shortLabel:'SEARCH AREA',description:'Append an exploration sweep at the end of the drawn ingress.',roles:['recon'],requiresTarget:true},
  {id:'deep-probe',label:'Deep Probe',shortLabel:'DEEP PROBE',description:'Use the drawn ingress as a direct probe with no extra sweep.',roles:['recon'],requiresTarget:true},
]

export const templatesForRole=(role:Role)=>ROUTE_TEMPLATES.filter(template=>template.roles.includes(role))
export const templateFor=(id:RouteTemplateId)=>ROUTE_TEMPLATES.find(template=>template.id===id)??ROUTE_TEMPLATES[0]

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
  return Array.from({length:9},(_,index)=>{
    const angle=-Math.PI/2+index*Math.PI*2/8
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

function build(template:RouteTemplateId,ingress:Point[],patternScale:number):Point[]{
  const base=ingress[0]
  const target=ingress.at(-1)!
  if(template==='custom'||template==='deep-probe')return ingress
  const {forward,side}=basis(base,target)
  if(template==='defensive-cap')return [...ingress,...patrolLoop(target,forward,side,.95*patternScale,.5*patternScale)]
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

export function generateRouteTemplate({template,ingress,maxDistance,bounds}:{template:RouteTemplateId;ingress:Point[];maxDistance:number;bounds:RouteBounds}):RouteGenerationResult{
  const safeIngress=ingress.map(point=>clampPoint(point,bounds))
  const base=safeIngress[0]??[0,0] as Point
  if(safeIngress.length<2)return {route:safeIngress,ingress:safeIngress,adjustment:'none'}
  if(template==='custom')return {route:safeIngress,ingress:safeIngress,adjustment:'none'}
  const initial=build(template,safeIngress,1)
  if(valid(initial,base,maxDistance,bounds))return {route:initial,ingress:safeIngress,adjustment:'none'}

  let low=.25,high=1
  for(let index=0;index<24;index++){
    const midpoint=(low+high)/2
    if(valid(build(template,safeIngress,midpoint),base,maxDistance,bounds))low=midpoint
    else high=midpoint
  }
  if(low>.25+.0001){
    return {route:build(template,safeIngress,low),ingress:safeIngress,adjustment:'pattern-shrunk'}
  }

  low=0;high=1
  for(let index=0;index<24;index++){
    const midpoint=(low+high)/2
    const shortened=prefixAtRatio(safeIngress,midpoint)
    if(valid(build(template,shortened,.25),base,maxDistance,bounds))low=midpoint
    else high=midpoint
  }
  const shortened=prefixAtRatio(safeIngress,low)
  return {route:build(template,shortened,.25),ingress:shortened,adjustment:'ingress-shortened'}
}
