import { resolveRound } from './engine'
import { deriveLogisticsIncome } from './economy'
import { LOGISTICS_EFFECTS } from './economyRules'
import { applyRecoveryOutcomesToBasing } from './forwardBasing'
import type { Asset, CombatEvent, EnemyFlight, GroundSiteSighting, MatchState, RoundResult, Squadron } from './types'
import { CAMPAIGN_ROUND_LIMIT, type CampaignOutcome } from './campaign'
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
    strikeTargetId: order.strikeTargetId ? knownTargets.get(localId(order.strikeTargetId)) : undefined,
    bombingTargets: order.bombingTargets?.map(target => ({
      // Unknown opponent targets are never promoted into canonical combat IDs.
      targetId: knownTargets.get(localId(target.targetId)) ?? '',
      routeIndex: target.routeIndex,
    })),
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

function observedEnemyAssets(input: Asset[], actual: Asset[], refreshed: Set<string>, strikeHealth: Map<string, number>): Asset[] {
  const known = new Map(input.filter(asset=>!asset.hidden&&asset.intel!=='unknown')
    .map(asset=>[localId(asset.id),asset]))
  for (const asset of actual) {
    const id = localId(asset.id)
    const prior = known.get(id)
    if (refreshed.has(id)) {
      known.set(id,{...clone(asset),id:opponentId(id),intel:'confirmed',confidence:Math.max(90,prior?.confidence??0),hidden:false,basedFormationIds:undefined})
    }
    const strike = strikeHealth.get(id)
    const current = known.get(id)
    if (current && strike !== undefined) {
      known.set(id,{...current,health:strike,operational:strike>0?current.operational:false,struck:true})
    }
  }
  return [...known.values()]
}

function outcomeFor(ownHealth: number, enemyBaseHealth: number, round: number): CampaignOutcome | undefined {
  if (ownHealth <= 0 && enemyBaseHealth <= 0) return 'mutual-destruction'
  if (enemyBaseHealth <= 0) return 'enemy-base-destroyed'
  if (ownHealth <= 0) return 'home-base-destroyed'
  return round >= CAMPAIGN_ROUND_LIMIT ? 'deadline' : undefined
}

function visibleTimes(result: RoundResult, hostileId: string): Array<[number, number]> {
  return result.contactIntervals.filter(interval => interval.targetId === hostileId).map(interval => [interval.start, interval.end])
}
const recoveryNotices: Partial<Record<string, Pick<CombatEvent, 'tone' | 'title' | 'detail'>>> = {
  'no-reachable-recovery': { tone: 'danger', title: 'NO RECOVERY FIELD', detail: 'is holding because no operational airfield is within reach.' },
  'fuel-reserve': { tone: 'warning', title: 'FUEL RESERVE RTB', detail: 'turns back to preserve fuel for landing.' },
  'fuel-exhaustion': { tone: 'danger', title: 'FORMATION LOST', detail: 'ran out of fuel before landing.' },
}

function projectResult(result: RoundResult, ownIds: Set<string>, opponentIds: Set<string>, input: MatchState,
  sightings: GroundSiteSighting[], refreshed: Set<string>): RoundResult {
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
  const strikes = result.combatSequences.filter(sequence=>sequence.kind==='strike').flatMap(sequence=>sequence.exchanges)
  const opponentStrikeHealth = new Map(strikes.filter(shot=>hasOwn(shot.attackerId)&&hasOpponent(shot.defenderId)&&shot.hit)
    .map(shot=>[localId(shot.defenderId),shot.targetStrength]))
  for(const effect of result.weaponEffects.filter(effect=>(effect.kind==='bomb'||effect.kind==='air-to-ground-missile')&&effect.hit&&hasOwn(effect.sourceId)&&hasOpponent(effect.targetId))){
    const target=result.assets.find(asset=>localId(asset.id)===localId(effect.targetId))
    if(target)opponentStrikeHealth.set(localId(effect.targetId),target.health)
  }
  const knownAssets = observedEnemyAssets(input.enemyAssets,result.assets,refreshed,opponentStrikeHealth)
  const groundReplay = {
    friendlyAtStart: clone(input.playerAssets),
    knownEnemyAtStart: clone(input.enemyAssets.filter(asset=>!asset.hidden&&asset.intel!=='unknown')),
    enemySightings: sightings.map(({asset,...window})=>({...window,asset:{...clone(asset),id:opponentId(localId(asset.id)),basedFormationIds:undefined}})),
  }
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
  for (const effect of result.weaponEffects.filter(item => (item.kind === 'air-to-ground-missile' || item.kind === 'bomb') && hasOwn(item.sourceId) && knownAssetIds.has(item.targetId))) {
    const squadron = ownResultSquadrons.find(item => item.id === ownId(effect.sourceId))
    const target = knownAssets.find(asset => asset.id === effect.targetId)
    if (squadron) events.push({ id: `strike-${effect.sourceId}-${Math.round(effect.start * 20)}`, time: effect.start, tone: 'friendly',
      title: effect.kind === 'bomb' ? 'BOMB RELEASED' : 'GROUND STRIKE LAUNCHED',
      detail: effect.kind === 'bomb' ? `${squadron.callsign} releases a bomb on confirmed ${target?.kind ?? 'ground'} coordinates.` : `${squadron.callsign} releases an air-to-ground missile.`, position: effect.from })
  }
  // Reconstruct notices only from this seat’s own flight tracks.
  for (const interval of result.behaviorIntervals) {
    if (!hasOwn(interval.unitId)) continue
    const message = recoveryNotices[interval.reason]
    if (!message) continue
    const formation = ownResultSquadrons.find(item => item.id === ownId(interval.unitId))
    if (!formation) continue
    const track = ownTracks.find(item => item.unitId === interval.unitId)
    const frame = track?.frames.find(frame => frame.time >= interval.start - .001)
    events.push({
      id: `recovery-${interval.id}`, time: interval.start, position: frame?.position,
      tone: message.tone, title: message.title, detail: `${formation.callsign} ${message.detail}`,
    })
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
      authorizedFrame(effect.sourceId, effect.start) || effect.kind === 'bomb' || effect.kind === 'air-to-ground-missile')) ||
    (hasOwn(effect.sourceId) && (knownAssetIds.has(effect.targetId) || authorizedFrame(effect.targetId, effect.start))))
    .map((effect, index) => {
      const authorizedSource=hasOwn(effect.sourceId)||knownAssetIds.has(effect.sourceId)||authorizedFrame(effect.sourceId,effect.start)
      let to = clone(effect.to)
      if (hasOpponent(effect.targetId)) {
        const lastVisible = contactTracks.find(track => track.unitId === ownId(effect.targetId))?.frames.filter(frame => frame.time <= effect.end).at(-1)
        if (lastVisible) to = clone(lastVisible.position)
      }
      // A bomb or ground missile striking an owned site may be shown as an
      // impact without exposing an undetected launch point or aircraft ID.
      const from=authorizedSource?clone(effect.from):to
      const sourceId=authorizedSource?ownId(effect.sourceId):'hostile-aircraft'
      return { ...clone(effect), id: `replay-effect-${Math.round(effect.start * 20)}-${sourceId}-${ownId(effect.targetId)}-${index}`,
        sourceId, targetId: ownId(effect.targetId), from, to }
    })
  // An own battery's flash is public to its operator even when the target has
  // no authorized track. Strip the target identity, trajectory and outcome.
  const ownAaaLaunches = result.weaponEffects.filter(effect =>
    effect.kind === 'aaa' && inputOwnAssets.has(localId(effect.sourceId)) && hasOwn(effect.sourceId)
    && !authorizedFrame(effect.targetId, effect.start))
    .map((effect, index) => ({
      id: `aaa-launch-${index}`, kind: 'aaa' as const, sourceId: ownId(effect.sourceId),
      targetId: 'untracked-aircraft', from: clone(effect.from), to: clone(effect.from),
      start: effect.start, end: effect.start, hit: false, damage: 0, launchOnly: true as const,
    }))
  const recovery = result.recoveryOutcomes.filter(item => hasOwn(item.formationId)).map(item => ({ ...clone(item),
    formationId: ownId(item.formationId), launchFieldId: localId(item.launchFieldId), plannedFieldId: localId(item.plannedFieldId), actualFieldId: item.actualFieldId ? localId(item.actualFieldId) : undefined,
  }))
  return {
    ...clone(result), cpuReport: undefined, groundReplay, squadrons: ownResultSquadrons, assets: knownAssets, playerAssets: ownAssets,
    unitTracks: tracks, enemyFlights: ownFlights, executionRoutes: Object.fromEntries(tracks.map(track => [track.unitId, track.frames.map(frame => clone(frame.position))])),
    contactIntervals: visibleIntervals.map(item => ({ ...clone(item), observerId: ownId(item.observerId), targetId: ownId(item.targetId) })),
    behaviorIntervals: result.behaviorIntervals.filter(item => hasOwn(item.unitId)).map(item => ({ ...clone(item), unitId: ownId(item.unitId), targetId: item.targetId && authorizedParticipant(item.targetId, item.start) ? ownId(item.targetId) : undefined })),
    events, lessons: [], combatSequences: sequences, activeDogfights: undefined, weaponEffects: [...effects, ...ownAaaLaunches],
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
      label: income.base > LOGISTICS_EFFECTS.baseIncome ? 'ROUND PAY · SUPPLY DEPOT' : 'ROUND PAY', source: 'round-income' },
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
  for (const report of b.enemyAssets.filter(asset=>asset.intel==='confirmed'&&!asset.hidden&&asset.health>0)) {
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
  const aProjection = projectResult(raw, aSeed, bSeed, a, raw.cpuReport?.groundSightings?.[0]??[],
    new Set(raw.cpuReport?.recoveredFriendlySiteIds?.map(localId)??[]))
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
    upgrades: clone(report.upgrades ?? []), operational: report.operational,
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
  const bProjection = projectResult(reverse, bSeed, bOpponents, b, raw.cpuReport?.groundSightings?.[1]??[], new Set(reportedAssets.map(asset=>localId(asset.id))))
  const bResult = {
    ...bProjection,
    logisticsIncome: sideIncome(b, bProjection.enemyLosses, bProjection.intelReports),
  }
  const aResultWithRound = { ...aResult, round: a.round }
  const bResultWithRound = { ...bResult, round: b.round }
  const aOwnAssets = raw.playerAssets.map(asset => clone(asset))
  const aHealth = aOwnAssets.find(asset => asset.kind === 'base')?.health ?? 0
  const bHealth = bSettledAssets.find(asset => asset.kind === 'base')?.health ?? 0
  const aOutcome = outcomeFor(aHealth, bHealth, a.round)
  const bOutcome = outcomeFor(bHealth, aHealth, b.round)
  const aState = projectSeat(a, aResult.assets, aOwnAssets, aFormations, aResultWithRound, aOutcome)
  const bState = projectSeat(b,
    bResult.assets, bSettledAssets, bFormations, bResultWithRound, bOutcome)
  return [aState, bState]
}
