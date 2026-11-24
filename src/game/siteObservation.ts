import { isOperationalSite, radarRange } from './equipmentRules'
import { modifiedStat } from './upgrades'
import type { Asset, Role, Squadron } from './types'

export const FIXED_ASSET_OBSERVATION_RANGE = 3.8
export const RECON_GROUND_OBSERVATION_RANGE = 8
const PASSIVE_RADAR_MARGIN = 1.6

export const groundObservationRange = (role: Role, observer?: Pick<Squadron, 'upgrades'>) =>
  role === 'recon' ? modifiedStat(observer, 'aircraft.reconSurveyRange', RECON_GROUND_OBSERVATION_RANGE) : FIXED_ASSET_OBSERVATION_RANGE

export function siteObservationRange(role: Role, site: Pick<Asset, 'kind' | 'health' | 'operational' | 'upgrades'>, observer?: Pick<Squadron, 'upgrades'>): number {
  const groundRange = groundObservationRange(role, observer)
  if (role !== 'recon' || site.kind !== 'radar' || !isOperationalSite(site)) return groundRange
  return Math.max(groundRange, radarRange(site) + PASSIVE_RADAR_MARGIN)
}
