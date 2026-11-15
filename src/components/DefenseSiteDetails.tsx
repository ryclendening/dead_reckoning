import { effectiveDefenseProfile, isOperationalSite, radarRange } from '../game/equipmentRules'
import type { Asset } from '../game/types'

const RADAR_RANGE_HELP = 'Linked SAMs use the radar’s radius; linked AAA gets 50% more range. Firing circles are centered on the weapons.'
export const RADAR_PLACEMENT_HELP = `Place SAM and AAA inside your radar’s dashed circle. ${RADAR_RANGE_HELP}`
export const formatDefenseRange = (range: number) => String(Number(range.toFixed(2)))

export function DefenseSiteDetails({ asset, sites, enemy = false }: { asset: Asset; sites: readonly Asset[]; enemy?: boolean }) {
  if (asset.kind === 'radar') {
    const linked = sites.filter(site => effectiveDefenseProfile(site, sites)?.radarId === asset.id)
    return <small className="defense-site-detail">DETECTION RANGE {formatDefenseRange(radarRange(asset))} map units
      {isOperationalSite(asset) ? ` · ${linked.length} linked ${linked.length === 1 ? 'battery' : 'batteries'}` : ' · Offline, no range boost'}
      <br/>Links SAM and AAA inside its dashed circle. {RADAR_RANGE_HELP}</small>
  }
  if (asset.kind !== 'sam' && asset.kind !== 'aaa') return null
  const profile = effectiveDefenseProfile(asset, sites)
  if (!profile) return <small className="defense-site-detail">Cannot engage while offline.</small>
  const radar = sites.find(site => site.id === profile.radarId)
  return <small className="defense-site-detail">
    {radar ? `Radar-linked · ${formatDefenseRange(profile.baseRange)} → ${formatDefenseRange(profile.range)} map units · ${radar.name ?? 'Radar site'}`
      : `${enemy ? 'Known' : 'Local'} range · ${formatDefenseRange(profile.range)} map units · ${enemy ? 'No confirmed radar link' : 'No radar link'}`}
  </small>
}
