import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { createCampaignDraft } from '../../src/game/data'
import { applyRound, resolveRound } from '../../src/game/engine'
import { applyRound as applyV1, resolveRound as resolveV1 } from './baseline/legacyEngine.fixture'
import { planCpu as planV1, cpuPlanningView as viewV1 } from './baseline/legacyPlanner.fixture'
import { maintainCpu as maintainV1 } from './baseline/legacySettlement.fixture'
import { planCpu, cpuPlanningView } from '../../src/game/cpu/planner'
import { defenseCoverage } from '../../src/game/cpu/placement'
import { maintainCpu } from '../../src/game/cpu/settlement'
import { confirmCampaignSetup } from '../../src/game/campaignSetup'
import { campaignOutcome } from '../../src/game/campaign'
import { deriveRecoveryPlanningView, formationField, normalizeFormationBasing, validateRecoveryPackage } from '../../src/game/forwardBasing'
import { generateRouteTemplate, validateGroundStrikeOrder } from '../../src/game/routeTemplates'
import { MAX_FLIGHT_DISTANCE } from '../../src/game/flightRules'
import { executeEconomyCommand, economyQuotesFor, validateAssetPlacement } from '../../src/game/economy'
import { axialToPoint } from '../../src/game/hex'
import { normalizeMatch } from '../../src/game/persistence'
import type { Asset, MatchState, Point, Squadron } from '../../src/game/types'
import type { CpuDifficulty } from '../../src/game/cpu/types'

type Policy='direct-rush'|'flank'|'recon-strike'|'heavy-sam'|'forward-fob'|'recon-denial'
const policies:Policy[]=['direct-rush','flank','recon-strike','heavy-sam','forward-fob','recon-denial']
const d=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1])
function ordered(s:MatchState,f:Squadron,mission:Squadron['mission'],station:Point,flank=false,target?:Asset):Squadron {
  const field=formationField(s.playerAssets,f.id)!,from=field.position,l=Math.max(.01,d(from,station))
  const midpoint:Point=[(from[0]+station[0])/2-(station[1]-from[1])/l*5,(from[1]+station[1])/2+(station[0]-from[0])/l*5]
  const ingress=flank?[from,midpoint,station]:[from,station]
  const generated=mission==='base-strike'||mission==='transit'?ingress:generateRouteTemplate({template:mission,ingress,maxDistance:MAX_FLIGHT_DISTANCE[f.role],bounds:{minX:Math.min(from[0],station[0])-8,maxX:Math.max(from[0],station[0])+8,minZ:Math.min(from[1],station[1])-8,maxZ:Math.max(from[1],station[1])+8}}).route
  const order={...f,mission,route:generated,routeIngress:ingress,sortieOrdered:true,strikeTargetId:target?.id,protectedPoint:mission==='defensive-cap'?station:undefined,protectedTargetId:undefined}
  const view=deriveRecoveryPlanningView({...s,squadrons:s.squadrons.map(u=>u.id===f.id?order:u)},f.id,generated,MAX_FLIGHT_DISTANCE[f.role])
  if(!view?.valid)return {...f,sortieOrdered:false}
  const result={...order,route:view.normalizedRoute,plannedRecoveryFieldId:view.intendedField.id}
  return mission==='base-strike'&&validateGroundStrikeOrder(s,result)!==undefined?{...f,sortieOrdered:false}:result
}
/** Scripted opponents consume player-authorized reports/own state only. */
function playerOrders(s:MatchState,policy:Policy):MatchState {
  const home=s.playerAssets.find(a=>a.kind==='base')!.position
  const base=s.enemyAssets.find(a=>a.kind==='base'&&a.intel==='confirmed'&&!a.hidden&&a.health>0)
  const sectors:Point[]=[[0,0],[-6,8],[0,8],[6,8],[-6,0],[6,0],[-6,-8],[0,-8],[6,-8],[-10,12],[10,12],[-10,-12],[10,-12]]
  const search=sectors.filter(p=>d(p,home)>9).sort((a,b)=>d(a,[-home[0]*.7,-home[1]*.7])-d(b,[-home[0]*.7,-home[1]*.7]))
  const point=search[(s.round-1)%search.length]??[0,0]
  const formations=s.squadrons.map(f=>{
    if(f.aircraft<=0||f.status==='trapped')return {...f,sortieOrdered:false}
    if(f.role==='recon')return ordered(s,f,'search-area',base?.position??point,policy==='flank')
    const launch=formationField(s.playerAssets,f.id)!
    if(base&&policy!=='recon-denial') {
      const angle=Math.atan2(launch.position[1]-base.position[1],launch.position[0]-base.position[0])+(policy==='flank'?.7:0)
      const release:Point=d(launch.position,base.position)<6?[launch.position[0]+.01,launch.position[1]]:[base.position[0]+Math.cos(angle)*5.9,base.position[1]+Math.sin(angle)*5.9]
      return ordered(s,f,'base-strike',release,policy==='flank',base)
    }
    if(policy==='direct-rush'||policy==='flank')return ordered(s,f,'forward-patrol',point,policy==='flank')
    if(policy==='forward-fob') {
      const fob=s.playerAssets.find(a=>a.kind==='fob'&&a.operational!==false&&a.health>0)
      if(fob&&launch.id!==fob.id)return ordered(s,f,'transit',fob.position)
    }
    return ordered(s,f,'defensive-cap',home)
  })
  return {...s,squadrons:formations}
}
function playerAdapt(s:MatchState,policy:Policy):MatchState {
  for(const f of s.squadrons)for(let i=0;i<4;i++) {
    const q=economyQuotesFor(s,{kind:'squadron',id:f.id}).find(q=>q.eligible&&(q.id==='repair-formation'||q.id==='replace-aircraft'))
    if(q)s=executeEconomyCommand(s,{actionId:q.id,target:q.target});else break
  }
  if(policy==='heavy-sam'||policy==='forward-fob') {
    const home=s.playerAssets.find(a=>a.kind==='base')!.position,kind=policy==='heavy-sam'?'sam':'fob'
    const points:Point[]=[]
    for(let q=-22;q<=22;q++)for(let r=-20;r<=20;r++) {const p=axialToPoint(q,r);if(validateAssetPlacement(s,kind,p).valid)points.push(p)}
    points.sort((a,b)=>policy==='heavy-sam'?d(a,home)-d(b,home):d(a,[0,0])-d(b,[0,0]))
    if(points[0]&&(kind!=='fob'||!s.playerAssets.some(a=>a.kind==='fob')))s=executeEconomyCommand(s,{actionId:`build-${kind}`,target:{kind:'campaign',id:'campaign'},placement:points[0]})
  }
  return s
}
interface Row {version:'v1'|'v2';difficulty:CpuDifficulty;seed:number;split:string;policy:Policy;cpuWin:boolean;rounds:number;playerBaseDamage:number;cpuBaseDamage:number;intel:number;sams:number;fobs:number;fobUsed:number;recovered:number;sorties:number;logistics:number;spent:number;illegal:number;expansions:number;packages:number;samCoverageGain:number;fobStrikeOrders:number;baseSeen:boolean;exposure:number;playerSams:number;playerFobs:number;decisions:string[]}
export function campaign(version:Row['version'],difficulty:CpuDifficulty,seed:number,policy:Policy):Row {
  const draft=createCampaignDraft(seed,difficulty)
  let s=confirmCampaignSetup({...draft,setup:{...draft.setup!,stage:'review',placedAssetIds:[...draft.setup!.selectedAssetIds]}})
  const row:Row={version,difficulty,seed,split:seed<100?'development':'holdout',policy,cpuWin:false,rounds:0,playerBaseDamage:0,cpuBaseDamage:0,intel:0,sams:0,fobs:0,fobUsed:0,recovered:0,sorties:0,logistics:0,spent:0,illegal:0,expansions:0,packages:0,samCoverageGain:0,fobStrikeOrders:0,baseSeen:false,exposure:6,playerSams:0,playerFobs:0,decisions:[]}
  for(let round=1;round<=6;round++) {
    s={...s,round,phase:'plan',lastResult:undefined,playerAssets:normalizeFormationBasing(s.squadrons,s.playerAssets)}
    const plan=version==='v2'?planCpu(cpuPlanningView(s)!):planV1(viewV1(s)!)
    s.cpu={...s.cpu!,plan,intent:plan.intent}
    if(version==='v2') {
      const restored=normalizeMatch(JSON.parse(JSON.stringify(s)))
      expect(restored.cpu?.plan).toEqual(s.cpu.plan)
      s=restored
    }
    row.decisions.push(plan.intent??plan.objective)
    row.expansions+=plan.trace?.work.routeExpansions??0
    row.packages+=plan.trace?.work.packages??0
    row.fobStrikeOrders+=plan.orders.filter(o=>o.sortieOrdered!==false&&o.mission==='base-strike'&&formationField(s.enemyAssets,o.id)?.kind==='fob').length
    const ids=new Set(plan.orders.filter(o=>o.sortieOrdered!==false).map(o=>o.id))
    if(!validateRecoveryPackage({playerAssets:s.enemyAssets,squadrons:plan.orders},MAX_FLIGHT_DISTANCE,ids).valid)row.illegal++
    s=playerOrders(s,policy)
    const result=(version==='v2'?resolveRound:resolveV1)(s)
    row.sorties+=ids.size;row.recovered+=result.cpuReport?.recoveredIds.length??0
    s=(version==='v2'?applyRound:applyV1)(s,result)
    row.fobUsed+=result.cpuReport?.recoveryOutcomes?.filter(o=>o.actualFieldId?.startsWith('e-fob')&&plan.orders.find(f=>f.id===o.formationId)?.sortieOrdered!==false&&['recovered','diverted'].includes(o.outcome)).length??0
    row.rounds=round
    if(campaignOutcome(s))break
    s={...s,phase:'adapt'}
    const placementView=cpuPlanningView(s)!,priorAssetIds=new Set(s.enemyAssets.map(a=>a.id))
    s=(version==='v2'?maintainCpu:maintainV1)(s)
    row.packages+=s.cpu!.adaptTrace?.work.packages??0
    row.expansions+=s.cpu!.adaptTrace?.work.routeExpansions??0
    for(const a of s.enemyAssets.filter(a=>a.kind==='sam'&&!priorAssetIds.has(a.id))){row.samCoverageGain+=defenseCoverage(placementView,a.position,'sam');placementView.assets.push(a)}
    s=playerAdapt(s,policy)
  }
  row.cpuWin=campaignOutcome(s)!=='enemy-base-destroyed'
  row.playerBaseDamage=100-s.playerBaseHealth;row.cpuBaseDamage=100-s.enemyBaseHealth;row.intel=s.cpu!.sites.length
  row.sams=s.enemyAssets.filter(a=>a.kind==='sam').length-1;row.fobs=s.enemyAssets.filter(a=>a.kind==='fob').length
  row.baseSeen=s.cpu!.sites.some(a=>a.kind==='base');row.exposure=s.baseExposure;row.playerSams=s.playerAssets.filter(a=>a.kind==='sam').length;row.playerFobs=s.playerAssets.filter(a=>a.kind==='fob').length
  row.logistics=s.cpu!.logistics;row.spent=s.cpu!.spending.reduce((n,e)=>n+e.cost,0)
  expect(row.logistics).toBeGreaterThanOrEqual(0)
  return row
}
const full=process.env.CPU_BENCHMARK==='full'
describe('paired campaign evaluation',()=>{
  it('runs legal reproducible policies against the preserved v1 baseline',()=>{
    const rows:Row[]=[],seeds=full?[3,11,29,47,71,89,103,127,151,173,197,229]:[3,103]
    for(const difficulty of full?['easy','medium','hard'] as const:['medium'] as const)for(const seed of seeds)for(const policy of policies)for(const version of ['v1','v2'] as const)rows.push(campaign(version,difficulty,seed,policy))
    expect(rows.filter(r=>r.version==='v2').every(r=>r.illegal===0)).toBe(true)
    const replay=campaign('v2','medium',3,'direct-rush')
    expect(replay).toEqual(rows.find(r=>r.version==='v2'&&r.difficulty==='medium'&&r.seed===3&&r.policy==='direct-rush'))
    if(full)writeFileSync('Evaluation/CpuPlannerV2/results.json',JSON.stringify({baseline:'d8850a0',seeds,rows},null,2)+'\n')
  },600000)
})
