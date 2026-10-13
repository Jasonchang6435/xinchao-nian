import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newState } from '../src/engine.js';

test('real MCP exchanges retain presence after private text is classified', { timeout: 15000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'xinchao-exchange-'));
  const statePath = join(directory, 'state.json');
  const beforeTime = new Date(Date.now() - 3 * 3600000);
  const seed = newState(beforeTime);
  seed.consciousness = 'sleeping';
  seed.sleepStartedAt = beforeTime.toISOString();
  seed.lastSettledAt = new Date().toISOString();
  seed.drives = Object.fromEntries(Object.keys(seed.drives).map((key) => [key, 0.35]));
  await writeFile(statePath, JSON.stringify(seed));

  let modelCalls = 0;
  let memoryWrites = 0;
  const provider = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw || '{}');
    const send = (value) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (request.url === '/v1/chat/completions') {
      modelCalls += 1;
      send({ choices: [{ message: { content: JSON.stringify({ type: 'sharing', tone: 'warm', warmth: 0.8, tension: 0.05 }) } }] });
      return;
    }
    if (input.method === 'notifications/initialized') {
      response.writeHead(202).end();
      return;
    }
    if (input.method === 'initialize') {
      send({ jsonrpc: '2.0', id: input.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'synthetic-memory', version: 'test' } } });
      return;
    }
    if (input.method === 'tools/call') {
      memoryWrites += 1;
      send({ jsonrpc: '2.0', id: input.id, result: { content: [{ type: 'text', text: 'synthetic memory accepted' }], isError: false } });
      return;
    }
    response.writeHead(404).end();
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;

  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const serviceToken = 'synthetic-service-token-'.repeat(3);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url))], {
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      SERVICE_TOKEN: serviceToken,
      STATE_PATH: statePath,
      PERSONALITY_PATH: join(directory, 'personality.json'),
      TRANSITION_JOURNAL_PATH: join(directory, 'transitions.jsonl'),
      OAUTH_STATE_PATH: join(directory, 'oauth.json'),
      BOX_STATE_PATH: join(directory, 'box.json'),
      CABIN_STATE_PATH: join(directory, 'cabin.json'),
      BRIDGE_STATE_PATH: join(directory, 'bridge.json'),
      MCP_ENABLED: 'true',
      OAUTH_ENABLED: 'false',
      MODEL_ENABLED: 'true',
      MODEL_API_KEY: 'synthetic-key',
      MODEL_BASE_URL: `${providerUrl}/v1`,
      OMBRE_MCP_URL: `${providerUrl}/mcp`,
      OMBRE_MCP_TOKEN: 'synthetic-memory-token',
      OMBRE_READ_ENABLED: 'true',
      SHADOW_MODE: 'true',
      OMBRE_WRITE_ENABLED: 'false',
      DREAM_ENABLED: 'false',
      AWARENESS_ENABLED: 'false',
      BRIDGE_ENABLED: 'false',
      SETTLE_INTERVAL_MINUTES: '1440',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  t.after(async () => {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (!exited) {
      const exit = once(child, 'exit');
      child.kill('SIGTERM');
      await exit;
    }
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`synthetic server exited: ${output}`);
    try {
      ready = (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(100) })).ok;
    } catch { /* The child has not listened yet. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(ready, output);
  const headers = { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json', 'Mcp-Session-Id': 'synthetic-exchange-session' };
  const state = async () => fetch(`${baseUrl}/v1/state`, { headers }).then((response) => response.json());
  const call = async (name, args) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    assert.equal(response.status, 200);
    const result = (await response.json()).result;
    assert.equal(result.isError, false, result.content?.[0]?.text);
    return result.structuredContent;
  };

  await t.test('memory storage alone does not invent a current interaction', async () => {
    const before = await state();
    await call('hold', { text: 'Synthetic memory', meaning: 'integration test' });
    const after = await state();
    assert.equal(memoryWrites, 1);
    assert.deepEqual(after.drives, before.drives);
    assert.equal(after.lastHeartbeatAt, before.lastHeartbeatAt);
    assert.equal(after.consciousness, 'sleeping');
  });
  await t.test('an AI self-report without an exchange does not wake or mark human presence', async () => {
    const before = await state();
    await call('xinchao_event', { event_id: 'synthetic-self-report', interaction_type: 'reflection' });
    const after = await state();
    assert.equal(modelCalls, 0);
    assert.equal(after.consciousness, 'sleeping');
    assert.equal(after.lastConversationAt, before.lastConversationAt);
    assert.equal(after.lastHeartbeatAt, before.lastHeartbeatAt);
  });
  const exchange = '她说：今天我把自己的旅行计划分享给你。 他回：听完了，我们一起整理了计划。';
  const args = { event_id: 'synthetic-real-exchange', exchange };
  let afterExchange;
  await t.test('a classified real exchange changes state and wakes the mind', async () => {
    const before = await state();
    const result = await call('xinchao_event', args);
    afterExchange = await state();
    assert.equal(modelCalls, 1);
    assert.equal(result.interaction.applied, true);
    assert.equal(afterExchange.consciousness, 'awake');
    assert.notEqual(afterExchange.lastConversationAt, before.lastConversationAt);
    assert.notEqual(afterExchange.lastHeartbeatAt, before.lastHeartbeatAt);
    assert.ok(afterExchange.drives.share < before.drives.share);
    assert.ok(afterExchange.emotion.valence > before.emotion.valence);
  });
  await t.test('retries do not repeat effects or refresh presence', async () => {
    const result = await call('xinchao_event', args);
    const after = await state();
    assert.equal(result.duplicate, true);
    assert.deepEqual(after.drives, afterExchange.drives);
    assert.equal(after.lastHeartbeatAt, afterExchange.lastHeartbeatAt);
    assert.equal(after.lastConversationAt, afterExchange.lastConversationAt);
  });
  await t.test('classification throttling still records real human presence', async () => {
    await call('xinchao_event', { event_id: 'synthetic-throttled-exchange', exchange });
    const after = await state();
    assert.equal(modelCalls, 1);
    assert.equal(after.consciousness, 'awake');
    assert.ok(Date.parse(after.lastHeartbeatAt) >= Date.parse(afterExchange.lastHeartbeatAt));
  });
  await t.test('private exchange text is absent from persisted state and journal', async () => {
    assert.equal((await readFile(statePath, 'utf8')).includes(exchange), false);
    assert.equal((await readFile(join(directory, 'transitions.jsonl'), 'utf8')).includes(exchange), false);
  });
});
