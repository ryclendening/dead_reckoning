import type { CSSProperties } from 'react'
import type { UnitCardData } from '../game/unitCards'

export interface CompactUnitCardProps {
  data:UnitCardData
  color:string
  selected?:boolean
  actionLabel?:string
  onSelect?:()=>void
}

/** Fixed-pixel text keeps phone labels legible when the tactical map is zoomed out. */
export function CompactUnitCard({data,color,selected=false,actionLabel,onSelect}:CompactUnitCardProps){
  const title=data.compact?.title??data.title
  const stat=actionLabel?(actionLabel==='STRIKE TARGET ASSIGNED'?'✓':'STRIKE'):data.compact?.stat
  const health=Math.max(0,Math.min(data.maxHealth,data.health)),fraction=health/Math.max(1,data.maxHealth)
  const label=`${data.title}, ${data.subtitle}, ${Math.round(health)} / ${data.maxHealth} health, ${data.status}${actionLabel?`, ${actionLabel}`:''}`
  return <button type="button" className={`compact-unit-card${selected?' selected':''}${actionLabel?' targetable':''}`} style={{'--unit-accent':color} as CSSProperties} aria-label={label} aria-pressed={selected} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();onSelect?.()}}>
    <span className="compact-unit-heading"><b>{title}</b>{stat?<span>{stat}</span>:null}</span>
    <span className="compact-unit-health" role="progressbar" aria-label="Health" aria-valuenow={Math.round(health)} aria-valuemin={0} aria-valuemax={data.maxHealth}><i style={{width:`${fraction*100}%`}}/></span>
  </button>
}
