import type { ContactInterval, RoundResult, UnitFrame, UnitTrack } from './types'

export type ContactLevel = 'radar' | 'visual'

export interface ContactProjection {
  level: ContactLevel
  identityKnown: boolean
  observerIds: string[]
}

export interface FriendlyUnitProjection {
  unitId: string
  frame: UnitFrame
  visibility: 'friendly'
}

export interface HostileUnitProjection {
  unitId: string
  frame: UnitFrame
  visibility: ContactLevel
  identityKnown: boolean
  observerIds: string[]
}

export interface VisibleTrackSegment {
  visibility: ContactLevel
  identityKnown: boolean
  frames: UnitFrame[]
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
  return {
    time: seconds,
    position: [lerp(before.position[0], after.position[0], amount), lerp(before.position[1], after.position[1], amount)],
    facing: [lerp(before.facing[0], after.facing[0], amount), lerp(before.facing[1], after.facing[1], amount)],
    mode: before.mode,
    strength: lerp(before.strength, after.strength, amount),
    morale: lerp(before.morale, after.morale, amount),
    aircraft: before.aircraft,
    traveledDistance: lerp(before.traveledDistance, after.traveledDistance, amount),
  }
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
  const identityKnown = targetIntervals.some(interval => interval.source === 'visual' && interval.start <= seconds)
  return {
    level,
    identityKnown,
    observerIds: [...new Set(active.map(interval => interval.observerId))].sort(),
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
    frame,
    visibility: contact.level,
    identityKnown: contact.identityKnown,
    observerIds: contact.observerIds,
  } : undefined
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
