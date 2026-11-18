import { CAMPAIGN_ROUND_LIMIT } from '../campaign'
import { economyCommandForQuote, economyQuotesFor, executeEconomyCommand, validateAssetPlacement } from '../sideEconomy'
import { LOGISTICS_EFFECTS } from '../economyRules'
import type { SidePlanningContext } from '../sideContext'
import type { EconomyCommand, EconomyTarget } from '../types'
import type { CpuPlanningView } from './planningView'
import { generateActions } from './actions'
import { choosePackage, contribution } from './strategy'
import { CPU_PROFILES, type RouteWork } from './routes'
import { defenseBenefits, defenseNetworkBenefits, forwardValue, legalPlacements, observedThreat } from './placement'
import type { TacticalPackage } from './types'

export const CPU_RESUPPLY_WORK_BUDGET = { easy: 6000, medium: 8000, hard: 10000 }

function withContext(view:CpuPlanningView,ctx:SidePlanningContext):CpuPlanningView {
  return {...view,assets:ctx.assets,context:ctx,cpu:{...view.cpu,formations:ctx.formations,logistics:ctx.logistics,reserves:ctx.reserves}}
}
/** Re-quote each command on the current working copy, including placement/upgrade exclusivity. */
function commands(view:CpuPlanningView):EconomyCommand[] {
  const ctx=view.context, targets:EconomyTarget[]=[...ctx.formations.map(f=>({kind:'squadron' as const,id:f.id})),...ctx.assets.map(a=>({kind:'asset' as const,id:a.id}))]
  const result:EconomyCommand[]=targets.flatMap(target=>economyQuotesFor(ctx,target).filter(q=>q.eligible).map(q=>({actionId:q.id,target,expectedCost:q.cost,expectedLogistics:ctx.logistics,expectedReserveAircraft:ctx.reserves})))
  // Consider fixed infrastructure only when its current return can cover the price.
  const work=ctx.formations.reduce((n,f)=>n+Math.ceil(Math.max(0,f.aircraft/f.maxAircraft*100-(f.strength??100))/25),0)
  const filtered=result.filter(c=>c.actionId!=='install-maintenance-wing'||work>12)
  const campaignQuotes=economyQuotesFor(ctx,{kind:'campaign',id:'campaign'})
  for(const quote of campaignQuotes){
    if(quote.effect.kind!=='formation-purchase'||!quote.eligible)continue
    const role=quote.effect.role
    const available=ctx.formations.filter(f=>f.role===role&&f.aircraft>0&&f.status!=='trapped').length
    if(available===0)filtered.push(economyCommandForQuote(ctx,quote))
  }
  for(const kind of ['sam','aaa','radar','fob'] as const) {
    if(!campaignQuotes.some(quote=>quote.id===`build-${kind}`&&quote.eligible))continue
    const ranked=legalPlacements(view,kind).map(p=>{const effects=kind==='fob'?undefined:defenseBenefits(view,p,kind);return {p,value:effects?effects.coverage*observedThreat(view)+effects.reconDenial+effects.opponentAttrition:forwardValue(view,p)?.gain??0}}).filter(c=>c.value>0)
      .sort((a,b)=>b.value-a.value||a.p[0]-b.p[0]||a.p[1]-b.p[1]).slice(0,2)
    for(const {p} of ranked)if(validateAssetPlacement(ctx,kind,p).valid)filtered.push({actionId:`build-${kind}`,target:{kind:'campaign',id:'campaign'},placement:p,expectedLogistics:ctx.logistics})
  }
  return filtered
}
export function planPurchases(view:CpuPlanningView):ReturnType<typeof choosePackage> {
  const profile=CPU_PROFILES[view.cpu.difficulty],work:RouteWork={expansions:0,rejected:[]},all:TacticalPackage[]=[]
  const original=view, nextRound={...view,round:view.round+1}
  const threat = observedThreat(view)
  const workBudget = CPU_RESUPPLY_WORK_BUDGET[view.cpu.difficulty]
  const outOfBudget = () => all.length + (work.rankedRoutes ?? 0) >= workBudget
  type Node={ctx:SidePlanningContext;commands:EconomyCommand[];coverage:number;forward:number;reconDenial:number;opponentAttrition:number;rank:number}
  // Keep the adaptation search bounded as campaigns accumulate formations,
  // repairs, and construction options. The previous search carried every
  // unique successor into the next depth, so branching compounded each round.
  const beamWidth=Math.max(8,profile.purchases*3)
  const nodeValue=(node:Node)=>{
    const aircraftValue=node.ctx.formations.reduce((total,formation)=>{
      const roleValue=formation.role==='fighter'||formation.role==='bomber' ? .45 : .25
      const available=formation.aircraft>0&&formation.status!=='trapped'?1:0
      return total+roleValue*available*(formation.aircraft/Math.max(1,formation.maxAircraft))*(formation.strength??100)/100
    },0)
    const spent=view.cpu.logistics-node.ctx.logistics
    return node.coverage*threat+node.reconDenial+node.opponentAttrition+node.forward*.25+aircraftValue*.08-spent*.0005
  }
  const boundBeam=(nodes:Node[])=>{
    const ordered=nodes.sort((a,b)=>b.rank+nodeValue(b)-a.rank-nodeValue(a)||a.commands.length-b.commands.length||JSON.stringify(a.commands).localeCompare(JSON.stringify(b.commands)))
    const selected:Node[]=[],groups=new Set<string>()
    for(const node of ordered){
      const command=node.commands.at(-1),group=command?`${command.actionId}:${command.target.kind}:${command.target.id}:${command.placement?.join(',')??''}`:'save'
      if(groups.has(group))continue
      groups.add(group);selected.push(node)
      if(selected.length>=beamWidth)return selected
    }
    for(const node of ordered)if(!selected.includes(node)){selected.push(node);if(selected.length>=beamWidth)break}
    return selected
  }
  let beam:Node[]=[{ctx:view.context,commands:[],coverage:0,forward:0,reconDenial:0,opponentAttrition:0,rank:0}]
  // Keep complete repair sequences even when minor purchases outrank their
  // prefixes. A destroyed formation is replaced through the purchase catalog.
  const serviceSeeds=new Map<number,Node[]>()
  for(const formation of view.context.formations) {
    let node=beam[0]
    for(let count=1;count<=profile.purchases;count++) {
      const quote=economyQuotesFor(node.ctx,{kind:'squadron',id:formation.id})
        .filter(q=>q.eligible&&q.id==='repair-formation').sort((a,b)=>a.cost-b.cost||a.id.localeCompare(b.id))[0]
      if(!quote)break
      const command:EconomyCommand={actionId:quote.id,target:quote.target,expectedCost:quote.cost,expectedLogistics:node.ctx.logistics,expectedReserveAircraft:node.ctx.reserves}
      const ctx=executeEconomyCommand(node.ctx,command)
      if(ctx===node.ctx)break
      node={...node,ctx,commands:[...node.commands,command]}
      node.rank=nodeValue(node)
      serviceSeeds.set(count,[...(serviceSeeds.get(count)??[]),node])
    }
  }
  // Territory has no defensive effect by itself. Preserve a few complete paid
  // FOB + weapon capabilities before beam pruning, just like full restoration.
  // No future income, free weapon, aircraft Transit or hidden target is assumed.
  if(threat>0&&view.round<CAMPAIGN_ROUND_LIMIT) {
    const expansions:Node[]=[]
    const effectsByPlacement = new Map<string, ReturnType<typeof defenseBenefits>>()
    for(const placement of legalPlacements(view,'fob')) {
      const fob:EconomyCommand={actionId:'build-fob',target:{kind:'campaign',id:'campaign'},placement,expectedLogistics:view.context.logistics}
      const expanded=executeEconomyCommand(view.context,fob)
      if(expanded===view.context)continue
      const current=withContext(view,expanded)
      for(const kind of ['sam','aaa'] as const)for(const p of legalPlacements(current,kind,[placement])) {
        if(validateAssetPlacement(view.context,kind,p).valid)continue
        const key = `${kind}:${p}`
        let effects = effectsByPlacement.get(key)
        if (!effects) {
          effects = defenseBenefits(view, p, kind)
          effectsByPlacement.set(key, effects)
        }
        if(effects.coverage+effects.reconDenial+effects.opponentAttrition<=0)continue
        const command:EconomyCommand={actionId:`build-${kind}`,target:{kind:'campaign',id:'campaign'},placement:p,expectedLogistics:expanded.logistics}
        const ctx=executeEconomyCommand(expanded,command)
        if(ctx===expanded)continue
        expansions.push({ctx,commands:[fob,command],...effects,forward:0,rank:0})
      }
    }
    const value=(n:Node)=>n.coverage*threat+n.reconDenial+n.opponentAttrition
    expansions.sort((a,b)=>value(b)-value(a)||b.ctx.logistics-a.ctx.logistics||JSON.stringify(a.commands).localeCompare(JSON.stringify(b.commands)))
    serviceSeeds.set(2,[...(serviceSeeds.get(2)??[]),...expansions.slice(0,2).map(node=>({...node,rank:nodeValue(node)}))])
  }
  const utility=(p:TacticalPackage)=>Object.values(contribution(nextRound,p)).reduce((a,b)=>a+b,0)
  for(let depth=0;depth<=profile.purchases;depth++) {
    const seeds=serviceSeeds.get(depth)??[]
    for(const seed of seeds)if(!beam.some(n=>JSON.stringify(n.commands)===JSON.stringify(seed.commands)))beam.push(seed)
    beam=boundBeam(beam)
    const scored:Array<{node:Node;score:number}>=[]
    for(const node of beam) {
      // Finish each started scenario so the chooser always has complete,
      // validated packages, including the no-purchase baseline.
      if (outOfBudget()) break
      const current=withContext(nextRound,node.ctx)
      const options=generateActions(current,work).map(p=>({...p,id:`${node.commands.map(c=>c.actionId+':'+c.target.id+':'+c.placement).join('|')}/${p.id}`,purchases:node.commands,
        summary:`${node.commands.length?node.commands.map(c=>`${c.actionId}${c.placement?` at ${c.placement.map(n=>n.toFixed(1))}`:''}`).join(', ')+'. ':''}${p.summary}`,
        predicted:{...p.predicted,logisticsSpent:original.cpu.logistics-node.ctx.logistics,
          futureLogisticsIncome:node.commands.some(command=>command.actionId==='install-supply-depot')
            ? LOGISTICS_EFFECTS.supplyDepotIncome*Math.max(0,CAMPAIGN_ROUND_LIMIT-original.round)*(1-.75*threat):0,
          defenseCoverageGain:node.coverage,
          reconDenial:node.reconDenial,opponentAttrition:node.opponentAttrition,
          ownBaseRiskReduced:Math.min(1,p.predicted.ownBaseRiskReduced+node.coverage*threat*1.6),
          futureStrikeAccessGain:Math.max(p.predicted.futureStrikeAccessGain,node.forward),
          roundsUntilPayoff:node.forward>0?2:p.predicted.roundsUntilPayoff}}))
      all.push(...options)
      scored.push({node,score:Math.max(...options.map(utility))})
    }
    if(depth===profile.purchases||outOfBudget())break
    const successors=scored.sort((a,b)=>b.score-a.score).slice(0,view.cpu.difficulty==='hard'?4:view.cpu.difficulty==='medium'?3:2).flatMap(({node})=>{
      const current=withContext(view,node.ctx)
      return commands(current).flatMap(command=>{
        const next=executeEconomyCommand(node.ctx,command);if(next===node.ctx)return []
        const changesDefense=['build-sam','build-aaa','build-radar'].includes(command.actionId)
        const effects=changesDefense?defenseNetworkBenefits(current,next.assets):{coverage:0,reconDenial:0,opponentAttrition:0}
        const forward=command.actionId==='build-fob'&&command.placement?forwardValue(current,command.placement)?.gain??0:0
        const child:Node={ctx:next,commands:[...node.commands,command],coverage:node.coverage+effects.coverage,forward:Math.max(node.forward,forward),reconDenial:Math.min(1,node.reconDenial+effects.reconDenial),opponentAttrition:Math.min(1,node.opponentAttrition+effects.opponentAttrition),rank:scored.find(candidate=>candidate.node===node)?.score??0}
        child.rank+=nodeValue(child)
        return [child]
      })
    })
    // Equivalent purchase permutations must not consume all beam slots.
    const unique=new Map<string,Node>()
    for(const node of successors){
      const key=JSON.stringify([node.ctx.logistics,node.ctx.reserves,node.ctx.formations.map(f=>[f.id,f.aircraft,f.strength,f.status]),node.ctx.assets.map(a=>[a.kind,a.position,a.health,a.operational,a.upgrades]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))])
      if(!unique.has(key))unique.set(key,node)
    }
    beam=boundBeam([...unique.values()])
  }
  // Preserve an explicit save alternative even when all useful aircraft are grounded.
  const save=all.find(p=>p.purchases.length===0&&p.orders.every(o=>o.sortieOrdered===false))!
  save.id='save'
  const comeback = view.cpu.formations.every(formation => formation.aircraft <= 0)
    ? all.filter(candidate => candidate.purchases.some(command => command.actionId === 'buy-fighter' || command.actionId === 'buy-recon' || command.actionId === 'buy-bomber'))
    : []
  const decision = choosePackage(nextRound, comeback.length ? comeback : all, work.rejected, work.expansions, work.routeCache?.values())
  decision.trace.work.rankedRoutes = work.rankedRoutes ?? 0
  decision.trace.work.evaluatedPackages = all.length
  return decision
}
