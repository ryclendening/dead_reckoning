import { describe, expect, it } from 'vitest'
import { FOB_TERRITORY_RADIUS, friendlyTerritoryForAssets, territoryBounds, territoryContains, territoryRegions } from './territory'

const home={center:[0,0] as [number,number],radius:4.5}
const fob=(overrides:Partial<{id:string;health:number;operational:boolean;position:[number,number]}>={})=>({id:'p-fob-1',kind:'fob' as const,position:[7,0] as [number,number],health:100,operational:true,...overrides})

describe('friendly territory model',()=>{
  it('derives a home region and operational FOB regions',()=>{
    const territory=friendlyTerritoryForAssets(home,[fob()])
    expect(territoryRegions(territory)).toEqual([{id:'home-territory',kind:'home',center:[0,0],radius:4.5},{id:'p-fob-1',kind:'fob',center:[7,0],radius:FOB_TERRITORY_RADIUS}])
    expect(territoryContains([9.5,0],territory)).toBe(true)
    expect(territoryContains([10.1,0],territory)).toBe(false)
  })
  it('omits disabled or destroyed FOB influence',()=>{const territory=friendlyTerritoryForAssets(home,[fob({operational:false}),fob({id:'destroyed',health:0})]);expect(territoryRegions(territory)).toHaveLength(1);expect(territoryContains([7,0],territory)).toBe(false)})
  it('derives bounds across the home and FOB regions',()=>{const territory=friendlyTerritoryForAssets(home,[fob()]);expect(territoryBounds(territory)).toEqual({minX:-4.5,maxX:10,minZ:-4.5,maxZ:4.5})})
})
