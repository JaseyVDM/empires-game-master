# Empires

Everything needed to run the night. Clone it, start Claude Code from the repo
root so it picks up `CLAUDE.md` as the Game Master brief, then just type results
as they happen.

```bash
git clone https://github.com/JaseyVDM/empires-game-master.git
cd empires-game-master
```

```
CLAUDE.md                 the Game Master brief and the full ruleset
game-state.json           live state, rewritten after every update
game-state.template.json  the clean starting state that `reset` rebuilds from
gm.mjs                    state helper: points, tokens, powers, islands, standings
data/questions.json       60 leg 3 questions, 12 per empire
data/maths-cards.json     6 stacks of 10 for leg 1 station B
```

## Before the night

The state file ships with three placeholder teams and a random empire draw
already made. Swap in the real ones:

```bash
node gm.mjs name team-1 "The Regulars"
node gm.mjs players team-1 "Jay, Sam, Priya"
node gm.mjs station-game coinage        # or cupflip
```

For a different number of teams, or a different empire draw, edit
`game-state.json` directly before anything starts. Team shape is uniform, so
copy a block and change `id`, `name`, `players`, `empire` and `power`.

## On the night

```bash
node gm.mjs round team-1 team-3 team-2      # leg 1 finishing order
node gm.mjs power team-2 leg1               # refused if already spent this leg
node gm.mjs leg2 start                      # deals 10 + 2 per leg 1 point
node gm.mjs buyin team-3                    # drink, +3 tokens
node gm.mjs hand                            # one of six played
node gm.mjs leg2 end team-1=22 team-2=9 team-3=14
node gm.mjs leg3 start                      # islands 3 / 2 / 1 by points
node gm.mjs ask                             # next question, tags kept even
node gm.mjs correct team-1                  # or wrong / lava
node gm.mjs win team-1
```

## Every command

Teams can be named by id (`team-1`), by name, by empire, or by the bare number
(`1`). All of these are the same team.

| Command | What it does |
|---|---|
| `state` | print the whole state file |
| `standings ["next line"]` | print the standings block |
| `undo` | take back the last change, up to 20 deep |
| `reset [--hard] [--yes]` | new night: clears scores, keeps teams unless `--hard` |
| `name <team> "<new name>"` | replace a placeholder team name |
| `players <team> "A, B, C"` | replace placeholder players |
| `excuse "<player>"` | drop a player from all drink penalties, permanently |
| `station-game <coinage\|cupflip>` | record which pub game Station C is |
| `penalty <on\|off>` | drink penalty switch |
| `round <1st> <2nd> [rest...]` | leg 1 finishing order: 1, 0.5, 0 |
| `round <team>=<place> ...` | same, with dead heats: `a=1 b=1 c=3` splits 0.75 each |
| `puttoff <winner> <loser>` | settle a dead heat the scoring cannot split |
| `power <team> <leg1\|leg2\|leg3>` | log a power as spent, refused twice in a leg |
| `leg2 start` | lock leg 1, deal starting tokens |
| `buyin <team>` | record a buy back in: drink, +3 tokens |
| `hand` | mark a hand played |
| `leg2 end <team>=<tokens> ...` | final counts, converts to 2 / 1 / 0 points |
| `leg3 start` | set starting islands from total points |
| `ask [empire]` | read out the next question, balanced by tag |
| `correct <team>` | right answer, moves 1 island, 2 on own empire |
| `wrong <team>` | out of this question and the next, back 1 on own empire |
| `lava <team>` | touched the floor: back one island plus a fixed measure |
| `win <team>` | reached the plinth, ends the night |
| `help` | the same list, in the terminal |

## When the referee mistypes

`undo` reverses the last change and prints what it took back. Every command that
writes state saves a snapshot first, twenty deep, so several in a row can be
walked back. `state`, `standings` and `help` change nothing and do not use up
history.

```bash
node gm.mjs undo
```

## Dead heats

Bare `round a b c` gives 1, 0.5, 0 as usual. For a tie, name the places instead:

```bash
node gm.mjs round team-1=1 team-2=1 team-3=3   # 0.75, 0.75, 0
```

Tied teams split the points for the places they occupy between them. Where a tie
cannot be split, `leg2 end` and `leg3 start` refuse to guess: they print who is
level and stop, without writing anything. Settle it in the room, record it, then
enter the result again:

```bash
node gm.mjs puttoff team-2 team-1
```

## `power` is a log only

`node gm.mjs power <team> <leg>` records that a power has been spent and refuses a
second use in the same leg. It does **not** apply the effect. Nothing is
redirected, stolen, skipped, vetoed or rematched by the tool. The referee does all
of that at the table, and for Vikings the command prints the current leader's name
so it is obvious who is being stolen from.

## Resetting

`game-state.json` is the only file that changes during a night. Do not restore it
from git to start again, that would wipe the team setup too. Use `reset`, which
rebuilds the state from `game-state.template.json`:

```bash
node gm.mjs reset               # shows what it would keep and clear, changes nothing
node gm.mjs reset --yes         # clears the scores, keeps team names, players and empires
node gm.mjs reset --hard --yes  # back to placeholders, as the repo ships
```

`reset` always prints what it is about to keep and what it is about to clear, and
does nothing at all until you add `--yes`.
