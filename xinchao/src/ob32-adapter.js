import { OmbreClient, extractText, parseMemoryMapText, parseMemoryPreviewText } from './ombre-client.js';

const LETTER_TOOLS = new Set(['letter_read', 'letter_write', 'letter_lock_update']);

export function adaptOb32Call(name, input = {}) {
  const args = { ...input };
  if (name === 'forget') return { name: 'trace', args: { bucket_id: args.bucket_id, delete: true } };
  if (name === 'breath_advanced') { delete args.mode; delete args.with_ids; }
  // These fields are emitted by the heart's internal producers, not OB 3.2.
  if (name === 'hold') {
    if (args.source && !args.why_remembered) args.why_remembered = `心潮来源：${args.source}${args.auto ? '（自动产出，非现实事件）' : ''}`;
    delete args.source; delete args.auto;
  }
  if (name === 'grow' && args.source) {
    if (!args.items) args.items = [{ content: args.content, why_remembered: `心潮来源：${args.source}` }];
    delete args.source;
  }
  return { name, args };
}

// Human Dashboard and AI MCP are deliberately separate authorization paths.
export class Ob32Adapter extends OmbreClient {
  constructor(config) {
    super(config);
    this.dashboardCookie = config.dashboardSession || '';
    this.dashboardLogin = null;
    this.loginRetryAfter = 0;
    this.aiMetadata = null;
    this.aiMetadataBuild = null;
    if (config.extraUrl) {
      this.extra = new OmbreClient({ ...config, url: config.extraUrl });
      this.extra.auth = this.auth; // same grant, separate MCP protocol session
    }
  }

  async call(name, args = {}, timeoutMs = 15000) {
    const mapped = adaptOb32Call(name, args);
    const result = LETTER_TOOLS.has(mapped.name) && this.extra
      ? await this.extra.call(mapped.name, mapped.args, timeoutMs)
      : await super.call(mapped.name, mapped.args, timeoutMs);
    if (['breath', 'breath_search', 'breath_advanced'].includes(mapped.name)) {
      return this.enrichRecall(result);
    }
    if (['hold', 'grow', 'trace', 'I', 'feel', 'plan', 'anchor', 'release', 'letter_write', 'letter_lock_update'].includes(mapped.name)) {
      this.aiMetadata = null;
      this._memoryMapCache = null;
    }
    return result;
  }

  async listTools() {
    const tools = await super.listTools();
    if (this.extra) {
      const extras = await this.extra.listTools();
      for (const tool of extras) if (LETTER_TOOLS.has(tool.name) && !tools.some((item) => item.name === tool.name)) tools.push(tool);
    }
    if (tools.some((tool) => tool.name === 'trace') && !tools.some((tool) => tool.name === 'forget')) {
      tools.push({ name: 'forget', description: '软删除记忆，保留原文并移入归档。',
        inputSchema: { type: 'object', properties: { bucket_id: { type: 'string', minLength: 1 } }, required: ['bucket_id'], additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } });
    }
    return tools;
  }

  // OB3.2 grow reports titles for new items, not reliable IDs. Keep is one
  // explicit item, so use hold's unambiguous 新建→ID / 合并→ID response.
  async storeHeldOutput(item) {
    if (!this.config.writeEnabled) throw new Error('ombre_write_disabled');
    const content = String(item?.content ?? '').trim();
    if (!content) throw new Error('box_content_empty');
    const result = await this.call('hold', { content, why_remembered: '心潮匣子：用户明确选择留下的产出' });
    const id = extractText(result).match(/(?:新建|合并)→([a-f0-9]{12,64})\b/i)?.[1];
    if (!id) throw new Error('OB hold completed without a verifiable ID; do not repeat the write blindly');
    return id;
  }

  async loginDashboard() {
    if (!this.config.dashboardPassword) throw new Error('OB Dashboard needs OMBRE_DASHBOARD_PASSWORD or OMBRE_DASHBOARD_SESSION');
    if (Date.now() < this.loginRetryAfter) throw new Error('OB Dashboard login is cooling down');
    if (!this.dashboardLogin) {
      this.dashboardLogin = (async () => {
        const response = await fetch(this.dashboardUrl('/auth/login'), {
          method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: this.config.dashboardPassword }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) { this.loginRetryAfter = Date.now() + 60000; throw new Error(`OB Dashboard login failed: HTTP ${response.status}`); }
        const cookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') || ''];
        const cookie = cookies.map((value) => value.match(/(?:^|;\s*)ombre_session=([^;]+)/)?.[1]).find(Boolean);
        if (!cookie) { this.loginRetryAfter = Date.now() + 60000; throw new Error('OB Dashboard did not issue an ombre_session'); }
        this.dashboardCookie = cookie;
      })().finally(() => { this.dashboardLogin = null; });
    }
    return this.dashboardLogin;
  }

  dashboardUrl(path) { return new URL(path, this.config.dashboardBaseUrl || this.config.url); }

  async dashboardGet(path) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.dashboardCookie) await this.loginDashboard();
      const response = await fetch(this.dashboardUrl(path), {
        headers: { Accept: 'application/json', Cookie: `ombre_session=${this.dashboardCookie}` },
        redirect: 'error', signal: AbortSignal.timeout(30000),
      });
      if ([401, 403].includes(response.status) && !attempt && this.config.dashboardPassword) {
        this.dashboardCookie = ''; continue;
      }
      if (!response.ok) throw new Error(`OB Dashboard read failed: HTTP ${response.status}`);
      return response.json();
    }
  }

  async fetchBucketMapStructured() {
    if (!this.config.dashboardPassword && !this.config.dashboardSession) return null; // pulse fallback needs only MCP
    const buckets = await this.dashboardGet('/api/buckets');
    if (!Array.isArray(buckets)) throw new Error('OB Dashboard returned an invalid bucket list');
    const map = parseMemoryMapText(JSON.stringify({ stars: buckets.map((bucket) => ({
      id: bucket.id, title: bucket.name, type: bucket.type, domains: bucket.domain,
      tags: bucket.tags, valence: bucket.valence, arousal: bucket.arousal,
      importance: bucket.importance, score: bucket.score, pinned: bucket.pinned,
      resolved: bucket.resolved, createdAt: bucket.created, lastActiveAt: bucket.last_active,
      activationCount: bucket.activation_count, historical: true,
    })), stats: { pinned: buckets.filter((bucket) => bucket.pinned).length, dynamic: buckets.filter((bucket) => !bucket.pinned).length } }));
    map.total = buckets.length;
    return map;
  }

  // Called only for the human Dashboard route. Never used as AI source material.
  async memoryBucketPreview(bucketId, maxLines = 7) {
    const id = String(bucketId ?? '').trim();
    const empty = (reason) => ({ schemaVersion: 1, available: false, reason, id, preview: '', lineCount: 0, truncated: false });
    if (!this.config.readEnabled) return empty('not_configured');
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(id)) return empty('invalid_id');
    if (!this.config.dashboardPassword && !this.config.dashboardSession) return empty('dashboard_credentials_missing');
    const bucket = await this.dashboardGet(`/api/bucket/${encodeURIComponent(id)}`);
    if (bucket.id !== id) return empty('id_mismatch');
    if (bucket.letter_locked || bucket.metadata?.locked) return empty('locked');
    const text = String(bucket.display_content ?? bucket.content ?? '');
    const limit = Math.max(1, Math.min(7, Number(maxLines) || 7));
    const preview = text.split(/\r?\n/).slice(0, limit).join('\n').slice(0, 1400);
    return parseMemoryPreviewText(JSON.stringify({ ok: true, id, preview, truncated: preview !== text }), id, limit);
  }

  // Upstream uses this in dreams/thoughts. Keep AI on the original MCP boundary.
  async memoryBucketPreviews() { return []; }

  async enrichRecall(result) {
    const content = result?.result?.content ?? result?.content;
    if (!Array.isArray(content) || !extractText(result).includes('[bucket_id:')) return result;
    try {
      // A large pulse can take tens of seconds. Metadata is optional: retain
      // the recall now and let the shared background request populate cache.
      let timer;
      let metadata;
      try {
        metadata = await Promise.race([this.getAiMetadata(),
          new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1000); })]);
      } finally { clearTimeout(timer); }
      if (!metadata) return result;
      const enriched = content.map((part) => part.type !== 'text' ? part : { ...part, text: part.text.replace(
        /^(.*\[bucket_id:([A-Za-z0-9._-]{1,160})\][^\n]*)$/gm,
        (line, _header, id) => {
          if (line.includes('[domain:')) return line;
          const star = metadata.get(id);
          // Even metadata for AI is fetched with AI MCP, never the human cookie.
          if (!star || star.bucketType === 'letter' || star.tags.includes('__letter__')) return line;
          const domains = star.domains.map((value) => value.replace(/[\[\]\r\n]/g, ''));
          return domains.length ? `${line} [domain:${domains.join(',')}]` : line;
        }) });
      return result?.result ? { ...result, result: { ...result.result, content: enriched } } : { ...result, content: enriched };
    } catch (error) {
      console.warn('[ombre] recall metadata unavailable:', error.message);
      return result; // retain the original recall and IDs; never fabricate metadata
    }
  }

  async getAiMetadata() {
    if (this.aiMetadata && Date.now() - this.aiMetadata.at < 600000) return this.aiMetadata.value;
    if (!this.aiMetadataBuild) this.aiMetadataBuild = (async () => {
      const result = await super.call('pulse', {}, 60000);
      const value = new Map();
      // Parse lines individually so the visual map's 400-node cap cannot drop refs.
      for (const line of extractText(result).split('\n')) {
        for (const star of parseMemoryMapText(line).stars) value.set(star.id, star);
      }
      this.aiMetadata = { at: Date.now(), value };
      return value;
    })().finally(() => { this.aiMetadataBuild = null; });
    return this.aiMetadataBuild;
  }
}
