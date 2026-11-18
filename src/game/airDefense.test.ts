import { describe, expect, it } from 'vitest'
import { samStatusAt, samStatusForPhase } from './airDefense'
import { createRoundSimulation, resolveRound } from './engine'
import { createMatch, enemyAssetsFor } from './data'
import { effectiveDefenseProfile, inCoverageCircle, SAM_DEPLOYMENT_LIMIT } from './equipmentRules'
import { projectGroundAssetAt } from './executionProjection'
import { createScenario } from './scenarios'
import { generateCampaignWorld } from './world'
import type { MatchState, Point } from './types'

function defenseFixture(twoFlights=false):MatchState{
  const state=createScenario('recon-recovery'),home=state.playerAssets.find(asset=>asset.kind==='base')!.position
  state.playerAssets=state.playerAssets.map(asset=>asset.kind==='base'?asset:{...asset,health:0})
  state.enemyAssets=state.enemyAssets.map(asset=>asset.kind==='sam'?{...asset,position:[home[0]+.5,home[1]] as Point}:asset.kind==='aaa'?{...asset,health:0}:asset)
  const route:Point[]=[home,...Array.from({length:24},(_,index)=>[home[0]+(index%2?1:-1),home[1]+(index%4<2?1:-1)] as Point)]
  state.squadrons=state.squadrons.map(squadron=>({...squadron,aircraft:4,strength:100,sortieOrdered:squadron.id==='raven'||twoFlights&&squadron.id==='ghost',route,routeIngress:route,plannedRecoveryFieldId:'p-base'}))
  return state
}

describe('finite SAM salvos',()=>{
  it('throttles overlapping SAM volleys in saves with older battery stacks', () => {
    const state = defenseFixture()
    const battery = state.enemyAssets.find(asset => asset.id === 'e-sam')!
    state.enemyAssets.push(...Array.from({ length: 7 }, (_, index) => ({ ...battery, id: `e-sam-extra-${index}` })))
    const launches = resolveRound(state).weaponEffects.filter(effect => effect.kind === 'sam' && effect.targetId === 'raven')
    expect(launches.filter(shot => shot.start === launches[0].start)).toHaveLength(SAM_DEPLOYMENT_LIMIT)
    for (const launch of launches) {
      const incoming = launches.filter(shot => shot.start <= launch.start && launch.start < shot.end)
      expect(incoming.length).toBeLessThanOrEqual(SAM_DEPLOYMENT_LIMIT)
    }
  })

  it('can repeatedly shoot the same formation, spends misses, and waits three seconds between all launches',()=>{
    const state=defenseFixture(),result=resolveRound(state),shots=result.weaponEffects.filter(effect=>effect.kind==='sam'&&effect.sourceId==='e-sam')
    expect(shots).toHaveLength(3)
    expect(new Set(shots.map(shot=>shot.targetId))).toEqual(new Set(['raven']))
    for(let index=1;index<shots.length;index++)expect(shots[index].start-shots[index-1].start).toBeCloseTo(3,6)
    expect(samStatusAt('e-sam',shots,shots[0].start-.001).remaining).toBe(3)
    expect(samStatusAt('e-sam',shots,shots[0].start)).toMatchObject({remaining:2,cooldown:3})
    expect(samStatusAt('e-sam',shots,result.duration).remaining).toBe(0)
    const miss={...shots[0],hit:false,damage:0}
    expect(samStatusAt('e-sam',[miss],miss.start).remaining).toBe(2)
    expect(result.contactIntervals.filter(contact=>contact.source==='radar')).toHaveLength(0)
  })

  it('shares the ammo and cooldown across formations instead of granting three shots per target',()=>{
    const state=defenseFixture(true),result=resolveRound(state),shots=result.weaponEffects.filter(effect=>effect.kind==='sam'&&effect.sourceId==='e-sam')
    expect(shots).toHaveLength(3)
    for(let index=1;index<shots.length;index++)expect(shots[index].start-shots[index-1].start).toBeGreaterThanOrEqual(3-.000001)
    expect(resolveRound(state)).toEqual(result)
    expect(samStatusAt('other-site',shots,result.duration).remaining).toBe(3)
  })

  it('resets ammunition on each round and agrees between live and batch simulation',()=>{
    const state=defenseFixture(),batch=resolveRound(state),simulation=createRoundSimulation(state)
    expect(samStatusAt('e-sam',simulation.result.weaponEffects,0).remaining).toBe(3)
    while(!simulation.complete)simulation.advance()
    expect(simulation.result).toEqual(batch)
    const next=createRoundSimulation({...state,round:state.round+1,lastResult:batch})
    expect(samStatusAt('e-sam',next.result.weaponEffects,0).remaining).toBe(3)
  })

  it('uses the same replenished ammunition for the map rack and inspector between rounds',()=>{
    const state=defenseFixture(),result=resolveRound(state)
    expect(samStatusForPhase('e-sam','debrief',result.weaponEffects,result.duration).remaining).toBe(0)
    for(const phase of ['adapt','plan'] as const){
      expect(samStatusForPhase('e-sam',phase,result.weaponEffects,result.duration)).toEqual({capacity:3,remaining:3,cooldown:0})
    }
  })

  it.each([{health:0},{operational:false}])('prevents launches by a destroyed or disabled SAM (%j)',overrides=>{
    const state=defenseFixture();Object.assign(state.enemyAssets.find(asset=>asset.id==='e-sam')!,overrides)
    expect(resolveRound(state).weaponEffects.filter(effect=>effect.kind==='sam'&&effect.sourceId==='e-sam')).toHaveLength(0)
  })
})

describe('radar-assisted ground defense',()=>{
  it('places both opening CPU batteries inside radar coverage across seeded layouts',()=>{
    for(let seed=0;seed<64;seed++){
      const sites=enemyAssetsFor(generateCampaignWorld(seed))
      const radar=sites.find(site=>site.kind==='radar')!
      for(const battery of sites.filter(site=>site.kind==='sam'||site.kind==='aaa')){
        expect(effectiveDefenseProfile(battery,sites)?.radarLinks.map(link=>link.id),`Seed ${seed}: ${battery.kind}`).toContain(radar.id)
      }
    }
  })

  it('links only operational batteries and their own in-range radars, without stacking',()=>{
    const state=createMatch(),sam={...state.playerAssets.find(a=>a.kind==='sam')!,position:[0,0] as Point}
    const aaa={...sam,kind:'aaa' as const}
    const radar={...state.playerAssets.find(a=>a.kind==='radar')!,position:[6.4,0] as Point}
    const linked=effectiveDefenseProfile(sam,[sam,radar])!
    const canFire=(position:Point)=>linked.coverage.some(circle=>inCoverageCircle(position,circle))
    expect(canFire([12.8,0])).toBe(true) // Inside the radar zone, far beyond the launcher.
    expect(canFire([-4,0])).toBe(false) // Inside the old launcher-centered 6.4 radius.
    expect(canFire([-3,0])).toBe(true) // Standalone range remains available.
    expect(effectiveDefenseProfile(aaa,[radar,{...radar,id:'spare'}])?.range).toBeCloseTo(2.85)
    for(const unavailable of [{...radar,position:[6.41,0] as Point},{...radar,health:0},{...radar,operational:false}]) {
      expect(effectiveDefenseProfile(sam,[unavailable])).toMatchObject({range:3.2,radarLinks:[],coverage:[{position:sam.position,radius:3.2}]})
      expect(effectiveDefenseProfile(aaa,[unavailable])).toMatchObject({range:1.9,radarLinks:[]})
    }
    expect(effectiveDefenseProfile({...sam,operational:false},[radar])).toBeUndefined()
  })

  it('drops extended range on the radar-destroying impact and resolves an already-launched missile',()=>{
    const state=createMatch(7301)
    const [home,enemyHome,radarPosition,samPosition]:Point[]=[[0,0],[15,0],[3,0],[7,0]]
    const initialRadar={...state.enemyAssets.find(a=>a.kind==='radar')!,position:radarPosition,health:60,intel:'confirmed' as const,hidden:false}
    const sampleRoute:Point[]=[home,...Array.from({length:13},(_,i)=>[i%2?.8:2,i%3*.1] as Point),home]
    state.playerAssets=state.playerAssets.filter(a=>a.kind==='base').map(a=>({...a,position:home}))
    state.enemyAssets=[...state.enemyAssets.filter(a=>a.kind==='base').map(a=>({...a,position:enemyHome})),
      initialRadar,{...state.enemyAssets.find(a=>a.kind==='sam')!,position:samPosition}]
    state.squadrons=state.squadrons.map(f=>{
      const route:Point[]=f.role==='recon'?sampleRoute:[home,[.1,0]]
      return {...f,sortieOrdered:f.id==='viper'||f.id==='raven',route,routeIngress:route,plannedRecoveryFieldId:'p-base',
        ...(f.role==='fighter'?{mission:'base-strike' as const,strikeTargetId:initialRadar.id}:{reconPosture:'aggressive' as const})}
    })
    state.cpu!.plan={round:state.round,objective:'defend',reason:'All enemy aircraft grounded.',candidates:[],
      orders:state.cpu!.formations.map(f=>({...f,sortieOrdered:false}))}

    const result=resolveRound(state)
    const impact=result.combatSequences.find(s=>s.kind==='strike')!.exchanges[0].time
    const shots=result.weaponEffects.filter(e=>e.kind==='sam')
    expect(shots).toHaveLength(1)
    expect(shots[0]).toMatchObject({targetId:'raven'})
    expect(shots[0].start).toBeLessThan(impact)
    expect(shots[0].end).toBeGreaterThan(impact)
    expect(result.combatSequences.some(s=>s.kind==='defense'&&s.exchanges.some(e=>e.weapon==='sam'&&e.time>impact))).toBe(true)
    expect(projectGroundAssetAt(initialRadar,result,impact-.05).health).toBe(60)
    expect(projectGroundAssetAt(initialRadar,result,impact).health).toBe(0)

    const survives={...state,enemyAssets:state.enemyAssets.map(a=>a.kind==='radar'?{...a,health:100}:a)}
    expect(resolveRound(survives).weaponEffects.filter(e=>e.kind==='sam').length).toBeGreaterThan(1)
  })
})
