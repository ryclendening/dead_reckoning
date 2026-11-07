import { useState } from 'react'
import type { MatchState } from '../game/types'
import type { CpuDifficulty } from '../game/cpu/types'

const OPTIONS: Array<{ id: CpuDifficulty; label: string; detail: string }> = [
  { id: 'easy', label: 'Easy', detail: 'Predictable approaches and simple mission choices.' },
  { id: 'medium', label: 'Medium', detail: 'Weighs known defenses and protects useful recon flights.' },
  { id: 'hard', label: 'Hard', detail: 'Compares more approaches and strike release points; responds strongly to known threats.' },
]

export function CampaignMenu({ saved, onContinue, onStart }: { saved?: MatchState; onContinue: () => void; onStart: (difficulty: CpuDifficulty) => void }) {
  const [difficulty, setDifficulty] = useState<CpuDifficulty>(saved?.cpu?.difficulty ?? 'medium')
  return <main className="campaign-menu"><section aria-labelledby="campaign-menu-title">
    <p className="menu-kicker">AIR COMMAND · SIX-ROUND CAMPAIGN</p>
    <h1 id="campaign-menu-title">DEAD RECKONING</h1>
    <p className="menu-intro">Find the enemy airfield. Recover your intelligence. Plan the strike and bring your aircraft home.</p>
    {saved ? <div className="menu-resume"><button type="button" onClick={onContinue}>CONTINUE CAMPAIGN <span>ROUND {saved.round} · {(saved.cpu?.difficulty ?? 'medium').toUpperCase()}</span></button></div> : null}
    <fieldset><legend>NEW CAMPAIGN · CPU DIFFICULTY</legend><div className="difficulty-options">{OPTIONS.map(option => <label key={option.id} className={difficulty === option.id ? 'selected' : ''}>
      <input type="radio" name="difficulty" value={option.id} checked={difficulty === option.id} onChange={() => setDifficulty(option.id)}/><span><strong>{option.label}</strong><small>{option.detail}</small></span>
    </label>)}</div></fieldset>
    <button type="button" className="menu-start" onClick={() => onStart(difficulty)}>START NEW CAMPAIGN <span>→</span></button>
    <p className="menu-footnote">Place your opening assets before planning round one. Progress saves automatically.{saved ? ' Starting a new campaign replaces this save.' : ''}</p>
  </section></main>
}
