import { describe, it, expect } from 'vitest'
import { createMatch } from '../data'
import { executeCpuEconomyCommand } from './economy'
import { sidePlanningContext } from '../sideContext'
import { validateAssetPlacement } from '../sideEconomy'
import { applyRound, resolveRound } from '../engine'
import { normalizeMatch } from '../persistence'
import { formationField } from '../forwardBasing'
import type { MatchState, Point } from '../types'

function fixture() {
  let s = createMatch(7301)
  const h = s.enemyAssets.find(a => a.kind === 'base')!.position
  const f: Point = [h[0], h[1] + 7]
  s = { ...s, phase: 'adapt', cpu: { ...s.cpu!, mappedAreas: [f] }, squadrons: s.squadrons.map(u => ({ ...u, sortieOrdered: false })) }
  return { s, h, f }
}
function transit(s: MatchState, f: Point): MatchState {
  const h = s.enemyAssets.find(a => a.kind === 'base')!.position
  return { ...s, phase: 'plan', cpu: { ...s.cpu!, plan: { ...s.cpu!.plan!, orders: s.cpu!.plan!.orders.map(u => u.role === 'fighter' ? {
    ...u, mission: 'transit', sortieOrdered: true, plannedRecoveryFieldId: 'e-fob-1', route: [h, f], routeIngress: [h, f],
  } : { ...u, sortieOrdered: false }) } } }
}
describe('side-aware infrastructure gate', () => {
  it('builds legally, pays once per accepted command, and stages by actual recovery', () => {
    const { s, f } = fixture()
    expect(validateAssetPlacement(sidePlanningContext(s, 'cpu'), 'fob', f).valid).toBe(true)
    const built = executeCpuEconomyCommand(s, { actionId: 'build-fob', target: { kind: 'campaign', id: 'campaign' }, placement: f, expectedLogistics: 10 })
    expect(built.cpu!.logistics).toBe(2)
    expect(executeCpuEconomyCommand(built, { actionId: 'build-fob', target: { kind: 'campaign', id: 'campaign' }, placement: f })).toBe(built)
    const plan = transit(built, f), result = resolveRound(plan), settled = applyRound(plan, result)
    expect(result.cpuReport!.recoveryOutcomes).toContainEqual(expect.objectContaining({ formationId: 'red-fighter', actualFieldId: 'e-fob-1', outcome: 'recovered' }))
    expect(formationField(settled.enemyAssets, 'red-fighter')!.id).toBe('e-fob-1')
    expect(applyRound(settled, result)).toBe(settled)
    expect(normalizeMatch(JSON.parse(JSON.stringify(settled))).cpu).toEqual(settled.cpu)
    const trapped = { ...settled, enemyAssets: settled.enemyAssets.map(a => a.kind === 'fob' ? { ...a, health: 0, operational: false } : a) }
    const next = resolveRound(trapped)
    expect(next.cpuReport!.recoveryOutcomes).toContainEqual(expect.objectContaining({ formationId: 'red-fighter', actualFieldId: 'e-fob-1', outcome: 'trapped' }))
  })
  it('a constructed SAM fires through the shared defender resolver', () => {
    const { s, h } = fixture(), placement: Point = [h[0], h[1] + 3]
    const built = executeCpuEconomyCommand({ ...s, enemyAssets: s.enemyAssets.filter(a => a.kind === 'base') }, { actionId: 'build-sam', target: { kind: 'campaign', id: 'campaign' }, placement })
    expect(built.cpu!.logistics).toBe(2)
    const start: Point = [placement[0] + 1, placement[1]]
    const state: MatchState = { ...built, playerAssets: built.playerAssets.filter(a => a.kind === 'base').map(a => ({ ...a, position: start })), squadrons: built.squadrons.map(u => ({ ...u, sortieOrdered: u.role === 'recon', route: [start, [start[0] + 10, start[1]]], routeIngress: [start, [start[0] + 10, start[1]]] })) }
    const result = resolveRound(state)
    expect(result.weaponEffects.some(e => e.kind === 'sam' && e.sourceId === 'e-sam-1')).toBe(true)
    const shot = result.weaponEffects.find(e => e.kind === 'sam' && e.sourceId === 'e-sam-1')!
    expect(result.squadrons.find(u => u.id === shot.targetId)).toBeDefined()
    expect(shot.end).toBeGreaterThan(shot.start)
  })
  it('credits confirmed SAM attrition without requiring an airborne returning observer',()=>{
    const {s,h}=fixture(),placement:Point=[h[0],h[1]+3]
    const built=executeCpuEconomyCommand({...s,enemyAssets:s.enemyAssets.filter(a=>a.kind==='base')},{actionId:'build-sam',target:{kind:'campaign',id:'campaign'},placement})
    const start:Point=[placement[0]+1,placement[1]]
    const route:Point[]=[start,...Array.from({length:24},(_,i)=>[start[0]+Math.cos(i*Math.PI/2)*.8,start[1]+Math.sin(i*Math.PI/2)*.8] as Point),start]
    const ready:MatchState={...built,phase:'plan',playerAssets:built.playerAssets.filter(a=>a.kind==='base').map(a=>({...a,position:start})),
      cpu:{...built.cpu!,plan:{...built.cpu!.plan!,orders:built.cpu!.formations.map(f=>({...f,sortieOrdered:false,route:[h],routeIngress:[h]}))}},
      squadrons:built.squadrons.map(f=>({...f,sortieOrdered:f.id==='raven',...(f.id==='raven'?{aircraft:1,strength:25,route,routeIngress:route,plannedRecoveryFieldId:'p-base'}:{})}))}
    const result=resolveRound(ready)
    expect(result.cpuReport!.sites).toEqual([])
    expect(result.cpuReport!.confirmedKills,JSON.stringify({shots:result.weaponEffects.filter(e=>e.kind==='sam'),squadrons:result.squadrons.map(s=>({id:s.id,aircraft:s.aircraft,strength:s.strength})),sequences:result.combatSequences})).toBe(1)
    const settled=applyRound(ready,result)
    expect(settled.cpu!.logistics-ready.cpu!.logistics).toBe(7)
    expect(applyRound(settled,result)).toBe(settled)
  })
  it('does not construct on player-only mapping and restores a lost four-aircraft recon proportionally', () => {
    const { s } = fixture()
    const context = sidePlanningContext(s, 'cpu')
    expect(validateAssetPlacement(context, 'sam', [900, 900]).valid).toBe(false)
    s.cpu!.formations[1] = { ...s.cpu!.formations[1], aircraft: 0, strength: 0 }
    const restored = executeCpuEconomyCommand(s, { actionId: 'replace-aircraft', target: { kind: 'squadron', id: 'red-recon' } })
    expect(restored.cpu!.formations[1]).toMatchObject({ aircraft: 1, strength: 25 })
  })
})

describe('CPU recovery under field damage',()=>{
  it('diverts an inbound Transit when a real player strike disables its destination',()=>{
    const {s,f}=fixture()
    const built=executeCpuEconomyCommand(s,{actionId:'build-fob',target:{kind:'campaign',id:'campaign'},placement:f})
    let ready=transit(built,f)
    const fob=ready.enemyAssets.find(a=>a.kind==='fob')!
    const launch:Point=[f[0]+4,f[1]]
    const release:Point=[launch[0]+.01,launch[1]]
    ready={...ready,enemyAssets:ready.enemyAssets.map(a=>a.id===fob.id?{...a,health:30,intel:'confirmed',confidence:100,hidden:false}:a),
      playerAssets:ready.playerAssets.filter(a=>a.kind==='base').map(a=>({...a,position:launch})),squadrons:ready.squadrons.map(u=>({...u,sortieOrdered:u.id==='viper',...(u.id==='viper'?{mission:'base-strike',strikeTargetId:fob.id,plannedRecoveryFieldId:'p-base',route:[launch,release],routeIngress:[launch,release]}:{})}))}
    const result=resolveRound(ready)
    expect(result.assets.find(a=>a.id===fob.id)!.health,JSON.stringify({events:result.events.filter(e=>e.title.includes('STRIKE')),frames:result.unitTracks.find(u=>u.unitId==='viper')!.frames.slice(0,4)})).toBe(0)
    expect(result.cpuReport!.recoveryOutcomes).toContainEqual(expect.objectContaining({formationId:'red-fighter',outcome:'diverted',actualFieldId:'e-base'}))
    expect(result.events.some(e=>e.title==='RECOVERY DIVERSION'&&e.detail.includes('BOGEY'))).toBe(false)
  })
  it('does not expose construction to player intelligence',()=>{
    const {s,h}=fixture()
    const built=executeCpuEconomyCommand({...s,enemyAssets:s.enemyAssets.filter(a=>a.kind==='base')},{actionId:'build-sam',target:{kind:'campaign',id:'campaign'},placement:[h[0]+3,h[1]]})
    expect(built.enemyAssets.find(a=>a.kind==='sam')).toMatchObject({intel:'unknown',hidden:true,confidence:0})
  })
})
