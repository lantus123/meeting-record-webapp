import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const clientNames = ['ClientCore', 'ClientSync', 'ClientPrint', 'ClientApp'];
const required = [
  'apps-script/Code.gs',
  'apps-script/Store.gs',
  'apps-script/Setup.gs',
  'apps-script/Index.html',
  'apps-script/Styles.html',
  ...clientNames.map((name) => `apps-script/${name}.html`),
  'apps-script/appsscript.json',
  'README.md'
];

for (const relative of required) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) throw new Error(`Missing required file: ${relative}`);
}

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const code = read('apps-script/Code.gs');
const store = read('apps-script/Store.gs');
const setup = read('apps-script/Setup.gs');
const index = read('apps-script/Index.html');
const styles = read('apps-script/Styles.html');
const clientHtmlParts = clientNames.map((name) => [name, read(`apps-script/${name}.html`)]);
const manifest = JSON.parse(read('apps-script/appsscript.json'));

if (manifest.runtimeVersion !== 'V8' || manifest.timeZone !== 'Asia/Taipei') {
  throw new Error('appsscript.json must use V8 and Asia/Taipei.');
}

for (const [name, source] of [
  ['Code.gs', code],
  ['Store.gs', store],
  ['Setup.gs', setup]
]) {
  try {
    new vm.Script(source, { filename: name });
  } catch (error) {
    throw new Error(`${name} syntax error: ${error.message}`);
  }
}

const clientParts = clientHtmlParts.map(([name, html]) => {
  const match = html.match(/^<script>\s*([\s\S]*?)\s*<\/script>\s*$/);
  if (!match) throw new Error(`${name}.html must contain exactly one outer script element.`);
  try {
    new vm.Script(match[1], { filename: `${name}.html` });
  } catch (error) {
    throw new Error(`${name}.html syntax error: ${error.message}`);
  }
  return match[1];
});
const client = clientParts.join('\n');

const requiredIncludes = ['Styles', ...clientNames];
if (requiredIncludes.some((name) => !new RegExp(`include\\(['\"]${name}['\"]\\)`).test(index))) {
  throw new Error('Index.html is missing Apps Script HTML includes.');
}
if (!/data-requested-record=["']<\?= requestedRecordId \?>["']/.test(index)) {
  throw new Error('Index.html must expose the sanitized requested record ID to the client.');
}

const clientIds = [
  ...client.matchAll(/querySelector\(['"]#([^'"]+)/g),
  ...client.matchAll(/getElementById\(['"]([^'"]+)/g)
].map((match) => match[1]);
const indexIds = new Set([...index.matchAll(/id=["']([^"']+)/g)].map((match) => match[1]));
const missingClientIds = [...new Set(clientIds)].filter((id) => !indexIds.has(id));
if (missingClientIds.length) {
  throw new Error(`Index.html is missing client elements: ${missingClientIds.join(', ')}`);
}

const meetingTypeValues = [...index.matchAll(/name=["']meetingType["'][^>]*value=["'](\d+)["']/g)]
  .map((match) => Number(match[1]))
  .sort((a, b) => a - b);
const expectedTypes = Array.from({ length: 16 }, (_, indexValue) => indexValue + 1);
if (JSON.stringify(meetingTypeValues) !== JSON.stringify(expectedTypes)) {
  throw new Error(`Expected meeting types 1-16, found: ${meetingTypeValues.join(', ')}`);
}

for (const subtype of ['5-1', '5-2', '5-3', '9-1', '9-2', '9-3']) {
  if (!index.includes(`value="${subtype}"`)) throw new Error(`Missing meeting subtype ${subtype}.`);
}

for (const phrase of [
  '討論內容摘要(或全文)',
  '主持人(或主任)批閱',
  '學術期刊討論會須載明期刊出處'
]) {
  if (!client.includes(phrase) && !index.includes(phrase)) {
    throw new Error(`Missing required printed text: ${phrase}`);
  }
}

for (const functionName of [
  'doGet',
  'bootstrapApp',
  'saveRecord',
  'issueAccessToken',
  'deleteRecord',
  'setupProject',
  'cleanupExpiredRecords'
]) {
  if (![code, store, setup].some((source) => new RegExp(`function\\s+${functionName}\\s*\\(`).test(source))) {
    throw new Error(`Missing server function: ${functionName}`);
  }
}

if (!styles.includes('@page { size: A4 portrait;') || !styles.includes('@media print')) {
  throw new Error('A4 print CSS is missing.');
}
if (!code.includes('XFrameOptionsMode.ALLOWALL')) {
  throw new Error('Google Sites embedding support is missing.');
}

const appSource = [code, store, setup, index, styles, client].join('\n');
if (/firebase/i.test(appSource)) throw new Error('Firebase reference remains in the Apps Script application.');

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /gh[pousr]_[0-9A-Za-z]{20,}/,
  /PASTE_YOUR_APPS_SCRIPT_ID_HERE\S+/
];
for (const pattern of secretPatterns) {
  if (pattern.test(appSource)) throw new Error(`Potential secret found: ${pattern}`);
}

console.log('Validation passed: syntax, form mapping, Apps Script includes, DOM references, print CSS, and secret scan.');
