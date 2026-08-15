import type { Asset, MatchState, Squadron } from './types'
import { snapToHex } from './hex'

export const PLAYER_BASE = snapToHex([-7.8, 11.2])
export const PLAYER_DECOY = snapToHex([6.8, 9.2])
export const PLAYER_RADAR = snapToHex([-6.7, 5.8])
export const ENEMY_BASE = snapToHex([7.4, -11.1])

export const initialPlayerAssets: Asset[] = [
  { id:'p-base', kind:'base', position:PLAYER_BASE, intel:'confirmed', confidence:100, health:100, hidden:false },
  { id:'p-decoy', kind:'decoy', position:PLAYER_DECOY, intel:'confirmed', confidence:100, health:60, hidden:false },
  { id:'p-radar', kind:'radar', position:PLAYER_RADAR, intel:'confirmed', confidence:100, health:100, hidden:false },
  { id:'p-sam', kind:'sam', position:snapToHex([-2.8,7.2]), intel:'confirmed', confidence:100, health:100, hidden:false },
  { id:'p-aaa', kind:'aaa', position:snapToHex([-7.2,9.1]), intel:'confirmed', confidence:100, health:100, hidden:false },
]

const route = (...points: [number, number][]) => points
export const initialSquadrons: Squadron[] = [
  { id:'viper', callsign:'VIPER 1', role:'interceptor', mission:'CAP', aggression:'aggressive', risk:'preserve', targetPriority:'opportunity', aircraft:4, maxAircraft:4, damaged:0, readiness:92, ammo:100, route:route(PLAYER_BASE,[-6,5.5],[-3.2,1],[-6,5.5],PLAYER_BASE) },
  { id:'falcon', callsign:'FALCON 2', role:'fighter', mission:'ESCORT', aggression:'balanced', risk:'normal', targetPriority:'opportunity', aircraft:4, maxAircraft:4, damaged:0, readiness:89, ammo:100, route:route(PLAYER_BASE,[-3.5,6],[0,1.2],[3,-3.5]) },
  { id:'hawk', callsign:'HAWK 3', role:'strike', mission:'STRIKE', aggression:'balanced', risk:'press', targetPriority:'air-defense', aircraft:4, maxAircraft:4, damaged:0, readiness:84, ammo:100, route:route(PLAYER_BASE,[-3.5,7],[1,1],[5,-7]) },
  { id:'raven', callsign:'RAVEN 4', role:'recon', mission:'RECON', aggression:'cautious', risk:'preserve', targetPriority:'opportunity', aircraft:4, maxAircraft:4, damaged:0, readiness:96, ammo:100, route:route(PLAYER_BASE,[-3,5],[1,0],[5,-7],[1,0],PLAYER_BASE) },
]

export const initialAssets: Asset[] = [
  { id:'e-base', kind:'base', position:ENEMY_BASE, intel:'unknown', confidence:0, health:100, hidden:true },
  { id:'e-decoy', kind:'decoy', position:snapToHex([-4.8,-9.6]), intel:'suspected', confidence:28, health:50, hidden:true },
  { id:'e-radar', kind:'radar', position:snapToHex([3.8,-4.8]), intel:'suspected', confidence:35, health:70, hidden:true },
  { id:'e-sam', kind:'sam', position:snapToHex([-4.6,-3.4]), intel:'unknown', confidence:0, health:65, hidden:true },
  { id:'e-aaa', kind:'aaa', position:snapToHex([7.8,-6.6]), intel:'unknown', confidence:0, health:55, hidden:true },
]

export const createMatch = (): MatchState => ({
  round:1, phase:'deploy', logistics:10, command:2, replacements:3, selectedId:'raven',
  squadrons:structuredClone(initialSquadrons), enemyAssets:structuredClone(initialAssets), playerAssets:structuredClone(initialPlayerAssets),
  playerBaseHealth:100, enemyBaseHealth:100, baseExposure:6, campaignScore:0, seed:7301,
})

export const PRESETS: Record<string, [number,number][]> = {
  'River run': [PLAYER_BASE,[-4.4,6],[-1,1.2],[2.8,-3.8],[6.2,-8.3]],
  'Northern gap': [PLAYER_BASE,[-8.2,4.2],[-7.2,-.4],[-5.1,-5.2]],
  'Deep probe': [PLAYER_BASE,[-3.2,5],[1.2,-.5],[5.2,-6.2],ENEMY_BASE],
}
