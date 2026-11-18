import { useRef, useState, type PointerEvent } from 'react'
import { PhaseHelp } from './PhaseHelp'
import { AlertTriangle, Bomb as BombIcon, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crosshair, Eye, List, LocateFixed, Map, RotateCcw, Shield, Sword } from 'lucide-react'
import { MAX_RECOVERY_WAYPOINTS, type RouteBudget } from '../game/forwardBasing'
import { formationStatus, recoveryReasonLabel } from '../game/formationStatus'
import { contactTracksAt } from '../game/contactTracks'
import { airfieldLabel, formationBaseGroups } from '../game/formationBasing'
import { viablePlanningFormationIds } from '../game/planningQueue'
import { projectFriendlyUnitAt } from '../game/executionProjection'
import { templateFor, templatesForRole } from '../game/routeTemplates'
import {DEBUG_SCENARIOS,DEBUG_SCENARIO_LABELS} from '../game/scenarios'
import { CAMPAIGN_ROUND_LIMIT } from '../game/campaign'
import type { Asset, CombatEvent, DebugScenario, MissionId, Phase, Point, ReconPosture, RoundResult, Squadron } from '../game/types'

const ROLE_ICONS={fighter:Crosshair,recon:Eye,bomber:BombIcon}

export function ContactTracks({result,seconds,home,onFocus}:{result?:RoundResult;seconds:number;home:Point;onFocus:(point:Point)=>void}){
  const tracks=contactTracksAt(result,seconds,home)
  if(!tracks.length)return null
  const visual=tracks.filter(track=>track.visibility==='visual').length,radar=tracks.filter(track=>track.visibility==='radar').length
  return <details name="map-tools" className="contact-tracks" aria-label="Enemy contact tracks">
    <summary>Tracks {visual+radar}</summary>
    <div>{tracks.map(track=><button key={track.unitId} className={track.visibility} onClick={()=>onFocus(track.position)} aria-label={`Locate ${track.trackId}, ${track.identification}, ${track.visibility==='lost'?'last known position':track.visibility}`}>
      <b>{track.trackId} · {track.identification}</b>
      <span>{track.callsign?`${track.callsign} · `:''}{track.visibility==='lost'?`CONTACT LOST · LAST SEEN ${Math.max(0,seconds-track.lastSeen).toFixed(1)}s AGO`:`${track.visibility.toUpperCase()} · ${track.course}${track.aircraft===undefined?'':` · ${track.aircraft} AIRCRAFT`}`}</span>
    </button>)}</div>
  </details>
}

export function TopBar({ round, phase, debugScenario, onDebugScenario, onReboot, onMenu, onlineStatus }: {
  round: number
  phase: Phase
  debugScenario: DebugScenario
  onDebugScenario: (scenario: DebugScenario) => void
  onReboot: () => void
  onMenu: () => void
  onlineStatus?: string
}) {
  const phaseName = phase === 'adapt' ? 'Resupply' : phase[0].toUpperCase() + phase.slice(1)
  return <header className="topbar match-header">
    <button type="button" className="menu-button" onClick={onMenu}>{onlineStatus ? 'Exit match' : 'Menu'}</button>
    <div className="match-round"><span>Round {round}/{CAMPAIGN_ROUND_LIMIT}</span><strong>{phaseName}</strong></div>
    <div className="match-header-actions">
      {onlineStatus ? <span className="match-connection" role="status">{onlineStatus}</span> : <details className="dev-menu">
        <summary>Dev <ChevronDown/></summary>
        <div><select value={debugScenario} onChange={event => onDebugScenario(event.target.value as DebugScenario)} aria-label="Debug scenario">
          {DEBUG_SCENARIOS.map(scenario => <option key={scenario} value={scenario}>{DEBUG_SCENARIO_LABELS[scenario]}</option>)}
        </select><button className="reboot" onClick={onReboot}><RotateCcw/> Reboot</button></div>
      </details>}
      <PhaseHelp phase={phase} online={Boolean(onlineStatus)}/>
    </div>
  </header>
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

function PlanningFuel({budget,needsLanding}:{budget:RouteBudget;needsLanding:boolean}){
  const {ingressDistance,patternDistance,recoveryReserve,missionDistance,remainingRange,maxDistance,intendedField}=budget
  const legs=[{label:'Outbound',value:ingressDistance,kind:'outbound'},{label:'On station',value:patternDistance,kind:'pattern'},
    {label:'Return',value:recoveryReserve,kind:'return'}]
  return <div className="planning-fuel" aria-label="Fuel budget">
    <div className="planning-fuel-header"><b>{remainingRange.toFixed(1)} fuel range left</b><span>{missionDistance.toFixed(1)} / {maxDistance} used</span></div>
    <div className="planning-fuel-meter" role="meter" aria-label="Fuel range used" aria-valuemin={0} aria-valuemax={maxDistance} aria-valuenow={Math.min(maxDistance,missionDistance)}>
      {legs.map(leg=><span key={leg.kind} className={leg.kind} style={{width:`${Math.min(100,leg.value/maxDistance*100)}%`}}/>)}
    </div>
    <div className="planning-fuel-legs">{legs.map(leg=><span key={leg.kind} className={leg.kind}>{leg.label} <b>{leg.value.toFixed(1)}</b></span>)}</div>
    <small>{needsLanding?'Landing field not selected':`Landing at ${airfieldLabel(intendedField)}`}</small>
  </div>
}

export function CommandShelf({squadrons,bases,activeBaseId,rosterMode,squadron,routeNotice,routeBudget,protectSummary,editingReturn=false,onRouteLegChange,onSelect,onBaseSelect,onRosterMode,onMission,onPickProtectTarget,onProtectFlight,onRecoverHome,onReconPosture,onClear,onBack,onCommit,step,onClose,reviewedIds,reviewedCount,totalCount,groundTargets=[],onChangeGroundTarget,onInspectGroundTarget,strikeUnlocked=false,strikeDisabledReason='RECOVER BASE INTELLIGENCE TO UNLOCK',selectingProtectTarget=false,allowEmptyCommit=false,onlineLock=false,cpuPlanning=false,onSelectBombTargets}:{squadrons:Squadron[];bases:Asset[];activeBaseId:string;rosterMode:PlanningRosterMode;squadron:Squadron;routeNotice?:string;routeBudget?:RouteBudget;protectSummary?:string;editingReturn?:boolean;onRouteLegChange?:(editingReturn:boolean)=>void;onSelect:(id:string)=>void;onBaseSelect:(id:string)=>void;onRosterMode:(mode:PlanningRosterMode)=>void;onMission:(mission:MissionId)=>void;onPickProtectTarget?:()=>void;onProtectFlight?:(id:string)=>void;onRecoverHome?:()=>void;onReconPosture?:(posture:ReconPosture)=>void;onClear:()=>void;onBack?:()=>void;onCommit:()=>void;step:PlanningStep;onClose:()=>void;reviewedIds:Set<string>;reviewedCount:number;totalCount:number;campaign?:boolean;groundTargets?:Asset[];onChangeGroundTarget?:()=>void;onInspectGroundTarget?:(id:string)=>void;strikeUnlocked?:boolean;strikeDisabledReason?:string;selectingProtectTarget?:boolean;allowEmptyCommit?:boolean;onlineLock?:boolean;cpuPlanning?:boolean;onSelectBombTargets?:()=>void}){
  const force=formationStatus(squadron)
  const swipeStart=useRef<{id:number;x:number;y:number;dragging:boolean}|undefined>(undefined)
  const suppressSwipeClick=useRef(false)
  const ready=reviewedCount>0
  const expanded=step!=='idle'
  const selectedGroundTarget=groundTargets.find(asset=>asset.id===squadron.strikeTargetId)
  const bombingTargetCount=squadron.bombingTargets?.length??0
  const groups=formationBaseGroups(squadrons,bases)
  const activeGroup=groups.find(group=>group.base.id===activeBaseId)??groups[0]
  const activeBase=activeGroup?.base
  const forwardBased=groups.some(group=>group.base.kind==='fob'&&group.formationIds.includes(squadron.id))
  const squadronById=new globalThis.Map(squadrons.map(item=>[item.id,item]))
  const openOrders=(id:string)=>onSelect(id)
  const primaryLabel=cpuPlanning?'CPU ORDERS…':onlineLock?'Lock orders':'Commit round'
  const primaryDisabled=(!ready&&!allowEmptyCommit)||cpuPlanning
  const primaryAction=ready||allowEmptyCommit?onCommit:undefined
  const aircraftIds=viablePlanningFormationIds(squadrons)
  const aircraftIndex=aircraftIds.indexOf(squadron.id)
  const cycleAircraft=(direction:number)=>{if(aircraftIds.length<2||aircraftIndex<0)return;onSelect(aircraftIds[(aircraftIndex+direction+aircraftIds.length)%aircraftIds.length])}
  const handlePointerDown=(event:PointerEvent<HTMLDivElement>)=>{
    suppressSwipeClick.current=false
    if(!event.isPrimary||event.button!==0||(event.target as HTMLElement).closest('select,input,textarea')){swipeStart.current=undefined;return}
    swipeStart.current={id:event.pointerId,x:event.clientX,y:event.clientY,dragging:false}
  }
  const handlePointerMove=(event:PointerEvent<HTMLDivElement>)=>{
    const start=swipeStart.current
    if(!start||start.id!==event.pointerId)return
    const dx=event.clientX-start.x,dy=event.clientY-start.y
    if(!start.dragging&&Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.2){start.dragging=true;event.currentTarget.setPointerCapture(event.pointerId)}
  }
  const handlePointerUp=(event:PointerEvent<HTMLDivElement>)=>{
    const start=swipeStart.current
    swipeStart.current=undefined
    if(!start||start.id!==event.pointerId)return
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
    const dx=event.clientX-start.x,dy=event.clientY-start.y
    suppressSwipeClick.current=start.dragging
    if(start.dragging&&Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.2)cycleAircraft(dx<0?1:-1)
  }
  const routeHelp=selectingProtectTarget?'Tap a site or map point to defend.'
    :editingReturn?'Tap the map for return waypoints. Tap an airfield to land there.'
    :squadron.mission==='transit'?'Tap a friendly airfield to end Transit there.'
    :squadron.mission==='base-strike'?'Tap to add waypoints. Drag S to move the release point.'
    :squadron.mission==='bomb'?'Drag B markers to adjust release points. Add route waypoints after the final target.'
    :squadron.mission==='defensive-cap'?(protectSummary??'Tap a site or map point to defend.')
    :'Tap to add waypoints. Drag a point to move it.'
  const transitEnd=squadron.mission==='transit'&&squadron.plannedRecoveryFieldId
  const waypointCount=editingReturn?squadron.recoveryWaypoints?.length??0
    : Math.max(0,squadron.routeIngress.length-(squadron.mission==='base-strike'||transitEnd?2:1)-(squadron.mission==='bomb'?(squadron.bombingTargets?.length??0):0))
  const waypointSummary=`${waypointCount} / ${MAX_RECOVERY_WAYPOINTS} ${editingReturn?'return':'outbound'} waypoints`
  const commitButton=step==='idle'&&(ready||allowEmptyCommit)
    ?<button type="button" className="shelf-primary" disabled={primaryDisabled} onClick={primaryAction}>{primaryLabel} <ChevronRight/></button>
    :null
  return <section className={`command-shelf ${expanded?'expanded':''}`} aria-label="Planning command shelf">
    {expanded?<div className={`command-sheet ${step}-step`} role="region" aria-roledescription="carousel" aria-label="Aircraft orders" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={()=>{swipeStart.current=undefined}} onClickCapture={event=>{if(suppressSwipeClick.current){event.preventDefault();event.stopPropagation();suppressSwipeClick.current=false}}}>
      <nav className="planning-aircraft-nav" aria-label="Aircraft navigation">
        <button type="button" className="planning-aircraft-arrow" aria-label="Previous aircraft" disabled={aircraftIds.length<2} onClick={()=>cycleAircraft(-1)}><ChevronLeft/></button>
        <div className="planning-aircraft-identity" aria-live="polite"><b>{squadron.callsign}</b><small>{cpuPlanning?'CPU PREPARING ORDERS…':`${squadron.role.toUpperCase()} · ${aircraftIndex+1} / ${aircraftIds.length}`}</small></div>
        <button type="button" className="planning-aircraft-arrow" aria-label="Next aircraft" disabled={aircraftIds.length<2} onClick={()=>cycleAircraft(1)}><ChevronRight/></button>
        <button type="button" className="planning-pane-close" onClick={onClose}>{step==='target'&&squadron.mission==='bomb'&&bombingTargetCount?'Edit route':'Done'}</button>
      </nav>
      <div className="planning-pane-content">
        <div className="planning-pane-caption">
          <h2 className="planning-title">{step==='route' ? (squadron.role==='recon' ? 'Search Area route' : 'Build route') : step==='target' ? 'Choose target' : 'Choose task'}</h2>
          {step!=='mission'?<p className="planning-help">{step==='target'?squadron.mission==='bomb'?'Tap confirmed enemy sites in flight order. Up to three payloads.':'Tap a confirmed enemy site on the map.':routeHelp}</p>:null}
        </div>
        {step==='route'&&onRouteLegChange?<div className="planning-route-legs" role="group" aria-label="Route leg">
          <button type="button" aria-pressed={!editingReturn} onClick={()=>onRouteLegChange(false)}>Outbound</button>
          <button type="button" aria-pressed={editingReturn} onClick={()=>onRouteLegChange(true)}>Return</button>
        </div>:null}
        {step==='route'?<>
          {routeBudget?<PlanningFuel budget={routeBudget} needsLanding={squadron.mission==='transit'&&!transitEnd}/>:null}
          <p className="shelf-range">{waypointSummary}</p>
          {routeNotice?<p className="planning-route-notice" role="status">{routeNotice}</p>:null}
        </>:routeNotice?<p className="planning-route-notice" role="status">{routeNotice}</p>:null}
        {step==='route'&&!editingReturn&&squadron.mission==='defensive-cap'?<div className="planning-protect-target">
          <button onClick={onPickProtectTarget}>DEFEND AREA</button>
          <select aria-label="Escort flight" value="" onChange={event=>{if(event.target.value)onProtectFlight?.(event.target.value)}}>
            <option value="" disabled>ESCORT FLIGHT</option>
            {squadrons.filter(item=>item.id!==squadron.id&&reviewedIds.has(item.id)&&item.aircraft>0).map(item=><option key={item.id} value={item.id}>{item.callsign}</option>)}
            {!squadrons.some(item=>item.id!==squadron.id&&reviewedIds.has(item.id)&&item.aircraft>0)?<option disabled>Confirm another flight first</option>:null}
          </select>
        </div>:null}
        {step==='route'&&selectedGroundTarget ? <div className="strike-target-summary">
          <span>{selectedGroundTarget.name ?? selectedGroundTarget.kind.toUpperCase()}</span>
          <button type="button" onClick={onChangeGroundTarget}>Change</button>
          <button type="button" onClick={()=>onInspectGroundTarget?.(selectedGroundTarget.id)}>Inspect</button>
        </div> : null}
        {step==='route'&&squadron.mission==='bomb'?<div className="bomb-target-summary"><span>{bombingTargetCount} / 3 TARGETS SELECTED</span><button type="button" onClick={onSelectBombTargets}>SELECT TARGETS</button></div>:null}
        {step==='route'&&!editingReturn&&squadron.role==='recon'?<div className="recon-posture" role="group" aria-label="Recon RTB condition"><span>RTB CONDITION</span><div>{(['aggressive','conservative'] as const).map(posture=><button key={posture} type="button" className={(squadron.reconPosture??'aggressive')===posture?'active':''} aria-pressed={(squadron.reconPosture??'aggressive')===posture} onClick={()=>onReconPosture?.(posture)}>{posture.toUpperCase()}</button>)}</div><small>{(squadron.reconPosture??'aggressive')==='conservative'?'RETURN ON FIGHTER CONTACT OR SAM/AAA LAUNCH':'FOLLOW THE PLANNED ROUTE THROUGH THREATS'}</small></div>:null}
        {step==='mission'?<div className="shelf-route">{templatesForRole(squadron.role).filter(template=>template.id!=='base-strike').map(template=>{const MissionIcon=template.id==='defensive-cap'?Shield:template.id==='forward-patrol'?Sword:template.id==='bomb'?BombIcon:template.id==='search-area'?Eye:Map;return <button key={template.id} className={squadron.mission===template.id?'active':''} aria-label={template.label} aria-pressed={squadron.mission===template.id} onClick={()=>onMission(template.id)}><MissionIcon/><b>{template.shortLabel}</b></button>})}{squadron.role==='fighter'?<button className={squadron.mission==='base-strike'?'active':''} aria-label="Ground Strike" aria-pressed={squadron.mission==='base-strike'} disabled={!strikeUnlocked} title={!strikeUnlocked?strikeDisabledReason:'Choose a confirmed enemy ground target.'} onClick={()=>onMission('base-strike')}><Crosshair/><b>GROUND STRIKE</b></button>:null}</div>:null}
      </div>
      {step==='mission'?<p className="mission-effect">{squadron.mission==='forward-patrol'?'Pursue contacts near the route.':squadron.mission==='base-strike'?'Choose a confirmed ground target.':squadron.mission==='bomb'?'Select up to three confirmed sites in flight order.':squadron.mission==='transit'?'Fly to a friendly airfield.':squadron.role==='recon'?'Plot waypoints to map terrain and observe enemy sites.':'Defend a site, point, or flight.'}</p>:<div className="planning-route-actions">
        {onBack?<button onClick={onBack}>CHANGE TASK</button>:<span/>}
        {step==='route'&&!editingReturn&&forwardBased&&onRecoverHome?<button onClick={onRecoverHome}>RECOVER HOME</button>:<span/>}
        {step==='route'?<button onClick={onClear}>{editingReturn?'CLEAR RETURN':squadron.mission==='base-strike'?'CLEAR WAYPOINTS':'CLEAR ROUTE'}</button>:<span/>}
      </div>}
      {step!=='route'?<p className="shelf-range">{reviewedCount} / {totalCount} ORDERS READY</p>:null}
    </div>:null}
    {!expanded&&rosterMode!=='closed'?<div className="planning-roster" aria-label={rosterMode==='all'?'All formations':'Airfield formations'}>
      <header><button className="planning-base-title" onClick={()=>activeBase&&onBaseSelect(activeBase.id)}><LocateFixed/><span><b>{activeBase?airfieldLabel(activeBase):'AIRFIELD'}</b><small>{activeGroup?.formationIds.length??0} FORMATIONS</small></span></button><button className={rosterMode==='all'?'active':''} onClick={()=>onRosterMode(rosterMode==='all'?'base':'all')}><List/> ALL {squadrons.length}</button><button aria-label="Close formation roster" onClick={()=>onRosterMode('closed')}><ChevronDown/></button></header>
      <div className="planning-roster-scroll">{(rosterMode==='all'?groups:activeGroup?[activeGroup]:[]).map(group=><section key={group.base.id} className="formation-base-group"><div className="formation-base-heading"><b>{airfieldLabel(group.base)}</b><button className={group.base.id===activeBaseId?'active':''} onClick={()=>onBaseSelect(group.base.id)}>{group.formationIds.length} BASED</button></div>{group.formationIds.length?group.formationIds.map(id=>{const item=squadronById.get(id);return item?<FormationRosterRow key={id} squadron={item} active={id===squadron.id} reviewed={reviewedIds.has(id)} onSelect={()=>openOrders(id)} onEdit={()=>openOrders(id)}/>:null}):<p className="formation-base-empty">NO FORMATIONS BASED HERE</p>}</section>)}</div>
    </div>:null}
    {!expanded ? <div className={`planning-capsule ${commitButton?'has-commit':''} ${onlineLock&&commitButton?'online-commit-first':''}`}>
      {onlineLock?commitButton:null}
      <button className="planning-base-toggle" aria-expanded={expanded} onClick={()=>activeBase&&onBaseSelect(activeBase.id)}><LocateFixed/><span><b>{activeBase?airfieldLabel(activeBase):'AIRFIELD'}</b><small aria-live={cpuPlanning?'polite':undefined}>{cpuPlanning?'CPU PREPARING ORDERS…':protectSummary&&reviewedIds.has(squadron.id) ? protectSummary : reviewedCount ? `${reviewedCount}/${totalCount} orders ready` : aircraftIds.length ? 'Select an aircraft' : 'No aircraft available'}</small></span><ChevronUp/></button>
      <button className={`planning-all-toggle ${rosterMode!=='closed'?'active':''}`} onClick={()=>{if(expanded)onClose();onRosterMode(rosterMode==='closed'?'all':'closed')}}><List/><span>ALL</span></button>
      {!onlineLock?commitButton:null}
    </div> : null}
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

export function FormationDock({squadrons,bases,result,progress,selectedId,followId,onSelect,onClearFollow,onAirfield}:{squadrons:Squadron[];bases:Asset[];result?:RoundResult;progress:number;selectedId:string;followId?:string;onSelect:(id:string)=>void;onClearFollow:()=>void;onAirfield:()=>void}){
  const [view,setView]=useState<'closed'|'details'|'roster'>('closed')
  const active=squadrons.find(s=>s.id===selectedId)??squadrons[0]
  if(!active)return null
  const ActiveRoleIcon=ROLE_ICONS[active.role]
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
    {view==='details'?<div className="execution-detail"><div className="execution-detail-head"><span>FORMATION STATUS</span><b>{active.callsign}</b></div><div className="execution-detail-grid"><div><small>ACTIVITY</small><b>{activity}</b><span>{targetContext}</span></div><div><small>MISSION</small><b>{missionLabel}</b><span>{active.mission==='base-strike'?'ATTACK SELECTED GROUND TARGET · NO VOLUNTARY INTERCEPTS':active.mission==='bomb'?`BOMBING ${active.bombingTargets?.length??0} TARGETS · NO VOLUNTARY INTERCEPTS`:active.mission==='transit'?'FLY TO AIRFIELD · NO VOLUNTARY INTERCEPTS':active.mission==='defensive-cap'?`${protectedFlight?`ESCORT ${protectedFlight.callsign}`:`PROTECT ${protectedAsset?.name??protectedAsset?.kind.toUpperCase()??'MAP POINT'}`} · VISIBLE AREA · BREAK AT EDGE`:active.mission==='forward-patrol'?'HUNT IN ROUTE CORRIDOR · BREAK AT EDGE':active.role==='fighter'?'INTERCEPTS CONTACTS INSIDE RESPONSIBILITY':active.role==='recon'?`SEARCH · ${(active.reconPosture??'aggressive').toUpperCase()} RTB CONDITION`:'TRANSIT OR BOMBING FORMATION'}</span></div><div><small>FORMATION</small><b>{frame.aircraft} / {active.maxAircraft} AIRCRAFT</b><span>{Math.round(frame.strength)}% STRENGTH · {Math.round(frame.morale)} MORALE</span></div><div><small>ROUTE</small><b>{frame.traveledDistance.toFixed(1)} RANGE FLOWN</b><span>{missionLabel}</span></div></div><div className="activity-key" aria-label="Tactical glyph key"><span>〉 CLOSE</span><span>⊗ ENGAGED</span><span>△ CHASE</span><span>◇ RETURN</span></div></div>:null}
    {view==='roster'?<div className="execution-roster"><header><span><List/> ALL FORMATIONS</span><button onClick={()=>setView('closed')}>CLOSE</button></header><div>{groups.map(group=><section key={group.base.id} className="formation-base-group"><div className="formation-base-heading"><b>{airfieldLabel(group.base)}</b><span>{group.formationIds.length} BASED</span></div>{group.formationIds.map(id=>{const item=squadronById.get(id);if(!item)return null;const itemFrame=frameFor(item,result,progress),RoleIcon=ROLE_ICONS[item.role];return <button key={id} className={`observe-roster-row ${id===active.id?'active':''}`} onClick={()=>{onSelect(id);setView('closed')}}><span><RoleIcon/></span><b>{item.callsign}</b><small>{modeLabel(itemFrame.mode)} · {itemFrame.aircraft} AIRCRAFT</small><ChevronRight/></button>})}</section>)}</div></div>:null}
    <div className="execution-shelf-main"><button className="execution-identity" aria-expanded={view==='details'} onClick={()=>setView(current=>current==='details'?'closed':'details')}><span><ActiveRoleIcon/></span><b>{active.callsign}</b><small>{activity} · {frame.aircraft} AIRCRAFT · DETAILS</small>{view==='details'?<ChevronDown className="execution-disclosure"/>:<ChevronUp className="execution-disclosure"/>}</button><button className={`execution-roster-toggle ${view==='roster'?'active':''}`} onClick={()=>setView(current=>current==='roster'?'closed':'roster')}><List/> ALL {squadrons.length}</button>{followId?<button className="execution-action" onClick={onClearFollow}>CLEAR FOLLOW</button>:<button className="execution-action" onClick={onAirfield}><LocateFixed/> AIRFIELD</button>}</div>
  </section>
}
