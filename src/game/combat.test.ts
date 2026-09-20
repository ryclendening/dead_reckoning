import {describe,expect,it} from 'vitest'
import {calculateFighterHitProbability,calculateFighterSidePower,createFighterEngagementRecord,evaluateFighterNumericalAdvantage,evaluateFighterPositionalAdvantage,FIGHTER_SUSTAINED_GUN_HIT_PROBABILITY,resolveFighterHitProbability,selectFighterOpeningAttacker} from './combat'
import {MAX_FLIGHT_DISTANCE,resolveRound} from './engine'
import {fighterEngagementPresentationAt} from './engagementPresentation'
import {createScenario} from './scenarios'

const createTwoVsOneScenario=(weakFriendly=false)=>{
  const state=createScenario('fighter-2v1')
  if(weakFriendly)state.squadrons=state.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,strength:20}:squadron)
  return state
}

describe('fighter engagement records',()=>{
  it('represents a multi-phase engagement with participants grouped by side',()=>{
    const record=createFighterEngagementRecord({
      start:2,
      end:8,
      participants:[
        {id:'blue-one',side:'friendly',joinedAt:2,exitedAt:8,initialStrength:100,finalStrength:64,initialAircraft:4,finalAircraft:4,finalDisposition:'enroute'},
        {id:'blue-two',side:'friendly',joinedAt:5,exitedAt:8,initialStrength:100,finalStrength:82,initialAircraft:4,finalAircraft:4,finalDisposition:'enroute'},
        {id:'red-one',side:'hostile',joinedAt:2,exitedAt:8,initialStrength:100,finalStrength:0,initialAircraft:4,finalAircraft:0,finalDisposition:'destroyed'},
      ],
      phases:[
        {kind:'approach',start:2,end:3},
        {kind:'opening-fire',start:3,end:4},
        {kind:'merged',start:4,end:8},
        {kind:'resolved',start:8,end:8},
      ],
    })
    expect(record.sides).toEqual({friendly:['blue-one','blue-two'],hostile:['red-one']})
    expect(record.phases.map(phase=>phase.kind)).toEqual(['approach','opening-fire','merged','resolved'])
    expect(record.participants.find(participant=>participant.id==='blue-two')?.joinedAt).toBe(5)
  })

  it('records the current duel through the new schema without changing legacy replay fields',()=>{
    const result=resolveRound(createScenario('fighter-duel'))
    const sequence=result.combatSequences.find(item=>item.kind==='dogfight')
    expect(sequence?.kind).toBe('dogfight')
    if(!sequence||sequence.kind!=='dogfight')throw new Error('Expected fighter-duel to produce a dogfight.')
    expect(sequence.engagement.schemaVersion).toBe(1)
    expect(sequence.engagement.sides).toEqual({friendly:['viper'],hostile:['red-fighter']})
    expect(sequence.engagement.phases.map(phase=>phase.kind)).toEqual(['opening-fire','merged','resolved'])
    expect(sequence.engagement.positionalAssessments).toHaveLength(2)
    expect(sequence.engagement.positionalAssessments.map(assessment=>assessment.participantId)).toEqual(sequence.participantIds)
    expect(sequence.engagement.positionalAssessments.every(assessment=>assessment.evaluatedAt===sequence.start&&assessment.evaluation.usableHeadings)).toBe(true)
    expect(sequence.participantIds).toEqual([...sequence.engagement.sides.friendly,...sequence.engagement.sides.hostile])
    expect(sequence.engagement.participants.map(participant=>participant.finalDisposition)).toEqual(sequence.participantIds.map(id=>sequence.finalDisposition[id]))
    for(const participant of sequence.engagement.participants){
      const track=result.unitTracks.find(item=>item.unitId===participant.id)
      expect(track?.frames.filter(frame=>frame.mode==='dogfighting'&&frame.strength>0).every(frame=>frame.aircraft===participant.initialAircraft)).toBe(true)
    }
    expect(JSON.parse(JSON.stringify(sequence))).toEqual(sequence)
  })

  it('rejects duplicate participant identities',()=>{
    expect(()=>createFighterEngagementRecord({start:0,end:1,participants:[
      {id:'same',side:'friendly',joinedAt:0,exitedAt:1,initialStrength:100,finalStrength:100,initialAircraft:4,finalAircraft:4,finalDisposition:'enroute'},
      {id:'same',side:'hostile',joinedAt:0,exitedAt:1,initialStrength:100,finalStrength:0,initialAircraft:4,finalAircraft:0,finalDisposition:'destroyed'},
    ]})).toThrow(/unique/)
  })
})

describe('fighter positional geometry',()=>{
  const from=(participantPosition:[number,number],participantHeading:[number,number],opponentPosition:[number,number],opponentHeading:[number,number])=>evaluateFighterPositionalAdvantage({participantPosition,participantHeading,opponentPosition,opponentHeading})

  it('classifies a directly aligned rear-aspect approach as dominant',()=>{
    const result=from([0,0],[1,0],[1,0],[1,0])
    expect(result).toMatchObject({classification:'dominant',approachAlignment:1,targetRearAspect:1,score:1,usableHeadings:true})
  })

  it('keeps a head-on approach neutral for both formations',()=>{
    const first=from([0,0],[1,0],[1,0],[-1,0])
    const second=from([1,0],[-1,0],[0,0],[1,0])
    expect(first).toMatchObject({classification:'neutral',score:0})
    expect(second).toMatchObject({classification:'neutral',score:0})
  })

  it('recognizes a crossing-angle approach as favorable rather than dominant',()=>{
    const result=from([0,0],[1,0],[1,0],[0,1])
    expect(result).toMatchObject({classification:'favorable',approachAlignment:1,targetRearAspect:0,score:.5})
  })

  it('classifies the reversed tail-chase geometry as disadvantaged',()=>{
    const result=from([0,0],[1,0],[-1,0],[1,0])
    expect(result).toMatchObject({classification:'disadvantaged',approachAlignment:-1,targetRearAspect:-1,score:-1})
  })

  it('returns a safe neutral result for coincident positions or stationary headings',()=>{
    expect(from([0,0],[0,0],[1,0],[1,0])).toMatchObject({classification:'neutral',usableHeadings:false})
    expect(from([0,0],[1,0],[0,0],[1,0])).toMatchObject({classification:'neutral',usableHeadings:false})
  })
})

describe('fighter combat probabilities',()=>{
  it('preserves the neutral sustained gun hit chance without modifiers',()=>{
    expect(calculateFighterHitProbability({baseHitProbability:FIGHTER_SUSTAINED_GUN_HIT_PROBABILITY})).toEqual({
      baseHitProbability:.69,modifiers:[],unclampedHitProbability:.69,finalHitProbability:.69,
    })
  })

  it('records additive modifier sources and clamps stacked advantages',()=>{
    const result=calculateFighterHitProbability({baseHitProbability:.69,modifiers:[
      {source:'position',key:'dominant-position',delta:.18},
      {source:'numbers',key:'two-to-one',delta:.12},
      {source:'formation-condition',key:'fresh-formation',delta:.08},
    ]})
    expect(result.unclampedHitProbability).toBeCloseTo(1.07)
    expect(result.finalHitProbability).toBe(.9)
    expect(result.modifiers.map(modifier=>modifier.key)).toEqual(['dominant-position','two-to-one','fresh-formation'])
  })

  it('clamps disadvantaged attacks and resolves exact roll boundaries deterministically',()=>{
    const input={baseHitProbability:.2,modifiers:[{source:'position' as const,key:'disadvantaged-position',delta:-.3}]}
    expect(calculateFighterHitProbability(input).finalHitProbability).toBe(.1)
    expect(resolveFighterHitProbability(input,.099999).hit).toBe(true)
    expect(resolveFighterHitProbability(input,.1).hit).toBe(false)
  })

  it('records probability and numerical context for every ordinary dogfight exchange',()=>{
    const sequence=resolveRound(createScenario('fighter-duel')).combatSequences.find(item=>item.kind==='dogfight')
    if(!sequence||sequence.kind!=='dogfight')throw new Error('Expected fighter duel.')
    const ordinary=sequence.exchanges.filter(exchange=>exchange.phase==='merged'&&exchange.resolution==='probability')
    expect(ordinary.length).toBeGreaterThan(0)
    expect(ordinary.every(exchange=>exchange.probability?.modifiers[0]?.source==='numbers'&&exchange.numericalAssessment&&exchange.probability.finalHitProbability===Math.max(.1,Math.min(.9,.69+exchange.numericalAssessment.hitProbabilityDelta))&&exchange.hit===((exchange.probability.roll)<exchange.probability.finalHitProbability))).toBe(true)
    expect(sequence.exchanges.filter(exchange=>exchange.phase==='merged').every(exchange=>exchange.resolution==='probability')).toBe(true)
  })

  it('uses positional score for initiative and a seeded tie-break for neutral geometry',()=>{
    const neutral={classification:'neutral' as const,score:0,approachAlignment:0,targetRearAspect:0,usableHeadings:true}
    const favorable={...neutral,classification:'favorable' as const,score:.5}
    expect(selectFighterOpeningAttacker({id:'advantaged',evaluation:favorable},{id:'neutral',evaluation:neutral},.99)).toBe('advantaged')
    expect(selectFighterOpeningAttacker({id:'first',evaluation:neutral},{id:'second',evaluation:neutral},.2)).toBe('first')
    expect(selectFighterOpeningAttacker({id:'first',evaluation:neutral},{id:'second',evaluation:neutral},.8)).toBe('second')
  })

  it('records exactly one bounded opening missile before sustained combat',()=>{
    const result=resolveRound(createScenario('fighter-duel'))
    const sequence=result.combatSequences.find(item=>item.kind==='dogfight')
    if(!sequence||sequence.kind!=='dogfight')throw new Error('Expected fighter duel.')
    const opening=sequence.exchanges.filter(exchange=>exchange.phase==='opening-fire')
    expect(opening).toHaveLength(1)
    expect(opening[0]).toMatchObject({weapon:'air-to-air-missile',resolution:'probability'})
    expect(opening[0].probability?.modifiers).toHaveLength(1)
    expect(opening[0].probability?.modifiers[0].source).toBe('position')
    expect(opening[0].probability!.finalHitProbability).toBeGreaterThanOrEqual(.1)
    expect(opening[0].probability!.finalHitProbability).toBeLessThanOrEqual(.9)
    expect(sequence.engagement.phases.find(phase=>phase.kind==='opening-fire')?.end).toBe(sequence.engagement.phases.find(phase=>phase.kind==='merged')?.start)
    expect(result.weaponEffects.filter(effect=>effect.id.startsWith('weapon-opening-'))).toHaveLength(1)
  })

  it('resolves a lethal opening hit without adding a merged exchange',()=>{
    let lethal:ReturnType<typeof resolveRound>['combatSequences'][number]|undefined
    for(let seed=1;seed<=64&&!lethal;seed++){
      const state=createScenario('fighter-duel');state.seed=seed
      state.squadrons=state.squadrons.map(squadron=>squadron.id==='viper'?{...squadron,strength:20}:squadron)
      const sequence=resolveRound(state).combatSequences.find(item=>item.kind==='dogfight')
      const opening=sequence?.exchanges.find(exchange=>exchange.phase==='opening-fire')
      if(sequence?.kind==='dogfight'&&opening?.defenderId==='viper'&&opening.hit)lethal=sequence
    }
    expect(lethal?.kind).toBe('dogfight')
    if(!lethal||lethal.kind!=='dogfight')throw new Error('Expected a deterministic lethal opening-fire fixture.')
    expect(lethal.engagement.phases.map(phase=>phase.kind)).toEqual(['opening-fire','resolved'])
    expect(lethal.exchanges).toHaveLength(1)
    expect(lethal.finalDisposition.viper).toBe('destroyed')
  })

  it('repeats the same probability records and outcomes for the same scenario seed',()=>{
    const dogfight=(result:ReturnType<typeof resolveRound>)=>result.combatSequences.find(item=>item.kind==='dogfight')
    expect(dogfight(resolveRound(createScenario('fighter-duel')))?.exchanges).toEqual(dogfight(resolveRound(createScenario('fighter-duel')))?.exchanges)
  })
})

describe('fighter numerical advantage',()=>{
  it('converts living authoritative strength into bounded force-ratio tiers',()=>{
    expect(calculateFighterSidePower([{strength:100}])).toBe(1)
    expect(calculateFighterSidePower([{strength:100},{strength:100}])).toBe(2)
    expect(evaluateFighterNumericalAdvantage(2,1)).toMatchObject({forceRatio:2,classification:'overwhelming',hitProbabilityDelta:.1})
    expect(evaluateFighterNumericalAdvantage(1,2)).toMatchObject({forceRatio:.5,classification:'overmatched',hitProbabilityDelta:-.1})
    expect(evaluateFighterNumericalAdvantage(0,0)).toMatchObject({forceRatio:1,classification:'even',hitProbabilityDelta:0})
  })

  it('uses current damaged power and remains symmetric around parity',()=>{
    expect(evaluateFighterNumericalAdvantage(1.3,1)).toMatchObject({classification:'advantaged',hitProbabilityDelta:.05})
    expect(evaluateFighterNumericalAdvantage(.75,1)).toMatchObject({classification:'disadvantaged',hitProbabilityDelta:-.05})
    expect(evaluateFighterNumericalAdvantage(1,1).hitProbabilityDelta).toBe(0)
    expect(Number.isFinite(evaluateFighterNumericalAdvantage(1,0).forceRatio)).toBe(true)
  })
})

describe('shared multi-formation fighter engagements',()=>{
  it('records a deterministic 2v1 as one authoritative engagement with one hostile participant',()=>{
    const result=resolveRound(createTwoVsOneScenario())
    const dogfights=result.combatSequences.filter(sequence=>sequence.kind==='dogfight')
    expect(dogfights).toHaveLength(1)
    const sequence=dogfights[0]
    if(sequence.kind!=='dogfight')throw new Error('Expected shared dogfight.')
    expect(sequence.engagement.sides).toEqual({friendly:['viper','falcon'],hostile:['red-fighter']})
    expect(new Set(sequence.participantIds).size).toBe(3)
    expect(sequence.engagement.participants).toHaveLength(3)
    expect(sequence.exchanges.every(exchange=>sequence.participantIds.includes(exchange.attackerId)&&sequence.participantIds.includes(exchange.defenderId))).toBe(true)
    expect(sequence.engagement.participants.filter(participant=>participant.id==='red-fighter')).toHaveLength(1)
    const merged=sequence.exchanges.filter(exchange=>exchange.phase==='merged'&&exchange.resolution==='probability')
    expect(merged.some(exchange=>exchange.numericalAssessment?.classification==='overwhelming')).toBe(true)
    expect(merged.some(exchange=>exchange.probability?.modifiers.some(modifier=>modifier.source==='numbers'))).toBe(true)
    const numericalExchange=merged.find(exchange=>exchange.numericalAssessment?.classification==='overwhelming')!
    expect(fighterEngagementPresentationAt(sequence,numericalExchange.time+.01)).toMatchObject({friendlyCount:2,hostileCount:1,label:'2V1 DOGFIGHT',numericalCue:'FRIENDLY ADVANTAGE'})
  })

  it('derives a clear presentation timeline without changing the engagement record',()=>{
    const sequence=resolveRound(createScenario('fighter-duel')).combatSequences.find(item=>item.kind==='dogfight')
    if(!sequence||sequence.kind!=='dogfight')throw new Error('Expected fighter duel.')
    const serialized=JSON.stringify(sequence)
    const opening=sequence.exchanges.find(exchange=>exchange.phase==='opening-fire')!
    const merged=sequence.engagement.phases.find(phase=>phase.kind==='merged')!
    const assessment=sequence.engagement.positionalAssessments.find(item=>item.participantId===opening.attackerId)!
    expect(fighterEngagementPresentationAt(sequence,sequence.start+.13)).toMatchObject({stage:'opening-fire',label:'OPENING FIRE',eventCue:'FIRST STRIKE',contextCue:`${assessment.classification.toUpperCase()} POSITION`})
    expect(fighterEngagementPresentationAt(sequence,opening.time+.08)).toMatchObject({stage:'opening-fire',label:'OPENING FIRE',eventCue:opening.hit?'HIT':'MISS'})
    expect(fighterEngagementPresentationAt(sequence,merged.start+.4)).toMatchObject({stage:'merged',label:'1V1 DOGFIGHT',eventCue:'MERGE'})
    expect(fighterEngagementPresentationAt(sequence,sequence.end+.2)).toMatchObject({stage:'resolved',label:'ENGAGEMENT RESOLVED',eventCue:'DOGFIGHT ENDS'})
    expect(JSON.stringify(sequence)).toBe(serialized)
  })

  it('shows deterministic 2v1 balance improvement across matched seed cohorts',()=>{
    const cohort=(scenario:'fighter-duel'|'fighter-2v1')=>Array.from({length:128},(_,offset)=>{
      const state=createScenario(scenario);state.seed=offset+1
      const sequence=resolveRound(state).combatSequences.find(item=>item.kind==='dogfight')
      const mergedExchanges=sequence?.kind==='dogfight'?sequence.exchanges.filter(exchange=>exchange.phase==='merged'&&exchange.probability):[]
      return sequence?.kind==='dogfight'?{friendlyWin:sequence.finalDisposition['red-fighter']==='destroyed',merged:sequence.engagement.phases.some(phase=>phase.kind==='merged'),duration:sequence.end-(sequence.engagement.phases.find(phase=>phase.kind==='merged')?.start??sequence.start),maximumProbability:Math.max(...mergedExchanges.map(exchange=>exchange.probability!.finalHitProbability),0)}:undefined
    }).filter((result):result is {friendlyWin:boolean;merged:boolean;duration:number;maximumProbability:number}=>!!result&&result.merged)
    const duel=cohort('fighter-duel'),twoVsOne=cohort('fighter-2v1')
    const winRate=(results:{friendlyWin:boolean}[])=>results.filter(result=>result.friendlyWin).length/results.length
    const averageDuration=(results:{duration:number}[])=>results.reduce((total,result)=>total+result.duration,0)/results.length
    expect(twoVsOne.length).toBeGreaterThan(100)
    expect(winRate(twoVsOne)).toBeGreaterThanOrEqual(winRate(duel)+.1)
    expect(averageDuration(twoVsOne)).toBeGreaterThan(0)
    expect(Math.max(...twoVsOne.map(result=>result.maximumProbability))).toBeLessThanOrEqual(.8)
  })

  it('admits the second fighter only after it reaches the active engagement',()=>{
    const result=resolveRound(createTwoVsOneScenario())
    const sequence=result.combatSequences.find(item=>item.kind==='dogfight')
    if(!sequence||sequence.kind!=='dogfight')throw new Error('Expected shared dogfight.')
    const lateArrival=sequence.engagement.participants.find(participant=>participant.id==='falcon')!
    expect(lateArrival.joinedAt).toBeGreaterThan(sequence.start)
    expect(result.events.some(event=>event.title==='FIGHTER JOINS DOGFIGHT'&&event.detail.includes('FALCON'))).toBe(true)
    const track=result.unitTracks.find(item=>item.unitId==='falcon')!
    const engagedFrames=track.frames.filter(frame=>frame.mode==='dogfighting')
    expect(engagedFrames.length).toBeGreaterThan(1)
    expect(engagedFrames.every(frame=>frame.traveledDistance===engagedFrames[0].traveledDistance)).toBe(true)
    const beforeJoin=[...track.frames].reverse().find(frame=>frame.time<lateArrival.joinedAt)!
    expect(Math.hypot(engagedFrames[0].position[0]-beforeJoin.position[0],engagedFrames[0].position[1]-beforeJoin.position[1])).toBeLessThan(.4)
    expect(fighterEngagementPresentationAt(sequence,lateArrival.joinedAt+.08)).toMatchObject({label:'OPENING FIRE',eventCue:'FIGHTER JOINS',contextCue:'2V1 FORMATIONS'})
  })

  it('continues after one participant is destroyed and releases every survivor at final resolution',()=>{
    let sequence:Extract<ReturnType<typeof resolveRound>['combatSequences'][number],{kind:'dogfight'}>|undefined
    let result:ReturnType<typeof resolveRound>|undefined
    for(let seed=1;seed<=64&&!sequence;seed++){
      const state=createTwoVsOneScenario(true);state.seed=seed
      const candidateResult=resolveRound(state);const candidate=candidateResult.combatSequences.find(item=>item.kind==='dogfight')
      if(candidate?.kind==='dogfight'){
        const earlyFriendlyLoss=candidate.engagement.participants.find(participant=>participant.side==='friendly'&&participant.finalDisposition==='destroyed'&&participant.exitedAt<candidate.end)
        const friendlySurvivor=candidate.engagement.participants.find(participant=>participant.side==='friendly'&&participant.finalDisposition==='enroute')
        if(earlyFriendlyLoss&&friendlySurvivor){sequence=candidate;result=candidateResult}
      }
    }
    expect(sequence).toBeDefined()
    if(!sequence||!result)throw new Error('Expected deterministic participant-loss fixture.')
    const loss=sequence.engagement.participants.find(participant=>participant.side==='friendly'&&participant.finalDisposition==='destroyed')!
    const lethalExchange=sequence.exchanges.find(exchange=>exchange.defenderId===loss.id&&exchange.targetStrength<=0)
    expect(lethalExchange).toMatchObject({resolution:'probability',phase:'merged'})
    expect(lethalExchange?.probability).toBeDefined()
    expect(fighterEngagementPresentationAt(sequence,loss.exitedAt+.01)).toMatchObject({friendlyCount:1,hostileCount:1,label:'1V1 DOGFIGHT'})
    expect(fighterEngagementPresentationAt(sequence,loss.exitedAt+.08)).toMatchObject({eventCue:'FORMATION LOST'})
    expect(sequence.exchanges.some(exchange=>exchange.time>loss.exitedAt)).toBe(true)
    const survivors=sequence.engagement.participants.filter(participant=>participant.finalDisposition!=='destroyed')
    expect(survivors.every(participant=>participant.exitedAt===sequence.end)).toBe(true)
    for(const survivor of survivors){
      const track=result.unitTracks.find(item=>item.unitId===survivor.id)!
      expect(track.frames.some(frame=>frame.time>sequence.end&&frame.mode!=='dogfighting')).toBe(true)
    }
  })
})

describe('Issue 11 integration evidence',()=>{
  const dogfightFor=(scenario:'fighter-tail'|'fighter-head-on'|'fighter-reversed',seed:number)=>{
    const state=createScenario(scenario);state.seed=seed
    const sequence=resolveRound(state).combatSequences.find(item=>item.kind==='dogfight')
    if(!sequence||sequence.kind!=='dogfight')throw new Error(`Expected a dogfight for ${scenario}.`)
    const opening=sequence.exchanges.find(exchange=>exchange.phase==='opening-fire')
    if(!opening?.probability)throw new Error(`Expected recorded opening probability for ${scenario}.`)
    return {sequence,opening}
  }

  it('shows bounded positional opening-fire effects across matched deterministic cohorts',()=>{
    const cohort=(scenario:'fighter-tail'|'fighter-head-on'|'fighter-reversed')=>Array.from({length:128},(_,offset)=>dogfightFor(scenario,offset+1))
    const tail=cohort('fighter-tail'),headOn=cohort('fighter-head-on'),reversed=cohort('fighter-reversed')
    const hitRate=(items:typeof tail)=>items.filter(item=>item.opening.hit).length/items.length
    expect(tail.every(item=>item.opening.attackerId==='viper'&&item.opening.probability!.finalHitProbability===.76)).toBe(true)
    expect(headOn.every(item=>item.opening.probability!.finalHitProbability===.58)).toBe(true)
    expect(reversed.every(item=>item.opening.attackerId==='red-fighter'&&item.opening.probability!.finalHitProbability===.76)).toBe(true)
    expect(hitRate(tail)).toBeGreaterThan(hitRate(headOn)+.08)
    expect(Math.max(...[...tail,...headOn,...reversed].map(item=>item.opening.probability!.finalHitProbability))).toBeLessThanOrEqual(.9)
  })

  it('preserves mission responsibility, sensor authority, fixed speed, fuel, and replay determinism around a merge',()=>{
    const state=createScenario('fighter-tail'),first=resolveRound(state),second=resolveRound(structuredClone(state))
    expect(JSON.parse(JSON.stringify(first))).toEqual(JSON.parse(JSON.stringify(second)))
    const sequence=first.combatSequences.find(item=>item.kind==='dogfight')
    if(!sequence||sequence.kind!=='dogfight')throw new Error('Expected a dogfight.')
    expect(first.contactIntervals.some(interval=>interval.observerId==='viper'&&interval.targetId==='red-fighter'&&interval.source==='visual'&&interval.start<=sequence.start)).toBe(true)
    const track=first.unitTracks.find(item=>item.unitId==='viper')!
    const dogfighting=track.frames.filter(frame=>frame.mode==='dogfighting')
    expect(dogfighting.length).toBeGreaterThan(1)
    expect(dogfighting.every(frame=>frame.traveledDistance===dogfighting[0].traveledDistance)).toBe(true)
    expect(track.frames.every((frame,index)=>index===0||Math.hypot(frame.position[0]-track.frames[index-1].position[0],frame.position[1]-track.frames[index-1].position[1])<=MAX_FLIGHT_DISTANCE.fighter*(frame.time-track.frames[index-1].time)+.001)).toBe(true)
    expect(track.frames.every(frame=>frame.traveledDistance<=MAX_FLIGHT_DISTANCE.fighter+.001)).toBe(true)
    expect(track.frames.some(frame=>frame.time>sequence.end&&frame.mode!=='dogfighting')).toBe(true)
  })
})
