import {describe,expect,it} from 'vitest'
import {deriveFogMaskSize,updateLiveFogMask,updatePersistentFogMask} from './fog'
import type {FogMaskInput} from './fog'
import {generateCampaignWorld} from './world'

describe('fog mask sizing',()=>{
  it('keeps the two generated-world masks within the 72 KB budget',()=>{const size=deriveFogMaskSize(generateCampaignWorld(7301).presentationBounds);expect(size).toEqual({width:160,height:192});expect(size.width*size.height*2).toBeLessThanOrEqual(72*1024)})

  it('distinguishes unknown, mapped, and friendly persistent knowledge',()=>{
    const input:FogMaskInput={mappedAreas:[[-1.5,1.5]],observations:[],width:4,height:4,presentationBounds:{minX:-2,maxX:2,minZ:-2,maxZ:2},friendlyTerritory:{center:[.5,-.5],radius:.75}},target=new Uint8Array(16)
    updatePersistentFogMask(input,target)
    expect(target[0]).toBe(153)
    expect(target[2*4+2]).toBe(255)
    expect(target[3]).toBe(0)
  })

  it('reveals only the current live-observation footprint in the live mask',()=>{
    const input:FogMaskInput={mappedAreas:[[-1.5,1.5]],observations:[{position:[.5,-.5],radius:.75}],width:4,height:4,presentationBounds:{minX:-2,maxX:2,minZ:-2,maxZ:2},friendlyTerritory:{center:[10,10],radius:1}},target=new Uint8Array(16)
    updateLiveFogMask(input,target)
    expect(target[2*4+2]).toBe(255)
    expect(target[0]).toBe(0)
  })
})
