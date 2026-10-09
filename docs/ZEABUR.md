# Zeabur：心潮 + 内置 OB 的 Docker 联合部署

本方案基于 main 新建的 `codex/zeabur-full-stack` 分支，运行仓库原版心潮 4.0 与内置 OB 2.6.5。改动集中在 Docker 构建、启动检查、Zeabur 模板与文档，不升级记忆业务逻辑，不接入现有 OB3.2，也不导入历史。

## 1. 部署后有哪些服务

| 服务 | 镜像构建文件（仓库根目录） | HTTP 端口 | 必须挂载的持久卷 | 公网用途 |
| --- | --- | --- | --- | --- |
| `ombre` | `Dockerfile.ombre` | 8000 | `/app/buckets` | 新 OB Dashboard，登录后管理/导出 |
| `xinchao` | `Dockerfile`（仓库根目录默认构建） | 18110 | `/app/state` | 心潮 API、可视化连接、MCP/OAuth |

心潮通过新 OB 的内网地址 `/mcp` 和独立内部令牌调用记忆。两个卷不共享，不挂载旧生产卷。新实例首启为空库。`bridge/` 是可选的用户本地 Runtime Bridge，不是云端第三个常驻服务；公开可视化前端仍使用 `https://xinchaomind.uk`，此仓库没有把该网站完整打包进镜像。

Zeabur不直接部署Compose YAML。本仓库的 `zeabur-template.yaml` 一次创建两个 Git/Docker 服务、卷、域名、变量和启动依赖；`compose.zeabur.yaml` 仅供本地Docker验收。

Zeabur 的构建探测（zbpack）只把构建根目录下名为 `Dockerfile` 的文件当成 Docker 项目；根目录没有标准 `Dockerfile` 时，服务名不匹配、也没指定路径的部署会**回退成 static**，被识别成静态 H5。本分支把心潮构建放在根目录 `Dockerfile`，网页控制台直接从 GitHub 部署也能探测到 Docker；OB 用 `Dockerfile.ombre`，由 `zbpack.ombre.json` / `ZBPACK_DOCKERFILE_PATH` 指定；`zbpack.xinchao.json` 让命名为 `xinchao` 的服务指向根 `Dockerfile`。[官方 Dockerfile 说明](https://zeabur.com/docs/en-US/deploy/methods/dockerfile)

## 2. 一次创建完整项目

### 准备

1. 在 Zeabur 授权 GitHub App 访问 `Jasonchang6435/xinchao-nian`。选择新项目和新域名，与旧生产OB分开。
2. 本机安装Git、Node.js（运行Zeabur CLI）。克隆这条分支；不要使用旧的 `codex/zeabur-external-ob` 分支。
3. 准备OpenAI兼容模型API的基础地址、Key与非推理模型名称。模板将其用于心潮模型和OB压缩模型。向量模型另外配置。
4. 分别执行 `openssl rand -hex 32` 五次，生成五个不同的64位随机值，妥善保存。它们分别用于OB内部令牌、心潮内部令牌、OB管理密码、网页口令、OAuth授权口令。不要把真实Key/密码提交到仓库或聊天。

### 一个部署命令

```bash
git clone --branch codex/zeabur-full-stack https://github.com/Jasonchang6435/xinchao-nian.git
cd xinchao-nian
npx zeabur@latest auth login
npx zeabur@latest template deploy -f zeabur-template.yaml
```

按CLI提示选择**新项目**并输入模板变量。域名提示若要求前缀，输入例如 `my-xinchao-new` 与 `my-ob-new`，Zeabur生成 `.zeabur.app` 域名；不要在前缀输入框填 `https://`。心潮的 `OAUTH_PUBLIC_BASE_URL`、`DASHBOARD_PUBLIC_BASE_URL` 用 `${ZEABUR_WEB_DOMAIN}` 自动取实际绑定的完整域名；部署后核对它们是 `https://你的实际域名`。注意 `PUBLIC_DOMAIN` 变量本身只有前缀（官方文档明确 `https://${PUBLIC_DOMAIN}` 会得到 `https://myapp` 这种不完整URL），不要拿它拼公开地址。

模板使用官方当前Schema的Git源结构 `spec.source.source=GITHUB`、数字 `repo=1410500658`，绑定本分支。不同仓库或新的fork需要修改两处repo ID和branch。模板会创建新资源，**不要把这条命令用于旧OB项目**。

这是“准备变量后，一个命令创建完整项目”；仓库未发布Zeabur模板市场代码，因此README没有虚构Deploy按钮。需要网页按钮时，可在自己Zeabur账号的模板页面导入该YAML并完成发布，取得真实模板链接后再添加按钮。模板创建与发布不等于GitHub分支合并。

CLI命令依据：[Zeabur官方CLI实现](https://github.com/zeabur/cli/blob/main/internal/cmd/template/deploy/deploy.go)。本地校验不会调用这个部署命令。

### 模板变量

| 变量 | 要填的内容 | 谁使用 |
| --- | --- | --- |
| `PUBLIC_DOMAIN` | 新心潮域名，按界面要求填写 | 心潮公开URL与域名绑定 |
| `OB_DOMAIN` | 新OB管理域名 | 新OB Dashboard |
| `OMBRE_MCP_SERVICE_TOKEN` | 随机值1，至少32字符 | OB鉴权；映射成心潮 `OMBRE_MCP_TOKEN` |
| `DYNAMIC_MIND_TOKEN` | 随机值2，至少32字符 | 映射成心潮 `SERVICE_TOKEN`；保留原compose反向调用配置 |
| `OMBRE_DASHBOARD_PASSWORD` | 随机值3，至少16字符 | 新OB Dashboard登录 |
| `DASHBOARD_ACCESS_TOKEN` | 随机值4，至少32字符 | 公开可视化网页的连接口令 |
| `OAUTH_APPROVAL_TOKEN` | 随机值5，至少16字符 | 开启MCP后授权页使用 |
| `MODEL_BASE_URL` | 供应商OpenAI兼容HTTPS基础地址，通常含 `/v1` | 心潮模型与OB压缩 |
| `MODEL_NAME` | 供应商实际存在的非推理模型名称 | 心潮模型与OB压缩 |
| `MODEL_API_KEY` | 供应商Key | 两个新服务的模型调用 |

示例地址与模型名称只是配置格式示例，应按自己的供应商填写。向量化尚未配置时，不能将关键词召回验收当作语义检索验收。

## 3. 自动托管与手工部署备用方式

模板创建的是两个Git服务，之后它们监视此分支对应路径变化；Zeabur收到GitHub事件后按Dockerfile重建。先在测试实例验证再推送部署分支。若使用自己的fork、关掉自动部署或改了branch/watchPaths，要在Zeabur同步调整。PR合并不会自动把已有服务从本分支切到main。

若模板导入受到平台版本或权限限制，可在同一新项目手工建两个Git服务：

1. 两个服务都选择本仓库、分支 `codex/zeabur-full-stack`，Root Directory留空（仓库根目录）。不要选 `xinchao/` 或 `ombre-brain/` 子目录，因为新Dockerfile使用根目录COPY路径。
2. 服务命名为 `ombre`：根目录 `zbpack.ombre.json` 会让zbpack选中 `Dockerfile.ombre`；再设置 `ZBPACK_DOCKERFILE_PATH=Dockerfile.ombre` 双保险，端口8000，卷挂 `/app/buckets`，健康检查 `/health`。
3. 服务命名为 `xinchao`：根目录 `Dockerfile` 是默认构建，`zbpack.xinchao.json` 也指向它；再设置 `ZBPACK_DOCKERFILE_PATH=Dockerfile` 双保险，端口18110，卷挂 `/app/state`，健康检查 `/health`。
4. 按两个 `.env.example` 设置环境变量。例子里的 `REPLACE_...` 必须替换。不要上传本地 `.env` 文件。
5. 将心潮 `OMBRE_MCP_URL` 改成 `http://新OB实际内网主机名:8000/mcp`；将其 `OMBRE_MCP_TOKEN` 填成OB的 `OMBRE_MCP_SERVICE_TOKEN`。
6. 心潮 `SERVICE_TOKEN` 与OB的 `DYNAMIC_MIND_TOKEN` 相同；若保留反向地址配置，填 `http://心潮实际内网主机名:18110`。当前内置OB源码未实现该环境变量的完整反向状态读取，不能据此声称已实现双向业务闭环。
7. 绑定两个新HTTPS域名；心潮的 `OAUTH_PUBLIC_BASE_URL`、`DASHBOARD_PUBLIC_BASE_URL` 填 `https://实际心潮域名`（手工建服务不走模板替换，直接填完整域名最稳），不带 `/mcp` 后缀。部署时确认环境变量引用已经解析。

如果某个Git服务已经建好、却显示为静态（static）站点：通常是zbpack没有选中项目里的Dockerfile。把该服务补上 `ZBPACK_DOCKERFILE_PATH`（心潮用 `Dockerfile`，OB 用 `Dockerfile.ombre`），然后重新部署（Redeploy）即可，不必重建项目。

网页控制台直接从 GitHub 部署单服务：Root Directory 留空、分支选 `codex/zeabur-full-stack`，根目录 `Dockerfile` 会让探测识别为 Docker，默认构建心潮（端口 18110，卷 `/app/state`，健康检查 `/health`）。若这个单服务要构建 OB，设置 `ZBPACK_DOCKERFILE_PATH=Dockerfile.ombre`、端口 8000、卷 `/app/buckets`。完整双服务部署仍用模板。

单服务不会自动带环境变量，至少要在服务的 Variables 里设置 `SERVICE_TOKEN`（`openssl rand -hex 32`，≥32字符，不能是 `replace-with...` 占位值），否则容器启动即报 `SERVICE_TOKEN is required` 退出。要开公开可视化再加 `DASHBOARD_ENABLED=true`、`DASHBOARD_ACCESS_TOKEN`（另一个独立的≥32字符随机值）、`DASHBOARD_PUBLIC_BASE_URL=https://实际心潮域名`、`DASHBOARD_ALLOWED_ORIGINS=https://xinchaomind.uk`；接 OB 的变量按 `deploy/zeabur/xinchao.env.example` 配。

模板通过两服务暴露的 `OB_INTERNAL_HOST` / `XINCHAO_INTERNAL_HOST` 和 `${CONTAINER_HOSTNAME}` 配置内网地址。实际内网主机名以Zeabur“网络→私有”显示为准；重命名服务不一定改变主机名。[官方内网说明](https://zeabur.com/docs/en-US/deploy/networking/private-networking)

## 4. 首次默认状态与合成验收

模板默认：

```env
MCP_ENABLED=false
OAUTH_ENABLED=false
OMBRE_READ_ENABLED=true
CONTEXT_OMBRE_ENABLED=true
OMBRE_WRITE_ENABLED=false
SHADOW_MODE=true
DASHBOARD_INCLUDE_PRIVATE_TEXT=false
ATTENTION_ENABLED=false
XINCHAO_BOARD_TOKEN=
```

首先检查两个 `/health` 返回成功，登录新OB Dashboard；核对新卷和空库。健康检查是进程存活检查，不代表所有心潮业务或模型配置都已通过。首次没有记忆时星图为空属于正常。

本分支按原版运行，**没有DRYRUN路由**。`OMBRE_WRITE_ENABLED=false` 和 `SHADOW_MODE=true` 禁止部分内部自动记忆写入，**不是整个原版网关的写入权限开关**。默认关闭心潮MCP可以避免尚未验收时开放AI记忆工具；OB管理员仍可以通过其Dashboard进行授权写入。

只在新空库/合成数据上开始工具链验收：

```env
MCP_ENABLED=true
OAUTH_ENABLED=true
```

重部署心潮后，测试手工创建、召回、星图和导出恢复。即使保持 `OMBRE_WRITE_ENABLED=false`，Claude经原版网关的 `hold/grow/trace` 等仍可能实际写入新OB。测试期间不要导入私人真实历史；线上全面禁写需要另一个经过验收的服务端权限改造，不能靠隐藏工具或提示词保证。

自动内部写入全流程在合成验收阶段另开：

```env
OMBRE_WRITE_ENABLED=true
SHADOW_MODE=false
```

这些开关不会修改旧OB；新服务只能连接自己的内网OB。自动功能是否可用需同时满足第8节已知限制与模型验收。

## 5. 接公开可视化与Claude

**可视化**：打开 `https://xinchaomind.uk`，选择公网实例，地址填 `https://你的新心潮域名`，口令填 `DASHBOARD_ACCESS_TOKEN`。不加 `/mcp` 或 `/dashboard`。这会把连接交给该公开前端，使用前理解它的凭据与访问边界；本改造未验证私人账号线上网页流程。

**Claude**：开启MCP/OAuth之后，添加自定义连接器，URL填 `https://你的新心潮域名/mcp`。在“心潮念”授权页输入 `OAUTH_APPROVAL_TOKEN`。授权页若显示“Ombre Brain”，说明连接到了OB管理域名，需纠正。

`OAUTH_PUBLIC_BASE_URL` 必须使用HTTPS，原版OAuth启动会拒绝HTTP，连localhost也不例外。内部Docker测试可以使用HTTPS资源标识并在私网直接HTTP请求，真实Claude连接必须有实际可访问的公网HTTPS。

五类口令各有用途；不要把 `SERVICE_TOKEN`、OB内部令牌或OB管理密码交给公开可视化网页。Runtime Bridge、Bark与手机注意力监测按原文档单独启用，初始模板不打开它们。

## 6. 卷、权限、配置与备份

- 新心潮入口只为 `/app/state` 挂载根目录设置owner/mode，随后降权至UID1000运行，私有新文件受 `umask 077` 保护；不递归修改已有文件。恢复卷内旧文件如果属于错误用户，须先核对备份再修权限，不能直接改整个卷。
- OB配置保存在 `/app/buckets/config.yaml`。只挂目录 `/app/buckets`，不要把目录误挂到config文件路径。新入口遇到配置路径为目录或符号链接时拒绝启动，保留内容。
- OB沿用原版持久化代码bootstrap：`_app`等也在卷内。镜像更新与Dashboard热更新可能影响实际运行代码，升级前记录版本；不要用“容器换了”推断一定回到某个版本。
- 心潮配置模板随镜像放在 `/app/configs`；私人规则文件不进入构建上下文。要自定义规则，通过Zeabur配置文件挂载到 `INTERACTION_RULES_PATH` / `ATTENTION_RULES_PATH` 指定位置，并备份原文件；不要把卷覆盖整个 `/app`。
- 两个服务各运行一个副本；状态文件、授权与OB文件库不按多副本并发共享设计。
- 内置OB普通逻辑导出不覆盖心潮卷、所有媒体或3.2来源证据。应分别备份两个卷以及环境变量和私人规则。卷备份通常不包含仓库代码，要另外记录Git提交和镜像。
- Zeabur对普通文件卷的完整平台备份要求暂停服务。测试新服务可在受控静默窗口备份；旧生产服务不由本部署操作暂停。保持不停的逻辑导出不可冒充原子完整卷备份。[官方备份说明](https://zeabur.com/docs/zh-CN/operations/data/backup-restore)
- 回退代码不会撤销已发生的写入。不要删除卷、执行 `down -v` 或拿过时备份覆盖真实试用数据；数据回退前先保全新增并对账。

## 7. 本地复现

```bash
cp deploy/zeabur/ombre.env.example deploy/zeabur/ombre.env
cp deploy/zeabur/xinchao.env.example deploy/zeabur/xinchao.env
# 编辑两份文件：随机口令互相匹配，其余口令各自独立。
docker compose -f compose.zeabur.yaml up -d --build
```

本地绑定端口只开放在127.0.0.1，健康地址分别为 `http://127.0.0.1:18001/health` 与 `http://127.0.0.1:18110/health`。要测试真实OAuth，需自己的HTTPS反代或隧道；保持OAuth关闭时可先做Dashboard和基础空库验收。

自动隔离验收：先构建两个镜像，然后运行脚本。脚本仅创建新的合成数据资源，不读取两份用户env、不访问旧服务、不发布主机端口；结束时删除它自己创建的容器/卷/网络，将合成证据与快照保留在输出目录。

```bash
docker build -f Dockerfile -t xinchao-zeabur-heart:20261009 .
docker build -f Dockerfile.ombre -t xinchao-zeabur-ombre:20261009 .
python3 deploy/zeabur/smoke-docker.py --output /tmp/xinchao-lab-new
```

同一组检查已加入 `.github/workflows/zeabur-docker.yml`；GitHub Actions只上传脱敏的evidence.json，不上传随机凭据、OAuth授权、记忆快照或导出包。

输出目录必须为尚不存在的绝对路径。日志、合成OAuth授权、快照与导出只保存在该私人目录。此脚本验收容器重建持久化和逻辑导出，不等于整卷备份恢复或生产历史迁移验收。

## 8. 已知限制与验收边界

容器化适配不填补原版业务缺口：心潮原版调用 `breath_advanced`，内置OB未公开这个工具；日间自动浮现、念头和远期材料可能受影响。此次保持两个业务目录源码不变，需另行功能修复与专项验收，不能因健康成功就宣称完整业务全部通过。

内置OB未完整实现原OB3.2的原文来源、引用、自我候选见证与人类锁权限。历史迁移仍须预检、转换、隔离保全和对账；本模板不提供自动同步或迁移，不要直接导入3.2私有包然后开放锁信读取。

共享文件心跳路径未在Zeabur两服务之间挂载，原版本地文件心跳通道不据此验收；正常API/客户端交互仍按原版记录。需要该通道时另设计接口方案，不能假定两个独立卷共享文件。

本地通过的项目及镜像摘要见 [验收记录](zeabur/验收记录.md)。Zeabur账号的模板实际创建、域名变量解析、HTTPS、公开网页与Claude实际账号仍需上线验收。此分支未部署旧或新生产服务。
