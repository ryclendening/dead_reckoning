import type { Asset, FormationRecoveryOutcome, Point, Squadron } from './types'

export interface BasingContext { playerAssets: Asset[]; squadrons: Squadron[] }
import { flightRangeFor } from './flightRules'

export const AIRFIELD_LANDING_RADIUS = .6
export const FOB_MIN_CAPACITY = 2
export const MAX_RECOVERY_WAYPOINTS = 5

export const isAirfield = (asset: Asset): boolean => asset.kind === 'base' || asset.kind === 'fob'
export const isOperationalAirfield = (asset: Asset): boolean => isAirfield(asset) && asset.health > 0 && (asset.kind === 'base' || asset.operational !== false)
export const distanceBetween = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const routeDistanceForBasing = (route: Point[]) => route.slice(1).reduce((sum, point, index) => sum + distanceBetween(route[index], point), 0)
export const recoveryPath = (from: Point, field: Point, waypoints: Point[] = []): Point[] => [from, ...waypoints, field]

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
  return assets.map(asset => isAirfield(asset) ? { ...asset, operational: asset.kind === 'base' ? asset.health > 0 : asset.operational !== false && asset.health > 0, basedFormationIds: normalized.get(asset.id) ?? [], ...(asset.kind === 'fob' ? { capacity: Math.max(FOB_MIN_CAPACITY, asset.capacity ?? FOB_MIN_CAPACITY) } : {}) } : asset)
}

export function formationField(assets: Asset[], formationId: string): Asset | undefined {
  return assets.filter(isAirfield).find(asset => asset.basedFormationIds?.includes(formationId)) ?? assets.find(asset => asset.kind === 'base')
}

const FOB_SELECTION_RADIUS = 1.05

/** Snap nearby clicks to a FOB only when the player is choosing a landing field. */
export function nearbyRecoveryFob(assets: Asset[], point: Point): Asset | undefined {
  return assets.filter(asset => asset.kind === 'fob' && isOperationalAirfield(asset))
    .map(asset => ({ asset, distance: distanceBetween(point, asset.position) }))
    .filter(candidate => candidate.distance <= FOB_SELECTION_RADIUS)
    .sort((a,b) => a.distance - b.distance || a.asset.id.localeCompare(b.asset.id))[0]?.asset
}

export function transitDestination(squadron: Pick<Squadron, 'mission'>, route: Point[], field: Asset): boolean {
  const end = route.at(-1)
  return squadron.mission === 'transit' && !!end && route.length >= 2 && distanceBetween(end, field.position) <= .001
}

/** Build a Transit path to the airfield the player explicitly selected. */
export function routeToRecoveryField(state: BasingContext, formationId: string, fieldId: string, direct = false): Point[] | undefined {
  const squadron = state.squadrons.find(item => item.id === formationId)
  const launch = formationField(state.playerAssets, formationId)
  const destination = state.playerAssets.find(asset => asset.id === fieldId && isOperationalAirfield(asset))
  if (!squadron || !launch || !destination) return undefined
  const prior = direct ? [] : squadron.routeIngress.slice(1)
  const previousField = state.playerAssets.find(asset => asset.id === squadron.plannedRecoveryFieldId)
  const hasDestination = previousField && transitDestination(squadron, squadron.routeIngress, previousField)
  return [[...launch.position], ...(hasDestination ? prior.slice(0, -1) : prior), [...destination.position]]
}

function projectedOccupants(state: BasingContext, omitFormationId?: string): Map<string, Set<string>> {
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

export function fieldHasCapacity(state: BasingContext, field: Asset, formationId: string): boolean {
  if (field.kind === 'base') return true
  const occupants = projectedOccupants(state, formationId).get(field.id) ?? new Set<string>()
  return occupants.has(formationId) || occupants.size < (field.capacity ?? FOB_MIN_CAPACITY)
}

export interface RecoveryPlanningView {
  launchField: Asset
  intendedField: Asset
  alternateField?: Asset
  normalizedRoute: Point[]
  recoveryRoute: Point[]
  missionDistance: number
  remainingRange: number
  valid: boolean
  reason?: string
  summary: string
}

export interface RouteBudget {
  ingressDistance: number
  patternDistance: number
  recoveryReserve: number
  missionDistance: number
  remainingRange: number
  maxDistance: number
  intendedField: Asset
  alternateField?: Asset
}

/** Break down the exact route that execution and recovery validation will use. */
export function deriveRouteBudget(state: BasingContext, formationId: string, route: Point[], routeIngress: Point[], maxDistance: number): RouteBudget | undefined {
  const view = deriveRecoveryPlanningView(state, formationId, route, maxDistance)
  if (!view) return undefined
  const flownDistance = routeDistanceForBasing(view.normalizedRoute)
  const ingressDistance = Math.min(routeDistanceForBasing(routeIngress), flownDistance)
  const formation=state.squadrons.find(item=>item.id===formationId)
  const unfinishedTransit=formation?.mission==='transit'&&!formation.plannedRecoveryFieldId
  const recoveryReserve = unfinishedTransit?0:Math.max(0, view.missionDistance - flownDistance)
  const missionDistance=flownDistance+recoveryReserve
  return {
    ingressDistance,
    patternDistance: Math.max(0, flownDistance - ingressDistance),
    recoveryReserve,
    missionDistance,
    remainingRange: Math.max(0, maxDistance - missionDistance),
    maxDistance,
    intendedField: view.intendedField,
    alternateField: view.alternateField,
  }
}

export function nearestReachableAlternate(state: BasingContext, formationId: string, from: Point, remainingRange: number, excludedFieldId: string, claims?: Map<string, Set<string>>): Asset | undefined {
  return state.playerAssets.filter(isOperationalAirfield).filter(field => field.id !== excludedFieldId).filter(field => {
    if (distanceBetween(from, field.position) > remainingRange + .001) return false
    if (field.kind === 'base') return true
    const occupants = claims?.get(field.id) ?? projectedOccupants(state, formationId).get(field.id) ?? new Set<string>()
    return occupants.has(formationId) || occupants.size < (field.capacity ?? FOB_MIN_CAPACITY)
  }).sort((a, b) => distanceBetween(from, a.position) - distanceBetween(from, b.position) || a.id.localeCompare(b.id))[0]
}

export function deriveRecoveryPlanningView(state: BasingContext, formationId: string, route: Point[], maxDistance: number): RecoveryPlanningView | undefined {
  const assets = normalizeFormationBasing(state.squadrons, state.playerAssets)
  const launchField = formationField(assets, formationId)
  if (!launchField) return undefined
  const formation = state.squadrons.find(item => item.id === formationId)
  const requestedField = assets.find(asset => asset.id === formation?.plannedRecoveryFieldId && isAirfield(asset))
  const intendedField = requestedField ?? launchField
  const normalizedRoute = route
  const landsOutbound = formation && transitDestination(formation, route, intendedField)
  const flown = routeDistanceForBasing(normalizedRoute)
  const waypoints = formation?.recoveryWaypoints ?? []
  const recoveryRoute = !landsOutbound && normalizedRoute.length >= 2
    ? recoveryPath(normalizedRoute.at(-1)!, intendedField.position, waypoints)
    : []
  const validRecovery = waypoints.length === 0 || (recoveryRoute.length > 0
    && waypoints.length <= MAX_RECOVERY_WAYPOINTS && waypoints.every(point => point.every(Number.isFinite)))
  const reserve = routeDistanceForBasing(recoveryRoute)
  const missionDistance = flown + reserve
  const remainingRange = Math.max(0, maxDistance - flown)
  const alternateField = nearestReachableAlternate({ ...state, playerAssets: assets }, formationId, normalizedRoute.at(-1) ?? launchField.position, remainingRange, intendedField.id)
  const validStart = normalizedRoute.length > 0 && distanceBetween(normalizedRoute[0], launchField.position) <= AIRFIELD_LANDING_RADIUS
  const operational = isOperationalAirfield(intendedField)
  const capacity = fieldHasCapacity({ ...state, playerAssets: assets }, intendedField, formationId)
  const valid = normalizedRoute.length >= 2 && validStart && validRecovery && missionDistance <= maxDistance + .001 && operational && capacity
  const reason = !validStart ? 'ROUTE MUST START AT THE LAUNCH FIELD' : !validRecovery ? 'RETURN WAYPOINTS REQUIRE A SEPARATE RECOVERY LEG' : missionDistance > maxDistance + .001 ? 'ROUTE EXCEEDS AVAILABLE RANGE' : !operational ? `${intendedField.name ?? 'FOB'} IS UNUSABLE` : !capacity ? `${intendedField.name ?? 'FOB'} IS AT CAPACITY` : normalizedRoute.length < 2 ? 'DRAW A VALID ROUTE' : undefined
  const alternate = alternateField ? (alternateField.name ?? (alternateField.kind === 'base' ? 'HOME BASE' : 'FORWARD BASE')) : 'NONE'
  return { launchField, intendedField, alternateField, normalizedRoute, recoveryRoute, missionDistance, remainingRange, valid, reason, summary: `RECOVERY: ${intendedField.name ?? (intendedField.kind === 'base' ? 'HOME BASE' : 'FORWARD BASE')} · ALTERNATE: ${alternate}` }
}

export function validateRecoveryPackage(state: BasingContext, maxDistances: Record<Squadron['role'], number> | ((squadron: Squadron) => number), formationIds?: ReadonlySet<string>): { valid: boolean; reason?: string } {
  for (const squadron of state.squadrons.filter(item => item.aircraft > 0 && item.status !== 'trapped' && (!formationIds || formationIds.has(item.id)))) {
    const maxDistance = typeof maxDistances === 'function' ? maxDistances(squadron) : maxDistances[squadron.role] ?? flightRangeFor(squadron)
    const view = deriveRecoveryPlanningView(state, squadron.id, squadron.route, maxDistance)
    if (!view?.valid) return { valid: false, reason: view?.reason ?? `INVALID RECOVERY FOR ${squadron.callsign}` }
    if (squadron.plannedRecoveryFieldId !== view.intendedField.id) return { valid: false, reason: `${squadron.callsign} RECOVERY IS NOT CONFIRMED` }
  }
  const occupants = projectedOccupants(state)
  for (const field of state.playerAssets.filter(asset => asset.kind === 'fob')) if ((occupants.get(field.id)?.size ?? 0) > Math.max(FOB_MIN_CAPACITY, field.capacity ?? FOB_MIN_CAPACITY)) return { valid: false, reason: `${field.name ?? 'FOB'} IS OVER CAPACITY` }
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
