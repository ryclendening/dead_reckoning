import { useId, useRef } from 'react'
import type { Phase } from '../game/types'
import { RADAR_PLACEMENT_HELP } from './DefenseSiteDetails'

type PlayPhase = 'deploy' | 'plan' | 'execute' | 'debrief' | 'adapt'

const help: Record<PlayPhase, { title: string; tips: [string, string][]; online?: string }> = {
  deploy: {
    title: 'Deployment',
    tips: [
      ['Place your sites', 'Select a site and tap a highlighted hex. To move a placed site, select it and tap another hex before locking deployment.'],
      ['Radar coverage', RADAR_PLACEMENT_HELP],
    ],
    online: 'Planning starts after both players lock their deployments.',
  },
  plan: {
    title: 'Planning',
    tips: [
      ['Choose a task', 'Tap an aircraft to choose a task. Recon flies the waypoints you plot. Ground Strike requires recovered intelligence on the target.'],
      ['Budget fuel', 'You can add up to five waypoints per leg. Outbound travel, the mission pattern, and the return all use fuel. Shorten a leg if a waypoint exceeds the budget.'],
      ['Choose where to land', 'Tap a friendly airfield on Return, or tap it on Outbound during Transit. Tapping a FOB while planning Protect makes it the defended site.'],
    ],
    online: 'Lock orders to commit your plan. Execution starts when both players have locked.',
  },
  execute: {
    title: 'Execution',
    tips: [
      ['Follow the action', 'Select a flight to track it. Free look lets you pan the map. Use 1× or 2× to change playback speed.'],
      ['Read contacts', 'Radar can show a track before its aircraft type is identified.'],
      ['Watch for recovery', 'Conservative recon turns back when it sees an enemy fighter or comes under ground fire. Flights must land to bring their new intelligence home.'],
    ],
    online: 'Newly spotted ground sites appear while they are in sight. Recover the observation to keep their coordinates.',
  },
  debrief: {
    title: 'Debrief',
    tips: [
      ['Review the round', 'Select a numbered highlight to focus its location. Orders & Results explains what happened to each mission.'],
      ['Read your payout', 'Round pay, recovered site intelligence, and confirmed enemy aircraft losses appear separately. A Supply Depot adds to round pay.'],
    ],
  },
  adapt: {
    title: 'Resupply',
    tips: [
      ['Spend your cash', 'Use Buy to add aircraft or build sites. Select the main airfield to see its upgrade options.'],
      ['Check repairs', 'Use Repairs or select a damaged formation to restore strength. Ground site damage persists. SAM missiles replenish each round.'],
      ['Prepare to launch', 'You can plan the next round even with no aircraft. A forward base holds up to two formations.'],
    ],
  },
}

const campaignEnd: (typeof help)[PlayPhase] = {
  title: 'Campaign results',
  tips: [['Review the outcome', 'The result explains what ended the campaign. Return to the menu to start a new match.']],
}

export function PhaseHelp({ phase, online }: { phase: Phase; online: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const dialogId = useId()
  const titleId = `${dialogId}-title`
  const content = phase === 'victory' || phase === 'defeat' || phase === 'draw' ? campaignEnd : help[phase]

  return <>
    <button type="button" className="phase-help-toggle" aria-label={`Help for ${content.title}`} aria-haspopup="dialog" aria-controls={dialogId}
      onClick={() => dialog.current?.showModal()}>?</button>
    <dialog id={dialogId} ref={dialog} className="phase-help-dialog" aria-labelledby={titleId}>
      <header>
        <h2 id={titleId}>{content.title} help</h2>
        <button type="button" aria-label="Close help" onClick={() => dialog.current?.close()}>Done</button>
      </header>
      <dl>
        {content.tips.map(([label, tip]) => <div key={label}><dt>{label}</dt><dd>{tip}</dd></div>)}
        {online && content.online ? <div><dt>Multiplayer</dt><dd>{content.online}</dd></div> : null}
      </dl>
    </dialog>
  </>
}
