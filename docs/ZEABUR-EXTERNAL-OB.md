# Zeabur：独立心潮 Docker + 现有 OB + 网页 + Claude

更新：2026-10-09。按顺序操作；原 OB 继续运行。本文适用于本 fork 的 `codex/zeabur-external-ob` 分支，合并后也可用 main。

## 1. 这次改造提供什么

```text
公开可视化网页 ── Dashboard会话 ──> 新Zeabur心潮服务
Claude ── OAuth + MCP ─────────> 同一个新服务
                                 │ OB3.2兼容层
                                 ├─ /mcp：原有记忆工具
                                 ├─ /mcp-extra：原有信件工具（独立会话）
                                 └─ Dashboard API：人类星图与预览（可选独立凭据）
                                 ↓
                       原 gaoli.zeabur.app OB服务及原记忆卷
```

根 Dockerfile 仅 COPY `xinchao/` 的应用文件，镜像没有 Python、附带 OB 或 Runtime Bridge。旧联合 compose 保留供原用法；本路线不使用它。

新服务的 `ob32` 适配器处理：高级召回参数、梦境来源标记、MCP与Dashboard分离认证、旧星图数据转换、预览锁信、OAuth刷新、独立信件会话、forget软删除别名、高级检索/feel/plan工具透传。匣子keep是单条明确产出，使用旧hold的可靠ID响应，避免把旧grow返回标题误当ID。

原 OB 不升级、不重部署、不迁库、不重写历史。上线后继续通过旧接口正常读写；登录授权与正常召回/写入会产生原有业务状态，这是允许的正式运行行为。

## 2. 先准备原 OB 的认证，不修改它

### A. 原来已有静态 Bearer

在原 OB 的 Zeabur Variables 查看已有 `OMBRE_MCP_AUTH_MODE` 与 `OMBRE_MCP_TOKEN`。如果现有模式接受静态令牌，把**已有**令牌复制到新服务的同名变量。不要为了这条路线更改原服务模式或重新部署。

新服务使用：

```dotenv
OMBRE_AUTH_MODE=token
OMBRE_MCP_TOKEN=<原OB已接受的令牌>
```

### B. 原来只有 OAuth，或不确定静态令牌

已核对原服务暴露 OAuth 元数据，未授权 MCP 请求返回401。但这些公开信息不能确认后台是否同时允许静态令牌。无需猜一个令牌，也无需切换旧服务鉴权，可以直接授权新桥接客户端。

在自己的电脑安装 Node.js 22或更高版本，取得本分支代码：

```bash
git clone --branch codex/zeabur-external-ob https://github.com/Jasonchang6435/xinchao-nian.git
cd xinchao-nian/xinchao
node scripts/authorize-ob.mjs https://gaoli.zeabur.app/mcp
```

脚本打印授权URL。用**同一台电脑**的浏览器打开，按原OB授权页输入已有凭据。脚本使用动态客户端注册、PKCE和本地回调；不会调用记忆读写工具，也不会打印访问/刷新令牌。

授权成功生成 `.private/ob-oauth.json`（权限600；Git忽略）。已有同名文件时脚本拒绝覆盖，重新授权可传入另一个私有输出文件路径作为第二个参数。

在本机私下打开该文件，把 `client_id`、`refresh_token`、`token_endpoint`、`resource` 对应填进**新服务**：

```dotenv
OMBRE_AUTH_MODE=oauth
OMBRE_MCP_TOKEN=
OMBRE_OAUTH_CLIENT_ID=<client_id>
OMBRE_OAUTH_REFRESH_TOKEN=<refresh_token>
OMBRE_OAUTH_TOKEN_URL=<token_endpoint>
OMBRE_OAUTH_RESOURCE=<resource，通常https://gaoli.zeabur.app/mcp>
OMBRE_OAUTH_STATE_PATH=/app/state/ob-oauth.json
```

第一次连接自动刷新并将当前凭据写入新卷；后续优先使用卷内的最新刷新凭据，环境变量仅用于首次初始化。授权过期或被撤销时需重新授权，并显式替换/移走**新心潮卷内**旧的 `ob-oauth.json` 再重启新服务；不要操作原OB记忆卷。也可用Zeabur文件管理将私有凭据文件一次性导入新卷，不要将会在每次部署覆盖刷新的凭据文件配置为固定镜像或静态挂载。

## 3. 在 Zeabur 只创建新服务

1. 打开已有 OB 所在项目，新增 GitHub 服务，选择 `Jasonchang6435/xinchao-nian`。
2. Source 分支选择 `codex/zeabur-external-ob`；若PR已合并，可选 main。
3. Root Directory 使用仓库根目录 `/`（或界面默认空值）；Zeabur应检测到根目录 `Dockerfile`。不要选 `ombre-brain`，不要运行旧联合compose。选择 `/xinchao` 也有对应Dockerfile，但本文推荐根目录构建。
4. 新服务保持**单实例**，端口 `18110`。应用读取 `PORT` 并监听 `0.0.0.0`。状态文件方案不支持多个实例同时写同一状态。
5. 在新服务 Volumes 创建自己的卷，挂载 `/app/state`。在正式产生数据前挂好。不要碰原OB卷。容器入口只准备这个目录的权限，随后以node用户运行。
6. 在新服务 Networking 绑定一个新的HTTPS域名。例如 `https://your-xinchao.zeabur.app`。这个地址的主机名需以控制台实际分配为准。
7. 将 [zeabur.env.example](../xinchao/zeabur.env.example) 的值填入新服务Variables。替换所有占位值，填入第2节的OB认证。
8. 部署/重启只针对这个**新服务**。日志应出现 `service_started`。

Zeabur官方：[Dockerfile构建](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)、[Root Directory](https://zeabur.com/docs/en-US/deploy/config/root-directory)、[Volumes](https://zeabur.com/docs/en-US/data-management/volumes)。

### 必填的新服务配置

三个新密钥各生成一次，使用不同值：

```bash
openssl rand -hex 32
```

| 变量 | 值/含义 |
|---|---|
| `SERVICE_TOKEN` | 第一份随机密钥，仅供服务端HTTP管理接口 |
| `OAUTH_APPROVAL_TOKEN` | 第二份随机密钥，Claude连接时在你的心潮授权页输入 |
| `DASHBOARD_ACCESS_TOKEN` | 第三份随机密钥，公开网页连接你的心潮时输入 |
| `OAUTH_PUBLIC_BASE_URL` | **新**心潮HTTPS基础域名，不加`/mcp` |
| `DASHBOARD_PUBLIC_BASE_URL` | 同一个新域名，不加路径 |
| `MCP_ENABLED`、`OAUTH_ENABLED`、`DASHBOARD_ENABLED` | `true` |
| `OMBRE_ADAPTER` | `ob32` |
| `OMBRE_MCP_URL` | `https://gaoli.zeabur.app/mcp` |
| `OMBRE_MCP_EXTRA_URL` | `https://gaoli.zeabur.app/mcp-extra` |
| `OMBRE_READ_ENABLED`、`OMBRE_WRITE_ENABLED`、`CONTEXT_OMBRE_ENABLED` | `true` |
| `SHADOW_MODE` | `false`，正式正常运行 |

最初使用已知公网OB地址，减少私网Host/OAuth资源绑定差异。成功后可改为同项目原OB Networking→Private 显示的真实hostname与端口。OAuth令牌资源及刷新地址仍保留原公开URL；不要根据服务显示名称猜私网地址。[Zeabur私网说明](https://zeabur.com/docs/en-US/deploy/networking/private-networking)。

### 星图与预览的可选凭据

在新服务设置 `OMBRE_DASHBOARD_BASE_URL=https://gaoli.zeabur.app`，并填 `OMBRE_DASHBOARD_PASSWORD=<原OB管理页密码>`；也可填已有 `OMBRE_DASHBOARD_SESSION` 的cookie值。后台自动登录/续会话，原密码与cookie不返回前端。

没有这些凭据时，星图回退到MCP `pulse` 元数据，**桶正文预览不可用**。填凭据后从原结构化列表构建星图并按需读取最多7行正文；上锁信件正文仍不返回。AI梦/念头材料始终来自AI的MCP调用，不使用拥有不同权限的人类Dashboard cookie。

## 4. 验证新服务与 OB 桥接

浏览器打开：

```text
https://<新心潮域名>/health
https://<新心潮域名>/.well-known/oauth-authorization-server
```

健康返回 `ok:true`、版本4.0.0及active模式；OAuth元数据应全部指向新域名。根路径暂时返回404，因为完整自托管网页源码未包含，这不代表服务故障。直接GET `/mcp` 返回401或405也不是健康检查失败，MCP需要鉴权POST。

在新服务的命令执行/终端中运行：

```bash
cd /app
node scripts/check-ob.mjs
```

成功返回 `ok:true`、工具名称及 `memoryWritesPerformed:false`。它只做initialize和tools/list，不做breath激活、不写测试记忆。配置了extraURL时还要求三个信件工具存在。

| 问题 | 处理 |
|---|---|
| `HTTP401` | 核对原OB接受的认证；OAuth则核对导入的授权/刷新凭据 |
| `HTTP404` | 核对URL路径和现有OB版本；3.2的信件使用`/mcp-extra` |
| `Required OB tools missing` | 不要把只显示心潮工具误判为桥接成功，核对OB连接和版本 |
| `EACCES` | 确认新卷挂载`/app/state`且使用本Docker入口；自定义容器用户需保证UID1000可写 |
| 星图`building` | 首次构建在后台进行，稍后刷新；大库可能耗时 |
| 预览`dashboard_credentials_missing` | 配独立的原OB管理页凭据，与MCP认证不同 |
| `ombre_write_disabled` | 正式运行应`OMBRE_WRITE_ENABLED=true`、`SHADOW_MODE=false` |

重启新服务后，新心潮状态和OAuth刷新状态应保留；原OB管理页仍能查看原历史。不要在上线准备中向生产OB批量写测试数据。

## 5. 接入可视化网页

复用上游公开网页 [xinchaomind.uk](https://xinchaomind.uk)。按它的连接窗口选择**我的心潮有公网地址**，输入：

```text
地址：https://<新心潮域名>
口令：新服务的 DASHBOARD_ACCESS_TOKEN
```

地址不加`/mcp`，不填原OB地址。公网模式由网页服务器中继；`DASHBOARD_ALLOWED_ORIGINS`可保持空。原OB令牌/密码和`SERVICE_TOKEN`都不填进公开网页。上游连接说明：[CONNECT-XINCHAOMIND](CONNECT-XINCHAOMIND.md)。

核对11维驱力、情绪、时间线、性格、小屋与OB星图。网页是否展示某项仍取决于上游平台版本。梦境文字默认隐藏；需要显示时在自己的新服务显式设置 `DASHBOARD_INCLUDE_PRIVATE_TEXT=true`。

完整 `xinchaomind.uk` 前端未在作者当前公开仓库中找到，本次不声称镜像已自带它。自托管可复用 [梦境云图组件](https://github.com/tianyupaipai-cmd/xinchao-dream-cloudmap)，另做看板并同源连接现有Dashboard API；这是独立的前端开发范围。

## 6. 最后接入 Claude MCP Connector

按Claude当前界面进入 **Customize → Connectors → + Add → Add custom connector**（不同客户端可能仍显示Settings/Connectors）。名称可填“心潮·念”，URL填写：

```text
https://<新心潮域名>/mcp
```

选择OAuth登录；OAuth client使用 **Register automatically**。本服务实现动态客户端注册，没有实现Claude发布身份的客户端元数据机制；不要填原OB的Client ID，也不要把SERVICE_TOKEN贴到网页输入框。

点击连接后跳到**新心潮域名**的授权页，输入新服务 `OAUTH_APPROVAL_TOKEN`。授权后，在对话左下角 `+ → Connectors` 开启本连接。Team/Enterprise需有权限的管理员先添加，成员再连接。[Claude官方操作说明](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)。

先要求Claude：

> 请调用 xinchao_context，确认心潮连接；再用 breath_search 查询一个我指定的既有历史记忆主题。此时不要新建或修改记忆。

应看到心潮工具及原OB检索工具。以后有明确保存意图时，才通过同一连接使用hold/grow。原OB连接器可以保留，但同一对话中通常只启用新心潮连接，避免工具重名或同一事件双写；这不需要删除或暂停原服务。

建议补充到Claude的使用说明：

> 新窗口开始调用 xinchao_context；一次明确互动结束后调用 xinchao_event，并使用稳定event_id避免重复。需要查旧事时调用breath_search；保存长期记忆前遵守用户明确意图。人物基岩和核心指令保留原配置，心潮短态不替代它们。

## 7. 手动链路成功后启用主动功能

先完成前述部署和接入，再在新服务填入自己的兼容模型配置：

```dotenv
MODEL_ENABLED=true
MODEL_BASE_URL=https://<模型服务>/v1
MODEL_API_KEY=<你的密钥>
MODEL_NAME=<实际模型名称>
DAYTIME_EMERGENCE_ENABLED=true
```

梦、部分互动分类和自主念头需要模型；仅有MCP连接不会替代这些服务端模型调用。Bark推送需额外配置自己的Bark；Runtime主动注入需另接支持的客户端Bridge。Claude网页Connector不等于本地Runtime，不承诺后台主动消息能自动注入Claude窗口。默认不配置公共留言墙令牌，避免无意向官方公共平台发帖。

## 8. 本地Docker复现与回退

从仓库根目录构建：

```bash
docker build -t xinchao-external-ob .
```

把环境模板复制为私有 `xinchao/.env` 并替换占位值，再使用独立compose：

```bash
docker compose -f compose.external-ob.yaml up -d --build
```

此compose只有一个心潮容器与新状态卷，没有OB服务。停止新心潮服务、在Claude关闭新连接即可回到原OB使用方式。原记忆无需恢复或迁移；已经通过正常业务写入的新记忆也不自动删除。

## 9. 验证范围

已验证：原174项测试和新增14项测试全部通过，共188项；覆盖OB3.2协议/参数/权限适配、慢元数据查询回退、实际心潮HTTP服务的OAuth/PKCE与Dashboard/MCP联调。独立Docker镜像构建、启动、普通用户运行及新卷重启持久化也通过。新增测试只使用本机模拟OB，不使用生产历史数据。实际Zeabur部署、真实OB授权以及官方网页/Claude账号端的最终验收，需要部署者按第2–6节完成。
