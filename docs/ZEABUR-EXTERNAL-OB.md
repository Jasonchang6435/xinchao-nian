# Zeabur：先测试，再桥接独立 OB，再开启真实写入

更新：2026-10-09。分支 `codex/zeabur-external-ob`。原生产 OB `https://gaoli.zeabur.app/` 全程保持运行；不升级、不重部署、不迁库、不重写历史。此文替代本分支此前默认开启写入的步骤。

## 1. 本次交付与部署顺序

根 Dockerfile 只构建 Node 心潮服务，不包含附带 OB、Python 或 Runtime Bridge。新心潮在后台通过 OB3.2 适配器桥接外部 OB；公开网页与 Claude 共用新心潮服务，分别使用 Dashboard 与 OAuth 授权。

**`DRYRUN` 是隔离路由，不是假成功响应。** 测试模式也调用真实 OB 实现，但只连接独立测试 OB，使用独立数据卷和独立 OAuth 凭据。缺测试地址会拒绝启动/连接，不会回退生产。配置变化后仅重启新心潮；不是热切换。

| 阶段 | DRYRUN | 测试写入 | 真实写入 | 目的 |
|---|---|---|---|---|
| A：新心潮上线，只读测试 OB | true（默认） | false | false | 域名、OAuth、工具发现、网页、读取链路 |
| B：测试 OB 完整流程 | true | `OMBRE_TEST_WRITE_ENABLED=true` | false | 人工保存、检索、匣子、信件、软删恢复、重启、备份恢复 |
| C：真实 OB 只读接入 | false | 不生效 | `OMBRE_WRITE_ENABLED=false` | 指定历史检索、星图；禁止显式新增/修改记忆 |
| D：真实业务写入 | false | 不生效 | true（独立人工开启） | 仅在 B、C 及真实逻辑恢复验收后开启 |

始终先保留 `OMBRE_DREAM_WRITE_ENABLED=false`、`OMBRE_ALLOW_DESTRUCTIVE_WRITES=false`；它们不会随普通写入自动开启。测试中要检查自动梦境落盘，可单独开启 `OMBRE_TEST_DREAM_WRITE_ENABLED`，真实开关仍为 false。

## 2. 先创建独立测试 OB

在 Zeabur **新建**测试 OB 服务，使用 `Jasonchang6435/Ombre-Brain` 的 OB3.2 代码，另建自己的持久卷，按它的 README 配置模型和 OAuth。研究基线为提交 `6f7335d01c43f79a82d5ec999ec3c517f6b9c8a5`；线上实际版本需在原服务 `/api/version` 与部署源中核对，版本不同应补测。

测试 OB 与原 OB 必须是不同服务、不同卷、不同域名；换一个生产域名别名不构成隔离。不能复制生产的自动 GitHub 同步、推送目的地或 OAuth 数据到测试服务。初期只放人工合成数据，模型采用你准备正式使用的供应商/模型。需要验证真实历史恢复时，另外建私有恢复实例，不能把私人备份放进公开演示实例。

**不运行 xinchao-nian 附带的 OB 代码。** 测试与正式阶段都桥接外部 OB；多出的测试 OB 是验收所需独立服务。后续停用测试服务不影响原 OB。

## 3. 给新心潮准备测试 OB OAuth 凭据

取得本分支代码，电脑安装 Node.js 22 或更高版本：

```bash
git clone --branch codex/zeabur-external-ob https://github.com/Jasonchang6435/xinchao-nian.git
cd xinchao-nian/xinchao
node scripts/authorize-ob.mjs https://<测试OB域名>/mcp .private/ob-test-oauth.json
```

用同一电脑浏览器打开打印的授权 URL，在**测试 OB**页面输入测试 OB Dashboard 密码。脚本执行动态注册、PKCE 和本地回调；不调用记忆工具，不打印访问/刷新令牌。文件权限为600，拒绝覆盖已有文件。

将私有文件内容对应填入新心潮 Variables，或一次性导入新心潮卷的 `/app/state/ob-test-oauth.json`：

```dotenv
OMBRE_TEST_AUTH_MODE=oauth
OMBRE_TEST_OAUTH_CLIENT_ID=<client_id>
OMBRE_TEST_OAUTH_REFRESH_TOKEN=<refresh_token>
OMBRE_TEST_OAUTH_TOKEN_URL=<token_endpoint>
OMBRE_TEST_OAUTH_RESOURCE=<resource>
```

刷新后以卷内最新凭据为准，环境变量只是首次初始化值。不要固定挂载会覆盖轮换令牌的旧文件；失效时为同一目标重新授权，替换对应**新心潮**凭据文件。密码、令牌都不发到聊天或 GitHub。

原 OB HTTP MCP 的 OAuth 说明见 [OB README](https://github.com/Jasonchang6435/Ombre-Brain/blob/6f7335d01c43f79a82d5ec999ec3c517f6b9c8a5/README.md)。静态 token 仅可用于目标 OB 已启用 token/hybrid 的情况，分别填 `OMBRE_TEST_AUTH_MODE=token` 与测试 token，不能用 Dashboard 密码冒充 Bearer。

## 4. Docker 部署新心潮

1. Zeabur 新增 GitHub 服务，选择 `Jasonchang6435/xinchao-nian`，分支 `codex/zeabur-external-ob`。
2. Root Directory 使用仓库根目录，检测根 Dockerfile；不要选 `ombre-brain`，不要运行旧联合 compose。
3. 新心潮单实例、端口18110；新建自己的卷挂载 `/app/state`，先挂卷再产生数据。
4. 分配新 HTTPS 域名，例如 `https://your-xinchao.zeabur.app`。
5. 按 [完整环境模板](../xinchao/zeabur.env.example) 填 Variables，替换全部占位地址及密钥；保留 `DRYRUN=true`、两组写入 false。
6. `OAUTH_PUBLIC_BASE_URL`、`DASHBOARD_PUBLIC_BASE_URL` 均为**新心潮**基础域名，不加 `/mcp`。
7. 三个密钥 `SERVICE_TOKEN`、`OAUTH_APPROVAL_TOKEN`、`DASHBOARD_ACCESS_TOKEN` 各用不同随机值。可各执行一次 `openssl rand -hex 32`。
8. 只部署新心潮，日志确认 `service_started`。原 OB 继续运行。

[Zeabur Dockerfile 构建说明](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)。根镜像以普通用户运行，入口准备新卷权限。不要多副本并发写同一文件卷。

测试模式默认心潮文件为 `/app/state/test/*`，正式模式为 `/app/state/*`；`TEST_STATE_PATH` 等只控制测试文件。测试 OB 授权为 `ob-test-oauth.json`，真实 OB 授权为 `ob-oauth.json`。切换不会把测试记忆 ID、匣子或 Claude OAuth 客户端继承到正式模式。自定义路径也必须分开，代码检查相同文件及路径归一化后的别名。

打开：

```text
https://<新心潮域名>/health
https://<新心潮域名>/.well-known/oauth-authorization-server
```

阶段 A 健康响应必须包含：

```json
{"ok":true,"dryRun":true,"memoryTarget":"test","memoryWritesEnabled":false}
```

`mode=active` 表示心潮状态引擎运行，不能据此判断允许写 OB。根路径404正常，镜像没有完整自托管网页。GET `/mcp` 的401/405也不能代替 OAuth POST 验收。

首次连接客户端前，在新服务终端执行 `cd /app` 后执行 `su-exec node:node node scripts/check-ob.mjs`（终端本来已是node用户则直接 `node scripts/check-ob.mjs`）。成功应为 `ok:true`、`memoryTarget:test`、`memoryWritesPerformed:false`；只 initialize/tools/list，不调用 breath/dream/hold。授权文件应由UID1000保存；若对正在使用的实例另开诊断进程并刷新了授权，只重启新心潮，使主进程重新读取轮换凭据。

## 5. 接网页与 Claude，完成线上测试流程

公开网页可复用 [xinchaomind.uk](https://xinchaomind.uk)。在“我的心潮有公网地址”模式填新心潮基础地址与 `DASHBOARD_ACCESS_TOKEN`。不加 `/mcp`，不填 OB 密码/令牌、SERVICE_TOKEN。公网模式经网页服务器中继，`DASHBOARD_ALLOWED_ORIGINS` 可保持空；自建浏览器直连时才配置精确来源。参考 [上游连接说明](CONNECT-XINCHAOMIND.md)。

星图详情是可选的人类权限路径：在当前模式填 `OMBRE_TEST_DASHBOARD_BASE_URL` 和测试管理页密码，正式阶段则填无 TEST 前缀的对应变量。无此凭据可使用 MCP pulse 星图回退，但正文预览不可用。后台只返回最多7行，上锁信件不返回正文；AI 的材料始终走 AI MCP，不能借人类 cookie 读锁信。

完整公开网页前端源码未在此前核查的作者公开仓库中找到，因此本镜像不声称含有完整自托管前端。公开的 [梦境云图组件](https://github.com/tianyupaipai-cmd/xinchao-dream-cloudmap) 可用于另做页面。当前工具链先复用公开网页；视觉展示仍须部署后实际验收。

Claude 添加 custom remote MCP connector，URL 为 `https://<新心潮域名>/mcp`。选择自动注册 OAuth 客户端，在**新心潮**授权页输入 `OAUTH_APPROVAL_TOKEN`，在对话中启用该连接。[Claude 官方连接步骤](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)。不要填原 OB Client ID；原 Claude→OB 连接保留但测试对话仅启用新连接，避免工具重名和双写。

A 阶段先验证 xinchao_context、xinchao_event、网页驱力/情绪/时间线/星图及测试记忆检索。向 hold 发请求应被拒绝，tools/list 不应开放写工具。

B 阶段只改：

```dotenv
DRYRUN=true
OMBRE_TEST_WRITE_ENABLED=true
OMBRE_WRITE_ENABLED=false
SHADOW_MODE=false
```

只重启新心潮，健康响应须 `dryRun:true`、`memoryTarget:test`、`memoryWritesEnabled:true`。这代表**测试 OB**可写，真实写入开关仍关闭。

用明确带 `TEST_ONLY` 标识的数据执行并保存验收记录：

- hold 保存中文、Unicode、换行、wiki 链接；再按 ID 核对正文，source_content/ranges 与 quotes 保真。
- grow 先使用明确 items，重试同一批次核对数量；再用真实模型测自然文本分段、标题、域与合并质量。
- breath_search 查到已保存数据；星图和最多7行预览正常，锁信正文不泄露。
- xinchao_box 新增产出，选择 keep 后回查目标记忆；只读阶段 keep 应拒绝。
- I 写候选后核对 candidate；历史正式 I 保留，不为通过测试强制 promote。
- letter_write/read/lock_update 测 AI 自己锁、人类锁及到期策略；MCP 不能冒充人类创建锁信。
- forget(id,reason) 后从活跃目录消失；restore(id) 后原文相同。物理删除/覆盖正文应被保护拒绝。
- 重启新心潮及**测试 OB**，验证状态、记忆和两层 OAuth 授权；测试卷备份恢复到新卷后再验一次。
- 单独在测试 OB 模拟模型超时、写入后响应丢失；不得盲目重写导致重复。

本地三轮真实服务测试已通过，但它使用确定性模型 fixture，不能替代线上真实模型质量、Claude 产品客户端和公开网页的验收。各项结果不齐全时保持阶段 B，不自动切生产。

## 6. 原 OB 不停服：逻辑导出与私有恢复验证

在原 OB 管理页登录，使用完整 ZIP 导出（接口 `GET /api/export`），保存到你的私有电脑，另存 `shasum -a 256 <备份.zip>` 的值。不要使用单纯文本/摘要导出替代它。

当前 OB3.2 ZIP 包含 Markdown（含归档）、不可变 `_sources` 证据和一致的 embeddings.db 快照及校验清单。**不包含**附件 `_media`、配置、OAuth、心潮状态或部署镜像。逐文件导出也不是跨所有文件的同一时点快照，原 OB/旧客户端仍可继续写入。详见 [风险与恢复报告](OB32-RISK-AND-RECOVERY.md)。

将副本恢复到全新、私有的 OB3.2 实例：先核验 manifest、逐文件哈希、source_refs 闭包与 SQLite；原文直接恢复，不经过压缩模型；单独配置新实例并重新授权。禁止覆盖原 OB 卷。`tools/lab/logical_restore.py` 已验证此原文恢复路径，必须在固定 OB3.2 Python 镜像内运行，目标必须是新目录；大数据生产操作优先使用该版本官方受限解压/迁移入口及其容量限制。

真实恢复验收应包括活跃/归档数量、每条 ID 与正文哈希、旧 I、锁信策略、不可变来源、SQLite、附件缺口清单，以及新实例启动/检索。备份包含私人历史，恢复实例不能用于公开演示。源码/镜像提交、Variables、附件及凭据另保管。

[Zeabur 官方文件卷完整备份](https://zeabur.com/docs/zh-CN/operations/data/backup-restore)需要暂停对应文件服务。本阶段遵照你的决定不暂停原 OB，执行的是在线逻辑恢复验证，不能称为完整文件卷备份；后续若要求全卷原子恢复点，再另选维护窗口。

## 7. 切真实目标，但仍不开放写入

B 阶段及真实逻辑恢复验收通过后，单独为新心潮授权**原 OB**：

```bash
node scripts/authorize-ob.mjs https://gaoli.zeabur.app/mcp .private/ob-oauth.json
```

将这份凭据填到 `OMBRE_OAUTH_*` 或导入新心潮 `/app/state/ob-oauth.json`，不要替换测试文件。核对无 TEST 前缀的 MCP、extra、Dashboard 地址为原 OB。

```dotenv
DRYRUN=false
OMBRE_WRITE_ENABLED=false
OMBRE_DREAM_WRITE_ENABLED=false
OMBRE_ALLOW_DESTRUCTIVE_WRITES=false
```

只重启新心潮，健康响应须 `dryRun:false`、`memoryTarget:live`、`memoryWritesEnabled:false`。正式心潮状态单独初始化。更换新心潮的三个密钥，使测试访问者不能访问私人历史；Claude 重新注册授权，网页重新登录。

先 check-ob 仅做工具发现，再由本人指定少量历史主题检索和星图查看。写工具隐藏，直接调用也拒绝；OB3.2 dream 因会改变 I 见证记录，也拒绝。**breath 等读取仍可能更新访问计数、足迹、到期锁状态**；无显式写入不等于原卷字节完全不变。如果要求新心潮对原卷零变化，仅做 initialize/tools/list，内容测试继续用恢复副本。

## 8. 单独开启真实写入与回退

确认上述验收并接受在线逻辑备份的范围后，才将 `OMBRE_WRITE_ENABLED=true`；`DRYRUN=false` 保持不变，只重启新心潮。自动梦境落盘及物理删除/正文覆盖仍关闭。先保存一条本人明确选择的正常记忆，按 ID 回查，再逐步使用。

主动模型/白昼功能最后启用；模型密钥不由 Claude MCP 连接自动提供。Bark、Bridge、公共留言墙默认关闭；Claude 网页连接器不保证能接收 Runtime 的后台主动注入。

立即回退分两类：关闭新心潮或将真实写入改 false，即回到原 OB 使用方式，无须恢复原库；已发生的正常写入仍保留。若发生数据错误，先停新心潮写入、保留事故后的备份与差异，再在新卷验证恢复，不能把旧备份直接覆盖原卷，否则会丢掉备份后的正常记忆。OAuth 轮换后仅恢复旧心潮凭据可能失效，需重新授权，或在隔离实验中成对恢复 OB 与心潮。

完整恢复、故障策略及已验证证据见 [数据安全报告](OB32-RISK-AND-RECOVERY.md)，可复现实验见 [Docker 实验说明](../tools/lab/README.md)。

## 9. 排错

| 现象 | 处理 |
|---|---|
| 缺 OMBRE_TEST_MCP_URL | 默认测试模式没有测试地址，拒绝回退原 OB；配置独立测试服务 |
| DRYRUN origin/state alias 拒绝 | 测试误填生产域名或共用文件；按两套环境拆分 |
| HTTP401 | 核对当前模式选中的那套授权/轮换凭据 |
| HTTP404 | 当前 OB3.2 信件走 `/mcp-extra`，附带旧2.6.5是统一 `/mcp`，不能混用 |
| 工具只剩心潮 | 桥接未成功，不作为通过；检查上游鉴权及 tools/list |
| ombre_write_disabled | A/C阶段预期结果；B只开 TEST 写入，D才开真实写入 |
| EACCES | 确认新心潮卷 `/app/state` 与入口权限，单实例运行 |
| 星图 building/无预览 | 稍候后台构建；当前模式另配人类 Dashboard 凭据 |
| 切模式后 Claude401 | 两套心潮 OAuth 文件分开，需要重新授权 |
