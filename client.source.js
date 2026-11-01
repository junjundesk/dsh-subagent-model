/* Source template. build.mjs embeds shared operations, translations and CSS inside the lazy factory. */
window.__ModuleLoader__.load({
  id: 'dsh-subagent-model',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    // @SHARED_LOGIC@
    const dictionaries = /* @DICTIONARIES@ */ {};
    const css = /* @CSS@ */ '';

    async function unwrap(promise) {
      const result = await promise;
      if (!result?.ok) {
        const error = new Error(result?.error?.message || 'DSH request failed');
        error.code = result?.error?.code;
        throw error;
      }
      return result.value;
    }

    return {
      name: `${PLUGIN_ID}@1.0.1`,
      // Remote namespaces are separate Cordis services; the root alone does not grant access.
      inject: ['slots', 'locale', 'remote', 'remote.settings', 'remote.session', 'remote.llm', 'remote.credentials'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(PLUGIN_ID, 'zh', dictionaries.zh));
        ctx.effect(() => ctx.locale.register(PLUGIN_ID, 'en', dictionaries.en));
        const t = ctx.locale.bind(PLUGIN_ID);
        const controller = createController({
          describe: () => unwrap(ctx.remote.settings.describe()),
          mutate: (ns, ops, revision) => unwrap(ctx.remote.settings.mutate(ns, ops, revision)),
          catalog: () => unwrap(ctx.remote.session.modelCatalog()),
          directory: () => unwrap(ctx.remote.llm.listConfigurableProviders()),
          describeCredential: async ref => (await unwrap(ctx.remote.credentials.describe([ref])))[ref],
        });

        function errorText(error, secret = '') {
          const code = String(error?.code || error?.message?.split(':')[0] || '');
          const key = `error.${code.replace('settings/', 'settings_')}`;
          let message = dictionaries.en[key] ? t(key) : String(error?.message || error);
          if (secret) message = message.split(secret).join('••••••');
          return message;
        }

        function Page() {
          React.useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot());
          const uid = React.useId();
          const [state, setState] = React.useState(null);
          const [draft, setDraft] = React.useState({ mode: 'inherit' });
          const [busy, setBusy] = React.useState(false);
          const [error, setError] = React.useState('');
          const [notice, setNotice] = React.useState('');
          const [custom, setCustom] = React.useState({ slug: '', displayName: '', type: 'chat', baseURL: '', model: '', contextWindow: 128000, maxTokens: 8192, efforts: [] });
          const [apiKey, setApiKey] = React.useState('');
          const [savedRef, setSavedRef] = React.useState('');
          const alive = React.useRef(false);
          const operation = React.useRef(0);
          const inFlight = React.useRef(false);

          const load = React.useCallback(async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            const serial = ++operation.current;
            setBusy(true); setError(''); setNotice('');
            try {
              const next = await controller.read();
              if (alive.current && serial === operation.current) { setState(next); setDraft(next.selection); }
            } catch (error) { if (alive.current && serial === operation.current) setError(errorText(error)); }
            finally { inFlight.current = false; if (alive.current && serial === operation.current) setBusy(false); }
          }, []);

          React.useEffect(() => {
            alive.current = true;
            void load();
            return () => { alive.current = false; };
          }, [load]);

          const change = patch => { setDraft(previous => ({ ...previous, ...patch })); setNotice(''); };
          const customChange = patch => { setCustom(previous => ({ ...previous, ...patch })); setNotice(''); };
          const group = state?.catalog.groups.find(item => item.id === draft.provider);
          const model = group?.models.find(item => item.id === draft.model);
          const dirty = state && JSON.stringify(draft) !== JSON.stringify(state.selection);
          const disabled = busy || !state?.writable;
          const option = (value, label) => h('option', { key: value, value }, label);
          const field = (key, label, control, help) => h('div', { className: 'dsm-field', key },
            h('label', { htmlFor: `${uid}-${key}` }, label),
            React.cloneElement(control, { id: `${uid}-${key}`, 'aria-describedby': help ? `${uid}-${key}-help` : undefined }),
            help && h('p', { id: `${uid}-${key}-help`, className: 'dsm-hint' }, help));

          async function save(event) {
            event.preventDefault();
            if (inFlight.current || !state) return;
            inFlight.current = true; setBusy(true); setError(''); setNotice('');
            let committed = false;
            try {
              await controller.save(draft, state.own.revision);
              committed = true;
              const next = await controller.read();
              if (alive.current) { setState(next); setDraft(next.selection); setNotice(t('saved')); }
            } catch (error) { if (alive.current) setError((committed ? `${t('saved')} ` : '') + errorText(error)); }
            finally { inFlight.current = false; if (alive.current) setBusy(false); }
          }

          async function addApi(event) {
            event.preventDefault();
            if (inFlight.current || !state?.adapter) return;
            inFlight.current = true; setBusy(true); setError(''); setNotice('');
            const secret = apiKey.trim();
            let ref = savedRef;
            let stored = Boolean(ref);
            let providerAdded = false;
            try {
              // Unique private credential avoids replacing another provider's key.
              if (!ref) ref = `DSH_SUBAGENT_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}_API_KEY`;
              const input = { ...custom, credentialRef: ref };
              const prepared = prepareCustomProvider(input); // Validate before any credential write.
              if (Object.hasOwn(state.adapter.value?.providers || {}, prepared.provider) || state.catalog.routableProviders.includes(prepared.provider)) fail('provider_exists', prepared.provider);
              if (!stored) {
                if (!secret) throw new Error(t('keyRequired'));
                const info = (await unwrap(ctx.remote.credentials.describe([ref])))[ref];
                if (info.configured || !info.writable) throw new Error('Credential reference is unavailable');
                await unwrap(ctx.remote.credentials.set(ref, secret));
                stored = true;
                if (alive.current) { setSavedRef(ref); setApiKey(''); }
              }
              const result = await controller.addApi(input, state.adapter.revision);
              providerAdded = true;
              if (alive.current) {
                setSavedRef(''); setApiKey('');
                setCustom({ slug: '', displayName: '', type: 'chat', baseURL: '', model: '', contextWindow: 128000, maxTokens: 8192, efforts: [] });
              }
              const next = await controller.read();
              if (alive.current) {
                setState(next);
                if (result.verified) {
                  setDraft({ mode: 'fixed', provider: result.provider, model: result.model });
                  setNotice(t('apiAdded'));
                } else {
                  setError(`${t('providerSavedPartial')} ${result.provider}\n${errorText({ code: result.warning, message: result.warning })}`);
                }
              }
            } catch (error) {
              if (alive.current) setError(`${stored ? `${t(providerAdded ? 'providerSavedPartial' : 'keySavedPartial')} ${ref}\n` : ''}${errorText(error, secret)}`);
            } finally { inFlight.current = false; if (alive.current) setBusy(false); }
          }

          const savedDescription = !state || state.selection.mode === 'inherit' ? t('unchanged') : `${state.selection.provider} / ${state.selection.model} · ${state.selection.reasoningEffort || t('auto')}`;
          return h('section', { className: 'dsm-page', 'aria-label': t('title'), 'aria-busy': busy },
            h('style', null, css),
            h('header', { className: 'dsm-heading' }, h('h2', null, t('title')), h('p', null, t('subtitle'))),
            h('p', { className: 'dsm-hint' }, t('scope')),
            error && h('div', { className: 'dsm-message dsm-error', role: 'alert' }, error),
            notice && h('div', { className: 'dsm-message dsm-success', role: 'status' }, notice),
            !state && h('div', null, busy ? t('loading') : h('button', { type: 'button', className: 'dsm-button', onClick: load }, t('retry'))),
            state && h(React.Fragment, null,
              !state.writable && h('p', { role: 'status' }, t('readOnly')),
              state.catalog.failures.length > 0 && h('details', { className: 'dsm-warning' }, h('summary', null, t('partialCatalog')), state.catalog.failures.map(item => h('p', { key: item.id }, `${item.name}: ${item.message}`))),
              h('form', { onSubmit: save },
                h('fieldset', { className: 'dsm-fieldset', disabled },
                  h('legend', null, t('routing')),
                  h('div', { className: 'dsm-modes' }, ['inherit', 'fixed'].map(mode => h('label', { key: mode, className: `dsm-mode${draft.mode === mode ? ' dsm-selected' : ''}` },
                    h('input', { type: 'radio', name: `${uid}-mode`, value: mode, checked: draft.mode === mode, onChange: () => change({ mode }) }),
                    h('span', null, h('strong', null, t(mode)), h('span', { className: 'dsm-hint' }, t(`${mode}Help`)))))),
                  draft.mode === 'fixed' && h('div', { className: 'dsm-fields' },
                    field('group', t('group'), h('select', { value: draft.provider || '', onChange: event => change({ provider: event.target.value, model: '', reasoningEffort: '' }), required: true }, option('', t('choose')), state.catalog.groups.map(item => option(item.id, item.name)))),
                    field('model', t('model'), h('select', { value: draft.model || '', onChange: event => change({ model: event.target.value, reasoningEffort: '' }), required: true, disabled: !group }, option('', t('choose')), (group?.models || []).map(item => option(item.id, item.name === item.id ? item.id : `${item.name} · ${item.id}`)))),
                    field('effort', t('effort'), h('select', { value: draft.reasoningEffort || '', onChange: event => change({ reasoningEffort: event.target.value }), disabled: !model?.reasoning?.efforts.length }, option('', t('auto')), (model?.reasoning?.efforts || []).map(item => option(item.id, `${item.name} · ${item.id}`))), !model?.reasoning?.efforts.length ? t('noEffort') : undefined)),
                  draft.mode === 'fixed' && draft.model && !model && h('p', { className: 'dsm-warning' }, t('missingModel')),
                  h('div', { className: 'dsm-status' }, h('span', null, `${t('active')}：`), h('code', null, savedDescription)),
                  h('div', { className: 'dsm-actions' },
                    h('button', { className: 'dsm-button dsm-primary', type: 'submit', disabled: !dirty }, busy ? t('saving') : t('save')),
                    h('button', { className: 'dsm-button', type: 'button', onClick: load, title: t('refreshHelp') }, t('refresh')),
                    dirty && h('span', { className: 'dsm-hint' }, t('draft'))))),
              h('p', { className: 'dsm-hint' }, t('policy')),
              h('details', { className: 'dsm-custom' },
                h('summary', null, t('custom')),
                h('p', { className: 'dsm-hint' }, t('customHelp')),
                !state.adapter ? h('p', null, t('apiUnavailable')) : h('form', { onSubmit: addApi },
                  h('fieldset', { className: 'dsm-fieldset', disabled },
                    h('div', { className: 'dsm-fields' },
                      field('slug', t('slug'), h('input', { value: custom.slug, onChange: event => customChange({ slug: event.target.value }), required: true, pattern: '[a-z0-9][a-z0-9-]{0,39}', placeholder: 'my-api', autoComplete: 'off' }), t('slugHelp')),
                      field('display', t('displayName'), h('input', { value: custom.displayName, onChange: event => customChange({ displayName: event.target.value }), placeholder: t('custom') })),
                      field('api', t('apiType'), h('select', { value: custom.type, onChange: event => customChange({ type: event.target.value }) }, ['chat', 'responses', 'claude'].map(type => option(type, t(type))))),
                      field('url', t('baseURL'), h('input', { value: custom.baseURL, type: 'url', required: true, placeholder: 'https://api.example.com/v1', autoComplete: 'off', onChange: event => customChange({ baseURL: event.target.value }) }), t('urlHelp')),
                      field('custom-model', t('modelId'), h('input', { value: custom.model, required: true, autoComplete: 'off', onChange: event => customChange({ model: event.target.value }) }), t('modelHelp')),
                      field('key', t('apiKey'), h('input', { value: apiKey, type: 'password', required: !savedRef, disabled: Boolean(savedRef), autoComplete: 'new-password', spellCheck: false, onChange: event => setApiKey(event.target.value) }), savedRef || t('keyHelp')),
                      field('context', t('contextWindow'), h('input', { type: 'number', min: 1, step: 1, required: true, value: custom.contextWindow, onChange: event => customChange({ contextWindow: event.target.value }) })),
                      field('tokens', t('maxTokens'), h('input', { type: 'number', min: 1, step: 1, required: true, value: custom.maxTokens, onChange: event => customChange({ maxTokens: event.target.value }) }))),
                    h('fieldset', { className: 'dsm-capabilities' }, h('legend', null, t('capabilities')),
                      h('div', { className: 'dsm-checks' }, EFFORTS.map(effort => h('label', { key: effort }, h('input', { type: 'checkbox', checked: custom.efforts.includes(effort), onChange: event => customChange({ efforts: event.target.checked ? [...custom.efforts, effort] : custom.efforts.filter(item => item !== effort) }) }), effort))),
                      h('p', { className: 'dsm-hint' }, t('capabilitiesHelp'))),
                    h('p', { className: 'dsm-warning' }, t('security')),
                    h('button', { className: 'dsm-button dsm-primary', type: 'submit' }, busy ? t('saving') : t('addApi')))))));
        }

        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: PLUGIN_ID, order: 12, label: () => t('title') }, Page));
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: PLUGIN_ID }, Page));
      },
    };
  },
});
