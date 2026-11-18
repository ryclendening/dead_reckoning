import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, FastForward, LocateFixed, Map as MapIcon, RotateCcw, ShieldCheck, Zap } from 'lucide-react'
import { Battlefield, type CameraPoseSnapshot } from './components/Battlefield'
import { AircraftInspector, AssetInspector } from './components/UnitInspector'
import { CampaignSetupPanel } from './components/CampaignSetupPanel'
import { CampaignMenu } from './components/CampaignMenu'
import { fetchOnlineMatch, OnlineInviteCode, OnlineRequestError, sendOnlineCommand } from './components/OnlineClient'
import type { CpuDifficulty } from './game/cpu/types'
import { ResupplyPanel, type ProcurementMode } from './components/ResupplyPanel'
import { KnownWorldMap } from './components/KnownWorldMap'
import { CampaignBriefing } from './components/CampaignBriefing'
import { CommandShelf, ContactTracks, ExecutionChitRail, FormationDock, ObserveEventFeed, TopBar, type PlanningRosterMode, type PlanningStep } from './components/Hud'
import { createCampaignDraft } from './game/data'
import { freshCampaignSeed } from './game/campaignLayout'
import { BASE_STRIKE_RANGE, campaignOutcome, confirmedStrikeTarget, groundStrikeTargets, isCampaign } from './game/campaign'
import { placeInitialAsset, validateInitialPlacement } from './game/campaignPlacement'
import { confirmCampaignSetup, validateCampaignAllocation, SETUP_REQUIRED_ASSET_IDS } from './game/campaignSetup'
import { applyRound, createRoundSimulation, EXECUTION_SECONDS, resolveRound, TICK_SECONDS, type RoundSimulationController } from './game/engine'
import { flightRangeFor } from './game/flightRules'
import { advanceToNextRound, beginNextRound, economyCommandForQuote, economyQuotesFor, executeEconomyCommand, openAdaptPhase, openAdaptPhaseImmediately, PROCUREMENT_CATALOG, validateAssetPlacement } from './game/economy'
import { formatCash, LOGISTICS_EFFECTS } from './game/economyRules'
import { snapToHex } from './game/hex'
import { deriveKnownWorldModel } from './game/knownWorld'
import { formationBaseGroups, formationBaseId } from './game/formationBasing'
import { deriveRecoveryPlanningView, deriveRouteBudget, formationField, isOperationalAirfield, MAX_RECOVERY_WAYPOINTS, routeDistanceForBasing, routeToRecoveryField, transitDestination, validateRecoveryPackage } from './game/forwardBasing'
import { buildGroundStrikeRoute, groundStrikeRoute, generateRouteTemplate, validateGroundStrikeOrder } from './game/routeTemplates'
import { normalizeMatch } from './game/persistence'
import { protectTargetSelectionFor } from './game/missionResponsibility'
import { isGroundStrikeTargeting, planGroundStrike } from './game/groundStrikePlanning'
import { aircraftInspectionAt } from './game/unitCards'
import { debriefMapSites, primaryDebriefEvent } from './game/debriefMap'
import { DebriefLegend, DebriefSymbol } from './components/DebriefSymbols'
import { missionOrderDebrief } from './game/missionDebrief'
export { normalizeMatch }
import { viablePlanningFormationIds } from './game/planningQueue'
import { projectGroundAssetAt, projectOnlineGroundReplay } from './game/executionProjection'
import {createScenario} from './game/scenarios'
import { deriveKnownEnvelope, derivePlanningEnvelope } from './game/world'
import { friendlyTerritoryForAssets } from './game/territory'
import { maxEscortRoute } from './game/escortRoute'
import type { Asset, CombatEvent, DebugScenario, EconomyActionId, EconomyCommand, EconomyTarget, MatchState, MissionId, Point, ReconPosture, RoundResult, Squadron } from './game/types'
import type { OnlineAction, OnlineCommand, OnlineResponse, OnlineSession, OnlineView } from './online/protocol'

const SAVE_KEY='dead-reckoning-mvp-v27'
const ONLINE_SESSION_KEY='dead-reckoning-online-session-v1'
const ONLINE_PLAYBACK_KEY='dead-reckoning-online-playback-v1'
const ONLINE_UI_ENABLED=import.meta.env.MODE==='online'
const LEGACY_SAVE_KEYS=['dead-reckoning-mvp-v26','dead-reckoning-mvp-v25','dead-reckoning-mvp-v24','dead-reckoning-mvp-v23','dead-reckoning-mvp-v22','dead-reckoning-mvp-v21','dead-reckoning-mvp-v20','dead-reckoning-mvp-v19','dead-reckoning-mvp-v18','dead-reckoning-mvp-v17','dead-reckoning-mvp-v16','dead-reckoning-mvp-v15','dead-reckoning-mvp-v14','dead-reckoning-mvp-v13','dead-reckoning-mvp-v12','dead-reckoning-mvp-v11','dead-reckoning-mvp-v10','dead-reckoning-mvp-v9']
function loadMatch():{match:MatchState;hasCampaign:boolean}{try{const saved=localStorage.getItem(SAVE_KEY);if(saved)return {match:normalizeMatch(JSON.parse(saved)),hasCampaign:true}}catch{}return {match:createCampaignDraft(),hasCampaign:false}}
function loadOnlineSession():OnlineSession|undefined{try{const raw=localStorage.getItem(ONLINE_SESSION_KEY);if(!raw)return;const session=JSON.parse(raw) as OnlineSession;return session.matchId&&session.token?session:undefined}catch{return undefined}}
function loadCompletedPlayback(){
  try{return localStorage.getItem(ONLINE_PLAYBACK_KEY)??undefined}catch{return undefined}
}
const pointDistance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
interface CpuPlanningWorkerResponse {
  requestId:number
  round:number
  phase:MatchState['phase']
  cpu?:MatchState['cpu']
  enemyAssets:Asset[]
  enemyBaseHealth:number
  onlineOutcome?:MatchState['onlineOutcome']
  error?:string
}
function assetsAtRoundStart(assets:Asset[],result:RoundResult):Asset[]{
  const damageByTarget=new globalThis.Map<string,number>()
  for(const sequence of result.combatSequences)if(sequence.kind==='strike')for(const exchange of sequence.exchanges)damageByTarget.set(exchange.defenderId,(damageByTarget.get(exchange.defenderId)??0)+exchange.damage)
  return assets.map(asset=>{const health=Math.min(asset.maxHealth,asset.health+(damageByTarget.get(asset.id)??0));return {...asset,health,...(asset.kind==='fob'?{operational:health>0}:{})}})
}
export default function App(){
  const [initial]=useState(loadMatch)
  const [match,setMatch]=useState<MatchState>(initial.match)
  const [hasCampaign,setHasCampaign]=useState(initial.hasCampaign)
  const [savedOnlineSession,setSavedOnlineSession]=useState<OnlineSession|undefined>(loadOnlineSession)
  const [onlineSession,setOnlineSession]=useState<OnlineSession|undefined>(undefined)
  const [onlineView,setOnlineView]=useState<OnlineView>()
  const [onlineInvite,setOnlineInvite]=useState<string>()
  const [onlineError,setOnlineError]=useState<string>()
  const [onlineCommandError,setOnlineCommandError]=useState<string>()
  const [onlineCommandBusy,setOnlineCommandBusy]=useState(false)
  const [submittingPlan,setSubmittingPlan]=useState<MatchState>()
  const onlineRef=useRef<{session:OnlineSession;view?:OnlineView}|undefined>(undefined)
  const retryCommandRef=useRef<{key:string;command:OnlineCommand}|undefined>(undefined)
  const inFlightCommandRef=useRef<OnlineCommand|undefined>(undefined)
  const onlineRefreshRef=useRef<{session:OnlineSession;request:Promise<void>}|undefined>(undefined)
  const localBackupRef=useRef<{match:MatchState;hasCampaign:boolean}|undefined>(undefined)
  const [menuOpen,setMenuOpen]=useState(true)
  const cameraMemory=useRef<CameraPoseSnapshot|undefined>(undefined)
  const [progress,setProgress]=useState(0)
  const [speed,setSpeed]=useState<1|2>(1)
  const speedRef=useRef<1|2>(1)
  const [activeEvent,setActiveEvent]=useState<CombatEvent>()
  const [completedPlayback,setCompletedPlayback]=useState(loadCompletedPlayback)
  const [playback,setPlayback]=useState<{key:string;elapsed:number}>()
  const [followId,setFollowId]=useState<string>()
  const [executionBaseId,setExecutionBaseId]=useState<string>()
  const [focusPoint,setFocusPoint]=useState<Point>()
  const [cameraFocusRequestKey,setCameraFocusRequestKey]=useState(0)
  const [routeNotice,setRouteNotice]=useState<string>()
  const [selectedAssetId,setSelectedAssetId]=useState<string>()
  const [inspectedFlightId,setInspectedFlightId]=useState<string>()
  const [planningStep,setPlanningStep]=useState<PlanningStep>('idle')
  const [editReturn,setEditReturn]=useState(false)
  const [selectingProtectTarget,setSelectingProtectTarget]=useState(false)
  const [planningBaseId,setPlanningBaseId]=useState('p-base')
  const [planningRosterMode,setPlanningRosterMode]=useState<PlanningRosterMode>('closed')
  const [reviewedIds,setReviewedIds]=useState<Set<string>>(()=>new Set())
  const [cpuPlanningRound,setCpuPlanningRound]=useState<number>()
  const [cpuAdaptingRound,setCpuAdaptingRound]=useState<number>()
  const [cpuPlanError,setCpuPlanError]=useState<string>()
  const cpuPlanRequestRef=useRef(0)
  const cpuPlanWorkerRef=useRef<Worker|undefined>(undefined)
  const [placementId,setPlacementId]=useState('p-base')
  const [worldMapOpen,setWorldMapOpen]=useState(false)
  const [showDefenseCoverage,setShowDefenseCoverage]=useState(true)
  const [economyTarget,setEconomyTarget]=useState<EconomyTarget>({kind:'campaign',id:'campaign'})
  const [procurementMode,setProcurementMode]=useState<ProcurementMode>('closed')
  const [procurementActionId,setProcurementActionId]=useState<EconomyActionId>()
  const [procurementPlacement,setProcurementPlacement]=useState<Point>()
  const resultRef=useRef<ReturnType<typeof resolveRound>|undefined>(undefined)
  const simulationRef=useRef<RoundSimulationController|undefined>(undefined)
  const [liveResult,setLiveResult]=useState<RoundResult>()
  const [acknowledgedThreatIds,setAcknowledgedThreatIds]=useState<Set<string>>(()=>new Set())
  const completingRef=useRef(false)
  useEffect(()=>{speedRef.current=speed},[speed])
  useEffect(()=>()=>{cpuPlanRequestRef.current++;cpuPlanWorkerRef.current?.terminate()},[])
  useEffect(()=>{if(hasCampaign&&!onlineSession&&cpuPlanningRound===undefined&&cpuAdaptingRound===undefined)try{localStorage.setItem(SAVE_KEY,JSON.stringify(match))}catch{}},[match,hasCampaign,onlineSession,cpuPlanningRound,cpuAdaptingRound])
  const acceptOnlineResponse=useCallback((response:OnlineResponse,session:OnlineSession)=>{
    const current=onlineRef.current
    if(current?.session!==session)return
    const previous=current.view
    const view=response.view
    if(previous&&view.revision<previous.revision)return
    onlineRef.current={session,view}
    if(!previous||view.revision>previous.revision||view.joined!==previous.joined||view.opponentLocked!==previous.opponentLocked||view.locked!==previous.locked){
      setOnlineView(view)
    }
    if(response.invite)setOnlineInvite(response.invite)
    if(!previous||view.match.phase!==previous.match.phase||view.match.round!==previous.match.round){
      setWorldMapOpen(false);setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined)
      setSelectedAssetId(undefined);setInspectedFlightId(undefined);setActiveEvent(undefined)
      setEconomyTarget({kind:'campaign',id:'campaign'});setProcurementMode('closed');setProcurementActionId(undefined);setProcurementPlacement(undefined)
      setReviewedIds(new Set());setPlanningStep('idle');setSelectingProtectTarget(false);setPlanningRosterMode('closed');setRouteNotice(undefined)
      setAcknowledgedThreatIds(new Set())
    }
    if(!previous||view.revision>previous.revision||view.locked!==previous.locked)setMatch(view.match)
    const pending=retryCommandRef.current?.command
    if(pending&&(view.revision>pending.revision||view.locked)){
      if(pending.action.type==='lock-plan')setSubmittingPlan(undefined)
      retryCommandRef.current=undefined
      setOnlineCommandError(undefined)
    }
    setOnlineError(undefined)
  },[])
  const attachOnline=(session:OnlineSession,view:OnlineView,invite?:string)=>{
    if(!onlineSession)localBackupRef.current={match,hasCampaign}
    resetPlanningUi()
    onlineRef.current={session,view};retryCommandRef.current=undefined
    try{localStorage.setItem(ONLINE_SESSION_KEY,JSON.stringify(session))}catch{}
    setSavedOnlineSession(session)
    setOnlineSession(session);setOnlineView(view);setOnlineInvite(invite);setOnlineError(undefined);setOnlineCommandError(undefined);setMatch(view.match);setMenuOpen(false)
    const base=view.match.playerAssets.find(asset=>asset.kind==='base')
    if(base)setPlacementId(base.id)
  }
  const refreshOnline=useCallback((session:OnlineSession)=>{
    if(onlineRefreshRef.current?.session===session)return onlineRefreshRef.current.request
    const request=fetchOnlineMatch(session)
      .then(response=>acceptOnlineResponse(response,session))
      .catch(reason=>{if(onlineRef.current?.session===session)setOnlineError(reason instanceof Error?reason.message:'Connection lost. Reconnecting…')})
      .finally(()=>{if(onlineRefreshRef.current?.request===request)onlineRefreshRef.current=undefined})
    onlineRefreshRef.current={session,request}
    return request
  },[acceptOnlineResponse])
  const sendOnlineAction=useCallback(async(action:OnlineAction)=>{
    const current=onlineRef.current
    if(!current?.view||inFlightCommandRef.current)return
    const key=JSON.stringify({revision:current.view.revision,action})
    const previousRetry=retryCommandRef.current
    const command:OnlineCommand=previousRetry?.key===key?previousRetry.command:{
      id:Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join(''),
      revision:current.view.revision,action
    }
    inFlightCommandRef.current=command
    retryCommandRef.current={key,command}
    setOnlineCommandBusy(true);setOnlineCommandError(undefined);setOnlineError(undefined)
    try{
      const response=await sendOnlineCommand(current.session,command)
      if(onlineRef.current?.session!==current.session)return
      acceptOnlineResponse(response,current.session)
      retryCommandRef.current=undefined
    }catch(reason){
      if(onlineRef.current?.session!==current.session)return
      if(onlineRef.current.view?.revision===command.revision){
        setOnlineCommandError(reason instanceof Error?reason.message:'Online command failed. Try again.')
        // A validation rejection is definitive. A lost response may have
        // committed the plan; keep the submitted package until we reconcile.
        if(action.type==='lock-plan'&&reason instanceof OnlineRequestError&&reason.status===400){
          retryCommandRef.current=undefined
          setSubmittingPlan(undefined)
        }
        void refreshOnline(current.session)
      }
    }finally{
      if(inFlightCommandRef.current===command){
        inFlightCommandRef.current=undefined
        setOnlineCommandBusy(false)
      }
    }
  },[acceptOnlineResponse,refreshOnline])
  // Only lobby and planning depend on the other seat. Once settled, avoid fetching
  // the full round recording repeatedly while this seat watches or reviews it.
  const needsOnlinePoll=!onlineView||onlineView.match.phase==='deploy'||onlineView.match.phase==='plan'||Boolean(onlineCommandError||onlineError)
  useEffect(()=>{
    if(!onlineSession||!needsOnlinePoll)return
    const refresh=()=>{if(!inFlightCommandRef.current)void refreshOnline(onlineSession)}
    refresh()
    const timer=window.setInterval(refresh,1600)
    return()=>window.clearInterval(timer)
  },[onlineSession,needsOnlinePoll,refreshOnline])
  const retryOnline=()=>{
    const current=onlineRef.current
    if(!current||inFlightCommandRef.current)return
    const retry=retryCommandRef.current?.command
    if(onlineCommandError&&retry&&current.view?.revision===retry.revision){void sendOnlineAction(retry.action);return}
    void refreshOnline(current.session)
  }
  const isPlanReadOnly=useCallback(()=>Boolean(onlineRef.current?.view?.locked||retryCommandRef.current?.command.action.type==='lock-plan'),[])
  const waitingOnPlan=match.phase==='plan'&&Boolean(onlineView?.locked||submittingPlan)
  const planningSquadrons=submittingPlan?.squadrons??match.squadrons
  const selected=planningSquadrons.find(s=>s.id===match.selectedId) ?? planningSquadrons[0]
  const displayedOrderIds=waitingOnPlan
    ? planningSquadrons.filter(formation=>formation.sortieOrdered).map(formation=>formation.id)
    : [...reviewedIds]
  const onlineRound=onlineSession&&match.phase==='debrief'?match.lastResult:undefined
  const playbackKey=onlineRound&&onlineRound.duration>0&&onlineSession?`${onlineSession.matchId}:${onlineRound.round}`:undefined
  const replayActive=Boolean(playbackKey&&completedPlayback!==playbackKey)
  const visiblePhase=replayActive?'execute':match.phase
  const onlineStatus=!onlineSession?undefined:onlineError?'Reconnecting':onlineView?.locked?'Waiting for opponent':onlineView?.opponentLocked?'Opponent ready':onlineView?.joined?'PvP':'Invite opponent'
  const replaySeconds=replayActive&&playback&&playback.key===playbackKey?playback.elapsed:0
  const replayProgress=onlineRound&&onlineRound.duration>0?replaySeconds/onlineRound.duration:0
  const projectedGround=replayActive&&onlineRound?projectOnlineGroundReplay(onlineRound,replaySeconds):undefined
  const legacyReplayGround=useMemo(()=>replayActive&&onlineRound&&!onlineRound.groundReplay?{
    playerAssets:assetsAtRoundStart(match.playerAssets,onlineRound),
    enemyAssets:assetsAtRoundStart(match.enemyAssets,onlineRound)
      .filter(asset=>!onlineRound.intelReports.some(report=>report.recovered&&report.assetId===asset.id))
  }:undefined,[match,onlineRound,replayActive])
  const replayMatch=projectedGround||legacyReplayGround?{...match,...(projectedGround??legacyReplayGround)}:match
  const executionResult=replayActive?onlineRound:match.phase==='execute'?liveResult:undefined
  const executionProgress=replayActive?replayProgress:progress
  const executionEvent=replayActive?activeEvent??onlineRound?.events.find(event=>event.time===0):activeEvent
  const campaign=isCampaign(match)
  const groundTargets=groundStrikeTargets(match)
  const pickingGroundTarget=!waitingOnPlan&&isGroundStrikeTargeting(match.phase,selected,planningStep)
  const inspectionResult=executionResult??(match.phase==='debrief'?match.lastResult:undefined)
  const inspectionSeconds=replayActive?replaySeconds:inspectionResult?.duration??0
  const observedAssetIds=new Set(match.phase==='execute'?(liveResult?.contactObservations??[]).filter(observation=>observation.start<=liveResult!.duration&&observation.end>=liveResult!.duration).map(observation=>observation.targetId):[])
  const selectedAsset=[...replayMatch.playerAssets,...replayMatch.enemyAssets.filter(asset=>!asset.hidden&&asset.intel!=='unknown'||observedAssetIds.has(asset.id))].find(asset=>asset.id===selectedAssetId)
  const inspectionAsset=selectedAsset&&(projectedGround?selectedAsset:replayActive?projectGroundAssetAt(selectedAsset,onlineRound,replaySeconds):[...inspectionResult?.playerAssets??[],...inspectionResult?.assets??[]].find(asset=>asset.id===selectedAsset.id)??selectedAsset)
  const inspectedAsset=inspectionAsset&&observedAssetIds.has(inspectionAsset.id)&&inspectionAsset.intel==='unknown'?{...inspectionAsset,intel:'probable' as const,hidden:false,confidence:70}:inspectionAsset
  const inspectingEnemy=Boolean(inspectedAsset&&replayMatch.enemyAssets.some(asset=>asset.id===inspectedAsset.id))
  const inspectionSites=inspectedAsset?(inspectingEnemy
    ? replayMatch.enemyAssets.filter(asset=>!asset.hidden&&asset.intel==='confirmed')
    : replayMatch.playerAssets).map(asset=>visiblePhase==='execute'&&!projectedGround?projectGroundAssetAt(asset,executionResult,inspectionSeconds):asset):undefined
  const inspectedAircraft=visiblePhase==='execute'&&inspectedFlightId?aircraftInspectionAt(executionResult,inspectedFlightId,inspectionSeconds):undefined
  const inspectAsset=(id:string)=>{if(match.phase==='adapt'){selectEconomyTarget({kind:'asset',id},false);return}setSelectedAssetId(id);setInspectedFlightId(undefined)}
  const inspectFlight=(id:string)=>{setInspectedFlightId(id);setSelectedAssetId(undefined)}
  const strikeTarget=campaign?confirmedStrikeTarget(replayMatch):undefined
  const enemyBaseOnMap=replayMatch.enemyAssets.find(asset=>asset.kind==='base'&&!asset.hidden&&asset.intel!=='unknown')
  const knownEnemyBaseHealth=strikeTarget?Math.min(strikeTarget.health,liveResult?.assets.find(asset=>asset.id===strikeTarget.id&&asset.kind==='base'&&!asset.hidden)?.health??strikeTarget.health):undefined
  const liveHomeHealth=(replayActive?replayMatch.playerAssets:liveResult?.playerAssets)?.find(asset=>asset.kind==='base')?.health??match.playerAssets.find(asset=>asset.kind==='base')?.health??match.playerBaseHealth
  const playerBase=replayMatch.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]
  const friendlyTerritory=useMemo(()=>friendlyTerritoryForAssets(replayMatch.world.friendlyTerritory,replayMatch.playerAssets),[replayMatch.playerAssets,replayMatch.world.friendlyTerritory])
  const knownEnvelope=useMemo(()=>deriveKnownEnvelope(match.world,match.mappedAreas,match.discoveredBoundaries,friendlyTerritory),[friendlyTerritory,match.discoveredBoundaries,match.mappedAreas,match.world])
  const planningEnvelope=useMemo(()=>derivePlanningEnvelope(knownEnvelope),[knownEnvelope])
  const activeMapPlanningBounds=match.phase==='plan'?match.world.presentationBounds:planningEnvelope
  const knownWorld=useMemo(()=>deriveKnownWorldModel({mappedAreas:match.mappedAreas,friendlyTerritory,friendlyAssets:match.playerAssets,enemyAssets:match.enemyAssets,discoveredBoundaries:match.discoveredBoundaries}),[friendlyTerritory,match.discoveredBoundaries,match.enemyAssets,match.mappedAreas,match.playerAssets])
  const planningBaseGroups=useMemo(()=>formationBaseGroups(match.squadrons,match.playerAssets),[match.playerAssets,match.squadrons])
  const activePlanningBaseId=planningBaseGroups.some(group=>group.base.id===planningBaseId)?planningBaseId:planningBaseGroups[0]?.base.id??'p-base'
  const viableFormationIds=useMemo(()=>viablePlanningFormationIds(match.squadrons),[match.squadrons])
  const reviewedCount=viableFormationIds.reduce((total,id)=>total+Number(reviewedIds.has(id)),0)
  const selectedLaunchField=formationField(planningBaseGroups.map(group=>group.base),selected.id)??match.playerAssets.find(asset=>asset.kind==='base')
  const recoveryView=useMemo(()=>deriveRecoveryPlanningView(match,selected.id,selected.route,flightRangeFor(selected)),[match,selected])
  const routeBudget=useMemo(()=>planningStep==='route'
    ? deriveRouteBudget(match,selected.id,selected.route,selected.routeIngress,flightRangeFor(selected))
    : undefined,[match,selected,planningStep])
  const canEditReturn=selected.mission!=='transit'&&Boolean(recoveryView?.recoveryRoute.length)
  const editingReturn=planningStep==='route'&&!waitingOnPlan&&canEditReturn&&editReturn
  useEffect(()=>setEditReturn(false),[match.phase,match.round,planningStep,selected.id])
  const routeAdjustmentNotice=(adjustment:ReturnType<typeof generateRouteTemplate>['adjustment'])=>adjustment==='ingress-clamped'?'ROUTE CLAMPED AT THE VISIBLE MAP LIMIT':adjustment==='pattern-shrunk'?'ON-STATION PATTERN REDUCED TO FIT FUEL':adjustment==='ingress-shortened'?'INGRESS ROUTE SHORTENED TO PRESERVE RETURN FUEL':undefined

  const setRoute=useCallback((ingress:Point[])=>{
    if(isPlanReadOnly())return false
    const squadron=match.squadrons.find(s=>s.id===match.selectedId)??match.squadrons[0]
    const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const withOrigin=ingress.length ? [[...launch] as Point,...ingress.slice(1)] : [[...launch] as Point]
    const routeBounds=match.world.presentationBounds
    if(squadron.mission==='defensive-cap'&&selectingProtectTarget&&withOrigin.length>1){
      const protectedPoint=withOrigin.at(-1)!
      const generated=generateRouteTemplate({template:squadron.mission,ingress:withOrigin,maxDistance:flightRangeFor(squadron),bounds:routeBounds})
      setRouteNotice('PROTECTING MAP POINT · COVERAGE CIRCLE SET')
      setSelectingProtectTarget(false)
      setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
      setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,protectedPoint:[...protectedPoint] as Point,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,recoveryWaypoints:undefined,plannedRecoveryFieldId:undefined}:s)}))
      return true
    }
    if(squadron.mission==='base-strike'){
      const anchors=buildGroundStrikeRoute(match,squadron.id,squadron.strikeTargetId)
      if(!anchors){setRouteNotice('SELECT A CONFIRMED GROUND TARGET');return false}
      const releasePoint=withOrigin.length>=2?withOrigin.at(-1)!:anchors.at(-1)!
      const target=match.enemyAssets.find(asset=>asset.id===squadron.strikeTargetId)
      const route=groundStrikeRoute(anchors,withOrigin.slice(1,-1),releasePoint)
      if(target&&pointDistance(releasePoint,target.position)>BASE_STRIKE_RANGE+.001){setRouteNotice(`KEEP THE STRIKE POINT INSIDE THE ${BASE_STRIKE_RANGE}-UNIT RELEASE CIRCLE`);return false}
      const error=validateGroundStrikeOrder(match,{...squadron,route})
      if(error){setRouteNotice(error.includes('AVAILABLE RANGE')?'Not enough fuel for the strike and return. Try a shorter ingress.':error);return false}
      setRouteNotice(undefined)
      setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
      setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,route,routeIngress:route}:s)}))
      return true
    }
    const generated=squadron.mission==='transit'
      ? { route:withOrigin, ingress:withOrigin, adjustment:'none' as const }
      : generateRouteTemplate({template:squadron.mission,ingress:withOrigin,maxDistance:flightRangeFor(squadron),bounds:routeBounds})
    if(generated.adjustment==='ingress-shortened'){
      setRouteNotice('Not enough fuel for that waypoint and the return. Try a closer point or drag the existing route shorter.')
      return false
    }
    const candidate={...squadron,route:generated.route,routeIngress:generated.ingress,
      recoveryWaypoints:ingress.length?squadron.recoveryWaypoints:undefined,
      plannedRecoveryFieldId:ingress.length?squadron.plannedRecoveryFieldId:undefined,
      protectedPoint:squadron.mission==='defensive-cap'&&!squadron.protectedTargetId&&generated.ingress.length>1?generated.ingress.at(-1):squadron.protectedPoint}
    const next={...match,squadrons:match.squadrons.map(s=>s.id===candidate.id?candidate:s)}
    if(ingress.length&&candidate.route.length>1){
      const view=deriveRecoveryPlanningView(next,candidate.id,candidate.route,flightRangeFor(candidate))
      const distance=candidate.mission==='transit'?routeDistanceForBasing(candidate.route):view?.missionDistance
      if(distance!==undefined&&distance>flightRangeFor(candidate)+.001){
        setRouteNotice('Not enough fuel for that waypoint and the return. Try a closer point or drag the existing route shorter.')
        return false
      }
    }
    setRouteNotice(routeAdjustmentNotice(generated.adjustment))
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
    setMatch(next)
    return true
  },[match,playerBase,selectingProtectTarget,isPlanReadOnly])
  const setReturnWaypoints=(waypoints:Point[])=>{
    if(isPlanReadOnly()||!editingReturn)return false
    const bounds=match.world.presentationBounds
    if(waypoints.length>MAX_RECOVERY_WAYPOINTS||waypoints.some(([x,z])=>x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ)){
      setRouteNotice('RETURN WAYPOINT IS OUTSIDE THE PLANNING AREA')
      return false
    }
    const next={...match,squadrons:match.squadrons.map(squadron=>squadron.id===selected.id
      ?{...squadron,recoveryWaypoints:waypoints.length?waypoints:undefined}:squadron)}
    const view=deriveRecoveryPlanningView(next,selected.id,selected.route,flightRangeFor(selected))
    if(!view?.valid){
      setRouteNotice(view&&view.missionDistance>flightRangeFor(selected)+.001
        ? 'Not enough fuel for that return waypoint. Try a closer point or shorten the route.'
        : view?.reason??'Invalid return route.')
      return false
    }
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(selected.id);return next})
    setRouteNotice(undefined)
    setMatch(next)
    return true
  }
  const routeToAirfield=(fieldId:string,direct=false)=>{
    if(isPlanReadOnly())return
    const field=match.playerAssets.find(asset=>asset.id===fieldId)
    if(!field||!isOperationalAirfield(field)){setRouteNotice('Recovery airfield is unavailable.');return}
    const changingReturn=editingReturn||(direct&&selected.role==='recon')
    if(!changingReturn&&selected.mission!=='transit'&&!direct)return
    const transit=changingReturn?undefined:routeToRecoveryField(match,selected.id,fieldId,direct)
    if(!changingReturn&&!transit)return
    const candidate:Squadron=transit
      ? {...selected,mission:'transit',route:transit,routeIngress:transit,recoveryWaypoints:undefined,protectedPoint:undefined,protectedTargetId:undefined,strikeTargetId:undefined,plannedRecoveryFieldId:fieldId}
      : {...selected,plannedRecoveryFieldId:fieldId}
    const next={...match,squadrons:match.squadrons.map(item=>item.id===candidate.id?candidate:item)}
    const view=deriveRecoveryPlanningView(next,candidate.id,candidate.route,flightRangeFor(candidate))
    if(!view?.valid){setRouteNotice(view?.reason??'Recovery route is unavailable.');return}
    setSelectingProtectTarget(false)
    setRouteNotice(`${changingReturn?'Return':'Transit'} to ${field.name??(field.kind==='base'?'Home Base':'FOB')}`)
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(candidate.id);return next})
    setMatch(next)
  }
  const selectMission=useCallback((mission:MissionId)=>{
    if(isPlanReadOnly())return
    if(mission==='base-strike')setSelectedAssetId(undefined)
    const squadron=match.squadrons.find(s=>s.id===match.selectedId)??match.squadrons[0]
    if(mission==='base-strike'){
      const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase
      setSelectingProtectTarget(false)
      setRouteNotice(undefined)
      setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
      setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,mission,strikeTargetId:undefined,route:[launch],routeIngress:[launch],recoveryWaypoints:undefined,plannedRecoveryFieldId:undefined}:s)}))
      setPlanningStep('target')
      return
    }
    const base=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const existing=mission==='transit'?[base]:squadron.routeIngress.length>=2?squadron.routeIngress:squadron.route.length>=2?squadron.route:[base]
    const ingress:[[number,number],...Point[]]=[[...base],...existing.slice(1)]
    const routeBounds=match.world.presentationBounds
    const generated=generateRouteTemplate({template:mission,ingress,maxDistance:flightRangeFor(squadron),bounds:routeBounds})
    const protect=mission==='defensive-cap'
    setSelectingProtectTarget(false)
    setRouteNotice(routeAdjustmentNotice(generated.adjustment))
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
    setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,mission,strikeTargetId:undefined,protectedPoint:protect&&generated.ingress.length>1?[...generated.ingress.at(-1)!] as Point:undefined,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,recoveryWaypoints:undefined,plannedRecoveryFieldId:undefined}:s)}))
    setPlanningStep('route')
  },[match,playerBase,isPlanReadOnly])
  const selectGroundTarget=(targetId:string)=>{
    if(isPlanReadOnly()||!pickingGroundTarget)return
    const order=planGroundStrike(match,selected.id,targetId)
    setSelectedAssetId(undefined)
    if(!order){setRouteNotice('NO LEGAL STRIKE INGRESS FROM THIS FIELD');return}
    setSelectingProtectTarget(false)
    setPlanningRosterMode('closed')
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(selected.id);return next})
    setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===selected.id?order:s)}))
    setRouteNotice(undefined)
    setPlanningStep('route')
  }
  const changeGroundTarget=()=>{if(isPlanReadOnly())return;setSelectedAssetId(undefined);setReviewedIds(ids=>{const next=new Set(ids);next.delete(selected.id);return next});setPlanningStep('target');setRouteNotice(undefined)}
  const placeAsset=useCallback((id:string,position:Point)=>{
    if(onlineRef.current?.view){if(!onlineRef.current.view.locked)void sendOnlineAction({type:'place',assetId:id,position});return}
    setMatch(m=>{
      const placed=placeInitialAsset(m,id,position)
      if(placed===m)return m
      if(m.setup)return placed
      const oldBase=m.playerAssets.find(a=>a.kind==='base')?.position??m.world.friendlyTerritory.center
      const nextBase=placed.playerAssets.find(a=>a.kind==='base')?.position??oldBase
      const reposition=(route:Point[])=>route.map((p,i)=>i===0||i===route.length-1&&Math.hypot(p[0]-oldBase[0],p[1]-oldBase[1])<.3?nextBase:p)
      return id==='p-base'?{...placed,squadrons:placed.squadrons.map(s=>({...s,route:reposition(s.route),routeIngress:reposition(s.routeIngress)}))}:placed
    })
  },[sendOnlineAction])
  const stageInitialPlacement=useCallback((id:string,position:Point)=>{if(onlineView?.locked)return;if(validateInitialPlacement(match,id,position).length===0)placeAsset(id,position)},[match,onlineView?.locked,placeAsset])
  const advanceCampaignSetup=useCallback(()=>setMatch(m=>{if(!m.setup)return m;if(m.setup.stage==='allocate'&&validateCampaignAllocation(m,m.setup).length===0)return {...m,setup:{...m.setup,stage:'place'}};if(SETUP_REQUIRED_ASSET_IDS.every(id=>m.setup!.placedAssetIds.includes(id)))return confirmCampaignSetup(m);return m}),[])
  const transitOrderError=(squadron:Squadron,state:MatchState)=>{
    if(squadron.mission!=='transit')return undefined
    const destination=state.playerAssets.find(asset=>asset.id===squadron.plannedRecoveryFieldId)
    return destination&&transitDestination(squadron,squadron.route,destination)
      ? undefined:'Tap a friendly airfield to finish the Transit order.'
  }
  const commit=(includeSelectedRoute=false)=>{
    if(onlineSession&&(isPlanReadOnly()||inFlightCommandRef.current))return
    if(cpuPlanningRound===match.round||cpuPlanError)return
    const orderedIds=new Set(reviewedIds)
    let source=match
    if(includeSelectedRoute){
      const transitError=transitOrderError(selected,match)
      if(transitError){setRouteNotice(transitError);return}
      const view=deriveRecoveryPlanningView(match,selected.id,selected.route,flightRangeFor(selected))
      if(selected.aircraft<=0||selected.status==='trapped'||!view?.valid){setRouteNotice(view?.reason??'FORMATION CANNOT LAUNCH');return}
      const candidate={...selected,route:view.normalizedRoute,plannedRecoveryFieldId:view.intendedField.id}
      const strikeError=validateGroundStrikeOrder(match,candidate)
      if(strikeError){setRouteNotice(strikeError);return}
      if(candidate.mission==='defensive-cap'&&candidate.protectedTargetId&&!reviewedIds.has(candidate.protectedTargetId)){setRouteNotice('ESCORT TARGET MUST HAVE A CONFIRMED ORDER FIRST');return}
      source={...match,squadrons:match.squadrons.map(item=>item.id===candidate.id?candidate:item)}
      orderedIds.add(candidate.id)
    }
    const orderedMatch={...source,squadrons:source.squadrons.map(s=>({...s,sortieOrdered:orderedIds.has(s.id),plannedRecoveryFieldId:orderedIds.has(s.id)?s.plannedRecoveryFieldId:undefined}))}
    const validation=validateRecoveryPackage(orderedMatch,s=>flightRangeFor(s),orderedIds)
    const strikeError=orderedMatch.squadrons.filter(s=>orderedIds.has(s.id)).map(s=>validateGroundStrikeOrder(orderedMatch,s)).find(Boolean)
    const escortError=orderedMatch.squadrons.filter(s=>orderedIds.has(s.id)&&s.mission==='defensive-cap'&&s.protectedTargetId).map(s=>{const target=orderedMatch.squadrons.find(item=>item.id===s.protectedTargetId);return !target||!orderedIds.has(target.id)?'ESCORT TARGET MUST HAVE A CONFIRMED ORDER':undefined}).find(Boolean)
    if((!orderedIds.size&&!onlineSession)||!validation.valid||strikeError||escortError){setRouteNotice(strikeError??escortError??validation.reason??'PLAN AT LEAST ONE FORMATION');return}
    if(onlineSession){const orders=orderedMatch.squadrons.filter(squadron=>orderedIds.has(squadron.id)).map(squadron=>({id:squadron.id,mission:squadron.mission,route:squadron.route,routeIngress:squadron.routeIngress,recoveryWaypoints:squadron.recoveryWaypoints,strikeTargetId:squadron.strikeTargetId,reconPosture:squadron.reconPosture,protectedPoint:squadron.protectedPoint,protectedTargetId:squadron.protectedTargetId,plannedRecoveryFieldId:squadron.plannedRecoveryFieldId}));setSubmittingPlan(orderedMatch);setSelectedAssetId(undefined);setInspectedFlightId(undefined);void sendOnlineAction({type:'lock-plan',orders});return}
    const simulation=createRoundSimulation(orderedMatch);simulationRef.current=simulation;resultRef.current=simulation.result;completingRef.current=false;setLiveResult(simulation.result);setAcknowledgedThreatIds(new Set());setProgress(1);setActiveEvent(undefined);setFollowId(match.selectedId);setExecutionBaseId(formationBaseId(planningBaseGroups,match.selectedId)??activePlanningBaseId);setFocusPoint(undefined);setMatch({...orderedMatch,phase:'execute'})
  }
  useEffect(()=>{
    const simulation=simulationRef.current;if(onlineSession||menuOpen||match.phase!=='execute'||!simulation)return
    let frame=0,last=performance.now(),accumulator=0,completionTimer:number|undefined
    const tick=(now:number)=>{accumulator+=(now-last)*speedRef.current;last=now;let advanced=false;while(accumulator>=TICK_SECONDS*1000&&!simulation.complete){const result=simulation.advance();resultRef.current=result;accumulator-=TICK_SECONDS*1000;advanced=true}if(advanced){setLiveResult(simulation.result);setActiveEvent(simulation.result.events.filter(event=>event.time<=simulation.result.duration).at(-1))}if(simulation.complete){if(!completingRef.current){completingRef.current=true;completionTimer=window.setTimeout(()=>setMatch(current=>current.phase==='execute'?applyRound(current,simulation.result):current),1250)}return}frame=requestAnimationFrame(tick)}
    frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);if(completionTimer!==undefined){clearTimeout(completionTimer);completingRef.current=false}}
  },[match.phase,menuOpen,onlineSession])
  useEffect(()=>{
    if(!replayActive||!playbackKey||!onlineRound)return
    setSpeed(1);speedRef.current=1
    let frame=0,last=performance.now(),lastPublish=last,elapsed=0,eventIndex=0
    let completionTimer:number|undefined
    const finish=()=>{
      setActiveEvent(undefined);setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined)
      setSelectedAssetId(undefined);setInspectedFlightId(undefined)
      setCompletedPlayback(playbackKey)
      try{localStorage.setItem(ONLINE_PLAYBACK_KEY,playbackKey)}catch{}
    }
    const tick=(now:number)=>{
      elapsed=Math.min(onlineRound.duration,elapsed+Math.max(0,Math.min(100,now-last))/1000*speedRef.current)
      last=now
      if(now-lastPublish>=TICK_SECONDS*1000||elapsed>=onlineRound.duration){
        lastPublish=now
        setPlayback({key:playbackKey,elapsed})
        while(eventIndex<onlineRound.events.length&&onlineRound.events[eventIndex].time<=elapsed)eventIndex++
        if(eventIndex>0)setActiveEvent(onlineRound.events[eventIndex-1])
      }
      if(elapsed>=onlineRound.duration){
        completionTimer=window.setTimeout(finish,500)
        return
      }
      frame=requestAnimationFrame(tick)
    }
    frame=requestAnimationFrame(tick)
    return()=>{cancelAnimationFrame(frame);if(completionTimer!==undefined)clearTimeout(completionTimer)}
  },[onlineRound,playbackKey,replayActive])

  const closeProcurement=()=>{setProcurementMode('closed');setProcurementActionId(undefined);setProcurementPlacement(undefined)}
  const enterResupply=()=>{
    if(replayActive)return
    if(onlineSession){void sendOnlineAction({type:'debrief'});return}
    const next=openAdaptPhaseImmediately(match);setWorldMapOpen(false);setFollowId(undefined);setExecutionBaseId(undefined);setSelectedAssetId(undefined);setInspectedFlightId(undefined);closeProcurement();setEconomyTarget({kind:'campaign',id:'campaign'});setFocusPoint(playerBase);setMatch(next)
    if(next.phase==='adapt'&&match.cpu)runCpuWork(match,'adapt')
  }
  const runCpuWork=(source:MatchState,action:'adapt'|'plan')=>{
    const requestId=++cpuPlanRequestRef.current
    const targetRound=action==='adapt'?source.round:source.round+1
    const targetPhase=action==='adapt'?'adapt':'plan'
    const clearPending=()=>{
      if(action==='adapt')setCpuAdaptingRound(undefined)
      else setCpuPlanningRound(undefined)
    }
    const applyResult=(result:CpuPlanningWorkerResponse)=>{
      if(requestId!==cpuPlanRequestRef.current)return
      if(result.error||result.round!==targetRound||result.phase!==targetPhase){runFallback();return}
      cpuPlanWorkerRef.current?.terminate();cpuPlanWorkerRef.current=undefined
      setMatch(current=>current.round===targetRound&&current.phase===targetPhase?{
        ...current,cpu:result.cpu,enemyAssets:result.enemyAssets,enemyBaseHealth:result.enemyBaseHealth,onlineOutcome:result.onlineOutcome,
      }:current)
      clearPending();setCpuPlanError(undefined)
    }
    const runFallback=()=>{
      cpuPlanWorkerRef.current?.terminate();cpuPlanWorkerRef.current=undefined
      try{
        const updated=action==='adapt'?openAdaptPhase(source):beginNextRound(source)
        if(updated.phase!==targetPhase||updated.round!==targetRound)throw new Error('The CPU plan is unavailable.')
        applyResult({requestId,round:updated.round,phase:updated.phase,cpu:updated.cpu,enemyAssets:updated.enemyAssets,enemyBaseHealth:updated.enemyBaseHealth,onlineOutcome:updated.onlineOutcome})
      }catch{
        if(requestId===cpuPlanRequestRef.current){clearPending();setCpuPlanError('CPU planning failed. Reload to retry.')}
      }
    }
    setCpuPlanError(undefined)
    if(action==='adapt')setCpuAdaptingRound(targetRound)
    else setCpuPlanningRound(targetRound)
    try{
      const worker=new Worker(new URL('./game/cpu/next-round.worker.ts',import.meta.url),{type:'module'})
      cpuPlanWorkerRef.current=worker
      worker.onmessage=(event:MessageEvent<CpuPlanningWorkerResponse>)=>applyResult(event.data)
      worker.onerror=event=>{event.preventDefault();runFallback()}
      worker.onmessageerror=()=>runFallback()
      worker.postMessage({requestId,action,match:{...source,lastResult:undefined}})
    }catch{
      runFallback()
    }
  }
  const nextRound=()=>{
    if(onlineSession){void sendOnlineAction({type:'next-round'});return}
    if(cpuAdaptingRound===match.round||cpuPlanError)return
    setSelectedAssetId(undefined);setInspectedFlightId(undefined);simulationRef.current=undefined;setLiveResult(undefined);setAcknowledgedThreatIds(new Set());setWorldMapOpen(false);setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined);setRouteNotice(undefined);setPlanningStep('idle');setReviewedIds(new Set());setPlanningBaseId('p-base');setPlanningRosterMode('closed');closeProcurement()
    const next=advanceToNextRound(match)
    if(next===match)return
    setMatch(next)
    if(match.cpu)runCpuWork(match,'plan')
    else setCpuPlanError(undefined)
  }
  const resetPlanningUi=()=>{cpuPlanRequestRef.current++;cpuPlanWorkerRef.current?.terminate();cpuPlanWorkerRef.current=undefined;setCpuPlanningRound(undefined);setCpuAdaptingRound(undefined);setCpuPlanError(undefined);cameraMemory.current=undefined;setSelectedAssetId(undefined);setInspectedFlightId(undefined);simulationRef.current=undefined;setLiveResult(undefined);setAcknowledgedThreatIds(new Set());setWorldMapOpen(false);setProgress(0);setPlayback(undefined);setActiveEvent(undefined);setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined);setRouteNotice(undefined);setPlanningStep('idle');setPlanningBaseId('p-base');setPlanningRosterMode('closed');setReviewedIds(new Set());closeProcurement()}
  const selectScenario=(scenario:DebugScenario)=>{setHasCampaign(true);resetPlanningUi();setEconomyTarget({kind:'campaign',id:'campaign'});setMatch(createScenario(scenario))}
  const restart=()=>{const seed=freshCampaignSeed();localStorage.removeItem(SAVE_KEY);for(const key of LEGACY_SAVE_KEYS)localStorage.removeItem(key);resetPlanningUi();setEconomyTarget({kind:'campaign',id:'campaign'});setMatch(m=>m.debugScenario&&m.debugScenario!=='campaign'?createScenario(m.debugScenario):createCampaignDraft(seed,m.cpu?.difficulty))}
  const selectFormation=(id:string)=>{setAcknowledgedThreatIds(current=>{const next=new Set(current);for(const alert of executionResult?.threatAlerts??[])if(alert.unitId===id&&alert.time<=inspectionSeconds)next.add(alert.id);return next});setFollowId(current=>current===id?undefined:id);setFocusPoint(undefined);setMatch(m=>({...m,selectedId:id}))}
  const confirmPlanningOrder=(squadron:Squadron,state:MatchState=match):boolean=>{
    if(isPlanReadOnly())return false
    const transitError=transitOrderError(squadron,state)
    if(transitError){setRouteNotice(transitError);return false}
    const view=deriveRecoveryPlanningView(state,squadron.id,squadron.route,flightRangeFor(squadron))
    if(squadron.aircraft<=0||squadron.status==='trapped'||!view?.valid){setRouteNotice(view?.reason??'FORMATION CANNOT LAUNCH');return false}
    const reviewedSquadron={...squadron,route:view.normalizedRoute}
    if(reviewedSquadron.mission==='defensive-cap'&&reviewedSquadron.protectedTargetId){const target=state.squadrons.find(item=>item.id===reviewedSquadron.protectedTargetId);if(!target||!reviewedIds.has(target.id)){setRouteNotice('ESCORT TARGET MUST HAVE A CONFIRMED ORDER FIRST');return false}}
    const strikeError=validateGroundStrikeOrder(state,reviewedSquadron)
    if(strikeError){setRouteNotice(strikeError);return false}
    setMatch(current=>({...current,squadrons:current.squadrons.map(item=>item.id===squadron.id?{...reviewedSquadron,route:view.normalizedRoute,plannedRecoveryFieldId:view.intendedField.id}:item)}))
    setReviewedIds(current=>new Set(current).add(squadron.id))
    setRouteNotice(undefined)
    return true
  }
  const finishProtectOrder=(squadron:Squadron,candidate:Squadron,state:MatchState)=>{
    const candidateState={...state,squadrons:state.squadrons.map(item=>item.id===squadron.id?candidate:item)}
    if(!confirmPlanningOrder(candidate,candidateState))return false
    setSelectingProtectTarget(false)
    setPlanningStep('idle')
    setPlanningRosterMode('closed')
    return true
  }
  const selectProtectAsset=(id:string)=>{
    if(isPlanReadOnly())return
    const asset=match.playerAssets.find(item=>item.id===id)
    const squadron=match.squadrons.find(item=>item.id===match.selectedId)
    if(!asset||!squadron||squadron.mission!=='defensive-cap')return
    const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const generated=generateRouteTemplate({template:'defensive-cap',ingress:[[...launch] as Point,[...asset.position] as Point],maxDistance:flightRangeFor(squadron),bounds:match.world.presentationBounds})
    const station=generated.ingress.at(-1)
    if(!station||Math.hypot(station[0]-asset.position[0],station[1]-asset.position[1])>.1){setRouteNotice('SITE OUT OF REACH · CHOOSE A CLOSER PROTECTION POINT');return}
    const candidate={...squadron,protectedPoint:[...asset.position] as Point,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,recoveryWaypoints:undefined,plannedRecoveryFieldId:undefined}
    finishProtectOrder(squadron,candidate,match)
  }
  const selectProtectPoint=(point:Point)=>{
    if(isPlanReadOnly())return
    const squadron=match.squadrons.find(item=>item.id===match.selectedId)
    if(!selectingProtectTarget||!squadron)return
    const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const generated=generateRouteTemplate({template:'defensive-cap',ingress:[[...launch] as Point,[...point] as Point],maxDistance:flightRangeFor(squadron),bounds:match.world.presentationBounds})
    const station=generated.ingress.at(-1)
    if(!station||Math.hypot(station[0]-point[0],station[1]-point[1])>.1){setRouteNotice('POINT OUT OF REACH · CHOOSE A CLOSER PROTECTION POINT');return}
    const candidate={...squadron,protectedPoint:[...point] as Point,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,recoveryWaypoints:undefined,plannedRecoveryFieldId:undefined}
    finishProtectOrder(squadron,candidate,match)
  }
  const protectTarget=selected.protectedTargetId?match.squadrons.find(item=>item.id===selected.protectedTargetId):undefined
  const protectAsset=selected.protectedPoint?match.playerAssets.find(asset=>Math.hypot(asset.position[0]-selected.protectedPoint![0],asset.position[1]-selected.protectedPoint![1])<.01):undefined
  const protectSummary=selected.mission==='defensive-cap'?(protectTarget?`ESCORT ${protectTarget.callsign} · MAX RANGE`:selected.protectedPoint?`DEFEND ${protectAsset?.name??protectAsset?.kind.toUpperCase()??'ROUTE ENDPOINT'}`:undefined):undefined
  const selectProtectFlight=(id:string)=>{if(isPlanReadOnly())return;const squadron=match.squadrons.find(item=>item.id===match.selectedId);const target=match.squadrons.find(item=>item.id===id);if(!squadron||squadron.mission!=='defensive-cap'||!target||target.id===squadron.id||!reviewedIds.has(target.id)||target.aircraft<=0)return;const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase;const escortRecovery=match.playerAssets.find(asset=>asset.id===squadron.plannedRecoveryFieldId)?.position??launch;const targetLaunch=formationField(match.playerAssets,target.id)?.position??target.route[0];const targetRecovery=match.playerAssets.find(asset=>asset.id===target.plannedRecoveryFieldId)?.position??targetLaunch;const targetRoute=target.route.at(-1)&&pointDistance(target.route.at(-1)!,targetRecovery)<.03?target.route:[...target.route,[...targetRecovery] as Point];const route=maxEscortRoute(launch,targetRoute,escortRecovery,flightRangeFor(squadron));if(route.length<2){setRouteNotice('NO FIGHTER RANGE AVAILABLE FOR THIS ESCORT');return}const candidate={...squadron,protectedTargetId:target.id,protectedPoint:undefined,route,routeIngress:route,recoveryWaypoints:undefined,plannedRecoveryFieldId:undefined};setRouteNotice('ESCORT ROUTE DRAWN TO MAX FIGHTER RANGE · CONFIRM ORDER');finishProtectOrder(squadron,candidate,match)}
  const setReconPosture=(posture:ReconPosture)=>{if(isPlanReadOnly())return;const id=match.selectedId;setMatch(current=>({...current,squadrons:current.squadrons.map(squadron=>squadron.id===id&&squadron.role==='recon'?{...squadron,reconPosture:posture}:squadron)}))}
  const selectPlanningFormation=(id:string)=>{
    if(isPlanReadOnly()){
      setMatch(current=>({...current,selectedId:id}))
      return
    }
    if(id===selected.id){
      if(planningStep!=='idle')return
      setSelectingProtectTarget(false)
      setRouteNotice(undefined)
      setPlanningRosterMode('closed')
      setPlanningStep(reviewedIds.has(id)||selected.role==='recon'?'route':'mission')
      return
    }
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
  const selectPlanningBase=(id:string)=>{if(isPlanReadOnly()||!planningBaseGroups.some(group=>group.base.id===id))return;setPlanningBaseId(id);setPlanningRosterMode('closed');setPlanningStep('idle');setRouteNotice(undefined)}
  const selectExecutionBase=(id:string)=>{const base=match.playerAssets.find(asset=>asset.id===id&&(asset.kind==='base'||asset.kind==='fob'));if(!base)return;setExecutionBaseId(id);setFollowId(undefined);setFocusPoint([...base.position]);setCameraFocusRequestKey(key=>key+1)}
  const focusAirfield=()=>{const id=match.playerAssets.find(asset=>asset.kind==='base')?.id;if(id)selectExecutionBase(id)}
  const focusEvent=(event:CombatEvent)=>{const target=match.squadrons.find(s=>event.detail.includes(s.callsign));if(target){setFollowId(target.id);setMatch(m=>({...m,selectedId:target.id}))}else setFollowId(undefined);if(event.position)setFocusPoint(event.position);setActiveEvent(event)}
  const selectEconomyTarget=(target:EconomyTarget,focus=true)=>{closeProcurement();setEconomyTarget(target);setSelectedAssetId(target.kind==='asset'?target.id:undefined);setInspectedFlightId(undefined);const point=target.kind==='asset'?[...match.playerAssets,...match.enemyAssets.filter(asset=>!asset.hidden&&asset.intel!=='unknown')].find(asset=>asset.id===target.id)?.position:target.kind==='squadron'?match.playerAssets.find(asset=>asset.id===formationBaseId(planningBaseGroups,target.id))?.position:undefined;setFocusPoint(focus?point:undefined)}
  const purchaseEconomy=(command:EconomyCommand)=>onlineSession?void sendOnlineAction({type:'purchase',actionId:command.actionId,target:command.target,placement:command.placement,upgradeId:command.upgradeId}):setMatch(state=>executeEconomyCommand(state,command))
  const changeProcurementMode=(mode:ProcurementMode)=>{setFocusPoint(undefined);setProcurementMode(mode);if(mode!=='placing')setProcurementPlacement(undefined);if(mode==='catalog'){setProcurementActionId(undefined);setSelectedAssetId(undefined);setEconomyTarget({kind:'campaign',id:'campaign'})}if(mode==='closed'){setProcurementActionId(undefined);setSelectedAssetId(undefined);setEconomyTarget({kind:'campaign',id:'campaign'})}}
  const selectProcurementAction=(actionId:EconomyActionId)=>{setFocusPoint(undefined);setProcurementActionId(actionId);setProcurementPlacement(undefined);setProcurementMode('placing');setEconomyTarget({kind:'campaign',id:'campaign'})}
  const procurementDefinition=PROCUREMENT_CATALOG.find(item=>item.actionId===procurementActionId)
  const validProcurementPoint=useCallback((point:Point)=>procurementDefinition?validateAssetPlacement(match,procurementDefinition.kind,point).valid:false,[match,procurementDefinition])
  const stageProcurementPlacement=useCallback((point:Point)=>{if(!procurementDefinition||!validProcurementPoint(point))return;const quote=economyQuotesFor(match,{kind:'campaign',id:'campaign'}).find(item=>item.id===procurementDefinition.actionId);if(!quote?.eligible)return;setProcurementPlacement(point)},[match,procurementDefinition,validProcurementPoint])
  const confirmProcurementPlacement=useCallback(()=>{if(!procurementDefinition||!procurementPlacement||!validProcurementPoint(procurementPlacement))return;const quote=economyQuotesFor(match,{kind:'campaign',id:'campaign'}).find(item=>item.id===procurementDefinition.actionId);if(!quote?.eligible)return;const command=economyCommandForQuote(match,quote);if(onlineSession)void sendOnlineAction({type:'purchase',actionId:command.actionId,target:command.target,placement:procurementPlacement,upgradeId:command.upgradeId});else setMatch(state=>executeEconomyCommand(state,{...command,placement:procurementPlacement}));setProcurementMode('closed');setProcurementActionId(undefined);setProcurementPlacement(undefined)},[match,onlineSession,procurementDefinition,procurementPlacement,sendOnlineAction,validProcurementPoint])

  const startCampaign=(difficulty:CpuDifficulty)=>{resetPlanningUi();setPlacementId('p-base');setEconomyTarget({kind:'campaign',id:'campaign'});setMatch(createCampaignDraft(freshCampaignSeed(),difficulty));setHasCampaign(true);setMenuOpen(false)}
  const exitOnline=()=>{onlineRef.current=undefined;inFlightCommandRef.current=undefined;retryCommandRef.current=undefined;setOnlineSession(undefined);setOnlineView(undefined);setOnlineInvite(undefined);setOnlineError(undefined);setOnlineCommandError(undefined);setOnlineCommandBusy(false);setSubmittingPlan(undefined);const backup=localBackupRef.current??loadMatch();localBackupRef.current=undefined;resetPlanningUi();setMatch(backup.match);setHasCampaign(backup.hasCampaign);setMenuOpen(true)}
  const forgetOnline=()=>{try{localStorage.removeItem(ONLINE_SESSION_KEY)}catch{}setSavedOnlineSession(undefined);exitOnline()}
  const continueOnline=()=>{if(!savedOnlineSession)return;localBackupRef.current={match,hasCampaign};resetPlanningUi();onlineRef.current={session:savedOnlineSession};setOnlineSession(savedOnlineSession);setOnlineView(undefined);setOnlineInvite(undefined);setOnlineError(undefined);setOnlineCommandError(undefined);setMenuOpen(false)}
  if(menuOpen&&!onlineSession)return <CampaignMenu saved={hasCampaign?match:undefined} savedOnline={ONLINE_UI_ENABLED&&Boolean(savedOnlineSession)} onContinueOnline={ONLINE_UI_ENABLED?continueOnline:undefined} onContinue={()=>setMenuOpen(false)} onStart={startCampaign} onCreateOnline={ONLINE_UI_ENABLED?entry=>attachOnline(entry.session,entry.view,entry.invite):undefined} onJoinOnline={ONLINE_UI_ENABLED?entry=>attachOnline(entry.session,entry.view):undefined}/>
  if(onlineSession&&!onlineView)return <main className="online-reconnect"><section><small>ONLINE SESSION</small><h1>RECONNECTING</h1><p>{onlineError??'Restoring your seat and loading the latest match state…'}</p><button type="button" onClick={exitOnline}>RETURN TO MENU</button><button type="button" className="forget-online" onClick={forgetOnline}>CLEAR SAVED ONLINE SEAT</button></section></main>

  return <main className="app-shell">
    <div className={`game-frame phase-${visiblePhase} ${planningStep!=='idle'||visiblePhase==='execute'&&executionBaseId?'shelf-open chit-queue-open':''} ${planningStep==='route'?'route-step-open':''} ${planningRosterMode!=='closed'?'roster-open':''}`}>
      <TopBar round={match.round} phase={visiblePhase} debugScenario={match.debugScenario??'campaign'} onDebugScenario={selectScenario} onReboot={restart} onMenu={onlineSession?exitOnline:()=>setMenuOpen(true)} onlineStatus={onlineStatus}/>
      {onlineSession&&visiblePhase!=='deploy'?<div className="pvp-base-health" aria-label="Airfield health">
        <span>Home base <b>{Math.round(liveHomeHealth)} HP</b></span>
        <span>Enemy base <b>{enemyBaseOnMap?`${Math.round(enemyBaseOnMap.health)} HP`:'Unknown'}</b></span>
      </div>:null}
      {onlineInvite&&!onlineView?.joined ? <OnlineInviteCode key={onlineInvite} code={onlineInvite}/> : null}
      {(onlineCommandError||onlineError)?<div className="online-command-error" role="alert"><span>{onlineCommandError??onlineError}</span><button type="button" disabled={onlineCommandBusy} onClick={retryOnline}>RETRY</button></div>:null}
      <div className="map-wrap"><Battlefield cameraMemory={cameraMemory} squadrons={planningSquadrons} assets={replayMatch.enemyAssets} playerAssets={match.phase==='deploy'&&match.setup?replayMatch.playerAssets.filter(asset=>SETUP_REQUIRED_ASSET_IDS.includes(asset.id as typeof SETUP_REQUIRED_ASSET_IDS[number])&&(match.setup!.placedAssetIds.includes(asset.id)||asset.id===placementId)):replayMatch.playerAssets} mappedAreas={match.mappedAreas} discoveredBoundaries={match.discoveredBoundaries} presentationBounds={match.world.presentationBounds} planningBounds={activeMapPlanningBounds} friendlyTerritory={friendlyTerritory} selectedId={match.selectedId} followId={followId} focusPoint={focusPoint} focusRequestKey={cameraFocusRequestKey} placementId={placementId} positionedPlacementIds={match.setup?.placedAssetIds} showDefenseCoverage={showDefenseCoverage} groundAssetsProjected={Boolean(projectedGround)} onPlacementSelect={id=>{if(!onlineView?.locked&&!onlineCommandBusy)setPlacementId(id)}} planningBaseId={activePlanningBaseId} executionBaseId={executionBaseId} planningRecoveryFieldId={match.phase==='plan'&&recoveryView&&selectedLaunchField&&recoveryView.intendedField.id!==selectedLaunchField.id?recoveryView.intendedField.id:undefined} plannedFormationIds={displayedOrderIds} routeOrigin={selectedLaunchField?.position} editingReturn={editingReturn} recoveryRoute={recoveryView?.recoveryRoute} onReturnWaypoints={setReturnWaypoints} routePlanningEnabled={!waitingOnPlan&&planningStep==='route'} lockedPlan={waitingOnPlan} showMissionPreview={waitingOnPlan?Boolean(selected.sortieOrdered):planningStep==='route'} selectingGroundTarget={pickingGroundTarget} onGroundTargetSelect={selectGroundTarget} selectedAssetId={selectedAssetId} inspectedFlightId={inspectedFlightId} onAssetInspect={inspectAsset} onFlightInspect={inspectFlight} selectingProtectTarget={!waitingOnPlan&&selectingProtectTarget} escortPreview={protectTarget?{targetId:protectTarget.id}:undefined} phase={visiblePhase} progress={executionProgress} activeEvent={executionEvent} executionResult={executionResult??(match.phase==='debrief'||match.phase==='adapt'?match.lastResult:undefined)} packageReview={false} economySelectionId={economyTarget.kind==='campaign'?undefined:economyTarget.id} onPlanningBaseSelect={selectPlanningBase} onPlanningFormationSelect={selectPlanningFormation} onPlanningProtectTarget={selectProtectAsset} onPlanningProtectPoint={selectProtectPoint} onPlanningProtectFlight={selectProtectFlight} onPlanningRecoverySelect={routeToAirfield} onExecutionBaseSelect={selectExecutionBase} onEconomySelect={id=>selectEconomyTarget({kind:'asset',id},false)} onEconomyFormationSelect={id=>selectEconomyTarget({kind:'squadron',id},false)} construction={match.phase==='adapt'&&procurementMode==='placing'&&procurementDefinition?{kind:procurementDefinition.kind,placement:procurementPlacement,isValid:validProcurementPoint,onStage:stageProcurementPlacement}:undefined} isPlacementValid={match.phase==='deploy'&&(onlineSession||!match.setup||match.setup.stage==='place'||match.setup.stage==='review')?point=>validateInitialPlacement(match,placementId,point).length===0:undefined} onRoute={setRoute} onPlace={match.phase==='deploy'&&(onlineSession||match.setup?.stage==='place'||match.setup?.stage==='review'||!match.setup)?stageInitialPlacement:()=>{}}/>
        {match.phase!=='adapt'&&inspectedAsset?<AssetInspector asset={inspectedAsset} sites={inspectionSites} enemy={inspectingEnemy} phase={visiblePhase} result={inspectionResult} seconds={inspectionSeconds} onClose={()=>setSelectedAssetId(undefined)}/>:inspectedAircraft?<AircraftInspector {...inspectedAircraft} onClose={()=>setInspectedFlightId(undefined)}/>:null}
        {match.phase!=='deploy' ? <div className="map-tools" aria-label="Map tools">
          {campaign&&(visiblePhase==='plan'||visiblePhase==='execute') ? <CampaignBriefing match={match} target={strikeTarget} homeHealth={Math.round(liveHomeHealth)} enemyHealth={knownEnemyBaseHealth===undefined?undefined:Math.round(knownEnemyBaseHealth)}/> : null}
          {visiblePhase==='execute' ? <><ContactTracks result={executionResult} seconds={inspectionSeconds} home={playerBase} onFocus={point=>{setFollowId(undefined);setFocusPoint(point)}}/>
            {executionResult?.events.some(event=>event.time<=inspectionSeconds) ? <details name="map-tools" className="map-events"><summary>Events</summary><ObserveEventFeed events={executionResult.events} progress={executionProgress} duration={executionResult.duration} onFocus={focusEvent}/></details> : null}</> : null}
          {visiblePhase!=='debrief'?<button type="button" className="defense-map-toggle" aria-label="Defense coverage" aria-pressed={showDefenseCoverage} onClick={()=>setShowDefenseCoverage(value=>!value)}><ShieldCheck/> Defense</button>:null}
          {!replayActive ? <button className="world-map-toggle" type="button" onClick={()=>setWorldMapOpen(true)}><MapIcon/> Map</button> : null}
        </div> : null}
        {worldMapOpen?<div className="known-world-modal" role="dialog" aria-modal="true"><KnownWorldMap model={knownWorld} onClose={()=>setWorldMapOpen(false)}/></div>:null}
      {match.phase==='plan'&&!waitingOnPlan&&planningStep==='idle'?<div className="map-tip"><span>TAP AIRFIELD</span> START FORMATION PLANNING</div>:null}
        {visiblePhase==='execute'?<ExecutionOverlay progress={executionProgress} speed={speed} onSpeed={()=>setSpeed(s=>s===1?2:1)} match={replayMatch} result={executionResult} selectedId={match.selectedId} followId={followId} onSelectFormation={selectFormation} onClearFollow={()=>setFollowId(undefined)} onAirfield={focusAirfield}/>:null}
      </div>
      {visiblePhase==='execute'&&executionBaseId?<ExecutionChitRail squadrons={match.squadrons} bases={replayMatch.playerAssets} result={executionResult} progress={executionProgress} activeBaseId={executionBaseId} selectedId={match.selectedId} followId={followId} threatenedIds={new Set((executionResult?.threatAlerts??[]).filter(alert=>alert.time<=inspectionSeconds&&!acknowledgedThreatIds.has(alert.id)).map(alert=>alert.unitId))} onSelect={selectFormation}/>:null}
      {match.phase==='deploy'&&onlineSession&&onlineView?.locked?<section className="online-wait-panel"><small>DEPLOYMENT LOCKED</small><strong>{onlineView.opponentLocked?'BOTH DEPLOYMENTS LOCKED':'WAITING FOR OPPONENT TO LOCK'}</strong><p>Your opening package is fixed for this match.</p></section>:match.phase==='deploy'&&match.setup?<CampaignSetupPanel match={match} online={Boolean(onlineSession)} placementId={placementId} onSelectPlacement={id=>{if(!onlineView?.locked&&!onlineCommandBusy)setPlacementId(id)}} onContinue={()=>onlineSession?void sendOnlineAction({type:'lock-deploy'}):advanceCampaignSetup()}/>:match.phase==='deploy'?<DeploymentPanel assets={match.playerAssets} selectedId={placementId} onSelect={setPlacementId} locked={Boolean(onlineView?.locked||onlineCommandBusy)} online={Boolean(onlineSession)} onLock={()=>onlineSession?void sendOnlineAction({type:'lock-deploy'}):setMatch(m=>({...m,phase:'plan'}))}/>:null}
      {match.phase==='plan'&&waitingOnPlan?<section className="online-wait-panel" aria-label="Read-only plan"><strong>{onlineView?.locked?'Orders locked':onlineCommandBusy?'Locking orders…':'Checking submitted orders'}</strong><p>{onlineView?.locked?'Tap an aircraft to review its orders.':'Your submitted routes are frozen.'}</p></section>:null}
      {match.phase==='plan'&&!waitingOnPlan?<CommandShelf squadrons={match.squadrons} bases={match.playerAssets} activeBaseId={activePlanningBaseId} rosterMode={planningRosterMode} squadron={selected} routeNotice={routeNotice} routeBudget={routeBudget} protectSummary={protectSummary} editingReturn={editingReturn} cpuPlanning={cpuPlanningRound===match.round} cpuPlanError={Boolean(cpuPlanError)} onRouteLegChange={canEditReturn&&!selectingProtectTarget?returnLeg=>{setEditReturn(returnLeg);setRouteNotice(undefined)}:undefined} onSelect={selectPlanningFormation} onBaseSelect={selectPlanningBase} onRosterMode={mode=>{setPlanningRosterMode(mode);if(mode!=='closed'){setPlanningStep('idle');setSelectingProtectTarget(false)}}} onMission={selectMission} onPickProtectTarget={()=>{setSelectingProtectTarget(true);setRouteNotice(undefined)}} onProtectFlight={selectProtectFlight} onReconPosture={setReconPosture} onRecoverHome={selected.role==='fighter'||canEditReturn?()=>routeToAirfield('p-base',true):undefined} onClear={()=>{setRouteNotice(undefined);if(selectingProtectTarget)setSelectingProtectTarget(false);else if(editingReturn)setReturnWaypoints([]);else setRoute([])}} onBack={()=>{setPlanningStep('mission');setSelectingProtectTarget(false);setRouteNotice(undefined)}} onCommit={()=>commit(planningStep==='route')} step={planningStep} onClose={()=>{if(planningStep==='route'&&selected.route.length>=2&&!selectingProtectTarget&&!confirmPlanningOrder(selected))return;setPlanningStep('idle');setSelectingProtectTarget(false)}} reviewedIds={reviewedIds} reviewedCount={reviewedCount} totalCount={viableFormationIds.length} groundTargets={groundTargets} onChangeGroundTarget={changeGroundTarget} onInspectGroundTarget={inspectAsset} strikeUnlocked={groundTargets.length>0} strikeDisabledReason="RECOVER GROUND TARGET INTELLIGENCE FIRST" selectingProtectTarget={selectingProtectTarget} onlineLock={Boolean(onlineSession)} allowEmptyCommit={Boolean(onlineSession)}/>:null}
      {match.phase==='debrief'&&match.lastResult&&!replayActive?<Debrief match={match} onFocus={point=>{setFollowId(undefined);setFocusPoint([...point] as Point)}} onResupply={enterResupply} pending={onlineCommandBusy}/>:null}
      {match.phase==='adapt'?<ResupplyPanel match={match} busy={onlineCommandBusy} cpuAdapting={cpuAdaptingRound===match.round} nextRoundDisabled={cpuAdaptingRound===match.round} cpuPlanError={Boolean(cpuPlanError)} selectedTarget={economyTarget} onSelectTarget={selectEconomyTarget} onCloseTarget={()=>selectEconomyTarget({kind:'campaign',id:'campaign'})} onPurchase={purchaseEconomy} onNextRound={nextRound} procurementMode={procurementMode} procurementActionId={procurementActionId} onProcurementMode={changeProcurementMode} onProcurementAction={selectProcurementAction} hasPlacementPreview={Boolean(procurementPlacement)} onConfirmPlacement={confirmProcurementPlacement} onCancelPlacement={()=>setProcurementPlacement(undefined)}/>:null}
      {(match.phase==='victory'||match.phase==='defeat'||match.phase==='draw')?<EndState victory={match.phase==='victory'} round={match.round} outcome={campaignOutcome(match)} onRestart={()=>setMenuOpen(true)}/>:null}
    </div>
  </main>
}

function DeploymentPanel({assets,selectedId,onSelect,onLock,locked=false,online=false}:{assets:Asset[];selectedId:string;onSelect:(id:string)=>void;onLock:()=>void;locked?:boolean;online?:boolean}){
  return <section className="deployment-panel" aria-label="Site placement">
    <div className="deployment-head"><h2>Place your sites</h2></div>
    <p>{locked?'Waiting for the other player.':'Select a site. Tap a highlighted hex.'}</p>
    <div className="asset-picker">{assets.map(asset=><button type="button" key={asset.id} disabled={locked}
      aria-pressed={asset.id===selectedId} className={asset.id===selectedId?'active':''} onClick={()=>onSelect(asset.id)}>
      <b>{asset.kind==='base'?'MAIN AIRFIELD':asset.kind.toUpperCase()}</b>
    </button>)}</div>
    <button type="button" className="commit" disabled={locked} onClick={onLock}>{online?'Lock deployment':'Begin planning'} <span aria-hidden="true">››</span></button>
  </section>
}

function ExecutionOverlay({progress,speed,onSpeed,match,result,selectedId,followId,onSelectFormation,onClearFollow,onAirfield}:{
  progress:number;speed:number;onSpeed:()=>void;match:MatchState;result?:RoundResult;selectedId:string;followId?:string
  onSelectFormation:(id:string)=>void;onClearFollow:()=>void;onAirfield:()=>void
}){
  const seconds=progress*(result?.duration??22)
  return <div className="execute-hud">
    <div className="timer live" aria-label={`${seconds.toFixed(1)} seconds elapsed`}><i style={{width:`${Math.min(100,match.phase==='debrief'?progress*100:seconds/60*100)}%`}}/></div>
    <div className="execute-view-controls">
      <button type="button" onClick={onAirfield}><LocateFixed/> Home</button>
      <button type="button" onClick={()=>followId?onClearFollow():onSelectFormation(selectedId)}>{followId?'Free look':'Track'}</button>
      <button type="button" onClick={onSpeed} aria-label={`Playback speed ${speed} times`}><FastForward/>{speed}×</button>
    </div>
    <FormationDock squadrons={match.squadrons} bases={match.playerAssets} result={result} progress={progress} selectedId={selectedId} followId={followId} onSelect={onSelectFormation} onClearFollow={onClearFollow} onAirfield={onAirfield}/>
  </div>
}

export function Debrief({match,onFocus,onResupply,pending=false}:{match:MatchState;onFocus:(point:Point)=>void;onResupply:()=>void;pending?:boolean}){
  const result=match.lastResult!
  const outcome=campaignOutcome(match)
  const message=outcome?campaignOutcomeMessage(outcome):undefined
  const intel=result.intelReports.filter(report=>report.recovered).map(report=>result.assets.find(asset=>asset.id===report.assetId)).filter((asset):asset is Asset=>!!asset)
  const losses=result.friendlyAttrition.filter(item=>item.aircraftLost>0)
  const {base,intel:intelIncome,enemyAircraft,total}=result.logisticsIncome
  const depotPay=Math.max(0,base-LOGISTICS_EFFECTS.baseIncome)
  const enemyBase=match.enemyAssets.find(asset=>asset.kind==='base'&&asset.intel==='confirmed'&&!asset.hidden)
  const orders=missionOrderDebrief(match,result)
  const sites=useMemo(()=>debriefMapSites(result),[result])
  return <section className="debrief briefing debrief-summary" aria-label="After action summary">
    <div className="debrief-content">
    <header><div><small>MISSION COMPLETE</small><h2>AFTER ACTION</h2></div>{message?<strong className="debrief-outcome">{message.title}</strong>:null}</header>
    <div className="debrief-metrics"><div><strong>{result.friendlyLosses}</strong><span>FRIENDLY LOST</span></div><div><strong>{result.enemyLosses}</strong><span>ENEMY LOST · CONFIRMED</span></div><div><strong>{intel.length}</strong><span>INTEL RECOVERED</span></div></div>
    <section className="debrief-cash" aria-label="Cash earned this round">
      <header><b>Cash earned this round</b><strong>+{formatCash(total)}</strong></header>
      <dl>
        <div><dt>Round pay</dt><dd>+{formatCash(base-depotPay)}</dd></div>
        {depotPay>0?<div><dt>Supply Depot</dt><dd>+{formatCash(depotPay)}</dd></div>:null}
        <div><dt>Recovered intelligence <small>{formatCash(LOGISTICS_EFFECTS.intelRecovery)} per new site</small></dt><dd>{intelIncome>0?'+':''}{formatCash(intelIncome)}</dd></div>
        <div><dt>Confirmed enemy aircraft lost <small>{formatCash(LOGISTICS_EFFECTS.confirmedEnemyAircraft)} per aircraft</small></dt><dd>{enemyAircraft>0?'+':''}{formatCash(enemyAircraft)}</dd></div>
      </dl>
    </section>
    <DebriefLegend/>
    <p className="debrief-map-note">Reported locations only. Unlocated losses remain in the totals.</p>
    <div className="debrief-highlights" aria-label="Round highlights"><small>ROUND HIGHLIGHTS · SELECT A SITE TO FOCUS</small>
      {sites.length?sites.map(site=><button key={site.id} onClick={()=>onFocus([...site.position])} className={`debrief-site ${primaryDebriefEvent(site).side}`}>
        <span className="debrief-site-number">{site.number}</span><DebriefSymbol kind={primaryDebriefEvent(site).kind}/>
        <span className="debrief-site-reports">{site.events.map(event=><span key={event.id}><b>{event.title}</b><span>{event.detail}</span><time>{event.time.toFixed(1)}s</time></span>)}</span><ChevronRight/>
      </button>):<p>No combat, aircraft losses, or new intelligence reported this round.</p>}
    </div>
    {orders.length?<div className="debrief-orders" aria-label="Mission orders and results"><small>ORDERS & RESULTS</small>{orders.map(order=><p key={order.id}><b>{order.callsign} · {order.purpose}</b><span>{order.result}</span></p>)}</div>:null}
    {isCampaign(match)?<div className="debrief-campaign"><span>HOME BASE <b>{Math.round(match.playerBaseHealth)} HP</b></span>
      {enemyBase?<span>ENEMY BASE <b>{Math.round(enemyBase.health)} HP</b></span>:result.enemyBaseDamage>0?<span>ENEMY BASE DAMAGE <b>−{result.enemyBaseDamage} HP</b></span>:null}</div>:null}
    {message?<p className="debrief-message">{message.message}</p>:null}
    {losses.length||intel.length?<details className="debrief-details"><summary>VIEW FORMATION & INTEL DETAILS</summary><div>{losses.map(item=><p key={item.id}>{item.callsign}: {item.startAircraft} → {item.endAircraft} AIRCRAFT · {item.endStrength}% STRENGTH</p>)}{intel.map(asset=><button key={asset.id} onClick={()=>onFocus(asset.position)}>NEW INTEL · {asset.kind.toUpperCase()} · FOCUS MAP</button>)}</div></details>:null}
    </div>
    <div className="debrief-actions"><button type="button" className="debrief-continue" disabled={pending} onClick={onResupply}>{pending?'LOADING…':message?'VIEW OUTCOME':'OPEN RESUPPLY'} <ChevronRight/></button></div>
  </section>
}

export function campaignOutcomeMessage(outcome:NonNullable<ReturnType<typeof campaignOutcome>>){
  switch(outcome){
    case 'enemy-base-destroyed':return{title:'ENEMY BASE DESTROYED',message:'Your strike destroyed the enemy base.'}
    case 'home-base-destroyed':return{title:'HOME BASE DESTROYED',message:'Enemy strikes destroyed your home base.'}
    case 'deadline':return{title:'DEADLINE REACHED',message:`Draw. Both bases survived through the deadline.`}
    case 'mutual-destruction':return{title:'DRAW',message:'Draw. Both bases were destroyed in the same round.'}
    case 'mutual-forces-lost':return{title:'DRAW',message:'Draw. Both sides lost all formations and reserve aircraft.'}
    case 'enemy-forces-lost':return{title:'ENEMY FORCES LOST',message:'All enemy formations were lost and the enemy could not buy a reinforcement.'}
    case 'forces-lost':return{title:'FORCES LOST',message:'All formations were lost and the cash balance could not cover a reinforcement.'}
  }
}

export function EndState({victory,round,outcome,onRestart}:{victory:boolean;round:number;outcome:ReturnType<typeof campaignOutcome>;onRestart:()=>void}){
  const draw=outcome==='deadline'||outcome==='mutual-destruction'||outcome==='mutual-forces-lost'
  const title=draw?'DRAW':outcome==='forces-lost'?'FORCES LOST':victory?'BREAKTHROUGH':'COMMAND LOST'
  const message=outcome?campaignOutcomeMessage(outcome).message:victory?'Enemy command aviation has been destroyed.':'Your home base has been rendered inoperable.'
  return <section className={`end-state ${draw?'draw':victory?'win':'loss'}`}><div className="end-icon">{victory?<ShieldCheck/>:<AlertTriangle/>}</div><small>CAMPAIGN ENDED · ROUND {String(round).padStart(2,'0')}</small><h1>{title}</h1><p>{message}</p><button onClick={onRestart}><RotateCcw/> NEW CAMPAIGN</button></section>
}
