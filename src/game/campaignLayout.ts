import { axialToPoint, HEX_ROW, HEX_WIDTH } from './hex'
import type { Point, WorldBounds } from './types'

// Leave enough room for a full opening territory and a direct, fuel-valid
// fighter strike even when the player places their base at its far edge.
export const CAMPAIGN_START_SEPARATION = { min: 18, max: 21 }
export const CAMPAIGN_START_CLEARANCE = 4.5
export const ENEMY_SITE_SPACING = 1.15

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

function randomSource(seed: number, salt: number) {
  let state = (seed ^ salt) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: T[], seed: number, salt: number): T[] {
  const result = [...items], random = randomSource(seed, salt)
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function hexes(bounds: WorldBounds, clearance = 0): Point[] {
  const points: Point[] = []
  for (let r = Math.ceil((bounds.minZ + clearance) / HEX_ROW); r <= Math.floor((bounds.maxZ - clearance) / HEX_ROW); r++) {
    const first = Math.ceil((bounds.minX + clearance) / HEX_WIDTH - r / 2)
    const last = Math.floor((bounds.maxX - clearance) / HEX_WIDTH - r / 2)
    for (let q = first; q <= last; q++) points.push(axialToPoint(q, r))
  }
  return points
}

function enemyCandidates(bounds: WorldBounds, friendlyStart: Point): Point[] {
  return hexes(bounds, CAMPAIGN_START_CLEARANCE).filter(point => {
    const separation = distance(point, friendlyStart)
    return separation >= CAMPAIGN_START_SEPARATION.min && separation <= CAMPAIGN_START_SEPARATION.max
  })
}

export function campaignStart(seed: number, bounds: WorldBounds): Point {
  // Broad central deployment area; neither faction is tied to four corners.
  const candidates = hexes({ minX: Math.max(bounds.minX + CAMPAIGN_START_CLEARANCE, -7.5), maxX: Math.min(bounds.maxX - CAMPAIGN_START_CLEARANCE, 7.5),
    minZ: Math.max(bounds.minZ + CAMPAIGN_START_CLEARANCE, -9), maxZ: Math.min(bounds.maxZ - CAMPAIGN_START_CLEARANCE, 9) })
  const start = shuffled(candidates, seed, 0x117da93).find(point => enemyCandidates(bounds, point).length > 0)
  if (!start) throw new Error('No campaign start satisfies the deployment and flight-range limits.')
  return start
}

export function campaignEnemyStart(seed: number, bounds: WorldBounds, friendlyStart: Point): Point {
  const start = shuffled(enemyCandidates(bounds, friendlyStart), seed, 0x7a31b49)[0]
  if (!start) throw new Error('No enemy start satisfies the deployment and flight-range limits.')
  return start
}

export function campaignEnemySites(seed: number, bounds: WorldBounds, base: Point): Record<'aaa' | 'sam' | 'radar' | 'decoy', Point> {
  const candidates = shuffled(hexes(bounds, .5).filter(point => distance(point, base) <= 4), seed, 0x31df902)
  const occupied = [base], sites = {} as Record<'aaa' | 'sam' | 'radar' | 'decoy', Point>
  // Keep AAA and SAM close enough to cover their own base while varying their
  // bearing, spacing, and relation to the other sites on every layout.
  const rings = [['aaa', 1.2, 1.9], ['sam', 1.8, 3.2], ['radar', 2, 4], ['decoy', 2.5, 4]] as const
  for (const [kind, min, max] of rings) {
    const position = candidates.find(point => distance(point, base) >= min && distance(point, base) <= max
      && occupied.every(other => distance(point, other) >= ENEMY_SITE_SPACING))
    if (!position) throw new Error(`No legal opening ${kind} site.`)
    sites[kind] = position
    occupied.push(position)
  }
  return sites
}

/** Called only when the player actually starts/reboots a campaign. */
export const freshCampaignSeed = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
