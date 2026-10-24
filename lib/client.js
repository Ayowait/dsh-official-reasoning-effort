window.__ModuleLoader__.load({
	id: "dsh-official-reasoning-effort",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// Browser half of dsh-official-reasoning-effort.
		//
		// Does NOT touch or replace the official model picker: the official
		// dsh-client-ui-model-selection composer renders the Model / Effort rows
		// and shows the Effort row whenever the model exposes `reasoning`. The
		// host half supplies generic off/low/high/max for models that declare
		// none, so the official Effort row appears by itself. Here we only add a
		// one-line hint at the bottom of the official menu when the current
		// model's levels were supplied generically, via a data attribute + ::after.

		const ROUTE = "/dsh-official-reasoning-effort/api/injected";
		const STYLE_ID = "dsh-official-reasoning-effort-hint";
		const ATTR = "data-thinking-unsupported";
		const MENU_LABELS = ["模型与推理等级", "Model and reasoning effort"];
		const HINT_ZH = "上游未声明思考强度，此处为通用档位，上游可能忽略或拒绝。";
		const HINT_EN = "Upstream does not declare reasoning effort; these are generic levels and may be ignored or rejected.";

		// This half is a pure side effect: it only needs the DOM and a same-origin
		// fetch() to the host route, so it declares NO required services. Fewer
		// hard dependencies means cordis always calls apply() and the hint can
		// never silently fail to mount because some unrelated service is absent.
		const inject = [];

		function injectStyles() {
			if (typeof document === "undefined") return () => {};
			if (document.getElementById(STYLE_ID) !== null) return () => {};
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.dataset.plugin = "dsh-official-reasoning-effort";
			style.textContent =
				"[role=\"menu\"][" + ATTR + "=\"true\"]::after{" +
				"content:\"" + HINT_ZH + "\";" +
				"display:block;padding:6px 10px 4px;" +
				"color:var(--dsw-alias-label-tertiary,#8a919d);" +
				"font-size:11px;line-height:15px;white-space:normal;}" +
				":root[lang^=\"en\"] [role=\"menu\"][" + ATTR + "=\"true\"]::after{content:\"" + HINT_EN + "\"}";
			document.head.appendChild(style);
			return () => { style.remove() };
		}

		function findRootMenu() {
			if (typeof document === "undefined") return null;
			for (const label of MENU_LABELS) {
				const el = document.querySelector("[role=\"menu\"][aria-label=\"" + label + "\"]");
				if (el !== null) return el;
			}
			return null;
		}

		// The official root menu's first cell (the Model row) holds a label span
		// carrying `data-provider-id` / `data-model-id` (see ModelSelect's
		// renderModelLabel). Different providers can expose the *same* model id
		// (e.g. an applefree relay model and the official account model both
		// called "deepseek-v4.1-flash-1017"), so the match MUST be on the
		// provider+model pair — matching the id alone would wrongly flag a
		// genuinely reasoning-capable model. Text is only a last-resort fallback.
		function currentMenuModel(menu) {
			const cells = menu.querySelectorAll("[role=\"menuitem\"]");
			if (cells.length === 0) return { provider: null, id: null, name: null };
			const first = cells[0];
			const labelled = first.querySelector("[data-model-id]");
			const readAttr = (el, attr) => {
				if (el === null) return null;
				const value = (el.getAttribute(attr) || "").trim();
				return value.length > 0 ? value : null;
			};
			const id = readAttr(labelled, "data-model-id");
			const provider = readAttr(labelled, "data-provider-id");
			const spans = first.querySelectorAll("span");
			let name = null;
			// The value span is the last non-empty span in the cell (label, value, chevron-svg).
			for (let i = spans.length - 1; i >= 0; i--) {
				const text = (spans[i].textContent || "").trim();
				if (text.length > 0) { name = text; break }
			}
			if (name === null) name = (first.textContent || "").trim();
			return { provider, id, name };
		}

		function apply(ctx) {
			ctx.effect(() => injectStyles(), "dsh-official-reasoning-effort: hint styles");

			let names = new Set();
			let pairs = new Set();
			let lastFetch = 0;
			let pendingFetch = null;
			const refreshInjected = () => {
				const now = Date.now();
				if (now - lastFetch < 500) return pendingFetch;
				lastFetch = now;
				pendingFetch = fetch(ROUTE, { headers: { accept: "application/json", "x-dsh-official-reasoning-effort": "client" } }).then((r) => r.ok ? r.json() : void 0).then((body) => {
					if (body === void 0) return;
					if (Array.isArray(body.names)) names = new Set(body.names.map((n) => String(n).trim()));
					// `injected` entries are `${provider}\u0000${model}` — the authoritative
					// pair, so the same model id under a different provider is not flagged.
					if (Array.isArray(body.injected)) pairs = new Set(body.injected.map((k) => String(k)));
				}).catch(() => {});
				return pendingFetch;
			};

			const syncMenu = () => {
				const menu = findRootMenu();
				if (menu === null) return;
				const model = currentMenuModel(menu);
				let matched = false;
				if (model.provider !== null && model.id !== null) matched = pairs.has(model.provider + "\u0000" + model.id);
				// Fallback only when the DOM exposes no ids at all (older harness).
				if (!matched && model.provider === null && model.id === null && model.name !== null) matched = names.has(model.name);
				if (matched) menu.setAttribute(ATTR, "true");
				else menu.removeAttribute(ATTR);
			};

			const refreshThenSync = () => {
				const menu = findRootMenu();
				if (menu === null) return;
				const p = refreshInjected();
				syncMenu(); // apply immediately with the current set
				if (p && typeof p.then === "function") p.then(() => syncMenu()).catch(() => {});
			};

			ctx.effect(() => {
				refreshInjected();
				if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
				const observer = new MutationObserver(() => {
					if (findRootMenu() !== null) refreshThenSync();
				});
				observer.observe(document.body, { childList: true, subtree: true });
				return () => { observer.disconnect() };
			}, "dsh-official-reasoning-effort: menu observer");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
