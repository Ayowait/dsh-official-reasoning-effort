import { buildPlan, DEFAULT_EFFORT, DEFAULT_EFFORTS, DEFAULT_LEVELS } from './plan.js'

const PI_AI_NAMESPACE = 'llm-pi-ai'
const ROUTE_PATH = '/dsh-official-reasoning-effort/api/injected'

// Intentionally NO Config schema / no `@deepseek-ai/schemastery` import.
//
// Profile plugins are loaded from `node_modules/<pkg>` where bare
// `@deepseek-ai/*` specifiers are NOT resolvable (the framework keeps those
// inside its own asar module graph). Importing schemastery here makes the whole
// host bundle throw MODULE_NOT_FOUND at load time, which takes the app down.
// The config object is plain and optional, exactly like `dsh-usage-insights`:
// export only `apply` + `name` (+ `inject`) and read `config = {}` defensively.

const name = 'dsh-official-reasoning-effort'
const inject = ['settings', 'webServer']

const STARTUP_RETRY_DELAY_MS = 50
const STARTUP_RETRY_LIMIT = 40

/**
 * Keep the "keys this plugin injected" set live for the read-only HTTP route
 * the browser half calls to decide whether to show the "upstream did not
 * declare" hint line.
 */
function createRegistry() {
  let keys = new Set()
  let names = new Set()
  return {
    replace(list, nameList) {
      keys = new Set(list)
      names = new Set(nameList ?? [])
    },
    toJSON() {
      // `injected` entries are `${provider}\u0000${model}`. The browser half
      // matches this pair against the official menu's data-provider-id and
      // data-model-id — never the model id alone, because two providers can
      // expose the same model id and only one of them lacks a declaration.
      return { injected: [...keys], names: [...names] }
    },
  }
}

/**
 * Read the live `llm-pi-ai` config through the settings service.
 *
 * The DSH settings service exposes `describe()` (not `get()`): it returns one
 * descriptor per configurable plugin entry, and `descriptor.value` is that
 * entry's live config projected onto its volatile form. For `llm-pi-ai` that
 * form is `{ providers: { ... } }`.
 */
function readPiAiConfig(ctx) {
  if (typeof ctx.settings.describe !== 'function') return undefined
  const descriptors = ctx.settings.describe()
  if (!Array.isArray(descriptors)) return undefined
  const entry = descriptors.find((row) => row && row.ns === PI_AI_NAMESPACE)
  return entry === undefined ? undefined : entry.value
}

async function syncOnce(ctx, config, registry) {
  const current = readPiAiConfig(ctx)
  if (current === undefined) return false
  const { ops, injected, names } = buildPlan(current, config)
  if (ops.length === 0) {
    registry.replace(injected, names)
    return true
  }
  try {
    await ctx.settings.mutate(PI_AI_NAMESPACE, ops)
    registry.replace(injected, names)
    ctx.logger.info('[dsh-official-reasoning-effort] wrote %d reasoning-effort setting(s)', ops.length)
  } catch (error) {
    // Still record what we intended, so the UI hint is correct even if a
    // particular write is refused by schema validation.
    registry.replace(injected, names)
    ctx.logger.warn('[dsh-official-reasoning-effort] could not update llm-pi-ai settings')
    ctx.logger.warn(error)
  }
  return true
}

function apply(ctx, config = {}) {
  const registry = createRegistry()
  let startupAttempts = 0
  // Liveness signal: the browser half stamps this header on every poll. A
  // non-zero count proves the client bundle loaded and ran — the one thing we
  // cannot otherwise observe from the host process.
  let clientHits = 0

  const sync = () => {
    syncOnce(ctx, config, registry)
      .then((ready) => {
        if (ready || startupAttempts >= STARTUP_RETRY_LIMIT) return
        startupAttempts += 1
        setTimeout(sync, STARTUP_RETRY_DELAY_MS)
      })
      .catch((error) => {
        ctx.logger.warn('[dsh-official-reasoning-effort] sync failed')
        ctx.logger.warn(error)
      })
  }

  setTimeout(sync, 0)
  ctx.on('settings/updated', (namespace) => {
    if (namespace === PI_AI_NAMESPACE) sync()
  })

  // Read-only route: the browser half fetches this same-origin to learn which
  // provider/model keys had their reasoning supplied generically.
  ctx.effect(
    () =>
      ctx.webServer.register({
        path: ROUTE_PATH,
        method: 'GET',
        handler: (request, response) => {
          try {
            if (request && request.headers && request.headers['x-dsh-official-reasoning-effort'] === 'client') clientHits += 1
          } catch {
            // ignore malformed request objects
          }
          const body = JSON.stringify({ ...registry.toJSON(), clientHits })
          response.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          response.end(body)
        },
      }),
    'dsh-official-reasoning-effort: injected-keys route',
  )
}

export { apply, inject, name, DEFAULT_EFFORT, DEFAULT_EFFORTS, DEFAULT_LEVELS }
