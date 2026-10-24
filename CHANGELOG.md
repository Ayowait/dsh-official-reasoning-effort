# Changelog

## 0.3.1 — 2026-10-24

- **修复「变成五档」**：只补 `reasoningEfforts` 时，官方选择器还会额外插入一行
  「Default」。官方组件把档位列表拼成
  `[...(reasoning.defaultEffort === undefined ? [{ label: 'Default' }] : []), ...efforts]`，
  而 `defaultEffort` 由 `llm-pi-ai` 从 **Provider 级** 的 `reasoning` 字段推导
  （`reasoningInfo(model, profile.reasoning)`）。Provider 未写 `reasoning` 时
  `defaultEffort` 为空，于是「Default」+ 四档 = **五档**。
  现在插件在给某个 Provider 补齐档位的同时，为该 Provider 写入 `reasoning: high`
  （与官方 `dsh-llm-deepseek` 的默认值一致：High 是「大多数任务的最佳平衡」），
  菜单即与官方完全一致为 **Off / Low / High / Max 四档**。
  已显式配置的 `reasoning` 不会被覆盖；无需补齐的 Provider 不会被动到。
- 可用 `defaultEffort` 自定义默认档，或用 `syncDefaultEffort: false` 关闭该行为。
- README 配图全部更换为本次实际运行截图。

## 0.3.0 — 2026-10-24

- **档位改为与官方一致：Off / Low / High / Max**（此前是 Low / Medium / High）。
  官方选择器的档位名称是对档位 id 首字母大写得到的（`llm-pi-ai` 的
  `reasoningInfo`：`${level[0].toUpperCase()}${level.slice(1)}`），因此只需注入
  `off / low / high / max` 四个 id，官方组件即原样显示 Off / Low / High / Max，
  界面不做任何改动。
- 迁移：可识别并升级本插件旧版本（0.2.x）写入的 `{low, medium, high}` 档位集合，
  自动改写为新档位；真实上游已声明的档位（`off/minimal/xhigh/max`、`false` 等）一律不碰。
- 提示小字文案保持不变，仍通过 CSS `::after` 注入在官方面板底部。

## 0.2.0 — 2026-10-23

- **改用官方原版组件**：不再自绘面板。服务端为缺少 `reasoningEfforts` 的模型补齐
  `low / medium / high`，官方自带的模型选择器随即自己显示「推理等级」行与下钻档位。
- 提示小字改为在官方展开面板底部用 CSS `::after` 注入，不修改官方 DOM/组件。
- 修复：服务端半移除 `@deepseek-ai/schemastery` 依赖（profile 插件安装目录无法解析该
  bare specifier，会导致 host bundle 加载失败、应用崩溃）。
- 修复：读取 `llm-pi-ai` 配置改用 `settings.describe()`（该服务没有 `get()`）。
- 修复：提示行匹配改用 **Provider + 模型** 组合，避免不同 Provider 下同名模型被误判。
- 注入幂等：识别本插件上次写入的通用档位，重复启动不重复改写、提示持续显示。
- 浏览器端声明零依赖服务，确保 `apply` 一定被调用。

## 0.1.0 — 2026-10-23

- 首个版本。
