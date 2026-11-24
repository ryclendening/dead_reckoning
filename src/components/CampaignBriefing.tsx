import { Crosshair, Eye, Shield } from 'lucide-react'
import { CAMPAIGN_ROUND_LIMIT } from '../game/campaign'
import { OBJECTIVE_REWARDS } from '../game/objectives'
import { formatCash } from '../game/economyRules'
import type { Asset, MatchState } from '../game/types'
import './CampaignBriefing.css'

function searchSector(startRegionId: string) {
  const opposite: Record<string, string> = {
    'north-west': 'south-east',
    'north-east': 'south-west',
    'south-west': 'north-east',
    'south-east': 'north-west',
  }
  return opposite[startRegionId] ?? 'opposite sector'
}

export function CampaignBriefing({ match, target, homeHealth, enemyHealth }: {
  match: MatchState
  target?: Asset
  homeHealth: number
  enemyHealth?: number
}) {
  const strikeReady = Boolean(target)
  const health = target ? enemyHealth ?? target.health : undefined
  return <details name="map-tools" className="campaign-briefing" aria-label="Campaign objectives">
    <summary><Shield/> Objectives</summary>
    <div className="campaign-briefing-detail"><header><span><Shield/></span><div><small>{`DESTROY ENEMY BASE BY END OF ROUND ${CAMPAIGN_ROUND_LIMIT}`}</small><b>CAMPAIGN OBJECTIVES</b></div></header>
    <div className="campaign-objective"><Crosshair/><span><b>{strikeReady ? 'STRIKE CONFIRMED BASE' : 'LOCATE AND STRIKE ENEMY BASE'}</b><small>{strikeReady ? 'Choose Ground Strike, select the enemy base, then review the ingress.' : `Search ${searchSector(match.world.startRegionId)} with recon and bring the coordinates home.`}</small></span><i className={strikeReady ? 'ready' : ''}>{strikeReady ? 'READY' : 'SEARCH'}</i></div>
    <div className="campaign-threat"><Eye/><span><b>PROTECT HOME BASE</b><small>Both sides can strike after recovering target coordinates. Both bases surviving round {CAMPAIGN_ROUND_LIMIT} is a draw.</small></span></div>
    <div className="campaign-health"><span>HOME BASE</span><i><em style={{ width: `${Math.max(0, Math.min(100, homeHealth))}%` }}/></i><b>{homeHealth}%</b></div>
    {strikeReady ? <div className="campaign-health enemy"><span>ENEMY BASE</span><i><em style={{ width: `${Math.max(0, Math.min(100, health ?? 0))}%` }}/></i><b>{health}%</b></div> : null}
    <ul className="campaign-contracts" aria-label="One-time payouts">
      {Object.values(OBJECTIVE_REWARDS).map(reward => {
        const complete = match.economy.completedObjectives?.includes(reward.id)
        return <li key={reward.id}><span>{reward.label}</span><b>{complete ? 'Paid' : `+${formatCash(reward.amount)}`}</b></li>
      })}
    </ul>
    </div>
  </details>
}
