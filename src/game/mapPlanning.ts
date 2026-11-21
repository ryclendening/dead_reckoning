import { formationField, isOperationalAirfield, transitDestination } from './forwardBasing'
import { clampProtectRadius } from './missionResponsibility'
import { buildGroundStrikeRoute, protectOrbit, validateGroundStrikeOrder } from './routeTemplates'
import type { Asset, MatchState, Point, Squadron } from './types'

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function resetMapOrder(squadron: Squadron, launch: Point): Squadron {
  const mission = squadron.role === 'fighter' ? 'forward-patrol' : squadron.role === 'recon' ? 'search-area' : 'bomb'
  return {
    ...squadron, mission, route: [launch], routeIngress: [launch], sortieOrdered: false,
    protectedPoint: undefined, protectedTargetId: undefined, protectRadius: undefined, strikeTargetId: undefined,
    bombingTargets: undefined, plannedRecoveryFieldId: undefined, recoveryWaypoints: undefined,
  }
}

/** The existing mission endpoint is an anchor, separate from the player's approach waypoints. */
export function approachWaypoints(squadron: Squadron, fields: readonly Asset[]): Point[] {
  if (squadron.protectedTargetId) return []
  const field = fields.find(asset => asset.id === squadron.plannedRecoveryFieldId)
  const end = squadron.routeIngress.at(-1)
  const station = end && squadron.protectedPoint && distance(end, squadron.protectedPoint) < .001
  const fixedEnd = squadron.strikeTargetId || station || field && transitDestination(squadron, squadron.routeIngress, field)
  return squadron.routeIngress.slice(1, fixedEnd ? -1 : undefined).slice(0, 5)
}

export function mapStrikeOrder(state: MatchState, squadron: Squadron, targetId: string): Squadron | undefined {
  const field = formationField(state.playerAssets, squadron.id)
  if (!field || !isOperationalAirfield(field) || squadron.role !== 'fighter') return
  const route = buildGroundStrikeRoute(state, squadron.id, targetId, approachWaypoints(squadron, state.playerAssets))
  if (!route) return
  const order: Squadron = { ...resetMapOrder(squadron, field.position), mission: 'base-strike', strikeTargetId: targetId, route, routeIngress: route }
  return validateGroundStrikeOrder(state, order) ? undefined : order
}

export function mapProtectOrder(state: MatchState, squadron: Squadron, center: Point, radius: number): Squadron | undefined {
  const field = formationField(state.playerAssets, squadron.id)
  if (!field || !isOperationalAirfield(field) || squadron.role !== 'fighter') return
  if (!Number.isFinite(radius)) return
  const protectRadius = clampProtectRadius(radius)
  const approach = approachWaypoints(squadron, state.playerAssets)
  const lastWaypoint = approach.at(-1)
  if (lastWaypoint && distance(lastWaypoint, center) < .001) approach.pop()
  const routeIngress = [field.position, ...approach, center]
  return {
    ...resetMapOrder(squadron, field.position), mission: 'defensive-cap', protectedPoint: center, protectRadius,
    plannedRecoveryFieldId: squadron.plannedRecoveryFieldId, recoveryWaypoints: squadron.recoveryWaypoints,
    routeIngress, route: protectOrbit(routeIngress, protectRadius),
  }
}
