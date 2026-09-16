const Patcher = require('./patcher');
const fs = require('fs');
const path = require('path');

const testDir = path.join(__dirname, 'test_workspace');
if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
fs.mkdirSync(testDir);

const sampleFile = path.join(testDir, 'app.js');
fs.writeFileSync(sampleFile, 'function main() {\n  console.log("hello world");\n}\nmain();\n', 'utf8');

const patcher = new Patcher(testDir);

const diffText = [
  'Here is the update:',
  'FILE: app.js',
  '<<<<<<< SEARCH',
  'function main() {',
  '  console.log("hello world");',
  '}',
  '=======',
  'function main() {',
  '  console.log("hello from Gemini Antigravity Bridge!");',
  '}',
  '>>>>>>>',
  '',
  'FILE_NEW: utils.js',
  '`javascript',
  'export function add(a, b) {',
  '  return a + b;',
  '}',
  '`'
].join('\n');

const res = patcher.applyDiff(diffText);
console.log('Patch results:', JSON.stringify(res, null, 2));

const updated = fs.readFileSync(sampleFile, 'utf8');
console.log('Updated app.js content:\n' + updated);

const utilsFile = path.join(testDir, 'utils.js');
console.log('Utils created:', fs.existsSync(utilsFile));

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });
