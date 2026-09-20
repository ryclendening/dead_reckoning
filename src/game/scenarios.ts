import {createMatch,enemyBaseFor} from './data'
import type {DebugScenario,MatchState,Point,Squadron} from './types'

export const DEBUG_SCENARIOS:DebugScenario[]=['campaign','fighter-duel','fighter-2v1','fighter-tail','fighter-head-on','fighter-reversed','fighter-recon','neutral-los','radar-intercept','reaction-interrupt','parallel-engagements','recon-pursuit','recon-recovery','recon-edge','recon-loss','fob-recovery','fob-divert','fob-stranded','fob-trapped']

export const DEBUG_SCENARIO_LABELS:Record<DebugScenario,string>={
  campaign:'CAMPAIGN',
  'fighter-duel':'FIGHTER VS FIGHTER',
  'fighter-2v1':'FIGHTER 2 VS 1',
  'fighter-tail':'FIGHTER TAIL ASPECT',
  'fighter-head-on':'FIGHTER HEAD-ON',
  'fighter-reversed':'FIGHTER REVERSED',
  'fighter-recon':'FIGHTER VS RECON',
  'neutral-los':'VISUAL CONTACT',
  'radar-intercept':'RADAR INTERCEPT',
  'reaction-interrupt':'PURSUIT INTERRUPTION',
  'parallel-engagements':'PARALLEL ENGAGEMENTS',
  'recon-pursuit':'RECON PURSUIT CONTROL',
  'recon-recovery':'RECON RECOVERY',
  'recon-edge':'RECON EDGE',
  'recon-loss':'RECON LOSS',
  'fob-recovery':'FOB RECOVERY',
  'fob-divert':'FOB DIVERSION',
  'fob-stranded':'FOB STRANDING',
  'fob-trapped':'FOB TRAPPED',
}

const midpoint=(a:Point,b:Point):Point=>[(a[0]+b[0])/2,(a[1]+b[1])/2]
const withRoute=(squadron:Squadron,route:Point[],overrides:Partial<Squadron>={}):Squadron=>({...squadron,...overrides,mission:squadron.role==='fighter'?'forward-patrol':'search-area',route,routeIngress:route})
const grounded=(squadron:Squadron):Squadron=>({...squadron,aircraft:0,strength:0})

export function createScenario(scenario:DebugScenario):MatchState{
  const match=createMatch()
  match.debugScenario=scenario
  if(scenario==='campaign')return match
  if(scenario==='recon-loss')match.seed=2

  match.phase='plan'
  const base=match.playerAssets.find(asset=>asset.kind==='base')!.position
  const radar=match.playerAssets.find(asset=>asset.kind==='radar')!.position
  const enemyRadar=match.enemyAssets.find(asset=>asset.kind==='radar')!.position
  const enemySam=match.enemyAssets.find(asset=>asset.kind==='sam')!.position
  const edgeTarget:Point=[base[0],base[1]>=0?match.world.bounds.maxZ+8:match.world.bounds.minZ-8]
  const geometryScenario=scenario==='fighter-tail'||scenario==='fighter-head-on'||scenario==='fighter-reversed'
  const fighterScenario=scenario==='fighter-duel'||scenario==='fighter-2v1'||geometryScenario||scenario==='fighter-recon'||scenario==='neutral-los'||scenario==='radar-intercept'||scenario==='reaction-interrupt'||scenario==='parallel-engagements'
  const fobScenario=scenario==='fob-recovery'||scenario==='fob-divert'||scenario==='fob-stranded'||scenario==='fob-trapped'
  if(fobScenario){
    const direction=base[1]>=0?-1:1
    const fobPosition:[number,number]=[base[0],base[1]+direction*18]
    match.playerAssets=[...match.playerAssets.map(asset=>asset.kind==='sam'||asset.kind==='aaa'?{...asset,health:0}:asset),{id:'p-fob-1',kind:'fob',name:'FOB ALPHA',position:fobPosition,intel:'confirmed',confidence:100,health:scenario==='fob-trapped'?0:100,maxHealth:100,hidden:false,struck:false,operational:scenario!=='fob-trapped',capacity:1,basedFormationIds:scenario==='fob-trapped'?['viper']:[]}]
    match.playerAssets=match.playerAssets.map(asset=>asset.kind==='base'?{...asset,basedFormationIds:scenario==='fob-trapped'?['falcon','raven','ghost']:['viper','falcon','raven','ghost']}:asset)
    match.selectedId='viper'
    const routeToFob:Point[]=scenario==='fob-stranded'?[base,[base[0]+15,base[1]+direction*10],fobPosition]:[scenario==='fob-trapped'?fobPosition:base,fobPosition]
    match.squadrons=match.squadrons.map(squadron=>squadron.id==='viper'?withRoute(squadron,routeToFob,{plannedRecoveryFieldId:'p-fob-1',...(scenario==='fob-trapped'?{status:'trapped' as const}: {})}):grounded(squadron))
    return match
  }
  match.selectedId=fighterScenario?'viper':'raven'
  if(geometryScenario)match.playerAssets=match.playerAssets.map(asset=>asset.kind==='sam'||asset.kind==='aaa'?{...asset,health:0}:asset)
  match.squadrons=match.squadrons.map(squadron=>{
    if(geometryScenario)return squadron.id==='viper'?withRoute(squadron,[base,[base[0]+8,base[1]]]):grounded(squadron)
    if(scenario==='fighter-duel'||scenario==='fighter-2v1'||scenario==='neutral-los')return squadron.id==='viper'||scenario==='fighter-2v1'&&squadron.id==='falcon'?withRoute(squadron,[base,midpoint(base,enemyRadar),enemyRadar]):grounded(squadron)
    if(scenario==='fighter-recon')return squadron.id==='viper'?withRoute(squadron,[base,midpoint(base,enemyRadar)]):grounded(squadron)
    if(scenario==='radar-intercept')return squadron.id==='viper'?withRoute(squadron,[base,radar,base]):grounded(squadron)
    if(scenario==='reaction-interrupt')return squadron.id==='viper'?withRoute(squadron,[base,midpoint(base,enemyRadar),enemyRadar]):grounded(squadron)
    if(scenario==='parallel-engagements'){
      const enemyBase=enemyBaseFor(match.world),delta:Point=[enemyBase[0]-base[0],enemyBase[1]-base[1]],length=Math.max(.001,Math.hypot(delta[0],delta[1])),forward:Point=[delta[0]/length,delta[1]/length],side:Point=[-forward[1],forward[0]],lateral=squadron.id==='viper'?-4:4;const target:Point=[base[0]+forward[0]*10+side[0]*lateral,base[1]+forward[1]*10+side[1]*lateral]
      return squadron.id==='viper'||squadron.id==='falcon'?withRoute(squadron,[base,target]):grounded(squadron)
    }
    if(scenario==='recon-pursuit')return squadron.id==='raven'?withRoute(squadron,[base,midpoint(base,enemyRadar),enemyRadar]):grounded(squadron)
    if(scenario==='recon-recovery')return squadron.id==='raven'?withRoute(squadron,[base,midpoint(base,enemyRadar),enemyRadar,midpoint(base,enemyRadar),base]):grounded(squadron)
    if(scenario==='recon-edge')return squadron.id==='raven'?withRoute(squadron,[base,edgeTarget]):grounded(squadron)
    if(scenario==='recon-loss')return squadron.id==='raven'?withRoute(squadron,[base,midpoint(base,enemySam),enemySam,enemyRadar],{aircraft:1,strength:1,morale:24}):grounded(squadron)
    return squadron
  })
  return match
}
