import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Crosshair, Eye, LocateFixed, Map, Radar, RotateCcw, Trophy, Wrench, Zap } from 'lucide-react'
import { formationStatus } from '../game/formationStatus'
import { templatesForRole } from '../game/routeTemplates'
import type { Aggression, CombatEvent, DebugScenario, RoundResult, RouteTemplateId, Squadron } from '../game/types'

const ROLE_ICONS={fighter:Crosshair,recon:Eye}
export function TopBar({round,intel,logistics,replacements,score,phase,debugScenario,onDebugScenario,onReboot}:{round:number;intel:number;logistics:number;replacements:number;score:number;phase:string;debugScenario:DebugScenario;onDebugScenario:(scenario:DebugScenario)=>void;onReboot:()=>void}){
  const scenarios:DebugScenario[]=['campaign','fighter-duel','fighter-recon','neutral-los','radar-intercept','recon-recovery','recon-loss']
  const labels:Record<DebugScenario,string>={campaign:'CAMPAIGN', 'fighter-duel':'FIGHTER VS FIGHTER', 'fighter-recon':'FIGHTER VS RECON', 'neutral-los':'NEUTRAL VISUAL', 'radar-intercept':'RADAR INTERCEPT', 'recon-recovery':'RECON RECOVERY', 'recon-loss':'RECON LOSS'}
  return <header className="topbar"><div className="brand"><b>DEAD RECKONING</b><small>AIR COMMAND</small></div><div className="round"><small>ROUND {String(round).padStart(2,'0')}</small><strong>{phase==='execute'?'OBSERVE':phase==='debrief'?'AFTER ACTION':phase.toUpperCase()}</strong></div><div className="resources"><span title="Known enemy assets"><Radar/> {intel}</span><span title="Logistics"><Wrench/> {logistics}</span><span title="Reserve aircraft"><Zap/> {replacements}</span><span title="Campaign score"><Trophy/> {score}</span></div><details className="dev-menu"><summary>DEV <ChevronDown/></summary><div><select value={debugScenario} onChange={e=>onDebugScenario(e.target.value as DebugScenario)} title="Deterministic debug scenario">{scenarios.map(s=><option key={s} value={s}>{labels[s]}</option>)}</select><button className="reboot" onClick={onReboot} title="Clear saved campaign and return to deployment"><RotateCcw/> REBOOT</button></div></details></header>
}

export function CommandShelf({squadrons,squadron,routeDistance,maxDistance,routeNotice,onSelect,onChange,onTemplate,onClear,onAdvance,onCommit,expanded,onToggle,reviewedCount,totalCount}:{squadrons:Squadron[];squadron:Squadron;routeDistance:number;maxDistance:number;routeNotice?:string;onSelect:(id:string)=>void;onChange:(patch:Partial<Squadron>)=>void;onTemplate:(template:RouteTemplateId)=>void;onClear:()=>void;onAdvance:()=>void;onCommit:()=>void;expanded:boolean;onToggle:()=>void;reviewedCount:number;totalCount:number}){
  const force=formationStatus(squadron)
  const ready=totalCount>0&&reviewedCount>=totalCount
  const templateLabel=squadron.routeTemplate==='custom'?'CUSTOM ROUTE':squadron.routeTemplate.replaceAll('-', ' ').toUpperCase()
  return <section className={`command-shelf ${expanded?'expanded':''}`} aria-label="Planning command shelf">
    {expanded?<div className="command-sheet"><div className="sheet-heading"><span>ORDERS · {squadron.callsign}</span><button onClick={onToggle}>CLOSE</button></div><div className="shelf-doctrine"><span>AGGRESSION</span>{(['conservative','neutral','aggressive'] as Aggression[]).map(value=><button key={value} className={squadron.aggression===value?'active':''} onClick={()=>onChange({aggression:value})}>{value}</button>)}</div><div className="shelf-route"><span><Map/> ROUTE</span>{templatesForRole(squadron.role).map(template=><button key={template.id} className={squadron.routeTemplate===template.id?'active':''} onClick={()=>onTemplate(template.id)}>{template.shortLabel}</button>)}<button onClick={onClear}>CLEAR</button></div><p className={`shelf-range ${routeDistance>=maxDistance-.1?'limit':''}`}>{routeNotice??`RANGE ${routeDistance.toFixed(0)} / ${maxDistance} · RETURN RESERVED`}</p></div>:null}
    <div className="shelf-inventory" aria-label="Formation inventory">{squadrons.map(item=>{const itemForce=formationStatus(item);return <button key={item.id} disabled={itemForce.destroyed} className={item.id===squadron.id?'active':''} onClick={()=>onSelect(item.id)} onDoubleClick={()=>{onSelect(item.id);onToggle()}} title="Tap to select. Double-tap for orders."><b>{item.callsign.split(' ')[0]}</b><span>{itemForce.aircraft}/{itemForce.maxAircraft}</span><i>{Array.from({length:itemForce.maxAircraft},(_,pip)=><em key={pip} className={pip<itemForce.aircraft?'live':''}/>)}</i></button>})}</div>
    <div className="shelf-main"><div className="shelf-guidance"><b>{templateLabel}</b><small>DOUBLE-TAP A FORMATION TO EDIT ORDERS</small></div><button className="shelf-primary" disabled={!ready&&(force.destroyed||squadron.route.length<2)} onClick={ready?onCommit:onAdvance}>{ready?'COMMIT':'NEXT'} <ChevronRight/></button></div>
    <div className="shelf-status"><span>{templateLabel}</span><span>{ready?'PACKAGE READY':`${reviewedCount} / ${totalCount} REVIEWED`}</span></div>
  </section>
}

function modeLabel(mode:string|undefined){return mode==='dogfighting'?'ENGAGED':mode==='intercepting'?'INTERCEPTING':mode==='recovering'||mode==='recovered'?'RETURNING':mode==='destroyed'?'DESTROYED':mode==='attacking-recon'?'PURSUING':'ON ROUTE'}
function frameFor(squadron:Squadron,result:RoundResult|undefined,progress:number){
  const track=result?.unitTracks.find(item=>item.unitId===squadron.id)
  if(!track?.frames.length)return {aircraft:squadron.aircraft,strength:squadron.strength??100,mode:squadron.status}
  const seconds=progress*(result?.duration??22)
  return track.frames.find(frame=>frame.time>=seconds)??track.frames.at(-1)!
}

export function ObserveEventFeed({events,progress,activeEvent,onFocus}:{events:CombatEvent[];progress:number;activeEvent?:CombatEvent;onFocus:(event:CombatEvent)=>void}){
  const seconds=progress*(events.at(-1)?.time??22)
  const visible=events.filter(event=>event.time<=seconds).slice(-5).reverse()
  return <div className="observe-feed" aria-label="Tactical event feed">{visible.length?visible.map(event=><button key={event.id} className={`${event.tone} ${activeEvent?.id===event.id?'active':''}`} onClick={()=>onFocus(event)}><span>{event.tone==='danger'?<AlertTriangle/>:<CheckCircle2/>}</span><span><b>{event.title}</b><small>{event.detail}</small></span><LocateFixed/></button>):<div className="observe-feed-empty">AWAITING CONTACT · SELECT A FORMATION BELOW TO FOLLOW IT</div>}</div>
}

export function FormationDock({squadrons,result,progress,selectedId,followId,onSelect,onClearFollow,onAirfield}:{squadrons:Squadron[];result?:RoundResult;progress:number;selectedId:string;followId?:string;onSelect:(id:string)=>void;onClearFollow:()=>void;onAirfield:()=>void}){
  const active=squadrons.find(s=>s.id===selectedId)??squadrons[0]
  const frame=frameFor(active,result,progress)
  const index=Math.max(0,squadrons.findIndex(s=>s.id===active.id))
  const cycle=(offset:number)=>onSelect(squadrons[(index+offset+squadrons.length)%squadrons.length].id)
  return <section className="execution-shelf" aria-label="Formation command shelf"><button aria-label="Previous formation" onClick={()=>cycle(-1)}><ChevronLeft/></button><button className="execution-identity" onClick={()=>onSelect(active.id)}><span>{active.role==='fighter'?<Crosshair/>:<Eye/>}</span><b>{active.callsign}</b><small>{modeLabel(frame.mode)} · {frame.aircraft} AIRCRAFT</small></button><button aria-label="Next formation" onClick={()=>cycle(1)}><ChevronRight/></button>{followId?<button className="execution-action" onClick={onClearFollow}>CLEAR FOLLOW</button>:<button className="execution-action" onClick={onAirfield}><LocateFixed/> AIRFIELD</button>}</section>
}

export function HealthBars({player,enemy,enemyKnown,exposure}:{player:number,enemy:number,enemyKnown:boolean,exposure:number}){return <div className="health-bars"><div><span>HOME BASE</span><i><b style={{width:`${player}%`}}/></i><em>{player}%</em></div><div><span>{enemyKnown?'ENEMY BASE':'ENEMY NETWORK'}</span><i><b className={enemyKnown?'enemy':'unknown'} style={{width:enemyKnown?`${enemy}%`:'100%'}}/></i><em>{enemyKnown?`${enemy}%`:'--'}</em></div><div className="exposure"><span>BASE EXPOSURE</span><i><b style={{width:`${exposure}%`}}/></i><em>{exposure}%</em></div></div>}
