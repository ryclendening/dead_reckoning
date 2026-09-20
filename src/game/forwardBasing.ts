import type { Asset, FormationRecoveryOutcome, MatchState, Point, Squadron } from './types'

export const AIRFIELD_LANDING_RADIUS = .6

export const isAirfield = (asset: Asset): boolean => asset.kind === 'base' || asset.kind === 'fob'
export const isOperationalAirfield = (asset: Asset): boolean => isAirfield(asset) && (asset.kind === 'base' || asset.operational !== false)
export const distanceBetween = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const routeDistanceForBasing = (route: Point[]) => route.slice(1).reduce((sum, point, index) => sum + distanceBetween(route[index], point), 0)

export function normalizeFormationBasing(squadrons: Squadron[], assets: Asset[]): Asset[] {
  const airfields = assets.filter(isAirfield)
  const main = airfields.find(asset => asset.kind === 'base')
  if (!main) return assets
  const liveIds = new Set(squadrons.filter(squadron => squadron.aircraft > 0).map(squadron => squadron.id))
  const claimed = new Set<string>()
  const normalized = new Map<string, string[]>()
  for (const field of [...airfields.filter(asset => asset.kind === 'fob'), main]) {
    const ids: string[] = []
    for (const id of field.basedFormationIds ?? []) {
      if (liveIds.has(id) && !claimed.has(id)) { claimed.add(id); ids.push(id) }
    }
    normalized.set(field.id, ids)
  }
  const mainIds = normalized.get(main.id) ?? []
  for (const squadron of squadrons) if (liveIds.has(squadron.id) && !claimed.has(squadron.id)) { claimed.add(squadron.id); mainIds.push(squadron.id) }
  normalized.set(main.id, mainIds)
  return assets.map(asset => isAirfield(asset) ? { ...asset, operational: asset.kind === 'base' ? true : asset.operational !== false, basedFormationIds: normalized.get(asset.id) ?? [], ...(asset.kind === 'fob' ? { capacity: asset.capacity ?? 1 } : {}) } : asset)
}

export function formationField(assets: Asset[], formationId: string): Asset | undefined {
  return assets.filter(isAirfield).find(asset => asset.basedFormationIds?.includes(formationId)) ?? assets.find(asset => asset.kind === 'base')
}

export function fieldAtRouteEnd(assets: Asset[], route: Point[]): Asset | undefined {
  const end = route.at(-1)
  if (!end) return undefined
  return assets.filter(isAirfield).map(asset => ({ asset, distance: distanceBetween(end, asset.position) })).filter(item => item.distance <= AIRFIELD_LANDING_RADIUS).sort((a, b) => a.distance - b.distance || a.asset.id.localeCompare(b.asset.id))[0]?.asset
}

export interface RouteFobLatch { field: Asset; segmentIndex: number; segmentProgress: number }

const segmentDistance = (point: Point, from: Point, to: Point) => {
  const dx = to[0] - from[0]; const dz = to[1] - from[1]
  const lengthSquared = dx * dx + dz * dz
  const progress = lengthSquared <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / lengthSquared))
  return { distance: distanceBetween(point, [from[0] + dx * progress, from[1] + dz * progress]), progress }
}

/** Return the first operational FOB crossed by the route, ignoring its launch field. */
export function firstRouteFobLatch(assets: Asset[], route: Point[]): RouteFobLatch | undefined {
  if (route.length < 2) return undefined
  const launchFieldIds = new Set(assets.filter(isAirfield).filter(field => distanceBetween(route[0], field.position) <= AIRFIELD_LANDING_RADIUS).map(field => field.id))
  const fobs = assets.filter(asset => asset.kind === 'fob' && isOperationalAirfield(asset) && !launchFieldIds.has(asset.id))
  for (let segmentIndex = 1; segmentIndex < route.length; segmentIndex++) {
    const matches = fobs.map(field => ({ field, ...segmentDistance(field.position, route[segmentIndex - 1], route[segmentIndex]) })).filter(item => item.distance <= AIRFIELD_LANDING_RADIUS).sort((a, b) => a.progress - b.progress || a.field.id.localeCompare(b.field.id))
    const first = matches[0]
    if (first) return { field: first.field, segmentIndex, segmentProgress: first.progress }
  }
  return undefined
}

export function snapRouteToRecoveryField(route: Point[], assets: Asset[]): Point[] {
  const latch = firstRouteFobLatch(assets, route)
  if (latch) return [...route.slice(0, latch.segmentIndex), [...latch.field.position] as Point]
  const field = fieldAtRouteEnd(assets, route)
  return field && route.length ? [...route.slice(0, -1), [...field.position] as Point] : route
}

function projectedOccupants(state: MatchState, omitFormationId?: string): Map<string, Set<string>> {
  const assets = normalizeFormationBasing(state.squadrons, state.playerAssets)
  const result = new Map(assets.filter(isAirfield).map(asset => [asset.id, new Set(asset.basedFormationIds ?? [])]))
  for (const squadron of state.squadrons) {
    if (squadron.id === omitFormationId || squadron.aircraft <= 0 || !squadron.plannedRecoveryFieldId) continue
    const source = formationField(assets, squadron.id)
    source && result.get(source.id)?.delete(squadron.id)
    result.get(squadron.plannedRecoveryFieldId)?.add(squadron.id)
  }
  return result
}

export function fieldHasCapacity(state: MatchState, field: Asset, formationId: string): boolean {
  if (field.kind === 'base') return true
  const occupants = projectedOccupants(state, formationId).get(field.id) ?? new Set<string>()
  return occupants.has(formationId) || occupants.size < (field.capacity ?? 1)
}

export interface RecoveryPlanningView {
  launchField: Asset
  intendedField: Asset
  alternateField?: Asset
  normalizedRoute: Point[]
  missionDistance: number
  remainingRange: number
  valid: boolean
  reason?: string
  summary: string
}

export function nearestReachableAlternate(state: MatchState, formationId: string, from: Point, remainingRange: number, excludedFieldId: string, claims?: Map<string, Set<string>>): Asset | undefined {
  return state.playerAssets.filter(isOperationalAirfield).filter(field => field.id !== excludedFieldId).filter(field => {
    if (distanceBetween(from, field.position) > remainingRange + .001) return false
    if (field.kind === 'base') return true
    const occupants = claims?.get(field.id) ?? projectedOccupants(state, formationId).get(field.id) ?? new Set<string>()
    return occupants.has(formationId) || occupants.size < (field.capacity ?? 1)
  }).sort((a, b) => distanceBetween(from, a.position) - distanceBetween(from, b.position) || a.id.localeCompare(b.id))[0]
}

export function deriveRecoveryPlanningView(state: MatchState, formationId: string, route: Point[], maxDistance: number): RecoveryPlanningView | undefined {
  const assets = normalizeFormationBasing(state.squadrons, state.playerAssets)
  const launchField = formationField(assets, formationId)
  if (!launchField) return undefined
  const normalizedRoute = snapRouteToRecoveryField(route, assets)
  const recognized = fieldAtRouteEnd(assets, normalizedRoute)
  const intendedField = recognized ?? launchField
  const flown = routeDistanceForBasing(normalizedRoute)
  const reserve = recognized ? 0 : distanceBetween(normalizedRoute.at(-1) ?? launchField.position, launchField.position)
  const missionDistance = flown + reserve
  const remainingRange = Math.max(0, maxDistance - flown)
  const alternateField = nearestReachableAlternate({ ...state, playerAssets: assets }, formationId, normalizedRoute.at(-1) ?? launchField.position, remainingRange, intendedField.id)
  const validStart = normalizedRoute.length > 0 && distanceBetween(normalizedRoute[0], launchField.position) <= AIRFIELD_LANDING_RADIUS
  const operational = isOperationalAirfield(intendedField)
  const capacity = fieldHasCapacity({ ...state, playerAssets: assets }, intendedField, formationId)
  const valid = normalizedRoute.length >= 2 && validStart && missionDistance <= maxDistance + .001 && operational && capacity
  const reason = !validStart ? 'ROUTE MUST START AT THE LAUNCH FIELD' : missionDistance > maxDistance + .001 ? 'ROUTE EXCEEDS AVAILABLE RANGE' : !operational ? `${intendedField.name ?? 'FOB'} IS UNUSABLE` : !capacity ? `${intendedField.name ?? 'FOB'} IS AT CAPACITY` : normalizedRoute.length < 2 ? 'DRAW A VALID ROUTE' : undefined
  const alternate = alternateField ? (alternateField.name ?? (alternateField.kind === 'base' ? 'HOME BASE' : 'FORWARD BASE')) : 'NONE'
  return { launchField, intendedField, alternateField, normalizedRoute, missionDistance, remainingRange, valid, reason, summary: `RECOVERY: ${intendedField.name ?? (intendedField.kind === 'base' ? 'HOME BASE' : 'FORWARD BASE')} · ALTERNATE: ${alternate}` }
}

export function validateRecoveryPackage(state: MatchState, maxDistances: Record<Squadron['role'], number>): { valid: boolean; reason?: string } {
  for (const squadron of state.squadrons.filter(item => item.aircraft > 0 && item.status !== 'trapped')) {
    const view = deriveRecoveryPlanningView(state, squadron.id, squadron.route, maxDistances[squadron.role])
    if (!view?.valid) return { valid: false, reason: view?.reason ?? `INVALID RECOVERY FOR ${squadron.callsign}` }
    if (squadron.plannedRecoveryFieldId !== view.intendedField.id) return { valid: false, reason: `${squadron.callsign} RECOVERY IS NOT CONFIRMED` }
  }
  const occupants = projectedOccupants(state)
  for (const field of state.playerAssets.filter(asset => asset.kind === 'fob')) if ((occupants.get(field.id)?.size ?? 0) > (field.capacity ?? 1)) return { valid: false, reason: `${field.name ?? 'FOB'} IS OVER CAPACITY` }
  return { valid: true }
}

export function applyRecoveryOutcomesToBasing(assets: Asset[], outcomes: FormationRecoveryOutcome[], squadrons: Squadron[]): Asset[] {
  const liveIds = new Set(squadrons.filter(squadron => squadron.aircraft > 0).map(squadron => squadron.id))
  const next = normalizeFormationBasing(squadrons, assets).map(asset => isAirfield(asset) ? { ...asset, basedFormationIds: (asset.basedFormationIds ?? []).filter(id => liveIds.has(id)) } : asset)
  for (const outcome of outcomes) {
    for (const field of next.filter(isAirfield)) field.basedFormationIds = (field.basedFormationIds ?? []).filter(id => id !== outcome.formationId)
    const destination = outcome.actualFieldId ? next.find(asset => asset.id === outcome.actualFieldId && isAirfield(asset)) : undefined
    if (destination && liveIds.has(outcome.formationId) && (outcome.outcome === 'recovered' || outcome.outcome === 'diverted' || outcome.outcome === 'trapped')) destination.basedFormationIds = [...(destination.basedFormationIds ?? []), outcome.formationId]
  }
  return next
}

export function setAirfieldOperational(assets: Asset[], fieldId: string, operational: boolean): Asset[] {
  return assets.map(asset => asset.id === fieldId && asset.kind === 'fob' ? { ...asset, operational, health: operational ? asset.maxHealth : 0 } : asset)
}
