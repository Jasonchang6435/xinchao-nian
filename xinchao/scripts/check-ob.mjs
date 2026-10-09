import { loadConfig } from '../src/config.js';
import { OmbreClient } from '../src/ombre-client.js';
import { Ob32Adapter } from '../src/ob32-adapter.js';

// Only initialize + tools/list. Never call hold/grow/trace/breath/dream.
try {
  const { ombre: config } = loadConfig();
  if (!config.url) throw new Error('OMBRE_MCP_URL is missing');
  const client = config.adapter === 'ob32' ? new Ob32Adapter(config) : new OmbreClient(config);
  const tools = await client.listTools();
  const names = tools.map((tool) => tool.name);
  const required = config.adapter === 'ob32' ? ['breath', 'breath_advanced', 'hold', 'grow', 'trace', 'pulse'] : ['breath', 'hold'];
  if (config.extraUrl) required.push('letter_read', 'letter_write', 'letter_lock_update');
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Required OB tools missing: ${missing.join(', ')}`);
  console.log(JSON.stringify({ ok: true, adapter: config.adapter, auth: config.authMode, tools: names,
    dashboardCredentialsConfigured: Boolean(config.dashboardPassword || config.dashboardSession), memoryWritesPerformed: false }, null, 2));
} catch (error) {
  console.error('OB bridge check failed:', error.message);
  process.exitCode = 1;
}
