#!/usr/bin/env node
// Empires game state helper. Every command writes game-state.json before printing.
// Usage: node empires/gm.mjs <command> [args]   (run `node empires/gm.mjs help`)

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const STATE = join(HERE, 'game-state.json')
const QUESTIONS = join(HERE, 'data', 'questions.json')

const read = () => JSON.parse(readFileSync(STATE, 'utf8'))
const readQuestions = () => JSON.parse(readFileSync(QUESTIONS, 'utf8')).questions

function write(s, note) {
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
const total = (t) => t.points.leg1 + t.points.leg2

function ranked(s) {
  const inLeg3 = s.status === 'leg3'
  return [...s.teams].sort((a, b) =>
    inLeg3 ? (b.leg3.island ?? 0) - (a.leg3.island ?? 0) || total(b) - total(a) : total(b) - total(a),
  )
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

  name <team> "<new name>"          replace a placeholder team name
  players <team> "A, B, C"          replace placeholder players
  excuse "<player>"                 drop a player from all drink penalties, permanently
  station-game <coinage|cupflip>    record which pub game Station C is
  penalty <on|off>                  drink penalty switch

  round <1st> <2nd> [rest...]       leg 1 finishing order: 1, 0.5, 0
  power <team> <leg1|leg2|leg3>     spend a power, refused if already spent this leg

  leg2 start                        lock leg 1, deal starting tokens (10 + 2 per point)
  buyin <team>                      record a buy back in: drink, +3 tokens
  hand                              mark a hand played
  leg2 end <team>=<tokens> ...      final counts, converts to 2 / 1 / 0 points

  leg3 start                        set starting islands from total points
  ask [empire]                      read out the next question, balanced by tag
  correct <team>                    right answer, moves 1 island, 2 on own empire
  wrong <team>                      wrong answer, locked out next question, back 1 on own empire
  lava <team>                       touched the floor: back one island plus a fixed measure
  win <team>                        reached the plinth, ends the night`)
  },

  state() {
    console.log(JSON.stringify(read(), null, 2))
  },

  standings(next) {
    standings(read(), next)
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
    const teams = order.map((k) => team(s, k))
    s.status = 'leg1'
    s.leg1.round += 1
    const awards = teams.map((t, i) => {
      const pts = i === 0 ? 1 : i === 1 ? 0.5 : 0
      t.points.leg1 += pts
      t.points.total = total(t)
      return `${t.name} ${pts}`
    })
    s.leg1.results.push({ round: s.leg1.round, order: teams.map((t) => t.id) })
    write(s, `leg 1 round ${s.leg1.round}: ${awards.join(', ')}`)
    const more = s.leg1.round < s.leg1.roundsTotal
    standings(s, more ? `rotate stations, run round ${s.leg1.round + 1}` : 'leg 1 done, run: gm.mjs leg2 start')
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
    console.log(`${t.name} plays ${t.empire}: ${t.power}`)
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
      const order = [...s.teams].sort((a, b) => b.leg2.tokens - a.leg2.tokens)
      order.forEach((t, i) => {
        t.points.leg2 = i === 0 ? 2 : i === 1 ? 1 : 0
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
    order.forEach((t, i) => {
      t.leg3.island = i === 0 ? 3 : i === 1 ? 2 : 1
      t.leg3.lockedOutFrom = null
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
    if (!empire) {
      const starved = inPlay.sort((a, b) => counts[a] - counts[b])[0]
      empire = pool.some((q) => q.empire === starved) ? starved : pool[0].empire
    }
    const q = pool.find((x) => x.empire.toLowerCase() === String(empire).toLowerCase()) || pool[0]
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
    const q = readQuestions().find((x) => x.id === s.leg3.currentQuestion)
    const own = q && q.empire === t.empire
    if (t.leg3.lockedOutFrom === s.leg3.questionsAsked.length - 1) {
      console.log(`REFUSED. ${t.name} is locked out of this question. It does not count.`)
      return
    }
    t.leg3.island = Math.min(s.leg3.islands, t.leg3.island + (own ? 2 : 1))
    write(s, `${t.name} correct${own ? ' on own empire, 2 islands' : ''}, now island ${t.leg3.island}`)
    console.log(`${t.name} moves ${own ? 'TWO' : 'one'} to island ${t.leg3.island}.`)
    standings(s, t.leg3.island >= s.leg3.islands ? `${t.name} is at the plinth, run: gm.mjs win ${t.id}` : 'run: gm.mjs ask')
  },

  wrong(key) {
    const s = read()
    const t = team(s, key)
    const q = readQuestions().find((x) => x.id === s.leg3.currentQuestion)
    const own = q && q.empire === t.empire
    t.leg3.lockedOutFrom = s.leg3.questionsAsked.length
    if (own) t.leg3.island = Math.max(1, t.leg3.island - 1)
    write(s, `${t.name} wrong${own ? ' on own empire, back one' : ''}, locked out of the next question`)
    console.log(`${t.name} is locked out of the next question${own ? `, and back to island ${t.leg3.island}` : ''}.`)
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
