import { describe, expect, it } from 'vitest'
import { enemyBaseFor } from './data'
import { groundStrikeTargets } from './campaign'
import { applyRound, createRoundSimulation, resolveRound } from './engine'
import { deriveRecoveryPlanningView } from './forwardBasing'
import { normalizeMatch } from './persistence'
import { buildGroundStrikeRoute, groundStrikeRoute, validateGroundStrikeOrder } from './routeTemplates'
import { createScenario } from './scenarios'
import type { Asset, MatchState, Point } from './types'

function strikeFixture(kind:Asset['kind']='sam'):MatchState{
  const state=createScenario('recon-recovery'),home=state.playerAssets.find(asset=>asset.kind==='base')!.position
  state.playerAssets=state.playerAssets.map(asset=>asset.kind==='sam'||asset.kind==='aaa'?{...asset,health:0}:asset)
  state.enemyAssets=state.enemyAssets.map(asset=>asset.id==='e-sam'?{...asset,kind,position:[home[0]+10,home[1]] as Point,intel:'confirmed',hidden:false,health:50,maxHealth:100}:asset.kind==='sam'||asset.kind==='aaa'?{...asset,health:0}:asset)
  const fighter=state.squadrons.find(squadron=>squadron.id==='viper')!
  fighter.aircraft=4;fighter.strength=100
  const route=buildGroundStrikeRoute(state,fighter.id,'e-sam')!
  state.squadrons=state.squadrons.map(squadron=>squadron.id===fighter.id?{...squadron,role:'fighter',mission:'base-strike',strikeTargetId:'e-sam',aircraft:4,strength:100,route,routeIngress:route,sortieOrdered:true,plannedRecoveryFieldId:'p-base'}:{...squadron,sortieOrdered:false})
  return state
}

describe('explicit ground strike orders',()=>{
  it.each(['sam','radar','aaa','fob','decoy'] as const)('strikes only the selected %s, persists its damage, and keeps base damage separate',kind=>{
    const state=strikeFixture(kind),result=resolveRound(state)
    const shots=result.weaponEffects.filter(effect=>effect.kind==='air-to-ground-missile')
    expect(shots).toHaveLength(1)
    expect(shots[0].targetId).toBe('e-sam')
    expect(shots[0].from).toEqual(state.squadrons.find(squadron=>squadron.id==='viper')!.route.at(-1))
    expect(result.assets.find(asset=>asset.id==='e-sam')).toMatchObject({health:0,struck:true})
    expect(result.enemyBaseDamage).toBe(0)
    expect(result.baseDamage).toBe(0)
    expect(applyRound(state,result).enemyAssets.find(asset=>asset.id==='e-sam')?.health).toBe(0)
    expect(result.events.find(event=>event.title==='GROUND TARGET STRUCK')?.detail).not.toContain('Home base')
  })

  it('rejects missing, hidden, provisional, friendly, destroyed, and stale targets without launching',()=>{
    for(const targetId of [undefined,'p-sam','missing','e-base']){
      const state=strikeFixture();state.squadrons[0].strikeTargetId=targetId
      expect(validateGroundStrikeOrder(state,state.squadrons[0])).toBe('SELECT A CONFIRMED GROUND TARGET')
      expect(resolveRound(state).weaponEffects.some(effect=>effect.kind==='air-to-ground-missile')).toBe(false)
    }
    for(const overrides of [{hidden:true},{intel:'probable' as const},{health:0}]){
      const state=strikeFixture();Object.assign(state.enemyAssets.find(asset=>asset.id==='e-sam')!,overrides)
      expect(groundStrikeTargets(state).map(asset=>asset.id)).not.toContain('e-sam')
      expect(validateGroundStrikeOrder(state,state.squadrons[0])).toBe('SELECT A CONFIRMED GROUND TARGET')
    }
  })

  it('does not attack ground sites on other fighter missions',()=>{
    const state=strikeFixture();state.squadrons[0].mission='transit'
    expect(resolveRound(state).weaponEffects.some(effect=>effect.kind==='air-to-ground-missile')).toBe(false)
  })

  it('preserves both anchors when clearing or editing optional waypoints and reserves recovery fuel',()=>{
    const state=strikeFixture(),fighter=state.squadrons[0],anchors=fighter.route
    const waypoints:Point[]=[[anchors[0][0],anchors[0][1]+2],[anchors[1][0],anchors[1][1]+2]]
    fighter.route=groundStrikeRoute(anchors,waypoints);fighter.routeIngress=fighter.route
    expect(validateGroundStrikeOrder(state,fighter)).toBeUndefined()
    expect(groundStrikeRoute(anchors,[])).toEqual(anchors)
    expect(groundStrikeRoute(anchors,Array(10).fill(waypoints[0]))).toHaveLength(7)
    const fob:Asset={...state.playerAssets[0],id:'p-crossed-fob',kind:'fob',position:waypoints[0],capacity:2,basedFormationIds:[]}
    state.playerAssets.push(fob)
    const view=deriveRecoveryPlanningView(state,fighter.id,fighter.route,40)!
    expect(view.valid).toBe(true)
    expect(view.normalizedRoute).toEqual(fighter.route)
    expect(view.intendedField.id).toBe('p-base')
    expect(view.missionDistance).toBeGreaterThan(Math.hypot(anchors[1][0]-anchors[0][0],anchors[1][1]-anchors[0][1])*2)
    expect(resolveRound(state).weaponEffects.find(effect=>effect.kind==='air-to-ground-missile')?.from).toEqual(anchors[1])
    fighter.route=[anchors[0],[anchors[0][0]+30,anchors[0][1]+30],anchors[1]]
    expect(validateGroundStrikeOrder(state,fighter)).toBe('GROUND STRIKE ROUTE EXCEEDS AVAILABLE RANGE')
  })

  it('does not release early just because an ingress leg is already inside target range',()=>{
    const state=strikeFixture(),fighter=state.squadrons[0],anchors=fighter.route,target=state.enemyAssets.find(asset=>asset.id==='e-sam')!
    // This intermediate point is in weapon range, but the final release anchor remains mandatory.
    fighter.route=[anchors[0],[target.position[0]-5.8,target.position[1]+.2],anchors[1]]
    fighter.routeIngress=fighter.route
    const simulation=createRoundSimulation(state)
    while(!simulation.complete){
      simulation.advance()
      const shot=simulation.result.weaponEffects.find(effect=>effect.kind==='air-to-ground-missile')
      if(shot){expect(shot.from).toEqual(anchors[1]);break}
    }
    expect(simulation.result.weaponEffects.some(effect=>effect.kind==='air-to-ground-missile')).toBe(true)
  })

  it('continues the strike through visual or radar contact instead of volunteering to chase',()=>{
    const state=strikeFixture();state.debugScenario='neutral-los'
    state.playerAssets=state.playerAssets.map(asset=>asset.kind==='radar'?{...asset,health:100,position:enemyBaseFor(state.world)}:asset)
    const result=resolveRound(state)
    expect(result.contactIntervals.some(contact=>contact.observerId==='viper'&&contact.targetId==='red-fighter')).toBe(true)
    expect(result.behaviorIntervals.filter(behavior=>behavior.unitId==='viper'&&behavior.mode==='intercepting')).toHaveLength(0)
    expect(result.events.filter(event=>event.title==='FIGHTER INTERCEPT'&&event.detail.includes('VIPER'))).toHaveLength(0)
  })

  it('still enters direct fighter combat when interdicted on its strike route',()=>{
    const state=strikeFixture();state.debugScenario='fighter-tail'
    const result=resolveRound(state)
    expect(result.combatSequences.some(sequence=>sequence.kind==='dogfight'&&sequence.participantIds.includes('viper'))).toBe(true)
    expect(result.behaviorIntervals.some(behavior=>behavior.unitId==='viper'&&behavior.mode==='dogfighting')).toBe(true)
  })

  it('preserves the explicit target on save and requires legacy orders without a target to be retasked',()=>{
    const state=strikeFixture()
    expect(normalizeMatch(JSON.parse(JSON.stringify(state))).squadrons[0].strikeTargetId).toBe('e-sam')
    delete state.squadrons[0].strikeTargetId
    const loaded=normalizeMatch(JSON.parse(JSON.stringify(state)))
    expect(validateGroundStrikeOrder(loaded,loaded.squadrons[0])).toBe('SELECT A CONFIRMED GROUND TARGET')
  })
})
