import { resolveOnlineRound } from '../game/onlineSimulation'
import type { EconomyActionId, Point } from '../game/types'
import { applyOnlineAction, canResolve, newOnlineMatch, OnlineError, playerView, type OnlineMatch, type SeatIndex } from './match'
import type { OnlineAction, OnlineCommand, OnlineOrder, OnlineResponse } from './protocol'

export interface MatchStore {
  get(id: string): Promise<OnlineMatch | undefined>
  findByInvite(invite: string): Promise<OnlineMatch | undefined>
  create(match: OnlineMatch): Promise<boolean>
  replace(match: OnlineMatch, expectedVersion: number): Promise<boolean>
}

const tokenPattern = /^[a-f0-9]{64}$/
const invitePattern = /^[a-f0-9]{32}$/
const matchPattern = /^\/api\/online\/matches\/([a-f0-9]{32})(\/commands)?$/
const commandIdPattern = /^[a-zA-Z0-9-]{16,64}$/
const missionPattern = /^(defensive-cap|forward-patrol|transit|search-area|base-strike)$/
const actionIdPattern = /^(repair-formation|replace-aircraft|repair-defense|repair-fob|install-[a-z0-9-]+|build-(fob|decoy|sam|aaa))$/
const resolutionLeaseMs = 30_000
const bodyLimit = 48 * 1024

function invalid(): never { throw new OnlineError('Invalid request.') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(value)) invalid()
  return value
}
function optionalId(value: unknown) {
  return value === undefined ? undefined : identifier(value)
}
function point(value: unknown): Point {
  if (!Array.isArray(value) || value.length !== 2 ||
      value.some(element => typeof element !== 'number' || !Number.isFinite(element) || Math.abs(element) > 1000)) invalid()
  return [value[0], value[1]]
}
function route(value: unknown, max: number) {
  if (!Array.isArray(value) || value.length < 2 || value.length > max) invalid()
  return value.map(point)
}

function parseOrder(value: unknown): OnlineOrder {
  const item = record(value)
  const { mission, reconPosture } = item
  if (typeof mission !== 'string' || !missionPattern.test(mission)) invalid()
  if (reconPosture !== undefined && reconPosture !== 'aggressive' && reconPosture !== 'conservative') invalid()
  const protectedTargetId = optionalId(item.protectedTargetId)
  return {
    id: identifier(item.id),
    mission: mission as OnlineOrder['mission'],
    route: route(item.route, 80),
    routeIngress: route(item.routeIngress, protectedTargetId ? 80 : 7),
    plannedRecoveryFieldId: identifier(item.plannedRecoveryFieldId),
    reconPosture,
    protectedTargetId,
    protectedPoint: item.protectedPoint === undefined ? undefined : point(item.protectedPoint),
    strikeTargetId: optionalId(item.strikeTargetId),
  }
}

function parseAction(value: unknown): OnlineAction {
  const item = record(value)
  switch (item.type) {
    case 'place': return { type: item.type, assetId: identifier(item.assetId), position: point(item.position) }
    case 'lock-deploy':
    case 'debrief':
    case 'next-round': return { type: item.type }
    case 'lock-plan':
      if (!Array.isArray(item.orders) || item.orders.length > 3) invalid()
      return { type: item.type, orders: item.orders.map(parseOrder) }
    case 'purchase': {
      const { actionId } = item
      const target = record(item.target)
      const { kind } = target
      if (typeof actionId !== 'string' || !actionIdPattern.test(actionId) || actionId.length > 120) invalid()
      if (kind !== 'asset' && kind !== 'squadron' && kind !== 'campaign') invalid()
      const id = identifier(target.id)
      if (kind === 'campaign' && id !== 'campaign') invalid()
      return {
        type: item.type, actionId: actionId as EconomyActionId,
        target: kind === 'campaign' ? { kind, id: 'campaign' } : { kind, id },
        placement: item.placement === undefined ? undefined : point(item.placement),
        upgradeId: optionalId(item.upgradeId),
      }
    }
    default: invalid()
  }
}

function parseCommand(item: Record<string, unknown>): OnlineCommand {
  const { id, revision } = item
  if (typeof id !== 'string' || !commandIdPattern.test(id) ||
    typeof revision !== 'number' || revision < 0 || !Number.isSafeInteger(revision)) invalid()
  return { id, revision, action: parseAction(item.action) }
}

async function readBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) invalid()
  let size = 0
  let body = ''
  const decoder = new TextDecoder()
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.length
    if (size > bodyLimit) {
      await reader.cancel()
      throw new OnlineError('Request is too large.', 413)
    }
    body += decoder.decode(chunk.value, { stream: true })
  }
  try { return record(JSON.parse(body + decoder.decode())) } catch { return invalid() }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)))
const hash = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))

function response(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}

function accepted(game: OnlineMatch, index: SeatIndex): OnlineResponse {
  const view = playerView(game, index)
  return index === 0 && !view.joined ? { view, invite: game.invite } : { view }
}

async function save(store: MatchStore, game: OnlineMatch, next: OnlineMatch) {
  next.version = game.version + 1
  return store.replace(next, game.version)
}

async function resolvePending(store: MatchStore, game: OnlineMatch) {
  if (!canResolve(game) || (game.resolving && game.resolving.until > Date.now())) return game
  const claimed: OnlineMatch = {
    ...game,
    resolving: { claim: randomHex(16), until: Date.now() + resolutionLeaseMs },
  }
  if (!await save(store, game, claimed)) return await store.get(game.id) ?? game

  try {
    const [first, second] = resolveOnlineRound(
      [claimed.seats[0].match, claimed.seats[1].match],
      (claimed.seed + claimed.seats[0].match.round * 97) >>> 0,
    )
    const settled = structuredClone(claimed)
    settled.resolving = undefined
    settled.seats[0].match = first
    settled.seats[1].match = second
    for (const seat of settled.seats) {
      seat.locked = false
      seat.revision++
    }
    return await save(store, claimed, settled) ? settled : await store.get(game.id) ?? game
  } catch (error) {
    await save(store, claimed, { ...claimed, resolving: undefined })
    throw error
  }
}

async function enter(request: Request, store: MatchStore, join: boolean) {
  const body = await readBody(request)
  const token = body.token
  if (typeof token !== 'string' || !tokenPattern.test(token)) invalid()
  const tokenHash = await hash(token)
  if (!join) {
    const id = (await hash('match:' + token)).slice(0, 32)
    const invite = randomHex(16)
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]
    const match = newOnlineMatch(id, tokenHash, invite, seed)
    const created = await store.create(match)
    const game = created ? match : await store.get(id)
    if (!game || game.seats[0].tokenHash !== tokenHash) throw new OnlineError('Could not create match. Try again.', 503)
    return response({ ...accepted(game, 0), session: { matchId: game.id, token } }, created ? 201 : 200)
  }

  const invite = body.invite
  if (typeof invite !== 'string' || !invitePattern.test(invite)) invalid()
  for (let attempt = 0; attempt < 5; attempt++) {
    const game = await store.findByInvite(invite)
    if (!game) throw new OnlineError('That invite was not found.', 404)
    if (game.seats[1].tokenHash === tokenHash) return response({ ...accepted(game, 1), session: { matchId: game.id, token } })
    if (game.seats[1].tokenHash) throw new OnlineError('That invite has already been used.', 409)
    if (game.seats[0].tokenHash === tokenHash) throw new OnlineError('Use the invite on your opponent’s device.', 409)
    const next = structuredClone(game)
    next.seats[1].tokenHash = tokenHash
    if (await save(store, game, next)) return response({ ...accepted(next, 1), session: { matchId: next.id, token } })
  }
  throw new OnlineError('The lobby is busy. Try again.', 503)
}

async function authorizedSeat(request: Request, game: OnlineMatch | undefined) {
  const authorization = request.headers.get('authorization') ?? ''
  const candidate = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!game || !tokenPattern.test(candidate)) throw new OnlineError('Match or player session not found.', 404)
  const tokenHash = await hash(candidate)
  if (game.seats[0].tokenHash === tokenHash) return 0
  if (game.seats[1].tokenHash === tokenHash) return 1
  throw new OnlineError('Match or player session not found.', 404)
}

async function submit(request: Request, store: MatchStore, game: OnlineMatch, index: SeatIndex) {
  const { id, revision, action } = parseCommand(await readBody(request))
  const digest = await hash(JSON.stringify({ revision, action }))
  for (let attempt = 0; attempt < 5; attempt++) {
    const seat = game.seats[index]
    const prior = Object.hasOwn(seat.commands, id) ? seat.commands[id] : undefined
    if (prior) {
      if (prior !== digest) throw new OnlineError('That command ID was already used.', 409)
      return response(accepted(await resolvePending(store, game), index))
    }
    if (seat.revision !== revision) throw new OnlineError('Your view is out of date. Refresh and try again.', 409)
    if (action.type === 'lock-plan' && !game.seats[1].tokenHash) throw new OnlineError('Wait for your opponent to join.', 409)
    const next = structuredClone(game)
    applyOnlineAction(next, index, action)
    const updatedSeat = next.seats[index]
    updatedSeat.revision++
    updatedSeat.commands[id] = digest
    const commandIds = Object.keys(updatedSeat.commands)
    if (commandIds.length > 128) delete updatedSeat.commands[commandIds[0]]
    if (await save(store, game, next)) return response(accepted(await resolvePending(store, next), index))
    game = await store.get(game.id) ?? game
  }
  throw new OnlineError('The match is busy. Retry this action.', 503)
}

export async function handleOnlineRequest(request: Request, store: MatchStore): Promise<Response> {
  const path = new URL(request.url).pathname
  try {
    if (request.method === 'POST' && path === '/api/online/matches') return await enter(request, store, false)
    if (request.method === 'POST' && path === '/api/online/join') return await enter(request, store, true)
    const routeMatch = matchPattern.exec(path)
    if (!routeMatch) return response({ error: 'Unknown online endpoint.' }, 404)
    const game = await store.get(routeMatch[1])
    const index = await authorizedSeat(request, game)
    if (!game) return response({ error: 'Match or player session not found.' }, 404)
    if (routeMatch[2] && request.method === 'POST') return await submit(request, store, game, index)
    if (!routeMatch[2] && request.method === 'GET') return response(accepted(await resolvePending(store, game), index))
    return response({ error: 'Method not allowed.' }, 405)
  } catch (error) {
    if (error instanceof OnlineError) return response({ error: error.message }, error.status)
    console.error('Online match operation failed:', error instanceof Error ? error.name : 'Unknown error')
    return response({ error: 'Online service unavailable. Try again in a moment.' }, 503)
  }
}
