// 静态预览：把 client.js 里那段总览台 CSS 抽出来，配一份等价 markup，截图看长相。
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('packages/dsh-companion-dashboard/lib/client.js', 'utf8')
const start = src.indexOf("  // ---- 总览台")
const end = src.indexOf("].join('\\n')", start)
if (start < 0 || end < 0) throw new Error('找不到 CSS 段')
const block = src.slice(start, end)
const css = block
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith("'."))
  .map((line) => line.replace(/^'/, '').replace(/',?$/, ''))
  .join('\n')

const room = (name, act, style, cur) =>
  `<button class="cmp-room${cur ? ' cur' : ''}" style="${style}"><span class="rn">${name}</span><span class="ra">${act}</span></button>`
const svc = ([name, on]) =>
  `<div class="cmp-svc${on ? ' on' : ''}"><span class="cmp-dot"></span><span class="n">${name}</span><span class="st">${on ? 'ON-LINE' : 'OFF-LINE'}</span></div>`

const html = `<!doctype html><meta charset="utf-8">
<style>
html,body{margin:0;height:100%;font-family:"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif}
${css}
</style>
<div class="cmp-console dark" style="padding:0">
 <div class="cmp-aura"></div>
 <div class="cmp-console-scroll"><div class="cmp-cgrid">
  <div class="cmp-c">
    <div class="cmp-k"><span>NOW</span></div>
    <div class="cmp-ct">她在书房</div>
    <div class="cmp-h">她在书房，看书。预计 12:22 换地方。</div>
    <div class="cmp-h">她回来会自己找上，不用一直等。</div>
    <div class="cmp-cf"><span>QQ 会话：在线</span><span class="cmp-a">去她的房间 →</span></div>
  </div>
  <div class="cmp-c">
    <div class="cmp-k"><span>SYSTEM</span></div>
    <div>${[['QQ 桥接', true], ['QQ 客户端', true], ['人格 · anima', true], ['B站', true], ['表情包', true], ['侧面栏', true]].map(svc).join('')}</div>
  </div>
  <div class="cmp-c">
    <div class="cmp-k"><span>MY HEAR</span></div>
    <div class="cmp-ct">没有在放歌</div>
    <div class="cmp-h">此刻安静。</div>
    <div class="cmp-cf"><span>她可以自己选歌</span><span class="cmp-a">还没接上播放器</span></div>
  </div>
  <div class="cmp-c wide">
    <div class="cmp-k"><span>HOME / LIVE</span></div>
    <div class="cmp-live">
      <div class="cmp-plan">
        ${room('客厅', '', 'grid-column:1 / 2;grid-row:1 / 2', false)}
        ${room('书房', '看书', 'grid-column:1 / 2;grid-row:2 / 3', true)}
        ${room('餐厅', '', 'grid-column:2 / 3;grid-row:1 / 2', false)}
        ${room('次卧', '', 'grid-column:2 / 3;grid-row:2 / 3', false)}
        ${room('阳台', '', 'grid-column:3 / 5;grid-row:1 / 2', false)}
        ${room('厨房·餐室', '', 'grid-column:3 / 4;grid-row:2 / 3', false)}
        ${room('玄关', '', 'grid-column:4 / 5;grid-row:2 / 3', false)}
      </div>
      <div class="cmp-in">
        <div class="cmp-k"><span>INDOOR</span></div>
        <div class="big">她在书房</div>
        <div class="cmp-h">她此刻在书房，看书。</div>
        <div class="cmp-stats">
          <div class="cmp-stat"><span class="k">房间</span><span class="v">书房</span></div>
          <div class="cmp-stat"><span class="k">状态</span><span class="v">看书</span></div>
          <div class="cmp-stat"><span class="k">回来</span><span class="v">12:22</span></div>
        </div>
      </div>
    </div>
  </div>
  <div class="cmp-c">
    <div class="cmp-k"><span>QQ / OWNER</span><span>LIVE</span></div>
    <div class="cmp-ct">最近的对话</div>
    <div class="cmp-empty">QQ 在线了，这里会显示最近 8 条私聊。</div>
    <div class="cmp-cf"><span>最近 8 条 / 只显示私聊</span><span class="cmp-a">去 QQ →</span></div>
  </div>
  <div class="cmp-c">
    <div class="cmp-k"><span>OWN DESIRE</span></div>
    <div class="cmp-ct">她想要的</div>
    <div class="cmp-empty">她还没写下想要的东西。等她把想法记下来，这里会一条条排出来。</div>
    <div class="cmp-cf"><span>她自己写下的，不一定说</span><span class="cmp-a">她的想要什么 →</span></div>
  </div>
  <div class="cmp-c">
    <div class="cmp-k"><span>MEMORY</span><span>12 条已确认</span></div>
    <div class="cmp-ct">温记忆</div>
    <div class="cmp-empty">记忆按「她说过的、我判过的」落成卡片，只把索引放进她的提示词。</div>
    <div class="cmp-cstats">
      <div class="cmp-stat"><div class="cmp-num-big">12</div><span class="k">已确认</span></div>
      <div class="cmp-stat"><div class="cmp-num-big">3</div><span class="k">待裁决</span></div>
      <div class="cmp-stat"><div class="cmp-num-big">2</div><span class="k">已拒绝</span></div>
    </div>
  </div>
 </div></div>
 <div class="cmp-foot"><span>dsh-onesoul · 总览 · 会话 VD-1</span><span>说话门：醒着 · QQ 在线</span></div>
</div>`

writeFileSync('E:/dsh-onesoul/.local-preview/console.html', html)
console.log('css lines:', css.split('\n').length, 'html:', html.length)
