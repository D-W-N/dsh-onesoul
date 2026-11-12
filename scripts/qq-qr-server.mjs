// QQ 登录看板：从 NapCat 启动日志里把 ASCII 二维码渲染成真图，随启动器刷新而刷新。
// 用法：node scripts/qq-qr-server.mjs        （端口 8899）
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import crypto from 'node:crypto';
import { renderLiveQr } from './qq-qr-render.mjs';

const PORT = Number(process.env.QR_PORT || 8899);
const WEBUI = 'http://127.0.0.1:6099';
const CFG = 'E:/dsh-onesoul/napcat/NapCat.Shell.Windows.Node/napcat/config/webui.json';

let jwt = null;
let jwtAt = 0;

function webuiToken() {
  try {
    return JSON.parse(readFileSync(CFG, 'utf8')).token || '';
  } catch {
    return '';
  }
}

async function napcatPost(pathname, body) {
  const r = await fetch(WEBUI + '/api' + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

async function loginStatus() {
  const token = webuiToken();
  if (!token) return { ok: false, error: '读不到 webui.json 的 token' };
  try {
    if (!jwt || Date.now() - jwtAt > 6 * 3600e3) {
      const hash = crypto.createHash('sha256').update(token + '.napcat').digest('hex');
      const a = await napcatPost('/auth/login', { hash });
      jwt = a?.data?.Credential || null;
      jwtAt = Date.now();
      if (!jwt) return { ok: false, error: 'WebUI 登录失败' };
    }
    const s = await napcatPost('/QQLogin/CheckLoginStatus', {});
    const d = s?.data || {};
    return {
      ok: true,
      isLogin: !!d.isLogin,
      phase: d.loginPhase || '',
      error: d.loginError || '',
      qrFromApi: !!d.qrcodeurl,
    };
  } catch (e) {
    jwt = null;
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>QQ 登录</title>
<style>
 body{margin:0;background:#0d1016;color:#e8eaee;font:15px/1.6 system-ui,"Segoe UI",sans-serif;
      display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:12px}
 .card{background:#fff;padding:12px;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.45)}
 img{width:min(72vmin,460px);height:min(72vmin,460px);image-rendering:pixelated;display:block}
 .t{opacity:.72;font-variant-numeric:tabular-nums;font-size:13.5px;text-align:center;max-width:60ch}
 .warn{color:#ffb454}.ok{color:#6ee7a7}
 a{color:#8ab4ff}
</style>
<div class="card"><img id="qr" alt="二维码"></div>
<div class="t" id="t">加载中…</div>
<script>
let n = 0
async function tick () {
  try {
    const r = await fetch('/state?n=' + (++n), { cache: 'no-store' })
    const j = await r.json()
    if (j.qrOk) document.getElementById('qr').src = '/qr.png?n=' + n
    else document.getElementById('qr').style.opacity = .15
    const bits = []
    if (j.isLogin) bits.push('<span class="ok">已登录</span>')
    else if (j.phase) bits.push('状态：' + j.phase)
    if (j.qrAgeSec != null) bits.push('码龄 ' + j.qrAgeSec + ' 秒' + (j.qrAgeSec > 300 ? ' <span class="warn">（可能已过期，重启 NapCat 会出新码）</span>' : ''))
    if (j.error) bits.push('<span class="warn">' + j.error + '</span>')
    bits.push('<a href="http://127.0.0.1:6099/webui/?token=' + j.webuiToken + '" target="_blank">打开 NapCat 自带页面</a>')
    document.getElementById('t').innerHTML = bits.join(' · ')
  } catch (e) {
    document.getElementById('t').textContent = '取状态失败：' + e.message
  }
}
tick(); setInterval(tick, 2500)
</script>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/qr.png') {
    const r = renderLiveQr(null);
    if (!r.ok) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(r.reason);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(r.png);
    return;
  }
  if (url.pathname === '/state') {
    const r = renderLiveQr(null);
    const st = await loginStatus();
    let qrAgeSec = null;
    let decodeUrl = '';
    if (r.ok) {
      try {
        const s = statSync(r.log);
        qrAgeSec = Math.round((Date.now() - s.mtimeMs) / 1000);
      } catch {}
      try {
        const all = [...readFileSync(r.log, 'utf8').matchAll(/二维码解码URL[:：]\s*(\S+)/g)];
        if (all.length) decodeUrl = all[all.length - 1][1];
      } catch {}
    }
    const body = {
      qrOk: r.ok,
      qrModules: r.ok ? r.modules : null,
      qrAgeSec,
      decodeUrl,
      webuiToken: webuiToken(),
      ...st,
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

server.listen(PORT, '127.0.0.1', () => console.log('QQ 登录看板 http://127.0.0.1:' + PORT + '/'));
