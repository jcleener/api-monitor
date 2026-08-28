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
	entryVisibility: z.object({
		deepseek: z.boolean().default(true),
		glm: z.boolean().default(true),
		opencodeGo: z.boolean().default(true),
		volcesCoding: z.boolean().default(true),
		volcesAgent: z.boolean().default(true),
	}),
});

// 单价表（CNY/1M tokens，2026-08 校验）：
// - DeepSeek 官方 2026-08-17 起峰谷定价：高峰 09:00-12:00 / 14:00-18:00（北京时间），空闲为高峰一半。
//   缓存命中远低于输入（V4-Flash 高峰 ¥0.1 vs 输入 ¥3），旧表把缓存命中按 ¥0.20 计价导致高估约 2 倍。
// - 用户可在 settings 的 priceTable 覆盖；支持平铺 {in,cr,cw,out}（或旧键 pi/pcr/pcw/po）与 {peak,offPeak} 两种形态。
const DEFAULT_PRICES = {
	deepseek: { in: 1.5, cr: 0.05, cw: 0, out: 4.5 }, // 供应商兜底 = V4-Flash 空闲价
	'deepseek-v4-flash': {
		peak: { in: 3, cr: 0.1, cw: 0, out: 9 },
		offPeak: { in: 1.5, cr: 0.05, cw: 0, out: 4.5 },
	},
	'deepseek-v4-pro': {
		peak: { in: 9, cr: 0.3, cw: 0, out: 27 },
		offPeak: { in: 4.5, cr: 0.15, cw: 0, out: 13.5 },
	},
};

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
// 花费（CNY）。仅 DeepSeek 参与计价。DeepSeek 峰谷定价无法按请求时刻归因（日志无逐事件时间戳），
// 返回 {peak, offPeak}；平铺价 peak === offPeak。未知模型返回 null（界面显示 —）。
function costFor(provider, model, buckets, priceTable, fetched) {
	const cls = classifyProvider(provider);
	if (cls !== 'deepseek') return null;
	const table = priceTable && typeof priceTable === 'object' ? priceTable : {};
	const entry = table[model] || table[provider] || (fetched && fetched[model]) || DEFAULT_PRICES[model] || DEFAULT_PRICES[cls];
	const norm = normPrice(entry);
	if (!norm) return null;
	const calc = (p) => p ? (buckets.uncachedInput * p.in + buckets.cacheRead * p.cr + buckets.cacheWrite * p.cw + buckets.output * p.out) / 1e6 : null;
	let peak, offPeak;
	if (norm.peak) { peak = calc(norm.peak); offPeak = calc(norm.offPeak); }
	else { const c = calc(norm.flat); peak = c; offPeak = c; }
	if (peak === null || offPeak === null) return null;
	return { peak, offPeak, tiered: Math.abs(peak - offPeak) > 0.005, model };
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
// 峰谷：高峰 09:00-12:00 / 14:00-18:00（北京时间），空闲为高峰一半。
// 页面列序固定：deepseek-v4-flash, deepseek-v4-pro；缓存命中/未命中/输出 各两组（空闲/高峰）。
const PRICE_PAGE = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing';
let fetchedPrices = null; // { model: { peak:{in,cr,cw,out}, offPeak:{...} } }（CNY/1M）
let fetchedAt = 0;
const PRICE_TTL_MS = 6 * 3600 * 1000;
async function refreshDeepseekPrices(force) {
	if (!force && fetchedPrices && Date.now() - fetchedAt < PRICE_TTL_MS) return fetchedPrices;
	try {
		const res = await http(PRICE_PAGE, { headers: [['Accept', 'text/html,application/xhtml+xml,text/plain']] });
		if (res.status !== 200) return fetchedPrices;
		// 官方定价页为 HTML 表格：先剥掉标签再正则（列序固定 flash/pro，缓存命中/未命中/输出各两组空闲/高峰）
		const t = res.body.replace(/<[^>]*>/g, ' ');
		const grab = (re) => { const m = t.match(re); return m && m.length === 5 ? m : null; };
		const hit = grab(/百万tokens输入（缓存命中）[\s\S]*?空闲时段\s*([\d.]+)元\s*([\d.]+)元\s*高峰时段\s*([\d.]+)元\s*([\d.]+)元/);
		const miss = grab(/百万tokens输入（缓存未命中）[\s\S]*?空闲时段\s*([\d.]+)元\s*([\d.]+)元\s*高峰时段\s*([\d.]+)元\s*([\d.]+)元/);
		const out = grab(/百万tokens输出[\s\S]*?空闲时段\s*([\d.]+)元\s*([\d.]+)元\s*高峰时段\s*([\d.]+)元\s*([\d.]+)元/);
		if (!hit || !miss || !out) { console.warn('[api-monitor] 定价页解析失败，保留上次价格'); return fetchedPrices; }
		const names = (t.match(/deepseek-v4-[a-z0-9-]+/g) || []).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2);
		if (names.length < 2) names.push('deepseek-v4-flash', 'deepseek-v4-pro');
		const mk = (offIn, offHit, offOut, pkIn, pkHit, pkOut) => ({
			offPeak: { in: num(offIn, 0), cr: num(offHit, 0), cw: 0, out: num(offOut, 0) },
			peak: { in: num(pkIn, 0), cr: num(pkHit, 0), cw: 0, out: num(pkOut, 0) },
		});
		const next = {};
		// 列序：第1列=flash，第2列=pro（页面固定）
		next[names[0]] = mk(miss[1], hit[1], out[1], miss[3], hit[3], out[3]);
		next[names[1]] = mk(miss[2], hit[2], out[2], miss[4], hit[4], out[4]);
		fetchedPrices = next;
		fetchedAt = Date.now();
		console.log('[api-monitor] DeepSeek 官方价格已更新: ' + Object.keys(next).join(', '));
		return fetchedPrices;
	} catch (e) { console.warn('[api-monitor] 抓取官方价格失败:', e instanceof Error ? e.message : e); return fetchedPrices; }
}

export function apply(ctx) {
	ctx.inject(['settings', 'credentials', 'subagents', 'sessions', 'sessionProjections', 'webServer'], (host) => {
		const settings = host.settings;
		const creds = host.credentials;
		const subagents = host.subagents;
		const sessions = host.sessions;
		const projections = host.sessionProjections;
		const webServer = host.webServer;

		settings.register('api-monitor', SCHEMA);
		const readCfg = () => settings.get('api-monitor') ?? {};

		const state = {
			deepseek: { configured: false, ts: 0 },
			glm: { configured: false, ts: 0 },
			opencode: { configured: false, ts: 0 },
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
			await Promise.all([refreshDeepseekPrices(false), pollDeepseek(), pollGlm(), pollOpencode(), pollVolcesCoding(), pollVolcesAgent()]);
		}

		// ---- session tree usage ----
		function computeSessionOnce(rootId, cfg) {
			const ids = [rootId];
			const total = { uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
			const buckets = {};
			const byProvider = {};
			const add = (b, parts) => {
				b.uncachedInput += parts.uncachedInput || 0;
				b.output += parts.output || 0;
				b.cacheRead += parts.cacheRead || 0;
				b.cacheWrite += parts.cacheWrite || 0;
				b.calls += parts.calls || 0;
			};
			const mk = () => ({ uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 });
			for (const id of ids) {
				const s = sessions.get(id);
				if (!s) continue;
				let tu = null;
				try { const snap = projections.snapshot(s); if (snap && snap.values) tu = snap.values.tokenUsage || null; } catch { tu = null; }
				if (tu) add(total, { uncachedInput: tu.uncachedInputTokens, output: tu.outputTokens, cacheRead: tu.cacheReadTokens, cacheWrite: tu.cacheWriteTokens });
				try {
					// 按 (turn,step) 去重：同一步的多次 usage（重试/失败后重发）只计最后一次，
					// 与 token-meter 的 tokenUsage 口径一致，避免同一逻辑调用被重复计费。
					const samples = new Map();
					let curTurn = 0, curStep = 0;
					for (const ev of s.log || []) {
						if (!ev) continue;
						const et = ev.type;
						const ed = ev.data || {};
						if (et === 'turn/start') curTurn = num(ed.turn, curTurn);
						else if (et === 'step/start') curStep = num(ed.step, curStep + 1);
						else if (et === 'assistant/message') {
							const msg = ed.message || {};
							const src = msg.source || {};
							const usage = ed.usage;
							if (!usage || typeof usage !== 'object') continue;
							if (usage.inputTokens === undefined && usage.outputTokens === undefined && usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined) continue;
							samples.set(curTurn + ':' + curStep, {
								provider: src.provider, model: src.model || '',
								uncachedInput: usage.inputTokens || 0, output: usage.outputTokens || 0,
								cacheRead: usage.cacheReadTokens || 0, cacheWrite: usage.cacheWriteTokens || 0,
							});
						}
					}
					for (const smp of samples.values()) {
						total.calls += 1;
						if (!smp.provider) continue;
						const cls = classifyProvider(smp.provider);
						const key = cls + '||' + String(smp.provider) + '||' + String(smp.model);
						if (!buckets[key]) { buckets[key] = mk(); buckets[key].provider = smp.provider; buckets[key].model = smp.model; }
						buckets[key].uncachedInput += smp.uncachedInput;
						buckets[key].output += smp.output;
						buckets[key].cacheRead += smp.cacheRead;
						buckets[key].cacheWrite += smp.cacheWrite;
						buckets[key].calls += 1;
						if (!byProvider[cls]) { byProvider[cls] = mk(); byProvider[cls].provider = smp.provider; }
						add(byProvider[cls], { uncachedInput: smp.uncachedInput, output: smp.output, cacheRead: smp.cacheRead, cacheWrite: smp.cacheWrite, calls: 1 });
					}
				} catch { /* skip */ }
			}
			const costs = {};
			const costTotal = { peak: 0, offPeak: 0 };
			for (const k of Object.keys(buckets)) {
				const b = buckets[k];
				const c = costFor(b.provider, b.model, b, cfg.priceTable || {}, fetchedPrices);
				b.cost = c;
				if (c !== null) { const cls = classifyProvider(b.provider); const acc = costs[cls] || (costs[cls] = { peak: 0, offPeak: 0 }); acc.peak += c.peak; acc.offPeak += c.offPeak; costTotal.peak += c.peak; costTotal.offPeak += c.offPeak; }
			}
			return { total, buckets, byProvider, costs, costTotal, sessionCount: ids.length };
		}
		async function computeSession(rootId) {
			const ids = [rootId];
			try {
				const descs = await subagents.listDescendants(rootId);
				for (const d of descs || []) if (d && d.kind === 'child' && d.id && d.id !== rootId) ids.push(d.id);
			} catch { /* degrade to single session */ }
			const value = computeSessionOnce(rootId, readCfg());
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
				},
				ts: now,
			};
		}

		// ---- HTTP routes ----
		function sendJson(res, status, payload) {
			res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
			res.end(JSON.stringify(payload));
		}
		function sameOrigin(req) {
			const origin = req.headers.origin;
			const host = req.headers.host;
			if (origin === undefined || host === undefined) return false;
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
						await settings.update('api-monitor', { volcesAccessKeyId: body.volcesAccessKeyId, volcesSecretAccessKey: body.volcesSecretAccessKey });
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
						await settings.update('api-monitor', { volcesTier: body.volcesTier });
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
						const KNOWN = ['deepseek', 'glm', 'opencodeGo', 'volcesCoding', 'volcesAgent'];
						const nextVis = {};
						for (const k of KNOWN) nextVis[k] = vis[k] !== undefined ? !!vis[k] : true;
						await settings.update('api-monitor', { entryVisibility: nextVis });
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