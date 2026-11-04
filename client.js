/**
 * WorkHub Client — main panel with internal navigation.
 * Design: DSH theme tokens only (--dsw-alias-*), one injected stylesheet,
 * small primitive components (Card / Stat / Chip / Btn / Table / Empty).
 */
window.__ModuleLoader__.load({
  id: '@ahao430/dsh-workhub',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useCallback } = React
    const h = React.createElement

    async function api(path, init) {
      const res = await fetch(`/api/workhub${path}`, {
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        ...init,
      })
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`)
      return body
    }

    /* ------------------------------------------------------------------ */
    /* stylesheet (tokens + hover/transition; classes only for pseudo CSS) */
    /* ------------------------------------------------------------------ */

    const CSS = `
.wh-root{display:flex;height:100%;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);
  --wh-accent:#2F6FEB;--wh-accent-soft:rgba(47,111,235,.13);
  --wh-ok:#1F9D68;--wh-ok-soft:rgba(31,157,104,.14);
  --wh-warn:#B8770A;--wh-warn-soft:rgba(184,119,10,.16);
  --wh-bad:#D9483B;--wh-bad-soft:rgba(217,72,59,.14)}
.wh-root *{box-sizing:border-box}
.wh-side{width:198px;flex:none;display:flex;flex-direction:column;padding:14px 10px 10px;gap:2px;
  background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);overflow-y:auto}
.wh-brand{display:flex;align-items:center;gap:9px;padding:4px 8px 14px}
.wh-brand-mark{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  background:var(--wh-accent);color:#fff;flex:none}
.wh-brand-name{font-weight:650;font-size:14px;line-height:1.1}
.wh-brand-tag{font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.wh-group{margin-top:12px;padding:0 8px 4px;font-size:10.5px;letter-spacing:.06em;
  color:var(--dsw-alias-label-secondary);font-weight:600}
.wh-nav{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:7px;cursor:pointer;
  border:none;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;
  width:100%;text-align:left;transition:background .12s ease,color .12s ease}
.wh-nav:hover{background:var(--dsw-alias-bg-layer-2)}
.wh-nav.on{background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1);
  color:var(--wh-accent);font-weight:600}
.wh-nav svg{flex:none;opacity:.85}
.wh-nav.on svg{opacity:1}
.wh-main{flex:1;display:flex;flex-direction:column;min-width:0}
.wh-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;
  padding:18px 28px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.wh-title{font-size:17px;font-weight:650;line-height:1.2}
.wh-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:3px}
.wh-ds-pill{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;
  border:none;cursor:pointer;font-size:11px;font-weight:600;line-height:17px;transition:filter .12s ease}
.wh-ds-pill:hover{filter:brightness(.95)}
.wh-scroll{flex:1;overflow-y:auto;padding:20px 28px 32px}
.wh-content{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.wh-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;padding:16px 18px}
.wh-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.wh-card-title{font-weight:600;font-size:13.5px}
.wh-card-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.wh-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px}
.wh-stat{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0}
.wh-stat-label{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wh-stat-value{font-size:23px;font-weight:650;line-height:1.15;font-variant-numeric:tabular-nums}
.wh-stat-hint{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.wh-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;
  font-size:11px;line-height:1.6;font-weight:500;white-space:nowrap;border:1px solid transparent}
.wh-chip.neutral{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.wh-chip.brand{background:var(--wh-accent-soft);color:var(--wh-accent)}
.wh-chip.ok{background:var(--wh-ok-soft);color:var(--wh-ok)}
.wh-chip.warn{background:var(--wh-warn-soft);color:var(--wh-warn)}
.wh-chip.bad{background:var(--wh-bad-soft);color:var(--wh-bad)}
.wh-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:12px}
.wh-tab{padding:7px 14px;font-size:12.5px;cursor:pointer;border:none;background:none;
  color:var(--dsw-alias-label-secondary);border-bottom:2px solid transparent;font-weight:500}
.wh-tab:hover{color:var(--dsh-alias-label-primary,var(--dsw-alias-label-primary))}
.wh-tab.on{color:var(--wh-accent);border-bottom-color:var(--wh-accent);font-weight:600}
.wh-clamp{position:relative;max-height:160px;overflow:hidden}
.wh-clamp::after{content:'';position:absolute;left:0;right:0;bottom:0;height:48px;
  background:linear-gradient(transparent,var(--dsw-alias-bg-layer-1))}
.wh-clamp.open{max-height:none;overflow:visible}
.wh-clamp.open::after{display:none}
.wh-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:7px;cursor:pointer;
  font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);
  transition:background .12s ease,border-color .12s ease,opacity .12s ease}
.wh-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.wh-btn:disabled{opacity:.5;cursor:default}
.wh-btn.primary{background:var(--wh-accent);border-color:transparent;color:#fff}
.wh-btn.primary:hover{filter:brightness(.94)}
.wh-btn.primary:disabled{opacity:.55}
.wh-btn.danger{color:var(--wh-bad)}
.wh-btn.ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.wh-btn.ghost:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.wh-btn.sm{padding:2px 8px;font-size:11.5px;border-radius:6px}
.wh-input,.wh-select{padding:6px 10px;border-radius:7px;font-size:12.5px;color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);outline:none;min-width:0}
.wh-input:focus,.wh-select:focus{border-color:var(--wh-accent);box-shadow:0 0 0 2px var(--wh-accent-soft)}
.wh-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.75}
.wh-table{width:100%;border-collapse:collapse;font-size:12.5px}
.wh-table th{text-align:left;padding:6px 8px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);
  border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.wh-table td{padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}
.wh-table tr:last-child td{border-bottom:none}
.wh-table tbody tr:hover{background:var(--dsw-alias-bg-layer-2)}
.wh-rowclick{cursor:pointer}
.wh-rowclick.on{background:var(--dsw-alias-bg-layer-2)}
.wh-muted{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.wh-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  padding:28px 16px;color:var(--dsw-alias-label-secondary);text-align:center;font-size:12.5px}
.wh-empty .big{font-size:22px;opacity:.35}
.wh-skel{height:12px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);animation:wh-pulse 1.2s ease-in-out infinite}
@keyframes wh-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.wh-bars{display:flex;align-items:flex-end;gap:6px;height:132px;padding-top:4px}
.wh-bars-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:1px;height:100%;min-width:6px}
.wh-bars-col:hover .wh-bars-seg{filter:brightness(1.12)}
.wh-bars-seg{min-height:2px;border-radius:2px;transition:filter .1s ease}
.wh-bar-row{display:grid;grid-template-columns:minmax(84px,150px) 1fr 52px;gap:10px;align-items:center;padding:5px 0}
.wh-bar-name{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wh-bar-track{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.wh-bar-fill{height:100%;border-radius:999px;background:var(--wh-accent);transition:width .25s ease}
.wh-bar-val{font-size:11.5px;color:var(--dsw-alias-label-secondary);text-align:right;font-variant-numeric:tabular-nums}
.wh-cal-head{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px}
.wh-cal-wd{text-align:center;font-size:11px;color:var(--dsw-alias-label-secondary);padding:2px 0}
.wh-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.wh-cal-cell{min-height:96px;border-radius:10px;padding:8px 9px 0;cursor:pointer;overflow:hidden;
  background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);
  display:flex;flex-direction:column;gap:2px;transition:border-color .12s ease,background .12s ease,transform .12s ease}
.wh-cal-cell:hover{transform:translateY(-1px)}
.wh-cal-att{display:flex;align-items:center;gap:2px;margin-top:3px;font-variant-numeric:tabular-nums}
.wh-cal-att-time{font-size:11.5px;font-weight:600;color:var(--wh-ok);letter-spacing:-.2px}
.wh-cal-att-sep{font-size:10px;color:var(--wh-ok);opacity:.7}
.wh-cal-att-warn{font-size:9px;font-weight:700;color:var(--wh-warn);margin-left:1px}
.wh-cal-wl{font-size:10.5px;color:var(--wh-accent);margin-top:1px;font-weight:500}
.wh-cal-req{display:inline-flex;align-items:center;gap:3px;align-self:flex-start;max-width:100%;
  font-size:10px;font-weight:600;letter-spacing:-.2px;color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:0 5px;line-height:16px;margin-top:2px;
  overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wh-cal-req-x{color:var(--dsw-alias-label-secondary);font-weight:500}
.wh-cal-strength{height:3px;border-radius:2px 2px 0 0;margin:auto -9px 0;transition:background .2s ease}
.wh-cal-cell:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.wh-cal-cell.sel{border-color:var(--wh-accent);box-shadow:0 0 0 1px var(--wh-accent) inset}
.wh-cal-cell.today{background:var(--wh-accent-soft);border-color:color-mix(in srgb, var(--wh-accent) 42%, transparent)}
.wh-cal-cell.today .wh-cal-day{color:var(--wh-accent);font-weight:700}
.wh-cal-today{display:inline-flex;align-items:center;padding:0 5px;border-radius:5px;
  background:var(--wh-accent);color:#fff;font-size:9.5px;font-weight:700;line-height:15px;letter-spacing:.02em}
.wh-cal-cell.blank{background:transparent;border-color:transparent;cursor:default}
.wh-cal-top{display:flex;align-items:center;justify-content:space-between}
.wh-cal-day{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.wh-cal-dots{display:flex;gap:3px}
.wh-cal-dot{width:5px;height:5px;border-radius:50%}
.wh-cal-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.45;
  overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.wh-seg{display:inline-flex;background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:2px;gap:2px}
.wh-seg button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;
  padding:4px 10px;border-radius:6px;cursor:pointer}
.wh-seg button.on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);
  font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.wh-timeline{display:flex;flex-direction:column}
.wh-tl{display:grid;grid-template-columns:52px 16px 1fr;gap:8px;align-items:start;
  padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12.5px}
.wh-tl:last-child{border-bottom:none}
.wh-tl-time{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;padding-top:1px}
.wh-tl-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;justify-self:center}
.wh-tl-body{min-width:0}
.wh-tl-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wh-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.wh-msg{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12.5px}
.wh-msg:last-child{border-bottom:none}
.wh-msg-meta{flex:none;width:104px;font-size:10.5px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.wh-msg-text{flex:1;min-width:0;word-break:break-word}
.wh-insight{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:10px 13px;
  background:var(--dsw-alias-bg-base);border-left-width:3px}
.wh-insight-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wh-insight-title{font-weight:600;font-size:12.5px}
.wh-heat{display:flex;flex-direction:column;gap:2px}
.wh-heat-row{display:flex;align-items:center;gap:2px}
.wh-heat-wd{width:16px;font-size:10px;color:var(--dsw-alias-label-secondary);flex:none}
.wh-heat-cell{width:16px;height:16px;border-radius:3px;background:var(--dsw-alias-bg-layer-2)}
.wh-heat-cell:hover{outline:1px solid var(--wh-accent)}
.wh-hour{display:flex;align-items:flex-end;gap:2px;height:84px}
.wh-hour-bar{flex:1;border-radius:2px 2px 0 0;background:var(--wh-accent);min-height:1px;opacity:.9}
.wh-hour-bar.dim{background:var(--dsw-alias-bg-layer-2);opacity:1}
.wh-grid2{display:grid;grid-template-columns:1.15fr .85fr;gap:14px;align-items:start}
@media (max-width:960px){.wh-grid2{grid-template-columns:1fr}}
.wh-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12.5px}
.wh-kv dt{color:var(--dsw-alias-label-secondary)}
.wh-kv dd{margin:0;word-break:break-all}
.wh-list{display:flex;flex-direction:column;gap:8px}
.wh-legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.wh-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
.wh-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wh-section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);
  text-transform:none;margin:2px 0 6px}
`

    const styleTag = () => h('style', { key: 'wh-css', dangerouslySetInnerHTML: { __html: CSS } })

    /* ----------------------------- palette ------------------------------ */

    const C = {
      chat_message: '#5B8DEF',
      todo: '#34B37E',
      minutes: '#E0A33E',
      report: '#9B7BE0',
      attendance: '#E8773E',
      commit: '#3FA7C4',
      requirement: '#D96A9E',
      task: '#7FB04A',
      pipeline: '#7A6BD9',
      worklog: '#C08A4E',
      git_repo: '#8A94A6',
      yunxiao_project: '#5C7A99',
      milestone: '#D9483B',
      calendar_event: '#3F8CAD',
    }
    const TYPE_LABEL = {
      todo: '待办', report: '日志', minutes: '会议', chat_message: '消息', attendance: '打卡',
      commit: '提交', requirement: '需求', task: '任务', pipeline: '流水线', worklog: '报工',
      git_repo: '仓库', yunxiao_project: '云效项目', milestone: '排期节点', calendar_event: '日程',
    }
    const typeLabel = (t) => TYPE_LABEL[t] ?? t
    const typeColor = (t) => C[t] ?? 'var(--dsw-alias-state-idle-primary)'

    /* --------------------------- primitives ----------------------------- */

    function Card({ title, sub, action, children, style }) {
      return h('section', { className: 'wh-card', style },
        (title || action)
          ? h('div', { className: 'wh-card-head' },
              h('div', null,
                h('div', { className: 'wh-card-title' }, title),
                sub ? h('div', { className: 'wh-card-sub' }, sub) : null),
              action ?? null)
          : null,
        children)
    }

    function Stat({ label, value, hint, accent }) {
      return h('div', { className: 'wh-stat' },
        h('div', { className: 'wh-stat-label' }, label),
        h('div', { className: 'wh-stat-value', style: accent ? { color: accent } : null }, value),
        hint ? h('div', { className: 'wh-stat-hint' }, hint) : null)
    }

    function Chip({ tone = 'neutral', children, style }) {
      return h('span', { className: `wh-chip ${tone}`, style }, children)
    }

    function Btn({ variant, size, disabled, onClick, children, style, title }) {
      const cls = ['wh-btn', variant ?? '', size === 'sm' ? 'sm' : ''].filter(Boolean).join(' ')
      return h('button', { className: cls, disabled, onClick, style, title }, children)
    }

    function Empty({ icon, title, hint }) {
      return h('div', { className: 'wh-empty' },
        icon ? h('div', { className: 'big' }, icon) : null,
        h('div', null, title),
        hint ? h('div', { style: { fontSize: 11.5, opacity: 0.8 } }, hint) : null)
    }

    /** 页内 tab 切换：tabs = [[id, label]] */
    function Tabs({ tabs, active, onChange }) {
      return h('div', { className: 'wh-tabs' },
        tabs.map(([id, label]) =>
          h('button', {
            key: id,
            className: `wh-tab${active === id ? ' on' : ''}`,
            onClick: () => onChange(id),
          }, label)))
    }

    /** 进行中需求行：需求号 + 标题 + 状态 + 更新日期 */
    function RequirementRow({ r, showDate = true }) {
      return h('div', {
        key: r.source_id ?? r.id,
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: 12.5 },
      },
        h(Chip, { tone: 'brand', style: { flex: 'none' } }, r.source_id ?? ''),
        h('span', {
          style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          title: r.title ?? '',
        }, (r.title ?? '').replace(new RegExp(`^${r.source_id}\\s*`), '') || r.title || '(无标题)'),
        h(Chip, { tone: 'warn', style: { flex: 'none' } }, r.status || '进行中'),
        showDate && r.day ? h('span', { className: 'wh-muted', style: { flex: 'none', fontSize: 11 } }, String(r.day).slice(5)) : null)
    }

    function Skeleton({ rows = 3 }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0' } },
        Array.from({ length: rows }, (_, i) =>
          h('div', { key: i, className: 'wh-skel', style: { width: `${100 - i * 18}%` } })))
    }

    function Loading({ label = '加载中…' }) {
      return h(Card, null, h('div', { className: 'wh-muted', style: { marginBottom: 10 } }, label), h(Skeleton))
    }

    function Delta({ value, suffix = '' }) {
      if (value === 0) return h(Chip, { tone: 'neutral' }, '持平')
      const tone = value > 0 ? 'ok' : 'warn'
      return h(Chip, { tone }, `${value > 0 ? '+' : ''}${value}${suffix}`)
    }

    function BarRow({ name, value, max, color }) {
      return h('div', { className: 'wh-bar-row' },
        h('span', { className: 'wh-bar-name', title: name }, name),
        h('div', { className: 'wh-bar-track' },
          h('div', { className: 'wh-bar-fill', style: { width: `${Math.max(2, (value / max) * 100)}%`, background: color } })),
        h('span', { className: 'wh-bar-val' }, value))
    }

    function Legend({ types }) {
      return h('div', { className: 'wh-legend' },
        types.map((t) => h('span', { key: t }, h('i', { style: { background: typeColor(t) } }), typeLabel(t))))
    }

    /* -------------------------- error boundary -------------------------- */

    class ErrorBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error) { try { console.error('[workhub]', error) } catch {} }
      render() {
        if (!this.state.error) return this.props.children
        return h(Card, { title: `页面渲染出错：${this.props.name ?? ''}` },
          h('pre', {
            style: { fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, opacity: 0.85 },
          }, String(this.state.error?.message ?? this.state.error)),
          h('div', { className: 'wh-muted', style: { marginTop: 10 } },
            '请把以上错误信息反馈给助手。其他页面不受影响，可继续使用侧边栏切换。'))
      }
    }

    /* ------------------------------ charts ------------------------------ */

    function StackedBars({ buckets, trend, maxN, bucketRequirements }) {
      if (!buckets.length) return h(Empty, { icon: '▁▃▅', title: '区间内暂无活动', hint: '同步后这里会显示每日/每周活动量' })
      const tooltipFor = (b, items) => {
        const total = Object.values(items).reduce((a, n) => a + n, 0)
        const lines = [`${b} · ${total} 事件`]
        const detail = Object.entries(items)
          .sort((a, b2) => b2[1] - a[1])
          .map(([t, n]) => `${typeLabel(t)} ${n}`)
        if (detail.length) lines.push(detail.join(' · '))
        const reqs = bucketRequirements?.[b]
        if (reqs?.length) {
          lines.push('', '提交的需求：')
          for (const r of reqs) lines.push(`· ${r.serial} ×${r.count}`)
        }
        return lines.join('\n')
      }
      return h('div', null,
        h('div', { className: 'wh-bars' },
          buckets.map((b) => {
            const items = trend[b]
            const total = Object.values(items).reduce((a, n) => a + n, 0)
            return h('div', { key: b, className: 'wh-bars-col', title: tooltipFor(b, items) },
              ['attendance', 'chat_message', 'todo', 'minutes', 'report', 'commit', 'requirement', 'task', 'worklog']
                .filter((t) => items[t])
                .map((t) => h('div', {
                  key: t,
                  className: 'wh-bars-seg',
                  style: { height: `${(items[t] / maxN) * 100}%`, background: typeColor(t) },
                })))
          })),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: 6 } },
          h('span', { className: 'wh-muted' }, buckets[0]),
          h('span', { className: 'wh-muted' }, buckets[buckets.length - 1])),
        h(Legend, { types: ['attendance', 'chat_message', 'todo', 'minutes', 'report', 'commit', 'requirement', 'task'] }))
    }

    function Heatmap({ matrix }) {
      const max = Math.max(1, ...matrix.flat())
      return h('div', null,
        h('div', { style: { display: 'flex', gap: 2, paddingLeft: 18, marginBottom: 3 } },
          Array.from({ length: 24 }, (_, hour) =>
            h('span', { key: hour, className: 'wh-muted', style: { width: 16, fontSize: 9, textAlign: 'center', flex: 'none' } },
              hour % 3 === 0 ? hour : ''))),
        h('div', { className: 'wh-heat' },
          matrix.map((hours, dow) =>
            h('div', { key: dow, className: 'wh-heat-row' },
              h('span', { className: 'wh-heat-wd' }, '一二三四五六日'[dow]),
              hours.map((n, hour) =>
                h('div', {
                  key: hour,
                  className: 'wh-heat-cell',
                  title: `周${'一二三四五六日'[dow]} ${hour}:00 — ${n} 事件`,
                  style: n
                    ? { background: `color-mix(in srgb, var(--wh-accent) ${Math.round(18 + 82 * (n / max))}%, transparent)` }
                    : null,
                }))))))
    }

    /* ---------------------------- Dashboard ---------------------------- */

    function useInsights(params) {
      const [list, setList] = useState(null)
      useEffect(() => {
        const q = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v))
        api(`/analyses?${q}`).then((r) => setList(r.analyses)).catch(() => setList([]))
      }, [JSON.stringify(params)])
      return list
    }

    function InsightCard({ a }) {
      const p = a.payload || {}
      const tone = p.importance === 'high' ? 'bad' : p.importance === 'medium' ? 'warn' : 'ok'
      const borderColor = {
        bad: 'var(--wh-bad)',
        warn: 'var(--wh-warn)',
        ok: 'var(--wh-ok)',
      }[tone]
      return h('div', { className: 'wh-insight', style: { borderLeftColor: borderColor } },
        h('div', { className: 'wh-insight-head' },
          h('span', { className: 'wh-insight-title' }, p.title || a.kind),
          h(Chip, { tone: p.origin === 'rule' ? 'neutral' : 'brand' }, p.origin === 'rule' ? '规则' : 'AI'),
          h('span', { className: 'wh-muted', style: { marginLeft: 'auto' } },
            new Date(a.generatedAt).toLocaleString())),
        p.description ? h('div', { style: { marginTop: 5, lineHeight: 1.55 } }, p.description) : null,
        h('div', { className: 'wh-muted', style: { marginTop: 5 } },
          `依据 ${a.sources?.length ?? 0} 条 · ${[...new Set((a.sources ?? []).map((s) => s.sourceType))].map(typeLabel).join(' / ')}`))
    }

    const GRAN_LABEL = { day: '按日', week: '按周', month: '按月', quarter: '按季度' }

    function Dashboard({ range, setRange }) {
      const [stats, setStats] = useState(null)
      const [err, setErr] = useState(null)
      const insights = useInsights({ kind: 'insight' })
      const load = useCallback(() => {
        return api(`/analytics/dashboard?${rangeQuery(range)}`)
          .then((r) => { setStats(r); setRange({ ...range, resolved: r.range }) })
          .catch((e) => setErr(String(e.message)))
      }, [range.preset, range.start, range.end, range.granularity, range.compare])
      useEffect(() => { void load() }, [load])
      if (err) return h(Card, { title: '加载失败' }, h('div', { style: { color: 'var(--wh-bad)' } }, err))
      if (!stats) return h(Loading)

      const trend = {}
      let maxN = 1
      for (const r of stats.activity || []) {
        trend[r.bucket] = trend[r.bucket] || {}
        trend[r.bucket][r.source_type] = r.n
        maxN = Math.max(maxN, r.n)
      }
      const buckets = Object.keys(trend).sort()

      const proj = {}
      for (const r of stats.projectActivity || []) {
        proj[r.name] = proj[r.name] || { total: 0, byType: {} }
        proj[r.name].total += r.n
        proj[r.name].byType[r.source_type] = r.n
      }
      const projRows = Object.entries(proj).sort((a, b) => b[1].total - a[1].total)
      const projMax = Math.max(1, ...projRows.map(([, v]) => v.total))

      const totalEvents = Object.values(stats.counts).reduce((a, b) => a + b, 0)
      const cmp = stats.compare
      const mainTypes = ['chat_message', 'commit', 'requirement', 'worklog', 'todo', 'attendance']
        .filter((t) => (stats.counts[t] ?? 0) > 0)
      const statCards = [
        h(Stat, { key: 'total', label: '工作事件', value: totalEvents, hint: `${stats.range.startDate} ~ ${stats.range.endDate}` }),
        h(Stat, { key: 'projects', label: '活跃项目', value: stats.activeProjects }),
        ...mainTypes.slice(0, 3).map((t) =>
          h(Stat, {
            key: t,
            label: typeLabel(t),
            value: stats.counts[t],
            hint: cmp ? null : null,
            accent: typeColor(t),
          })),
      ]

      const compareRows = cmp
        ? [
            ['工作事件', totalEvents, Object.values(cmp.counts).reduce((a, b) => a + b, 0)],
            ['活跃项目', stats.activeProjects, cmp.activeProjects],
            ...mainTypes.map((t) => [typeLabel(t), stats.counts[t] ?? 0, cmp.counts[t] ?? 0]),
          ]
        : []

      return h('div', { className: 'wh-content' },
        h('div', { className: 'wh-stats' }, statCards),
        h('div', { className: 'wh-grid2' },
          h(Card, { title: '项目投入分布', sub: `${stats.range.startDate} ~ ${stats.range.endDate}` },
            projRows.length
              ? h('div', null, projRows.map(([name, v]) =>
                  h(BarRow, { key: name, name, value: v.total, max: projMax, color: 'var(--wh-accent)' })))
              : h(Empty, {
                  icon: '◎',
                  title: '尚未配置项目或无关联数据',
                  hint: '到「项目分析」创建项目并绑定群聊 / 关键词，数据会自动归集',
                })),
          h(Card, { title: '工作活动趋势', sub: `粒度 · ${GRAN_LABEL[stats.range.granularity] ?? stats.range.granularity}` },
            h(StackedBars, { buckets, trend, maxN, bucketRequirements: stats.bucketRequirements }))),
        (stats.inProgress ?? []).length
          ? h(Card, {
              title: `进行中需求 · ${stats.inProgress.length}`,
              sub: `${stats.range.startDate} ~ ${stats.range.endDate} 内有更新 · 非终态需求，按最近更新倒序`,
            },
              stats.inProgress.map((r) => h(RequirementRow, { key: r.source_id, r })))
          : null,
        cmp
          ? h(Card, {
              title: '周期对比',
              sub: `本期 ${stats.range.startDate} ~ ${stats.range.endDate} · 上期 ${cmp.range.startDate} ~ ${cmp.range.endDate}`,
            },
              h('table', { className: 'wh-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '指标'), h('th', null, '上期'), h('th', null, '本期'), h('th', null, '变化'))),
                h('tbody', null, compareRows.map(([label, now, before]) =>
                  h('tr', { key: label },
                    h('td', null, label),
                    h('td', { className: 'wh-muted' }, String(before)),
                    h('td', null, String(now)),
                    h('td', null, h(Delta, { value: now - before })))))))
          : null,
        h(Card, {
          title: 'AI 工作洞察',
          sub: '规则引擎与 Agent 生成的带来源结论',
        },
          (insights ?? []).length
            ? h('div', { className: 'wh-list' }, insights.map((a) => h(InsightCard, { key: a.id, a })))
            : h(Empty, {
                icon: '✦',
                title: '暂无洞察',
                hint: '在 DSH 对话中说「分析一下 AI 基建项目并保存洞察」，Agent 会读取数据并生成带来源的结论',
              })),
        h('div', { className: 'wh-muted', style: { textAlign: 'center', paddingTop: 2 } },
          '统计为确定性 SQL 计算 · AI 结论文本均携带来源证据'))
    }

    /* -------------------------- source cards ---------------------------- */

    function StatusChip({ status }) {
      const map = {
        connected: ['已连接', 'ok'],
        refreshing: ['access 过期 · 自动续期', 'warn'],
        disconnected: ['未连接', 'neutral'],
        expired: ['登录已失效 · 需重新登录', 'bad'],
        error: ['异常', 'bad'],
      }
      const [label, tone] = map[status] || ['未知', 'neutral']
      return h(Chip, { tone }, `● ${label}`)
    }

    function YunxiaoCard({ sources, onChanged }) {
      const yx = sources?.yunxiao
      const [instanceType, setInstanceType] = useState(yx?.instanceType ?? 'center')
      const [baseUrl, setBaseUrl] = useState(yx?.baseUrl ?? '')
      const [orgId, setOrgId] = useState(yx?.organizationId ?? '')
      const [token, setToken] = useState('')
      const [msg, setMsg] = useState(null)
      const [busy, setBusy] = useState(false)

      const save = async (disconnect) => {
        setBusy(true); setMsg(null)
        try {
          const body = disconnect ? {} : { instanceType, baseUrl, organizationId: orgId, token: token || undefined }
          await api(`/sources/yunxiao/${disconnect ? 'disconnect' : 'save'}`, {
            method: 'POST', body: JSON.stringify(body),
          })
          setMsg(disconnect ? '已断开并清除本地 Token' : '已保存 · Token 仅存钥匙串')
          setToken('')
          onChanged()
        } catch (e) { setMsg(`失败: ${e.message}`) } finally { setBusy(false) }
      }

      return h(Card, {
        title: '阿里云云效',
        sub: `PAT 认证${yx?.tokenStored ? ' · Token 已存钥匙串' : ' · 未配置 Token'}`,
        action: h(StatusChip, { status: yx?.status }),
      },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { className: 'wh-toolbar' },
            h('span', { className: 'wh-muted' }, '实例'),
            h('div', { className: 'wh-seg' },
              ['center', 'region'].map((t) =>
                h('button', {
                  key: t,
                  className: instanceType === t ? 'on' : '',
                  onClick: () => setInstanceType(t),
                }, t === 'center' ? '中心站' : 'Region 站')))),
          h('input', {
            className: 'wh-input', placeholder: 'API Base URL（https://openapi-rdc.aliyuncs.com）',
            value: baseUrl, onChange: (e) => setBaseUrl(e.target.value),
          }),
          instanceType === 'center'
            ? h('input', {
                className: 'wh-input', placeholder: '组织 ID（留空自动取自账号）',
                value: orgId, onChange: (e) => setOrgId(e.target.value),
              })
            : null,
          h('input', {
            className: 'wh-input',
            placeholder: yx?.tokenStored ? 'Personal Access Token（留空保持不变）' : 'Personal Access Token',
            value: token, onChange: (e) => setToken(e.target.value),
            type: 'password', autoComplete: 'off',
          }),
          msg ? h('div', { className: 'wh-muted', style: { color: msg.startsWith('失败') ? 'var(--wh-bad)' : 'var(--wh-ok)' } }, msg) : null,
          h('div', { className: 'wh-toolbar' },
            h(Btn, { variant: 'primary', disabled: busy || !baseUrl, onClick: () => save(false) }, busy ? '保存中…' : '保存配置'),
            yx?.tokenStored ? h(Btn, { variant: 'ghost', disabled: busy, onClick: () => save(true) }, '断开连接') : null)))
    }

    function DingTalkLoginButton({ onDone, variant = 'primary', label = '重新登录钉钉' }) {
      const [job, setJob] = useState(null)
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)
      const timerRef = React.useRef(null)

      const stopPolling = () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      }
      useEffect(() => stopPolling, [])

      const poll = () => {
        stopPolling()
        timerRef.current = setInterval(async () => {
          try {
            const r = await api('/auth/dingtalk/login/status')
            setJob(r.job)
            if (!r.job || r.job.status !== 'running') {
              stopPolling()
              setBusy(false)
              if (r.job?.status === 'done') {
                setMsg('登录成功，正在刷新连接状态…')
                onDone?.()
              } else if (r.job?.status === 'error') {
                setMsg(`登录未完成：${r.job.error ?? '未知原因'}`)
              }
            }
          } catch (e) {
            stopPolling(); setBusy(false); setMsg(`状态查询失败：${e.message}`)
          }
        }, 2000)
      }

      const start = async () => {
        if (!window.confirm('将打开浏览器进行钉钉授权（OAuth Loopback）。\n\n授权完成后会自动回到本页，无需终端操作。继续？')) return
        setBusy(true); setMsg(null); setJob(null)
        try {
          const r = await api('/auth/dingtalk/login', { method: 'POST', body: '{}' })
          setJob(r.job ?? null)
          if (r.status === 'running') poll()
          else { setBusy(false); setMsg('已有登录流程在进行中') }
        } catch (e) {
          setBusy(false); setMsg(`启动失败：${e.message}`)
        }
      }

      const cancel = async () => {
        try { await api('/auth/dingtalk/login/cancel', { method: 'POST', body: '{}' }) } catch {}
        stopPolling(); setBusy(false); setMsg('已取消登录')
      }

      const running = busy || job?.status === 'running'
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { className: 'wh-toolbar', style: { gap: 6 } },
          h(Btn, { size: 'sm', variant, disabled: running, onClick: start },
            running ? '等待浏览器授权…' : label),
          running ? h(Btn, { size: 'sm', variant: 'ghost', onClick: cancel }, '取消') : null,
          job?.url
            ? h(Btn, {
                size: 'sm',
                onClick: () => window.open(job.url, '_blank', 'noopener'),
              }, '打开授权页面')
            : null),
        running
          ? h('div', { className: 'wh-muted' },
              '已在本机启动授权流程：浏览器会自动打开钉钉登录页，扫码授权后本页自动刷新。若浏览器未弹出，点「打开授权页面」。')
          : null,
        job?.code ? h('div', { className: 'wh-muted' }, `设备码：${job.code}`) : null,
        msg
          ? h('div', {
              className: 'wh-muted',
              style: { color: msg.startsWith('登录成功') ? 'var(--wh-ok)' : msg.startsWith('已取消') ? null : 'var(--wh-bad)' },
            }, msg)
          : null)
    }

    function ReloginHint({ command, onRelogin }) {
      const [copied, setCopied] = useState(false)
      const copy = () => {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(command).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }).catch(() => {})
        }
      }
      return h('div', {
        style: {
          marginTop: 10, padding: '10px 12px', borderRadius: 8,
          background: 'var(--wh-bad-soft)',
          border: '1px solid color-mix(in srgb, var(--wh-bad) 30%, transparent)',
        },
      },
        h('div', { style: { fontSize: 12, color: 'var(--wh-bad)', fontWeight: 600, marginBottom: 4 } },
          '钉钉登录已失效，需要重新登录'),
        h('div', { className: 'wh-muted', style: { marginBottom: 8 } },
          '在终端执行下面命令并扫码，完成后回到本页点「全部同步」即可恢复（历史数据不受影响）。'),
        h('div', { className: 'wh-toolbar', style: { gap: 6, marginBottom: 8 } },
          h(DingTalkLoginButton, { onDone: onRelogin, label: '一键重新登录' })),
        h('div', { className: 'wh-muted', style: { marginBottom: 4 } }, '若浏览器无法打开，也可在终端执行：'),
        h('div', { className: 'wh-toolbar', style: { gap: 6 } },
          h('code', {
            style: {
              flex: 1, padding: '4px 8px', borderRadius: 6, fontSize: 12,
              background: 'var(--dsw-alias-bg-layer-1)',
              border: '1px solid var(--dsw-alias-border-l1)',
            },
          }, command),
          h(Btn, { size: 'sm', onClick: copy }, copied ? '已复制 ✓' : '复制命令')))
    }

    function SourcesSection() {
      const [sources, setSources] = useState(null)
      const load = useCallback(() => api('/sources').then(setSources).catch(() => {}), [])
      useEffect(() => { void load() }, [load])
      if (!sources) return h(Loading, { label: '读取连接状态…' })
      const dd = sources.dingtalk
      const caps = sources.capabilities ?? []
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h('div', { className: 'wh-grid2' },
          h(Card, { title: '钉钉', sub: 'DWS CLI OAuth', action: h(StatusChip, { status: dd.status }) },
            h('dl', { className: 'wh-kv' },
              h('dt', null, '账号'), h('dd', null, h('b', null, dd.account ?? '—')),
              h('dt', null, '组织'), h('dd', null, dd.organization ?? '—'),
              h('dt', null, 'Profile'), h('dd', null, dd.profile ? `${dd.profile.count} 个` : '—'),
              dd.expiresAt ? h('dt', null, 'access token') : null,
              dd.expiresAt
                ? h('dd', null,
                    new Date(dd.expiresAt).toLocaleString(),
                    Number.isFinite(dd.minutesLeft) ? h('span', { className: 'wh-muted' }, ` · 剩 ${Math.max(0, dd.minutesLeft)} 分钟`) : null)
                : null,
              dd.refreshExpiresAt ? h('dt', null, 'refresh token') : null,
              dd.refreshExpiresAt
                ? h('dd', null, `${new Date(dd.refreshExpiresAt).toLocaleString()}（到期前自动续期）`)
                : null,
              dd.lastError ? h('dt', null, '错误') : null,
              dd.lastError ? h('dd', { style: { color: 'var(--wh-bad)' } }, dd.lastError) : null),
            dd.selfHealing
              ? h('div', { className: 'wh-muted', style: { marginTop: 8 } },
                  'access token 已过期，DWS 会在下次调用时用 refresh token 自动续期，无需处理。')
              : null,
            dd.reloginCommand
              ? h(ReloginHint, { command: dd.reloginCommand, onRelogin: load })
              : null,
            !dd.reloginCommand
              ? h('div', { style: { marginTop: 10 } },
                  h(DingTalkLoginButton, { onDone: load, variant: 'ghost', label: '重新登录 / 切换组织' }))
              : null),
          h(YunxiaoCard, { sources, onChanged: load })),
        h(Card, { title: '数据能力矩阵', sub: '各数据源最近一次同步结果' },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            caps.map((c) => h(Chip, {
              key: c.capability,
              tone: c.status === 'available' ? 'ok' : c.status === 'unavailable' ? 'bad' : 'neutral',
              title: c.error ?? '',
            }, `${c.capability} · ${c.status === 'available' ? '可用' : c.status === 'unavailable' ? '失败' : '未验证'}`)))))
    }

    /* --------------------------- Data manager --------------------------- */

    const SYNC_TONE = { ok: 'ok', syncing: 'warn', error: 'bad', partial: 'warn' }
    const SYNC_LABEL = { ok: '正常', syncing: '同步中', error: '错误', partial: '部分' }

    function DataManager() {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState('')
      const [msg, setMsg] = useState(null)
      const [items, setItems] = useState(null)
      const [sourceFilter, setSourceFilter] = useState('')
      const [chatQuery, setChatQuery] = useState('')

      const loadStatus = useCallback(
        () => api('/sync/status').then(setStatus).catch((e) => setMsg(String(e.message))),
        [],
      )
      useEffect(() => { void loadStatus() }, [loadStatus])

      const loadItems = useCallback((t) => {
        setItems(null)
        api(`/items?limit=50${t ? `&sourceType=${t}` : ''}`)
          .then((r) => setItems(r.items))
          .catch((e) => setMsg(String(e.message)))
      }, [])

      const run = async (source) => {
        setBusy(source); setMsg(null)
        try {
          const r = await api('/sync/run', { method: 'POST', body: JSON.stringify({ source }) })
          const summary = Object.entries(r.results).map(([k, v]) => `${k}: ${v.status}${v.upserted != null ? ` (+${v.upserted})` : ''}`).join(' · ')
          setMsg(`同步完成 — ${summary}`)
          await loadStatus()
        } catch (e) { setMsg(`同步失败: ${e.message}`) } finally { setBusy('') }
      }

      const collectChat = async (conversationId) => {
        setBusy(`chat:${conversationId}`); setMsg(null)
        try {
          const r = await api('/chats/collect', { method: 'POST', body: JSON.stringify({ conversationId, sinceDays: 14 }) })
          setMsg(`采集完成 — ${r.result.upserted} 条消息`)
          await loadStatus()
        } catch (e) { setMsg(`采集失败: ${e.message}`) } finally { setBusy('') }
      }

      const collectRecent = async (n) => {
        const targets = (status?.chats ?? []).filter((c) => c.latest_message_time).slice(0, n)
        if (!targets.length) { setMsg('没有可采集的会话（先同步 dws.chats）'); return }
        setBusy('batch'); setMsg(null)
        const done = []
        for (const c of targets) {
          try {
            const r = await api('/chats/collect', { method: 'POST', body: JSON.stringify({ conversationId: c.conversation_id, sinceDays: 14 }) })
            done.push(`${c.name || c.conversation_id.slice(0, 12)}: ${r.result.upserted}`)
          } catch (e) {
            done.push(`${c.name || c.conversation_id.slice(0, 12)}: 失败(${e.message.slice(0, 40)})`)
          }
        }
        setBusy('')
        setMsg(`批量采集完成 — ${done.join(' · ')}`)
        await loadStatus()
      }

      const syncRows = (status?.sources ?? []).map(({ source, initialDays, state }) => {
        const tone = SYNC_TONE[state?.status] ?? 'neutral'
        return h('tr', { key: source },
          h('td', null,
            h('div', { style: { fontWeight: 500 } }, source),
            initialDays ? h('div', { className: 'wh-muted' }, `初始范围 ${initialDays} 天`) : null),
          h('td', null, h(Chip, { tone }, SYNC_LABEL[state?.status] ?? '未同步')),
          h('td', { className: 'wh-muted' }, state?.last_sync_at ? new Date(state.last_sync_at).toLocaleString() : '—'),
          h('td', { className: 'wh-muted' }, state?.total_synced != null ? String(state.total_synced) : '—'),
          h('td', { style: { textAlign: 'right' } },
            h(Btn, { size: 'sm', disabled: !!busy, onClick: () => run(source) }, busy === source ? '同步中' : '同步')),
          state?.last_error
            ? h('td', { style: { color: 'var(--wh-bad)', fontSize: 11, maxWidth: 260 } }, state.last_error)
            : h('td'))
      })

      const shownChats = (status?.chats ?? [])
        .filter((c) => !chatQuery || (c.name ?? '').toLowerCase().includes(chatQuery.toLowerCase()))
        .slice(0, 40)
      const chatRows = shownChats.map((chat) =>
        h('tr', { key: chat.conversation_id },
          h('td', null,
            chat.name || chat.conversation_id.slice(0, 22),
            chat.latest_message_time ? h('div', { className: 'wh-muted' }, `最新 ${chat.latest_message_time}`) : null),
          h('td', { className: 'wh-muted' },
            chat.messageCount
              ? `已采集 ${chat.messageCount} 条 · ${new Date(chat.last_collected_at).toLocaleString()}`
              : '未采集'),
          h('td', { style: { textAlign: 'right' } },
            h(Btn, {
              size: 'sm',
              variant: chat.messageCount ? undefined : 'primary',
              disabled: !!busy,
              onClick: () => collectChat(chat.conversation_id),
            }, busy === `chat:${chat.conversation_id}` ? '采集中…' : chat.messageCount ? '更新' : '采集'))))

      const filters = ['', 'commit', 'requirement', 'task', 'worklog', 'todo', 'report', 'minutes', 'chat_message', 'attendance', 'pipeline']
      const itemRows = (items ?? []).map((item) =>
        h('tr', { key: item.id },
          h('td', { className: 'wh-muted', style: { whiteSpace: 'nowrap' } },
            item.occurred_at?.slice(5, 16).replace('T', ' ')),
          h('td', null, h(Chip, { tone: 'neutral' }, typeLabel(item.source_type))),
          h('td', null,
            item.title || '(无标题)',
            item.actor ? h('div', { className: 'wh-muted' }, item.actor) : null)))

      return h('div', { className: 'wh-content' },
        h(SourcesSection),
        msg ? h('div', { className: 'wh-card', style: { fontSize: 12, wordBreak: 'break-all' } }, msg) : null,
        h(Card, {
          title: '同步状态',
          sub: `${(status?.sources ?? []).length || 12} 个数据源 · 定时每 30 分钟增量同步`,
          action: h(Btn, { variant: 'primary', disabled: !!busy, onClick: () => run('all') },
            busy === 'all' ? '同步中…' : '全部同步'),
        },
          h('table', { className: 'wh-table' },
            h('thead', null, h('tr', null,
              h('th', null, '数据源'), h('th', null, '状态'), h('th', null, '最近同步'), h('th', null, '条数'), h('th', null, ''), h('th', null, ''))),
            h('tbody', null, syncRows))),
        h(Card, {
          title: '会话消息采集',
          sub: `共 ${(status?.chats ?? []).length} 个会话 · 已采集 ${(status?.chats ?? []).filter((c) => c.messageCount > 0).length} 个 · 采集近 14 天消息`,
          action: h('div', { className: 'wh-toolbar', style: { gap: 6 } },
            h('input', {
              className: 'wh-input', placeholder: '搜索会话…', value: chatQuery,
              style: { width: 150 },
              onChange: (e) => setChatQuery(e.target.value),
            }),
            h(Btn, {
              size: 'sm', disabled: !!busy,
              onClick: () => collectRecent(5),
            }, busy === 'batch' ? '批量采集中…' : '采集最近活跃 5 个')),
        },
          (status?.chats ?? []).length
            ? h('table', { className: 'wh-table' },
                h('thead', null, h('tr', null, h('th', null, '会话'), h('th', null, '采集状态'), h('th', null, ''))),
                h('tbody', null, chatRows))
            : h(Empty, { icon: '◌', title: '暂无会话', hint: '先同步「dws.chats」数据源' })),
        h(Card, { title: '已存工作事件', sub: '统一工作事件表（work_items）' },
          h('div', { className: 'wh-toolbar', style: { marginBottom: 10 } },
            filters.map((t) =>
              h('button', {
                key: t || 'all',
                className: sourceFilter === t ? 'wh-btn sm primary' : 'wh-btn sm',
                onClick: () => { setSourceFilter(t); loadItems(t) },
              }, t ? typeLabel(t) : '全部'))),
          items === null
            ? h(Empty, { icon: '⌕', title: '选择一个类型查看已存数据' })
            : items.length
              ? h('table', { className: 'wh-table' }, h('tbody', null, itemRows))
              : h(Empty, { icon: '∅', title: '该类型暂无数据' })))
    }

    /* ---------------------------- Projects ------------------------------ */

    function ProjectForm({ chats, onCreated }) {
      const [name, setName] = useState('')
      const [keywords, setKeywords] = useState('')
      const [chatIds, setChatIds] = useState([])
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)

      const submit = async () => {
        setBusy(true); setErr(null)
        try {
          await api('/projects/create', { method: 'POST', body: JSON.stringify({ name, keywords, chatIds }) })
          setName(''); setKeywords(''); setChatIds([])
          onCreated()
        } catch (e) { setErr(String(e.message)) } finally { setBusy(false) }
      }

      const chatOptions = (chats ?? []).slice(0, 80).map((c) =>
        h('label', { key: c.conversation_id, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, padding: '3px 0' } },
          h('input', {
            type: 'checkbox',
            checked: chatIds.includes(c.conversation_id),
            onChange: (e) =>
              setChatIds(e.target.checked
                ? [...chatIds, c.conversation_id]
                : chatIds.filter((x) => x !== c.conversation_id)),
          }),
          c.name || c.conversation_id.slice(0, 20)))

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h('div', { className: 'wh-toolbar' },
          h('input', { className: 'wh-input', style: { flex: 1, minWidth: 180 }, placeholder: '项目名称（如：AI 基建）', value: name, onChange: (e) => setName(e.target.value) }),
          h(Btn, { variant: 'primary', disabled: busy || !name.trim(), onClick: submit }, busy ? '创建中…' : '创建并归集')),
        h('input', { className: 'wh-input', placeholder: '关键词 / 别名（逗号分隔，如 NewAPI, SkillHub, 安全审计）', value: keywords, onChange: (e) => setKeywords(e.target.value) }),
        h('details', null,
          h('summary', { className: 'wh-muted', style: { cursor: 'pointer', padding: '2px 0' } }, `绑定群聊（已选 ${chatIds.length}）`),
          h('div', { style: { maxHeight: 190, overflowY: 'auto', marginTop: 6 } }, chatOptions)),
        err ? h('div', { style: { color: 'var(--wh-bad)', fontSize: 12 } }, err) : null)
    }

    function ProjectDetail({ projectId, range }) {
      const [data, setData] = useState(null)
      const [err, setErr] = useState(null)
      const effRange = range?.preset || (range?.start && range?.end) ? range : { preset: 'last_30_days' }
      useEffect(() => {
        setData(null); setErr(null)
        api(`/analytics/project?projectId=${projectId}&${rangeQuery(effRange)}`)
          .then(setData).catch((e) => setErr(String(e.message)))
      }, [projectId, effRange.preset, effRange.start, effRange.end])
      if (err) return h(Card, { title: '加载失败' }, h('div', { style: { color: 'var(--wh-bad)' } }, err))
      if (!data) return h(Loading)
      const p = data.project
      const fs = data.factStats
      const reqEntries = Object.entries(fs?.requirements ?? {})
      const linkedGroups = Object.entries(data.linkedItems ?? {})

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(Card, {
          title: p.name,
          sub: `${data.range.startDate} ~ ${data.range.endDate} · 关联 ${data.total} 条工作记录`,
          action: h(Chip, { tone: p.origin === 'yunxiao' ? 'brand' : 'neutral' },
            p.origin === 'yunxiao' ? '云效项目' : '手动项目'),
        },
          h('div', { className: 'wh-stats' },
            h(Stat, { label: '报工工时', value: `${fs?.worklogHours ?? 0}h`, hint: `${fs?.worklogEntries ?? 0} 条报工` }),
            h(Stat, { label: '代码提交', value: fs?.commits ?? 0 }),
            h(Stat, { label: '任务', value: fs?.tasks ?? 0 }),
            h(Stat, { label: '会议', value: fs?.meetings ?? 0 }),
            h(Stat, { label: '需求', value: reqEntries.reduce((a, [, n]) => a + n, 0) }),
            h(Stat, { label: '对话消息', value: fs?.chatMessages ?? 0 }))),
        reqEntries.length
          ? h(Card, { title: '需求状态分布' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                reqEntries.sort((a, b) => b[1] - a[1]).map(([st, n]) =>
                  h('div', { key: st, className: 'wh-toolbar', style: { justifyContent: 'space-between' } },
                    h(Chip, { tone: 'neutral' }, st),
                    h('span', { className: 'wh-muted' }, `${n} 项`)))))
          : null,
        (data.inProgress ?? []).length
          ? h(Card, {
              title: `进行中需求 · ${data.inProgress.length}`,
              sub: `${data.range.startDate} ~ ${data.range.endDate} 内有更新 · 非终态需求`,
            },
              data.inProgress.map((r) => h(RequirementRow, { key: r.source_id, r })))
          : null,
        h(Card, { title: 'AI 洞察与分析' },
          (data.insights ?? []).length
            ? h('div', { className: 'wh-list' }, data.insights.map((a) => h(InsightCard, { key: a.id, a })))
            : h(Empty, { icon: '✦', title: '暂无项目洞察', hint: `在 DSH 对话中说「分析 ${p.name} 项目近 14 天并保存洞察」` })),
        h(Card, { title: '关联工作项', sub: '近 90 天 · 各来源前 6 条' },
          linkedGroups.length
            ? h('div', { className: 'wh-list' },
                linkedGroups.map(([type, items]) =>
                  h('div', { key: type },
                    h('div', { className: 'wh-section-title' }, `${typeLabel(type)} · ${items.length}`),
                    items.slice(0, 6).map((it) =>
                      h('div', { key: it.id, style: { display: 'flex', gap: 10, padding: '3px 0', fontSize: 12.5 } },
                        h('span', { className: 'wh-muted', style: { flex: 'none', width: 44 } }, (it.occurredAt || '').slice(5, 10)),
                        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                          it.title || '(无标题)'))))))
            : h(Empty, { icon: '◎', title: '暂无关联', hint: '检查项目关键词 / 群绑定，或先在数据管理同步' })))
    }

    function ProjectsPage({ range }) {
      const [data, setData] = useState(null)
      const [status, setStatus] = useState(null)
      const [msg, setMsg] = useState(null)
      const [selected, setSelected] = useState(null)
      const [inprog, setInprog] = useState(null)

      const load = useCallback(() => {
        api('/projects').then(setData).catch((e) => setMsg(String(e.message)))
        api('/sync/status').then(setStatus).catch(() => {})
      }, [])
      useEffect(() => { void load() }, [load])
      useEffect(() => {
        setInprog(null)
        api(`/analytics/inprogress/grouped?${rangeQuery(range)}`)
          .then(setInprog).catch(() => setInprog({ groups: [] }))
      }, [range.preset, range.start, range.end])

      const resolveNow = async () => {
        setMsg(null)
        try {
          const r = await api('/projects/resolve', { method: 'POST', body: '{}' })
          setMsg(`归集完成 — ${r.resolve.projects} 个项目 · ${r.resolve.linkedItems} 条已关联 / ${r.resolve.totalItems} 条`)
        } catch (e) { setMsg(`归集失败: ${e.message}`) }
      }
      const del = async (id, name) => {
        if (!window.confirm(`删除项目「${name}」？相关归集链接会一并清除。`)) return
        setMsg(null)
        try {
          await api('/projects/delete', { method: 'POST', body: JSON.stringify({ id }) })
          setMsg(`已删除 ${name}`)
          load()
        } catch (e) { setMsg(`删除失败: ${e.message}`) }
      }

      const rows = (data?.projects ?? []).map((p) =>
        h('tr', {
          key: p.id,
          className: selected === p.id ? 'wh-rowclick on' : 'wh-rowclick',
          onClick: () => setSelected(selected === p.id ? null : p.id),
        },
          h('td', null,
            h('div', { style: { fontWeight: 550 } }, p.name),
            p.rules.keywords.length
              ? h('div', { className: 'wh-tags', style: { marginTop: 4 } },
                  p.rules.keywords.slice(0, 6).map((k) => h(Chip, { key: k, tone: 'neutral' }, k)))
              : null),
          h('td', null, h(Chip, { tone: p.origin === 'yunxiao' ? 'brand' : 'neutral' },
            p.origin === 'yunxiao' ? '云效' : '手动')),
          h('td', { className: 'wh-muted' }, `${p.rules.chatIds.length} 个群`),
          h('td', { style: { textAlign: 'right' } },
            h(Btn, { size: 'sm', variant: 'ghost', onClick: (e) => { e.stopPropagation(); del(p.id, p.name) } }, '删除'))))

      return h('div', { className: 'wh-content' },
        msg ? h('div', { className: 'wh-card', style: { fontSize: 12 } }, msg) : null,
        h(Card, {
          title: '项目',
          sub: '点击行查看项目分析 · 云效项目自动同步',
          action: h(Btn, { onClick: resolveNow }, '重新归集'),
        },
          rows.length
            ? h('table', { className: 'wh-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '项目'), h('th', null, '来源'), h('th', null, '绑定'), h('th', null, ''))),
                h('tbody', null, rows))
            : h(Empty, { icon: '◎', title: '还没有项目', hint: '在下方创建第一个项目，或同步云效项目' })),
        selected && data?.projects?.some((p) => p.id === selected)
          ? h(ProjectDetail, { projectId: selected, range })
          : null,
        (inprog?.groups ?? []).length
          ? h(Card, {
              title: `进行中需求 · ${inprog.groups.reduce((a, g) => a + g.total, 0)} 项 / ${inprog.groups.length} 个项目`,
              sub: `${inprog.range?.startDate ?? ''} ~ ${inprog.range?.endDate ?? ''} 内有更新 · 每项目展示前 3 条`,
            },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
                inprog.groups.map((g) =>
                  h('div', { key: g.projectId },
                    h('div', { className: 'wh-toolbar', style: { justifyContent: 'space-between', marginBottom: 2 } },
                      h('span', { style: { fontWeight: 550 } }, g.name),
                      h(Chip, { tone: 'brand' }, `进行中 ${g.total}`)),
                    g.items.map((r) => h(RequirementRow, { key: r.source_id, r }))))))
          : null,
        h(Card, { title: '新建项目' },
          h(ProjectForm, { chats: status?.chats ?? [], onCreated: load })),
        h('div', { className: 'wh-muted', style: { textAlign: 'center' } },
          '归集规则：群聊绑定（整群消息）→ 关键词 / 别名匹配（待办 · 日志 · 会议）· 云效工作项按空间直连'))
    }

    /* --------------------------- time filter ---------------------------- */

    const PRESETS = [
      ['company_period', '上周五→本周四'],
      ['this_week', '本周'], ['last_week', '上周'], ['last_7_days', '最近 7 天'],
      ['today', '今天'], ['yesterday', '昨天'], ['this_month', '本月'], ['last_month', '上月'],
      ['last_30_days', '最近 30 天'], ['this_quarter', '本季度'], ['this_year', '今年'],
    ]

    /** Build the query string shared by every time-ranged page. */
    function rangeQuery(range, extra) {
      const q = new URLSearchParams()
      if (range.preset === 'custom' && range.start && range.end) {
        q.set('start', range.start)
        q.set('end', range.end)
      } else {
        q.set('preset', range.preset)
      }
      if (range.granularity) q.set('granularity', range.granularity)
      if (range.compare) q.set('compare', '1')
      for (const [k, v] of Object.entries(extra ?? {})) if (v != null) q.set(k, String(v))
      return q
    }

    const GRANULARITIES = [['day', '按日'], ['week', '按周'], ['month', '按月'], ['quarter', '按季度']]

    const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
    const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    /** Single date-range picker: button + popover calendar, two clicks pick start→end. */
    function RangePicker({ range, onChange }) {
      const [open, setOpen] = useState(false)
      const resolvedStart = range.resolved?.startDate ?? range.start ?? isoOf(new Date())
      const resolvedEnd = range.resolved?.endDate ?? range.end ?? resolvedStart
      const [cursor, setCursor] = useState(() => resolvedStart.slice(0, 7))
      const [from, setFrom] = useState(null)
      const [to, setTo] = useState(null)

      useEffect(() => {
        if (!open) {
          setFrom(null); setTo(null); setCursor(resolvedStart.slice(0, 7))
        }
      }, [open, resolvedStart])

      const [y, m] = cursor.split('-').map(Number)
      const daysInMonth = new Date(y, m, 0).getDate()
      const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7
      const cells = []
      for (let i = 0; i < lead; i++) cells.push(null)
      for (let d = 1; d <= daysInMonth; d++) cells.push(`${cursor}-${String(d).padStart(2, '0')}`)

      const shiftMonth = (n) => {
        const nm = new Date(y, m - 1 + n, 1)
        setCursor(`${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}`)
      }

      const pick = (date) => {
        if (!from || (from && to)) { setFrom(date); setTo(null); return }
        if (date < from) { setFrom(date); setTo(null); return }
        setTo(date)
        onChange({ ...range, preset: 'custom', start: from, end: date, granularity: null })
        setTimeout(() => setOpen(false), 120)
      }

      const dayEls = cells.map((date, i) => {
        if (!date) return h('div', { key: `b${i}` })
        const pStart = from ?? resolvedStart
        const pEnd = to ?? (from ? from : resolvedEnd)
        const inRange = date >= pStart && date <= pEnd
        const isEdge = date === pStart || date === pEnd
        return h('button', {
          key: date,
          className: 'wh-dp-day',
          onClick: () => pick(date),
          style: {
            border: 'none', cursor: 'pointer', height: 28, borderRadius: 6, fontSize: 12,
            background: isEdge ? 'var(--wh-accent)' : inRange ? 'var(--wh-accent-soft)' : 'transparent',
            color: isEdge ? '#fff' : 'var(--dsw-alias-label-primary)',
            fontWeight: isEdge ? 600 : 400,
          },
        }, String(Number(date.slice(8))))
      })

      const head = h('div', { className: 'wh-toolbar', style: { justifyContent: 'space-between', marginBottom: 8 } },
        h(Btn, { size: 'sm', variant: 'ghost', onClick: () => shiftMonth(-1) }, '‹'),
        h('span', { style: { fontWeight: 600, fontSize: 12.5 } }, `${y} 年 ${m} 月`),
        h(Btn, { size: 'sm', variant: 'ghost', onClick: () => shiftMonth(1) }, '›'))
      const weekRow = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 } },
        WEEK_LABELS.map((w) => h('div', { key: w, className: 'wh-muted', style: { textAlign: 'center', fontSize: 10 } }, w)))
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 } }, dayEls)
      const foot = h('div', { className: 'wh-toolbar', style: { justifyContent: 'space-between', marginTop: 8 } },
        h('span', { className: 'wh-muted', style: { fontSize: 11 } },
          from && !to ? '再选择结束日期' : `${from ?? resolvedStart} → ${to ?? (from ?? resolvedEnd)}`),
        h(Btn, { size: 'sm', onClick: () => setOpen(false) }, '关闭'))
      const popover = h('div', {
        className: 'wh-popover',
        style: {
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60, width: 300,
          background: 'var(--dsw-alias-bg-overlay)', border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: 10, padding: 12, boxShadow: '0 12px 32px rgba(0,0,0,.18)',
        },
      }, head, weekRow, grid, foot)
      const trigger = h(Btn, { size: 'sm', onClick: () => setOpen(!open) },
        `${resolvedStart} → ${resolvedEnd}`)
      return h('div', { style: { position: 'relative' } }, trigger, open ? popover : null)
    }

    function TimeBar({ range, onChange }) {
      // 预设变化时回填真实日期（resolved），保证右侧显示的是实际区间
      useEffect(() => {
        if (range.preset === 'custom' || !range.preset) return
        let alive = true
        api(`/time/resolve?preset=${range.preset}&compare=${range.compare ? '1' : '0'}`)
          .then((r) => { if (alive) onChange({ ...range, resolved: r.range }) })
          .catch(() => {})
        return () => { alive = false }
      }, [range.preset, range.compare])

      const setPreset = (id) => onChange({ ...range, preset: id, start: undefined, end: undefined, granularity: null, resolved: undefined })
      return h('div', { className: 'wh-toolbar' },
        h('div', { className: 'wh-seg' },
          PRESETS.slice(0, 5).map(([id, label]) =>
            h('button', {
              key: id,
              className: range.preset === id ? 'on' : '',
              onClick: () => setPreset(id),
            }, label))),
        h('select', {
          className: 'wh-select',
          value: PRESETS.some(([id]) => id === range.preset) ? range.preset : '',
          onChange: (e) => { if (e.target.value) setPreset(e.target.value) },
        },
          h('option', { value: '' }, '更多范围…'),
          PRESETS.map(([id, label]) => h('option', { key: id, value: id }, label))),
        h(RangePicker, { range, onChange }),
        h('select', {
          className: 'wh-select',
          value: range.granularity || '',
          onChange: (e) => onChange({ ...range, granularity: e.target.value || null }),
        },
          h('option', { value: '' }, '自动粒度'),
          GRANULARITIES.map(([id, label]) => h('option', { key: id, value: id }, label))),
        h('label', { className: 'wh-toolbar', style: { gap: 5, cursor: 'pointer', fontSize: 12 } },
          h('input', {
            type: 'checkbox', checked: range.compare,
            onChange: (e) => onChange({ ...range, compare: e.target.checked }),
          }), '对比上期'))
    }

    /* ---------------------------- Calendar ------------------------------ */

    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

    function DayPanel({ date, projectId }) {
      const [data, setData] = useState(null)
      const [err, setErr] = useState(null)
      const [copied, setCopied] = useState(false)
      const [busyGen, setBusyGen] = useState(false)
      const [genMsg, setGenMsg] = useState(null)
      const [expanded, setExpanded] = useState(false)
      const [tab, setTab] = useState('summary')
      const reload = useCallback(() => {
        setData(null); setErr(null)
        const q = new URLSearchParams({ date })
        if (projectId) q.set('projectId', projectId)
        return api(`/calendar/day?${q}`).then(setData).catch((e) => setErr(String(e.message)))
      }, [date, projectId])
      useEffect(() => { void reload() }, [reload])

      const quickGenerate = async () => {
        setBusyGen(true); setGenMsg(null)
        try {
          const r = await api('/generate/daily-draft', { method: 'POST', body: JSON.stringify({ date }) })
          setGenMsg(r.generatedBy === 'rule' ? '已用规则引擎生成草稿（可点「AI 精修」让 Agent 润色）' : '已生成')
          await reload()
        } catch (e) { setGenMsg(`生成失败: ${e.message}`) } finally { setBusyGen(false) }
      }

      const askAi = () => {
        const prompt = `请用 workhub_get_day_analysis_input 读取 ${date} 的工作事件，回答：当天最重要的事是什么、有哪些讨论未形成待办，并给出可追溯的来源。`
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(prompt).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }).catch(() => {})
        }
      }
      if (err) return h(Card, { title: '加载失败' }, h('div', { style: { color: 'var(--wh-bad)' } }, err))
      if (!data) return h(Loading)
      const s = data.summary
      const byType = data.metrics?.byType ?? {}

      const summaryBlock = s
        ? h('div', null,
            s.status === 'stale'
              ? h('div', { style: { marginBottom: 10 } },
                  h(Chip, { tone: 'warn' }, '◐ 数据已更新，建议重新生成'))
              : null,
            h('p', { style: { margin: '0 0 10px', lineHeight: 1.65 } }, s.overview),
            ...['achievements', 'decisions', 'blockers', 'nextActions'].map((k) => {
              const items = s[k] ?? []
              if (!items.length) return null
              const label = { achievements: '重点工作', decisions: '关键决策', blockers: '待跟进', nextActions: '下一步' }[k]
              const tone = k === 'blockers' ? 'bad' : k === 'decisions' ? 'brand' : 'neutral'
              return h('div', { key: k, style: { marginBottom: 10 } },
                h('div', { className: 'wh-section-title', style: { marginBottom: 4 } }, label),
                h('ul', { style: { margin: 0, paddingLeft: 18, lineHeight: 1.7 } },
                  items.map((x, i) => h('li', { key: i }, x))))
            }),
            h('div', { className: 'wh-muted' },
              `依据 ${s.sources?.length ?? 0} 条记录 · 生成于 ${new Date(s.generatedAt).toLocaleString()}`))
        : h(Empty, {
            icon: '✦',
            title: `当日 ${data.events.length} 条事件已归集，尚无 AI 总结`,
            hint: `在 DSH 对话中说「总结 ${date} 的工作并保存到日历」`,
          })

      const meta = s?.metrics ?? {}
      const extraBlocks = [
        meta.myToday?.length
          ? h('div', { key: 'today', style: { marginTop: 12 } },
              h('div', { className: 'wh-section-title' }, '我今天做了什么'),
              h('ul', { style: { margin: 0, paddingLeft: 18, lineHeight: 1.75 } },
                meta.myToday.map((x, i) => h('li', { key: i }, x))))
          : null,
        (meta.codeGroups ?? []).length
          ? h('div', { key: 'code', style: { marginTop: 12 } },
              h('div', { className: 'wh-section-title' }, `代码推进${meta.merges ? ` · 另有 ${meta.merges} 次分支合并` : ''}`),
              (meta.codeGroups ?? []).map((g) =>
                h('div', { key: g.key, style: { display: 'flex', gap: 8, padding: '3px 0', fontSize: 12.5 } },
                  h(Chip, { tone: 'brand' }, String(g.count)),
                  h('span', { style: { fontWeight: 500, whiteSpace: 'nowrap' } }, g.key),
                  h('span', { className: 'wh-muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    (g.titles ?? []).join(' · ')))))
          : null,
        (meta.communications ?? []).length
          ? h('div', { key: 'comm', style: { marginTop: 12 } },
              h('div', { className: 'wh-section-title' }, '沟通要点（我的发言）'),
              (meta.communications ?? []).map((c) =>
                h('div', { key: c.chat, style: { padding: '4px 0', fontSize: 12.5 } },
                  h('div', { style: { fontWeight: 500 } }, `${c.chat} · ${c.count} 条`),
                  (c.snippets ?? []).map((t, i) =>
                    h('div', { key: i, className: 'wh-muted', style: { whiteSpace: 'normal' } }, `「${t}」`)))))
          : null,
      ].filter(Boolean)

      const meetingNotes = data.meetings ?? []
      const noteCard = (m, i) => {
        const parts = [
          h('div', { className: 'wh-insight-head', key: 'head' },
            h('span', { className: 'wh-insight-title' }, m.title),
            m.durationMinutes ? h(Chip, { tone: 'neutral' }, `${m.durationMinutes} 分钟`) : null),
        ]
        if (m.summary) {
          parts.push(h('div', { key: 'sum', style: { marginTop: 5, lineHeight: 1.55, fontSize: 12.5 } }, m.summary))
        }
        if ((m.keywords ?? []).length) {
          parts.push(h('div', { key: 'kw', className: 'wh-tags', style: { marginTop: 6 } },
            m.keywords.map((k) => h(Chip, { key: k, tone: 'neutral' }, k))))
        }
        if ((m.actions ?? []).length) {
          parts.push(h('div', { key: 'act', style: { marginTop: 8 } },
            h('div', { className: 'wh-section-title' }, '行动项'),
            m.actions.map((a, j) => h('div', { key: j, style: { fontSize: 12.5, padding: '2px 0' } }, `· ${a}`))))
        }
        return h('div', { key: i, className: 'wh-insight', style: { borderLeftColor: 'var(--wh-accent)' } }, parts)
      }
      const meetingBlock = meetingNotes.length
        ? h(Card, {
            title: `会议纪要 · ${meetingNotes.length}`,
            sub: 'AI 听记摘要与行动项（来自钉钉听记 / 日程）',
          },
            h('div', { className: 'wh-list' }, meetingNotes.map(noteCard)))
        : null

      const milestones = (data.events ?? []).filter((e) => e.sourceType === 'milestone')
      const milestoneBlock = milestones.length
        ? h(Card, {
            title: `云效需求排期节点 · ${milestones.length}`,
            sub: '来自需求自定义字段（计划提测 / 计划完成 / 期望上线等）',
          },
            h('div', { className: 'wh-list' },
              milestones.map((m) =>
                h('div', { key: m.id, className: 'wh-toolbar', style: { alignItems: 'flex-start', gap: 8 } },
                  h('span', { style: { color: 'var(--wh-bad)', fontWeight: 600, whiteSpace: 'nowrap' } }, '📌 ' + (m.title ?? '')),
                  h('span', { className: 'wh-muted', style: { flex: 1, minWidth: 0 } }, m.contentPreview ?? ''),
                  (m.projects ?? []).map((p) => h(Chip, { key: p, tone: 'neutral' }, p))))))
        : null

      const REQ_RE = /\b([A-Z]{2,6}PRO-\d+)\b/
      const SYSTEM_TODO_RE = /^\[HR\]|忘记打卡|绩效考核|审批/
      const tlEvents = (data.events ?? []).filter((e) => e.sourceType !== 'milestone')
      const tlCommits = tlEvents.filter((e) => e.sourceType === 'commit')
      const tlSystemTodos = tlEvents.filter((e) => e.sourceType === 'todo' && SYSTEM_TODO_RE.test(e.title || ''))
      const tlChats = tlEvents.filter((e) => e.sourceType === 'chat_message')
      const tlMain = tlEvents.filter((e) =>
        e.sourceType !== 'commit' && e.sourceType !== 'chat_message' && !tlSystemTodos.includes(e))
      const me = meta.me
      const chatGroups = (() => {
        const g = new Map()
        for (const c of tlChats) {
          const name = c.chatName || '会话'
          const cur = g.get(name) ?? { name, count: 0, mine: 0, first: c.time, last: c.time, samples: [] }
          cur.count += 1
          if (me && c.actor === me) cur.mine += 1
          if (c.time && c.time < cur.first) cur.first = c.time
          if (c.time && c.time > cur.last) cur.last = c.time
          if (cur.samples.length < 3) cur.samples.push(c)
          g.set(name, cur)
        }
        return [...g.values()].sort((a, b) => b.count - a.count)
      })()
      const commitGroups = (() => {
        const g = new Map()
        let merges = 0
        for (const c of tlCommits) {
          const title = String(c.title ?? '')
          if (/^Merge\b/i.test(title)) { merges += 1; continue }
          const m = REQ_RE.exec(title)
          const key = m ? m[1] : '其他改动'
          const cur = g.get(key) ?? { key, count: 0, titles: [] }
          cur.count += 1
          if (cur.titles.length < 4) cur.titles.push(title)
          g.set(key, cur)
        }
        return { groups: [...g.values()].sort((a, b) => b.count - a.count), merges }
      })()

      const timelineRow = (e) =>
        h('div', { key: e.id, className: 'wh-tl' },
          h('span', { className: 'wh-tl-time' }, e.time || '--:--'),
          h('span', { className: 'wh-tl-dot', style: { background: typeColor(e.sourceType) } }),
          h('div', { className: 'wh-tl-body' },
            h('div', { className: 'wh-tl-title', title: e.title || '' },
              e.sourceType === 'chat_message' && e.chatName ? `${e.chatName} · ` : '',
              e.title || '(无标题)'),
            h('div', { className: 'wh-tags' },
              h(Chip, { tone: 'neutral' }, typeLabel(e.sourceType)),
              (e.projects ?? []).map((p) => h(Chip, { key: p, tone: 'brand' }, p)),
              e.actor ? h('span', { className: 'wh-muted' }, e.actor) : null)))

      const commitRow = tlCommits.length
        ? h('div', { key: 'commits', className: 'wh-tl' },
            h('span', { className: 'wh-tl-time' }, '全天'),
            h('span', { className: 'wh-tl-dot', style: { background: typeColor('commit') } }),
            h('div', { className: 'wh-tl-body' },
              h('div', { className: 'wh-tl-title' },
                `代码提交 ${tlCommits.length} 次 · ` +
                commitGroups.groups.slice(0, 4).map((g) => `${g.key}×${g.count}`).join('、') +
                (commitGroups.merges ? ` · 合并×${commitGroups.merges}` : '')),
              h('div', { className: 'wh-tags' },
                commitGroups.groups.slice(0, 3).map((g) =>
                  h('span', { key: g.key, className: 'wh-muted', style: { fontSize: 11 } },
                    `${g.key}: ${g.titles[0]?.slice(0, 30) ?? ''}`)))))
        : null

      const systemTodoRow = tlSystemTodos.length
        ? h('div', { key: 'sys-todo', className: 'wh-tl' },
            h('span', { className: 'wh-tl-time' }, '同步'),
            h('span', { className: 'wh-tl-dot', style: { background: 'var(--dsw-alias-state-idle-primary)' } }),
            h('div', { className: 'wh-tl-body' },
              h('div', { className: 'wh-tl-title' },
                `系统待办 ${tlSystemTodos.length} 条（HR / 绩效 / 忘打卡等历史同步项，非当日新增）`)))
        : null

      const chatRows = chatGroups.map((g) =>
        h('div', { key: 'chat-' + g.name, className: 'wh-tl' },
          h('span', { className: 'wh-tl-time' }, g.first || '--:--'),
          h('span', { className: 'wh-tl-dot', style: { background: typeColor('chat_message') } }),
          h('div', { className: 'wh-tl-body' },
            h('div', { className: 'wh-tl-title' },
              `${g.name} · ${g.count} 条消息${g.mine ? `（我 ${g.mine} 条）` : ''}`),
            h('div', { className: 'wh-tags' },
              g.samples.slice(0, 2).map((c, i) =>
                h('span', { key: i, className: 'wh-muted', style: { fontSize: 11, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  `${c.actor ?? ''}：${(c.title ?? '').slice(0, 40)}`))))))

      const showAll = expanded
      const timeline = data.events.length
        ? h('div', null,
            h('div', { className: 'wh-timeline' },
              [commitRow, systemTodoRow, ...chatRows, ...tlMain.map(timelineRow)].filter(Boolean)),
            showAll
              ? h('div', { style: { marginTop: 10, maxHeight: 320, overflowY: 'auto', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 8 } },
                  h('div', { className: 'wh-timeline' }, data.events.map(timelineRow)))
              : null,
            h('div', { style: { textAlign: 'center', marginTop: 10 } },
              h(Btn, { size: 'sm', variant: 'ghost', onClick: () => setExpanded(!showAll) },
                showAll ? '收起原始事件' : `展开全部 ${data.events.length} 条原始事件`)))
        : h(Empty, { icon: '◌', title: '当日无工作事件' })

      const inProgress = data.inProgress ?? []
      const summaryCard = h(Card, {
        title: `${date} 每日总结`,
        sub: [
          data.metrics?.checkIn ? `打卡 ${data.metrics.checkIn}–${data.metrics.checkOut ?? '未打卡下班'}` : null,
          data.metrics?.worklogHours ? `报工 ${data.metrics.worklogHours}h` : null,
          ...Object.entries(byType).map(([t, n]) => `${typeLabel(t)} ${n}`),
        ].filter(Boolean).join(' · '),
        action: h('div', { className: 'wh-toolbar', style: { gap: 6 } },
          h(Btn, {
            size: 'sm',
            variant: 'primary',
            disabled: busyGen,
            onClick: quickGenerate,
          }, busyGen ? '生成中…' : '快捷生成总结'),
          h(Btn, { size: 'sm', variant: 'ghost', onClick: askAi }, copied ? '已复制 ✓' : 'AI 精修')),
      },
        genMsg ? h('div', { className: 'wh-muted', style: { marginBottom: 8 } }, genMsg) : null,
        summaryBlock,
        ...extraBlocks)
      const inProgressCard = h(Card, {
        title: `进行中需求 · ${inProgress.length}`,
        sub: '当日有更新的非终态需求',
      },
        inProgress.length
          ? inProgress.map((r) => h(RequirementRow, { key: r.source_id, r }))
          : h(Empty, { icon: '◇', title: '当日无进行中需求更新', hint: '切换更宽的时间范围可在驾驶舱查看更多' }))
      const timelineCard = h(Card, { title: `工作事件时间线 · ${data.events.length}`, sub: '按发生时间排列 · 点击可对照原始来源' },
        timeline)

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        h(Tabs, {
          tabs: [
            ['summary', '总结'],
            ['req', `需求 · ${inProgress.length + milestones.length}`],
            ['events', `事件 · ${data.events.length}`],
          ],
          active: tab,
          onChange: setTab,
        }),
        tab === 'summary' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, summaryCard, meetingBlock) : null,
        tab === 'req' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } }, inProgressCard, milestoneBlock) : null,
        tab === 'events' ? timelineCard : null)
    }

    /** Small badge used inside calendar cells: 打卡 / 报工. */
    function CellBadge({ tone, children, title }) {
      const bg = tone === 'ok' ? 'var(--wh-ok-soft)' : tone === 'warn' ? 'var(--wh-warn-soft)' : 'var(--wh-accent-soft)'
      const fg = tone === 'ok' ? 'var(--wh-ok)' : tone === 'warn' ? 'var(--wh-warn)' : 'var(--wh-accent)'
      return h('span', {
        title,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 5px',
          borderRadius: 4, background: bg, color: fg, fontSize: 10, lineHeight: '15px',
          whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
        },
      }, children)
    }

    function CalAttWorkBadges({ d }) {
      if (!d) return null
      const badges = []
      if (d.attendance > 0) {
        const complete = d.attendanceComplete
        const label = complete
          ? `${d.checkIn ?? '?'}–${d.checkOut ?? '?'}`
          : `${d.checkIn ?? '--:--'} 单次`
        badges.push(h(CellBadge, {
          key: 'att',
          tone: complete ? 'ok' : 'warn',
          title: complete ? `打卡完整 ${d.checkIn}–${d.checkOut}` : '仅一次打卡，可能缺卡',
        }, `⏱ ${label}`))
      }
      if (d.worklogHours > 0) {
        badges.push(h(CellBadge, {
          key: 'wl',
          tone: 'accent',
          title: `${d.worklogEntries} 条报工记录`,
        }, `报 ${d.worklogHours}h`))
      }
      if (!badges.length) return null
      return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 1 } }, badges)
    }

    /** One calendar cell: date + attendance window + worklog hours (no counts, no milestones). */
    function CalCell({ date, d, selected, todayIso, onClick, tall }) {
      const isSel = date === selected
      const isToday = date === todayIso
      const events = d?.events ?? 0
      const chats = d?.chats ?? 0
      const workEvents = Math.max(0, events - chats)
      const level = workEvents === 0 ? 0 : workEvents < 8 ? 1 : workEvents < 20 ? 2 : workEvents < 45 ? 3 : workEvents < 80 ? 4 : 5
      const barColor = ['transparent', 'color-mix(in srgb, var(--wh-accent) 16%, transparent)',
        'color-mix(in srgb, var(--wh-accent) 30%, transparent)',
        'color-mix(in srgb, var(--wh-accent) 48%, transparent)',
        'color-mix(in srgb, var(--wh-accent) 66%, transparent)',
        'var(--wh-accent)'][level]
      const hasAtt = !!d?.attendance
      const hasWl = (d?.worklogHours ?? 0) > 0
      return h('div', {
        className: ['wh-cal-cell', isSel ? 'sel' : '', isToday ? 'today' : ''].filter(Boolean).join(' '),
        style: tall ? { minHeight: 116 } : null,
        onClick,
        title: d
          ? [
              date,
              d.checkIn ? `打卡 ${d.checkIn}–${d.checkOut ?? '未打卡下班'}` : '无打卡记录',
              hasWl ? `报工 ${d.worklogHours}h` : null,
              `${workEvents} 工作事件${chats ? ` + ${chats} 消息` : ''}`,
              d.milestoneCount ? `排期节点 ${d.milestoneCount}` : null,
              d.hasSummary ? '已有 AI 总结' : null,
            ].filter(Boolean).join(' · ')
          : date,
      },
        h('div', { className: 'wh-cal-top' },
          h('span', { className: 'wh-cal-day' }, String(Number(date.slice(8)))),
          isToday
            ? h('span', { className: 'wh-cal-today' }, '今日')
            : d?.hasSummary ? h('span', { style: { color: 'var(--wh-accent)', fontSize: 10 } }, '✦') : null),
        hasAtt
          ? h('div', { className: 'wh-cal-att' },
              h('span', { className: 'wh-cal-att-time' }, d.checkIn ?? '--:--'),
              d.checkOut ? h('span', { className: 'wh-cal-att-sep' }, '–') : null,
              d.checkOut ? h('span', { className: 'wh-cal-att-time' }, d.checkOut) : null,
              d.attendanceComplete ? null : h('span', { className: 'wh-cal-att-warn', title: '仅一次打卡，可能缺卡' }, '!'))
          : null,
        hasWl
          ? h('div', { className: 'wh-cal-wl' }, `报工 ${d.worklogHours}h`)
          : null,
        d?.topRequirement
          ? h('div', { className: 'wh-cal-req', title: `当日提交最多的需求：${d.topRequirement.serial}（${d.topRequirement.count} 次）` },
              d.topRequirement.serial,
              h('span', { className: 'wh-cal-req-x' }, `×${d.topRequirement.count}`))
          : null,
        h('div', { className: 'wh-cal-strength', style: { background: barColor } }))
    }

    function CalendarPage() {
      const today = new Date()
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const [month, setMonth] = useState(todayIso.slice(0, 7))
      const [selected, setSelected] = useState(todayIso)
      const [data, setData] = useState(null)
      const [projects, setProjects] = useState([])
      const [projectFilter, setProjectFilter] = useState('')
      const [view, setView] = useState('month')
      useEffect(() => { api('/projects').then((r) => setProjects(r.projects)).catch(() => {}) }, [])
      useEffect(() => {
        const q = new URLSearchParams({ month })
        if (projectFilter) q.set('projectId', projectFilter)
        api(`/calendar?${q}`).then(setData).catch(() => setData({ days: [] }))
      }, [month, projectFilter])
      const byDate = {}
      for (const d of data?.days ?? []) byDate[d.date] = d

      const [y, m] = month.split('-').map(Number)
      const first = new Date(y, m - 1, 1)
      const daysInMonth = new Date(y, m, 0).getDate()
      const lead = (first.getDay() + 6) % 7
      const cells = []
      for (let i = 0; i < lead; i++) cells.push(null)
      for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
      const shift = (n) => {
        const nm = new Date(y, m - 1 + n, 1)
        setMonth(`${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}`)
      }

      const cellEls = cells.map((date, i) => {
        if (!date) return h('div', { key: `e${i}`, className: 'wh-cal-cell blank' })
        return h(CalCell, { key: date, date, d: byDate[date], selected, todayIso, onClick: () => setSelected(date) })
      })

      const weekStart = (() => {
        const sel = new Date(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 1, Number(selected.slice(8, 10)))
        const monday = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() - ((sel.getDay() + 6) % 7))
        const arr = []
        for (let i = 0; i < 7; i++) {
          const dd = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
          arr.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`)
        }
        return arr
      })()

      const weekEls = weekStart.map((date) =>
        h(CalCell, { key: date, date, d: byDate[date], selected, todayIso, tall: true, onClick: () => setSelected(date) }))

      return h('div', { className: 'wh-content' },
        h('div', { className: 'wh-toolbar', style: { justifyContent: 'space-between' } },
          h('div', { className: 'wh-toolbar' },
            h(Btn, { size: 'sm', onClick: () => shift(-1) }, '‹'),
            h('span', { style: { fontWeight: 600, minWidth: 92, textAlign: 'center' } }, `${y} 年 ${m} 月`),
            h(Btn, { size: 'sm', onClick: () => shift(1) }, '›'),
            h('div', { className: 'wh-seg' },
              [['month', '月'], ['week', '周']].map(([id, label]) =>
                h('button', { key: id, className: view === id ? 'on' : '', onClick: () => setView(id) }, label)))),
          h('div', { className: 'wh-toolbar' },
            h('select', {
              className: 'wh-select', value: projectFilter,
              onChange: (e) => setProjectFilter(e.target.value),
            },
              h('option', { value: '' }, '全部项目'),
              projects.map((p) => h('option', { key: p.id, value: p.id }, p.name))))),
        h('div', { className: 'wh-muted', style: { marginTop: -6 } },
          '✦ = 已有 AI 总结 · 卡片展示打卡时段 / 报工时长 / 当日主力需求'),
        view === 'month'
          ? h('div', null,
              h('div', { className: 'wh-cal-head' },
                ['一', '二', '三', '四', '五', '六', '日'].map((w) => h('div', { key: w, className: 'wh-cal-wd' }, w))),
              h('div', { className: 'wh-cal' }, cellEls))
          : h('div', null,
              h('div', { className: 'wh-cal-head' },
                weekStart.map((date) => h('div', { key: date, className: 'wh-cal-wd' }, `周${'一二三四五六日'[(new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))).getDay() + 6) % 7]}`))),
              h('div', { className: 'wh-cal' }, weekEls)),
        h(DayPanel, { date: selected, projectId: projectFilter || undefined }))
    }

    /* ----------------------------- Reports ------------------------------ */

    function ReportsPage({ range }) {
      const [list, setList] = useState(null)
      const [summaries, setSummaries] = useState(null)
      const [busy, setBusy] = useState('')
      const [msg, setMsg] = useState(null)
      const [openReports, setOpenReports] = useState({})

      const loadSummaries = useCallback(() => {
        api('/summaries?days=90').then((r) => setSummaries(r.summaries)).catch(() => setSummaries([]))
      }, [])
      const loadReports = useCallback(() => {
        api('/analyses?kind=report_draft').then((r) => setList(r.analyses)).catch(() => setList([]))
      }, [])
      useEffect(() => { void loadSummaries(); void loadReports() }, [loadSummaries, loadReports])

      const genDaily = async (date) => {
        setBusy(`day:${date}`); setMsg(null)
        try {
          await api('/generate/daily-draft', { method: 'POST', body: JSON.stringify({ date }) })
          setMsg(`已生成 ${date} 的规则版总结`)
          loadSummaries()
        } catch (e) { setMsg(`生成失败: ${e.message}`) } finally { setBusy('') }
      }

      const genReport = async () => {
        setBusy('report'); setMsg(null)
        try {
          const body = { preset: range?.preset ?? 'company_period' }
          if (range?.preset === 'custom') { body.start = range.start; body.end = range.end }
          const r = await api('/generate/report-draft', { method: 'POST', body: JSON.stringify(body) })
          setMsg(`已生成周报草稿（${r.analysis.scope.startDate} ~ ${r.analysis.scope.endDate}）`)
          loadReports()
        } catch (e) { setMsg(`生成失败: ${e.message}`) } finally { setBusy('') }
      }

      const delReport = async (id, title) => {
        if (!window.confirm(`删除报告草稿「${title}」？`)) return
        try {
          await api('/analyses/delete', { method: 'POST', body: JSON.stringify({ id }) })
          setMsg('已删除报告草稿')
          loadReports()
        } catch (e) { setMsg(`删除失败: ${e.message}`) }
      }
      const delSummary = async (date) => {
        if (!window.confirm(`删除 ${date} 的每日总结？（可从日历重新生成）`)) return
        try {
          await api('/summaries/delete', { method: 'POST', body: JSON.stringify({ date }) })
          setMsg(`已删除 ${date} 的每日总结`)
          loadSummaries()
        } catch (e) { setMsg(`删除失败: ${e.message}`) }
      }

      const reports = (list ?? []).filter((a) => a.kind === 'report_draft')
      const exportMd = (id) => window.open(`/api/workhub/analyses/export?id=${encodeURIComponent(id)}`, '_blank')
      const exportDaily = (date) => window.open(`/api/workhub/summaries/export?date=${encodeURIComponent(date)}`, '_blank')

      const reportCards = reports.map((a) => {
        const open = !!openReports[a.id]
        return h(Card, {
          key: a.id,
          title: a.payload?.title || '报告草稿',
          sub: `${new Date(a.generatedAt).toLocaleString()} · 依据 ${a.sources?.length ?? 0} 条记录${a.payload?.generatedBy === 'rule' ? ' · 规则版' : ' · AI'}`,
          action: h('div', { className: 'wh-toolbar', style: { gap: 6 } },
            h(Btn, { size: 'sm', variant: 'ghost', onClick: () => setOpenReports({ ...openReports, [a.id]: !open }) },
              open ? '收起' : '展开全文'),
            h(Btn, { size: 'sm', onClick: () => exportMd(a.id) }, '导出 Markdown'),
            h(Btn, { size: 'sm', variant: 'ghost', onClick: () => delReport(a.id, a.payload?.title ?? '报告草稿') }, '删除')),
        },
          h('div', { className: `wh-clamp${open ? ' open' : ''}` },
            a.payload?.overview ? h('p', { style: { margin: '0 0 10px', lineHeight: 1.65 } }, a.payload.overview) : null,
            (a.payload?.sections ?? []).map((sec, i) =>
              h('div', { key: i, style: { marginBottom: 10 } },
                h('div', { className: 'wh-section-title' }, sec.title),
                h('div', { style: { fontSize: 12.5, whiteSpace: 'pre-wrap', lineHeight: 1.65 } }, sec.content)))))
      })

      const summaryCards = (summaries ?? []).map((sm) =>
        h(Card, {
          key: sm.date,
          title: `${sm.date} 每日总结`,
          sub: [
            sm.status === 'stale' ? '数据已更新（待重生成）' : '已生成',
            sm.metrics?.checkIn ? `打卡 ${sm.metrics.checkIn}–${sm.metrics.checkOut ?? '未打卡'}` : null,
            sm.metrics?.worklogHours ? `报工 ${sm.metrics.worklogHours}h` : null,
            `依据 ${sm.sources?.length ?? 0} 条`,
          ].filter(Boolean).join(' · '),
          action: h('div', { className: 'wh-toolbar', style: { gap: 6 } },
            h(Btn, { size: 'sm', onClick: () => exportDaily(sm.date) }, '导出'),
            h(Btn, {
              size: 'sm', variant: 'ghost', disabled: !!busy,
              onClick: () => genDaily(sm.date),
            }, busy === `day:${sm.date}` ? '生成中…' : '重生成'),
            h(Btn, { size: 'sm', variant: 'ghost', onClick: () => delSummary(sm.date) }, '删除')),
        },
          sm.overview ? h('p', { style: { margin: '0 0 6px', lineHeight: 1.6 } }, sm.overview) : null,
          h('div', { className: 'wh-tags' },
            (sm.achievements ?? []).slice(0, 3).map((x, i) => h(Chip, { key: i, tone: 'neutral' }, x.slice(0, 26))))))

      return h('div', { className: 'wh-content' },
        msg ? h('div', { className: 'wh-card', style: { fontSize: 12 } }, msg) : null,
        h(Card, {
          title: '报告草稿',
          sub: '规则版由面板即时生成（无需 AI）；AI 版在对话中让 Agent 起草',
          action: h(Btn, { variant: 'primary', size: 'sm', disabled: !!busy, onClick: genReport },
            busy === 'report' ? '生成中…' : '快捷生成周报草稿'),
        },
          reports.length ? h('div', { className: 'wh-list' }, reportCards) : h(Empty, {
            icon: '▤',
            title: '暂无报告草稿',
            hint: '点右上角「快捷生成周报草稿」，按当前时间范围生成规则版草稿',
          })),
        h(Card, {
          title: '每日总结',
          sub: `近 90 天 · ${(summaries ?? []).length} 篇（来自工作日历）`,
        },
          (summaries ?? []).length
            ? h('div', { className: 'wh-list' }, summaryCards)
            : h(Empty, { icon: '✦', title: '暂无每日总结', hint: '到工作日历选择日期，点「快捷生成总结」' })))
    }

    /* -------------------------- Chat insights --------------------------- */

    const TOPIC_TONE = { emerging: 'warn', discussing: 'brand', decided: 'brand', implementing: 'ok', resolved: 'ok', dormant: 'neutral' }

    function TopicsSection({ chatId }) {
      const list = useInsights({ kind: 'topic_cluster' })
      const clusters = (list ?? []).filter((a) => a.scope?.chatId === chatId)
      if (!clusters.length) {
        return h(Card, { title: '话题聚类' },
          h(Empty, {
            icon: '☰',
            title: '暂无聚类结果',
            hint: '在 DSH 对话中说「分析该会话近 14 天讨论话题并保存聚类」',
          }))
      }
      return h(Card, { title: '话题聚类', sub: 'AI 分析 · 每个话题携带证据消息' },
        h('div', { className: 'wh-list' },
          clusters.flatMap((a) =>
            (a.payload?.topics ?? []).map((t, i) =>
              h('div', { key: `${a.id}-${i}`, className: 'wh-insight', style: { borderLeftColor: 'var(--wh-accent)' } },
                h('div', { className: 'wh-insight-head' },
                  h('span', { className: 'wh-insight-title' }, t.name),
                  t.status ? h(Chip, { tone: TOPIC_TONE[t.status] ?? 'neutral' }, t.status) : null,
                  h('span', { className: 'wh-muted', style: { marginLeft: 'auto' } },
                    `${t.evidenceItemIds?.length ?? 0} 条证据`)),
                t.summary ? h('div', { style: { marginTop: 5, lineHeight: 1.55 } }, t.summary) : null)))))
    }

    function ChatSummarySection({ chatId }) {
      const [list, setList] = useState(null)
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState(null)

      const load = useCallback(() => {
        api('/analyses?kind=chat_summary')
          .then((r) => setList((r.analyses ?? []).filter((a) => a.scope?.chatId === chatId)))
          .catch(() => setList([]))
      }, [chatId])
      useEffect(() => { void load() }, [load])

      const generate = useCallback(async () => {
        setBusy(true); setMsg(null)
        try {
          await api('/generate/chat-summary', { method: 'POST', body: JSON.stringify({ chatId, days: 14 }) })
          setMsg('已生成会话小结（规则版）')
          load()
        } catch (e) { setMsg(`生成失败: ${e.message}`) } finally { setBusy(false) }
      }, [chatId, load])

      const askAi = () => {
        const prompt = `请用 workhub_get_chat_analysis_input 读取会话 ${chatId} 近 14 天的消息，输出：讨论主题、形成的结论、行动项（谁做什么）、未决问题，并用 workhub_save_topic_cluster 保存。`
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(prompt).then(() => setMsg('已复制 AI 提示词，去对话粘贴即可')).catch(() => {})
        }
      }

      const del = async (id) => {
        if (!window.confirm('删除这份会话小结？')) return
        try {
          await api('/analyses/delete', { method: 'POST', body: JSON.stringify({ id }) })
          load()
        } catch (e) { setMsg(`删除失败: ${e.message}`) }
      }

      if (!list) return h(Loading)
      const latest = list[0]
      const head = h('div', { className: 'wh-toolbar', style: { gap: 6 } },
        h(Btn, { size: 'sm', variant: 'primary', disabled: busy, onClick: generate }, busy ? '生成中…' : '快捷生成小结'),
        h(Btn, { size: 'sm', variant: 'ghost', onClick: askAi }, 'AI 精修'))
      if (!latest) {
        return h(Card, { title: '会话小结', sub: '规则版：话题分组 + 行动项 + 未决问题', action: head },
          msg ? h('div', { className: 'wh-muted', style: { marginBottom: 8 } }, msg) : null,
          h(Empty, { icon: '☰', title: '还没有这份会话的小结', hint: '点右上角「快捷生成小结」，直接从已采集消息生成' }))
      }
      const p = latest.payload ?? {}
      return h(Card, {
        title: '会话小结',
        sub: `${new Date(latest.generatedAt).toLocaleString()} · 依据 ${latest.sources?.length ?? 0} 条消息${p.generatedBy === 'rule' ? ' · 规则版' : ' · AI'}`,
        action: h('div', { className: 'wh-toolbar', style: { gap: 6 } },
          h(Btn, { size: 'sm', disabled: busy, onClick: generate }, busy ? '生成中…' : '重新生成'),
          h(Btn, { size: 'sm', variant: 'ghost', onClick: askAi }, 'AI 精修'),
          h(Btn, { size: 'sm', variant: 'ghost', onClick: () => del(latest.id) }, '删除')),
      },
        msg ? h('div', { className: 'wh-muted', style: { marginBottom: 8 } }, msg) : null,
        h('p', { style: { margin: '0 0 10px', lineHeight: 1.65 } }, p.overview),
        (p.topics ?? []).length
          ? h('div', { style: { marginBottom: 10 } },
              h('div', { className: 'wh-section-title' }, '话题分组'),
              (p.topics ?? []).map((t) =>
                h('div', { key: t.name, style: { padding: '4px 0', fontSize: 12.5 } },
                  h('div', { style: { fontWeight: 550 } }, `${t.name} · ${t.count} 条`),
                  (t.samples ?? []).map((x, i) => h('div', { key: i, className: 'wh-muted', style: { whiteSpace: 'normal' } }, `「${x}」`)))))
          : null,
        (p.actionItems ?? []).length
          ? h('div', { style: { marginBottom: 10 } },
              h('div', { className: 'wh-section-title' }, '行动项候选'),
              (p.actionItems ?? []).map((a, i) =>
                h('div', { key: i, style: { padding: '3px 0', fontSize: 12.5 } },
                  h(Chip, { tone: 'brand' }, a.sender), ' ', a.text)))
          : null,
        (p.questions ?? []).length
          ? h('div', null,
              h('div', { className: 'wh-section-title' }, '未决问题'),
              (p.questions ?? []).map((q, i) =>
                h('div', { key: i, style: { padding: '3px 0', fontSize: 12.5 } },
                  h(Chip, { tone: 'warn' }, q.sender), ' ', q.text)))
          : null)
    }

    function ChatInsightsPage({ initialChatId = '' }) {
      const [status, setStatus] = useState(null)
      const [chatId, setChatId] = useState(initialChatId)
      const [input, setInput] = useState(null)
      const [err, setErr] = useState(null)
      const [busyCollect, setBusyCollect] = useState(false)
      useEffect(() => { api('/sync/status').then(setStatus).catch(() => {}) }, [])
      useEffect(() => {
        if (!chatId) { setInput(null); return }
        setErr(null); setInput(null)
        api(`/analyses/input/chat?chatId=${encodeURIComponent(chatId)}&days=14`)
          .then(setInput).catch((e) => setErr(String(e.message)))
      }, [chatId])

      const allChats = (status?.chats ?? []).filter((c) => c.name || c.conversation_id)
      const collected = allChats.filter((c) => c.messageCount > 0)
      const senderEntries = input
        ? Object.entries(input.stats.bySender).sort((a, b) => b[1] - a[1]).slice(0, 10)
        : []
      const senderMax = Math.max(1, ...senderEntries.map(([, n]) => n))

      return h('div', { className: 'wh-content' },
        h(Card, {
          title: '聊天洞察',
          sub: allChats.length
            ? `${allChats.length} 个会话 · 已采集 ${collected.length} 个`
            : '尚无会话数据',
          action: h('div', { className: 'wh-toolbar', style: { gap: 6 } },
            h('select', {
              className: 'wh-select', value: chatId,
              style: { maxWidth: 240 },
              onChange: (e) => setChatId(e.target.value),
            },
              h('option', { value: '' }, '选择会话…'),
              allChats.map((c) => h('option', { key: c.conversation_id, value: c.conversation_id },
                `${c.name || c.conversation_id.slice(0, 18)}${c.messageCount ? ` (${c.messageCount})` : ' · 未采集'}`))),
            chatId && !(collected.find((c) => c.conversation_id === chatId))
              ? h(Btn, {
                  size: 'sm', variant: 'primary', disabled: busyCollect,
                  onClick: async () => {
                    setBusyCollect(true)
                    try {
                      await api('/chats/collect', { method: 'POST', body: JSON.stringify({ conversationId: chatId, sinceDays: 14 }) })
                      const r = await api('/sync/status')
                      setStatus(r)
                      setErr(null)
                      // 重新触发输入加载
                      const input = await api(`/analyses/input/chat?chatId=${encodeURIComponent(chatId)}&days=14`)
                      setInput(input)
                    } catch (e) { setErr(String(e.message)) } finally { setBusyCollect(false) }
                  },
                }, busyCollect ? '采集中…' : '立即采集该会话')
              : null),
        },
          !allChats.length
            ? h(Empty, { icon: '◌', title: '暂无会话数据', hint: '先在数据管理同步「dws.chats」' })
            : null),
        err ? h(Card, { title: '读取失败' }, h('div', { style: { color: 'var(--wh-bad)' } }, err)) : null,
        input
          ? h('div', { className: 'wh-grid2' },
              h(Card, {
                title: input.chat.name || chatId,
                sub: `近 14 天 · ${input.stats.total} 条消息 · ${input.stats.participants} 人参与`,
              },
                h('div', { className: 'wh-stats', style: { marginBottom: 10 } },
                  h(Stat, { label: '消息数', value: input.stats.total }),
                  h(Stat, { label: '参与人数', value: input.stats.participants }),
                  h(Stat, { label: '发言人数', value: senderEntries.length })),
                senderEntries.length
                  ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                      senderEntries.map(([s, n]) =>
                        h(BarRow, {
                          key: s,
                          name: s,
                          value: Math.round((n / input.stats.total) * 100),
                          max: 100,
                          color: 'var(--wh-accent)',
                        })))
                  : h(Empty, { icon: '◇', title: '暂无发言统计', hint: '采集会话后显示' })),
              h(Card, { title: '最近消息', sub: '前 20 条 · 用于人工核对' },
                h('div', {
                  style: { maxHeight: 430, overflowY: 'auto', paddingRight: 4 },
                },
                  (input.messages ?? []).slice(0, 20).map((m) =>
                    h('div', { key: m.itemId, className: 'wh-msg' },
                      h('div', { className: 'wh-msg-meta' }, `${m.day?.slice(5)} ${m.sender}`),
                      h('div', { className: 'wh-msg-text' }, m.text))))))
          : null,
        chatId ? h(ChatSummarySection, { chatId }) : null,
        chatId ? h(TopicsSection, { chatId }) : null)
    }

    /* ---------------------------- Efficiency ---------------------------- */

    function EfficiencyPage({ range }) {
      const [data, setData] = useState(null)
      const [err, setErr] = useState(null)
      useEffect(() => {
        setData(null); setErr(null)
        api(`/analytics/efficiency?${rangeQuery(range)}`).then(setData).catch((e) => setErr(String(e.message)))
      }, [range.preset, range.start, range.end])
      if (err) return h(Card, { title: '加载失败' }, h('div', { style: { color: 'var(--wh-bad)' } }, err))
      if (!data) return h(Loading)
      const maxHour = Math.max(1, ...data.hourHistogram)
      const actorMax = Math.max(1, ...data.topActors.map((a) => a.n))
      return h('div', { className: 'wh-content' },
        h(Card, {
          title: '工作时间热力图',
          sub: `${data.range.startDate} ~ ${data.range.endDate} · 活动代理指标，非实际工时`,
        },
          h(Heatmap, { matrix: data.matrix })),
        h(Card, { title: '时段分布', sub: '按小时聚合' },
          h('div', { className: 'wh-hour' },
            data.hourHistogram.map((n, hour) =>
              h('div', {
                key: hour,
                className: n ? 'wh-hour-bar' : 'wh-hour-bar dim',
                title: `${hour}:00 — ${n} 事件`,
                style: { height: `${Math.max(2, (n / maxHour) * 100)}%` },
              }))),
          h('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: 6 } },
            h('span', { className: 'wh-muted' }, '0 时'),
            h('span', { className: 'wh-muted' }, '12 时'),
            h('span', { className: 'wh-muted' }, '23 时'))),
        data.topActors.length
          ? h(Card, { title: '协作对象', sub: '消息 / 记录中出现次数 Top 10' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                data.topActors.map((a) =>
                  h(BarRow, { key: a.actor, name: a.actor, value: a.n, max: actorMax, color: 'var(--wh-accent)' }))))
          : null)
    }

    /* ----------------------------- Actions ------------------------------ */

    const ENV_STATE = { RUNNING: '运行中', DEPLOYING: '部署中', NEW: '未部署', ERROR: '异常' }
    const ORDER_TYPE = { Deploy: '部署', Rollback: '回滚', Scale: '扩缩', Destroy: '销毁' }
    const envTone = (s) => (s === 'RUNNING' ? 'ok' : s === 'DEPLOYING' ? 'brand' : s === 'ERROR' ? 'bad' : 'neutral')
    const orderTone = (s) => (s === 'SUCCESS' ? 'ok' : s === 'FAILED' ? 'bad' : s === 'RUNNING' || s === 'INIT' || s === 'PREPARING' ? 'brand' : 'neutral')

    function ActionsPage({ initialTab = 'flow' }) {
      const [data, setData] = useState(null)
      const [msg, setMsg] = useState(null)
      const [busy, setBusy] = useState('')
      const [appsData, setAppsData] = useState(null)
      const [selApp, setSelApp] = useState('')
      const [detail, setDetail] = useState(null)
      const load = useCallback(() => api('/actions/pipelines').then(setData).catch((e) => setMsg(String(e.message))), [])
      useEffect(() => { void load() }, [load])

      useEffect(() => {
        void api('/actions/appstack')
          .then((r) => {
            setAppsData(r)
            if (r.apps?.length) setSelApp((cur) => cur || r.apps[0].name)
          })
          .catch((e) => setAppsData({ apps: [], error: { message: String(e.message) } }))
      }, [])

      useEffect(() => {
        if (!selApp) return
        setDetail(null)
        void api(`/actions/appstack/detail?app=${encodeURIComponent(selApp)}`)
          .then(setDetail)
          .catch((e) => setDetail({ error: { message: String(e.message) } }))
      }, [selApp])

      const run = async (pipelineId, name) => {
        if (!window.confirm(`确认运行流水线？\n\n${name}（id: ${pipelineId}）\n\n该操作将真实触发云效流水线执行。`)) return
        setBusy(pipelineId); setMsg(null)
        try {
          const r = await api('/actions/pipelines/run', { method: 'POST', body: JSON.stringify({ pipelineId }) })
          setMsg(`已触发运行 #${r.runId}（${name}）`)
          load()
        } catch (e) { setMsg(`运行失败: ${e.message}`) } finally { setBusy('') }
      }

      const deploy = async (envName) => {
        if (!selApp) return
        const envLabel = (detail?.envs ?? []).find((e) => e.name === envName)?.displayName ?? envName
        if (!window.confirm(`确认部署应用？\n\n应用：${selApp}\n环境：${envLabel}\n\n将使用最新编排版本创建部署单（真实发布）。`)) return
        setBusy(`deploy:${envName}`); setMsg(null)
        try {
          const r = await api('/actions/appstack/deploy', { method: 'POST', body: JSON.stringify({ appName: selApp, envName, userConfirmed: true }) })
          setMsg(`已创建部署单「${r.order?.name ?? ''}」· 状态 ${r.order?.state || 'INIT'}`)
          void api(`/actions/appstack/detail?app=${encodeURIComponent(selApp)}`).then(setDetail)
          load()
        } catch (e) { setMsg(`部署失败: ${e.message}`) } finally { setBusy('') }
      }

      const pipelines = data?.pipelines ?? []
      const actions = data?.actions ?? []
      const [actTab, setActTab] = useState(initialTab)

      const flowCard = h(Card, { title: '云效流水线', sub: `${pipelines.length} 条 · 运行需二次确认` },
        pipelines.length
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              pipelines.map((p) =>
                h('div', {
                  key: p.id,
                  className: 'wh-toolbar',
                  style: { justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
                },
                  h('div', null,
                    h('div', { style: { fontWeight: 500 } }, p.title?.replace('流水线 · ', '') || p.source_id),
                    h('div', { className: 'wh-muted' }, `id ${p.source_id}${p.occurred_at ? ` · ${new Date(p.occurred_at).toLocaleDateString()}` : ''}`)),
                  h(Btn, { variant: 'danger', size: 'sm', disabled: !!busy, onClick: () => run(p.source_id, p.title) },
                    busy === p.source_id ? '运行中…' : '运行'))))
          : h(Empty, { icon: '⚙', title: '暂无流水线', hint: '先在数据管理同步 yunxiao.pipelines' }))

      const appstackCard = h(Card, { title: '应用交付', sub: `${appsData?.apps?.length ?? 0} 个应用 · 环境与部署单实时查询 · 部署需二次确认` },
          appsData?.error
            ? h('div', { className: 'wh-muted', style: { fontSize: 12 } }, `⚠ ${appsData.error.message}`)
            : (appsData?.apps?.length ?? 0) === 0
              ? h(Empty, { icon: '⬆', title: '暂无应用交付应用', hint: '云效 Appstack 应用会显示在这里' })
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
                  h('div', { className: 'wh-toolbar', style: { justifyContent: 'space-between' } },
                    h('select', {
                      className: 'wh-select', value: selApp,
                      onChange: (e) => setSelApp(e.target.value),
                    },
                      (appsData.apps ?? []).map((a) => h('option', { key: a.name, value: a.name }, a.name))),
                    detail?.orchestration?.sha
                      ? h('span', { className: 'wh-muted', style: { fontSize: 11 } }, `最新编排 ${String(detail.orchestration.sha).slice(0, 8)} · ${detail.orchestration.message || '无描述'}`)
                      : null),
                  detail?.error
                    ? h('div', { className: 'wh-muted', style: { fontSize: 12 } }, `⚠ ${detail.error.message}`)
                    : !detail
                      ? h('div', { className: 'wh-muted', style: { fontSize: 12 } }, '加载环境与部署单…')
                      : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                          (detail.envs ?? []).length
                            ? (detail.envs ?? []).map((e) =>
                              h('div', {
                                key: e.name,
                                className: 'wh-toolbar',
                                style: { justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
                              },
                                h('div', null,
                                  h('div', { style: { fontWeight: 500 } }, e.displayName || e.name),
                                  h('div', { className: 'wh-muted' }, `${e.name}${e.deployGroup ? ` · 部署组 ${e.deployGroup}` : ''}`)),
                                h('div', { className: 'wh-toolbar', style: { gap: 6 } },
                                  h(Chip, { tone: envTone(e.state) }, ENV_STATE[e.state] ?? e.state ?? '未知'),
                                  h(Btn, { variant: 'danger', size: 'sm', disabled: !!busy, onClick: () => deploy(e.name) },
                                    busy === `deploy:${e.name}` ? '部署中…' : '部署'))))
                            : h(Empty, { icon: '◇', title: '该应用暂无环境', hint: '在云效 Appstack 中为应用创建环境' }),
                          (detail.orders ?? []).length
                            ? h('div', { style: { marginTop: 6 } },
                                h('div', { className: 'wh-muted', style: { fontSize: 11, marginBottom: 4 } }, '最近部署单'),
                                (detail.orders ?? []).map((o, i) =>
                                  h('div', {
                                    key: `${o.name}-${i}`,
                                    className: 'wh-toolbar',
                                    style: { justifyContent: 'space-between', fontSize: 12, padding: '4px 0' },
                                  },
                                    h('div', { className: 'wh-toolbar', style: { gap: 6 } },
                                      h(Chip, { tone: orderTone(o.state) }, o.state || '?'),
                                      h('span', null, `${ORDER_TYPE[o.type] ?? o.type ?? '—'} · ${o.name}`)),
                                    h('span', { className: 'wh-muted', style: { whiteSpace: 'nowrap' } },
                                      o.createdAt ? new Date(o.createdAt).toLocaleString() : ''))))
                            : null)))

      return h('div', { className: 'wh-content' },
        msg ? h('div', { className: 'wh-card', style: { fontSize: 12 } }, msg) : null,
        h(Tabs, {
          tabs: [['flow', `流水线 · ${pipelines.length}`], ['appstack', `应用交付 · ${appsData?.apps?.length ?? 0}`]],
          active: actTab,
          onChange: setActTab,
        }),
        actTab === 'flow' ? flowCard : null,
        actTab === 'appstack' ? appstackCard : null,
        h(Card, { title: '操作审计日志', sub: '所有写操作留痕' },
          actions.length
            ? h('table', { className: 'wh-table' },
                h('thead', null, h('tr', null,
                  h('th', null, '时间'), h('th', null, '操作方'), h('th', null, '动作'), h('th', null, '目标'), h('th', null, '结果'))),
                h('tbody', null, actions.map((a) =>
                  h('tr', { key: a.id },
                    h('td', { className: 'wh-muted', style: { whiteSpace: 'nowrap' } }, new Date(a.created_at).toLocaleString()),
                    h('td', null, a.operator),
                    h('td', null, a.action),
                    h('td', { className: 'wh-muted' }, a.target ?? ''),
                    h('td', null, h(Chip, { tone: a.status === 'ok' ? 'ok' : 'bad' }, a.status))))))
            : h(Empty, { icon: '◫', title: '暂无操作记录' })),
        h('div', { className: 'wh-muted', style: { textAlign: 'center' } },
          '安全策略：查询直接执行 · 流水线运行与应用部署需确认 · 全部写操作审计留痕'))
    }

    /* ------------------------------ shell ------------------------------ */

    const Icons = {
      dashboard: (p) => h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, ...p },
        h('rect', { x: 3, y: 3, width: 7.5, height: 7.5, rx: 2 }),
        h('rect', { x: 13.5, y: 3, width: 7.5, height: 4.5, rx: 2 }),
        h('rect', { x: 3, y: 13.5, width: 7.5, height: 7.5, rx: 2 }),
        h('rect', { x: 13.5, y: 10.5, width: 7.5, height: 10.5, rx: 2 })),
      calendar: (p) => h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, ...p },
        h('rect', { x: 3, y: 4.5, width: 18, height: 16, rx: 3 }),
        h('path', { d: 'M3 9.5h18M8 3v3M16 3v3' })),
      projects: (p) => h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, ...p },
        h('path', { d: 'M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' })),
      chats: (p) => h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, ...p },
        h('path', { d: 'M4 5.5h16v10H9l-5 4z' })),
      efficiency: (p) => h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, ...p },
        h('path', { d: 'M4 19V9M10 19V5M16 19v-7M22 19H2' })),
      reports: (p) => h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, ...p },
        h('path', { d: 'M6 3h9l4 4v14H6z' }), h('path', { d: 'M9 12h7M9 16h5' })),
      actions: (p) => h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, ...p },
        h('path', { d: 'M5 4l14 8-14 8z' })),
      data: (p) => h('svg', { viewBox: '0 0 24 24', width: 15, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, ...p },
        h('ellipse', { cx: 12, cy: 6, rx: 8, ry: 3 }), h('path', { d: 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6' })),
    }

    const PAGES = [
      ['dashboard', '工作驾驶舱', Dashboard, '今日工作全景与趋势', '分析'],
      ['calendar', '工作日历', CalendarPage, '按天回顾工作事件与 AI 总结', '分析'],
      ['projects', '项目分析', ProjectsPage, '跨钉钉与云效的项目进展', '分析'],
      ['chats', '聊天洞察', ChatInsightsPage, '会话统计与话题聚类', '洞察'],
      ['efficiency', '工作效能', EfficiencyPage, '工作活动分布与节奏', '洞察'],
      ['reports', '智能报告', ReportsPage, 'Agent 生成的报告草稿', '产出'],
      ['actions', '快捷执行', ActionsPage, '流水线运行与操作审计', '执行'],
      ['data', '数据管理', DataManager, '数据源、同步与凭证', '系统'],
    ]

    function WorkHubIcon({ size = 20 }) {
      const r = (x, y, o) => h('rect', { x, y, width: 8, height: 8, rx: 2, fill: 'currentColor', opacity: o })
      return h('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true, style: { display: 'block' } },
        r(3, 3, 0.92), r(13, 3, 0.5), r(3, 13, 0.5), r(13, 13, 0.92))
    }

    function DataSourcePill({ kind, label, status, onClick }) {
      const tone = kind === 'ding' ? { bg: 'rgba(22,119,255,.12)', fg: '#1677FF' }
        : { bg: 'rgba(232,93,4,.13)', fg: '#C2410C' }
      const dotColor = status === 'connected'
        ? 'var(--wh-ok)'
        : status === 'expired' ? 'var(--wh-warn)'
          : status === 'error' ? 'var(--wh-bad)' : 'var(--dsw-alias-state-idle-primary)'
      const text = { connected: '已连接', expired: '已过期', error: '异常', disconnected: '未连接' }[status] ?? '未连接'
      return h('button', {
        className: 'wh-ds-pill',
        style: { background: tone.bg, color: tone.fg },
        title: `${label} · ${text}（点击进入数据管理）`,
        onClick,
      },
        h('span', { style: { width: 6, height: 6, borderRadius: '50%', background: dotColor, flex: 'none' } }),
        label)
    }

    function WorkHubPanel() {
      const [page, setPage] = useState('dashboard')
      const [range, setRange] = useState({ preset: 'this_week', granularity: null, compare: false })
      const [dsStatus, setDsStatus] = useState(null)
      useEffect(() => {
        let alive = true
        const tick = () => api('/sources')
          .then((r) => { if (alive) setDsStatus({ ding: r.dingtalk?.status, yx: r.yunxiao?.status }) })
          .catch(() => {})
        void tick()
        return () => { alive = false }
      }, [page])
      const current = PAGES.find(([id]) => id === page) ?? PAGES[0]
      const usesTime = ['dashboard', 'efficiency', 'reports', 'projects'].includes(current[0])

      let lastGroup = null
      const nav = []
      for (const [id, label, , , group] of PAGES) {
        if (group !== lastGroup) {
          nav.push(h('div', { key: `g-${group}`, className: 'wh-group' }, group))
          lastGroup = group
        }
        const Icon = Icons[id]
        nav.push(h('button', {
          key: id,
          className: page === id ? 'wh-nav on' : 'wh-nav',
          onClick: () => setPage(id),
        }, Icon ? h(Icon) : null, h('span', null, label)))
      }

      const sidebar = h('aside', { className: 'wh-side' },
        h('div', { className: 'wh-brand' },
          h('div', { className: 'wh-brand-mark' }, h(WorkHubIcon, { size: 16 })),
          h('div', null,
            h('div', { className: 'wh-brand-name' }, 'WorkHub'),
            h('div', { className: 'wh-brand-tag' }, '钉钉 × 云效 工作台'))),
        nav)

      const header = h('header', { className: 'wh-top' },
        h('div', null,
          h('div', { className: 'wh-toolbar', style: { gap: 8 } },
            h('div', { className: 'wh-title' }, current[1]),
            h('div', { className: 'wh-toolbar', style: { gap: 6 } },
              h(DataSourcePill, { kind: 'ding', label: '钉钉', status: dsStatus?.ding, onClick: () => setPage('data') }),
              h(DataSourcePill, { kind: 'yx', label: '云效', status: dsStatus?.yx, onClick: () => setPage('data') }))),
          h('div', { className: 'wh-sub' }, current[3])),
        usesTime ? h(TimeBar, { range, onChange: setRange }) : null)

      const pageProps = current[0] === 'dashboard'
        ? { range, setRange }
        : current[0] === 'efficiency' || current[0] === 'reports' || current[0] === 'projects'
          ? { range }
          : null
      const body = h(ErrorBoundary, { name: current[1], key: current[0] },
        h(current[2], pageProps))

      const main = h('div', { className: 'wh-main' },
        header,
        h('div', { className: 'wh-scroll' }, body))

      return h('div', { className: 'wh-root' }, styleTag(), sidebar, main)
    }

    // debug/testing hook: page components for smoke tests
    window.__WORKHUB_DEBUG__ = { PAGES, TimeBar, SourcesSection, ProjectDetail, DayPanel, TopicsSection, ChatSummarySection, Heatmap, InsightCard, Stat, Card, Btn, CSS }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'workhub', order: 20, label: 'WorkHub' },
            WorkHubIcon,
          ))
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: 'workhub', label: 'WorkHub' },
            WorkHubPanel,
          ))
      },
    }
  },
})
