# SORTIE — design doc v1.0

**A mobile-suit auto-battler.** You see what the regime is fielding, buy the counter, place it on a
hex board, and watch the round resolve. Both sides get richer every round.

v0.1–0.4 were a tactical campaign — named pilots, permadeath, one squad of three. That is a
different genre. The loop below is the actual auto-battler: **shop → placement against visible
intel → auto-resolve → escalate**, repeated for ten rounds. The hex board, the deterministic sim
and the renderer carried over; the pilot campaign is in `legacy/`.

## Reading the board

Counter-picking is the strongest way to play, so the game has to let you see what you are countering.

- The **intel line** lists the regime's composition before you spend anything, with ranks — a
  rank-A Colossus is a different problem to a rank-D one.
- Their squads stand on the board during deployment, exactly where they will start.
- **Hovering any squad**, either side, deploying or mid-battle, gives a readout: name, rank, role,
  era, machines remaining, hull, damage, range bracket, splash, armour-piercing, save and slot cost.

## The loop

1. **Intel.** The regime's army for this round is bought and placed *before* you spend anything.
   You can see exactly what is coming and where it stands.
2. **Shop.** Spend credits on squads and on permanent field upgrades.
3. **Placement.** **Drag a unit from the shop straight onto a hex** to buy and place it in one
   motion, or drag squads already on the board to rearrange them. Dropping one squad onto another
   swaps them. Clicking a shop card still buys and auto-places, so the keyboard path works; tapping
   an empty hex places the selected squad, so touch works.
4. **Battle.** Resolves automatically, watchable tick by tick, pausable and scrubbable.
5. **Consequences.** The loser's supply drops by 1–3 depending on how badly. **Both armies persist,
   but rebuilding is not free** — destroyed squads come back at 25% of their price, billed against
   next round's income, and anything you cannot afford is written off. Armies are capped at 18
   squads.

   Both extremes of this were wrong. Permanent loss left you with *nothing* in half of all rounds —
   a treadmill, not a war. Free rebuilds made watching your entire force die completely weightless:
   ten squads a round were destroyed and every one came back for nothing. The bill runs about 53% of
   income, so a bad round costs you next round's shopping, which is a consequence you can see
   coming. The regime pays on exactly the same terms; charging only the player made a loss
   unrecoverable.

Income rises every round for both sides, so round eight looks nothing like round one. Run out of
supply and the war is over.

## Emplaced artillery

Siege Walkers and Missile Tracks do not move. You put them on a hex and they fight from it for
the whole battle.

They used to reposition like everything else, and it was wrong twice over. A gun line that walks
toward the enemy reads as a slow brawler rather than artillery, and it kept strolling out of the
cover it had been placed in — the player's positioning decision was being undone by the approach
heuristic a few ticks later.

Holding still makes both halves of the piece sharp. Placement becomes the whole decision: a
Siege Walker cannot fire inside three hexes, so where you set it down decides which lanes it
covers and how long it has before something reaches it. And it hands the opponent a clear answer
— go around it, or close the distance and stand where it cannot depress its guns. A Missile Track
fires indirect and ignores terrain entirely, so the only counter to one is reaching it.

This made artillery stronger, not weaker: measured value went from the middle of the pack to
61% (Siege) and 58% (Missile), because a gun that stops walking itself into a brawl keeps firing.
Prices moved to match.

It also took some of the point out of charging. Against a gun line that could flee, charge speed
was the difference between catching it and never catching it; against one that holds, it only
buys a couple of saved volleys. Still a real edge — 19% to 23% — just a smaller one.

## Charging

The one order you give. Every squad is set to **HOLD** or **CHARGE** before the battle.

A charging squad sprints at 1.7× speed straight for contact, **cannot fire while it is still
crossing**, and is **easier to hit** the whole way in. When it arrives, the first strike lands at
**3.2× damage with +1 armour-piercing** — the blade going through.

It is deliberately a situational tool rather than a general buff:

| Charging | Result |
|---|---|
| Lancers into a Colossus | 10% → **33%** |
| Skirmishers against a normal army | 80% → **23%** |
| Lancers against a normal army | 30% → 33%, roughly a wash |

Committing is right when the target is big and armoured and your unit was built for knife range.
It is a mistake for anything that wanted to shoot from distance, which is the point.

## The counter web

The whole thing rests on one rule: **damage lands on one machine at a time, and overkill is
wasted.** A 95-damage Colossus shot into a 63-hull Pod throws most of itself away. That single rule
generates the rest:

| If you field | It struggles against | Because |
|---|---|---|
| A swarm of cheap squads | Splash (Missile Tracks, Siege Walkers) | splash hits several machines per shot instead of one |
| One expensive giant | Armour-piercing (Lancers, Heavy Suits with Magnetic Rounds) | AP worsens or removes the armour save |
| Splash artillery | Anything fast that closes | siege cannot fire inside three hexes |
| Pure long range | Bodies that soak the first volleys | range brackets punish shooting far |

**Armour is a save.** Heavy Suits save on 5+, a Colossus on 4+, an Ace on 4+. A weapon's AP
worsens that roll; at 7+ there is no save at all.

**High ground is a position worth fighting for.** From a ridge you shoot *over* debris that blocks
the shot entirely from ground level, the cover it would grant is void, you get +1 reach, −1 to hit
shooting down — and **your hits can crit**: beat the target number by 3 or more and the shot lands
double and ignores the armour save. Nothing crits from flat ground, so the ridge is a place, not a
buff. About a third of volleys fired from height crit.

**Density before variety.** The board was 91% open ground, so terrain barely featured — an average
map had five ridge hexes out of 165. It is now about 21% terrain. Adding types without density
would just have made each one rare enough that nobody learns it.

**Three flags, not one.** `opaque` (cannot see through), `blocks` (cannot deploy on) and `impassable`
(cannot enter at all) are separate. The first two were a single flag for a long time. Ridges must be standable, so they were `blocks:false`, which
also made hills completely transparent — you could shoot straight through a hill. They are now
`opaque:true, blocks:false`: from the ground, rubble *and* hills stop a shot; from a hill you see
over rubble but not over another hill.

**Units have to want the high ground.** Movement scoring rewards elevation and a squad already
holding a ridge will not step off it to shave a hex of range. Before that, units walked straight
off hills to close and spent 17% of their ticks up there, so crits effectively never fired. It is
100% now.

**Climbing costs.** Entering a hex costs its terrain plus one more for *gaining* elevation — a
ridge costs 3 to climb, 2 to move along, and 1 to drop off.
High ground is expensive to take and cheap to hold, and pays back a −1 to hit shooting down, +1
shooting up, and +1 weapon range. A Siege Walker that starts on a ridge wins 98% of a control
matchup against 90% on flat ground.

**Range is bracketed** — short +0, medium +1, long +3 on the 2d6 to-hit — and the whole modifier
stack is printed next to every shot in the combat log.

### Army list

Nine units, priced by an auto-tuner (`tune.js`) that walks each cost until win rates converge
across many budgets. Final spread: every unit sits between 47% and 62% average win rate, 15 points
apart, with each beating and losing to several others.

Eleven field upgrades, permanent, applying to every squad of that type you own now or buy later —
expanded squads, anti-beam coating, magnetic rounds, thruster boosts, saturation pods, point
defence, and Newtype reflexes for the Ace.

## The regime

It buys to counter you. Field a crowd and it buys splash; field a giant and it buys
armour-piercing; field siege and it buys things that close. It techs up from round three and its
budget grows faster than yours — your edge is that your squads persist and it rebuilds from
scratch.

## What survives a war

Everything else resets. A **profile** does not — it lives in `localStorage` (falling back to memory
if a sandbox blocks it) and pulls in both directions.

**Tiers.** Every war you win raises the tier the regime fights at, I through VII: more income, then
developed machines a round sooner, then advanced ones, then its whole line starting a rank up. It
tops out rather than running away.

**Doctrines.** Every war you win also hands you one of three permanent perks — more starting
credits, a fourth machine off the ladder, a promoted first squad, extra income, cheaper repairs, a
free field upgrade, or two more field slots. They stack, and they are what makes tier seven
survivable: the difficulty and the answer to it advance together.

A loss still counts a war fought and keeps your best streak on the record, so failure is progress
rather than deletion.

## Ranks

Every squad carries a rank — **D, C, B, A, S** — and each is about a third stronger in hull and
damage than the last, compounding to roughly **3.3×** at S. Two routes up:

- **Promote** with credits. Each rank costs more than the last (270 → 405 → 540 → 675 for a Line
  Suit squad), so going tall is a real commitment.
- **Merge** three squads of the same type *at the same rank* into one of the next, free — and it
  hands two slots back.

**This exists because the late game had no shop.** By round eight the player was slot-capped 84% of
the time and sitting on **4,090 unspent credits** by round ten, with income still arriving and
nothing to buy. Ranks turn money into power when you cannot turn it into bodies: unspent credits at
round ten fell from 4,090 to **106**.

They also keep era-one machines worth fielding late, which is what makes extending the ladder
possible at all — without ranks every new era turns the previous one into landfill.

**Merging trades force for slots**, deliberately: three squads become one at 1.35×, so you lose
more than half the bodies to gain two slots. It is right when slots are the binding constraint and
wrong otherwise. A test policy that merged greedily deleted its own army and scored 0% across every
war — worth remembering as the trap it is.

The regime ranks up on the same terms, spending its surplus on quality once it is slot-capped.

## The ladder

Every machine sits in an **era**, and a war climbs them. You open with blades, massed bodies and
the simplest line, and finish with guided fire, superheavy hulls and a single pilot who is better
than everyone.

| Era | | Machines |
|---|---|---|
| 1 | EARLY | Scrap Pods, Line Suits, Lancers |
| 2 | DEVELOPED | Heavy Suits, Skirmishers, Siege Walkers |
| 3 | ADVANCED | Missile Tracks, Colossus, Ace Frame |

**You always start with the three era-1 machines** — same every war. After each round you unlock one
of the remaining machines *in your current era*; the next era opens only once the current one is
complete. Progress is a march, not a lottery.

**The regime climbs the same ladder**, capped at era 1 through round 3, era 2 from round 4, era 3
from round 7. It cannot field a Colossus while you are still holding spears.

Rewards never hand you a machine you have not unlocked.

### Why a ladder and not a tree

A tech *tree* means prerequisites, branches and a diagram to read. A *ladder* is one ordered list
and a single rule — "unlock from the earliest era that still has something in it" — which is about
fifteen lines of code and no new UI at all. It is also the truer model: warfare advanced, it did
not branch. Nobody chose between gunpowder and bronze.

The choice still exists where it matters — which machine you take *within* the current era — and
that is a real decision without any tree machinery. If branching ever earns its keep, the `era`
field already carries the ordering a tree would need.

**The intent is to extend this in both directions** so a run is the whole evolution of warfare:
sticks, stones and massed infantry below era 1, and whatever sits above mobile suits at the top.

## Rewards between rounds

After each round you draft **one of three** (four when you are losing), and lose the rest. Field
upgrades live in this pool rather than competing with squads for credits — that competition is why
players bought 1.1 of 11 upgrades before this existed, and 7.3 of 11 after.

**Rarity is exponential in both directions.** Six tiers, each roughly 2× rarer and 1.7× stronger
than the one below, so a LEGENDARY is ~80× rarer and ~13× the effect of a COMMON.

| Tier | Weight | Effect | Roughly |
|---|---|---|---|
| COMMON | 100 | ×1.0 | 1 in 2 |
| UNCOMMON | 52 | ×1.7 | 1 in 4 |
| RARE | 26 | ×2.9 | 1 in 7 |
| ELITE | 11 | ×4.8 | 1 in 18 |
| EPIC | 4 | ×8.0 | 1 in 49 |
| LEGENDARY | 1.2 | ×13.0 | 1 in 162 |

The multiplier drives the numbers directly: a common WAR BONDS is +60 income a round, a legendary
is +780. A common free-squad card gives one cheap squad; a legendary gives five, and only high
rarity unlocks the expensive end of the roster.

The catch-up card is offered **only when you actually lost the round or are behind on supply** —
not merely because something died, which happens nearly every round. It is either **FIELD
WORKSHOPS** (refunds the repair bill you just paid) or **SALVAGE CREW** (recovers squads you could
not afford to rebuild). Neither hands you a squad you already have: an earlier version predated
automatic rebuilds and offered to "rebuild the squad you lost", which quietly gave you a second
Colossus.

**Luck rises with the round and when you are behind** (`1 + 0.10×round + 0.40 if losing`), so
legendaries are 1-in-160 at round 1 and about 1-in-20 by round 9. That rubber band is also the
cheapest fix for an early snowball deciding the whole war.

## Balance

From `gamerunner.js`, 200 whole wars under a reasonable-buyer policy:

| Measure | Result |
|---|---|
| Wars won | 51% |
| Avg rounds played | 4.9 / 10 |
| Rounds won by player | 60% |
| Squads wiped per round | 2.08 |
| Field upgrades bought per war | 1.1 |

## Layout

The page is a screen, not a document: `100dvh` app shell, no page scroll, three columns —
**shop | board | army-or-log** — each scrolling independently. The board letterboxes to fit its
column. Round results and the reward draft float over the board rather than pushing content down.
Reference material (loop, counter web, board rules, rarity table, army list, balance runner) is a
**third tab** in the side panel — no modal, no drawer, no overlay anywhere in the UI. Below 1080px
the columns stack and the page scrolls again.

**One trap worth remembering:** an author rule that sets `display` beats the browser's
`[hidden]{display:none}`, so any element styled `display:flex` silently ignores the `hidden`
attribute. That broke four elements at once. The stylesheet now ends with
`[hidden]{display:none!important}`. jsdom's cascade applies `[hidden]` anyway, so it reports a
false pass — `uitest.js` asserts the rule's presence structurally instead.

Density matters as much as structure: the status strip is three items (round, credits, one
contested supply bar) rather than five plus twenty-four pips; shop cards are two lines with the
flavour text on hover; army rows show a name and a count, since where a squad stands is visible on
the board and does not need spelling out in words.

`uitest.js` asserts the shell holds: no page scroll, three columns, per-column scrolling, the
board constrained to its column, and no long-form sections left in the play area.

## Files

| File | Purpose |
|---|---|
| `hex.js` | board geometry, terrain, precomputed distance and line-of-sight tables |
| `army.js` | unit roster, tech, shop, economy, the regime's buying AI, round resolution |
| `battle.js` | squad battle resolution. Pure, deterministic, no DOM |
| `matrix.js` | `node matrix.js [budget] [seeds]` — mono-army duels. Useful, but see the warning below |
| `marginal.js` | `node marginal.js` — **the metric that matters**: given the army you have, what is the best use of your next credits |
| `tune.js` | tunes costs against mono-army duels |
| `tune2.js` | tunes costs against marginal value; rewrites `army.js` |
| `evolve.js` | `node evolve.js [pop] [gens] [--write]` — evolutionary tuning of cost/hull/damage/speed |
| `strategy.js` | `node strategy.js [wars]` — plays whole wars under different buying policies. Catches dominant lines the per-unit tests cannot see |
| `gamerunner.js` | `node gamerunner.js [wars]` — plays whole wars headlessly |
| `health.js` | `node health.js [wars]` — one-screen dashboard: roster balance, war arc, roster reach. Run after any change |
| `test.js` | determinism, counter web, economy, rewards, arms race, attrition, board |
| `uitest.js` | loads the built page in jsdom and plays a full round |
| `template.html` | the page, with `/*__HEX__*/`, `/*__ARMY__*/`, `/*__BATTLE__*/`, `/*__RENDER__*/` markers |
| `build.js` | inlines the modules and the renderer → `artifact.html` + `prototype.html` + `index.html` |
| `src/game/board.ts` | **the board renderer** — machines, motion, weapons, impacts, light |
| `src/theatre/` | the pieces it is built from: sprite batcher, procedural rig atlas, era skins, bloom |
| `render.js` | the compiled renderer, committed. `npm run render` rebuilds it |
| `legacy/` | the pilot campaign (v0.1–0.4) and its tests |

Run `node build.js`, then `node test.js && node uitest.js`.

**The trap that keeps biting:** `battle.js` reaches `army.js` two ways — `require` under node, and
a hand-listed fallback object in the browser where both are inlined into one scope. A name missing
from that list is invisible to every node test and instantly fatal in a browser. `uitest.js` is the
only thing that catches it.

### Pathing: cost fields, not greedy steps

Units used to walk by scoring their six neighbours and stepping to the best one. That looks
equivalent to pathing and is not: a squad can sit in a **basin** where every adjacent hex scores
worse and simply stop, forever. Adding impassable rock made those basins common — a Lancer squad
was found frozen on a ridge four hexes from the enemy for an entire battle, never firing a shot,
and 3% of all squads finished battles having fired nothing.

Movement now picks the best ground within seven hexes and paths to it with a cost field. Squads
firing zero shots went from 3% to **0%**. It costs about 8ms a battle, which is worth it.

**A crew inside its own minimum range fires anyway** — sidearms only, 40% damage, no splash. A
Siege Walker hugged by something fast used to stand there for forty ticks and die without shooting.
Technically the counter working; it read as a broken unit.

Fixing pathing also changed what **charging** is for. It used to be the only way melee reached
anything. Now that they can walk, its job is closing on artillery (Lancers vs a siege line: 3% →
20%) and catching units fast enough to stay out of reach (43% → 65%). It still buys a ranged unit
nothing.

### Line of sight, strictly

A sight line that runs exactly along a hex edge is ambiguous — rounding picks one of two tied
hexes arbitrarily, so a shot could resolve as clear while the tracer visibly clipped the rubble
beside it. On a real map **1130 sampled pairs** ran along an edge. `lineBetween` now nudges the
endpoints both ways and takes the union: if either candidate blocks, the shot is blocked. Strict,
and it matches what the player sees. Debris density was cut from 13% to 7% to compensate, since
every blocker now counts for more.

### Evolutionary tuning

`evolve.js` runs a small GA over the numeric dials. Two rules keep it from producing mush:

**It mutates magnitudes, not identities.** Cost, hull, damage and speed are dials. Range brackets,
splash, armour-piercing, saves and role are what a unit *is* — mutate those and the counter web
dissolves into nine interchangeable blobs.

**Fitness rewards differentiation, not just fairness.** Optimising "every unit wins 50%" alone
converges on nine identical units, all at 50% precisely because none of them counter anything. So
fitness rewards a *high* spread within each unit's matchup row while keeping the spread *between*
units low.

A run of 14×18 took about six minutes and moved fitness from −0.78 to +0.06, marginal spread from
33 to 17, and differentiation from 0.285 to 0.354 — landing close to the hand-tuned numbers, which
is reassuring about both. Two caveats found in the doing: the evaluation's per-unit sample was
briefly small enough that spread sat at the noise floor and the search ignored it, and the first
version shipped the *last* generation's best rather than the best ever seen, which is wrong when
fitness is noisy.

### Cost tuning drifts

`tune2.js` optimises cost *ratios*, so the absolute scale creeps upward every pass — after several
runs the cheapest squad cost 525 and a starting budget bought one unit. It now renormalises against
the cheapest squad (anchored at 140) before writing, and it only rewrites unit costs, never tech.

### The measurement trap

The duel matrix said the roster was balanced to **18 points** while the marginal test said **91**.
Ace Frame was a 92% auto-pick and the duel matrix could not see it, because nobody plays a
mono-army — the question a player actually asks is *"what is the best use of my next 1300
credits, given what I already own"*. Tune against `marginal.js`; keep `matrix.js` only as a
secondary read. Current marginal spread: **10 points**.

## The after-action

An auto-battler's loop is watch → understand → adapt, and understanding was entirely on the player.
Each battle now reports, in plain language:

- squads that **never fired**, and why — inside their minimum range, no clear line, still closing
- squads whose damage was mostly **overkill**, with the percentage
- which enemy squad **accounted for most of your losses**
- one line of **advice** read off their composition

Plus a per-squad table: shots, hits, damage, wasted percentage, idle ticks, machines lost. Example
from a real defeat:

```
59% of SIEGE WALKERS damage was overkill — too much gun for what it shot at
Their SKIRMISHERS accounted for 14 of your 16 machines lost
They are fielding numbers — splash hits several machines a shot.
```

## How you win

Measured, not asserted — `strategy.js` plays whole wars under different buying policies:

| Strategy | Wins |
|---|---|
| Counter-pick what they field | **90%** |
| Buy cheap bodies | 83% |
| One of each role | 83% |
| Upgrades before units | 80% |
| All-in melee, everything charging | 57% |
| Buy the most expensive thing affordable | 45% |

Counter-picking is the best way to play, which is the intended core skill. A 45-point spread means
the choices matter without one line dominating.

**A slot has to cost what it is worth.** With every unit taking one of eighteen slots, "buy the
biggest thing you can afford" won **100%** of wars — eighteen Colossus slots is three times the army
of eighteen Pod slots, so past a certain income credits stopped mattering entirely and cheap units
were a trap. Big machines now take three slots, mid ones two, cheap ones one. That single change
dropped the strategy from 100% to 45% and turned the cap into a breadth-versus-depth decision.

## Where it landed

| Measure | Value |
|---|---|
| Round one | 53% to the player, equal force on the board |
| Win rate by round | 50 / 48 / 56 / 55 / 51 / 51 / 48 / 49 / 54 / 57 |
| Wars won | 47% |
| Lead changes hands | 41% of wars |
| Winner's final supply margin | 10.1 of 15 (was 13.7 — a total snowball) |
| Cost of losing a round | −1 / −2 / −3 supply at 32% / 52% / 16% |
| Roster marginal spread | 18 points, whole roster reachable |

The flat round curve and the 41% lead changes are the two numbers that matter most: the war is no
longer decided in the first few rounds.

**Round one was badly unfair and nobody noticed for a long time.** The regime opened with 1330
credits to the player's 950 — 40% more hull on the board and a 5% player win rate — left over from
moving its income into `resolveRound` and never re-checking the opener. Both sides now start on 950
and the regime's edge comes from its income curve instead. There is a test for it.

## Two things the board was not telling you

**The deploy zone was a hairline.** Selecting a squad and clicking anywhere else did nothing, silently
— the mechanic worked, it just never said no. The zone now has a fill, hovering an illegal hex draws
a red cross and a not-allowed cursor, and a refused click flashes the zone and explains itself.

**The regime fielded a third more army than you could.** Its slot cap was written as `SLOT_CAP + 3`
and checked *before* adding a squad, so by the last round it took the field with 21.4 slots against
your 18 — 17 squads against 12.6. Both sides now get the same eighteen, enforced after the fact. It
still fields more *squads* than you, but only because it buys cheap one-slot units; the slots match.

## The war that could not be won

Every balance figure in this document came from bots playing bots, and they all said the game was
healthy. The first human to play it said he lost constantly. He was right, and the tools could not
see it.

Once the eighteen-slot cap bites, credits can only become force through ranks. The regime's buyer
does this automatically — `enemyArmy` has done it from the start, under a comment reading "spend
them on quality, exactly as you can". The player was never told "as you can". The control read
`▲ 270`.

Same buying, same placement, the only variable being whether the player ranks up:

| | r6 | r7 | r8 | r9 | r10 | wars |
|---|---|---|---|---|---|---|
| never ranking up | 69% | 61% | 35% | 13% | 0% | 56% |
| ranking up when slots are full | 77% | 79% | 71% | 58% | 58% | 72% |

By round seven the un-ranked army flatlines around 11,000 hull holding 4,326 unspent credits,
while the regime climbs past 14,000. The last third of every war was a scripted loss.

The war record hid it twice over. Wars are decided on supply attrition and often end by round six,
so the headline said 56% while every late round actually played was a defeat. And `health.js`
measured a bot that ranks up — it was reporting on a player who already knew the secret.

Two fixes, and the second is the general one:

- The control is named (`Rank up 230`), lights up the moment buying another squad becomes
  impossible, and the hint bar states the whole rule outright when slots are full.
- `gamerunner.js` models ranking up, and `naive.js` exists to play the game as someone who does
  *not* know the mechanics — buys sensibly, never counter-picks, never merges, never ranks up.
  Where its round-by-round curve diverges from the expert policy's is a mechanic the interface is
  failing to teach. A bot policy encodes knowledge the player has not been given; measuring only
  expert play makes a discoverability failure look like balance.

## The opening battle

Round one gave both sides 950 credits. That sounds like fairness and is not: the regime's buyer is
a solved policy and a person playing their first war is not, so an even budget lost the opening
battle about two times in three. First impressions are not the place to be even-handed.

The regime now opens on 840, which puts the first sortie at 67% for a player who buys sensibly and
knows no counters. The handicap belongs to the bottom of the ladder — tier scaling multiplies the
regime's income and takes it straight back.

## The board draws machines

For a long time a squad was a triangle with a number under it, and every shot was a two-pixel line
between two hex centres. That is a readable abstraction and it was never going to be more than one.

The board now draws the machines. A squad is its surviving members standing in formation, and when
it loses four of six you watch four machines fall over in the hex where it happened — the count is
still stamped underneath, but you no longer have to read it to know the flank collapsed. Shots
leave the weapon, cross, and land: a Line Suit fires a beam, a Siege Walker lobs an arc over the
ridge it is shooting past, a Lancer swings. Scroll to zoom in; during a battle the camera follows
whatever is firing.

The split is strict, and it is what keeps this from being a rewrite:

| The page owns | The renderer owns |
|---|---|
| terrain, deploy zones, cursors, labels, hit-testing | machines, motion, weapons, impacts, light |
| every decision | nothing |

So the 2D canvas still draws the grid and everything you point at, and a transparent WebGL canvas
draws over it. The two agree on where a hex is and on nothing else. Feed the renderer the same
frame twice and you get the same picture apart from time; it cannot change the outcome of a battle
because it is never asked.

Machines are drawn in code — a procedural rig posed into a texture atlas at load, one figure per
era per archetype per pose. There is no artist on this project and there is not going to be one, so
the constraint is doing real work: a new era costs one object in `era.ts` rather than several
hundred frames of animation, and a Colossus is a Line Suit with different numbers. That is also
what makes the era ladder drawable when it arrives — the same beats, ten thousand years apart.

Reactions are *derived* from the event list each frame rather than pushed into state, so scrubbing
the playbar backwards cannot leave a machine stuck mid-recoil.

It degrades honestly. No WebGL, a failed shader compile, or the Machines toggle off, and the page
draws the flat tokens it always drew. The fallback and the toggle are the same code path, so
neither can rot unnoticed.

## The ladder is visible

The eras used to be a number on a shop card. `era: 1` meant "unlocked later, costs more", and a
round-nine battle looked exactly like a round-one battle with bigger numbers.

Every machine now looks like the age it came from, and every age is in the atlas at once — because
a late war fields all three at the same time. That is the whole point. The Line Suits you have been
dragging around since round one are still standing on the field in round nine, visibly a generation
behind the machine next to them, and you can see at a glance which half of your army is obsolete.

The ages are told apart by **silhouette first, colour second**. Colour stops working the moment a
figure is thirty pixels tall with half of it in shadow; an outline keeps working.

| | Frame | Head | Carries | Shots read as |
|---|---|---|---|---|
| **1 — Early** | short, thin, barely armoured | crested helm, no visor | a shield on the off arm | thrown arcs, no flash |
| **2 — Developed** | broad, short-legged, plated over everything | sealed helm, dark | nothing spare | slugs with muzzle flash |
| **3 — Advanced** | tall, thin-limbed, huge pauldrons | lit visor | thrusters | beams and trails |

`RigSpec` grew four fields to carry this — `plating`, `shield`, `crest`, `visor` — and the figure
drawing reads them. Adding a fourth age is still one object in `era.ts`.

The weapon look already came from the era skin, so this fell out for free: an era-1 Lancer throws
something that arcs, an era-2 Line Suit fires a slug that flashes, an era-3 Missile Track puts a
beam over the ridge. Same beats, ten thousand years apart.

## The regime's wallet, and what it cannot buy

The regime's income is a line: `465 + 158 per round`, against your `470 + 150`. It opens slightly
behind you and climbs slightly faster. Both ends are dials (`enemyBase`, `enemySlope`) because both
ends do different jobs — and the reason to say that out loud is that one of them used to be a lie.
`enemySlope` was a mod `econ.js` passed and `army.js` never read, so every slope sweep that tool
ever ran measured nothing at all.

**Tune the level on `health.js`, not `econ.js`.** They disagreed by twenty points on what a credit
is worth to the regime, and the disagreement is structural rather than noise: `econ.js` buys at
random from what it can afford, `health.js` counter-picks the regime's roles, and counter-picking
compounds whatever you hand the other side. A change that cost the random buyer 20 points cost the
competent one 40. `econ.js` is still the right tool for the *shape* of a war; it is the wrong tool
for how hard one is.

The curve under a competent buyer, 150 wars:

```
regime 465+158/rd   wars 59%   r1 75  r2 75  r3 77  r4 77  r5 71  r6 49  r7 39  r8 21  r9 9  r10 5
```

**Money cannot reach the early war.** Rounds one to four sit at 72–79% at every regime income from
420 to 520 — the regime is constrained early by what the era ladder lets it field, not by credits,
so paying it more changes nothing until it has something to spend on. If those rounds should be a
real fight, the lever is its roster or its slot pacing, not its wallet.

**A low late-round number is not on its own a bug.** A war averages 8.4 rounds, so reaching round
nine mostly means you are already losing, and `r9 9%` is the win rate of a losing position rather
than of an ordinary endgame. Any tuning pass that reads the raw tail as a design failure is reading
a conditioning artifact.

That is *not* a retraction of "the war that could not be won" above. What made that one a real bug
was never the absolute number — it was the **gap between two policies** on the same curve: 58% and
0% at round ten depending only on whether the player knew to spend on ranks. A tail that is low for
everybody is the shape of a war being decided; a tail that is low only for the player who was never
taught something is an interface failure. Always compare two policies before concluding either.

`late idle` is 83 credits. The unwinnable late war that used to leave 3,600 credits unspent is
gone under a measurement that was not the one that found it.

## A fair price is not a reachable one

The marginal tuner priced Siege Walkers at 1295 and was right to: that is what the gun measures.
`health.js` then reported it **first fielded in round ten** of a war that averages nine rounds.
Correctly valued, never bought — content that does not exist.

Three slots and 1295 credits is a double tax. By the time the credits are there the slots are not,
and the right play with a full board is to spend on ranks instead. Nothing about its value per
credit was wrong; the absolute ticket was out of reach of the army that would want it.

So it was **trimmed rather than repriced** — hull and damage down about 19%, cost down 22% to 1010.
Value per credit lands where the tuner put it, and the ticket lands where a mid-war army can pay
it. First fielded round 10 -> round 4. Marginal spread widened 11 -> 16, which is inside tolerance
and worth paying.

The general point: **marginal value and roster reach ask different questions.** One is "is this
priced right", the other is "does anybody ever field it", and they can disagree. When they do, the
reach number is the one describing the game a person actually plays. Run both.

## Light on the machines

The figures were flat. Every panel was one solid colour with a darker outline, and that is what made
them read as cut paper — a flat quad is a flat quad at any resolution, so no amount of extra detail
was going to fix it. Three changes, in order of how much they mattered:

**One light, from up and to the left, consistent across every figure and era.** Consistency is what
makes shading read as lighting rather than as decoration.

**Plates are lit across their own axis, not along the light direction.** A limb filled with a
gradient running perpendicular to its length becomes a cylinder; the same limb filled flat stays a
ribbon. This is the whole trick, and it costs one gradient per panel.

**A rim light on the lit edge — capped in absolute pixels.** The first version scaled rim width
with the plate, which put a bright slab down the middle of every torso and read as a blown
highlight. A highlight is a property of a boundary, not of how big the thing is.

Cells went from 96px to 128px at the same time. The board scales figures by `unit / cellSize`, so a
bigger cell costs nothing on screen — it only buys sampling headroom, which previously ran out
around x2.5 zoom and went soft exactly when you leaned in to look. The sheet is 2816x2048, about
23MB on the GPU, which is roughly the ceiling before a phone starts caring.

**The era-one shield had to be rescued twice.** Filling half its face with the team accent turned it
into a banner — a bright slab wider than the machine carrying it — which is precisely the "stick men
with flags" failure the rig redraw was supposed to end. Dark board, small bright boss: the accent
belongs where the eye finds it, not where the eye lands first. Era-one plating also went 0.22 to
0.40, because a levy that thin was a stick carrying a board rather than a soldier behind cover.

**Still flat: the ground.** Terrain is two greys of 2D canvas hexes, and the machines now clearly
outclass the world they stand on. That is the next visual ceiling, and it is a bigger one than
anything left on the figures.

## Machines, not figures with armour on

Lighting made these look lit. It did not make them look like mobile suits. What does that is
hardware, and specifically five things, in rough order of how much each one buys:

| | Why |
|---|---|
| **the head** | a fin and *two eyes*. A single visor slit reads as a helmet; a pair of eyes reads as a face, and a face is the difference between a machine and a lump with a stripe on it. Eight pixels. |
| **skirt armour** | plates flaring off the waist. The widest part of the lower body, and the reason a mech reads as top-heavy rather than as a person in plate. |
| **the backpack** | with sabre hilts standing above the shoulders. The cheapest silhouette break available. |
| **pauldrons** | flared, lipped, much wider than the shoulder under them. |
| **the boots** | blocks with a toe and an accent, not the wedge a person stands on. |

**Colour is blocked into four roles, not metal-plus-accent.** `Livery` gives every age a `body`,
`plate`, `accent` and `trim` per side — because "a silhouette in a team colour" is exactly what
makes a figure read as a game token. Yours is a white frame with a deep chest group and a hot
accent; the regime's is factory grey with crimson. The renderer's team tint, which used to do all
of the side identification, is now a whisper: a multiply strong enough to identify a side is also
strong enough to collapse four colours back into one.

**Bulk has to be capped against height.** Every panel is sized from `unit`, which carries breadth
and limb bulk — but a torso's *height* does not, so the widest frames grew pauldrons and skirts past
the body they hang on and a Colossus became a 33px-tall, 64px-wide slab. Anything that sticks out
sideways is now capped at a fraction of the figure's own height. The roster's width-to-height ratio
was also pulled from 0.13-0.24 into 0.13-0.18: bulk should read as bulk, never as a pile.

## Noise, made in code

Same constraint as the machines: no audio file ever arrives, so every sound is synthesised from
oscillators and filtered noise at the moment it is needed. That is not a limitation being worked
around — it is what lets a shot sound like the age that fired it without shipping three sample
libraries. An era is a filter cutoff and an envelope, the same way it is a silhouette.

| | Weapon | Impact | Melee |
|---|---|---|---|
| **Early** | air, then a dull wooden knock — nothing here contains a reaction | a low thud | shaft against shaft |
| **Developed** | a hard crack over a chamber that rings | a sharper, brighter hit | steel on steel, two tones beating |
| **Advanced** | a rising charge, then a discharge | a deep filtered collapse | a sabre's sustained edge |

The report fires when the weapon does and the impact lands when the bolt does — playing both on the
same frame is what makes a battle sound like a rattle instead of an exchange.

A tick can emit a dozen weapons. Everything goes through one compressor, voices are capped per
tick, and the same sound repeated inside 40ms is dropped rather than stacked — twelve rifle cracks
in phase is one very loud rifle, not twelve rifles.

**Testing audio needs more than "it did not throw."** An envelope that ramps only to the silence
floor raises no exception and outputs nothing, which is exactly the failure that ships unheard. So
`uitest.js` installs a recording `AudioContext` that captures the peak gain every sound *schedules*,
and asserts that all 27 sounds (nine kinds across three ages) are audible, that the three ages do
not fire the same weapon, and that muting really schedules nothing.

## localStorage throws

Worth stating on its own because it has now bitten twice. In a sandboxed frame — which is exactly
what a Claude artifact is — reading `localStorage` **throws** rather than returning null, and an
unguarded read takes the whole script down with it. `army.js` guards the save file. The Optics and
Sound toggles did not, so any browser with WebGL and no storage would have got a blank game. Both
now go through one `pref()` / `setPref()` pair that swallows it. Never touch `localStorage` bare.

## Four things that do not fix the early war

Rounds one to five sit at 72-79% for a competent player and have resisted every numeric fix tried.
The failures are more informative than a success would have been, so they are recorded here to stop
the next attempt repeating them.

**Regime income does not reach it.** Rounds one to four stay at 72-79% at every regime income from
420 to 520 a round. Raising it far enough to move them puts whole wars at 28-39%, because the same
credits compound into the late war where the player is already losing.

**Era access does not reach it, and making it "fair" made it worse.** `enemyArmy` claimed in a
comment to climb the same ladder as the player and did not — it ran on a fixed schedule while the
player's first unlock draft already draws era-two machines. Letting the regime field the age the
player had actually reached moved round three from 77% to **85% in the player's favour**. The
roster is tuned so every unit is worth what it costs, so a later era is not a stronger credit; an
early regime given permission to buy 430s and 1010s simply fields fewer machines than the 140s and
235s it would otherwise have massed. **Era is pacing, not power.**

**Tech is not what wins it — refusing tech wins it harder.** Denying the player every tech boon
*raised* rounds two to four to 85-87%, because the alternative reward is cash and cash buys
machines now. What tech buys is the late war: round seven is 46% with it and 8% without. Ranks are
worth only four points of whole wars but are the difference between 11% and 1% at round nine.

```
baseline          wars 60%   r1 74  r2 75  r3 74  r4 75  r5 72  r6 45  r7 46  r8 26  r9 11  r10  6
no tech boons     wars 35%   r1 74  r2 85  r3 87  r4 83  r5 51  r6 24  r7  8  r8  6  r9  2  r10  0
no ranks/merges   wars 56%   r1 74  r2 75  r3 74  r4 75  r5 74  r6 53  r7 37  r8 15  r9  1  r10  1
```

**What is left is structural.** `enemyArmy()` runs *before* the player buys, and the game
deliberately shows enemy intel before the shop — so the player counter-picks a finished army with
complete information while the regime counters the army from last round. Counter-picking is the
stated heart of the game and only one side currently does it against live information.

That was tested properly, once `enemyArmy` grew a `buyOnly` option so a caller can run the
purchase without also granting a second tech roll and six more rank-ups. (The first attempt did
grant them, produced non-monotonic results, and was thrown out — a broken experiment looks exactly
like a strong effect until the monotonicity check fails.)

**The hypothesis is confirmed, and the fix still does not work.** Letting the regime spend a
quarter of its credits after seeing the player's army pulls rounds two to four from 74/75/75 down
to 63/57/55 — the only lever tried that moves those rounds at all. It also puts whole wars at 32%.

```
reserve  0%   wars 60%   r1 74  r2 75  r3 74  r4 75  r5 72
reserve 25%   wars 32%   r1 72  r2 63  r3 57  r4 55  r5 43
reserve 40%   wars 32%   r1 75  r2 72  r3 68  r4 61  r5 43
```

Paying for it out of regime income reverses it, because a *percentage* reserve is small when the
regime is poor and large when it is rich — backwards, since the broken rounds are the early ones.
At 15% reserve with income cut to 400, rounds two to four went to 83/85/78: **worse than doing
nothing.** A flat reserve has the right shape — a fixed reaction force is most of a round-two
budget and a rounding error in round nine — and still lands whole wars at 24-46% across 200, 320
and 440 credits held.

So: across two parameter families and nine settings, **any reactive spending strong enough to
flatten rounds two to four also drops whole wars to 24-46%.** The information advantage compounds
over the war; there is no setting in this family that buys the early flattening without the late
collapse.

The lead is still right and the instrument is too blunt. Making it work means a regime reaction
that is *weaker* than a full counter-buy — reacting by ranking what it already has, or by
re-deploying, rather than by buying a counter. That is a design exercise rather than a tuning one,
and it is where the next attempt should start.

## Known problems

- **Battles themselves are decisive, even when the war is not.** 78% end with the loser under 10%
  of the winner's power, because combat is a positive feedback loop — whoever kills first has more
  guns. The war stays close because the supply bite measures the *winner's* attrition, but the
  individual fight rarely looks like a nail-biter.



- **No mid-battle input.** Placement and stance are set before the fight and that is your whole
  tactical vocabulary. There is still no facing or formation.
- **The regime's buying AI is a heuristic**, not a search. It counters roles, not specific builds.

- **Lancers underperform against a Colossus** at equal cost despite being the designated AP answer:
  melee has to survive the walk in. A ranged AP unit would close that hole.
