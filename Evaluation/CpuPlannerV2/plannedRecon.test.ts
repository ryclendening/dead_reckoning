import { describe,it,expect } from 'vitest'
import { createCampaignDraft } from '../../src/game/data'
import { confirmCampaignSetup } from '../../src/game/campaignSetup'
import { resolveRound,applyRound } from '../../src/game/engine'
import { campaignOutcome } from '../../src/game/campaign'
import { openAdaptPhase,beginNextRound } from '../../src/game/economy'
import { normalizeMatch } from '../../src/game/persistence'
import { validateRecoveryPackage } from '../../src/game/forwardBasing'
import { flightRangeFor } from '../../src/game/flightRules'
import { competitivePlayerOrders } from './competitiveOpponents'
import type { CpuDifficulty } from '../../src/game/cpu/types'
import type { ReconPosture } from '../../src/game/types'

/** Asynchronous smoke coverage, not a competitive-rate benchmark. Both sides'
 * routes and conditions are locked before execution; no advance/RTB commands. */
function campaign(seed:number,difficulty:CpuDifficulty,posture:ReconPosture) {
  const draft=createCampaignDraft(seed,difficulty)
  let s=confirmCampaignSetup({...draft,setup:{...draft.setup!,stage:'review',placedAssetIds:[...draft.setup!.selectedAssetIds]}})
  const rounds=[]
  while(!campaignOutcome(s)) {
    const committed=JSON.stringify(s.cpu!.plan)
    s=competitivePlayerOrders(s,'recon-strike')
    s.squadrons=s.squadrons.map(f=>f.role==='recon'?{...f,reconPosture:posture}:f)
    expect(JSON.stringify(s.cpu!.plan)).toBe(committed)
    for(const [assets,orders] of [[s.playerAssets,s.squadrons],[s.enemyAssets,s.cpu!.plan!.orders]] as const) {
      expect(validateRecoveryPackage({playerAssets:assets,squadrons:orders},flightRangeFor,new Set(orders.filter(o=>o.sortieOrdered!==false).map(o=>o.id))).valid).toBe(true)
    }
    const reloaded=normalizeMatch(JSON.parse(JSON.stringify(s)))
    expect(reloaded.cpu!.plan).toEqual(s.cpu!.plan)
    const result=resolveRound(reloaded)
    expect(result.simulationCommands).toEqual([])
    expect(result.behaviorIntervals.some(i=>i.reason==='cpu-preserve-recon')).toBe(false)
    rounds.push({round:s.round,posture:s.cpu!.plan!.orders.find(o=>o.role==='recon'&&o.sortieOrdered!==false)?.reconPosture,baseDamage:result.baseDamage,homeDamage:result.enemyBaseDamage})
    s=applyRound(reloaded,result)
    expect(applyRound(s,result)).toBe(s)
    s=openAdaptPhase({...s,phase:'debrief'})
    if(!campaignOutcome(s)){expect(openAdaptPhase(s)).toBe(s);s=beginNextRound(s)}
    expect(s.round).toBeLessThanOrEqual(6)
  }
  return {rounds,outcome:campaignOutcome(s),cpu:s.cpu,player:s.squadrons}
}
describe('committed recon campaign smoke',()=>{
  it.each(['easy','medium','hard'] as const)('runs %s against both preselected player conditions without live input',difficulty=>{
    for(const [seed,posture] of [[3,'aggressive'],[11,'conservative']] as const) {
      const result=campaign(seed,difficulty,posture)
      expect(result.outcome).toBeDefined()
      expect(result.rounds.some(r=>r.posture==='aggressive'||r.posture==='conservative')).toBe(true)
      if(seed===3)expect(campaign(seed,difficulty,posture)).toEqual(result)
    }
  },180000)
})
