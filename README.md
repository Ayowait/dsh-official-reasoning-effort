# dsh-official-reasoning-effort

[![GitHub](https://img.shields.io/badge/GitHub-Ayowait%2Fdsh--official--reasoning--effort-181717?logo=github)](https://github.com/Ayowait/dsh-official-reasoning-effort)
[![License](https://img.shields.io/badge/license-MIT-79e5bd.svg)](LICENSE)

> Reasoning-effort control for gateway / custom providers — using the official
> composer UI, not a re-implementation of it.

![Expanded panel](assets/popover-root.png)

## What it solves

Many gateway APIs (e.g. `deepseek-v4.1-flash` on a relay) expose no `reasoning
effort` knob of their own, yet the request still succeeds upstream. The official
composer only renders the **Effort** row when the model declares reasoning
levels — so gateways without a declaration show no such option at all.

## How it works (official components only)

This plugin does **not** draw its own UI. It has two small halves:

1. **Host half (data fill)**: every model in `llm-pi-ai` that lacks
   `reasoningEfforts` gets `off / low / high / max` added — additively; an existing
   declaration (including `false`) is never overwritten. Once the model carries
   the field, `llm-pi-ai` reports `reasoning: true` with the level list, and the
   **official** `ModelSelect` composer renders its own 模型 / 推理等级 rows with
   the drill-down level picker by itself. Nothing is re-implemented.
2. **Browser half (one hint line)**: the model picker panel is found by its
   official `aria-label`, and when the currently selected provider+model is one
   whose levels were supplied generically, a CSS `::after` pseudo-element adds a
   single small line at the bottom of the official panel:

   > 上游未声明思考强度，此处为通用档位，上游可能忽略或拒绝。
   >
   > Upstream does not declare reasoning effort; these are generic levels and may be ignored or rejected.

   It is hidden for models whose levels are genuinely declared upstream. The
   match is on the **provider + model pair** (`data-provider-id` /
   `data-model-id`), so the same model id served by a different, reasoning-capable
   provider is never flagged.

![Reasoning levels (official drill-down: exactly Off / Low / High / Max)](assets/effort-levels-off-low-high-max.png)

## Levels

- Default four, identical to the official control: `Off` / `Low` / `High` / `Max`.
  These are the ids `off / low / high / max`; `llm-pi-ai` renders each level's
  label by capitalising its id, so the official picker shows exactly
  Off / Low / High / Max with no UI changes.

### Why `reasoning: high` is written too

Declaring `reasoningEfforts` alone yields **five** rows (an extra `Default`).
The official picker builds its list as:

```js
[...(reasoning.defaultEffort === undefined
     ? [{ effort: undefined, label: t('effort.providerDefault') }]  // ← the extra Default
     : []),
 ...reasoning.efforts.map((effort) => ({ ... }))]
```

`defaultEffort` is derived by `llm-pi-ai` from the **provider profile's**
`reasoning` field (`reasoningInfo(model, profile.reasoning)`). A provider that
declares no `reasoning` has no `defaultEffort`, hence `Default` + four levels =
five rows. The official `dsh-llm-deepseek` adapter always sets one (falling back
to `high`), which is why the built-in provider shows four rows.

The plugin therefore writes `reasoning: high` for any provider whose levels it
filled (High is the official "default balance for most tasks"). An explicitly
configured `reasoning` is never overwritten, and providers needing no fill are
left alone.

- A model that natively publishes more (or fewer) levels keeps its own list —
  the official picker renders whatever the model declares;
- On send the level maps to the wire value following the `pi-ai` adapter
  (defaulting to the level name; overridable in config).

## Install

```sh
dsh plugin --profile <your-profile> add github:Ayowait/dsh-official-reasoning-effort
```

`lib/` is prebuilt and committed, so installing from GitHub needs no local build.
No client bundling step is required either — the browser half is a plain
side-effect module.

## Configuration

Zero-config by default: it discovers every existing `llm-pi-ai` provider and
fills generic levels for models that declare none. Override only for special
gateways / exclusions / per-model handling:

```yaml
- insert:
    - id: dsh-official-reasoning-effort
      name: dsh-official-reasoning-effort
      config:
        efforts:
          high: reasoning_high
        providers:
          special-gateway:
            efforts:
              max: max_reasoning
            models:
              non-reasoning-model:
                disabled: true
          excluded-provider:
            disabled: true
```

### Fields

| Field | Meaning |
| --- | --- |
| `auto` | Auto-discover all providers (default `true`); when `false`, only providers listed under `providers`. |
| `efforts` | Override the wire-value map for all providers (default `off/low/high/max → same name`). |
| `defaultEffort` | Provider default effort written when filling levels (default `high`, the official default). |
| `syncDefaultEffort` | Set `false` to skip writing the provider default (the official menu then shows an extra `Default` row). |
| `providers.<id>.efforts` | Override wire values for one provider. |
| `providers.<id>.disabled` | Exclude a provider. |
| `providers.<id>.models.<model>.efforts` | Override wire values for one model. |
| `providers.<id>.models.<model>.disabled` | Mark a model as non-reasoning (`reasoningEfforts: false`). |

## Safe defaults

- Existing `reasoningEfforts` (including `false`) is **never** overwritten;
- Re-injection is idempotent: a value equal to the generic set this plugin would
  write is recognised as its own prior write (the hint keeps showing) while a
  genuine upstream declaration is left alone;
- Migration: the `{low, medium, high}` set written by earlier 0.2.x releases is
  recognised and upgraded once to `off / low / high / max`;
- Other fields are untouched; no provider credentials, requests, tools, or
  telemetry are added;
- The host half is dependency-free (no `@deepseek-ai/*` imports) — those
  specifiers are not resolvable from a profile plugin's install directory and
  importing them would take the whole host bundle down;
- The read-only route `GET /dsh-official-reasoning-effort/api/injected` reports the
  `provider\0model` keys that were filled, so the browser can decide whether to
  show the hint.

## Develop / test

```sh
npm test
```

## License

MIT
