const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'x-clean-ui.user.js'), 'utf8');
const header = source.match(/^\/\/ ==UserScript==\r?\n[\s\S]*?^\/\/ ==\/UserScript==/m)?.[0];
if (!header) throw new Error('Userscript metadata header is missing');

const base = 'https://naoaki0.github.io/x-clean-ui/';
for (const [key, value] of Object.entries({
  version: /\d+\.\d+\.\d+/,
  updateURL: `${base}x-clean-ui.meta.js`,
  downloadURL: `${base}x-clean-ui.user.js`,
})) {
  const actual = header.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'))?.[1];
  if (!actual || (value instanceof RegExp ? !value.test(actual) : actual !== value)) {
    throw new Error(`Invalid @${key} in userscript metadata`);
  }
}

const output = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'x-clean-ui.user.js'), source);
fs.writeFileSync(path.join(output, 'x-clean-ui.meta.js'), `${header}\n`);
