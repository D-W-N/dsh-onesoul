# 发布手册 · dsh-onesoul（单包）

> **2026-11-01 夜更新：口径已改为单包发布，本文下半部分的三包顺序仅作历史与回滚参考。**
>
> - npm：`dsh-onesoul@0.1.2` 已发布（0.1.0 首版 → 0.1.1 行 id 修正 → 0.1.2 当前 latest） → https://www.npmjs.com/package/dsh-onesoul
> - GitHub：https://github.com/D-W-N/dsh-onesoul （tag `v0.1.2`）
> - 安装：`dsh plugin add --profile web dsh-onesoul`
> - 单包里 **内置** `dsh-anima` 与 `dsh-companion-dashboard` 的 lib（`plugins/anima/lib`、`plugins/dashboard/lib`，由 `scripts/build-onesoul.mjs` 从 `packages/` 同步），第三方 7 个包仍是 `dependencies`。
> - 为什么必须单入口：宿主 `dsh-client-modules` 的 `exactPackageSpecifier()` 对子路径返回 undefined ⇒ `dsh.client` 只能挂在包根，`cordis.patch.yml` 里也只能写一行 `- id: dsh-onesoul / name: dsh-onesoul`。

## 单包重新发布（当前流程）

```bash
cd E:/dsh-onesoul && node scripts/build-onesoul.mjs            # 把 packages/*/lib 同步进 plugins/
cd E:/dsh-onesoul/packages/dsh-onesoul && npm version patch    # 或 minor/major
npm publish --userconfig E:/dsh-onesoul/.verify/npmrc-publish \
  --registry https://registry.npmjs.org
cd E:/dsh-onesoul && git commit -am "release" && git push origin main
```

发布凭证：`E:/dsh-onesoul/.verify/npmrc-publish`（granular token，**必须勾 Bypass 2FA**，否则 registry 回 403「granular access token with bypass 2fa enabled is required」；普通 granular token 只能 `npm stage publish` 进暂存区）。

GitHub 推送凭证：`E:/dsh-onesoul/.verify/github_key`（ed25519，已加到账号 D-W-N 的 SSH keys），remote 用 SSH over 443：

```bash
GIT_SSH_COMMAND='ssh -F /dev/null -i E:/dsh-onesoul/.verify/github_key -o IdentitiesOnly=yes -o UserKnownHostsFile=/dev/null -p 443' git push
```

（本机 22 端口被封、https 走 Watt Toolkit 中间人证书使 node 侧 TLS 校验失败，所以走 `ssh.github.com:443`。）

---

# 历史：三包发布（dsh-anima → dashboard → bundle）

发布顺序**必须**是 `dsh-anima` → `dsh-companion-dashboard` → `dsh-companion-bundle`：
聚合包的 `dependencies` 指向前两个包，先发聚合包会让用户装到一个解析不到依赖的空壳。

## 0. 前置

```bash
npm whoami            # 现在是 ENEEDAUTH，先登录
npm login             # 或 npm config set //registry.npmjs.org/:_authToken=<token>
npm config get registry
```

registry 必须是 **npmjs.org**（聚合包在 npmmirror 上还不存在，pnpm 解析依赖会 404）。
若公司网络需要镜像，请只对第三方包用镜像，自己这两个包发布到 npmjs。

## 1. 发布前本地校验

```bash
cd E:/dsh-onesoul

# 冒烟（8 项）
node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs

# 浏览器半 SSR（registerTab + 四分支渲染 + 实时状态归一化）
node scripts/ssr-check.mjs

# 打包 + 聚合包 patch 结构校验
rm -rf .verify/tarballs && mkdir -p .verify/tarballs
for p in dsh-anima dsh-companion-dashboard dsh-companion-bundle; do
  (cd packages/$p && npm pack --cache E:/dsh-onesoul/.probe/npmcache --pack-destination E:/dsh-onesoul/.verify/tarballs | tail -1)
done
node .verify/check-patch.mjs
```

`check-patch.mjs` 必须输出 `missingPackages: []`、`missingEntries: []`（3 个条目 / 9 行 / 2 条 accessToken 覆写行），`danglingOverrides` 也必须为空。

## 2. 发布

```bash
cd E:/dsh-onesoul/packages/dsh-anima              && npm publish --access public
cd E:/dsh-onesoul/packages/dsh-companion-dashboard && npm publish --access public
cd E:/dsh-onesoul/packages/dsh-companion-bundle    && npm publish --access public
```

验证：

```bash
npm view dsh-anima version
npm view dsh-companion-dashboard version
npm view dsh-companion-bundle version
npm view dsh-companion-bundle dependencies
```

## 3. 发布后的一行装齐验证（干净 profile）

```bash
dsh plugin add --profile web dsh-companion-bundle
dsh --profile web --dump-config | grep -E '^- id: (dsh-anima|dsh-companion-dashboard|dsh-better-sidebar|dsh-deepseek-web-login|dsh-meme|dsh-bili-pond|dsh-onebot|onebot-settings-remote|napcat-keeper)'
dsh --profile web --dump-config | grep -c 'accessToken: dsh-companion-onebot'   # 期望 2
```

期望：9 行齐全、`accessToken` 出现 2 次、无 `Cannot find package`、无 `did not activate`。

QQ 通道换过一次（`@zaofan/dsh-qqbot` → `dsh-onebot-qq` + `dsh-napcat-keeper`）：若旧 profile 的 cordis.patch.yml 里还留着
`- id: qqbot` / `name: '@zaofan/dsh-qqbot'`，每次启动都会 ERR_MODULE_NOT_FOUND，发布后请一并提示用户删除。

### 3.1 QQ 生效还需要用户自己做两件事

1. 装好 NapCat 并用**小号**扫码登录（插件层不区分主号/小号，NapCat 登哪个号 AI 就是哪个号）；
2. 两边 accessToken 保持一致（聚合包默认 `dsh-companion-onebot`；在 napcat 桥面板改的话 onebot 侧要改成同一串），
   否则 NapCat 连上来被 4401 拒绝、或反向 WS 直接起不来。

若出现 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: onnxruntime-node@1.30.0`：
包已装好、只是 pnpm 跳过了构建脚本，在该 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 里加一行即可，不影响装配。

## 4. 版本联动

当前待发布版本：`dsh-anima@0.1.10`、`dsh-companion-dashboard@0.1.35`、`dsh-companion-bundle@0.1.41`。

改 `dsh-companion-dashboard` 或 `dsh-anima` 后要同步两处：

1. 该包自己的 `version`；
2. `packages/dsh-companion-bundle/package.json` 里对应的依赖范围（如 `^0.1.23`）与自己的 `version`。

本地反复试装时，把 `file:` 依赖指向新 tgz 再 `pnpm install`（版本号没变 pnpm 会沿用旧缓存，必须让路径或版本变化）。

## 5. 已知的宿主侧约束（发布不能解决）

- `dsh-better-sidebar` 钉在 `^0.26.1`（peer `@deepseek-ai/dsh-agent ^0.2.0-rc.2`）。用户的 DSH 升到 ≥0.2.1-rc.1 后可自行升到 `^0.28`。
- desktop profile 由 Electron 独占管理，`dsh plugin add --profile desktop` 会被拒绝；桌面用户需要按
  `docs/VERIFICATION.md §7.2` 的 pnpm 方式安装，或把日常 profile 切到 web。