const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { test, afterEach } = require('node:test');
const handler = require('../api/lead.js');
const originalFetch = global.fetch;
const originalEnv = process.env.LEADS_WEBHOOK_URL;
const payload = { name: 'PRUEBA AUTOMÁTICA', phone: '+593 900000001', topic: 'Mi estrategia',
  marketingConsent: false, registrationId: 'test-registration-20261010' };
const validUrl = 'https://script.google.com/macros/s/test-deployment/exec';
afterEach(() => {
  global.fetch = originalFetch;
  if (originalEnv === undefined) delete process.env.LEADS_WEBHOOK_URL;
  else process.env.LEADS_WEBHOOK_URL = originalEnv;
});
async function request(body = payload, method = 'POST') {
  const res = { statusCode: 200, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; } };
  await handler({ method, body }, res);
  return res;
}
function scriptRuntime({ writeFails = false, lockAvailable = true } = {}) {
  const rows = [['Fecha y hora', 'Nombre', 'WhatsApp', 'Tema consultado', 'Carta 1', 'Carta 2',
    'Carta 3', 'Consentimiento comercial', 'Fecha del consentimiento', 'Clic en WhatsApp',
    'Estado del lead', 'Observaciones']];
  let released = false, flushed = false;
  const sheet = { getLastRow: () => rows.length,
    getRange(row, col, n = 1, m = 1) { return {
      getValues: () => Array.from({ length: n }, (_, i) =>
        Array.from({ length: m }, (_, j) => rows[row - 1 + i]?.[col - 1 + j] ?? '')),
      setValue(value) {
        if (writeFails) throw Error('Permission denied');
        rows[row - 1] ||= []; rows[row - 1][col - 1] = value;
      },
      setValues(values) {
        if (writeFails) throw Error('Permission denied');
        values.forEach((valuesRow, i) => {
          rows[row - 1 + i] ||= [];
          valuesRow.forEach((v, j) => { rows[row - 1 + i][col - 1 + j] = v; });
        });
      },
      setNumberFormat() {}, getValue: () => rows[row - 1]?.[col - 1] ?? '',
      createTextFinder(value) { return {
        matchEntireCell() { return this; }, useRegularExpression() { return this; },
        findNext() {
          for (let i = row - 1; i < row - 1 + n; i++)
            if (rows[i]?.[col - 1] === value) return { getRow: () => i + 1 };
          return null;
        }
      }; }
    }; }
  };
  const context = vm.createContext({
    ContentService: { MimeType: { JSON: 'application/json' },
      createTextOutput(text) { return { text, setMimeType() { return this; } }; } },
    LockService: { getScriptLock: () => ({ tryLock: () => lockAvailable,
      releaseLock() { released = true; } }) },
    SpreadsheetApp: {
      openById(id) {
        assert.equal(id, '1Y3IIHMdPra7Q0pJMHd6dK0-317lLjUcP0aJagp0NHss');
        return { getSheetByName(name) { assert.equal(name, 'Registros'); return sheet; } };
      }, flush() { flushed = true; }
    }
  });
  vm.runInContext(readFileSync(require.resolve('../google-apps-script/Code.gs'), 'utf8'), context);
  return { rows, get released() { return released; }, get flushed() { return flushed; },
    post: body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text),
    raw: contents => JSON.parse(context.doPost({ postData: { contents } }).text) };
}
test('HTTP 200 HTML cannot unlock the cards', async () => {
  process.env.LEADS_WEBHOOK_URL = validUrl;
  global.fetch = async () => new Response('<html>Script error</html>');
  const r = await request();
  assert.equal(r.statusCode, 502); assert.equal(r.body.code, 'WEBHOOK_NOT_JSON');
});
test('HTTP 200 with a script error or no row receipt is rejected', async () => {
  process.env.LEADS_WEBHOOK_URL = validUrl;
  for (const reply of [{ ok: false }, { ok: true }]) {
    global.fetch = async () => Response.json(reply);
    assert.equal((await request()).body.code, 'WEBHOOK_SAVE_NOT_CONFIRMED');
  }
});
test('receipts for a different lead or sheet are rejected', async () => {
  process.env.LEADS_WEBHOOK_URL = validUrl;
  for (const reply of [
    { ok: true, stored: true, row: 2, sheet: 'Registros', registrationId: 'other-registration' },
    { ok: true, stored: true, row: 2, sheet: 'Wrong tab', registrationId: payload.registrationId }
  ]) { global.fetch = async () => Response.json(reply); assert.equal((await request()).statusCode, 502); }
});
test('missing, dev and non-Google webhook URLs never send data', async () => {
  let called = false; global.fetch = async () => { called = true; };
  for (const url of ['', 'https://script.google.com/macros/s/test/dev', 'https://example.com/exec']) {
    process.env.LEADS_WEBHOOK_URL = url; assert.equal((await request()).statusCode, 503);
  }
  assert.equal(called, false);
});
test('input validation and HTTP method are enforced', async () => {
  process.env.LEADS_WEBHOOK_URL = validUrl;
  for (const body of [{ ...payload, phone: '        ' }, { ...payload, marketingConsent: 'false' }, { ...payload, name: '' }])
    assert.equal((await request(body)).statusCode, 400);
  const r = await request(payload, 'GET'); assert.equal(r.statusCode, 405); assert.equal(r.headers.Allow, 'POST');
});
test('Vercel to doPost writes a row and retries without duplicates', async () => {
  process.env.LEADS_WEBHOOK_URL = validUrl;
  const script = scriptRuntime();
  global.fetch = async (url, options) => {
    assert.equal(url, validUrl); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'follow');
    return Response.json(script.post(JSON.parse(options.body)));
  };
  const r = await request(); assert.equal(r.statusCode, 200); assert.equal(r.body.row, 2);
  assert.equal(script.rows[1][1], payload.name); assert.equal(script.rows[1][2], "'" + payload.phone);
  assert.equal(script.rows[1][3], payload.topic); assert.equal(script.rows[1][7], 'No');
  assert.equal(script.rows[1][8], ''); assert.equal(script.rows[1][10], 'Nuevo');
  assert.equal(script.rows[1][11], ''); assert.equal(script.rows[1][12], payload.registrationId);
  assert.equal(script.flushed, true); assert.equal(script.released, true);
  assert.equal((await request()).body.row, 2); assert.equal(script.rows.length, 2);
});
test('doPost validates JSON, boolean consent, locks and failed writes', () => {
  assert.equal(scriptRuntime().raw('not-json').code, 'INVALID_JSON');
  assert.equal(scriptRuntime().post({ ...payload, marketingConsent: 'false' }).code, 'INVALID_DATA');
  assert.equal(scriptRuntime({ lockAvailable: false }).post(payload).code, 'BUSY');
  const failing = scriptRuntime({ writeFails: true });
  assert.equal(failing.post(payload).ok, false); assert.equal(failing.released, true);
  const s = scriptRuntime(); assert.equal(s.post({ ...payload, name: '=SUM(1,2)', marketingConsent: true }).stored, true);
  assert.equal(s.rows[1][1], "'=SUM(1,2)"); assert.equal(s.rows[1][7], 'Sí'); assert.ok(s.rows[1][8]);
});
test('tarot markup, CSS, card content and game rendering remain unchanged', () => {
  const before = execFileSync('git', ['show', 'e33269e5ba4b72cc51760015c70a9cbe80c72586:index.html'], { encoding: 'utf8' });
  const after = readFileSync(require.resolve('../index.html'), 'utf8');
  assert.equal(after.split('<script>')[0], before.split('<script>')[0]);
  const js = after.split('<script>')[1].split('</script>')[0]; new vm.Script(js);
  assert.ok(js.includes('receipt.stored!==true'));
  assert.equal(after.split('const startReading=')[1].split("$('#leadForm').onsubmit")[0],
    before.split('const startReading=')[1].split("$('#leadForm').onsubmit")[0]);
});
