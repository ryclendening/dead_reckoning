import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, FastForward, Map as MapIcon, RotateCcw, ShieldCheck, Zap } from 'lucide-react'
import { Battlefield } from './components/Battlefield'
import { CampaignSetupPanel } from './components/CampaignSetupPanel'
import { AdaptPanel, type ProcurementMode } from './components/AdaptPanel'
import { KnownWorldMap } from './components/KnownWorldMap'
import { CampaignBriefing } from './components/CampaignBriefing'
import { CommandShelf, ExecutionChitRail, FormationDock, ObserveEventFeed, TopBar, type PlanningRosterMode, type PlanningStep } from './components/Hud'
import { createCampaignDraft } from './game/data'
import { campaignOutcome, confirmedStrikeTarget, isCampaign } from './game/campaign'
import { placeInitialAsset } from './game/campaignPlacement'
import { confirmCampaignSetup, validateCampaignAllocation } from './game/campaignSetup'
import { applyRound, createRoundSimulation, EXECUTION_SECONDS, MAX_FLIGHT_DISTANCE, missionDistance, resolveRound, TICK_SECONDS, type RoundSimulationController } from './game/engine'
import { beginNextRound, economyAttentionTargets, executeEconomyCommand, openAdaptPhase, PROCUREMENT_CATALOG, validateAssetPlacement } from './game/economy'
import { snapToHex } from './game/hex'
import { deriveKnownWorldModel } from './game/knownWorld'
import { formationBaseGroups, formationBaseId } from './game/formationBasing'
import { deriveRecoveryPlanningView, formationField, routeToRecoveryField, snapRouteToRecoveryField, validateRecoveryPackage } from './game/forwardBasing'
import { buildBaseStrikeRoute, generateRouteTemplate, validateBaseStrikeOrder } from './game/routeTemplates'
import { normalizeMatch } from './game/persistence'
import { escortCoverageLabel, estimateEscortCoverage, protectTargetSelectionFor } from './game/missionResponsibility'
import { missionOrderDebrief } from './game/missionDebrief'
export { normalizeMatch }
import { viablePlanningFormationIds } from './game/planningQueue'
import { projectFriendlyUnitAt, projectHostileUnitAt } from './game/executionProjection'
import {createScenario} from './game/scenarios'
import { deriveKnownEnvelope, derivePlanningEnvelope } from './game/world'
import { friendlyTerritoryForAssets } from './game/territory'
import type { Asset, CombatEvent, DebugScenario, EconomyActionId, EconomyCommand, EconomyTarget, MatchState, MissionId, Point, RoundResult, SimulationCommand, Squadron } from './game/types'

const SAVE_KEY='dead-reckoning-mvp-v27'
const LEGACY_SAVE_KEYS=['dead-reckoning-mvp-v26','dead-reckoning-mvp-v25','dead-reckoning-mvp-v24','dead-reckoning-mvp-v23','dead-reckoning-mvp-v22','dead-reckoning-mvp-v21','dead-reckoning-mvp-v20','dead-reckoning-mvp-v19','dead-reckoning-mvp-v18','dead-reckoning-mvp-v17','dead-reckoning-mvp-v16','dead-reckoning-mvp-v15','dead-reckoning-mvp-v14','dead-reckoning-mvp-v13','dead-reckoning-mvp-v12','dead-reckoning-mvp-v11','dead-reckoning-mvp-v10','dead-reckoning-mvp-v9']
function loadMatch():MatchState{try{const saved=localStorage.getItem(SAVE_KEY);if(!saved)return createCampaignDraft();return normalizeMatch(JSON.parse(saved) as MatchState)}catch{return createCampaignDraft()}}
export default function App(){
  const [match,setMatch]=useState<MatchState>(loadMatch)
  const [progress,setProgress]=useState(0)
  const [speed,setSpeed]=useState<1|2>(1)
  const speedRef=useRef<1|2>(1)
  const [activeEvent,setActiveEvent]=useState<CombatEvent>()
  const [followId,setFollowId]=useState<string>()
  const [executionBaseId,setExecutionBaseId]=useState<string>()
  const [focusPoint,setFocusPoint]=useState<Point>()
  const [routeNotice,setRouteNotice]=useState<string>()
  const [planningStep,setPlanningStep]=useState<PlanningStep>('idle')
  const [selectingProtectTarget,setSelectingProtectTarget]=useState(false)
  const [planningBaseId,setPlanningBaseId]=useState('p-base')
  const [planningRosterMode,setPlanningRosterMode]=useState<PlanningRosterMode>('closed')
  const [reviewedIds,setReviewedIds]=useState<Set<string>>(()=>new Set())
  const [placementId,setPlacementId]=useState('p-base')
  const [worldMapOpen,setWorldMapOpen]=useState(false)
  const [economyTarget,setEconomyTarget]=useState<EconomyTarget>({kind:'asset',id:'p-base'})
  const [procurementMode,setProcurementMode]=useState<ProcurementMode>('closed')
  const [procurementActionId,setProcurementActionId]=useState<EconomyActionId>()
  const [procurementPlacement,setProcurementPlacement]=useState<Point>()
  const resultRef=useRef<ReturnType<typeof resolveRound>|undefined>(undefined)
  const simulationRef=useRef<RoundSimulationController|undefined>(undefined)
  const pendingCommandsRef=useRef<SimulationCommand[]>([])
  const [liveResult,setLiveResult]=useState<RoundResult>()
  const [acknowledgedThreatIds,setAcknowledgedThreatIds]=useState<Set<string>>(()=>new Set())
  const completingRef=useRef(false)
  useEffect(()=>{speedRef.current=speed},[speed])
  useEffect(()=>localStorage.setItem(SAVE_KEY,JSON.stringify(match)),[match])
  const selected=match.squadrons.find(s=>s.id===match.selectedId) ?? match.squadrons[0]
  const campaign=isCampaign(match)
  const strikeTarget=campaign?confirmedStrikeTarget(match):undefined
  const knownEnemyBaseHealth=strikeTarget?Math.min(strikeTarget.health,liveResult?.assets.find(asset=>asset.id===strikeTarget.id&&asset.kind==='base'&&!asset.hidden)?.health??strikeTarget.health):undefined
  const liveHomeHealth=liveResult?.playerAssets.find(asset=>asset.kind==='base')?.health??match.playerAssets.find(asset=>asset.kind==='base')?.health??match.playerBaseHealth
  const intel=match.enemyAssets.filter(a=>a.intel!=='unknown').length
  const playerBase=match.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]
  const friendlyTerritory=useMemo(()=>friendlyTerritoryForAssets(match.world.friendlyTerritory,match.playerAssets),[match.playerAssets,match.world.friendlyTerritory])
  const knownEnvelope=useMemo(()=>deriveKnownEnvelope(match.world,match.mappedAreas,match.discoveredBoundaries,friendlyTerritory),[friendlyTerritory,match.discoveredBoundaries,match.mappedAreas,match.world])
  const planningEnvelope=useMemo(()=>derivePlanningEnvelope(knownEnvelope),[knownEnvelope])
  const knownWorld=useMemo(()=>deriveKnownWorldModel({mappedAreas:match.mappedAreas,friendlyTerritory,friendlyAssets:match.playerAssets,enemyAssets:match.enemyAssets,discoveredBoundaries:match.discoveredBoundaries}),[friendlyTerritory,match.discoveredBoundaries,match.enemyAssets,match.mappedAreas,match.playerAssets])
  const planningBaseGroups=useMemo(()=>formationBaseGroups(match.squadrons,match.playerAssets),[match.playerAssets,match.squadrons])
  const activePlanningBaseId=planningBaseGroups.some(group=>group.base.id===planningBaseId)?planningBaseId:planningBaseGroups[0]?.base.id??'p-base'
  const viableFormationIds=useMemo(()=>viablePlanningFormationIds(match.squadrons),[match.squadrons])
  const reviewedCount=viableFormationIds.reduce((total,id)=>total+Number(reviewedIds.has(id)),0)
  const selectedLaunchField=formationField(planningBaseGroups.map(group=>group.base),selected.id)??match.playerAssets.find(asset=>asset.kind==='base')
  const recoveryView=useMemo(()=>deriveRecoveryPlanningView(match,selected.id,selected.route,MAX_FLIGHT_DISTANCE[selected.role]),[match,selected])
  const routeAdjustmentNotice=(adjustment:ReturnType<typeof generateRouteTemplate>['adjustment'])=>adjustment==='ingress-clamped'?'ROUTE CLAMPED AT THE KNOWN MAP LIMIT':adjustment==='pattern-shrunk'?'ON-STATION PATTERN REDUCED TO FIT FUEL':adjustment==='ingress-shortened'?'INGRESS ROUTE SHORTENED TO PRESERVE RETURN FUEL':undefined

  const setRoute=useCallback((ingress:Point[])=>{
    const squadron=match.squadrons.find(s=>s.id===match.selectedId)??match.squadrons[0]
    const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const withOrigin=ingress.length ? [[...launch] as Point,...ingress.slice(1)] : [[...launch] as Point]
    if(squadron.mission==='defensive-cap'&&selectingProtectTarget&&withOrigin.length>1){
      const protectedPoint=withOrigin.at(-1)!
      const generated=generateRouteTemplate({template:squadron.mission,ingress:withOrigin,maxDistance:MAX_FLIGHT_DISTANCE[squadron.role],bounds:planningEnvelope})
      setRouteNotice('PROTECTING MAP POINT · COVERAGE CIRCLE SET')
      setSelectingProtectTarget(false)
      setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
      setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,protectedPoint:[...protectedPoint] as Point,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}:s)}))
      return
    }
    if(squadron.mission==='base-strike'){
      setRouteNotice(undefined)
      setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
      setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,route:withOrigin,routeIngress:withOrigin,plannedRecoveryFieldId:undefined}:s)}))
      return
    }
    const generated=generateRouteTemplate({template:squadron.mission,ingress:withOrigin,maxDistance:MAX_FLIGHT_DISTANCE[squadron.role],bounds:planningEnvelope})
    setRouteNotice(routeAdjustmentNotice(generated.adjustment))
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next});setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,route:generated.route,routeIngress:generated.ingress,protectedPoint:s.mission==='defensive-cap'&&!s.protectedTargetId&&generated.ingress.length>1?[...generated.ingress.at(-1)!] as Point:s.protectedPoint,plannedRecoveryFieldId:undefined}:s)}))
  },[match,planningEnvelope,playerBase,selectingProtectTarget])
  const routeToAirfield=useCallback((fieldId:string,direct=false)=>{
    const field=match.playerAssets.find(asset=>asset.id===fieldId&&(asset.kind==='base'||asset.kind==='fob'))
    const squadron=match.squadrons.find(item=>item.id===match.selectedId)
    if(!field||!squadron)return
    setSelectingProtectTarget(protectTargetSelectionFor('exit'))
    const ingress=routeToRecoveryField(match,squadron.id,fieldId,direct)
    if(!ingress){setRouteNotice('RECOVERY AIRFIELD IS UNAVAILABLE');return}
    const view=deriveRecoveryPlanningView(match,squadron.id,ingress,MAX_FLIGHT_DISTANCE[squadron.role])
    setRouteNotice(view?.valid?`${squadron.role==='fighter'?'TRANSIT':'RECOVERY'} ROUTE SET TO ${field.name??(field.kind==='base'?'HOME BASE':'FOB')} · CONFIRM ORDERS`:view?.reason??'RECOVERY ROUTE IS NOT VALID')
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
    setMatch(state=>({...state,squadrons:state.squadrons.map(item=>item.id===squadron.id?{...item,mission:item.role==='fighter'?'transit':item.mission,route:ingress,routeIngress:ingress,plannedRecoveryFieldId:undefined}:item)}))
  },[match])
  const selectMission=useCallback((mission:MissionId)=>{
    const squadron=match.squadrons.find(s=>s.id===match.selectedId)??match.squadrons[0]
    if(mission==='base-strike'){
      setSelectingProtectTarget(protectTargetSelectionFor('mission',mission))
      const route=buildBaseStrikeRoute(match,squadron.id)
      if(!route){setRouteNotice(confirmedStrikeTarget(match)?'NO LEGAL STRIKE INGRESS FROM THIS FIELD':'CONFIRM THE ENEMY BASE BEFORE STRIKING');return}
      setRouteNotice(undefined)
      setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
      setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,mission,route,routeIngress:route,plannedRecoveryFieldId:undefined}:s)}))
      setPlanningStep('route')
      return
    }
    const base=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const existing=squadron.routeIngress.length>=2?squadron.routeIngress:squadron.route.length>=2?squadron.route:[base]
    const ingress:[[number,number],...Point[]]=[[...base],...existing.slice(1)]
    const generated=generateRouteTemplate({template:mission,ingress,maxDistance:MAX_FLIGHT_DISTANCE[squadron.role],bounds:planningEnvelope})
    const protect=mission==='defensive-cap'
    setSelectingProtectTarget(false)
    setRouteNotice(routeAdjustmentNotice(generated.adjustment))
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
    setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,mission,protectedPoint:protect&&generated.ingress.length>1?[...generated.ingress.at(-1)!] as Point:undefined,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}:s)}))
    setPlanningStep('route')
  },[match,planningEnvelope,playerBase])
  const placeAsset=useCallback((id:string,position:Point)=>setMatch(m=>{
    const placed=placeInitialAsset(m,id,position)
    if(placed===m)return m
    if(m.setup)return placed
    const oldBase=m.playerAssets.find(a=>a.kind==='base')?.position??m.world.friendlyTerritory.center
    const nextBase=placed.playerAssets.find(a=>a.kind==='base')?.position??oldBase
    const reposition=(route:Point[])=>route.map((p,i)=>i===0||i===route.length-1&&Math.hypot(p[0]-oldBase[0],p[1]-oldBase[1])<.3?nextBase:p)
    return id==='p-base'?{...placed,squadrons:placed.squadrons.map(s=>({...s,route:reposition(s.route),routeIngress:reposition(s.routeIngress)}))}:placed
  }),[])
  const advanceCampaignSetup=useCallback(()=>setMatch(m=>{if(!m.setup)return m;if(m.setup.stage==='allocate'&&validateCampaignAllocation(m,m.setup).length===0)return {...m,setup:{...m.setup,stage:'place'}};if(m.setup.stage==='place'&&m.setup.placedAssetIds.length===m.setup.selectedAssetIds.length)return {...m,setup:{...m.setup,stage:'review'}};if(m.setup.stage==='review')return confirmCampaignSetup(m);return m}),[])
  const commit=(includeSelectedRoute=false)=>{
    const orderedIds=new Set(reviewedIds)
    let source=match
    if(includeSelectedRoute){
      const view=deriveRecoveryPlanningView(match,selected.id,selected.route,MAX_FLIGHT_DISTANCE[selected.role])
      if(selected.aircraft<=0||selected.status==='trapped'||!view?.valid){setRouteNotice(view?.reason??'FORMATION CANNOT LAUNCH');return}
      const candidate={...selected,route:view.normalizedRoute,plannedRecoveryFieldId:view.intendedField.id}
      const strikeError=validateBaseStrikeOrder(match,candidate)
      if(strikeError){setRouteNotice(strikeError);return}
      if(candidate.mission==='defensive-cap'&&candidate.protectedTargetId&&!reviewedIds.has(candidate.protectedTargetId)){setRouteNotice('ESCORT TARGET MUST HAVE A CONFIRMED ORDER FIRST');return}
      source={...match,squadrons:match.squadrons.map(item=>item.id===candidate.id?candidate:item)}
      orderedIds.add(candidate.id)
    }
    const orderedMatch={...source,squadrons:source.squadrons.map(s=>({...s,sortieOrdered:orderedIds.has(s.id),plannedRecoveryFieldId:orderedIds.has(s.id)?s.plannedRecoveryFieldId:undefined}))}
    const validation=validateRecoveryPackage(orderedMatch,MAX_FLIGHT_DISTANCE,orderedIds)
    const strikeError=orderedMatch.squadrons.filter(s=>orderedIds.has(s.id)).map(s=>validateBaseStrikeOrder(orderedMatch,s)).find(Boolean)
    const escortError=orderedMatch.squadrons.filter(s=>orderedIds.has(s.id)&&s.mission==='defensive-cap'&&s.protectedTargetId).map(s=>{const target=orderedMatch.squadrons.find(item=>item.id===s.protectedTargetId);if(!target||!orderedIds.has(target.id))return 'ESCORT TARGET MUST HAVE A CONFIRMED ORDER';const coverage=escortEstimateFor(s,target);return !coverage.recoveryFeasible||coverage.percent<30?`ESCORT COVERAGE TOO LOW · ${coverage.percent}% PREDICTED · CHECK ROUTE AND RECOVERY`:undefined}).find(Boolean)
    if(!orderedIds.size||!validation.valid||strikeError||escortError){setRouteNotice(strikeError??escortError??validation.reason??'PLAN AT LEAST ONE FORMATION');return}
    const simulation=createRoundSimulation(orderedMatch);simulationRef.current=simulation;resultRef.current=simulation.result;pendingCommandsRef.current=[];completingRef.current=false;setLiveResult(simulation.result);setAcknowledgedThreatIds(new Set());setProgress(1);setActiveEvent(undefined);setFollowId(match.selectedId);setExecutionBaseId(formationBaseId(planningBaseGroups,match.selectedId)??activePlanningBaseId);setFocusPoint(undefined);setMatch({...orderedMatch,phase:'execute'})
  }
  useEffect(()=>{
    const simulation=simulationRef.current;if(match.phase!=='execute'||!simulation)return
    let frame=0,last=performance.now(),accumulator=0,completionTimer:number|undefined
    const tick=(now:number)=>{accumulator+=(now-last)*speedRef.current;last=now;let advanced=false;while(accumulator>=TICK_SECONDS*1000&&!simulation.complete){const commands=pendingCommandsRef.current.splice(0);const result=simulation.advance(commands);resultRef.current=result;accumulator-=TICK_SECONDS*1000;advanced=true}if(advanced){setLiveResult(simulation.result);setActiveEvent(simulation.result.events.filter(event=>event.time<=simulation.result.duration).at(-1))}if(simulation.complete){if(!completingRef.current){completingRef.current=true;completionTimer=window.setTimeout(()=>setMatch(current=>current.phase==='execute'?applyRound(current,simulation.result):current),1250)}return}frame=requestAnimationFrame(tick)}
    frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);if(completionTimer!==undefined)clearTimeout(completionTimer)}
  },[match.phase])

  const closeProcurement=()=>{setProcurementMode('closed');setProcurementActionId(undefined);setProcurementPlacement(undefined)}
  const enterAdapt=()=>{const next=openAdaptPhase(match);const first=economyAttentionTargets(next)[0]??{kind:'asset' as const,id:'p-base'};setWorldMapOpen(false);setFollowId(undefined);setExecutionBaseId(undefined);closeProcurement();setEconomyTarget(first);setFocusPoint(first.kind==='asset'?next.playerAssets.find(asset=>asset.id===first.id)?.position:playerBase);setMatch(next)}
  const nextRound=()=>{simulationRef.current=undefined;pendingCommandsRef.current=[];setLiveResult(undefined);setAcknowledgedThreatIds(new Set());setWorldMapOpen(false);setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined);setRouteNotice(undefined);setPlanningStep('idle');setReviewedIds(new Set());setPlanningBaseId('p-base');setPlanningRosterMode('closed');closeProcurement();setMatch(beginNextRound)}
  const resetPlanningUi=()=>{simulationRef.current=undefined;pendingCommandsRef.current=[];setLiveResult(undefined);setAcknowledgedThreatIds(new Set());setWorldMapOpen(false);setProgress(0);setActiveEvent(undefined);setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined);setRouteNotice(undefined);setPlanningStep('idle');setPlanningBaseId('p-base');setPlanningRosterMode('closed');setReviewedIds(new Set());closeProcurement()}
  const selectScenario=(scenario:DebugScenario)=>{resetPlanningUi();setEconomyTarget({kind:'asset',id:'p-base'});setMatch(createScenario(scenario))}
  const restart=()=>{localStorage.removeItem(SAVE_KEY);for(const key of LEGACY_SAVE_KEYS)localStorage.removeItem(key);resetPlanningUi();setEconomyTarget({kind:'asset',id:'p-base'});setMatch(m=>m.debugScenario&&m.debugScenario!=='campaign'?createScenario(m.debugScenario):createCampaignDraft())}
  const selectFormation=(id:string)=>{setAcknowledgedThreatIds(current=>{const next=new Set(current);for(const alert of liveResult?.threatAlerts??[])if(alert.unitId===id)next.add(alert.id);return next});setFollowId(id);setFocusPoint(undefined);setMatch(m=>({...m,selectedId:id}))}
  const selectProtectAsset=(id:string)=>{const asset=match.playerAssets.find(item=>item.id===id);const squadron=match.squadrons.find(item=>item.id===match.selectedId);if(!asset||!squadron||!selectingProtectTarget)return;const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase;const generated=generateRouteTemplate({template:'defensive-cap',ingress:[[...launch] as Point,[...asset.position] as Point],maxDistance:MAX_FLIGHT_DISTANCE.fighter,bounds:planningEnvelope});const station=generated.ingress.at(-1);if(!station||Math.hypot(station[0]-asset.position[0],station[1]-asset.position[1])>.1){setRouteNotice('SITE OUT OF REACH · CHOOSE A CLOSER PROTECTION POINT');return}setSelectingProtectTarget(false);setRouteNotice(`PROTECTING ${asset.name??asset.kind.toUpperCase()} · COVERAGE CIRCLE SET`);setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next});setMatch(state=>({...state,squadrons:state.squadrons.map(item=>item.id===squadron.id?{...item,protectedPoint:[...asset.position] as Point,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}:item)}))}
  const selectProtectPoint=(point:Point)=>{const squadron=match.squadrons.find(item=>item.id===match.selectedId);if(!selectingProtectTarget||!squadron)return;const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase;const generated=generateRouteTemplate({template:'defensive-cap',ingress:[[...launch] as Point,[...point] as Point],maxDistance:MAX_FLIGHT_DISTANCE.fighter,bounds:planningEnvelope});const station=generated.ingress.at(-1);if(!station||Math.hypot(station[0]-point[0],station[1]-point[1])>.1){setRouteNotice('POINT OUT OF REACH · CHOOSE A CLOSER PROTECTION POINT');return}setSelectingProtectTarget(false);setRouteNotice('PROTECTING MAP POINT · COVERAGE CIRCLE SET');setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next});setMatch(state=>({...state,squadrons:state.squadrons.map(item=>item.id===squadron.id?{...item,protectedPoint:[...point] as Point,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}:item)}))}
  const escortEstimateFor=(escort:Squadron,target:Squadron)=>{
    const launch=formationField(match.playerAssets,escort.id),targetLaunch=formationField(match.playerAssets,target.id)
    const escortRecovery=match.playerAssets.find(asset=>asset.id===escort.plannedRecoveryFieldId)??launch
    const targetRecovery=match.playerAssets.find(asset=>asset.id===target.plannedRecoveryFieldId)??targetLaunch
    if(!launch||!escortRecovery||!targetLaunch||!targetRecovery)return {percent:0,fullyCovered:false,recoveryFeasible:false}
    const targetRoute=target.route.at(-1)&&Math.hypot(target.route.at(-1)![0]-targetRecovery.position[0],target.route.at(-1)![1]-targetRecovery.position[1])<.03?target.route:[...target.route,[...targetRecovery.position] as Point]
    return estimateEscortCoverage({escortRoute:[launch.position],protectedRoute:targetRoute,escortSpeed:MAX_FLIGHT_DISTANCE.fighter/EXECUTION_SECONDS,protectedSpeed:MAX_FLIGHT_DISTANCE[target.role]/EXECUTION_SECONDS,recoveryPoint:escortRecovery.position,maxDistance:MAX_FLIGHT_DISTANCE.fighter})
  }
  const confirmPlanningOrder=(squadron:Squadron):boolean=>{
    const view=deriveRecoveryPlanningView(match,squadron.id,squadron.route,MAX_FLIGHT_DISTANCE[squadron.role])
    if(squadron.aircraft<=0||squadron.status==='trapped'||!view?.valid){setRouteNotice(view?.reason??'FORMATION CANNOT LAUNCH');return false}
    const reviewedSquadron={...squadron,route:view.normalizedRoute}
    if(reviewedSquadron.mission==='defensive-cap'&&reviewedSquadron.protectedTargetId){const target=match.squadrons.find(item=>item.id===reviewedSquadron.protectedTargetId);if(!target||!reviewedIds.has(target.id)){setRouteNotice('ESCORT TARGET MUST HAVE A CONFIRMED ORDER FIRST');return false}const coverage=escortEstimateFor(reviewedSquadron,target);if(!coverage.recoveryFeasible||coverage.percent<30){setRouteNotice(`ESCORT COVERAGE TOO LOW · ${coverage.percent}% PREDICTED · CHECK ROUTE AND RECOVERY`);return false}}
    const strikeError=validateBaseStrikeOrder(match,reviewedSquadron)
    if(strikeError){setRouteNotice(strikeError);return false}
    setMatch(current=>({...current,squadrons:current.squadrons.map(item=>item.id===squadron.id?{...item,route:view.normalizedRoute,plannedRecoveryFieldId:view.intendedField.id}:item)}))
    setReviewedIds(current=>new Set(current).add(squadron.id))
    setRouteNotice(undefined)
    return true
  }
  const protectTarget=selected.protectedTargetId?match.squadrons.find(item=>item.id===selected.protectedTargetId):undefined
  const protectAsset=selected.protectedPoint?match.playerAssets.find(asset=>Math.hypot(asset.position[0]-selected.protectedPoint![0],asset.position[1]-selected.protectedPoint![1])<.01):undefined
  const protectCoverage=protectTarget?escortEstimateFor(selected,protectTarget):undefined
  const protectSummary=selected.mission==='defensive-cap'?(protectTarget?`${protectTarget.callsign} · ${escortCoverageLabel(protectCoverage?.percent??0)}`:selected.protectedPoint?`PROTECT ${protectAsset?.name??protectAsset?.kind.toUpperCase()??'ROUTE ENDPOINT'} · PURSUIT ENDS AT AREA EDGE`:undefined):undefined
  const selectProtectFlight=(id:string)=>{const squadron=match.squadrons.find(item=>item.id===match.selectedId);const target=match.squadrons.find(item=>item.id===id);if(!squadron||squadron.mission!=='defensive-cap'||!target||target.id===squadron.id||!reviewedIds.has(target.id)||target.aircraft<=0)return;const coverage=escortEstimateFor(squadron,target);if(!coverage.recoveryFeasible||coverage.percent<30){setRouteNotice(`NO USEFUL ESCORT COVERAGE · ${coverage.percent}% PREDICTED · RECOVERY NOT FEASIBLE`);return}const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase;const generated=generateRouteTemplate({template:'defensive-cap',ingress:[[...launch] as Point,[...target.route[0]] as Point],maxDistance:MAX_FLIGHT_DISTANCE.fighter,bounds:planningEnvelope});setSelectingProtectTarget(false);setRouteNotice(`${target.callsign} ESCORT · ${coverage.percent}% PREDICTED COVERAGE · ${100-coverage.percent}% UNCOVERED`);setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next});setMatch(state=>({...state,squadrons:state.squadrons.map(item=>item.id===squadron.id?{...item,protectedTargetId:target.id,protectedPoint:undefined,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}:item)}))}
  const orderRtb=(id:string)=>{const simulation=simulationRef.current;if(!simulation||simulation.complete)return;const issuedAtTick=simulation.nextTick();if(pendingCommandsRef.current.some(command=>command.unitId===id&&command.type==='rtb')||(simulation.result.simulationCommands??[]).some(command=>command.unitId===id&&command.type==='rtb'))return;pendingCommandsRef.current.push({id:`rtb-${match.round}-${id}-${issuedAtTick}`,unitId:id,type:'rtb',issuedAtTick})}
  const selectPlanningFormation=(id:string)=>{
    if(id===selected.id)return
    if(planningStep==='route'&&selected.route.length>=2&&!selectingProtectTarget&&!confirmPlanningOrder(selected))return
    const target=match.squadrons.find(s=>s.id===id)
    if(!target)return
    const alreadyPlanned=reviewedIds.has(id)
    setSelectingProtectTarget(false)
    setRouteNotice(undefined)
    const baseId=formationBaseId(planningBaseGroups,id)
    if(baseId)setPlanningBaseId(baseId)
    setPlanningRosterMode('closed')
    setPlanningStep(alreadyPlanned||target.role==='recon'?'route':'mission')
    if(!alreadyPlanned)setReviewedIds(ids=>{const next=new Set(ids);next.delete(id);return next})
    setMatch(m=>({...m,selectedId:id,squadrons:alreadyPlanned?m.squadrons:m.squadrons.map(s=>s.id===id?{...s,plannedRecoveryFieldId:undefined}:s)}))
  }
  const selectPlanningBase=(id:string)=>{if(!planningBaseGroups.some(group=>group.base.id===id))return;setPlanningBaseId(id);setPlanningRosterMode('closed');setPlanningStep('idle');setRouteNotice(undefined)}
  const selectExecutionBase=(id:string)=>{const base=match.playerAssets.find(asset=>asset.id===id&&(asset.kind==='base'||asset.kind==='fob'));if(!base)return;setExecutionBaseId(id);setFollowId(undefined);setFocusPoint(base.position)}
  const focusAirfield=()=>{const id=formationBaseId(planningBaseGroups,match.selectedId)??executionBaseId??'p-base';selectExecutionBase(id)}
  const focusEvent=(event:CombatEvent)=>{const target=match.squadrons.find(s=>event.detail.includes(s.callsign));if(target){setFollowId(target.id);setMatch(m=>({...m,selectedId:target.id}))}else setFollowId(undefined);if(event.position)setFocusPoint(event.position);setActiveEvent(event)}
  const selectEconomyTarget=(target:EconomyTarget)=>{setEconomyTarget(target);const point=target.kind==='asset'?match.playerAssets.find(asset=>asset.id===target.id)?.position:target.kind==='squadron'?match.playerAssets.find(asset=>asset.id===formationBaseId(planningBaseGroups,target.id))?.position:undefined;setFocusPoint(point)}
  const purchaseEconomy=(command:EconomyCommand)=>setMatch(state=>executeEconomyCommand(state,command))
  const changeProcurementMode=(mode:ProcurementMode)=>{setProcurementMode(mode);if(mode!=='placing')setProcurementPlacement(undefined);if(mode==='catalog')setProcurementActionId(undefined);if(mode==='closed'){setProcurementActionId(undefined);setEconomyTarget({kind:'asset',id:'p-base'})}}
  const selectProcurementAction=(actionId:EconomyActionId)=>{setProcurementActionId(actionId);setProcurementPlacement(undefined);setProcurementMode('placing');setEconomyTarget({kind:'campaign',id:'campaign'})}
  const procurementDefinition=PROCUREMENT_CATALOG.find(item=>item.actionId===procurementActionId)
  const validProcurementPoint=useCallback((point:Point)=>procurementDefinition?validateAssetPlacement(match,procurementDefinition.kind,point).valid:false,[match,procurementDefinition])

  return <main className="app-shell">
    <div className={`game-frame phase-${match.phase} ${planningStep!=='idle'||match.phase==='execute'&&executionBaseId?'shelf-open chit-queue-open':''} ${planningStep==='route'?'route-step-open':''} ${planningRosterMode!=='closed'?'roster-open':''}`}>
      <TopBar round={match.round} intel={intel} logistics={match.logistics} replacements={match.replacements} score={match.campaignScore??0} phase={match.phase} debugScenario={match.debugScenario??'campaign'} onDebugScenario={selectScenario} onReboot={restart}/>
      <div className="map-wrap"><Battlefield squadrons={match.squadrons} assets={match.enemyAssets} playerAssets={match.playerAssets} mappedAreas={match.mappedAreas} discoveredBoundaries={match.discoveredBoundaries} presentationBounds={match.world.presentationBounds} planningBounds={planningEnvelope} friendlyTerritory={friendlyTerritory} selectedId={match.selectedId} followId={followId} focusPoint={focusPoint} placementId={placementId} planningBaseId={activePlanningBaseId} executionBaseId={executionBaseId} planningRecoveryFieldId={match.phase==='plan'&&recoveryView&&selectedLaunchField&&recoveryView.intendedField.id!==selectedLaunchField.id?recoveryView.intendedField.id:undefined} plannedFormationIds={[...reviewedIds]} routeOrigin={selectedLaunchField?.position} routePlanningEnabled={planningStep==='route'} showMissionPreview={planningStep==='route'} selectingProtectTarget={selectingProtectTarget} escortPreview={protectTarget&&protectCoverage?{targetId:protectTarget.id,percent:protectCoverage.percent}:undefined} phase={match.phase} progress={progress} activeEvent={activeEvent} executionResult={match.phase==='execute'?liveResult:match.phase==='debrief'||match.phase==='adapt'?match.lastResult:undefined} packageReview={false} economySelectionId={economyTarget.kind==='asset'?economyTarget.id:undefined} onPlanningBaseSelect={selectPlanningBase} onPlanningFormationSelect={selectPlanningFormation} onPlanningProtectTarget={selectProtectAsset} onPlanningProtectPoint={selectProtectPoint} onPlanningProtectFlight={selectProtectFlight} onPlanningRecoverySelect={routeToAirfield} onExecutionBaseSelect={selectExecutionBase} onEconomySelect={id=>selectEconomyTarget({kind:'asset',id})} construction={match.phase==='adapt'&&procurementMode==='placing'&&procurementDefinition?{kind:procurementDefinition.kind,placement:procurementPlacement,isValid:validProcurementPoint,onStage:setProcurementPlacement}:undefined} onRoute={setRoute} onPlace={match.setup?.stage==='place'||!match.setup?placeAsset:()=>{}}/>
        {campaign&&(match.phase==='plan'||match.phase==='execute')?<CampaignBriefing match={match} target={strikeTarget} homeHealth={Math.round(liveHomeHealth)} enemyHealth={knownEnemyBaseHealth===undefined?undefined:Math.round(knownEnemyBaseHealth)}/>:null}
        {match.phase!=='deploy'?<button className="world-map-toggle" type="button" onClick={()=>setWorldMapOpen(true)}><MapIcon/> KNOWN WORLD</button>:null}
        {worldMapOpen?<div className="known-world-modal" role="dialog" aria-modal="true"><KnownWorldMap model={knownWorld} onClose={()=>setWorldMapOpen(false)}/></div>:null}
        {match.phase==='deploy'&&match.setup?.stage==='place'?<div className="map-tip deploy-tip"><span>TAP HEX</span> PLACE SELECTED ASSET · FRIENDLY TERRITORY ONLY</div>:null}
      {match.phase==='plan'&&planningStep==='idle'?<div className="map-tip"><span>TAP AIRFIELD</span> START FORMATION PLANNING</div>:null}
        {match.phase==='execute'?<ExecutionOverlay progress={progress} activeEvent={activeEvent} speed={speed} onSpeed={()=>setSpeed(s=>s===1?2:1)} match={match} result={liveResult} selectedId={match.selectedId} followId={followId} onSelectFormation={selectFormation} onClearFollow={()=>setFollowId(undefined)} onAirfield={focusAirfield} onEventFocus={focusEvent} onRtb={orderRtb}/>:null}
      </div>
      {match.phase==='execute'&&executionBaseId?<ExecutionChitRail squadrons={match.squadrons} bases={match.playerAssets} result={liveResult} progress={progress} activeBaseId={executionBaseId} selectedId={match.selectedId} followId={followId} threatenedIds={new Set((liveResult?.threatAlerts??[]).filter(alert=>!acknowledgedThreatIds.has(alert.id)).map(alert=>alert.unitId))} onSelect={selectFormation}/>:null}
      {match.phase==='deploy'&&match.setup?<CampaignSetupPanel match={match} placementId={placementId} onSelectPlacement={setPlacementId} onChange={setup=>setMatch(m=>({...m,setup}))} onContinue={advanceCampaignSetup}/>:match.phase==='deploy'?<DeploymentPanel assets={match.playerAssets} selectedId={placementId} onSelect={setPlacementId} onLock={()=>setMatch(m=>({...m,phase:'plan'}))}/>:null}
      {match.phase==='plan'?<CommandShelf squadrons={match.squadrons} bases={match.playerAssets} activeBaseId={activePlanningBaseId} rosterMode={planningRosterMode} squadron={selected} routeDistance={recoveryView?.missionDistance??missionDistance(selected.route,playerBase)} maxDistance={MAX_FLIGHT_DISTANCE[selected.role]} routeNotice={routeNotice} protectSummary={protectSummary} recoverySummary={recoveryView?.summary} onSelect={selectPlanningFormation} onBaseSelect={selectPlanningBase} onRosterMode={mode=>{setPlanningRosterMode(mode);if(mode!=='closed'){setPlanningStep('idle');setSelectingProtectTarget(false)}}} onMission={selectMission} onPickProtectTarget={()=>{setSelectingProtectTarget(true);setRouteNotice(undefined)}} onProtectFlight={selectProtectFlight} onRecoverHome={()=>routeToAirfield('p-base',true)} onClear={()=>{setRouteNotice(undefined);if(selectingProtectTarget)setSelectingProtectTarget(false);else setRoute([])}} onBack={()=>{setPlanningStep('mission');setSelectingProtectTarget(false);setRouteNotice(undefined)}} onCommit={commit} step={planningStep} onClose={()=>{if(planningStep==='route'&&selected.route.length>=2&&!selectingProtectTarget&&!confirmPlanningOrder(selected))return;setPlanningStep('idle');setSelectingProtectTarget(false)}} reviewedIds={reviewedIds} reviewedCount={reviewedCount} totalCount={viableFormationIds.length} campaign={campaign} strikeUnlocked={Boolean(strikeTarget)} strikeDisabledReason="RECOVER BASE INTELLIGENCE FIRST" selectingProtectTarget={selectingProtectTarget}/>:null}
      {match.phase==='debrief'&&match.lastResult?<Debrief match={match} onFocus={point=>{setFollowId(undefined);setFocusPoint([...point] as Point)}} onAdapt={enterAdapt}/>:null}
      {match.phase==='adapt'?<AdaptPanel match={match} selectedTarget={economyTarget} onSelectTarget={selectEconomyTarget} onPurchase={purchaseEconomy} onNextRound={nextRound} procurementMode={procurementMode} procurementActionId={procurementActionId} procurementPlacement={procurementPlacement} onProcurementMode={changeProcurementMode} onProcurementAction={selectProcurementAction}/>:null}
      {(match.phase==='victory'||match.phase==='defeat')?<EndState victory={match.phase==='victory'} round={match.round} outcome={campaignOutcome(match)} onRestart={restart}/>:null}
    </div>
  </main>
}

function DeploymentPanel({assets,selectedId,onSelect,onLock}:{assets:Asset[];selectedId:string;onSelect:(id:string)=>void;onLock:()=>void}){
  return <section className="deployment-panel"><div className="deployment-head"><div><small>PRE-MATCH DEPLOYMENT</small><h2>BUILD YOUR DECEPTION</h2></div><ShieldCheck/></div><p>Place the real base, decoy, sensors, and defenses. Overlap radar and weapon rings, but avoid revealing the real base through an obvious defensive cluster.</p><div className="asset-picker">{assets.map(a=><button key={a.id} className={a.id===selectedId?'active':''} onClick={()=>onSelect(a.id)}><b>{a.kind.toUpperCase()}</b><small>{a.kind==='base'?'PRIMARY':a.kind==='decoy'?'FALSE FIELD':a.kind==='radar'?'DETECT 6.4':a.kind==='sam'?'ENGAGE 3.2':'ENGAGE 1.9'}</small></button>)}</div><button className="commit" onClick={onLock}>LOCK DEPLOYMENT <span>››</span></button></section>
}

function ExecutionOverlay({progress,activeEvent,speed,onSpeed,match,result,selectedId,followId,onSelectFormation,onClearFollow,onAirfield,onEventFocus,onRtb}:{progress:number;activeEvent?:CombatEvent;speed:number;onSpeed:()=>void;match:MatchState;result?:RoundResult;selectedId:string;followId?:string;onSelectFormation:(id:string)=>void;onClearFollow:()=>void;onAirfield:()=>void;onEventFocus:(event:CombatEvent)=>void;onRtb:(id:string)=>void}){
  const seconds=progress*(result?.duration??22)
  const contacts=result?.enemyFlights.flatMap(flight=>{const projection=projectHostileUnitAt(result,flight.id,seconds);return projection?[projection]:[]})??[]
  const visual=contacts.some(contact=>contact.visibility==='visual')
  const cue=result?.defenseCues?.find(c=>progress>=c.start&&progress<=c.end)
  const recovering=match.squadrons.some(squadron=>projectFriendlyUnitAt(result,squadron.id,seconds)?.frame.mode==='recovering')
  return <div className="execute-hud"><div className="timer live" aria-label={`${seconds.toFixed(1)} seconds elapsed`}><i style={{width:`${Math.min(100,seconds/60*100)}%`}}/></div>{recovering||contacts.length?<div className={`contact-status ${contacts.length?'hot':''} ${visual?'visual':''}`}>{recovering?'RECOVERY IN PROGRESS':visual?`${contacts.length} VISUAL CONTACT${contacts.length===1?'':'S'}`:`${contacts.length} RADAR TRACK${contacts.length===1?'':'S'}`}</div>:null}{cue?<div className="cue-status"><ShieldCheck/> DEFENSE CUED · +{cue.rangeBonus.toFixed(1)} RANGE</div>:null}<ObserveEventFeed events={result?.events??[]} progress={progress} duration={result?.duration} onFocus={onEventFocus}/><FormationDock squadrons={match.squadrons} bases={match.playerAssets} result={result} progress={progress} selectedId={selectedId} followId={followId} onSelect={onSelectFormation} onClearFollow={onClearFollow} onAirfield={onAirfield} onRtb={onRtb}/>
    <div className="exec-controls"><button className="speed" onClick={onSpeed}><FastForward/>{speed}×</button></div></div>
}

export function Debrief({match,onFocus,onAdapt}:{match:MatchState;onFocus:(point:Point)=>void;onAdapt:()=>void}){
  const result=match.lastResult!
  const outcome=campaignOutcome(match)
  const message=outcome?campaignOutcomeMessage(outcome):undefined
  const intel=result.intelReports.filter(report=>report.recovered).map(report=>result.assets.find(asset=>asset.id===report.assetId)).filter((asset):asset is Asset=>!!asset)
  const losses=result.friendlyAttrition.filter(item=>item.aircraftLost>0)
  const orders=missionOrderDebrief(match,result)
  return <section className="debrief briefing debrief-summary" aria-label="After action summary">
    <header><div><small>MISSION COMPLETE</small><h2>AFTER ACTION</h2></div>{message?<strong className="debrief-outcome">{message.title}</strong>:null}</header>
    <div className="debrief-metrics"><div><strong>{result.friendlyLosses}</strong><span>FRIENDLY LOST</span></div><div><strong>{result.enemyLosses}</strong><span>ENEMY LOST</span></div><div><strong>{intel.length}</strong><span>INTEL RECOVERED</span></div><div><strong>+{result.logisticsIncome.total}</strong><span>LOGISTICS</span></div></div>
    {orders.length?<div className="debrief-orders" aria-label="Mission orders and results"><small>ORDERS & RESULTS</small>{orders.map(order=><p key={order.id}><b>{order.callsign} · {order.purpose}</b><span>{order.result}</span></p>)}</div>:null}
    {isCampaign(match)?<div className="debrief-campaign"><span>HOME BASE <b>{match.playerBaseHealth}%</b></span><span>EXPOSURE <b>{result.baseExposure}%</b></span>{result.enemyBaseDamage>0?<span>ENEMY BASE <b>−{result.enemyBaseDamage}</b></span>:null}</div>:null}
    {message?<p className="debrief-message">{message.message}</p>:null}
    {losses.length||intel.length?<details className="debrief-details"><summary>VIEW FORMATION & INTEL DETAILS</summary><div>{losses.map(item=><p key={item.id}>{item.callsign}: {item.startAircraft} → {item.endAircraft} AIRCRAFT · {item.endStrength}% STRENGTH</p>)}{intel.map(asset=><button key={asset.id} onClick={()=>onFocus(asset.position)}>NEW INTEL · {asset.kind.toUpperCase()} · FOCUS MAP</button>)}</div></details>:null}
    <button className="debrief-continue" onClick={onAdapt}>{message?'VIEW OUTCOME':'OPEN ADAPT'} <ChevronRight/></button>
  </section>
}

export function campaignOutcomeMessage(outcome:NonNullable<ReturnType<typeof campaignOutcome>>){
  switch(outcome){
    case 'enemy-base-destroyed':return{title:'ENEMY BASE DESTROYED',message:'Your strike destroyed the enemy base.'}
    case 'home-base-destroyed':return{title:'HOME BASE DESTROYED',message:'Enemy strikes destroyed your home base.'}
    case 'deadline':return{title:'DEADLINE REACHED',message:'The six-round campaign ended before the enemy base was destroyed.'}
    case 'forces-lost':return{title:'FORCES LOST',message:'All available formations and reserve aircraft have been lost.'}
  }
}

export function EndState({victory,round,outcome,onRestart}:{victory:boolean;round:number;outcome:ReturnType<typeof campaignOutcome>;onRestart:()=>void}){
  const title=outcome==='deadline'?'DEADLINE REACHED':outcome==='forces-lost'?'FORCES LOST':victory?'BREAKTHROUGH':'COMMAND LOST'
  const message=outcome?campaignOutcomeMessage(outcome).message:victory?'Enemy command aviation has been destroyed.':'Your home base has been rendered inoperable.'
  return <section className={`end-state ${victory?'win':'loss'}`}><div className="end-icon">{victory?<ShieldCheck/>:<AlertTriangle/>}</div><small>CAMPAIGN ENDED · ROUND {String(round).padStart(2,'0')}</small><h1>{title}</h1><p>{message}</p><button onClick={onRestart}><RotateCcw/> NEW CAMPAIGN</button></section>
}
