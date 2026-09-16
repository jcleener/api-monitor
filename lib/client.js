/**
 * api-monitor — client half (resident browser plugin).
 *
 * Rendered as a `sidebar.footer.action` entry (full-width vertical summary
 * above the Cordis panel button) that opens a Cordis-style floating window.
 * All data comes from the host via same-origin /api-monitor/* routes.
 */
window.__ModuleLoader__.load({
	id: "api-monitor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles
		const css = [
			".am-vblock{display:flex;flex-direction:column;gap:2px;width:100%;padding:5px 10px;border-radius:9px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);cursor:pointer}",
			".am-vblock:hover{background:var(--dsw-alias-interactive-bg-hover,#333)}",
			".am-vhead{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary,#eee);margin-bottom:1px}",
			".am-vrow{display:flex;align-items:center;gap:6px;font-size:11px;line-height:1.7;color:var(--dsw-alias-label-secondary,#bbb)}",
			".am-vlbl{color:var(--dsw-alias-label-tertiary,#999);flex:none}",
			".am-vval{margin-left:auto;color:var(--dsw-alias-label-primary,#eee);font-variant-numeric:tabular-nums}",
			".am-dot{width:7px;height:7px;border-radius:50%;flex:none}",
			".am-dot-green{background:var(--dsw-alias-state-success-primary,#34c759)}.am-dot-yellow{background:var(--dsw-alias-state-warn-label,#ffcc00)}.am-dot-red{background:var(--dsw-alias-state-error-primary,#ff3b30)}.am-dot-dim{background:var(--dsw-alias-label-caption)}",
			".am-iconbtn{display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#bbb);font-size:15px;cursor:pointer;flex:none}",
			".am-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover,#333);color:var(--dsw-alias-label-primary,#eee)}",
			".hHd-Xa_root:not(.hHd-Xa_collapsed) .hHd-Xa_footerActions{flex-direction:column;align-items:stretch}",
			".am-backdrop{position:fixed;inset:0;z-index:20;background:var(--dsw-alias-bg-mask-1)}",
			".am-panel{position:fixed;left:12px;bottom:108px;z-index:21;width:420px;max-width:calc(100vw - 24px);background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:var(--dsw-shadow-lv3,0 14px 44px rgba(0,0,0,.5));display:flex;flex-direction:column;max-height:60vh;overflow:hidden}",
			".am-panelhead{box-sizing:border-box;flex:none;display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:44px;padding:10px 12px}",
			".am-panelhead .t{font-size:14px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary,#eee)}",
			".am-panelhead .x{width:28px;height:28px;color:var(--dsw-alias-label-tertiary,#999);cursor:pointer;border:none;background:transparent;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:1}",
			".am-panelhead .x:hover{background:var(--dsw-alias-interactive-bg-hover,#333);color:var(--dsw-alias-label-primary,#eee)}",
			".am-panelbody{flex:1;min-height:0;padding:0 12px 12px;overflow-y:auto}",
			".am-title{font-weight:600;font-size:12px;color:var(--dsw-alias-label-primary,#eee);margin-bottom:2px}",
			".am-block{border-top:1px solid var(--dsw-alias-border-l2,#2a2a2a);margin-top:6px;padding-top:6px}",
			".am-block:first-child{border-top:none;margin-top:0;padding-top:0}",
			".am-block-off{opacity:.5}",
			".am-block-off:hover{opacity:.85}",
			".am-block-off .am-title{margin-bottom:0}",
			".am-row{display:flex;justify-content:space-between;gap:8px;line-height:1.6}",
			".am-row .k{color:var(--dsw-alias-label-tertiary,#999)}.am-row .v{color:var(--dsw-alias-label-primary,#eee);font-variant-numeric:tabular-nums}",
			".am-err{color:var(--dsw-alias-state-warn-label,#ff9f0a);font-size:11px;margin-top:2px}",
			".am-stale{opacity:.55}",
			".am-stale-note{color:var(--dsw-alias-label-tertiary,#999);font-size:10px;margin-top:2px}",
			".am-actions{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}",
			".am-btn{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary,#eee);border-radius:7px;padding:4px 10px;font-size:12px;cursor:pointer}",
			".am-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#333)}",
			".am-btn.primary{background:var(--dsw-alias-state-business-primary,#0a84ff);border-color:var(--dsw-alias-state-business-primary,#0a84ff);color:var(--dsw-alias-label-primary-inverted)}",
			".am-select{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:3px 6px;font-size:12px}",
			".am-input{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;padding:4px 6px;font-size:12px;width:150px}",
			".am-chkrow{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-tertiary,#aaa);cursor:pointer}",
			".am-cfgform{display:flex;flex-direction:column;gap:6px;margin-top:8px}",
			".am-foot{display:flex;justify-content:space-between;align-items:center;margin-top:8px}",
			".am-ts{color:var(--dsw-alias-label-caption);font-size:10px}"
		].join("");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"api-monitor/styles.css\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "api-monitor";
			tag.dataset.pluginCss = "api-monitor/styles.css";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		// ---- tiny host RPC over same-origin HTTP ----
		function hostGet(path, args) {
			const qs = args ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null))).toString() : "";
			return fetch(path + qs, { cache: "no-store" }).then((r) => r.json());
		}
		function hostPost(path, body) {
			return fetch(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body || {}),
			}).then((r) => r.json());
		}

		const fmtN = (u) => ({ tin: (u && u.uncachedInput) || 0, cout: (u && u.cacheRead) || 0, tout: (u && u.output) || 0, calls: (u && u.calls) || 0 });
		// 峰谷拆分后同一屏会并排出现 4 位数到 8 位数：旧的 1e7 / 1e5 两档会把 41703 原样吐出、
		// 把 8203648 写成「8204k」，于是「输入 118k」旁边跟着「输入 41703」。每档保留一位小数。
		function fmtTokens(n) {
			const v = Math.max(0, Number(n) || 0);
			if (v >= 1e6) { const m = v / 1e6; return (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + "m"; }
			if (v >= 1e3) {
				const k = v / 1e3;
				const r = k >= 10 ? Math.round(k) : Math.round(k * 10) / 10;
				return (r >= 1000 ? "1m" : r + "k"); // 999_6xx 这类四舍五入到 1000k 的进位
			}
			return String(Math.round(v));
		}
		const tokenRow = (u) => { const t = fmtN(u); return "输入 " + fmtTokens(t.tin) + " · 缓存读 " + fmtTokens(t.cout) + " · 输出 " + fmtTokens(t.tout); };
		const pctStr = (v) => (v === null || v === undefined ? "—" : Math.round(v) + "%");
		const fmtTs = (t) => (t ? new Date(t).toLocaleTimeString() : "");
		const numv = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
		// 花费（host 已按 CNY 返回）。actual = 按每次调用各自时刻归因后的真实花费；
		// peak / offPeak 分别是高峰时段与空闲时段那部分的用量所对应的花费，两者之和即 actual。
		const money = (v) => "¥" + Math.max(0, Number(v) || 0).toFixed(2);
		const fmtCost = (c) => (!c || !Number.isFinite(c.actual) ? "—" : money(c.actual));

		function ApiMonitor(props) {
			const useSessionsHook = props.useSessions;
			const currentId = (useSessionsHook ? useSessionsHook((s) => s && s.current) : null) || null;
			const wide = props.wide !== false;
			const [snap, setSnap] = react.useState(null);
			const [open, setOpen] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [keyForm, setKeyForm] = react.useState(null);
			const [ak, setAk] = react.useState("");
			const [sk, setSk] = react.useState("");
			const [loadKey, setLoadKey] = react.useState(0);

			react.useEffect(() => {
				let disposed = false;
				const load = () => { hostGet("/api-monitor/snapshot", { root: currentId }).then((v) => { if (!disposed && v) setSnap(v); }).catch(() => {}); };
				load();
				const clean = setInterval(load, 8000);
				return () => { disposed = true; clearInterval(clean); };
			}, [currentId, loadKey]);

			const refreshNow = () => {
				setBusy(true);
				hostPost("/api-monitor/refresh", {}).then(() => hostGet("/api-monitor/snapshot", { root: currentId }).then(setSnap).catch(() => {})).catch(() => {}).finally(() => setBusy(false));
			};
			const saveTier = (tier) => { hostPost("/api-monitor/set-tier", { volcesTier: tier }).then(() => setLoadKey((x) => x + 1)).catch(() => {}); };
			const setVisibility = (block, value) => {
				const nextVis = Object.assign({}, vis, { [block]: value });
				hostPost("/api-monitor/set-visibility", { entryVisibility: nextVis }).then(() => setLoadKey((x) => x + 1)).catch(() => {});
			};
			const saveKeys = () => {
				if (!ak || !sk) return;
				setBusy(true);
				hostPost("/api-monitor/set-volces-keys", { volcesAccessKeyId: ak, volcesSecretAccessKey: sk }).then(() => { setKeyForm(null); setAk(""); setSk(""); setLoadKey((x) => x + 1); }).catch(() => {}).finally(() => setBusy(false));
			};

			const vis = (snap && snap.config && snap.config.entryVisibility) || {};
			const cfgDefaults = { warnPercent: 70, dangerPercent: 90, balanceWarn: 10, showCacheHitRate: true, showResetTime: false, volcesTier: "auto" };
			const C = snap && snap.config ? snap.config : cfgDefaults;
			const p = (snap && snap.providers) || {};
			const balClass = (b) => (b === null || b === undefined ? "var(--dsw-alias-label-caption)" : (b < numv(C.balanceWarn, 10) ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-success-primary)"));
			const session = (snap && snap.session) || { total: {}, byProvider: {}, costs: {}, costTotal: { peak: 0, offPeak: 0 }, buckets: {} };
			const byp = session.byProvider || {};
			const sTot = session.total || {};
			const deepTok = byp.deepseek || {};
			const glmTok = byp.glm || {};
			const ocTok = byp.opencode || {};
			const vcTokFor = (kind) => (kind === "coding" ? byp.volces || {} : byp["volces-agent"] || {});

			const keyConfigBtn = (which) => react.createElement("button", { className: "am-btn", onClick: (e) => { e.stopPropagation(); setKeyForm(which); } }, "key配置");
			const blockTitle = (txt, onClickVis, shown) => react.createElement("div", { className: "am-row" },
				react.createElement("span", { className: "am-title" }, txt),
				react.createElement("label", { className: "am-chkrow" },
					react.createElement("input", { type: "checkbox", checked: shown !== false, onChange: (e) => onClickVis(e.target.checked) }),
					"显示在入口"));
			// 勾掉「显示在入口」后，面板里该套餐只保留标题行（标题 + 勾选框），其余行不渲染。
			const panelBlock = (blockKey, title, rows) => {
				const shown = vis[blockKey] !== false;
				return react.createElement("div", { className: "am-block" + (shown ? "" : " am-block-off"), key: blockKey },
					blockTitle(title, (v) => setVisibility(blockKey, v), shown),
					...(shown ? rows : []));
			};
			const cacheHit = (t) => { const denom = (t.uncachedInput || 0) + (t.cacheRead || 0); if (!denom) return 0; return Math.round(((t.cacheRead || 0) / denom) * 100); };

			const dot = (cls) => react.createElement("span", { className: "am-dot " + cls });
			const balDot = (e) => (e && e.balance !== undefined ? (e.balance < numv(C.balanceWarn, 10) ? "am-dot-red" : "am-dot-green") : "am-dot-dim");
			const pctDot = (vals) => {
				const vs = (vals || []).filter((v) => v !== null && v !== undefined);
				if (!vs.length) return "am-dot-dim";
				// 展示的是剩余%；0% = 用尽。最低的剩余窗口决定状态。
				const worst = Math.min.apply(null, vs);
				if (worst <= 100 - numv(C.dangerPercent, 90)) return "am-dot-red";   // 剩余 ≤10% → 用尽边缘
				if (worst <= 100 - numv(C.warnPercent, 70)) return "am-dot-yellow";  // 剩余 ≤30% → 预警
				return "am-dot-green";
			};
			const vrows = [];
			if (vis.deepseek !== false) {
				const b = p.deepseek && p.deepseek.balance;
				vrows.push(react.createElement("div", { className: "am-vrow", key: "ds" }, dot(balDot(p.deepseek)), react.createElement("span", { className: "am-vlbl" }, "DeepSeek"), react.createElement("span", { className: "am-vval" + (p.deepseek && p.deepseek.stale ? " am-stale" : "") }, b !== undefined ? "¥" + b.toFixed(2) : (p.deepseek && p.deepseek.error ? "—" : "…"))));
			}
			if (vis.glm !== false) {
				const gm = p.glm || {};
				vrows.push(react.createElement("div", { className: "am-vrow", key: "glm" }, dot(pctDot([gm.five, gm.weekly, gm.monthly])), react.createElement("span", { className: "am-vlbl" }, "GLM Plan"), react.createElement("span", { className: "am-vval" + (gm.stale ? " am-stale" : "") }, (gm.five !== null || gm.weekly !== null || gm.monthly !== null) ? (pctStr(gm.five) + "|" + pctStr(gm.weekly)) : (gm.error ? "—" : "…"))));
			}
			if (vis.opencodeGo !== false) {
				const oc = p.opencode || {};
				vrows.push(react.createElement("div", { className: "am-vrow", key: "oc" }, dot(pctDot([oc.rolling, oc.weekly, oc.monthly])), react.createElement("span", { className: "am-vlbl" }, "OpenCode Go"), react.createElement("span", { className: "am-vval" + (oc.stale ? " am-stale" : "") }, (oc.rolling !== null || oc.weekly !== null || oc.monthly !== null) ? (pctStr(oc.rolling) + "|" + pctStr(oc.weekly) + "|" + pctStr(oc.monthly)) : (oc.error ? "—" : "…"))));
			}
			if (vis.qwen !== false) {
				const qw = byp.qwen || {};
				vrows.push(react.createElement("div", { className: "am-vrow", key: "qwen" }, dot(qw.calls ? "am-dot-green" : "am-dot-dim"), react.createElement("span", { className: "am-vlbl" }, "Qwen Plan"), react.createElement("span", { className: "am-vval" }, (qw.calls || 0) + " 次")));
			}
			if (vis.volcesCoding !== false) {
				const vc = p.volcesCoding || {};
				vrows.push(react.createElement("div", { className: "am-vrow", key: "vc" }, dot(pctDot([vc.five, vc.weekly, vc.monthly])), react.createElement("span", { className: "am-vlbl" }, "火山 Coding"), react.createElement("span", { className: "am-vval" + (vc.stale ? " am-stale" : "") }, (vc.five !== null || vc.weekly !== null || vc.monthly !== null) ? (pctStr(vc.five) + "|" + pctStr(vc.weekly) + "|" + pctStr(vc.monthly)) : (vc.error ? "—" : "…"))));
			}
			if (vis.volcesAgent !== false) {
				const va = p.volcesAgent || {};
				vrows.push(react.createElement("div", { className: "am-vrow", key: "va" }, dot(pctDot([va.five, va.weekly, va.monthly])), react.createElement("span", { className: "am-vlbl" }, "火山 Agent"), react.createElement("span", { className: "am-vval" + (va.stale ? " am-stale" : "") }, (va.five !== null || va.weekly !== null || va.monthly !== null) ? (pctStr(va.five) + "|" + pctStr(va.weekly) + "|" + pctStr(va.monthly)) : (va.error ? "—" : "…"))));
			}

			const entry = wide
				? react.createElement("button", { className: "am-vblock", onClick: (e) => { e.stopPropagation(); setOpen(!open); }, title: "API 用量监控（点击查看套餐/用量）" },
					react.createElement("div", { className: "am-vhead" }, react.createElement("span", {}, "⛽"), react.createElement("span", {}, "API 用量")),
					vrows)
				: react.createElement("button", { className: "am-iconbtn", onClick: (e) => { e.stopPropagation(); setOpen(!open); }, title: "API 用量监控" }, "⛽");

			if (!open) return entry;

			const maybeKeyForm = () => {
				if (keyForm === null) return null;
				return react.createElement("div", { className: "am-cfgform" },
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "AccessKey ID"), react.createElement("input", { className: "am-input", value: ak, onChange: (e) => setAk(e.target.value), placeholder: "AK" })),
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "SecretKey"), react.createElement("input", { className: "am-input", type: "password", value: sk, onChange: (e) => setSk(e.target.value), placeholder: "SK" })),
					react.createElement("div", { className: "am-actions" },
						react.createElement("button", { className: "am-btn primary", onClick: saveKeys }, "保存"),
						react.createElement("button", { className: "am-btn", onClick: () => setKeyForm(null) }, "取消")));
			};

			const volcesBlock = (kind, titleD, dataEntry, tierOpts) => {
				const vcTok = vcTokFor(kind);
				const rows = [];
				rows.push(react.createElement("div", { className: "am-row", key: "u1" }, react.createElement("span", { className: "k" }, "用量剩余"), react.createElement("span", { className: "v" }, "5小时 " + pctStr(dataEntry.five) + " / 1周 " + pctStr(dataEntry.weekly) + " / 1月 " + pctStr(dataEntry.monthly))));
				rows.push(react.createElement("div", { className: "am-row", key: "u2" }, react.createElement("span", { className: "k" }, "本次会话次数"), react.createElement("span", { className: "v" }, String(vcTok.calls || 0))));
				rows.push(react.createElement("div", { className: "am-row", key: "u3" }, react.createElement("span", { className: "k" }, "本次会话token"), react.createElement("span", { className: "v" }, tokenRow(vcTok))));
				rows.push(react.createElement("div", { className: "am-actions", key: "act" },
					react.createElement("select", { className: "am-select", value: C.volcesTier || "auto", onChange: (e) => saveTier(e.target.value) },
						tierOpts.map((o) => react.createElement("option", { value: o, key: o }, o === "auto" ? "自动" : o))),
					keyConfigBtn(kind),
					react.createElement("button", { className: "am-btn", onClick: refreshNow, disabled: busy }, "读取套餐")));
				if (dataEntry.stale) rows.push(react.createElement("div", { className: "am-stale-note", key: "st" }, "↑ 显示上次数据（" + fmtTs(dataEntry.lastGoodTs) + " 获取）"));
				if (!dataEntry.keyConfigured) rows.push(react.createElement("div", { className: "am-err", key: "ke" }, "未配置 AK/SK（Coding 与 Agent 共用）"));
				if (dataEntry.error) rows.push(react.createElement("div", { className: "am-err", key: "er" }, dataEntry.error));
				else if (dataEntry.unsubscribed) rows.push(react.createElement("div", { className: "am-err", key: "un" }, "未订阅"));
				return panelBlock(kind === "coding" ? "volcesCoding" : "volcesAgent", titleD, rows);
			};

			// DeepSeek 峰谷拆分：host 按每次调用各自的时刻归因，这里把高峰/空闲两段分别列出。
			// 价目表本身不区分峰谷（tiered=false）时不展示，免得出现两行同一个数。
			const dsCost = session.costs && session.costs.deepseek;
			const splitRow = (key, label, tok, amount) => react.createElement("div", { className: "am-row", key },
				react.createElement("span", { className: "k" }, label),
				react.createElement("span", { className: "v" }, tokenRow(tok) + " · " + money(amount)));
			const dsSplitRows = dsCost && dsCost.tiered
				? [splitRow("pk", "高峰时段", deepTok.peak, dsCost.peak), splitRow("op", "空闲时段", deepTok.offPeak, dsCost.offPeak)]
				: [];

			const body = react.createElement("div", { className: "am-panelbody" },
				panelBlock("deepseek", "DeepSeek", [
					react.createElement("div", { className: "am-row", key: "bal" }, react.createElement("span", { className: "k" }, "余额 (CNY)"), react.createElement("span", { className: "v", style: { color: balClass(p.deepseek && p.deepseek.balance) } }, (p.deepseek && p.deepseek.balance !== undefined) ? ("¥" + p.deepseek.balance.toFixed(2)) : "—")),
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "本次会话token"), react.createElement("span", { className: "v" }, tokenRow(deepTok))),
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "会话花费预估"), react.createElement("span", { className: "v" }, fmtCost(session.costs && session.costs.deepseek))),
					dsSplitRows,
					p.deepseek && p.deepseek.stale ? react.createElement("div", { className: "am-stale-note" }, "↑ 显示上次数据（" + fmtTs(p.deepseek.lastGoodTs) + " 获取）") : null,
					p.deepseek && p.deepseek.error ? react.createElement("div", { className: "am-err" }, p.deepseek.error) : null,
				]),
				panelBlock("glm", "GLM Coding Plan", [
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "套餐档位"), react.createElement("span", { className: "v" }, (p.glm && p.glm.level) || "—")),
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "用量剩余"), react.createElement("span", { className: "v" }, "5小时 " + pctStr(p.glm && p.glm.five) + " / 1周 " + pctStr(p.glm && p.glm.weekly) + " / 1月 " + pctStr(p.glm && p.glm.monthly))),
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "本次会话token"), react.createElement("span", { className: "v" }, tokenRow(glmTok))),
					p.glm && p.glm.stale ? react.createElement("div", { className: "am-stale-note" }, "↑ 显示上次数据（" + fmtTs(p.glm.lastGoodTs) + " 获取）") : null,
					p.glm && p.glm.error ? react.createElement("div", { className: "am-err" }, p.glm.error) : null,
				]),
				panelBlock("opencodeGo", "OpenCode Go", [
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "用量剩余"), react.createElement("span", { className: "v" }, "5小时 " + pctStr(p.opencode && p.opencode.rolling) + " / 1周 " + pctStr(p.opencode && p.opencode.weekly) + " / 1月 " + pctStr(p.opencode && p.opencode.monthly))),
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "本次会话token"), react.createElement("span", { className: "v" }, tokenRow(ocTok))),
					p.opencode && p.opencode.stale ? react.createElement("div", { className: "am-stale-note" }, "↑ 显示上次数据（" + fmtTs(p.opencode.lastGoodTs) + " 获取）") : null,
					p.opencode && p.opencode.error ? react.createElement("div", { className: "am-err" }, p.opencode.error) : null,
				]),
				panelBlock("qwen", "Qwen Token Plan", [
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "本次会话token"), react.createElement("span", { className: "v" }, tokenRow(byp.qwen || {}))),
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "本次会话次数"), react.createElement("span", { className: "v" }, String((byp.qwen || {}).calls || 0))),
					C.showCacheHitRate ? react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "缓存命中率"), react.createElement("span", { className: "v" }, cacheHit(byp.qwen || {}) + "%")) : null,
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "额度 (Credits)"), react.createElement("span", { className: "v" }, "接口不可查")),
					react.createElement("div", { className: "am-actions" },
						react.createElement("button", { className: "am-btn", onClick: (e) => { e.stopPropagation(); window.open("https://bailian.console.aliyun.com/cn-beijing/subscription/token-plan/personal", "_blank", "noopener"); } }, "查看额度")),
				]),
				volcesBlock("coding", "火山 Coding Plan", p.volcesCoding || {}, ["auto", "lite", "pro"]),
				volcesBlock("agent", "火山 Agent Plan", p.volcesAgent || {}, ["auto", "small", "medium", "large", "max", "pro"]),
				maybeKeyForm(),
				react.createElement("div", { className: "am-block" },
					react.createElement("div", { className: "am-title" }, "本次会话总览"),
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "token用量"), react.createElement("span", { className: "v" }, tokenRow(sTot))),
					react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "调用次数"), react.createElement("span", { className: "v" }, String(sTot.calls || 0))),
					C.showCacheHitRate ? react.createElement("div", { className: "am-row" }, react.createElement("span", { className: "k" }, "缓存命中率"), react.createElement("span", { className: "v" }, cacheHit(sTot) + "%")) : null),
				react.createElement("div", { className: "am-foot" },
					react.createElement("span", { className: "am-ts" }, "每 60s 自动刷新 · " + new Date((snap && snap.ts) || Date.now()).toLocaleTimeString()),
					react.createElement("button", { className: "am-btn", onClick: refreshNow, disabled: busy }, "读取套餐")));

			const panel = react.createElement("div", { className: "am-panel", tabIndex: 0, onKeyDown: (e) => { if (e.key === "Escape") setOpen(false); } },
				react.createElement("div", { className: "am-panelhead" },
					react.createElement("span", { className: "t" }, "API 用量监控"),
					react.createElement("button", { className: "x", onClick: (e) => { e.stopPropagation(); setOpen(false); }, "aria-label": "关闭" }, "✕")),
				body);

			return react.createElement(react.Fragment, null,
				entry,
				react.createElement("div", { className: "am-backdrop", onMouseDown: (e) => { e.stopPropagation(); setOpen(false); } }),
				panel);
		}

		const inject = ["slots"];
		function apply(ctx) {
			ctx.inject(["slots"], (scope) => {
				scope.slots.inject("sidebar.footer.action", () => scope.slots.register(
					{ name: "sidebar.footer.action", id: "api-monitor", order: -20, label: () => "API 用量" },
					(props) => react.createElement(ApiMonitor, props),
				));
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});