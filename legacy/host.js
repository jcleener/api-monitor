/* api-monitor — Host half. Pure JS, no imports. */
'use strict';

/* ---------------- pure JS SHA-256 (FIPS 180-4) + HMAC-SHA256 ---------------- */
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function sha256Bytes(msg) {
  const bitLen = msg.length * 8;
  const ml = bitLen >>> 0;
  const mh = Math.floor(bitLen / 4294967296);
  const padded = new Uint8Array((((msg.length + 8) >> 6) + 1) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, ml, false);
  dv.setUint32(padded.length - 8, mh, false);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA_K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const od = new DataView(out.buffer);
  od.setUint32(0, h0, false); od.setUint32(4, h1, false); od.setUint32(8, h2, false); od.setUint32(12, h3, false);
  od.setUint32(16, h4, false); od.setUint32(20, h5, false); od.setUint32(24, h6, false); od.setUint32(28, h7, false);
  return out;
}
function concatBytes(a, b) { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }
function toHex(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0'); return s; }
function sha256hex(str) { return toHex(sha256Bytes(new TextEncoder().encode(str))); }
function sha256bytes(str) { return sha256Bytes(new TextEncoder().encode(str)); }
function hmacSha256hex(keyBytes, msgBytes) {
  const block = 64;
  let key = keyBytes;
  if (key.length > block) key = sha256Bytes(key);
  const k1 = new Uint8Array(block), k2 = new Uint8Array(block);
  for (let i = 0; i < block; i++) { const b = key[i] || 0; k1[i] = b ^ 0x36; k2[i] = b ^ 0x5c; }
  const inner = sha256Bytes(concatBytes(k1, msgBytes));
  return toHex(sha256Bytes(concatBytes(k2, inner)));
}

/* ---------------- small helpers ---------------- */
function num(v, d) { const n = typeof v === 'number' ? v : (v == null ? d : Number(v)); return Number.isFinite(n) ? n : d; }
function bool(v, d) { return typeof v === 'boolean' ? v : d; }
function pctLeft(used) { const n = num(used, NaN); return Number.isFinite(n) ? Math.max(0, Math.min(100, 100 - n)) : null; }
function tryJson(text) { try { const v = JSON.parse(text); return v; } catch { return null; } }

/* ---------------- settings schema (hand-rolled schemastery-compatible) ---------------- */
function coerceVal(val, f) {
  if (f.type === 'boolean') return val === undefined ? (f.def !== undefined ? f.def : false) : !!val;
  if (f.type === 'number') {
    if (val === undefined) return f.def !== undefined ? f.def : 0;
    const n = Number(val); return Number.isFinite(n) ? n : (f.def !== undefined ? f.def : 0);
  }
  if (f.type === 'object') {
    if (val === undefined || val === null || typeof val !== 'object' || Array.isArray(val)) return f.dict ? {} : (f.def && typeof f.def === 'object' ? f.def : {});
    const out = {};
    if (f.dict) for (const [k, cf] of Object.entries(f.dict)) out[k] = coerceVal(val[k], cf);
    return out;
  }
  return val === undefined ? (f.def !== undefined ? f.def : '') : String(val);
}
function buildSchemaDef() {
  return {
    volcesAccessKeyId: { type: 'string', def: '' },
    volcesSecretAccessKey: { type: 'string', def: '', meta: { role: 'secret' } },
    volcesTier: { type: 'string', def: 'auto' },
    pollIntervalSeconds: { type: 'number', def: 60 },
    warnPercent: { type: 'number', def: 70 },
    dangerPercent: { type: 'number', def: 90 },
    balanceWarn: { type: 'number', def: 10 },
    priceTable: { type: 'object', def: {} },
    showCacheHitRate: { type: 'boolean', def: true },
    showResetTime: { type: 'boolean', def: false },
    entryVisibility: {
      type: 'object', def: {}, dict: {
        deepseek: { type: 'boolean', def: true },
        siliconflow: { type: 'boolean', def: true },
        opencodeGo: { type: 'boolean', def: true },
        volcesCoding: { type: 'boolean', def: true },
        volcesAgent: { type: 'boolean', def: true },
      },
    },
  };
}
function buildSettingsSchema() {
  const fields = buildSchemaDef();
  const rootDict = {};
  for (const [k, f] of Object.entries(fields)) {
    rootDict[k] = { type: f.type, meta: f.meta || {}, def: f.def, dict: f.dict || undefined, inner: f.inner || undefined };
  }
  const fn = (input) => {
    const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const out = {};
    for (const [k, f] of Object.entries(fields)) out[k] = coerceVal(src[k], f);
    for (const k of Object.keys(src)) if (!(k in fields)) out[k] = src[k];
    return out;
  };
  fn.type = 'object';
  fn.dict = rootDict;
  fn.meta = {};
  fn.toJSON = () => ({ type: 'object', dict: rootDict, meta: {} });
  return fn;
}
function defaultsOf(fields) {
  const o = {};
  for (const [k, f] of Object.entries(fields)) o[k] = f.type === 'object' && f.dict ? defaultsOf(f.dict) : (f.type === 'boolean' || f.type === 'number' ? f.def : '');
  return o;
}

/* price seeding (per 1M tokens, USD) — override via priceTable */
const DEFAULT_PRICE = {
  'deepseek': { pi: 0.28, pcr: 0.028, pcw: 0.28, po: 0.42 },
  'siliconflow': { pi: 0.5, pcr: 0.05, pcw: 0.5, po: 1.5 },
};
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
  const table = (priceTable && typeof priceTable === 'object') ? priceTable : {};
  const entry = table[model] || table[provider] || DEFAULT_PRICE[cls];
  if (!entry) return null;
  const pi = num(entry.pi, 0), pcr = num(entry.pcr, 0), pcw = num(entry.pcw, 0), po = num(entry.po, 0);
  return (buckets.uncachedInput * pi + buckets.cacheRead * pcr + buckets.cacheWrite * pcw + buckets.output * po) / 1e6;
}

/* ---------------- module ---------------- */
return {
  inject: ['settings', 'credentials', 'subagents', 'sessions', 'sessionProjections', 'shell', 'timer'],
  async apply(ctx) {
    const settings = ctx.get('settings');
    const creds = ctx.get('credentials');
    const subagents = ctx.get('subagents');
    const sessions = ctx.get('sessions');
    const projections = ctx.get('sessionProjections');
    const shell = ctx.get('shell');

    // ----- settings namespace (guarded) -----
    let cfgFallback = null;
    let settingsOk = false;
    const fields = buildSchemaDef();
    try {
      if (settings) { settings.register('api-monitor', buildSettingsSchema(), {}); }
      settingsOk = true;
    } catch (e) {
      // Duplicate registration is expected when a previous package of this plugin
      // already registered the namespace in this process (settings.register ties
      // the namespace to the service scope, which survives package updates).
      try { const existing = settings.get('api-monitor'); settingsOk = existing !== undefined && existing !== null; }
      catch { settingsOk = false; }
      if (!settingsOk) console.error('settings.register failed:', e && e.message || e);
    }
    const readCfg = () => {
      if (settingsOk) { const v = settings.get('api-monitor'); return v || defaultsOf(fields); }
      return cfgFallback || (cfgFallback = defaultsOf(fields));
    };

    // ----- state -----
    const state = {
      deepseek: { configured: false, ts: 0 },
      siliconflow: { configured: false, ts: 0 },
      opencode: { configured: false, ts: 0 },
      volcesCoding: { configured: false, ts: 0 },
      volcesAgent: { configured: false, ts: 0 },
    };
    let sessionCache = { rootId: null, at: 0, value: null };

    // ----- http via curl -----
    async function http(url, opts = {}) {
      const method = opts.method || 'GET';
      const headerArgs = (opts.headers || []).map((p) => `-H ${JSON.stringify(p[0] + ': ' + p[1])}`).join(' ');
      let cmd = `curl -sS -m 25 -w '\\n__AM_STATUS__%{http_code}\\n' ${headerArgs}`;
      if (method === 'POST') cmd += ' -X POST --data-binary @-';
      cmd += ' ' + JSON.stringify(url);
      const req = { command: cmd, timeoutMs: 32000, stdoutMaxBytes: 1200000, env: opts.env || {} };
      if (opts.body != null) req.stdin = opts.body;
      const res = await shell.run(shell.resolve(req));
      const text = (res && res.stdout && res.stdout.text) || '';
      const m = text.match(/__AM_STATUS__(\d+)\s*$/);
      const status = m ? parseInt(m[1], 10) : (res ? res.exitCode : 0);
      const body = m ? text.slice(0, m.index) : text;
      return { status, body, exitCode: res ? res.exitCode : 0 };
    }

    // ----- DeepSeek -----
    async function pollDeepseek() {
      const entry = state.deepseek = { configured: false, ts: Date.now() };
      try {
        const key = await creds.resolve('DEEPSEEK_API_KEY');
        if (!key || !key.value) { entry.error = '未配置'; return; }
        entry.configured = true;
        const res = await http('https://api.deepseek.com/user/balance', {
          headers: [['Authorization', 'Bearer ' + key.value]],
        });
        if (res.status !== 200) { entry.error = 'HTTP ' + res.status; return; }
        const j = tryJson(res.body);
        const infos = j && Array.isArray(j.balance_infos) ? j.balance_infos : [];
        let cny = infos.find((i) => i && i.currency === 'CNY') || null;
        let usd = infos.find((i) => i && i.currency === 'USD') || null;
        const chosen = cny || usd;
        entry.available = !!j && j.is_available !== undefined ? !!j.is_available : true;
        if (chosen) {
          entry.balance = num(chosen.total_balance, 0);
          entry.currency = chosen.currency;
        }
        if (!entry.balance && entry.balance !== 0) entry.error = '无余额字段';
      } catch (e) { entry.error = '接口错误'; }
    }
    // ----- SiliconFlow -----
    async function pollSiliconflow() {
      const entry = state.siliconflow = { configured: false, ts: Date.now() };
      try {
        const key = await creds.resolve('SILICONFLOW_API_KEY');
        if (!key || !key.value) { entry.error = '未配置'; return; }
        entry.configured = true;
        const res = await http('https://api.siliconflow.cn/v1/user/info', {
          headers: [['Authorization', 'Bearer ' + key.value]],
        });
        if (res.status !== 200) { entry.error = 'HTTP ' + res.status; return; }
        const j = tryJson(res.body);
        const d = j && j.data ? j.data : j;
        if (d && d.totalBalance !== undefined) entry.balance = num(d.totalBalance, 0);
        else if (d && d.balance !== undefined) entry.balance = num(d.balance, 0);
        else { entry.error = '无余额字段'; return; }
        entry.available = true;
      } catch (e) { entry.error = '接口错误'; }
    }
    // ----- OpenCode Go -----
    async function pollOpencode() {
      const entry = state.opencode = { configured: false, ts: Date.now() };
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
        entry.rolling = pick(usage && usage.rolling);
        entry.weekly = pick(usage && usage.weekly);
        entry.monthly = pick(usage && usage.monthly);
        entry.available = entry.rolling !== null || entry.weekly !== null || entry.monthly !== null;
        if (!entry.available) entry.error = '无用量字段';
      } catch (e) { entry.error = '接口错误'; }
    }

    // ----- Volcengine SigV4 -----
    function pctEncode(s) {
      return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    }
    function volcSign(method, params, body, accessKey, secretKey, region, service) {
      const now = new Date();
      const xDate = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/-/g, '').replace(/:/g, '').replace('T', 'T');
      const dateStamp = xDate.slice(0, 8);
      const contentHash = sha256hex(body || '');
      const host = 'open.volcengineapi.com';
      const headerOrder = ['host', 'x-date', 'x-content-sha256', 'content-type'];
      const canonicalHeaders =
        'host:' + host + '\n' +
        'x-date:' + xDate + '\n' +
        'x-content-sha256:' + contentHash + '\n' +
        'content-type:application/json\n';
      const signedHeaders = headerOrder.join(';');
      const qKeys = Object.keys(params).sort();
      const canonicalQuery = qKeys.map((k) => pctEncode(k) + '=' + pctEncode(String(params[k]))).join('&');
      const canonicalRequest = method + '\n/\n' + canonicalQuery + '\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + contentHash;
      const credentialScope = dateStamp + '/' + region + '/' + service + '/request';
      const stringToSign = 'HMAC-SHA256\n' + xDate + '\n' + credentialScope + '\n' + sha256hex(canonicalRequest);
      const kDate = hmac(key(secretKey), txt(dateStamp));
      const kRegion = hmac(hexBytes(kDate), txt(region));
      const kService = hmac(hexBytes(kRegion), txt(service));
      const kSigning = hmac(hexBytes(kService), txt('request'));
      const signature = hmac(hexBytes(kSigning), txt(stringToSign));
      const authorization = 'HMAC-SHA256 Credential=' + accessKey + '/' + credentialScope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
      return { authorization, xDate, contentHash };
    }
    function txt(s) { return new TextEncoder().encode(s); }
    function key(s) { return new TextEncoder().encode(s); }
    function hexBytes(h) { const out = new Uint8Array(h.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return out; }
    // note: hmac() below returns hex via hmacSha256hex
    function hmac(kb, mb) { return hmacSha256hex(kb, mb); }

    async function volcesRequest(params, body, region, service, accessKey, secretKey) {
      const signed = volcSign('POST', params, body, accessKey, secretKey, region, service);
      const url = 'https://open.volcengineapi.com/?' + Object.keys(params).map((k) => pctEncode(k) + '=' + pctEncode(String(params[k]))).sort().join('&');
      const res = await http(url, {
        method: 'POST',
        body: body || '',
        headers: [
          ['Authorization', signed.authorization],
          ['x-date', signed.xDate],
          ['x-content-sha256', signed.contentHash],
          ['content-type', 'application/json'],
        ],
      });
      return res;
    }
    function volcesApiKey() {
      const cfg = readCfg();
      return { ak: cfg.volcesAccessKeyId || '', sk: cfg.volcesSecretAccessKey || '' };
    }
    // quota parsing: QuotaUsage row -> {level, Percent, Reset} (cc-switch contract)
    function parseQuotaRows(j) {
      const r0 = j && j.Result ? j.Result : {};
      const rows = Array.isArray(r0.QuotaUsage) ? r0.QuotaUsage : (Array.isArray(r0.Usages) ? r0.Usages : (Array.isArray(r0.Details) ? r0.Details : []));
      const byLevel = {};
      for (const r of rows) {
        if (!r) continue;
        const label = r.Level || r.Type || r.Period || r.Label || r.Window || '';
        if (!label) continue;
        const pct = r.Percent !== undefined ? r.Percent : (r.UsedPercent !== undefined ? r.UsedPercent : r.UsagePercent);
        byLevel[String(label).toLowerCase()] = { percent: num(pct, NaN), reset: r.ResetTime || r.ResetTimestamp || null };
      }
      return byLevel;
    }
    function volcesRespError(j) {
      const e = j && j.ResponseMetadata && j.ResponseMetadata.Error;
      return e ? (e.Message || e.Code || '未知错误') : null;
    }
    async function pollVolcesCoding() {
      const entry = state.volcesCoding = { configured: false, ts: Date.now(), keyConfigured: false };
      try {
        const inferKey = await creds.resolve('VOLCES_API_KEY');
        if (inferKey && inferKey.value) entry.configured = true;
        const { ak, sk } = volcesApiKey();
        entry.keyConfigured = !!(ak && sk);
        if (!ak || !sk) { entry.error = '未配置 AK/SK'; return; }
        const params = { Action: 'GetCodingPlanUsage', Region: 'cn-beijing', Version: '2024-01-01' };
        const res = await volcesRequest(params, '', 'cn-beijing', 'ark', ak, sk);
        if (res.status === 401 || res.status === 403) { entry.error = 'AK/SK 无效或权限不足'; return; }
        if (res.status !== 200) {
          const em = volcesRespError(tryJson(res.body));
          entry.error = em ? ('火山 API 错误 (' + res.status + '): ' + em) : ('HTTP ' + res.status);
          return;
        }
        const j = tryJson(res.body);
        if (!j) { entry.error = '响应解析失败'; return; }
        const em2 = volcesRespError(j);
        if (em2) { entry.error = '火山 API 错误: ' + em2; return; }
        const byLevel = parseQuotaRows(j);
        const five = byLevel['session'] || byLevel['5h'] || byLevel['fivehour'] || byLevel['five_hour'] || byLevel['rolling_5h'];
        const week = byLevel['weekly'] || byLevel['week'] || byLevel['7d'];
        const month = byLevel['monthly'] || byLevel['month'];
        entry.five = five ? pctLeft(five.percent) : null;
        entry.weekly = week ? pctLeft(week.percent) : null;
        entry.monthly = month ? pctLeft(month.percent) : null;
        if (entry.five === null && entry.weekly === null && entry.monthly === null) {
          entry.available = false;
          entry.unsubscribed = true;
          return;
        }
        entry.available = true;
      } catch (e) { entry.error = '接口错误'; }
    }
    async function pollVolcesAgent() {
      const entry = state.volcesAgent = { configured: false, ts: Date.now(), keyConfigured: false };
      try {
        const inferKey = await creds.resolve('VOLCES_API_KEY');
        if (inferKey && inferKey.value) entry.configured = true;
        const { ak, sk } = volcesApiKey();
        entry.keyConfigured = !!(ak && sk);
        if (!ak || !sk) { entry.error = '未配置 AK/SK'; return; }
        const params = { Action: 'GetAFPUsage', Region: 'cn-beijing', Version: '2024-01-01' };
        const res = await volcesRequest(params, '', 'cn-beijing', 'ark', ak, sk);
        if (res.status === 401 || res.status === 403) { entry.error = 'AK/SK 无效或权限不足'; return; }
        if (res.status !== 200) {
          const em = volcesRespError(tryJson(res.body));
          entry.error = em ? ('火山 API 错误 (' + res.status + '): ' + em) : ('HTTP ' + res.status);
          return;
        }
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
        entry.five = norm(r.AFPFiveHour);
        entry.weekly = norm(r.AFPWeekly);
        entry.monthly = norm(r.AFPMonthly);
        entry.available = entry.five !== null || entry.weekly !== null || entry.monthly !== null;
        if (!entry.available) entry.unsubscribed = true;
      } catch (e) { entry.error = '接口错误'; }
    }

    async function pollAll() {
      await Promise.all([pollDeepseek(), pollSiliconflow(), pollOpencode(), pollVolcesCoding(), pollVolcesAgent()]);
    }

    // ----- session tree usage -----
    function computeSessionOnce(rootId, cfg) {
      const ids = [rootId];
      // descendants already enumerated: caller fills ids
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
        try { const snap = projections.snapshot(s); if (snap && snap.values) tu = snap.values.tokenUsage || null; } catch (e) { tu = null; }
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
            if (!buckets[key]) {
              buckets[key] = mk();
              buckets[key].provider = provider;
              buckets[key].model = src.model || '';
            }
            buckets[key].uncachedInput += usage.inputTokens || 0;
            buckets[key].output += usage.outputTokens || 0;
            buckets[key].cacheRead += usage.cacheReadTokens || 0;
            buckets[key].cacheWrite += usage.cacheWriteTokens || 0;
            buckets[key].calls += 1;
            if (!byProvider[cls]) { byProvider[cls] = mk(); byProvider[cls].provider = provider; }
            add(byProvider[cls], { uncachedInput: usage.inputTokens, output: usage.outputTokens, cacheRead: usage.cacheReadTokens, cacheWrite: usage.cacheWriteTokens, calls: 1 });
          }
        } catch (e) { /* skip on log shape issues */ }
      }
      // cost
      const costs = {};
      let costTotal = 0;
      for (const k of Object.keys(buckets)) {
        const b = buckets[k];
        const c = costFor(b.provider, b.model, b, cfg.priceTable || {});
        b.cost = c;
        if (c !== null) {
          const cls = classifyProvider(b.provider);
          costs[cls] = (costs[cls] || 0) + c;
          costTotal += c;
        }
      }
      return { total, buckets, byProvider, costs, costTotal, sessionCount: ids.length };
    }

    async function computeSession(rootId) {
      const ids = [rootId];
      try {
        const descs = await subagents.listDescendants(rootId);
        for (const d of descs || []) if (d && d.kind === 'child' && d.id && d.id !== rootId) ids.push(d.id);
      } catch (e) { /* tree unavailable -> degrade to single session */ }
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
          deepseek: state.deepseek,
          siliconflow: state.siliconflow,
          opencode: state.opencode,
          volcesCoding: state.volcesCoding,
          volcesAgent: state.volcesAgent,
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

    // ----- RPC -----
    harness.handle('getSnapshot', async (args) => {
      const a = args || {};
      return await getSnapshot(typeof a.rootSessionId === 'string' ? a.rootSessionId : null);
    });
    harness.handle('refreshNow', async () => {
      await pollAll();
      return { ok: true, ts: Date.now() };
    });
    harness.handle('setVolcesKeys', async (args) => {
      const a = args || {};
      if (typeof a.volcesAccessKeyId !== 'string' || typeof a.volcesSecretAccessKey !== 'string') return { ok: false, error: 'bad args' };
      if (!settingsOk) { return { ok: false, error: 'settings unavailable' }; }
      try {
        // args arrives host-realm from the wire; passing it directly keeps the
        // patch a host-realm plain object (sandbox-built objects fail the
        // settings service's isPlainObject guard).
        await settings.update('api-monitor', a);
        await Promise.all([pollVolcesCoding(), pollVolcesAgent()]);
        return { ok: true, ts: Date.now() };
      } catch (e) { return { ok: false, error: e && e.message || String(e) }; }
    });
    harness.handle('setTier', async (args) => {
      const a = args || {};
      if (typeof a.volcesTier !== 'string') return { ok: false, error: 'bad args' };
      if (!settingsOk) return { ok: false, error: 'settings unavailable' };
      try { await settings.update('api-monitor', a); return { ok: true }; }
      catch (e) { return { ok: false, error: e && e.message || String(e) }; }
    });
    harness.handle('setEntryVisibility', async (args) => {
      const a = args || {};
      const vis = a.entryVisibility;
      if (!settingsOk || typeof vis !== 'object' || vis === null || Array.isArray(vis)) return { ok: false, error: 'bad args' };
      try { await settings.update('api-monitor', a); return { ok: true }; }
      catch (e) { return { ok: false, error: e && e.message || String(e) }; }
    });
    harness.handle('getConfig', async () => {
      const cfg = readCfg();
      return {
        volcesTier: cfg.volcesTier || 'auto',
        entryVisibility: cfg.entryVisibility || {},
        pollIntervalSeconds: num(cfg.pollIntervalSeconds, 60),
        warnPercent: num(cfg.warnPercent, 70),
        dangerPercent: num(cfg.dangerPercent, 90),
        balanceWarn: num(cfg.balanceWarn, 10),
        volcesKeyConfigured: !!(cfg.volcesAccessKeyId && cfg.volcesSecretAccessKey),
        settingsOk,
      };
    });

    // ----- polling loop -----
    await pollAll();
    const tick = () => { pollAll().catch(() => {}); };
    ctx.interval(() => tick(), Math.max(20, num(readCfg().pollIntervalSeconds, 60)) * 1000);

    console.log('api-monitor host active');
  },
};
