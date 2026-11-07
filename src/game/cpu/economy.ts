import type { EconomyCommand, MatchState } from '../types'
import { sidePlanningContext, applySideContext } from '../sideContext'
import { executeEconomyCommand } from '../sideEconomy'
/** Authoritative shared commands. Evaluations call the same function on isolated contexts. */
export function executeCpuEconomyCommand(state: MatchState, command: EconomyCommand): MatchState {
  if (!state.cpu || state.phase !== 'adapt') return state
  const before = sidePlanningContext(state, 'cpu'), next = executeEconomyCommand(before, command)
  if (next === before) return state
  const applied = applySideContext(state, next)
  return { ...applied, cpu: { ...applied.cpu!, spending: [...state.cpu.spending, {
    round: state.round, action: command.actionId, targetId: command.target.id, cost: before.logistics - next.logistics,
  }] } }
}
