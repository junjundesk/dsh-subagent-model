import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChildSelection, shouldRouteChild } from '../logic.js';
import { apply } from '../index.js';

// Model-selection publishing regression tests for the dual host surfaces:
//   applyChildSelection(llm, selection, payload, sessionController?) must
//   1) prefer 'await agent.model.select(route)' when that capability is a
//      function (dsh 0.2.2-alpha.2 AgentModel), keeping this === agent.model;
//   2) otherwise capability-detect selectForNextRequest on
//      sessionController.agents (dsh-v0.2.1-rc.5 api-session-controller) and
//      call legacy.selectForNextRequest(agent, route) with this === agents;
//   3) otherwise fail('model_selection_unavailable') with a diagnosable detail.
// Every failure is fail-closed: no silent default-model fallback, no retry, no
// path switching after a publish error, and the public session selectModel
// command is never called.

const fixed = { mode: 'fixed', provider: 'group-a', model: 'model-a', reasoningEffort: 'high' };
const header = { origin: 'subagent', parentSession: 'parent-1' };
const llm = { resolveCallConfig: async value => value };

// A real rc.5 Agent carries options/session/inbox/status/ctx and never a
// model member; model selection is owned by the api-session-controller agents.
function rc5Agent() {
  return {
    options: { provider: 'default-p', model: 'default-m' },
    session: { header, append: () => {} },
    inbox: {}, status: 'idle', ctx: {},
  };
}

function modernAgent(log, behavior = () => Promise.resolve()) {
  return {
    session: { header },
    model: {
      select(route) {
        log.push({ path: 'agent.model.select', self: this, agent: undefined, route });
        return behavior(route);
      },
    },
  };
}

function legacyRig(log) {
  const agents = {
    selectForNextRequest(agent, route) {
      log.push({ path: 'selectForNextRequest', self: this, agent, route });
      return Promise.resolve();
    },
  };
  const sessionController = {
    agents,
    // The public command must never serve as a fallback path.
    selectModel(...args) { log.push({ path: 'sessionController.selectModel', self: this, route: args[0] }); },
  };
  return { agents, sessionController };
}

test('rc.5 path: a model-less agent publishes through agents.selectForNextRequest', async () => {
  const log = [];
  const { agents, sessionController } = legacyRig(log);
  const agent = rc5Agent();
  assert.equal(await applyChildSelection(llm, fixed, { agent, source: 'startup' }, sessionController), true);
  assert.equal(log.length, 1);
  assert.equal(log[0].path, 'selectForNextRequest');
  assert.equal(log[0].self, agents, 'the legacy method keeps its this binding');
  assert.equal(log[0].agent, agent, 'the legacy signature is (agent, route)');
  assert.deepEqual(log[0].route, { provider: 'group-a', model: 'model-a', reasoningEffort: 'high' });
});

test('agent.model.select wins whenever both capabilities exist', async () => {
  const log = [];
  const { agents, sessionController } = legacyRig(log);
  const agent = modernAgent(log);
  assert.equal(await applyChildSelection(llm, fixed, { agent, source: 'startup' }, sessionController), true);
  assert.deepEqual(log.map(item => item.path), ['agent.model.select'], 'the rc.5 legacy path must not run');
  assert.equal(log[0].self, agent.model, 'the modern method keeps its this binding');
});

test('a non-function model.select falls through to the legacy path', async () => {
  for (const model of [undefined, null, {}, { select: 42 }]) {
    const log = [];
    const { sessionController } = legacyRig(log);
    const agent = { ...rc5Agent(), model };
    assert.equal(await applyChildSelection(llm, fixed, { agent, source: 'startup' }, sessionController), true);
    assert.deepEqual(log.map(item => item.path), ['selectForNextRequest']);
  }
});

test('both publish paths await their asynchronous publication', async () => {
  const delay = () => new Promise(resolve => setTimeout(resolve, 10));
  {
    let settled = false;
    const agent = { session: { header }, model: { async select() { await delay(); settled = true; } } };
    assert.equal(await applyChildSelection(llm, fixed, { agent, source: 'startup' }, legacyRig([]).sessionController), true);
    assert.equal(settled, true, 'applyChildSelection must await agent.model.select');
  }
  {
    let settled = false;
    const { agents, sessionController } = legacyRig([]);
    agents.selectForNextRequest = async () => { await delay(); settled = true; };
    assert.equal(await applyChildSelection(llm, fixed, { agent: rc5Agent(), source: 'startup' }, sessionController), true);
    assert.equal(settled, true, 'applyChildSelection must await selectForNextRequest');
  }
});

test('missing publish capability fails with model_selection_unavailable and a detail', async () => {
  for (const [label, sessionController] of [
    ['no fourth argument', undefined],
    ['controller without agents', {}],
    ['agents without selectForNextRequest', { agents: {} }],
    ['selectForNextRequest is not a function', { agents: { selectForNextRequest: 42 } }],
  ]) {
    const error = await applyChildSelection(llm, fixed, { agent: rc5Agent(), source: 'startup' }, sessionController).then(() => null, reason => reason);
    assert.equal(error?.code, 'model_selection_unavailable', label);
    assert.notEqual(error.message, 'model_selection_unavailable', label + ' must carry a diagnosable detail');
  }
});

test('validation failure publishes nothing and never retries', async () => {
  const log = [];
  let validations = 0;
  const { sessionController } = legacyRig(log);
  const failing = { resolveCallConfig: async () => { validations++; throw new Error('unavailable'); } };
  await assert.rejects(() => applyChildSelection(failing, fixed, { agent: rc5Agent(), source: 'startup' }, sessionController), /unavailable/);
  assert.equal(validations, 1, 'no retry after a failed validation');
  assert.equal(log.length, 0, 'nothing may be published after a failed validation');
});

test('an aborted creation publishes nothing on either path', async () => {
  const abort = new AbortController();
  abort.abort();
  const log = [];
  const { sessionController } = legacyRig(log);
  await assert.rejects(() => applyChildSelection(llm, fixed, { agent: modernAgent(log), source: 'startup', signal: abort.signal }, sessionController));
  await assert.rejects(() => applyChildSelection(llm, fixed, { agent: rc5Agent(), source: 'startup', signal: abort.signal }, sessionController));
  assert.equal(log.length, 0, 'a cancelled creation must not publish');
});

test('a modern publish error is fail-closed: no path switch, no retry', async () => {
  const log = [];
  const { sessionController } = legacyRig(log);
  const agent = modernAgent(log, () => { throw new Error('publish refused'); });
  await assert.rejects(() => applyChildSelection(llm, fixed, { agent, source: 'startup' }, sessionController), /publish refused/);
  assert.deepEqual(log.map(item => item.path), ['agent.model.select'], 'must not fall through to the legacy path or retry');
});

test('a rejected modern promise and a legacy publish error are both fail-closed', async () => {
  {
    const log = [];
    const { sessionController } = legacyRig(log);
    const agent = modernAgent(log, () => Promise.reject(new Error('async publish refused')));
    await assert.rejects(() => applyChildSelection(llm, fixed, { agent, source: 'startup' }, sessionController), /async publish refused/);
    assert.deepEqual(log.map(item => item.path), ['agent.model.select']);
  }
  {
    const log = [];
    const { agents, sessionController } = legacyRig(log);
    agents.selectForNextRequest = function (agent, route) {
      log.push({ path: 'selectForNextRequest', self: this, agent, route });
      return Promise.reject(new Error('legacy publish refused'));
    };
    await assert.rejects(() => applyChildSelection(llm, fixed, { agent: rc5Agent(), source: 'startup' }, sessionController), /legacy publish refused/);
    assert.deepEqual(log.map(item => item.path), ['selectForNextRequest'], 'must not retry or switch paths');
  }
  // No failure anywhere above may reach the public selectModel command.
});

test('main agent, resume and other sources never publish or validate', async () => {
  const log = [];
  let validations = 0;
  const validating = { resolveCallConfig: async value => { validations++; return value; } };
  const { sessionController } = legacyRig(log);
  const main = { session: { header: {} }, model: { select: route => log.push({ path: 'agent.model.select', route }) } };
  assert.equal(await applyChildSelection(validating, fixed, { agent: main, source: 'startup' }, sessionController), false);
  for (const source of ['resume', 'clear', 'compact']) {
    assert.equal(await applyChildSelection(validating, fixed, { agent: rc5Agent(), source }, sessionController), false, source);
  }
  assert.equal(log.length, 0, 'main and resumed agents keep their model untouched');
  assert.equal(validations, 0, 'unrouted creation is untouched');
});

test('an inherit selection never reaches any publish path', async () => {
  const log = [];
  const { sessionController } = legacyRig(log);
  assert.equal(await applyChildSelection(llm, { mode: 'inherit' }, { agent: modernAgent(log), source: 'startup' }, sessionController), false);
  assert.equal(await applyChildSelection(llm, { mode: 'inherit' }, { agent: rc5Agent(), source: 'startup' }, sessionController), false);
  assert.equal(log.length, 0);
});

test('an absent effort clears the inherited effort on both publish paths', async () => {
  const log = [];
  const { sessionController } = legacyRig(log);
  const agent = modernAgent(log);
  await applyChildSelection(llm, { ...fixed, reasoningEffort: '' }, { agent, source: 'startup' }, sessionController);
  await applyChildSelection(llm, { ...fixed, reasoningEffort: '' }, { agent: rc5Agent(), source: 'startup' }, sessionController);
  // rc.5 ModelSelection omits reasoningEffort to clear any inherited effort.
  assert.deepEqual(log.map(item => item.route), [
    { provider: 'group-a', model: 'model-a' },
    { provider: 'group-a', model: 'model-a' },
  ]);
});

function hostFixture(log, { withAgents = true } = {}) {
  const events = new Map();
  const agents = {
    selectForNextRequest(agent, route) { log.push({ path: 'selectForNextRequest', self: this, agent, route }); },
  };
  const sessionController = {
    ...(withAgents ? { agents } : {}),
    modelCatalog: () => ({ groups: [], routableProviders: [], failures: [], default: { provider: 'p', model: 'm' } }),
    selectModel(...args) { log.push({ path: 'sessionController.selectModel', route: args[0] }); },
  };
  const ctx = {
    fiber: {},
    effect: fn => fn(),
    on: (event, handler) => { events.set(event, handler); return () => events.delete(event); },
    settings: { writable: true, describe: () => [], mutate: async () => {}, configure: () => () => {} },
    sessionController,
    llm: { listConfigurableProviders: () => [], resolveCallConfig: async value => value },
    credentials: { describe: async () => ({ configured: true }) },
    tools: { register: () => () => {} },
  };
  apply(ctx, { selection: { get: () => fixed } });
  return { events, sessionController };
}

test('agent/created forwards ctx.sessionController to the rc.5 publish path', async () => {
  const log = [];
  const { events, sessionController } = hostFixture(log);
  const agent = rc5Agent();
  await events.get('agent/created')({ agent, source: 'startup' });
  assert.deepEqual(log.map(item => item.path), ['selectForNextRequest'], 'the listener must pass ctx.sessionController as the fourth argument');
  assert.equal(log[0].self, sessionController.agents);
  assert.equal(log[0].agent, agent);
});

test('agent/created keeps the modern publish path when the agent owns one', async () => {
  const log = [];
  const { events } = hostFixture(log);
  await events.get('agent/created')({ agent: modernAgent(log), source: 'startup' });
  assert.deepEqual(log.map(item => item.path), ['agent.model.select']);
});

test('agent/created fails creation instead of falling back without any capability', async () => {
  const log = [];
  const { events } = hostFixture(log, { withAgents: false });
  await assert.rejects(() => events.get('agent/created')({ agent: rc5Agent(), source: 'startup' }), /model_selection_unavailable/);
  assert.deepEqual(log.map(item => item.path), [], 'no fallback publication may rescue a failed creation');
});

test('shouldRouteChild matches the rc.5 start-source contract', () => {
  assert.equal(shouldRouteChild('startup', header), true);
  for (const source of ['resume', 'clear', 'compact']) assert.equal(shouldRouteChild(source, header), false, source);
});
