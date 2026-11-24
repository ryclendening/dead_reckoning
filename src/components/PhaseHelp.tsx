import { useId, useRef } from 'react'
import type { Phase } from '../game/types'
import { DebriefLegend } from './DebriefSymbols'
import { RADAR_PLACEMENT_HELP } from './DefenseSiteDetails'
import { FIXED_ASSET_OBSERVATION_RANGE, RECON_GROUND_OBSERVATION_RANGE } from '../game/siteObservation'

type PlayPhase = 'deploy' | 'plan' | 'execute' | 'debrief' | 'adapt'

const help: Record<PlayPhase, { title: string; tips: [string, string][]; online?: string }> = {
  deploy: {
    title: 'Deployment',
    tips: [
      ['Place your sites', 'Pick a site from the bottom rail and tap a highlighted hex. Drag to pan. You can move any site until you start planning.'],
      ['Radar coverage', RADAR_PLACEMENT_HELP],
    ],
    online: 'Planning starts after both players lock their deployments.',
  },
  plan: {
    title: 'Planning',
    tips: [
      ['Choose a formation', 'Tap the aircraft count above a runway, then choose a formation from the fan. Use the Airfield map control to find a runway. Tap the runway itself to set a destination while editing.'],
      ['Fighter orders', 'Tap the map to plot a patrol. Tap its last waypoint again to select it, then drag from it to size a Protect ring. Select P to resize the ring. Drag elsewhere to pan. Tap a friendly airfield for Transit or use Escort for a flight with a confirmed order.'],
      ['Inspect a site', 'Tap a site to see HP and status. Enemy rings are dated estimates. Recon must land to update them.'],
      ['Earn cash', 'Objectives shows the one-time payouts for destroying enemy defenses and recovering evidence of an upgrade.'],
      ['Ground targets', 'Tap a confirmed enemy site to finish a fighter’s approach as Ground Strike. Drag S inside the marked release circle to adjust. Bombers take up to three targets in tap order. Tap a selected site again to remove it.'],
      ['Recon and recovery', 'Recon flies the route you plot. Aggressive continues through threats. Passive returns when it sees a fighter or a SAM or AAA battery fires at it.'],
      ['Spot ground sites', `Recon spots sites within ${RECON_GROUND_OBSERVATION_RANGE} map units and can pick up an operating radar beyond its coverage. Fighters and bombers spot sites within ${FIXED_ASSET_OBSERVATION_RANGE} units.`],
      ['Budget fuel', 'You can add up to five waypoints per leg. Outbound travel, the mission pattern, and the return all use fuel. Shorten a leg if a waypoint exceeds the budget.'],
      ['Choose where to land', 'Tap a friendly airfield on Return to change recovery while keeping the mission. Bombers return to their launch field on new orders.'],
    ],
    online: 'Lock orders to commit your plan. Execution starts when both players have locked.',
  },
  execute: {
    title: 'Execution',
    tips: [
      ['Follow the action', 'Select a flight to track it. Free look lets you pan the map. Use 1× or 2× to change playback speed.'],
      ['Read contacts', 'Radar can show a track before its aircraft type is identified. Newly spotted ground sites appear while an aircraft can observe them.'],
      ['Watch for recovery', 'Passive recon turns back when it sees an enemy fighter or comes under ground fire. Flights must land to bring their new intelligence home.'],
    ],
  },
  debrief: {
    title: 'Debrief',
    tips: [
      ['Review the round', 'Scroll the event feed to review the round in time order. Tap a report to locate it. At wide zoom, tap a numbered circle to zoom into nearby sites. Tap a stack at one site to fan out its reports. The totals include losses without a reported location.'],
      ['Read your payout', 'Round pay, recovered site intelligence, and confirmed enemy aircraft losses appear separately. A Supply Depot adds to round pay.'],
    ],
  },
  adapt: {
    title: 'Resupply',
    tips: [
      ['Purchase and build', 'In Buy, select an offer for details. In Upgrades, choose an airfield, defense site, or formation. Each can install one of its two branches. This round shows your purchases. To build, pick a site in Ground, tap a marked hex, then select Confirm build.'],
      ['Check repairs', 'Tap an airfield’s aircraft count to open its formation fan. An amber dot marks a field with repairs available. Select a marked formation to see its repair offer. Ground site damage persists. SAM missiles replenish each round.'],
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
      {phase==='debrief'?<DebriefLegend/>:null}
    </dialog>
  </>
}
