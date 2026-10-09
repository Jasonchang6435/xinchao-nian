# OB2.6 → OB3.2 桥接兼容性、数据安全与恢复报告

日期：2026-10-09。目标：保留现有独立 OB3.2 的运行与历史，在新心潮服务增加动态心智、Dashboard 与 MCP/OAuth 网关。生产零部署变更；先在线逻辑备份与私有恢复，再允许切换真实写入。

## 1. 结论与基线

可以桥接，且不需要把历史搬进心潮。记忆仍由原 OB 保存，心潮只保存动态状态与自己的授权。**不能宣称 OB2.6 与 OB3.2 所有行为逐项等效**：工具拓扑、自动候选门禁、自我认知沉淀、锁信权限、原文证据及召回输出格式均有变化。适配必须保留3.2的数据约束，而不是只让调用“不报错”。

本地使用两组真实源码：

| 对象 | 固定基线 | 说明 |
|---|---|---|
| 原 OB | `Jasonchang6435/Ombre-Brain`，`6f7335d01c43f79a82d5ec999ec3c517f6b9c8a5`，VERSION3.2.0 | 真实服务、真实 Markdown/SQLite/原文存储及 OAuth |
| 心潮改造基础 | `Jasonchang6435/xinchao-nian`，main基线 `a38a0a3241b0d3928d4a452ea1a38cf7efa14cd3` | 4.0.0心潮；改造在 `codex/zeabur-external-ob` |
| 旧 OB 基线 | 上述心潮基线中 `ombre-brain/`，VERSION2.6.5 | 已改造的附带源码，不代表所有上游2.6分支 |

心潮源码亦有对更新版本 `advanced`、`with_ids` 的假设，不能仅凭附带 VERSION 把所有心潮逻辑归为2.6。正式部署前应核对正在运行的 OB 构建提交；README 的版本不能证明生产镜像一致。

旧源码实验使用同一已校验 Python 依赖底座，其 MCP SDK 版本1.28.1相同；部分其他依赖版本与旧 lock 不同。因此它证明旧**源码行为**差异，不代表完整旧发行版依赖组合认证。

## 2. 心潮相对独立 OB 增加的关键技术

OB 负责记忆事实与生命周期。心潮新增持续状态引擎：11维驱力、情绪底色/起因、慢变性格、事件去重、睡眠与时间结算。情绪 V/A 与 OB 记忆坐标相接，召回推动心潮，心潮再影响召回排序；不能替代保存记忆前的明确选择。

短态通过 xinchao_context、xinchao_event 与“此刻”块进入 AI 窗口；长期记忆仍走 OB hold/grow/breath/trace。黑匣子保存尚未选择长期保留的产出，keep 才向 OB 写入。I 的确认用于自我觉察；小屋、信件、思绪池、梦境与桥接组成可选闭环。

新增公开 Dashboard 授权面与远程 MCP/OAuth 网关，将网页的人类权限和 AI 的记忆权限分开。Runtime Bridge、Bark和自主模型调用是另外的运行组件，远程 Claude Connector 本身不会提供后台模型或主动注入能力。

独立部署改造只构建心潮，使用外部 OB3.2 适配器；不复制原历史、不启动附带 OB、不在生产执行 schema 迁移。

## 3. 接口与语义对照

| 能力 | 附带2.6.5源码 | 原3.2源码/实测 | 当前适配与边界 |
|---|---|---|---|
| MCP拓扑 | 分组工具回灌统一 `/mcp`，`/mcp-extra` 不暴露 | 主 `/mcp` 与信件 `/mcp-extra` | 两个协议会话，共享同一授权；不是共享 Session-ID |
| hold | 明确选择后保存；auto另有候选判断 | 原文保存；支持title/domain、quotes、source证据 | 手动透传；内部source记录为why_remembered |
| auto=true | 首次纯技术候选会拒绝/暂缓，另有候选账本 | 无相同 auto/source 参数与旧候选门禁 | 未知自动产出明确拒绝，不删除参数后擅自落库；匣子keep需明确选择 |
| grow | 摘取/分段、旧返回格式 | 支持显式items和批次去重；新建项可能只返回标题 | 匣子单条keep改用hold可靠ID，不能把英文标题当ID；旧grow(source)明确拒绝静默改分段，需明确items；自然文本分段仍依赖真实模型验收 |
| 高级召回 | 无 breath_advanced 工具 | breath_advanced、breath_search等 | 去掉心潮内部mode/with_ids，保留3.2有效过滤；从真实响应解析ID |
| dream | 梦材料接口 | 材料输出含ID，且会记录I候选见证日期 | 写入关闭时拒绝dream；不能称纯读 |
| 梦境保存 | 旧auto候选策略可能不落盘 | hold后trace隐藏；两次调用非原子事务 | 默认禁止自动梦落盘；opt-in后以可靠ID设置dont_surface，部分失败保留ID并禁止盲重试 |
| dont_surface | 旧浮现过滤 | 限制自动浮现/梦材料；显式检索可命中、目录可展示元数据 | 不能作为隐私或权限开关；锁信单独按可信调用方授权 |
| I | 新写条目直接type=i | 新写先dynamic候选，经多个独立日期梦见证沉淀；可显式promote | 保留新候选语义及旧正式I，不为追求旧行为自动promote；多日最终沉淀尚未实测 |
| forget / restore | id、reason；软删移归档，restore恢复 | trace(delete/delete_reason/restore) | 兼容id/bucket_id；冲突别名拒绝；删除理由保留；不代理purge |
| trace覆盖/物理删除 | 旧工具体系 | hard_delete、正文/meaning/media替换与补丁 | 默认禁止高风险替换/物理删除并从工具schema隐藏；普通write开关不会解锁 |
| 原话/证据 | 旧格式/能力不同 | quotes最多3句、每句100字；source_content/ranges进入不可变_sources | 透传并验证保存与恢复；超限拒绝，不能靠截断“通过” |
| 锁信 | 旧信件能力 | AI与人类可信入口及锁所有者约束 | AI MCP不借人类cookie；不能冒充人类创建锁信；人类预览也遵守对方锁 |
| 星图/预览 | 心潮期待sidecar结构化路由 | 人类Dashboard列表与桶详情；MCP pulse另一路 | 人类凭据另登录；最多7行；无凭据回退pulse且无正文预览 |
| OAuth | 授权码、PKCE、刷新 | 资源绑定、令牌轮换 | 串行刷新、权限600私有持久化，主/extra共享grant，测试/正式文件分开 |
| 失败重试 | HTTP失败可能来自会话失效 | 写入后响应丢失仍可能已成功 | 不因超时、断连或含糊400重放写；404失效会话可重建；401先拒绝执行才刷新 |

旧 Dashboard 的 `content` 展示会去掉wiki双括号，实验确认归档原文件仍保留 `[[链接]]`。因此读接口展示文本与磁盘原文必须分别比较，不能把渲染差异误判为数据丢失。

相关源码：[OB入口](https://github.com/Jasonchang6435/Ombre-Brain/blob/6f7335d01c43f79a82d5ec999ec3c517f6b9c8a5/src/server.py)、[原文及备份](https://github.com/Jasonchang6435/Ombre-Brain/blob/6f7335d01c43f79a82d5ec999ec3c517f6b9c8a5/src/ombrebrain/storage/backup_archive.py)、[信件锁](https://github.com/Jasonchang6435/Ombre-Brain/blob/6f7335d01c43f79a82d5ec999ec3c517f6b9c8a5/src/tools/plan/core.py)。

## 4. 3.2新能力如何用于心潮

已接入/实测：高级召回过滤及原话查询、hold/grow原文证据、候选I、软删恢复、信件读写与锁权限、结构化星图、AI权限材料解析及轮换授权。目录可用于先看结构再精确查询；quotes用于回忆原话，sources用于证据追溯，二者不应塞进所有自动浮现。

后续可扩展：在心潮keep时由本人选择附带来源原文/ranges/quotes；显示候选沉淀进度；对导出副本展示原文证据链；增加无改写的保存预览与人工审阅。当前keep仍只保存产出及来源关系，不能宣称已自动保存所有原始对话。

未接入AI网关：管理页维护/调试接口、物理purge、任意文件访问。它们没有自然落到心潮工具的需求，不因“API新增”就向AI开放。

## 5. 默认测试模式与不可跨越的写入门禁

`DRYRUN=true`（含True/1）默认选 `OMBRE_TEST_*` 全套端点、token、OAuth和Dashboard凭据；`false/0`选 `OMBRE_*`。其他拼写拒绝。测试字段缺失不借正式字段。配置同时检查测试与已配置正式URL是否同源，以及测试/正式状态文件是否归一化后同一文件。

同源检查不是网络隔离证明：两个域名仍可能指向同一生产服务/卷。部署者必须用两个真实服务和独立卷，核对 Zeabur 资源身份。

测试心潮状态默认在 `/app/state/test/*`；正式在 `/app/state/*`。测试与正式的匣子、性格、时间线、OAuth、Bridge、小屋不共用。切换时Claude重新授权；正式三个访问密钥应重新生成，避免测试参与者保留访问历史的权限。

普通写入分别由 TEST/正式WRITE_ENABLED 控制，自动梦境落盘和危险替换另有独立开关。网关既隐藏写工具，也在调用时拒绝；后台keep/I确认/梦落盘同样检查。只读OB3.2额外拒绝dream的I见证副作用。

心潮自身仍保存事件/状态，所以“关闭写入”在本文指关闭心潮向所选OB的显式记忆写入。breath等读取可能更新激活计数、足迹或到期信件锁。若要求原OB文件字节毫无变化，生产验收只能做initialize/tools/list，内容验证必须用私有恢复副本。

## 6. 风险、措施与剩余限制

| 风险 | 具体触发 | 已实施措施 | 仍需验收 |
|---|---|---|---|
| 测试误写生产 | URL、凭据或卷复用；DRYRUN拼错 | 默认隔离路由、严格值检查、origin/file别名拒绝、双写开关 | Zeabur资源身份；不同域名不能代替独立卷 |
| 自动产出污染事实 | 删除旧auto后直接hold；梦回流 | 未知自动产出拒绝；梦落盘默认关、dont_surface验证 | dont_surface不限制显式检索；模型内容仍需审阅 |
| 接口“成功”但保存失败 | OB部分校验返回错误文字而非isError | keep/梦须可靠ID；不盲重试；超限测试验证无新桶 | 通用OB工具仍会返回原文错误信息，客户端须读结果与回查 |
| 正文覆盖/物理删除 | trace补丁、替换、hard_delete | 默认阻断、schema隐藏、purge不代理 | 开危险开关前需新的完整恢复点与单独审阅 |
| 合并/分段错误 | 模型误判同一事件或摘要 | 保存原文/不可变来源；批次去重、并发测试 | fixture不证明真实模型质量；自然文本grow须线上实测 |
| 部分事务 | 梦已hold而trace失败；keep已写而来源关联失败 | 错误保留目标ID，不重放hold | 不能把多调用称为原子事务，需按ID修复 |
| 重试重复写 | OB落盘后网络响应丢失 | 真实掉响应注入验证仅1次请求且1条正文 | 用户/Claude主动再次调用仍需先查询确认 |
| 锁信泄露 | 人类cookie借给AI，作者字符串冒充身份 | 权限路径分离、锁预览拒绝、冒充锁信被拒绝 | 正式数据旧锁字段异常需在恢复副本审计 |
| 备份遗漏/跨时点 | 误以ZIP等于整个卷 | 在线逻辑与离线全卷明确分层、manifest/哈希/DB/source闭包 | 原OB不停，尚无全卷同一时点恢复点 |
| 回退丢新记忆 | 旧备份覆盖当前库 | 只恢复新目录，保留事故后差异与备份 | 备份后正常新增须逐条对账，不能一键抹掉 |
| 凭据失效 | 恢复旧心潮刷新令牌，对应OB已轮换 | 成对实验恢复两边；正式重新授权 | 不恢复别人仍使用的生产OAuth数据库 |
| 多实例写坏状态 | 多个心潮副本共用文件卷 | 单实例要求、原子状态写入 | 水平扩容需另改数据库/锁，不在本次范围 |

本轮修复了此前Mock不易发现的风险：旧id/reason映射、auto候选门禁缺失、危险trace默认暴露，以及“dream是纯读”的错误假设。实验也修正了测试夹具路径和Dashboard渲染预期；这些失败没有用跳过断言来掩盖。

## 7. 原OB不停服的备份层

第一层：原OB登录后 `GET /api/export`。真实3.2代码包含Markdown（活跃和归档）、`sources/*.source`、一致SQLite快照、export_meta和backup_manifest。校验清单逐文件大小/SHA，来源闭包避免悬空证据；SQLite采用在线backup API。

不包含配置、OAuth、附件 `_media`、部署镜像、心潮状态。Markdown逐文件读取，不能保证所有文件都来自同一时刻；原OB维护任务、旧客户端仍可同时写。记录导出时间、原服务版本、文件数/ID/哈希，重复导出可对账，但哈希一致性不等于完整卷原子快照。

恢复到私有新实例：严格验证manifest及安全路径，逐字恢复MD和sources，检查SQLite，使用新config及新OAuth。实验脚本不压缩/重写原文，目标存在就拒绝。生产大包须遵守官方解压/迁移的条目、容量和空闲空间限制；不要用不受限的zip extractall。

第二层：将配置、Variables、镜像提交/摘要和附件单独私下保管，列明缺口。运行中复制SQLite文件或整卷tar都不能替代一致备份。

第三层：以后如需完整文件卷恢复点，选维护窗口停止所有写入者后做全卷备份。当前按用户决定不执行。Zeabur官方要求文件卷服务先暂停，备份只包括持久卷，不包括镜像代码；应另保管部署版本。[Zeabur备份说明](https://zeabur.com/docs/zh-CN/operations/data/backup-restore)。

## 8. 完整目录工具与本地恢复验证

提供 `tools/vault_snapshot.py`：只能在停掉全部写入者后用 `--quiesced` 创建。它会逐文件记录大小、SHA、mtime、权限，源目录发生变化则拒绝；拒绝symlink/特殊文件。压缩包与独立receipt均权限600，恢复前核验外部SHA与成员清单，只允许恢复到不存在的新目录，解压后再验哈希。receipt需要另存受信任副本，内置manifest不是防伪签名。

```bash
python3 tools/vault_snapshot.py create /private/test-ob-vault /private/backups/ob.tar.gz --quiesced
python3 tools/vault_snapshot.py verify /private/backups/ob.tar.gz --receipt /private/backups/ob.tar.gz.receipt.json
python3 tools/vault_snapshot.py restore /private/backups/ob.tar.gz /private/NEW-restored-vault --receipt /private/backups/ob.tar.gz.receipt.json
```

这些命令示范**已停止的测试卷或离线副本**，不可对运行中的生产卷套用。工具保留文件权限，不保留跨平台UID/GID，启动恢复容器前须处理正确属主。完整新心潮卷包含state、OAuth、cabin、personality、journal和黑匣子；黑匣子虽然不进Dashboard，也属于完整灾备的数据，备份应按私人内容加密存放。不要公开完整实验目录中的私有日志、密钥、备份。

测试数据含历史核心/正式I/人类锁信、源证据、附件、配置，以及后续真实API生成的动态记忆。正常重启、一次SIGKILL后重新启动，再做后态与基线全目录快照；恢复到新目录后，实际两个SQLite数据库都执行integrity_check并重新启动。验证成对OAuth可用、历史原文、测试记忆及回退后仅剩原历史。在线逻辑ZIP另恢复到新OB/新心潮，以新授权启动并对账活跃数量。

## 9. 本轮证据与明确未完成项

自动测试：心潮 **201/201**；完整目录工具 **7/7**。真实OB3.2在隔离Docker内运行三轮，每轮13组检查；包含明确items、6个并发相同hold、原话/来源保真、历史I、锁权限、无损软删恢复、模型API故障、写后丢响应、实际心潮OAuth/MCP及星图。额外验证默认测试目标的只读门禁、在线导出恢复、两个DB完整性、故障重启、成对恢复与基线回退。

证据文件见 `docs/evidence/`；不是Mock替代真实OB。模型服务用本地确定性fixture以可重复测试存储与协议，未验证真实模型推理质量。所有实验新建随机容器/内部网络，无对外端口，使用合成数据；不访问gaoli生产、不读取生产历史。

当前尚未完成：真实Zeabur新服务部署、你的账号中公开网页与Claude的端到端验收、你的真实历史在线导出恢复、真实模型质量与连续多个日期的I沉淀。代码通过不代表这些已通过，也不承诺任意故障下绝对零损失。

正式开启真实写入前，按 [顺序部署手册](ZEABUR-EXTERNAL-OB.md) 完成这些项，记录验收时间、部署版本及导出校验值。保留真实写入关闭，直到操作者明确开启独立环境变量。
