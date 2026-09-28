const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('Pages artifacts come from the single userscript source and expose matching update URLs', (t) => {
  const root = path.join(__dirname, '..');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'x-clean-ui-release-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-userscript.cjs'), output]);

  const source = fs.readFileSync(path.join(root, 'x-clean-ui.user.js'), 'utf8');
  const download = fs.readFileSync(path.join(output, 'x-clean-ui.user.js'), 'utf8');
  const update = fs.readFileSync(path.join(output, 'x-clean-ui.meta.js'), 'utf8');
  assert.equal(download, source);
  assert.ok(source.startsWith(update.trimEnd()));
  assert.ok(update.trimEnd().endsWith('// ==/UserScript=='));
  assert.match(update, /^\/\/ @version\s+\d+\.\d+\.\d+$/m);
  assert.match(update, /^\/\/ @match\s+https:\/\/x\.com\/\*$/m);
  assert.match(update, /^\/\/ @match\s+https:\/\/twitter\.com\/\*$/m);
  assert.match(update, /^\/\/ @updateURL\s+https:\/\/naoaki0\.github\.io\/x-clean-ui\/x-clean-ui\.meta\.js$/m);
  assert.match(update, /^\/\/ @downloadURL\s+https:\/\/naoaki0\.github\.io\/x-clean-ui\/x-clean-ui\.user\.js$/m);
});
