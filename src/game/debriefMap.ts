import { contactProjectionAt, unitTrackFor } from './executionProjection'
import type { Point, RoundResult } from './types'

export type DebriefEventKind = 'dogfight' | 'pursuit' | 'defense' | 'strike' | 'loss' | 'intel'
export interface DebriefMapEvent {
  id: string
  kind: DebriefEventKind
  time: number
  position: Point
  title: string
  detail: string
  side: 'friendly' | 'hostile' | 'neutral'
  count?: number
}
export interface DebriefMapSite { id: string; position: Point; events: DebriefMapEvent[]; number: number }

/** Event locations come from resolved records, never planned routes or hidden enemy tracks. */
export function debriefMapEvents(result: RoundResult): DebriefMapEvent[] {
  const events: DebriefMapEvent[] = []
  const friendlyIds = new Set(result.squadrons.map(unit => unit.id))
  const name = (id: string, time: number) => result.squadrons.find(unit => unit.id === id)?.callsign
    ?? (contactProjectionAt(result, id, time)?.identityKnown ? result.enemyFlights.find(unit => unit.id === id)?.callsign : undefined)
    ?? (result.assets.some(asset => asset.id === id) ? 'HOSTILE AIR DEFENSE' : 'HOSTILE AIRCRAFT')
  for (const sequence of result.combatSequences) {
    // Enemy-only combat is not a player report. Ground strikes are handled at impact below.
    if (sequence.kind === 'strike') {
      for (const exchange of sequence.exchanges) {
        const target = [...result.playerAssets, ...result.assets].find(asset => asset.id === exchange.defenderId)
        if (!target || (!friendlyIds.has(exchange.attackerId) && !result.playerAssets.some(asset => asset.id === target.id))) continue
        events.push({ id: exchange.id, kind: 'strike', time: exchange.time, position: exchange.position,
          title: exchange.targetStrength <= 0 ? 'SITE DESTROYED' : 'GROUND STRIKE',
          detail: `${target.name ?? target.kind.toUpperCase()} · ${exchange.damage} DAMAGE`, side: friendlyIds.has(exchange.attackerId) ? 'hostile' : 'friendly' })
      }
      continue
    }
    if (!sequence.participantIds.some(id => friendlyIds.has(id)) && !sequence.participantIds.some(id => result.playerAssets.some(asset => asset.id === id))) continue
    const kind = sequence.kind === 'flyby' ? 'pursuit' : sequence.kind
    const title = sequence.kind === 'dogfight' ? 'DOGFIGHT' : sequence.kind === 'defense' ? 'AIR DEFENSE' : sequence.kind === 'flyby' ? 'RETURN FIRE' : 'RECON PURSUIT'
    const first = sequence.exchanges[0]
    const ownDefense = result.playerAssets.find(asset => sequence.participantIds.includes(asset.id))
    const position = kind === 'defense' ? ownDefense?.position ?? first?.position ?? sequence.location : sequence.location
    events.push({ id: sequence.id, kind, time: sequence.start, position, title,
      detail: `${sequence.participantIds.map(id => result.playerAssets.find(asset => asset.id === id)?.name ?? name(id, sequence.start)).join(' / ')} · ${sequence.exchanges.reduce((total, exchange) => total + exchange.damage, 0)} DAMAGE`, side: 'neutral' })
  }

  for (const item of [...result.friendlyAttrition, ...result.enemyAttrition]) {
    const friendly = friendlyIds.has(item.id)
    if (!item.aircraftLost || (!friendly && !item.confirmed)) continue
    const track = unitTrackFor(result, item.id)
    if (!track) continue
    let remaining = item.aircraftLost
    let lastLossTime = track.frames[0]?.time ?? 0
    for (let index = 1; index < track.frames.length && remaining > 0; index++) {
      const frame = track.frames[index], previous = track.frames[index - 1]
      const count = Math.min(remaining, Math.max(0, previous.aircraft - frame.aircraft))
      if (!count) continue
      remaining -= count
      // Pip reconciliation can occur on combat exit. Anchor it to that combat's last hit.
      const hit = result.combatSequences.flatMap(sequence => sequence.exchanges)
        .filter(exchange => exchange.defenderId === item.id && exchange.hit && exchange.damage > 0 && exchange.time >= lastLossTime && exchange.time <= frame.time + .000001)
        .sort((a, b) => b.time - a.time)[0]
      lastLossTime = frame.time
      const time = hit?.time ?? frame.time
      // Confirmed aggregate attrition does not authorize a hidden crash position.
      if (!friendly && !contactProjectionAt(result, item.id, time)) continue
      const recoveryLoss = !hit && frame.mode === 'destroyed' && previous.mode === 'stranded'
      events.push({ id: `loss-${item.id}-${index}`, kind: 'loss', time, position: hit?.position ?? frame.position,
        title: `${friendly ? 'FRIENDLY' : 'ENEMY'} AIRCRAFT LOST`,
        detail: `${name(item.id, time)} · ${count} LOST${recoveryLoss ? ' · FUEL EXHAUSTED' : ''}`, side: friendly ? 'friendly' : 'hostile', count })
    }
  }
  const reported = new Set<string>()
  for (const report of result.intelReports) {
    if (!report.recovered || reported.has(report.assetId)) continue
    const asset = result.assets.find(candidate => candidate.id === report.assetId)
    if (!asset) continue
    reported.add(asset.id)
    const recovery = unitTrackFor(result, report.observerId)?.frames.find(frame => frame.mode === 'recovered')
    events.push({ id: `intel-${asset.id}`, kind: 'intel', time: recovery?.time ?? result.duration,
      position: asset.position, title: 'INTEL RECOVERED', detail: `${asset.kind.toUpperCase()} · ${asset.name ?? 'FIXED SITE'}`, side: 'neutral' })
  }
  return events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
}

/** Nearby reports share a pin instead of piling silhouettes on top of one another. */
export function debriefMapSites(result: RoundResult): DebriefMapSite[] {
  const sites: DebriefMapSite[] = []
  for (const event of debriefMapEvents(result)) {
    const site = sites.find(site => Math.hypot(site.position[0] - event.position[0], site.position[1] - event.position[1]) < 2.4)
    if (site) site.events.push(event)
    else sites.push({ id: event.id, position: event.position, events: [event], number: sites.length + 1 })
  }
  return sites
}

export function primaryDebriefEvent(site: DebriefMapSite): DebriefMapEvent {
  return site.events.find(event => event.kind === 'loss') ?? site.events.find(event => event.kind === 'strike') ?? site.events[0]
}
