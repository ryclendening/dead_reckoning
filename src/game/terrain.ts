import type { GeographyArchetype, Point, TerrainCell, TerrainKind, TerrainMap } from './types'
import type { FriendlyTerritory } from './types'
import { territoryContains } from './territory'

export const MOUNTAIN_FUEL_MULTIPLIER = 1.5

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
const seedUnit = (seed: number, salt: number) => {
  let value = (seed ^ salt) >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000
}

function classify(archetype: GeographyArchetype, seed: number, x: number, z: number): TerrainKind {
  const angle = seedUnit(seed, 0x43aa1) * Math.PI
  const along = x * Math.cos(angle) + z * Math.sin(angle)
  const across = -x * Math.sin(angle) + z * Math.cos(angle)
  const wobble = Math.sin(along * .31 + seed * .0007) * 1.25 + Math.sin(along * .79 + seed) * .35
  if (archetype === 'coast') {
    const channel = across - wobble
    return Math.abs(channel) < 1.45 && Math.abs(along) < 17 ? 'water' : 'land'
  }
  if (archetype === 'highlands') {
    const ridge = across - wobble
    const pass = Math.abs(along - (seedUnit(seed, 0x817) * 10 - 5)) < 1.8
    return Math.abs(ridge) < 1.35 && !pass ? 'mountain' : 'land'
  }
  const islands = [[-7,-6,5.8],[5,-8,5.2],[0,5,6.1],[9,5,3.5]] as const
  return islands.some(([cx, cz, radius], index) => distance([x,z],[cx + Math.sin(angle + index) * 2,cz + Math.cos(angle + index) * 2]) < radius + wobble * .2) ? 'land' : 'water'
}

/** Deterministic geography snapshot. The safe deployment clearings keep all opening assets on land. */
export function generateTerrainMap(seed: number, bounds: {minX:number;maxX:number;minZ:number;maxZ:number}, safeStarts: Point[] = []): TerrainMap {
  const archetypes: GeographyArchetype[] = ['coast','highlands','islands']
  const archetype = archetypes[Math.abs(seed) % archetypes.length]
  const cellSize = .75
  const width = Math.floor((bounds.maxX-bounds.minX)/cellSize+1e-6)+1
  const height = Math.floor((bounds.maxZ-bounds.minZ)/cellSize+1e-6)+1
  const safeRadius = 5.1
  const cells: TerrainCell[] = []
  for (let z = bounds.minZ; z <= bounds.maxZ + 1e-6; z += cellSize) {
    for (let x = bounds.minX; x <= bounds.maxX + 1e-6; x += cellSize) {
      const kind = safeStarts.some(start => distance(start,[x,z]) <= safeRadius) ? 'land' : classify(archetype,seed,x,z)
      cells.push({index:cells.length,x:Number(x.toFixed(3)),z:Number(z.toFixed(3)),kind})
    }
  }
  return {version:1,archetype,cellSize,originX:bounds.minX,originZ:bounds.minZ,width,height,cells}
}

const indexFor = (point: Point, terrain: TerrainMap) => {
  const ix = Math.round((point[0]-terrain.originX)/terrain.cellSize)
  const iz = Math.round((point[1]-terrain.originZ)/terrain.cellSize)
  if(ix<0||iz<0||ix>=terrain.width||iz>=terrain.height)return undefined
  const index = iz*terrain.width+ix
  let low=0,high=terrain.cells.length
  while(low<high){const middle=(low+high)>>>1;if(terrain.cells[middle].index<index)low=middle+1;else high=middle}
  const cell=terrain.cells[low]
  return cell?.index===index&&Math.abs(cell.x-point[0])<=terrain.cellSize*.51&&Math.abs(cell.z-point[1])<=terrain.cellSize*.51?cell:undefined
}

export const terrainKindAt = (point: Point, terrain?: TerrainMap): TerrainKind | undefined => terrain ? indexFor(point,terrain)?.kind : undefined

/** Samples the path against a knowledge-limited terrain snapshot. Unknown cells cost ordinary fuel. */
export function segmentFuelCost(from: Point, to: Point, terrain?: TerrainMap): number {
  const length=distance(from,to)
  if(!terrain||length<1e-7)return length
  const samples=Math.max(1,Math.ceil(length/(terrain.cellSize*.35)))
  let cost=0
  for(let index=0;index<samples;index++){
    const t=(index+.5)/samples
    const point:Point=[from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t]
    cost += length/samples*(terrainKindAt(point,terrain)==='mountain'?MOUNTAIN_FUEL_MULTIPLIER:1)
  }
  return cost
}

export const routeFuelCost = (route: Point[], terrain?: TerrainMap) => route.slice(1).reduce((sum,point,index)=>sum+segmentFuelCost(route[index],point,terrain),0)

export function groundFootprintIsClear(point: Point, terrain?: TerrainMap, radius = .8): boolean {
  if (!terrain) return true
  const step=terrain.cellSize*.5
  for(let z=-radius;z<=radius+1e-6;z+=step)for(let x=-radius;x<=radius+1e-6;x+=step){
    if(x*x+z*z>radius*radius)continue
    const kind=terrainKindAt([point[0]+x,point[1]+z],terrain)
    if(kind===undefined||kind==='water'||kind==='mountain')return false
  }
  return true
}

/** Retain only cells inside the viewer's surveyed areas. */
export function terrainKnownWithin(terrain: TerrainMap | undefined, areas: Point[], radius = 2.65, territory?:FriendlyTerritory): TerrainMap | undefined {
  if(!terrain)return undefined
  const known=terrain.cells.filter(cell=>areas.some(area=>distance(area,[cell.x,cell.z])<=radius)||Boolean(territory&&territoryContains([cell.x,cell.z],territory)))
  if(!known.length)return {version:1,cellSize:terrain.cellSize,originX:0,originZ:0,width:1,height:1,cells:[]}
  const original=(cell:TerrainCell)=>({ix:Math.round((cell.x-terrain.originX)/terrain.cellSize),iz:Math.round((cell.z-terrain.originZ)/terrain.cellSize)})
  const coordinates=known.map(cell=>({cell,...original(cell)}))
  const minX=Math.min(...coordinates.map(entry=>entry.ix)),maxX=Math.max(...coordinates.map(entry=>entry.ix))
  const minZ=Math.min(...coordinates.map(entry=>entry.iz)),maxZ=Math.max(...coordinates.map(entry=>entry.iz))
  const width=maxX-minX+1,height=maxZ-minZ+1
  const cells=coordinates.map(({cell,ix,iz})=>({...cell,index:(iz-minZ)*width+(ix-minX)})).sort((a,b)=>a.index-b.index)
  return {version:1,cellSize:terrain.cellSize,originX:terrain.originX+minX*terrain.cellSize,originZ:terrain.originZ+minZ*terrain.cellSize,width,height,cells}
}

export const terrainCode = (kind: TerrainKind): number => kind==='land'?0:kind==='water'?1:2
