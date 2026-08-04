'use strict';
/* Make advancing an era mean something, measured in the currency that actually binds.

   The first attempt at this scaled `bodies x hull x damage` and was wrong: a Colossus is one
   1132-hull body, and concentrated hull is worth far less than distributed hull because overkill
   is thrown away. It looked strong on paper, played weak, and the cost tuner marked it down.

   A unit's FAIR PRICE is its measured value — that is precisely what tune2 solves for. So read the
   era curve straight off tuned costs: cost / slots is what a unit is worth per slot of the 18-slot
   cap. Today that reads 215 / 211 / 252 across the three eras, which is flat: an army of era-1
   Line Suits is worth as much as an army of Colossi, so the ladder goes sideways.

   Target: value per slot rises x1.7 an era. Credits stay fair everywhere (nothing is a trap);
   SLOTS are the ladder. Later eras don't beat earlier ones per credit — they fit more army inside
   the same cap, if you can afford them. Credits bind early, slots bind late, and advancing an era
   is how you convert the first constraint into the second. */
const fs = require('fs');
const A = require('./army.js');

const TARGET_PER_SLOT = { 1: 150, 2: 255, 3: 434 };     // x1.7 a rung, extends forever

let src = fs.readFileSync('army.js', 'utf8');
console.log('unit             era  worth/slot -> target    power x     hp        dmg');
for (const u of A.UNITS) {
  const now = u.cost / u.slots;
  const want = TARGET_PER_SLOT[u.era];
  const mult = want / now;
  const k = Math.sqrt(mult);                    // split across hull and damage, preserving the role
  const hp = Math.round(u.hp * k);
  const dmg = Math.round(u.dmg * k * 10) / 10;

  src = src.replace(new RegExp("(id: '" + u.id + "',[^\\n]*?hp: )[0-9.]+"), '$1' + hp);
  src = src.replace(new RegExp("(id: '" + u.id + "',[^\\n]*?dmg: )[0-9.]+"), '$1' + dmg);

  console.log('  ' + u.name.padEnd(15) + u.era + '     ' + String(Math.round(now)).padStart(4) +
    '   -> ' + String(want).padStart(4) + '     x' + mult.toFixed(2).padStart(5) +
    '   ' + String(u.hp).padStart(4) + '->' + String(hp).padStart(4) +
    '  ' + String(u.dmg).padStart(5) + '->' + String(dmg).padStart(5));
}
fs.writeFileSync('army.js', src);
console.log('\npower rescaled — now re-run tune2 so prices catch up to the new power');
