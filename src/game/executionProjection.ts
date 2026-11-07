import type { Asset, ContactInterval, RoundResult, UnitFrame, UnitTrack } from './types'
import { headingAngle, shortestAngleLerp } from './heading'

export type ContactLevel = 'radar' | 'visual'

export interface ContactProjection {
  trackId: string
  level: ContactLevel
  identityKnown: boolean
  observerIds: string[]
  visibleSince: number
}

export interface FriendlyUnitProjection {
  unitId: string
  frame: UnitFrame
  visibility: 'friendly'
}

export interface HostileUnitProjection {
  unitId: string
  trackId: string
  frame: UnitFrame
  visibility: ContactLevel
  identityKnown: boolean
  observerIds: string[]
  visibleSince: number
}

export interface VisibleTrackSegment {
  visibility: ContactLevel
  identityKnown: boolean
  frames: UnitFrame[]
}

export interface DebriefHistory {
  friendly: UnitTrack[]
  hostile: Array<{ unitId: string; segments: VisibleTrackSegment[] }>
}

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount
const copyFrame = (frame: UnitFrame): UnitFrame => ({
  ...frame,
  position: [...frame.position],
  facing: [...frame.facing],
})

/**
 * Samples an authoritative execution track at an absolute simulated time.
 * Continuous values interpolate; discrete values come from the latest frame
 * at or before the requested time.
 */
export function sampleUnitTrack(track: UnitTrack | undefined, seconds: number): UnitFrame | undefined {
  const frames = track?.frames
  if (!frames?.length) return undefined
  if (seconds <= frames[0].time) return copyFrame(frames[0])
  const last = frames.at(-1)!
  if (seconds >= last.time) return copyFrame(last)

  let low = 1
  let high = frames.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (frames[middle].time < seconds) low = middle + 1
    else high = middle
  }

  const after = frames[low]
  if (after.time === seconds) return copyFrame(after)
  const before = frames[low - 1]
  const amount = (seconds - before.time) / Math.max(Number.EPSILON, after.time - before.time)
  const position:[number,number]=[lerp(before.position[0],after.position[0],amount),lerp(before.position[1],after.position[1],amount)]
  const fromHeading=headingAngle(before.position,before.facing)
  const angle=shortestAngleLerp(fromHeading,headingAngle(after.position,after.facing,fromHeading),amount)
  return {
    time: seconds,
    position,
    facing: [position[0]+Math.sin(angle),position[1]+Math.cos(angle)],
    mode: before.mode,
    strength: lerp(before.strength, after.strength, amount),
    morale: lerp(before.morale, after.morale, amount),
    aircraft: before.aircraft,
    traveledDistance: lerp(before.traveledDistance, after.traveledDistance, amount),
  }
}

/** Samples smooth motion without advancing beyond authority or a contact window. */
export function sampleUnitTrackForRender(
  track: UnitTrack | undefined,
  requestedSeconds: number,
  authoritativeSeconds: number,
  visibility?: { contactStart: number | null },
): UnitFrame | undefined {
  const frames=track?.frames
  if(!frames?.length||visibility?.contactStart===null)return undefined
  const earliest=Math.max(frames[0].time,visibility?.contactStart??frames[0].time)
  const latest=Math.min(authoritativeSeconds,frames.at(-1)!.time)
  if(latest<earliest)return undefined
  return sampleUnitTrack(track,Math.max(earliest,Math.min(latest,requestedSeconds)))
}

export function unitTrackFor(result: RoundResult | undefined, unitId: string): UnitTrack | undefined {
  return result?.unitTracks.find(track => track.unitId === unitId)
}

export function contactProjectionAt(
  result: RoundResult | undefined,
  targetId: string,
  seconds: number,
): ContactProjection | undefined {
  if (!result) return undefined
  const targetIntervals = result.contactIntervals.filter(interval => interval.targetId === targetId)
  const active = targetIntervals.filter(interval => seconds >= interval.start && seconds <= interval.end)
  if (!active.length) return undefined
  const level: ContactLevel = active.some(interval => interval.source === 'visual') ? 'visual' : 'radar'
  const visibleSince = Math.min(...active.filter(interval => interval.source === level).map(interval => interval.start))
  const identityKnown = targetIntervals.some(interval => interval.source === 'visual' && interval.start <= seconds)
  return {
    trackId: contactTrackIdAt(result,targetId,seconds)!,
    level,
    identityKnown,
    observerIds: [...new Set(active.map(interval => interval.observerId))].sort(),
    visibleSince,
  }
}

export function projectFriendlyUnitAt(
  result: RoundResult | undefined,
  unitId: string,
  seconds: number,
): FriendlyUnitProjection | undefined {
  const frame = sampleUnitTrack(unitTrackFor(result, unitId), seconds)
  return frame ? { unitId, frame, visibility: 'friendly' } : undefined
}

export function projectHostileUnitAt(
  result: RoundResult | undefined,
  unitId: string,
  seconds: number,
): HostileUnitProjection | undefined {
  const contact = contactProjectionAt(result, unitId, seconds)
  if (!contact) return undefined
  const frame = sampleUnitTrack(unitTrackFor(result, unitId), seconds)
  return frame ? {
    unitId,
    trackId: contact.trackId,
    frame,
    visibility: contact.level,
    identityKnown: contact.identityKnown,
    observerIds: contact.observerIds,
    visibleSince: contact.visibleSince,
  } : undefined
}

/** Number only acquired contacts; hidden flights never reserve or renumber IDs. */
export function contactTrackIdAt(result:RoundResult,targetId:string,seconds:number):string|undefined{
  const acquired=[...result.contactIntervals].filter(interval=>interval.start<=seconds).sort((left,right)=>left.start-right.start)
  const ids=[...new Set(acquired.map(interval=>interval.targetId))]
  const index=ids.indexOf(targetId)
  return index<0?undefined:`TRACK ${String(index+1).padStart(2,'0')}`
}

interface ContactSpan {
  start: number
  end: number
  visibility: ContactLevel
  identityKnown: boolean
}

function contactSpans(intervals: ContactInterval[], duration: number): ContactSpan[] {
  const visualLearnedAt = intervals
    .filter(interval => interval.source === 'visual')
    .reduce<number | undefined>((earliest, interval) => earliest === undefined ? interval.start : Math.min(earliest, interval.start), undefined)
  const boundaries = [...new Set(intervals.flatMap(interval => [
    Math.max(0, Math.min(duration, interval.start)),
    Math.max(0, Math.min(duration, interval.end)),
  ]))].sort((left, right) => left - right)
  const spans: ContactSpan[] = []
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1]
    const end = boundaries[index]
    if (end < start) continue
    const midpoint = start + (end - start) / 2
    const active = intervals.filter(interval => midpoint >= interval.start && midpoint <= interval.end)
    if (!active.length) continue
    const visibility: ContactLevel = active.some(interval => interval.source === 'visual') ? 'visual' : 'radar'
    const identityKnown = visualLearnedAt !== undefined && visualLearnedAt <= start
    const previous = spans.at(-1)
    if (previous && previous.end === start && previous.visibility === visibility && previous.identityKnown === identityKnown) previous.end = end
    else spans.push({ start, end, visibility, identityKnown })
  }
  return spans
}

/** Returns only track portions the player legitimately detected. */
export function visibleTrackSegments(result: RoundResult, targetId: string): VisibleTrackSegment[] {
  const track = unitTrackFor(result, targetId)
  if (!track?.frames.length) return []
  const intervals = result.contactIntervals.filter(interval => interval.targetId === targetId)
  return contactSpans(intervals, result.duration).flatMap(span => {
    const times = [...new Set([
      span.start,
      ...track.frames.filter(frame => frame.time > span.start && frame.time < span.end).map(frame => frame.time),
      span.end,
    ])].sort((left, right) => left - right)
    const frames = times.map(time => sampleUnitTrack(track, time)).filter((frame): frame is UnitFrame => !!frame)
    return frames.length ? [{ visibility: span.visibility, identityKnown: span.identityKnown, frames }] : []
  })
}

/** Builds debrief traces exclusively from recorded tracks and legitimate contact intervals. */
export function debriefHistoryFor(result: RoundResult): DebriefHistory {
  const friendlyIds = new Set(result.squadrons.map(squadron => squadron.id))
  return {
    friendly: result.unitTracks.filter(track => friendlyIds.has(track.unitId) && track.frames.length > 1),
    hostile: result.enemyFlights.flatMap(flight => {
      const segments = visibleTrackSegments(result, flight.id)
      return segments.length ? [{ unitId: flight.id, segments }] : []
    }),
  }
}

/** Project fixed-target health from resolved impacts, never from a future final asset snapshot. */
export function projectGroundAssetAt(asset:Asset,result:RoundResult|undefined,seconds:number):Asset{
  if(!result)return asset
  const damage=result.combatSequences.filter(sequence=>sequence.kind==='strike').flatMap(sequence=>sequence.exchanges)
    .filter(exchange=>exchange.defenderId===asset.id&&exchange.time<=seconds+.000001)
    .reduce((sum,exchange)=>sum+exchange.damage,0)
  return damage>0?{...asset,health:Math.max(0,asset.health-damage),struck:true}:asset
}
