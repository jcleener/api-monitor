/**
 * api-monitor — host half (static, resident in the dsh web process).
 *
 * Registers the `api-monitor` settings namespace, polls DeepSeek /
 * SiliconFlow / OpenCode Go / Volcengine (Coding + Agent Plan), aggregates the
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
		siliconflow: z.boolean().default(true),
		opencodeGo: z.boolean().default(true),
		volcesCoding: z.boolean().default(true),
		volcesAgent: z.boolean().default(true),
	}),
});

const DEFAULT_PRICE = {
	deepseek: { pi: 0.28, pcr: 0.028, pcw: 0.28, po: 0.42 },
	siliconflow: { pi: 0.5, pcr: 0.05, pcw: 0.5, po: 1.5 },
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
	if (s.includes('silicon')) return 'siliconflow';
	if (s.includes('opencode') || s.includes('vision')) return 'opencode';
	if (s.includes('volces') || s.includes('ark') || s.includes('doubao')) return 'volces';
	return s || 'unknown';
}

function costFor(provider, model, buckets, priceTable) {
	const cls = classifyProvider(provider);
	if (cls !== 'deepseek' && cls !== 'siliconflow') return null;
	const table = priceTable && typeof priceTable === 'object' ? priceTable : {};
	const entry = table[model] || table[provider] || DEFAULT_PRICE[cls];
	if (!entry) return null;
	const pi = num(entry.pi, 0), pcr = num(entry.pcr, 0), pcw = num(entry.pcw, 0), po = num(entry.po, 0);
	return (buckets.uncachedInput * pi + buckets.cacheRead * pcr + buckets.cacheWrite * pcw + buckets.output * po) / 1e6;
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
			siliconflow: { configured: false, ts: 0 },
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
		async function pollSiliconflow() {
			const entry = state.siliconflow = beginPoll(state.siliconflow);
			try {
				const key = await creds.resolve('SILICONFLOW_API_KEY');
				if (!key || !key.value) { entry.error = '未配置'; return; }
				entry.configured = true;
				const res = await http('https://api.siliconflow.cn/v1/user/info', { headers: [['Authorization', 'Bearer ' + key.value]] });
				if (res.status !== 200) { entry.error = 'HTTP ' + res.status; return; }
				const j = tryJson(res.body);
				const d = j && j.data ? j.data : j;
				if (d && d.totalBalance !== undefined) { entry.balance = num(d.totalBalance, 0); entry.stale = false; entry.lastGoodTs = Date.now(); }
				else if (d && d.balance !== undefined) { entry.balance = num(d.balance, 0); entry.stale = false; entry.lastGoodTs = Date.now(); }
				else if (entry.balance === undefined) { entry.error = '无余额字段'; return; }
				entry.available = true;
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
			await Promise.all([pollDeepseek(), pollSiliconflow(), pollOpencode(), pollVolcesCoding(), pollVolcesAgent()]);
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
					for (const ev of s.log || []) {
						if (!ev || ev.type !== 'assistant/message') continue;
						const d = ev.data || {};
						const msg = d.message || {};
						const src = msg.source || {};
						const provider = src.provider;
						const usage = d.usage || {};
						total.calls += 1;
						if (!provider) continue;
						const cls = classifyProvider(provider);
						const key = cls + '||' + String(provider) + '||' + String(src.model || '');
						if (!buckets[key]) { buckets[key] = mk(); buckets[key].provider = provider; buckets[key].model = src.model || ''; }
						buckets[key].uncachedInput += usage.inputTokens || 0;
						buckets[key].output += usage.outputTokens || 0;
						buckets[key].cacheRead += usage.cacheReadTokens || 0;
						buckets[key].cacheWrite += usage.cacheWriteTokens || 0;
						buckets[key].calls += 1;
						if (!byProvider[cls]) { byProvider[cls] = mk(); byProvider[cls].provider = provider; }
						add(byProvider[cls], { uncachedInput: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens, cacheWrite: usage.cacheWriteTokens, calls: 1 });
					}
				} catch { /* skip */ }
			}
			const costs = {};
			let costTotal = 0;
			for (const k of Object.keys(buckets)) {
				const b = buckets[k];
				const c = costFor(b.provider, b.model, b, cfg.priceTable || {});
				b.cost = c;
				if (c !== null) { const cls = classifyProvider(b.provider); costs[cls] = (costs[cls] || 0) + c; costTotal += c; }
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
				session = { total: { uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 }, buckets: {}, byProvider: {}, costs: {}, costTotal: 0, sessionCount: 0, ids: [] };
			}
			return {
				providers: {
					deepseek: state.deepseek, siliconflow: state.siliconflow, opencode: state.opencode,
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
					try { await pollAll(); sendJson(res, 200, { ok: true, ts: Date.now() }); }
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
						await settings.update('api-monitor', { entryVisibility: vis });
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
