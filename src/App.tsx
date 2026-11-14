import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, FastForward, Map as MapIcon, RotateCcw, ShieldCheck, Zap } from 'lucide-react'
import { Battlefield, type CameraPoseSnapshot } from './components/Battlefield'
import { AircraftInspector, AssetInspector } from './components/UnitInspector'
import { CampaignSetupPanel } from './components/CampaignSetupPanel'
import { CampaignMenu } from './components/CampaignMenu'
import { fetchOnlineMatch, sendOnlineCommand } from './components/OnlineClient'
import type { CpuDifficulty } from './game/cpu/types'
import { AdaptPanel, type ProcurementMode } from './components/AdaptPanel'
import { KnownWorldMap } from './components/KnownWorldMap'
import { CampaignBriefing } from './components/CampaignBriefing'
import { CommandShelf, ContactTracks, ExecutionChitRail, FormationDock, ObserveEventFeed, TopBar, type PlanningRosterMode, type PlanningStep } from './components/Hud'
import { createCampaignDraft } from './game/data'
import { freshCampaignSeed } from './game/campaignLayout'
import { BASE_STRIKE_RANGE, campaignOutcome, confirmedStrikeTarget, groundStrikeTargets, isCampaign } from './game/campaign'
import { placeInitialAsset, validateInitialPlacement } from './game/campaignPlacement'
import { confirmCampaignSetup, validateCampaignAllocation, SETUP_REQUIRED_ASSET_IDS } from './game/campaignSetup'
import { applyRound, createRoundSimulation, EXECUTION_SECONDS, missionDistance, resolveRound, TICK_SECONDS, type RoundSimulationController } from './game/engine'
import { flightRangeFor } from './game/flightRules'
import { beginNextRound, economyCommandForQuote, economyQuotesFor, executeEconomyCommand, openAdaptPhase, PROCUREMENT_CATALOG, validateAssetPlacement } from './game/economy'
import { snapToHex } from './game/hex'
import { deriveKnownWorldModel } from './game/knownWorld'
import { formationBaseGroups, formationBaseId } from './game/formationBasing'
import { deriveRecoveryPlanningView, formationField, routeToRecoveryField, snapRouteToRecoveryField, validateRecoveryPackage } from './game/forwardBasing'
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
import { projectFriendlyUnitAt, projectHostileUnitAt } from './game/executionProjection'
import {createScenario} from './game/scenarios'
import { deriveKnownEnvelope, derivePlanningEnvelope } from './game/world'
import { friendlyTerritoryForAssets } from './game/territory'
import { maxEscortRoute } from './game/escortRoute'
import type { Asset, CombatEvent, DebugScenario, EconomyActionId, EconomyCommand, EconomyTarget, MatchState, MissionId, Point, ReconPosture, RoundResult, Squadron } from './game/types'
import type { OnlineAction, OnlineCommand, OnlineSession, OnlineView } from './online/protocol'

const SAVE_KEY='dead-reckoning-mvp-v27'
const ONLINE_SESSION_KEY='dead-reckoning-online-session-v1'
const ONLINE_UI_ENABLED=import.meta.env.MODE==='online'
const LEGACY_SAVE_KEYS=['dead-reckoning-mvp-v26','dead-reckoning-mvp-v25','dead-reckoning-mvp-v24','dead-reckoning-mvp-v23','dead-reckoning-mvp-v22','dead-reckoning-mvp-v21','dead-reckoning-mvp-v20','dead-reckoning-mvp-v19','dead-reckoning-mvp-v18','dead-reckoning-mvp-v17','dead-reckoning-mvp-v16','dead-reckoning-mvp-v15','dead-reckoning-mvp-v14','dead-reckoning-mvp-v13','dead-reckoning-mvp-v12','dead-reckoning-mvp-v11','dead-reckoning-mvp-v10','dead-reckoning-mvp-v9']
function loadMatch():{match:MatchState;hasCampaign:boolean}{try{const saved=localStorage.getItem(SAVE_KEY);if(saved)return {match:normalizeMatch(JSON.parse(saved)),hasCampaign:true}}catch{}return {match:createCampaignDraft(),hasCampaign:false}}
function loadOnlineSession():OnlineSession|undefined{try{const raw=localStorage.getItem(ONLINE_SESSION_KEY);if(!raw)return;const session=JSON.parse(raw) as OnlineSession;return session.matchId&&session.token?session:undefined}catch{return undefined}}
const pointDistance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
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
  const [onlineInviteNotice,setOnlineInviteNotice]=useState('')
  const [onlineError,setOnlineError]=useState<string>()
  const [onlineCommandError,setOnlineCommandError]=useState<string>()
  const [onlineCommandBusy,setOnlineCommandBusy]=useState(false)
  const onlineRef=useRef<{session:OnlineSession;view?:OnlineView}|undefined>(undefined)
  const retryCommandRef=useRef<{key:string;command:OnlineCommand}|undefined>(undefined)
  const localBackupRef=useRef<{match:MatchState;hasCampaign:boolean}|undefined>(undefined)
  const [menuOpen,setMenuOpen]=useState(true)
  const cameraMemory=useRef<CameraPoseSnapshot|undefined>(undefined)
  const [progress,setProgress]=useState(0)
  const [speed,setSpeed]=useState<1|2>(1)
  const speedRef=useRef<1|2>(1)
  const [activeEvent,setActiveEvent]=useState<CombatEvent>()
  const [replayActive,setReplayActive]=useState(false)
  const [replayProgress,setReplayProgress]=useState(0)
  const [followId,setFollowId]=useState<string>()
  const [executionBaseId,setExecutionBaseId]=useState<string>()
  const [focusPoint,setFocusPoint]=useState<Point>()
  const [routeNotice,setRouteNotice]=useState<string>()
  const [selectedAssetId,setSelectedAssetId]=useState<string>()
  const [inspectedFlightId,setInspectedFlightId]=useState<string>()
  const [planningStep,setPlanningStep]=useState<PlanningStep>('idle')
  const [selectingProtectTarget,setSelectingProtectTarget]=useState(false)
  const [planningBaseId,setPlanningBaseId]=useState('p-base')
  const [planningRosterMode,setPlanningRosterMode]=useState<PlanningRosterMode>('closed')
  const [reviewedIds,setReviewedIds]=useState<Set<string>>(()=>new Set())
  const [placementId,setPlacementId]=useState('p-base')
  const [worldMapOpen,setWorldMapOpen]=useState(false)
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
  useEffect(()=>{if(hasCampaign&&!onlineSession)try{localStorage.setItem(SAVE_KEY,JSON.stringify(match))}catch{}},[match,hasCampaign,onlineSession])
  const acceptOnlineResponse=useCallback((response:{view:OnlineView;invite?:string},session:OnlineSession,forceSnapshot=false)=>{
    const current=onlineRef.current
    if(!current||current.session.matchId!==session.matchId||current.session.token!==session.token)return
    const previous=current.view
    if(previous&&response.view.revision<previous.revision)return
    onlineRef.current={session:current.session,view:response.view}
    setOnlineView(response.view)
    if(response.invite)setOnlineInvite(response.invite)
    const entersPlan=response.view.match.phase==='plan'&&(!previous||previous.match.phase!=='plan'||previous.match.round!==response.view.match.round)
    if(entersPlan){setReviewedIds(new Set());setPlanningStep('idle');setSelectingProtectTarget(false);setPlanningRosterMode('closed');setRouteNotice(undefined)}
    if(forceSnapshot||!previous||response.view.revision>previous.revision)setMatch(response.view.match)
    setOnlineError(undefined)
  },[])
  const attachOnline=(session:OnlineSession,view:OnlineView,invite?:string)=>{
    if(!onlineSession)localBackupRef.current={match,hasCampaign}
    onlineRef.current={session,view};retryCommandRef.current=undefined
    try{localStorage.setItem(ONLINE_SESSION_KEY,JSON.stringify(session))}catch{}
    setSavedOnlineSession(session)
    setOnlineSession(session);setOnlineView(view);setOnlineInvite(invite);setOnlineInviteNotice('');setOnlineError(undefined);setOnlineCommandError(undefined);setMatch(view.match);setMenuOpen(false)
    const base=view.match.playerAssets.find(asset=>asset.kind==='base')
    if(base)setPlacementId(base.id)
  }
  const sendOnlineAction=useCallback(async(action:OnlineAction)=>{
    const current=onlineRef.current
    if(!current?.session||!current.view||onlineCommandBusy)return
    setOnlineCommandBusy(true);setOnlineError(undefined)
    const key=JSON.stringify({revision:current.view.revision,action})
    const previousRetry=retryCommandRef.current
    const command:OnlineCommand=previousRetry?.key===key?previousRetry.command:{id:globalThis.crypto?.getRandomValues?Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join(''):`${Date.now()}-${Math.random().toString(36).slice(2)}`,revision:current.view.revision,action}
    retryCommandRef.current={key,command}
    try{
      const response=await sendOnlineCommand(current.session,command)
      retryCommandRef.current=undefined
      if(onlineRef.current?.session.token===current.session.token&&onlineRef.current.session.matchId===current.session.matchId)setOnlineCommandError(undefined)
      acceptOnlineResponse(response,current.session,true)
    }catch(reason){
      if(onlineRef.current?.session.token===current.session.token&&onlineRef.current.session.matchId===current.session.matchId){setOnlineCommandError(reason instanceof Error?reason.message:'Online command failed. Retry when connected.')
        try{const latest=await fetchOnlineMatch(current.session);acceptOnlineResponse(latest,current.session)}catch{}}
    }finally{setOnlineCommandBusy(false)}
  },[acceptOnlineResponse,onlineCommandBusy])
  useEffect(()=>{if(!onlineSession){onlineRef.current=undefined;return}onlineRef.current={session:onlineSession,view:onlineRef.current?.view};let active=true
    let requestInFlight=false
    const refresh=async()=>{if(requestInFlight)return;requestInFlight=true;try{const response=await fetchOnlineMatch(onlineSession);if(!active)return;acceptOnlineResponse(response,onlineSession);setMenuOpen(false)}catch(reason){if(active&&onlineRef.current?.session.token===onlineSession.token&&onlineRef.current.session.matchId===onlineSession.matchId)setOnlineError(reason instanceof Error?reason.message:'Connection lost. Reconnecting…')}finally{requestInFlight=false}}
    void refresh();const timer=window.setInterval(()=>void refresh(),1600)
    return()=>{active=false;window.clearInterval(timer)}
  },[onlineSession,acceptOnlineResponse])
  const selected=match.squadrons.find(s=>s.id===match.selectedId) ?? match.squadrons[0]
  const replayMatch=useMemo(()=>replayActive&&match.phase==='debrief'&&match.lastResult?{...match,playerAssets:assetsAtRoundStart(match.playerAssets,match.lastResult),enemyAssets:assetsAtRoundStart(match.enemyAssets,match.lastResult)}:match,[match,replayActive])
  const campaign=isCampaign(match)
  const groundTargets=groundStrikeTargets(match)
  const pickingGroundTarget=isGroundStrikeTargeting(match.phase,selected,planningStep)
  const inspectionResult=match.phase==='execute'?liveResult:match.phase==='debrief'?match.lastResult:undefined
  const observedAssetIds=new Set(match.phase==='execute'?(liveResult?.contactObservations??[]).filter(observation=>observation.start<=liveResult!.duration&&observation.end>=liveResult!.duration).map(observation=>observation.targetId):[])
  const selectedAsset=[...match.playerAssets,...match.enemyAssets.filter(asset=>!asset.hidden&&asset.intel!=='unknown'||observedAssetIds.has(asset.id))].find(asset=>asset.id===selectedAssetId)
  const inspectionAsset=selectedAsset&&([...inspectionResult?.playerAssets??[],...inspectionResult?.assets??[]].find(asset=>asset.id===selectedAsset.id)??selectedAsset)
  const inspectedAsset=inspectionAsset&&observedAssetIds.has(inspectionAsset.id)&&inspectionAsset.intel==='unknown'?{...inspectionAsset,intel:'probable' as const,hidden:false,confidence:70}:inspectionAsset
  const inspectedAircraft=match.phase==='execute'&&inspectedFlightId?aircraftInspectionAt(liveResult,inspectedFlightId,liveResult?.duration??0):undefined
  const inspectAsset=(id:string)=>{if(match.phase==='adapt'){selectEconomyTarget({kind:'asset',id},false);return}setSelectedAssetId(id);setInspectedFlightId(undefined)}
  const inspectFlight=(id:string)=>{setInspectedFlightId(id);setSelectedAssetId(undefined)}
  const strikeTarget=campaign?confirmedStrikeTarget(match):undefined
  const knownEnemyBaseHealth=strikeTarget?Math.min(strikeTarget.health,liveResult?.assets.find(asset=>asset.id===strikeTarget.id&&asset.kind==='base'&&!asset.hidden)?.health??strikeTarget.health):undefined
  const liveHomeHealth=liveResult?.playerAssets.find(asset=>asset.kind==='base')?.health??match.playerAssets.find(asset=>asset.kind==='base')?.health??match.playerBaseHealth
  const intel=match.enemyAssets.filter(a=>a.intel!=='unknown').length
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
  const routeAdjustmentNotice=(adjustment:ReturnType<typeof generateRouteTemplate>['adjustment'])=>adjustment==='ingress-clamped'?'ROUTE CLAMPED AT THE VISIBLE MAP LIMIT':adjustment==='pattern-shrunk'?'ON-STATION PATTERN REDUCED TO FIT FUEL':adjustment==='ingress-shortened'?'INGRESS ROUTE SHORTENED TO PRESERVE RETURN FUEL':undefined

  const setRoute=useCallback((ingress:Point[])=>{
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
      setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,protectedPoint:[...protectedPoint] as Point,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}:s)}))
      return true
    }
    if(squadron.mission==='base-strike'){
      const anchors=buildGroundStrikeRoute(match,squadron.id,squadron.strikeTargetId)
      if(!anchors){setRouteNotice('SELECT A CONFIRMED GROUND TARGET');return false}
      const releasePoint=withOrigin.length>=2?withOrigin.at(-1)!:anchors.at(-1)!
      const target=match.enemyAssets.find(asset=>asset.id===squadron.strikeTargetId)
      const route=groundStrikeRoute(anchors,withOrigin.slice(1,-1),releasePoint)
      if(target&&pointDistance(releasePoint,target.position)>BASE_STRIKE_RANGE+.001){setRouteNotice(`KEEP THE STRIKE POINT INSIDE THE ${BASE_STRIKE_RANGE}-UNIT RELEASE CIRCLE`);return false}
      if(missionDistance(route,launch)>flightRangeFor(squadron)+.001){setRouteNotice('WAYPOINT EXCEEDS FUEL RANGE · NOT PLACED');return false}
      setRouteNotice(undefined)
      setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
      setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,route,routeIngress:route,plannedRecoveryFieldId:undefined}:s)}))
      return true
    }
    const generated=generateRouteTemplate({template:squadron.mission,ingress:withOrigin,maxDistance:flightRangeFor(squadron),bounds:routeBounds})
    setRouteNotice(routeAdjustmentNotice(generated.adjustment))
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next});setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,route:generated.route,routeIngress:generated.ingress,protectedPoint:s.mission==='defensive-cap'&&!s.protectedTargetId&&generated.ingress.length>1?[...generated.ingress.at(-1)!] as Point:s.protectedPoint,plannedRecoveryFieldId:undefined}:s)}))
    return true
  },[match,playerBase,selectingProtectTarget])
  const routeToAirfield=useCallback((fieldId:string,direct=false)=>{
    const field=match.playerAssets.find(asset=>asset.id===fieldId&&(asset.kind==='base'||asset.kind==='fob'))
    const squadron=match.squadrons.find(item=>item.id===match.selectedId)
    if(!field||!squadron)return
    setSelectingProtectTarget(protectTargetSelectionFor('exit'))
    const ingress=routeToRecoveryField(match,squadron.id,fieldId,direct)
    if(!ingress){setRouteNotice('RECOVERY AIRFIELD IS UNAVAILABLE');return}
    const view=deriveRecoveryPlanningView(match,squadron.id,ingress,flightRangeFor(squadron))
    setRouteNotice(view?.valid?`${squadron.role==='fighter'?'TRANSIT':'RECOVERY'} ROUTE SET TO ${field.name??(field.kind==='base'?'HOME BASE':'FOB')} · CONFIRM ORDERS`:view?.reason??'RECOVERY ROUTE IS NOT VALID')
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
    setMatch(state=>({...state,squadrons:state.squadrons.map(item=>item.id===squadron.id?{...item,mission:item.role==='fighter'?'transit':item.mission,route:ingress,routeIngress:ingress,plannedRecoveryFieldId:undefined}:item)}))
  },[match])
  const selectMission=useCallback((mission:MissionId)=>{
    const squadron=match.squadrons.find(s=>s.id===match.selectedId)??match.squadrons[0]
    if(mission==='base-strike'){
      const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase
      setSelectingProtectTarget(false)
      setRouteNotice(undefined)
      setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
      setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,mission,strikeTargetId:undefined,route:[launch],routeIngress:[launch],plannedRecoveryFieldId:undefined}:s)}))
      setPlanningStep('target')
      return
    }
    const base=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const existing=squadron.routeIngress.length>=2?squadron.routeIngress:squadron.route.length>=2?squadron.route:[base]
    const ingress:[[number,number],...Point[]]=[[...base],...existing.slice(1)]
    const routeBounds=match.world.presentationBounds
    const generated=generateRouteTemplate({template:mission,ingress,maxDistance:flightRangeFor(squadron),bounds:routeBounds})
    const protect=mission==='defensive-cap'
    setSelectingProtectTarget(false)
    setRouteNotice(routeAdjustmentNotice(generated.adjustment))
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
    setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,mission,strikeTargetId:undefined,protectedPoint:protect&&generated.ingress.length>1?[...generated.ingress.at(-1)!] as Point:undefined,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}:s)}))
    setPlanningStep('route')
  },[match,playerBase])
  const selectGroundTarget=(targetId:string)=>{
    if(!pickingGroundTarget)return
    const order=planGroundStrike(match,selected.id,targetId)
    inspectAsset(targetId)
    if(!order){setRouteNotice('NO LEGAL STRIKE INGRESS FROM THIS FIELD');return}
    setSelectingProtectTarget(false)
    setPlanningRosterMode('closed')
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(selected.id);return next})
    setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===selected.id?order:s)}))
    setRouteNotice(undefined)
    setPlanningStep('route')
  }
  const changeGroundTarget=()=>{setReviewedIds(ids=>{const next=new Set(ids);next.delete(selected.id);return next});setPlanningStep('target');setRouteNotice(undefined)}
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
  const commit=(includeSelectedRoute=false)=>{
    if(onlineSession&&(onlineView?.locked||onlineCommandBusy))return
    const orderedIds=new Set(reviewedIds)
    let source=match
    if(includeSelectedRoute){
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
    if(onlineSession){const orders=orderedMatch.squadrons.filter(squadron=>orderedIds.has(squadron.id)).map(squadron=>({id:squadron.id,mission:squadron.mission,route:squadron.route,routeIngress:squadron.routeIngress,strikeTargetId:squadron.strikeTargetId,reconPosture:squadron.reconPosture,protectedPoint:squadron.protectedPoint,protectedTargetId:squadron.protectedTargetId,plannedRecoveryFieldId:squadron.plannedRecoveryFieldId}));void sendOnlineAction({type:'lock-plan',orders});return}
    const simulation=createRoundSimulation(orderedMatch);simulationRef.current=simulation;resultRef.current=simulation.result;completingRef.current=false;setLiveResult(simulation.result);setAcknowledgedThreatIds(new Set());setProgress(1);setActiveEvent(undefined);setFollowId(match.selectedId);setExecutionBaseId(formationBaseId(planningBaseGroups,match.selectedId)??activePlanningBaseId);setFocusPoint(undefined);setMatch({...orderedMatch,phase:'execute'})
  }
  useEffect(()=>{
    const simulation=simulationRef.current;if(onlineSession||menuOpen||match.phase!=='execute'||!simulation)return
    let frame=0,last=performance.now(),accumulator=0,completionTimer:number|undefined
    const tick=(now:number)=>{accumulator+=(now-last)*speedRef.current;last=now;let advanced=false;while(accumulator>=TICK_SECONDS*1000&&!simulation.complete){const result=simulation.advance();resultRef.current=result;accumulator-=TICK_SECONDS*1000;advanced=true}if(advanced){setLiveResult(simulation.result);setActiveEvent(simulation.result.events.filter(event=>event.time<=simulation.result.duration).at(-1))}if(simulation.complete){if(!completingRef.current){completingRef.current=true;completionTimer=window.setTimeout(()=>setMatch(current=>current.phase==='execute'?applyRound(current,simulation.result):current),1250)}return}frame=requestAnimationFrame(tick)}
    frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);if(completionTimer!==undefined){clearTimeout(completionTimer);completingRef.current=false}}
  },[match.phase,menuOpen,onlineSession])
  useEffect(()=>{
    const result=match.phase==='debrief'?match.lastResult:undefined
    if(!replayActive||!result||result.duration<=0)return
    let frame=0,completionTimer:number|undefined,last=performance.now(),lastPublish=last,elapsed=replayProgress*result.duration
    const tick=(now:number)=>{
      elapsed=Math.min(result.duration,elapsed+Math.max(0,Math.min(100,now-last))/1000*speedRef.current);last=now
      if(now-lastPublish>=50||elapsed>=result.duration){lastPublish=now;setReplayProgress(elapsed/result.duration);setActiveEvent(result.events.filter(event=>event.time<=elapsed).at(-1))}
      if(elapsed>=result.duration){completionTimer=window.setTimeout(()=>{setReplayActive(false);setReplayProgress(0);setActiveEvent(undefined);setFollowId(undefined)},900);return}
      frame=requestAnimationFrame(tick)
    }
    frame=requestAnimationFrame(tick)
    return()=>{cancelAnimationFrame(frame);if(completionTimer!==undefined)clearTimeout(completionTimer)}
  },[match.lastResult,match.phase,replayActive])

  const closeProcurement=()=>{setProcurementMode('closed');setProcurementActionId(undefined);setProcurementPlacement(undefined)}
  const enterAdapt=()=>{if(onlineSession){void sendOnlineAction({type:'debrief'});return}const next=openAdaptPhase(match);setWorldMapOpen(false);setFollowId(undefined);setExecutionBaseId(undefined);setSelectedAssetId(undefined);setInspectedFlightId(undefined);closeProcurement();setEconomyTarget({kind:'campaign',id:'campaign'});setFocusPoint(playerBase);setMatch(next)}
  const startReplay=()=>{if(!match.lastResult)return;setReplayProgress(0);setActiveEvent(undefined);setFollowId(undefined);setReplayActive(true)}
  const stopReplay=()=>{setReplayActive(false);setReplayProgress(0);setActiveEvent(undefined);setFollowId(undefined)}
  const nextRound=()=>{if(onlineSession){void sendOnlineAction({type:'next-round'});return}setSelectedAssetId(undefined);setInspectedFlightId(undefined);simulationRef.current=undefined;setLiveResult(undefined);setAcknowledgedThreatIds(new Set());setWorldMapOpen(false);setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined);setRouteNotice(undefined);setPlanningStep('idle');setReviewedIds(new Set());setPlanningBaseId('p-base');setPlanningRosterMode('closed');closeProcurement();setMatch(beginNextRound)}
  const resetPlanningUi=()=>{cameraMemory.current=undefined;setSelectedAssetId(undefined);setInspectedFlightId(undefined);simulationRef.current=undefined;setLiveResult(undefined);setAcknowledgedThreatIds(new Set());setWorldMapOpen(false);setProgress(0);setReplayActive(false);setReplayProgress(0);setActiveEvent(undefined);setFollowId(undefined);setExecutionBaseId(undefined);setFocusPoint(undefined);setRouteNotice(undefined);setPlanningStep('idle');setPlanningBaseId('p-base');setPlanningRosterMode('closed');setReviewedIds(new Set());closeProcurement()}
  const selectScenario=(scenario:DebugScenario)=>{setHasCampaign(true);resetPlanningUi();setEconomyTarget({kind:'campaign',id:'campaign'});setMatch(createScenario(scenario))}
  const restart=()=>{const seed=freshCampaignSeed();localStorage.removeItem(SAVE_KEY);for(const key of LEGACY_SAVE_KEYS)localStorage.removeItem(key);resetPlanningUi();setEconomyTarget({kind:'campaign',id:'campaign'});setMatch(m=>m.debugScenario&&m.debugScenario!=='campaign'?createScenario(m.debugScenario):createCampaignDraft(seed,m.cpu?.difficulty))}
  const selectFormation=(id:string)=>{setAcknowledgedThreatIds(current=>{const next=new Set(current);for(const alert of liveResult?.threatAlerts??[])if(alert.unitId===id)next.add(alert.id);return next});setFollowId(id);setFocusPoint(undefined);setMatch(m=>({...m,selectedId:id}))}
  const confirmPlanningOrder=(squadron:Squadron,state:MatchState=match):boolean=>{
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
    const asset=match.playerAssets.find(item=>item.id===id)
    const squadron=match.squadrons.find(item=>item.id===match.selectedId)
    if(!asset||!squadron||!selectingProtectTarget)return
    const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const generated=generateRouteTemplate({template:'defensive-cap',ingress:[[...launch] as Point,[...asset.position] as Point],maxDistance:flightRangeFor(squadron),bounds:match.world.presentationBounds})
    const station=generated.ingress.at(-1)
    if(!station||Math.hypot(station[0]-asset.position[0],station[1]-asset.position[1])>.1){setRouteNotice('SITE OUT OF REACH · CHOOSE A CLOSER PROTECTION POINT');return}
    const candidate={...squadron,protectedPoint:[...asset.position] as Point,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}
    finishProtectOrder(squadron,candidate,match)
  }
  const selectProtectPoint=(point:Point)=>{
    const squadron=match.squadrons.find(item=>item.id===match.selectedId)
    if(!selectingProtectTarget||!squadron)return
    const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const generated=generateRouteTemplate({template:'defensive-cap',ingress:[[...launch] as Point,[...point] as Point],maxDistance:flightRangeFor(squadron),bounds:match.world.presentationBounds})
    const station=generated.ingress.at(-1)
    if(!station||Math.hypot(station[0]-point[0],station[1]-point[1])>.1){setRouteNotice('POINT OUT OF REACH · CHOOSE A CLOSER PROTECTION POINT');return}
    const candidate={...squadron,protectedPoint:[...point] as Point,protectedTargetId:undefined,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}
    finishProtectOrder(squadron,candidate,match)
  }
  const protectTarget=selected.protectedTargetId?match.squadrons.find(item=>item.id===selected.protectedTargetId):undefined
  const protectAsset=selected.protectedPoint?match.playerAssets.find(asset=>Math.hypot(asset.position[0]-selected.protectedPoint![0],asset.position[1]-selected.protectedPoint![1])<.01):undefined
  const protectSummary=selected.mission==='defensive-cap'?(protectTarget?`ESCORT ${protectTarget.callsign} · MAX RANGE`:selected.protectedPoint?`DEFEND ${protectAsset?.name??protectAsset?.kind.toUpperCase()??'ROUTE ENDPOINT'}`:undefined):undefined
  const selectProtectFlight=(id:string)=>{const squadron=match.squadrons.find(item=>item.id===match.selectedId);const target=match.squadrons.find(item=>item.id===id);if(!squadron||squadron.mission!=='defensive-cap'||!target||target.id===squadron.id||!reviewedIds.has(target.id)||target.aircraft<=0)return;const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase;const escortRecovery=match.playerAssets.find(asset=>asset.id===squadron.plannedRecoveryFieldId)?.position??launch;const targetLaunch=formationField(match.playerAssets,target.id)?.position??target.route[0];const targetRecovery=match.playerAssets.find(asset=>asset.id===target.plannedRecoveryFieldId)?.position??targetLaunch;const targetRoute=target.route.at(-1)&&pointDistance(target.route.at(-1)!,targetRecovery)<.03?target.route:[...target.route,[...targetRecovery] as Point];const route=maxEscortRoute(launch,targetRoute,escortRecovery,flightRangeFor(squadron));if(route.length<2){setRouteNotice('NO FIGHTER RANGE AVAILABLE FOR THIS ESCORT');return}const candidate={...squadron,protectedTargetId:target.id,protectedPoint:undefined,route,routeIngress:route,plannedRecoveryFieldId:undefined};setRouteNotice('ESCORT ROUTE DRAWN TO MAX FIGHTER RANGE · CONFIRM ORDER');finishProtectOrder(squadron,candidate,match)}
  const setReconPosture=(posture:ReconPosture)=>{const id=match.selectedId;setMatch(current=>({...current,squadrons:current.squadrons.map(squadron=>squadron.id===id&&squadron.role==='recon'?{...squadron,reconPosture:posture}:squadron)}))}
  const selectPlanningFormation=(id:string)=>{
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
  const selectPlanningBase=(id:string)=>{if(!planningBaseGroups.some(group=>group.base.id===id))return;setPlanningBaseId(id);setPlanningRosterMode('closed');setPlanningStep('idle');setRouteNotice(undefined)}
  const selectExecutionBase=(id:string)=>{const base=match.playerAssets.find(asset=>asset.id===id&&(asset.kind==='base'||asset.kind==='fob'));if(!base)return;setExecutionBaseId(id);setFollowId(undefined);setFocusPoint(base.position)}
  const focusAirfield=()=>{const id=formationBaseId(planningBaseGroups,match.selectedId)??executionBaseId??'p-base';selectExecutionBase(id)}
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
  const exitOnline=()=>{onlineRef.current=undefined;retryCommandRef.current=undefined;setOnlineSession(undefined);setOnlineView(undefined);setOnlineInvite(undefined);setOnlineInviteNotice('');setOnlineError(undefined);setOnlineCommandError(undefined);setOnlineCommandBusy(false);const backup=localBackupRef.current??loadMatch();localBackupRef.current=undefined;resetPlanningUi();setMatch(backup.match);setHasCampaign(backup.hasCampaign);setMenuOpen(true)}
  const forgetOnline=()=>{try{localStorage.removeItem(ONLINE_SESSION_KEY)}catch{}setSavedOnlineSession(undefined);exitOnline()}
  const continueOnline=()=>{if(!savedOnlineSession)return;onlineRef.current={session:savedOnlineSession};setOnlineSession(savedOnlineSession);setOnlineView(undefined);setOnlineInvite(undefined);setOnlineInviteNotice('');setOnlineError(undefined);setOnlineCommandError(undefined);setMenuOpen(false)}
  if(menuOpen&&!onlineSession)return <CampaignMenu saved={hasCampaign?match:undefined} savedOnline={ONLINE_UI_ENABLED&&Boolean(savedOnlineSession)} onContinueOnline={ONLINE_UI_ENABLED?continueOnline:undefined} onContinue={()=>setMenuOpen(false)} onStart={startCampaign} onCreateOnline={ONLINE_UI_ENABLED?entry=>attachOnline(entry.session,entry.view,entry.invite):undefined} onJoinOnline={ONLINE_UI_ENABLED?entry=>attachOnline(entry.session,entry.view):undefined}/>
  if(onlineSession&&!onlineView)return <main className="online-reconnect"><section><small>ONLINE SESSION</small><h1>RECONNECTING</h1><p>{onlineError??'Restoring your seat and loading the latest match state…'}</p><button type="button" onClick={exitOnline}>RETURN TO MENU</button><button type="button" className="forget-online" onClick={forgetOnline}>CLEAR SAVED ONLINE SEAT</button></section></main>

  return <main className="app-shell">
    <div className={`game-frame phase-${match.phase} ${planningStep!=='idle'||match.phase==='execute'&&executionBaseId?'shelf-open chit-queue-open':''} ${planningStep==='route'?'route-step-open':''} ${planningRosterMode!=='closed'?'roster-open':''}`}>
      <TopBar round={match.round} intel={intel} logistics={match.logistics} replacements={match.replacements} score={match.campaignScore??0} phase={match.phase} debugScenario={match.debugScenario??'campaign'} onDebugScenario={selectScenario} onReboot={restart} onMenu={onlineSession?exitOnline:()=>setMenuOpen(true)} difficulty={match.cpu?.difficulty} online={Boolean(onlineSession)}/>
      {onlineSession?<div className="online-match-status" role="status"><span className={`connection-mark ${onlineError?'offline':''}`}/><b>{onlineError?'RECONNECTING':onlineView?.joined?'OPPONENT JOINED':'WAITING FOR OPPONENT'}</b>{onlineView?.locked?<span>YOUR ORDERS LOCKED</span>:onlineView?.opponentLocked?<span>OPPONENT LOCKED</span>:null}{onlineInvite&&!onlineView?.joined?<div className="online-invite"><small>ONE-USE INVITE CODE</small><input aria-label="One-use invite code" readOnly value={onlineInvite} onFocus={event=>event.currentTarget.select()}/><button type="button" onClick={()=>{if(navigator.clipboard?.writeText)void navigator.clipboard.writeText(onlineInvite).then(()=>setOnlineInviteNotice('INVITE COPIED'),()=>setOnlineInviteNotice('SELECT THE CODE TO COPY'));else setOnlineInviteNotice('SELECT THE CODE TO COPY')}}>{onlineInviteNotice||'COPY'}</button></div>:null}{onlineCommandBusy?<span>SENDING…</span>:null}</div>:null}
      {(onlineCommandError||onlineError)?<div className="online-command-error" role="alert"><span>{onlineCommandError??onlineError}</span><button type="button" onClick={()=>{const retry=retryCommandRef.current;const current=onlineRef.current;if(onlineCommandError&&retry&&current?.view?.revision===retry.command.revision){setOnlineCommandError(undefined);void sendOnlineAction(retry.command.action);return}if(onlineCommandError){setOnlineCommandError(undefined);retryCommandRef.current=undefined}setOnlineError(undefined);if(current)void fetchOnlineMatch(current.session).then(response=>acceptOnlineResponse(response,current.session)).catch(error=>setOnlineError(error instanceof Error?error.message:'Reconnect failed.'))}}>RETRY</button></div>:null}
      <div className="map-wrap"><Battlefield cameraMemory={cameraMemory} squadrons={match.squadrons} assets={replayMatch.enemyAssets} playerAssets={match.phase==='deploy'&&match.setup?replayMatch.playerAssets.filter(asset=>SETUP_REQUIRED_ASSET_IDS.includes(asset.id as typeof SETUP_REQUIRED_ASSET_IDS[number])&&(match.setup!.placedAssetIds.includes(asset.id)||asset.id===placementId)):replayMatch.playerAssets} mappedAreas={match.mappedAreas} discoveredBoundaries={match.discoveredBoundaries} presentationBounds={match.world.presentationBounds} planningBounds={activeMapPlanningBounds} friendlyTerritory={friendlyTerritory} selectedId={match.selectedId} followId={followId} focusPoint={focusPoint} placementId={placementId} positionedPlacementIds={match.setup?.placedAssetIds} onPlacementSelect={id=>{if(!onlineView?.locked&&!onlineCommandBusy)setPlacementId(id)}} planningBaseId={activePlanningBaseId} executionBaseId={executionBaseId} planningRecoveryFieldId={match.phase==='plan'&&recoveryView&&selectedLaunchField&&recoveryView.intendedField.id!==selectedLaunchField.id?recoveryView.intendedField.id:undefined} plannedFormationIds={[...reviewedIds]} routeOrigin={selectedLaunchField?.position} routePlanningEnabled={planningStep==='route'} showMissionPreview={planningStep==='route'} selectingGroundTarget={pickingGroundTarget} onGroundTargetSelect={selectGroundTarget} selectedAssetId={selectedAssetId} inspectedFlightId={inspectedFlightId} onAssetInspect={inspectAsset} onFlightInspect={inspectFlight} selectingProtectTarget={selectingProtectTarget} escortPreview={protectTarget?{targetId:protectTarget.id}:undefined} phase={replayActive?'execute':match.phase} progress={replayActive?replayProgress:progress} activeEvent={activeEvent} executionResult={match.phase==='execute'?liveResult:match.phase==='debrief'||match.phase==='adapt'?match.lastResult:undefined} packageReview={false} economySelectionId={economyTarget.kind==='asset'?economyTarget.id:undefined} onPlanningBaseSelect={selectPlanningBase} onPlanningFormationSelect={selectPlanningFormation} onPlanningProtectTarget={selectProtectAsset} onPlanningProtectPoint={selectProtectPoint} onPlanningProtectFlight={selectProtectFlight} onPlanningRecoverySelect={routeToAirfield} onExecutionBaseSelect={selectExecutionBase} onEconomySelect={id=>selectEconomyTarget({kind:'asset',id},false)} construction={match.phase==='adapt'&&procurementMode==='placing'&&procurementDefinition?{kind:procurementDefinition.kind,placement:procurementPlacement,isValid:validProcurementPoint,onStage:stageProcurementPlacement}:undefined} isPlacementValid={match.phase==='deploy'&&(onlineSession||!match.setup||match.setup.stage==='place'||match.setup.stage==='review')?point=>validateInitialPlacement(match,placementId,point).length===0:undefined} onRoute={setRoute} onPlace={match.phase==='deploy'&&(onlineSession||match.setup?.stage==='place'||match.setup?.stage==='review'||!match.setup)?stageInitialPlacement:()=>{}}/>
        {match.phase!=='adapt'&&inspectedAsset?<AssetInspector asset={inspectedAsset} enemy={match.enemyAssets.some(asset=>asset.id===inspectedAsset.id)} phase={match.phase} result={inspectionResult} seconds={inspectionResult?.duration??0} onClose={()=>setSelectedAssetId(undefined)}/>:inspectedAircraft?<AircraftInspector {...inspectedAircraft} onClose={()=>setInspectedFlightId(undefined)}/>:null}
        {campaign&&(match.phase==='plan'||match.phase==='execute')?<CampaignBriefing match={match} target={strikeTarget} homeHealth={Math.round(liveHomeHealth)} enemyHealth={knownEnemyBaseHealth===undefined?undefined:Math.round(knownEnemyBaseHealth)}/>:null}
        {match.phase!=='deploy'?<button className="world-map-toggle" type="button" onClick={()=>setWorldMapOpen(true)}><MapIcon/> KNOWN WORLD</button>:null}
        {worldMapOpen?<div className="known-world-modal" role="dialog" aria-modal="true"><KnownWorldMap model={knownWorld} onClose={()=>setWorldMapOpen(false)}/></div>:null}
        {match.phase==='deploy'&&match.setup&&(match.setup.stage==='place'||match.setup.stage==='review')?<div className="map-tip deploy-tip"><span>TAP HEX</span> PLACE OR MOVE SELECTED ASSET · VALID HEXES ONLY</div>:null}
      {match.phase==='plan'&&planningStep==='idle'?<div className="map-tip"><span>TAP AIRFIELD</span> START FORMATION PLANNING</div>:null}
        {match.phase==='execute'||replayActive?<ExecutionOverlay progress={replayActive?replayProgress:progress} activeEvent={activeEvent} speed={speed} onSpeed={()=>setSpeed(s=>s===1?2:1)} match={replayMatch} result={match.phase==='debrief'?match.lastResult:liveResult} selectedId={match.selectedId} followId={followId} onSelectFormation={selectFormation} onClearFollow={()=>setFollowId(undefined)} onAirfield={focusAirfield} onEventFocus={focusEvent} onContactFocus={point=>{setFollowId(undefined);setFocusPoint(point)}}/>:null}
        {replayActive?<div className="replay-transport"><span>ROUND REPLAY · {Math.round(replayProgress*100)}%</span><button type="button" onClick={stopReplay}>RETURN TO DEBRIEF</button></div>:null}
      </div>
      {match.phase==='execute'&&executionBaseId?<ExecutionChitRail squadrons={match.squadrons} bases={match.playerAssets} result={liveResult} progress={progress} activeBaseId={executionBaseId} selectedId={match.selectedId} followId={followId} threatenedIds={new Set((liveResult?.threatAlerts??[]).filter(alert=>!acknowledgedThreatIds.has(alert.id)).map(alert=>alert.unitId))} onSelect={selectFormation}/>:null}
      {match.phase==='deploy'&&onlineSession&&onlineView?.locked?<section className="online-wait-panel"><small>DEPLOYMENT LOCKED</small><strong>{onlineView.opponentLocked?'BOTH DEPLOYMENTS LOCKED':'WAITING FOR OPPONENT TO LOCK'}</strong><p>Your opening package is fixed for this match.</p></section>:match.phase==='deploy'&&match.setup?<CampaignSetupPanel match={match} placementId={placementId} onSelectPlacement={id=>{if(!onlineView?.locked&&!onlineCommandBusy)setPlacementId(id)}} onContinue={()=>onlineSession?void sendOnlineAction({type:'lock-deploy'}):advanceCampaignSetup()}/>:match.phase==='deploy'?<DeploymentPanel assets={match.playerAssets} selectedId={placementId} onSelect={setPlacementId} locked={Boolean(onlineView?.locked||onlineCommandBusy)} online={Boolean(onlineSession)} onLock={()=>onlineSession?void sendOnlineAction({type:'lock-deploy'}):setMatch(m=>({...m,phase:'plan'}))}/>:null}
      {match.phase==='plan'&&onlineSession&&onlineView?.locked?<section className="online-wait-panel"><small>ROUND {match.round} · PLAN LOCKED</small><strong>{onlineView.opponentLocked?'BOTH ORDERS LOCKED · ROUND SETTLING':'WAITING FOR OPPONENT TO LOCK'}</strong><p>You can review the battlefield while the server waits for the other seat.</p></section>:null}
      {match.phase==='plan'&&!(onlineSession&&onlineView?.locked)?<CommandShelf squadrons={match.squadrons} bases={match.playerAssets} activeBaseId={activePlanningBaseId} rosterMode={planningRosterMode} squadron={selected} routeDistance={recoveryView?.missionDistance??missionDistance(selected.route,playerBase)} maxDistance={flightRangeFor(selected)} routeNotice={routeNotice} protectSummary={protectSummary} recoverySummary={recoveryView?.summary} onSelect={selectPlanningFormation} onBaseSelect={selectPlanningBase} onRosterMode={mode=>{setPlanningRosterMode(mode);if(mode!=='closed'){setPlanningStep('idle');setSelectingProtectTarget(false)}}} onMission={selectMission} onPickProtectTarget={()=>{setSelectingProtectTarget(true);setRouteNotice(undefined)}} onProtectFlight={selectProtectFlight} onReconPosture={setReconPosture} onRecoverHome={()=>routeToAirfield('p-base',true)} onClear={()=>{setRouteNotice(undefined);if(selectingProtectTarget)setSelectingProtectTarget(false);else setRoute([])}} onBack={()=>{setPlanningStep('mission');setSelectingProtectTarget(false);setRouteNotice(undefined)}} onCommit={()=>commit(planningStep==='route')} step={planningStep} onClose={()=>{if(planningStep==='route'&&selected.route.length>=2&&!selectingProtectTarget&&!confirmPlanningOrder(selected))return;setPlanningStep('idle');setSelectingProtectTarget(false)}} reviewedIds={reviewedIds} reviewedCount={reviewedCount} totalCount={viableFormationIds.length} groundTargets={groundTargets} onChangeGroundTarget={changeGroundTarget} strikeUnlocked={groundTargets.length>0} strikeDisabledReason="RECOVER GROUND TARGET INTELLIGENCE FIRST" selectingProtectTarget={selectingProtectTarget} onlineLock={Boolean(onlineSession)} allowEmptyCommit={Boolean(onlineSession)}/>:null}
      {match.phase==='debrief'&&match.lastResult&&!replayActive?<Debrief match={match} onFocus={point=>{setFollowId(undefined);setFocusPoint([...point] as Point)}} onAdapt={enterAdapt} onReplay={onlineSession?startReplay:undefined}/>:null}
      {match.phase==='adapt'?<AdaptPanel match={match} selectedTarget={economyTarget} onSelectTarget={selectEconomyTarget} onCloseTarget={()=>selectEconomyTarget({kind:'campaign',id:'campaign'})} onPurchase={purchaseEconomy} onNextRound={nextRound} procurementMode={procurementMode} procurementActionId={procurementActionId} onProcurementMode={changeProcurementMode} onProcurementAction={selectProcurementAction} hasPlacementPreview={Boolean(procurementPlacement)} onConfirmPlacement={confirmProcurementPlacement} onCancelPlacement={()=>setProcurementPlacement(undefined)}/>:null}
      {(match.phase==='victory'||match.phase==='defeat'||match.phase==='draw')?<EndState victory={match.phase==='victory'} round={match.round} outcome={campaignOutcome(match)} onRestart={()=>setMenuOpen(true)}/>:null}
    </div>
  </main>
}

function DeploymentPanel({assets,selectedId,onSelect,onLock,locked=false,online=false}:{assets:Asset[];selectedId:string;onSelect:(id:string)=>void;onLock:()=>void;locked?:boolean;online?:boolean}){
  return <section className="deployment-panel"><div className="deployment-head"><div><small>{online?'ONLINE DEPLOYMENT':'PRE-MATCH DEPLOYMENT'}</small><h2>BUILD YOUR DECEPTION</h2></div><ShieldCheck/></div><p>{locked?'Deployment locked. Waiting for the other seat.':'Select an asset, then tap a highlighted hex to place or move it. Lock the full layout when ready.'}</p><div className="asset-picker">{assets.map(a=><button key={a.id} disabled={locked} className={a.id===selectedId?'active':''} onClick={()=>onSelect(a.id)}><b>{a.kind.toUpperCase()}</b><small>{a.kind==='base'?'PRIMARY':a.kind==='decoy'?'FALSE FIELD':a.kind==='radar'?'DETECT 6.4':a.kind==='sam'?'ENGAGE 3.2':'ENGAGE 1.9'}</small></button>)}</div><button className="commit" disabled={locked} onClick={onLock}>{online?'LOCK DEPLOYMENT':'BEGIN PLANNING'} <span>››</span></button></section>
}

function ExecutionOverlay({progress,activeEvent,speed,onSpeed,match,result,selectedId,followId,onSelectFormation,onClearFollow,onAirfield,onEventFocus,onContactFocus}:{progress:number;activeEvent?:CombatEvent;speed:number;onSpeed:()=>void;match:MatchState;result?:RoundResult;selectedId:string;followId?:string;onSelectFormation:(id:string)=>void;onClearFollow:()=>void;onAirfield:()=>void;onEventFocus:(event:CombatEvent)=>void;onContactFocus:(point:Point)=>void}){
  const seconds=progress*(result?.duration??22)
  const contacts=result?.enemyFlights.flatMap(flight=>{const projection=projectHostileUnitAt(result,flight.id,seconds);return projection?[projection]:[]})??[]
  const visualCount=contacts.filter(contact=>contact.visibility==='visual').length
  const radarCount=contacts.length-visualCount
  const visual=visualCount>0
  const cue=result?.defenseCues?.find(c=>progress>=c.start&&progress<=c.end)
  const recovering=match.squadrons.some(squadron=>projectFriendlyUnitAt(result,squadron.id,seconds)?.frame.mode==='recovering')
  return <div className="execute-hud"><div className="timer live" aria-label={`${seconds.toFixed(1)} seconds elapsed`}><i style={{width:`${Math.min(100,seconds/60*100)}%`}}/></div>{recovering||contacts.length?<div className={`contact-status ${contacts.length?'hot':''} ${visual?'visual':''}`}>{contacts.length?`${contacts.length} TRACKS · ${visualCount} VISUAL / ${radarCount} RADAR`:'RECOVERY IN PROGRESS'}</div>:null}{cue?<div className="cue-status"><ShieldCheck/> DEFENSE CUED · +{cue.rangeBonus.toFixed(1)} RANGE</div>:null}<ContactTracks result={result} seconds={seconds} home={match.playerAssets.find(asset=>asset.kind==='base')?.position??match.world.friendlyTerritory.center} onFocus={onContactFocus}/><ObserveEventFeed events={result?.events??[]} progress={progress} duration={result?.duration} onFocus={onEventFocus}/><FormationDock squadrons={match.squadrons} bases={match.playerAssets} result={result} progress={progress} selectedId={selectedId} followId={followId} onSelect={onSelectFormation} onClearFollow={onClearFollow} onAirfield={onAirfield}/>
    <div className="exec-controls"><button className="speed" onClick={onSpeed}><FastForward/>{speed}×</button></div></div>
}

export function Debrief({match,onFocus,onAdapt,onReplay}:{match:MatchState;onFocus:(point:Point)=>void;onAdapt:()=>void;onReplay?:()=>void}){
  const result=match.lastResult!
  const outcome=campaignOutcome(match)
  const message=outcome?campaignOutcomeMessage(outcome):undefined
  const intel=result.intelReports.filter(report=>report.recovered).map(report=>result.assets.find(asset=>asset.id===report.assetId)).filter((asset):asset is Asset=>!!asset)
  const losses=result.friendlyAttrition.filter(item=>item.aircraftLost>0)
  const orders=missionOrderDebrief(match,result)
  const sites=useMemo(()=>debriefMapSites(result),[result])
  return <section className="debrief briefing debrief-summary" aria-label="After action summary">
    <div className="debrief-content">
    <header><div><small>MISSION COMPLETE</small><h2>AFTER ACTION</h2></div>{message?<strong className="debrief-outcome">{message.title}</strong>:null}</header>
    <div className="debrief-metrics"><div><strong>{result.friendlyLosses}</strong><span>FRIENDLY LOST</span></div><div><strong>{result.enemyLosses}</strong><span>ENEMY LOST · CONFIRMED</span></div><div><strong>{intel.length}</strong><span>INTEL RECOVERED</span></div><div><strong>+{result.logisticsIncome.total}</strong><span>LOGISTICS</span></div></div>
    <DebriefLegend/>
    <p className="debrief-map-note">Reported locations only. Unlocated losses remain in the totals.</p>
    <div className="debrief-highlights" aria-label="Round highlights"><small>ROUND HIGHLIGHTS · SELECT A SITE TO FOCUS</small>
      {sites.length?sites.map(site=><button key={site.id} onClick={()=>onFocus([...site.position])} className={`debrief-site ${primaryDebriefEvent(site).side}`}>
        <span className="debrief-site-number">{site.number}</span><DebriefSymbol kind={primaryDebriefEvent(site).kind}/>
        <span className="debrief-site-reports">{site.events.map(event=><span key={event.id}><b>{event.title}</b><span>{event.detail}</span><time>{event.time.toFixed(1)}s</time></span>)}</span><ChevronRight/>
      </button>):<p>No combat, aircraft losses, or new intelligence reported this round.</p>}
    </div>
    {orders.length?<div className="debrief-orders" aria-label="Mission orders and results"><small>ORDERS & RESULTS</small>{orders.map(order=><p key={order.id}><b>{order.callsign} · {order.purpose}</b><span>{order.result}</span></p>)}</div>:null}
    {isCampaign(match)?<div className="debrief-campaign"><span>HOME BASE <b>{match.playerBaseHealth}%</b></span>{result.enemyBaseDamage>0?<span>ENEMY BASE <b>−{result.enemyBaseDamage}</b></span>:null}</div>:null}
    {message?<p className="debrief-message">{message.message}</p>:null}
    {losses.length||intel.length?<details className="debrief-details"><summary>VIEW FORMATION & INTEL DETAILS</summary><div>{losses.map(item=><p key={item.id}>{item.callsign}: {item.startAircraft} → {item.endAircraft} AIRCRAFT · {item.endStrength}% STRENGTH</p>)}{intel.map(asset=><button key={asset.id} onClick={()=>onFocus(asset.position)}>NEW INTEL · {asset.kind.toUpperCase()} · FOCUS MAP</button>)}</div></details>:null}
    </div>
    <div className="debrief-actions">{onReplay?<button className="debrief-replay" onClick={onReplay}>WATCH REPLAY</button>:null}<button className="debrief-continue" onClick={onAdapt}>{message?'VIEW OUTCOME':'OPEN ADAPT'} <ChevronRight/></button></div>
  </section>
}

export function campaignOutcomeMessage(outcome:NonNullable<ReturnType<typeof campaignOutcome>>){
  switch(outcome){
    case 'enemy-base-destroyed':return{title:'ENEMY BASE DESTROYED',message:'Your strike destroyed the enemy base.'}
    case 'home-base-destroyed':return{title:'HOME BASE DESTROYED',message:'Enemy strikes destroyed your home base.'}
    case 'deadline':return{title:'DEADLINE REACHED',message:'Draw. Both bases survived the six-round campaign.'}
    case 'mutual-destruction':return{title:'DRAW',message:'Draw. Both bases were destroyed in the same round.'}
    case 'mutual-forces-lost':return{title:'DRAW',message:'Draw. Both sides lost all formations and reserve aircraft.'}
    case 'enemy-forces-lost':return{title:'ENEMY FORCES LOST',message:'All enemy formations and reserve aircraft have been lost.'}
    case 'forces-lost':return{title:'FORCES LOST',message:'All available formations and reserve aircraft have been lost.'}
  }
}

export function EndState({victory,round,outcome,onRestart}:{victory:boolean;round:number;outcome:ReturnType<typeof campaignOutcome>;onRestart:()=>void}){
  const draw=outcome==='deadline'||outcome==='mutual-destruction'||outcome==='mutual-forces-lost'
  const title=draw?'DRAW':outcome==='forces-lost'?'FORCES LOST':victory?'BREAKTHROUGH':'COMMAND LOST'
  const message=outcome?campaignOutcomeMessage(outcome).message:victory?'Enemy command aviation has been destroyed.':'Your home base has been rendered inoperable.'
  return <section className={`end-state ${draw?'draw':victory?'win':'loss'}`}><div className="end-icon">{victory?<ShieldCheck/>:<AlertTriangle/>}</div><small>CAMPAIGN ENDED · ROUND {String(round).padStart(2,'0')}</small><h1>{title}</h1><p>{message}</p><button onClick={onRestart}><RotateCcw/> NEW CAMPAIGN</button></section>
}
