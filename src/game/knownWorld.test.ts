import {describe,expect,it} from 'vitest'
import type {Asset,WorldBounds} from './types'
import {deriveKnownWorldModel} from './knownWorld'
import type {KnownWorldInput} from './knownWorld'

const asset=(id:string,overrides:Partial<Asset>={}):Asset=>({id,kind:'sam',position:[0,0],intel:'confirmed',confidence:95,health:100,maxHealth:100,hidden:false,struck:false,...overrides})
const baseKnowledge=():KnownWorldInput=>({mappedAreas:[[0,0],[2,0]],friendlyTerritory:{center:[0,0],radius:4.5},friendlyAssets:[asset('p-base',{kind:'base',position:[-1,1]})],enemyAssets:[],discoveredBoundaries:[]})

describe('deriveKnownWorldModel',()=>{
  it('excludes hidden assets, aircraft-shaped extras, and undiscovered edges',()=>{const input={...baseKnowledge(),enemyAssets:[asset('hidden-confirmed',{hidden:true}),asset('visible-unknown',{intel:'unknown'}),asset('known-probable',{intel:'probable',position:[3,-2]})],discoveredBoundaries:[{edge:'east' as const,coordinate:14,from:-1,to:2}],liveAircraft:[{id:'red-air',position:[4,4]}]};const model=deriveKnownWorldModel(input);expect(model.enemyAssets.map(item=>item.id)).toEqual(['known-probable']);expect(model.boundaries).toHaveLength(1);expect(model.unchartedDirections).toEqual(['north','south','west']);expect(model).not.toHaveProperty('liveAircraft')})
  it('derives its view box only from known information',()=>{const knowledge=baseKnowledge(),compact:WorldBounds={minX:-14,maxX:14,minZ:-18,maxZ:18},enormous:WorldBounds={minX:-1400,maxX:1400,minZ:-1800,maxZ:1800};expect(deriveKnownWorldModel({...knowledge,world:{bounds:compact}} as KnownWorldInput).viewBox).toEqual(deriveKnownWorldModel({...knowledge,world:{bounds:enormous}} as KnownWorldInput).viewBox)})
  it('keeps probable and confirmed fixed intelligence',()=>{const model=deriveKnownWorldModel({...baseKnowledge(),enemyAssets:[asset('probable-radar',{kind:'radar',intel:'probable'}),asset('confirmed-sam'),asset('suspected-aaa',{kind:'aaa',intel:'suspected'})]});expect(model.enemyAssets.map(item=>item.id)).toEqual(['confirmed-sam','probable-radar'])})
  it('expands only when recovered knowledge is supplied',()=>{const before=baseKnowledge(),failed=deriveKnownWorldModel(before),recovered=deriveKnownWorldModel({...before,mappedAreas:[...before.mappedAreas,[12,-7]]});expect(deriveKnownWorldModel({...before,mappedAreas:[...before.mappedAreas]}).viewBox).toEqual(failed.viewBox);expect(recovered.viewBox.maxX).toBeGreaterThan(failed.viewBox.maxX);expect(recovered.viewBox.minZ).toBeLessThan(failed.viewBox.minZ)})
  it('projects exact recovered boundary coordinates without true bounds',()=>{const model=deriveKnownWorldModel({...baseKnowledge(),discoveredBoundaries:[{edge:'east',coordinate:14,from:-1.5,to:2.25}]});expect(model.boundaries).toEqual([{edge:'east',from:[14,-1.5],to:[14,2.25]}])})
})
