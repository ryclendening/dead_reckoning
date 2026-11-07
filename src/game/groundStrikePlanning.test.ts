import { describe, expect, it } from 'vitest'
import { createMatch } from './data'
import { isGroundStrikeTargeting, planGroundStrike } from './groundStrikePlanning'
import { validateGroundStrikeOrder } from './routeTemplates'

function fixture(){
  const state=createMatch()
  state.enemyAssets=state.enemyAssets.map(asset=>({...asset,intel:'confirmed',hidden:false}))
  return state
}

describe('battlefield ground strike selection',()=>{
  it('requires the Ground Strike task before a battlefield target can be assigned',()=>{
    const state=fixture(),fighter=state.squadrons.find(flight=>flight.role==='fighter')!
    fighter.mission='defensive-cap';fighter.protectedTargetId='raven';fighter.plannedRecoveryFieldId='p-base'
    expect(planGroundStrike(state,fighter.id,'e-sam')).toBeUndefined()
    fighter.mission='base-strike'
    const order=planGroundStrike(state,fighter.id,'e-sam')!
    expect(order).toMatchObject({id:fighter.id,mission:'base-strike',strikeTargetId:'e-sam'})
    expect(order.protectedTargetId).toBeUndefined()
    expect(order.plannedRecoveryFieldId).toBeUndefined()
    expect(order.route).toHaveLength(2)
    expect(order.routeIngress).toEqual(order.route)
    expect(validateGroundStrikeOrder(state,order)).toBeUndefined()
    expect(fighter.strikeTargetId).toBeUndefined()
  })

  it('keeps map picking for an unfinished order, and requires Change Target during ingress editing',()=>{
    const fighter={...fixture().squadrons[0],mission:'base-strike' as const,strikeTargetId:undefined}
    expect(isGroundStrikeTargeting('plan',fighter,'target')).toBe(true)
    expect(isGroundStrikeTargeting('plan',fighter,'idle')).toBe(true)
    expect(isGroundStrikeTargeting('plan',{...fighter,strikeTargetId:'e-sam'},'route')).toBe(false)
    expect(isGroundStrikeTargeting('plan',{...fighter,strikeTargetId:'e-sam'},'idle')).toBe(false)
    expect(isGroundStrikeTargeting('execute',fighter,'target')).toBe(false)
  })

  it('retargets to another battlefield site and regenerates the fixed strike point',()=>{
    const state=fixture();state.squadrons[0].mission='base-strike'
    const first=planGroundStrike(state,state.squadrons[0].id,'e-sam')!
    state.squadrons[0]=first
    const next=planGroundStrike(state,first.id,'e-base')!
    expect(next.strikeTargetId).toBe('e-base')
    expect(next.route[0]).toEqual(first.route[0])
    expect(next.route.at(-1)).not.toEqual(first.route.at(-1))
    expect(validateGroundStrikeOrder(state,next)).toBeUndefined()
  })

  it('rejects friendly, provisional, hidden, destroyed, out-of-range, and non-planning assignments',()=>{
    const state=fixture(),fighter=state.squadrons[0];fighter.mission='base-strike'
    expect(planGroundStrike(state,fighter.id,'p-sam')).toBeUndefined()
    for(const overrides of [{intel:'probable' as const},{hidden:true},{health:0},{position:[100,100] as [number,number]}]){
      const candidate={...state,enemyAssets:state.enemyAssets.map(asset=>asset.id==='e-sam'?{...asset,...overrides}:asset)}
      expect(planGroundStrike(candidate,fighter.id,'e-sam')).toBeUndefined()
    }
    expect(planGroundStrike({...state,phase:'execute'},fighter.id,'e-sam')).toBeUndefined()
    expect(planGroundStrike(state,state.squadrons.find(flight=>flight.role==='recon')!.id,'e-sam')).toBeUndefined()
    expect(planGroundStrike({...state,squadrons:state.squadrons.map(flight=>({...flight,status:'trapped'}))},fighter.id,'e-sam')).toBeUndefined()
  })
})
