import type { Asset, EconomyState, FriendlyTerritory, MatchState, Phase, Point, Squadron } from './types'
import { friendlyTerritoryForAssets } from './territory'
import { terrainKnownWithin } from './terrain'
export interface SidePlanningContext {
  side: 'player' | 'cpu'; assets: Asset[]; formations: Squadron[]
  logistics: number; reserves: number; territory: FriendlyTerritory; opposingTerritory?: FriendlyTerritory; mappedAreas: Point[]
  phase: Phase; round: number; economy: EconomyState; terrain?: MatchState['world']['terrain']
}
export function sidePlanningContext(state: MatchState, side: 'player' | 'cpu'): SidePlanningContext {
  if (side === 'player') {
    const enemyHome = state.enemyAssets.find(asset => asset.kind === 'base')
    return { side, assets: state.playerAssets, formations: state.squadrons, logistics: state.logistics,
    reserves: state.replacements, territory: state.world.friendlyTerritory,
    opposingTerritory: enemyHome ? friendlyTerritoryForAssets({center:[...enemyHome.position],radius:4.5},state.enemyAssets) : undefined, mappedAreas: state.mappedAreas,
    phase: state.phase, round: state.round, economy: state.economy, terrain: terrainKnownWithin(state.world.terrain,state.mappedAreas,2.65,friendlyTerritoryForAssets(state.world.friendlyTerritory,state.playerAssets)) }
  }
  if (!state.cpu) throw new Error('CPU inventory required')
  const home = state.enemyAssets.find(asset => asset.kind === 'base')!
  return { side, assets: state.enemyAssets, formations: state.cpu.formations, logistics: state.cpu.logistics,
    reserves: state.cpu.reserves, territory: { center: [...home.position], radius: 4.5 },
    opposingTerritory: friendlyTerritoryForAssets(state.world.friendlyTerritory,state.playerAssets), mappedAreas: state.cpu.mappedAreas ?? [],
    phase: state.phase, round: state.round, economy: { statement: [] }, terrain: terrainKnownWithin(state.world.terrain,state.cpu.mappedAreas??[],2.65,friendlyTerritoryForAssets({center:[...home.position],radius:4.5},state.enemyAssets)) }
}
export function applySideContext(state: MatchState, context: SidePlanningContext): MatchState {
  if (context.side === 'player') return { ...state, playerAssets: context.assets, squadrons: context.formations,
    logistics: context.logistics, replacements: context.reserves, economy: context.economy }
  return { ...state, enemyAssets: context.assets, cpu: { ...state.cpu!, formations: context.formations,
    logistics: context.logistics, reserves: context.reserves } }
}
