/**
 * `@deepseek-ai/schemastery` 的最小替身，仅供 node 直跑宿主半的 smoke 用。
 *
 * `lib/index.js` 在模块求值期只会用它声明一次 schema（`z.object({...})` 里嵌
 * `z.string().default('').role('secret')` 之类的链式调用），运行期不解析、不校验。
 * 所以这里给一个「怎么链都返回自己」的可调用 Proxy 就够了——测试只取 `__test` 里的纯函数。
 */
const chain = new Proxy(function () {}, {
  get: () => chain,
  apply: () => chain,
  construct: () => chain,
});

export default chain;
