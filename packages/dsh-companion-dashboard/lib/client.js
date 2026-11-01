/**
 * dsh-companion-dashboard —— 浏览器半（dsh.client bundle 格式，与 dsh-meme 同款）。
 *
 * 只在 dsh-better-sidebar 里注册一个「控制中心」Tab：记忆（原生内嵌，直接调
 * dsh-anima 的 /anima/api）+ QQ/B站/表情包（状态与入口提示，不跳转）。
 * 没有任何构建步骤：一律 React.createElement，不用 JSX。
 */
window.__ModuleLoader__.load({
  id: 'dsh-companion-dashboard',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useCallback = React.useCallback

    // 临时探针：桌面版 renderer 里这份 bundle 拿到的 react 是哪一个（重启后看日志）
    try { console.error('[cmp-probe] build=0.1.35 react=' + String(React && React.version) + ' useState=' + typeof React.useState + ' keys=' + Object.keys(React || {}).length) } catch (e) { console.error('[cmp-probe] react probe failed', e) }

    const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']
    const API = '/companion/api'
    const ANIMA = '/anima/api'

    /** 切换模型后那句「QQ 聊天同步了什么」的补充说明（POST /model 的 chatSwitch 字段）。 */
    function chatSwitchText(data) {
      const chat = data && data.chatSwitch
      if (!chat) return ''
      if (chat.ok) return chat.switched > 0 ? '；已同步到 ' + chat.switched + ' 个 QQ 聊天' : '；QQ 聊天没有需要同步的选择'
      if (chat.reason === 'no-chat-yet') return '；QQ 还没有活跃聊天，等收到消息后自动跟随'
      return '；QQ 聊天同步失败（' + String(chat.reason || 'unknown') + '）'
    }

    // ---- 样式：一次性注入，类名统一 cmp- 前缀 ----
    const CSS = [
      '.cmp-panel{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.cmp-nav{display:flex;gap:6px;padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}',
      '.cmp-nav button{cursor:pointer;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;border-radius:999px;padding:4px 12px;font-size:12px}',
      '.cmp-nav button.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.cmp-body{flex:1;min-height:0;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:12px}',
      '.cmp-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}',
      '.cmp-card h4{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.04em;text-transform:uppercase}',
      '.cmp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.cmp-muted{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.cmp-item{border-top:1px solid var(--dsw-alias-border-l1);padding:8px 0;display:flex;flex-direction:column;gap:6px}',
      '.cmp-item:first-of-type{border-top:none}',
      '.cmp-text{white-space:pre-wrap;line-height:1.5}',
      '.cmp-btn{cursor:pointer;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;border-radius:6px;padding:3px 10px;font-size:12px}',
      '.cmp-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.cmp-btn.danger{color:#d9534f;border-color:#d9534f}',
      '.cmp-btn:disabled{opacity:.45;cursor:default}',
      '.cmp-input,.cmp-area{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit}',
      '.cmp-grid{display:grid;grid-template-columns:64px 1fr;gap:6px 8px;align-items:center}',
'.cmp-picker{max-height:232px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:4px;margin:6px 0 10px}',
      '.cmp-pickgroup{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);padding:6px 8px 2px}',
'.cmp-pick{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1.35}',
'.cmp-pick:hover{background:var(--dsw-alias-bg-layer-2)}',
'.cmp-pick.on{background:var(--dsw-alias-brand-primary);color:#fff}',
'.cmp-pick input{margin:0}',
'.cmp-pick-order{flex:0 0 18px;text-align:center;font-variant-numeric:tabular-nums;color:inherit;font-size:12px;opacity:.75}',
'.cmp-pick.on .cmp-pick-order{opacity:1;font-weight:600}',
'.cmp-pick-label{flex:1 1 auto;word-break:break-all}',
      '.cmp-note{border-left:2px solid var(--dsw-alias-brand-primary);padding-left:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}',
      '.cmp-badge{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;border:1px solid var(--dsw-alias-border-l1)}',
      '.cmp-badge.ok{color:#2e9e5b;border-color:#2e9e5b}',
      '.cmp-badge.no{color:var(--dsw-alias-label-secondary)}',
      '.cmp-toast{font-size:12px;padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}',
      '.cmp-qrwrap{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin:8px 0}',
      '.cmp-qr{width:168px;height:168px;image-rendering:pixelated;background:#fff;border-radius:8px;padding:6px;box-sizing:border-box}',
      '.cmp-lbl { font-size: 12px; color: var(--dsw-alias-text-secondary); margin: 0 0 4px; }',
  '.cmp-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }',
  '.cmp-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: var(--dsw-alias-bg-elevated); font-size: 12px; }',
  '.cmp-chip-x { border: 0; background: transparent; cursor: pointer; color: var(--dsw-alias-text-secondary); font-size: 14px; line-height: 1; padding: 0; }',
  '.cmp-check { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--dsw-alias-text-secondary); }',
  '.cmp-num { width: 56px; }',
  '.cmp-day { border: 0; cursor: pointer; opacity: 0.45; }',
  '.cmp-day.on { opacity: 1; outline: 1px solid var(--dsw-alias-border); }',
  '.cmp-pool { width: 100%; box-sizing: border-box; font: inherit; font-size: 12px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border); background: var(--dsw-alias-bg-elevated); color: inherit; resize: vertical; }',
].join('\n')

    let styleInjected = false
    function ensureStyle() {
      if (styleInjected || typeof document === 'undefined') return
      styleInjected = true
      const node = document.createElement('style')
      node.setAttribute('data-dsh-companion', 'dashboard')
      node.textContent = CSS
      document.head.appendChild(node)
    }

    async function readJson(res) {
      const body = await res.json().catch(() => null)
      if (!res.ok || !body || body.ok !== true) {
        throw new Error((body && body.error) || 'HTTP ' + res.status)
      }
      return body.data
    }
    async function apiGet(path) {
      return readJson(await fetch(path, { headers: { Accept: 'application/json' } }))
    }
    async function apiPost(path, payload) {
      return readJson(await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload == null ? {} : payload),
      }))
    }

    // dsh-bili-pond 的路由直接把字段摊在顶层（{ok:true,current,providers,…}），
    // 没有 {ok,data} 外壳 ⇒ 不能用上面那两个，否则 body.data 是 undefined。
    async function apiGetRaw(path) {
      const res = await fetch(path, { headers: { Accept: 'application/json' } })
      const body = await res.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('HTTP ' + res.status)
      if (body.ok === false) throw new Error(String(body.error || ('HTTP ' + res.status)))
      return body
    }
    async function apiPostRaw(path, payload) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload == null ? {} : payload),
      })
      const body = await res.json().catch(() => null)
      if (!body || typeof body !== 'object') throw new Error('HTTP ' + res.status)
      if (body.ok === false) throw new Error(String(body.error || ('HTTP ' + res.status)))
      return body
    }

    // ---- 通道实时状态：同源直读子插件自己的路由（浏览器半自带 dsh-auth cookie）----
    // 每个分支给若干候选路由，按顺序试：装上哪套通道就用哪套的状态端点。
    const LIVE_ROUTES = {
      qq: ['/dsh-napcat-keeper/state?light=1', '/api/qqbot-settings/read'],
      bili: ['/api/bili-pond/status'],
      meme: ['/dsh-memes-api?packId=all'],
    }

    async function probeLive(id, routes) {
      let last = ''
      for (const route of routes) {
        try {
          const res = await fetch(route, { headers: { Accept: 'application/json' } })
          const body = await res.json().catch(() => null)
          if (!res.ok) { last = 'HTTP ' + String(res.status); continue }
          return { lines: summarizeLive(id, body), error: '', route, body }
        } catch (error) {
          last = error.message
        }
      }
      throw new Error(last || '没有可用的状态路由')
    }

    // 快捷操作：直接打 NapCat 看门狗自己的动作端点（同源，浏览器半自带 dsh-auth cookie）
    async function keeperAction(action) {
      const res = await fetch('/dsh-napcat-keeper/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ do: action }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error('HTTP ' + String(res.status))
      return (body && body.said) || '已执行'
    }

    function qrUrl(stamp) {
      return API + '/napcat/qr?t=' + String(stamp)
    }

    function listKeys(value) {
      const keys = Object.keys(value || {})
      return keys.length === 0 ? '尚无配置项' : keys.join(', ')
    }

    function summarizeLive(id, body) {
      if (!body) return []
      if (id === 'qq') {
        const runtime = body.runtime
        if (runtime) {
          const lines = [
            'NapCat：' + (runtime.online ? '在线' : '离线') + (runtime.phase ? '（' + runtime.phase + '）' : ''),
            '端口 ' + String(runtime.portUsed || '?') + (runtime.portAlive ? ' 已监听' : ' 未监听') +
              (runtime.mode ? '，模式 ' + runtime.mode : ''),
          ]
          if (runtime.nickname) lines.push('登录账号：' + runtime.nickname + (runtime.userId ? '（' + String(runtime.userId) + '）' : ''))
          lines.push('看门狗：' + (runtime.enabled ? '开' : '关') +
            '，拉起 ' + String(runtime.launchCount || 0) + ' 次，重扫码 ' + String(runtime.scanRetries || 0) + ' 次')
          if (runtime.hint) lines.push(runtime.hint)
          return lines
        }
        return [
          '配置项：' + listKeys(body.value),
          '来源：' + (body.source || '未知') + (body.writerProfile ? '（profile ' + body.writerProfile + '）' : ''),
        ]
      }
      if (id === 'bili') {
        const config = body.config || (body.data && body.data.config) || {}
        const lines = []
        if (config.perDay != null) lines.push('每日互动额度：' + String(config.perDay) + ' 次')
        lines.push('自动运行：' + (config.autoRun ? '开' : '关'))
        lines.push('写操作：' + (config.autoRun ? '按额度执行' : '关闭（当前只读）'))
        const home = body.home || (body.data && body.data.home)
        if (home) lines.push('数据目录：' + home)
        return lines
      }
      if (id === 'meme') {
        const packs = body.packs || []
        return [
          '图库：' + String(packs.length) + ' 个（共 ' + String(body.total || 0) + ' 张）',
          packs.map((pack) => pack.name + '×' + String(pack.count)).join('、'),
        ]
      }
      return []
    }

    function Row(props) {
      return h('div', { className: 'cmp-row' }, props.children)
    }
    function Card(props) {
      return h('div', { className: 'cmp-card' }, props.title ? h('h4', null, props.title) : null, props.children)
    }
    function Badge(props) {
      return h('span', { className: 'cmp-badge ' + (props.ok ? 'ok' : 'no') }, props.ok ? '已安装' : '未安装')
    }

    // ---- 记忆分支：原生内嵌裁决 ----
    function MemoryBranch(props) {
      const [pending, setPending] = useState({ total: 0, entries: [] })
      const [approved, setApproved] = useState(0)
      const [draft, setDraft] = useState('')
      const [persona, setPersona] = useState({ name: '', userCall: '', role: '', style: '' })
      const [scope, setScope] = useState({ memoryScope: 'global', channelPrefixes: ['onebot-'], channelProfile: false })
      const [busy, setBusy] = useState('')
      const [toast, setToast] = useState('')

      const reload = useCallback(async () => {
        try {
          const [pend, appr, per, set] = await Promise.all([
            apiGet(ANIMA + '/pending?limit=50'),
            apiGet(ANIMA + '/approved'),
            apiGet(ANIMA + '/persona'),
            apiGet(ANIMA + '/settings').catch(function () { return { memoryScope: 'global', channelPrefixes: ['onebot-'], channelProfile: false } }),
          ])
          setPending({ total: pend.total || 0, entries: pend.entries || [] })
          setApproved(appr.total || 0)
          setPersona({ name: per.name || '', userCall: per.userCall || '', role: per.role || '', style: per.style || '' })
          setScope({ memoryScope: set.memoryScope || 'global', channelPrefixes: set.channelPrefixes || ['onebot-'], channelProfile: set.channelProfile === true })
        } catch (error) {
          setToast('读取 anima 失败：' + error.message)
        }
      }, [])

      useEffect(() => { reload() }, [reload])

      const decide = async (id, decision) => {
        setBusy(id)
        try {
          await apiPost(ANIMA + '/decide', { id, decision })
          setToast(decision === 'approve' ? '已通过，写入长期记忆' : '已拒绝，丢弃')
          await reload()
          if (props.onCounts) props.onCounts()
        } catch (error) {
          setToast('裁决失败：' + error.message)
        } finally {
          setBusy('')
        }
      }

      const capture = async () => {
        const text = draft.trim()
        if (!text) return
        setBusy('capture')
        try {
          await apiPost(ANIMA + '/capture', { text, source: 'dashboard', tags: [] })
          setDraft('')
          setToast('已加入待审缓冲区（不会自动生效）')
          await reload()
          if (props.onCounts) props.onCounts()
        } catch (error) {
          setToast('加入候选失败：' + error.message)
        } finally {
          setBusy('')
        }
      }

      const saveScope = async (next) => {
        setBusy('scope')
        try {
          const saved = await apiPost(ANIMA + '/settings', { memoryScope: next })
          setScope({ memoryScope: saved.memoryScope || next, channelPrefixes: saved.channelPrefixes || ['onebot-'], channelProfile: saved.channelProfile === true })
          setToast(next === 'onesoul' ? '记忆只在 Onesoul 通道注入（QQ / B站 值班）' : '记忆对所有会话都注入')
        } catch (error) {
          setToast('切换记忆范围失败：' + error.message)
        } finally {
          setBusy('')
        }
      }

      const savePersona = async () => {
        setBusy('persona')
        try {
          await apiPost(ANIMA + '/persona', {
            name: persona.name, userCall: persona.userCall, role: persona.role, style: persona.style,
          })
          setToast('人设已保存，下一轮对话起生效')
          await reload()
        } catch (error) {
          setToast('保存人设失败：' + error.message)
        } finally {
          setBusy('')
        }
      }

      const bind = (key) => ({
        className: 'cmp-input',
        value: persona[key],
        onChange: (event) => setPersona({ ...persona, [key]: event.target.value }),
      })

      return h('div', { className: 'cmp-body' }, [
        toast ? h('div', { key: 'toast', className: 'cmp-toast' }, toast) : null,
        h(Card, { key: 'counts', title: '记忆池' },
          h(Row, null,
            h('span', null, '待审 ' + String(pending.total) + ' 条'),
            h('span', { className: 'cmp-muted' }, '已确认 ' + String(approved) + ' 条'),
            h('button', { className: 'cmp-btn', onClick: reload, disabled: !!busy }, '刷新'),
          ),
          h('div', { className: 'cmp-note', style: { marginTop: 8 } },
            '候选不会自动生效：只有你在这里点「通过」，它才会进入长期记忆并注入人格。'),
        ),
        h(Card, { key: 'scope', title: '记忆生效范围' },
          h(Row, null,
            h('button', {
              className: 'cmp-btn' + (scope.memoryScope === 'global' ? ' primary' : ''),
              disabled: busy === 'scope',
              onClick: () => saveScope('global'),
            }, scope.memoryScope === 'global' ? '全局（已选）' : '全局'),
            h('button', {
              className: 'cmp-btn' + (scope.memoryScope === 'onesoul' ? ' primary' : ''),
              disabled: busy === 'scope',
              onClick: () => saveScope('onesoul'),
            }, scope.memoryScope === 'onesoul' ? '仅 Onesoul 通道（已选）' : '仅 Onesoul 通道'),
          ),
          h('div', { className: 'cmp-note', style: { marginTop: 8 } },
            scope.memoryScope === 'onesoul'
              ? '长期记忆与临时记忆只进 Onesoul 通道会话（会话 id 前缀 ' + String((scope.channelPrefixes || []).join(' / ')) + '）' + (scope.channelProfile ? '，以及整个值班进程' : '') + '；桌面/网页里的普通对话完全隔开：人设、通道小抄、记忆一条都不注入。'
              : '长期记忆与临时记忆对所有会话都注入：桌面、网页、QQ、B站值班共用一份。'),
        ),
        h(Card, { key: 'pending', title: '待审候选' },
          pending.entries.length === 0
            ? h('div', { className: 'cmp-muted' }, '暂无待审候选。')
            : pending.entries.map((entry) => h('div', { key: entry.id, className: 'cmp-item' },
                h('div', { className: 'cmp-text' }, entry.text),
                h(Row, null,
                  h('span', { className: 'cmp-muted' }, (entry.source || 'unknown') + ' · ' + String(entry.createdAt || '').slice(0, 19)),
                  h('button', { className: 'cmp-btn primary', disabled: busy === entry.id, onClick: () => decide(entry.id, 'approve') }, '通过'),
                  h('button', { className: 'cmp-btn danger', disabled: busy === entry.id, onClick: () => decide(entry.id, 'reject') }, '拒绝'),
                ),
              )),
        ),
        h(Card, { key: 'capture', title: '手动加入候选' },
          h('textarea', {
            className: 'cmp-area', rows: 3, value: draft,
            placeholder: '写一条你想让她记住的事，加入后仍需在这里裁决。',
            onChange: (event) => setDraft(event.target.value),
          }),
          h('div', { className: 'cmp-row', style: { marginTop: 8, justifyContent: 'flex-end' } },
            h('button', { className: 'cmp-btn', disabled: busy === 'capture', onClick: capture }, '加入待审'),
          ),
        ),
        h(Card, { key: 'persona', title: '人设（全局）' },
          h('div', { className: 'cmp-grid' }, [
            h('span', { key: 'l1', className: 'cmp-muted' }, '名字'),
            h('input', { key: 'f1', ...bind('name'), placeholder: '她叫什么' }),
            h('span', { key: 'l2', className: 'cmp-muted' }, '称呼'),
            h('input', { key: 'f2', ...bind('userCall'), placeholder: '她怎么称呼你' }),
            h('span', { key: 'l3', className: 'cmp-muted' }, '角色'),
            h('input', { key: 'f3', ...bind('role'), placeholder: '一句话身份' }),
            h('span', { key: 'l4', className: 'cmp-muted' }, '风格'),
            h('input', { key: 'f4', ...bind('style'), placeholder: '语气与表达习惯' }),
          ]),
          h('div', { className: 'cmp-row', style: { marginTop: 10, justifyContent: 'flex-end' } },
            h('button', { className: 'cmp-btn primary', disabled: busy === 'persona', onClick: savePersona }, '保存人设'),
          ),
        ),
      ])
    }

    // ---- QQ：把 NapCat 的登录/拉起/重启搬进控制中心，不跳设置页 ----
    function QqLoginCard(props) {
      const { online, installed, onDone } = props
      const [stamp, setStamp] = useState(0)
      const [said, setSaid] = useState('')
      const [busy, setBusy] = useState('')
      const [qrMissing, setQrMissing] = useState(false)
      useEffect(() => {
        setStamp(Date.now())
        setQrMissing(false)
        if (online) return undefined
        const timer = setInterval(() => setStamp(Date.now()), 15000)
        return () => clearInterval(timer)
      }, [online])
      const run = useCallback((action, label) => {
        setBusy(action)
        setSaid(label + '中…')
        // 拉起走仪表盘自己的可见窗口通道（keeper 的隐藏窗口实测起不来），失败才退回 keeper
        const task = action === 'start'
          ? apiPost(API + '/napcat/start', {}).then((data) => {
            return '已用可见窗口拉起 NapCat（' + String((data && data.spawned) || '') + '），等它出新码点「刷新二维码」'
          }).catch(() => keeperAction('launch'))
          : keeperAction(action)
        task
          .then((text) => { setSaid(text); if (onDone) onDone() })
          .catch((error) => setSaid(label + '失败：' + error.message))
          .finally(() => setBusy(''))
      }, [onDone])
      if (!installed) {
        return h(Card, { title: 'NapCat 登录' }, h('div', { className: 'cmp-muted' }, '没装 dsh-napcat-keeper，这一块不显示登录入口。'))
      }
      return h(Card, { title: 'NapCat 登录（不用跳设置页）' },
        h('div', { className: 'cmp-muted', style: { lineHeight: 1.6 } },
          online
            ? '当前在线，不需要扫码。'
            : '离线时这里直接显示 NapCat 的登录二维码：用要发言的那个 QQ 号扫，手机上记得点「确认登录」。',
        ),
        online ? null : h('div', { className: 'cmp-qrwrap' },
          qrMissing
            ? h('div', { className: 'cmp-muted' }, '现在还没有二维码（NapCat 没起来或已登录）。先点「拉起」，等它写出新码再刷新。')
            : h('img', {
              className: 'cmp-qr',
              src: qrUrl(stamp),
              alt: 'NapCat 登录二维码',
              onError: () => setQrMissing(true),
              onLoad: () => setQrMissing(false),
            }),
        ),
        h('div', { className: 'cmp-row', style: { marginTop: 8 } },
          h('button', { className: 'cmp-btn', disabled: busy !== '', onClick: () => run('probe', '重新探测') }, '重新探测'),
          h('button', { className: 'cmp-btn', disabled: busy !== '', onClick: () => run('start', '拉起') }, '拉起 NapCat'),
          h('button', { className: 'cmp-btn primary', disabled: busy !== '', onClick: () => run('restart', '重启') }, '重启 NapCat'),
          h('button', { className: 'cmp-btn', disabled: busy !== '', onClick: () => run('hideConsole', '收起控制台') }, '收起控制台窗口'),
          h('button', { className: 'cmp-btn', disabled: busy !== '', onClick: () => setStamp(Date.now()) }, '刷新二维码'),
        ),
        said ? h('div', { className: 'cmp-toast', style: { marginTop: 8 } }, said) : null,
      )
    }

    // ---- 主人号 / 朋友号 + 主动互动 ----
    // 刻意写成 class 组件：理由同 BiliDutyCardV2（桌面侧边栏里第一次 useState 可能
    // 抛 Cannot read properties of undefined (reading 'current')）。
    function dutyStateText(why) {
      if (why === 'disabled') return '已关闭'
      if (why === 'no-owner') return '还没设主人号'
      if (why === 'outside-window') return '不在时段内'
      if (why === 'nothing-new') return '值班还没产出'
      if (why === 'already-pushed') return '这一轮已经提过'
      if (why === 'cooling') return '冷却中'
      return '待推送'
    }

    function fmtTime(ts) {
      if (!ts) return '还没发过'
      const d = new Date(ts)
      const two = (n) => String(n).padStart(2, '0')
      return (d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes())
    }

    class OwnerCard extends React.Component {
      constructor(props) {
        super(props)
        this.state = { data: null, ownerInput: '', friendInput: '', poolText: '', interval: '', winStart: '', winEnd: '', days: [1, 2, 3, 4, 5, 6, 7], dutyMax: '', dutyCool: '', busy: '', said: '', error: '' }
        this.refresh = this.refresh.bind(this)
        this.save = this.save.bind(this)
        this.sendNow = this.sendNow.bind(this)
        this.sendDutyNow = this.sendDutyNow.bind(this)
        this.saveDuty = this.saveDuty.bind(this)
      }

      componentDidMount() { this.refresh() }

      refresh() {
        return apiGet(API + '/interact').then((data) => {
          const p = (data && data.proactive) || {}
          this.setState({
            data: data,
            error: '',
            interval: String(p.intervalMinutes || 90),
            winStart: String(p.windowStart === undefined ? 9 : p.windowStart),
            winEnd: String(p.windowEnd === undefined ? 23 : p.windowEnd),
            days: Array.isArray(p.days) && p.days.length > 0 ? p.days : [1, 2, 3, 4, 5, 6, 7],
            poolText: (p.pool || []).join('\n'),
            dutyMax: String((p.dutyPush && p.dutyPush.maxItems) || 2),
            dutyCool: String((p.dutyPush && p.dutyPush.cooldownMinutes) || 30),
          })
        }).catch((error) => this.setState({ error: error.message }))
      }

      save(patch, label) {
        this.setState({ busy: 'save', said: (label || '保存') + '中…' })
        return apiPost(API + '/interact', patch).then((data) => {
          this.setState({ data: data, busy: '', said: label || '已保存' })
        }).catch((error) => this.setState({ busy: '', said: (label || '保存') + '失败：' + error.message }))
      }

      ids() {
        const d = this.state.data || {}
        return { owners: d.owners || [], friends: d.friends || [] }
      }

      addOwner() {
        const id = String(this.state.ownerInput || '').trim()
        if (!/^\d{5,12}$/.test(id)) { this.setState({ said: 'QQ 号要 5-12 位数字' }); return }
        const owners = this.ids().owners
        if (owners.indexOf(id) >= 0) { this.setState({ said: '这个号已经在列表里' }); return }
        this.save({ owners: owners.concat([id]) }, '已加主人号 ' + id).then(() => this.setState({ ownerInput: '' }))
      }

      removeOwner(id) { this.save({ owners: this.ids().owners.filter((x) => x !== id) }, '已移除 ' + id) }

      addFriend() {
        const id = String(this.state.friendInput || '').trim()
        if (!/^\d{5,12}$/.test(id)) { this.setState({ said: 'QQ 号要 5-12 位数字' }); return }
        const friends = this.ids().friends
        if (friends.indexOf(id) >= 0) { this.setState({ said: '这个号已经在列表里' }); return }
        this.save({ friends: friends.concat([id]) }, '已加朋友号 ' + id).then(() => this.setState({ friendInput: '' }))
      }

      removeFriend(id) { this.save({ friends: this.ids().friends.filter((x) => x !== id) }, '已移除 ' + id) }

      toggleProactive() {
        const p = (this.state.data && this.state.data.proactive) || {}
        const next = !p.enabled
        this.save({ proactive: { enabled: next } }, next ? '主动互动已开启' : '主动互动已关闭')
      }

      toggleDay(n) {
        const cur = Array.isArray(this.state.days) ? this.state.days : []
        const next = cur.includes(n) ? cur.filter(function (x) { return x !== n }) : cur.concat([n]).sort(function (a, b) { return a - b })
        this.setState({ days: next })
      }

      saveProactive() {
        this.save({
          proactive: {
            intervalMinutes: this.state.interval,
            windowStart: this.state.winStart,
            windowEnd: this.state.winEnd,
            days: this.state.days,
            pool: String(this.state.poolText || '').split('\n'),
          },
        }, '互动设置已保存')
      }

      setUseModel(useModel) { this.save({ proactive: { useModel: useModel } }, useModel ? '改用模型生成' : '改回本地模板') }

      sendNow() {
        this.setState({ busy: 'send', said: '正在发…' })
        return apiPost(API + '/interact/send', {}).then((info) => {
          this.setState({ busy: '', said: '已发送（' + ((info && info.source) === 'model' ? '模型' : '模板') + '）：' + ((info && info.text) || '') })
          return this.refresh()
        }).catch((error) => this.setState({ busy: '', said: '发送失败：' + error.message }))
      }

      toggleDuty() {
        const dp = (this.state.data && this.state.data.proactive && this.state.data.proactive.dutyPush) || {}
        const next = dp.enabled === false
        this.save({ proactive: { dutyPush: { enabled: next } } }, next ? '值班推送已开启' : '值班推送已关闭')
      }

      saveDuty() {
        this.save({ proactive: { dutyPush: { maxItems: this.state.dutyMax, cooldownMinutes: this.state.dutyCool } } }, '值班推送设置已保存')
      }

      sendDutyNow() {
        this.setState({ busy: 'duty', said: '正在提…' })
        return apiPost(API + '/interact/send', { duty: true, force: true }).then((info) => {
          this.setState({ busy: '', said: '已推送：' + ((info && info.text) || '') })
          return this.refresh()
        }).catch((error) => this.setState({ busy: '', said: '推送失败：' + error.message }))
      }

      renderBody() {
        const { data, error, busy, said } = this.state
        if (!data && error) return h('div', { className: 'cmp-toast' }, '读不到互动设置：' + error)
        if (!data) return h('div', { className: 'cmp-muted' }, '读取中…')
        const p = data.proactive || {}
        const dp = p.dutyPush || {}
        const duty = data.duty || null
        const owners = data.owners || []
        const friends = data.friends || []
        const chip = (id, onRemove) => h('span', { key: 'c' + id, className: 'cmp-chip' },
          id, h('button', { className: 'cmp-chip-x', onClick: onRemove, title: '移除' }, '×'))
        return h('div', { className: 'cmp-card' },
          h('h4', { style: { margin: '0 0 6px' } }, '主人号 / 朋友号'),
          h('div', { className: 'cmp-muted', style: { lineHeight: 1.6 } }, '主人号：会收到定时主动消息。朋友号：正常应答即可，这里只是名录。'),
          h('div', { className: 'cmp-lbl', style: { marginTop: 8 } }, '主人号'),
          h('div', { className: 'cmp-chips' }, owners.length === 0 ? h('span', { className: 'cmp-muted' }, '还没设置') : owners.map((id) => chip(id, () => this.removeOwner(id)))),
          h('div', { className: 'cmp-row', style: { marginTop: 6 } },
            h('input', { value: this.state.ownerInput, placeholder: '主人号 QQ 号', onChange: (e) => this.setState({ ownerInput: e.target.value }) }),
            h('button', { className: 'cmp-btn', disabled: busy !== '', onClick: () => this.addOwner() }, '加为主人号'),
          ),
          h('div', { className: 'cmp-lbl', style: { marginTop: 10 } }, '朋友号'),
          h('div', { className: 'cmp-chips' }, friends.length === 0 ? h('span', { className: 'cmp-muted' }, '还没设置') : friends.map((id) => chip(id, () => this.removeFriend(id)))),
          h('div', { className: 'cmp-row', style: { marginTop: 6 } },
            h('input', { value: this.state.friendInput, placeholder: '朋友号 QQ 号', onChange: (e) => this.setState({ friendInput: e.target.value }) }),
            h('button', { className: 'cmp-btn', disabled: busy !== '', onClick: () => this.addFriend() }, '加为朋友号'),
          ),
          h('div', { className: 'cmp-lbl', style: { marginTop: 12 } }, '主动互动（发主人号）'),
          h('div', { className: 'cmp-row' },
            h('label', { className: 'cmp-check' }, h('input', { type: 'checkbox', checked: p.enabled === true, onChange: () => this.toggleProactive() }), '开启'),
            h('span', { className: 'cmp-muted' }, '每'),
            h('input', { className: 'cmp-num', value: this.state.interval, onChange: (e) => this.setState({ interval: e.target.value }) }),
            h('span', { className: 'cmp-muted' }, '分钟一条，只在'),
            h('input', { className: 'cmp-num', value: this.state.winStart, onChange: (e) => this.setState({ winStart: e.target.value }) }),
            h('span', { className: 'cmp-muted' }, '点到'),
            h('input', { className: 'cmp-num', value: this.state.winEnd, onChange: (e) => this.setState({ winEnd: e.target.value }) }),
            h('span', { className: 'cmp-muted' }, '点之间'),
          ),
          h('div', { className: 'cmp-row', style: { marginTop: 6 } },
            h('span', { className: 'cmp-muted' }, '哪几天：'),
            DAY_LABELS.map((label, index) => {
              const n = index + 1
              const on = (this.state.days || []).includes(n)
              return h('button', { key: 'day' + n, className: 'cmp-chip cmp-day' + (on ? ' on' : ''), onClick: () => this.toggleDay(n) }, label)
            }),
            h('button', { className: 'cmp-btn', onClick: () => this.setState({ days: [1, 2, 3, 4, 5, 6, 7] }) }, '全周'),
          ),
          h('div', { className: 'cmp-muted', style: { marginTop: 6 } },
            '上一次：' + fmtTime(p.lastSentAt) + '　下次：' + (data.nextDueAt ? fmtTime(data.nextDueAt) : '未开启'),
            '　出站管道：' + (data.outbound && data.outbound.ok ? '已就绪' : '还没捕获（让机器人先收到任意一条 QQ 消息）'),
          ),
          p.lastError ? h('div', { className: 'cmp-toast', style: { marginTop: 6 } }, '上次失败：' + p.lastError) : null,
          h('div', { className: 'cmp-muted', style: { marginTop: 8 } }, '台词（一行一条，空着用默认几句）：'),
          h('textarea', { className: 'cmp-pool', rows: 4, value: this.state.poolText, onChange: (e) => this.setState({ poolText: e.target.value }) }),
          h('div', { className: 'cmp-row', style: { marginTop: 8 } },
            h('button', { className: 'cmp-btn primary', disabled: busy !== '', onClick: () => this.saveProactive() }, '保存互动设置'),
            h('button', { className: 'cmp-btn', disabled: busy !== '' || owners.length === 0, onClick: () => this.sendNow() }, '现在发一条'),
            h('label', { className: 'cmp-check' }, h('input', { type: 'checkbox', checked: p.useModel === true, onChange: () => this.setUseModel(p.useModel !== true) }), '让模型现写（会消耗一次额度）'),
          ),
          h('div', { className: 'cmp-lbl', style: { marginTop: 12 } }, '值班摘要（发主人号）'),
          h('div', { className: 'cmp-row' },
            h('label', { className: 'cmp-check' }, h('input', { type: 'checkbox', checked: !(dp && dp.enabled === false), onChange: () => this.toggleDuty() }), '一轮跑完主动提一次'),
            h('span', { className: 'cmp-muted' }, '最多'),
            h('input', { className: 'cmp-num', value: this.state.dutyMax, onChange: (e) => this.setState({ dutyMax: e.target.value }) }),
            h('span', { className: 'cmp-muted' }, '条，冷却'),
            h('input', { className: 'cmp-num', value: this.state.dutyCool, onChange: (e) => this.setState({ dutyCool: e.target.value }) }),
            h('span', { className: 'cmp-muted' }, '分钟'),
          ),
          duty && duty.preview ? h('div', { className: 'cmp-muted', style: { marginTop: 6, lineHeight: 1.6 } }, '下次会这样提：' + duty.preview) : h('div', { className: 'cmp-muted', style: { marginTop: 6 } }, '值班还没留下 say.txt / memory.jsonl：先跑一轮值班。'),
          h('div', { className: 'cmp-muted', style: { marginTop: 6 } },
            '上次推送：' + fmtTime(duty && duty.lastAt) + '　状态：' + dutyStateText(duty && duty.pending && duty.pending.why),
          ),
          duty && duty.lastText ? h('div', { className: 'cmp-muted', style: { marginTop: 6 } }, '上次内容：' + duty.lastText) : null,
          h('div', { className: 'cmp-row', style: { marginTop: 8 } },
            h('button', { className: 'cmp-btn primary', disabled: busy !== '', onClick: () => this.saveDuty() }, '保存值班推送设置'),
            h('button', { className: 'cmp-btn', disabled: busy !== '' || owners.length === 0, onClick: () => this.sendDutyNow() }, '现在提一次'),
          ),
          said ? h('div', { className: 'cmp-toast', style: { marginTop: 8 } }, said) : null,
        )
      }

      render() {
        try {
          return this.renderBody()
        } catch (error) {
          console.log('[cmp-owner] render failed: ' + (error && error.stack ? error.stack : error))
          throw error
        }
      }
    }
    // ---- 通道分支：状态 + 不跳转的入口提示 ----
    // B站「值班」那一轮用哪条线路：数据源是 dsh-bili-pond 自己的 /api/bili-pond/models，
    // 它已经把「当前进程注册的线路」+「值班 profile 里能不能用」都算好了；保存走 /api/bili-pond/config。
    // 注意：这张卡刻意写成 class 组件，不用 hooks。
    // 实测在桌面版 0.2.1-rc.3 的侧边栏里，这里第一次 useState 会抛
    // TypeError: Cannot read properties of undefined (reading 'current')
    // （dispatcher 取不到 = 这个组件拿到的是另一份 react 实例）。class 组件不经过
    // dispatcher，setState 由渲染器在实例上注入，跨实例也稳。
    class BiliDutyCardV2 extends React.Component {
      constructor(props) {
        super(props)
        this.state = { data: null, duty: null, cli: null, pond: null, provider: '', model: '', manual: '', manualProvider: '', catalog: null, busy: false, toast: '' }
        this.load = this.load.bind(this)
        this.save = this.save.bind(this)
        this.repairCli = this.repairCli.bind(this)
      }

      componentDidMount() { this.load() }

      async load() {
        try {
          const body = await apiGetRaw('/api/bili-pond/models')
          const cur = (body && body.current) || {}
          this.setState({ data: body, provider: String(cur.provider || ''), model: String(cur.model || '') })
          // 插件自己列不出线路时（多半是没配「dsh 路径」，它 spawn dsh 失败会让整个
          // /models 直接 500），退回 DSH 自己的模型目录兜一份，别让下拉空着。
          try { this.setState({ duty: await apiGet('/companion/api/duty') }) } catch (ignored) { this.setState({ duty: null }) }
          try { this.setState({ cli: await apiGet('/companion/api/duty/cli') }) } catch (ignored) { this.setState({ cli: null }) }
          try { this.setState({ pond: await apiGet('/companion/api/pond-gate') }) } catch (ignored) { this.setState({ pond: null }) }
          if (!body || !body.providers || body.providers.length === 0) {
            try { this.setState({ catalog: await apiGet('/companion/api/model') }) } catch { this.setState({ catalog: null }) }
          }
        } catch (error) {
          this.setState({ toast: '读不到 B站 值班模型：' + error.message })
        }
      }

      async save(nextProvider, nextModel) {
        if (this.state.busy) return
        this.setState({ busy: true, toast: '' })
        try {
          await apiPostRaw('/api/bili-pond/config', { dutyProvider: nextProvider, dutyModel: nextModel })
          this.setState({ toast: nextProvider ? ('已保存：值班用 ' + nextProvider + ' / ' + (nextModel || '（未选模型→仍跟随 profile 默认）')) : '已清空：值班跟随 headless profile 自己的默认模型' })
          await this.load()
        } catch (error) {
          this.setState({ toast: '保存失败：' + error.message })
        } finally {
          this.setState({ busy: false })
        }
      }

      /** 把选中的线路写进「值班那个 profile」的默认模型：绕开 dump-config 看不见运行时线路的假阴性 */
      async setDutyDefault() {
        const prov = String(this.state.provider || this.state.manualProvider || '').trim()
        const mod = String(this.state.model || this.state.manual || '').trim()
        if (!prov || !mod) { this.setState({ toast: '先把线路和模型都选好，才能改值班 profile 的默认模型' }); return }
        if (this.state.busy) return
        this.setState({ busy: true, toast: '' })
        try {
          const info = await apiPost('/companion/api/duty/default', { provider: prov, model: mod })
          await apiPostRaw('/api/bili-pond/config', { dutyProvider: '', dutyModel: '' })
          this.setState({ toast: '已把「' + String((info && info.profile) || 'headless') + '」的默认模型改成 ' + prov + ' / ' + mod + '，并清空值班覆盖 ⇒ 下一轮值班就用它' })
          await this.load()
        } catch (error) {
          this.setState({ toast: '改默认模型失败：' + error.message })
        } finally {
          this.setState({ busy: false })
        }
      }

      /** 值班 CLI 修复：桌面版拿 Electron 当 node 跑 dsh 会被运行时指纹挡住（0 秒 exit 1）
       *  ⇒ 让宿主写一份 {node,bin} 给包装器，再把 bili-duty 的 dshBin 指过去。
       */
      async repairCli() {
        if (this.state.busy) return
        this.setState({ busy: true, toast: '正在修值班 CLI…' })
        try {
          const fixed = await apiPost('/companion/api/duty/cli', {})
          const wrapper = String((fixed && fixed.wrapper) || '')
          if (!wrapper) throw new Error('宿主没返回包装器路径')
          await apiPostRaw('/api/bili-pond/config', { dshBin: wrapper })
          this.setState({ toast: '已修好：值班改用真 node 跑 dsh（' + String(fixed.node || '') + '）⇒ 再开一轮就不会 0 秒退出了' })
          await this.load()
        } catch (error) {
          this.setState({ toast: '修值班 CLI 失败：' + error.message })
        } finally {
          this.setState({ busy: false })
        }
      }

      /** 把「提供这条线路的插件」装进值班 profile（B站 插件自带的 profile-add，最长 4 分钟） */
      /**
       * 值班 profile 少了 @deepseek-ai/dsh-headless 时，CLI 只挂 dsh-base：
       * 不读 task、不产出、也不退出，面板上就是「跑完不结束」。
       */
      async fixBundles() {
        this.setState({ busy: true, toast: '正在给值班 profile 补 headless app…' })
        try {
          const info = await apiPost('/companion/api/duty/bundles', {})
          this.setState({ duty: info })
          this.setState({ toast: '已补上 @deepseek-ai/dsh-headless ⇒ 「' + String((info && info.profile) || 'headless') + '」现在能真正跑任务了' })
          await this.load()
        } catch (error) {
          this.setState({ toast: '补 headless app 失败：' + error.message })
        } finally {
          this.setState({ busy: false })
        }
      }

      /** 鱼塘排班闸门：控制台只做「停放 / 归还」，不替用户打开他从没开过的自动运行 */
      async savePond(patch) {
        if (this.state.busy) return
        this.setState({ busy: true, toast: '' })
        try {
          const info = await apiPost('/companion/api/pond-gate', patch)
          this.setState({ pond: info })
          this.setState({ toast: (patch && patch.gate === false) ? '已交还：控制台不再管鱼塘的自动运行' : '已保存鱼塘排班（鱼塘 60 秒内自己会读到）' })
        } catch (error) {
          this.setState({ toast: '保存鱼塘排班失败：' + error.message })
        } finally {
          this.setState({ busy: false })
        }
      }

      togglePondGate() {
        const cur = this.state.pond || {}
        return this.savePond({ gate: cur.gate !== true })
      }

      togglePondDay(n) {
        const cur = this.state.pond || {}
        const days = (cur.days && cur.days.length ? cur.days : [1, 2, 3, 4, 5, 6, 7]).slice()
        const at = days.indexOf(n)
        if (at >= 0) days.splice(at, 1)
        else days.push(n)
        days.sort((a, b) => a - b)
        return this.savePond({ days })
      }

      async installPackage(pkg) {
        const profile = String((this.state.data && this.state.data.profile) || 'headless')
        if (this.state.busy) return
        this.setState({ busy: true, toast: '正在把 ' + pkg + ' 装进「' + profile + '」…（可能要几分钟）' })
        try {
          await apiPostRaw('/api/bili-pond/profile-add', { package: pkg, profile: profile })
          this.setState({ toast: '已装进「' + profile + '」：' + pkg + '，点「重新探测」看它出现在线路里' })
        } catch (error) {
          this.setState({ toast: '装失败：' + error.message })
        } finally {
          this.setState({ busy: false })
        }
      }

      render() {
        try {
          return this.renderBody()
        } catch (error) {
          try {
            console.error('[cmp-bili] render failed: ' + String(error && (error.stack || error)) + ' | state=' + JSON.stringify({ hasData: this.state.data !== null && this.state.data !== undefined, provider: this.state.provider, hasCatalog: !!this.state.catalog, catalogGroups: this.state.catalog && this.state.catalog.groups ? this.state.catalog.groups.length : -1 }))
          } catch (ignored) {}
          throw error
        }
      }

      renderBody() {
        const { data, duty, cli, pond, provider, model, manual, manualProvider, catalog, busy, toast } = this.state
        const own = (data && data.providers) || []
        const groups = (catalog && catalog.groups) || []
        const providers = own.length > 0
          ? own
          : groups.map((group) => ({
              id: String(group.provider || ''),
              name: String(group.name || group.provider || ''),
              models: (group.models || []).map((item) => ({ id: String(item.id || ''), name: String(item.name || item.id || '') })),
              source: 'catalog',
              usable: null,
            })).filter((item) => item.id)
        const hit = providers.filter((item) => item.id === provider)[0]
        const models = (hit && hit.models) || []
        const usingCatalog = own.length === 0 && providers.length > 0
        const chosen = provider || manualProvider.trim()

        return h('div', { className: 'cmp-card', key: 'biliduty' },
          h('h4', null, '值班模型（B站自动跑那一轮用哪条线路）'),
          !data
            ? h('div', { className: 'cmp-muted' }, '读取中…')
            : h('div', { className: 'cmp-live' },
                h('div', { className: 'cmp-text' }, '当前：' + ((data.current && data.current.provider)
                  ? (data.current.provider + (data.current.model ? ' / ' + data.current.model : '（未选模型）'))
                  : '跟随 ' + String(data.profile || 'headless') + ' profile 自己的默认模型')),
                h('div', { className: 'cmp-muted' }, '值班跑在另一个 profile：' + String(data.profile || 'headless')
                  + (data.profileKnown ? '' : '（这台上还没这个 profile，或 dsh CLI 没找到：' + String(data.profileError || '未知') + '）')),
                duty ? h('div', { className: 'cmp-muted' }, '它的默认模型：'
                  + ((duty.defaults && duty.defaults.provider) ? (duty.defaults.provider + ' / ' + String(duty.defaults.model || '')) : '没写（跟随 DSH 内置默认）')
                  + '　已装：' + ((duty.bundles || []).length) + ' 个 bundle / ' + ((duty.dependencies || []).length) + ' 个依赖') : null,
                cli ? h('div', { className: cli.needsRepair ? 'cmp-toast' : 'cmp-muted' },
                  '值班 CLI：' + (cli.usingWrapper
                    ? ('已改走真 node（' + String((cli.saved && cli.saved.node) || '') + '）')
                    : (cli.dshBin || '没填 dsh 路径') + (cli.needsRepair ? '　⚠ 桌面版拿 Electron 跑它会在引导阶段 exit 1' : ''))) : null,
                (duty && duty.exists === false) ? h('div', { className: 'cmp-toast' }, '这台机器上还没有「' + String(duty.profile) + '」这个 profile ⇒ 值班根本起不来。先 dsh plugin --profile ' + String(duty.profile) + ' add <提供线路的插件>。') : null,
                h('div', { className: 'cmp-muted' }, '从宿主带进值班的线路：'
                  + (data.reuseRoutes === false ? '关闭' : (data.reusedRoutes && data.reusedRoutes.length ? data.reusedRoutes.join('、') : '无（宿主 patch 里没有模型 entry）'))),
                (data.warnings && data.warnings.length) ? h('div', { className: 'cmp-muted' }, '警告：' + data.warnings.join('；')) : null,
                (duty && duty.exists && duty.hasHeadlessApp === false) ? h('div', { className: 'cmp-toast' },
                '值班 profile「' + String(duty.profile) + '」少了 @deepseek-ai/dsh-headless（一次性任务 app）⇒ 子进程只挂 dsh-base，不读任务也不退出。',
                h('button', { className: 'cmp-btn', disabled: busy, onClick: () => this.fixBundles() }, '补上 headless app')) : null,
              (data.ok === false) ? h('div', { className: 'cmp-toast' }, 'B站 插件报错：' + String(data.error || '未知')) : null,
                (data.ok === false) ? h('div', { className: 'cmp-note' }, '最常见的原因是没配「dsh 路径」：桌面应用里没有 dsh CLI，插件 spawn 不到就直接报错、线路下拉也跟着空。去 DSH 设置页「B站鱼塘 → dsh 路径」填 dsh 的 lib/bin.js（本机是 D:\\DeepSeek-Harness\\npm-global\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js），保存后回来点「重新探测」。') : null,
                usingCatalog ? h('div', { className: 'cmp-muted' }, '下面这份线路是从 DSH 自己的模型目录兜出来的（B站 插件的 /models 没返回线路）⇒ 只能证明「这台机器上有它」，值班那个 profile 里有没有、模型名对不对，得那边真跑一次才知道。') : null,
              ),
          h('div', { className: 'cmp-grid' },
            h('label', null, '线路'),
            providers.length > 0
              ? h('select', { className: 'cmp-input', value: provider, onChange: (event) => { this.setState({ provider: event.target.value, model: '', manual: '' }) } },
                  h('option', { value: '' }, '（空＝跟随 profile 默认）'),
                  providers.map((item) => h('option', { key: item.id, value: item.id },
                    item.id + (item.usable === false ? '（值班 profile 没有）' : '') + (item.source === 'profile' ? ' · 仅在值班 profile' : ''))),
                )
              : h('input', { className: 'cmp-input', placeholder: '手填线路 id（如 deepseek-web）', value: manualProvider, onChange: (event) => this.setState({ manualProvider: event.target.value }) }),
            h('label', null, '模型'),
            models.length > 0
              ? h('select', { className: 'cmp-input', value: model, onChange: (event) => this.setState({ model: event.target.value }) },
                  h('option', { value: '' }, '（空＝不写模型，跟随默认）'),
                  models.map((item) => h('option', { key: item.id, value: item.id }, item.name && item.name !== item.id ? item.name + '（' + item.id + '）' : item.id)),
                )
              : h('input', { className: 'cmp-input', placeholder: hit && hit.source === 'profile' ? '这条线路只在值班 profile 里，手填模型 id' : '先选线路', value: manual, onChange: (event) => this.setState({ manual: event.target.value }) }),
          ),
          h(Row, null,
            h('button', { className: 'cmp-btn primary', disabled: busy, onClick: () => this.save(chosen, model || manual) }, busy ? '保存中…' : '保存'),
            h('button', { className: 'cmp-btn', disabled: busy || !chosen, onClick: () => this.save('', '') }, '清空（跟随默认）'),
            h('button', { className: 'cmp-btn', disabled: busy || !chosen, onClick: () => this.setDutyDefault() }, '把默认改成这条线路'),
            (hit && hit.usable === false && hit.package) ? h('button', { className: 'cmp-btn', disabled: busy, onClick: () => this.installPackage(hit.package) }, '装进值班 profile（' + hit.package + '）') : null,
            (cli && cli.needsRepair) ? h('button', { className: 'cmp-btn', disabled: busy, onClick: () => this.repairCli() }, '修复值班 CLI（改走真 node）') : null,
            h('button', { className: 'cmp-btn', onClick: () => this.load() }, '重新探测'),
          ),
          h('div', { className: 'cmp-note' }, '两个都空 ⇒ 完全不写 agent-default-model，值班跟随那个 profile 自己的默认模型；只选了线路没选模型 ⇒ 这一轮也跟随默认（插件故意不写半条无效配置，否则值班进程会 exit 1）。日常刷视频不花模型额度，只有生成报告／评论那一轮才会用到这里选的线路。'),
          (hit && hit.usable === false && !hit.package) ? h('div', { className: 'cmp-note' }, '「' + hit.id + '」在当前进程里有、但值班 profile 的 dump-config 里看不到 ⇒ 插件会在开跑前把它拒掉。运行时才注册的线路（our-free-model 系的车道都这样）其实跑得起来，用上面「把默认改成这条线路」写进值班 profile 就能绕过这条假阴性。') : null,
          h('div', { className: 'cmp-text', style: { marginTop: 10 } }, '鱼塘自动运行（按星期开）'),
          !pond
            ? h('div', { className: 'cmp-muted' }, '读取中…')
            : h('div', null,
                h('div', { className: 'cmp-muted' }, '现在：' + (pond.autoRun ? '开着' : '关着')
                  + (pond.gate ? (pond.parked ? '（非排班日，已由控制台暂停）' : '（排班日，控制台不拦）') : '（控制台不管它）')),
                h('label', { className: 'cmp-check' },
                  h('input', { type: 'checkbox', checked: pond.gate === true, disabled: busy, onChange: () => this.togglePondGate() }),
                  '让控制台按星期开关鱼塘的自动运行'),
                pond.gate
                  ? h('div', { className: 'cmp-row' },
                      h('span', { className: 'cmp-muted' }, '哪几天：'),
                      [1, 2, 3, 4, 5, 6, 7].map((n) => h('span', {
                        key: String(n),
                        className: 'cmp-chip cmp-day' + (((pond.days || []).indexOf(n) >= 0) ? ' on' : ''),
                        onClick: busy ? undefined : () => this.togglePondDay(n),
                      }, DAY_LABELS[n - 1])),
                      h('button', { className: 'cmp-btn', disabled: busy, onClick: () => this.savePond({ days: [1, 2, 3, 4, 5, 6, 7] }) }, '全周'),
                    )
                  : null,
                pond.gate
                  ? h('div', { className: 'cmp-note' }, '排班日把它还回去、非排班日关掉；本来就没开的，控制台不会替你打开。动的是 ' + String(pond.dir || '') + ' 下的 config.json，鱼塘每 60 秒自己重读一次，不用重启。')
                  : null,
              ),
          toast ? h('div', { className: 'cmp-toast' }, toast) : null,
        )
      }
    }

    function ChannelBranch(props) {
      const { branch, services } = props
      const entry = (services && services[branch.id]) || { installed: false, packages: [], profiles: [] }
      const [live, setLive] = useState(null)
      const [tick, setTick] = useState(0)
      const routes = LIVE_ROUTES[branch.id] || []
      const route = routes.length > 0

      useEffect(() => {
        if (routes.length === 0) return undefined
        let alive = true
        setLive(null)
        probeLive(branch.id, routes)
          .then((result) => { if (alive) setLive(result) })
          .catch((error) => { if (alive) setLive({ lines: [], error: error.message }) })
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [branch.id, route, tick])

      return h('div', { className: 'cmp-body' }, [
        route
          ? h(Card, { key: 'live', title: '实时状态' },
            live === null
              ? h('div', { className: 'cmp-muted' }, '读取中…')
              : live.error
                ? h('div', { className: 'cmp-muted' }, '读取失败：' + live.error + '（该子插件可能未启用）')
                : h('div', { className: 'cmp-live' }, live.lines.map((line, index) => h('div', { key: String(index), className: 'cmp-muted' }, line))),
            h('div', { className: 'cmp-row', style: { marginTop: 8 } },
              h('button', { className: 'cmp-btn', onClick: () => setTick(tick + 1) }, '刷新'),
            ),
          )
          : null,
        branch.id === 'qq'
          ? h(QqLoginCard, {
            key: 'napcat',
            online: !!(live && live.body && live.body.runtime && live.body.runtime.online),
            installed: entry.installed,
            onDone: () => setTick(tick + 1),
          })
          : null,
        branch.id === 'qq' ? h(OwnerCard, { key: 'owner' }) : null,
        branch.id === 'bili' ? h(BiliDutyCardV2, { key: 'biliduty' }) : null,
        h(Card, { key: 'status', title: branch.title + ' 状态' },
          h(Row, null,
            h(Badge, { ok: entry.installed }),
            h('span', { className: 'cmp-muted' }, entry.installed ? (entry.packages.join(', ') + ' @ ' + entry.profiles.join('/')) : '尚未出现在任何 profile 的依赖里'),
          ),
          h('div', { className: 'cmp-note', style: { marginTop: 8 } }, branch.hint),
        ),
        h(Card, { key: 'entry', title: '入口' },
          h('div', { className: 'cmp-muted', style: { lineHeight: 1.6 } },
            branch.id === 'qq' ? '登录、拉起、重启已经搬到上面那张卡（直接打看门狗的动作端点）；人格实例与更细的看门狗参数在 DSH 设置 →「napcat桥」。' : null,
            branch.id === 'bili' ? 'B站 扫码登录与浏览在设置 →「B站」面板；写操作默认关闭，每日额度由插件代码级上限控制。' : null,
            branch.id === 'meme' ? '表情包图库在设置 →「表情包」面板；当前图库目录见下方路径。' : null,
          ),
          branch.id === 'meme' && props.status && props.status.meme
            ? h('div', { className: 'cmp-muted', style: { marginTop: 8 } }, '图库目录：' + props.status.meme.packsDir + '（' + String((props.status.meme.packs || []).length) + ' 个图库）')
            : null,
        ),
      ])
    }

    // ---- 模型分支：选默认模型（provider / model / 推理强度）----
    // ---- 免费链路（dsh-our-free-model 的 combo 命名降级链）----
    // 链本身由插件自己的设置 API 维护（/api/our-free-model/combos），这里只做「勾选顺序 + 一键设为默认」。
    const FREE_CHAINS = '/api/our-free-model/combos'

    async function readFreeChains() {
      const res = await fetch(FREE_CHAINS, { headers: { Accept: 'application/json' } })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) throw new Error('HTTP ' + res.status)
      return body
    }

    /** 目录里哪个 provider 挂着 combo:* 虚拟模型（免费模型插件的车道） */
    function comboProvider(groups, name) {
      const id = 'combo:' + name
      for (const group of groups || []) {
        for (const item of group.models || []) {
          if (item.id === id) return group.id
        }
      }
      return ''
    }

    function FreeChainCard(props) {
      const [catalog, setCatalog] = useState(null)
      const [chains, setChains] = useState([])
      const [models, setModels] = useState([])
      const [name, setName] = useState('free')
      const [strategy, setStrategy] = useState('fallback')
      const [picked, setPicked] = useState([])
      const [q, setQ] = useState('')
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState('')

      const load = useCallback(async () => {
        try {
          const body = await readFreeChains()
          setChains(Array.isArray(body.combos) ? body.combos : [])
          setModels(Array.isArray(body.models) ? body.models : [])
        } catch (error) {
          setToast('读不到免费链路（没装 dsh-our-free-model？）：' + error.message)
        }
        try {
          setCatalog(await apiGet(API + '/model'))
        } catch { /* 目录只是用来提示「哪些不在链范围」，读不到就静默降级 */ }
      }, [])
      const groups = (catalog && catalog.groups) || []

      useEffect(() => { load() }, [load])

      // 可选的只有**这个插件自己车道里的模型**：链的成员按它自己 catalog 的裸 id 对号
      // （src/core/runtime.js:107 的 state().catalog），DSH 全局别的 provider 的模型放进来会被整条丢弃。
      const options = models
        .filter((item) => String(item.id || '').indexOf('combo:') !== 0)
        .map((item) => ({
          value: String(item.id),
          id: String(item.id),
          label: String(item.name || item.id) + (item.name && item.name !== item.id ? '（' + item.id + '）' : '') + ' · ' + String(item.channel || 'free'),
          channel: String(item.channel || 'free'),
        }))

      // 不在链范围的那些：DSH 全局目录里有、但这个插件的 catalog 里没有 ⇒ combos 里放进去会被整条丢掉。
      const chainIds = options.map((item) => item.id)
      const outsideModels = []
      for (const group of groups || []) {
        for (const item of (group && group.models) || []) {
          const id = String(item.id || '')
          if (id && chainIds.indexOf(id) < 0) outsideModels.push(group.id + '/' + id)
        }
      }

      // 按车道分组渲染：免费 / Kilo / 账号 / 聚合 各有各的额度来源，分组后一眼能看出成本。
      const pickerRows = () => {
        const needle = q.trim().toLowerCase()
        const visible = options.filter((item) => !needle || (item.label + ' ' + item.channel).toLowerCase().indexOf(needle) >= 0)
        if (visible.length === 0) {
          return h('div', { className: 'cmp-muted' }, options.length === 0
            ? '目录里还没有可用模型（dsh-our-free-model 还没就绪？点上面的「重新读取」试试）'
            : '没有匹配「' + q.trim() + '」的模型')
        }
        const out = []
        const order = []
        for (const item of visible) {
          if (order.indexOf(item.channel) < 0) order.push(item.channel)
        }
        for (const channel of order) {
          const rows = visible.filter((item) => item.channel === channel)
          out.push(h('div', { key: 'ch:' + channel, className: 'cmp-pickgroup' }, channel + ' · ' + rows.length))
          for (const item of rows) {
            const at = picked.map((row) => row.id).indexOf(item.id)
            out.push(h('label', { key: item.value, className: 'cmp-pick' + (at >= 0 ? ' on' : '') },
              h('input', { type: 'checkbox', checked: at >= 0, onChange: () => toggle(item) }),
              h('span', { className: 'cmp-pick-order' }, at >= 0 ? String(at + 1) : '·'),
              h('span', { className: 'cmp-pick-label' }, item.label),
            ))
          }
        }
        return out
      }

      // 多选直接生效：勾上就追加到链尾，取消就摘掉；序号＝链路顺序。
      const toggle = (item) => {
        setPicked((old) => (old.some((row) => row.id === item.id)
          ? old.filter((row) => row.id !== item.id)
          : old.concat([{ id: item.id, label: item.label }])))
      }

      const save = async () => {
        if (busy) return
        if (!name.trim() || picked.length === 0) return setToast('先给链路起个名字并至少放一条模型')
        setBusy(true)
        setToast('')
        try {
          const others = chains.filter((item) => item.name !== name.trim())
          const next = others.concat([{
            name: name.trim(),
            strategy: strategy,
            // 链路里存的是**裸目录 id**：dsh-our-free-model 的 buildComboCatalog 用 catalog 条目 id 对号，
            // 写成 provider/model 会被当成找不到的链接而整条丢弃（src/combos.js:107）。
            models: picked.map((item) => item.id),
          }])
          const res = await fetch(FREE_CHAINS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ combos: next }),
          })
          const body = await res.json().catch(() => null)
          if (!res.ok || !body) throw new Error((body && body.error) || 'HTTP ' + res.status)
          setToast('链路已保存：combo:' + name.trim() + '（' + picked.length + ' 段，' + strategy + '）')
          setPicked([])
          if (props.onSaved) props.onSaved()
          await load()
        } catch (error) {
          setToast('保存链路失败：' + error.message)
        } finally {
          setBusy(false)
        }
      }

      const useAsDefault = async (chainName) => {
        const provider = comboProvider((catalog && catalog.groups) || [], chainName)
        if (!provider) return setToast('目录里还没有 combo:' + chainName + '，稍等插件刷新或重新读取模型目录')
        setBusy(true)
        try {
          const data = await apiPost(API + '/model', { provider: provider, model: 'combo:' + chainName })
          const hot = data && data.hotSwitch
          setToast('已设为默认 combo:' + chainName
            + (hot && hot.supported ? '；热切 ' + hot.switched + ' 个活跃会话' : '；热切不可用，只对新会话生效')
            + chatSwitchText(data))
          if (props.onChanged) props.onChanged()
        } catch (error) {
          setToast('设置失败：' + error.message)
        } finally {
          setBusy(false)
        }
      }

      return h(Card, { title: '免费链路（自动切换供应商）' },
        chains.length === 0
          ? h('div', { className: 'cmp-muted' }, '还没有链路。选几家渠道的模型排好顺序，建一条 combo：额度撞墙时自动换下一家。')
          : chains.map((chain) =>
              h(Row, { key: chain.name },
                h('span', { className: 'cmp-text' }, 'combo:' + chain.name + '（' + (chain.strategy || 'fallback') + '）· ' + (chain.models || []).join(' → ')),
                h('button', { className: 'cmp-btn', disabled: busy, onClick: () => useAsDefault(chain.name) }, '设为默认'),
              )),
        h('div', { className: 'cmp-grid' },
          h('label', null, '链路名'),
          h('input', { className: 'cmp-input', value: name, onChange: (event) => setName(event.target.value) }),
          h('label', null, '策略'),
          h('select', { className: 'cmp-input', value: strategy, onChange: (event) => setStrategy(event.target.value) },
            h('option', { value: 'fallback' }, 'fallback（每轮从链首开始）'),
            h('option', { value: 'round-robin' }, 'round-robin（轮换起点）'),
          ),
        ),
        h('div', { className: 'cmp-note' }, picked.length === 0
          ? '勾选要放进链路的模型，勾选顺序＝降级顺序（下面列的是**全部**可入链的模型）：'
          : '已选 ' + picked.length + ' 段，序号即降级顺序（chain 从头试到尾）：'),
        h('input', {
          className: 'cmp-input',
          placeholder: '搜模型（名字 / id / 车道）…',
          value: q,
          onChange: (event) => setQ(event.target.value),
        }),
        h('div', { className: 'cmp-picker' }, pickerRows()),
        outsideModels.length === 0
          ? null
          : h('div', { className: 'cmp-note' }, '另有 ' + outsideModels.length + ' 个模型在 DSH 目录里但**不能**进链（如 ' + outsideModels.slice(0, 3).join('、') + '）：链的成员由 dsh-our-free-model 用它自己的 catalog 对号（src/combos.js），只认它自己车道里的 id。要把某家拉进来，先在「免费模型」设置页打开那个账号车道，或粘贴该平台 key（聚合车道会把它列进目录，这里就会自动出现）。'),
        picked.length > 0
          ? h('div', { className: 'cmp-note' }, '链路顺序：' + picked.map((item) => item.id).join(' → '))
          : null,
        h(Row, null,
          h('button', { className: 'cmp-btn', disabled: busy || picked.length === 0, onClick: () => setPicked([]) }, '全不选'),
          h('button', { className: 'cmp-btn primary', disabled: busy || picked.length === 0, onClick: save }, busy ? '保存中…' : '保存链路'),
        ),
        h('div', { className: 'cmp-note' }, '链路由 dsh-our-free-model 维护（与它的「免费模型」设置页同一份数据）；成员只能是它自己车道里的模型。出正文前撞额度墙就换下一段，调用方看不到。'),
        toast ? h('div', { className: 'cmp-toast' }, toast) : null,
      )
    }
    function ModelBranch(props) {
      const [catalog, setCatalog] = useState(null)
      const [provider, setProvider] = useState('')
      const [model, setModel] = useState('')
      const [effort, setEffort] = useState('')
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState('')

      const load = useCallback(async () => {
        try {
          const data = await apiGet(API + '/model')
          setCatalog(data)
          const cur = (data && data.current) || {}
          const firstGroup = data && data.groups && data.groups[0]
          setProvider(cur.provider || (firstGroup && firstGroup.id) || '')
          setModel(cur.model || '')
          setEffort(cur.reasoningEffort || '')
        } catch (error) {
          setToast('读取模型目录失败：' + error.message)
        }
      }, [])

      useEffect(() => { load() }, [load])

      const groups = (catalog && catalog.groups) || []
      const group = groups.filter((item) => item.id === provider)[0]
      const models = (group && group.models) || []
      const picked = models.filter((item) => item.id === model)[0]
      const efforts = (picked && picked.reasoning && picked.reasoning.efforts) || []
      const current = (catalog && catalog.current) || null
      const chatModel = (catalog && catalog.chatModel) || null
      const chatLine = (() => {
        if (!chatModel) return ''
        if (!chatModel.captured) return 'QQ 聊天：还没有活跃聊天（收到一条 QQ 消息后才会出现）'
        const rows = chatModel.chats || []
        const using = rows.filter((row) => row.provider || row.model).map((row) => row.chatId + ' → ' + (row.provider || '?') + '/' + (row.model || '?'))
        return 'QQ 聊天：' + rows.length + ' 个' + (using.length ? '（' + using.slice(0, 3).join('；') + (using.length > 3 ? ' …' : '') + '）' : '')
      })()

      const pickProvider = (next) => {
        setProvider(next)
        const g = groups.filter((item) => item.id === next)[0]
        const first = (g && g.models && g.models[0] && g.models[0].id) || ''
        setModel(first)
        setEffort('')
      }

      const save = async () => {
        if (busy) return
        if (!provider || !model) return setToast('先选一个 provider 和 model')
        setBusy(true)
        setToast('')
        try {
          const payload = { provider: provider, model: model }
          if (effort) payload.reasoningEffort = effort
          const data = await apiPost(API + '/model', payload)
          const hot = data && data.hotSwitch
          const hotText = (hot && hot.supported ? '；已热切 ' + hot.switched + ' 个活跃会话' : '；热切不可用，只对新会话生效') + chatSwitchText(data)
          if (data && data.saved) {
            setToast('已切换默认模型：' + String((data.current && data.current.provider) || provider) + ' / ' + String((data.current && data.current.model) || model) + hotText)
          } else {
            setToast('没落盘：' + String((data && data.note) || '部署可能没有 configEditor'))
          }
          if (data && data.current) setCatalog((old) => (old ? { ...old, current: data.current } : old))
        } catch (error) {
          setToast('切换失败：' + error.message)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { className: 'cmp-body' },
        h(Card, { title: '当前默认模型' },
          current
            ? h('div', { className: 'cmp-text' }, String(current.provider) + ' / ' + String(current.model) + (current.reasoningEffort ? '（推理强度 ' + String(current.reasoningEffort) + '）' : ''))
            : h('div', { className: 'cmp-muted' }, '读不到当前选择（agentDefaultModel 服务不可用）'),
        ),
        h(Card, { title: '切换' },
          h('div', { className: 'cmp-grid' },
            h('label', null, '来源'),
            h('select', {
              className: 'cmp-input',
              value: provider,
              disabled: groups.length === 0,
              onChange: (event) => pickProvider(event.target.value),
            }, groups.map((item) => h('option', { key: item.id, value: item.id }, item.name + '（' + item.id + '）'))),
            h('label', null, '模型'),
            h('select', {
              className: 'cmp-input',
              value: model,
              disabled: models.length === 0,
              onChange: (event) => { setModel(event.target.value); setEffort('') },
            }, models.map((item) => h('option', { key: item.id, value: item.id }, item.name + (item.name === item.id ? '' : '（' + item.id + '）')))),
            efforts.length > 0 ? h('label', null, '推理') : null,
            efforts.length > 0
              ? h('select', {
                  className: 'cmp-input',
                  value: effort,
                  onChange: (event) => setEffort(event.target.value),
                },
                h('option', { value: '' }, '跟随默认'),
                efforts.map((item) => h('option', { key: item.id, value: item.id }, item.name)))
              : null,
          ),
          h(Row, null,
            h('button', { className: 'cmp-btn primary', disabled: busy || !model, onClick: save }, busy ? '保存中…' : '保存为默认模型'),
            h('button', { className: 'cmp-btn', disabled: busy, onClick: load }, '重新读取'),
          ),
          h('div', { className: 'cmp-note' }, '写的是 agentDefaultModel 的配置行（会落进 profile 的 patch），新建会话直接用它；正在跑的会话尽力热切，QQ 每个聊天另外把新选择写进各自的 selectionRef（和在各聊天里发 /model 一样）。'),
          chatLine ? h('div', { className: 'cmp-muted' }, chatLine) : null,
          toast ? h('div', { className: 'cmp-toast' }, toast) : null,
        ),
        (catalog && catalog.failures && catalog.failures.length > 0)
          ? h(Card, { title: '取不到的来源' },
              catalog.failures.map((item) => h('div', { key: item.id, className: 'cmp-muted' }, item.name + '：' + item.message)))
          : null,
        h(FreeChainCard, { onChanged: load, onSaved: load }),
        (catalog && !catalog.llm)
          ? h('div', { className: 'cmp-note' }, 'llm 注册表不可用，只能看不能选。')
          : null,
      )
    }

    function ControlCenter(props) {
      ensureStyle()
      const [branch, setBranch] = useState('memory')
      const [status, setStatus] = useState(null)
      const [toast, setToast] = useState('')

      const reload = useCallback(async () => {
        try {
          setStatus(await apiGet(API + '/status'))
        } catch (error) {
          setToast('读取聚合状态失败：' + error.message)
        }
      }, [])

      useEffect(() => { reload() }, [reload])

      const channels = (status && status.branches) || [
        { id: 'memory', title: '记忆' }, { id: 'qq', title: 'QQ' }, { id: 'bili', title: 'B站' }, { id: 'meme', title: '表情包' },
      ]
      const branches = channels.concat([{ id: 'model', title: '模型' }])
      const current = branches.filter((item) => item.id === branch)[0] || branches[0]

      return h('div', { className: 'cmp-panel' },
        h('div', { className: 'cmp-nav' }, branches.map((item) =>
          h('button', { key: item.id, className: branch === item.id ? 'on' : '', onClick: () => setBranch(item.id) },
            item.title + (item.id === 'memory' && status && status.anima && status.anima.counts ? ' ' + String(status.anima.counts.pending) : ''),
          ),
        )),
        toast ? h('div', { className: 'cmp-toast', style: { margin: '8px 12px 0' } }, toast) : null,
        current.id === 'model'
          ? h(ModelBranch, null)
          : current.id === 'memory'
            ? h(MemoryBranch, { onCounts: reload })
            : h(ChannelBranch, { branch: current, services: status && status.services, status }),
      )
    }

    const inject = ['betterSidebar']

    function apply(ctx) {
      let mounted = false
      let attempts = 0

      function mount() {
        if (mounted) return
        const service = ctx.get ? ctx.get('betterSidebar') : ctx.betterSidebar
        if (!service || typeof service.registerTab !== 'function') {
          attempts += 1
          if (attempts >= 10) {
            console.warn('[dsh-companion-dashboard] betterSidebar 服务不可用，控制中心未注册')
            return
          }
          setTimeout(mount, 300)
          return
        }
        mounted = true
        ctx.effect(() => {
          try {
            const dispose = service.registerTab({
              id: 'companion:control-center',
              title: '控制中心',
              description: '人格、待审记忆与各通道状态，一个 Tab 看住',
              order: 5,
              single: true,
              component: () => h(ControlCenter, null),
            })
            console.log('[dsh-companion-dashboard] 控制中心 Tab 已注册 (companion:control-center)')
            return dispose
          } catch (error) {
            console.error('[dsh-companion-dashboard] registerTab 失败', error)
            return () => {}
          }
        })
      }

      mount()
    }

    exports.apply = apply
    exports.inject = inject
    exports.__test = { ControlCenter, MemoryBranch, ChannelBranch, QqLoginCard, OwnerCard, ModelBranch, FreeChainCard, BiliDutyCardV2, comboProvider, summarizeLive }
    return module.exports
  },
})