// Runs inside the real heart container on an isolated Docker network.
// OB requests go through a TLS proxy to the real OB3.2 implementation.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { loadConfig } from '/app/src/config.js';
import { Ob32Adapter } from '/app/src/ob32-adapter.js';
import { extractText } from '/app/src/ombre-client.js';
import { OmbreClient } from '/app/src/ombre-client.js';

assert.equal(process.getuid(), 1000, 'Run scenarios as the same unprivileged UID as the heart server');
const cfg = loadConfig();
const base = 'https://ob.lab.test';
const heart = 'http://127.0.0.1:18110';
const report = [];
const check = (name, data = {}) => { report.push({ name, passed: true, ...data }); };
const control = async (data) => fetch('http://provider:8001/lab/control', {
  ...(data ? { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } } : {}),
}).then(r => r.json());
async function request(url, data, headers = {}, form = false) {
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(120000),
    ...(data ? { method: 'POST', body: form ? new URLSearchParams(data) : JSON.stringify(data) } : {}),
    headers: { ...(data ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...headers } });
  return r;
}
async function grant(origin, password, upstream = false) {
  const meta = await request(origin + '/.well-known/oauth-authorization-server').then(r => r.json());
  const redirect = 'http://127.0.0.1:49123/callback';
  const verifier = randomBytes(32).toString('base64url');
  const client = await request(origin + '/oauth/register', { redirect_uris: [redirect], client_name: 'isolated-data-safety-lab',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }).then(r => r.json());
  assert.ok(client.client_id);
  const resource = upstream ? base + '/mcp' : cfg.oauth.publicBaseUrl + '/mcp';
  const auth = await request(origin + '/oauth/authorize', {
    response_type: 'code', client_id: client.client_id, redirect_uri: redirect, resource, state: 'lab-state',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    ...(upstream ? { password, scope: 'mcp' } : { approval_token: password }),
  }, {}, true);
  assert.equal(auth.status, 302, 'Real OAuth authorization must succeed');
  const callback = new URL(auth.headers.get('location'));
  assert.equal(callback.searchParams.get('state'), 'lab-state');
  const token = await request(origin + '/oauth/token', { grant_type: 'authorization_code', code: callback.searchParams.get('code'),
    client_id: client.client_id, redirect_uri: redirect, code_verifier: verifier, resource }, {}, true).then(r => r.json());
  assert.ok(token.access_token && token.refresh_token);
  return { ...token, client_id: client.client_id, token_endpoint: meta.token_endpoint, resource,
    expires_at: Date.now() + token.expires_in * 1000 };
}
let cookie;
async function buckets(path = '/api/buckets') {
  if (!cookie) {
    const login = await request(base + '/auth/login', { password: process.env.LAB_OB_PASSWORD });
    assert.equal(login.status, 200);
    cookie = login.headers.getSetCookie().find(x => x.startsWith('ombre_session=')).split(';')[0];
  }
  const r = await request(base + path, null, { Cookie: cookie });
  assert.equal(r.status, 200, 'Dashboard read ' + path);
  return r.json();
}
const detail = id => buckets('/api/bucket/' + encodeURIComponent(id));
const idFromHold = r => {
  const match = extractText(r).match(/(?:新建|合并)→([a-f0-9]{12,64})\b/i);
  assert.ok(match, 'Real hold must return a reliable bucket ID'); return match[1];
};

try {
  const stage = process.argv[2];
  if (stage === 'prepare') {
    const before = await buckets();
    const token = await grant(base, process.env.LAB_OB_PASSWORD, true);
    token.expires_at = 0; // force a real refresh before the first MCP operation
    await writeFile(cfg.ombre.oauthStatePath, JSON.stringify(token), { mode: 0o600 });
    const gateway = await grant(heart, cfg.oauth.approvalToken);
    await writeFile('/app/state/lab-gateway.json', JSON.stringify(gateway), { mode: 0o600 });
    assert.equal((await buckets()).length, before.length);
    check('real_OB_OAuth_DCR_PKCE_and_gateway_OAuth_without_memory_writes');
  } else if (stage === 'verify-readonly') {
    const health = await request(heart + '/health').then(r => r.json());
    assert.equal(health.dryRun, true); assert.equal(health.memoryTarget, 'test'); assert.equal(health.memoryWritesEnabled, false);
    const gateway = JSON.parse(await readFile('/app/state/lab-gateway.json', 'utf8'));
    const headers = { Authorization: 'Bearer ' + gateway.access_token, Accept: 'application/json, text/event-stream' };
    const list = await request(heart + '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers).then(r => r.json());
    assert.ok(list.result.tools.some(t => t.name === 'breath'));
    const recall = await request(heart + '/mcp', { jsonrpc:'2.0', id:4, method:'tools/call', params:{name:cfg.ombre.adapter === 'native' ? 'breath' : 'breath_search',arguments:{query:'雨天的约定'}} }, headers).then(r=>r.json());
    assert.ok(extractText(recall).includes('雨天的约定'));
    for (const name of ['hold','grow','trace','forget','restore','letter_write']) assert.ok(!list.result.tools.some(t => t.name === name));
    const before = (await control()).mcpWrites;
    const denied = await request(heart + '/mcp', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name:'hold', arguments:{content:'must not write'}} }, headers).then(r => r.json());
    assert.ok(denied.result?.isError || denied.error);
    assert.equal((await control()).mcpWrites, before); assert.equal((await buckets()).length, 3);
    check('DRYRUN_test_target_readonly_gateway_blocks_writes_before_real_OB');
  } else if (stage === 'legacy-round') {
    const main = new OmbreClient(cfg.ombre);
    const extra = new OmbreClient({ ...cfg.ombre, url: cfg.ombre.extraUrl }); extra.auth = main.auth;
    const a = (await main.listTools()).map(t => t.name);
    const b = (await extra.listTools()).map(t => t.name);
    assert.ok(a.includes('hold') && a.includes('forget') && a.includes('restore'));
    assert.ok(b.includes('I') && b.includes('pulse') && b.includes('plan'));
    assert.ok(!a.includes('breath_advanced'));
    check('real_OB265_main_extra_and_missing_advanced_search_baseline');
    const text = 'LAB_LEGACY 逐字保留的一段往事。\n原文 [[链接]] 与 Unicode 🫶';
    const id = idFromHold(await main.call('hold', { content: text, tags: 'lab-round-1', auto: false }, 60000));
    assert.equal((await detail(id)).content, text.replaceAll('[[','').replaceAll(']]',''));
    check('real_OB265_Dashboard_renders_wiki_without_brackets');
    const count = (await buckets()).length;
    const auto = extractText(await main.call('hold', { content: 'Docker API 配置部署技术日志', auto: true, source: 'lab-automatic' }, 60000));
    assert.match(auto, /自动.*拒绝|候选暂未/); assert.equal((await buckets()).length, count);
    check('real_OB265_automatic_candidate_gate_does_not_write_first_technical_candidate');
    await extra.call('I', { content: 'LAB_LEGACY_SELF 我愿意耐心倾听', aspect: 'patterns' });
    const selves = (await buckets()).filter(x => x.type === 'i');
    assert.ok(selves.length >= 2);
    check('real_OB265_I_writes_formal_item_directly');
    await main.call('forget', { id, reason: '基线软删演练' });
    assert.equal((await request(base + '/api/bucket/' + id, null, { Cookie: cookie })).status, 404);
    const raw = await fetch('http://provider:8001/lab/bucket/' + id).then(r => r.json());
    assert.equal(raw.content, text);
    await main.call('restore', { id });assert.equal((await detail(id)).content, text.replaceAll('[[','').replaceAll(']]',''));
    const restoredRaw = await fetch('http://provider:8001/lab/bucket/' + id).then(r => r.json());assert.equal(restoredRaw.content, text);
    check('real_OB265_soft_delete_and_restore_baseline');
    const event = await request(heart + '/v1/conversation-event', { event_id: 'legacy-round', interaction_type: 'discovery' }, { Authorization: 'Bearer ' + cfg.serviceToken });
    assert.equal(event.status, 200);
  } else if (stage === 'round') {
    const round = Number(process.argv[3]);
    const client = new Ob32Adapter({ ...cfg.ombre, writeEnabled: true, dreamWriteEnabled: true });
    const names = (await client.listTools()).map(x => x.name);
    for (const tool of ['breath_advanced', 'breath_search', 'feel', 'plan', 'letter_read', 'letter_write', 'letter_lock_update', 'restore']) assert.ok(names.includes(tool), tool);
    check('real_tool_discovery_and_split_letter_session');
    const historical = await detail('010101010101');
    assert.equal(historical.content, '历史核心：雨天的约定。\n原话：我一直记得。\n[[保留链接]]');
    const text = `LAB_ROUND_${round} 这是一段逐字保存的长期记忆。\n第二行含 Unicode 🫶 与 [[链接]]。`;
    const rawSource = '原始谈话第一行\n原始谈话第二行';
    const id = idFromHold(await client.call('hold', { content: text, title: `轮次${round}`, domain: '测试',
      source_content: rawSource, source_ranges: [[1, 2]], quotes: ['我一直记得。'], tags: `lab-round-${round}`, importance: 5 }, 60000));
    const stored = await detail(id);
    assert.equal(stored.content, text); assert.equal(stored.metadata.quotes[0].text, '我一直记得。');
    assert.ok(stored.metadata.source_refs[0].ref.startsWith('src_'));
    check('hold_exact_text_quotes_and_immutable_source_refs');
    assert.match(extractText(await client.call('breath_search', { query: `LAB_ROUND_${round}`, quotes: true }, 60000)), /我一直记得/);
    await client.call('trace', { bucket_id: id, resolved: 1 });
    assert.equal((await detail(id)).content, text);
    await client.call('forget', { id, reason: '本地软删演练' });
    assert.equal((await request(base + '/api/bucket/' + id, null, { Cookie: cookie })).status, 404);
    const deleted = await fetch('http://provider:8001/lab/bucket/' + id).then(r => r.json());
    assert.equal(deleted.content, text); assert.ok(deleted.metadata.deleted_at);
    await client.call('restore', { id });
    assert.equal((await detail(id)).content, text); assert.ok(!(await detail(id)).metadata.deleted_at);
    check('legacy_forget_reason_and_restore_preserve_text');
    const batch = { content: `批次${round}第一条原文\n批次${round}第二条原文`, items: [
      { content: `LAB_BATCH_${round}_A 独立事件甲的最终正文`, domain: ['测试'], source_ranges: [[1,1]], tags: [`batch-${round}`] },
      { content: `LAB_BATCH_${round}_B 独立事件乙的最终正文`, domain: ['测试'], source_ranges: [[2,2]], tags: [`batch-${round}`] }] };
    await client.call('grow', batch, 60000);
    const count = (await buckets()).length;
    await client.call('grow', batch, 60000);
    assert.equal((await buckets()).length, count);
    const batchBuckets = (await buckets()).filter(b => b.tags?.includes(`batch-${round}`));
    assert.equal(batchBuckets.length, 2);
    const batchDetails = await Promise.all(batchBuckets.map(b => detail(b.id)));
    assert.deepEqual(new Set(batchDetails.map(b => b.content)), new Set(batch.items.map(i => i.content)));
    for (const b of batchDetails) assert.ok(b.metadata.source_refs.length > 0);
    check('grow_explicit_items_idempotence_and_shared_sources');
    const duplicate = `LAB_DUPLICATE_${round} 相同正文并发保存不得生成重复桶`;
    const writes = await Promise.all(Array.from({ length: 6 }, () => client.call('hold', { content: duplicate, domain: '测试' }, 60000)));
    assert.equal(new Set(writes.map(idFromHold)).size, 1);
    check('six_concurrent_identical_holds_one_bucket');
    const dreamId = await client.storeDream({ dream: `LAB_DREAM_${round} 虚构梦境`, residue: '虚构余韵', awareness: '不是现实事件' });
    assert.equal((await detail(dreamId)).metadata.dont_surface, true);
    const surfaced = extractText(await client.call('breath_advanced', { max_results: 50, max_tokens: 20000 }, 60000));
    assert.ok(!surfaced.includes('[bucket_id:' + dreamId + ']'));
    const material = await client.digestMaterial(48);
    assert.ok(material.text && material.bucketIds.length, 'Real dream format must parse into source material');
    assert.ok(!material.bucketIds.includes(dreamId));
    check('dream_real_format_refs_and_dont_surface');
    const self = `LAB_SELF_${round} 我觉得自己更愿意耐心倾听`;
    await client.writeSelfAwareness(self, 'patterns');
    const candidate = (await buckets()).find(b => b.tags?.includes('__i_candidate__') && !b.resolved);
    assert.ok(candidate); assert.equal((await detail(candidate.id)).metadata.i_stage, 'candidate');
    assert.match(extractText(await client.call('I', { read: true })), /候选|沉淀/);
    const oldSelf = await detail('020202020202'); assert.equal(oldSelf.metadata.type, 'i');
    check('new_I_candidate_semantics_and_old_I_preserved');
    const letter = `LAB_LOCKED_LETTER_${round} 这封信的锁定正文不能越权泄漏`;
    const letterCount = (await buckets()).length;
    const deniedLetter = extractText(await client.call('letter_write', { author: 'user', content: 'cannot impersonate human', lock_type: 'permanent' }));
    assert.match(deniedLetter, /不能替对方/); assert.equal((await buckets()).length, letterCount);
    await client.call('letter_write', { author: '实验助手', title: `锁信${round}`, content: letter,
      lock_type: 'timed', unlock_date: '2099-01-01' }, 60000);
    const letterRead = extractText(await client.call('letter_read', { limit: 50 }, 60000));
    assert.ok(!letterRead.includes('历史人类锁信，AI不可读取。'));
    assert.ok(letterRead.includes(letter)); // A real AI relation name is required; impersonating a human is refused
    const locked = (await buckets()).filter(b => b.letter_locked).at(-1);
    assert.ok(locked);
    const preview = await client.memoryBucketPreview(locked.id);
    assert.equal(preview.available, false); assert.equal(preview.preview, '');
    const plainPreview = await client.memoryBucketPreview(id);
    assert.equal(plainPreview.available, true);
    check('real_letter_AI_and_human_lock_boundary_and_preview');
    const stateBefore = await control();
    await assert.rejects(client.call('trace', { bucket_id: id, hard_delete: true }), /destructive/);
    await assert.rejects(client.call('trace', { bucket_id: id, content: 'would overwrite' }), /destructive/);
    await assert.rejects(client.call('hold', { content: 'unreviewed automatic text', auto: true, source: 'unknown' }), /candidate gate/);
    assert.equal((await control()).mcpWrites, stateBefore.mcpWrites);
    check('unsafe_delete_replace_and_unknown_auto_block_before_OB');
    const unchanged = (await buckets()).length;
    await client.call('hold', { content: 'invalid quotes must not write', quotes: ['x'.repeat(101)] }, 60000);
    assert.equal((await buckets()).length, unchanged);
    check('invalid_quotes_rejected_without_bucket_creation');
    await control({ fail_model: true });
    const fallbackText = `LAB_PROVIDER_OUTAGE_${round} 元数据服务故障也不得丢失正文`;
    try {
      const fallbackId = idFromHold(await client.call('hold', { content: fallbackText, domain: '测试' }, 120000));
      assert.equal((await detail(fallbackId)).content, fallbackText);
    } finally { await control({ fail_model: false }); }
    check('real_provider_failure_preserves_hold_text');
    const beforeDrop = (await control()).mcpWrites;
    await control({ drop_write_response: true });
    const uncertainText = `LAB_RESPONSE_LOST_${round} 服务已写入但响应丢失`;
    await assert.rejects(client.call('hold', { content: uncertainText, domain: '测试' }, 60000));
    assert.equal((await control()).mcpWrites, beforeDrop + 1);
    const uncertainMatches = [];
    for (const bucket of await buckets()) { const body = await detail(bucket.id); if (body.content === uncertainText) uncertainMatches.push(body); }
    assert.equal(uncertainMatches.length, 1, 'Lost response still persisted exactly one body');
    assert.equal((await detail('010101010101')).content, historical.content);
    check('lost_write_response_not_replayed_and_history_text_intact');
    const gateway = JSON.parse(await readFile('/app/state/lab-gateway.json', 'utf8'));
    const headers = { Authorization: `Bearer ${gateway.access_token}`, Accept: 'application/json, text/event-stream' };
    const init = await request(heart + '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lab', version: '1' } } }, headers);
    headers['Mcp-Session-Id'] = init.headers.get('mcp-session-id');
    const list = await request(heart + '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers).then(r => r.json());
    for (const name of ['hold', 'breath_search', 'restore', 'letter_read']) assert.ok(list.result.tools.some(t => t.name === name));
    const event = await request(heart + '/v1/conversation-event', { event_id: `round-${round}`, interaction_type: 'discovery' }, { Authorization: 'Bearer ' + cfg.serviceToken });
    assert.equal(event.status, 200);
    const map = await client.fetchBucketMapStructured(); assert.ok(map.available && map.total > 4);
    const refreshed = JSON.parse(await readFile(cfg.ombre.oauthStatePath, 'utf8'));
    assert.ok(refreshed.access_token && refreshed.refresh_token);
    check('gateway_real_OB_tools_events_star_map_and_refreshed_credentials');
  } else if (stage === 'online-export') {
    const original = await buckets();
    const r = await request(base + '/api/export', null, { Cookie: cookie });
    assert.equal(r.status, 200);
    const bytes = Buffer.from(await r.arrayBuffer()); assert.ok(bytes.length > 1000);
    await writeFile('/app/state/lab-online-export.zip', bytes, {mode:0o600});
    await writeFile('/app/state/lab-export-count.json', JSON.stringify({buckets:original.length}), {mode:0o600});
    assert.equal((await buckets()).length, original.length);
    check('online_logical_export_while_real_OB_keeps_running_without_memory_writes');
  } else if (stage === 'verify-logical') {
    assert.equal((await detail('010101010101')).content, '历史核心：雨天的约定。\n原话：我一直记得。\n[[保留链接]]');
    const client = new Ob32Adapter(cfg.ombre);
    assert.ok((await client.listTools()).some(t => t.name === 'hold'));
    const all = await buckets(); assert.ok(all.some(b => b.tags?.includes('lab-round-3')));
    const expected = JSON.parse(await readFile('/app/state/lab-export-count.json','utf8'));assert.equal(all.length, expected.buckets);
    assert.equal((await detail('020202020202')).metadata.type, 'i');
    assert.ok((await detail('010101010101')).metadata.source_refs.length);
    check('online_export_raw_restore_boot_with_fresh_config_and_new_OAuth_authorization');
  } else if (stage === 'verify-restored' || stage === 'verify-baseline') {
    const client = new Ob32Adapter(cfg.ombre);
    assert.ok((await client.listTools()).some(t => t.name === 'hold'));
    const expectedCore = '历史核心：雨天的约定。\n原话：我一直记得。\n[[保留链接]]';
    assert.equal((await detail('010101010101')).content, cfg.ombre.adapter === 'native' ? expectedCore.replaceAll('[[','').replaceAll(']]','') : expectedCore);
    const all = await buckets();
    if (stage === 'verify-restored') assert.ok(all.some(b => b.tags?.includes('lab-round-1')));
    else {
      assert.equal(all.length, 3);
      assert.ok(!all.some(b => b.tags?.some(t => t.startsWith('lab-round-'))));
    }
    const state = JSON.parse(await readFile(cfg.statePath, 'utf8'));
    if (stage === 'verify-restored') assert.ok(state.revision > 0);
    const gateway = JSON.parse(await readFile('/app/state/lab-gateway.json', 'utf8'));
    const response = await request(heart + '/mcp', { jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lab-restored', version: '1' } } }, { Authorization: 'Bearer ' + gateway.access_token });
    assert.equal(response.status, 200);
    check(stage === 'verify-restored' ? 'restored_OB_and_heart_boot_with_history_sources_and_both_OAuth_grants'
      : 'baseline_rollback_boot_has_only_original_history_and_matching_OAuth_grants');
  } else throw new Error('Unknown laboratory stage');
  console.log(JSON.stringify({ stage, checks: report }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, checks: report, failed: error.message, stack: error.stack?.split('\n').slice(0, 8) }));
  process.exitCode = 1;
}
