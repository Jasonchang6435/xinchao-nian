import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Ob32Adapter } from '../src/ob32-adapter.js';
import { OmbreClient, extractText, parseMcp } from '../src/ombre-client.js';
import { ObAuth } from '../src/ob-auth.js';
import { handleMcpMessage } from '../src/mcp-protocol.js';

const SOURCE = 'aabbccddeeff';
const NEW_ID = '112233445566';
const mcpResult = (text) => ({ content: [{ type: 'text', text }] });
const tools = ['breath', 'breath_search', 'breath_advanced', 'hold', 'grow', 'trace', 'pulse', 'dream', 'I', 'feel', 'plan'];

async function fixture(t, options = {}) {
  const calls = [];
  let logins = 0;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const json = (data, status = 200, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(data));
    };
    let text = ''; for await (const chunk of request) text += chunk;
    if (path === '/auth/login') {
      logins++;
      assert.equal(JSON.parse(text).password, 'human-password');
      return json({ ok: true }, 200, { 'Set-Cookie': 'ombre_session=human-cookie; HttpOnly; Path=/' });
    }
    if (path.startsWith('/api/')) {
      calls.push({ path, cookie: request.headers.cookie });
      if (request.headers.cookie !== 'ombre_session=human-cookie') return json({ error: 'unauthorized' }, 401);
      if (path === '/api/buckets') return json([
        { id: SOURCE, name: '真实记忆', type: 'dynamic', domain: ['恋爱'], tags: ['共同记忆'], score: 9, created: '2026-09-01' },
        { id: 'locked', name: '锁信', type: 'letter', domain: ['letter'], tags: ['__letter__'], letter_locked: true },
      ]);
      if (path === '/api/bucket/locked') return json({ id: 'locked', letter_locked: true, content: 'must never escape' });
      if (path === `/api/bucket/${SOURCE}`) return json({ id: SOURCE, content: Array.from({ length: 10 }, (_, i) => `原文${i}`).join('\n') });
      return json({ error: 'not found' }, 404);
    }
    const payload = JSON.parse(text);
    assert.equal(request.headers.authorization, 'Bearer memory-token');
    if (payload.method === 'initialize') return json({ jsonrpc: '2.0', id: payload.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'OB', version: '3.2.0' } } }, 200,
      path === '/mcp-extra' ? { 'Mcp-Session-Id': 'extra-session' } : {});
    if (payload.method === 'notifications/initialized') { response.writeHead(202).end(); return; }
    if (payload.method === 'tools/list') return json({ jsonrpc: '2.0', id: payload.id, result: { tools: (path === '/mcp-extra' ? ['letter_read', 'letter_write', 'letter_lock_update'] : tools).map((name) => ({ name, inputSchema: { type: 'object', properties: {} } })) } });
    const { name, arguments: args } = payload.params;
    calls.push({ path, name, args, session: request.headers['mcp-session-id'] });
    if (options.httpError) return json({ error: 'bad request' }, 400);
    if (options.rpcError) return json({ jsonrpc: '2.0', id: payload.id, error: { code: -32602, message: 'invalid arguments' } });
    if (options.toolError) return json({ jsonrpc: '2.0', id: payload.id, result: { isError: true, ...mcpResult('validation failed') } });
    let result;
    if (name.startsWith('breath')) {
      assert.equal('mode' in args, false); assert.equal('with_ids' in args, false);
      result = mcpResult(`[权重:9.00] [bucket_id:${SOURCE}]\n当时的一件事；正文里另有 deadbeef1234`);
    } else if (name === 'pulse') {
      if (options.pulseDelayMs) await new Promise((resolve) => setTimeout(resolve, options.pulseDelayMs));
      result = mcpResult(`[${SOURCE}] 《真实记忆》 主题:恋爱 情感:V0.8/A0.4 重要:8 权重:9 标签:共同记忆`);
    }
    else if (name === 'hold') {
      assert.equal('auto' in args, false); assert.equal('source' in args, false);
      result = mcpResult(`新建→${NEW_ID} 梦境`);
    } else if (name === 'grow') result = mcpResult('1条|新1合0 batch:g_123\n📝AnEnglishTitle'); // real 3.2 title-only output
    else if (name === 'trace' && options.traceFailure) result = mcpResult('修改失败');
    else result = mcpResult('操作完成');
    json({ jsonrpc: '2.0', id: payload.id, result });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, logins: () => logins,
    config: { url: `${base}/mcp`, extraUrl: `${base}/mcp-extra`, token: 'memory-token', authMode: 'token', readEnabled: true, writeEnabled: true, breathMaxResults: 3, breathMaxTokens: 800 } };
}

test('OB3.2 surfacing adapts arguments and enriches refs with AI-side metadata only', async (t) => {
  const f = await fixture(t);
  const client = new Ob32Adapter({ ...f.config, dashboardPassword: 'human-password' });
  const material = await client.daytimeMaterialWithRefs([], { valence: .8, arousal: .4 }, new Date('2026-10-09'));
  assert.deepEqual(material.bucketIds, [SOURCE]);
  assert.deepEqual(material.domains, ['恋爱']);
  const recall = f.calls.find((call) => call.name === 'breath_advanced');
  assert.equal(recall.args.date_from, '2026-09-25');
  assert.equal(recall.args.valence, .8);
  assert.equal(f.logins(), 0);
  assert.equal(f.calls.some((call) => call.path.startsWith('/api/')), false);
  assert.deepEqual(await client.memoryBucketPreviews([SOURCE]), []);
});

test('slow metadata cannot block recall and enriches subsequent calls from cache', async (t) => {
  const f = await fixture(t, { pulseDelayMs: 1800 });
  const client = new Ob32Adapter(f.config);
  const first = await client.call('breath_search', { query: '旧事' });
  assert.match(extractText(first), new RegExp(SOURCE));
  assert.doesNotMatch(extractText(first), /\[domain:/);
  assert.equal(client.aiMetadata, null); // upstream pulse is still pending
  await client.aiMetadataBuild;
  const second = await client.call('breath_search', { query: '旧事' });
  assert.match(extractText(second), /\[domain:恋爱\]/);
  assert.equal(f.calls.filter((call) => call.name === 'pulse').length, 1);
});

test('dream write stamps legal metadata then prevents dream self-recall', async (t) => {
  const f = await fixture(t); const client = new Ob32Adapter(f.config);
  assert.equal(await client.storeDream({ dream: '梦', residue: '余韵', awareness: '觉察' }), NEW_ID);
  const hold = f.calls.find((call) => call.name === 'hold');
  assert.match(hold.args.why_remembered, /自动产出/);
  assert.equal(hold.args.tags, 'dream');
  assert.deepEqual(f.calls.find((call) => call.name === 'trace').args, { bucket_id: NEW_ID, dont_surface: 1 });
});

test('failed dream marking reports a partial write without repeating hold', async (t) => {
  const f = await fixture(t, { traceFailure: true }); const client = new Ob32Adapter(f.config);
  await assert.rejects(client.storeDream({ dream: '梦', residue: '余韵', awareness: '觉察' }), /do not repeat hold/);
  assert.equal(f.calls.filter((call) => call.name === 'hold').length, 1);
});

test('box keep uses unambiguous hold ID rather than mistaking grow title for an ID', async (t) => {
  const f = await fixture(t); const client = new Ob32Adapter(f.config);
  const content = '用户明确要留下的正文\n第二行';
  assert.equal(await client.storeHeldOutput({ content }), NEW_ID);
  assert.equal(f.calls.find((call) => call.name === 'hold').args.content, content);
  assert.equal(f.calls.some((call) => call.name === 'grow'), false);
});

test('forget is soft delete; extra letters have independent MCP session', async (t) => {
  const f = await fixture(t); const client = new Ob32Adapter(f.config);
  const list = await client.listTools();
  assert.ok(list.some((tool) => tool.name === 'forget'));
  assert.ok(list.some((tool) => tool.name === 'letter_read'));
  await client.call('forget', { bucket_id: SOURCE });
  assert.deepEqual(f.calls.find((call) => call.name === 'trace').args, { bucket_id: SOURCE, delete: true });
  await client.call('letter_read', {});
  const letter = f.calls.find((call) => call.name === 'letter_read');
  assert.equal(letter.path, '/mcp-extra'); assert.equal(letter.session, 'extra-session');
});

test('write gate rejects direct gateway writes without contacting OB', async (t) => {
  const f = await fixture(t); const client = new Ob32Adapter({ ...f.config, writeEnabled: false });
  for (const name of ['hold', 'grow', 'forget', 'plan', 'letter_write']) await assert.rejects(client.call(name, { bucket_id: SOURCE }), /ombre_write_disabled/);
  assert.equal(f.calls.length, 0);
  await client.call('I', { read: true });
  await assert.rejects(client.call('I', { content: 'write' }), /ombre_write_disabled/);
});

test('human previews respect locks and seven-line limits; human cookie never reaches MCP', async (t) => {
  const f = await fixture(t); const client = new Ob32Adapter({ ...f.config, dashboardPassword: 'human-password' });
  const map = await client.fetchBucketMapStructured();
  assert.equal(map.total, 2); assert.equal('content' in map.stars[0], false);
  const locked = await client.memoryBucketPreview('locked');
  assert.equal(locked.reason, 'locked'); assert.equal(locked.preview, '');
  const preview = await client.memoryBucketPreview(SOURCE);
  assert.equal(preview.lineCount, 7); assert.equal(preview.truncated, true);
  assert.equal(f.logins(), 1);
});

test('JSON-RPC errors and tool isError are failures, not successful empty text', async (t) => {
  const rpc = await fixture(t, { rpcError: true });
  await assert.rejects(new OmbreClient(rpc.config).call('pulse'), /RPC error/);
  const tool = await fixture(t, { toolError: true });
  await assert.rejects(new OmbreClient(tool.config).call('pulse'), /tool failed/);
});

test('ambiguous HTTP400 writes are never replayed', async (t) => {
  const f = await fixture(t, { httpError: true });
  await assert.rejects(new OmbreClient(f.config).call('hold', { content: 'once' }), /HTTP 400/);
  assert.equal(f.calls.filter((call) => call.name === 'hold').length, 1);
});

test('SSE parser selects the matching response after keepalive and notification', () => {
  const input = ': ping\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: {"jsonrpc":"2.0","id":7,"result":{\r\ndata: "tools":[]}}\r\n\r\n';
  assert.deepEqual(parseMcp(input, 7).result, { tools: [] });
  assert.throws(() => parseMcp(input, 8), /matching/);
});

test('gateway advertises and forwards advanced search and letters using upstream schemas', async (t) => {
  const f = await fixture(t); const client = new Ob32Adapter(f.config);
  const handlers = { listObTools: () => client.listTools(), callOb: (name, args) => client.call(name, args) };
  const list = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, handlers);
  for (const name of ['breath_search', 'breath_advanced', 'feel', 'plan', 'letter_read']) assert.ok(list.body.result.tools.some((tool) => tool.name === name));
  const called = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'breath_search', arguments: { query: '当时', max_results: 1 } } }, handlers);
  assert.ok(extractText(called.body).includes('当时'));
});

test('OAuth refresh is serialized and rotated credentials survive a restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ob-oauth-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let refreshes = 0;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const form = new URLSearchParams(body);
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('client_id'), 'client');
    refreshes++;
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 3600 }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = { authMode: 'oauth', oauthStatePath: join(directory, 'auth.json'), oauthClientId: 'client', oauthRefreshToken: 'seed-refresh', oauthTokenUrl: `http://127.0.0.1:${server.address().port}/token`, oauthResource: 'https://ob.example/mcp' };
  const auth = new ObAuth(config);
  assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => auth.token())), Array(8).fill('new-access'));
  assert.equal(refreshes, 1);
  assert.equal(JSON.parse(await readFile(config.oauthStatePath)).refresh_token, 'rotated-refresh');
  assert.equal((await stat(config.oauthStatePath)).mode & 0o777, 0o600);
  assert.equal(await new ObAuth(config).token(), 'new-access');
  assert.equal(refreshes, 1);
});

test('real HTTP service completes Claude-style OAuth/PKCE, bridges OB, and gates writes', async (t) => {
  const f = await fixture(t);
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-http-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const publicBase = 'https://xinchao.test';
  const app = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), SERVICE_TOKEN: 'service-'.repeat(8), SHADOW_MODE: 'true',
      STATE_PATH: join(directory, 'state.json'), PERSONALITY_PATH: join(directory, 'personality.json'),
      TRANSITION_JOURNAL_PATH: join(directory, 'transitions.jsonl'), CABIN_STATE_PATH: join(directory, 'cabin.json'),
      BOX_STATE_PATH: join(directory, 'box.json'), OAUTH_STATE_PATH: join(directory, 'oauth.json'),
      MCP_ENABLED: 'true', OAUTH_ENABLED: 'true', OAUTH_PUBLIC_BASE_URL: publicBase, OAUTH_APPROVAL_TOKEN: 'approval-'.repeat(8),
      DASHBOARD_ENABLED: 'true', DASHBOARD_PUBLIC_BASE_URL: base, DASHBOARD_ACCESS_TOKEN: 'dashboard-'.repeat(8),
      OMBRE_ADAPTER: 'ob32', OMBRE_AUTH_MODE: 'token', OMBRE_MCP_URL: f.config.url, OMBRE_MCP_EXTRA_URL: f.config.extraUrl,
      OMBRE_MCP_TOKEN: 'memory-token', OMBRE_READ_ENABLED: 'true', OMBRE_WRITE_ENABLED: 'true',
      OMBRE_DASHBOARD_PASSWORD: 'human-password', OMBRE_DASHBOARD_SESSION: '', OMBRE_DASHBOARD_BASE_URL: f.base,
      MODEL_ENABLED: 'false', BARK_ENABLED: 'false', BRIDGE_ENABLED: 'false', DAYTIME_EMERGENCE_ENABLED: 'false', ATTENTION_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  app.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  t.after(async () => {
    if (app.exitCode == null && app.signalCode == null) {
      app.kill('SIGTERM'); await new Promise((resolve) => app.once('exit', resolve));
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('service startup timed out')), 10000);
    app.stdout.on('data', (chunk) => { if (chunk.toString().includes('service_started')) { clearTimeout(timer); resolve(); } });
    app.once('exit', (code) => { clearTimeout(timer); reject(new Error(`service exited ${code}: ${stderr}`)); });
  });
  const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  assert.equal((await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' })).status, 401);
  const discovery = await fetch(base + '/.well-known/oauth-authorization-server').then((r) => r.json());
  assert.equal(discovery.token_endpoint, publicBase + '/oauth/token');
  const redirect = 'https://claude.ai/api/mcp/auth_callback';
  const client = await post('/oauth/register', { redirect_uris: [redirect], client_name: 'Claude test' }).then((r) => r.json());
  const verifier = 'v'.repeat(43);
  const values = { response_type: 'code', client_id: client.client_id, redirect_uri: redirect, resource: publicBase + '/mcp', state: 'test-state',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', approval_token: 'approval-'.repeat(8) };
  const authorized = await fetch(base + '/oauth/authorize', { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  assert.equal(authorized.status, 302, authorized.status !== 302 ? await authorized.text() : '');
  const callback = new URL(authorized.headers.get('location'));
  assert.equal(callback.searchParams.get('state'), 'test-state');
  const token = await post('/oauth/token', { grant_type: 'authorization_code', client_id: client.client_id,
    redirect_uri: redirect, code: callback.searchParams.get('code'), code_verifier: verifier, resource: publicBase + '/mcp' }).then((r) => r.json());
  assert.ok(token.access_token && token.refresh_token);
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json, text/event-stream' };
  const initialized = await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude test', version: '1' } } }, headers);
  assert.equal(initialized.status, 200);
  headers['Mcp-Session-Id'] = initialized.headers.get('mcp-session-id');
  const list = await post('/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/list' }, headers).then((r) => r.json());
  const names = list.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('xinchao_context') && names.includes('breath_search') && names.includes('letter_read'));
  assert.equal(names.includes('hold'), false); // shadow mode gates forwarded writes, too
  const denied = await post('/mcp', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'hold', arguments: { content: 'never written' } } }, headers).then((r) => r.json());
  assert.equal(denied.result.isError, true);
  assert.equal(f.calls.some((call) => call.name === 'hold'), false);
  const dashboard = await post('/dashboard/session', { access_token: 'dashboard-'.repeat(8) });
  const cookie = dashboard.headers.get('set-cookie').split(';')[0];
  const snapshot = await fetch(base + '/dashboard/api/snapshot', { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.equal(snapshot.drives.length, 11);
  assert.equal(JSON.stringify(snapshot).includes('memory-token'), false);
  const preview = await fetch(base + `/dashboard/api/memory-bucket?id=${SOURCE}`, { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.equal(preview.lineCount, 7);
});
