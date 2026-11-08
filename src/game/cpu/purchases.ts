import { economyQuotesFor, executeEconomyCommand, validateAssetPlacement } from '../sideEconomy'
import type { SidePlanningContext } from '../sideContext'
import type { EconomyCommand, EconomyTarget } from '../types'
import type { CpuPlanningView } from './planningView'
import { generateActions } from './actions'
import { choosePackage, contribution } from './strategy'
import { CPU_PROFILES, type RouteWork } from './routes'
import { defenseCoverage, forwardValue, legalPlacements, observedThreat } from './placement'
import type { TacticalPackage } from './types'

function withContext(view:CpuPlanningView,ctx:SidePlanningContext):CpuPlanningView {
  return {...view,assets:ctx.assets,context:ctx,cpu:{...view.cpu,formations:ctx.formations,logistics:ctx.logistics,reserves:ctx.reserves}}
}
/** Re-quote each command on the current working copy, including placement/upgrade exclusivity. */
function commands(view:CpuPlanningView):EconomyCommand[] {
  const ctx=view.context, targets:EconomyTarget[]=[...ctx.formations.map(f=>({kind:'squadron' as const,id:f.id})),...ctx.assets.map(a=>({kind:'asset' as const,id:a.id}))]
  const result:EconomyCommand[]=targets.flatMap(target=>economyQuotesFor(ctx,target).filter(q=>q.eligible&&q.id!=='install-supply-depot').map(q=>({actionId:q.id,target,expectedCost:q.cost,expectedLogistics:ctx.logistics,expectedReserveAircraft:ctx.reserves})))
  // Supply Depot is evaluated as dominated: at most five +2 payouts cannot repay 12.
  // Maintenance Wing is considered only against concrete remaining eligible work.
  const work=ctx.formations.reduce((n,f)=>n+Math.min(ctx.reserves,f.maxAircraft-f.aircraft)+Math.ceil(Math.max(0,f.aircraft/f.maxAircraft*100-(f.strength??100))/25),0)
  const filtered=result.filter(c=>c.actionId!=='install-maintenance-wing'||work>12)
  for(const kind of ['sam','aaa','fob'] as const) {
    const ranked=legalPlacements(view,kind).map(p=>({p,value:kind==='fob'?forwardValue(view,p)?.gain??0:defenseCoverage(view,p,kind)*observedThreat(view)})).filter(c=>c.value>0)
      .sort((a,b)=>b.value-a.value||a.p[0]-b.p[0]||a.p[1]-b.p[1]).slice(0,2)
    for(const {p} of ranked)if(validateAssetPlacement(ctx,kind,p).valid)filtered.push({actionId:`build-${kind}`,target:{kind:'campaign',id:'campaign'},placement:p,expectedLogistics:ctx.logistics})
  }
  return filtered
}
export function planPurchases(view:CpuPlanningView):ReturnType<typeof choosePackage> {
  const profile=CPU_PROFILES[view.cpu.difficulty],work:RouteWork={expansions:0,rejected:[]},all:TacticalPackage[]=[]
  const original=view, nextRound={...view,round:view.round+1}
  type Node={ctx:SidePlanningContext;commands:EconomyCommand[];coverage:number;forward:number}
  let beam:Node[]=[{ctx:view.context,commands:[],coverage:0,forward:0}]
  const utility=(p:TacticalPackage)=>Object.values(contribution(nextRound,p)).reduce((a,b)=>a+b,0)
  for(let depth=0;depth<=profile.purchases;depth++) {
    const scored:Array<{node:Node;score:number}>=[]
    for(const node of beam) {
      const current=withContext(nextRound,node.ctx)
      const options=generateActions(current,work).map(p=>({...p,id:`${node.commands.map(c=>c.actionId+':'+c.target.id+':'+c.placement).join('|')}/${p.id}`,purchases:node.commands,
        summary:`${node.commands.length?node.commands.map(c=>`${c.actionId}${c.placement?` at ${c.placement.map(n=>n.toFixed(1))}`:''}`).join(', ')+'. ':''}${p.summary}`,
        predicted:{...p.predicted,logisticsSpent:original.cpu.logistics-node.ctx.logistics,defenseCoverageGain:node.coverage,
          ownBaseRiskReduced:Math.min(1,p.predicted.ownBaseRiskReduced+node.coverage*observedThreat(original)*1.6),
          futureStrikeAccessGain:Math.max(p.predicted.futureStrikeAccessGain,node.forward),
          roundsUntilPayoff:node.forward>0?2:p.predicted.roundsUntilPayoff}}))
      all.push(...options)
      scored.push({node,score:Math.max(...options.map(utility))})
    }
    if(depth===profile.purchases)break
    const successors=scored.sort((a,b)=>b.score-a.score).slice(0,view.cpu.difficulty==='hard'?4:view.cpu.difficulty==='medium'?3:2).flatMap(({node})=>{
      const current=withContext(view,node.ctx)
      return commands(current).flatMap(command=>{
        const next=executeEconomyCommand(node.ctx,command);if(next===node.ctx)return []
        const kind=command.actionId==='build-sam'?'sam':command.actionId==='build-aaa'?'aaa':undefined
        const coverage=kind&&command.placement?defenseCoverage(current,command.placement,kind):0
        const forward=command.actionId==='build-fob'&&command.placement?forwardValue(current,command.placement)?.gain??0:0
        return [{ctx:next,commands:[...node.commands,command],coverage:node.coverage+coverage,forward:Math.max(node.forward,forward)}]
      })
    })
    // Equivalent purchase permutations must not consume all beam slots. Keep
    // every bounded successor until its actual tactical package is evaluated.
    const unique=new Map<string,Node>()
    for(const node of successors){
      const key=JSON.stringify([node.ctx.logistics,node.ctx.reserves,node.ctx.formations.map(f=>[f.id,f.aircraft,f.strength,f.status]),node.ctx.assets.map(a=>[a.kind,a.position,a.health,a.operational,a.upgrades]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))])
      if(!unique.has(key))unique.set(key,node)
    }
    beam=[...unique.values()]
  }
  // Preserve an explicit save alternative even when all useful aircraft are grounded.
  const save=all.find(p=>p.purchases.length===0&&p.orders.every(o=>o.sortieOrdered===false))!
  save.id='save'
  return choosePackage(nextRound,all,work.rejected,work.expansions)
}
