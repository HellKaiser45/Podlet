import { Elysia, t } from 'elysia';
import AppContainer from '../runtime';
import type { ModelConfig } from '../types';

// Every quirk must be declared: Elysia would otherwise strip it before the
// handler ever sees it, making the opt-in unreachable.
const QuirksSchema = t.Optional(t.Object({
  no_cache_control: t.Optional(t.Boolean()),
  no_reasoning_effort: t.Optional(t.Boolean()),
  no_stream_options: t.Optional(t.Boolean()),
  anthropic_static_budget: t.Optional(t.Boolean()),
  disable_thinking_on_none: t.Optional(t.Boolean()),
  opencode_session: t.Optional(t.Boolean()),
}));

const HeadersSchema = t.Optional(t.Record(t.String(), t.String()));

const ModelFieldsSchema = {
  provider: t.String(),
  model: t.String(),
  api_key_name: t.Optional(t.String()),
  base_url: t.Optional(t.String()),
  headers: HeadersSchema,
  quirks: QuirksSchema,
  api_key_optional: t.Optional(t.Boolean()),
};

const PartialModelFieldsSchema = {
  provider: t.Optional(t.String()),
  model: t.Optional(t.String()),
  api_key_name: t.Optional(t.String()),
  base_url: t.Optional(t.String()),
  headers: HeadersSchema,
  quirks: QuirksSchema,
  api_key_optional: t.Optional(t.Boolean()),
};

const MODEL_FIELDS = [
  'provider',
  'model',
  'api_key_name',
  'base_url',
  'headers',
  'quirks',
  'api_key_optional',
] as const;

/**
 * Both routes run with `normalize: false` so an undeclared key is still visible
 * here. Without that, Elysia would silently drop `reasoning_effort` and the
 * legacy-config upgrade would look like a success.
 */
const REASONING_EFFORT_REMOVED =
  "reasoning_effort is no longer a model setting — delete the 'reasoning_effort' key; thinking is now per agent (agent.thinking: none|low|medium|high)";

const PROTOCOL_REMOVED =
  "protocol is not a model setting — delete the 'protocol' key; the entry's 'provider' name alone decides the protocol";

function pickModelFields(raw: unknown): Partial<ModelConfig> {
  const out: Record<string, unknown> = {};
  if (raw === null || typeof raw !== 'object') return out as Partial<ModelConfig>;
  const source = raw as Record<string, unknown>;
  for (const field of MODEL_FIELDS) {
    if (field in source) out[field] = source[field];
  }
  return out as Partial<ModelConfig>;
}

function hasRemovedField(raw: unknown, field: 'reasoning_effort' | 'protocol'): boolean {
  return raw !== null && typeof raw === 'object' && field in (raw as Record<string, unknown>);
}

export default function modelsRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/models' })
    // GET all models (stored config + response-only health)
    .get('/all', () => container.modelManager.getAll())

    // GET single model
    .get('/:name', ({ params, set }) => {
      const model = container.modelManager.load(params.name);
      if (!model) {
        set.status = 404;
        return { error: 'Model not found' };
      }
      return { name: params.name, ...model };
    })

    // POST create model
    .post('/', async ({ body, set }) => {
      const rawConfig = (body as Record<string, any>).config;
      if (hasRemovedField(rawConfig, 'reasoning_effort')) {
        set.status = 422;
        return { error: REASONING_EFFORT_REMOVED };
      }
      if (hasRemovedField(rawConfig, 'protocol')) {
        set.status = 422;
        return { error: PROTOCOL_REMOVED };
      }
      try {
        const config = await container.modelManager.create(body.name, pickModelFields(rawConfig) as ModelConfig);
        set.status = 201;
        return { name: body.name, ...config, health: container.modelManager.health[body.name] };
      } catch (e: any) {
        set.status = 409;
        return { error: e.message };
      }
    }, {
      normalize: false,
      body: t.Object({
        name: t.String(),
        config: t.Object(ModelFieldsSchema),
      })
    })

    // PUT update model (partial)
    .put('/:name', async ({ params, body, set }) => {
      if (hasRemovedField(body, 'reasoning_effort')) {
        set.status = 422;
        return { error: REASONING_EFFORT_REMOVED };
      }
      if (hasRemovedField(body, 'protocol')) {
        set.status = 422;
        return { error: PROTOCOL_REMOVED };
      }
      try {
        const config = await container.modelManager.update(params.name, pickModelFields(body));
        return { name: params.name, ...config, health: container.modelManager.health[params.name] };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    }, {
      normalize: false,
      body: t.Object(PartialModelFieldsSchema)
    })

    // DELETE model
    .delete('/:name', async ({ params, set }) => {
      try {
        await container.modelManager.delete(params.name);
        return { success: true };
      } catch (e: any) {
        set.status = 404;
        return { error: e.message };
      }
    })
}