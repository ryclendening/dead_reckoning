import { Crosshair, Eye, Gauge, Map, Radar, Shield, Wrench, Zap } from 'lucide-react'
import type { Aggression, Mission, Risk, Squadron } from '../game/types'

const ROLE_ICONS={interceptor:Shield,fighter:Crosshair,strike:Zap,recon:Eye}
export function TopBar({round,intel,logistics,replacements,phase}:{round:number,intel:number,logistics:number,replacements:number,phase:string}){
  return <header className="topbar"><div className="brand"><b>DEAD RECKONING</b><small>AIR COMMAND</small></div><div className="round"><small>ROUND {String(round).padStart(2,'0')}</small><strong>{phase==='execute'?'OBSERVE':phase==='debrief'?'AFTER ACTION':phase==='deploy'?'DEPLOY':phase.toUpperCase()}</strong></div><div className="resources"><span><Radar/> {intel}</span><span><Wrench/> {logistics}</span><span><Zap/> {replacements}</span></div></header>
}

export function SquadronRail({squadrons,selectedId,onSelect}:{squadrons:Squadron[];selectedId:string;onSelect:(id:string)=>void}){
  return <div className="squadron-rail">{squadrons.map((s,i)=>{const Icon=ROLE_ICONS[s.role];return <button key={s.id} className={s.id===selectedId?'active':''} onClick={()=>onSelect(s.id)}><span className="sq-number">0{i+1}</span><Icon/><span className="sq-name">{s.callsign.split(' ')[0]}</span><span className="readiness"><i style={{width:`${s.readiness}%`}}/></span></button>})}</div>
}

const missions:Record<Squadron['role'],Mission[]>={interceptor:['CAP','ESCORT'],fighter:['ESCORT','CAP'],strike:['STRIKE','ESCORT'],recon:['RECON']}
export function OrdersPanel({squadron,onChange,onPreset,onClear,onCommit}:{squadron:Squadron;onChange:(patch:Partial<Squadron>)=>void;onPreset:(name:string)=>void;onClear:()=>void;onCommit:()=>void}){
  const Icon=ROLE_ICONS[squadron.role]
  const doctrineSummary=squadron.mission==='CAP'
    ? squadron.aggression==='aggressive'?'EXTENDED PURSUIT · COVERAGE GAP + ATTRITION RISK':squadron.aggression==='cautious'?'SHADOWS CONTACTS · CUES DEFENSE NETWORK':'LOCAL INTERCEPT · LIMITED DEFENSE CUEING'
    : squadron.mission==='ESCORT'&&squadron.aggression==='aggressive'?'MAY PEEL OFF · REJOINS STRIKE PACKAGE':squadron.risk==='press'?'CROSSES THREAT RINGS · ACCEPTS ATTRITION':squadron.risk==='preserve'?'ABORTS AT FIRST CONFIRMED THREAT':'FOLLOWS ROUTE · STANDARD ABORT THRESHOLD'
  return <section className="orders"><div className="orders-head"><div className="role-mark"><Icon/></div><div><h2>{squadron.callsign}</h2><p>{squadron.role.toUpperCase()} · {squadron.aircraft}/{squadron.maxAircraft} AIRCRAFT</p></div><div className="stat"><strong>{squadron.readiness}%</strong><small>READY</small></div></div>
    <div className="doctrine"><label>MISSION<select value={squadron.mission} onChange={e=>onChange({mission:e.target.value as Mission})}>{missions[squadron.role].map(x=><option key={x}>{x}</option>)}</select></label><label>AGGRESSION<select value={squadron.aggression} onChange={e=>onChange({aggression:e.target.value as Aggression})}><option value="cautious">CAUTIOUS</option><option value="balanced">BALANCED</option><option value="aggressive">AGGRESSIVE</option></select></label><label>RISK<select value={squadron.risk} onChange={e=>onChange({risk:e.target.value as Risk})}><option value="preserve">PRESERVE</option><option value="normal">NORMAL</option><option value="press">PRESS ATTACK</option></select></label></div>
    <div className="doctrine-readout"><Gauge/> {doctrineSummary}</div><div className="route-row"><span><Map/> TAP / DRAG MAP</span>{['River run','Northern gap','Deep probe'].map(p=><button key={p} onClick={()=>onPreset(p)}>{p}</button>)}<button onClick={onClear}>CLEAR</button></div>
    <button className="commit" disabled={squadron.route.length<2} onClick={onCommit}>COMMIT ORDERS <span>››</span></button>
  </section>
}

export function PhaseRail({phase}:{phase:string}){const labels=phase==='deploy'?['DEPLOY','PLACE','SCREEN','DECEIVE','LOCK']:['PLAN','COMMIT','OBSERVE','LEARN','ADAPT'];const index=phase==='deploy'?0:phase==='plan'?0:phase==='execute'?2:phase==='debrief'?3:4;return <aside className="phase-rail">{labels.map((x,i)=><div key={x} className={i===index?'active':i<index?'done':''}><b>0{i+1}</b><span>{x}</span></div>)}</aside>}

export function HealthBars({player,enemy,enemyKnown}:{player:number;enemy:number;enemyKnown:boolean}){return <div className="health-bars"><div><span>HOME BASE</span><i><b style={{width:`${player}%`}}/></i><em>{player}%</em></div><div><span>{enemyKnown?'ENEMY BASE':'ENEMY NETWORK'}</span><i><b className={enemyKnown?'enemy':'unknown'} style={{width:enemyKnown?`${enemy}%`:'100%'}}/></i><em>{enemyKnown?`${enemy}%`:'--'}</em></div></div>}
