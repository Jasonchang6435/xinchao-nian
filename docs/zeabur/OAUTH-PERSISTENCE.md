# Claude 授权后要求重新连接：Zeabur 持久化检查

`OAUTH_APPROVAL_TOKEN` 是心潮授权页的批准口令；它不是 Claude 每次调用 MCP 使用的访问令牌。默认访问令牌有效期是 86400 秒，刷新令牌有效期是 31536000 秒。不要用延长有效期、关闭认证解决授权记录丢失。

## 必须先挂平台卷，再进行授权

在 Zeabur **心潮服务 → 硬盘**中确认存在 `state`，挂载目录为 `/app/state`。Dockerfile 的 `VOLUME` 声明和容器内出现这个挂载点，都不能替代 Zeabur 硬盘页上的实际持久化配置。手工从 GitHub 部署单服务时，要单独添加卷；模板已声明该卷。

以下默认文件必须位于这同一个卷内：

| 文件 | 内容 |
| --- | --- |
| `oauth.json` | OAuth 客户端登记、访问令牌和刷新令牌的哈希记录 |
| `state.json` | 心潮运行状态 |
| `transitions.jsonl` | 状态变化记录 |
| `black-box.json` | 黑匣子 |
| `cabin.json` | 小屋与账本 |
| `personality.json`、`bridge-queue.json` | 启用相关功能时产生的状态 |

新 OB 则挂独立卷 `/app/buckets`；不能拿它替代心潮卷。不要把两个服务的卷混用。[Zeabur 卷文档](https://zeabur.com/docs/en-US/operations/data/volumes)

## 已运行但没有挂卷时

首次挂载新卷会遮盖原目录并重启服务。先停止人工使用该心潮，在线导出整个 `/app/state`，校验全部文件与哈希，再挂卷并恢复；在线稳定文件导出不等于暂停服务后的原子卷备份。不要删除卷或拿过时备份覆盖新增状态。

恢复文件应属于 UID/GID `1000:1000`，权限为 `0600`，目录权限为 `0700`。Zeabur 远程 exec 可能以 root 执行，即使服务主进程以 UID1000 运行；只设置文件权限而未设置所有者，会导致重启后 `EACCES`。

本分支入口在降权之前，仅修复 `/app/state` 内上述已知普通状态文件的 root 所有者，保留文件内容；不递归调整其他文件，不修改其他所有者，拒绝符号链接和硬链接。恢复脚本仍应主动设置正确所有者。

恢复后重启心潮，重新核对文件哈希、状态 revision、OAuth 元数据、网页与记忆连接。新旧 OB 无需为此重启。若授权记录在之前重启中已经丢失，它们无法仅靠恢复空文件重建，Claude 需要重新授权。

## Claude 配置与验收

- MCP URL：`https://你的心潮域名/mcp`。
- `OAUTH_PUBLIC_BASE_URL`：`https://你的心潮域名`，不带 `/mcp`。
- 授权页输入 `OAUTH_APPROVAL_TOKEN`；不要把它填成 OAuth client secret 或请求头访问令牌。
- 重新授权后，检查 `oauth_client_registered`、`oauth_authorization_approved`、`oauth_token_issued` 与 `mcp_request` 的成功记录。
- 如果重新连接显示 `unknown client_id`，移除旧连接器后以相同 MCP URL 新建，重新进行动态注册和授权。当前服务使用公开客户端动态注册与 PKCE。
- 检查授权状态文件存在并属于 UID1000；后续在受控窗口重启心潮，验证同一连接继续有效，并检查 `oauth_token_refreshed`。
- 一小时真实 Claude 会话测试和长期稳定性，需要实际连接器重新授权后观察；本地 Docker 测试不能代替这一项。

Claude 自定义连接器说明：[官方帮助](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)。
