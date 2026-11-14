import { randomBytes, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

const origin = process.argv[2] ?? 'http://localhost:4173'
const hex = count => randomBytes(count).toString('hex')

async function request(path, token, body) {
  const response = await fetch(new URL('/api/online/' + path, origin), {
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  assert.equal(response.ok, true, `${response.status}: ${data.error ?? path}`)
  return data
}

async function playRound() {
  const host = await request('matches', null, { token: hex(32) })
  const guest = await request('join', null, { invite: host.invite, token: hex(32) })
  const path = 'matches/' + host.session.matchId
  const get = token => request(path, token)
  const send = (player, action, id = randomUUID()) => request(path + '/commands', player.session.token, {
    id, revision: player.view.revision, action,
  })
  const deploy = async (player) => {
    const center = player.view.match.world.friendlyTerritory.center
    const offsets = [[0, 0], [1.56 * Math.sqrt(3), 0], [-1.56 * Math.sqrt(3), 0], [.78 * Math.sqrt(3), 2.34]]
    for (const [index, assetId] of ['p-base', 'p-radar', 'p-sam', 'p-aaa'].entries()) {
      const [dx, dz] = offsets[index]
      const result = await send(player, { type: 'place', assetId, position: [center[0] + dx, center[1] + dz] })
      assert.deepEqual(result.view.match.enemyAssets, [])
      player.view = result.view
    }
    await send(player, { type: 'lock-deploy' })
    player.view = (await get(player.session.token)).view
  }
  await Promise.all([deploy(host), deploy(guest)])
  ;[host.view, guest.view] = (await Promise.all([get(host.session.token), get(guest.session.token)])).map(result => result.view)
  for (const player of [host, guest]) assert.equal(player.view.match.phase, 'plan')

  const flightOrder = (player, opponent) => {
    const home = player.view.match.playerAssets.find(asset => asset.kind === 'base').position
    const destination = opponent.view.match.playerAssets.find(asset => asset.kind === 'base').position
    const route = [home, destination, home]
    return { id: 'raven', mission: 'search-area', route, routeIngress: route, plannedRecoveryFieldId: 'p-base', reconPosture: 'aggressive' }
  }
  const hostId = randomUUID()
  const hostPlan = { type: 'lock-plan', orders: [flightOrder(host, guest)] }
  const start = performance.now()
  await Promise.all([
    send(host, hostPlan, hostId),
    send(guest, { type: 'lock-plan', orders: [flightOrder(guest, host)] }),
  ])
  const resolved = await Promise.all([get(host.session.token), get(guest.session.token)])
  const elapsed = Math.round(performance.now() - start)
  for (const player of resolved) {
    assert.equal(player.view.match.phase, 'debrief')
    assert.equal(player.view.match.lastResult.round, 1)
    assert.equal(player.view.locked, false)
    assert.equal(player.view.match.lastResult.cpuReport, undefined)
    assert.equal(player.view.match.cpu, undefined)
    assert.ok(player.view.match.lastResult.unitTracks.find(track => track.unitId === 'raven').frames.length > 400)
  }
  const duplicate = await send(host, hostPlan, hostId)
  assert.equal(duplicate.view.match.logistics, resolved[0].view.match.logistics)
  assert.equal(duplicate.view.revision, resolved[0].view.revision)
  return elapsed
}

const page = await fetch(origin)
assert.equal(page.status, 200)
assert.match(await page.text(), /Dead Reckoning/)
const times = await Promise.all(Array.from({ length: 3 }, playRound))
console.log(`Three concurrent matches joined and resolved one flown round each in ${times.join(', ')} ms (locks plus result reads).`)
