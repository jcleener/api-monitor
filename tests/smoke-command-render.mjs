/**
 * api-monitor × Command GOAT — 客户端渲染 smoke（真实加载 bundle）。
 *
 * 不是在源码里 grep 字符串：本测试伪造 window.__ModuleLoader__ / document / fetch / react，
 * 加载真实的 lib/client.js，取出注册到 `sidebar.footer.action` 的组件，用一套「有状态的」
 * 极小 React 运行时把它渲染成元素树，然后：
 *   - 读元素树的文本（等价于读渲染出的 DOM 文本）断言入口行文案；
 *   - 真的调用入口按钮的 onClick（setOpen）再重渲染，断言浮动面板里的区块文案；
 *   - 真的调用「查看用量」按钮的 onClick，断言它 open 出去的 URL。
 *
 * 相对于 test/smoke-client-current-session.mjs，本文件补充了两处 stub 能力：
 *   1. useState 是**有状态**的（原 smoke 的 setter 是 no-op，永远停在 `open=false`，面板渲染不出来）；
 *   2. 渲染循环会 flush useEffect 并在 setState 后重渲染（否则 fetch 回来的 snapshot 永远进不去）。
 *
 * 断言集（共 15 条，全 PASS 时 exit 0）：(a) 侧边栏入口行文案；(b) 点开后的 Command Code GOAT 区块 +
 * 「查看用量」按钮真的 open；(c) entryVisibility.command=false 隐藏该行；(d) 旧宿主（providers 无
 * command）渲染占位行 `Command GOAT—|—|—` —— Lead 裁定「入口行只看可见性开关、不看 p.command」是
 * 既定设计（对齐 GLM 未配置时的形态），详见 tests/verify-command-ui.md 的「已知限制」；(e) 其他区块无回归。
 *
 * Usage: node test/smoke-command-render.mjs [path-to-client.js]
 * Default target is this repo's own ../lib/client.js.
 * Exit: 0 = all PASS, 1 = at least one FAIL.
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = process.argv[2] ?? path.join(HERE, '..', 'lib', 'client.js')

const results = []
const check = (step, ok, detail = '') => {
  results.push({ step, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? '  — ' + detail : ''}`)
}

// ── browser stubs ───────────────────────────────────────────────────────────
let captured
const fetched = []
const opened = []
let currentSnapshot = {}

// 组件 effect 里挂了 8s 轮询；stub 掉，保证测试确定性（不重复打 fetch、不吊住事件循环）。
const realSetInterval = globalThis.setInterval
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

globalThis.window = {
  __ModuleLoader__: { load: (cfg) => { captured = cfg } },
  addEventListener() {}, removeEventListener() {},
  open(url) { opened.push(String(url)) },
}
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, style: {}, textContent: '' }),
  head: { appendChild() {} },
}
globalThis.fetch = async (u) => {
  fetched.push(String(u))
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(currentSnapshot)) }
}

// ── minimal *stateful* React runtime + element tree model ───────────────────
let hooks = []
let hookIndex = 0
let pendingEffects = []
let dirty = false
let currentProps = null
let tree = null

const react = {
  useState(init) {
    const i = hookIndex++
    if (!hooks[i]) hooks[i] = { value: typeof init === 'function' ? init() : init }
    const slot = hooks[i]
    return [slot.value, (next) => {
      const v = typeof next === 'function' ? next(slot.value) : next
      if (Object.is(v, slot.value)) return
      slot.value = v
      dirty = true
    }]
  },
  useEffect(fn, deps) {
    const i = hookIndex++
    const prev = hooks[i]
    const changed = !prev || !prev.deps || !deps || deps.length !== prev.deps.length ||
      deps.some((d, k) => !Object.is(d, prev.deps[k]))
    hooks[i] = { deps, cleanup: prev ? prev.cleanup : undefined }
    if (changed) pendingEffects.push({ i, fn })
  },
  // Render-through: 函数型 type 直接调用（组件体真的跑），其余保留成元素节点。
  createElement(type, props, ...children) {
    const p = Object.assign({}, props || {})
    if (children.length) p.children = children
    if (typeof type === 'function') return type(p)
    return { el: true, type, props: p }
  },
  Fragment: Symbol('Fragment'),
}

function renderOnce(props) {
  hookIndex = 0
  currentProps = props
  return Component(props)
}

function runEffects() {
  const batch = pendingEffects
  pendingEffects = []
  for (const e of batch) {
    const clean = e.fn()
    if (typeof clean === 'function') hooks[e.i].cleanup = clean
  }
  return batch.length
}

// 渲染 → flush effect → 等微任务（fetch 回来）→ 若 dirty 再渲染，直到稳定。
async function settle(max = 40) {
  for (let i = 0; i < max; i++) {
    const ran = runEffects()
    await new Promise((r) => setTimeout(r, 0))
    if (dirty) { dirty = false; tree = renderOnce(currentProps); continue }
    if (!ran) break
  }
  return tree
}

async function mount(snapshot) {
  currentSnapshot = snapshot
  fetched.length = 0
  opened.length = 0
  hooks = []
  pendingEffects = []
  dirty = false
  tree = null
  const props = { wide: true, useSessions: (selector) => selector({ current: 'session-fixture' }) }
  tree = renderOnce(props)
  return settle()
}

const classOf = (el) => (el && el.props && typeof el.props.className === 'string' ? el.props.className : '')
const isVRow = (el) => classOf(el).split(/\s+/).includes('am-vrow')
const isBlock = (el) => classOf(el).split(/\s+/).includes('am-block')

function walk(node, fn) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, fn); return }
  if (node.el) fn(node)
  const kids = node.props && node.props.children
  if (kids !== undefined) walk(kids, fn)
}
const findAll = (node, pred) => { const out = []; walk(node, (el) => { if (pred(el)) out.push(el) }); return out }
const findByClass = (node, cls) => findAll(node, (el) => classOf(el).split(/\s+/).includes(cls))[0]

// 元素树 → 文本（等价于 DOM 的 textContent 拼接）。
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props ? node.props.children : undefined)
}

async function click(el) {
  const fn = el && el.props && el.props.onClick
  if (typeof fn !== 'function') throw new Error('element has no onClick')
  fn({ stopPropagation() {} })
  await settle()
}

// 渲染到「入口」状态（未点开）。
async function renderEntry(snapshot) {
  const out = { error: null, entryEl: null }
  try {
    await mount(snapshot)
    out.entryEl = findByClass(tree, 'am-vblock')
    out.entryText = out.entryEl ? textOf(out.entryEl) : ''
  } catch (e) { out.error = e; out.entryText = '' }
  return out
}

// 渲染并真的点开入口，拿到浮动面板。
async function renderPanel(snapshot) {
  const out = { error: null, entryEl: null, panelEl: null, panelText: '', commandBlock: null, commandBlockText: '' }
  try {
    await mount(snapshot)
    out.entryEl = findByClass(tree, 'am-vblock')
    await click(out.entryEl)
    out.panelEl = findByClass(tree, 'am-panel')
    out.panelText = out.panelEl ? textOf(out.panelEl) : ''
    out.commandBlock = out.panelEl
      ? findAll(out.panelEl, isBlock).find((el) => textOf(el).includes('Command Code GOAT'))
      : null
    out.commandBlockText = out.commandBlock ? textOf(out.commandBlock) : ''
  } catch (e) { out.error = e }
  return out
}

// ── load + apply the real bundle ────────────────────────────────────────────
let Component
try {
  await import(pathToFileURL(CLIENT).href + '?smoke=' + Date.now())
  check('load: bundle registered through window.__ModuleLoader__', !!captured, captured?.id ?? '')
  const mod = captured?.factory((id) => (id === 'react' ? react : {}))
  check('factory: materialized with stubbed require()', typeof mod?.apply === 'function')

  const regs = []
  const injections = []
  mod.apply({
    inject(deps, cb) { return cb({ slots: { inject: (k, c) => { injections.push(k); return c() }, register: (o, c) => { regs.push({ o, c }); return () => {} } } }) },
    effect: (fn) => fn(),
  })
  check('apply: injected sidebar.footer.action', injections.includes('sidebar.footer.action'))
  Component = regs[0]?.c
  check('apply: registration carries a renderable component', typeof Component === 'function')
} catch (error) {
  check('load + apply chain', false, String(error?.message ?? error))
}

// ── fixtures（自带固定数据，不依赖线上快照） ─────────────────────────────────
const COMMAND_GOAT = {
  five: 98.18, weekly: 99.27, monthly: 99.64, plan: 'GOAT',
  monthlyCap: 70, monthlyCredits: 69.745,
  available: true, configured: true, stale: false,
}
const VIS = { deepseek: true, glm: false, opencodeGo: false, command: true, qwen: false, volcesCoding: true, volcesAgent: false }
// 新增 command 之前的旧 schema：key 列表里没有 command。
const VIS_OLD_HOST = { deepseek: true, glm: false, opencodeGo: false, qwen: false, volcesCoding: true, volcesAgent: false }

function snapshotWith({ command = COMMAND_GOAT, entryVisibility = VIS, commandInProviders = true } = {}) {
  const providers = {
    deepseek: { configured: true, available: true, stale: false, balance: 84.74, currency: 'CNY' },
    glm: { configured: true, stale: false, level: 'Max', five: 88, weekly: 77, monthly: 66 },
    opencode: { configured: true, stale: false, rolling: 55, weekly: 44, monthly: 33 },
    volcesCoding: { keyConfigured: true, stale: false, five: 0, weekly: 79.77, monthly: 63.94 },
    volcesAgent: { keyConfigured: true, stale: false, five: 12, weekly: 34, monthly: 56 },
  }
  if (commandInProviders) providers.command = command
  return {
    ts: 1790789670656,
    providers,
    session: { total: { uncachedInput: 0, output: 0, cacheRead: 0, calls: 0 }, byProvider: {}, costs: {} },
    config: { entryVisibility, warnPercent: 70, dangerPercent: 90, balanceWarn: 10, showCacheHitRate: true, volcesTier: 'auto' },
  }
}

// ── (a) 侧边栏入口 ──────────────────────────────────────────────────────────
{
  const r = await renderEntry(snapshotWith())
  check('a1 侧边栏入口渲染出 "Command GOAT"',
    r.error === null && r.entryText.includes('Command GOAT'),
    r.error ? String(r.error.message) : r.entryText)

  const row = r.entryEl ? findAll(r.entryEl, isVRow).find((el) => textOf(el).includes('Command GOAT')) : null
  check('a2 该入口行带出 "98%|99%|100%"',
    !!row && textOf(row).includes('98%|99%|100%'),
    row ? textOf(row) : '(未找到 Command GOAT 行)')
}

// ── (b) 点开入口后的面板区块 ────────────────────────────────────────────────
{
  const r = await renderPanel(snapshotWith())
  // 注意实际渲染值：usdCredits() 对 cap 也做 toFixed(2)，所以是 "$69.75 / $70.00"。
  const want = [
    'Command Code GOAT', '套餐档位', 'GOAT', '用量剩余',
    '5小时 98% / 1周 99% / 1月 100%', '月度额度 (USD)', '$69.75 / $70.00', '查看用量',
  ]
  const missing = want.filter((w) => !r.panelText.includes(w))
  check('b1 点开入口后面板出现全部 8 条文案',
    r.error === null && missing.length === 0,
    r.error ? String(r.error.message) : (missing.length ? '缺少: ' + missing.join(' | ') : `8/8 — "${r.panelText}"`))

  const inBlock = r.commandBlockText
  const blockMissing = want.filter((w) => !inBlock.includes(w))
  check('b2 这些文案落在 "Command Code GOAT" 区块内（不是别处区块的文案）',
    !!r.commandBlock && blockMissing.length === 0,
    r.commandBlock ? (blockMissing.length ? '缺少: ' + blockMissing.join(' | ') : `"${inBlock}"`) : '(未找到区块)')

  // 真实驱动区块里的按钮，验证 onClick 真的能 open 出去。
  const btn = r.commandBlock ? findAll(r.commandBlock, (el) => el.type === 'button' && textOf(el) === '查看用量')[0] : null
  let openedUrl = ''
  try { await click(btn) } catch (e) { openedUrl = 'click-error: ' + String(e.message) }
  check('b3 "查看用量" 按钮点下去真的 open commandcode.ai/studio',
    opened.length === 1 && opened[0] === 'https://commandcode.ai/studio',
    openedUrl || JSON.stringify(opened))
}

// ── (c) entryVisibility.command = false ─────────────────────────────────────
{
  const r = await renderEntry(snapshotWith({ entryVisibility: Object.assign({}, VIS, { command: false }) }))
  check('c1 command=false 时侧边栏不出现 "Command GOAT"',
    r.error === null && !r.entryText.includes('Command GOAT'),
    r.error ? String(r.error.message) : r.entryText)
  check('c2 只隐藏 command，不影响 DeepSeek 行',
    r.error === null && r.entryText.includes('DeepSeek'),
    r.error ? String(r.error.message) : r.entryText)
}

// ── (d) 旧宿主形态：providers 里完全没有 command ─────────────────────────────
// Lead 裁定（第 2 轮）：入口行的门槛只看可见性开关（`vis.command !== false`），不看 p.command
// 是否存在 —— 这是**既定设计**，对齐 GLM/OpenCode/火山「未配置也渲染占位行，靠面板勾选隐藏」。
// 所以这里断言的是「渲染占位行」这个实际且期望的行为，而不是早期写错的「不出现该行」。
{
  const r = await renderEntry(snapshotWith({ commandInProviders: false, entryVisibility: VIS_OLD_HOST }))
  check('d1 旧宿主（providers/entryVisibility 都没有 command）不抛异常',
    r.error === null,
    r.error ? String(r.error.message) : '组件正常返回元素树')
  const row = r.entryEl ? findAll(r.entryEl, isVRow).find((el) => textOf(el).includes('Command GOAT')) : null
  const rowText = row ? textOf(row) : ''
  check('d2 旧宿主渲染 "Command GOAT" 占位行 —|—|—（与 GLM 未配置同形态，非缺陷）',
    r.error === null && rowText === 'Command GOAT—|—|—',
    r.error ? String(r.error.message) : (rowText || '(未找到 Command GOAT 行)'))
}

// ── (e) 其他区块不回归 ──────────────────────────────────────────────────────
{
  const r = await renderEntry(snapshotWith())
  const gone = ['GLM Plan', 'OpenCode Go', 'Qwen Plan'].filter((s) => r.entryText.includes(s))
  check('e1 glm/opencodeGo/qwen=false → "GLM Plan"/"OpenCode Go"/"Qwen Plan" 都不出现',
    r.error === null && gone.length === 0,
    r.error ? String(r.error.message) : (gone.length ? '仍出现: ' + gone.join(' | ') : r.entryText))
  check('e2 deepseek 与 火山 Coding 仍在',
    r.error === null && r.entryText.includes('DeepSeek') && r.entryText.includes('火山 Coding'),
    r.error ? String(r.error.message) : r.entryText)
}

// ── summary ─────────────────────────────────────────────────────────────────
globalThis.setInterval = realSetInterval
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ` — ${failed.length} FAIL` : ''}`)
process.exit(failed.length ? 1 : 0)
