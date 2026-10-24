/**
 * Offline test for the browser half (lib/client.js).
 *
 * The client half no longer renders a React component — it is a side-effect
 * plugin that (1) injects a ::after hint stylesheet and (2) watches the DOM for
 * the official model menu, tagging it when the current model's provider+model
 * pair is in the host-supplied injected set. We stub a tiny DOM +
 * MutationObserver and verify.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
const assert = (c, l) => { if (c) console.log('ok  ', l); else { failures++; console.error('FAIL', l) } }

// ---- minimal DOM ----
const head = { children: [], appendChild(el) { this.children.push(el) } }
function makeEl(tag) {
  return {
    tagName: tag, dataset: {}, children: [], _attrs: {}, textContent: '',
    setAttribute(k, v) { this._attrs[k] = String(v) },
    removeAttribute(k) { delete this._attrs[k] },
    getAttribute(k) { return this._attrs[k] },
    appendChild(c) { this.children.push(c) },
    remove() {},
  }
}
const styleEls = {}
const documentStub = {
  head,
  getElementById(id) { return styleEls[id] ?? null },
  createElement(tag) { return makeEl(tag) },
  querySelector(sel) { return documentStub._menu && documentStub._menuSel === sel ? documentStub._menu : null },
  _menuSel: null, _menu: null,
}
// register <style> element by id
const origCreate = documentStub.createElement
documentStub.createElement = (tag) => {
  const el = origCreate(tag)
  if (tag === 'style') {
    let _id = ''
    Object.defineProperty(el, 'id', { get() { return _id }, set(v) { _id = v; styleEls[v] = el } })
  }
  return el
}

globalThis.document = documentStub
globalThis.Node = class Node {}
let observerCallback = null
globalThis.MutationObserver = class {
  constructor(cb) { observerCallback = cb }
  observe() {}
  disconnect() {}
}

// ---- fake fetch returns injected names ----
let fetchPayload = { injected: [], names: [] }
globalThis.fetch = async () => ({ ok: true, json: async () => fetchPayload })

// ---- load client.js through fake loader ----
let registered = null
globalThis.window = { __ModuleLoader__: { load(def) {
  const req = (n) => { if (n === 'react' || n === 'react/jsx-runtime') return {}; throw new Error('unexpected ' + n) }
  registered = def.factory(req)
} } }
new Function('window', 'document', 'MutationObserver', 'fetch', 'Node', readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8'))(
  globalThis.window, globalThis.document, globalThis.MutationObserver, globalThis.fetch, globalThis.Node,
)

assert(registered !== null, 'module registered via __ModuleLoader__')
assert(typeof registered.apply === 'function', 'exports.apply is a function')
assert(Array.isArray(registered.inject), 'exports.inject is an array')
assert(registered.inject.length === 0, 'client declares no required services (pure DOM side effect)')

// ---- fake ctx ----
const ctx = {
  effect(fn) { return fn() },
  modelDirectories: {}, sessions: {}, remote: {}, 'remote.session': {},
}
registered.apply(ctx)

await new Promise(r => setTimeout(r, 10)) // let initial fetch resolve

assert(styleEls['dsh-official-reasoning-effort-hint'] !== undefined, 'hint stylesheet injected')
const css = styleEls['dsh-official-reasoning-effort-hint']?.textContent ?? ''
assert(css.includes('上游未声明思考强度'), 'hint CSS carries the zh copy')
assert(css.includes('::after'), 'hint CSS uses ::after')
assert(observerCallback !== null, 'MutationObserver wired for the menu')

// ---- build a fake official menu whose model cell shows a given name ----
// Mirrors ModelSelect: the Model row's value span carries data-provider-id and
// data-model-id, and a slot plugin may rewrite the visible text (badge).
function makeMenu(modelName, modelId, providerId) {
  const m = makeEl('div')
  const item = makeEl('button')
  const labelSpan = makeEl('span'); labelSpan.textContent = '模型'
  const valueSpan = makeEl('span'); valueSpan.textContent = modelName
  if (modelId !== undefined) valueSpan._attrs['data-model-id'] = modelId
  if (providerId !== undefined) valueSpan._attrs['data-provider-id'] = providerId
  const hasIds = modelId !== undefined || providerId !== undefined
  item.querySelector = (sel) => (sel === '[data-model-id]' ? (hasIds ? valueSpan : null) : null)
  item.querySelectorAll = (sel) => (sel === 'span' ? [labelSpan, valueSpan] : [])
  m.querySelectorAll = (sel) => (sel === '[role="menuitem"]' ? [item] : [])
  return m
}

// The injected model, identified by its provider+model pair -> tagged.
fetchPayload = { injected: ['applefree\u0000deepseek-v4.1-flash-1017'], names: ['deepseek-v4.1-flash-1017'] }
documentStub._menu = makeMenu('deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash-1017', 'applefree')
documentStub._menuSel = '[role="menu"][aria-label="模型与推理等级"]'
await new Promise(r => setTimeout(r, 520)) // pass the 500ms fetch throttle
observerCallback && observerCallback()
await new Promise(r => setTimeout(r, 30)) // let the fetch->sync promise chain settle
assert(documentStub._menu.getAttribute('data-thinking-unsupported') === 'true', 'menu tagged for injected provider+model pair')

// Badge-rewritten label (text differs) -> still tagged via the id pair.
documentStub._menu = makeMenu('DeepSeek-V4.1-Flash 1017', 'deepseek-v4.1-flash-1017', 'applefree')
await new Promise(r => setTimeout(r, 520))
observerCallback && observerCallback()
await new Promise(r => setTimeout(r, 30))
assert(documentStub._menu.getAttribute('data-thinking-unsupported') === 'true', 'menu tagged via ids even when label text is rewritten')

// Same model id under a DIFFERENT provider (official account) -> NOT tagged.
documentStub._menu = makeMenu('DeepSeek-V4.1-Flash 1017', 'deepseek-v4.1-flash-1017', 'deepseek-account')
await new Promise(r => setTimeout(r, 520))
observerCallback && observerCallback()
await new Promise(r => setTimeout(r, 30))
assert(documentStub._menu.getAttribute('data-thinking-unsupported') !== 'true', 'same model id under another provider is NOT tagged')

// A genuinely supported model -> not tagged.
documentStub._menu = makeMenu('gpt-5', 'gpt-5', 'chatanywhere')
await new Promise(r => setTimeout(r, 520))
observerCallback && observerCallback()
await new Promise(r => setTimeout(r, 30))
assert(documentStub._menu.getAttribute('data-thinking-unsupported') !== 'true', 'menu not tagged for supported model')

console.log(failures === 0 ? '\nALL CLIENT TESTS PASSED' : '\n' + failures + ' CLIENT TEST(S) FAILED')
if (failures > 0) process.exitCode = 1
