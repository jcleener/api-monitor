/**
 * api-monitor — host half (static, resident in the dsh web process).
 *
 * Registers the `api-monitor` settings namespace, polls DeepSeek / GLM
 * (Coding Plan) / OpenCode Go / Volcengine (Coding + Agent Plan), aggregates the
 * current session tree token usage & cost, and serves everything to the
 * browser client over same-origin HTTP routes under `/api-monitor/*`.
 */
import z from '@deepseek-ai/schemastery';

export const name = 'api-monitor';

const SCHEMA = z.object({
	volcesAccessKeyId: z.string().default(''),
	volcesSecretAccessKey: z.string().role('secret').default(''),
	volcesTier: z.string().default('auto'),
	pollIntervalSeconds: z.number().default(60),
	warnPercent: z.number().default(70),
	dangerPercent: z.number().default(90),
	balanceWarn: z.number().default(10),
	priceTable: z.dict(z.any()).default({}),
	showCacheHitRate: z.boolean().default(true),
	showResetTime: z.boolean().default(false),
	// Command Code（provider id `command`，配置里的显示名是 command goat）月度额度上限（美元）。
	// 0 = 自动：按 windowLimits 的 5 小时/周 cap 反查套餐档位再取其月度额度。
	commandMonthlyCap: z.number().default(0),
	entryVisibility: z.object({
		deepseek: z.boolean().default(true),
		glm: z.boolean().default(true),
		opencodeGo: z.boolean().default(true),
		command: z.boolean().default(true),
		qwen: z.boolean().default(true),
		volcesCoding: z.boolean().default(true),
		volcesAgent: z.boolean().default(true),
	}),
});

// 单价表（CNY/1M tokens，2026-09-11 按官方定价页校准）：
// - 官方现用模型名就是 `deepseek-flash`（DeepSeek-V4.1-Flash）。成本归因键取自会话日志里的
//   source.model，实测即 `deepseek-flash`；旧表只登记了 `deepseek-v4-flash`，于是每次查表都落空、
//   退化成 `deepseek` 平价兜底——峰谷因此永远显示成一个数。
// - 2026-09-10 12:00 起 Flash 系列降价：空闲 输入 ¥1 / 缓存命中 ¥0.02 / 输出 ¥4，高峰为其 2 倍
//   （旧表 Flash 空闲价 ¥1.5/¥0.05/¥4.5，峰值 ¥3/¥0.1/¥9，已整体偏高）。
// - 峰谷时段：高峰为北京时间周一至周五 9:00-12:00、14:00-18:00，其余为空闲（空闲价为高峰一半）。
// - v4-pro 单价未变；但官方计划 2026-09-14 12:00 之后把该模型名路由到 V4.1 Flash 并按 Flash 计费。
// - 用户可在 settings 的 priceTable 覆盖；支持平铺 {in,cr,cw,out}（或旧键 pi/pcr/pcw/po）与 {peak,offPeak} 两种形态。
const DEFAULT_PRICES = {
	deepseek: { in: 1, cr: 0.02, cw: 0, out: 4 }, // 供应商兜底 = Flash 空闲价
	'deepseek-flash': {
		peak: { in: 2, cr: 0.04, cw: 0, out: 8 },
		offPeak: { in: 1, cr: 0.02, cw: 0, out: 4 },
	},
	// 旧模型名仍可调用、仍按 Flash 计费（官方定价页脚注 1），保留别名以免历史会话按兜底价计算
	'deepseek-v4-flash': {
		peak: { in: 2, cr: 0.04, cw: 0, out: 8 },
		offPeak: { in: 1, cr: 0.02, cw: 0, out: 4 },
	},
	'deepseek-v4-flash-vision-exp': {
		peak: { in: 2, cr: 0.04, cw: 0, out: 8 },
		offPeak: { in: 1, cr: 0.02, cw: 0, out: 4 },
	},
	'deepseek-v4-pro': {
		peak: { in: 9, cr: 0.3, cw: 0, out: 27 },
		offPeak: { in: 4.5, cr: 0.15, cw: 0, out: 13.5 },
	},
};

// ---- Command Code（command goat / GOAT 套餐）----
// 官方口径（https://commandcode.ai/docs/resources/pricing-limits）：订阅额度按「信用值」计，
// 除了按月重置的月度额度，另有 5 小时与 7 天两个滚动窗口，各按月度额度的固定比例封顶。
// `GET /alpha/billing/credits` 只回「还剩多少」和两个窗口的 `{used, cap}`，**不回月度上限**，
// 因此月度额度要靠 (5h cap, 周 cap) 这对数字反查套餐档位——下表即官方各档位的原始数字。
const COMMAND_PLANS = [
	{ name: 'Go', five: 2, weekly: 5, monthly: 10 },
	{ name: 'Team Pro', five: 12, weekly: 24, monthly: 40 },
	{ name: 'GOAT', five: 14, weekly: 35, monthly: 70 },
	{ name: 'Pro', five: 16, weekly: 40, monthly: 80 },
	{ name: 'Max 10x', five: 45, weekly: 90, monthly: 150 },
	{ name: 'Max 20x', five: 90, weekly: 180, monthly: 300 },
];
// 按 (5h cap, 周 cap) 精确匹配；周 cap 缺失时退化为只认 5h cap（各档位 5h cap 互不相同）。
function commandPlan(fiveCap, weeklyCap) {
	const f = num(fiveCap, NaN);
	if (!Number.isFinite(f) || f <= 0) return null;
	const w = num(weeklyCap, NaN);
	return COMMAND_PLANS.find((p) => p.five === f && (!Number.isFinite(w) || p.weekly === w))
		|| COMMAND_PLANS.find((p) => p.five === f)
		|| null;
}
/**
 * 把 `/alpha/billing/credits` 的响应折算成三个「剩余 %」（口径与 GLM 面板一致：展示剩余）。
 * 纯函数，便于直接用真实响应做回归。
 *
 * @param j - `/alpha/billing/credits` 的 JSON。
 * @param cfgCap - 配置项 `commandMonthlyCap`；>0 时压过档位反查。
 * @param spent - `/alpha/usage/summary` 的 `totalCost`；只有档位与配置都给不出上限时才需要。
 * @returns 三个剩余百分比（null = 该窗口取不到）、档位名、月度上限与剩余额度、两个窗口的重置时刻。
 */
function commandReadings(j, cfgCap, spent) {
	const credits = (j && j.credits) || {};
	const win = (j && j.windowLimits) || {};
	const monthlyRemaining = num(credits.monthlyCredits, NaN);
	const fiveHour = win.fiveHour || null;
	const weeklyWin = win.weekly || null;
	const windowLeft = (w) => {
		if (!w) return null;
		const cap = num(w.cap, NaN);
		if (!(cap > 0)) return null;
		return pctLeft((num(w.used, 0) / cap) * 100);
	};
	const plan = commandPlan(fiveHour && fiveHour.cap, weeklyWin && weeklyWin.cap);
	const monthlyCap = num(cfgCap, 0) > 0 ? num(cfgCap, 0) : (plan ? plan.monthly : 0);
	let monthly = null;
	if (monthlyCap > 0 && Number.isFinite(monthlyRemaining)) {
		monthly = pctLeft(((monthlyCap - monthlyRemaining) / monthlyCap) * 100);
	} else if (Number.isFinite(monthlyRemaining) && spent !== null && spent !== undefined) {
		// 档位认不出的兜底：本期花费与剩余额度一起还原总池。
		const remaining = monthlyRemaining + num(credits.purchasedCredits, 0) + num(credits.freeCredits, 0);
		const total = remaining + num(spent, 0);
		if (total > 0) monthly = pctLeft((num(spent, 0) / total) * 100);
	}
	const stamp = (w) => (w && Number.isFinite(num(w.resetAt, NaN)) ? num(w.resetAt, 0) : null);
	return {
		five: windowLeft(fiveHour),
		weekly: windowLeft(weeklyWin),
		monthly,
		plan: plan ? plan.name : null,
		monthlyCap: monthlyCap > 0 ? monthlyCap : null,
		monthlyCredits: Number.isFinite(monthlyRemaining) ? monthlyRemaining : null,
		fiveResetAt: stamp(fiveHour),
		weeklyResetAt: stamp(weeklyWin),
	};
}
/**
 * 把 {@link commandReadings} 的结果落到 state 条目上（stale-while-revalidate）。
 *
 * 只有本轮**真的取到至少一个窗口**时才写数值与档位元数据；三个窗口全空视为本轮失败，
 * 一个字段都不动，让 beginPoll 保留的上一轮读数继续显示（调用方据此写 `entry.error`）。
 * 这与 pollGlm / pollOpencode / pollVolcesCoding / pollVolcesAgent 的既有语义一致。
 *
 * @param entry - `state.command`（已由 beginPoll 从上一轮铺底）。
 * @param r - {@link commandReadings} 的返回值。
 * @returns 本轮是否落盘了有效读数。
 */
function applyCommandReadings(entry, r) {
	if (r.five === null && r.weekly === null && r.monthly === null) return false;
	entry.five = r.five;
	entry.weekly = r.weekly;
	entry.monthly = r.monthly;
	entry.plan = r.plan;
	entry.monthlyCap = r.monthlyCap;
	entry.monthlyCredits = r.monthlyCredits;
	entry.fiveResetAt = r.fiveResetAt;
	entry.weeklyResetAt = r.weeklyResetAt;
	entry.available = true;
	entry.stale = false;
	entry.lastGoodTs = Date.now();
	return true;
}

const num = (v, d) => {
	const n = typeof v === 'number' ? v : v == null ? d : Number(v);
	return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const pctLeft = (used) => {
	const n = num(used, NaN);
	return Number.isFinite(n) ? Math.max(0, Math.min(100, 100 - n)) : null;
};
const tryJson = (text) => {
	try { return JSON.parse(text); } catch { return null; }
};

// ---- stale-while-revalidate ----
// Every poll starts from the previous entry so last-good readings survive the
// in-flight window and failed rounds: the UI shows "上次数据" instead of
// placeholder dashes while the provider is slow or unreachable.
const hasData = (e) => !!(e && (e.balance !== undefined || e.five !== undefined || e.rolling !== undefined || e.weekly !== undefined || e.monthly !== undefined));
function beginPoll(prev) {
	return {
		...(prev && typeof prev === 'object' ? prev : {}),
		configured: false,
		ts: Date.now(),
		error: undefined,
		stale: hasData(prev),
	};
}

function classifyProvider(p) {
	const s = String(p || '').toLowerCase();
	if (s.includes('deepseek')) return 'deepseek';
	// Qwen Cloud Token Plan（provider id `qwen-token-plan-cn`，也兼容 dashscope/bailian 等别名）。
	// 注意顺序：它的 id 里含 "plan"，若落到 volces 分支会被错认成火山 Agent Plan。
	if (s.includes('qwen') || s.includes('token-plan') || s.includes('dashscope') || s.includes('bailian')) return 'qwen';
	if (s.includes('bigmodel') || s.includes('zhipu') || s.includes('glm') || s.includes('zai')) return 'glm';
	if (s.includes('opencode') || s.includes('vision')) return 'opencode';
	if (s.includes('volces') || s.includes('ark') || s.includes('doubao')) return s.includes('agent') || s.includes('plan') ? 'volces-agent' : 'volces';
	return s || 'unknown';
}

function priceEntry(model, provider, cls, priceTable) {
	const table = priceTable && typeof priceTable === 'object' ? priceTable : {};
	return table[model] || table[provider] || DEFAULT_PRICES[model] || DEFAULT_PRICES[cls];
}
// 归一化一条价格：平铺 {in,cr,cw,out}（兼容旧键 pi/pcr/pcw/po）或 {peak,offPeak}。
function normPrice(entry) {
	if (!entry || typeof entry !== 'object') return null;
	const flat = (p) => p && typeof p === 'object' ? {
		in: num(p.in, num(p.pi, 0)), cr: num(p.cr, num(p.pcr, 0)),
		cw: num(p.cw, num(p.pcw, 0)), out: num(p.out, num(p.po, 0)),
	} : null;
	if (entry.peak && entry.offPeak) return { peak: flat(entry.peak), offPeak: flat(entry.offPeak) };
	const f = flat(entry);
	return f === null ? null : { flat: f };
}
// 高峰时段判定：官方口径为「北京时间周一至周五 9:00-12:00、14:00-18:00」，其余为空闲。
// 会话日志的每个事件都带 `time`（epoch ms），所以峰谷可以按每次调用各自的时刻归因，
// 不必再拿一个价去套整段用量。缺 time 的样本按空闲计（空闲占一周的多数时段）。
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
function isPeakHour(ms) {
	if (!Number.isFinite(ms)) return false;
	const t = new Date(ms + BEIJING_OFFSET_MS); // 平移到"北京时间的 UTC 视图"
	const day = t.getUTCDay();
	if (day === 0 || day === 6) return false; // 周末全天空闲
	const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
	return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60);
}
// 花费（CNY）。仅 DeepSeek 参与计价；返回 null 表示该来源不显示花费。
// bucket 既带合计，也带按峰谷拆开的子桶（peak / offPeak），于是：
//   peak    = 高峰时段那些调用的实际花费
//   offPeak = 空闲时段那些调用的实际花费
//   actual  = 本次会话的真实花费（两者之和）
// tiered 表示价目表本身区分峰谷——界面据此决定要不要展示拆分。
function costFor(provider, model, bucket, priceTable, fetched) {
	const cls = classifyProvider(provider);
	if (cls !== 'deepseek') return null;
	const table = priceTable && typeof priceTable === 'object' ? priceTable : {};
	const entry = table[model] || table[provider] || (fetched && fetched[model]) || DEFAULT_PRICES[model] || DEFAULT_PRICES[cls];
	const norm = normPrice(entry);
	if (!norm) return null;
	const calc = (p, u) => p ? (u.uncachedInput * p.in + u.cacheRead * p.cr + u.cacheWrite * p.cw + u.output * p.out) / 1e6 : null;
	const zero = { uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	if (norm.peak && norm.offPeak) {
		const peak = calc(norm.peak, bucket.peak || zero);
		const offPeak = calc(norm.offPeak, bucket.offPeak || zero);
		if (peak === null || offPeak === null) return null;
		const tiered = norm.peak.in !== norm.offPeak.in || norm.peak.out !== norm.offPeak.out || norm.peak.cr !== norm.offPeak.cr;
		return { peak, offPeak, actual: peak + offPeak, tiered, model };
	}
	const c = calc(norm.flat, bucket);
	if (c === null) return null;
	return { peak: c, offPeak: c, actual: c, tiered: false, model };
}

// ---- small HTTP / crypto helpers (native Node) ----
async function http(url, opts = {}) {
	const init = { method: opts.method || 'GET', headers: {} };
	for (const [k, v] of opts.headers || []) init.headers[k] = v;
	if (opts.body != null) init.body = opts.body;
	const res = await fetch(url, init);
	const text = await res.text();
	return { status: res.status, body: text };
}
const enc = new TextEncoder();
async function sha256hex(s) {
	const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(keyBytes, msgBytes) {
	const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, msgBytes);
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexBytes(h) {
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
	return out;
}
function pctEncode(s) {
	return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// ---- 官方价格自动抓取（DeepSeek 中文定价页，正则解析，CNY/1M）----
// 峰谷：高峰为北京时间周一至周五 9:00-12:00、14:00-18:00，空闲为高峰的一半。
// 列序不再写死：定价页表头「模型」一行给出两列的模型名（当前 deepseek-flash / deepseek-v4-pro），
// 缓存命中 / 未命中 / 输出 各两组（空闲 / 高峰）。
const PRICE_PAGE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing';
let fetchedPrices = null; // { model: { peak:{in,cr,cw,out}, offPeak:{...} } }（CNY/1M）
let fetchedAt = 0;
const PRICE_TTL_MS = 6 * 3600 * 1000;
// 表头「模型」行 → 列序模型名（形如：模型 deepseek-flash (1) deepseek-v4-pro (2)）。
// 列序错位会把 Flash 的价算到 Pro 头上且完全静默，所以取不到就放弃本轮抓取。
function modelColumns(html) {
	const row = html.match(/模型<\/td>([\s\S]*?)<\/tr>/);
	if (!row) return [];
	return [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
		.map((m) => m[1].replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<[^>]*>/g, '').trim())
		.filter((s) => /^[a-z0-9][a-z0-9.\-]*$/.test(s));
}
async function refreshDeepseekPrices(force) {
	if (!force && fetchedPrices && Date.now() - fetchedAt < PRICE_TTL_MS) return fetchedPrices;
	try {
		const res = await http(PRICE_PAGE, { headers: [['Accept', 'text/html,application/xhtml+xml,text/plain']] });
		if (res.status !== 200) return fetchedPrices;
		// 官方定价页为 HTML 表格：先剥掉标签再正则。标签一律换成空格，于是
		// 「百万tokens输入<br>（缓存命中）」会变成「百万tokens输入 （缓存命中）」——
		// 原来写死的无空白版「输入（缓存命中）」永远匹配不上，抓取一直静默失效（priceFetchedAt 恒为 0）。
		const t = res.body.replace(/<[^>]*>/g, ' ');
		const grab = (re) => { const m = t.match(re); return m && m.length === 5 ? m : null; };
		const rowRe = (label) => new RegExp(label + '[\\s\\S]*?空闲时段\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元\\s*高峰时段\\s*([\\d.]+)\\s*元\\s*([\\d.]+)\\s*元');
		const hit = grab(rowRe('百万tokens输入\\s*（缓存命中）'));
		const miss = grab(rowRe('百万tokens输入\\s*（缓存未命中）'));
		const out = grab(rowRe('百万tokens输出'));
		if (!hit || !miss || !out) { console.warn('[api-monitor] 定价页解析失败，保留上次价格'); return fetchedPrices; }
		const names = modelColumns(res.body);
		if (names.length < 2) { console.warn('[api-monitor] 定价页表头未给出两个模型列，放弃本轮抓取'); return fetchedPrices; }
		const mk = (offIn, offHit, offOut, pkIn, pkHit, pkOut) => ({
			offPeak: { in: num(offIn, 0), cr: num(offHit, 0), cw: 0, out: num(offOut, 0) },
			peak: { in: num(pkIn, 0), cr: num(pkHit, 0), cw: 0, out: num(pkOut, 0) },
		});
		const next = {};
		// 列序：第1列=flash，第2列=pro（以表头取到的顺序为准）
		next[names[0]] = mk(miss[1], hit[1], out[1], miss[3], hit[3], out[3]);
		next[names[1]] = mk(miss[2], hit[2], out[2], miss[4], hit[4], out[4]);
		// 合理性闸门：峰价不应低于谷价、输入/输出必须为正。不满足就保留内置表，
		// 免得把错位的数字当成价格用。内置表已按官方定价页校准过，放弃抓取是安全的一侧。
		const sane = (p) => p.offPeak.in > 0 && p.offPeak.out > 0
			&& p.peak.in >= p.offPeak.in && p.peak.out >= p.offPeak.out && p.peak.cr >= p.offPeak.cr;
		if (!Object.keys(next).every((k) => sane(next[k]))) { console.warn('[api-monitor] 定价页数字不合理，保留上次价格'); return fetchedPrices; }
		fetchedPrices = next;
		fetchedAt = Date.now();
		console.log('[api-monitor] DeepSeek 官方价格已更新: ' + Object.keys(next).join(', '));
		return fetchedPrices;
	} catch (e) { console.warn('[api-monitor] 抓取官方价格失败:', e instanceof Error ? e.message : e); return fetchedPrices; }
}

/**
 * 0.1.7+：插件配置是 Loader 条目上的 `config:`（条目 id = `api-monitor`），
 * 由宿主按此 schema 校验并在设置页渲染表单；改动经 configEditor.edit 落盘到 profile patch。
 */
export const Config = SCHEMA;

export function apply(ctx, config) {
	// 写配置：把整份 config 落盘到 profile patch，Loader reconcile 后以新 config 重跑 apply。
	const writeCfg = async (patch) => {
		const editor = ctx.get('configEditor');
		const entry = ctx.fiber?.entry;
		if (editor === void 0 || entry === void 0) throw new Error('configEditor 不可用（无法保存配置）');
		await editor.edit(entry, (current) => ({ ...(current ?? {}), ...patch }));
	};
	ctx.inject(['settings', 'credentials', 'subagents', 'sessions', 'sessionProjections', 'webServer'], (host) => {
		const settings = host.settings;
		const creds = host.credentials;
		const subagents = host.subagents;
		const sessions = host.sessions;
		const projections = host.sessionProjections;
		const webServer = host.webServer;

		// 设置页按 schema 自动生成本插件卡片。
		try {
			settings.configure({ auto: true }, ctx.fiber);
		} catch (e) { console.warn('[api-monitor] settings.configure 失败:', e instanceof Error ? e.message : e); }
		const readCfg = () => config ?? {};

		const state = {
			deepseek: { configured: false, ts: 0 },
			glm: { configured: false, ts: 0 },
			opencode: { configured: false, ts: 0 },
			command: { configured: false, ts: 0 },
			volcesCoding: { configured: false, ts: 0 },
			volcesAgent: { configured: false, ts: 0 },
		};
		let sessionCache = { rootId: null, at: 0, value: null };

		// ---- polls ----
		async function pollDeepseek() {
			const entry = state.deepseek = beginPoll(state.deepseek);
			try {
				const key = await creds.resolve('DEEPSEEK_API_KEY');
				if (!key || !key.value) { entry.error = '未配置'; return; }
				entry.configured = true;
				const res = await http('https://api.deepseek.com/user/balance', { headers: [['Authorization', 'Bearer ' + key.value]] });
				if (res.status !== 200) { entry.error = 'HTTP ' + res.status; return; }
				const j = tryJson(res.body);
				const infos = j && Array.isArray(j.balance_infos) ? j.balance_infos : [];
				const chosen = infos.find((i) => i && i.currency === 'CNY') || infos.find((i) => i && i.currency === 'USD') || null;
				entry.available = !!j && j.is_available !== undefined ? !!j.is_available : true;
				if (chosen) {
					entry.balance = num(chosen.total_balance, 0);
					entry.currency = chosen.currency;
					entry.stale = false;
					entry.lastGoodTs = Date.now();
				} else if (entry.balance === undefined) {
					entry.error = '无余额字段';
				}
			} catch (e) { entry.error = '接口错误'; }
		}
		// ---- GLM Coding Plan（智谱 / Z.ai）配额 ----
		// GET {base}/api/monitor/usage/quota/limit，Authorization: Bearer <key>。
		// base：国内 open.bigmodel.cn（BIGMODEL_API_KEY），国际 api.z.ai（ZAI_API_KEY）。
		// 响应 data.limits[]：unit=3 → 5 小时滚动窗口，unit=6 → 周配额，type=TIME_LIMIT → 月度工具额度；
		// type 实测返回 CREDIT_LIMIT（部分账号/文档为 TOKENS_LIMIT），故按 unit 为主、type 放宽匹配。
		// percentage 为已用 %，界面展示剩余 % = 100 − used；data.level 为套餐档位（lite/pro/...）。
		async function pollGlm() {
			const entry = state.glm = beginPoll(state.glm);
			try {
				let key = null, base = '';
				const bigmodel = await creds.resolve('BIGMODEL_API_KEY');
				if (bigmodel && bigmodel.value) { key = bigmodel.value; base = 'https://open.bigmodel.cn'; }
				else {
					const zai = await creds.resolve('ZAI_API_KEY');
					if (zai && zai.value) { key = zai.value; base = 'https://api.z.ai'; }
				}
				if (!key) { entry.error = '未配置'; return; }
				entry.configured = true;
				const res = await http(base + '/api/monitor/usage/quota/limit', {
					headers: [['Authorization', 'Bearer ' + key], ['Content-Type', 'application/json'], ['Accept-Language', 'en-US,en']],
				});
				if (res.status === 401 || res.status === 403) { entry.error = 'API Key 无效'; return; }
				if (res.status !== 200) { entry.error = 'HTTP ' + res.status; return; }
				const j = tryJson(res.body);
				if (!j) { entry.error = '响应解析失败'; return; }
				if (j.success === false) { entry.error = '接口返回失败: ' + (j.msg || j.message || '未知原因'); return; }
				const d = j.data || {};
				const limits = Array.isArray(d.limits) ? d.limits : [];
				const byUnit = (u) => limits.find((l) => l && Number(l.unit) === u) || null;
				const timeLimit = limits.find((l) => l && l.type === 'TIME_LIMIT') || null;
				const rem = (lim) => (lim && lim.percentage !== undefined ? pctLeft(lim.percentage) : null);
				const five = rem(byUnit(3));
				const weekly = rem(byUnit(6));
				const monthly = rem(timeLimit);
				if (five !== null || weekly !== null || monthly !== null) {
					entry.five = five;
					entry.weekly = weekly;
					entry.monthly = monthly;
					entry.level = d.level ? String(d.level) : null;
					entry.available = true;
					entry.stale = false;
					entry.lastGoodTs = Date.now();
				} else {
					// 本轮无配额字段：保留上次成功数据（stale 保持 true），不覆盖为占位符
					entry.error = '无配额字段';
				}
			} catch (e) { entry.error = '接口错误'; }
		}
		async function pollOpencode() {
			const entry = state.opencode = beginPoll(state.opencode);
			try {
				const key = await creds.resolve('VISION_API_KEY');
				if (!key || !key.value) { entry.error = '未配置'; return; }
				entry.configured = true;
				const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
				const res = await http('https://opencode.ai/zen/go/v1/usage', {
					headers: [['Authorization', 'Bearer ' + key.value], ['x-api-key', key.value], ['User-Agent', UA]],
				});
				if (res.status === 401 || res.status === 403) { entry.error = 'API Key 无效'; return; }
				if (res.status !== 200) { entry.error = 'HTTP ' + res.status; return; }
				const j = tryJson(res.body);
				const usage = j && j.usage ? j.usage : j;
				const pick = (o) => (o && typeof o.percent === 'number' ? pctLeft(o.percent) : null);
				const rolling = pick(usage && usage.rolling);
				const weekly = pick(usage && usage.weekly);
				const monthly = pick(usage && usage.monthly);
				if (rolling !== null || weekly !== null || monthly !== null) {
					entry.rolling = rolling;
					entry.weekly = weekly;
					entry.monthly = monthly;
					entry.available = true;
					entry.stale = false;
					entry.lastGoodTs = Date.now();
				} else {
					// 本轮无用量字段：保留上次成功数据（stale 保持 true），不覆盖为占位符
					entry.error = '无用量字段';
				}
			} catch (e) { entry.error = '接口错误'; }
		}
		// ---- Command Code（command goat）配额 ----
		// GET https://api.commandcode.ai/alpha/billing/credits，Authorization: Bearer <key>。
		// 响应：credits.monthlyCredits = 月度额度**剩余**（美元），
		// windowLimits.fiveHour / weekly = 两个滚动窗口的 {used, cap, resetAt}，单位同为信用值（美元）。
		// 三个窗口与 GLM 面板一一对应：
		//   5小时 = 100 − fiveHour.used/fiveHour.cap×100
		//   1周   = 100 − weekly.used/weekly.cap×100
		//   1月   = 100 − (月度上限 − monthlyCredits)/月度上限×100
		// 月度上限接口不给，靠 (5h cap, 周 cap) 反查 COMMAND_PLANS；
		// 也可以被配置项 commandMonthlyCap 覆盖（0 = 自动反查）。
		// 兜底：档位认不出且配置也没给上限时，改用 /alpha/usage/summary 的 totalCost 反推总池
		// （本期花费 / (花费 + 剩余)）——该接口在部分账号上恒回 0，所以只作最后手段。
		async function pollCommand() {
			const entry = state.command = beginPoll(state.command);
			try {
				// 键名有两个来源，**两个都试**：DSH 的 provider 配置用的是 `COMMANDCODE_API_KEY`
				// （profile 的 llm-pi-ai `providers.commandcode.apiKeyEnv` 就是它，也是 DSH 写进
				// `.credentials.yaml` 的名字）；插件早期文档与 smoke 脚本用的是 `COMMAND_API_KEY`。
				// 只认旧名 → 已在 DSH 里配好 command goat 的用户永远看到「未配置」（2026-10-10 实测）。
				// 该值本身即可用作 Bearer（实测 93 字符、`u` 开头、直连返回 200），只是形状不像 sk-；
				// 读取一律走 creds.resolve，不要自己去解析 .credentials.yaml。
				let command = await creds.resolve('COMMANDCODE_API_KEY');
				if (!command || !command.value) command = await creds.resolve('COMMAND_API_KEY');
				if (!command || !command.value) { entry.error = '未配置'; return; }
				entry.configured = true;
				const key = command.value;
				const res = await http('https://api.commandcode.ai/alpha/billing/credits', {
					headers: [['Authorization', 'Bearer ' + key], ['Accept', 'application/json']],
				});
				if (res.status === 401 || res.status === 403) { entry.error = 'API Key 无效'; return; }
				if (res.status !== 200) { entry.error = 'HTTP ' + res.status; return; }
				const j = tryJson(res.body);
				if (!j || typeof j !== 'object') { entry.error = '响应解析失败'; return; }
				const cfgCap = num(readCfg().commandMonthlyCap, 0);
				// 先不取 summary（多一次请求）；只有档位与配置都给不出月度上限时才回退去问它。
				let r = commandReadings(j, cfgCap, null);
				if (r.monthly === null) {
					const sres = await http('https://api.commandcode.ai/alpha/usage/summary', {
						headers: [['Authorization', 'Bearer ' + key], ['Accept', 'application/json']],
					});
					r = commandReadings(j, cfgCap, sres.status === 200 ? num((tryJson(sres.body) || {}).totalCost, 0) : null);
				}
				// 只有本轮真的取到数值才落盘；全空时保留上一轮（stale 保持 true），
				// 与 pollGlm / pollOpencode / pollVolces* 同款。曾经这里先做 Object.assign(entry, r)：
				// commandReadings 永远带 five/weekly/monthly 三个键，于是「无配额字段」那轮会把上次成功
				// 的数值覆写成 null——面板一边提示「显示上次数据」、一边把数字显示成「—」。
				if (!applyCommandReadings(entry, r)) entry.error = '无配额字段';
			} catch (e) { entry.error = '接口错误'; }
		}

		// ---- Volcengine SigV4 (crypto.subtle) ----
		async function volcSign(method, params, body, accessKey, secretKey, region, service) {
			const now = new Date();
			const xDate = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/-/g, '').replace(/:/g, '').replace('T', 'T');
			const dateStamp = xDate.slice(0, 8);
			const contentHash = await sha256hex(body || '');
			const hostName = 'open.volcengineapi.com';
			const canonicalHeaders =
				'host:' + hostName + '\n' +
				'x-date:' + xDate + '\n' +
				'x-content-sha256:' + contentHash + '\n' +
				'content-type:application/json\n';
			const signedHeaders = 'host;x-date;x-content-sha256;content-type';
			const qKeys = Object.keys(params).sort();
			const canonicalQuery = qKeys.map((k) => pctEncode(k) + '=' + pctEncode(String(params[k]))).join('&');
			const canonicalRequest = method + '\n/\n' + canonicalQuery + '\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + contentHash;
			const credentialScope = dateStamp + '/' + region + '/' + service + '/request';
			const stringToSign = 'HMAC-SHA256\n' + xDate + '\n' + credentialScope + '\n' + await sha256hex(canonicalRequest);
			const kDate = await hmacHex(enc.encode(secretKey), enc.encode(dateStamp));
			const kRegion = await hmacHex(hexBytes(kDate), enc.encode(region));
			const kService = await hmacHex(hexBytes(kRegion), enc.encode(service));
			const kSigning = await hmacHex(hexBytes(kService), enc.encode('request'));
			const signature = await hmacHex(hexBytes(kSigning), enc.encode(stringToSign));
			const authorization = 'HMAC-SHA256 Credential=' + accessKey + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
			return { authorization, xDate, contentHash };
		}
		async function volcesRequest(params, body, region, service, accessKey, secretKey) {
			const signed = await volcSign('POST', params, body, accessKey, secretKey, region, service);
			const q = Object.keys(params).map((k) => pctEncode(k) + '=' + pctEncode(String(params[k]))).sort().join('&');
			const url = 'https://open.volcengineapi.com/?' + q;
			return http(url, {
				method: 'POST', body: body || '',
				headers: [
					['Authorization', signed.authorization],
					['x-date', signed.xDate],
					['x-content-sha256', signed.contentHash],
					['content-type', 'application/json'],
				],
			});
		}
		function volcesApiKey() {
			const cfg = readCfg();
			return { ak: cfg.volcesAccessKeyId || '', sk: cfg.volcesSecretAccessKey || '' };
		}
		function parseQuotaRows(j) {
			const r0 = j && j.Result ? j.Result : {};
			const rows = Array.isArray(r0.QuotaUsage) ? r0.QuotaUsage : Array.isArray(r0.Usages) ? r0.Usages : Array.isArray(r0.Details) ? r0.Details : [];
			const byLevel = {};
			for (const r of rows) {
				if (!r) continue;
				const label = r.Level || r.Type || r.Period || r.Label || r.Window || '';
				if (!label) continue;
				const pct = r.Percent !== undefined ? r.Percent : r.UsedPercent !== undefined ? r.UsedPercent : r.UsagePercent;
				byLevel[String(label).toLowerCase()] = { percent: num(pct, NaN), reset: r.ResetTime || r.ResetTimestamp || null };
			}
			return byLevel;
		}
		function volcesRespError(j) {
			const e = j && j.ResponseMetadata && j.ResponseMetadata.Error;
			return e ? (e.Message || e.Code || '未知错误') : null;
		}
		async function pollVolcesCoding() {
			const entry = state.volcesCoding = beginPoll(state.volcesCoding);
			try {
				const inferKey = await creds.resolve('VOLCES_API_KEY');
				if (inferKey && inferKey.value) entry.configured = true;
				const { ak, sk } = volcesApiKey();
				entry.keyConfigured = !!(ak && sk);
				if (!ak || !sk) { entry.error = '未配置 AK/SK'; return; }
				const params = { Action: 'GetCodingPlanUsage', Region: 'cn-beijing', Version: '2024-01-01' };
				const res = await volcesRequest(params, '', 'cn-beijing', 'ark', ak, sk);
				if (res.status === 401 || res.status === 403) { entry.error = 'AK/SK 无效或权限不足'; return; }
				if (res.status !== 200) { const em = volcesRespError(tryJson(res.body)); entry.error = em ? ('火山 API 错误 (' + res.status + '): ' + em) : ('HTTP ' + res.status); return; }
				const j = tryJson(res.body);
				if (!j) { entry.error = '响应解析失败'; return; }
				const em2 = volcesRespError(j);
				if (em2) { entry.error = '火山 API 错误: ' + em2; return; }
				const byLevel = parseQuotaRows(j);
				const five = byLevel['session'] || byLevel['5h'] || byLevel['fivehour'] || byLevel['five_hour'] || byLevel['rolling_5h'];
				const week = byLevel['weekly'] || byLevel['week'] || byLevel['7d'];
				const month = byLevel['monthly'] || byLevel['month'];
				const f = five ? pctLeft(five.percent) : null;
				const w = week ? pctLeft(week.percent) : null;
				const m = month ? pctLeft(month.percent) : null;
				if (f !== null || w !== null || m !== null) {
					entry.five = f;
					entry.weekly = w;
					entry.monthly = m;
					entry.available = true;
					entry.stale = false;
					entry.lastGoodTs = Date.now();
				} else {
					// 本轮无配额数据：保留上次成功数据（stale 保持 true）
					entry.available = false;
					entry.unsubscribed = true;
				}
			} catch (e) { entry.error = '接口错误'; }
		}
		async function pollVolcesAgent() {
			const entry = state.volcesAgent = beginPoll(state.volcesAgent);
			try {
				const inferKey = await creds.resolve('VOLCES_API_KEY');
				if (inferKey && inferKey.value) entry.configured = true;
				const { ak, sk } = volcesApiKey();
				entry.keyConfigured = !!(ak && sk);
				if (!ak || !sk) { entry.error = '未配置 AK/SK'; return; }
				const params = { Action: 'GetAFPUsage', Region: 'cn-beijing', Version: '2024-01-01' };
				const res = await volcesRequest(params, '', 'cn-beijing', 'ark', ak, sk);
				if (res.status === 401 || res.status === 403) { entry.error = 'AK/SK 无效或权限不足'; return; }
				if (res.status !== 200) { const em = volcesRespError(tryJson(res.body)); entry.error = em ? ('火山 API 错误 (' + res.status + '): ' + em) : ('HTTP ' + res.status); return; }
				const j = tryJson(res.body);
				if (!j) { entry.error = '响应解析失败'; return; }
				const em2 = volcesRespError(j);
				if (em2) { entry.error = '火山 API 错误: ' + em2; return; }
				const r = j.Result || {};
				const norm = (o) => {
					if (!o) return null;
					const quota = num(o.Quota, o.Quota != null ? o.Quota : NaN);
					const used = num(o.Used, o.Used != null ? o.Used : NaN);
					if (!(quota > 0) || !Number.isFinite(used)) return null;
					return pctLeft((used / quota) * 100);
				};
				const f = norm(r.AFPFiveHour);
				const w = norm(r.AFPWeekly);
				const m = norm(r.AFPMonthly);
				if (f !== null || w !== null || m !== null) {
					entry.five = f;
					entry.weekly = w;
					entry.monthly = m;
					entry.available = true;
					entry.stale = false;
					entry.lastGoodTs = Date.now();
				} else {
					// 本轮无配额数据：保留上次成功数据（stale 保持 true）
					entry.unsubscribed = true;
				}
			} catch (e) { entry.error = '接口错误'; }
		}
		async function pollAll() {
			await Promise.all([refreshDeepseekPrices(false), pollDeepseek(), pollGlm(), pollOpencode(), pollCommand(), pollVolcesCoding(), pollVolcesAgent()]);
		}

		// ---- session tree usage ----
		// Session 的事件读取面。**这里曾经把 `log` 换成 `events`，而 dsh-session（0.1.2-rc.1 与
		// 0.1.5-rc.1 都一样）从来没有 `events` getter**：`session.events` 恒为 undefined，
		// 于是按来源的桶永远为空、只有总量在涨。现在优先用公开读取面 `snapshotEvents()`
		// ——token-meter 的 tokenUsage 投影折叠的就是它，两者口径天然一致——再逐级回退。
		function sessionEvents(s) {
			try {
				if (typeof s.snapshotEvents === 'function') {
					const ev = s.snapshotEvents();
					if (Array.isArray(ev)) return ev;
				}
			} catch { /* fall through to the legacy accessors */ }
			if (Array.isArray(s.events)) return s.events;
			if (Array.isArray(s.log)) return s.log;
			return [];
		}
		// 与 token-meter 的 usageOf 同口径：usage 通常内联在 assistant/message 上，但失败/中断的
		// settlement 可能只在流里留下 usage chunk，只认 data.usage 会漏掉这些调用。
		function usageOfEvent(ev) {
			const d = (ev && ev.data) || {};
			if (d.usage && typeof d.usage === 'object') return d.usage;
			const stream = d.stream;
			if (Array.isArray(stream)) {
				for (let i = stream.length - 1; i >= 0; i--) {
					const rec = stream[i];
					if (rec && rec.type === 'chunk' && rec.chunk && rec.chunk.type === 'usage' && rec.chunk.usage) return rec.chunk.usage;
				}
			}
			return null;
		}
		function computeSessionOnce(ids, cfg) {
			const total = { uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
			const buckets = {};
			const byProvider = {};
			const mk = () => ({ uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 });
			// 来源桶在合计之外再带一份按峰谷拆开的用量，供按调用时刻计价。
			const mkSplit = () => { const b = mk(); b.peak = mk(); b.offPeak = mk(); return b; };
			const partsOf = (u) => ({
				uncachedInput: num(u.inputTokens, 0),
				output: num(u.outputTokens, 0),
				cacheRead: num(u.cacheReadTokens, 0),
				cacheWrite: num(u.cacheWriteTokens, 0),
			});
			// sign=+1 记账，sign=-1 冲销被替换掉的那次采样。isPeak 决定同时落进哪个峰谷子桶。
			const acc = (b, p, sign, isPeak) => {
				b.uncachedInput += sign * p.uncachedInput;
				b.output += sign * p.output;
				b.cacheRead += sign * p.cacheRead;
				b.cacheWrite += sign * p.cacheWrite;
				b.calls += sign;
				const sub = isPeak ? b.peak : b.offPeak;
				if (!sub) return;
				sub.uncachedInput += sign * p.uncachedInput;
				sub.output += sign * p.output;
				sub.cacheRead += sign * p.cacheRead;
				sub.cacheWrite += sign * p.cacheWrite;
				sub.calls += sign;
			};
			for (const id of ids) {
				const s = sessions.get(id);
				if (!s) continue;
				// 总量仍取 token-meter 投影：它是权威口径，也涵盖没有路由信息的 attempt。
				let tu = null;
				try { const snap = projections.snapshot(s); if (snap && snap.values) tu = snap.values.tokenUsage || null; } catch { tu = null; }
				if (tu) {
					total.uncachedInput += num(tu.uncachedInputTokens, 0);
					total.output += num(tu.outputTokens, 0);
					total.cacheRead += num(tu.cacheReadTokens, 0);
					total.cacheWrite += num(tu.cacheWriteTokens, 0);
				}
				try {
					// 按 (turn,step) 拆分来源，并复用 tokenUsage 投影的「替换」语义：同一步的重发
					// 冲销上一次再记新的（llm/retry-started 之后的 attempt 才是真追加），
					// 这样各来源之和与「本次会话总览」的总量同口径。
					let last = null;
					for (const ev of sessionEvents(s)) {
						if (!ev) continue;
						if (ev.type === 'llm/retry-started') {
							const d = ev.data || {};
							if (last && last.turn === num(d.turn, NaN) && last.step === num(d.step, NaN)) last = null;
							continue;
						}
						if (ev.type !== 'assistant/message') continue;
						const d = ev.data || {};
						const usage = usageOfEvent(ev);
						if (!usage || typeof usage !== 'object') continue;
						const turn = num(d.turn, NaN);
						const step = num(d.step, NaN);
						if (!Number.isFinite(turn) || !Number.isFinite(step)) continue;
						const parts = partsOf(usage);
						// 按这次调用自己的事件时刻定峰谷；冲销时也用同一个窗口，替换才对称。
						const isPeak = isPeakHour(ev.time);
						if (last && last.turn === turn && last.step === step) {
							if (last.bucket) acc(last.bucket, last.parts, -1, last.isPeak);
							last = null;
						}
						const src = (d.message && d.message.source) || {};
						const provider = src.provider;
						if (!provider) { last = { turn, step, parts, bucket: null, isPeak }; continue; } // 无路由：只进总量
						const model = src.model || '';
						const key = classifyProvider(provider) + '||' + String(provider) + '||' + String(model);
						let b = buckets[key];
						if (!b) { b = buckets[key] = mkSplit(); b.provider = provider; b.model = model; }
						acc(b, parts, 1, isPeak);
						last = { turn, step, parts, bucket: b, isPeak };
					}
				} catch { /* skip */ }
			}
			// byProvider 与调用次数由 buckets 汇总，保证「各来源相加 = 可归属的总量」；
			// 峰谷子桶一并汇总，界面才能按来源显示高峰/空闲各自的用量与花费。
			for (const k of Object.keys(buckets)) {
				const b = buckets[k];
				const cls = classifyProvider(b.provider);
				if (!byProvider[cls]) { byProvider[cls] = mkSplit(); byProvider[cls].provider = b.provider; }
				const agg = byProvider[cls];
				agg.uncachedInput += b.uncachedInput;
				agg.output += b.output;
				agg.cacheRead += b.cacheRead;
				agg.cacheWrite += b.cacheWrite;
				agg.calls += b.calls;
				for (const w of ['peak', 'offPeak']) {
					agg[w].uncachedInput += b[w].uncachedInput;
					agg[w].output += b[w].output;
					agg[w].cacheRead += b[w].cacheRead;
					agg[w].cacheWrite += b[w].cacheWrite;
					agg[w].calls += b[w].calls;
				}
				total.calls += b.calls;
			}
			const costs = {};
			const costTotal = { peak: 0, offPeak: 0, actual: 0 };
			for (const k of Object.keys(buckets)) {
				const b = buckets[k];
				const c = costFor(b.provider, b.model, b, cfg.priceTable || {}, fetchedPrices);
				b.cost = c;
				if (c !== null) {
					const cls = classifyProvider(b.provider);
					const acc2 = costs[cls] || (costs[cls] = { peak: 0, offPeak: 0, actual: 0 });
					acc2.peak += c.peak; acc2.offPeak += c.offPeak; acc2.actual += c.actual;
					acc2.tiered = !!c.tiered;
					costTotal.peak += c.peak; costTotal.offPeak += c.offPeak; costTotal.actual += c.actual;
				}
			}
			return { total, buckets, byProvider, costs, costTotal, sessionCount: ids.length };
		}
		async function computeSession(rootId) {
			const ids = [rootId];
			try {
				const descs = await subagents.listDescendants(rootId);
				for (const d of descs || []) if (d && d.kind === 'child' && d.id && d.id !== rootId && !ids.includes(d.id)) ids.push(d.id);
			} catch { /* degrade to single session */ }
			// 必须把整棵树交给折叠：子代理（subagent）的用量在各自的 Session 里，
			// 原来这里算出的 ids 被丢掉、恒等于 [rootId]，子代理 token 从不计入。
			const value = computeSessionOnce(ids, readCfg());
			value.ids = ids;
			return value;
		}
		async function getSnapshot(rootId) {
			const cfg = readCfg();
			const now = Date.now();
			let session;
			if (rootId && sessionCache.rootId === rootId && now - sessionCache.at < 8000 && sessionCache.value) {
				session = sessionCache.value;
			} else if (rootId) {
				session = await computeSession(rootId);
				sessionCache = { rootId, at: now, value: session };
			} else {
				session = { total: { uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 }, buckets: {}, byProvider: {}, costs: {}, costTotal: { peak: 0, offPeak: 0 }, sessionCount: 0, ids: [] };
			}
			return {
				providers: {
					deepseek: state.deepseek, glm: state.glm, opencode: state.opencode,
					command: state.command,
					volcesCoding: state.volcesCoding, volcesAgent: state.volcesAgent,
				},
				session,
				config: {
					pollIntervalSeconds: num(cfg.pollIntervalSeconds, 60),
					warnPercent: num(cfg.warnPercent, 70),
					dangerPercent: num(cfg.dangerPercent, 90),
					balanceWarn: num(cfg.balanceWarn, 10),
					showCacheHitRate: bool(cfg.showCacheHitRate, true),
					showResetTime: bool(cfg.showResetTime, false),
					priceFetchedAt: fetchedAt || 0,
					entryVisibility: cfg.entryVisibility || {},
					volcesTier: cfg.volcesTier || 'auto',
					commandMonthlyCap: num(cfg.commandMonthlyCap, 0),
				},
				ts: now,
			};
		}

		// ---- HTTP routes ----
		function sendJson(res, status, payload) {
			res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify(payload));
		}
		// DSH Desktop serves the UI from the custom `dsh-app://app` scheme and relays its
		// fetches to this local server — and that relay attaches NO `Origin` header (only
		// `Host` + the auth cookie). Treating a missing Origin as hostile 403s every write
		// from the desktop app while leaving all GETs working. Mirror DSH's own policy for
		// its local routes instead: refuse `sec-fetch-site: cross-site`, and require a
		// *present* Origin to match Host. A cross-origin page always sends both, so an
		// absent Origin is the desktop same-origin case rather than a forgery.
		function sameOrigin(req) {
			if (req.headers['sec-fetch-site'] === 'cross-site') return false;
			const origin = req.headers.origin;
			if (origin === undefined) return true;
			const host = req.headers.host;
			if (host === undefined) return false;
			try { return new URL(origin).host === host; } catch { return false; }
		}
		async function readJsonBody(req, maxBytes = 4096) {
			const chunks = [];
			let size = 0;
			for await (const chunk of req) {
				const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				size += buffer.length;
				if (size > maxBytes) throw new Error('request body too large');
				chunks.push(buffer);
			}
			return JSON.parse(Buffer.concat(chunks).toString('utf8'));
		}
		function queryOf(req) {
			const u = new URL(req.url, 'http://localhost');
			return u.searchParams;
		}

		const routes = [
			{
				kind: 'exact', path: '/api-monitor/snapshot',
				handler: async (req, res) => {
					try { sendJson(res, 200, await getSnapshot(queryOf(req).get('root') || null)); }
					catch (e) { sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
				},
			},
			{
				kind: 'exact', path: '/api-monitor/config',
				handler: async (req, res) => {
					const cfg = readCfg();
					sendJson(res, 200, {
						volcesTier: cfg.volcesTier || 'auto',
						entryVisibility: cfg.entryVisibility || {},
						pollIntervalSeconds: num(cfg.pollIntervalSeconds, 60),
						warnPercent: num(cfg.warnPercent, 70),
						dangerPercent: num(cfg.dangerPercent, 90),
						balanceWarn: num(cfg.balanceWarn, 10),
						volcesKeyConfigured: !!(cfg.volcesAccessKeyId && cfg.volcesSecretAccessKey),
					});
				},
			},
			{
				kind: 'exact', path: '/api-monitor/refresh',
				handler: async (req, res) => {
					if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
					if (!sameOrigin(req)) { sendJson(res, 403, { error: 'untrusted origin' }); return; }
					try { await refreshDeepseekPrices(true); await pollAll(); sendJson(res, 200, { ok: true, ts: Date.now() }); }
					catch (e) { sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }); }
				},
			},
			{
				kind: 'exact', path: '/api-monitor/set-volces-keys',
				handler: async (req, res) => {
					if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
					if (!sameOrigin(req)) { sendJson(res, 403, { error: 'untrusted origin' }); return; }
					try {
						const body = await readJsonBody(req);
						if (typeof body.volcesAccessKeyId !== 'string' || typeof body.volcesSecretAccessKey !== 'string') { sendJson(res, 400, { ok: false, error: 'bad args' }); return; }
						await writeCfg({ volcesAccessKeyId: body.volcesAccessKeyId, volcesSecretAccessKey: body.volcesSecretAccessKey });
						await Promise.all([pollVolcesCoding(), pollVolcesAgent()]);
						sendJson(res, 200, { ok: true, ts: Date.now() });
					} catch (e) { sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }); }
				},
			},
			{
				kind: 'exact', path: '/api-monitor/set-tier',
				handler: async (req, res) => {
					if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
					if (!sameOrigin(req)) { sendJson(res, 403, { error: 'untrusted origin' }); return; }
					try {
						const body = await readJsonBody(req);
						if (typeof body.volcesTier !== 'string') { sendJson(res, 400, { ok: false, error: 'bad args' }); return; }
						await writeCfg({ volcesTier: body.volcesTier });
						sendJson(res, 200, { ok: true });
					} catch (e) { sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }); }
				},
			},
			{
				kind: 'exact', path: '/api-monitor/set-visibility',
				handler: async (req, res) => {
					if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
					if (!sameOrigin(req)) { sendJson(res, 403, { error: 'untrusted origin' }); return; }
					try {
						const body = await readJsonBody(req);
						const vis = body.entryVisibility;
						if (typeof vis !== 'object' || vis === null || Array.isArray(vis)) { sendJson(res, 400, { ok: false, error: 'bad args' }); return; }
						// 只接受已知区块键：顺带清掉旧版本遗留的 entryVisibility 键（如 siliconflow）
						const KNOWN = ['deepseek', 'glm', 'opencodeGo', 'command', 'qwen', 'volcesCoding', 'volcesAgent'];
						const nextVis = {};
						for (const k of KNOWN) nextVis[k] = vis[k] !== undefined ? !!vis[k] : true;
						await writeCfg({ entryVisibility: nextVis });
						sendJson(res, 200, { ok: true });
					} catch (e) { sendJson(res, 400, { ok: false, error: e instanceof Error ? e.message : String(e) }); }
				},
			},
		];
		const disposers = routes.map((r) => webServer.register(r));

		// ---- poller ----
		pollAll().catch(() => {});
		const pollMs = Math.max(20, num(readCfg().pollIntervalSeconds, 60)) * 1000;
		const timer = setInterval(() => { pollAll().catch(() => {}); }, pollMs);
		timer.unref?.();

		console.log('[api-monitor] host active');
		return () => {
			clearInterval(timer);
			for (const d of disposers) d();
		};
	});
}

/**
 * 仅供测试的纯函数出口：Credits 响应 → 三个窗口的剩余百分比，以及把它们落到 state 条目的语义。
 * Loader 只读 `name` / `Config` / `apply` / `inject`，多余的具名导出没有副作用。
 */
export const __test = { commandReadings, commandPlan, applyCommandReadings, COMMAND_PLANS };