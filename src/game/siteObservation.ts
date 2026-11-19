import { isOperationalSite, radarRange, RADAR_BASE_RANGE } from './equipmentRules'
import type { Asset, Role } from './types'

export const FIXED_ASSET_OBSERVATION_RANGE = 3.8
export const RECON_GROUND_OBSERVATION_RANGE = 8
const PASSIVE_RADAR_MARGIN = 1.6

export const groundObservationRange = (role: Role) =>
  role === 'recon' ? RECON_GROUND_OBSERVATION_RANGE : FIXED_ASSET_OBSERVATION_RANGE

export const STANDARD_RADAR_EMISSION_OBSERVATION_RANGE = RADAR_BASE_RANGE + PASSIVE_RADAR_MARGIN

export function siteObservationRange(role: Role, site: Pick<Asset, 'kind' | 'health' | 'operational' | 'upgrades'>): number {
  const groundRange = groundObservationRange(role)
  if (site.kind !== 'radar' || !isOperationalSite(site)) return groundRange
  return Math.max(groundRange, radarRange(site) + PASSIVE_RADAR_MARGIN)
}
