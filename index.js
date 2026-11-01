import Schema from '@deepseek-ai/schemastery';
import { PLUGIN_ID, applyChildSelection, createController, EFFORTS } from './logic.js';

export const name = PLUGIN_ID;
export const inject = ['llm', 'settings', 'sessionController', 'tools', 'credentials'];
export const Config = Schema.object({
  selection: Schema.object({
    mode: Schema.union(['inherit', 'fixed']).default('inherit'),
    provider: Schema.string().default(''),
    model: Schema.string().default(''),
    reasoningEffort: Schema.string().default(''),
  }).default({ mode: 'inherit' }).volatile(),
});

export function createHostApi(ctx) {
  return {
    describe: async () => ({ writable: ctx.settings.writable === true, namespaces: ctx.settings.describe({ redactSecrets: true }) }),
    mutate: (ns, ops, revision) => ctx.settings.mutate(ns, ops, revision),
    catalog: () => ctx.sessionController.modelCatalog(),
    directory: async () => ctx.llm.listConfigurableProviders(),
    describeCredential: ref => ctx.credentials.describe(ref),
  };
}

export function apply(ctx, config) {
  const controller = createController(createHostApi(ctx));
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber));
  ctx.on('agent/created', payload => applyChildSelection(ctx.llm, config.selection.get(), payload).then(() => undefined));

  // Both this tool and the UI use createController -> the same native settings operations.
  // Credential entry is deliberately user-only; the tool never accepts or returns a key.
  ctx.tools.register({
    name: 'dsh_subagent_model',
    description: '查看或设置本 profile 新建本地子代理的固定模型，不改变主代理或已运行子代理。status 返回设置及修订号；catalog 查看分组、模型和强度；select/inherit 保存设置；add_api 使用已有凭据引用新增自定义 API 分组。密钥只能在“设置 → 子代理模型”输入。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'catalog', 'select', 'inherit', 'add_api'], description: '默认 status。' },
        expected_revision: { type: 'integer', description: '写操作必填：select/inherit 使用 status.revision，add_api 使用 status.apiRevision。' },
        provider: { type: 'string', description: 'catalog 可按分组过滤；select 必填，使用 catalog 返回的 id。' },
        model: { type: 'string', description: 'select 必填，使用 catalog 返回的模型 id。' },
        reasoning_effort: { type: 'string', description: 'select 可选的模型强度 id；省略使用该模型默认强度。' },
        api: {
          type: 'object',
          description: '仅 add_api。新增分组不会自动改变当前选中模型；成功后可 select。',
          properties: {
            slug: { type: 'string', description: '唯一的小写字母、数字和连字符标识，1–40 字符。' },
            displayName: { type: 'string' },
            type: { type: 'string', enum: ['chat', 'responses', 'claude'] },
            baseURL: { type: 'string', description: 'HTTP(S) API 基础地址，不包含密钥。' },
            model: { type: 'string', description: '服务商要求的精确模型 id。' },
            credentialRef: { type: 'string', description: '已在 DSH 凭据服务保存的环境变量式名称，不是密钥。' },
            contextWindow: { type: 'integer', description: '默认 128000。' },
            maxTokens: { type: 'integer', description: '默认 8192，不超过 contextWindow。' },
            efforts: { type: 'array', items: { type: 'string', enum: [...EFFORTS] }, description: '仅声明 API 实际支持的强度；省略表示不发送强度。' },
          },
          required: ['slug', 'type', 'baseURL', 'model', 'credentialRef'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, result) => [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    },
    isConcurrencySafe: args => !args?.action || ['status', 'catalog'].includes(args.action),
    async execute(args, exec) {
      const action = args.action || 'status';
      if (['select', 'inherit', 'add_api'].includes(action)) {
        // A child must not alter profile-wide routing for its siblings or parent.
        if (exec.agent?.session.header.origin === 'subagent') throw new Error('Only the main agent may change profile-wide subagent settings.');
        if (action === 'add_api') return controller.addApi(args.api || {}, args.expected_revision);
        return controller.save(action === 'inherit' ? { mode: 'inherit' } : {
          mode: 'fixed', provider: args.provider, model: args.model, reasoningEffort: args.reasoning_effort,
        }, args.expected_revision);
      }
      const state = await controller.read();
      if (action === 'status') return {
        selection: state.selection,
        writable: state.writable,
        revision: state.own.revision,
        apiRevision: state.adapter?.revision ?? null,
        scope: 'New in-process subagents only; existing children and main agent are unchanged.',
        groups: state.catalog.groups.map(group => ({ id: group.id, name: group.name, modelCount: group.models.length })),
        failures: state.catalog.failures,
      };
      if (action === 'catalog') return {
        groups: state.catalog.groups.filter(group => !args.provider || group.id === args.provider),
        failures: state.catalog.failures,
      };
      throw new Error('Unknown action');
    },
  });
}
