import type { Asset, MatchState, Point } from '../types'
import { sidePlanningContext, type SidePlanningContext } from '../sideContext'
import type { CpuState } from './types'
export interface CpuPlanningView {
  cpu: CpuState; assets: Asset[]; context: SidePlanningContext; home: Point; homeHealth: number; round: number; exposure: number
}
/** Only own state, recovered reports and CPU-authored targeting pressure cross this boundary. */
export function cpuPlanningView(state: MatchState): CpuPlanningView | undefined {
  const base = state.enemyAssets.find(asset => asset.kind === 'base')
  if (!state.cpu || !base) return undefined
  const context = structuredClone(sidePlanningContext(state, 'cpu'))
  // Player visibility of our sites is not CPU knowledge. Normalize those presentation fields.
  context.assets=context.assets.map(a=>({...a,intel:'confirmed',confidence:100,hidden:false}))
  const cpu=structuredClone(state.cpu)
  cpu.sites=cpu.sites.map(s=>({...s,health:Math.max(0,s.health-(s.estimatedDamage??0))}))
  return { cpu, assets: context.assets, context, home: [...base.position], homeHealth: base.health, round: state.round, exposure: state.baseExposure }
}
