#!/usr/bin/env node
// Empires game state helper. Every command writes game-state.json before printing.
// Usage: node gm.mjs <command> [args]   (run `node gm.mjs help`)

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const STATE = join(HERE, 'game-state.json')
const TEMPLATE = join(HERE, 'game-state.template.json')
const QUESTIONS = join(HERE, 'data', 'questions.json')

const HISTORY_CAP = 20

// Snapshot of the state as it was last read, minus history, so write() can push
// the pre-change state for undo. Read only commands never call write(), so they
// never add a history entry.
let snapshot = null

function read() {
  const s = JSON.parse(readFileSync(STATE, 'utf8'))
  if (!Array.isArray(s.history)) s.history = []
  const { history, ...rest } = s
  snapshot = JSON.stringify(rest)
  return s
}

const readQuestions = () => JSON.parse(readFileSync(QUESTIONS, 'utf8')).questions

function write(s, note, record = true) {
  if (record && snapshot) {
    s.history.push(JSON.parse(snapshot))
    if (s.history.length > HISTORY_CAP) s.history = s.history.slice(-HISTORY_CAP)
  }
  s.updatedAt = new Date().toISOString()
  if (note) s.log.push({ at: s.updatedAt, note })
  writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n')
}

function team(s, key) {
  const k = String(key).toLowerCase()
  const t = s.teams.find(
    (t) => t.id === k || t.name.toLowerCase() === k || t.empire.toLowerCase() === k || t.id.endsWith(`-${k}`),
  )
  if (!t) die(`no team matching "${key}". Teams: ${s.teams.map((t) => t.id).join(', ')}`)
  return t
}

const die = (msg) => {
  console.error(`error: ${msg}`)
  process.exit(1)
}

const powersLeft = (t) => 3 - Object.values(t.powersUsed).filter(Boolean).length
const total = (t) => t.points.leg1 + t.points.leg2 + (t.tiebreak || 0)

function ranked(s) {
  const inLeg3 = s.status === 'leg3'
  return [...s.teams].sort((a, b) =>
    inLeg3 ? (b.leg3.island ?? 0) - (a.leg3.island ?? 0) || total(b) - total(a) : total(b) - total(a),
  )
}

// Teams level on the sort key across a boundary where the reward changes.
// Returns the tied pairs so the caller can refuse rather than pick by array order.
function boundaryTies(order, separated, rewardAt) {
  const tied = []
  for (let i = 0; i + 1 < order.length; i++) {
    if (rewardAt(i) === rewardAt(i + 1)) continue
    if (!separated(order[i], order[i + 1])) tied.push([order[i], order[i + 1]])
  }
  return tied
}

function refuseTie(tied, what) {
  console.log(`REFUSED. Level on ${what} where it changes the reward:`)
  tied.forEach(([a, b]) => console.log(`  ${a.name} and ${b.name}`))
  console.log('Run a putt off, record it, then enter this again:')
  tied.forEach(([a, b]) => console.log(`  node gm.mjs puttoff <${a.id} or ${b.id}> <the other>`))
}

function standings(s, next) {
  const leg = s.status === 'leg2' ? 2 : s.status === 'leg3' ? 3 : 1
  const round = leg === 1 ? s.leg1.round : leg === 2 ? s.leg2.handsPlayed : s.leg3.questionsAsked.length
  const lines = [`LEG ${leg} | Round ${round}`]
  ranked(s).forEach((t, i) => {
    lines.push(
      `${i + 1}. ${t.name} ${t.empire}  pts: ${total(t).toFixed(1)}  powers left: ${powersLeft(t)}`,
    )
  })
  lines.push(`NEXT: ${next || s.next || 'waiting on the referee'}`)
  console.log(lines.join('\n'))
}

const cmds = {
  help() {
    console.log(`Empires GM

  state                             print the whole state file
  standings ["next line"]           print the standings block
  undo                              take back the last change, up to 20 deep
  reset [--hard] [--yes]            new night: clears scores, keeps teams unless --hard

  name <team> "<new name>"          replace a placeholder team name
  players <team> "A, B, C"          replace placeholder players
  excuse "<player>"                 drop a player from all drink penalties, permanently
  station-game <coinage|cupflip>    record which pub game Station C is
  penalty <on|off>                  drink penalty switch

  round <1st> <2nd> [rest...]       leg 1 finishing order: 1, 0.5, 0
  round <team>=<place> ...          same, with dead heats: a=1 b=1 c=3 splits 0.75 each
  puttoff <winner> <loser>          settle a dead heat the scoring cannot split
  power <team> <leg1|leg2|leg3>     log a power as spent, refused if already spent this leg

  leg2 start                        lock leg 1, deal starting tokens (10 + 2 per point)
  buyin <team>                      record a buy back in: drink, +3 tokens
  hand                              mark a hand played
  leg2 end <team>=<tokens> ...      final counts, converts to 2 / 1 / 0 points

  leg3 start                        set starting islands from total points
  ask [empire]                      read out the next question, balanced by tag
  correct <team>                    right answer, moves 1 island, 2 on own empire
  wrong <team>                      out of this question and the next, back 1 on own empire
  lava <team>                       touched the floor: back one island plus a fixed measure
  win <team>                        reached the plinth, ends the night`)
  },

  state() {
    console.log(JSON.stringify(read(), null, 2))
  },

  standings(next) {
    standings(read(), next)
  },

  undo() {
    const s = read()
    if (!s.history.length) {
      console.log('Nothing to undo. History is empty.')
      return
    }
    const prev = s.history[s.history.length - 1]
    const undone = s.log.length ? s.log[s.log.length - 1].note : 'the last change'
    const restored = { ...prev, history: s.history.slice(0, -1) }
    write(restored, null, false)
    console.log(`Undone: ${undone}`)
    standings(restored, `undone: ${undone}`)
  },

  reset(...flags) {
    const hard = flags.includes('--hard')
    const yes = flags.includes('--yes')
    const bad = flags.find((f) => !['--hard', '--yes'].includes(f))
    if (bad) die(`unknown flag "${bad}". reset [--hard] [--yes]`)
    const s = read()
    const tpl = JSON.parse(readFileSync(TEMPLATE, 'utf8'))
    const blank = tpl.teams[0]
    const teams = hard
      ? JSON.parse(JSON.stringify(tpl.teams))
      : s.teams.map((t) => ({
          ...JSON.parse(JSON.stringify(blank)),
          id: t.id,
          name: t.name,
          players: t.players,
          empire: t.empire,
          power: t.power,
          placeholder: t.placeholder,
        }))
    const next = {
      ...JSON.parse(JSON.stringify(tpl)),
      teams,
      config: hard ? JSON.parse(JSON.stringify(tpl.config)) : JSON.parse(JSON.stringify(s.config)),
      history: [],
    }
    const keeps = hard
      ? 'nothing, this is a hard reset back to the template'
      : `team names, players, empires and powers (${s.teams.map((t) => `${t.name} ${t.empire}`).join(', ')}), and the whole config block`
    const clears = 'all points, tokens, buy ins, powers used, islands, questions asked, the log and the undo history'
    console.log(`reset${hard ? ' --hard' : ''} would KEEP: ${keeps}`)
    console.log(`reset${hard ? ' --hard' : ''} would CLEAR: ${clears}`)
    if (!yes) {
      console.log('\nNothing has changed. Re-run with --yes to go ahead.')
      return
    }
    write(next, `reset${hard ? ' --hard' : ''}: state rebuilt from the template`)
    console.log('\nDone. Fresh state.')
    standings(next, hard ? 'set up teams, then play' : 'teams are still set, run: gm.mjs round <1st> <2nd> ...')
  },

  name(key, ...rest) {
    const s = read()
    const t = team(s, key)
    const was = t.name
    t.name = rest.join(' ') || die('give a name')
    t.placeholder = false
    s.config.placeholderTeams = s.teams.some((t) => t.placeholder)
    write(s, `${was} renamed to ${t.name}`)
    standings(s)
  },

  players(key, ...rest) {
    const s = read()
    const t = team(s, key)
    t.players = rest.join(' ').split(',').map((p) => p.trim()).filter(Boolean)
    if (!t.players.length) die('give at least one player')
    write(s, `${t.name} players set: ${t.players.join(', ')}`)
    console.log(`${t.name} (${t.empire}): ${t.players.join(', ')}`)
  },

  excuse(...rest) {
    const s = read()
    const who = rest.join(' ').trim() || die('name the player')
    if (!s.config.excusedFromDrinks.includes(who)) s.config.excusedFromDrinks.push(who)
    write(s, `${who} is out of all drink penalties for the night`)
    console.log(`${who} is out of the drinking. It will not come up again.`)
  },

  'station-game'(kind) {
    const s = read()
    if (!['coinage', 'cupflip'].includes(kind)) die('coinage or cupflip')
    s.config.stationCGame = kind
    write(s, `Station C is ${kind}`)
    console.log(`Station C: ${kind}`)
  },

  penalty(onOff) {
    const s = read()
    if (!['on', 'off'].includes(onOff)) die('on or off')
    s.config.drinkPenalty = onOff === 'on'
    write(s, `drink penalty ${onOff}`)
    console.log(`Drink penalty ${onOff}. Measure stays fixed: ${s.config.fixedMeasure}.`)
  },

  round(...order) {
    const s = read()
    if (!order.length) die('give the finishing order, first to last')
    const explicit = order.some((a) => a.includes('='))
    if (explicit && !order.every((a) => a.includes('='))) {
      die('mixed forms. Either bare order "round a b c", or places "round a=1 b=1 c=3"')
    }
    // groups[0] is the best place, and a group with more than one team is a dead heat
    let groups
    if (explicit) {
      const byPlace = new Map()
      order.forEach((arg) => {
        const [k, p] = arg.split('=')
        const place = Number(p)
        if (!Number.isFinite(place)) die(`bad place in "${arg}", use team=place`)
        if (!byPlace.has(place)) byPlace.set(place, [])
        byPlace.get(place).push(team(s, k))
      })
      groups = [...byPlace.keys()].sort((a, b) => a - b).map((p) => byPlace.get(p))
    } else {
      groups = order.map((k) => [team(s, k)])
    }
    const flat = groups.flat()
    if (new Set(flat.map((t) => t.id)).size !== flat.length) die('a team is listed twice')

    const pointsForPlace = (place) => (place === 1 ? 1 : place === 2 ? 0.5 : 0)
    s.status = 'leg1'
    s.leg1.round += 1
    const awards = []
    let place = 1
    groups.forEach((g) => {
      // a dead heat splits the points for every place the tied teams occupy
      const pot = g.reduce((sum, _, i) => sum + pointsForPlace(place + i), 0)
      const share = pot / g.length
      g.forEach((t) => {
        t.points.leg1 += share
        t.points.total = total(t)
      })
      awards.push(`${g.map((t) => t.name).join(' = ')} ${share}`)
      place += g.length
    })
    s.leg1.results.push({
      round: s.leg1.round,
      order: flat.map((t) => t.id),
      places: groups.map((g) => g.map((t) => t.id)),
    })
    write(s, `leg 1 round ${s.leg1.round}: ${awards.join(', ')}`)
    if (groups.some((g) => g.length > 1)) console.log(`Dead heat split: ${awards.join(', ')}`)
    const more = s.leg1.round < s.leg1.roundsTotal
    standings(s, more ? `rotate stations, run round ${s.leg1.round + 1}` : 'leg 1 done, run: gm.mjs leg2 start')
  },

  puttoff(winnerKey, loserKey) {
    const s = read()
    if (!winnerKey || !loserKey) die('puttoff <winner> <loser>')
    const w = team(s, winnerKey)
    const l = team(s, loserKey)
    if (w.id === l.id) die('the winner and the loser have to be different teams')
    w.tiebreak = Number(((w.tiebreak || 0) + 0.01).toFixed(4))
    w.points.total = total(w)
    write(s, `putt off: ${w.name} beat ${l.name}`)
    console.log(`Putt off: ${w.name} beat ${l.name}. ${w.name} now sorts above ${l.name} on a level score.`)
    standings(s, 'enter the result that was tied again')
  },

  power(key, leg) {
    const s = read()
    const t = team(s, key)
    if (!['leg1', 'leg2', 'leg3'].includes(leg)) die('leg1, leg2 or leg3')
    if (t.powersUsed[leg]) {
      console.log(`REFUSED. ${t.name} already spent the ${t.empire} power in ${leg}. One per leg.`)
      return
    }
    t.powersUsed[leg] = true
    write(s, `${t.name} used the ${t.empire} power in ${leg}`)
    console.log(`${t.name} plays ${t.empire}.`)
    console.log(`POWER: ${t.power}`)
    if (t.empire === 'Vikings') {
      const leader = ranked(s)[0]
      console.log(
        leader.id === t.id
          ? `Current leader is ${leader.name}, which is you. Nothing to steal from yourself.`
          : `Current leader is ${leader.name} ${leader.empire}. That is who loses the point or token.`,
      )
    }
    console.log('LOG ONLY. Apply the effect at the table by hand, gm.mjs does not move anything for it.')
    standings(s)
  },

  leg2(sub, ...rest) {
    const s = read()
    if (sub === 'start') {
      s.status = 'leg2'
      s.teams.forEach((t) => {
        t.leg2.tokens = s.leg2.startingTokensBase + s.leg2.tokensPerLeg1Point * t.points.leg1
      })
      s.leg2.startingTokensSet = true
      write(s, 'leg 2 opened, starting tokens dealt')
      console.log(
        s.teams
          .map((t) => `${t.name} ${t.empire}: ${t.leg2.tokens} tokens (10 + 2 x ${t.points.leg1})`)
          .join('\n'),
      )
      standings(s, 'deal three hole cards each, two up one down, play hand 1 of 6')
      return
    }
    if (sub === 'end') {
      if (!rest.length) die('give final counts like team-1=14 team-2=6')
      rest.forEach((pair) => {
        const [k, n] = pair.split('=')
        if (n === undefined) die(`bad pair "${pair}", use team=tokens`)
        team(s, k).leg2.tokens = Number(n)
      })
      const order = [...s.teams].sort(
        (a, b) => b.leg2.tokens - a.leg2.tokens || (b.tiebreak || 0) - (a.tiebreak || 0),
      )
      const rewardAt = (i) => (i === 0 ? 2 : i === 1 ? 1 : 0)
      const tied = boundaryTies(
        order,
        (a, b) => a.leg2.tokens !== b.leg2.tokens || (a.tiebreak || 0) !== (b.tiebreak || 0),
        rewardAt,
      )
      if (tied.length) {
        refuseTie(tied, 'tokens')
        return
      }
      order.forEach((t, i) => {
        t.points.leg2 = rewardAt(i)
        t.points.total = total(t)
      })
      s.leg2.handsPlayed = s.leg2.handsTotal
      write(s, `leg 2 closed: ${order.map((t) => `${t.name} ${t.leg2.tokens}`).join(', ')}`)
      standings(s, 'leg 2 done, run: gm.mjs leg3 start')
      return
    }
    die('leg2 start | leg2 end <team>=<tokens> ...')
  },

  buyin(key) {
    const s = read()
    const t = team(s, key)
    t.leg2.buyIns += 1
    t.leg2.tokens += 3
    write(s, `${t.name} bought back in (${t.leg2.buyIns} total)`)
    console.log(`${t.name} drinks and buys back in for 3 tokens. Now ${t.leg2.tokens}. Buy ins: ${t.leg2.buyIns}.`)
  },

  hand() {
    const s = read()
    s.leg2.handsPlayed = Math.min(s.leg2.handsPlayed + 1, s.leg2.handsTotal)
    write(s, `hand ${s.leg2.handsPlayed} of ${s.leg2.handsTotal} played`)
    const left = s.leg2.handsTotal - s.leg2.handsPlayed
    standings(s, left ? `deal hand ${s.leg2.handsPlayed + 1} of ${s.leg2.handsTotal}` : 'six hands played, run: gm.mjs leg2 end <team>=<tokens> ...')
  },

  leg3(sub) {
    const s = read()
    if (sub !== 'start') die('leg3 start')
    s.status = 'leg3'
    const order = [...s.teams].sort((a, b) => total(b) - total(a))
    const islandAt = (i) => (i === 0 ? 3 : i === 1 ? 2 : 1)
    const tied = boundaryTies(order, (a, b) => total(a) !== total(b), islandAt)
    if (tied.length) {
      refuseTie(tied, 'total points')
      return
    }
    order.forEach((t, i) => {
      t.leg3.island = islandAt(i)
      t.leg3.lockedOutFrom = null
      t.leg3.wrongOn = null
    })
    write(s, `leg 3 opened: ${order.map((t) => `${t.name} island ${t.leg3.island}`).join(', ')}`)
    console.log(order.map((t) => `${t.name} ${t.empire}: start on island ${t.leg3.island}`).join('\n'))
    standings(s, 'floor is lava, run: gm.mjs ask')
  },

  ask(forced) {
    const s = read()
    const asked = new Set(s.leg3.questionsAsked)
    const pool = readQuestions().filter((q) => !asked.has(q.id))
    if (!pool.length) die('question bank is empty for tonight')
    const inPlay = s.teams.map((t) => t.empire)
    const counts = Object.fromEntries(inPlay.map((e) => [e, 0]))
    readQuestions().forEach((q) => {
      if (asked.has(q.id) && q.empire in counts) counts[q.empire] += 1
    })
    let empire = forced
    if (empire) {
      // only empires actually in play tonight, so a typo is not silently answered
      const match = inPlay.find((e) => e.toLowerCase() === String(empire).toLowerCase())
      if (!match) die(`no empire "${empire}" in play tonight. In play: ${inPlay.join(', ')}`)
      empire = match
      if (!pool.some((q) => q.empire === match)) die(`every ${match} question has been asked already`)
    }
    if (!empire) {
      const starved = inPlay.sort((a, b) => counts[a] - counts[b])[0]
      empire = pool.some((q) => q.empire === starved) ? starved : pool[0].empire
    }
    const matches = pool.filter((x) => x.empire.toLowerCase() === String(empire).toLowerCase())
    const from = matches.length ? matches : pool
    const q = from[Math.floor(Math.random() * from.length)]
    s.leg3.currentQuestion = q.id
    s.leg3.questionsAsked.push(q.id)
    const index = s.leg3.questionsAsked.length - 1
    const barred = s.teams.filter((t) => t.leg3.lockedOutFrom === index)
    write(s, `asked ${q.id} (${q.empire})`)
    const owner = s.teams.find((t) => t.empire === q.empire)
    console.log(`[${q.empire}]${owner ? ` — ${owner.name}'s empire, two islands if they get it` : ''}`)
    if (barred.length) console.log(`LOCKED OUT of this one: ${barred.map((t) => t.name).join(', ')}`)
    console.log(`${q.q}\nANSWER: ${q.a}`)
  },

  correct(key) {
    const s = read()
    const t = team(s, key)
    if (!s.leg3.currentQuestion) die('no question in play. Run: gm.mjs ask')
    const here = s.leg3.questionsAsked.length - 1
    if (t.leg3.wrongOn === here) {
      console.log(`REFUSED. ${t.name} already answered this one wrong. They are out of it.`)
      return
    }
    if (t.leg3.lockedOutFrom === here) {
      console.log(`REFUSED. ${t.name} is locked out of this question. It does not count.`)
      return
    }
    const q = readQuestions().find((x) => x.id === s.leg3.currentQuestion)
    const own = q && q.empire === t.empire
    t.leg3.island = Math.min(s.leg3.islands, t.leg3.island + (own ? 2 : 1))
    write(s, `${t.name} correct${own ? ' on own empire, 2 islands' : ''}, now island ${t.leg3.island}`)
    console.log(`${t.name} moves ${own ? 'TWO' : 'one'} to island ${t.leg3.island}.`)
    standings(s, t.leg3.island >= s.leg3.islands ? `${t.name} is at the plinth, run: gm.mjs win ${t.id}` : 'run: gm.mjs ask')
  },

  wrong(key) {
    const s = read()
    const t = team(s, key)
    if (!s.leg3.currentQuestion) die('no question in play. Run: gm.mjs ask')
    const q = readQuestions().find((x) => x.id === s.leg3.currentQuestion)
    const own = q && q.empire === t.empire
    t.leg3.wrongOn = s.leg3.questionsAsked.length - 1
    t.leg3.lockedOutFrom = s.leg3.questionsAsked.length
    if (own) t.leg3.island = Math.max(1, t.leg3.island - 1)
    write(s, `${t.name} wrong${own ? ' on own empire, back one' : ''}, out of this question and the next`)
    console.log(`${t.name} is out of this question and locked out of the next${own ? `, and back to island ${t.leg3.island}` : ''}.`)
    standings(s, 'run: gm.mjs ask')
  },

  lava(key) {
    const s = read()
    const t = team(s, key)
    t.leg3.island = Math.max(1, t.leg3.island - 1)
    write(s, `${t.name} touched the floor, back to island ${t.leg3.island}`)
    console.log(
      `${t.name} back to island ${t.leg3.island}` +
        (s.config.drinkPenalty ? `, plus one fixed measure: ${s.config.fixedMeasure}.` : '.'),
    )
    standings(s, 'run: gm.mjs ask')
  },

  win(key) {
    const s = read()
    const t = team(s, key)
    s.leg3.winner = t.id
    s.status = 'finished'
    t.leg3.island = s.leg3.islands
    write(s, `${t.name} (${t.empire}) reached the plinth and won`)
    console.log(`${t.name} of ${t.empire} takes the plinth. That is the night.`)
    standings(s, 'game over, game-state.json holds the full record')
  },
}

const [cmd, ...args] = process.argv.slice(2)
if (!cmd || !cmds[cmd]) {
  cmds.help()
  process.exit(cmd ? 1 : 0)
}
cmds[cmd](...args)
