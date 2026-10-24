/**
 * Browser half of dsh-official-reasoning-effort (source of truth for lib/client.js).
 *
 * Does NOT touch or replace the official model picker. The host half supplies
 * generic off/low/high/max levels for models that declare none, so the official
 * Effort row appears by itself. Here we only add a one-line hint at the bottom
 * of the official menu when the current model's levels were supplied
 * generically, via a data attribute + ::after.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

const ROUTE = '/dsh-official-reasoning-effort/api/injected'
const STYLE_ID = 'dsh-official-reasoning-effort-hint'
const ATTR = 'data-thinking-unsupported'
const MENU_LABELS = ['模型与推理等级', 'Model and reasoning effort']
const HINT_ZH = '上游未声明思考强度，此处为通用档位，上游可能忽略或拒绝。'
const HINT_EN = 'Upstream does not declare reasoning effort; these are generic levels and may be ignored or rejected.'

// Pure DOM side effect: no required services, so apply() always runs.
export const inject: string[] = []

function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-official-reasoning-effort'
  style.textContent =
    `[role="menu"][${ATTR}="true"]::after{` +
    `content:"${HINT_ZH}";` +
    `display:block;padding:6px 10px 4px;` +
    `color:var(--dsw-alias-label-tertiary,#8a919d);` +
    `font-size:11px;line-height:15px;white-space:normal;}` +
    `:root[lang^="en"] [role="menu"][${ATTR}="true"]::after{content:"${HINT_EN}"}`
  document.head.appendChild(style)
  return () => { style.remove() }
}

function findRootMenu(): Element | null {
  if (typeof document === 'undefined') return null
  for (const label of MENU_LABELS) {
    const el = document.querySelector(`[role="menu"][aria-label="${label}"]`)
    if (el !== null) return el
  }
  return null
}

interface MenuModel { provider: string | null; id: string | null; name: string | null }

function currentMenuModel(menu: Element): MenuModel {
  const cells = menu.querySelectorAll('[role="menuitem"]')
  if (cells.length === 0) return { provider: null, id: null, name: null }
  const first = cells[0]
  const labelled = first.querySelector('[data-model-id]')
  const readAttr = (el: Element | null, attr: string): string | null => {
    if (el === null) return null
    const value = (el.getAttribute(attr) ?? '').trim()
    return value.length > 0 ? value : null
  }
  const id = readAttr(labelled, 'data-model-id')
  const provider = readAttr(labelled, 'data-provider-id')
  const spans = first.querySelectorAll('span')
  let name: string | null = null
  for (let i = spans.length - 1; i >= 0; i--) {
    const text = (spans[i].textContent ?? '').trim()
    if (text.length > 0) { name = text; break }
  }
  if (name === null) name = (first.textContent ?? '').trim()
  return { provider, id, name }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectStyles(), 'dsh-official-reasoning-effort: hint styles')

  let names = new Set<string>()
  let pairs = new Set<string>()
  let lastFetch = 0
  let pendingFetch: Promise<void> | undefined
  const refreshInjected = (): Promise<void> | undefined => {
    const now = Date.now()
    if (now - lastFetch < 500) return pendingFetch
    lastFetch = now
    pendingFetch = fetch(ROUTE, { headers: { accept: 'application/json', 'x-dsh-official-reasoning-effort': 'client' } })
      .then(r => (r.ok ? r.json() : undefined))
      .then((body: { names?: string[]; injected?: string[] } | undefined) => {
        if (body === undefined) return
        if (Array.isArray(body.names)) names = new Set(body.names.map(n => String(n).trim()))
        if (Array.isArray(body.injected)) pairs = new Set(body.injected.map(k => String(k)))
      })
      .catch(() => {})
    return pendingFetch
  }

  const syncMenu = (): void => {
    const menu = findRootMenu()
    if (menu === null) return
    const model = currentMenuModel(menu)
    let matched = false
    if (model.provider !== null && model.id !== null) matched = pairs.has(`${model.provider}\u0000${model.id}`)
    if (!matched && model.provider === null && model.id === null && model.name !== null) matched = names.has(model.name)
    if (matched) menu.setAttribute(ATTR, 'true')
    else menu.removeAttribute(ATTR)
  }

  const refreshThenSync = (): void => {
    if (findRootMenu() === null) return
    const p = refreshInjected()
    syncMenu()
    if (p !== undefined) p.then(() => syncMenu()).catch(() => {})
  }

  ctx.effect(() => {
    refreshInjected()
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
    const observer = new MutationObserver(() => {
      if (findRootMenu() !== null) refreshThenSync()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, 'dsh-official-reasoning-effort: menu observer')
}
