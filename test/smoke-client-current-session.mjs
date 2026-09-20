/**
 * api-monitor × DSH 0.1.6-alpha.2 — "current session" derivation smoke.
 *
 * Regression lock for the silent break: `SessionListState.current` was removed in
 * 0.1.6, so `useSessions((s) => s.current)` returned undefined forever, `root` was
 * dropped from the /api-monitor/snapshot request, and the host answered the
 * all-zero session branch (balance fine, token/cost always 0).
 *
 * This harness loads the real bundle through a stubbed `window.__ModuleLoader__`,
 * renders the registered sidebar component with a faked `useSessions`, and reads
 * the URL the component actually fetches — so it asserts the outgoing `root`, not
 * just the source text.
 *
 * Usage: node test/smoke-client-current-session.mjs [path-to-client.js]
 * Default target is this repo's own ../lib/client.js.
 * Exit: 0 = all PASS, 1 = at least one FAIL.
 */
import fs from 'node:fs'
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

globalThis.window = {
  __ModuleLoader__: { load: (cfg) => { captured = cfg } },
  addEventListener() {}, removeEventListener() {}, open() {},
}
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, style: {}, textContent: '' }),
  head: { appendChild() {} },
}
globalThis.fetch = async (u) => {
  fetched.push(String(u))
  return { ok: true, status: 200, json: async () => ({}) }
}

// ── minimal React hook runtime ──────────────────────────────────────────────
const rt = { effects: [] }
const react = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: (fn) => { rt.effects.push(fn) },
  // Render-through: calling createElement with a component invokes it, so the
  // component body (and its selector call) really runs.
  createElement: (type, props) => (typeof type === 'function' ? type(props || {}) : { type, props }),
  Fragment: Symbol('Fragment'),
}

// ── load + apply ────────────────────────────────────────────────────────────
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
  const entry = regs[0]
  check('apply: registered id=api-monitor order=-20', entry?.o?.id === 'api-monitor' && entry?.o?.order === -20, JSON.stringify(entry?.o))
  Component = entry?.c
  check('apply: registration carries a renderable component', typeof Component === 'function')
} catch (error) {
  check('load + apply chain', false, String(error?.message ?? error))
}

// ── drive the component and read the outgoing request ───────────────────────
async function renderWith(snapshot) {
  fetched.length = 0
  rt.effects.length = 0
  const props = { wide: true, useSessions: (selector) => selector(snapshot) }
  Component(props)
  for (const fn of rt.effects) fn()
  await new Promise((r) => setTimeout(r, 0))
  return fetched[0] ?? ''
}

const rootOf = (url) => {
  try { return new URL(url, 'http://x/').searchParams.get('root') } catch { return null }
}

// 1. 0.1.5 shape — plain backward compatibility
{
  const url = await renderWith({ current: 'session-legacy' })
  check('0.1.5 shape {current} → root=session-legacy', rootOf(url) === 'session-legacy', url)
}

// 2. 0.1.6 shape — the shipped mainSessionId() expression (retainedBy.mainView)
{
  const url = await renderWith({
    ids: ['session-a', 'session-b'],
    byId: {
      'session-a': { id: 'session-a', retainedBy: { gateway: 1 } },
      'session-b': { id: 'session-b', retainedBy: { mainView: 1 } },
    },
  })
  check('0.1.6 shape {byId[*].retainedBy.mainView} → root=session-b', rootOf(url) === 'session-b', url)
}

// 3. live but not yet listed in `ids` → the byId fallback still finds it
{
  const url = await renderWith({ ids: [], byId: { 'session-live': { retainedBy: { mainView: 2 } } } })
  check('0.1.6 shape with empty `ids` → byId fallback finds mainView', rootOf(url) === 'session-live', url)
}

// 4. mainView count 0 must NOT be treated as current
{
  const url = await renderWith({ ids: ['session-x'], byId: { 'session-x': { retainedBy: { mainView: 0 } } } })
  check('0.1.6 shape with mainView=0 → no root sent (host zero-branch is honest)', rootOf(url) === null, url || '(no request)')
}

// 5. no snapshot at all — must not throw
{
  const url = await renderWith(null)
  check('null snapshot → no throw, no root', rootOf(url) === null, url || '(no request)')
}

// 6. the request itself is still the snapshot route
{
  const url = await renderWith({ current: 'session-legacy' })
  check('request path is /api-monitor/snapshot', url.startsWith('/api-monitor/snapshot'), url)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? ` — ${failed.length} FAIL` : ''}`)
process.exit(failed.length ? 1 : 0)