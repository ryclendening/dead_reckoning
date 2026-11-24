import type { Asset, DefenseSurvey } from './types'
import { effectiveDefenseProfile, isOperationalSite, radarRange } from './equipmentRules'
import { isKnownUpgradeId } from './upgrades'

export const isDefenseSite = (asset: Pick<Asset, 'kind'>) =>
  asset.kind === 'radar' || asset.kind === 'sam' || asset.kind === 'aaa'

export function validDefenseSurvey(value: unknown): value is DefenseSurvey {
  if (!value || typeof value !== 'object') return false
  const { round, upgrades, range } = value as Partial<DefenseSurvey>
  return typeof round === 'number' && Number.isInteger(round) && round > 0
    && Array.isArray(upgrades) && upgrades.every(isKnownUpgradeId)
    && (range === undefined || typeof range === 'number' && Number.isFinite(range) && range > 0)
}

export function surveyDefense(asset: Asset, sites: readonly Asset[], round: number): DefenseSurvey | undefined {
  if (!isOperationalSite(asset)) return undefined
  const range = asset.kind === 'radar' ? radarRange(asset) : effectiveDefenseProfile(asset, sites)?.range
  return range === undefined ? undefined : { round, range, upgrades: [...(asset.upgrades ?? [])] }
}

export function foundNewDefenseUpgrade(previous: DefenseSurvey | undefined, survey: DefenseSurvey | undefined) {
  return survey?.upgrades.some(upgrade => !previous?.upgrades.includes(upgrade)) ?? false
}

/** Enemy configuration comes from the report, never the live owner's loadout. */
export function reportedEnemyAsset(asset: Asset): Asset {
  return { ...asset, upgrades: asset.defenseSurvey?.upgrades, basedFormationIds: undefined }
}

export function coverageSurveyFor(asset: Asset) {
  const survey = asset.defenseSurvey
  if (asset.intel !== 'confirmed' || asset.hidden || !isOperationalSite(asset) || !isDefenseSite(asset)
    || !survey || survey.range === undefined) return undefined
  return { round: survey.round, range: survey.range }
}
