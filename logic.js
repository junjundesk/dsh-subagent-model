/** Pure operations shared by the installed Host tool and browser UI. No secrets are returned. */
export const PLUGIN_ID = 'dsh-subagent-model';
export const API_TYPES = Object.freeze({
  chat: 'openai-completions',
  responses: 'openai-responses',
  claude: 'anthropic-messages',
});
export const EFFORTS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

export function fail(code, details = '') {
  const error = new Error(details ? `${code}: ${details}` : code);
  error.code = code;
  throw error;
}

export function normalizeSelection(value) {
  if (!value || value.mode === 'inherit') return { mode: 'inherit' };
  if (value.mode !== 'fixed') fail('invalid_mode');
  const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
  const model = typeof value.model === 'string' ? value.model.trim() : '';
  if (!provider || !model) fail('select_model');
  const reasoningEffort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : '';
  return { mode: 'fixed', provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

export function selectionRoute(selection) {
  const { mode, ...route } = normalizeSelection(selection);
  return mode === 'fixed' ? route : undefined;
}

export function validateCatalogSelection(value, catalog) {
  const selected = normalizeSelection(value);
  if (selected.mode === 'inherit') return selected;
  const group = catalog.groups.find(item => item.id === selected.provider);
  const model = group?.models.find(item => item.id === selected.model);
  if (!model) fail('model_unavailable', `${selected.provider}/${selected.model}`);
  if (selected.reasoningEffort && !model.reasoning?.efforts.some(item => item.id === selected.reasoningEffort)) {
    fail('effort_unavailable', selected.reasoningEffort);
  }
  return selected;
}

export function shouldRouteChild(source, header) {
  return source === 'startup' && header?.origin === 'subagent' && typeof header.parentSession === 'string';
}

export async function applyChildSelection(llm, selection, { agent, source, signal }, sessionController) {
  if (!shouldRouteChild(source, agent.session.header)) return false;
  const route = selectionRoute(selection);
  if (!route) return false;
  // Validate before publication; never silently fall back to an unintended model.
  await llm.resolveCallConfig(route, signal);
  signal?.throwIfAborted();
  if (typeof agent.model?.select === 'function') {
    // DSH 0.2.2+: public, durable per-Agent model selection.
    await agent.model.select(route);
  } else {
    // DSH 0.2.1-rc.5 has no Agent.model. Its internal Web controller writes the
    // same model/selection event and installs the Agent-local request selection.
    // Capability-check this private bridge; never call public selectModel(),
    // which rejects child sessions and also changes the deployment default.
    const agents = sessionController?.agents;
    if (typeof agents?.selectForNextRequest !== 'function') {
      fail('model_selection_unavailable', 'Host exposes neither agent.model.select nor the rc.5 session selection bridge. Update DSH or switch subagent settings to inherit.');
    }
    await agents.selectForNextRequest(agent, route);
  }
  // Publication errors propagate: do not retry another API or silently run a
  // child on an unintended provider after a possibly committed selection.
  return true;
}

export function normalizeBaseURL(value, type) {
  let url;
  try { url = new URL(String(value).trim()); } catch { fail('invalid_url'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('invalid_url');
  // SDKs append the endpoint. Accept pasted full endpoint URLs without duplicating it.
  url.pathname = url.pathname.replace(/\/(chat\/completions|responses|messages)\/?$/, '').replace(/\/+$/, '');
  if (type === 'claude') url.pathname = url.pathname.replace(/\/v1$/, '');
  return url.toString().replace(/\/+$/, '');
}

export function prepareCustomProvider(input) {
  const slug = String(input.slug || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) fail('invalid_slug');
  const provider = `dsh-subagent-${slug}`;
  const api = API_TYPES[input.type];
  if (!api) fail('invalid_api_type');
  const modelId = String(input.model || '').trim();
  if (!modelId || modelId.length > 200) fail('select_model');
  const credentialRef = String(input.credentialRef || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(credentialRef)) fail('invalid_credential_ref');
  const contextWindow = Number(input.contextWindow ?? 128000);
  const maxTokens = Number(input.maxTokens ?? 8192);
  if (!Number.isSafeInteger(contextWindow) || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || contextWindow < maxTokens) fail('invalid_token_limits');
  const efforts = input.efforts ?? [];
  if (!Array.isArray(efforts) || efforts.some(item => !EFFORTS.includes(item)) || new Set(efforts).size !== efforts.length) fail('invalid_efforts');
  if (efforts.length && !efforts.some(effort => effort !== 'off')) fail('invalid_efforts');
  // No invented capabilities: empty means explicitly no reasoning control.
  const reasoningEfforts = efforts.length ? Object.fromEntries(efforts.map(effort => [effort, effort === 'off' ? null : effort])) : false;
  const model = { id: modelId, name: modelId, contextWindow, maxTokens, input: ['text'], reasoningEfforts };
  return {
    provider,
    model: modelId,
    profile: {
      displayName: String(input.displayName || slug).trim() || slug,
      api,
      baseURL: normalizeBaseURL(input.baseURL, input.type),
      apiKeyEnv: credentialRef,
      models: [model],
    },
  };
}

export function findOwnNamespace(namespaces) {
  const candidates = namespaces.filter(item => item.ns.split(':').at(-1) === PLUGIN_ID);
  if (candidates.length !== 1) fail('plugin_settings_unavailable');
  return candidates[0];
}

export function findAdapterNamespace(namespaces, directory) {
  // Directory owns actual namespace ids; never invent include: prefixes.
  const ids = new Set(directory.filter(item => item.settingsPath?.[0] === 'providers').map(item => item.settingsNs));
  const candidates = namespaces.filter(item => ids.has(item.ns) && item.ns.split(':').at(-1) === 'llm-pi-ai');
  if (candidates.length !== 1) fail('api_adapter_unavailable');
  return candidates[0];
}

/** Tools whose `target` is a durable teammate name, never a session/subagent id. */
export const TEAM_TARGET_TOOLS = Object.freeze(['send_message', 'interrupt_agent']);

/** Model-facing guidance registered while Agent Teams is mounted. */
export const TEAM_TARGET_GUIDANCE = 'Agent Teams messaging: send_message and interrupt_agent take a teammate name from list_agents (for example "lead"), never a subagent or session id. Call list_agents and pass its target when unsure.';

/** Recognize a session/subagent UUID even though it also matches the teammate-name grammar. */
export function isAgentIdLike(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

/**
* Explain why one Team messaging call cannot be addressed, using the live roster.
* DSH forbids plugins from rewriting tool arguments, so this drives a corrective
* denial instead of letting the built-in roster lookup throw an opaque stack.
* @param tool - tool name as dispatched.
* @param args - parsed call arguments.
* @param members - live TeamMemberView rows for the caller.
* @returns a corrective message, or undefined when the call is addressable.
*/
export function teamTargetIssue(tool, args, members) {
  if (!TEAM_TARGET_TOOLS.includes(tool)) return undefined;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const raw = args.target;
  if (typeof raw !== 'string') return undefined; // Unknown signature (for example the subagent agent_id tool) or schema failure.
  const target = raw.trim();
  if (!target || target === 'lead') return undefined;
  const roster = Array.isArray(members) ? members.filter(member => member && typeof member.name === 'string') : [];
  const byName = roster.find(member => member.name === target);
  if (byName) {
    if (byName.status === 'failed') return `Teammate "${target}" failed to start. Call list_agents for its diagnostics and create a replacement if needed.`;
    if (byName.status === 'provisioning') return `Teammate "${target}" is still provisioning. Wait via list_agents/wait_agent, then retry with target "${target}".`;
    return undefined;
  }
  const byId = roster.find(member => member.id === target);
  if (byId) return `"${target}" is the session id of teammate "${byId.name}", not a message target. Pass target: "${byId.name}".`;
  const names = roster.map(member => member.name).slice(0, 12);
  const valid = names.length > 0 ? `Valid targets: ${names.join(', ')}.` : 'No teammates exist yet; create one with spawn_teammate.';
  if (isAgentIdLike(target)) return `"${target}" looks like a subagent or session id, not a teammate name. ${valid}`;
  return `Unknown teammate target "${target}". ${valid}`;
}


export function createController(api) {
  return {
    async read() {
      const [settings, catalog, directory] = await Promise.all([api.describe(), api.catalog(), api.directory()]);
      const own = findOwnNamespace(settings.namespaces);
      let adapter;
      try { adapter = findAdapterNamespace(settings.namespaces, directory); } catch { /* Existing-model selection still works. */ }
      return { writable: settings.writable, own, adapter, catalog, selection: normalizeSelection(own.value?.selection) };
    },
    async save(selection, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision)) fail('revision_required');
      const settings = await api.describe();
      const own = findOwnNamespace(settings.namespaces);
      if (!settings.writable) fail('settings_read_only');
      if (own.revision !== expectedRevision) fail('settings_conflict');
      const selected = validateCatalogSelection(selection, await api.catalog());
      await api.mutate(own.ns, [{ op: 'set', path: ['selection'], value: selected }], expectedRevision);
      return { saved: true, selection: selected, appliesTo: 'new-local-subagents' };
    },
    async addApi(input, expectedRevision) {
      const result = prepareCustomProvider(input);
      if (!Number.isSafeInteger(expectedRevision)) fail('revision_required');
      const [settings, directory, beforeCatalog] = await Promise.all([api.describe(), api.directory(), api.catalog()]);
      const adapter = findAdapterNamespace(settings.namespaces, directory);
      if (!settings.writable) fail('settings_read_only');
      if (adapter.revision !== expectedRevision) fail('settings_conflict');
      if (Object.hasOwn(adapter.value?.providers || {}, result.provider) || directory.some(item => item.provider === result.provider) || beforeCatalog.routableProviders.includes(result.provider)) fail('provider_exists', result.provider);
      const info = await api.describeCredential(result.profile.apiKeyEnv);
      if (!info.configured) fail('credential_missing', result.profile.apiKeyEnv);
      await api.mutate(adapter.ns, [{ op: 'set', path: ['providers', result.provider], value: result.profile }], expectedRevision);
      // A post-commit read is not a failed write: return explicit partial success so
      // neither caller retries a provider creation or credential write blindly.
      const committed = { added: true, provider: result.provider, model: result.model, credentialRef: result.profile.apiKeyEnv };
      try {
        const [catalog, updatedDirectory] = await Promise.all([api.catalog(), api.directory()]);
        const registered = updatedDirectory.find(item => item.provider === result.provider);
        const advertised = catalog.groups.find(item => item.id === result.provider)?.models.some(item => item.id === result.model);
        if (!advertised || registered?.error || registered?.settingsNs !== adapter.ns || registered?.settingsPath?.[0] !== 'providers' || registered?.settingsPath?.[1] !== result.provider) fail('provider_activation_failed', result.provider);
        return { ...committed, verified: true };
      } catch (error) {
        return { ...committed, verified: false, needsRefresh: true, warning: String(error?.code || 'provider_verification_failed') };
      }
    },
  };
}
