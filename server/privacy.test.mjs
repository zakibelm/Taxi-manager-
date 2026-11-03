import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { hasPersonalData } from './privacy.mjs';
import { createChatMiddleware } from './chat.mjs';
test('direct identifiers are detected, ordinary driver questions are not', () => {
 for (const bad of ['écris à jean@example.com', 'appelle le 450-555-1234', '(514) 555 0199', '+1 450.555.1234', '4111 1111 1111 1111', 'client 4504123456'])
  assert.equal(hasPersonalData(bad), true, bad);
 for (const ok of ['Quel est mon revenu total cette semaine ?', 'J’ai fait 120.00 45.50 32.00 et 15.00 aujourd’hui', 'Courses 2026-10-11 de 18 h à 23 h', 'Total 1 234,50 $ en 12 courses', '1234 5678 9012 3456'])
  assert.equal(hasPersonalData(ok), false, ok);
});
test('chat refuses personal data before any provider call and without consuming the provider', async () => {
 let calls = 0;
 const middleware = createChatMiddleware({ getUser: () => ({ id: 'u', email: 'a@example.test', role: 'chauffeur' }), services: { list: async () => [] }, provider: { complete: async () => { calls++; return 'ok'; } } });
 const server = createServer((req, res) => middleware(req, res, () => res.end()));
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const send = message => fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, includeServices: false }) });
 try {
  const refused = await send('mon courriel est moi@example.com');
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /courriel/);
  assert.equal(calls, 0);
  assert.equal((await send('Combien ai-je gagné ?')).status, 200); assert.equal(calls, 1);
 } finally { await new Promise(r => server.close(r)); }
});
