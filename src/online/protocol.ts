import type { EconomyActionId, EconomyTarget, MatchState, Point, Squadron } from '../game/types'

export type OnlineOrder = Pick<Squadron, 'id' | 'mission' | 'route' | 'routeIngress' | 'strikeTargetId' |
  'reconPosture' | 'protectedPoint' | 'protectedTargetId' | 'plannedRecoveryFieldId'>

export type OnlineAction =
  | { type: 'place'; assetId: string; position: Point }
  | { type: 'lock-deploy' }
  | { type: 'lock-plan'; orders: OnlineOrder[] }
  | { type: 'debrief' }
  | { type: 'purchase'; actionId: EconomyActionId; target: EconomyTarget; placement?: Point; upgradeId?: string }
  | { type: 'next-round' }

export interface OnlineCommand { id: string; revision: number; action: OnlineAction }
export interface OnlineSession { matchId: string; token: string }

export interface OnlineView {
  match: MatchState
  matchId: string
  revision: number
  joined: boolean
  locked: boolean
  opponentLocked: boolean
}

export interface OnlineResponse { view: OnlineView; invite?: string }
export interface OnlineEntry extends OnlineResponse { session: OnlineSession }
