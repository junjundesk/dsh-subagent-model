import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSelection, selectionRoute, validateCatalogSelection, normalizeBaseURL,
  prepareCustomProvider, shouldRouteChild, applyChildSelection, createController,
  findOwnNamespace, findAdapterNamespace,
} from '../logic.js';
import { apply, Config } from '../index.js';

const catalog = {
  groups: [{ id: 'group-a', name: 'A', models: [{ id: 'model-a', name: 'Model A', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] }],
  routableProviders: ['group-a'], failures: [], default: { provider: 'group-a', model: 'model-a' },
};
const fixed = { mode: 'fixed', provider: 'group-a', model: 'model-a', reasoningEffort: 'high' };
const input = { slug: 'test', type: 'chat', baseURL: 'https://api.example.test/v1', model: 'm', credentialRef: 'TEST_API_KEY', efforts: ['low', 'high'] };
const throwsCode = (fn, code) => assert.throws(fn, error => error.code === code);
const rejectsCode = (fn, code) => assert.rejects(fn, error => error.code === code);

function fixture({ rejectWrite = false, activate = true, configured = true } = {}) {
  const own = { ns: 'dsh-subagent-model', revision: 3, value: { selection: { mode: 'inherit' } } };
  const adapter = { ns: 'llm-pi-ai', revision: 8, value: { providers: { existing: { preserved: true } } } };
  const data = structuredClone(catalog);
  const directory = [{ provider: 'openai', settingsNs: adapter.ns, settingsPath: ['providers', 'openai'] }];
  const writes = [];
  const api = {
    describe: async () => ({ writable: true, namespaces: structuredClone([own, adapter]) }),
    catalog: async () => structuredClone(data), directory: async () => structuredClone(directory),
    describeCredential: async () => ({ configured, writable: true }),
    mutate: async (ns, ops, revision) => {
      if (rejectWrite) throw new Error('write refused');
      const target = ns === own.ns ? own : adapter;
      assert.equal(revision, target.revision);
      writes.push({ ns, ops, revision });
      if (ns === own.ns) target.value.selection = structuredClone(ops[0].value);
      else {
        const id = ops[0].path[1];
        target.value.providers[id] = structuredClone(ops[0].value);
        if (activate) {
          data.groups.push({ id, name: id, models: ops[0].value.models.map(item => ({ id: item.id, name: item.id })) });
          data.routableProviders.push(id);
          directory.push({ provider: id, settingsNs: ns, settingsPath: ['providers', id] });
        }
      }
      target.revision++;
    },
  };
  return { controller: createController(api), api, own, adapter, writes, data, directory };
}

test('inherit strips stale route values', () => assert.deepEqual(normalizeSelection({ ...fixed, mode: 'inherit' }), { mode: 'inherit' }));
test('auto effort never retains a parent effort', () => assert.deepEqual(selectionRoute({ ...fixed, reasoningEffort: '' }), { provider: 'group-a', model: 'model-a' }));
test('fixed selections require a route', () => throwsCode(() => normalizeSelection({ mode: 'fixed' }), 'select_model'));
test('catalog validates exact effort ids', () => throwsCode(() => validateCatalogSelection({ ...fixed, reasoningEffort: 'max' }, catalog), 'effort_unavailable'));
test('catalog rejects unavailable models', () => throwsCode(() => validateCatalogSelection({ ...fixed, model: 'gone' }, catalog), 'model_unavailable'));
test('selection uses advertised exact ids', () => assert.deepEqual(validateCatalogSelection(fixed, catalog), fixed));
test('chat full endpoint becomes base URL', () => assert.equal(normalizeBaseURL('https://example.test/v1/chat/completions/'), 'https://example.test/v1'));
test('responses full endpoint becomes base URL', () => assert.equal(normalizeBaseURL('https://example.test/v1/responses'), 'https://example.test/v1'));
test('claude URL removes SDK v1 endpoint prefix', () => assert.equal(normalizeBaseURL('https://example.test/proxy/v1/messages', 'claude'), 'https://example.test/proxy'));
for (const url of ['file:///x', 'https://user:key@example.test/v1', 'https://example.test?api_key=secret', 'https://example.test/#secret', 'invalid']) {
  test(`reject unsafe URL ${url}`, () => throwsCode(() => normalizeBaseURL(url), 'invalid_url'));
}
for (const [type, api] of Object.entries({ chat: 'openai-completions', responses: 'openai-responses', claude: 'anthropic-messages' })) {
  test(`${type} uses native adapter protocol`, () => assert.equal(prepareCustomProvider({ ...input, type }).profile.api, api));
}
test('custom provider keeps secrets as references only', () => {
  const result = prepareCustomProvider({ ...input, apiKey: 'not-accepted-by-operation' });
  assert.equal(result.provider, 'dsh-subagent-test');
  assert.equal(result.profile.apiKeyEnv, 'TEST_API_KEY');
  assert.ok(!JSON.stringify(result).includes('not-accepted-by-operation'));
});
test('empty reasoning list explicitly disables capabilities', () => assert.equal(prepareCustomProvider({ ...input, efforts: [] }).profile.models[0].reasoningEfforts, false));
test('off is omitted on wire and must accompany supported reasoning', () => {
  assert.deepEqual(prepareCustomProvider({ ...input, efforts: ['off', 'high'] }).profile.models[0].reasoningEfforts, { off: null, high: 'high' });
  throwsCode(() => prepareCustomProvider({ ...input, efforts: ['off'] }), 'invalid_efforts');
});
test('invalid slugs cannot become property paths', () => throwsCode(() => prepareCustomProvider({ ...input, slug: '__proto__' }), 'invalid_slug'));
test('max output cannot exceed context', () => throwsCode(() => prepareCustomProvider({ ...input, maxTokens: 5000, contextWindow: 1000 }), 'invalid_token_limits'));
test('never apply child routing to root, regular fork or resume', () => {
  assert.equal(shouldRouteChild('startup', {}), false);
  assert.equal(shouldRouteChild('startup', { parentSession: 'p' }), false);
  assert.equal(shouldRouteChild('resume', { origin: 'subagent', parentSession: 'p' }), false);
});
test('validate before durable child selection, never materialize unrelated defaults', async () => {
  const calls = [];
  const agent = { session: { header: { origin: 'subagent', parentSession: 'p' } }, model: { select: value => calls.push(['select', value]) } };
  const llm = { resolveCallConfig: async value => { calls.push(['validate', value]); return { ...value, reasoningEffort: 'low' }; } };
  assert.equal(await applyChildSelection(llm, { ...fixed, reasoningEffort: '' }, { agent, source: 'startup' }), true);
  assert.deepEqual(calls.map(item => item[0]), ['validate', 'select']);
  assert.deepEqual(calls[1][1], { provider: 'group-a', model: 'model-a' });
});
test('invalid route fails child creation instead of falling back', async () => {
  let selected = false;
  const agent = { session: { header: { origin: 'subagent', parentSession: 'p' } }, model: { select: () => { selected = true; } } };
  await assert.rejects(() => applyChildSelection({ resolveCallConfig: async () => { throw new Error('unavailable'); } }, fixed, { agent, source: 'startup' }));
  assert.equal(selected, false);
});
test('aborted creation never selects a model', async () => {
  const abort = new AbortController(); abort.abort();
  const agent = { session: { header: { origin: 'subagent', parentSession: 'p' } }, model: { select: () => assert.fail('must not select') } };
  await assert.rejects(() => applyChildSelection({ resolveCallConfig: async value => value }, fixed, { agent, source: 'startup', signal: abort.signal }));
});
test('namespace discovery uses directory authority rather than inspect ids', () => {
  const f = fixture();
  assert.equal(findOwnNamespace([f.own]).ns, 'dsh-subagent-model');
  assert.equal(findAdapterNamespace([f.adapter], f.directory).ns, 'llm-pi-ai');
});
test('save uses revisioned mutation of only owned selection', async () => {
  const f = fixture(); await f.controller.save(fixed, 3);
  assert.deepEqual(f.writes[0], { ns: 'dsh-subagent-model', revision: 3, ops: [{ op: 'set', path: ['selection'], value: fixed }] });
});
test('stale draft cannot overwrite settings', async () => {
  const f = fixture(); await rejectsCode(() => f.controller.save(fixed, 2), 'settings_conflict'); assert.equal(f.writes.length, 0);
});
test('reset keeps native defaults and does not modify adapter settings', async () => {
  const f = fixture(); await f.controller.save({ mode: 'inherit' }, 3); assert.equal(f.adapter.revision, 8);
});
test('new API preserves existing providers and verifies live catalog', async () => {
  const f = fixture(); const result = await f.controller.addApi(input, 8);
  assert.equal(result.added, true); assert.deepEqual(f.adapter.value.providers.existing, { preserved: true });
});
test('save success without live registration is not reported as activation', async () => {
  const f = fixture({ activate: false }); const result = await f.controller.addApi(input, 8);
  assert.equal(result.added, true); assert.equal(result.verified, false);
  assert.equal(result.needsRefresh, true); assert.equal(result.warning, 'provider_activation_failed');
  assert.equal(f.writes.length, 1);
});
test('duplicate routable provider is rejected even without directory metadata', async () => {
  const f = fixture(); f.data.routableProviders.push('dsh-subagent-test');
  await rejectsCode(() => f.controller.addApi(input, 8), 'provider_exists'); assert.equal(f.writes.length, 0);
});
test('API mutation requires a configured credential but never resolves its value', async () => {
  const f = fixture({ configured: false }); await rejectsCode(() => f.controller.addApi(input, 8), 'credential_missing'); assert.equal(f.writes.length, 0);
});
test('failed settings persistence propagates without retry', async () => {
  const f = fixture({ rejectWrite: true }); await assert.rejects(() => f.controller.addApi(input, 8), /write refused/); assert.equal(f.writes.length, 0);
});
test('Host registers a disposable creation hook and shared-operation tool', async () => {
  const f = fixture(); const events = new Map(); let tool;
  const ctx = {
    fiber: {}, effect: fn => fn(), on: (event, handler) => { events.set(event, handler); return () => events.delete(event); },
    settings: { writable: true, describe: () => [f.own, f.adapter], mutate: f.api.mutate, configure: () => () => {} },
    sessionController: { modelCatalog: f.api.catalog }, llm: { listConfigurableProviders: () => f.directory, resolveCallConfig: async route => route },
    credentials: { describe: f.api.describeCredential }, tools: { register: definition => { tool = definition; } },
  };
  apply(ctx, { selection: { get: () => fixed } });
  assert.ok(events.has('agent/created')); assert.equal(tool.name, 'dsh_subagent_model');
  const status = await tool.execute({ action: 'status' }, {}); assert.equal(status.revision, 3);
  await tool.execute({ action: 'select', provider: 'group-a', model: 'model-a', expected_revision: 3 }, { agent: { session: { header: {} } } });
  assert.equal(f.own.value.selection.provider, 'group-a');
  await assert.rejects(() => tool.execute({ action: 'inherit', expected_revision: 4 }, { agent: { session: { header: { origin: 'subagent' } } } }), /Only the main agent/);
  assert.ok(Config);
});
test('post-commit catalog failure returns explicit partial success without retry', async () => {
  const f = fixture(); let reads = 0;
  f.api.catalog = async () => { if (++reads > 1) throw new Error('connection lost'); return structuredClone(f.data); };
  const result = await f.controller.addApi(input, 8);
  assert.equal(result.added, true); assert.equal(result.verified, false);
  assert.equal(result.needsRefresh, true); assert.equal(f.writes.length, 1);
});
test('read-only Host facts prevent writes through shared operations', async () => {
  const f = fixture(); f.api.describe = async () => ({ writable: false, namespaces: [f.own, f.adapter] });
  await rejectsCode(() => f.controller.save(fixed, 3), 'settings_read_only');
  assert.equal(f.writes.length, 0);
});
test('all UI languages have matching keys and metadata', async () => {
  const [zh, en] = await Promise.all(['zh', 'en'].map(async lang => JSON.parse(await readFile(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'))));
  assert.deepEqual(Object.keys(zh.ui).sort(), Object.keys(en.ui).sort()); assert.ok(zh.meta.title && en.meta.description);
});
