const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const html = readFileSync(require.resolve('../index.html'), 'utf8');
const submission = html.split("$('#leadForm').onsubmit=")[1].split('</script>')[0];

function form(fetch, { legacyCrypto = false, phone = '+593900000011' } = {}) {
  const nodes = {
    '#leadForm': {}, '#submitLead': { disabled: false, textContent: 'Revelar mi destino ✦' },
    '#leadName': { value: 'PRUEBA CONFIRMACIÓN' }, '#leadConsent': { checked: false },
    '#leadPhone': { value: phone, focus() { this.focused = true; } }, '#leadError': { textContent: '' }
  };
  let readings = 0, ids = 0;
  const context = vm.createContext({
    $: selector => nodes[selector], startReading: () => readings++, fetch, AbortController,
    crypto: { randomUUID: legacyCrypto ? undefined : () => '00000000-0000-4000-8000-' + String(++ids).padStart(12, '0'),
      getRandomValues: bytes => { ids++; bytes.fill(7); return bytes; } },
    setTimeout: (fn, delay) => { if (delay === 750) queueMicrotask(fn); return 1; }, clearTimeout() {}
  });
  vm.runInContext("let registrationId='';const topic='Mi estrategia';$('#leadForm').onsubmit=" + submission, context);
  return { nodes, submit: () => nodes['#leadForm'].onsubmit({ preventDefault() {} }),
    get readings() { return readings; }, get ids() { return ids; } };
}
function receipt(options) {
  return Response.json({ ok: true, stored: true, row: 2,
    registrationId: JSON.parse(options.body).registrationId });
}

test('a lost response after saving is retried automatically with the same registration ID', async () => {
  const bodies = [], saved = new Set();
  const f = form(async (url, options) => {
    assert.equal(url, '/api/lead'); assert.equal(options.method, 'POST');
    bodies.push(options.body); saved.add(JSON.parse(options.body).registrationId);
    if (bodies.length === 1) throw new TypeError('Connection lost after storage');
    return receipt(options);
  });
  await f.submit();
  assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]); assert.equal(saved.size, 1);
  assert.equal(f.readings, 1); assert.equal(f.ids, 1); assert.equal(f.nodes['#submitLead'].disabled, false);
  assert.equal(f.nodes['#leadError'].textContent, '');
});

test('a temporary server timeout is retried and a confirmed receipt unlocks the cards', async () => {
  let calls = 0;
  const f = form(async (url, options) => ++calls === 1 ?
    Response.json({ code: 'WEBHOOK_TIMEOUT' }, { status: 502 }) : receipt(options));
  await f.submit(); assert.equal(calls, 2); assert.equal(f.readings, 1);
});

test('two failures keep the cards locked and a later manual retry preserves the ID', async () => {
  const bodies = [];
  const f = form(async (url, options) => {
    bodies.push(options.body);
    return bodies.length <= 2 ? Response.json({ code: 'WEBHOOK_NETWORK_ERROR' }, { status: 502 }) : receipt(options);
  });
  await f.submit(); assert.equal(f.readings, 0); assert.equal(bodies.length, 2);
  assert.match(f.nodes['#leadError'].textContent, /confirmar tu registro/);
  await f.submit(); assert.equal(f.readings, 1); assert.equal(bodies[0], bodies[2]); assert.equal(f.ids, 1);
});

test('invalid data is explained and is not repeatedly sent to the server', async () => {
  let calls = 0;
  const f = form(async () => { calls++; return Response.json({ code: 'INVALID_DATA' }, { status: 400 }); });
  await f.submit(); assert.equal(calls, 1); assert.equal(f.readings, 0);
  assert.match(f.nodes['#leadError'].textContent, /Revisa tu nombre y número/);
  const badPhone = form(async () => { throw Error('must not send'); }, { phone: '-------1' });
  await badPhone.submit(); assert.equal(badPhone.readings, 0);
  assert.equal(badPhone.nodes['#leadPhone'].focused, true);
  assert.match(badPhone.nodes['#leadError'].textContent, /8 dígitos/);
});

test('a receipt for a different registration never reveals the cards', async () => {
  let calls = 0;
  const f = form(async () => { calls++; return Response.json({ ok: true, stored: true, registrationId: 'wrong-id' }); });
  await f.submit(); assert.equal(calls, 2); assert.equal(f.readings, 0);
});

test('browsers without randomUUID generate a valid stable ID and can register', async () => {
  const ids = [];
  const f = form(async (url, options) => {
    ids.push(JSON.parse(options.body).registrationId);
    if (ids.length === 1) throw new TypeError('Temporary connection failure');
    return receipt(options);
  }, { legacyCrypto: true });
  await f.submit(); assert.match(ids[0], /^[A-Za-z0-9_-]{16,80}$/);
  assert.equal(ids[0], ids[1]); assert.equal(f.readings, 1);
});

test('double clicking a pending submission cannot send a second registration', async () => {
  let resolve, calls = 0;
  const f = form((url, options) => {
    calls++; return new Promise(r => { resolve = () => r(receipt(options)); });
  });
  const pending = f.submit(); await f.submit(); assert.equal(calls, 1);
  resolve(); await pending; assert.equal(f.readings, 1);
});
