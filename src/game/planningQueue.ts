import type { Squadron } from './types'
import type { FormationBaseGroup } from './formationBasing'

export const viablePlanningFormationIds = (squadrons: Squadron[]) => squadrons
  .filter(squadron => squadron.aircraft > 0 && squadron.status !== 'trapped')
  .map(squadron => squadron.id)

export function nextUnplannedFormationId(ids: string[], reviewedIds: ReadonlySet<string>): string | undefined {
  return ids.find(id => !reviewedIds.has(id))
}

export function airfieldFirstPlanningIds(squadrons: Squadron[], groups: FormationBaseGroup[], activeBaseId: string): string[] {
  const viable = new Set(viablePlanningFormationIds(squadrons))
  const active = groups.find(group => group.base.id === activeBaseId)
  const orderedGroups = active ? [active, ...groups.filter(group => group.base.id !== activeBaseId)] : groups
  return orderedGroups.flatMap(group => group.formationIds).filter(id => viable.has(id))
}

export function planningPackageReady(squadrons: Squadron[], reviewedIds: ReadonlySet<string>): boolean {
  const viable = squadrons.filter(squadron => squadron.aircraft > 0 && squadron.status !== 'trapped')
  return viable.length > 0 && viable.every(squadron => reviewedIds.has(squadron.id) && squadron.route.length >= 2)
}
