import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createController, applyChildSelection, shouldRouteChild } from '../logic.js';
import { apply, createHostApi, installTeamTargetGuard } from '../index.js';

// Compatibility-boundary regression tests against DeepSeek Harness dsh-v0.2.1-rc.5.
// Every fact in RC5 was extracted from the published @deepseek-ai/*@0.2.1-rc.5
// packages (provenance noted per entry). The tests pin the plugin's outbound
// call shapes and its input tolerance to that exact host contract, so a future
// edit cannot silently drift onto a different DSH surface.
const RC5 = {
  // @deepseek-ai/dsh-settings@0.2.1-rc.5 SettingsForms: describe(options.redactSecrets),
  // mutate(ns, ops, expectedRevision), configure(presentation, owner = ctx.fiber),
  // writable getter; describe rows carry ns/revision/value/base/user/schema/...
  hostSurface: {
    settings: ['writable', 'describe', 'mutate', 'configure'],
    sessionController: ['modelCatalog'], // @deepseek-ai/dsh-api-session-controller@0.2.1-rc.5
    llm: ['listConfigurableProviders', 'resolveCallConfig'], // @deepseek-ai/dsh-llm@0.2.1-rc.5
    credentials: ['describe'], // CredentialProvider.describe(ref): Promise<CredentialInfo>
    tools: ['register', 'guard'], // @deepseek-ai/dsh-tools@0.2.1-rc.5 ToolRuntime
  },
  hostRoots: ['effect', 'on', 'fiber', 'get'], // @deepseek-ai/cordis@~4.0.5
  // @deepseek-ai/dsh-api-remotes@0.2.1-rc.5 endpoint namespaces: settings/describe,
  // settings/mutate, session/modelCatalog, llm/listConfigurableProviders,
  // credentials/describe (batched refs), credentials/set.
  remoteSurface: {
    settings: ['describe', 'mutate'],
    session: ['modelCatalog'],
    llm: ['listConfigurableProviders'],
    credentials: ['describe', 'set'],
  },
  clientInject: ['slots', 'locale', 'remote', 'remote.settings', 'remote.session', 'remote.llm', 'remote.credentials'],
  // package.json dsh.client.inject targets; each package is published at 0.2.1-rc.5.
  clientInjectPackages: [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-plugin-manager',
  ],
  // @deepseek-ai/dsh-agent@0.2.1-rc.5 runtime-types.d.ts SessionStartSource.
  startSources: ['startup', 'resume', 'clear', 'compact'],
  agentCreatedEvent: 'agent/created', // payload: { agent, source, signal? }; signal omitted when absent
  // @deepseek-ai/dsh-api-session-controller@0.2.1-rc.5 SessionEventMap subset.
  sessionEvents: [
    'turn/start', 'turn/end', 'step/start', 'step/end', 'user/message', 'assistant/message',
    'tool/call', 'tool/result', 'request/header', 'request/context', 'session/end-seed',
    'model/selection', 'session/title', 'team/member', 'goal/change',
  ],
};

const catalog = {
  groups: [{ id: 'group-a', name: 'A', models: [{ id: 'model-a', name: 'Model A', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] }],
  routableProviders: ['group-a'], failures: [{ id: 'group-b', name: 'B', message: 'offline' }], default: { provider: 'group-a', model: 'model-a' },
};
const fixed = { mode: 'fixed', provider: 'group-a', model: 'model-a', reasoningEffort: 'high' };
const input = { slug: 'test', type: 'chat', baseURL: 'https://api.example.test/v1', model: 'm', credentialRef: 'TEST_API_KEY', efforts: ['low', 'high'] };

// rc.5-shaped settings rows: the plugin may only rely on ns/revision/value.
function rc5Row(ns, revision, value) {
  return { ns, revision, value, autoGenerate: true, schema: { type: 'object' }, applies: 'live', base: {}, user: {}, secrets: [] };
}

function controllerFixture() {
  const own = rc5Row('dsh-subagent-model', 3, { selection: { mode: 'inherit' } });
  const adapter = rc5Row('llm-pi-ai', 8, { providers: { existing: { preserved: true } } });
  const writes = [];
  const directory = [{ provider: 'openai', displayName: 'OpenAI', settingsNs: adapter.ns, settingsPath: ['providers', 'openai'] }];
  const api = {
    describe: async () => ({ writable: true, namespaces: structuredClone([own, adapter, rc5Row('include:other-plugin', 1, {})]) }),
    catalog: async () => structuredClone(catalog),
    directory: async () => structuredClone(directory),
    describeCredential: async () => ({ configured: true, writable: true }),
    mutate: async (ns, ops, revision) => {
      const target = ns === own.ns ? own : adapter;
      writes.push({ ns, ops, revision });
      if (ns === own.ns) target.value.selection = structuredClone(ops[0].value);
      else target.value.providers[ops[0].path[1]] = structuredClone(ops[0].value);
      target.revision++;
    },
  };
  return { controller: createController(api), own, adapter, writes };
}

test('index.js host calls stay inside the rc.5 service surface', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  const allowed = new Set(Object.entries(RC5.hostSurface).flatMap(([service, members]) => members.map(member => `${service}.${member}`)));
  const pairs = [...source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)].map(match => `${match[1]}.${match[2]}`);
  assert.ok(pairs.length > 0, 'Host code must call rc.5 services');
  for (const pair of new Set(pairs)) assert.ok(allowed.has(pair), `Call ${pair} is outside the dsh-v0.2.1-rc.5 host surface`);
  const roots = new Set([...source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map(match => match[1]));
  for (const root of roots) {
    assert.ok(root in RC5.hostSurface || RC5.hostRoots.includes(root), `ctx.${root} is outside the dsh-v0.2.1-rc.5 host surface`);
  }
});

test('index.js injects every rc.5 host service it touches', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  const declaration = source.match(/export const inject = \[([^\]]+)\]/);
  assert.ok(declaration, 'Host plugin must declare its service dependencies');
  const injected = new Set([...declaration[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]));
  const touched = new Set([...source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)\./g)].map(match => match[1]).filter(name => name in RC5.hostSurface));
  for (const service of touched) assert.ok(injected.has(service), `Missing inject: ${service}`);
  for (const service of injected) assert.ok(service in RC5.hostSurface, `${service} is not a dsh-v0.2.1-rc.5 host service name`);
});

test('createHostApi forwards the exact rc.5 call shapes', async () => {
  const calls = [];
  const ctx = {
    settings: {
      writable: true,
      describe: options => { calls.push(['settings.describe', options]); return [rc5Row('dsh-subagent-model', 1, {})]; },
      mutate: (ns, ops, revision) => { calls.push(['settings.mutate', ns, ops, revision]); },
      configure: () => () => {},
    },
    sessionController: { modelCatalog: () => { calls.push(['sessionController.modelCatalog']); return catalog; } },
    llm: {
      listConfigurableProviders: () => { calls.push(['llm.listConfigurableProviders']); return []; },
      resolveCallConfig: async value => value,
    },
    credentials: { describe: ref => { calls.push(['credentials.describe', ref]); return { configured: true, writable: true }; } },
  };
  const api = createHostApi(ctx);
  const described = await api.describe();
  assert.deepEqual(calls[0], ['settings.describe', { redactSecrets: true }], 'rc.5 redacts only when callers opt in');
  assert.equal(described.writable, true);
  assert.equal(described.namespaces.length, 1);
  const ops = [{ op: 'set', path: ['selection'], value: fixed }];
  await api.mutate('llm-pi-ai', ops, 7);
  assert.deepEqual(calls[1], ['settings.mutate', 'llm-pi-ai', ops, 7], 'rc.5 mutate is (ns, ops, expectedRevision)');
  assert.deepEqual(await api.catalog(), catalog);
  assert.deepEqual(await api.directory(), []);
  assert.deepEqual(await api.describeCredential('TEST_API_KEY'), { configured: true, writable: true });
  assert.deepEqual(calls.slice(2).map(call => call[0]), ['sessionController.modelCatalog', 'llm.listConfigurableProviders', 'credentials.describe']);
});

test('controller reads full rc.5 settings rows without depending on extra fields', async () => {
  const f = controllerFixture();
  const state = await f.controller.read();
  assert.equal(state.own.ns, 'dsh-subagent-model');
  assert.equal(state.own.revision, 3);
  assert.equal(state.adapter.ns, 'llm-pi-ai');
  assert.deepEqual(state.selection, { mode: 'inherit' });
  assert.equal(state.writable, true);
});

test('settings writes use rc.5 set-op grammar over volatile paths', async () => {
  const f = controllerFixture();
  await f.controller.save(fixed, 3);
  await f.controller.addApi(input, 8);
  assert.ok(f.writes.length === 2);
  for (const { ops } of f.writes) {
    for (const op of ops) {
      assert.equal(op.op, 'set', 'rc.5 mutate accepts ordered form edits keyed by op');
      assert.ok(Array.isArray(op.path) && op.path.length > 0 && op.path.every(key => typeof key === 'string'));
      assert.ok('value' in op);
    }
  }
  assert.deepEqual(f.writes[0].ops[0].path, ['selection']);
  assert.deepEqual(f.writes[1].ops[0].path, ['providers', 'dsh-subagent-test']);
  // rc.5 write() rejects paths outside volatile fields; the plugin's own namespace
  // may only persist the volatile selection field.
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  const selectionDecl = source.slice(source.indexOf('selection: Schema.object('), source.indexOf('guardTeamTargets'));
  assert.match(selectionDecl, /\.volatile\(\)/, 'selection must stay volatile for rc.5 settings.mutate');
});

// A real rc.5 Agent carries options/session/inbox/status/ctx and no model
// member; model selection there is owned by the api-session-controller agents.
function rc5Agent(header) {
  return { options: {}, session: { header, append: () => {} }, inbox: {}, status: 'idle', ctx: {} };
}

function rc5SessionController(published) {
  return { agents: { selectForNextRequest(agent, route) { published.push(route); } } };
}

test('child routing consumes the rc.5 agent/created payload shape', async () => {
  const published = [];
  const agent = rc5Agent({ origin: 'subagent', parentSession: 'parent-1' });
  const sessionController = rc5SessionController(published);
  const llm = { resolveCallConfig: async value => value };
  // rc.5 omits the signal key entirely when the factory passed none.
  const payload = { agent, source: 'startup' };
  assert.equal(await applyChildSelection(llm, { mode: 'inherit' }, payload, sessionController), false);
  assert.equal(published.length, 0);
  assert.equal(await applyChildSelection(llm, fixed, payload, sessionController), true);
  assert.equal(published.length, 1);
  for (const source of RC5.startSources) {
    assert.equal(shouldRouteChild(source, agent.session.header), source === 'startup');
  }
  assert.equal(shouldRouteChild('startup', { parentSession: 'parent-1' }), false, 'root agents carry no subagent origin');
});

test('published selection matches rc.5 ModelSelection field for field on both publish faces', async () => {
  const llm = { resolveCallConfig: async value => value };
  // rc.5 ModelSelection = { provider, model, reasoningEffort? } with effort omitted for adapter defaults.
  const expected = [
    { provider: 'group-a', model: 'model-a', reasoningEffort: 'high' },
    { provider: 'group-a', model: 'model-a' },
  ];
  // Face 1: dsh 0.2.2+ AgentModel via agent.model.select.
  const modern = [];
  const modernAgent = {
    session: { header: { origin: 'subagent', parentSession: 'p' } },
    model: { select: route => modern.push(route) },
  };
  await applyChildSelection(llm, fixed, { agent: modernAgent, source: 'startup' });
  await applyChildSelection(llm, { ...fixed, reasoningEffort: '' }, { agent: modernAgent, source: 'startup' });
  assert.deepEqual(modern, expected);
  // Face 2: rc.5 agents bridge via selectForNextRequest.
  const legacy = [];
  const sessionController = rc5SessionController(legacy);
  const child = () => rc5Agent({ origin: 'subagent', parentSession: 'p' });
  await applyChildSelection(llm, fixed, { agent: child(), source: 'startup' }, sessionController);
  await applyChildSelection(llm, { ...fixed, reasoningEffort: '' }, { agent: child(), source: 'startup' }, sessionController);
  assert.deepEqual(legacy, expected);
});

test('child validation uses the rc.5 resolveCallConfig(config, signal) signature', async () => {
  const calls = [];
  const abort = new AbortController();
  const agent = rc5Agent({ origin: 'subagent', parentSession: 'p' });
  const llm = { resolveCallConfig: (config, signal) => { calls.push([config, signal]); return config; } };
  assert.equal(await applyChildSelection(llm, fixed, { agent, source: 'startup', signal: abort.signal }, rc5SessionController([])), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], { provider: 'group-a', model: 'model-a', reasoningEffort: 'high' });
  assert.equal(calls[0][1], abort.signal, 'rc.5 resolves the call config under the creation signal');
});

test('registered tool satisfies the rc.5 ToolDefinition contract', () => {
  let tool;
  const ctx = {
    fiber: {}, effect: fn => fn(), on: () => () => {},
    settings: { writable: true, describe: () => [], mutate: async () => {}, configure: () => () => {} },
    sessionController: { modelCatalog: () => catalog },
    llm: { listConfigurableProviders: () => [], resolveCallConfig: async value => value },
    credentials: { describe: async () => ({ configured: true, writable: true }) },
    tools: { register: definition => { tool = definition; return () => {}; }, guard: () => () => {} },
    get: () => undefined,
  };
  apply(ctx, { selection: { get: () => ({ mode: 'inherit' }) } });
  assert.ok(tool, 'apply must register the shared tool');
  // rc.5 ToolSchema whitelist for the model: name/description/parameters;
  // ToolDefinition additionally mandates output plus execute(args, exec).
  assert.equal(typeof tool.name, 'string');
  assert.equal(typeof tool.description, 'string');
  assert.equal(tool.parameters.type, 'object');
  assert.equal(typeof tool.execute, 'function');
  assert.ok(tool.output && typeof tool.output.render === 'function' && tool.output.schema);
  const blocks = tool.output.render({}, { ok: true });
  for (const block of blocks) {
    // rc.5 TextBlock = { type: 'text', text: string }.
    assert.equal(block.type, 'text');
    assert.equal(typeof block.text, 'string');
  }
  assert.equal(tool.isConcurrencySafe({ action: 'status' }), true);
  assert.equal(tool.isConcurrencySafe({ action: 'select' }), false);
});

test('team target guard satisfies the rc.5 ToolGuard contract', () => {
  const members = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'explorer', role: 'teammate', status: 'inactive' }];
  const guards = [];
  const ctx = {
    tools: { guard: fn => { guards.push(fn); return () => {}; } },
    get: name => (name === 'agentTeams' ? { listMembers: () => members } : undefined),
    effect: fn => fn(),
  };
  installTeamTargetGuard(ctx);
  assert.equal(guards.length, 1);
  // rc.5 ToolGuard = (execution) => string | undefined, executed synchronously
  // after tools/pre-execute; the guard may only deny with a reason string.
  const denied = guards[0]({ callId: 'c1', name: 'send_message', arguments: { target: members[0].id }, agent: { id: 'agent-1' } });
  assert.equal(typeof denied, 'string');
  const allowed = guards[0]({ callId: 'c2', name: 'send_message', arguments: { target: 'explorer' }, agent: { id: 'agent-1' } });
  assert.equal(allowed, undefined);
});

test('client remote calls stay inside rc.5 remote namespaces', async () => {
  for (const filename of ['client.source.js', 'client.js']) {
    const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
    const calls = [...source.matchAll(/\bctx\.remote\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)].map(match => `${match[1]}.${match[2]}`);
    assert.ok(calls.length > 0);
    for (const call of new Set(calls)) {
      const [namespace, method] = call.split('.');
      assert.ok(RC5.remoteSurface[namespace]?.includes(method), `Remote call ${call} is outside the dsh-v0.2.1-rc.5 remote surface`);
    }
    const declaration = source.match(/inject:\s*\[([^\]]+)\]/);
    assert.ok(declaration);
    const injected = new Set([...declaration[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]));
    for (const namespace of new Set(calls.map(call => `remote.${call.split('.')[0]}`))) {
      assert.ok(injected.has(namespace), `Missing inject: ${namespace}`);
    }
    for (const service of injected) assert.ok(RC5.clientInject.includes(service), `${service} is outside the rc.5 client inject surface`);
  }
});

test('client credential calls match the rc.5 batched signature', async () => {
  for (const filename of ['client.source.js', 'client.js']) {
    const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
    // rc.5 credentials/describe takes refs: string[] and answers a record keyed by ref.
    assert.match(source, /credentials\.describe\(\[[^\]]+\]\)/);
    assert.match(source, /credentials\.set\([A-Za-z_$][\w$]*, /);
  }
});

test('package.json client inject targets exist at rc.5', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const target of pkg.dsh.client.inject) {
    assert.ok(RC5.clientInjectPackages.includes(target), `${target} is not published for dsh-v0.2.1-rc.5`);
  }
});

test('verify-session only reads rc.5 session log events', async () => {
  const source = await readFile(new URL('./verify-session.mjs', import.meta.url), 'utf8');
  const events = new Set([
    ...[...source.matchAll(/row\.type === '([^']+)'/g)].map(match => match[1]),
    ...[...source.matchAll(/\/\^\(([^)]+)\)\$\//g)].flatMap(match => match[1].split('|').map(item => item.replace(/\\\//g, '/'))),
  ]);
  assert.ok(events.size >= 3, 'The smoke verifier must name the events it depends on');
  for (const event of events) assert.ok(RC5.sessionEvents.includes(event), `${event} is not in the rc.5 session log`);
});
