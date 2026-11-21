import { useState } from 'react'
import { PhaseHelp } from './PhaseHelp'
import { FormationChip } from './FormationChip'
import { AlertTriangle, Bomb as BombIcon, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CornerUpLeft, Crosshair, Eye, List, LocateFixed, RotateCcw, Route, Trash2, Undo2 } from 'lucide-react'
import type { RouteBudget } from '../game/forwardBasing'
import { formationStatus, recoveryReasonLabel } from '../game/formationStatus'
import { contactTracksAt } from '../game/contactTracks'
import { airfieldLabel, formationBaseGroups } from '../game/formationBasing'
import { projectFriendlyUnitAt } from '../game/executionProjection'
import { templateFor } from '../game/routeTemplates'
import {DEBUG_SCENARIOS,DEBUG_SCENARIO_LABELS} from '../game/scenarios'
import { CAMPAIGN_ROUND_LIMIT } from '../game/campaign'
import type { Asset, CombatEvent, DebugScenario, Phase, Point, ReconPosture, RoundResult, Squadron } from '../game/types'

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

export type PlanningStep = 'idle' | 'route'

export function PlanningChitRail({squadrons,bases,activeBaseId,selectedId,reviewedIds,onSelect}:{squadrons:Squadron[];bases:Asset[];activeBaseId:string;selectedId:string;reviewedIds:Set<string>;onSelect:(id:string)=>void}){
  const group=formationBaseGroups(squadrons,bases).find(item=>item.base.id===activeBaseId)
  if(!group)return null
  const squadronById=new globalThis.Map(squadrons.map(item=>[item.id,item]))
  return <aside className="planning-chits" aria-label={`${airfieldLabel(group.base)} planning queue`}>
    <header><LocateFixed/><span>{airfieldLabel(group.base)}</span></header>
    <div>{group.formationIds.map(id=>{const item=squadronById.get(id);if(!item)return null;const force=formationStatus(item);const RoleIcon=ROLE_ICONS[item.role];const planned=reviewedIds.has(id);return <button key={id} className={`${id===selectedId?'active':''} ${planned?'planned':''} ${force.destroyed?'destroyed':''}`} disabled={force.destroyed} onClick={()=>onSelect(id)} aria-label={`${item.callsign}, ${planned?'planned':'pending'}`}><RoleIcon/><b>{item.callsign}</b><small>{force.aircraft}/{force.maxAircraft}</small><i>{planned?<CheckCircle2/>:<span/>}</i></button>})}</div>
  </aside>
}

interface CommandShelfProps {
  squadrons: Squadron[]
  squadron: Squadron
  routeNotice?: string
  routeBudget?: RouteBudget
  editingReturn?: boolean
  onRouteLegChange?: (leg:'route'|'return')=>void
  onSelect: (id:string)=>void
  onProtectFlight?: (id:string)=>void
  onReconPosture?: (posture:ReconPosture)=>void
  onClear: ()=>void
  onUndoWaypoint?: ()=>void
  onCommit: ()=>void
  onClose: ()=>void
  step: PlanningStep
  reviewedIds: Set<string>
  reviewedCount: number
  totalCount: number
  groundTargets?: Asset[]
  allowEmptyCommit?: boolean
  onlineLock?: boolean
  cpuPlanning?: boolean
}

export function CommandShelf({
  squadrons,squadron,routeNotice,routeBudget,editingReturn=false,onRouteLegChange,onSelect,
  onProtectFlight,onReconPosture,onClear,onUndoWaypoint,onCommit,onClose,step,reviewedIds,
  reviewedCount,totalCount,groundTargets=[],allowEmptyCommit=false,onlineLock=false,cpuPlanning=false,
}:CommandShelfProps){
  const editing=step==='route'
  const isFighter=squadron.role==='fighter'
  const isBomber=squadron.role==='bomber'
  const hasRoute=squadron.route.length>=2
  const strikeTarget=groundTargets.find(asset=>asset.id===squadron.strikeTargetId)
  const eligibleEscorts=squadrons.filter(item=>item.id!==squadron.id&&reviewedIds.has(item.id)&&item.aircraft>0)
  const routeStatus=editingReturn?'Return'
    :isBomber?`${squadron.bombingTargets?.length??0} / 3 targets`
    :strikeTarget?`Strike · ${strikeTarget.name??strikeTarget.kind.toUpperCase()}`
    :squadron.protectRadius!==undefined?`Protect · ${squadron.protectRadius.toFixed(1)} units`
    :squadron.protectedTargetId?'Escort'
    :hasRoute?templateFor(squadron.mission).label
    :isFighter?'Tap to plot patrol':'Tap to plot recon'
  const commitButton=reviewedCount>0||allowEmptyCommit
    ?<button type="button" className="shelf-primary" disabled={cpuPlanning} onClick={onCommit}>{cpuPlanning?'CPU orders…':onlineLock?'Lock orders':'Commit round'} <ChevronRight/></button>
    :null

  return <section className="phase-panel planning-strip" aria-label="Planning command shelf">
    <nav className="planning-flights" aria-label="Aircraft">
      {squadrons.map(flight => <FormationChip key={flight.id} flight={flight} cue={reviewedIds.has(flight.id) ? 'planned' : undefined}
        disabled={flight.aircraft<=0||flight.status==='trapped'} selected={editing&&flight.id===squadron.id} onSelect={()=>onSelect(flight.id)}/>)}
    </nav>
    <div className="planning-strip-status" aria-live="polite">
      <span>{routeNotice??(editing?routeStatus:totalCount?`${reviewedCount} / ${totalCount} ready`:'No aircraft available')}</span>
      {editing&&hasRoute&&routeBudget&&!routeNotice?<b data-low={routeBudget.remainingRange<5} title="Fuel remaining after reserving recovery">{routeBudget.remainingRange.toFixed(1)} fuel left</b>:null}
    </div>
    <div className={`phase-panel-footer planning-strip-actions${onlineLock&&!editing?' online-commit-first':''}`}>
      {editing?<>
        {!isBomber?<button type="button" className="plan-icon" aria-label="Undo last waypoint" title="Undo waypoint" disabled={!onUndoWaypoint} onClick={onUndoWaypoint}><Undo2/></button>:null}
        <button type="button" className="plan-icon" aria-label={editingReturn?'Clear return':isBomber?'Clear targets':'Reset order'} title={editingReturn?'Clear return':isBomber?'Clear targets':'Reset order'} disabled={!hasRoute} onClick={onClear}><Trash2/></button>
        {onRouteLegChange?<button type="button" className="plan-icon" aria-pressed={editingReturn} aria-label={editingReturn?'Edit outbound route':'Edit return route'}
          title={editingReturn?'Outbound':'Return'} onClick={()=>onRouteLegChange(editingReturn?'route':'return')}>{editingReturn?<Route/>:<CornerUpLeft/>}</button>:null}
        {isFighter&&!editingReturn?<select className="planning-escort" aria-label="Escort flight" value={squadron.protectedTargetId??''} onChange={event=>onProtectFlight?.(event.target.value)}>
          <option value="" disabled>Escort</option>
          {eligibleEscorts.map(flight=><option key={flight.id} value={flight.id}>{flight.callsign}</option>)}
          {!eligibleEscorts.length?<option disabled>Confirm another flight first</option>:null}
        </select>:null}
        {squadron.role==='recon'&&!editingReturn?<div className="planning-posture" role="group" aria-label="Recon posture">
          <button type="button" aria-pressed={squadron.reconPosture!=='conservative'} onClick={()=>onReconPosture?.('aggressive')}>Aggressive</button>
          <button type="button" aria-pressed={squadron.reconPosture==='conservative'} onClick={()=>onReconPosture?.('conservative')}>Passive</button>
        </div>:null}
        <button type="button" className="phase-primary planning-done" onClick={onClose}><Check/>Done</button>
      </>:commitButton}
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
