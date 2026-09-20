import {describe,expect,it} from 'vitest'
import {decideReaction} from './reactionLifecycle'

const baseline={destroyed:false,inDirectCombat:false,recoveryCommanded:false,recoveryRequired:false,missionAvailable:true}

describe('shared aircraft reaction lifecycle',()=>{
  it('uses the explicit priority order',()=>{
    expect(decideReaction({...baseline,destroyed:true,inDirectCombat:true,recoveryCommanded:true,actionableTargetId:'track'})).toMatchObject({state:'destroyed'})
    expect(decideReaction({...baseline,inDirectCombat:true,recoveryCommanded:true,actionableTargetId:'track'})).toMatchObject({state:'combat'})
    expect(decideReaction({...baseline,recoveryCommanded:true,actionableTargetId:'track'})).toMatchObject({state:'recovering',reason:'recovery-commanded'})
    expect(decideReaction({...baseline,recoveryRequired:true,actionableTargetId:'track'})).toMatchObject({state:'recovering',reason:'recovery-required'})
    expect(decideReaction({...baseline,actionableTargetId:'track'})).toEqual({state:'intercept',targetId:'track',reason:'actionable-contact'})
  })

  it('resumes the mission without carrying historical target intent',()=>{
    expect(decideReaction(baseline)).toEqual({state:'mission',reason:'resume-mission'})
    expect(decideReaction({...baseline,missionAvailable:false})).toEqual({state:'recovering',reason:'mission-unavailable'})
  })
})
