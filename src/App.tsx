import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, FastForward, Map as MapIcon, RotateCcw, ShieldCheck, Volume2, Wrench, Zap } from 'lucide-react'
import { Battlefield } from './components/Battlefield'
import { KnownWorldMap } from './components/KnownWorldMap'
import { CommandShelf, FormationDock, HealthBars, ObserveEventFeed, TopBar } from './components/Hud'
import { createMatch } from './game/data'
import { applyRound, capRouteForFuel, effectiveSensorRange, MAX_FLIGHT_DISTANCE, missionDistance, RADAR_COMMUNICATION_RANGE, RADAR_RANGE, rearmSquadron, repairDefense, repairRunway, repairSquadron, resolveRound, restoreReadiness, serviceSquadronCost } from './game/engine'
import { snapToHex } from './game/hex'
import { deriveKnownWorldModel } from './game/knownWorld'
import { generateRouteTemplate, templatesForRole } from './game/routeTemplates'
import { deriveKnownEnvelope, derivePlanningEnvelope } from './game/world'
import type { Asset, CombatEvent, DebugScenario, MatchState, Point, RouteTemplateId, Squadron } from './game/types'

const SAVE_KEY='dead-reckoning-mvp-v20'
const LEGACY_SAVE_KEYS=['dead-reckoning-mvp-v19','dead-reckoning-mvp-v18','dead-reckoning-mvp-v17','dead-reckoning-mvp-v16','dead-reckoning-mvp-v15','dead-reckoning-mvp-v14','dead-reckoning-mvp-v13','dead-reckoning-mvp-v12','dead-reckoning-mvp-v11','dead-reckoning-mvp-v10','dead-reckoning-mvp-v9']
function normalizeMatch(input:MatchState):MatchState{
  const fresh=createMatch()
  const compatible=input.squadrons?.filter(s=>s.role==='fighter'||s.role==='recon')??[]
  if(compatible.length!==fresh.squadrons.length)return {...fresh,debugScenario:input.debugScenario??'campaign'}
  const squadrons=compatible.map(s=>{const aggression=['conservative','neutral','aggressive'].includes(s.aggression)?s.aggression:'neutral';const routeTemplate=templatesForRole(s.role).some(template=>template.id===s.routeTemplate)?s.routeTemplate:'custom';const routeIngress=s.routeIngress?.length?s.routeIngress:s.route;return {...s,routeIngress,routeTemplate:routeTemplate as RouteTemplateId,aggression:aggression as Squadron['aggression'],mission:s.role==='fighter'?'CAP' as const:'RECON' as const,targetPriority:'opportunity' as const,selectedTargetId:undefined,strength:s.strength??Math.max(0,Math.min(100,(s.aircraft/Math.max(1,s.maxAircraft))*100)),morale:s.morale??Math.round(48+s.readiness*.42),status:s.status??'enroute' as const}})
  return {...fresh,...input,world:input.world??fresh.world,mappedAreas:input.mappedAreas??[],discoveredBoundaries:input.discoveredBoundaries??[],phase:input.phase==='execute'?'plan':input.phase,squadrons,debugScenario:input.debugScenario??'campaign',lastResult:input.phase==='execute'?undefined:input.lastResult}
}
function loadMatch():MatchState{try{const saved=localStorage.getItem(SAVE_KEY);if(!saved)return createMatch();return normalizeMatch(JSON.parse(saved) as MatchState)}catch{return createMatch()}}
function makeScenario(scenario:DebugScenario):MatchState{
  const match=createMatch()
  match.debugScenario=scenario
  if(scenario==='recon-loss')match.seed=2
  if(scenario==='campaign')return match
  match.phase='plan'
  const base=match.playerAssets.find(asset=>asset.kind==='base')!.position
  const radar=match.playerAssets.find(asset=>asset.kind==='radar')!.position
  const enemyRadar=match.enemyAssets.find(asset=>asset.kind==='radar')!.position
  const enemySam=match.enemyAssets.find(asset=>asset.kind==='sam')!.position
  const midpoint=(a:Point,b:Point):Point=>[(a[0]+b[0])/2,(a[1]+b[1])/2]
  match.squadrons=match.squadrons.map(s=>{
    if(scenario==='fighter-duel'||scenario==='neutral-los')return s.id==='viper'?{...s,route:[base,midpoint(base,enemyRadar),enemyRadar],aggression:scenario==='neutral-los'?'neutral':'aggressive'}:{...s,aircraft:0,strength:0}
    if(scenario==='fighter-recon')return s.id==='viper'?{...s,route:[base,midpoint(base,enemyRadar)],aggression:'aggressive'}:{...s,aircraft:0,strength:0}
    if(scenario==='radar-intercept')return s.id==='viper'?{...s,route:[base,radar,base],aggression:'aggressive'}:{...s,aircraft:0,strength:0}
    if(scenario==='recon-recovery')return s.id==='raven'?{...s,route:[base,midpoint(base,enemyRadar),enemyRadar,midpoint(base,enemyRadar),base],aggression:'neutral'}:{...s,aircraft:0,strength:0}
    if(scenario==='recon-loss')return s.id==='raven'?{...s,aircraft:1,strength:1,morale:24,route:[base,midpoint(base,enemySam),enemySam,enemyRadar],aggression:'aggressive'}:{...s,aircraft:0,strength:0}
    return s
  })
  return match
}

export default function App(){
  const [match,setMatch]=useState<MatchState>(loadMatch)
  const [progress,setProgress]=useState(0)
  const [speed,setSpeed]=useState<1|2>(1)
  const [activeEvent,setActiveEvent]=useState<CombatEvent>()
  const [followId,setFollowId]=useState<string>()
  const [focusPoint,setFocusPoint]=useState<Point>()
  const [routeNotice,setRouteNotice]=useState<string>()
  const [ordersExpanded,setOrdersExpanded]=useState(false)
  const [reviewedIds,setReviewedIds]=useState<Set<string>>(()=>new Set())
  const [placementId,setPlacementId]=useState('p-base')
  const [worldMapOpen,setWorldMapOpen]=useState(false)
  const resultRef=useRef<ReturnType<typeof resolveRound>|undefined>(undefined)
  const completingRef=useRef(false)
  useEffect(()=>localStorage.setItem(SAVE_KEY,JSON.stringify(match)),[match])
  const selected=match.squadrons.find(s=>s.id===match.selectedId) ?? match.squadrons[0]
  const intel=match.enemyAssets.filter(a=>a.intel!=='unknown').length
  const enemyBaseKnown=match.enemyAssets.some(a=>a.kind==='base'&&a.intel==='confirmed')
  const playerBase=match.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]
  const knownEnvelope=useMemo(()=>deriveKnownEnvelope(match.world,match.mappedAreas,match.discoveredBoundaries),[match.discoveredBoundaries,match.mappedAreas,match.world])
  const planningEnvelope=useMemo(()=>derivePlanningEnvelope(knownEnvelope),[knownEnvelope])
  const knownWorld=useMemo(()=>deriveKnownWorldModel({mappedAreas:match.mappedAreas,friendlyTerritory:match.world.friendlyTerritory,friendlyAssets:match.playerAssets,enemyAssets:match.enemyAssets,discoveredBoundaries:match.discoveredBoundaries}),[match.discoveredBoundaries,match.enemyAssets,match.mappedAreas,match.playerAssets,match.world.friendlyTerritory])

  const patchSelected=useCallback((patch:Partial<Squadron>)=>{setReviewedIds(ids=>{const next=new Set(ids);next.delete(match.selectedId);return next});setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===m.selectedId?{...s,...patch}:s)}))},[match.selectedId])
  const setRoute=useCallback((ingress:Point[])=>{
    const squadron=match.squadrons.find(s=>s.id===match.selectedId)??match.squadrons[0]
    if(squadron.routeTemplate==='custom'){
      const base=match.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]
      const capped=capRouteForFuel(ingress,base,MAX_FLIGHT_DISTANCE[squadron.role])
      setRouteNotice(undefined)
      setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next});setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,route:capped,routeIngress:capped}:s)}))
      return
    }
    const generated=generateRouteTemplate({template:squadron.routeTemplate,ingress,maxDistance:MAX_FLIGHT_DISTANCE[squadron.role],bounds:planningEnvelope})
    setRouteNotice(generated.adjustment==='pattern-shrunk'?'ON-STATION PATTERN REDUCED TO FIT FUEL':generated.adjustment==='ingress-shortened'?'INGRESS ROUTE SHORTENED TO PRESERVE RETURN FUEL':undefined)
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next});setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,route:generated.route,routeIngress:generated.ingress}:s)}))
  },[match,planningEnvelope])
  const selectRouteTemplate=useCallback((template:RouteTemplateId)=>{
    const squadron=match.squadrons.find(s=>s.id===match.selectedId)??match.squadrons[0]
    const base=match.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2] as Point
    const ingress=squadron.routeIngress.length>=2?squadron.routeIngress:squadron.route.length>=2?squadron.route:[base]
    const generated=template==='custom'
      ? {route:ingress,ingress,adjustment:'none' as const}
      : generateRouteTemplate({template,ingress,maxDistance:MAX_FLIGHT_DISTANCE[squadron.role],bounds:planningEnvelope})
    setRouteNotice(generated.adjustment==='pattern-shrunk'?'ON-STATION PATTERN REDUCED TO FIT FUEL':generated.adjustment==='ingress-shortened'?'INGRESS ROUTE SHORTENED TO PRESERVE RETURN FUEL':undefined)
    setReviewedIds(ids=>{const next=new Set(ids);next.delete(squadron.id);return next})
    setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===squadron.id?{...s,routeTemplate:template,route:generated.route,routeIngress:generated.ingress}:s)}))
  },[match,planningEnvelope])
  const placeAsset=useCallback((id:string,position:Point)=>setMatch(m=>{const oldBase=m.playerAssets.find(a=>a.kind==='base')?.position??m.world.friendlyTerritory.center;const center=m.world.friendlyTerritory.center,radius=m.world.friendlyTerritory.radius-.75,delta:Point=[position[0]-center[0],position[1]-center[1]],length=Math.hypot(delta[0],delta[1]);const bounded:Point=length<=radius?position:[center[0]+delta[0]/length*radius,center[1]+delta[1]/length*radius];const placed=snapToHex(bounded);const playerAssets=m.playerAssets.map(a=>a.id===id?{...a,position:placed}:a);const reposition=(route:Point[])=>route.map((p,i)=>i===0||i===route.length-1&&Math.hypot(p[0]-oldBase[0],p[1]-oldBase[1])<.3?placed:p);const squadrons=id==='p-base'?m.squadrons.map(s=>({...s,route:reposition(s.route),routeIngress:reposition(s.routeIngress)})):m.squadrons;return {...m,playerAssets,squadrons}}),[])
  const commit=()=>{const result=resolveRound(match);resultRef.current=result;completingRef.current=false;setProgress(0);setActiveEvent(undefined);setFollowId(match.selectedId);setFocusPoint(undefined);setMatch(m=>({...m,phase:'execute'}))}
  useEffect(()=>{
    if(match.phase!=='execute'||!resultRef.current)return
    const result=resultRef.current;let frame=0;let last=performance.now();let current=progress;const duration=result.duration*1000
    const tick=(now:number)=>{const dt=(now-last)*speed;last=now;current=Math.min(1,current+dt/duration);setProgress(current);const seconds=current*result.duration;const event=[...result.events].reverse().find(e=>e.time<=seconds);setActiveEvent(event);if(current>=1){if(!completingRef.current){completingRef.current=true;setTimeout(()=>setMatch(m=>m.phase==='execute'?applyRound(m,result):m),1250)}return}frame=requestAnimationFrame(tick)}
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame)
  },[match.phase,speed]) // progress intentionally resumes from the value captured when speed/phase changes

  const nextRound=()=>{setWorldMapOpen(false);setFollowId(undefined);setFocusPoint(undefined);setMatch(m=>({...m,round:m.round+1,phase:'plan',lastResult:undefined}))}
  const selectScenario=(scenario:DebugScenario)=>{setWorldMapOpen(false);setMatch(makeScenario(scenario));setProgress(0);setActiveEvent(undefined);setFollowId(undefined);setFocusPoint(undefined)}
  const restart=()=>{localStorage.removeItem(SAVE_KEY);for(const key of LEGACY_SAVE_KEYS)localStorage.removeItem(key);setWorldMapOpen(false);setMatch(m=>makeScenario(m.debugScenario??'campaign'));setProgress(0);setActiveEvent(undefined);setFollowId(undefined);setFocusPoint(undefined)}
  const selectFormation=(id:string)=>{setFollowId(id);setFocusPoint(undefined);setMatch(m=>({...m,selectedId:id}))}
  const selectPlanningFormation=(id:string)=>{setRouteNotice(undefined);setOrdersExpanded(false);setMatch(m=>({...m,selectedId:id}))}
  const reviewNextFormation=()=>{
    if(selected.aircraft<=0||selected.route.length<2)return
    const available=match.squadrons.filter(s=>s.aircraft>0)
    const nextReviewed=new Set(reviewedIds);nextReviewed.add(selected.id);setReviewedIds(nextReviewed);setOrdersExpanded(false)
    const next=available.find(s=>!nextReviewed.has(s.id))
    if(next)setMatch(m=>({...m,selectedId:next.id}))
  }
  const focusAirfield=()=>{setFollowId(undefined);setFocusPoint(playerBase)}
  const focusEvent=(event:CombatEvent)=>{const target=match.squadrons.find(s=>event.detail.includes(s.callsign));if(target){setFollowId(target.id);setMatch(m=>({...m,selectedId:target.id}))}else setFollowId(undefined);if(event.position)setFocusPoint(event.position);setActiveEvent(event)}

  return <main className="app-shell">
    <div className={`game-frame phase-${match.phase} ${ordersExpanded?'shelf-open':''}`}>
      <TopBar round={match.round} intel={intel} logistics={match.logistics} replacements={match.replacements} score={match.campaignScore??0} phase={match.phase} debugScenario={match.debugScenario??'campaign'} onDebugScenario={selectScenario} onReboot={restart}/>
      <div className="map-wrap"><Battlefield squadrons={match.squadrons} assets={match.enemyAssets} playerAssets={match.playerAssets} mappedAreas={match.mappedAreas} discoveredBoundaries={match.discoveredBoundaries} presentationBounds={match.world.presentationBounds} planningBounds={planningEnvelope} friendlyTerritory={match.world.friendlyTerritory} selectedId={match.selectedId} followId={followId} focusPoint={focusPoint} placementId={placementId} phase={match.phase} progress={progress} activeEvent={activeEvent} executionResult={match.phase==='execute'?resultRef.current:match.phase==='debrief'?match.lastResult:undefined} packageReview={false} onRoute={setRoute} onPlace={placeAsset}/><HealthBars player={match.playerBaseHealth} enemy={match.enemyBaseHealth} enemyKnown={enemyBaseKnown} exposure={match.baseExposure??6}/>
        {match.phase!=='deploy'?<button className="world-map-toggle" type="button" onClick={()=>setWorldMapOpen(true)}><MapIcon/> KNOWN WORLD</button>:null}
        {worldMapOpen?<div className="known-world-modal" role="dialog" aria-modal="true"><KnownWorldMap model={knownWorld} onClose={()=>setWorldMapOpen(false)}/></div>:null}
        {match.phase==='deploy'?<div className="map-tip deploy-tip"><span>TAP HEX</span> PLACE SELECTED ASSET · FRIENDLY TERRITORY ONLY</div>:null}
        {match.phase==='plan'?<><div className="range-key" aria-label="Range key"><span className="vision"><i/><b>AIRCRAFT</b><small>identify up close</small></span><span className="radar"><i/><b>RADAR</b><small>spots tracks</small></span><span className="comms"><i/><b>COMMS</b><small>shares tracks</small></span><span className="weapons"><i/><b>WEAPONS</b><small>SAM & AAA engage inside</small></span></div><div className="map-tip"><span>DRAW ROUTE</span> {selected.routeTemplate==='custom'?'TAP / DRAG':'SET INGRESS · PATTERN ADDED AT FINAL POINT'}</div></>:null}
        {match.phase==='execute'?<ExecutionOverlay progress={progress} activeEvent={activeEvent} speed={speed} onSpeed={()=>setSpeed(s=>s===1?2:1)} match={match} result={resultRef.current} selectedId={match.selectedId} followId={followId} onSelectFormation={selectFormation} onClearFollow={()=>setFollowId(undefined)} onAirfield={focusAirfield} onEventFocus={focusEvent} onSkip={()=>resultRef.current&&setMatch(m=>applyRound(m,resultRef.current!))}/>:null}
      </div>
      {match.phase==='deploy'?<DeploymentPanel assets={match.playerAssets} selectedId={placementId} onSelect={setPlacementId} onLock={()=>setMatch(m=>({...m,phase:'plan'}))}/>:null}
      {match.phase==='plan'?<CommandShelf squadrons={match.squadrons} squadron={selected} routeDistance={missionDistance(selected.route,playerBase)} maxDistance={MAX_FLIGHT_DISTANCE[selected.role]} routeNotice={routeNotice} onSelect={selectPlanningFormation} onChange={patchSelected} onTemplate={selectRouteTemplate} onClear={()=>{setRouteNotice(undefined);setRoute([])}} onAdvance={reviewNextFormation} onCommit={commit} expanded={ordersExpanded} onToggle={()=>setOrdersExpanded(value=>!value)} reviewedCount={reviewedIds.size} totalCount={match.squadrons.filter(s=>s.aircraft>0).length}/>:null}
      {match.phase==='debrief'&&match.lastResult?<Debrief match={match} onFocus={point=>{setFollowId(undefined);setFocusPoint([...point] as Point)}} onRepair={id=>setMatch(m=>repairSquadron(m,id))} onRearm={id=>setMatch(m=>rearmSquadron(m,id))} onReady={id=>setMatch(m=>restoreReadiness(m,id))} onDefense={id=>setMatch(m=>repairDefense(m,id))} onRunway={()=>setMatch(m=>repairRunway(m))} onNext={nextRound}/>:null}
      {(match.phase==='victory'||match.phase==='defeat')?<EndState victory={match.phase==='victory'} round={match.round} onRestart={restart}/>:null}
    </div>
  </main>
}

function DeploymentPanel({assets,selectedId,onSelect,onLock}:{assets:Asset[];selectedId:string;onSelect:(id:string)=>void;onLock:()=>void}){
  return <section className="deployment-panel"><div className="deployment-head"><div><small>PRE-MATCH DEPLOYMENT</small><h2>BUILD YOUR DECEPTION</h2></div><ShieldCheck/></div><p>Place the real base, decoy, sensors, and defenses. Overlap radar and weapon rings, but avoid revealing the real base through an obvious defensive cluster.</p><div className="asset-picker">{assets.map(a=><button key={a.id} className={a.id===selectedId?'active':''} onClick={()=>onSelect(a.id)}><b>{a.kind.toUpperCase()}</b><small>{a.kind==='base'?'PRIMARY':a.kind==='decoy'?'FALSE FIELD':a.kind==='radar'?'DETECT 6.4':a.kind==='sam'?'ENGAGE 3.2':'ENGAGE 1.9'}</small></button>)}</div><button className="commit" onClick={onLock}>LOCK DEPLOYMENT <span>››</span></button></section>
}

function ExecutionOverlay({progress,activeEvent,speed,onSpeed,match,result,selectedId,followId,onSelectFormation,onClearFollow,onAirfield,onEventFocus,onSkip}:{progress:number;activeEvent?:CombatEvent;speed:number;onSpeed:()=>void;match:MatchState;result?:ReturnType<typeof resolveRound>;selectedId:string;followId?:string;onSelectFormation:(id:string)=>void;onClearFollow:()=>void;onAirfield:()=>void;onEventFocus:(event:CombatEvent)=>void;onSkip:()=>void}){
  const seconds=progress*(result?.duration??22)
  const windows=result?.enemyFlights.flatMap(f=>f.detectionWindows.filter(w=>progress>=w.start&&progress<=w.end))??[]
  const friendlyRadarIds=new Set(match.playerAssets.filter(asset=>asset.kind==='radar').map(asset=>asset.id))
  const linkedTracks=result?.radarTrackReceipts?.filter(receipt=>friendlyRadarIds.has(receipt.radarId)&&seconds>=receipt.start&&seconds<=receipt.end)??[]
  const visual=windows.some(w=>w.source==='visual')
  const cue=result?.defenseCues?.find(c=>progress>=c.start&&progress<=c.end)
  const network=linkedTracks.length>0
  const recovering=(result?.behaviorIntervals??[]).some(interval=>interval.mode==='recovering'&&seconds>=interval.start&&seconds<=interval.end)
  return <div className="execute-hud"><div className="timer"><i style={{width:`${progress*100}%`}}/></div><div className={`contact-status ${windows.length?'hot':''} ${visual?'visual':''} ${network?'network':''}`}>{recovering?'RECOVERY IN PROGRESS':windows.length?(visual?`${windows.length} VISUAL CONTACT`:network?`${linkedTracks.length} RADAR LINK${linkedTracks.length===1?'':'S'} ACTIVE`:`${windows.length} RADAR TRACK`):'NO HOSTILE TRACKS'}</div>{cue?<div className="cue-status"><ShieldCheck/> DEFENSE CUED · +{cue.rangeBonus.toFixed(1)} RANGE</div>:null}<ObserveEventFeed events={result?.events??[]} progress={progress} activeEvent={activeEvent} onFocus={onEventFocus}/><FormationDock squadrons={match.squadrons} result={result} progress={progress} selectedId={selectedId} followId={followId} onSelect={onSelectFormation} onClearFollow={onClearFollow} onAirfield={onAirfield}/>
    <div className="exec-controls"><button onClick={onSkip}>SKIP TO DEBRIEF</button><button className="speed" onClick={onSpeed}><FastForward/>{speed}×</button></div></div>
}

function Debrief({match,onFocus,onRepair,onRearm,onReady,onDefense,onRunway,onNext}:{match:MatchState;onFocus:(point:Point)=>void;onRepair:(id:string)=>void;onRearm:(id:string)=>void;onReady:(id:string)=>void;onDefense:(id:string)=>void;onRunway:()=>void;onNext:()=>void}){
  const r=match.lastResult!
  const [tab,setTab]=useState<'friendly'|'enemy'|'intel'|'adapt'>('friendly')
  const intelReports=r.intelReports.filter(report=>report.recovered).map(report=>({...report,asset:r.assets.find(asset=>asset.id===report.assetId)})).filter((report):report is typeof report&{asset:Asset}=>!!report.asset)
  const lossRows=(items:typeof r.friendlyAttrition)=>items.filter(item=>item.aircraftLost>0)
  const tabs=[['friendly','FRIENDLY',r.friendlyLosses],['enemy','ENEMY',r.enemyLosses],['intel','INTEL',intelReports.length],['adapt','ADAPT',0]] as const
  const pages=[{kind:'friendly',title:'FRIENDLY LOSSES'},{kind:'enemy',title:'ENEMY LOSSES'},...intelReports.map(report=>({kind:'intel',title:'NEW INTELLIGENCE',report})),{kind:'adapt',title:'ADAPT'}] as Array<{kind:string;title:string;report?:typeof intelReports[number]}>
  const [page,setPage]=useState(0)
  const [detailsOpen,setDetailsOpen]=useState(false)
  const current=pages[page]??pages[0]
  useEffect(()=>{setDetailsOpen(false);if(current.kind==='intel'&&current.report)onFocus(current.report.asset.position)},[page])
  const movePage=(delta:number)=>setPage(index=>Math.max(0,Math.min(pages.length-1,index+delta)))
  const renderLossRows=(items:typeof r.friendlyAttrition,enemy=false)=>{const rows=lossRows(items).filter(item=>!enemy||item.confirmed);return rows.length?<div className="formation-summary">{rows.map(item=><article key={item.id} className={item.destroyed?'lost':'damaged'}><div><b>{item.callsign}</b><small>{enemy?(item.destroyed?'DESTROYED':'DAMAGED'):item.finalStatus.toUpperCase()}</small></div><strong>{item.startAircraft} → {item.endAircraft}</strong><span>{item.aircraftLost} LOST</span><span>{item.endStrength}% STR</span><i><em style={{width:`${item.endStrength}%`}}/></i></article>)}</div>:<p className="debrief-empty">No {enemy?'confirmed enemy':'friendly'} aircraft lost this round.</p>}
  return <section className={`debrief briefing briefing-stage-${current.kind}${detailsOpen?' details-open':''}`}><div className="debrief-title"><div><small>ROUND {String(match.round).padStart(2,'0')} COMPLETE</small><h2>AFTER ACTION</h2></div><div className="outcome"><CheckCircle2/><span>{current.title}</span></div></div><div className="briefing-progress"><span>{page+1} OF {pages.length}</span><div>{pages.map((item,index)=><button key={`${item.kind}-${index}`} aria-label={`Go to ${item.title}`} className={`${item.kind} ${index===page?'active':''}`} onClick={()=>setPage(index)}/>)}</div></div><div className="briefing-card">{current.kind==='friendly'?<><button className="debrief-rollup" onClick={()=>setDetailsOpen(open=>!open)}><strong>{r.friendlyLosses}</strong><span>FRIENDLY AIRCRAFT LOST · {r.friendlyFormationsDestroyed} FORMATIONS DESTROYED<br/><small>TAP FOR FORMATION DETAIL</small></span></button>{detailsOpen?renderLossRows(r.friendlyAttrition):null}</>:null}{current.kind==='enemy'?<><button className="debrief-rollup" onClick={()=>setDetailsOpen(open=>!open)}><strong>{r.enemyLosses}</strong><span>CONFIRMED ENEMY AIRCRAFT LOST · {r.enemyFormationsDestroyed} FORMATIONS DESTROYED<br/><small>TAP FOR FORMATION DETAIL</small></span></button>{detailsOpen?renderLossRows(r.enemyAttrition,true):null}</>:null}{current.kind==='intel'&&current.report?<button className="debrief-rollup intel-rollup" onClick={()=>onFocus(current.report!.asset.position)}><strong>1</strong><span>NEW INTELLIGENCE · {current.report.asset.kind.toUpperCase()} LOCATED<br/><small>TAP TO FOCUS ON MAP</small></span></button>:null}{current.kind==='adapt'?<><div className="debrief-rollup"><strong>{r.roundScore}</strong><span>ROUND SCORE · {match.logistics} LOGISTICS · {match.replacements} RESERVES</span></div><p className="debrief-empty">HOME-BASE EXPOSURE {r.baseExposure}% · {match.command} COMMAND AVAILABLE</p></>:null}</div><div className="briefing-controls"><button disabled={page===0} onClick={()=>movePage(-1)}>‹ BACK</button><span>{current.kind==='intel'?'MAP FOCUSED ON REPORT':page===pages.length-1?'READY FOR NEXT ROUND':'NEXT: '+pages[page+1].title}</span><button onClick={page===pages.length-1?onNext:()=>movePage(1)}>{page===pages.length-1?'NEXT ROUND':'NEXT ›'}</button></div></section>
  return <section className="debrief"><div className="debrief-title"><div><small>ROUND {String(match.round).padStart(2,'0')} COMPLETE</small><h2>AFTER ACTION</h2></div><div className="outcome"><CheckCircle2/><span>REVIEW</span></div></div><div className="debrief-tabs" role="tablist">{tabs.map(([id,label,count])=><button key={id} role="tab" aria-selected={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}{count>0?<b>{count}</b>:null}</button>)}</div>{tab==='friendly'?<div className="debrief-pane"><div className="debrief-rollup"><strong>{r.friendlyLosses}</strong><span>FRIENDLY AIRCRAFT LOST · {r.friendlyFormationsDestroyed} FORMATIONS DESTROYED</span></div>{lossRows(r.friendlyAttrition).length?<div className="formation-summary">{lossRows(r.friendlyAttrition).map(item=><article key={item.id} className={item.destroyed?'lost':'damaged'}><div><b>{item.callsign}</b><small>{item.finalStatus.toUpperCase()}</small></div><strong>{item.startAircraft} → {item.endAircraft}</strong><span>{item.aircraftLost} LOST</span><span>{item.endStrength}% STR</span><i><em style={{width:`${item.endStrength}%`}}/></i></article>)}</div>:<p className="debrief-empty">No friendly aircraft lost this round.</p>}</div>:null}{tab==='enemy'?<div className="debrief-pane"><div className="debrief-rollup"><strong>{r.enemyLosses}</strong><span>CONFIRMED ENEMY AIRCRAFT LOST · {r.enemyFormationsDestroyed} FORMATIONS DESTROYED</span></div>{lossRows(r.enemyAttrition).filter(item=>item.confirmed).length?<div className="formation-summary">{lossRows(r.enemyAttrition).filter(item=>item.confirmed).map(item=><article key={item.id} className={item.destroyed?'lost':'damaged'}><div><b>{item.callsign}</b><small>{item.destroyed?'DESTROYED':'DAMAGED'}</small></div><strong>{item.startAircraft} → {item.endAircraft}</strong><span>{item.aircraftLost} LOST</span><span>{item.endStrength}% STR</span><i><em style={{width:`${item.endStrength}%`}}/></i></article>)}</div>:<p className="debrief-empty">No confirmed enemy aircraft losses this round.</p>}</div>:null}{tab==='intel'?<div className="debrief-pane"><div className="debrief-rollup"><strong>{intelReports.length}</strong><span>NEW INTELLIGENCE · SELECT A REPORT TO FOCUS THE MAP</span></div>{intelReports.length?<div className="intel-report">{intelReports.map(report=><button key={report.id} onClick={()=>onFocus(report.asset.position)}><Zap/><span><b>{report.asset.kind.toUpperCase()} LOCATED</b><small>{report.detail}</small></span><ChevronRight/></button>)}</div>:<p className="debrief-empty"><AlertTriangle/> No new fixed assets identified this round.</p>}</div>:null}{tab==='adapt'?<div className="debrief-pane"><div className="debrief-rollup"><strong>{r.roundScore}</strong><span>ROUND SCORE · {match.logistics} LOGISTICS · {match.replacements} RESERVES</span></div><p className="debrief-empty">HOME-BASE EXPOSURE {r.baseExposure}% · {match.command} COMMAND AVAILABLE</p><button className="continue" onClick={onNext}>ADAPT FOR ROUND {String(match.round+1).padStart(2,'0')} <ChevronRight/></button></div>:null}</section>
  /* Legacy expanded debrief retained below while the compact tab flow replaces it.
  return <section className="debrief"><div className="debrief-title"><div><small>ROUND {String(match.round).padStart(2,'0')} COMPLETE</small><h2>AFTER ACTION</h2></div><div className={`outcome ${r.enemyBaseDamage>0?'success':''}`}><CheckCircle2/><span>{r.enemyBaseDamage>0?'OBJECTIVE HIT':'INTEL GAINED'}</span></div></div>
    <div className="summary-grid"><article><small>FRIENDLY LOST</small><strong>{r.friendlyLosses}</strong><span>AIRCRAFT · {r.friendlyFormationsDestroyed} FORMATIONS</span></article><article><small>ENEMY LOST</small><strong>{r.enemyLosses}</strong><span>CONFIRMED · {r.enemyFormationsDestroyed} FORMATIONS</span></article><article><small>ROUND SCORE</small><strong>{r.roundScore}</strong><span>CAMPAIGN {match.campaignScore}</span></article><article><small>BASE DAMAGE</small><strong>{r.enemyBaseDamage}%</strong><span>INFLICTED</span></article></div>
    <div className="formation-summary"><div className="section-kicker">FORMATION ATTRITION <span>START → END · STRENGTH · STATUS</span></div>{r.friendlyAttrition.map(item=>{const squadron=match.squadrons.find(s=>s.id===item.id)!;const frame=r.unitTracks.find(track=>track.unitId===item.id)?.frames.at(-1);const range=frame?.traveledDistance??missionDistance(squadron.route,match.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]);return <article key={item.id} className={item.destroyed?'lost':item.aircraftLost>0?'damaged':''}><div><b>{item.callsign}</b><small>{item.role.toUpperCase()} · {item.finalStatus.toUpperCase()}</small></div><strong>{item.startAircraft} → {item.endAircraft}</strong><span>{item.aircraftLost} LOST</span><span>{item.endStrength}% STR</span><span>{range.toFixed(1)} RNG</span><i><em style={{width:`${item.endStrength}%`}}/></i></article>})}</div>
    <div className={`opsec-report ${r.baseExposureDelta<=0?'secure':'exposed'}`}><div><small>ROUTE SECURITY</small><b>HOME-BASE EXPOSURE {r.baseExposure}%</b></div><strong>{r.baseExposureDelta>0?`+${r.baseExposureDelta}`:r.baseExposureDelta}</strong><p>{r.baseExposureDelta>0?'Enemy analysts can backtrace direct ingress vectors. Add an offset leg before crossing the forward line.':'Indirect departures are denying a reliable origin trace.'}</p></div>
    <div className="lesson-report"><h3>COMMAND FINDINGS <span>ROUTES + MARKERS ABOVE</span></h3>{r.lessons?.length?r.lessons.map((lesson,i)=><article key={i} className={lesson.tone}><b>{lesson.title}</b><p>{lesson.detail}</p></article>):<article><b>Orders executed as planned</b><p>No doctrine threshold materially changed a route this round.</p></article>}</div>
    <div className="intel-report"><h3>INTELLIGENCE PICTURE</h3>{r.intelGained.length?r.intelGained.map((x,i)=><p key={i}><Zap/> {x}</p>):<p><AlertTriangle/> No new fixed assets identified. Change the recon corridor.</p>}</div>
    <div className="readiness-list"><h3>FORCE READINESS <span>{match.logistics} LOGISTICS · {match.replacements} RESERVES · {match.command} CP</span></h3>{match.squadrons.map(s=>{const serviceCost=serviceSquadronCost(s);const replacing=s.damaged===0&&s.aircraft<s.maxAircraft;const serviceLabel=s.damaged>0?'REPAIR':'REPLACE';return <div className="readiness-row" key={s.id}><div><b>{s.callsign}</b><small>{s.role.toUpperCase()} · {s.aircraft}/{s.maxAircraft} READY · {s.damaged} DAMAGED · AMMO {s.ammo}%</small></div><span className="mini-bar"><i style={{width:`${s.readiness}%`}}/></span><button disabled={serviceCost===0||match.logistics<serviceCost||replacing&&match.replacements===0} onClick={()=>onRepair(s.id)}><Wrench/> {serviceLabel} {serviceCost||''}</button><button disabled={match.logistics<1||s.ammo===100} onClick={()=>onRearm(s.id)}>ARM 1</button><button disabled={match.logistics<1||s.readiness===100} onClick={()=>onReady(s.id)}>REST 1</button></div>})}</div>
    <div className="defense-logistics"><h3>BASE &amp; DEFENSES</h3><button disabled={match.logistics<3||match.playerBaseHealth===100} onClick={onRunway}><b>RUNWAY {match.playerBaseHealth}%</b><span>REPAIR 18 · COST 3</span></button>{match.playerAssets.filter(a=>a.kind==='radar'||a.kind==='sam'||a.kind==='aaa').map(a=><button key={a.id} disabled={match.logistics<2||a.health===100} onClick={()=>onDefense(a.id)}><b>{a.kind.toUpperCase()} {a.health}%</b><span>REPAIR 28 · COST 2</span></button>)}</div>
    <button className="continue" onClick={onNext}>ADAPT FOR ROUND {String(match.round+1).padStart(2,'0')} <ChevronRight/></button>
  </section>*/
}

function EndState({victory,round,onRestart}:{victory:boolean;round:number;onRestart:()=>void}){
  return <section className={`end-state ${victory?'win':'loss'}`}><div className="end-icon">{victory?<ShieldCheck/>:<AlertTriangle/>}</div><small>CAMPAIGN ENDED · ROUND {String(round).padStart(2,'0')}</small><h1>{victory?'BREAKTHROUGH':'COMMAND LOST'}</h1><p>{victory?'Enemy command aviation has been destroyed. Their integrated air defense network is collapsing.':'Your primary airbase has been rendered inoperable. The enemy found the truth before you found theirs.'}</p><button onClick={onRestart}><RotateCcw/> NEW CAMPAIGN</button></section>
}
