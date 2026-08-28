import type { Asset, CampaignWorld, MatchState, Point, Squadron } from './types'
import { snapToHex } from './hex'
import { createStartingKnowledge, generateCampaignWorld } from './world'

const add=(origin:Point,offset:Point):Point=>snapToHex([origin[0]+offset[0],origin[1]+offset[1]])
const route=(...points:Point[])=>points

export function friendlyAssetsFor(world:CampaignWorld):Asset[]{const base=world.friendlyTerritory.center;return [
  {id:'p-base',kind:'base',position:[...base],intel:'confirmed',confidence:100,health:100,maxHealth:100,hidden:false,struck:false},
  {id:'p-decoy',kind:'decoy',position:add(base,[3.2,-1.4]),intel:'confirmed',confidence:100,health:60,maxHealth:60,hidden:false,struck:false},
  {id:'p-radar',kind:'radar',position:add(base,[-1.5,-3.2]),intel:'confirmed',confidence:100,health:100,maxHealth:100,hidden:false,struck:false},
  {id:'p-sam',kind:'sam',position:add(base,[2.3,-2.1]),intel:'confirmed',confidence:100,health:100,maxHealth:100,hidden:false,struck:false},
  {id:'p-aaa',kind:'aaa',position:add(base,[-2.1,-1.2]),intel:'confirmed',confidence:100,health:100,maxHealth:100,hidden:false,struck:false},
]}

export function enemyBaseFor(world:CampaignWorld):Point{const [x,z]=world.friendlyTerritory.center;return snapToHex([(x>=0?-1:1)*9.2,(z>=0?-1:1)*12.4])}
export function enemyAssetsFor(world:CampaignWorld):Asset[]{const base=enemyBaseFor(world);return [
  {id:'e-base',kind:'base',position:base,intel:'unknown',confidence:0,health:100,maxHealth:100,hidden:true,struck:false},
  {id:'e-decoy',kind:'decoy',position:add(base,[-3.1,1.8]),intel:'unknown',confidence:0,health:50,maxHealth:50,hidden:true,struck:false},
  {id:'e-radar',kind:'radar',position:add(base,[1.9,3.3]),intel:'unknown',confidence:0,health:70,maxHealth:70,hidden:true,struck:false},
  {id:'e-sam',kind:'sam',position:add(base,[-2.4,3.5]),intel:'unknown',confidence:0,health:65,maxHealth:65,hidden:true,struck:false},
  {id:'e-aaa',kind:'aaa',position:add(base,[3.1,1.5]),intel:'unknown',confidence:0,health:55,maxHealth:55,hidden:true,struck:false},
]}

export function squadronsFor(world:CampaignWorld):Squadron[]{const base=world.friendlyTerritory.center,at=(offset:Point)=>add(base,offset);return [
  {id:'viper',callsign:'VIPER 1',role:'fighter',mission:'CAP',aggression:'aggressive',targetPriority:'opportunity',aircraft:4,maxAircraft:4,damaged:0,readiness:92,ammo:100,strength:100,morale:86,routeTemplate:'custom',routeIngress:route(base,at([-1.5,-3.2]),at([-3.8,-5.6]),at([-1.5,-3.2]),base),route:route(base,at([-1.5,-3.2]),at([-3.8,-5.6]),at([-1.5,-3.2]),base)},
  {id:'falcon',callsign:'FALCON 2',role:'fighter',mission:'CAP',aggression:'neutral',targetPriority:'opportunity',aircraft:4,maxAircraft:4,damaged:0,readiness:89,ammo:100,strength:100,morale:78,routeTemplate:'custom',routeIngress:route(base,at([2.4,-3.1]),at([5.2,-6.4]),at([2.4,-3.1]),base),route:route(base,at([2.4,-3.1]),at([5.2,-6.4]),at([2.4,-3.1]),base)},
  {id:'raven',callsign:'RAVEN 3',role:'recon',mission:'RECON',aggression:'conservative',targetPriority:'opportunity',aircraft:4,maxAircraft:4,damaged:0,readiness:96,ammo:100,strength:100,morale:84,routeTemplate:'custom',routeIngress:route(base,at([-1.5,-4]),at([1.5,-8.2]),at([4.8,-11.2]),at([1.5,-8.2]),base),route:route(base,at([-1.5,-4]),at([1.5,-8.2]),at([4.8,-11.2]),at([1.5,-8.2]),base)},
  {id:'ghost',callsign:'GHOST 4',role:'recon',mission:'RECON',aggression:'conservative',targetPriority:'opportunity',aircraft:4,maxAircraft:4,damaged:0,readiness:94,ammo:100,strength:100,morale:90,routeTemplate:'custom',routeIngress:route(base,at([-4.8,-2.2]),at([-6.1,-6.6]),at([-4.8,-2.2]),base),route:route(base,at([-4.8,-2.2]),at([-6.1,-6.6]),at([-4.8,-2.2]),base)},
]}

const DEFAULT_WORLD=generateCampaignWorld(7301)
export const PLAYER_BASE=DEFAULT_WORLD.friendlyTerritory.center
export const initialPlayerAssets=friendlyAssetsFor(DEFAULT_WORLD)
export const initialSquadrons=squadronsFor(DEFAULT_WORLD)
export const initialAssets=enemyAssetsFor(DEFAULT_WORLD)

export const createMatch=(seed=7301):MatchState=>{const world=generateCampaignWorld(seed),knowledge=createStartingKnowledge(world);return {round:1,phase:'plan',logistics:10,command:2,replacements:3,selectedId:'raven',squadrons:squadronsFor(world),enemyAssets:enemyAssetsFor(world),playerAssets:friendlyAssetsFor(world),playerBaseHealth:100,enemyBaseHealth:100,baseExposure:6,campaignScore:0,seed,world,mappedAreas:knowledge.mappedAreas,discoveredBoundaries:knowledge.discoveredBoundaries}}
