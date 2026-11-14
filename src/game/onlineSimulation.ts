import { resolveRound } from './engine'
import { deriveLogisticsIncome } from './economy'
import { applyRecoveryOutcomesToBasing } from './forwardBasing'
import type { Asset, EnemyFlight, MatchState, RoundResult, Squadron } from './types'
import type { CampaignOutcome } from './campaign'
import type { CpuSiteReport, CpuState } from './cpu/types'

const opponentId = (id: string) => `opponent:${id.replace(/^opponent:/, '')}`
const localId = (id: string) => id.replace(/^opponent:/, '')
const clone = <T>(value: T): T => structuredClone(value)

function mapAsset(asset: Asset, id: string): Asset {
  return { ...clone(asset), id,
    basedFormationIds: asset.basedFormationIds?.map(opponentId),
  }
}

function mapOrder(order: Squadron, knownTargets: Map<string, string>): Squadron {
  return { ...clone(order), id: opponentId(order.id),
    route: clone(order.route), routeIngress: clone(order.routeIngress),
    plannedRecoveryFieldId: order.plannedRecoveryFieldId ? opponentId(order.plannedRecoveryFieldId) : undefined,
    protectedTargetId: order.protectedTargetId ? opponentId(order.protectedTargetId) : undefined,
    strikeTargetId: order.strikeTargetId ? knownTargets.get(localId(order.strikeTargetId)) ?? localId(order.strikeTargetId) : undefined,
  }
}

function knownReports(state: MatchState, enemyToCanonical: Map<string, string>): CpuSiteReport[] {
  return state.enemyAssets.flatMap(asset => {
    const id = enemyToCanonical.get(localId(asset.id))
    return id ? [{ id, kind: asset.kind, position: clone(asset.position), health: asset.health,
      maxHealth: asset.maxHealth, observedRound: Math.max(1, state.round), upgrades: clone(asset.upgrades ?? []) }] : []
  })
}

function makeCpuState(seat: MatchState, orders: Squadron[], reports: CpuSiteReport[], seed: number): CpuState {
  const planOrders = orders.map(order => clone(order))
  const firstFighter = planOrders.find(order => order.role === 'fighter') ?? planOrders[0]
  return {
    version: 2, difficulty: 'medium', seed, formations: planOrders.map(order => clone(order)),
    logistics: seat.logistics, reserves: seat.replacements, sites: reports, traffic: [],
    searchIndex: 0, lastReconLost: false, spending: [],
    plan: { round: seat.round, objective: firstFighter?.mission === 'base-strike' ? 'strike' : 'defend',
      reason: 'Committed online opponent orders.', orders: planOrders, candidates: [] },
  }
}

function observedEnemyAssets(input: Asset[], actual: Asset[], idPrefix: boolean): Asset[] {
  const known = new Map(input.map(asset => [localId(asset.id), asset]))
  const output = new Map<string, Asset>()
  for (const asset of actual) {
    const prior = known.get(localId(asset.id))
    if (asset.intel !== 'unknown' && !asset.hidden || prior && prior.intel !== 'unknown' && !prior.hidden) {
      const id = idPrefix ? opponentId(localId(asset.id)) : localId(asset.id)
      const damagedSinceReport = Boolean(prior && asset.health < prior.health)
      output.set(id, { ...(prior ? clone(prior) : clone(asset)), id,
        health: prior ? damagedSinceReport ? asset.health : prior.health : asset.health,
        maxHealth: prior?.maxHealth ?? asset.maxHealth,
        intel: prior?.intel === 'confirmed' || asset.intel === 'confirmed' ? 'confirmed' : asset.intel,
        confidence: Math.max(prior?.confidence ?? 0, asset.confidence), hidden: false,
        position: prior ? clone(prior.position) : clone(asset.position),
        upgrades: clone(prior?.upgrades ?? asset.upgrades),
        operational: prior && !damagedSinceReport ? prior.operational : asset.operational,
        struck: Boolean(prior?.struck || damagedSinceReport),
        basedFormationIds: undefined,
      })
    }
  }
  for (const [id, asset] of known) {
    if (!output.has(id) && asset.intel !== 'unknown') {
      const key = idPrefix ? opponentId(id) : id
      output.set(key, { ...clone(asset), id: key, basedFormationIds: undefined })
    }
  }
  return [...output.values()]
}

function outcomeFor(home: MatchState, enemyBaseHealth: number, enemyFormations: Squadron[], round: number, enemyReserves: number): CampaignOutcome | undefined {
  const ownBase = home.playerAssets.find(asset => asset.kind === 'base')
  const ownHealth = Math.min(home.playerBaseHealth, ownBase?.health ?? home.playerBaseHealth)
  if (ownHealth <= 0 && enemyBaseHealth <= 0) return 'mutual-destruction'
  if (enemyBaseHealth <= 0) return 'enemy-base-destroyed'
  if (ownHealth <= 0) return 'home-base-destroyed'
  const ownLost = home.squadrons.every(item => item.aircraft <= 0) && home.replacements <= 0
  const enemyLost = enemyFormations.length > 0 && enemyFormations.every(item => item.aircraft <= 0) && enemyReserves <= 0
  if (ownLost && enemyLost) return 'mutual-forces-lost'
  if (ownLost) return 'forces-lost'
  if (enemyLost) return 'enemy-forces-lost'
  return round >= 6 ? 'deadline' : undefined
}

function visibleTimes(result: RoundResult, hostileId: string): Array<[number, number]> {
  return result.contactIntervals.filter(interval => interval.targetId === hostileId).map(interval => [interval.start, interval.end])
}
function projectResult(result: RoundResult, ownIds: Set<string>, opponentIds: Set<string>, input: MatchState,
  opponentAssetPrefix: boolean): RoundResult {
  const hasOwn = (id: string) => ownIds.has(id)
  const hasOpponent = (id: string) => opponentIds.has(id)
  const hostileTrackIds = new Map<string, string>()
  for (const interval of result.contactIntervals.filter(item => hasOwn(item.observerId) && hasOpponent(item.targetId))) {
    if (!hostileTrackIds.has(interval.targetId)) hostileTrackIds.set(interval.targetId, `opponent:track-${hostileTrackIds.size + 1}`)
  }
  const ownId = (id: string) => hasOwn(id) ? localId(id) : hostileTrackIds.get(id) ?? opponentId(localId(id))
  const visibleIntervals = result.contactIntervals.filter(item => hasOwn(item.observerId) && hasOpponent(item.targetId))
  const visibleTargets = new Set(visibleIntervals.map(item => item.targetId))
  const authorizedTimes = new Map([...visibleTargets].map(id => [id, visibleTimes(result, id)]))
  const authorizedFrame = (id: string, time: number) => (authorizedTimes.get(id) ?? []).some(([start, end]) => time >= start - .001 && time <= end + .001)
  const visualFrame = (id: string, time: number) => visibleIntervals.some(interval => interval.targetId === id && interval.source === 'visual' && time >= interval.start - .001 && time <= interval.end + .001)
  const ownTracks = result.unitTracks.filter(track => hasOwn(track.unitId))
  const contactTracks = result.unitTracks.filter(track => hasOpponent(track.unitId) && visibleTargets.has(track.unitId)).map(track => ({
    ...clone(track), unitId: ownId(track.unitId),
    frames: track.frames.filter(frame => authorizedFrame(track.unitId, frame.time)).map(frame => visualFrame(track.unitId, frame.time) ? { ...frame, traveledDistance: 0, morale: 70 } : {
      ...frame, mode: 'following-route' as const, strength: 100, morale: 70, aircraft: 4, traveledDistance: 0,
      facing: [frame.position[0] + 1, frame.position[1]] as [number, number],
    }),
  })).filter(track => track.frames.length > 0)
  const tracks = [...ownTracks.map(track => ({ ...clone(track), unitId: ownId(track.unitId) })), ...contactTracks]
  const ownFlights = result.enemyFlights.filter(flight => hasOpponent(flight.id) && visibleTargets.has(flight.id)).map(flight => {
    const frames = contactTracks.find(track => track.unitId === ownId(flight.id))?.frames ?? []
    const visual = visibleIntervals.some(interval => interval.targetId === flight.id && interval.source === 'visual')
    const lastVisual = frames.filter(frame => visualFrame(flight.id, frame.time)).at(-1)
    return { id: ownId(flight.id), callsign: visual ? flight.callsign : 'UNKNOWN AIRCRAFT',
      role: visual ? flight.role : 'fighter', aircraft: lastVisual?.aircraft ?? 4,
      strength: lastVisual?.strength, target: 'base', initialAircraft: lastVisual?.aircraft ?? 4,
      route: frames.map(frame => clone(frame.position)),
      detectionWindows: visibleIntervals.filter(interval => interval.targetId === flight.id).map(interval => ({
        start: interval.start / result.duration, end: interval.end / result.duration, source: interval.source,
      })),
    } satisfies EnemyFlight
  })
  const ownResultSquadrons = result.squadrons.filter(squadron => hasOwn(squadron.id)).map(squadron => ({ ...clone(squadron), id: ownId(squadron.id) }))
  const knownAssets = observedEnemyAssets(input.enemyAssets, result.assets, opponentAssetPrefix)
  const inputOwnAssets = new Set(input.playerAssets.map(asset => localId(asset.id)))
  const ownAssets = result.playerAssets.filter(asset => inputOwnAssets.has(localId(asset.id))).map(asset => ({ ...clone(asset), id: localId(asset.id) }))
  const ownReports = result.intelReports.filter(report => hasOwn(report.observerId)).map(report => ({ ...clone(report),
    observerId: ownId(report.observerId), assetId: opponentId(localId(report.assetId)) }))
  const knownAssetIds = new Set([...opponentIds].filter(id => knownAssets.some(asset => asset.id === ownId(id))))
  const visibleLossIds = new Set(result.combatSequences.flatMap(sequence => sequence.exchanges
    .filter(exchange => exchange.hit && hasOwn(exchange.attackerId) && visibleTargets.has(exchange.defenderId) && visualFrame(exchange.defenderId, exchange.time))
    .map(exchange => exchange.defenderId)))
  const committedAircraft = ownTracks.filter(track => track.frames[0]?.mode === 'following-route')
    .reduce((total, track) => total + track.frames[0].aircraft, 0)
  const enemyAttrition = result.enemyAttrition.flatMap(item => {
    if (!item.confirmed || !visibleLossIds.has(item.id)) return []
    const visualFrames = contactTracks.find(track => track.unitId === ownId(item.id))?.frames.filter(frame => visualFrame(item.id, frame.time)) ?? []
    const startAircraft = visualFrames[0]?.aircraft ?? 0, endAircraft = visualFrames.at(-1)?.aircraft ?? 0
    const aircraftLost = Math.min(item.aircraftLost, startAircraft - endAircraft)
    if (aircraftLost <= 0) return []
    return [{ ...item, id: ownId(item.id), startAircraft, endAircraft, aircraftLost, endStrength: visualFrames.at(-1)?.strength ?? 0,
      destroyed: endAircraft === 0, finalStatus: endAircraft === 0 ? 'destroyed' as const : 'damaged' as const }]
  })
  const events: RoundResult['events'] = [{
    id: 'sorties-airborne', time: 0, tone: 'info', title: 'SORTIES AIRBORNE', detail: `${committedAircraft} aircraft committed.`,
  }]
  for (const report of ownReports.filter(item => item.recovered)) {
    const asset = knownAssets.find(item => item.id === report.assetId)
    if (asset) events.push({ id: report.id, time: result.duration, tone: 'friendly', title: 'INTEL RECOVERED', detail: report.detail, position: asset.position })
  }
  for (const effect of result.weaponEffects.filter(item => item.kind === 'air-to-ground-missile' && hasOwn(item.sourceId))) {
    const squadron = ownResultSquadrons.find(item => item.id === ownId(effect.sourceId))
    if (squadron) events.push({ id: 'strike-' + effect.sourceId, time: effect.start, tone: 'friendly', title: 'GROUND STRIKE LAUNCHED',
      detail: `${squadron.callsign} releases an air-to-ground missile.`, position: effect.from })
  }
  events.sort((a, b) => a.time - b.time)
  const authorizedParticipant = (id: string, time: number) =>
    hasOwn(id) || knownAssetIds.has(id) || authorizedFrame(id, time)
  const sequences = result.combatSequences.filter(sequence => sequence.participantIds.some(hasOwn) &&
    (sequence.kind === 'strike' || sequence.participantIds.every(id => authorizedParticipant(id, sequence.start)))).map((sequence, index) => ({
    ...clone(sequence), id: `replay-${sequence.kind}-${index}`,
    participantIds: sequence.participantIds.map(id => authorizedParticipant(id, sequence.start) ? ownId(id) : 'hostile-aircraft'),
    finalDisposition: Object.fromEntries(Object.entries(sequence.finalDisposition).filter(([id]) => hasOwn(id)).map(([id, mode]) => [ownId(id), mode])),
    moraleBreakReason: undefined,
    exchanges: sequence.exchanges.filter(exchange => sequence.kind === 'strike' ||
      authorizedParticipant(exchange.attackerId, exchange.time) && authorizedParticipant(exchange.defenderId, exchange.time)).map(exchange => {
        const defenderFrame = hasOpponent(exchange.defenderId) ? contactTracks.find(track => track.unitId === ownId(exchange.defenderId))?.frames
          .filter(frame => frame.time <= exchange.time && visualFrame(exchange.defenderId, frame.time)).at(-1) : undefined
        return { ...exchange, probability: undefined, numericalAssessment: undefined,
          id: `replay-shot-${Math.round(exchange.time * 20)}-${ownId(exchange.defenderId)}`,
          attackerId: authorizedParticipant(exchange.attackerId, exchange.time) ? ownId(exchange.attackerId) : 'hostile-aircraft',
          defenderId: ownId(exchange.defenderId),
          ...(hasOpponent(exchange.defenderId) && !knownAssetIds.has(exchange.defenderId)
            ? { targetStrength: defenderFrame?.strength ?? 100, targetMorale: 70 } : {}) }
      }),
    ...(sequence.kind === 'dogfight' ? { engagement: { ...sequence.engagement,
      sides: { friendly: sequence.engagement.sides.friendly.map(ownId), hostile: sequence.engagement.sides.hostile.map(ownId) },
      participants: sequence.engagement.participants.map(participant => {
        if (hasOwn(participant.id)) return { ...participant, id: ownId(participant.id) }
        const track = contactTracks.find(item => item.unitId === ownId(participant.id))
        const first = track?.frames[0], last = track?.frames.at(-1)
        return { ...participant, id: ownId(participant.id), joinedAt: first?.time ?? participant.joinedAt,
          exitedAt: last?.time ?? participant.exitedAt, initialStrength: first?.strength ?? 100, finalStrength: last?.strength ?? 100,
          initialAircraft: first?.aircraft ?? 4, finalAircraft: last?.aircraft ?? 4, finalDisposition: 'rtb' as const }
      }),
      positionalAssessments: sequence.engagement.positionalAssessments.filter(item => !hasOpponent(item.participantId) || authorizedFrame(item.participantId, item.evaluatedAt))
        .filter(item => !hasOpponent(item.opponentId) || authorizedFrame(item.opponentId, item.evaluatedAt))
        .map(item => ({ ...item, participantId: ownId(item.participantId), opponentId: ownId(item.opponentId) })),
    } } : {}),
  })) as RoundResult['combatSequences']
  const effects = result.weaponEffects.filter(effect => (hasOwn(effect.targetId) && (hasOwn(effect.sourceId) || knownAssetIds.has(effect.sourceId) ||
      authorizedFrame(effect.sourceId, effect.start))) ||
    (hasOwn(effect.sourceId) && (knownAssetIds.has(effect.targetId) || authorizedFrame(effect.targetId, effect.start))))
    .map(effect => {
      let to = clone(effect.to)
      if (hasOpponent(effect.targetId)) {
        const lastVisible = contactTracks.find(track => track.unitId === ownId(effect.targetId))?.frames.filter(frame => frame.time <= effect.end).at(-1)
        if (lastVisible) to = clone(lastVisible.position)
      }
      return { ...clone(effect), id: `replay-effect-${Math.round(effect.start * 20)}-${ownId(effect.sourceId)}-${ownId(effect.targetId)}`,
        sourceId: ownId(effect.sourceId), targetId: ownId(effect.targetId), to }
    })
  const recovery = result.recoveryOutcomes.filter(item => hasOwn(item.formationId)).map(item => ({ ...clone(item),
    formationId: ownId(item.formationId), launchFieldId: localId(item.launchFieldId), plannedFieldId: localId(item.plannedFieldId), actualFieldId: item.actualFieldId ? localId(item.actualFieldId) : undefined,
  }))
  return {
    ...clone(result), cpuReport: undefined, squadrons: ownResultSquadrons, assets: knownAssets, playerAssets: ownAssets,
    unitTracks: tracks, enemyFlights: ownFlights, executionRoutes: Object.fromEntries(tracks.map(track => [track.unitId, track.frames.map(frame => clone(frame.position))])),
    contactIntervals: visibleIntervals.map(item => ({ ...clone(item), observerId: ownId(item.observerId), targetId: ownId(item.targetId) })),
    behaviorIntervals: result.behaviorIntervals.filter(item => hasOwn(item.unitId)).map(item => ({ ...clone(item), unitId: ownId(item.unitId), targetId: item.targetId && authorizedParticipant(item.targetId, item.start) ? ownId(item.targetId) : undefined })),
    events, lessons: [], combatSequences: sequences, activeDogfights: undefined, weaponEffects: effects,
    contactObservations: result.contactObservations.filter(item => hasOwn(item.observerId) && hasOpponent(item.targetId) && visibleTargets.has(item.targetId)).map(item => ({ ...clone(item), observerId: ownId(item.observerId), targetId: ownId(item.targetId) })),
    interceptPlans: result.interceptPlans.filter(item => hasOwn(item.squadronId) && hasOpponent(item.targetId) && visibleTargets.has(item.targetId)).map(item => ({ ...clone(item), squadronId: ownId(item.squadronId), targetId: ownId(item.targetId) })),
    intelReports: ownReports, intelGained: ownReports.filter(item => item.recovered).map(item => item.detail), recoveryOutcomes: recovery,
    friendlyAttrition: result.friendlyAttrition.filter(item => hasOwn(item.id)).map(item => ({ ...clone(item), id: ownId(item.id) })),
    enemyAttrition,
    friendlyFormationsDestroyed: ownResultSquadrons.filter(item => item.aircraft <= 0).length,
    enemyFormationsDestroyed: enemyAttrition.filter(item => item.destroyed).length,
    friendlyLosses: result.friendlyAttrition.reduce((total, item) => total + item.aircraftLost, 0), enemyLosses: enemyAttrition.reduce((sum, item) => sum + item.aircraftLost, 0),
    simulationCommands: result.simulationCommands?.filter(command => hasOwn(command.unitId)).map(command => ({ ...clone(command), unitId: ownId(command.unitId) })),
    threatAlerts: result.threatAlerts?.filter(alert => hasOwn(alert.unitId) && (hasOwn(alert.sourceId) || authorizedParticipant(alert.sourceId, alert.time))).map(alert => ({ ...clone(alert), unitId: ownId(alert.unitId), sourceId: ownId(alert.sourceId) })),
    mappedAreas: [...new Map([...input.mappedAreas, ...result.mappedAreas].map(point => [`${point[0]}:${point[1]}`, point])).values()],
    discoveredBoundaries: input.discoveredBoundaries, baseExposure: input.baseExposure, baseExposureDelta: 0,
    roundScore: events.reduce((score, event) => score + (event.title === 'INTEL RECOVERED' || event.title === 'ENEMY AIRCRAFT LOST' ? 2 : event.title === 'DOGFIGHT ENDS' ? 1 : 0), 0),
  }
}

function sideIncome(state: MatchState, enemyLosses: number, reports: RoundResult['intelReports']) {
  return deriveLogisticsIncome(state, { enemyLosses, intelReports: reports })
}

function projectSeat(input: MatchState, enemyAssetsForSeat: Asset[], ownAssetsForSeat: Asset[], ownFormationValues: Squadron[],
  resultForSeat: RoundResult, outcome: CampaignOutcome | undefined): MatchState {
  const income = resultForSeat.logisticsIncome
  const settled = input.economy.lastSettledRound === input.round
  const statement = settled ? input.economy.statement : [
    ...input.economy.statement,
    { id: `income-${input.round}-base`, round: input.round, direction: 'income' as const, amount: income.base,
      label: income.base > 6 ? 'ROUND LOGISTICS · SUPPLY DEPOT' : 'ROUND LOGISTICS', source: 'round-income' },
    ...(income.intel ? [{ id: `income-${input.round}-intel`, round: input.round, direction: 'income' as const, amount: income.intel, label: 'INTELLIGENCE RECOVERY', source: 'intel-recovery' }] : []),
    ...(income.enemyAircraft ? [{ id: `income-${input.round}-enemy-aircraft`, round: input.round, direction: 'income' as const, amount: income.enemyAircraft, label: 'CONFIRMED ENEMY AIRCRAFT', source: 'enemy-aircraft' }] : []),
  ]
  return {
    ...clone(input), phase: 'debrief', round: input.round, seed: input.seed, campaignScore: input.campaignScore + resultForSeat.roundScore,
    squadrons: ownFormationValues, playerAssets: ownAssetsForSeat, enemyAssets: enemyAssetsForSeat,
    playerBaseHealth: ownAssetsForSeat.find(asset => asset.kind === 'base')?.health ?? input.playerBaseHealth,
    enemyBaseHealth: enemyAssetsForSeat.find(asset => asset.kind === 'base')?.health ?? input.enemyBaseHealth,
    logistics: input.logistics + (settled ? 0 : income.total), economy: { lastSettledRound: input.round, statement },
    command: Math.min(3, input.command + 1),
    mappedAreas: [...new Map([...input.mappedAreas, ...resultForSeat.mappedAreas].map(point => [`${point[0]}:${point[1]}`, point])).values()],
    discoveredBoundaries: clone(input.discoveredBoundaries),
    lastResult: resultForSeat,
    ...(outcome ? { onlineOutcome: outcome } : { onlineOutcome: undefined }),
  } as MatchState
}

/** Resolve both committed sides once, then publish a visibility-safe replay to each seat. */
export function resolveOnlineRound(seats: [MatchState, MatchState], seed: number): [MatchState, MatchState] {
  const [a, b] = seats
  const aAssetsByLocalId = new Map(a.playerAssets.map(asset => [localId(asset.id), asset]))
  const aEnemyReports = new Map(a.enemyAssets.map(asset => [localId(asset.id), asset]))
  const bAssets = b.playerAssets.map(asset => {
    const report = aEnemyReports.get(localId(asset.id))
    return { ...mapAsset(asset, opponentId(asset.id)), intel: report?.intel ?? 'unknown', confidence: report?.confidence ?? 0,
      hidden: !report || report.intel === 'unknown' || report.hidden }
  })
  const bKnownTargets = new Map<string, string>()
  for (const report of b.enemyAssets) {
    const id = localId(report.id)
    if (aAssetsByLocalId.has(id)) bKnownTargets.set(id, id)
  }
  const bOrders = b.squadrons.map(order => mapOrder(order, bKnownTargets))
  const aAssets = clone(a.playerAssets)
  const bReports = knownReports(b, bKnownTargets)
  const mappedCpu = makeCpuState(b, bOrders, bReports, seed)
  const canonical: MatchState = {
    ...clone(a), cpu: mappedCpu, debugScenario: 'campaign', phase: 'plan',
    squadrons: clone(a.squadrons), playerAssets: aAssets, enemyAssets: bAssets,
    playerBaseHealth: a.playerAssets.find(asset => asset.kind === 'base')?.health ?? a.playerBaseHealth,
    enemyBaseHealth: b.playerAssets.find(asset => asset.kind === 'base')?.health ?? b.enemyBaseHealth,
    seed, lastResult: undefined,
  }
  const raw = resolveRound(canonical, [], { recordOpponentView: true })
  const aSeed = new Set([...a.squadrons.map(order => order.id), ...a.playerAssets.map(asset => asset.id)])
  const bSeed = new Set([...bOrders.map(order => order.id), ...bAssets.map(asset => asset.id)])
  const bOpponents = new Set([...a.squadrons.map(order => order.id), ...a.playerAssets.map(asset => asset.id)])
  const bOriginal = new Map(b.squadrons.map(item => [item.id, item]))
  const bRecovery = raw.cpuReport?.recoveryOutcomes ?? []
  const bFormations: Squadron[] = raw.enemyFlights.map(flight => {
    const original = bOriginal.get(localId(flight.id))!
    const recovery = bRecovery.find(item => item.formationId === flight.id)
    return { ...clone(original), aircraft: flight.aircraft, strength: flight.strength, morale: flight.morale,
      readiness: flight.readiness ?? original.readiness, ammo: flight.ammo ?? original.ammo,
      status: recovery?.outcome === 'trapped' ? 'trapped' : recovery?.outcome === 'destroyed' || recovery?.outcome === 'lost' ? 'destroyed' : flight.status,
      sortieOrdered: flight.sortieOrdered, plannedRecoveryFieldId: undefined }
  })
  const aFormations = raw.squadrons.map(item => clone(item))
  const bOwnAssets = raw.assets.map(asset => ({ ...clone(asset), id: localId(asset.id), intel: 'confirmed' as const, confidence: 100, hidden: false, basedFormationIds: asset.basedFormationIds?.map(localId) }))
  const bSettledAssets = applyRecoveryOutcomesToBasing(bOwnAssets, bRecovery.map(item => ({ ...item,
    formationId: localId(item.formationId), launchFieldId: localId(item.launchFieldId), plannedFieldId: localId(item.plannedFieldId), actualFieldId: item.actualFieldId ? localId(item.actualFieldId) : undefined,
  })), bFormations)
  const aProjection = projectResult(raw, aSeed, bSeed, a, true)
  const reverse: RoundResult = {
    ...raw,
    squadrons: bFormations.map(formation => ({ ...formation, id: opponentId(formation.id) })),
    assets: raw.playerAssets.map(asset => {
      const prior = b.enemyAssets.find(item => localId(item.id) === localId(asset.id))
      return { ...clone(asset), id: opponentId(localId(asset.id)), intel: prior?.intel ?? 'unknown',
        confidence: prior?.confidence ?? 0, hidden: !prior || prior.intel === 'unknown' || prior.hidden }
    }),
    playerAssets: bSettledAssets,
    enemyFlights: raw.squadrons.map(squadron => ({ ...clone(squadron), id: squadron.id, initialAircraft: squadron.aircraft,
      target: 'base' as const, detectionWindows: raw.contactIntervals.filter(interval => interval.targetId === squadron.id).map(interval => ({ start: interval.start / raw.duration, end: interval.end / raw.duration, source: interval.source, observer: interval.observerId })) })),
    contactIntervals: raw.cpuReport?.opponentContacts ?? [], mappedAreas: raw.cpuReport?.mappedAreas ?? [], discoveredBoundaries: [],
    friendlyAttrition: raw.enemyAttrition, enemyAttrition: raw.friendlyAttrition,
    recoveryOutcomes: bRecovery,
    friendlyLosses: raw.enemyLosses, enemyLosses: raw.friendlyLosses,
    baseDamage: raw.enemyBaseDamage, enemyBaseDamage: raw.baseDamage, command: Math.min(3, b.command + 1),
    cpuReport: undefined,
  }
  reverse.combatSequences = reverse.combatSequences.map(sequence => sequence.kind === 'dogfight' ? ({ ...sequence,
    engagement: { ...sequence.engagement, sides: { friendly: sequence.engagement.sides.hostile, hostile: sequence.engagement.sides.friendly } },
  }) : sequence)
  const aResult = {
    ...aProjection,
    logisticsIncome: sideIncome(a, aProjection.enemyLosses, aProjection.intelReports),
  }
  const reportedAssets = (raw.cpuReport?.sites ?? []).map(report => ({
    id: opponentId(report.id), kind: report.kind, position: clone(report.position), health: report.health,
    maxHealth: report.maxHealth, intel: 'confirmed' as const, confidence: 90, hidden: false, struck: false,
    upgrades: clone(report.upgrades ?? []),
  }))
  const bNewIntelReports = reportedAssets.flatMap(asset => {
    const previous = b.enemyAssets.find(item => item.id === asset.id)
    const observerId = raw.cpuReport?.siteObservers?.[localId(asset.id)]
    if (previous && previous.intel !== 'unknown' && !previous.hidden || !observerId) return []
    return [{ id: `intel-${asset.id}`, observerId, assetId: asset.id, confidence: 90,
      recovered: true, detail: `Recovered ${asset.kind} coordinates.` }]
  })
  const refreshedAssets = new Map(reportedAssets.map(asset => [asset.id, asset]))
  reverse.assets = reverse.assets.map(asset => refreshedAssets.get(asset.id) ?? asset)
  reverse.intelReports = bNewIntelReports
  const bProjection = projectResult(reverse, bSeed, bOpponents, b, true)
  const bResult = {
    ...bProjection,
    logisticsIncome: sideIncome(b, bProjection.enemyLosses, bProjection.intelReports),
  }
  const aResultWithRound = { ...aResult, round: a.round }
  const bResultWithRound = { ...bResult, round: b.round }
  const aOwnAssets = raw.playerAssets.map(asset => clone(asset))
  const aOutcome = outcomeFor({ ...a, squadrons: aFormations, playerAssets: aOwnAssets,
    playerBaseHealth: aOwnAssets.find(asset => asset.kind === 'base')?.health ?? 0 },
    bOwnAssets.find(asset => asset.kind === 'base')?.health ?? 0, bFormations, a.round, b.replacements)
  const bOutcome = outcomeFor({ ...b, squadrons: bFormations, playerAssets: bSettledAssets,
    playerBaseHealth: bSettledAssets.find(asset => asset.kind === 'base')?.health ?? 0 },
    aOwnAssets.find(asset => asset.kind === 'base')?.health ?? 0, aFormations, b.round, a.replacements)
  const aState = projectSeat(a, aResult.assets, aOwnAssets, aFormations, aResultWithRound, aOutcome)
  const bState = projectSeat(b,
    bResult.assets, bSettledAssets, bFormations, bResultWithRound, bOutcome)
  return [aState, bState]
}
