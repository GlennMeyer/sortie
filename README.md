# SORTIE

A mobile-suit auto-battler on a hex grid. You buy machines, place them, and watch the
battle resolve itself — then spend what you salvaged before the regime's next wave.

**Play it: https://glennmeyer.github.io/sortie/**

## How it works

Each round you get credits, a shop, and a look at exactly what the regime is bringing and
where it will stand. You place your squads anywhere in your three deploy rows, hit SORTIE,
and the battle plays out deterministically — same seed, same placement, same result.

Winning is about counter-picking and ground:

- **Overkill is wasted.** A shot that does 900 damage to a 60-hull machine kills one machine.
  That single rule is why a swarm beats a giant and armour-piercing beats a swarm.
- **You cannot shoot through terrain.** Debris and ridges block line of sight; rock blocks
  everything. High ground sees over rubble and lands crits, but costs extra to climb.
- **Artillery is emplaced.** Siege units hold the hex you put them on, so where you set them
  down is the whole decision — and flanking them is the answer.
- **Slots, not just credits.** Eighteen field slots cap how much army you can bring.

Squads merge three-of-a-kind up the rank ladder D → C → B → A → S, and the war profile
persists between runs with tiers and doctrines.

## Development

```
node test.js      # simulation and balance assertions
node uitest.js    # jsdom pass over the real UI
node build.js     # bundle the modules into artifact.html + index.html
node health.js    # balance dashboard: is any unit an auto-pick or a dead buy?
node marginal.js  # what a credit buys, per unit — the metric that matters
node tune2.js     # solve for fair costs
```

`DESIGN.md` is the source of truth for the rules.
