import { Crosshair, Eye, Gauge, Map, Radar, RotateCcw, Trophy, Wrench, Zap } from 'lucide-react'
import type { Aggression, DebugScenario, Mission, Squadron } from '../game/types'

const ROLE_ICONS={fighter:Crosshair,recon:Eye}
export function TopBar({round,intel,logistics,replacements,score,phase,debugScenario,onDebugScenario,onReboot}:{round:number;intel:number;logistics:number;replacements:number;score:number;phase:string;debugScenario:DebugScenario;onDebugScenario:(scenario:DebugScenario)=>void;onReboot:()=>void}){
  const scenarios:DebugScenario[]=['campaign','fighter-duel','neutral-los','radar-intercept','recon-recovery','recon-loss']
  return <header className="topbar"><div className="brand"><b>DEAD RECKONING</b><small>AIR COMMAND</small></div><div className="round"><small>ROUND {String(round).padStart(2,'0')}</small><strong>{phase==='execute'?'OBSERVE':phase==='debrief'?'AFTER ACTION':phase==='deploy'?'DEPLOY':phase.toUpperCase()}</strong></div><div className="resources"><span title="Known enemy assets"><Radar/> {intel}</span><span title="Logistics"><Wrench/> {logistics}</span><span title="Reserve aircraft"><Zap/> {replacements}</span><span title="Campaign score"><Trophy/> {score}</span></div><div className="reboot-cluster"><select value={debugScenario} onChange={e=>onDebugScenario(e.target.value as DebugScenario)} title="Deterministic debug scenario">{scenarios.map(s=><option key={s} value={s}>{s.replaceAll('-',' ').toUpperCase()}</option>)}</select><button className="reboot" onClick={onReboot} title="Clear saved campaign and return to deployment"><RotateCcw/> REBOOT</button></div></header>
}

export function SquadronRail({squadrons,selectedId,onSelect}:{squadrons:Squadron[];selectedId:string;onSelect:(id:string)=>void}){
  return <div className="squadron-rail">{squadrons.map((s,i)=>{const Icon=ROLE_ICONS[s.role]??Crosshair;return <button key={s.id} className={s.id===selectedId?'active':''} onClick={()=>onSelect(s.id)}><span className="sq-number">0{i+1}</span><Icon/><span className="sq-name">{s.callsign.split(' ')[0]}</span><span className="readiness"><i style={{width:`${s.readiness}%`}}/></span></button>})}</div>
}

const missions:Record<Squadron['role'],Mission[]>={fighter:['CAP'],recon:['RECON']}
export function OrdersPanel({squadron,routeDistance,maxDistance,onChange,onPreset,onClear,onCommit}:{squadron:Squadron;routeDistance:number;maxDistance:number;onChange:(patch:Partial<Squadron>)=>void;onPreset:(name:string)=>void;onClear:()=>void;onCommit:()=>void}){
  const Icon=ROLE_ICONS[squadron.role]
  const doctrineSummary=squadron.mission==='CAP'
    ? squadron.aggression==='conservative'?'AVOIDS VISUAL CONTACT · RECOVERS TO BASE':squadron.aggression==='neutral'?'ENGAGES ON VISUAL CONTACT':'INTERCEPTS AND ENGAGES HOSTILE CONTACTS'
    : squadron.aggression==='conservative'?'ABORTS COLLECTION ON HOSTILE CONTACT':squadron.aggression==='neutral'?'CONTINUES THROUGH TRACKS · ABORTS ON DIRECT CONTACT':'CONTINUES COLLECTION UNDER DIRECT THREAT'
  return <section className="orders"><div className="orders-head"><div className="role-mark"><Icon/></div><div><h2>{squadron.callsign}</h2><p>{squadron.role.toUpperCase()} · {squadron.aircraft}/{squadron.maxAircraft} AIRCRAFT</p></div><div className="stat"><strong>{squadron.readiness}%</strong><small>READY</small></div></div>
    <div className="doctrine"><label>MISSION<select value={squadron.mission} onChange={e=>onChange({mission:e.target.value as Mission})}>{missions[squadron.role].map(x=><option key={x}>{x}</option>)}</select></label><label>AGGRESSION<select value={squadron.aggression} onChange={e=>onChange({aggression:e.target.value as Aggression})}><option value="conservative">CONSERVATIVE</option><option value="neutral">NEUTRAL</option><option value="aggressive">AGGRESSIVE</option></select></label></div>
    <div className="doctrine-readout"><Gauge/> {doctrineSummary}</div><div className={`fuel-readout ${routeDistance>=maxDistance-.1?'limit':''}`}><Gauge/> FUEL RANGE {routeDistance.toFixed(1)} / {maxDistance.toFixed(0)} · RETURN RESERVED</div><div className="route-row"><span><Map/> TAP / DRAG MAP</span>{['River run','Northern gap','Deep probe'].map(p=><button key={p} onClick={()=>onPreset(p)}>{p}</button>)}<button onClick={onClear}>CLEAR</button></div>
    <button className="commit" disabled={squadron.route.length<2} onClick={onCommit}>COMMIT ORDERS <span>››</span></button>
  </section>
}

export function HealthBars({player,enemy,enemyKnown,exposure}:{player:number,enemy:number,enemyKnown:boolean,exposure:number}){return <div className="health-bars"><div><span>HOME BASE</span><i><b style={{width:`${player}%`}}/></i><em>{player}%</em></div><div><span>{enemyKnown?'ENEMY BASE':'ENEMY NETWORK'}</span><i><b className={enemyKnown?'enemy':'unknown'} style={{width:enemyKnown?`${enemy}%`:'100%'}}/></i><em>{enemyKnown?`${enemy}%`:'--'}</em></div><div className="exposure"><span>BASE EXPOSURE</span><i><b style={{width:`${exposure}%`}}/></i><em>{exposure}%</em></div></div>}
