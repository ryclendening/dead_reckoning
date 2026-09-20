import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, FastForward, Map as MapIcon, RotateCcw, ShieldCheck, Zap } from 'lucide-react'
import { Battlefield } from './components/Battlefield'
import { CampaignSetupPanel } from './components/CampaignSetupPanel'
import { AdaptPanel, type ProcurementMode } from './components/AdaptPanel'
import { KnownWorldMap } from './components/KnownWorldMap'
import { CommandShelf, ExecutionChitRail, FormationDock, ObserveEventFeed, PlanningChitRail, TopBar, type PlanningRosterMode, type PlanningStep } from './components/Hud'
import { createCampaignDraft, createMatch } from './game/data'
import { placeInitialAsset } from './game/campaignPlacement'
import { confirmCampaignSetup, validateCampaignAllocation } from './game/campaignSetup'
import { applyRound, createRoundSimulation, effectiveSensorRange, MAX_FLIGHT_DISTANCE, missionDistance, RADAR_COMMUNICATION_RANGE, RADAR_RANGE, resolveRound, TICK_SECONDS, type RoundSimulationController } from './game/engine'
import { beginNextRound, createEconomyState, economyAttentionTargets, executeEconomyCommand, openAdaptPhase, PROCUREMENT_CATALOG, validateAssetPlacement } from './game/economy'
import { snapToHex } from './game/hex'
import { deriveKnownWorldModel } from './game/knownWorld'
import { formationBaseGroups, formationBaseId } from './game/formationBasing'
import { deriveRecoveryPlanningView, formationField, normalizeFormationBasing, snapRouteToRecoveryField, validateRecoveryPackage } from './game/forwardBasing'
import { generateRouteTemplate, templatesForRole } from './game/routeTemplates'
import { airfieldFirstPlanningIds, nextUnplannedFormationId, planningPackageReady, viablePlanningFormationIds } from './game/planningQueue'
import { projectFriendlyUnitAt, projectHostileUnitAt } from './game/executionProjection'
import {createScenario} from './game/scenarios'
import { deriveKnownEnvelope, derivePlanningEnvelope } from './game/world'
import type { Asset, CombatEvent, DebugScenario, EconomyActionId, EconomyCommand, EconomyTarget, MatchState, MissionId, Point, RoundResult, SimulationCommand } from './game/types'

const SAVE_KEY='dead-reckoning-mvp-v27'
const LEGACY_SAVE_KEYS=['dead-reckoning-mvp-v26','dead-reckoning-mvp-v25','dead-reckoning-mvp-v24','dead-reckoning-mvp-v23','dead-reckoning-mvp-v22','dead-reckoning-mvp-v21','dead-reckoning-mvp-v20','dead-reckoning-mvp-v19','dead-reckoning-mvp-v18','dead-reckoning-mvp-v17','dead-reckoning-mvp-v16','dead-reckoning-mvp-v15','dead-reckoning-mvp-v14','dead-reckoning-mvp-v13','dead-reckoning-mvp-v12','dead-reckoning-mvp-v11','dead-reckoning-mvp-v10','dead-reckoning-mvp-v9']
export function normalizeMatch(input:MatchState):MatchState{
  const fresh=createMatch()
  const compatible=input.squadrons?.filter(s=>s.role==='fighter'||s.role==='recon')??[]
  if(compatible.length!==fresh.squadrons.length)return input.debugScenario&&input.debugScenario!=='campaign'?{...fresh,debugScenario:input.debugScenario}:createCampaignDraft(input.seed??fresh.seed)
  const squadrons=compatible.map(s=>{const fallback:MissionId=s.role==='fighter'?'defensive-cap':'search-area';const mission=s.role==='recon'?'search-area':templatesForRole(s.role).some(template=>template.id===s.mission)?s.mission:fallback;const routeIngress=s.routeIngress?.length?s.routeIngress:s.route;return {...s,routeIngress,mission,strength:s.strength??Math.max(0,Math.min(100,(s.aircraft/Math.max(1,s.maxAircraft))*100)),morale:s.morale??Math.round(48+s.readiness*.42),status:s.status??'enroute' as const}})
  const playerAssets=normalizeFormationBasing(squadrons,(input.playerAssets??fresh.playerAssets).map(asset=>asset.kind==='base'?{...asset,operational:true,upgrades:asset.upgrades??[]}:asset.kind==='fob'?{...asset,operational:asset.operational!==false,capacity:asset.capacity??1,basedFormationIds:asset.basedFormationIds??[]}:asset))
  return {...fresh,...input,world:input.world??fresh.world,mappedAreas:input.mappedAreas??[],discoveredBoundaries:input.discoveredBoundaries??[],phase:input.phase==='execute'?'plan':input.phase,squadrons,playerAssets,economy:input.economy??createEconomyState(),debugScenario:input.debugScenario??'campaign',lastResult:input.phase==='execute'?undefined:input.lastResult}
}
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
  const intel=match.enemyAssets.filter(a=>a.intel!=='unknown').length
  const playerBase=match.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]
  const knownEnvelope=useMemo(()=>deriveKnownEnvelope(match.world,match.mappedAreas,match.discoveredBoundaries),[match.discoveredBoundaries,match.mappedAreas,match.world])
  const planningEnvelope=useMemo(()=>derivePlanningEnvelope(knownEnvelope),[knownEnvelope])
  const knownWorld=useMemo(()=>deriveKnownWorldModel({mappedAreas:match.mappedAreas,friendlyTerritory:match.world.friendlyTerritory,friendlyAssets:match.playerAssets,enemyAssets:match.enemyAssets,discoveredBoundaries:match.discoveredBoundaries}),[match.discoveredBoundaries,match.enemyAssets,match.mappedAreas,match.playerAssets,match.world.friendlyTerritory])
  const planningBaseGroups=useMemo(()=>formationBaseGroups(match.squadrons,match.playerAssets),[match.playerAssets,match.squadrons])
  const activePlanningBaseId=planningBaseGroups.some(group=>group.base.id===planningBaseId)?planningBaseId:planningBaseGroups[0]?.base.id??'p-base'
  const viableFormationIds=useMemo(()=>viablePlanningFormationIds(match.squadrons),[match.squadrons])
  const reviewedCount=viableFormationIds.reduce((total,id)=>total+Number(reviewedIds.has(id)),0)
  const planningReady=planningPackageReady(match.squadrons,reviewedIds)
  const selectedLaunchField=formationField(planningBaseGroups.map(group=>group.base),selected.id)??match.playerAssets.find(asset=>asset.kind==='base')
  const recoveryView=useMemo(()=>deriveRecoveryPlanningView(match,selected.id,selected.route,MAX_FLIGHT_DISTANCE[selected.role]),[match,selected])

  const setRoute=useCallback((ingress:Point[])=>{
    const squadron=match.squadrons.find(s=>s.id===match.selectedId)??match.squadrons[0]
    const launch=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const withOrigin=ingress.length ? [[...launch] as Point,...ingress.slice(1)] : [[...launch] as Point]
    const generated=generateRouteTemplate({template:squadron.mission,ingress:withOrigin,maxDistance:MAX_FLIGHT_DISTANCE[squadron.role],bounds:planningEnvelope})
    setRouteNotice(generated.adjustment==='pattern-shrunk'?'ON-STATION PATTERN REDUCED TO FIT FUEL':generated.adjustment==='ingress-shortened'?'INGRESS ROUTE SHORTENED TO PRESERVE RETURN FUEL':undefined)
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next});setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}:s)}))
  },[match,planningEnvelope,playerBase])
  const selectMission=useCallback((mission:MissionId)=>{
    const squadron=match.squadrons.find(s=>s.id===match.selectedId)??match.squadrons[0]
    const base=formationField(match.playerAssets,squadron.id)?.position??playerBase
    const existing=squadron.routeIngress.length>=2?squadron.routeIngress:squadron.route.length>=2?squadron.route:[base]
    const ingress:[[number,number],...Point[]]=[[...base],...existing.slice(1)]
    const generated=generateRouteTemplate({template:mission,ingress,maxDistance:MAX_FLIGHT_DISTANCE[squadron.role],bounds:planningEnvelope})
    setRouteNotice(generated.adjustment==='pattern-shrunk'?'ON-STATION PATTERN REDUCED TO FIT FUEL':generated.adjustment==='ingress-shortened'?'INGRESS ROUTE SHORTENED TO PRESERVE RETURN FUEL':undefined)
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
    setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,mission,route:generated.route,routeIngress:generated.ingress,plannedRecoveryFieldId:undefined}:s)}))
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
  const commit=()=>{const validation=validateRecoveryPackage(match,MAX_FLIGHT_DISTANCE);if(!planningReady||!validation.valid){setRouteNotice(validation.reason);return}const simulation=createRoundSimulation(match);simulationRef.current=simulation;resultRef.current=simulation.result;pendingCommandsRef.current=[];completingRef.current=false;setLiveResult(simulation.result);setAcknowledgedThreatIds(new Set());setProgress(1);setActiveEvent(undefined);setFollowId(match.selectedId);setExecutionBaseId(activePlanningBaseId);setFocusPoint(undefined);setMatch(m=>({...m,phase:'execute'}))}
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
  const orderRtb=(id:string)=>{const simulation=simulationRef.current;if(!simulation||simulation.complete)return;const issuedAtTick=simulation.nextTick();if(pendingCommandsRef.current.some(command=>command.unitId===id&&command.type==='rtb')||(simulation.result.simulationCommands??[]).some(command=>command.unitId===id&&command.type==='rtb'))return;pendingCommandsRef.current.push({id:`rtb-${match.round}-${id}-${issuedAtTick}`,unitId:id,type:'rtb',issuedAtTick})}
  const selectPlanningFormation=(id:string)=>{setRouteNotice(undefined);const baseId=formationBaseId(planningBaseGroups,id);if(baseId)setPlanningBaseId(baseId);setPlanningRosterMode('closed');setPlanningStep('route');setReviewedIds(ids=>{const next=new Set(ids);next.delete(id);return next});setMatch(m=>({...m,selectedId:id,squadrons:m.squadrons.map(s=>s.id===id?{...s,plannedRecoveryFieldId:undefined}:s)}))}
  const selectPlanningBase=(id:string)=>{const group=planningBaseGroups.find(item=>item.base.id===id);if(!group)return;setPlanningBaseId(id);setPlanningRosterMode('closed');setRouteNotice(undefined);const viableIds=group.formationIds.filter(formationId=>match.squadrons.some(squadron=>squadron.id===formationId&&squadron.aircraft>0&&squadron.status!=='trapped'));const nextId=nextUnplannedFormationId(viableIds,reviewedIds)??viableIds[0];setPlanningStep(nextId?'route':'idle');if(nextId){setReviewedIds(ids=>{const next=new Set(ids);next.delete(nextId);return next});setMatch(m=>({...m,selectedId:nextId,squadrons:m.squadrons.map(s=>s.id===nextId?{...s,plannedRecoveryFieldId:undefined}:s)}))}}
  const reviewNextFormation=()=>{
    const view=deriveRecoveryPlanningView(match,selected.id,selected.route,MAX_FLIGHT_DISTANCE[selected.role])
    if(selected.aircraft<=0||selected.status==='trapped'||!view?.valid){setRouteNotice(view?.reason??'FORMATION CANNOT LAUNCH');return}
    setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===selected.id?{...s,route:view.normalizedRoute,plannedRecoveryFieldId:view.intendedField.id}:s)}))
    const nextReviewed=new Set(reviewedIds);nextReviewed.add(selected.id);setReviewedIds(nextReviewed)
    const nextId=nextUnplannedFormationId(airfieldFirstPlanningIds(match.squadrons,planningBaseGroups,activePlanningBaseId),nextReviewed)
    const next=match.squadrons.find(s=>s.id===nextId)
    if(next){const baseId=formationBaseId(planningBaseGroups,next.id);if(baseId)setPlanningBaseId(baseId);setPlanningRosterMode('closed');setPlanningStep('route');setRouteNotice(undefined);setMatch(m=>({...m,selectedId:next.id}))}
    else setPlanningStep('idle')
  }
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
      <div className="map-wrap"><Battlefield squadrons={match.squadrons} assets={match.enemyAssets} playerAssets={match.playerAssets} mappedAreas={match.mappedAreas} discoveredBoundaries={match.discoveredBoundaries} presentationBounds={match.world.presentationBounds} planningBounds={planningEnvelope} friendlyTerritory={match.world.friendlyTerritory} selectedId={match.selectedId} followId={followId} focusPoint={focusPoint} placementId={placementId} planningBaseId={activePlanningBaseId} executionBaseId={executionBaseId} planningRecoveryFieldId={match.phase==='plan'&&recoveryView&&selectedLaunchField&&recoveryView.intendedField.id!==selectedLaunchField.id?recoveryView.intendedField.id:undefined} routeOrigin={selectedLaunchField?.position} routePlanningEnabled={planningStep==='route'} phase={match.phase} progress={progress} activeEvent={activeEvent} executionResult={match.phase==='execute'?liveResult:match.phase==='debrief'||match.phase==='adapt'?match.lastResult:undefined} packageReview={false} economySelectionId={economyTarget.kind==='asset'?economyTarget.id:undefined} onPlanningBaseSelect={selectPlanningBase} onExecutionBaseSelect={selectExecutionBase} onEconomySelect={id=>selectEconomyTarget({kind:'asset',id})} construction={match.phase==='adapt'&&procurementMode==='placing'&&procurementDefinition?{kind:procurementDefinition.kind,placement:procurementPlacement,isValid:validProcurementPoint,onStage:setProcurementPlacement}:undefined} onRoute={setRoute} onPlace={match.setup?.stage==='place'||!match.setup?placeAsset:()=>{}}/>
        {match.phase!=='deploy'?<button className="world-map-toggle" type="button" onClick={()=>setWorldMapOpen(true)}><MapIcon/> KNOWN WORLD</button>:null}
        {worldMapOpen?<div className="known-world-modal" role="dialog" aria-modal="true"><KnownWorldMap model={knownWorld} onClose={()=>setWorldMapOpen(false)}/></div>:null}
        {match.phase==='deploy'&&match.setup?.stage==='place'?<div className="map-tip deploy-tip"><span>TAP HEX</span> PLACE SELECTED ASSET · FRIENDLY TERRITORY ONLY</div>:null}
        {match.phase==='plan'?<><div className="range-key" aria-label="Range key"><span className="vision"><i/><b>DETECTION / LOS</b><small>aircraft sees and identifies</small></span><span className="engage"><i/><b>ENGAGE AREA</b><small>intercept authority when contact is current</small></span><span className="radar"><i/><b>RADAR</b><small>spots tracks</small></span><span className="comms"><i/><b>COMMS</b><small>shares tracks</small></span><span className="weapons"><i/><b>WEAPONS</b><small>SAM & AAA engage inside</small></span></div><div className="map-tip"><span>{planningStep==='idle'?'TAP AIRFIELD':'SET MISSION & ROUTE'}</span> {planningStep==='idle'?'START FORMATION PLANNING':'SET INGRESS · PATTERN ADDED AT FINAL POINT'}</div></>:null}
        {match.phase==='execute'?<ExecutionOverlay progress={progress} activeEvent={activeEvent} speed={speed} onSpeed={()=>setSpeed(s=>s===1?2:1)} match={match} result={liveResult} selectedId={match.selectedId} followId={followId} onSelectFormation={selectFormation} onClearFollow={()=>setFollowId(undefined)} onAirfield={focusAirfield} onEventFocus={focusEvent} onRtb={orderRtb}/>:null}
      </div>
      {match.phase==='plan'&&planningStep!=='idle'?<PlanningChitRail squadrons={match.squadrons} bases={match.playerAssets} activeBaseId={activePlanningBaseId} selectedId={match.selectedId} reviewedIds={reviewedIds} onSelect={selectPlanningFormation}/>:null}
      {match.phase==='execute'&&executionBaseId?<ExecutionChitRail squadrons={match.squadrons} bases={match.playerAssets} result={liveResult} progress={progress} activeBaseId={executionBaseId} selectedId={match.selectedId} followId={followId} threatenedIds={new Set((liveResult?.threatAlerts??[]).filter(alert=>!acknowledgedThreatIds.has(alert.id)).map(alert=>alert.unitId))} onSelect={selectFormation}/>:null}
      {match.phase==='deploy'&&match.setup?<CampaignSetupPanel match={match} placementId={placementId} onSelectPlacement={setPlacementId} onChange={setup=>setMatch(m=>({...m,setup}))} onContinue={advanceCampaignSetup}/>:match.phase==='deploy'?<DeploymentPanel assets={match.playerAssets} selectedId={placementId} onSelect={setPlacementId} onLock={()=>setMatch(m=>({...m,phase:'plan'}))}/>:null}
      {match.phase==='plan'?<CommandShelf squadrons={match.squadrons} bases={match.playerAssets} activeBaseId={activePlanningBaseId} rosterMode={planningRosterMode} squadron={selected} routeDistance={recoveryView?.missionDistance??missionDistance(selected.route,playerBase)} maxDistance={MAX_FLIGHT_DISTANCE[selected.role]} routeNotice={routeNotice} recoverySummary={recoveryView?.summary} onSelect={selectPlanningFormation} onBaseSelect={selectPlanningBase} onRosterMode={mode=>{setPlanningRosterMode(mode);if(mode!=='closed')setPlanningStep('idle')}} onMission={selectMission} onClear={()=>{setRouteNotice(undefined);setRoute([])}} onAdvance={reviewNextFormation} onCommit={commit} step={planningStep} onClose={()=>setPlanningStep('idle')} reviewedIds={reviewedIds} reviewedCount={reviewedCount} totalCount={viableFormationIds.length}/>:null}
      {match.phase==='debrief'&&match.lastResult?<Debrief match={match} onFocus={point=>{setFollowId(undefined);setFocusPoint([...point] as Point)}} onAdapt={enterAdapt}/>:null}
      {match.phase==='adapt'?<AdaptPanel match={match} selectedTarget={economyTarget} onSelectTarget={selectEconomyTarget} onPurchase={purchaseEconomy} onNextRound={nextRound} procurementMode={procurementMode} procurementActionId={procurementActionId} procurementPlacement={procurementPlacement} onProcurementMode={changeProcurementMode} onProcurementAction={selectProcurementAction}/>:null}
      {(match.phase==='victory'||match.phase==='defeat')?<EndState victory={match.phase==='victory'} round={match.round} onRestart={restart}/>:null}
    </div>
  </main>
}

function DeploymentPanel({assets,selectedId,onSelect,onLock}:{assets:Asset[];selectedId:string;onSelect:(id:string)=>void;onLock:()=>void}){
  return <section className="deployment-panel"><div className="deployment-head"><div><small>PRE-MATCH DEPLOYMENT</small><h2>BUILD YOUR DECEPTION</h2></div><ShieldCheck/></div><p>Place the real base, decoy, sensors, and defenses. Overlap radar and weapon rings, but avoid revealing the real base through an obvious defensive cluster.</p><div className="asset-picker">{assets.map(a=><button key={a.id} className={a.id===selectedId?'active':''} onClick={()=>onSelect(a.id)}><b>{a.kind.toUpperCase()}</b><small>{a.kind==='base'?'PRIMARY':a.kind==='decoy'?'FALSE FIELD':a.kind==='radar'?'DETECT 6.4':a.kind==='sam'?'ENGAGE 3.2':'ENGAGE 1.9'}</small></button>)}</div><button className="commit" onClick={onLock}>LOCK DEPLOYMENT <span>››</span></button></section>
}

function ExecutionOverlay({progress,activeEvent,speed,onSpeed,match,result,selectedId,followId,onSelectFormation,onClearFollow,onAirfield,onEventFocus,onRtb}:{progress:number;activeEvent?:CombatEvent;speed:number;onSpeed:()=>void;match:MatchState;result?:RoundResult;selectedId:string;followId?:string;onSelectFormation:(id:string)=>void;onClearFollow:()=>void;onAirfield:()=>void;onEventFocus:(event:CombatEvent)=>void;onRtb:(id:string)=>void}){
  const seconds=progress*(result?.duration??22)
  const contacts=result?.enemyFlights.flatMap(flight=>{const projection=projectHostileUnitAt(result,flight.id,seconds);return projection?[projection]:[]})??[]
  const friendlyRadarIds=new Set(match.playerAssets.filter(asset=>asset.kind==='radar').map(asset=>asset.id))
  const linkedTracks=result?.radarTrackReceipts?.filter(receipt=>friendlyRadarIds.has(receipt.radarId)&&seconds>=receipt.start&&seconds<=receipt.end)??[]
  const visual=contacts.some(contact=>contact.visibility==='visual')
  const cue=result?.defenseCues?.find(c=>progress>=c.start&&progress<=c.end)
  const network=linkedTracks.length>0
  const recovering=match.squadrons.some(squadron=>projectFriendlyUnitAt(result,squadron.id,seconds)?.frame.mode==='recovering')
  return <div className="execute-hud"><div className="timer live" aria-label={`${seconds.toFixed(1)} seconds elapsed`}><i style={{width:`${Math.min(100,seconds/60*100)}%`}}/></div><div className={`contact-status ${contacts.length?'hot':''} ${visual?'visual':''} ${network?'network':''}`}>{recovering?'RECOVERY IN PROGRESS':contacts.length?(visual?`${contacts.length} VISUAL CONTACT${contacts.length===1?'':'S'}`:network?`${contacts.length} RADAR TRACK${contacts.length===1?'':'S'} ACTIVE`:`${contacts.length} RADAR TRACK${contacts.length===1?'':'S'}`):'NO HOSTILE TRACKS'}</div>{cue?<div className="cue-status"><ShieldCheck/> DEFENSE CUED · +{cue.rangeBonus.toFixed(1)} RANGE</div>:null}<ObserveEventFeed events={result?.events??[]} progress={progress} duration={result?.duration} onFocus={onEventFocus}/><FormationDock squadrons={match.squadrons} bases={match.playerAssets} result={result} progress={progress} selectedId={selectedId} followId={followId} onSelect={onSelectFormation} onClearFollow={onClearFollow} onAirfield={onAirfield} onRtb={onRtb}/>
    <div className="exec-controls"><button className="speed" onClick={onSpeed}><FastForward/>{speed}×</button></div></div>
}

function Debrief({match,onFocus,onAdapt}:{match:MatchState;onFocus:(point:Point)=>void;onAdapt:()=>void}){
  const r=match.lastResult!
  const intelReports=r.intelReports.filter(report=>report.recovered).map(report=>({...report,asset:r.assets.find(asset=>asset.id===report.assetId)})).filter((report):report is typeof report&{asset:Asset}=>!!report.asset)
  const lossRows=(items:typeof r.friendlyAttrition)=>items.filter(item=>item.aircraftLost>0)
  const pages=[{kind:'friendly',title:'FRIENDLY LOSSES'},{kind:'enemy',title:'ENEMY LOSSES'},...intelReports.map(report=>({kind:'intel',title:'NEW INTELLIGENCE',report})),{kind:'adapt',title:'READY TO ADAPT'}] as Array<{kind:string;title:string;report?:typeof intelReports[number]}>
  const [page,setPage]=useState(0)
  const [detailsOpen,setDetailsOpen]=useState(false)
  const current=pages[page]??pages[0]
  useEffect(()=>{setDetailsOpen(false);if(current.kind==='intel'&&current.report)onFocus(current.report.asset.position)},[page])
  const movePage=(delta:number)=>setPage(index=>Math.max(0,Math.min(pages.length-1,index+delta)))
  const renderLossRows=(items:typeof r.friendlyAttrition,enemy=false)=>{const rows=lossRows(items).filter(item=>!enemy||item.confirmed);return rows.length?<div className="formation-summary">{rows.map(item=><article key={item.id} className={item.destroyed?'lost':'damaged'}><div><b>{item.callsign}</b><small>{enemy?(item.destroyed?'DESTROYED':'DAMAGED'):item.finalStatus.toUpperCase()}</small></div><strong>{item.startAircraft} → {item.endAircraft}</strong><span>{item.aircraftLost} LOST</span><span>{item.endStrength}% STR</span><i><em style={{width:`${item.endStrength}%`}}/></i></article>)}</div>:<p className="debrief-empty">No {enemy?'confirmed enemy':'friendly'} aircraft lost this round.</p>}
  return <section className={`debrief briefing briefing-stage-${current.kind}${detailsOpen?' details-open':''}`}><div className="debrief-title"><div><small>ROUND {String(match.round).padStart(2,'0')} COMPLETE</small><h2>AFTER ACTION</h2></div><div className="outcome"><CheckCircle2/><span>{current.title}</span></div></div><div className="briefing-progress"><span>{page+1} OF {pages.length}</span><div>{pages.map((item,index)=><button key={`${item.kind}-${index}`} aria-label={`Go to ${item.title}`} className={`${item.kind} ${index===page?'active':''}`} onClick={()=>setPage(index)}/>)}</div></div><div className="briefing-card">{current.kind==='friendly'?<><button className="debrief-rollup" onClick={()=>setDetailsOpen(open=>!open)}><strong>{r.friendlyLosses}</strong><span>FRIENDLY AIRCRAFT LOST · {r.friendlyFormationsDestroyed} FORMATIONS DESTROYED<br/><small>TAP FOR FORMATION DETAIL</small></span></button>{detailsOpen?renderLossRows(r.friendlyAttrition):null}</>:null}{current.kind==='enemy'?<><button className="debrief-rollup" onClick={()=>setDetailsOpen(open=>!open)}><strong>{r.enemyLosses}</strong><span>CONFIRMED ENEMY AIRCRAFT LOST · {r.enemyFormationsDestroyed} FORMATIONS DESTROYED<br/><small>TAP FOR FORMATION DETAIL</small></span></button>{detailsOpen?renderLossRows(r.enemyAttrition,true):null}</>:null}{current.kind==='intel'&&current.report?<button className="debrief-rollup intel-rollup" onClick={()=>onFocus(current.report!.asset.position)}><strong>1</strong><span>NEW INTELLIGENCE · {current.report.asset.kind.toUpperCase()} LOCATED<br/><small>TAP TO FOCUS ON MAP</small></span></button>:null}{current.kind==='adapt'?<><div className="debrief-rollup"><strong>+{r.logisticsIncome.total}</strong><span>LOGISTICS CREDITED · {match.logistics} AVAILABLE · {match.replacements} RESERVE AIRCRAFT</span></div><p className="debrief-empty">Review completed. Spend Logistics during Adapt before issuing the next round's orders.</p></>:null}</div><div className="briefing-controls"><button disabled={page===0} onClick={()=>movePage(-1)}>‹ BACK</button><span>{current.kind==='intel'?'MAP FOCUSED ON REPORT':page===pages.length-1?'LOGISTICS READY':'NEXT: '+pages[page+1].title}</span><button onClick={page===pages.length-1?onAdapt:()=>movePage(1)}>{page===pages.length-1?'OPEN ADAPT':'NEXT ›'}</button></div></section>
}

function EndState({victory,round,onRestart}:{victory:boolean;round:number;onRestart:()=>void}){
  return <section className={`end-state ${victory?'win':'loss'}`}><div className="end-icon">{victory?<ShieldCheck/>:<AlertTriangle/>}</div><small>CAMPAIGN ENDED · ROUND {String(round).padStart(2,'0')}</small><h1>{victory?'BREAKTHROUGH':'COMMAND LOST'}</h1><p>{victory?'Enemy command aviation has been destroyed. Their integrated air defense network is collapsing.':'Your primary airbase has been rendered inoperable. The enemy found the truth before you found theirs.'}</p><button onClick={onRestart}><RotateCcw/> NEW CAMPAIGN</button></section>
}
