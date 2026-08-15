import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, FastForward, PlaneTakeoff, Radio, RotateCcw, ShieldCheck, Volume2, Wrench, Zap } from 'lucide-react'
import { Battlefield } from './components/Battlefield'
import { HealthBars, OrdersPanel, PhaseRail, SquadronRail, TopBar } from './components/Hud'
import { createMatch, PRESETS } from './game/data'
import { applyRound, attritionCreditAt, battleScoreAt, callReinforcement, effectiveSensorRange, RADAR_RANGE, rearmSquadron, REINFORCEMENT_OPTIONS, repairDefense, repairRunway, repairSquadron, resolveRound, restoreReadiness, serviceSquadronCost, supportCreditsAt } from './game/engine'
import { snapToHex } from './game/hex'
import type { Asset, CombatEvent, MatchState, Point, ReinforcementType, Squadron } from './game/types'

const SAVE_KEY='dead-reckoning-mvp-v9'
function loadMatch():MatchState{try{const saved=localStorage.getItem(SAVE_KEY);if(!saved)return createMatch();const parsed=JSON.parse(saved) as MatchState;return parsed.phase==='execute'?{...parsed,phase:'plan'}:parsed}catch{return createMatch()}}

export default function App(){
  const [match,setMatch]=useState<MatchState>(loadMatch)
  const [progress,setProgress]=useState(0)
  const [speed,setSpeed]=useState<1|2>(1)
  const [activeEvent,setActiveEvent]=useState<CombatEvent>()
  const [placementId,setPlacementId]=useState('p-base')
  const resultRef=useRef<ReturnType<typeof resolveRound>|undefined>(undefined)
  const completingRef=useRef(false)
  useEffect(()=>localStorage.setItem(SAVE_KEY,JSON.stringify(match)),[match])
  const selected=match.squadrons.find(s=>s.id===match.selectedId) ?? match.squadrons[0]
  const intel=match.enemyAssets.filter(a=>a.intel!=='unknown').length
  const enemyBaseKnown=match.enemyAssets.some(a=>a.kind==='base'&&a.intel==='confirmed')
  const playerBase=match.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2]

  const patchSelected=useCallback((patch:Partial<Squadron>)=>setMatch(m=>({...m,squadrons:m.squadrons.map(s=>s.id===m.selectedId?{...s,...patch}:s)})),[])
  const setRoute=useCallback((route:Point[])=>patchSelected({route}),[patchSelected])
  const placeAsset=useCallback((id:string,position:Point)=>setMatch(m=>{const oldBase=m.playerAssets.find(a=>a.kind==='base')?.position??[-7.8,11.2];const placed=snapToHex([Math.max(-8.7,Math.min(8.7,position[0])),Math.max(2.4,Math.min(12.4,position[1]))]);const playerAssets=m.playerAssets.map(a=>a.id===id?{...a,position:placed}:a);const squadrons=id==='p-base'?m.squadrons.map(s=>({...s,route:s.route.map((p,i)=>i===0||i===s.route.length-1&&Math.hypot(p[0]-oldBase[0],p[1]-oldBase[1])<.3?placed:p)})):m.squadrons;return {...m,playerAssets,squadrons}}),[])
  const commit=()=>{const result=resolveRound(match);resultRef.current=result;completingRef.current=false;setProgress(0);setActiveEvent(undefined);setMatch(m=>({...m,phase:'execute'}))}
  const reinforce=(type:ReinforcementType)=>{const result=resultRef.current;if(!result)return;const seconds=progress*18;const option=REINFORCEMENT_OPTIONS[type];if(match.command<option.commandCost||match.replacements<option.reserveCost||supportCreditsAt(result,seconds)<option.scoreCost)return;const next=callReinforcement(result,type,seconds,playerBase);if(next===result)return;resultRef.current=next;setMatch(m=>({...m,command:m.command-option.commandCost,replacements:m.replacements-option.reserveCost}))}

  useEffect(()=>{
    if(match.phase!=='execute'||!resultRef.current)return
    const result=resultRef.current;let frame=0;let last=performance.now();let current=progress;const duration=18000
    const tick=(now:number)=>{const dt=(now-last)*speed;last=now;current=Math.min(1,current+dt/duration);setProgress(current);const seconds=current*18;const liveResult=resultRef.current??result;const event=[...liveResult.events].reverse().find(e=>e.time<=seconds);setActiveEvent(event);if(current>=1){if(!completingRef.current){completingRef.current=true;setTimeout(()=>setMatch(m=>m.phase==='execute'?applyRound(m,resultRef.current??result):m),650)}return}frame=requestAnimationFrame(tick)}
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame)
  },[match.phase,speed]) // progress intentionally resumes from the value captured when speed/phase changes

  const nextRound=()=>setMatch(m=>({...m,round:m.round+1,phase:'plan',lastResult:undefined}))
  const restart=()=>{localStorage.removeItem(SAVE_KEY);setMatch(createMatch());setProgress(0);setActiveEvent(undefined)}

  return <main className="app-shell">
    <div className={`game-frame phase-${match.phase}`}>
      <TopBar round={match.round} intel={intel} logistics={match.logistics} replacements={match.replacements} score={match.campaignScore??0} phase={match.phase}/>
      <div className="map-wrap"><Battlefield squadrons={match.squadrons} assets={match.enemyAssets} playerAssets={match.playerAssets} selectedId={match.selectedId} placementId={placementId} phase={match.phase} progress={progress} activeEvent={activeEvent} executionResult={match.phase==='execute'?resultRef.current:match.phase==='debrief'?match.lastResult:undefined} onRoute={setRoute} onPlace={placeAsset}/><PhaseRail phase={match.phase}/><HealthBars player={match.playerBaseHealth} enemy={match.enemyBaseHealth} enemyKnown={enemyBaseKnown} exposure={match.baseExposure??6}/>
        {match.phase==='deploy'?<div className="map-tip deploy-tip"><span>TAP HEX</span> PLACE SELECTED ASSET · FRIENDLY TERRITORY ONLY</div>:null}
        {match.phase==='plan'?<><div className="sensor-legend"><b>LOS {effectiveSensorRange(selected).toFixed(1)}</b><span>RADAR {RADAR_RANGE.toFixed(1)}</span></div><div className="map-tip"><span>TAP / DRAG</span> FREEHAND ROUTE · RINGS SHOW OBSERVATION</div></>:null}
        {match.phase==='execute'?<ExecutionOverlay progress={progress} activeEvent={activeEvent} speed={speed} onSpeed={()=>setSpeed(s=>s===1?2:1)} match={match} result={resultRef.current} onReinforce={reinforce} onAbort={()=>resultRef.current&&setMatch(m=>applyRound(m,resultRef.current!))}/>:null}
      </div>
      {match.phase==='deploy'?<DeploymentPanel assets={match.playerAssets} selectedId={placementId} onSelect={setPlacementId} onLock={()=>setMatch(m=>({...m,phase:'plan'}))}/>:null}
      {match.phase==='plan'?<><SquadronRail squadrons={match.squadrons} selectedId={match.selectedId} onSelect={id=>setMatch(m=>({...m,selectedId:id}))}/><OrdersPanel squadron={selected} onChange={patchSelected} onPreset={name=>setRoute([playerBase,...PRESETS[name].slice(1)])} onClear={()=>setRoute([])} onCommit={commit}/></>:null}
      {match.phase==='debrief'&&match.lastResult?<Debrief match={match} onRepair={id=>setMatch(m=>repairSquadron(m,id))} onRearm={id=>setMatch(m=>rearmSquadron(m,id))} onReady={id=>setMatch(m=>restoreReadiness(m,id))} onDefense={id=>setMatch(m=>repairDefense(m,id))} onRunway={()=>setMatch(m=>repairRunway(m))} onNext={nextRound}/>:null}
      {(match.phase==='victory'||match.phase==='defeat')?<EndState victory={match.phase==='victory'} round={match.round} onRestart={restart}/>:null}
    </div>
  </main>
}

function DeploymentPanel({assets,selectedId,onSelect,onLock}:{assets:Asset[];selectedId:string;onSelect:(id:string)=>void;onLock:()=>void}){
  return <section className="deployment-panel"><div className="deployment-head"><div><small>PRE-MATCH DEPLOYMENT</small><h2>BUILD YOUR DECEPTION</h2></div><ShieldCheck/></div><p>Place the real base, decoy, sensors, and defenses. Overlap radar and weapon rings, but avoid revealing the real base through an obvious defensive cluster.</p><div className="asset-picker">{assets.map(a=><button key={a.id} className={a.id===selectedId?'active':''} onClick={()=>onSelect(a.id)}><b>{a.kind.toUpperCase()}</b><small>{a.kind==='base'?'PRIMARY':a.kind==='decoy'?'FALSE FIELD':a.kind==='radar'?'DETECT 6.4':a.kind==='sam'?'ENGAGE 3.2':'ENGAGE 1.9'}</small></button>)}</div><button className="commit" onClick={onLock}>LOCK DEPLOYMENT <span>››</span></button></section>
}

function ExecutionOverlay({progress,activeEvent,speed,onSpeed,match,result,onReinforce,onAbort}:{progress:number;activeEvent?:CombatEvent;speed:number;onSpeed:()=>void;match:MatchState;result?:ReturnType<typeof resolveRound>;onReinforce:(type:ReinforcementType)=>void;onAbort:()=>void}){
  const [storeOpen,setStoreOpen]=useState(false)
  const windows=result?.enemyFlights.flatMap(f=>f.detectionWindows.filter(w=>progress>=w.start&&progress<=w.end))??[]
  const visual=windows.some(w=>w.source==='visual')
  const cue=result?.defenseCues?.find(c=>progress>=c.start&&progress<=c.end)
  const network=windows.some(w=>w.source==='network')
  const seconds=progress*18;const score=result?battleScoreAt(result,seconds):0;const attrition=result?attritionCreditAt(result,seconds):0;const support=result?supportCreditsAt(result,seconds):0
  const lossObserved=result?.events.some(event=>event.time<=seconds&&(event.title==='AIRCRAFT LOST'||event.title==='PURSUIT LOSS'))??false
  const alreadyCalled=(type:ReinforcementType)=>result?.reinforcementCalls.some(call=>call.type===type)??false
  const canCall=(type:ReinforcementType)=>{const option=REINFORCEMENT_OPTIONS[type];if(!result||alreadyCalled(type)||support<option.scoreCost||match.command<option.commandCost||match.replacements<option.reserveCost)return false;return type==='alert-cap'?windows.length>0&&progress<.82:lossObserved}
  return <div className="execute-hud"><div className="timer"><i style={{width:`${progress*100}%`}}/></div><div className={`contact-status ${windows.length?'hot':''} ${visual?'visual':''} ${network?'network':''}`}>{windows.length?(visual?`${windows.length} VISUAL CONTACT`:network?'DEFENSE TRACK SHARED':`${windows.length} RADAR TRACK`):'NO HOSTILE TRACKS'}</div>{cue?<div className="cue-status"><ShieldCheck/> DEFENSE CUED · +{cue.rangeBonus.toFixed(1)} RANGE</div>:null}<div className={`event-card ${activeEvent?.tone??''}`}><span>{activeEvent?.tone==='danger'?<AlertTriangle/>:<Volume2/>}</span><div><b>{activeEvent?.title??'AWAITING CONTACT'}</b><p>{activeEvent?.detail??'Packages are crossing the forward line.'}</p></div></div>
    <div className={`reserve-desk ${storeOpen?'open':''}`}><button className="reserve-toggle" onClick={()=>setStoreOpen(open=>!open)}><Radio/><span>RESERVE DESK</span><b>{support} AUTH</b></button>{storeOpen?<div className="reserve-drawer"><header><span>ROUND SCORE {score}</span><span>{attrition?`+${attrition} ATTRITION`:null}</span><b>{match.command} CP · {match.replacements} RES</b></header>{(['alert-cap','replacement-flight'] as ReinforcementType[]).map(type=>{const option=REINFORCEMENT_OPTIONS[type];return <button key={type} disabled={!canCall(type)} onClick={()=>onReinforce(type)}><i>{type==='alert-cap'?<PlaneTakeoff/>:<Wrench/>}</i><span><b>{option.label}</b><small>{option.summary}</small></span><em>{option.scoreCost} AUTH · {option.commandCost} CP · {option.reserveCost} RES</em></button>})}<p>TRACKS, INTEL, KILLS, AND OBSERVED ATTRITION AUTHORIZE SUPPORT.</p></div>:null}</div>
    <div className="exec-controls"><button onClick={onAbort}>ABORT &amp; RECOVER</button><button className="speed" onClick={onSpeed}><FastForward/>{speed}×</button></div><div className="strength-mini">{match.squadrons.map(s=><span key={s.id}>{s.callsign.split(' ')[0]} <b>{s.aircraft}/{s.maxAircraft}</b></span>)}</div></div>
}

function Debrief({match,onRepair,onRearm,onReady,onDefense,onRunway,onNext}:{match:MatchState;onRepair:(id:string)=>void;onRearm:(id:string)=>void;onReady:(id:string)=>void;onDefense:(id:string)=>void;onRunway:()=>void;onNext:()=>void}){
  const r=match.lastResult!
  return <section className="debrief"><div className="debrief-title"><div><small>ROUND {String(match.round).padStart(2,'0')} COMPLETE</small><h2>AFTER ACTION</h2></div><div className={`outcome ${r.enemyBaseDamage>0?'success':''}`}><CheckCircle2/><span>{r.enemyBaseDamage>0?'OBJECTIVE HIT':'INTEL GAINED'}</span></div></div>
    <div className="summary-grid"><article><small>FRIENDLY LOSSES</small><strong>{r.friendlyLosses}</strong><span>AIRCRAFT</span></article><article><small>ENEMY LOSSES</small><strong>{r.enemyLosses}</strong><span>CONFIRMED</span></article><article><small>ROUND SCORE</small><strong>{r.roundScore}</strong><span>CAMPAIGN {match.campaignScore}</span></article><article><small>BASE DAMAGE</small><strong>{r.enemyBaseDamage}%</strong><span>INFLICTED</span></article></div>
    <div className={`opsec-report ${r.baseExposureDelta<=0?'secure':'exposed'}`}><div><small>ROUTE SECURITY</small><b>HOME-BASE EXPOSURE {r.baseExposure}%</b></div><strong>{r.baseExposureDelta>0?`+${r.baseExposureDelta}`:r.baseExposureDelta}</strong><p>{r.baseExposureDelta>0?'Enemy analysts can backtrace direct ingress vectors. Add an offset leg before crossing the forward line.':'Indirect departures are denying a reliable origin trace.'}</p></div>
    <div className="lesson-report"><h3>COMMAND FINDINGS <span>ROUTES + MARKERS ABOVE</span></h3>{r.lessons?.length?r.lessons.map((lesson,i)=><article key={i} className={lesson.tone}><b>{lesson.title}</b><p>{lesson.detail}</p></article>):<article><b>Orders executed as planned</b><p>No doctrine threshold materially changed a route this round.</p></article>}</div>
    <div className="intel-report"><h3>INTELLIGENCE PICTURE</h3>{r.intelGained.length?r.intelGained.map((x,i)=><p key={i}><Zap/> {x}</p>):<p><AlertTriangle/> No new fixed assets identified. Change the recon corridor.</p>}</div>
    <div className="readiness-list"><h3>FORCE READINESS <span>{match.logistics} LOGISTICS · {match.replacements} RESERVES · {match.command} CP</span></h3>{match.squadrons.map(s=>{const serviceCost=serviceSquadronCost(s);const replacing=s.damaged===0&&s.aircraft<s.maxAircraft;const serviceLabel=s.damaged>0?'REPAIR':'REPLACE';return <div className="readiness-row" key={s.id}><div><b>{s.callsign}</b><small>{s.role.toUpperCase()} · {s.aircraft}/{s.maxAircraft} READY · {s.damaged} DAMAGED · AMMO {s.ammo}%</small></div><span className="mini-bar"><i style={{width:`${s.readiness}%`}}/></span><button disabled={serviceCost===0||match.logistics<serviceCost||replacing&&match.replacements===0} onClick={()=>onRepair(s.id)}><Wrench/> {serviceLabel} {serviceCost||''}</button><button disabled={match.logistics<1||s.ammo===100} onClick={()=>onRearm(s.id)}>ARM 1</button><button disabled={match.logistics<1||s.readiness===100} onClick={()=>onReady(s.id)}>REST 1</button></div>})}</div>
    <div className="defense-logistics"><h3>BASE &amp; DEFENSES</h3><button disabled={match.logistics<3||match.playerBaseHealth===100} onClick={onRunway}><b>RUNWAY {match.playerBaseHealth}%</b><span>REPAIR 18 · COST 3</span></button>{match.playerAssets.filter(a=>a.kind==='radar'||a.kind==='sam'||a.kind==='aaa').map(a=><button key={a.id} disabled={match.logistics<2||a.health===100} onClick={()=>onDefense(a.id)}><b>{a.kind.toUpperCase()} {a.health}%</b><span>REPAIR 28 · COST 2</span></button>)}</div>
    <button className="continue" onClick={onNext}>ADAPT FOR ROUND {String(match.round+1).padStart(2,'0')} <ChevronRight/></button>
  </section>
}

function EndState({victory,round,onRestart}:{victory:boolean;round:number;onRestart:()=>void}){
  return <section className={`end-state ${victory?'win':'loss'}`}><div className="end-icon">{victory?<ShieldCheck/>:<AlertTriangle/>}</div><small>CAMPAIGN ENDED · ROUND {String(round).padStart(2,'0')}</small><h1>{victory?'BREAKTHROUGH':'COMMAND LOST'}</h1><p>{victory?'Enemy command aviation has been destroyed. Their integrated air defense network is collapsing.':'Your primary airbase has been rendered inoperable. The enemy found the truth before you found theirs.'}</p><button onClick={onRestart}><RotateCcw/> NEW CAMPAIGN</button></section>
}
