/**
 * api-monitor × Command Code（command goat）—「三个周期用量」折算回归。
 *
 * 覆盖两件事：
 *  1. 纯函数 `commandReadings()` 对 `/alpha/billing/credits` 真实响应形态的折算是否正确
 *     —— 5 小时 / 1 周 / 1 月三个窗口都要出「剩余 %」，且 GLM 面板同口径（展示剩余）。
 *  2. 月度上限靠 (5h cap, 周 cap) 反查套餐档位：GOAT = $14/$35 → 月度 $70。
 *     同时锁定官方各档位的原始数字（文档 pricing-limits），避免表被改错。
 *
 * 默认走真实接口（读 ~/.dsh/.credentials.yaml 的 COMMAND_API_KEY）；
 * 拿不到 key 时只跑内置 fixture，不失败。
 *
 * Usage: node test/smoke-command-credits.mjs
 * Exit: 0 = all PASS, 1 = at least one FAIL.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOST = path.join(HERE, '..', 'lib', 'index.js')

// 宿主半 import 了 @deepseek-ai/schemastery（只在 DSH 实例里可解析）；这里换成
// 「怎么链都返回自己」的替身，好让本测试能在裸 node 下直接跑纯函数。
const STUB = pathToFileURL(path.join(HERE, '_schemastery-stub.mjs')).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/schemastery') return { url: STUB, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const results = []
const check = (step, ok, detail = '') => {
  results.push({ step, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? '  — ' + detail : ''}`)
}

const { __test } = await import(pathToFileURL(HOST).href)
const { commandReadings, commandPlan, applyCommandReadings, COMMAND_PLANS } = __test

// ── 1. 档位表本身（官方 pricing-limits 的原始数字） ─────────────────────────
const EXPECTED_PLANS = [
  ['Go', 2, 5, 10],
  ['Team Pro', 12, 24, 40],
  ['GOAT', 14, 35, 70],
  ['Pro', 16, 40, 80],
  ['Max 10x', 45, 90, 150],
  ['Max 20x', 90, 180, 300],
]
check('档位表与官方文档一致', EXPECTED_PLANS.every(([n, f, w, m], i) => {
  const p = COMMAND_PLANS[i]
  return p && p.name === n && p.five === f && p.weekly === w && p.monthly === m
}), `${COMMAND_PLANS.length} 档`)

for (const [name, five, weekly, monthly] of EXPECTED_PLANS) {
  const p = commandPlan(five, weekly)
  check(`反查档位 ${name}`, p !== null && p.name === name && p.monthly === monthly, p ? `→ ${p.name}/${p.monthly}` : '→ null')
}
check('周 cap 缺失时仍能按 5h cap 反查', commandPlan(90, undefined)?.name === 'Max 20x')
check('未知上限不硬猜档位', commandPlan(7, 17) === null && commandPlan(0, 0) === null)

// ── 2. GOAT 真实响应形态的折算 ──────────────────────────────────────────────
const GOAT_FIXTURE = {
  credits: { belowThreshold: false, creditThreshold: 0, monthlyCredits: 69.968508491, purchasedCredits: 0, freeCredits: 0 },
  windowLimits: {
    limited: true,
    exceeded: null,
    fiveHour: { used: 0.031491509, cap: 14, exceeded: false, resetAt: 1790806291494 },
    weekly: { used: 0.031491509, cap: 35, exceeded: false, resetAt: 1791393091494 },
  },
  sandboxAccess: false,
  sandboxMinutes: null,
}
const r = commandReadings(GOAT_FIXTURE, 0, null)
check('GOAT → 档位', r.plan === 'GOAT', String(r.plan))
check('GOAT → 月度上限 70', r.monthlyCap === 70, String(r.monthlyCap))
check('GOAT → 5 小时剩余 ≈ 99.78%', Math.abs(r.five - (100 - (0.031491509 / 14) * 100)) < 1e-9, String(r.five))
check('GOAT → 1 周剩余 ≈ 99.91%', Math.abs(r.weekly - (100 - (0.031491509 / 35) * 100)) < 1e-9, String(r.weekly))
check('GOAT → 1 月剩余 ≈ 99.955%', Math.abs(r.monthly - (100 - (0.031491509 / 70) * 100)) < 1e-9, String(r.monthly))
check('三个窗口都在 [0,100]', [r.five, r.weekly, r.monthly].every((v) => v !== null && v >= 0 && v <= 100))
check('重置时刻按 ms 原样带出', r.fiveResetAt === 1790806291494 && r.weeklyResetAt === 1791393091494)

// 用尽 / 超额要夹到 0，不能出现负数
const drained = commandReadings({ credits: { monthlyCredits: 0 }, windowLimits: { fiveHour: { used: 20, cap: 14 }, weekly: { used: 40, cap: 35 } } }, 0, null)
check('超额夹到 0%', drained.five === 0 && drained.weekly === 0 && drained.monthly === 0, `${drained.five}/${drained.weekly}/${drained.monthly}`)

// 配置覆盖压过档位反查：把上限当成 $140，剩余额不变 → 剩余 % = 69.9685/140。
const overridden = commandReadings(GOAT_FIXTURE, 140, null)
check('commandMonthlyCap 覆盖生效', overridden.monthlyCap === 140 && Math.abs(overridden.monthly - (69.968508491 / 140) * 100) < 1e-9, `${overridden.monthlyCap} → ${overridden.monthly}%`)

// 档位认不出 + 无配置 → 走 summary 兜底（spent / (spent + remaining)）
const unknown = { credits: { monthlyCredits: 40, purchasedCredits: 5, freeCredits: 0 }, windowLimits: { fiveHour: { used: 1, cap: 7 }, weekly: { used: 1, cap: 17 } } }
check('认不出档位时首轮不给月度值', commandReadings(unknown, 0, null).monthly === null)
check('认不出档位时 summary 兜底可用', commandReadings(unknown, 0, 5).monthly === 90, String(commandReadings(unknown, 0, 5).monthly))
check('字段全缺时不抛错、全 null', (() => {
  const e = commandReadings({}, 0, null)
  return e.five === null && e.weekly === null && e.monthly === null && e.plan === null && e.monthlyCap === null
})())

// ── 3. stale-while-revalidate：失败的那一轮不得覆写上次成功的读数 ─────────────
// 回归锁：曾经 pollCommand 先做 Object.assign(entry, r)，而 commandReadings 永远带
// five/weekly/monthly 三个键，于是「无配额字段」的一轮会把上次成功的数字清成 null，
// 面板出现「提示显示上次数据、数值却是 —」的矛盾状态。
const goodRound = commandReadings(GOAT_FIXTURE, 0, null)
const emptyRound = commandReadings({}, 0, null)
const entry = { configured: true, stale: true, five: 1, weekly: 2, monthly: 3, plan: 'GOAT', monthlyCap: 70, monthlyCredits: 9, lastGoodTs: 12345 }
check('全空的一轮不落盘', applyCommandReadings(entry, emptyRound) === false)
check('全空的一轮保留上次三个数值', entry.five === 1 && entry.weekly === 2 && entry.monthly === 3, `${entry.five}/${entry.weekly}/${entry.monthly}`)
check('全空的一轮保留档位与上次获取时刻', entry.plan === 'GOAT' && entry.monthlyCap === 70 && entry.monthlyCredits === 9 && entry.lastGoodTs === 12345 && entry.stale === true)
check('有效的一轮会落盘并解除 stale', applyCommandReadings(entry, goodRound) === true
  && entry.five === goodRound.five && entry.weekly === goodRound.weekly && entry.monthly === goodRound.monthly
  && entry.plan === 'GOAT' && entry.monthlyCap === 70 && entry.available === true && entry.stale === false && entry.lastGoodTs > 12345)
// 只认得出 5h/周两个窗口（档位未知 + summary 无数据）仍算有效轮：monthly 落 null 是正常的。
const partial = commandReadings(unknown, 0, null)
const partialEntry = { five: 9, weekly: 9, monthly: 9, plan: 'X' }
check('部分窗口有效时也算有效轮', applyCommandReadings(partialEntry, partial) === true
  && partialEntry.five === partial.five && partialEntry.weekly === partial.weekly && partialEntry.monthly === null && partialEntry.plan === null)

// ── 4. 真实接口（可选） ─────────────────────────────────────────────────────
function readApiKey() {
  const p = path.join(os.homedir(), '.dsh', '.credentials.yaml')
  try {
    const m = fs.readFileSync(p, 'utf8').match(/COMMAND_API_KEY:\s*(\S+)/)
    return m ? m[1] : null
  } catch { return null }
}
const key = readApiKey()
if (key === null) {
  console.log('SKIP  真实接口（~/.dsh/.credentials.yaml 里没有 COMMAND_API_KEY）')
} else {
  try {
    const res = await fetch('https://api.commandcode.ai/alpha/billing/credits', {
      headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
    })
    check('真实接口 HTTP 200', res.status === 200, 'HTTP ' + res.status)
    const live = commandReadings(await res.json(), 0, null)
    check('真实响应能算出 5 小时窗口', live.five !== null, `${live.five}%`)
    check('真实响应能算出 1 周窗口', live.weekly !== null, `${live.weekly}%`)
    check('真实响应能算出 1 月窗口', live.monthly !== null, `${live.monthly}%`)
    check('真实响应认出了档位', live.plan !== null, `${live.plan} · 月度上限 $${live.monthlyCap} · 剩余 $${live.monthlyCredits}`)
  } catch (e) {
    check('真实接口可访问', false, e instanceof Error ? e.message : String(e))
  }
}

const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
process.exit(failed.length === 0 ? 0 : 1)
