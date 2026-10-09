# 隔离 Docker 风险实验

`run.py`启动真实OB和心潮服务，provider只是可复现的模型API fixture及TLS代理，不模拟OB数据库或工具实现。内部网络无发布端口，容器/网络随机命名，脚本只清理本次创建的资源；输出目录必须是新目录，包含私人测试密钥和备份，不能提交。

## 镜像与复现

先从固定提交 `6f7335d01c43f79a82d5ec999ec3c517f6b9c8a5` 获取独立 `Jasonchang6435/Ombre-Brain`，在该源码根目录按官方Dockerfile构建，并标记 `xinchao-risk-ob32:6f7335d`。心潮在本仓库根目录执行：

```bash
docker build -t xinchao-external-ob:dev .
python3 tools/lab/run.py --output /private/tmp/NEW-xinchao-risk-run
```

本机Docker网络曾下载不完整PyPI文件，导致hash校验失败；没有关闭锁文件校验。实验实际使用host从官方PyPI获取同版本包、逐个验证官方SHA/大小，再在OB构建中离线安装，仍使用原 `requirements.lock.txt --require-hashes`；源码不改。依赖证据在 `docs/evidence/dependency-downloads.json`。这是实验下载路径，不是心潮镜像或生产OB升级要求。正常网络可直接按官方Dockerfile构建，实际镜像摘要可能因base镜像/时间不同而变化。

旧源码比较：在本repo `ombre-brain` 目录，执行 `docker build -f ../tools/lab/Dockerfile.legacy -t xinchao-risk-ob265:vendored .`，再从根目录执行：

```bash
python3 tools/lab/run.py --ob-image xinchao-risk-ob265:vendored --legacy --output /private/tmp/NEW-xinchao-legacy-run
```

旧源码共用3.2的已验证依赖底座；不是精确重建所有旧依赖。它仅是回归参考，不用于新Zeabur正式部署。

## 流程与证据

默认DRYRUN测试目标；先关闭测试写入验证网关门禁，之后仅在实验env里打开TEST写入。预置合成历史核心、正式I、人类锁信、source证据、附件；做三轮读写，服务间重启，第2轮后SIGKILL，第三轮继续验证。停掉两个**实验**服务才做完整目录快照并恢复到新目录，SQLite integrity_check后启动；最后恢复基线到另一组新目录，验证回退。

同时在OB仍运行时GET逻辑ZIP，`logical_restore.py`用真实3.2官方reader验证manifest、source闭包、content-address、SQLite，逐字恢复到新卷，新config/新OAuth后启动并对账数量。不会导入压缩模型。

`evidence.json`只记录检查名、计数和镜像，不含凭据/正文，可分享。`*.private.log`、env、cert.key、卷和快照含私有数据，不可分享；不要把源码中provider公开部署。该脚本内的宽Docker网段可信代理设置只用于随机内部网络实验，不是生产配置建议。

这是存储、协议和恢复测试，不证明线上Zeabur、Claude/网页UI、生产真实数据或模型推理质量。正式步骤见 `docs/ZEABUR-EXTERNAL-OB.md`。
