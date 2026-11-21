import { Bomb, Check, Crosshair, Eye, Wrench } from 'lucide-react'
import type { Squadron } from '../game/types'

const roleIcons = { fighter: Crosshair, recon: Eye, bomber: Bomb }

export function FormationChip({ flight, selected, cue, disabled, showCount, onSelect }: {
  flight: Squadron
  selected: boolean
  cue?: 'planned' | 'repair'
  disabled?: boolean
  showCount?: boolean
  onSelect: () => void
}) {
  const Icon = roleIcons[flight.role]
  const status = flight.status === 'trapped' ? 'trapped' : cue === 'repair' ? 'repair available' : cue
  const label = [flight.callsign, status ?? flight.role, showCount ? `${flight.aircraft} aircraft` : undefined].filter(Boolean).join(', ')

  return <button type="button" className="formation-chip" data-role={flight.role} data-cue={cue}
    aria-label={label} aria-pressed={selected} title={label} disabled={disabled}
    onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSelect() }}>
    <Icon className="formation-role" aria-hidden="true"/>
    <span>{flight.callsign}</span>
    {showCount ? <small>{flight.aircraft}</small> : null}
    {cue === 'planned' ? <Check className="formation-cue" aria-hidden="true"/>
      : cue === 'repair' ? <Wrench className="formation-cue" aria-hidden="true"/> : null}
  </button>
}
