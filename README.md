# Empires

Everything needed to run the night. Clone it, start Claude Code from the repo
root so it picks up `CLAUDE.md` as the Game Master brief, then just type results
as they happen.

```bash
git clone https://github.com/JaseyVDM/empires-game-master.git
cd empires-game-master
```

```
CLAUDE.md              the Game Master brief and the full ruleset
game-state.json        live state, rewritten after every update
gm.mjs                 state helper: points, tokens, powers, islands, standings
data/questions.json    60 leg 3 questions, 12 per empire
data/maths-cards.json  6 stacks of 10 for leg 1 station B
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

`node gm.mjs help` lists everything. `node gm.mjs state` dumps the lot if the
referee loses the thread.

## Resetting

`game-state.json` is the only file that changes during a night. To run it again,
restore that file from git: `git checkout game-state.json`.
