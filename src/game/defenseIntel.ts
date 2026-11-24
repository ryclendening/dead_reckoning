import type { Asset, DefenseSurvey } from './types'
import { isKnownUpgradeId } from './upgrades'

export const isDefenseSite = (asset: Pick<Asset, 'kind'>) =>
  asset.kind === 'radar' || asset.kind === 'sam' || asset.kind === 'aaa'

export function validDefenseSurvey(value: unknown): value is DefenseSurvey {
  if (!value || typeof value !== 'object') return false
  const { round, upgrades } = value as Partial<DefenseSurvey>
  return typeof round === 'number' && Number.isInteger(round) && round > 0
    && Array.isArray(upgrades) && upgrades.every(isKnownUpgradeId)
}

export function surveyDefense(asset: Asset, round: number): DefenseSurvey {
  return { round, upgrades: [...(asset.upgrades ?? [])] }
}

export function foundNewDefenseUpgrade(previous: DefenseSurvey | undefined, survey: DefenseSurvey | undefined) {
  return survey?.upgrades.some(upgrade => !previous?.upgrades.includes(upgrade)) ?? false
}

/** Enemy configuration comes from the report, never the live owner's loadout. */
export function reportedEnemyAsset(asset: Asset): Asset {
  return { ...asset, upgrades: asset.defenseSurvey?.upgrades, basedFormationIds: undefined }
}

export function surveyedDefenseSites(assets: readonly Asset[]): Asset[] {
  return assets.filter(asset => asset.intel === 'confirmed' && !asset.hidden && asset.defenseSurvey && isDefenseSite(asset))
    .map(reportedEnemyAsset)
}
