// 静态预览（bento 版）：抽出 client.js 的总览台 CSS，配 5 张等价卡，截图查有没有空洞。
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('packages/dsh-companion-dashboard/lib/client.js', 'utf8')
const start = src.indexOf('  // ---- 总览台')
const end = src.indexOf("].join('\\n')", start)
if (start < 0 || end < 0) throw new Error('找不到 CSS 段')
const css = src.slice(start, end)
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith("'."))
  .map((line) => line.replace(/^'/, '').replace(/',?$/, ''))
  .join('\n')

const room = (name, act, style, cur) =>
  `<button class="cmp-room${cur ? ' cur' : ''}" style="${style}"><span class="rn">${name}</span><span class="ra">${act}</span></button>`
const svc = ([name, st, on]) =>
  `<button class="cmp-svc jump${on ? ' on' : ''}"><span class="cmp-dot"></span><span class="n">${name}</span><span class="st">${st}</span><span class="go">\u2192</span></button>`

const html = `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;height:100%;font-family:"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif}
${css}
</style>
<div class="cmp-console dark" style="height:820px">
 <div class="cmp-aura"></div>
 <div class="cmp-console-scroll"><div class="cmp-cgrid">

  <div class="cmp-c live">
    <div class="cmp-k"><span>HOME / LIVE</span></div>
    <div class="cmp-live">
      <div class="cmp-plan">
        ${room('客厅', '在家', 'grid-column:1;grid-row:1', false)}
        ${room('书房', '看书', 'grid-column:1;grid-row:2', true)}
        ${room('阳台', '晒太阳', 'grid-column:2;grid-row:1', false)}
        ${room('次卧', '空着', 'grid-column:2;grid-row:2', false)}
        ${room('厨房', '做饭', 'grid-column:3;grid-row:1', false)}
        ${room('餐室', '空着', 'grid-column:3;grid-row:2', false)}
      </div>
      <div class="cmp-in">
        <div class="cmp-k"><span>INDOOR</span></div>
        <div class="cmp-ct">她在书房</div>
        <div class="cmp-stats">
          <div><span class="k">房间</span><span>书房</span></div>
          <div><span class="k">状态</span><span>看书</span></div>
          <div><span class="k">回来</span><span>12:22</span></div>
        </div>
      </div>
    </div>
    <div class="cmp-rt">
      <div class="cmp-k">今天的时间线</div>
      <div class="cmp-rlist">
        ${[
          ['07:30–09:00', '客厅', '吃早饭'],
          ['09:00–12:00', '书房', '看书'],
          ['12:00–13:30', '厨房', '做饭'],
          ['13:30–18:00', '书房', '写字'],
          ['18:00–21:00', '客厅', '发呆'],
          ['21:00–23:30', '次卧', '看书'],
        ].map(([t, r, a], i) => `<div class="cmp-rrow${i === 1 ? ' cur' : ''}"><span class="t">${t}</span><span class="r">${r}</span><span class="a">${a}</span></div>`).join('')}
      </div>
    </div>
  </div>

  <div class="cmp-c sys">
    <div class="cmp-k"><span>SYSTEM</span><span>点一行进对应页</span></div>
    <div>${[
      ['QQ 桥接', 'ON-LINE', true], ['QQ 客户端', 'ON-LINE', true], ['人格 · anima', 'ON-LINE', true],
      ['B站', 'ON-LINE', true], ['表情包', 'ON-LINE', true], ['侧面栏', 'OFF-LINE', false],
      ['对话记录', '', false], ['模型链路', '', false],
    ].map(svc).join('')}</div>
  </div>

  <div class="cmp-c ear">
    <div class="cmp-k"><span>MY HEAR</span></div>
    <div class="cmp-ct">让她说一句</div>
    <div class="cmp-h">声音走 Edge 朗读，晓晓音色，落成 mp3 再放出来。</div>
    <div class="cmp-say"><input class="cmp-input" placeholder="她要说的话…"><button class="cmp-btn primary">说</button></div>
    <div class="cmp-say-m"></div>
    <div class="cmp-spk"><select><option>小爱触屏音箱 · LX04</option><option>小爱音箱Play增强版 · L05C</option></select><button class="cmp-btn">对音箱说</button></div>
    <div class="cmp-cf"><span>耳朵开着</span><span class="cmp-a">关掉</span></div>
  </div>

  <div class="cmp-c chat">
    <div class="cmp-k"><span>QQ / OWNER</span><span>LIVE</span></div>
    <div class="cmp-chat">
      ${[
        ['23:01', '我', '你在干嘛'],
        ['23:01', '她', '在书房看书呢'],
        ['23:02', '小爱', '你会微积分吗'],
        ['23:02', '她', '这个我暂时还回答不上诶'],
        ['23:05', '我', '早点睡'],
        ['23:05', '她', '好，你也是'],
      ].map(([t, w, b], i) => `<div class="cmp-chat-row${w === '她' ? ' her' : ''}"><span class="cmp-chat-t">${t}</span><span class="cmp-chat-w">${w}</span><span class="cmp-chat-b">${b}</span></div>`).join('')}
    </div>
    <div class="cmp-cf"><span>6 条 · 上限 60</span><span class="cmp-a">刷新</span></div>
  </div>

  <div class="cmp-c mem">
    <div class="cmp-k"><span>MEMORY</span><span>2 条已确认</span></div>
    <div class="cmp-ct">温记忆</div>
    <div class="cmp-empty">记忆按「她说过的、我判过的」落成卡片，只把索引放进她的提示词。</div>
    <div class="cmp-cstats">
      <div class="cmp-stat"><div class="cmp-num-big">2</div><span class="k">已确认</span></div>
      <div class="cmp-stat"><div class="cmp-num-big">1</div><span class="k">待裁决</span></div>
      <div class="cmp-stat"><div class="cmp-num-big">2</div><span class="k">已拒绝</span></div>
    </div>
    <div class="cmp-cf"><span>生效范围</span><span class="cmp-scope"><button class="on">全局</button><button>仅 Onesoul</button></span></div>
    <div class="cmp-cf"><span>所有对话都进记忆</span><span class="cmp-a">进记忆页 →</span></div>
  </div>

 </div></div>
 <div class="cmp-foot"><span>dsh-onesoul · 总览</span><span>说话门：醒着 · QQ 在线</span></div>
</div>
`
writeFileSync('.local-preview/grid.html', html)
console.log('wrote .local-preview/grid.html (' + html.length + ' bytes)')
