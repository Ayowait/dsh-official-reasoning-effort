// Offline unit test for the pure planning logic (no DSH runtime needed).
import { buildPlan, mergeEfforts, DEFAULT_EFFORTS } from '../lib/plan.js'

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error('FAIL', label)
    console.error('  expected', e)
    console.error('  actual  ', a)
    process.exitCode = 1
  } else {
    console.log('ok  ', label)
  }
}

// 1. A gateway model with no reasoningEfforts gets off/low/high/max injected and is recorded.
const settings1 = {
  providers: {
    gateway: {
      api: 'openai-completions',
      models: [
        { id: 'deepseek-v4.1-flash' },
        { id: 'gpt-x', reasoningEfforts: false },
        { id: 'native', reasoningEfforts: { low: 'low', high: 'high' } },
      ],
    },
  },
}
const p1 = buildPlan(settings1, {})
eq(p1.injected, ['gateway\u0000deepseek-v4.1-flash'], 'gateway model recorded as injected')
const modelsOp1 = p1.ops.find((o) => o.path.join('.') === 'providers.gateway.models')
eq(modelsOp1 !== undefined, true, 'one set op for models array')
const models = modelsOp1.value
eq(models[0].reasoningEfforts, DEFAULT_EFFORTS, 'gateway model got default levels')
eq(models[1].reasoningEfforts, false, 'existing false preserved, not recorded')
eq(models[2].reasoningEfforts, { low: 'low', high: 'high' }, 'native declaration untouched')

// 2. modelOverrides path.
const settings2 = {
  providers: {
    gw2: { modelOverrides: { 'm-1': { name: 'M1' }, 'm-2': { reasoningEfforts: { low: 'low' } } } },
  },
}
const p2 = buildPlan(settings2, {})
eq(p2.injected, ['gw2\u0000m-1'], 'override model recorded')
eq(p2.ops[0].path, ['providers', 'gw2', 'modelOverrides', 'm-1', 'reasoningEfforts'], 'override op path')
eq(p2.ops[0].value, DEFAULT_EFFORTS, 'override got default levels')

// 3. Per-model effort override changes wire values but still records injection.
const settings3 = { providers: { gw3: { models: [{ id: 'm' }] } } }
const p3 = buildPlan(settings3, { providers: { gw3: { models: { m: { efforts: { high: 'reasoning_high' } } } } } })
eq(p3.ops[0].value[0].reasoningEfforts, { off: 'off', low: 'low', high: 'reasoning_high', max: 'max' }, 'wire override applied')

// 4. Provider disabled -> untouched.
const settings4 = { providers: { off: { models: [{ id: 'm' }] } } }
const p4 = buildPlan(settings4, { providers: { off: { disabled: true } } })
eq(p4.injected, [], 'disabled provider skipped')
eq(p4.ops, [], 'disabled provider no ops')

// 5. auto:false only touches explicitly listed providers.
const settings5 = { providers: { a: { models: [{ id: 'm' }] }, b: { models: [{ id: 'n' }] } } }
const p5 = buildPlan(settings5, { auto: false, providers: { b: {} } })
eq(p5.injected, ['b\u0000n'], 'auto:false only listed provider')

// 6. Model-level disabled -> reasoningEfforts:false (honor non-reasoning upstream).
const settings6 = { providers: { g: { models: [{ id: 'nr' }] } } }
const p6 = buildPlan(settings6, { providers: { g: { models: { nr: { disabled: true } } } } })
eq(p6.ops[0].value[0].reasoningEfforts, false, 'model disabled gets false')

// 7. mergeEfforts basic.
eq(mergeEfforts({ high: 'reasoning_high' }), { off: 'off', low: 'low', high: 'reasoning_high', max: 'max' }, 'mergeEfforts override')
eq(mergeEfforts(undefined), DEFAULT_EFFORTS, 'mergeEfforts default')

// 8. Empty providers / missing namespace -> no ops.
eq(buildPlan({}, {}), { ops: [], injected: [], names: [] }, 'empty providers')
eq(buildPlan(undefined, {}), { ops: [], injected: [], names: [] }, 'missing current')

// 9. Injected model display names are reported for the client hint.
const settings9 = { providers: { gw: { models: [{ id: 'deepseek-v4.1-flash-1017', name: 'deepseek-v4.1-flash-1017' }] } } }
const p9 = buildPlan(settings9, {})
eq(p9.names, ['deepseek-v4.1-flash-1017'], 'injected display names captured')

// 10. Idempotency: a model already holding exactly our current set is NOT
// re-written (no ops) but is STILL reported as injected so the UI hint persists.
const settings10 = { providers: { gw: { models: [{ id: 'm', reasoningEfforts: { off: 'off', low: 'low', high: 'high', max: 'max' } }] } } }
const p10 = buildPlan(settings10, {})
eq(p10.ops.some((o) => o.path.join('.') === 'providers.gw.models'), false, 'our current set not re-written (idempotent)')
eq(p10.injected, ['gw\u0000m'], 'our current set still reported injected for hint')
eq(p10.names, ['m'], 'our current set name reported')

// 11. A genuine upstream declaration (different level set) is neither written nor reported.
const settings11 = { providers: { gw: { models: [{ id: 'm', reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' } }] } } }
const p11 = buildPlan(settings11, {})
eq(p11.ops, [], 'genuine declaration untouched')
eq(p11.injected, [], 'genuine declaration not reported as injected')

// 12. MIGRATION: a legacy set written by 0.2.x ({low,medium,high}) is recognised,
// upgraded to the current set, and still reported as injected.
const settings12 = { providers: { gw: { models: [{ id: 'm', reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } }] } } }
const p12 = buildPlan(settings12, {})
const upgradeOp12 = p12.ops.find((o) => o.path.join('.') === 'providers.gw.models')
eq(upgradeOp12 !== undefined, true, 'legacy set produces one upgrade op')
eq(upgradeOp12.value[0].reasoningEfforts, DEFAULT_EFFORTS, 'legacy set upgraded to off/low/high/max')
eq(p12.injected, ['gw\u0000m'], 'legacy upgraded model still reported injected')

// 13. MIGRATION recognises the legacy signature by key shape and rewrites all
// levels to the current set (identity wire values, `medium` dropped for `max`).
const settings13 = { providers: { gw: { models: [{ id: 'm', reasoningEfforts: { low: 'L', medium: 'medium', high: 'H' } }] } } }
const p13 = buildPlan(settings13, {})
eq(p13.ops[0].value[0].reasoningEfforts, DEFAULT_EFFORTS, 'legacy migration rewrites to current set')
eq(p13.injected, ['gw\u0000m'], 'legacy (custom wire) still reported injected')

// 14. A genuine minimal/high set is NOT mistaken for ours.
const settings14 = { providers: { gw: { models: [{ id: 'm', reasoningEfforts: { minimal: 'minimal', high: 'high' } }] } } }
const p14 = buildPlan(settings14, {})
eq(p14.ops, [], 'genuine minimal/high untouched')
eq(p14.injected, [], 'genuine minimal/high not reported')

// 15. Realistic fixture: the genuine curated sets seen in a real profile must
// never be touched, while the plugin's own legacy {low,medium,high} set on a
// relay provider is migrated. This mirrors cordis.patch.yml after a prior run.
const realistic = {
  providers: {
    chatanywhere: {
      models: [
        { id: 'gpt-5', reasoningEfforts: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' } },
        { id: 'gpt-5.2', reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' } },
        { id: 'gpt-4.1', reasoningEfforts: false },
      ],
    },
    applefree: {
      models: [
        { id: 'deepseek-v4.1-flash', reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
        { id: 'glm-5.2', reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
      ],
    },
  },
}
const p15 = buildPlan(realistic, {})
eq(p15.injected, ['applefree\u0000deepseek-v4.1-flash', 'applefree\u0000glm-5.2'], 'only relay legacy models reported injected')
const modelOp15 = p15.ops.find((o) => o.path.join('.') === 'providers.applefree.models')
eq(modelOp15 !== undefined, true, 'relay provider produces a models op')
eq(p15.ops.every((o) => o.path[1] === 'applefree'), true, 'no op touches the genuinely-declared provider')
const migrated = modelOp15.value
eq(migrated[0].reasoningEfforts, DEFAULT_EFFORTS, 'relay model migrated to off/low/high/max')
eq(realistic.providers.chatanywhere.models[0].reasoningEfforts, { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' }, 'genuine 4-key set untouched')
eq(realistic.providers.chatanywhere.models[1].reasoningEfforts, { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' }, 'genuine 5-key set untouched')

// 16. CRITICAL: the provider default effort must be declared, otherwise the
// official picker inserts an extra leading "Default" row (5 rows instead of 4).
const settings16 = { providers: { gw: { models: [{ id: 'm' }] } } }
const p16 = buildPlan(settings16, {})
const reasoningOp = p16.ops.find((o) => o.path.join('.') === 'providers.gw.reasoning')
eq(reasoningOp !== undefined, true, 'provider reasoning default is declared')
eq(reasoningOp.value, 'high', 'provider reasoning default matches official (high)')

// 17. An explicit provider default is preserved, never overwritten.
const settings17 = { providers: { gw: { reasoning: 'max', models: [{ id: 'm' }] } } }
const p17 = buildPlan(settings17, {})
eq(p17.ops.some((o) => o.path.join('.') === 'providers.gw.reasoning'), false, 'explicit provider reasoning untouched')

// 18. A provider whose models all carry genuine upstream declarations gets no ops.
const settings18 = { providers: { native: { models: [{ id: 'm', reasoningEfforts: { off: 'none', high: 'high', max: 'max' } }] } } }
const p18 = buildPlan(settings18, {})
eq(p18.ops, [], 'provider with genuine declarations gets no default op')

// 19. Configurable default + opt-out.
const settings19 = { providers: { gw: { models: [{ id: 'm' }] } } }
eq(buildPlan(settings19, { defaultEffort: 'low' }).ops.find((o) => o.path.join('.') === 'providers.gw.reasoning').value, 'low', 'defaultEffort config honoured')
eq(buildPlan(settings19, { defaultEffort: 'bogus' }).ops.find((o) => o.path.join('.') === 'providers.gw.reasoning').value, 'high', 'invalid defaultEffort falls back to high')
eq(buildPlan(settings19, { syncDefaultEffort: false }).ops.some((o) => o.path.join('.') === 'providers.gw.reasoning'), false, 'syncDefaultEffort:false opts out')

console.log(process.exitCode ? '\nSOME HOST TESTS FAILED' : '\nALL HOST TESTS PASSED')
