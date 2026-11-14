import { describe, expect, it } from 'vitest'
import { handleOnlineRequest, type MatchStore } from './api'
import type { OnlineMatch } from './match'
import type { OnlineAction, OnlineEntry, OnlineOrder, OnlineResponse } from './protocol'
import { generateRouteTemplate } from '../game/routeTemplates'
import { deriveRecoveryPlanningView } from '../game/forwardBasing'
import { flightRangeFor } from '../game/flightRules'
import { axialToPoint } from '../game/hex'
import type { Point } from '../game/types'

function fixture() {
  const games = new Map<string, OnlineMatch>()
  const store: MatchStore = {
    async get(id) { return structuredClone(games.get(id)) },
    async findByInvite(invite) { return structuredClone([...games.values()].find(game => game.invite === invite)) },
    async create(game) {
      if (games.has(game.id)) return false
      games.set(game.id, structuredClone(game))
      return true
    },
    async replace(game, version) {
      if (games.get(game.id)?.version !== version) return false
      games.set(game.id, structuredClone(game))
      return true
    },
  }
  const request = (path: string, body?: unknown, token?: string) => handleOnlineRequest(new Request(
    'https://game.example/api/online/' + path,
    { method: body === undefined ? 'GET' : 'POST',
      headers: token ? { authorization: 'Bearer ' + token } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
  ), store)
  return { request, store }
}

const hostToken = 'a'.repeat(64)
const guestToken = 'b'.repeat(64)
async function fetchEntry(response: Promise<Response>): Promise<OnlineEntry> {
  const result = await response
  expect(result.ok).toBe(true)
  return result.json()
}

function plannedOrder(player: OnlineResponse, destination: Point): OnlineOrder {
  const match = player.view.match
  const recon = match.squadrons.find(squadron => squadron.role === 'recon')!
  const home = match.playerAssets.find(asset => asset.kind === 'base')!
  const generated = generateRouteTemplate({
    template: 'search-area', ingress: [home.position, destination],
    maxDistance: flightRangeFor(recon), bounds: match.world.presentationBounds,
  })
  const recovery = deriveRecoveryPlanningView(match, recon.id, generated.route, flightRangeFor(recon))!
  return { id: recon.id, mission: 'search-area', route: recovery.normalizedRoute, routeIngress: generated.ingress,
    plannedRecoveryFieldId: recovery.intendedField.id, reconPosture: 'conservative' }
}

describe('invite-only online campaign API', () => {
  it('allocates exactly one guest seat and lets each device recover a lost entry response', async () => {
    const { request } = fixture()
    const host = await fetchEntry(request('matches', { token: hostToken }))
    const retry = await fetchEntry(request('matches', { token: hostToken }))
    expect(retry.session).toEqual(host.session)
    expect(retry.invite).toBe(host.invite)
    const tokens = [guestToken, 'c'.repeat(64)]
    const responses = await Promise.all(tokens.map(token => request('join', { token, invite: host.invite })))
    expect(responses.map(result => result.status).sort()).toEqual([200, 409])
    const guest = await responses.find(response => response.ok)!.json() as OnlineEntry
    expect((await fetchEntry(request('join', { token: guest.session.token, invite: host.invite }))).session).toEqual(guest.session)
    expect(guest.invite).toBeUndefined()
    expect((await request('matches/' + host.session.matchId)).status).toBe(404)
    expect((await request('matches/' + host.session.matchId, undefined, 'd'.repeat(64))).status).toBe(404)
  })

  it('plays a full six-round campaign with private orders, concurrent locks and retry-safe settlement', async () => {
    const { request, store } = fixture()
    let a: OnlineResponse = await fetchEntry(request('matches', { token: hostToken }))
    const id = a.view.matchId
    let b: OnlineResponse = await fetchEntry(request('join', { token: guestToken, invite: a.invite }))
    let index = 0
    const endpoint = 'matches/' + id
    const next = (player: OnlineResponse, action: OnlineAction, token: string, command = (++index).toString().padStart(16, '0')) =>
      request(endpoint + '/commands', { id: command, revision: player.view.revision, action }, token)
    const get = async (token: string) => (await request(endpoint, undefined, token)).json() as Promise<OnlineResponse>
    const perform = async (response: Promise<Response>) => {
      const result = await response
      const json = await result.json()
      expect(result.ok, JSON.stringify(json.error)).toBe(true)
      return json as OnlineResponse
    }
    const deploy = async (player: OnlineResponse, token: string) => {
      const center = player.view.match.world.friendlyTerritory.center
      const placements = [[0, 0], [2, 0], [-2, 0], [0, 2]]
      for (let step = 0; step < placements.length; step++) {
        const [dq, dr] = placements[step]
        const assetId = ['p-base', 'p-radar', 'p-sam', 'p-aaa'][step]
        const offset = axialToPoint(dq, dr)
        player = await perform(next(player, { type: 'place', assetId, position: [center[0] + offset[0], center[1] + offset[1]] }, token))
      }
      return player
    }
    ;[a, b] = await Promise.all([deploy(a, hostToken), deploy(b, guestToken)])
    expect(a.view.match.enemyAssets).toEqual([])
    expect(b.view.match.enemyAssets).toEqual([])
    a = await perform(next(a, { type: 'lock-deploy' }, hostToken))
    expect(a.view.locked).toBe(true)
    b = await perform(next(b, { type: 'lock-deploy' }, guestToken))
    a = await get(hostToken)
    expect(a.view.match.phase).toBe('plan')
    expect(b.view.match.phase).toBe('plan')

    for (let round = 1; round <= 6; round++) {
      const hold = { type: 'lock-plan' as const, orders: [] }
      const center = a.view.match.world.friendlyTerritory.center
      const plan = round === 1 ? { type: 'lock-plan' as const, orders: [plannedOrder(a, [center[0] + 1, center[1] + 1])] } : hold
      if (round === 1) {
        const altered = structuredClone(plan)
        altered.orders[0].route[1] = center
        expect((await next(a, altered, hostToken)).status).toBe(400)
        expect((await next(a, { type: 'lock-plan', orders: [{ ...plan.orders[0], mission: 'base-strike' }] }, hostToken)).status).toBe(400)
      }
      const aStart = a
      const hostCommand = 'committed-action-' + round
      await Promise.all([
        perform(next(a, plan, hostToken, hostCommand)),
        perform(next(b, hold, guestToken)),
      ])
      ;[a, b] = await Promise.all([get(hostToken), get(guestToken)])
      for (const player of [a, b]) {
        expect(player.view.match.phase).toBe('debrief')
        expect(player.view.match.lastResult?.round).toBe(round)
        expect(player.view.match.logistics).toBe(10 + round * 6)
        expect(player.view.match.cpu).toBeUndefined()
        expect(player.view.match.lastResult?.cpuReport).toBeUndefined()
        expect(player.view.match.lastResult?.enemyFlights).toEqual([])
      }
      expect((await perform(next(aStart, plan, hostToken, hostCommand))).view.revision).toBe(a.view.revision)
      expect((await next(aStart, { type: 'debrief' }, hostToken, hostCommand)).status).toBe(409)
      expect((await next(aStart, { type: 'debrief' }, hostToken)).status).toBe(409)
      ;[a, b] = await Promise.all([
        perform(next(a, { type: 'debrief' }, hostToken)),
        perform(next(b, { type: 'debrief' }, guestToken)),
      ])
      if (round < 6) {
        ;[a, b] = await Promise.all([
          perform(next(a, { type: 'next-round' }, hostToken)),
          perform(next(b, { type: 'next-round' }, guestToken)),
        ])
      }
    }
    expect(a.view.match.phase).toBe('draw')
    expect(b.view.match.phase).toBe('draw')
    expect((await store.get(id))?.resolving).toBeUndefined()
  })

  it('retries a claim that expired before the round was published', async () => {
    const { request, store } = fixture()
    const host = await fetchEntry(request('matches', { token: hostToken }))
    const game = (await store.get(host.session.matchId))!
    const prior = game.version++
    game.resolving = { claim: 'expired', until: 0 }
    game.seats[1].tokenHash = 'joined'
    for (const seat of game.seats) {
      seat.locked = true
      seat.match.phase = 'plan'
      seat.match.squadrons = seat.match.squadrons.map(squadron => ({ ...squadron, sortieOrdered: false }))
    }
    expect(await store.replace(game, prior)).toBe(true)
    const response = await request('matches/' + game.id, undefined, hostToken)
    expect(response.status).toBe(200)
    const saved = (await store.get(game.id))!
    expect(saved.resolving).toBeUndefined()
    expect(saved.seats[0].match.lastResult?.round).toBe(1)
    expect(saved.seats[1].match.lastResult?.round).toBe(1)
  })
})
