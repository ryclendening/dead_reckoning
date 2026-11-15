import { effectiveDefenseProfile, isOperationalSite, radarRange } from '../game/equipmentRules'
import type { Asset } from '../game/types'

const RADAR_RANGE_HELP = 'Linked SAMs can fire anywhere inside the radar’s dashed circle. Linked AAA gets 50% more range around the gun.'
export const RADAR_PLACEMENT_HELP = `Place SAM and AAA inside your radar’s dashed circle. ${RADAR_RANGE_HELP}`
export const formatDefenseRange = (range: number) => String(Number(range.toFixed(2)))

export function DefenseSiteDetails({ asset, sites, enemy = false }: { asset: Asset; sites: readonly Asset[]; enemy?: boolean }) {
  if (asset.kind === 'radar') {
    const linked = sites.filter(site => effectiveDefenseProfile(site, sites)?.radarLinks.some(radar => radar.id === asset.id))
    return <small className="defense-site-detail">DETECTION RANGE {formatDefenseRange(radarRange(asset))} map units
      {isOperationalSite(asset) ? ` · ${linked.length} linked ${linked.length === 1 ? 'battery' : 'batteries'}` : ' · Offline, no range boost'}
      <br/>Links SAM and AAA inside its dashed circle. {RADAR_RANGE_HELP}</small>
  }
  if (asset.kind !== 'sam' && asset.kind !== 'aaa') return null
  const profile = effectiveDefenseProfile(asset, sites)
  if (!profile) return <small className="defense-site-detail">Cannot engage while offline.</small>
  const radarNames = profile.radarLinks.map(link => sites.find(site => site.id === link.id)?.name ?? 'Radar site')
  if (asset.kind === 'sam' && radarNames.length) {
    return <small className="defense-site-detail">
      Local range · {formatDefenseRange(profile.range)} map units<br/>
      Radar guided · Covers the detection {radarNames.length === 1 ? 'zone' : 'zones'} of {radarNames.join(', ')}
    </small>
  }
  return <small className="defense-site-detail">
    {radarNames.length ? `Radar-linked · ${formatDefenseRange(profile.baseRange)} → ${formatDefenseRange(profile.range)} map units · ${radarNames[0]}`
      : `${enemy ? 'Known' : 'Local'} range · ${formatDefenseRange(profile.range)} map units · ${enemy ? 'No confirmed radar link' : 'No radar link'}`}
  </small>
}
