import type { BoundarySegment, CampaignWorld, FriendlyTerritory, Point, WorldBounds, WorldEdge } from './types'
import { territoryBounds, territoryContains } from './territory'

export const CAMPAIGN_WORLD_BOUNDS:WorldBounds={minX:-14,maxX:14,minZ:-18,maxZ:18}
export const PRESENTATION_APRON=6
export const START_TERRITORY_RADIUS=4.5
export const MAPPED_AREA_RADIUS=2.65
export const MULTIPLAYER_EDGE_CLEARANCE=3.5
export const MULTIPLAYER_OPPONENT_SEPARATION=4.5

const START_ANCHORS:ReadonlyArray<{id:string;center:Point}>=[
  {id:'north-west',center:[-3,4]},
  {id:'north-east',center:[3,4]},
  {id:'south-west',center:[-3,-4]},
  {id:'south-east',center:[3,-4]},
]

const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value))
const keyFor=(point:Point)=>`${Math.round(point[0]*1000)}:${Math.round(point[1]*1000)}`
const seededIndex=(seed:number,length:number)=>Math.abs(Math.imul(seed^(seed>>>16),0x45d9f3b))%length
const contains=(bounds:WorldBounds,point:Point)=>point[0]>=bounds.minX-1e-7&&point[0]<=bounds.maxX+1e-7&&point[1]>=bounds.minZ-1e-7&&point[1]<=bounds.maxZ+1e-7
const edgeCoordinate=(edge:WorldEdge,point:Point)=>edge==='east'||edge==='west'?point[1]:point[0]
const boundaryCoordinate=(edge:WorldEdge,bounds:WorldBounds)=>edge==='east'?bounds.maxX:edge==='west'?bounds.minX:edge==='north'?bounds.maxZ:bounds.minZ
const edgeLimits=(edge:WorldEdge,bounds:WorldBounds):[number,number]=>edge==='east'||edge==='west'?[bounds.minZ,bounds.maxZ]:[bounds.minX,bounds.maxX]

export function generateCampaignWorld(seed:number):CampaignWorld{
  const start=START_ANCHORS[seededIndex(seed,START_ANCHORS.length)]
  return {seed,bounds:{...CAMPAIGN_WORLD_BOUNDS},presentationBounds:{minX:CAMPAIGN_WORLD_BOUNDS.minX-PRESENTATION_APRON,maxX:CAMPAIGN_WORLD_BOUNDS.maxX+PRESENTATION_APRON,minZ:CAMPAIGN_WORLD_BOUNDS.minZ-PRESENTATION_APRON,maxZ:CAMPAIGN_WORLD_BOUNDS.maxZ+PRESENTATION_APRON},startRegionId:start.id,friendlyTerritory:{center:[...start.center],radius:START_TERRITORY_RADIUS}}
}

/** Forward-compatible placement utility; it does not enable multiplayer mechanics. */
export function generateMultiplayerStartAnchors(seed:number,playerCount:number,bounds:WorldBounds=CAMPAIGN_WORLD_BOUNDS):Point[]{
  if(playerCount<=0)return []
  const candidates:Point[]=[]
  for(let z=bounds.minZ+MULTIPLAYER_EDGE_CLEARANCE;z<=bounds.maxZ-MULTIPLAYER_EDGE_CLEARANCE+1e-7;z+=3.5)for(let x=bounds.minX+MULTIPLAYER_EDGE_CLEARANCE;x<=bounds.maxX-MULTIPLAYER_EDGE_CLEARANCE+1e-7;x+=3.5)candidates.push([Number(x.toFixed(3)),Number(z.toFixed(3))])
  const ordered=candidates.map((point,index)=>({point,order:seededIndex(seed+index*7919,1_000_003)})).sort((a,b)=>a.order-b.order||a.point[1]-b.point[1]||a.point[0]-b.point[0]).map(entry=>entry.point)
  const starts:Point[]=[]
  for(const candidate of ordered){if(starts.every(existing=>distance(existing,candidate)>=MULTIPLAYER_OPPONENT_SEPARATION-1e-7))starts.push(candidate);if(starts.length===playerCount)return starts}
  throw new Error(`Unable to place ${playerCount} starts with the required world clearance.`)
}

export function createStartingKnowledge(world:CampaignWorld):{mappedAreas:Point[];discoveredBoundaries:BoundarySegment[]}{
  const {center,radius}=world.friendlyTerritory;const samples:Point[]=[];const spacing=1.25
  for(let z=center[1]-radius;z<=center[1]+radius+1e-7;z+=spacing)for(let x=center[0]-radius;x<=center[0]+radius+1e-7;x+=spacing){const point:Point=[Number(x.toFixed(3)),Number(z.toFixed(3))];if(distance(center,point)<=radius&&contains(world.bounds,point))samples.push(point)}
  samples.push([...center])
  return {mappedAreas:Array.from(new Map(samples.map(point=>[keyFor(point),point])).values()),discoveredBoundaries:[]}
}

/** Smallest player-known extent; deliberately does not consult hidden world edges. */
export function deriveKnownEnvelope(world:CampaignWorld,mappedAreas:Point[],boundaries:BoundarySegment[]=[],friendlyTerritory:FriendlyTerritory=world.friendlyTerritory):WorldBounds{
  const territory=territoryBounds(friendlyTerritory)
  const boundaryPoints:Point[]=boundaries.flatMap(segment=>segment.edge==='north'||segment.edge==='south'?[[segment.from,segment.coordinate],[segment.to,segment.coordinate]]:[[segment.coordinate,segment.from],[segment.coordinate,segment.to]])
  const points=[...mappedAreas,...boundaryPoints]
  return {minX:Math.min(territory.minX,...points.map(point=>point[0]-MAPPED_AREA_RADIUS)),maxX:Math.max(territory.maxX,...points.map(point=>point[0]+MAPPED_AREA_RADIUS)),minZ:Math.min(territory.minZ,...points.map(point=>point[1]-MAPPED_AREA_RADIUS)),maxZ:Math.max(territory.maxZ,...points.map(point=>point[1]+MAPPED_AREA_RADIUS))}
}

export const derivePlanningEnvelope=(known:WorldBounds,margin=4):WorldBounds=>({minX:known.minX-margin,maxX:known.maxX+margin,minZ:known.minZ-margin,maxZ:known.maxZ+margin})

export interface MovementIntersection{point:Point;edge:WorldEdge;t:number}
export function intersectMovementWithWorld(from:Point,to:Point,bounds:WorldBounds):MovementIntersection|undefined{
  if(!contains(bounds,from)||contains(bounds,to))return undefined
  const dx=to[0]-from[0],dz=to[1]-from[1],candidates:MovementIntersection[]=[]
  const add=(t:number,edge:WorldEdge)=>{if(t<0||t>1)return;const point:Point=[from[0]+dx*t,from[1]+dz*t];if(contains(bounds,point))candidates.push({point:[Number(point[0].toFixed(6)),Number(point[1].toFixed(6))],edge,t})}
  if(dx>0)add((bounds.maxX-from[0])/dx,'east');if(dx<0)add((bounds.minX-from[0])/dx,'west');if(dz>0)add((bounds.maxZ-from[1])/dz,'north');if(dz<0)add((bounds.minZ-from[1])/dz,'south')
  return candidates.sort((a,b)=>a.t-b.t)[0]
}

export function boundarySegmentsObservedAt(point:Point,radius:number,bounds:WorldBounds):BoundarySegment[]{
  const segments:BoundarySegment[]=[]
  const distances:[WorldEdge,number][]=[['west',Math.abs(point[0]-bounds.minX)],['east',Math.abs(point[0]-bounds.maxX)],['south',Math.abs(point[1]-bounds.minZ)],['north',Math.abs(point[1]-bounds.maxZ)]]
  for(const [edge,perpendicular] of distances){if(perpendicular>radius+1e-7)continue;const tangent=Math.sqrt(Math.max(0,radius*radius-perpendicular*perpendicular));const [min,max]=edgeLimits(edge,bounds);const center=edgeCoordinate(edge,point);const from=clamp(center-tangent,min,max),to=clamp(center+tangent,min,max);if(to-from>1e-5)segments.push({edge,coordinate:boundaryCoordinate(edge,bounds),from:Number(from.toFixed(6)),to:Number(to.toFixed(6))})}
  return segments
}

export function mergeBoundarySegments(existing:BoundarySegment[],incoming:BoundarySegment[]):BoundarySegment[]{
  const grouped=new Map<string,BoundarySegment[]>()
  for(const segment of [...existing,...incoming]){const normalized={...segment,from:Math.min(segment.from,segment.to),to:Math.max(segment.from,segment.to)};const key=`${segment.edge}:${segment.coordinate}`;grouped.set(key,[...(grouped.get(key)??[]),normalized])}
  const order:WorldEdge[]=['north','east','south','west'];const merged:BoundarySegment[]=[]
  for(const edge of order)for(const [,list] of [...grouped].filter(([,segments])=>segments[0].edge===edge).sort(([a],[b])=>a.localeCompare(b))){for(const segment of list.sort((a,b)=>a.from-b.from||a.to-b.to)){const current=merged.at(-1);if(current&&current.edge===segment.edge&&current.coordinate===segment.coordinate&&segment.from<=current.to+1e-5)current.to=Math.max(current.to,segment.to);else merged.push({...segment})}}
  return merged
}

export interface MapKnowledge{mappedAreas:Point[];friendlyTerritory:CampaignWorld['friendlyTerritory'];mappedRadius?:number}
export const isPointMapped=(point:Point,knowledge:MapKnowledge)=>territoryContains(point,knowledge.friendlyTerritory)||knowledge.mappedAreas.some(mapped=>distance(point,mapped)<=(knowledge.mappedRadius??MAPPED_AREA_RADIUS)+1e-7)
