# 启动、源码运行与节点加入

本仓库是当前项目的公开源码与素材交付，不包含原主机的私密配置、数据库、钱包、验证者密钥或虚拟机磁盘。下列“现有安装启动”和“新环境部署”是两种不同操作。

## 1. 已经安装的三节点环境

Windows 主机：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\card_endfiled\Start-Game.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\card_endfiled\Status-Game.ps1
```

浏览器打开 `http://localhost:8787`。主机启动器管理指定的两个 VMware Ubuntu、三个 Besu 节点、SSH 隧道、Windows PostgreSQL 和游戏服务。它依赖机器本地的 `game/deployment/local-host.json` 与已有目录，不能直接复制给陌生环境当通用安装器。公开参考副本在 `tools/existing-host/`，没有附带对应私密配置。

Ubuntu 的现有用户服务：

```bash
systemctl --user start talos-besu
systemctl --user status talos-besu --no-pager
# 原配置中负责索引的那台虚拟机额外执行：
systemctl --user start talos-indexer
```

Linux 浏览器访问同一 API 的本地隧道入口 `http://localhost:8787`。单独启动 Besu 不会启动 Windows 数据库，也不会自动创建网页隧道。正常停机优先运行 Windows `Stop-Game.ps1`，不要在进程运行时直接删除链目录。

## 2. 先导入完整美术

源码仓库包含 306 张 540×960 WebP 展示图、6 张 1080×1920 动态纹理与元数据。4K 和原始图在 GitHub Release 独立附件中。

1. 下载全部 `ta_kard-art-4k-*.zip` 到同一目录。它们是独立 ZIP，不是必须合并字节的分卷包。
2. 在仓库根目录运行 `python tools/import-art.py --archives "下载目录"`。
3. 运行 `python tools/verify-assets.py`，校验清单内的 SHA-256。native 原始图为可选，不影响对战运行。

完整 4K 资源必须放到 `game/assets/cards/4k/`。应用仅把同时存在 display/4k 的卡面标记为可用；缺少 4K 不应通过伪造文件绕过检查。前端仍只显示已持有且已有实际插画的卡面，不预览未解锁卡面。

网页中的 `/assets/` 静态请求由 API 提供。外部玩家通过原 API 的隧道打开网页时，也由原主机提供图片，**无需每个同步节点复制 5GB 素材**；若另建一套应用服务，则需要为那套服务导入素材。

## 3. 阅读、测试和编译源码

需要 Node.js 20+；推荐使用与项目匹配的 Node.js 24、pnpm 9。锁文件为 pnpm 格式。不要为了执行单元测试复制现有链的 private 目录。

```bash
cd game/deployment
corepack pnpm install --frozen-lockfile
npm test
npm run compile
npm run compile:battle
```

`npm test` 执行不广播交易的 `*.test.mjs`。`test/*.live.mjs`、`*integration.mjs` 和部署脚本会连接测试链，其中部分会发送交易，不能当作纯静态检查运行。

`build/` 随仓库附带当前 ABI、字节码和编译器说明。重新编译会覆盖对应构建文件；旧版合约在 versions 下独立归档。链上已部署实例不会因本地编译自动更新。

## 4. 在全新环境搭建自己的网络

这是开发者流程，不是加入原链的流程；不要在现有安装目录执行 `prepare.mjs` 或生成新创世文件。现有脚本包含 Windows/VMware 目录约定，需要按自己的环境配置。

1. 安装 Besu、匹配的 Java、Node.js、PostgreSQL。数据库推荐仅监听本机，原部署使用 5433。
2. 在独立工作副本运行 `node scripts/prepare.mjs`，生成新的私密配置与角色密钥。脚本遇到已有 private/config.json 会拒绝重建。
3. 用 Besu 的 QBFT 网络生成工具生成验证者配置，修改节点 IP、数据目录和端口；相关逻辑见 `scripts/configure-network.mjs`。三台必须使用完全相同的 genesis，节点私钥各不相同。
4. 配置并启动至少满足该网络法定人数的验证者。不要把同一 node key 复制成“多个节点”。RPC 保持回环监听，通过隧道供应用访问。
5. 创建应用数据库，并将连接信息写入 `private/config.json`。`schema.sql` 由服务初始化；`scripts/setup-db.mjs` 是原 Windows 目录专用参考，不能在未修改路径时直接用于其他系统。
6. 编译、部署 TalosCards → TalosCardItems → TalosBattle。脚本在 `scripts/deploy-*.mjs`。**deploy-items.mjs 带原网络创世哈希保护**，新链必须使用自己的 manifest/genesis，不能跳过校验继续混用。部署前给独立生成的管理地址分配测试 ETH。
7. 双版本部署先使用 `versions/battle-16/` 的编译产物发布 16 费，记录地址；再发布当前 20 费。把旧地址写入 `previousBattleContracts`，当前写入 `battleContract`。本仓库没有把整个新链流程封装成一键自动化；generic deploy-battle 脚本也不会自动替你保全所有版本，操作前自行归档。
8. 配置索引器的 `indexer-config.json`，token 与 API 的 indexerToken 一致，contracts 指向铸造和 ERC-721 地址。将 API/RPC 的访问隧道设置好。
9. 在 `game/deployment` 运行 `npm start`；在索引器配置所在工作目录启动 `node indexer.mjs`。原 API 固定接受 localhost:8787 的 Host/Origin；使用 SSH 隧道访问，不能仅通过改浏览器网址把它变成公网服务器。

`config.example.json` 与 `indexer-config.example.json` 在 `config-templates/`，均为不能直接签名运行的占位样例；以 `prepare.mjs` 生成的私密值及实际部署证据为准。所有私密文件都不应提交 Git。

## 5. 增加 Windows / Linux 同步节点

源码目录 `game/deployment/adaptive-node` 保留两个系统入口，均加入 **manifest 指定的现有链**：

Windows：双击 `Install.cmd`，填写服务器可互联的 WLAN IPv4 并选择安装目录；或：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -NoGui -ServerIP '192.168.1.10' -InstallDir 'D:\ta_kard_node'
```

Linux x86_64：

```bash
bash Install.sh --server 192.168.1.10 --root "$HOME/ta_kard_node"
```

这里的 IP 是示例，必须替换为真实可达服务器地址。首次需联网下载校验过的运行环境，或复用已有运行环境。安装器自动选择本机 IPv4/可用端口、生成独立节点身份、保留已有数据、修复 static-nodes 数组格式并设置小网络同步阈值。

服务器端需要允许目标节点访问 P2P TCP 30303。RPC、数据库和钱包管理接口无需对外开放。TCP 测试成功只能说明端口可达，不能证明 EVM 链一致；还要检查 peer 数、相同高度区块哈希以及后续区块增长。网络、系统权限与下载可达性仍可能导致新设备安装失败，本次源码发布不代表在所有外部网络上均已验收。

日常 Windows 使用安装目录下 `Start-Node.cmd` / `Status-Node.cmd` / `Stop-Node.cmd`。Linux 使用安装器输出的 `start-node.sh` / `status-node.sh` / `stop-node.sh`。新增普通同步节点不自动变成验证者，也不自动创建一个玩家钱包。

## 6. 原服务器 IPv4 变化或换同链入口

Windows 使用已安装目录 `Change-Server.cmd`；Linux 使用安装器生成的 `change-server.sh`，或 `node tools/install.mjs change-server --root <节点目录> --server <新IPv4>`。同一节点只是 IP 变了，填写新地址；换同链其他节点时，还应使用对方 `Export-Server` 导出的公开连接 JSON。会校验同链身份，不创建新测试链。详细选项见 `adaptive-node/更换服务器说明.md`。

节点连接成功之后，还要单独更新游戏网页的 SSH 隧道指向，区块同步入口和游戏 API 入口不是同一种连接。

## 7. 对战与商城

在配装或大厅选择旧版 16 费/新版 20 费，携带 4 名不同角色与 1 个局外装备；切换只影响新房间。20 费队伍不能加入旧版房间，战术点仍上限 6。

商城选择已持有的独立 NFT，输入测试 ETH 价格挂售；其他钱包查看卡面与唯一编号后购买。交易提交后以链上确认结果为准。此项目不接入真实 ETH，不提供盈利性运营授权。
