import type { Asset, CombatSequence, ObjectiveId, ObjectiveReward } from './types'

export const OBJECTIVE_REWARDS: Record<ObjectiveId, ObjectiveReward> = {
  'silence-radar': { id: 'silence-radar', label: 'First radar destroyed', amount: 4 },
  'suppress-battery': { id: 'suppress-battery', label: 'First battery destroyed', amount: 4 },
  'survey-upgrade': { id: 'survey-upgrade', label: 'First defense upgrade surveyed', amount: 3 },
}

export const isObjectiveId = (value: unknown): value is ObjectiveId =>
  typeof value === 'string' && Object.hasOwn(OBJECTIVE_REWARDS, value)

export function objectiveRewards(
  completed: readonly ObjectiveId[] | undefined,
  ownFormationIds: ReadonlySet<string>,
  enemySites: readonly Pick<Asset, 'id' | 'kind'>[],
  sequences: readonly CombatSequence[],
  surveyedUpgrade: boolean,
): ObjectiveReward[] {
  const achievements = new Set<ObjectiveId>()
  if (surveyedUpgrade) achievements.add('survey-upgrade')
  for (const sequence of sequences) {
    if (sequence.kind !== 'strike') continue
    for (const shot of sequence.exchanges) {
      if (!ownFormationIds.has(shot.attackerId) || shot.damage <= 0 || shot.targetStrength > 0) continue
      const site = enemySites.find(asset => asset.id === shot.defenderId)
      if (site?.kind === 'radar') achievements.add('silence-radar')
      if (site?.kind === 'sam' || site?.kind === 'aaa') achievements.add('suppress-battery')
    }
  }
  return [...achievements].filter(id => !completed?.includes(id)).map(id => OBJECTIVE_REWARDS[id])
}
