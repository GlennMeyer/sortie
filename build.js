'use strict';
/* Inlines sim.js into the page so the prototype and the balance runner share one source of truth.
   Emits artifact.html (body content, for publishing) and prototype.html (standalone, for local viewing).
   campaign.js falls back to reading sim's globals when there is no module system, which is
   exactly the situation here — sim.js is inlined first, in the same script scope. */
const fs = require('fs');
const hex = fs.readFileSync('hex.js', 'utf8');
const meta = fs.readFileSync('meta.js', 'utf8');
const army = fs.readFileSync('army.js', 'utf8');
const battle = fs.readFileSync('battle.js', 'utf8');
const tpl = fs.readFileSync('template.html', 'utf8');
for (const m of ['/*__HEX__*/', '/*__META__*/', '/*__ARMY__*/', '/*__BATTLE__*/', '/*__RENDER__*/'])
  if (!tpl.includes(m)) throw new Error('template.html is missing the ' + m + ' marker');

/* The renderer is TypeScript and is compiled by vite (npm run render) into render.js, which is
   committed for the same reason artifact.html is: the delivery format is one file with no build
   step at the far end. If it is missing the page still runs — the board falls back to flat
   tokens — so a stale checkout degrades rather than breaks. */
let render = '';
try { render = fs.readFileSync('render.js', 'utf8'); }
catch { console.warn('  no render.js — building without the board renderer (run: npm run render)'); }

// order matters: hex first, then army, then battle — each falls back to the previous ones' globals
const body = tpl.replace('/*__HEX__*/', hex).replace('/*__META__*/', meta)
  .replace('/*__ARMY__*/', army).replace('/*__BATTLE__*/', battle)
  .replace('/*__RENDER__*/', () => render);
fs.writeFileSync('artifact.html', body);
fs.writeFileSync('prototype.html',
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">\n</head>\n<body>\n' + body + '\n</body>\n</html>\n');

/* Parse-check the game script exactly as the browser will see it. The renderer bundle sits in a
   script of its own ahead of this one — it is machine-generated and already type-checked, and
   including it here would only mean parsing minified output to no purpose. */
const script = body.slice(body.lastIndexOf('<script>') + 8, body.lastIndexOf('</script>'));
new Function(script);
/* The same file twice: artifact.html is what gets published to claude.ai, index.html is what
   GitHub Pages serves at glennmeyer.github.io/sortie. Writing both here means a build can never
   leave one of them a version behind. */
fs.writeFileSync('index.html', body);
console.log('built  artifact.html + index.html ' + (body.length / 1024).toFixed(1) + 'kb   script parsed clean');
