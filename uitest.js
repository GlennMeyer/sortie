'use strict';
/* Loads the built page in a real DOM and plays it the way a person would.
   Exists because UI-only regressions (a missing name in campaign.js's browser export
   fallback) are invisible to the node tests and completely fatal in a browser. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const ops = {};
function stubCanvas(win) {
  win.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, {
      get: (o, k) => {
        if (k in o) return o[k];
        if (typeof k === 'symbol') return undefined;
        // a few calls return values rather than nothing; a bare no-op stub throws on those
        if (k === 'measureText') return txt => { ops.measureText = (ops.measureText || 0) + 1; return { width: String(txt).length * 6 }; };
        if (k === 'createLinearGradient' || k === 'createRadialGradient')
          return () => ({ addColorStop() {} });
        return () => { ops[k] = (ops[k] || 0) + 1; };
      },
      set: (o, k, v) => { o[k] = v; return true; },
    });
  };
  win.HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 900, height: 620, right: 900, bottom: 620 });
}

const dom = new JSDOM('<!doctype html><html><head></head><body>' +
  fs.readFileSync('artifact.html', 'utf8') + '</body></html>',
  { runScripts: 'dangerously', pretendToBeVisual: true, beforeParse: stubCanvas });
const w = dom.window, d = w.document;

const errors = [];
w.addEventListener('error', e => errors.push(String(e.error && e.error.stack || e.message)));
w.onerror = (m, s, l, c, err) => errors.push(String(err && err.stack || m));

const steps = [];
const check = (name, cond, extra) => { steps.push({ name, ok: !!cond, extra }); return !!cond; };
const q = s => d.querySelector(s);
const all = s => [...d.querySelectorAll(s)];
const txt = s => (q(s) || {}).textContent || '';
const click = e => e && e.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const btn = re => all('#controls button').find(b => re.test(b.textContent.trim()));
const wait = ms => new Promise(r => setTimeout(r, ms));
// read a labelled number straight off the war bar
const num = label => {
  if (/your supply/i.test(label) || /regime supply/i.test(label)) {
    const cell = all('#warbar div').find(x => x.dataset && x.dataset.you !== undefined);
    if (!cell) return NaN;
    return parseInt(/your/i.test(label) ? cell.dataset.you : cell.dataset.them, 10);
  }
  const cell = all('#warbar div').find(x => x.textContent.toLowerCase().startsWith(label.toLowerCase()));
  return cell ? parseInt(cell.querySelector('b').textContent, 10) : NaN;
};

(async () => {
  await wait(400);

  check('shop renders unit cards', all('#shop .card').length >= 6, all('#shop .card').length + ' cards');

  // the page is a screen, not a document
  const css = [...d.querySelectorAll('style')].map(x => x.textContent).join('');
  const scriptText = [...d.querySelectorAll('script')].map(x => x.textContent).join('');
  // jsdom applies [hidden] even when an author display: rule should beat it, so this cannot be
  // checked with getComputedStyle — it has to be asserted structurally.
  check('the page itself does not scroll', /html,body\{height:100%;overflow:hidden\}/.test(css));
  check('layout is a three-column shell', /\.cols3\{[^}]*grid-template-columns:288px/.test(css));
  check('every column scrolls on its own', /\.scroll\{[^}]*overflow-y:auto/.test(css));
  check('the board is sized to its column in script, not just capped by CSS',
    /function fitCanvas\(\)/.test(scriptText) && /ResizeObserver/.test(scriptText));
  check('reference material is a tab, not a modal or a drawer',
    q('#manual') && q('#manual').hidden && q('#tabManual') && !/class="modal"/.test(css));
  check('hidden actually hides — [hidden] must beat display:flex',
    /\[hidden\]\{display:none!important\}/.test(css));
  check('no long-form sections left in the play area', all('.app section.shead').length === 0);
  check('the status strip stays compact', all('#warbar > div').length <= 5,
    all('#warbar > div').length + ' cells');
  const slotCell = all('#warbar > div').find(x => x.dataset && x.dataset.slotcap);
  check('field slots are shown before you hit the cap', !!slotCell,
    slotCell ? slotCell.textContent : 'not shown');
  check('and every shop card states its slot cost',
    all('#shop .card .cstat').every(c => /slot/.test(c.textContent)),
    (all('#shop .card .cstat')[0] || {}).textContent || 'none');
  check('supply is one contested bar rather than two rows of pips',
    all('#warbar .contest').length === 1 && all('#warbar .pips').length === 0);
  check('shop cards are two lines, with the prose on hover',
    all('#shop .card .cnote').length === 0 && all('#shop .card').every(c => c.title || c.disabled),
    all('#shop .card .cnote').length + ' prose blocks left');
  check('the intel line is one line, not a paragraph', txt('#hint').length < 90,
    txt('#hint').length + ' chars');

  // one panel, three tabs — no overlay anywhere
  check('army shows first', !q('#army').hidden && q('#log').hidden && q('#manual').hidden);
  click(q('#tabManual'));
  check('the manual tab shows the reference', !q('#manual').hidden && q('#army').hidden);
  check('the manual holds the army list, rarity table and the runner',
    all('#specTable tr').length > 5 && q('#btnSim') && all('#rarTable tr').length === 7,
    all('#specTable tr').length + ' unit rows, ' + all('#rarTable tr').length + ' rarity rows');
  click(q('#tabLog'));
  check('switching tabs hides the others', !q('#log').hidden && q('#manual').hidden && q('#army').hidden);
  click(q('#tabArmy'));
  check('and back to the army', !q('#army').hidden);
  check('war bar renders', all('#warbar div').length >= 4);
  check('enemy intel is shown before you buy', /incoming/i.test(txt('#hint')),
    txt('#hint').slice(0, 60));
  check('enemy is already on the board', (ops.fill || 0) > 20, (ops.fill || 0) + ' fill ops');

  // buy something
  const credits0 = num('Credits');
  const affordable = all('#shop .card').filter(c => !c.disabled);
  if (!check('at least one unit is affordable', affordable.length)) return done();
  click(affordable[0]);
  check('buying adds a squad', all('#army .sq').length === 1, all('#army .sq').length + ' squads');
  check('buying spends credits', num('Credits') < credits0, credits0 + ' -> ' + num('Credits'));

  // tech tab
  click(q('#tabTech'));
  check('field upgrades tab lists tech', all('#shop .card').length >= 6, all('#shop .card').length + ' upgrades');
  click(q('#tabUnits'));

  // buy a second squad and place it by clicking the board
  const more = all('#shop .card').filter(c => !c.disabled);
  if (more.length) click(more[0]);
  const cv2 = q('#board'), rect = cv2.getBoundingClientRect();
  const pt = (type, x, y) => cv2.dispatchEvent(new w.PointerEvent(type,
    { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
  const whereOf = () => [...d.querySelectorAll('#army .sq')].map(x => x.dataset.hex).join('|');

  // find a squad token on the board, then drag it somewhere else in the deploy zone
  const before = whereOf();
  let dragged = false, grabbed = null;
  for (let gx = 0.08; gx < 0.96 && !grabbed; gx += 0.04) {
    for (const gy of [0.83, 0.90, 0.96]) {
      pt('pointerdown', rect.width * gx, rect.height * gy);
      if (d.querySelector('#board').style.cursor === 'grabbing' || true) {
        // drop it on a different column and see whether the roster text changed
        for (let tx = 0.90; tx > 0.05 && !dragged; tx -= 0.06) {
          pt('pointermove', rect.width * tx, rect.height * gy);
          pt('pointerup', rect.width * tx, rect.height * gy);
          if (whereOf() !== before) { dragged = true; grabbed = true; break; }
          pt('pointerdown', rect.width * gx, rect.height * gy);
        }
      }
      pt('pointercancel', 0, 0);
      if (dragged) break;
    }
  }
  check('dragging a squad moves it on the board', dragged, dragged ? before + ' -> ' + whereOf() : 'roster never changed');

  // drag a unit straight from the shop onto a hex: buys and places in one motion
  {
    const card = all('#shop .card').find(c => !c.disabled);
    const squadsBefore = all('#army .sq').length, creditsB = num('Credits');
    let bought = false;
    for (let gx = 0.10; gx < 0.95 && !bought; gx += 0.06) {
      card.dispatchEvent(new w.PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }));
      w.dispatchEvent(new w.PointerEvent('pointermove', { bubbles: true, pointerId: 2,
        clientX: rect.left + rect.width * gx, clientY: rect.top + rect.height * 0.90 }));
      w.dispatchEvent(new w.PointerEvent('pointerup', { bubbles: true, pointerId: 2,
        clientX: rect.left + rect.width * gx, clientY: rect.top + rect.height * 0.90 }));
      if (all('#army .sq').length > squadsBefore) bought = true;
    }
    check('dragging from the shop buys and places in one motion', bought,
      squadsBefore + ' -> ' + all('#army .sq').length + ' squads, ' + creditsB + ' -> ' + num('Credits') + ' credits');
    check('the shop drag actually charged you', num('Credits') < creditsB);
  }

  // tap-to-place still works as a fallback
  const before2 = whereOf();
  let tapped = false;
  for (let gx = 0.08; gx < 0.96 && !tapped; gx += 0.05) {
    pt('pointerdown', rect.width * gx, rect.height * 0.93);
    pt('pointerup', rect.width * gx, rect.height * 0.93);
    if (whereOf() !== before2) tapped = true;
  }
  check('tapping an empty hex still places the selected squad', tapped,
    tapped ? '' : 'no tap placement');

  const creditsAtDeploy = num('Credits');
  // ranks: the credit sink for a slot-capped army
  check('every squad shows a rank', all('#army .sq .rank').length > 0,
    (all('#army .sq .rank')[0] || {}).textContent || 'none');
  check('squads start at D', all('#army .sq').every(r => r.dataset.rank === '0'));
  // every squad offers a way up: promote with credits, or merge three of a kind
  const rankBtns = [...d.querySelectorAll('#army .sq button')]
    .filter(b => !/hold|charge/i.test(b.textContent) && b.textContent.trim() !== '\u00d7');
  check('every squad offers a way to rank up', rankBtns.length >= all('#army .sq').length,
    rankBtns.map(b => b.textContent).join(' | ') || 'none');
  const upBtn = rankBtns.find(b => !/merge/i.test(b.textContent) && !b.disabled);
  const mergeBtn = rankBtns.find(b => /merge/i.test(b.textContent));
  check('and that is either a promotion or a merge', !!upBtn || !!mergeBtn,
    (upBtn || mergeBtn || {}).textContent || 'neither');
  if (upBtn) {
    const c0 = num('Credits');
    click(upBtn);
    check('promoting spends credits and raises the rank',
      num('Credits') < c0 && all('#army .sq').some(r => r.dataset.rank !== '0'),
      c0 + ' -> ' + num('Credits'));
  } else if (mergeBtn) {
    const n0 = all('#army .sq').length;
    click(mergeBtn);
    check('merging three squads leaves one at a higher rank',
      all('#army .sq').length < n0 && all('#army .sq').some(r => r.dataset.rank !== '0'),
      n0 + ' -> ' + all('#army .sq').length + ' squads');
  }

  // inspecting what you are up against
  {
    const cvx = q('#board'), rc = cvx.getBoundingClientRect();
    const move = (x, y) => cvx.dispatchEvent(new w.PointerEvent('pointermove',
      { bubbles: true, pointerId: 9, clientX: x, clientY: y }));
    let sawFoe = false, sawMine = false;
    for (let gx = 0.05; gx < 0.98 && !(sawFoe && sawMine); gx += 0.03) {
      for (const gy of [0.10, 0.16, 0.22, 0.86, 0.92]) {
        move(rc.width * gx, rc.height * gy);
        const box = q('#inspect');
        if (box.className === 'idle') continue;
        if (box.className === 'foe') sawFoe = true; else sawMine = true;
      }
    }
    check('hovering an enemy squad tells you what it is', sawFoe);
    check('and hovering your own does too', sawMine);
    /* The readout must never be added to or removed from the layout. It shares a flex column with
       the canvas, so toggling it resized the board and the grid jumped under the cursor on every
       hover. It is always in the flow; only its contents change. */
    move(rc.width * 0.5, rc.height * 0.5);
    const idleBox = q('#inspect');
    check('the readout keeps its place when you are pointing at nothing',
      !idleBox.hidden && idleBox.className === 'idle' && idleBox.textContent.length > 0,
      idleBox.textContent.slice(0, 40));
    const shown = q('#inspect');
    if (shown.className !== 'idle') {
      check('the readout carries the numbers you need to counter it',
        /hull/.test(shown.textContent) && /dmg/.test(shown.textContent) && /range/.test(shown.textContent),
        shown.textContent.slice(0, 70));
    }
  }
  check('the intel line names the enemy composition', /incoming/i.test(txt('#hint')), txt('#hint').slice(0, 70));

  /* The single most expensive thing a player can fail to discover: when slots are full, ranks are
     the only way credits become force. A war where you never rank up wins 0% of round ten. The
     control used to read '▲ 270', which named nothing. */
  {
    const rankBtn = [...d.querySelectorAll('#army .sq button')].find(b => /rank up/i.test(b.textContent));
    check('squads show a named rank-up control, not a bare glyph', !!rankBtn,
      rankBtn ? rankBtn.textContent : 'none found');
    if (rankBtn) check('and it says what the promotion costs', /rank up\s*\d+/i.test(rankBtn.textContent),
      rankBtn.textContent);
  }

  // stance: the one order you give
  const stanceBtn = [...d.querySelectorAll('#army .sq button')].find(b => /hold|charge/i.test(b.textContent));
  check('every squad has a stance control', !!stanceBtn, stanceBtn ? stanceBtn.textContent : 'none');
  if (stanceBtn) {
    check('squads hold by default', /hold/i.test(stanceBtn.textContent));
    click(stanceBtn);
    const after = [...d.querySelectorAll('#army .sq button')].find(b => /hold|charge/i.test(b.textContent));
    check('stance toggles to charge', /charge/i.test(after.textContent), after.textContent);
    click(after);
  }

  // clicking somewhere a squad cannot go must say so rather than silently ignoring it
  {
    const before = whereOf();
    pt('pointerdown', rect.width * 0.5, rect.height * 0.20);
    pt('pointerup', rect.width * 0.5, rect.height * 0.20);
    check('an illegal placement does not silently move anything', whereOf() === before);
    check('and it tells you why', /highlighted zone/i.test(txt('#hint')), txt('#hint').slice(0, 60));
    check('the warning is styled as a refusal', q('#hint').className.includes('deny'));
  }

  const fight = btn(/^fight$/i);
  if (!check('fight button present', fight && !fight.disabled,
    all('#controls button').map(b => b.textContent).join(' | '))) return done();
  click(fight);
  if (!check('battle starts', /battle/i.test(txt('#mainTitle')), txt('#mainTitle'))) return done();

  await wait(300);
  check('playback bar appears', q('#playbar') && !q('#playbar').hidden);
  check('the log takes over the side panel during a battle', !q('#log').hidden,
    'log hidden: ' + q('#log').hidden);
  check('the result does not float over the board', !/#summary\{[^}]*position:absolute/.test(css));
  click(q('#pbPlay'));
  const held = q('#tickTag').textContent;
  await wait(600);
  check('pause holds the battle', q('#tickTag').textContent === held, held);
  click(q('#pbStep'));
  check('step advances a tick', q('#tickTag').textContent !== held, held + ' -> ' + q('#tickTag').textContent);
  click(q('#pbPlay'));

  await wait(3200);   // a battle on the full board opens with several ticks of walking
  check('combat log fills', all('#log div').length > 0, all('#log div').length + ' lines');
  check('log shows the to-hit number', /needs \d+\+/.test(q('#log').textContent),
    (q('#log').textContent.match(/needs \d+\+[^\n]{0,26}/) || ['none'])[0]);
  check('log cannot be squashed by flexbox',
    /#log div\{[^}]*flex:0 0 auto/.test([...d.querySelectorAll('style')].map(x => x.textContent).join('')));

  for (let i = 0; i < 90 && !/result/i.test(txt('#mainTitle')); i++) await wait(400);
  if (!check('battle reaches a result', /result/i.test(txt('#mainTitle')), txt('#mainTitle'))) return done();
  check('round summary is populated', q('#summary') && !q('#summary').hidden && q('#summary').textContent.length > 20);
  check('the summary explains what happened', all('#summary .wnote').length > 0,
    (all('#summary .wnote')[0] || {}).textContent || 'no explanation');
  check('and shows a per-squad breakdown', all('#summary .ministat tr').length > 1,
    (all('#summary .ministat tr').length - 1) + ' squads listed');

  const supplyAfter = num('Your supply') + num('Regime supply');
  check('a round of supply was spent somewhere', supplyAfter < 30, supplyAfter + ' of 30 supply left');

  // unlock draft comes before the reward draft
  const unlockBtn = btn(/unlock a unit|take a reward|outcome/i);
  if (unlockBtn && /unlock/i.test(unlockBtn.textContent)) {
    click(unlockBtn);
    check('the unlock draft offers three units', all('#summary .card.boon').length === 3,
      all('#summary .card.boon').length + ' options');
    check('it says how much of the roster you field', /\d of \d machines/.test(q('#summary').textContent),
      (q('#summary').textContent.match(/\d of \d machines/) || ['none'])[0]);
    click(all('#summary .card.boon')[0]);
  } else if (unlockBtn) {
    click(unlockBtn);
  }

  // taking the unlock drops straight into the reward draft
  check('the reward draft follows', all('#summary .card.boon').length >= 3,
    all('#summary .card.boon').length + ' options');
  const boonText = q('#summary').textContent;
  /* Every offer must be cashable, so a round where nothing is useful still buys something.
     Bank the first one and confirm the credits actually arrive. */
  const bankBtns = all('#summary .btn.bank');
  check('every reward can be banked for credits instead', bankBtns.length === all('#summary .card.boon').length,
    bankBtns.length + ' bank buttons for ' + all('#summary .card.boon').length + ' rewards');
  const bankLabel = bankBtns.length ? bankBtns[0].textContent : '';
  check('the bank button says what it pays', /bank for \d+ credits/i.test(bankLabel), bankLabel);
  if (bankBtns.length) {
    const creditsBefore = w.__st ? w.__st.credits : null;
    click(bankBtns[0]);
    check('banking a reward starts the next round', /deployment/i.test(txt('#mainTitle')), txt('#mainTitle'));
    if (creditsBefore != null)
      check('and the credits landed', w.__st.credits > creditsBefore,
        creditsBefore + ' -> ' + w.__st.credits);
  }
  click(all('#summary .card.boon')[0]);
  check('taking a reward starts the next round', /deployment/i.test(txt('#mainTitle')), txt('#mainTitle'));
  check('the reward was recorded', boonText.length > 30);
  check('locked units are listed but not buyable',
    all('#shop .card.locked').length > 0 && all('#shop .card.locked').every(c => c.disabled),
    all('#shop .card.locked').length + ' locked of ' + all('#shop .card').length);

  const next = btn(/next round|outcome/i);
  // income is banked when the round resolves, so compare against what we had before fighting
  check('income arrives for the next round', num('Credits') > creditsAtDeploy,
    creditsAtDeploy + ' -> ' + num('Credits'));

  click(q('#btnSim'));
  await wait(6000);
  check('balance runner produces a table', all('#simTable tr').length > 2, all('#simTable tr').length + ' rows');

  done();
})();

function done() {
  for (const s of steps) console.log((s.ok ? '  PASS  ' : '  FAIL  ') + s.name + (s.extra ? '  [' + s.extra + ']' : ''));
  const bad = steps.filter(s => !s.ok).length;
  console.log(errors.length ? '\nJS ERRORS:\n' + [...new Set(errors)].join('\n') : '\nno JS errors');
  console.log(bad ? `\n${bad} UI CHECK(S) FAILED` : '\nUI flow OK end to end');
  process.exit(bad || errors.length ? 1 : 0);
}
