import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crosshair, Eye, List, LocateFixed, Map, Radar, RotateCcw, Shield, Sword, Trophy, Wrench, Zap } from 'lucide-react'
import { formationStatus, recoveryReasonLabel } from '../game/formationStatus'
import { contactTracksAt } from '../game/contactTracks'
import { airfieldLabel, formationBaseGroups } from '../game/formationBasing'
import { projectFriendlyUnitAt } from '../game/executionProjection'
import { templateFor, templatesForRole } from '../game/routeTemplates'
import {DEBUG_SCENARIOS,DEBUG_SCENARIO_LABELS} from '../game/scenarios'
import type { Asset, CombatEvent, DebugScenario, MissionId, Point, RoundResult, Squadron } from '../game/types'

const ROLE_ICONS={fighter:Crosshair,recon:Eye}

export function ContactTracks({result,seconds,home,onFocus}:{result?:RoundResult;seconds:number;home:Point;onFocus:(point:Point)=>void}){
  const tracks=contactTracksAt(result,seconds,home)
  if(!tracks.length)return null
  const visual=tracks.filter(track=>track.visibility==='visual').length,radar=tracks.filter(track=>track.visibility==='radar').length
  return <details className="contact-tracks" aria-label="Enemy contact tracks">
    <summary>{visual+radar} CURRENT TRACKS · {visual} VISUAL / {radar} RADAR</summary>
    <div>{tracks.map(track=><button key={track.unitId} className={track.visibility} onClick={()=>onFocus(track.position)} aria-label={`Locate ${track.trackId}, ${track.identification}, ${track.visibility==='lost'?'last known position':track.visibility}`}>
      <b>{track.trackId} · {track.identification}</b>
      <span>{track.callsign?`${track.callsign} · `:''}{track.visibility==='lost'?`CONTACT LOST · LAST SEEN ${Math.max(0,seconds-track.lastSeen).toFixed(1)}s AGO`:`${track.visibility.toUpperCase()} · ${track.course}${track.aircraft===undefined?'':` · ${track.aircraft} AIRCRAFT`}`}</span>
    </button>)}</div>
  </details>
}

export function TopBar({round,intel,logistics,replacements,score,phase,debugScenario,onDebugScenario,onReboot,onMenu,difficulty}:{round:number;intel:number;logistics:number;replacements:number;score:number;phase:string;debugScenario:DebugScenario;onDebugScenario:(scenario:DebugScenario)=>void;onReboot:()=>void;onMenu?:()=>void;difficulty?:string}){
  return <header className="topbar"><div className="brand"><b>DEAD RECKONING</b><small>{onMenu?<button type="button" className="menu-button" onClick={onMenu}>MENU</button>:'AIR COMMAND'}{difficulty?` · ${difficulty.toUpperCase()}`:''}</small></div><div className="round"><small>ROUND {String(round).padStart(2,'0')}</small><strong>{phase==='execute'?'OBSERVE':phase==='debrief'?'AFTER ACTION':phase.toUpperCase()}</strong></div><div className="resources"><span title="Known enemy assets"><Radar/> {intel}</span><span title="Logistics"><Wrench/> {logistics}</span><span title="Reserve aircraft"><Zap/> {replacements}</span>{phase==='debrief'||phase==='adapt'||phase==='victory'||phase==='defeat'?<span title="Campaign score"><Trophy/> {score}</span>:null}</div><details className="dev-menu"><summary>DEV <ChevronDown/></summary><div><select value={debugScenario} onChange={e=>onDebugScenario(e.target.value as DebugScenario)} title="Deterministic debug scenario">{DEBUG_SCENARIOS.map(s=><option key={s} value={s}>{DEBUG_SCENARIO_LABELS[s]}</option>)}</select><button className="reboot" onClick={onReboot} title="Clear saved campaign and return to deployment"><RotateCcw/> REBOOT</button></div></details></header>
}

export type PlanningRosterMode = 'closed' | 'base' | 'all'
export type PlanningStep = 'idle' | 'route' | 'mission' | 'target'

function FormationRosterRow({squadron,active,reviewed,onSelect,onEdit}:{squadron:Squadron;active:boolean;reviewed:boolean;onSelect:()=>void;onEdit:()=>void}){
  const force=formationStatus(squadron)
  const RoleIcon=ROLE_ICONS[squadron.role]
  const routeState=force.destroyed?'DESTROYED':squadron.route.length<2?'NO ROUTE':reviewed?'PLANNED':'PENDING'
  return <div className={`formation-roster-row ${active?'active':''} ${force.destroyed?'destroyed':''}`}>
    <button className="formation-roster-select" disabled={force.destroyed} onClick={onSelect} onDoubleClick={onEdit} title="Tap to select; double-tap to edit orders">
      <RoleIcon/><span><b>{squadron.callsign}</b><small>{squadron.role.toUpperCase()}</small></span>
      <i>{Array.from({length:force.maxAircraft},(_,pip)=><em key={pip} className={pip<force.aircraft?'live':''}/>)}</i>
      <strong className={routeState==='NO ROUTE'?'warning':''}>{routeState}</strong>
    </button>
    <button className="formation-roster-edit" disabled={force.destroyed} onClick={onEdit}>EDIT</button>
  </div>
}

export function PlanningChitRail({squadrons,bases,activeBaseId,selectedId,reviewedIds,onSelect}:{squadrons:Squadron[];bases:Asset[];activeBaseId:string;selectedId:string;reviewedIds:Set<string>;onSelect:(id:string)=>void}){
  const group=formationBaseGroups(squadrons,bases).find(item=>item.base.id===activeBaseId)
  if(!group)return null
  const squadronById=new globalThis.Map(squadrons.map(item=>[item.id,item]))
  return <aside className="planning-chits" aria-label={`${airfieldLabel(group.base)} planning queue`}>
    <header><LocateFixed/><span>{airfieldLabel(group.base)}</span></header>
    <div>{group.formationIds.map(id=>{const item=squadronById.get(id);if(!item)return null;const force=formationStatus(item);const RoleIcon=ROLE_ICONS[item.role];const planned=reviewedIds.has(id);return <button key={id} className={`${id===selectedId?'active':''} ${planned?'planned':''} ${force.destroyed?'destroyed':''}`} disabled={force.destroyed} onClick={()=>onSelect(id)} aria-label={`${item.callsign}, ${planned?'planned':'pending'}`}><RoleIcon/><b>{item.callsign}</b><small>{force.aircraft}/{force.maxAircraft}</small><i>{planned?<CheckCircle2/>:<span/>}</i></button>})}</div>
  </aside>
}

export function CommandShelf({squadrons,bases,activeBaseId,rosterMode,squadron,routeDistance,maxDistance,routeNotice,protectSummary,recoverySummary,onSelect,onBaseSelect,onRosterMode,onMission,onPickProtectTarget,onProtectFlight,onRecoverHome,onClear,onBack,onCommit,step,onClose,reviewedIds,reviewedCount,totalCount,groundTargets=[],onChangeGroundTarget,strikeUnlocked=false,strikeDisabledReason='RECOVER BASE INTELLIGENCE TO UNLOCK',selectingProtectTarget=false}:{squadrons:Squadron[];bases:Asset[];activeBaseId:string;rosterMode:PlanningRosterMode;squadron:Squadron;routeDistance:number;maxDistance:number;routeNotice?:string;protectSummary?:string;recoverySummary?:string;onSelect:(id:string)=>void;onBaseSelect:(id:string)=>void;onRosterMode:(mode:PlanningRosterMode)=>void;onMission:(mission:MissionId)=>void;onPickProtectTarget?:()=>void;onProtectFlight?:(id:string)=>void;onRecoverHome?:()=>void;onClear:()=>void;onBack?:()=>void;onCommit:()=>void;step:PlanningStep;onClose:()=>void;reviewedIds:Set<string>;reviewedCount:number;totalCount:number;campaign?:boolean;groundTargets?:Asset[];onChangeGroundTarget?:()=>void;strikeUnlocked?:boolean;strikeDisabledReason?:string;selectingProtectTarget?:boolean}){
  const force=formationStatus(squadron)
  const ready=reviewedCount>0
  const expanded=step!=='idle'
  const missionLabel=templateFor(squadron.mission).label.toUpperCase()
  const groups=formationBaseGroups(squadrons,bases)
  const activeGroup=groups.find(group=>group.base.id===activeBaseId)??groups[0]
  const activeBase=activeGroup?.base
  const forwardBased=groups.some(group=>group.base.kind==='fob'&&group.formationIds.includes(squadron.id))
  const squadronById=new globalThis.Map(squadrons.map(item=>[item.id,item]))
  const openOrders=(id:string)=>onSelect(id)
  const primaryLabel='COMMIT ROUND'
  const primaryDisabled=!ready
  const primaryAction=ready?onCommit:undefined
  return <section className={`command-shelf ${expanded?'expanded':''}`} aria-label="Planning command shelf">
    {expanded?<div className={`command-sheet ${step}-step`}>
      {step==='route'?<>
        <div className="sheet-heading"><span>ORDERS {reviewedCount} / {totalCount}</span><b>{squadron.callsign}</b><button onClick={onClose}>CLOSE</button></div>
        <h2 className="planning-title">BUILD YOUR ROUTE</h2>
        <p className="planning-help">{selectingProtectTarget?"Tap a friendly site or map point once to confirm area defense. A checked flight pip selects an escort and shows its route.":squadron.mission==='base-strike'?"The takeoff point stays fixed. Select the strike marker, then tap anywhere inside the six-unit circle to move it. Add up to five ingress waypoints.":squadron.mission==='defensive-cap'?"Choose a site or point with one tap, or escort a confirmed flight. Escort draws the longest fighter-feasible stretch of that flight's route.":"Add or move up to five waypoints. Select another aircraft to save this route."}</p>
        {squadron.mission==='defensive-cap'?<div className="planning-protect-target"><button onClick={onPickProtectTarget}>DEFEND SITE OR POINT</button><details><summary>ESCORT A FLIGHT</summary><div>{squadrons.filter(item=>item.id!==squadron.id&&reviewedIds.has(item.id)&&item.aircraft>0).map(item=><button key={item.id} onClick={()=>onProtectFlight?.(item.id)}>{item.callsign} · ORDER READY · VIEW ROUTE</button>)}{!squadrons.some(item=>item.id!==squadron.id&&reviewedIds.has(item.id)&&item.aircraft>0)?<small>Confirm the other flight first, then select it here.</small>:null}</div></details><small>{protectSummary??"Default: defend the route endpoint."}</small></div>:null}
        {squadron.mission==='base-strike'?<p className="strike-target-summary">TARGET: {groundTargets.find(asset=>asset.id===squadron.strikeTargetId)?.name??groundTargets.find(asset=>asset.id===squadron.strikeTargetId)?.kind.toUpperCase()??'SELECT TARGET'} <button onClick={onChangeGroundTarget}>CHANGE TARGET</button></p>:null}
        <div className="planning-route-actions">{squadron.role==='fighter'&&onBack?<button onClick={onBack}>CHANGE TASK</button>:null}{forwardBased&&onRecoverHome?<button onClick={onRecoverHome}>RECOVER HOME</button>:null}<button onClick={onClear}>{squadron.mission==='base-strike'?'CLEAR WAYPOINTS':'CLEAR ROUTE'}</button></div>
        <p className={`shelf-range ${routeDistance>=maxDistance-.1?'limit':''}`} aria-live="polite">{routeNotice??(squadron.route.length<2?'TAP THE MAP TO START':`${Math.min(5,Math.max(0,squadron.routeIngress.length-(squadron.mission==='base-strike'?2:1)))} / 5 WAYPOINTS · ${Math.max(0,maxDistance-routeDistance).toFixed(1)} RANGE LEFT`)}</p>
      </>:null}
      {step==='target'?<>
        <div className="sheet-heading"><b>{squadron.callsign} · GROUND STRIKE</b><button onClick={onClose}>CLOSE</button></div>
        <h2 className="planning-title">CLICK A TARGET ON THE MAP</h2>
        <p className="planning-help">Tap a confirmed enemy target on the map.</p>
        <p className="mission-effect">{routeNotice??(!groundTargets.length?'Recover ground target intelligence first.':'One missile payload per formation. No voluntary air interceptions.')}</p>
        <button onClick={onBack}>CHANGE TASK</button>
      </>:null}
      {step==='mission'?<>
        <div className="sheet-heading"><span>ORDERS {reviewedCount} / {totalCount}</span><b>{squadron.callsign}</b><button onClick={onClose}>CLOSE</button></div>
        <h2 className="planning-title">CHOOSE YOUR TASK</h2>
        <div className="shelf-route">{templatesForRole(squadron.role).filter(template=>template.id!=='base-strike').map(template=>{const MissionIcon=template.id==='defensive-cap'?Shield:template.id==='forward-patrol'?Sword:Map;return <button key={template.id} className={squadron.mission===template.id?'active':''} aria-label={template.label} aria-pressed={squadron.mission===template.id} onClick={()=>onMission(template.id)}><MissionIcon/><b>{template.shortLabel}</b></button>})}{squadron.role==='fighter'?<button className={squadron.mission==='base-strike'?'active':''} aria-label="Ground Strike" aria-pressed={squadron.mission==='base-strike'} disabled={!strikeUnlocked} title={!strikeUnlocked?strikeDisabledReason:'Choose a confirmed enemy ground target.'} onClick={()=>onMission('base-strike')}><Crosshair/><b>GROUND STRIKE</b></button>:null}</div>
        <p className="mission-effect" aria-live="polite">{routeNotice??(squadron.mission==='forward-patrol'?'Patrol and pursue contacts near your route.':squadron.mission==='base-strike'?'Select a ground target, then plan the ingress.':squadron.mission==='transit'?'Fly directly to a friendly airfield.':'Defend your route endpoint, a site, or a confirmed flight.')}</p>
      </>:null}
    </div>:null}
    {!expanded&&rosterMode!=='closed'?<div className="planning-roster" aria-label={rosterMode==='all'?'All formations':'Airfield formations'}>
      <header><button className="planning-base-title" onClick={()=>activeBase&&onBaseSelect(activeBase.id)}><LocateFixed/><span><b>{activeBase?airfieldLabel(activeBase):'AIRFIELD'}</b><small>{activeGroup?.formationIds.length??0} FORMATIONS</small></span></button><button className={rosterMode==='all'?'active':''} onClick={()=>onRosterMode(rosterMode==='all'?'base':'all')}><List/> ALL {squadrons.length}</button><button aria-label="Close formation roster" onClick={()=>onRosterMode('closed')}><ChevronDown/></button></header>
      <div className="planning-roster-scroll">{(rosterMode==='all'?groups:activeGroup?[activeGroup]:[]).map(group=><section key={group.base.id} className="formation-base-group"><div className="formation-base-heading"><b>{airfieldLabel(group.base)}</b><button className={group.base.id===activeBaseId?'active':''} onClick={()=>onBaseSelect(group.base.id)}>{group.formationIds.length} BASED</button></div>{group.formationIds.length?group.formationIds.map(id=>{const item=squadronById.get(id);return item?<FormationRosterRow key={id} squadron={item} active={id===squadron.id} reviewed={reviewedIds.has(id)} onSelect={()=>openOrders(id)} onEdit={()=>openOrders(id)}/>:null}):<p className="formation-base-empty">NO FORMATIONS BASED HERE</p>}</section>)}</div>
    </div>:null}
    <div className={`planning-capsule ${step!=='idle'?'route-editing':''} ${step==='idle'&&ready?'has-commit':''}`}>
      <button className="planning-base-toggle" aria-expanded={expanded} onClick={()=>activeBase&&onBaseSelect(activeBase.id)}><LocateFixed/><span><b>{activeBase?airfieldLabel(activeBase):'AIRFIELD'}</b><small>{expanded?`${squadron.callsign} · ${missionLabel}`:protectSummary&&reviewedIds.has(squadron.id)?protectSummary:reviewedCount?`ORDERS READY · SELECT FLIGHTS OR COMMIT`:'SELECT AIRCRAFT ABOVE AIRFIELD'}</small></span><ChevronUp/></button>
      <button className={`planning-all-toggle ${rosterMode!=='closed'?'active':''}`} onClick={()=>{if(expanded)onClose();onRosterMode(rosterMode==='closed'?'all':'closed')}}><List/><span>ALL</span></button>
      {step==='idle'&&ready?<button className="shelf-primary" disabled={primaryDisabled} onClick={primaryAction}>{primaryLabel} <ChevronRight/></button>:null}
    </div>
  </section>
}

function modeLabel(mode:string|undefined){return mode==='grounded'?'STATIONED':mode==='dogfighting'?'ENGAGED':mode==='intercepting'?'INTERCEPTING':mode==='recovering'?'RETURNING':mode==='recovered'?'LANDED':mode==='stranded'?'NO RECOVERY':mode==='trapped'?'TRAPPED':mode==='destroyed'?'DESTROYED':mode==='attacking-recon'?'PURSUING':'ON ROUTE'}
function frameFor(squadron:Squadron,result:RoundResult|undefined,progress:number){
  const seconds=progress*(result?.duration??22)
  return projectFriendlyUnitAt(result,squadron.id,seconds)?.frame??{aircraft:squadron.aircraft,strength:squadron.strength??100,morale:squadron.morale??70,mode:squadron.status,traveledDistance:0}
}

export function ExecutionChitRail({squadrons,bases,result,progress,activeBaseId,selectedId,followId,threatenedIds=new Set(),onSelect}:{squadrons:Squadron[];bases:Asset[];result?:RoundResult;progress:number;activeBaseId:string;selectedId:string;followId?:string;threatenedIds?:Set<string>;onSelect:(id:string)=>void}){
  const group=formationBaseGroups(squadrons,bases).find(item=>item.base.id===activeBaseId)
  if(!group)return null
  const squadronById=new globalThis.Map(squadrons.map(item=>[item.id,item]))
  const sortieIds=new Set(result?result.unitTracks.filter(track=>track.frames[0]?.aircraft>0&&track.frames[0]?.mode!=='trapped'&&track.frames[0]?.mode!=='grounded').map(track=>track.unitId):squadrons.filter(item=>item.aircraft>0&&item.status!=='trapped'&&item.route.length>=2&&item.sortieOrdered!==false).map(item=>item.id))
  const formationIds=group.formationIds.filter(id=>sortieIds.has(id))
  return <aside className="planning-chits execution-chits" aria-label={`${airfieldLabel(group.base)} launched formations`}>
    <header><LocateFixed/><span>{airfieldLabel(group.base)}</span></header>
    <div>{formationIds.map(id=>{const item=squadronById.get(id);if(!item)return null;const frame=frameFor(item,result,progress);const RoleIcon=ROLE_ICONS[item.role];const destroyed=frame.aircraft<=0,threatened=threatenedIds.has(id);const healthTone=frame.strength<40?'critical':frame.strength<70?'damaged':'healthy';return <button key={id} className={`${id===selectedId&&followId===id?'active':''} ${destroyed?'destroyed':''} ${threatened?'threatened':''}`} onClick={()=>onSelect(id)} aria-label={`${item.callsign}, ${modeLabel(frame.mode)}, ${Math.round(frame.strength)} percent strength${threatened?', threat alert':''}`}><RoleIcon/><b>{item.callsign}</b>{threatened?<strong className="formation-threat">!</strong>:null}<small>{frame.aircraft}/{item.maxAircraft} · {modeLabel(frame.mode)}</small><i className={`formation-health ${healthTone}`}><span style={{width:`${Math.max(0,frame.strength)}%`}}/></i></button>})}</div>
    {!formationIds.length?<p className="execution-chits-empty">NO SORTIES</p>:null}
  </aside>
}

export function ObserveEventFeed({events,progress,duration=22,onFocus}:{events:CombatEvent[];progress:number;duration?:number;onFocus:(event:CombatEvent)=>void}){
  const [cursorId,setCursorId]=useState<string>()
  const [historyOpen,setHistoryOpen]=useState(false)
  const seconds=progress*duration
  const visible=events.filter(event=>event.time<=seconds)
  const cursorIndex=cursorId?visible.findIndex(event=>event.id===cursorId):-1
  const index=cursorIndex>=0?cursorIndex:visible.length-1
  const event=visible[index]
  const navigate=(offset:number)=>{const next=Math.max(0,Math.min(visible.length-1,index+offset));setCursorId(next===visible.length-1?undefined:visible[next]?.id)}
  if(!event)return null
  const EventIcon=event.tone==='danger'||event.tone==='warning'?AlertTriangle:CheckCircle2
  return <section className={`observe-feed ${event.tone} ${historyOpen?'history-open':''}`} aria-label="Tactical event navigator">
    <header className="event-feed-head"><span><i/> LIVE FEED</span><b>{index+1} / {visible.length}</b><button disabled={index<=0} onClick={()=>navigate(-1)} aria-label="Previous event"><ChevronLeft/></button><button disabled={index>=visible.length-1} onClick={()=>navigate(1)} aria-label="Next event"><ChevronRight/></button><button className="event-history-toggle" aria-expanded={historyOpen} onClick={()=>setHistoryOpen(open=>!open)} aria-label="Toggle event history"><List/>{historyOpen?<ChevronUp/>:<ChevronDown/>}</button></header>
    <div className="event-feed-body"><div className="event-severity"><EventIcon/></div><button className="event-current" onClick={()=>onFocus(event)} aria-label={`Focus event: ${event.title}`}><b>{event.title}</b><small>{event.detail}</small></button><button className="event-focus" onClick={()=>onFocus(event)} aria-label="Focus current event"><LocateFixed/></button></div>
    <div className="event-timeline" aria-label="Event severity timeline">{visible.slice(-12).map(item=><button key={item.id} className={`${item.tone} ${item.id===event.id?'active':''}`} onClick={()=>setCursorId(item.id===visible.at(-1)?.id?undefined:item.id)} aria-label={`Show ${item.title}`}/>)}</div>
    {historyOpen?<div className="event-history">{[...visible].reverse().map(item=><button key={item.id} className={`${item.tone} ${item.id===event.id?'active':''}`} onClick={()=>{setCursorId(item.id===visible.at(-1)?.id?undefined:item.id);onFocus(item)}}><span>{item.time.toFixed(1)}s</span><b>{item.title}</b><small>{item.detail}</small><LocateFixed/></button>)}</div>:null}
  </section>
}

export function FormationDock({squadrons,bases,result,progress,selectedId,followId,onSelect,onClearFollow,onAirfield,onRtb}:{squadrons:Squadron[];bases:Asset[];result?:RoundResult;progress:number;selectedId:string;followId?:string;onSelect:(id:string)=>void;onClearFollow:()=>void;onAirfield:()=>void;onRtb:(id:string)=>void}){
  const [view,setView]=useState<'closed'|'details'|'roster'>('closed')
  const active=squadrons.find(s=>s.id===selectedId)??squadrons[0]
  if(!active)return null
  const frame=frameFor(active,result,progress)
  const seconds=progress*(result?.duration??22)
  const behavior=result?.behaviorIntervals.filter(interval=>interval.unitId===active.id&&seconds>=interval.start&&seconds<=interval.end).at(-1)
  const activity=frame.mode==='recovering'?`${modeLabel(frame.mode)} · ${recoveryReasonLabel(behavior?.reason)}`:modeLabel(frame.mode)
  const targetContext=behavior?.targetId?(behavior.source==='visual'?'VISUAL CONTACT':behavior.source==='radar'?'RADAR TRACK':'ASSIGNED CONTACT'):'NO ACTIVE CONTACT'
  const groups=formationBaseGroups(squadrons,bases)
  const squadronById=new globalThis.Map(squadrons.map(item=>[item.id,item]))
  const protectedFlight=active.protectedTargetId?squadronById.get(active.protectedTargetId):undefined
  const protectedAsset=active.protectedPoint?bases.find(asset=>Math.hypot(asset.position[0]-active.protectedPoint![0],asset.position[1]-active.protectedPoint![1])<.01):undefined
  const missionLabel=templateFor(active.mission).label.toUpperCase()
  return <section className={`execution-shelf ${view!=='closed'?'expanded':''}`} aria-label="Formation command shelf">
    {view==='details'?<div className="execution-detail"><div className="execution-detail-head"><span>FORMATION STATUS</span><b>{active.callsign}</b></div><div className="execution-detail-grid"><div><small>ACTIVITY</small><b>{activity}</b><span>{targetContext}</span></div><div><small>MISSION</small><b>{missionLabel}</b><span>{active.mission==='base-strike'?'ATTACK SELECTED GROUND TARGET · NO VOLUNTARY INTERCEPTS':active.mission==='transit'?'FLY TO AIRFIELD · NO VOLUNTARY INTERCEPTS':active.mission==='defensive-cap'?`${protectedFlight?`ESCORT ${protectedFlight.callsign}`:`PROTECT ${protectedAsset?.name??protectedAsset?.kind.toUpperCase()??'MAP POINT'}`} · VISIBLE AREA · BREAK AT EDGE`:active.mission==='forward-patrol'?'HUNT IN ROUTE CORRIDOR · BREAK AT EDGE':active.role==='fighter'?'INTERCEPTS CONTACTS INSIDE RESPONSIBILITY':'SEARCH CONTINUES UNTIL RTB IS ORDERED'}</span></div><div><small>FORMATION</small><b>{frame.aircraft} / {active.maxAircraft} AIRCRAFT</b><span>{Math.round(frame.strength)}% STRENGTH · {Math.round(frame.morale)} MORALE</span></div><div><small>ROUTE</small><b>{frame.traveledDistance.toFixed(1)} RANGE FLOWN</b><span>{missionLabel}</span></div></div><div className="activity-key" aria-label="Tactical glyph key"><span>〉 CLOSE</span><span>⊗ ENGAGED</span><span>△ CHASE</span><span>◇ RETURN</span></div></div>:null}
    {view==='roster'?<div className="execution-roster"><header><span><List/> ALL FORMATIONS</span><button onClick={()=>setView('closed')}>CLOSE</button></header><div>{groups.map(group=><section key={group.base.id} className="formation-base-group"><div className="formation-base-heading"><b>{airfieldLabel(group.base)}</b><span>{group.formationIds.length} BASED</span></div>{group.formationIds.map(id=>{const item=squadronById.get(id);if(!item)return null;const itemFrame=frameFor(item,result,progress);return <button key={id} className={`observe-roster-row ${id===active.id?'active':''}`} onClick={()=>{onSelect(id);setView('closed')}}><span>{item.role==='fighter'?<Crosshair/>:<Eye/>}</span><b>{item.callsign}</b><small>{modeLabel(itemFrame.mode)} · {itemFrame.aircraft} AIRCRAFT</small><ChevronRight/></button>})}</section>)}</div></div>:null}
    <div className="execution-shelf-main"><button className="execution-identity" aria-expanded={view==='details'} onClick={()=>setView(current=>current==='details'?'closed':'details')}><span>{active.role==='fighter'?<Crosshair/>:<Eye/>}</span><b>{active.callsign}</b><small>{activity} · {frame.aircraft} AIRCRAFT · DETAILS</small>{view==='details'?<ChevronDown className="execution-disclosure"/>:<ChevronUp className="execution-disclosure"/>}</button><button className={`execution-roster-toggle ${view==='roster'?'active':''}`} onClick={()=>setView(current=>current==='roster'?'closed':'roster')}><List/> ALL {squadrons.length}</button>{active.role==='recon'&&!['recovering','recovered','destroyed','trapped'].includes(frame.mode??'')?<button className="execution-action rtb" onClick={()=>onRtb(active.id)} title="Return to the home base if range permits; otherwise recover at the planned field">ORDER RTB</button>:followId?<button className="execution-action" onClick={onClearFollow}>CLEAR FOLLOW</button>:<button className="execution-action" onClick={onAirfield}><LocateFixed/> AIRFIELD</button>}</div>
  </section>
}
