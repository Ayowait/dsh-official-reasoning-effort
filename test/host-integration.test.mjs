// Integration test for the host half (lib/index.js) against a mock DSH runtime.
// Verifies the settings wiring, the injected-keys route, and re-sync on updates.
import { createServer } from 'node:http'

let failures = 0
const assert = (c, l) => { if (c) console.log('ok  ', l); else { failures++; console.error('FAIL', l) } }

// ---- mock settings service: describe() returns the live llm-pi-ai config ----
const liveConfig = {
  providers: {
    gateway: { api: 'openai-completions', models: [{ id: 'deepseek-v4.1-flash' }] },
  },
}
const mutateCalls = []
const settings = {
  describe() {
    return [{ ns: 'llm-pi-ai', value: JSON.parse(JSON.stringify(liveConfig)) }]
  },
  async mutate(ns, ops) {
    mutateCalls.push({ ns, ops })
    // Apply ops so a subsequent describe() reflects the write.
    for (const op of ops) {
      let node = liveConfig
      for (let i = 0; i < op.path.length - 1; i++) node = node[op.path[i]]
      node[op.path[op.path.length - 1]] = op.value
    }
  },
}

// ---- mock ctx ----
let routeDef = null
const eventHandlers = {}
const ctx = {
  settings,
  webServer: {
    register(def) { routeDef = def; return () => {} },
  },
  on(event, handler) { eventHandlers[event] = handler },
  effect(fn) { return fn() },
  logger: { info() {}, warn() {}, error() {} },
}

// ---- load the host half as ESM and apply ----
const mod = await import('../lib/index.js')
assert(mod.name === 'dsh-official-reasoning-effort', 'host name export')
assert(Array.isArray(mod.inject) && mod.inject.includes('settings') && mod.inject.includes('webServer'), 'host inject includes settings+webServer')
assert(!('Config' in mod), 'no Config export (avoids unresolvable schemastery import)')

mod.apply(ctx, {})
await new Promise((r) => setTimeout(r, 30)) // let the setTimeout(sync,0) run

assert(mutateCalls.length === 1, 'settings.mutate was called')
assert(mutateCalls[0].ns === 'llm-pi-ai', 'mutate targeted llm-pi-ai')
const ops = mutateCalls[0].ops
const op = ops.find((o) => o.path.join('.') === 'providers.gateway.models')
assert(op !== undefined, 'models op was written')
assert(
  JSON.stringify(op.value[0].reasoningEfforts) === JSON.stringify({ off: 'off', low: 'low', high: 'high', max: 'max' }),
  'gateway model got injected off/low/high/max, got ' + JSON.stringify(op.value[0].reasoningEfforts),
)
// Without this the official picker inserts a leading "Default" row -> 5 rows.
const effortDefault = ops.find((o) => o.path.join('.') === 'providers.gateway.reasoning')
assert(effortDefault !== undefined && effortDefault.value === 'high', 'provider default effort written so the menu shows exactly Off/Low/High/Max')

// ---- route ----
assert(routeDef !== null && routeDef.path === '/dsh-official-reasoning-effort/api/injected', 'injected route registered at expected path')

const server = createServer((req, res) => {
  if (routeDef && req.url === routeDef.path) return routeDef.handler(req, res)
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port

const body = await (await fetch(base + '/dsh-official-reasoning-effort/api/injected')).json()
assert(Array.isArray(body.injected), 'route returns { injected: [] }')
assert(body.injected.includes('gateway\u0000deepseek-v4.1-flash'), 'injected list contains gateway model key, got ' + JSON.stringify(body.injected))
assert(Array.isArray(body.names) && body.names.includes('deepseek-v4.1-flash'), 'route returns injected model names, got ' + JSON.stringify(body.names))
assert(!('ids' in body), 'route does not expose bare ids (provider+model pair matching only)')
server.close()

// settings/updated should re-sync: add a second provider and fire the event.
liveConfig.providers.gw2 = { models: [{ id: 'm-2' }] }
eventHandlers['settings/updated'] && eventHandlers['settings/updated']('llm-pi-ai')
await new Promise((r) => setTimeout(r, 30))
assert(mutateCalls.length === 2, 're-sync handled settings/updated')

console.log(failures === 0 ? '\nALL HOST INTEGRATION TESTS PASSED' : '\n' + failures + ' HOST INTEGRATION TEST(S) FAILED')
if (failures > 0) process.exitCode = 1
