import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, FastForward, LocateFixed, RotateCcw, ShieldCheck, Zap } from 'lucide-react'
import { Battlefield, type CameraPoseSnapshot } from './components/Battlefield'
import { AircraftInspector, AssetInspector } from './components/UnitInspector'
import { CampaignSetupPanel } from './components/CampaignSetupPanel'
import { CampaignMenu } from './components/CampaignMenu'
import { fetchOnlineMatch, OnlineInviteCode, OnlineRequestError, sendOnlineCommand } from './components/OnlineClient'
import type { CpuDifficulty } from './game/cpu/types'
import { prepareCpuRound } from './game/cpu/planner'
import { ResupplyPanel, type ProcurementMode } from './components/ResupplyPanel'
import type { PurchaseCategory } from './components/PurchaseCatalog'
import { CampaignBriefing } from './components/CampaignBriefing'
import { CommandShelf, ContactTracks, ExecutionChitRail, FormationDock, ObserveEventFeed, TopBar, type PlanningStep } from './components/Hud'
import { createCampaignDraft } from './game/data'
import { freshCampaignSeed } from './game/campaignLayout'
import { campaignOutcome, confirmedStrikeTarget, groundStrikeTargets, isCampaign } from './game/campaign'
import { initialPlacementValidator, placeInitialAsset } from './game/campaignPlacement'
import { confirmCampaignSetup, validateCampaignAllocation, SETUP_REQUIRED_ASSET_IDS } from './game/campaignSetup'
import { applyRound, createRoundSimulation, EXECUTION_SECONDS, resolveRound, TICK_SECONDS, type RoundSimulationController } from './game/engine'
import { flightRangeFor } from './game/flightRules'
import { advanceReplayTime } from './game/frameClock'
import { economyAttentionTargets, advanceToNextRound, constructionPlacementValidator, economyCommandForQuote, economyQuotesFor, executeEconomyCommand, openAdaptPhaseImmediately, PROCUREMENT_CATALOG } from './game/economy'
import { formatCash, LOGISTICS_EFFECTS } from './game/economyRules'
import { snapToHex } from './game/hex'
import { airfieldLabel, formationBaseGroups, formationBaseId } from './game/formationBasing'
import { deriveRecoveryPlanningView, deriveRouteBudget, formationField, isOperationalAirfield, MAX_RECOVERY_WAYPOINTS, routeDistanceForBasing, transitDestination, validateRecoveryPackage } from './game/forwardBasing'
import { generateRouteTemplate, protectOrbit, validateBomberOrderForPlayer, validateGroundStrikeOrder } from './game/routeTemplates'
import { normalizeMatch } from './game/persistence'
import { planBombingTarget, removeBombingTarget } from './game/groundStrikePlanning'
import { approachWaypoints, mapProtectOrder, mapStrikeOrder, resetMapOrder } from './game/mapPlanning'
import { isDefenseSite, surveyedDefenseSites } from './game/defenseIntel'
import { aircraftInspectionAt } from './game/unitCards'
import { debriefMapSites } from './game/debriefMap'
import { DebriefSymbol } from './components/DebriefSymbols'
import { missionOrderDebrief } from './game/missionDebrief'
export { normalizeMatch }
import { withoutLastPlanningWaypoint, viablePlanningFormationIds } from './game/planningQueue'
import { observedGroundSiteIdsAt, projectGroundAssetAt, projectOnlineGroundReplay } from './game/executionProjection'
import {createScenario} from './game/scenarios'
import { deriveKnownEnvelope, derivePlanningEnvelope } from './game/world'
import { friendlyTerritoryForAssets } from './game/territory'
import { terrainKnownWithin } from './game/terrain'
import { maxEscortRoute } from './game/escortRoute'
import type { Asset, CombatEvent, DebugScenario, EconomyActionId, EconomyCommand, EconomyTarget, MatchState, Point, ReconPosture, RoundResult, Squadron } from './game/types'
import type { OnlineAction, OnlineCommand, OnlineResponse, OnlineSession, OnlineView } from './online/protocol'
import { unpackDisplayTerrain } from './online/displayTerrain'

const SAVE_KEY='dead-reckoning-mvp-v27'
const ONLINE_SESSION_KEY='dead-reckoning-online-session-v1'
const ONLINE_PLAYBACK_KEY='dead-reckoning-online-playback-v1'
const ONLINE_UI_ENABLED=import.meta.env.MODE==='online'
const CPU_WORK_TIMEOUT_MS = 12_000
const LEGACY_SAVE_KEYS=['dead-reckoning-mvp-v26','dead-reckoning-mvp-v25','dead-reckoning-mvp-v24','dead-reckoning-mvp-v23','dead-reckoning-mvp-v22','dead-reckoning-mvp-v21','dead-reckoning-mvp-v20','dead-reckoning-mvp-v19','dead-reckoning-mvp-v18','dead-reckoning-mvp-v17','dead-reckoning-mvp-v16','dead-reckoning-mvp-v15','dead-reckoning-mvp-v14','dead-reckoning-mvp-v13','dead-reckoning-mvp-v12','dead-reckoning-mvp-v11','dead-reckoning-mvp-v10','dead-reckoning-mvp-v9']
function loadMatch():{match:MatchState;hasCampaign:boolean}{try{const saved=localStorage.getItem(SAVE_KEY);if(saved)return {match:normalizeMatch(JSON.parse(saved)),hasCampaign:true}}catch{}return {match:createCampaignDraft(),hasCampaign:false}}
function loadOnlineSession():OnlineSession|undefined{try{const raw=localStorage.getItem(ONLINE_SESSION_KEY);if(!raw)return;const session=JSON.parse(raw) as OnlineSession;return session.matchId&&session.token?session:undefined}catch{return undefined}}
function loadCompletedPlayback(){
  try{return localStorage.getItem(ONLINE_PLAYBACK_KEY)??undefined}catch{return undefined}
}
const pointDistance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
const basingContext=(state:MatchState)=>({...state,terrain:terrainKnownWithin(state.world.terrain,state.mappedAreas,2.65,friendlyTerritoryForAssets(state.world.friendlyTerritory,state.playerAssets))})
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
  const [focusedDebriefEvent,setFocusedDebriefEvent]=useState<string>()
  useEffect(()=>{setFocusedDebriefEvent(undefined)},[match.round,match.phase])
  const [cameraFocusRequestKey,setCameraFocusRequestKey]=useState(0)
  const [routeNotice,setRouteNotice]=useState<string>()
  const [selectedAssetId,setSelectedAssetId]=useState<string>()
  const [inspectedFlightId,setInspectedFlightId]=useState<string>()
  const [planningStep,setPlanningStep]=useState<PlanningStep>('idle')
  const [editReturn,setEditReturn]=useState(false)
  const [planningBaseId,setPlanningBaseId]=useState('p-base')
  const [reviewedIds,setReviewedIds]=useState<Set<string>>(()=>new Set())
  const [cpuPlanningRound,setCpuPlanningRound]=useState<number>()
  const [cpuAdaptingRound,setCpuAdaptingRound]=useState<number>()
  const cpuPlanRequestRef=useRef(0)
  const cancelCpuWorkerRef=useRef<(() => void) | undefined>(undefined)
  const [placementId,setPlacementId]=useState('p-base')
  const [showDefenseCoverage,setShowDefenseCoverage]=useState(true)
  const [economyTarget,setEconomyTarget]=useState<EconomyTarget>({kind:'campaign',id:'campaign'})
  const [procurementMode,setProcurementMode]=useState<ProcurementMode>('closed')
  const [purchaseCategory,setPurchaseCategory]=useState<PurchaseCategory>('Aircraft')
  const [procurementActionId,setProcurementActionId]=useState<EconomyActionId>()
  const [procurementPlacement,setProcurementPlacement]=useState<Point>()
  const resultRef=useRef<ReturnType<typeof resolveRound>|undefined>(undefined)
  const simulationRef=useRef<RoundSimulationController|undefined>(undefined)
  const [liveResult,setLiveResult]=useState<RoundResult>()
  const [acknowledgedThreatIds,setAcknowledgedThreatIds]=useState<Set<string>>(()=>new Set())
  const completingRef=useRef(false)
  useEffect(()=>{speedRef.current=speed},[speed])
  useEffect(()=>()=>{cpuPlanRequestRef.current++;cancelCpuWorkerRef.current?.()},[])
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
      setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined)
      setSelectedAssetId(undefined);setInspectedFlightId(undefined);setActiveEvent(undefined)
      setEconomyTarget({kind:'campaign',id:'campaign'});setProcurementMode('closed');setProcurementActionId(undefined);setProcurementPlacement(undefined)
      setReviewedIds(new Set());setPlanningStep('idle');setRouteNotice(undefined)
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
  const inspectionResult=executionResult??(match.phase==='debrief'?match.lastResult:undefined)
  const inspectionSeconds=replayActive?replaySeconds:inspectionResult?.duration??0
  const observedAssetIds=observedGroundSiteIdsAt(match.phase==='execute'?liveResult:undefined,inspectionSeconds)
  const selectedAsset=[...replayMatch.playerAssets,...replayMatch.enemyAssets.filter(asset=>!asset.hidden&&asset.intel!=='unknown'||observedAssetIds.has(asset.id))].find(asset=>asset.id===selectedAssetId)
  const inspectionAsset=selectedAsset&&(projectedGround?selectedAsset:visiblePhase==='execute'?projectGroundAssetAt(selectedAsset,executionResult,inspectionSeconds):[...inspectionResult?.playerAssets??[],...inspectionResult?.assets??[]].find(asset=>asset.id===selectedAsset.id)??selectedAsset)
  const inspectedAsset=inspectionAsset&&inspectionAsset.health>0
    ? observedAssetIds.has(inspectionAsset.id)&&inspectionAsset.intel==='unknown'
      ? {...inspectionAsset,intel:'probable' as const,hidden:false,confidence:70}
      : inspectionAsset
    : undefined
  const inspectingEnemy=Boolean(inspectedAsset&&replayMatch.enemyAssets.some(asset=>asset.id===inspectedAsset.id))
  const inspectionSites=inspectedAsset?(inspectingEnemy
    ? surveyedDefenseSites(replayMatch.enemyAssets)
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
  const packedTerrain=onlineView?.displayTerrain
  const onlineTerrain=useMemo(()=>unpackDisplayTerrain(packedTerrain),[packedTerrain])
  const visibleTerrain=onlineTerrain??match.world.terrain
  const knownEnvelope=useMemo(()=>deriveKnownEnvelope(match.world,match.mappedAreas,match.discoveredBoundaries,friendlyTerritory),[friendlyTerritory,match.discoveredBoundaries,match.mappedAreas,match.world])
  const planningEnvelope=useMemo(()=>derivePlanningEnvelope(knownEnvelope),[knownEnvelope])
  const activeMapPlanningBounds=match.phase==='plan'?match.world.presentationBounds:planningEnvelope
  const planningBaseGroups=useMemo(()=>formationBaseGroups(match.squadrons,match.playerAssets),[match.playerAssets,match.squadrons])
  const activePlanningBaseId=planningBaseGroups.some(group=>group.base.id===planningBaseId)?planningBaseId:planningBaseGroups[0]?.base.id??'p-base'
  const viableFormationIds=useMemo(()=>viablePlanningFormationIds(match.squadrons),[match.squadrons])
  const reviewedCount=viableFormationIds.reduce((total,id)=>total+Number(reviewedIds.has(id)),0)
  const selectedLaunchField=formationField(planningBaseGroups.map(group=>group.base),selected.id)??match.playerAssets.find(asset=>asset.kind==='base')
  const recoveryView=useMemo(()=>deriveRecoveryPlanningView(basingContext(match),selected.id,selected.route,flightRangeFor(selected)),[match,selected])
  const routeBudget=useMemo(()=>planningStep==='route'
    ? deriveRouteBudget(basingContext(match),selected.id,selected.route,selected.routeIngress,flightRangeFor(selected))
    : undefined,[match,selected,planningStep])
  const canEditReturn=selected.mission!=='transit'&&selected.route.length>=2&&!selected.protectedTargetId&&Boolean(recoveryView?.recoveryRoute.length)
  const editingReturn=planningStep==='route'&&!waitingOnPlan&&canEditReturn&&editReturn
  const editingOrder=match.phase==='plan'&&!waitingOnPlan&&planningStep==='route'
  const pickingGroundTarget=editingOrder&&!editingReturn&&selected.role!=='recon'
  useEffect(()=>{setEditReturn(false)},[match.phase,match.round,planningStep,selected.id])

  const stagePlanningOrder=useCallback((candidate:Squadron,notice?:string)=>{
    setRouteNotice(notice)
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(candidate.id);return next})
    setMatch(current=>({...current,squadrons:current.squadrons.map(s=>s.id===candidate.id?candidate:s)}))
  },[])

  const setRoute=(ingress:Point[])=>{
    if(isPlanReadOnly())return false
    const launch=formationField(match.playerAssets,selected.id)?.position??playerBase
    if(!ingress.length){
      stagePlanningOrder(resetMapOrder(selected,launch))
      setEditReturn(false)
      return true
    }
    const squadron=selected.protectedTargetId?resetMapOrder(selected,launch):selected
    const withOrigin=[launch,...ingress.slice(1)]
    const bounds=match.world.presentationBounds
    const terrain=basingContext(match).terrain
    let route=withOrigin
    if(squadron.protectRadius!==undefined){
      route=protectOrbit(withOrigin,squadron.protectRadius)
    }else if(squadron.mission==='forward-patrol'||squadron.mission==='defensive-cap'){
      const generated=generateRouteTemplate({template:squadron.mission,ingress:withOrigin,maxDistance:flightRangeFor(squadron),bounds,terrain})
      if(generated.ingress.length!==withOrigin.length||generated.adjustment==='ingress-shortened'){
        setRouteNotice('Shorten the approach to leave fuel to return.')
        return false
      }
      route=generated.route
    }
    if([...withOrigin,...route].some(([x,z])=>x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ)){
      setRouteNotice('Keep the route inside the planning map.')
      return false
    }
    const candidate={...squadron,route,routeIngress:withOrigin,
      protectedPoint:squadron.mission==='defensive-cap'&&withOrigin.length>1?withOrigin.at(-1):undefined}
    if(route.length>=2){
      const next={...match,squadrons:match.squadrons.map(s=>s.id===candidate.id?candidate:s)}
      const view=deriveRecoveryPlanningView(basingContext(next),candidate.id,candidate.route,flightRangeFor(candidate))
      const distance=candidate.mission==='transit'?routeDistanceForBasing(route,terrain):view?.missionDistance
      const error=validateGroundStrikeOrder(next,candidate)
      const bomberError=validateBomberOrderForPlayer(next,candidate)
      if(error||bomberError||!view?.valid||distance!==undefined&&distance>flightRangeFor(candidate)+.001){
        setRouteNotice(error??bomberError??view?.reason??'Shorten the approach to leave fuel to return.')
        return false
      }
    }
    stagePlanningOrder(candidate)
    return true
  }
  const setReturnWaypoints=(waypoints:Point[])=>{
    if(isPlanReadOnly()||!editingReturn)return false
    const bounds=match.world.presentationBounds
    if(waypoints.length>MAX_RECOVERY_WAYPOINTS||waypoints.some(([x,z])=>x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ)){
      setRouteNotice('RETURN WAYPOINT IS OUTSIDE THE PLANNING AREA')
      return false
    }
    const next={...match,squadrons:match.squadrons.map(squadron=>squadron.id===selected.id
      ?{...squadron,recoveryWaypoints:waypoints.length?waypoints:undefined}:squadron)}
    const view=deriveRecoveryPlanningView(basingContext(next),selected.id,selected.route,flightRangeFor(selected))
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
  const transitField=match.playerAssets.find(asset=>asset.id===selected.plannedRecoveryFieldId)
  const fixedTransitEnd=Boolean(transitField&&transitDestination(selected,selected.routeIngress,transitField))
  const fixedEnd=fixedTransitEnd||selected.mission==='base-strike'||Boolean(selected.protectedPoint)
  const undoRoute=editingOrder&&!selected.protectedTargetId
    ? withoutLastPlanningWaypoint(editingReturn?recoveryView?.recoveryRoute??[]:selected.routeIngress,editingReturn||fixedEnd)
    : undefined
  const undoWaypoint=undoRoute?()=>{
    if(editingReturn)setReturnWaypoints(undoRoute.slice(1,-1))
    else if(selected.role==='bomber'){
      const lastRouteIndex=selected.routeIngress.length-1
      const assigned=selected.bombingTargets?.find(target=>target.routeIndex===lastRouteIndex)
      if(assigned)stagePlanningOrder(removeBombingTarget(selected,assigned.targetId))
      else setRoute(undoRoute)
    }
    else setRoute(undoRoute)
  }:undefined

  const routeToAirfield=(fieldId:string)=>{
    if(isPlanReadOnly()||!editingOrder)return
    const field=match.playerAssets.find(asset=>asset.id===fieldId)
    if(!field||!isOperationalAirfield(field)){setRouteNotice('That airfield is unavailable.');return}
    const origin=selectedLaunchField?.position??playerBase
    const transit=[origin,...approachWaypoints(selected,match.playerAssets),field.position]
    if(!editingReturn&&transit.length===2&&pointDistance(origin,field.position)<.001){
      setRouteNotice('Add a waypoint or choose another airfield.')
      return
    }
    const candidate:Squadron=editingReturn
      ? {...selected,plannedRecoveryFieldId:fieldId}
      : {...resetMapOrder(selected,origin),mission:'transit',route:transit,routeIngress:transit,plannedRecoveryFieldId:fieldId}
    const next={...match,squadrons:match.squadrons.map(item=>item.id===candidate.id?candidate:item)}
    const view=deriveRecoveryPlanningView(basingContext(next),candidate.id,candidate.route,flightRangeFor(candidate))
    if(!view?.valid){setRouteNotice(view?.reason??'Recovery route is unavailable.');return}
    stagePlanningOrder(candidate)
  }
  const selectGroundTarget=(targetId:string)=>{
    if(isPlanReadOnly()||!pickingGroundTarget)return
    if(selected.role==='bomber'){
      const assigned=selected.bombingTargets?.some(target=>target.targetId===targetId)
      const bomber=selected.mission==='bomb'?selected:resetMapOrder(selected,selectedLaunchField?.position??playerBase)
      const state=bomber===selected?match:{...match,squadrons:match.squadrons.map(item=>item.id===bomber.id?bomber:item)}
      const order=assigned?removeBombingTarget(bomber,targetId):planBombingTarget(state,bomber.id,targetId)
      if(!order){setRouteNotice((bomber.bombingTargets?.length??0)>=3?'Three targets max. Tap a marked target to remove it.':'That target is out of range.');return}
      setSelectedAssetId(undefined)
      stagePlanningOrder(order)
      return
    }
    if(selected.strikeTargetId===targetId)return
    const order=mapStrikeOrder(match,selected,targetId)
    if(!order){setRouteNotice('Shorten the approach to reach that target.');return}
    setSelectedAssetId(undefined)
    stagePlanningOrder(order)
  }
  const selectProtectRing=(point:Point,radius:number)=>{
    if(isPlanReadOnly()||!editingOrder||editingReturn)return
    const order=mapProtectOrder(match,selected,point,radius)
    if(!order)return
    const bounds=match.world.presentationBounds
    if(order.route.some(([x,z])=>x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ)){
      setRouteNotice('Keep the Protect ring inside the map.')
      return
    }
    const next={...match,squadrons:match.squadrons.map(item=>item.id===order.id?order:item)}
    const view=deriveRecoveryPlanningView(basingContext(next),order.id,order.route,flightRangeFor(order))
    if(!view?.valid){setRouteNotice('Draw a smaller ring or shorten the approach.');return}
    setSelectedAssetId(undefined)
    stagePlanningOrder(order)
  }
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
  const validInitialPoint=useMemo(()=>{
    if(match.phase!=='deploy'||onlineView?.locked||!onlineSession&&match.setup?.stage==='allocate')return undefined
    const validate=initialPlacementValidator(match,placementId)
    return (point:Point)=>validate(point).length===0
  },[match,onlineSession,onlineView?.locked,placementId])
  const stageInitialPlacement=useCallback((id:string,position:Point)=>{
    if(!onlineCommandBusy&&id===placementId&&validInitialPoint?.(position))placeAsset(id,position)
  },[onlineCommandBusy,placementId,validInitialPoint,placeAsset])
  const advanceCampaignSetup=useCallback(()=>setMatch(m=>{if(!m.setup)return m;if(m.setup.stage==='allocate'&&validateCampaignAllocation(m,m.setup).length===0)return {...m,setup:{...m.setup,stage:'place'}};if(SETUP_REQUIRED_ASSET_IDS.every(id=>m.setup!.placedAssetIds.includes(id)))return confirmCampaignSetup(m);return m}),[])
  const transitOrderError=(squadron:Squadron,state:MatchState)=>{
    if(squadron.mission!=='transit')return undefined
    const destination=state.playerAssets.find(asset=>asset.id===squadron.plannedRecoveryFieldId)
    return destination&&transitDestination(squadron,squadron.route,destination)
      ? undefined:'Tap a friendly airfield to finish the Transit order.'
  }
  const commit=()=>{
    if(onlineSession&&(isPlanReadOnly()||inFlightCommandRef.current))return
    if(cpuPlanningRound===match.round)return
    const orderedIds=new Set(reviewedIds)
    const orderedMatch={...match,squadrons:match.squadrons.map(s=>({...s,sortieOrdered:orderedIds.has(s.id),plannedRecoveryFieldId:orderedIds.has(s.id)?s.plannedRecoveryFieldId:undefined}))}
    const validation=validateRecoveryPackage(basingContext(orderedMatch),s=>flightRangeFor(s),orderedIds)
    const strikeError=orderedMatch.squadrons.filter(s=>orderedIds.has(s.id)).map(s=>validateGroundStrikeOrder(orderedMatch,s)).find(Boolean)
    const bomberError=orderedMatch.squadrons.filter(s=>orderedIds.has(s.id)).map(s=>validateBomberOrderForPlayer(orderedMatch,s)).find(Boolean)
    const escortError=orderedMatch.squadrons.filter(s=>orderedIds.has(s.id)&&s.mission==='defensive-cap'&&s.protectedTargetId).map(s=>{const target=orderedMatch.squadrons.find(item=>item.id===s.protectedTargetId);return !target||!orderedIds.has(target.id)?'ESCORT TARGET MUST HAVE A CONFIRMED ORDER':undefined}).find(Boolean)
    if(!validation.valid||strikeError||bomberError||escortError){setRouteNotice(strikeError??bomberError??escortError??validation.reason??'INVALID ORDER PACKAGE');return}
    if(onlineSession){const orders=orderedMatch.squadrons.filter(squadron=>orderedIds.has(squadron.id)).map(squadron=>({id:squadron.id,mission:squadron.mission,route:squadron.route,routeIngress:squadron.routeIngress,recoveryWaypoints:squadron.recoveryWaypoints,strikeTargetId:squadron.strikeTargetId,bombingTargets:squadron.bombingTargets,reconPosture:squadron.reconPosture,protectedPoint:squadron.protectedPoint,protectedTargetId:squadron.protectedTargetId,protectRadius:squadron.protectRadius,plannedRecoveryFieldId:squadron.plannedRecoveryFieldId}));setSubmittingPlan(orderedMatch);setSelectedAssetId(undefined);setInspectedFlightId(undefined);void sendOnlineAction({type:'lock-plan',orders});return}
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
    const resetFrameTime=()=>{last=performance.now()}
    const tick=(now:number)=>{
      elapsed=advanceReplayTime(elapsed,document.hidden?0:now-last,speedRef.current,onlineRound.duration)
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
    document.addEventListener('visibilitychange',resetFrameTime)
    frame=requestAnimationFrame(tick)
    return()=>{document.removeEventListener('visibilitychange',resetFrameTime);cancelAnimationFrame(frame);if(completionTimer!==undefined)clearTimeout(completionTimer)}
  },[onlineRound,playbackKey,replayActive])

  const closeProcurement=()=>{setProcurementMode('closed');setProcurementActionId(undefined);setProcurementPlacement(undefined)}
  const enterResupply=()=>{
    if(replayActive)return
    if(onlineSession){void sendOnlineAction({type:'debrief'});return}
    const next=openAdaptPhaseImmediately(match);setFollowId(undefined);setExecutionBaseId(undefined);setSelectedAssetId(undefined);setInspectedFlightId(undefined);closeProcurement();setEconomyTarget({kind:'campaign',id:'campaign'});setFocusPoint(playerBase);setMatch(next)
    if(next.phase==='adapt'&&match.cpu)runCpuWork(next,'adapt')
  }
  const runCpuWork=(source:MatchState,action:'adapt'|'plan')=>{
    cancelCpuWorkerRef.current?.()
    const requestId=++cpuPlanRequestRef.current
    const targetRound=action==='adapt'?source.round:source.round+1
    const targetPhase=action==='adapt'?'adapt':'plan'
    const finish = (result?: CpuPlanningWorkerResponse) => {
      if(requestId!==cpuPlanRequestRef.current)return
      cpuPlanRequestRef.current++
      cancelCpuWorkerRef.current?.()
      cancelCpuWorkerRef.current = undefined
      const valid = result?.requestId === requestId && !result.error && result.round === targetRound && result.phase === targetPhase && result.cpu
      setMatch(current => {
        if (current.round !== targetRound || current.phase !== targetPhase || !current.cpu) return current
        if (valid && result) return {
          ...current, cpu: result.cpu, enemyAssets: result.enemyAssets,
          enemyBaseHealth: result.enemyBaseHealth, onlineOutcome: result.onlineOutcome,
        }
        // Preserve player edits made while the worker was running.
        if (action === 'adapt') return { ...current, cpu: { ...current.cpu, lastAdaptedRound: current.round } }
        return prepareCpuRound(current, { holdFormations: true })
      })
      if (action === 'adapt') setCpuAdaptingRound(undefined)
      else setCpuPlanningRound(undefined)
    }
    if(action==='adapt')setCpuAdaptingRound(targetRound)
    else setCpuPlanningRound(targetRound)
    try{
      const worker=new Worker(new URL('./game/cpu/next-round.worker.ts',import.meta.url),{type:'module'})
      const timeout = window.setTimeout(() => finish(), CPU_WORK_TIMEOUT_MS)
      cancelCpuWorkerRef.current = () => {
        window.clearTimeout(timeout)
        worker.terminate()
      }
      worker.onmessage=(event:MessageEvent<CpuPlanningWorkerResponse>)=>finish(event.data)
      worker.onerror=event=>{event.preventDefault();finish()}
      worker.onmessageerror=()=>finish()
      worker.postMessage({requestId,action,match:{...source,lastResult:undefined}})
    }catch{
      finish()
    }
  }
  const nextRound=()=>{
    if(onlineSession){void sendOnlineAction({type:'next-round'});return}
    if(cpuAdaptingRound===match.round)return
    setSelectedAssetId(undefined);setInspectedFlightId(undefined);simulationRef.current=undefined;setLiveResult(undefined);setAcknowledgedThreatIds(new Set());setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined);setRouteNotice(undefined);setPlanningStep('idle');setReviewedIds(new Set());setPlanningBaseId('p-base');closeProcurement()
    const next=advanceToNextRound(match)
    if(next===match)return
    setMatch(next)
    if(match.cpu)runCpuWork(match,'plan')
  }
  const resetPlanningUi=()=>{cpuPlanRequestRef.current++;cancelCpuWorkerRef.current?.();cancelCpuWorkerRef.current=undefined;setCpuPlanningRound(undefined);setCpuAdaptingRound(undefined);cameraMemory.current=undefined;setSelectedAssetId(undefined);setInspectedFlightId(undefined);simulationRef.current=undefined;setLiveResult(undefined);setAcknowledgedThreatIds(new Set());setProgress(0);setPlayback(undefined);setActiveEvent(undefined);setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined);setRouteNotice(undefined);setPlanningStep('idle');setPlanningBaseId('p-base');setReviewedIds(new Set());closeProcurement()}
  const selectScenario=(scenario:DebugScenario)=>{setHasCampaign(true);resetPlanningUi();setEconomyTarget({kind:'campaign',id:'campaign'});setMatch(createScenario(scenario))}
  const restart=()=>{const seed=freshCampaignSeed();localStorage.removeItem(SAVE_KEY);for(const key of LEGACY_SAVE_KEYS)localStorage.removeItem(key);resetPlanningUi();setEconomyTarget({kind:'campaign',id:'campaign'});setMatch(m=>m.debugScenario&&m.debugScenario!=='campaign'?createScenario(m.debugScenario):createCampaignDraft(seed,m.cpu?.difficulty))}
  const selectFormation=(id:string)=>{setAcknowledgedThreatIds(current=>{const next=new Set(current);for(const alert of executionResult?.threatAlerts??[])if(alert.unitId===id&&alert.time<=inspectionSeconds)next.add(alert.id);return next});setFollowId(current=>current===id?undefined:id);setFocusPoint(undefined);setMatch(m=>({...m,selectedId:id}))}
  const confirmPlanningOrder=(squadron:Squadron,state:MatchState=match):boolean=>{
    if(isPlanReadOnly())return false
    const transitError=transitOrderError(squadron,state)
    if(transitError){setRouteNotice(transitError);return false}
    const view=deriveRecoveryPlanningView(basingContext(state),squadron.id,squadron.route,flightRangeFor(squadron))
    if(squadron.aircraft<=0||squadron.status==='trapped'||!view?.valid){setRouteNotice(view?.reason??'FORMATION CANNOT LAUNCH');return false}
    const reviewedSquadron={...squadron,route:view.normalizedRoute}
    if(reviewedSquadron.mission==='defensive-cap'&&reviewedSquadron.protectedTargetId){const target=state.squadrons.find(item=>item.id===reviewedSquadron.protectedTargetId);if(!target||!reviewedIds.has(target.id)){setRouteNotice('ESCORT TARGET MUST HAVE A CONFIRMED ORDER FIRST');return false}}
    const strikeError=validateGroundStrikeOrder(state,reviewedSquadron)
    const bomberError=validateBomberOrderForPlayer(state,reviewedSquadron)
    if(strikeError||bomberError){setRouteNotice(strikeError??bomberError);return false}
    setMatch(current=>({...current,squadrons:current.squadrons.map(item=>item.id===squadron.id?{...reviewedSquadron,route:view.normalizedRoute,plannedRecoveryFieldId:view.intendedField.id}:item)}))
    setReviewedIds(current=>new Set(current).add(squadron.id))
    setRouteNotice(undefined)
    return true
  }
  const protectTarget=selected.protectedTargetId?match.squadrons.find(item=>item.id===selected.protectedTargetId):undefined
  const selectProtectFlight=(id:string)=>{
    if(isPlanReadOnly()||selected.role!=='fighter')return
    const target=match.squadrons.find(item=>item.id===id)
    if(!target||target.id===selected.id||!reviewedIds.has(id)||target.aircraft<=0)return
    // A flight can only escort a flight whose existing order does not loop back to it.
    const chain=new Set([selected.id])
    for(let item:Squadron|undefined=target;item;item=match.squadrons.find(candidate=>candidate.id===item?.protectedTargetId)){
      if(chain.has(item.id)){setRouteNotice('Choose a flight outside this escort chain.');return}
      chain.add(item.id)
    }
    const launch=selectedLaunchField?.position??playerBase
    const targetRecovery=match.playerAssets.find(asset=>asset.id===target.plannedRecoveryFieldId)?.position??target.route[0]
    const targetRoute=target.route.at(-1)&&pointDistance(target.route.at(-1)!,targetRecovery)<.03?target.route:[...target.route,targetRecovery]
    const route=maxEscortRoute(launch,targetRoute,launch,flightRangeFor(selected))
    if(route.length<2){setRouteNotice('That flight is out of escort range.');return}
    stagePlanningOrder({...resetMapOrder(selected,launch),mission:'defensive-cap',protectedTargetId:id,route,routeIngress:route})
  }
  const setReconPosture=(posture:ReconPosture)=>{if(isPlanReadOnly())return;const id=match.selectedId;setMatch(current=>({...current,squadrons:current.squadrons.map(squadron=>squadron.id===id&&squadron.role==='recon'?{...squadron,reconPosture:posture}:squadron)}))}
  const closePlanningOrder=()=>{
    if(selected.route.length>=2&&!confirmPlanningOrder(selected))return false
    setPlanningStep('idle')
    return true
  }
  const selectPlanningFormation=(id:string)=>{
    if(isPlanReadOnly()){
      setMatch(current=>({...current,selectedId:id}))
      return
    }
    const target=match.squadrons.find(s=>s.id===id)
    if(!target||target.aircraft<=0||target.status==='trapped')return
    if(planningStep==='route'){
      if(id===selected.id)return
      if(!closePlanningOrder())return
    }
    const baseId=formationBaseId(planningBaseGroups,id)
    if(baseId)setPlanningBaseId(baseId)
    setSelectedAssetId(undefined)
    setRouteNotice(undefined)
    setPlanningStep('route')
    const launch=formationField(match.playerAssets,id)?.position??playerBase
    setMatch(current=>({...current,selectedId:id,squadrons:reviewedIds.has(id)?current.squadrons:current.squadrons.map(s=>s.id===id?resetMapOrder(s,launch):s)}))
  }
  const selectPlanningBase=(id:string)=>{
    if(isPlanReadOnly()||!planningBaseGroups.some(group=>group.base.id===id))return
    setPlanningBaseId(id);setPlanningStep('idle');setRouteNotice(undefined)
  }
  const focusMapPoint=(point:Point)=>{
    setFollowId(undefined)
    setFocusPoint([...point])
    setCameraFocusRequestKey(key=>key+1)
  }
  const selectExecutionBase=(id:string)=>{const base=match.playerAssets.find(asset=>asset.id===id&&(asset.kind==='base'||asset.kind==='fob'));if(!base)return;setExecutionBaseId(id);focusMapPoint(base.position)}
  const focusAirfield=()=>{const id=match.playerAssets.find(asset=>asset.kind==='base')?.id;if(id)selectExecutionBase(id)}
  const focusDebrief=(point:Point,eventId?:string)=>{
    focusMapPoint(point)
    setFocusedDebriefEvent(eventId)
  }
  const focusEvent=(event:CombatEvent)=>{const target=match.squadrons.find(s=>event.detail.includes(s.callsign));if(target){setFollowId(target.id);setMatch(m=>({...m,selectedId:target.id}))}else setFollowId(undefined);if(event.position)setFocusPoint(event.position);setActiveEvent(event)}
  const selectEconomyTarget=(target:EconomyTarget,focus=true)=>{closeProcurement();setEconomyTarget(target);setSelectedAssetId(target.kind==='asset'?target.id:undefined);setInspectedFlightId(undefined);const point=target.kind==='asset'?[...match.playerAssets,...match.enemyAssets.filter(asset=>!asset.hidden&&asset.intel!=='unknown')].find(asset=>asset.id===target.id)?.position:target.kind==='squadron'?match.playerAssets.find(asset=>asset.id===formationBaseId(planningBaseGroups,target.id))?.position:undefined;setFocusPoint(focus?point:undefined)}
  const purchaseEconomy=(command:EconomyCommand)=>onlineSession?void sendOnlineAction({type:'purchase',actionId:command.actionId,target:command.target,placement:command.placement,upgradeId:command.upgradeId}):setMatch(state=>executeEconomyCommand(state,command))
  const changeProcurementMode=(mode:ProcurementMode,upgradeTarget?:EconomyTarget)=>{
    setFocusPoint(undefined)
    setProcurementMode(mode)
    if(mode==='placing')return
    setProcurementPlacement(undefined)
    setProcurementActionId(undefined)
    setSelectedAssetId(undefined)
    setEconomyTarget(upgradeTarget??{kind:'campaign',id:'campaign'})
  }
  const selectProcurementAction=(actionId:EconomyActionId)=>{setFocusPoint(undefined);setProcurementActionId(actionId);setProcurementPlacement(undefined);setProcurementMode('placing');setEconomyTarget({kind:'campaign',id:'campaign'})}
  const procurementDefinition=PROCUREMENT_CATALOG.find(item=>item.actionId===procurementActionId)
  const validProcurementPoint=useMemo(()=>{
    if(match.phase!=='adapt'||procurementMode!=='placing'||!procurementDefinition)return ()=>false
    const validate=constructionPlacementValidator(match,procurementDefinition.kind)
    return (point:Point)=>validate(point).valid
  },[match,procurementDefinition,procurementMode])
  const stageProcurementPlacement=useCallback((point:Point)=>{if(!procurementDefinition||!validProcurementPoint(point))return;const quote=economyQuotesFor(match,{kind:'campaign',id:'campaign'}).find(item=>item.id===procurementDefinition.actionId);if(!quote?.eligible)return;setProcurementPlacement(point)},[match,procurementDefinition,validProcurementPoint])
  const confirmProcurementPlacement=useCallback(()=>{if(!procurementDefinition||!procurementPlacement||!validProcurementPoint(procurementPlacement))return;const quote=economyQuotesFor(match,{kind:'campaign',id:'campaign'}).find(item=>item.id===procurementDefinition.actionId);if(!quote?.eligible)return;const command=economyCommandForQuote(match,quote);if(onlineSession)void sendOnlineAction({type:'purchase',actionId:command.actionId,target:command.target,placement:procurementPlacement,upgradeId:command.upgradeId});else setMatch(state=>executeEconomyCommand(state,{...command,placement:procurementPlacement}));setProcurementMode('closed');setProcurementActionId(undefined);setProcurementPlacement(undefined)},[match,onlineSession,procurementDefinition,procurementPlacement,sendOnlineAction,validProcurementPoint])

  const startCampaign=(difficulty:CpuDifficulty)=>{resetPlanningUi();setPlacementId('p-base');setEconomyTarget({kind:'campaign',id:'campaign'});setMatch(createCampaignDraft(freshCampaignSeed(),difficulty));setHasCampaign(true);setMenuOpen(false)}
  const exitOnline=()=>{onlineRef.current=undefined;inFlightCommandRef.current=undefined;retryCommandRef.current=undefined;setOnlineSession(undefined);setOnlineView(undefined);setOnlineInvite(undefined);setOnlineError(undefined);setOnlineCommandError(undefined);setOnlineCommandBusy(false);setSubmittingPlan(undefined);const backup=localBackupRef.current??loadMatch();localBackupRef.current=undefined;resetPlanningUi();setMatch(backup.match);setHasCampaign(backup.hasCampaign);setMenuOpen(true)}
  const forgetOnline=()=>{try{localStorage.removeItem(ONLINE_SESSION_KEY)}catch{}setSavedOnlineSession(undefined);exitOnline()}
  const continueOnline=()=>{if(!savedOnlineSession)return;localBackupRef.current={match,hasCampaign};resetPlanningUi();onlineRef.current={session:savedOnlineSession};setOnlineSession(savedOnlineSession);setOnlineView(undefined);setOnlineInvite(undefined);setOnlineError(undefined);setOnlineCommandError(undefined);setMenuOpen(false)}
  if(menuOpen&&!onlineSession)return <CampaignMenu saved={hasCampaign?match:undefined} savedOnline={ONLINE_UI_ENABLED&&Boolean(savedOnlineSession)} onContinueOnline={ONLINE_UI_ENABLED?continueOnline:undefined} onContinue={()=>setMenuOpen(false)} onStart={startCampaign} onCreateOnline={ONLINE_UI_ENABLED?entry=>attachOnline(entry.session,entry.view,entry.invite):undefined} onJoinOnline={ONLINE_UI_ENABLED?entry=>attachOnline(entry.session,entry.view):undefined}/>
  if(onlineSession&&!onlineView)return <main className="online-reconnect"><section><small>ONLINE SESSION</small><h1>RECONNECTING</h1><p>{onlineError??'Restoring your seat and loading the latest match state…'}</p><button type="button" onClick={exitOnline}>RETURN TO MENU</button><button type="button" className="forget-online" onClick={forgetOnline}>CLEAR SAVED ONLINE SEAT</button></section></main>

  return <main className="app-shell">
    <div className={`game-frame phase-${visiblePhase} ${planningStep!=='idle'||visiblePhase==='execute'&&executionBaseId?'shelf-open chit-queue-open':''} ${planningStep==='route'?'route-step-open':''}`}>
      <TopBar round={match.round} phase={visiblePhase} debugScenario={match.debugScenario??'campaign'} onDebugScenario={selectScenario} onReboot={restart} onMenu={onlineSession?exitOnline:()=>setMenuOpen(true)} onlineStatus={onlineStatus}/>
      {onlineSession&&visiblePhase!=='deploy'?<div className="pvp-base-health" aria-label="Airfield health">
        <span>Home base <b>{Math.round(liveHomeHealth)} HP</b></span>
        <span>Enemy base <b>{enemyBaseOnMap?`${Math.round(enemyBaseOnMap.health)} HP`:'Unknown'}</b></span>
      </div>:null}
      {onlineInvite&&!onlineView?.joined ? <OnlineInviteCode key={onlineInvite} code={onlineInvite}/> : null}
      {(onlineCommandError||onlineError)?<div className="online-command-error" role="alert"><span>{onlineCommandError??onlineError}</span><button type="button" disabled={onlineCommandBusy} onClick={retryOnline}>RETRY</button></div>:null}
      <div className="battlefield-workspace">
      <div className="map-wrap"><Battlefield cameraMemory={cameraMemory} squadrons={planningSquadrons} assets={replayMatch.enemyAssets} playerAssets={match.phase==='deploy'&&match.setup?replayMatch.playerAssets.filter(asset=>SETUP_REQUIRED_ASSET_IDS.includes(asset.id as typeof SETUP_REQUIRED_ASSET_IDS[number])&&(match.setup!.placedAssetIds.includes(asset.id)||asset.id===placementId)):replayMatch.playerAssets} mappedAreas={match.mappedAreas} terrain={visibleTerrain} discoveredBoundaries={match.discoveredBoundaries} presentationBounds={match.world.presentationBounds} planningBounds={activeMapPlanningBounds} friendlyTerritory={friendlyTerritory} selectedId={match.selectedId} followId={followId} focusPoint={focusPoint} focusRequestKey={cameraFocusRequestKey} focusedDebriefEvent={focusedDebriefEvent} onDebriefFocus={focusDebrief} placementId={placementId} positionedPlacementIds={match.setup?.placedAssetIds} showDefenseCoverage={showDefenseCoverage} groundAssetsProjected={Boolean(projectedGround)} onPlacementSelect={id=>{if(!onlineView?.locked&&!onlineCommandBusy)setPlacementId(id)}} planningBaseId={activePlanningBaseId} executionBaseId={executionBaseId} planningRecoveryFieldId={match.phase==='plan'&&recoveryView&&selectedLaunchField&&recoveryView.intendedField.id!==selectedLaunchField.id?recoveryView.intendedField.id:undefined} plannedFormationIds={displayedOrderIds} routeOrigin={selectedLaunchField?.position} editingReturn={editingReturn} recoveryRoute={recoveryView?.recoveryRoute} onReturnWaypoints={setReturnWaypoints} routePlanningEnabled={editingOrder} lockedPlan={waitingOnPlan} showMissionPreview={waitingOnPlan?Boolean(selected.sortieOrdered):editingOrder} selectingGroundTarget={pickingGroundTarget} onGroundTargetSelect={selectGroundTarget} selectedAssetId={selectedAssetId} inspectedFlightId={inspectedFlightId} onAssetInspect={inspectAsset} onFlightInspect={inspectFlight} escortPreview={protectTarget?{targetId:protectTarget.id}:undefined} phase={visiblePhase} progress={executionProgress} activeEvent={executionEvent} executionResult={executionResult??(match.phase==='debrief'||match.phase==='adapt'?match.lastResult:undefined)} packageReview={false} showResupplyAircraft={procurementMode==='closed'} resupplyRepairIds={visiblePhase==='adapt'?new Set(economyAttentionTargets(match).map(target=>target.id)):undefined} economySelectionId={economyTarget.kind==='campaign'?undefined:economyTarget.id} onPlanningBaseSelect={selectPlanningBase} onPlanningFormationSelect={selectPlanningFormation} onPlanningProtectRing={editingOrder&&selected.role==='fighter'&&!editingReturn?selectProtectRing:undefined} onPlanningRecoverySelect={routeToAirfield} onExecutionBaseSelect={selectExecutionBase} onEconomySelect={id=>selectEconomyTarget({kind:'asset',id},false)} onEconomyFormationSelect={id=>selectEconomyTarget({kind:'squadron',id},false)} construction={match.phase==='adapt'&&procurementMode==='placing'&&procurementDefinition?{kind:procurementDefinition.kind,placement:procurementPlacement,isValid:validProcurementPoint,onStage:stageProcurementPlacement}:undefined} isPlacementValid={validInitialPoint} onRoute={setRoute} onPlace={match.phase==='deploy'&&(onlineSession||match.setup?.stage==='place'||match.setup?.stage==='review'||!match.setup)?stageInitialPlacement:()=>{}}/>
        {!inspectedAsset&&inspectedAircraft?<AircraftInspector {...inspectedAircraft} onClose={()=>setInspectedFlightId(undefined)}/>:null}
        <div className="map-control-stack">
          {visiblePhase!=='deploy'&&visiblePhase!=='debrief' ? <div className="map-tools" aria-label="Map tools">
            {campaign&&(visiblePhase==='plan'||visiblePhase==='execute') ? <CampaignBriefing match={match} target={strikeTarget} homeHealth={Math.round(liveHomeHealth)} enemyHealth={knownEnemyBaseHealth===undefined?undefined:Math.round(knownEnemyBaseHealth)}/> : null}
            {visiblePhase==='plan'&&planningBaseGroups.length===1?<button type="button" aria-label="Locate airfield"
              onClick={()=>focusMapPoint(planningBaseGroups[0].base.position)}><LocateFixed/> Airfield</button>:null}
            {visiblePhase==='plan'&&planningBaseGroups.length>1?<details name="map-tools" className="airfield-locator">
              <summary><LocateFixed/> Airfields</summary>
              <div>{planningBaseGroups.map(({base})=><button type="button" key={base.id} onClick={event=>{
                event.currentTarget.closest('details')?.removeAttribute('open')
                focusMapPoint(base.position)
              }}>{airfieldLabel(base)}</button>)}</div>
            </details>:null}
            {visiblePhase==='execute' ? <><ContactTracks result={executionResult} seconds={inspectionSeconds} home={playerBase} onFocus={point=>{setFollowId(undefined);setFocusPoint(point)}}/>
              {executionResult?.events.some(event=>event.time<=inspectionSeconds) ? <details name="map-tools" className="map-events"><summary>Events</summary><ObserveEventFeed events={executionResult.events} progress={executionProgress} duration={executionResult.duration} onFocus={focusEvent}/></details> : null}</> : null}
            <button type="button" className="defense-map-toggle" aria-label="Defense coverage" aria-pressed={showDefenseCoverage} onClick={()=>setShowDefenseCoverage(value=>!value)}><ShieldCheck/> Defense</button>
          </div> : null}
          {inspectedAsset&&visiblePhase!=='deploy'&&(visiblePhase!=='adapt'||procurementMode==='closed')?<AssetInspector
            asset={inspectedAsset} sites={inspectionSites} enemy={inspectingEnemy} phase={visiblePhase}
            result={inspectionResult} seconds={inspectionSeconds}
            onClose={()=>visiblePhase==='adapt'?selectEconomyTarget({kind:'campaign',id:'campaign'},false):setSelectedAssetId(undefined)}
            onUpgrades={visiblePhase==='adapt'&&!inspectingEnemy&&inspectedAsset.operational!==false&&(inspectedAsset.kind==='base'||isDefenseSite(inspectedAsset))
              ? ()=>{setPurchaseCategory('Upgrades');changeProcurementMode('catalog',{kind:'asset',id:inspectedAsset.id})}
              : undefined}/>:null}
        </div>
        {visiblePhase==='execute'?<ExecutionOverlay progress={executionProgress} speed={speed} onSpeed={()=>setSpeed(s=>s===1?2:1)} match={replayMatch} result={executionResult} selectedId={match.selectedId} followId={followId} onSelectFormation={selectFormation} onClearFollow={()=>setFollowId(undefined)} onAirfield={focusAirfield}/>:null}
      </div>
      {visiblePhase==='execute'&&executionBaseId?<ExecutionChitRail squadrons={match.squadrons} bases={replayMatch.playerAssets} result={executionResult} progress={executionProgress} activeBaseId={executionBaseId} selectedId={match.selectedId} followId={followId} threatenedIds={new Set((executionResult?.threatAlerts??[]).filter(alert=>alert.time<=inspectionSeconds&&!acknowledgedThreatIds.has(alert.id)).map(alert=>alert.unitId))} onSelect={selectFormation}/>:null}
      {match.phase==='deploy'?<CampaignSetupPanel
        match={match} placementId={placementId} onSelectPlacement={setPlacementId}
        online={Boolean(onlineSession)} busy={onlineCommandBusy} locked={onlineView?.locked} opponentLocked={onlineView?.opponentLocked}
        onContinue={()=>onlineSession?void sendOnlineAction({type:'lock-deploy'}):match.setup?advanceCampaignSetup():setMatch(m=>({...m,phase:'plan'}))}/>:null}
      {match.phase==='plan'&&waitingOnPlan?<section className="phase-panel online-wait-panel" aria-label="Read-only plan"><strong>{onlineView?.locked?'Orders locked':onlineCommandBusy?'Locking orders…':'Checking submitted orders'}</strong><p>{onlineView?.locked?'Open an airfield’s aircraft count to review orders.':'Your submitted routes are frozen.'}</p></section>:null}
      {match.phase==='plan'&&!waitingOnPlan?<CommandShelf
        squadrons={match.squadrons}
        squadron={selected} routeNotice={routeNotice} routeBudget={routeBudget} editingReturn={editingReturn}
        onRouteLegChange={canEditReturn?leg=>{setEditReturn(leg==='return');setRouteNotice(undefined)}:undefined}
        onProtectFlight={selectProtectFlight}
        onReconPosture={setReconPosture} onUndoWaypoint={undoWaypoint}
        onClear={()=>{if(editingReturn)setReturnWaypoints([]);else if(selected.role==='bomber')stagePlanningOrder(resetMapOrder(selected,selectedLaunchField?.position??playerBase));else setRoute([])}}
        onCommit={commit} step={planningStep} onClose={closePlanningOrder} reviewedIds={reviewedIds}
        reviewedCount={reviewedCount} totalCount={viableFormationIds.length} groundTargets={groundTargets}
        onlineLock={Boolean(onlineSession)} cpuPlanning={cpuPlanningRound===match.round} allowEmptyCommit/>:null}
      {match.phase==='debrief'&&match.lastResult&&!replayActive?<Debrief key={match.round} match={match} focusedEvent={focusedDebriefEvent} onFocus={focusDebrief} onResupply={enterResupply} pending={onlineCommandBusy}/>:null}
      {match.phase==='adapt'?<ResupplyPanel match={match} busy={onlineCommandBusy} cpuAdapting={cpuAdaptingRound===match.round} nextRoundDisabled={cpuAdaptingRound===match.round} selectedTarget={economyTarget} purchaseCategory={purchaseCategory} onPurchaseCategoryChange={setPurchaseCategory} onCloseTarget={()=>selectEconomyTarget({kind:'campaign',id:'campaign'})} onPurchase={purchaseEconomy} onNextRound={nextRound} procurementMode={procurementMode} procurementActionId={procurementActionId} onProcurementMode={changeProcurementMode} onProcurementAction={selectProcurementAction} hasPlacementPreview={Boolean(procurementPlacement)} onConfirmPlacement={confirmProcurementPlacement} onCancelPlacement={()=>setProcurementPlacement(undefined)}/>:null}
      </div>
      {(match.phase==='victory'||match.phase==='defeat'||match.phase==='draw')?<EndState victory={match.phase==='victory'} round={match.round} outcome={campaignOutcome(match)} onRestart={()=>setMenuOpen(true)}/>:null}
    </div>
  </main>
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

function baseHealthChange(health:number,damage:number){
  const end=Math.round(health),start=Math.round(health+damage)
  return start>end?`${start} → ${end} HP`:`${end} HP`
}

export function Debrief({match,focusedEvent,onFocus,onResupply,pending=false}:{
  match:MatchState;focusedEvent?:string;onFocus:(point:Point,eventId?:string)=>void;onResupply:()=>void;pending?:boolean
}){
  const result=match.lastResult!
  const feed=useRef<HTMLDivElement>(null)
  const activeRow=useRef<HTMLButtonElement>(null)
  const outcome=campaignOutcome(match)
  const message=outcome?campaignOutcomeMessage(outcome):undefined
  const intel=result.intelReports.filter(report=>report.recovered).map(report=>result.assets.find(asset=>asset.id===report.assetId)).filter((asset):asset is Asset=>!!asset)
  const losses=result.friendlyAttrition.filter(item=>item.aircraftLost>0)
  const {base,intel:intelIncome,enemyAircraft,total,objectives=[]}=result.logisticsIncome
  const depotPay=Math.max(0,base-LOGISTICS_EFFECTS.baseIncome)
  const enemyBase=match.enemyAssets.find(asset=>asset.kind==='base'&&asset.intel==='confirmed'&&!asset.hidden)
  const orders=missionOrderDebrief(match,result)
  const reports=useMemo(()=>debriefMapSites(result).flatMap(site=>site.events.map(event=>({site,event}))).sort((a,b)=>a.event.time-b.event.time||a.event.id.localeCompare(b.event.id)),[result])
  useEffect(()=>{
    const panel=feed.current,row=activeRow.current
    if(!focusedEvent||!panel||!row)return
    const viewport=panel.getBoundingClientRect(),entry=row.getBoundingClientRect()
    if(entry.top<viewport.top||entry.bottom>viewport.bottom)panel.scrollTop+=entry.top-viewport.top
  },[focusedEvent])

  return <section className="phase-panel debrief-summary" aria-label="After action summary">
    <header className="debrief-feed-heading">
      {isCampaign(match)?<div className="debrief-campaign" role="group" aria-label="Base health">
        <span className={result.baseDamage>0?'base-damaged':undefined}>HOME BASE <b>{baseHealthChange(match.playerBaseHealth,result.baseDamage)}</b></span>
        {enemyBase?<span className={result.enemyBaseDamage>0?'base-damaged':undefined}>ENEMY BASE <b>{baseHealthChange(enemyBase.health,result.enemyBaseDamage)}</b></span>:result.enemyBaseDamage>0?<span>ENEMY DAMAGE <b>−{Math.round(result.enemyBaseDamage)} HP</b></span>:null}
      </div>:<h2>Round report</h2>}
      <strong className="debrief-payout" aria-label="Round payout">+{formatCash(total)}</strong>
    </header>
    <div className="debrief-feed" ref={feed} aria-label="Round report">
      {message?<p className="debrief-message">{message.message}</p>:null}
      <div className="debrief-metrics"><div><strong>{result.friendlyLosses}</strong><span>FRIENDLY LOST</span></div><div><strong>{result.enemyLosses}</strong><span>ENEMY LOST · CONFIRMED</span></div><div><strong>{intel.length}</strong><span>INTEL RECOVERED</span></div></div>
      {reports.length?<ol className="debrief-event-list" aria-label="Round events">
        {reports.map(({site,event})=><li key={event.id}>
          <button type="button" className={`debrief-site ${event.side}`} aria-pressed={event.id===focusedEvent} ref={event.id===focusedEvent?activeRow:undefined}
            onClick={()=>onFocus(site.position,event.id)}>
            <span className="debrief-site-number" title={`Map site ${site.number}`}>{site.number}</span>
            <DebriefSymbol kind={event.kind}/>
            <span className="debrief-site-reports"><span><b>{event.title}</b><span>{event.detail}</span><time>{event.time.toFixed(1)}s</time></span></span>
          </button>
        </li>)}
      </ol>:<p className="phase-panel-copy">No combat, losses, or new intel.</p>}
      {orders.length?<details className="debrief-report-details"><summary>Orders</summary>{orders.map(order=><p key={order.id}><b>{order.callsign} · {order.purpose}</b><br/>{order.result}</p>)}</details>:null}
      {losses.length?<details className="debrief-report-details"><summary>Formation losses</summary>{losses.map(item=><p key={item.id}>{item.callsign} · {item.startAircraft} → {item.endAircraft} aircraft · {item.endStrength}% strength</p>)}</details>:null}
      <details className="debrief-report-details"><summary>Payout breakdown</summary>
        <dl>
          <div><dt>Round pay</dt><dd>+{formatCash(base-depotPay)}</dd></div>
          {depotPay>0?<div><dt>Supply Depot</dt><dd>+{formatCash(depotPay)}</dd></div>:null}
          <div><dt>Recovered intel <small>{formatCash(LOGISTICS_EFFECTS.intelRecovery)} per new site</small></dt><dd>{intelIncome>0?'+':''}{formatCash(intelIncome)}</dd></div>
          {objectives.map(reward=><div key={reward.id}><dt>{reward.label}</dt><dd>+{formatCash(reward.amount)}</dd></div>)}
          <div><dt>Confirmed enemy losses <small>{formatCash(LOGISTICS_EFFECTS.confirmedEnemyAircraft)} per aircraft</small></dt><dd>{enemyAircraft>0?'+':''}{formatCash(enemyAircraft)}</dd></div>
        </dl>
      </details>
    </div>
    <div className="phase-panel-footer"><button type="button" className="phase-primary" disabled={pending} onClick={onResupply}>{pending?'Loading…':message?'View outcome':'Open Resupply'} <ChevronRight/></button></div>
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
