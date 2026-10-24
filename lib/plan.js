/**
 * Pure planning logic for dsh-official-reasoning-effort (no runtime dependencies).
 *
 * These functions decide which `llm-pi-ai` model entries need generic reasoning
 * levels injected, and produce the additive settings ops. Keeping this module
 * dependency-free lets it be unit-tested offline and reused by `index.js`.
 *
 * The generic set mirrors the levels the official DeepSeek reasoning control
 * exposes — Off / Low / High / Max. `llm-pi-ai` builds each level's display
 * label by capitalising the level id (see `reasoningInfo`:
 * `${level[0].toUpperCase()}${level.slice(1)}`), so the ids `off/low/high/max`
 * render exactly as "Off / Low / High / Max" — no UI work on our side.
 */

/** The four generic levels offered when a model declares none (official-style). */
export const DEFAULT_LEVELS = ['off', 'low', 'high', 'max']
/** Wire value sent upstream for each generic level: the level name itself. */
export const DEFAULT_EFFORTS = { off: 'off', low: 'low', high: 'high', max: 'max' }
/**
 * The provider-level default effort.
 *
 * This is NOT cosmetic. The official picker builds its level list as:
 *
 *   [...(reasoning.defaultEffort === undefined
 *        ? [{ effort: undefined, label: t('effort.providerDefault') }] : []),
 *    ...reasoning.efforts.map(...)]
 *
 * so a model whose `defaultEffort` is missing gets an EXTRA leading "Default"
 * row — five rows instead of the official four. `llm-pi-ai` derives
 * `defaultEffort` from the provider profile's `reasoning` field, so declaring
 * it is what makes the menu read exactly Off / Low / High / Max. The official
 * `dsh-llm-deepseek` adapter always sets one (falling back to `high`, "the
 * default balance for most tasks"), which is why the built-in provider shows
 * only four rows. We mirror that.
 */
export const DEFAULT_EFFORT = 'high'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deep, key-and-value equality for two flat effort dicts. */
function equalSet(a, b) {
  if (!isRecord(a) || !isRecord(b)) return false
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const key of bk) {
    if (!Object.prototype.hasOwnProperty.call(a, key)) return false
    if (a[key] !== b[key]) return false
  }
  return true
}

/** Merge a provided effort override over the plugin defaults (wire values win). */
export function mergeEfforts(override) {
  if (!isRecord(override)) return { ...DEFAULT_EFFORTS }
  const merged = { ...DEFAULT_EFFORTS }
  for (const [level, wire] of Object.entries(override)) {
    if (typeof wire === 'string' && wire.length > 0) merged[level] = wire
  }
  return merged
}

function providerEffortsOf(config, provider) {
  const providerCfg = isRecord(config?.providers) ? config.providers[provider] : undefined
  return mergeEfforts(isRecord(providerCfg) ? providerCfg.efforts : undefined)
}

function modelEffortsOf(providerEfforts, modelCfg) {
  if (isRecord(modelCfg) && isRecord(modelCfg.efforts)) {
    return { ...providerEfforts, ...mergeEfforts(modelCfg.efforts) }
  }
  return providerEfforts
}

/**
 * True when `efforts` is exactly the three-level set a previous release of this
 * plugin (0.2.x) wrote for a model whose upstream declared nothing:
 * `{low, medium, high}`. It exists ONLY so we can recognise, and upgrade, our
 * own earlier write. A genuine upstream is implausible to declare exactly these
 * three levels — `medium` is not even one of DeepSeek's official levels, and the
 * providers that do declare levels use richer sets (`off/minimal/xhigh/max`,
 * `... : false`, …) — so this narrow signature cannot clobber real capability.
 */
function isLegacyGenericSet(efforts) {
  if (!isRecord(efforts)) return false
  const keys = Object.keys(efforts)
  return keys.length === 3 && keys.includes('low') && keys.includes('medium') && keys.includes('high')
}

/**
 * True when `efforts` is a generic set this plugin writes — either the current
 * default (or an override's set) or the legacy `{low,medium,high}` set. Anything
 * else is a genuine upstream declaration and must be left untouched.
 */
function isOurGenericSet(efforts, expected) {
  return equalSet(efforts, expected) || isLegacyGenericSet(efforts)
}

function displayName(entry, modelId) {
  return typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : modelId
}

/**
 * Plan the additive settings ops for one provider profile.
 * @returns {{ ops: object[], injected: string[] }} ops to apply and injected keys.
 */
export function planProvider(provider, profile, config, injected, injectedNames = []) {
  const empty = { ops: [], injected }
  if (!isRecord(profile)) return empty
  if (config.disabled === true) return empty
  const providerCfg = isRecord(config.providers) ? config.providers[provider] : undefined
  if (isRecord(providerCfg) && providerCfg.disabled === true) return empty

  const injectedBefore = injected.length
  const providerEfforts = providerEffortsOf(config, provider)
  const requestedDefault =
    typeof config.defaultEffort === 'string' && DEFAULT_LEVELS.includes(config.defaultEffort)
      ? config.defaultEffort
      : DEFAULT_EFFORT
  const ops = []

  const modelCfgFor = (modelId) =>
    isRecord(providerCfg) && isRecord(providerCfg.models) && typeof modelId === 'string'
      ? providerCfg.models[modelId]
      : undefined

  // The set to write: `false` when the model is a configured non-reasoner,
  // otherwise the merged generic/override effort map.
  const targetEfforts = (modelCfg) =>
    isRecord(modelCfg) && modelCfg.disabled === true ? false : { ...modelEffortsOf(providerEfforts, modelCfg) }

  const record = (modelId, entry) => {
    injected.push(provider + '\u0000' + modelId)
    injectedNames.push(displayName(entry, modelId))
  }

  const models = profile.models
  if (Array.isArray(models)) {
    let changed = false
    const next = models.map((entry) => {
      if (!isRecord(entry)) return entry
      const modelId = entry.id
      if (typeof modelId !== 'string' || modelId.length === 0) return entry
      const target = targetEfforts(modelCfgFor(modelId))
      if (entry.reasoningEfforts !== undefined) {
        // Already declared. If it is a generic set this plugin writes, keep
        // flagging it as injected (so the hint persists across restarts) and
        // upgrade a legacy set to the current one; otherwise it belongs to the
        // upstream and is left exactly as-is.
        if (target !== false && isOurGenericSet(entry.reasoningEfforts, target)) {
          record(modelId, entry)
          if (!equalSet(entry.reasoningEfforts, target)) {
            changed = true
            return { ...entry, reasoningEfforts: target }
          }
        }
        return entry
      }
      changed = true
      record(modelId, entry)
      return { ...entry, reasoningEfforts: target }
    })
    if (changed) ops.push({ op: 'set', path: ['providers', provider, 'models'], value: next })
  }

  const overrides = profile.modelOverrides
  if (isRecord(overrides)) {
    for (const modelId of Object.keys(overrides)) {
      const current = overrides[modelId]
      if (!isRecord(current)) continue
      const target = targetEfforts(modelCfgFor(modelId))
      if (current.reasoningEfforts !== undefined) {
        if (target !== false && isOurGenericSet(current.reasoningEfforts, target)) {
          record(modelId, current)
          if (!equalSet(current.reasoningEfforts, target)) {
            ops.push({
              op: 'set',
              path: ['providers', provider, 'modelOverrides', modelId, 'reasoningEfforts'],
              value: target,
            })
          }
        }
        continue
      }
      record(modelId, current)
      ops.push({
        op: 'set',
        path: ['providers', provider, 'modelOverrides', modelId, 'reasoningEfforts'],
        value: target,
      })
    }
  }

  // ---------------------------------------------------------------------
  // Provider-level default effort.
  //
  // The official picker renders a leading "Default" row whenever the model's
  // `defaultEffort` is undefined (see ModelSelect's effortChoices:
  // `reasoning.defaultEffort === void 0 ? [{ effort: undefined, ... }] : []`).
  // `llm-pi-ai` fills `defaultEffort` from the *provider profile's* `reasoning`
  // field, so a provider that never declares one shows five rows instead of the
  // official four. We declare it only when we actually injected something for
  // this provider (i.e. it lacked declarations), and never overwrite a value the
  // operator or the installed catalog already set. Models with a genuine
  // upstream declaration are untouched, so a provider that needs no injection
  // keeps its own default behaviour.
  const injectedForProvider = injected.length > injectedBefore
  if (injectedForProvider && config.syncDefaultEffort !== false && profile.reasoning === undefined) {
    ops.push({ op: 'set', path: ['providers', provider, 'reasoning'], value: requestedDefault })
  }

  return { ops, injected }
}

/**
 * Build additive `llm-pi-ai` settings ops for every existing provider.
 * @returns {{ ops: object[], injected: string[], names: string[] }}
 */
export function buildPlan(current, config = {}) {
  const providers = isRecord(current) && isRecord(current.providers) ? current.providers : undefined
  if (providers === undefined) return { ops: [], injected: [], names: [] }
  const auto = config.auto === false ? false : true
  const ops = []
  const injected = []
  const names = []
  for (const [provider, profile] of Object.entries(providers)) {
    if (!auto && !(isRecord(config.providers) && Object.prototype.hasOwnProperty.call(config.providers, provider))) continue
    const result = planProvider(provider, profile, config, injected, names)
    for (const op of result.ops) ops.push(op)
  }
  return { ops, injected, names }
}
