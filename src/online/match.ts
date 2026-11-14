import { campaignEnemyStart } from '../game/campaignLayout'
import { placeInitialAsset, validateInitialPlacement } from '../game/campaignPlacement'
import { confirmCampaignSetup, createCampaignSetupState, SETUP_FORMATION_IDS, SETUP_REQUIRED_ASSET_IDS } from '../game/campaignSetup'
import { friendlyAssetsFor, squadronsFor } from '../game/data'
import { beginNextRound, createEconomyState, executeEconomyCommand, openAdaptPhase } from '../game/economy'
import { maxEscortRoute } from '../game/escortRoute'
import { flightRangeFor } from '../game/flightRules'
import { deriveRecoveryPlanningView, distanceBetween, fieldAtRouteEnd, formationField, isOperationalAirfield, validateRecoveryPackage } from '../game/forwardBasing'
import { snapToHex } from '../game/hex'
import { OPENING_LOGISTICS, OPENING_RESERVES } from '../game/openingForces'
import { generateRouteTemplate, templatesForRole, validateGroundStrikeOrder } from '../game/routeTemplates'
import type { MatchState, Point, Squadron } from '../game/types'
import { createStartingKnowledge, generateCampaignWorld } from '../game/world'
import type { OnlineAction, OnlineOrder, OnlineView } from './protocol'

export type SeatIndex = 0 | 1

interface Seat {
  tokenHash: string
  revision: number
  locked: boolean
  match: MatchState
  commands: Record<string, string>
}

export interface OnlineMatch {
  id: string
  version: number
  invite: string
  seed: number
  resolving?: { claim: string; until: number }
  seats: [Seat, Seat]
}

export class OnlineError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

const other = (seat: SeatIndex): SeatIndex => seat === 0 ? 1 : 0
const isHex = (position: Point) => distanceBetween(snapToHex(position), position) <= .001

export function newOnlineMatch(id: string, tokenHash: string, invite: string, seed: number): OnlineMatch {
  const world = generateCampaignWorld(seed)
  const starts = [world.friendlyTerritory.center, campaignEnemyStart(seed, world.bounds, world.friendlyTerritory.center)]
  if (seed % 2) starts.reverse()

  const createSeat = (index: SeatIndex): Seat => {
    const localWorld = {
      ...world, seed: 0, layoutVersion: undefined, startRegionId: 'online',
      friendlyTerritory: { ...world.friendlyTerritory, center: starts[index] },
    }
    const match: MatchState = {
      world: localWorld, ...createStartingKnowledge(localWorld), round: 1, phase: 'deploy',
      seed: 0, logistics: OPENING_LOGISTICS, replacements: OPENING_RESERVES, command: 2, selectedId: 'raven',
      squadrons: squadronsFor(localWorld).filter(squadron => SETUP_FORMATION_IDS.some(id => id === squadron.id)),
      playerAssets: friendlyAssetsFor(localWorld).filter(asset => SETUP_REQUIRED_ASSET_IDS.some(id => id === asset.id)),
      enemyAssets: [], playerBaseHealth: 100, enemyBaseHealth: 100, baseExposure: 0, campaignScore: 0,
      economy: createEconomyState(), setup: createCampaignSetupState(),
    }
    return { match, locked: false, revision: 0, tokenHash: index === 0 ? tokenHash : '', commands: {} }
  }

  return { id, version: 0, invite, seed, seats: [createSeat(0), createSeat(1)] }
}

export function playerView(game: OnlineMatch, index: SeatIndex): OnlineView {
  const seat = game.seats[index]
  const opponent = game.seats[other(index)]
  const { cpu: _cpu, seed: _seed, world, ...match } = seat.match
  return {
    match: {
      ...match, seed: 0,
      world: { seed: 0, startRegionId: 'online', friendlyTerritory: world.friendlyTerritory,
        bounds: world.presentationBounds, presentationBounds: world.presentationBounds },
    },
    matchId: game.id,
    revision: seat.revision,
    joined: Boolean(game.seats[1].tokenHash),
    locked: seat.locked,
    opponentLocked: opponent.locked && opponent.match.round === seat.match.round && opponent.match.phase === match.phase,
  }
}

function matchingRoute(a: Point[], b: Point[]) {
  return a.length === b.length && a.every((point, index) => distanceBetween(point, b[index]) <= .001)
}

function validateOrderGeometry(match: MatchState, squadron: Squadron) {
  const field = formationField(match.playerAssets, squadron.id)
  const { presentationBounds: bounds } = match.world
  const { mission, routeIngress, route, protectedTargetId, protectedPoint } = squadron
  if (!field || !isOperationalAirfield(field) || distanceBetween(route[0], field.position) > .001 ||
      distanceBetween(routeIngress[0], field.position) > .001) return 'ROUTE MUST START AT AN OPERATIONAL LAUNCH FIELD'
  if ([...route, ...routeIngress].some(([x, z]) => x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ)) {
    return 'ROUTE IS OUTSIDE THE PLANNING AREA'
  }

  const strikeError = validateGroundStrikeOrder(match, squadron)
  if (strikeError) return strikeError
  if (mission === 'base-strike') return matchingRoute(route, routeIngress) ? undefined : 'STRIKE INGRESS MUST MATCH THE FLIGHT PATH'

  const normalize = (path: Point[]) => deriveRecoveryPlanningView(match, squadron.id, path, flightRangeFor(squadron))?.normalizedRoute
  if (protectedTargetId) {
    const target = match.squadrons.find(item => item.id === protectedTargetId)
    const targetField = match.playerAssets.find(asset => asset.id === target?.plannedRecoveryFieldId)
    if (!target || !targetField) return 'ESCORT REQUIRES A FLIGHT WITH A RECOVERY FIELD'
    const targetRoute = distanceBetween(target.route.at(-1)!, targetField.position) < .03
      ? target.route : [...target.route, targetField.position]
    const recovery = match.playerAssets.find(asset => asset.id === squadron.plannedRecoveryFieldId)
    const matchesEscort = [field.position, recovery?.position ?? field.position].some(position => {
      const expected = maxEscortRoute(field.position, targetRoute, position, flightRangeFor(squadron))
      const normalized = normalize(expected)
      return normalized && matchingRoute(route, normalized) && matchingRoute(routeIngress, expected)
    })
    return matchesEscort ? undefined : 'REDRAW THE ESCORT ROUTE FOR THE CURRENT TARGET ORDER'
  }

  const recovered = fieldAtRouteEnd(match.playerAssets, routeIngress)
  const normalizedIngress = normalize(routeIngress)
  const directRecovery = normalizedIngress && matchingRoute(route, normalizedIngress) && recovered && isOperationalAirfield(recovered)
  if (mission === 'transit') return directRecovery ? undefined : 'TRANSIT MUST END AT AN OPERATIONAL AIRFIELD'
  if (mission === 'search-area' && directRecovery) return undefined

  const generated = generateRouteTemplate({ template: mission, ingress: routeIngress, maxDistance: flightRangeFor(squadron), bounds })
  const expected = normalize(generated.route)
  if (!expected || !matchingRoute(route, expected)) return 'ROUTE MUST FOLLOW THE ASSIGNED MISSION PATTERN'
  if (mission === 'defensive-cap' && protectedPoint && distanceBetween(protectedPoint, routeIngress.at(-1)!) > .1) {
    return 'PROTECT POINT MUST MATCH THE PLANNED STATION'
  }
}

function lockOrders(match: MatchState, orders: OnlineOrder[]): MatchState {
  const byId = new Map(orders.map(order => [order.id, order]))
  if (byId.size !== orders.length) throw new OnlineError('Each formation can receive only one order.')
  const squadrons = match.squadrons.map(squadron => {
    const order = byId.get(squadron.id)
    if (!order) return { ...squadron, sortieOrdered: false, plannedRecoveryFieldId: undefined }
    byId.delete(squadron.id)
    if (!squadron.aircraft || squadron.status === 'trapped' ||
        !templatesForRole(squadron.role).some(template => template.id === order.mission)) {
      throw new OnlineError('The formation cannot fly that mission.')
    }
    return {
      ...squadron, mission: order.mission, sortieOrdered: true, route: order.route, routeIngress: order.routeIngress,
      plannedRecoveryFieldId: order.plannedRecoveryFieldId,
      strikeTargetId: order.mission === 'base-strike' ? order.strikeTargetId : undefined,
      reconPosture: squadron.role === 'recon' ? order.reconPosture : undefined,
      protectedPoint: order.mission === 'defensive-cap' && !order.protectedTargetId ? order.protectedPoint : undefined,
      protectedTargetId: order.mission === 'defensive-cap' ? order.protectedTargetId : undefined,
    }
  })
  if (byId.size) throw new OnlineError('Unknown formation.')
  const planned = { ...match, squadrons }
  const validation = validateRecoveryPackage(planned, flightRangeFor, new Set(orders.map(order => order.id)))
  if (!validation.valid) throw new OnlineError(validation.reason ?? 'Invalid recovery package.')

  for (const squadron of squadrons.filter(item => item.sortieOrdered)) {
    if (squadron.protectedTargetId) {
      const seen = new Set([squadron.id])
      let targetId: string | undefined = squadron.protectedTargetId
      while (targetId) {
        const target = squadrons.find(item => item.id === targetId)
        if (!target?.sortieOrdered || seen.has(targetId)) throw new OnlineError('Escort requires another ordered formation without an escort cycle.')
        seen.add(targetId)
        targetId = target.protectedTargetId
      }
    }
    const error = validateOrderGeometry(planned, squadron)
    if (error) throw new OnlineError(error)
  }
  return planned
}

export function applyOnlineAction(game: OnlineMatch, index: SeatIndex, action: OnlineAction) {
  const seat = game.seats[index]
  const match = seat.match
  if (seat.locked) throw new OnlineError('Your turn is already locked.', 409)

  switch (action.type) {
    case 'place': {
      if (match.phase !== 'deploy' || !match.setup) break
      if (!isHex(action.position)) throw new OnlineError('Choose a deployment hex.')
      const error = validateInitialPlacement(match, action.assetId, action.position)[0]
      if (error) throw new OnlineError(error)
      seat.match = placeInitialAsset(match, action.assetId, action.position)
      return
    }
    case 'lock-deploy':
      if (match.phase !== 'deploy' || !match.setup) break
      if (confirmCampaignSetup(match) === match) throw new OnlineError('Place every starting asset before locking deployment.')
      seat.locked = true
      if (game.seats[other(index)].locked) {
        for (const participant of game.seats) {
          participant.match = confirmCampaignSetup(participant.match)
          participant.locked = false
        }
        game.seats[other(index)].revision++
      }
      return
    case 'lock-plan':
      if (match.phase !== 'plan') break
      seat.match = lockOrders(match, action.orders)
      seat.locked = true
      return
    case 'debrief':
      if (match.phase !== 'debrief') break
      seat.match = openAdaptPhase(match)
      return
    case 'purchase': {
      if (match.phase !== 'adapt') break
      if (action.placement && !isHex(action.placement)) throw new OnlineError('Choose a construction hex.')
      const next = executeEconomyCommand(match, action)
      if (next === match) throw new OnlineError('That purchase is unavailable.')
      seat.match = next
      return
    }
    case 'next-round':
      if (match.phase !== 'adapt') break
      seat.match = beginNextRound(match)
      if (seat.match === match) break
      return
  }
  throw new OnlineError('That action is unavailable during this phase.', 409)
}

export function canResolve(game: OnlineMatch) {
  return game.seats.every(seat => seat.locked && seat.match.phase === 'plan') &&
    game.seats[0].match.round === game.seats[1].match.round
}
