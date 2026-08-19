/* api-monitor — Client half. Pure JS + React.createElement. */
'use strict';

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots');
    const timer = ctx.get('timer');
    if (slots === undefined) return;

    styles.insert(`
      .am-vblock { display:flex; flex-direction:column; gap:2px; width:100%; padding:5px 10px; border-radius:9px; box-sizing:border-box;
        border:1px solid var(--dsw-alias-border-l2,#333); background:var(--dsw-alias-button-ghost-hover,#2a2a2a); cursor:pointer; }
      .am-vblock:hover { background:var(--dsw-alias-interactive-bg-hover,#333); }
      .am-vhead { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600; color:var(--dsw-alias-label-primary,#eee); margin-bottom:1px; }
      .am-vrow { display:flex; align-items:center; gap:6px; font-size:11px; line-height:1.7; color:var(--dsw-alias-label-secondary,#bbb); }
      .am-vlbl { color:var(--dsw-alias-label-tertiary,#999); flex:none; }
      .am-vval { margin-left:auto; color:var(--dsw-alias-label-primary,#eee); font-variant-numeric:tabular-nums; }
      .am-dot { width:7px; height:7px; border-radius:50%; flex:none; }
      .am-dot-green { background:var(--dsw-alias-state-success-primary,#34c759); } .am-dot-yellow { background:var(--dsw-alias-state-warn-label,#ffcc00); } .am-dot-red { background:var(--dsw-alias-state-error-primary,#ff3b30); } .am-dot-dim { background:var(--dsw-alias-label-quaternary,#555); }
      .am-iconbtn { display:flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:50%; border:none;
        background:transparent; color:var(--dsw-alias-label-secondary,#bbb); font-size:15px; cursor:pointer; flex:none; }
      .am-iconbtn:hover { background:var(--dsw-alias-interactive-bg-hover,#333); color:var(--dsw-alias-label-primary,#eee); }
      .am-cv { color:var(--dsw-alias-label-primary,#eee); font-variant-numeric:tabular-nums; overflow:hidden; text-overflow:ellipsis; }
      /* wide sidebar footArea: stack footer.action entries vertically so api-monitor sits ABOVE the Cordis button */
      .hHd-Xa_root:not(.hHd-Xa_collapsed) .hHd-Xa_footerActions { flex-direction: column; align-items: stretch; }
      .am-backdrop { position:fixed; inset:0; z-index:20; background:rgba(0,0,0,.25); }
      /* window styled like the Cordis plugin panel (menu surface + lv3 shadow + 44px header) */
      .am-panel { position:fixed; left:12px; bottom:108px; z-index:21; width:420px; max-width:calc(100vw - 24px);
        background:var(--dsw-specific-menu,#1e1e1e); border:1px solid var(--dsw-alias-border-inverted,#333); border-radius:12px;
        box-shadow:var(--dsw-shadow-lv3,0 14px 44px rgba(0,0,0,.5)); display:flex; flex-direction:column; max-height:60vh; overflow:hidden; }
      .am-panelhead { box-sizing:border-box; flex:none; display:flex; justify-content:space-between; align-items:center; gap:8px; min-height:44px; padding:10px 12px; }
      .am-panelhead .t { font-size:14px; font-weight:500; line-height:20px; color:var(--dsw-alias-label-primary,#eee); }
      .am-panelhead .x { width:28px; height:28px; color:var(--dsw-alias-label-tertiary,#999); cursor:pointer; border:none; background:transparent;
        border-radius:999px; display:inline-flex; align-items:center; justify-content:center; font-size:14px; line-height:1; }
      .am-panelhead .x:hover { background:var(--dsw-alias-interactive-bg-hover,#333); color:var(--dsw-alias-label-primary,#eee); }
      .am-panelbody { flex:1; min-height:0; padding:0 12px 12px; overflow-y:auto; }
      .am-title { font-weight:600; font-size:12px; color:var(--dsw-alias-label-primary,#eee); margin-bottom:2px; }
      .am-block { border-top:1px solid var(--dsw-alias-border-l2,#2a2a2a); margin-top:6px; padding-top:6px; }
      .am-block:first-child { border-top:none; margin-top:0; padding-top:0; }
      .am-row { display:flex; justify-content:space-between; gap:8px; line-height:1.6; }
      .am-row .k { color:var(--dsw-alias-label-tertiary,#999); } .am-row .v { color:var(--dsw-alias-label-primary,#eee); font-variant-numeric:tabular-nums; }
      .am-err { color:var(--dsw-alias-state-warn-label,#ff9f0a); font-size:11px; margin-top:2px; }
      .am-actions { display:flex; gap:8px; align-items:center; margin-top:8px; flex-wrap:wrap; }
      .am-btn { background:var(--dsw-alias-button-ghost-hover,#2a2a2a); border:1px solid var(--dsw-alias-border-l2,#3a3a3a);
        color:var(--dsw-alias-label-primary,#eee); border-radius:7px; padding:4px 10px; font-size:12px; cursor:pointer; }
      .am-btn:hover { background:var(--dsw-alias-interactive-bg-hover,#333); }
      .am-btn.primary { background:var(--dsw-alias-state-business-primary,#0a84ff); border-color:var(--dsw-alias-state-business-primary,#0a84ff); color:#fff; }
      .am-select { background:var(--dsw-alias-button-ghost-hover,#2a2a2a); color:var(--dsw-alias-label-primary,#eee);
        border:1px solid var(--dsw-alias-border-l2,#3a3a3a); border-radius:7px; padding:3px 6px; font-size:12px; }
      .am-input { background:var(--dsw-alias-button-ghost-hover,#2a2a2a); color:var(--dsw-alias-label-primary,#eee);
        border:1px solid var(--dsw-alias-border-l2,#3a3a3a); border-radius:7px; padding:4px 6px; font-size:12px; width:150px; }
      .am-chkrow { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--dsw-alias-label-tertiary,#aaa); cursor:pointer; }
      .am-cfgform { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
      .am-foot { display:flex; justify-content:space-between; align-items:center; margin-top:8px; }
      .am-ts { color:var(--dsw-alias-label-quaternary,#888); font-size:10px; }
    `);

    function fmtN(usage) {
      return { tin: usage && usage.uncachedInput || 0, cout: usage && usage.cacheRead || 0, tout: usage && usage.output || 0, calls: usage && usage.calls || 0 };
    }
    function fmtTokens(n) {
      const v = n || 0;
      if (v >= 1e7) return Math.round(v / 1e6) + 'm';
      if (v >= 1e5) return Math.round(v / 1e3) + 'k';
      return String(v);
    }
    function tokenRow(u) { const t = fmtN(u); return ('输入 ' + fmtTokens(t.tin) + ' · 缓存读 ' + fmtTokens(t.cout) + ' · 输出 ' + fmtTokens(t.tout)); }
    function pctStr(v) { return v === null || v === undefined ? '—' : Math.round(v) + '%'; }
    function numv(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

    function ApiMonitor(props) {
      const currentId = props.sessionId || (props.useSessions ? props.useSessions((s) => s && s.current) : null) || null;
      const [snap, setSnap] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [keyForm, setKeyForm] = React.useState(null);
      const [ak, setAk] = React.useState('');
      const [sk, setSk] = React.useState('');
      const [loadKey, setLoadKey] = React.useState(0);

      React.useEffect(() => {
        let disposed = false;
        const load = () => {
          host.call('getSnapshot', { rootSessionId: currentId }).then((v) => { if (!disposed && v) setSnap(v); }).catch(() => {});
        };
        load();
        const clean = timer ? timer.interval(() => load(), 8000) : null;
        return () => { disposed = true; if (clean) clean(); };
      }, [currentId, loadKey]);

      React.useEffect(() => {
        host.call('getConfig', {}).then((c) => { if (c) setCfg(c); }).catch(() => {});
      }, [loadKey]);
      const [cfg, setCfg] = React.useState(null);

      const refreshNow = () => {
        setBusy(true);
        host.call('refreshNow', {}).then(() => { host.call('getSnapshot', { rootSessionId: currentId }).then(setSnap).catch(() => {}); })
          .catch(() => {}).finally(() => setBusy(false));
      };
      const saveTier = (tier) => { host.call('setTier', { volcesTier: tier }).then(() => setLoadKey((x) => x + 1)).catch(() => {}); };
      const setVisibility = (block, value) => {
        const nextVis = Object.assign({}, vis, { [block]: value });
        host.call('setEntryVisibility', { entryVisibility: nextVis }).then(() => setLoadKey((x) => x + 1)).catch(() => {});
      };
      const saveKeys = () => {
        if (!ak || !sk) return;
        setBusy(true);
        host.call('setVolcesKeys', { volcesAccessKeyId: ak, volcesSecretAccessKey: sk }).then(() => { setKeyForm(null); setAk(''); setSk(''); setLoadKey((x) => x + 1); }).catch(() => {}).finally(() => setBusy(false));
      };

      const vis = (snap && snap.config && snap.config.entryVisibility) || {};
      const cfgDefaults = { warnPercent: 70, dangerPercent: 90, balanceWarn: 10, showCacheHitRate: true, showResetTime: false, volcesTier: 'auto' };
      const C = snap && snap.config ? snap.config : cfgDefaults;
      const p = (snap && snap.providers) || {};
      const balClass = (b) => (b === null || b === undefined ? 'var(--dsw-alias-label-quaternary,#888)' : (b < numv(C.balanceWarn, 10) ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)'));
      const session = (snap && snap.session) || { total: {}, byProvider: {}, costs: {}, costTotal: 0, buckets: {} };
      const byp = session.byProvider || {};
      const sTot = session.total || {};
      const deepTok = byp.deepseek || {};
      const sfTok = byp.siliconflow || {};
      const ocTok = byp.opencode || {};
      const vcTok = byp.volces || {};

      function keyConfigBtn(which) { return React.createElement('button', { className: 'am-btn', onClick: (e) => { e.stopPropagation(); setKeyForm(which); } }, 'key配置'); }
      function blockTitle(txt, onClickVis, shown) {
        return React.createElement('div', { className: 'am-row' },
          React.createElement('span', { className: 'am-title' }, txt),
          React.createElement('label', { className: 'am-chkrow' },
            React.createElement('input', { type: 'checkbox', checked: shown !== false, onChange: (e) => onClickVis(e.target.checked) }),
            '显示在入口'));
      }
      function cacheHit(t) { const denom = (t.uncachedInput || 0) + (t.cacheRead || 0); if (!denom) return 0; return Math.round((t.cacheRead || 0) / denom * 100); }

      const wide = props.wide !== false;
      const dot = (cls) => React.createElement('span', { className: 'am-dot ' + cls });
      const balDot = (e) => (e && e.balance !== undefined ? (e.balance < numv(C.balanceWarn, 10) ? 'am-dot-red' : 'am-dot-green') : 'am-dot-dim');
      const pctDot = (vals) => {
        const vs = (vals || []).filter((v) => v !== null && v !== undefined);
        if (!vs.length) return 'am-dot-dim';
        const worst = Math.max.apply(null, vs);
        if (worst >= numv(C.dangerPercent, 90)) return 'am-dot-red';
        if (worst >= numv(C.warnPercent, 70)) return 'am-dot-yellow';
        return 'am-dot-green';
      };
      const vrows = [];
      if (vis.deepseek !== false) {
        const b = p.deepseek && p.deepseek.balance;
        vrows.push(React.createElement('div', { className: 'am-vrow', key: 'ds' },
          dot(balDot(p.deepseek)),
          React.createElement('span', { className: 'am-vlbl' }, 'DeepSeek'),
          React.createElement('span', { className: 'am-vval' }, b !== undefined ? '¥' + b.toFixed(2) : (p.deepseek && p.deepseek.error ? '—' : '…'))));
      }
      if (vis.siliconflow !== false) {
        const b = p.siliconflow && p.siliconflow.balance;
        vrows.push(React.createElement('div', { className: 'am-vrow', key: 'sf' },
          dot(balDot(p.siliconflow)),
          React.createElement('span', { className: 'am-vlbl' }, 'SiliconFlow'),
          React.createElement('span', { className: 'am-vval' }, b !== undefined ? '¥' + b.toFixed(2) : (p.siliconflow && p.siliconflow.error ? '—' : '…'))));
      }
      if (vis.opencodeGo !== false) {
        const oc = p.opencode || {};
        vrows.push(React.createElement('div', { className: 'am-vrow', key: 'oc' },
          dot(pctDot([oc.rolling, oc.weekly, oc.monthly])),
          React.createElement('span', { className: 'am-vlbl' }, 'OpenCode Go'),
          React.createElement('span', { className: 'am-vval' }, (oc.rolling !== null || oc.weekly !== null || oc.monthly !== null)
            ? (pctStr(oc.rolling) + '|' + pctStr(oc.weekly) + '|' + pctStr(oc.monthly))
            : (oc.error ? '—' : '…'))));
      }
      if (vis.volcesCoding !== false) {
        const vc = p.volcesCoding || {};
        vrows.push(React.createElement('div', { className: 'am-vrow', key: 'vc' },
          dot(pctDot([vc.five, vc.weekly, vc.monthly])),
          React.createElement('span', { className: 'am-vlbl' }, '火山 Coding'),
          React.createElement('span', { className: 'am-vval' }, (vc.five !== null || vc.weekly !== null || vc.monthly !== null)
            ? (pctStr(vc.five) + '|' + pctStr(vc.weekly) + '|' + pctStr(vc.monthly))
            : (vc.error ? '—' : '…'))));
      }
      if (vis.volcesAgent !== false) {
        const va = p.volcesAgent || {};
        vrows.push(React.createElement('div', { className: 'am-vrow', key: 'va' },
          dot(pctDot([va.five, va.weekly, va.monthly])),
          React.createElement('span', { className: 'am-vlbl' }, '火山 Agent'),
          React.createElement('span', { className: 'am-vval' }, (va.five !== null || va.weekly !== null || va.monthly !== null)
            ? (pctStr(va.five) + '|' + pctStr(va.weekly) + '|' + pctStr(va.monthly))
            : (va.error ? '—' : '…'))));
      }

      const entry = wide
        ? React.createElement('button', {
          className: 'am-vblock', onClick: (e) => { e.stopPropagation(); setOpen(!open); }, title: 'API 用量监控（点击查看套餐/用量）',
        },
          React.createElement('div', { className: 'am-vhead' },
            React.createElement('span', {}, '⛽'),
            React.createElement('span', {}, 'API 用量')),
          vrows)
        : React.createElement('button', {
          className: 'am-iconbtn', onClick: (e) => { e.stopPropagation(); setOpen(!open); }, title: 'API 用量监控',
        }, '⛽');

      if (!open) return entry;

      function maybeKeyForm() {
        if (keyForm === null) return null;
        return React.createElement('div', { className: 'am-cfgform' },
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, 'AccessKey ID'), React.createElement('input', { className: 'am-input', value: ak, onChange: (e) => setAk(e.target.value), placeholder: 'AK' })),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, 'SecretKey'), React.createElement('input', { className: 'am-input', type: 'password', value: sk, onChange: (e) => setSk(e.target.value), placeholder: 'SK' })),
          React.createElement('div', { className: 'am-actions' },
            React.createElement('button', { className: 'am-btn primary', onClick: saveKeys }, '保存'),
            React.createElement('button', { className: 'am-btn', onClick: () => setKeyForm(null) }, '取消')));
      }

      function volcesBlock(kind, titleD, dataEntry, tierOpts) {
        const rows = [];
        rows.push(React.createElement('div', { className: 'am-row', key: 'u1' },
          React.createElement('span', { className: 'k' }, '用量剩余'),
          React.createElement('span', { className: 'v' }, '5小时 ' + pctStr(dataEntry.five) + ' / 1周 ' + pctStr(dataEntry.weekly) + ' / 1月 ' + pctStr(dataEntry.monthly))));
        rows.push(React.createElement('div', { className: 'am-row', key: 'u2' },
          React.createElement('span', { className: 'k' }, '本次会话次数'),
          React.createElement('span', { className: 'v' }, String(vcTok.calls || 0))));
        rows.push(React.createElement('div', { className: 'am-row', key: 'u3' },
          React.createElement('span', { className: 'k' }, '本次会话token'),
          React.createElement('span', { className: 'v' }, tokenRow(vcTok))));
        const actions = React.createElement('div', { className: 'am-actions', key: 'act' },
          React.createElement('select', { className: 'am-select', value: C.volcesTier || 'auto', onChange: (e) => saveTier(e.target.value) },
            tierOpts.map((o) => React.createElement('option', { value: o, key: o }, o === 'auto' ? '自动' : o))),
          keyConfigBtn(kind),
          React.createElement('button', { className: 'am-btn', onClick: refreshNow, disabled: busy }, '读取套餐'));
        rows.push(actions);
        if (!dataEntry.keyConfigured) rows.push(React.createElement('div', { className: 'am-err', key: 'ke' }, '未配置 AK/SK（Coding 与 Agent 共用）'));
        if (dataEntry.error) rows.push(React.createElement('div', { className: 'am-err', key: 'er' }, dataEntry.error));
        else if (dataEntry.unsubscribed) rows.push(React.createElement('div', { className: 'am-err', key: 'un' }, '未订阅'));
        rows.unshift(blockTitle(titleD, (v) => setVisibility(kind === 'coding' ? 'volcesCoding' : 'volcesAgent', v), kind === 'coding' ? vis.volcesCoding : vis.volcesAgent));
        return React.createElement('div', { className: 'am-block', key: kind }, rows);
      }

      const body = React.createElement('div', { className: 'am-panelbody' },
        React.createElement('div', { className: 'am-block' },
          blockTitle('DeepSeek', (v) => setVisibility('deepseek', v), vis.deepseek),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, '余额 (CNY)'), React.createElement('span', { className: 'v', style: { color: balClass(p.deepseek && p.deepseek.balance) } }, (p.deepseek && p.deepseek.balance !== undefined) ? ('¥' + p.deepseek.balance.toFixed(2)) : '—')),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, '本次会话token'), React.createElement('span', { className: 'v' }, tokenRow(deepTok))),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, '本会话花费'), React.createElement('span', { className: 'v' }, (session.costs && session.costs.deepseek !== undefined) ? ('¥' + (session.costs.deepseek * 7.2).toFixed(2)) : '—')),
          p.deepseek && p.deepseek.error ? React.createElement('div', { className: 'am-err' }, p.deepseek.error) : null),
        React.createElement('div', { className: 'am-block' },
          blockTitle('SiliconFlow', (v) => setVisibility('siliconflow', v), vis.siliconflow),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, '余额 (CNY)'), React.createElement('span', { className: 'v', style: { color: balClass(p.siliconflow && p.siliconflow.balance) } }, (p.siliconflow && p.siliconflow.balance !== undefined) ? ('¥' + p.siliconflow.balance.toFixed(2) ) : '—')),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, '本次会话token'), React.createElement('span', { className: 'v' }, tokenRow(sfTok))),
          p.siliconflow && p.siliconflow.error ? React.createElement('div', { className: 'am-err' }, p.siliconflow.error) : null),
        React.createElement('div', { className: 'am-block' },
          blockTitle('OpenCode Go', (v) => setVisibility('opencodeGo', v), vis.opencodeGo),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, '用量剩余'), React.createElement('span', { className: 'v' }, '5小时 ' + pctStr(p.opencode && p.opencode.rolling) + ' / 1周 ' + pctStr(p.opencode && p.opencode.weekly) + ' / 1月 ' + pctStr(p.opencode && p.opencode.monthly))),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, '本次会话token'), React.createElement('span', { className: 'v' }, tokenRow(ocTok))),
          p.opencode && p.opencode.error ? React.createElement('div', { className: 'am-err' }, p.opencode.error) : null),
        volcesBlock('coding', '火山 Coding Plan', p.volcesCoding || {}, ['auto', 'lite', 'pro']),
        volcesBlock('agent', '火山 Agent Plan', p.volcesAgent || {}, ['auto', 'small', 'medium', 'large', 'max', 'pro']),
        maybeKeyForm(),
        React.createElement('div', { className: 'am-block' },
          React.createElement('div', { className: 'am-title' }, '本次会话总览'),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, 'token用量'), React.createElement('span', { className: 'v' }, tokenRow(sTot))),
          React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, '调用次数'), React.createElement('span', { className: 'v' }, String(sTot.calls || 0))),
          C.showCacheHitRate ? React.createElement('div', { className: 'am-row' }, React.createElement('span', { className: 'k' }, '缓存命中率'), React.createElement('span', { className: 'v' }, cacheHit(sTot) + '%')) : null),
        React.createElement('div', { className: 'am-foot' },
          React.createElement('span', { className: 'am-ts' }, '每 60s 自动刷新 · ' + new Date((snap && snap.ts) || Date.now()).toLocaleTimeString()),
          React.createElement('button', { className: 'am-btn', onClick: refreshNow, disabled: busy }, '读取套餐')));

      const panel = React.createElement('div', { className: 'am-panel', tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Escape') setOpen(false); } },
        React.createElement('div', { className: 'am-panelhead' },
          React.createElement('span', { className: 't' }, 'API 用量监控'),
          React.createElement('button', { className: 'x', onClick: (e) => { e.stopPropagation(); setOpen(false); }, 'aria-label': '关闭' }, '✕')),
        body);

      return React.createElement(React.Fragment, null,
        entry,
        React.createElement('div', { className: 'am-backdrop', onMouseDown: (e) => { e.stopPropagation(); setOpen(false); } }),
        panel);
    }

    slots.inject('sidebar.footer.action', () => slots.register(
      { name: 'sidebar.footer.action', id: 'api-monitor', order: -20, label: () => 'API 用量' },
      (props) => React.createElement(ApiMonitor, props),
    ));
  },
};
