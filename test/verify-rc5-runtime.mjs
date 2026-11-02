// Optional real rc.5 component probe (not part of `npm test`: the filename does
// not match *.test.mjs and it needs an isolated npm project root).
//
// Usage:
//   node test/verify-rc5-runtime.mjs <absolute path to an isolated npm root>
//
// The isolated root must have installed the real dsh-v0.2.1-rc.5 components
// (see the header of the run output). This script loads exactly those builds
// from the given root, asserts their versions, and drives the plugin's real
// applyChildSelection against a real rc.5 ApiSessionAgentController and a real
// cordis Context with the two waterfalls installModelSelection owns:
//   system-prompt/assemble  (assembly variables)
//   agent/request           (request config)
//
// Scope: component-level only. Only the session and Host surfaces are mocked;
// the rc.5 controller, model-selection coupling, and waterfall dispatch run for
// real. This is NOT a full Agent-loop run and NOT a network/provider E2E. The
// dual-listener ordering risk (entry installModelSelection vs plugin publish)
// is intentionally not probed here and stays documented in docs/.
//
// Reproducible isolation setup (any empty npm project):
//   npm install @deepseek-ai/cordis@4.0.5 @deepseek-ai/dsh-agent@0.2.1-rc.5 \
//     @deepseek-ai/dsh-api-session-controller@0.2.1-rc.5 \
//     @deepseek-ai/dsh-subagent@0.2.1-rc.5
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const EXPECTED_VERSIONS = [
  { specifier: '@deepseek-ai/cordis', name: '@deepseek-ai/cordis', version: '4.0.5' },
  { specifier: '@deepseek-ai/dsh-agent', name: '@deepseek-ai/dsh-agent', version: '0.2.1-rc.5' },
  { specifier: '@deepseek-ai/dsh-api-session-controller', name: '@deepseek-ai/dsh-api-session-controller', version: '0.2.1-rc.5' },
  { specifier: '@deepseek-ai/dsh-subagent', name: '@deepseek-ai/dsh-subagent', version: '0.2.1-rc.5' },
];

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected });
  console.log((pass ? 'PASS ' : 'FAIL ') + name);
  console.log('   actual:   ' + JSON.stringify(actual));
  if (!pass) console.log('   expected: ' + JSON.stringify(expected));
}

function packageRootOf(require, specifier, expectedName) {
  let dir = path.dirname(require.resolve(specifier));
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (manifest.name === expectedName) return { dir, manifest };
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('package root not found for ' + specifier);
    dir = parent;
  }
}

async function main() {
  const rootArg = process.argv[2];
  if (!rootArg) {
    console.error('usage: node test/verify-rc5-runtime.mjs <absolute path to an isolated npm project root>');
    process.exit(2);
  }
  const root = path.resolve(rootArg);
  const rootManifest = path.join(root, 'package.json');
  if (!fs.existsSync(rootManifest)) {
    console.error('not an npm project root: ' + root);
    process.exit(2);
  }
  console.log('isolated root: ' + root);
  console.log('component-level probe: real rc.5 Context/controller/waterfalls; only session and Host surfaces are mocked; not a full Agent-loop or network E2E.');

  // ---- load exactly the rc.5 builds from the given root and pin versions ----
  const require = createRequire(pathToFileURL(rootManifest));
  for (const expected of EXPECTED_VERSIONS) {
    const { manifest } = packageRootOf(require, expected.specifier, expected.name);
    if (manifest.version !== expected.version) {
      throw new Error('version mismatch for ' + expected.name + ': expected ' + expected.version + ', found ' + manifest.version);
    }
  }
  check('rc.5 component versions pinned', EXPECTED_VERSIONS.map(item => item.name + '@' + item.version), [
    '@deepseek-ai/cordis@4.0.5',
    '@deepseek-ai/dsh-agent@0.2.1-rc.5',
    '@deepseek-ai/dsh-api-session-controller@0.2.1-rc.5',
    '@deepseek-ai/dsh-subagent@0.2.1-rc.5',
  ]);
  const load = specifier => import(pathToFileURL(require.resolve(specifier)).href);
  const { Context } = await load('@deepseek-ai/cordis');
  // agent.js is an internal file the package exports do not advertise; load the
  // exact file from the pinned package root instead of a subpath specifier.
  const controllerRoot = packageRootOf(require, '@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-api-session-controller');
  const agentJsPath = path.join(controllerRoot.dir, 'lib', 'types', 'agent.js');
  if (!fs.existsSync(agentJsPath)) throw new Error('agent.js not found at ' + agentJsPath);
  const { ApiSessionAgentController } = await import(pathToFileURL(agentJsPath).href);
  const { resolveChildAgentOptions } = await load('@deepseek-ai/dsh-subagent');
  const logicUrl = pathToFileURL(fileURLToPath(new URL('../logic.js', import.meta.url))).href;
  const { applyChildSelection } = await import(logicUrl);

  // ---- fakes: session and Host surfaces only; no user data, no credentials ----
  function makeSession(header) {
    const events = [];
    let headerState = undefined;
    return {
      header,
      events,
      append(type, data) { events.push({ type, data: structuredClone(data) }); },
      requestHeader() { return headerState; },
      setRequestHeader(next) { headerState = next; },
    };
  }
  function hostCtxFor() {
    return {
      typert: { lookups: { configure() {} }, contexts: { configureHost() {} } },
      sessionProjections: { stateOf() { return { lastUsed: null, pending: null }; } },
      agentDefaultModel: {
        currentSelection() { throw new Error('probe: host default model must not be accessed'); },
        async saveSelection() { throw new Error('probe: host default model must not be accessed'); },
      },
      sessions: new Map(),
    };
  }

  // ---- loop base semantics replicated from dsh-agent-loop/lib/index.js
  //      prepareRequest L1178-1199 + requestProposal L716-722 + L1591-1592 ----
  function requestProposal(header) {
    if (header.adapterDefaults === undefined) return header.config;
    const proposal = { ...header.config };
    if (header.adapterDefaults.reasoningEffort === true) delete proposal.reasoningEffort;
    if (header.adapterDefaults.maxTokens === true) delete proposal.maxTokens;
    return proposal;
  }
  function loopSeedFromOptions(options, session, requestHeaderLogged) {
    const persistedHeader = session.requestHeader();
    const persistedConfig = persistedHeader && persistedHeader.config;
    const route = { provider: options.provider ?? '', model: options.model ?? '' };
    const persistedReasoningEffort =
      persistedConfig && persistedConfig.provider === route.provider && persistedConfig.model === route.model &&
      persistedHeader?.adapterDefaults?.reasoningEffort !== true
        ? persistedConfig.reasoningEffort
        : undefined;
    const reasoningEffort = options.reasoningEffort ?? persistedReasoningEffort;
    const maxTokens = options.maxTokens;
    const base = requestHeaderLogged
      ? requestProposal(persistedHeader)
      : { ...route, ...(reasoningEffort === undefined ? {} : { reasoningEffort }), ...(maxTokens === undefined ? {} : { maxTokens }) };
    return structuredClone(base);
  }
  function loopBaseVariables(options) {
    return { provider: options.provider, model: options.model };
  }
  async function drive(ctx, child, options, requestHeaderLogged) {
    const assembly = { variables: loopBaseVariables(options) };
    const assembled = await ctx.waterfall('system-prompt/assemble', assembly, {}, () => Promise.resolve(assembly));
    const seed = loopSeedFromOptions(options, child.session, requestHeaderLogged);
    const config = await ctx.waterfall('agent/request', { turn: 1, step: 1, signal: AbortSignal.timeout(5000) }, () => Promise.resolve(seed));
    return { assembled, config };
  }
  const routeOf = config => ({ provider: config.provider, model: config.model, reasoningEffort: config.reasoningEffort });

  const llmCalls = [];
  const llmStub = { resolveCallConfig: async value => { llmCalls.push(structuredClone(value)); return value; } };
  const publishViaPlugin = async (selection, payload, controller) => {
    let selectModelCalls = 0;
    const sessionController = {
      agents: controller,
      selectModel() { selectModelCalls++; throw new Error('probe: public selectModel must never be called'); },
    };
    const routed = await applyChildSelection(llmStub, selection, payload, sessionController);
    check('applyChildSelection routed through the rc.5 bridge', routed, true);
    check('public selectModel stayed untouched', selectModelCalls, 0);
  };

  // ================= Scenario A: fixed selection with an explicit effort =================
  // Real spawn/fork route change (resolveChildAgentOptions drops effort when the
  // child route differs from the parent), then the plugin publishes an explicit
  // effort selection through the real controller bridge.
  const parent = {
    options: { provider: 'parent-p', model: 'parent-m', reasoningEffort: 'high', maxTokens: 4096 },
    session: { requestHeader: () => undefined },
  };
  const childOptionsA = resolveChildAgentOptions(parent, { provider: 'spawn-p', model: 'spawn-m' }, 1);
  const ctxA = new Context();
  const sessionA = makeSession({ origin: 'subagent', parentSession: 'parent-1' });
  const childA = { id: 'child-A', ctx: ctxA, session: sessionA, options: childOptionsA };
  const controllerA = new ApiSessionAgentController(hostCtxFor());
  await publishViaPlugin({ mode: 'fixed', provider: 'plug-p', model: 'plug-m', reasoningEffort: 'low' }, { agent: childA, source: 'startup' }, controllerA);
  check('A validation ran on the published route before publication', llmCalls[0], { provider: 'plug-p', model: 'plug-m', reasoningEffort: 'low' });

  const round1 = await drive(ctxA, childA, childOptionsA, false);
  check('A1 round1 assemble.variables (provider/model)', round1.assembled.variables, { provider: 'plug-p', model: 'plug-m' });
  check('A1 round1 request route (provider/model/effort)', routeOf(round1.config), { provider: 'plug-p', model: 'plug-m', reasoningEffort: 'low' });
  check('A1 round1 request config keeps maxTokens from options', round1.config.maxTokens, 4096);

  // The loop logs the resolved header after round 1 and seeds round 2 from it.
  sessionA.setRequestHeader({ config: { provider: 'plug-p', model: 'plug-m', reasoningEffort: 'low', maxTokens: 4096 }, adapterDefaults: {} });
  const round2 = await drive(ctxA, childA, childOptionsA, true);
  check('A2 round2 assemble.variables (provider/model)', round2.assembled.variables, { provider: 'plug-p', model: 'plug-m' });
  check('A2 round2 request route (provider/model/effort)', routeOf(round2.config), { provider: 'plug-p', model: 'plug-m', reasoningEffort: 'low' });
  check('A2 round2 request config keeps maxTokens', round2.config.maxTokens, 4096);
  check('A durable side: exactly one model/selection append', sessionA.events.map(event => event.type), ['model/selection']);
  check('A durable side: model/selection payload', sessionA.events[0].data, { provider: 'plug-p', model: 'plug-m', reasoningEffort: 'low' });

  // ================= Scenario B: effort clearing over a seed that HAS effort =================
  // Same-route delegation keeps the parent effort (real resolveChildAgentOptions),
  // so the seed genuinely carries 'high' before the plugin publishes an effortless
  // selection; the request waterfall must then drop the inherited effort.
  const parentB = {
    options: { provider: 'parent-p', model: 'parent-m', reasoningEffort: 'high', maxTokens: 4096 },
    session: { requestHeader: () => undefined },
  };
  const childOptionsB = resolveChildAgentOptions(parentB, { provider: 'parent-p', model: 'parent-m' }, 1);
  const ctxB = new Context();
  const sessionB = makeSession({ origin: 'subagent', parentSession: 'parent-1' });
  const childB = { id: 'child-B', ctx: ctxB, session: sessionB, options: childOptionsB };
  const controllerB = new ApiSessionAgentController(hostCtxFor());
  const seedB = loopSeedFromOptions(childOptionsB, sessionB, false);
  check('B precondition: the loop seed carries inherited effort high', seedB.reasoningEffort, 'high');
  await publishViaPlugin({ mode: 'fixed', provider: 'plug-p', model: 'plug-m' }, { agent: childB, source: 'startup' }, controllerB);

  const roundB1 = await drive(ctxB, childB, childOptionsB, false);
  check('B1 round1 request route drops the inherited effort', { provider: roundB1.config.provider, model: roundB1.config.model, hasEffort: 'reasoningEffort' in roundB1.config }, { provider: 'plug-p', model: 'plug-m', hasEffort: false });
  check('B1 round1 assemble.variables (provider/model)', roundB1.assembled.variables, { provider: 'plug-p', model: 'plug-m' });
  check('B1 round1 request config keeps maxTokens', roundB1.config.maxTokens, 4096);

  sessionB.setRequestHeader({ config: { provider: 'plug-p', model: 'plug-m', maxTokens: 4096 }, adapterDefaults: {} });
  const roundB2 = await drive(ctxB, childB, childOptionsB, true);
  check('B2 round2 request route keeps no effort', { provider: roundB2.config.provider, model: roundB2.config.model, hasEffort: 'reasoningEffort' in roundB2.config }, { provider: 'plug-p', model: 'plug-m', hasEffort: false });
  check('B2 round2 request config keeps maxTokens', roundB2.config.maxTokens, 4096);
  check('B durable side: exactly one model/selection append without effort', sessionB.events.map(event => event.type), ['model/selection']);
  check('B durable side: model/selection payload has no effort key', sessionB.events[0].data, { provider: 'plug-p', model: 'plug-m' });

  const failed = results.filter(item => !item.pass);
  console.log('\n== SUMMARY == ' + JSON.stringify({ total: results.length, pass: results.length - failed.length, fail: failed.length }));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(error => {
  console.error('PROBE ERROR: ' + (error && error.message ? error.message : String(error)));
  process.exit(1);
});
