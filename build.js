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
for (const m of ['/*__HEX__*/', '/*__META__*/', '/*__ARMY__*/', '/*__BATTLE__*/'])
  if (!tpl.includes(m)) throw new Error('template.html is missing the ' + m + ' marker');

// order matters: hex first, then army, then battle — each falls back to the previous ones' globals
const body = tpl.replace('/*__HEX__*/', hex).replace('/*__META__*/', meta)
  .replace('/*__ARMY__*/', army).replace('/*__BATTLE__*/', battle);
fs.writeFileSync('artifact.html', body);
fs.writeFileSync('prototype.html',
  '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">\n</head>\n<body>\n' + body + '\n</body>\n</html>\n');

// Parse-check the combined script exactly as the browser will see it.
const script = body.slice(body.indexOf('<script>') + 8, body.lastIndexOf('</script>'));
new Function(script);
console.log('built  artifact.html ' + (body.length / 1024).toFixed(1) + 'kb   script parsed clean');
