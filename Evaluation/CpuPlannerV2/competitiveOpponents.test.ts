import { describe,expect,it } from 'vitest'
import { createCampaignDraft } from '../../src/game/data'
import { confirmCampaignSetup } from '../../src/game/campaignSetup'
import { MAX_FLIGHT_DISTANCE } from '../../src/game/flightRules'
import { validateRecoveryPackage } from '../../src/game/forwardBasing'
import { competitivePlayerOrders, resolveCompetitiveRound } from './competitiveOpponents'
import type { Asset, MatchState } from '../../src/game/types'

function campaign():MatchState {
  const draft=createCampaignDraft(29,'hard')
  return confirmCampaignSetup({...draft,setup:{...draft.setup!,stage:'review',placedAssetIds:[...draft.setup!.selectedAssetIds]}})
}
describe('competitive evaluation opponent contract',()=>{
  it('scouts with fighters and does not change orders when hidden CPU state changes',()=>{
    const s=campaign(),changed=structuredClone(s)
    changed.cpu!.plan=undefined;changed.cpu!.logistics=999;changed.cpu!.sites=[]
    changed.enemyAssets=changed.enemyAssets.map(a=>({...a,position:[a.position[0]+10,a.position[1]-10],health:5}))
    const before=structuredClone(s),orders=competitivePlayerOrders(s,'direct-rush')
    expect(competitivePlayerOrders(changed,'direct-rush').squadrons).toEqual(orders.squadrons)
    expect(s).toEqual(before)
    expect(orders.squadrons.filter(f=>f.role==='fighter').every(f=>f.mission==='transit'&&f.sortieOrdered)).toBe(true)
  })
  it('issues legal strikes with both fighters once a base is recovered and physically launches missiles',()=>{
    let s=campaign()
    const home=s.playerAssets.find(a=>a.kind==='base')!.position
    const base:Asset={...s.enemyAssets.find(a=>a.kind==='base')!,position:[home[0],home[1]+18],hidden:false,intel:'confirmed',confidence:100}
    s={...s,enemyAssets:[base],cpu:{...s.cpu!,plan:{round:1,objective:'defend',reason:'Isolate attacking script.',candidates:[],orders:s.cpu!.formations.map(f=>({...f,sortieOrdered:false}))}}}
    const orders=competitivePlayerOrders(s,'direct-rush'),ids=new Set(orders.squadrons.filter(f=>f.sortieOrdered!==false).map(f=>f.id))
    expect(orders.squadrons.filter(f=>f.mission==='base-strike'&&f.sortieOrdered!==false)).toHaveLength(2)
    expect(validateRecoveryPackage({playerAssets:orders.playerAssets,squadrons:orders.squadrons},MAX_FLIGHT_DISTANCE,ids).valid).toBe(true)
    const result=resolveCompetitiveRound(orders)
    expect(result.weaponEffects.filter(e=>e.kind==='air-to-ground-missile')).toHaveLength(2)
    expect(result.enemyBaseDamage).toBe(100)
  })
  it('sends recon home after a legitimate live base sighting and recovers its report',()=>{
    let s=campaign()
    const home=s.playerAssets.find(a=>a.kind==='base')!.position
    s={...s,enemyAssets:[{...s.enemyAssets.find(a=>a.kind==='base')!,position:[home[0],home[1]+12]}],
      cpu:{...s.cpu!,plan:{round:1,objective:'defend',reason:'Isolate online recon command.',candidates:[],orders:s.cpu!.formations.map(f=>({...f,sortieOrdered:false}))}}}
    const planned=competitivePlayerOrders(s,'direct-rush')
    const recon=planned.squadrons.find(f=>f.role==='recon')!
    const route=[home,[home[0],home[1]+12] as [number,number],[home[0]+8,home[1]+12] as [number,number]]
    planned.squadrons=planned.squadrons.map(f=>f.id===recon.id?{...f,route,routeIngress:route,plannedRecoveryFieldId:'p-base'}:{...f,sortieOrdered:false})
    const result=resolveCompetitiveRound(planned)
    expect(result.simulationCommands?.some(c=>c.unitId===recon.id&&c.type==='rtb')).toBe(true)
    expect(result.intelReports.some(r=>r.assetId==='e-base'&&r.recovered)).toBe(true)
  })
})
