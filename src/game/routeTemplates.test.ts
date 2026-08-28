import { describe, expect, it } from 'vitest'
import { CAMPAIGN_WORLD_BOUNDS } from './world'
import { generateRouteTemplate, templatesForRole } from './routeTemplates'
import type { Point } from './types'

const base:Point=[-7.8,11.2]
const farTarget:Point=[8.8,-12.8]
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const missionDistance=(route:Point[])=>route.slice(1).reduce((sum,point,index)=>sum+distance(route[index],point),0)+distance(route.at(-1)!,base)

describe('route templates',()=>{
  it('only exposes role-appropriate movement templates',()=>{
    expect(templatesForRole('fighter').map(template=>template.id)).toEqual(['custom','defensive-cap','forward-patrol'])
    expect(templatesForRole('recon').map(template=>template.id)).toEqual(['custom','search-area','deep-probe'])
  })

  it('is deterministic for identical inputs',()=>{
    const input={template:'defensive-cap' as const,ingress:[base,[-3,5]] as Point[],maxDistance:40,bounds:CAMPAIGN_WORLD_BOUNDS}
    expect(generateRouteTemplate(input)).toEqual(generateRouteTemplate(input))
  })

  it('creates closed fighter patrol shapes',()=>{
    const defensive=generateRouteTemplate({template:'defensive-cap',ingress:[base,[-3,5]],maxDistance:40,bounds:CAMPAIGN_WORLD_BOUNDS})
    const forward=generateRouteTemplate({template:'forward-patrol',ingress:[base,[-3,5]],maxDistance:40,bounds:CAMPAIGN_WORLD_BOUNDS})
    expect(defensive.route.length).toBeGreaterThan(8)
    expect(forward.route.length).toBeGreaterThan(8)
    expect(distance(defensive.route[2],defensive.route.at(-1)!)).toBeLessThan(.001)
    expect(distance(forward.route[2],forward.route.at(-1)!)).toBeLessThan(.001)
    expect(Math.max(...forward.route.map(point=>distance(point,base)))).toBeGreaterThan(Math.max(...defensive.route.map(point=>distance(point,base))))
  })

  it('creates a multi-pass recon search and a direct probe',()=>{
    const ingress:[Point,Point,Point]=[base,[-2,5],[2,-4]]
    const search=generateRouteTemplate({template:'search-area',ingress,maxDistance:48,bounds:CAMPAIGN_WORLD_BOUNDS})
    const probe=generateRouteTemplate({template:'deep-probe',ingress,maxDistance:48,bounds:CAMPAIGN_WORLD_BOUNDS})
    expect(search.route.length).toBe(13)
    expect(probe.route.length).toBe(3)
    expect(search.route.slice(0,ingress.length)).toEqual(ingress)
    expect(probe.route).toEqual(ingress)
    expect(new Set(search.route.slice(1).map(point=>point[0].toFixed(2))).size).toBeGreaterThan(3)
  })

  it('preserves a drawn ingress while changing templates',()=>{
    const ingress:[Point,Point,Point]=[base,[-2,5],[2,-4]]
    const cap=generateRouteTemplate({template:'defensive-cap',ingress,maxDistance:40,bounds:CAMPAIGN_WORLD_BOUNDS})
    const patrol=generateRouteTemplate({template:'forward-patrol',ingress:cap.ingress,maxDistance:40,bounds:CAMPAIGN_WORLD_BOUNDS})
    expect(cap.ingress).toEqual(ingress)
    expect(patrol.ingress).toEqual(ingress)
  })

  it('keeps fitted routes inside bounds and reserves recovery fuel',()=>{
    for(const [template,maxDistance] of [['defensive-cap',40],['forward-patrol',40],['search-area',48],['deep-probe',48]] as const){
      const result=generateRouteTemplate({template,ingress:[base,farTarget],maxDistance,bounds:CAMPAIGN_WORLD_BOUNDS})
      expect(result.route.every(point=>point[0]>=CAMPAIGN_WORLD_BOUNDS.minX&&point[0]<=CAMPAIGN_WORLD_BOUNDS.maxX&&point[1]>=CAMPAIGN_WORLD_BOUNDS.minZ&&point[1]<=CAMPAIGN_WORLD_BOUNDS.maxZ)).toBe(true)
      expect(missionDistance(result.route)).toBeLessThanOrEqual(maxDistance+.001)
      expect(result.adjustment).not.toBe('none')
    }
  })
})
