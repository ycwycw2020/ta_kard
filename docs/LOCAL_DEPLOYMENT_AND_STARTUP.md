# 塔卫牌 v1.0 · 本地部署与运行启动指南

本指南适用于 Windows 主机＋两台 Ubuntu 虚拟机的三节点结构。三个 Besu 节点共用一条测试链；游戏 API 与 PostgreSQL 位于 Windows。项目只部署在本地测试链，不使用真实 ETH。

## 一、选择正确的使用方式

| 当前情况 | 从哪里开始 |
|---|---|
| 原主机已经安装在 `D:\card_endfiled` | 第二节，直接启动已有环境 |
| 只想在另一台电脑加入现有网络 | 第六节，安装同步节点并连接原游戏入口 |
| 第一次下载源码，在新电脑独立部署 | 第三至五节，准备素材、运行环境、链与私密配置 |

公开源码包不携带原网络的私钥、数据库密码、玩家数据、区块数据库或运行环境二进制。它不是整机安装镜像；只解压源码再执行 `npm start`，不能自动重建原三节点环境。

## 二、已安装环境：启动、访问、检查与停止

### Windows 主机启动三节点

确认 VMware Workstation 可用、两台 Ubuntu 虚拟机文件仍在本机，且 VMware NAT/DHCP 服务正常。建议在 **PowerShell 7** 中执行：

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "D:\card_endfiled\Start-Game.ps1" -NoBrowser
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "D:\card_endfiled\Status-Game.ps1"
```

启动器会启动或复用虚拟机、三台 Besu 节点、SSH 转发、Windows PostgreSQL、游戏 API 与索引器。上述脚本依赖本机已有的 `game/deployment/local-host.json`、SSH 身份和私密配置；它们没有附在公开包中。使用自定义安装目录时，为启动/状态/停止脚本传入 `-Root '你的安装目录'`，还需确保本机配置中的实际路径正确。

服务准备好后打开：**http://localhost:8787**。

状态正常时，三个节点均 `ok: true`，每台可连接另外两台；相同高度区块哈希一致，后续高度继续增长，索引进度接近链头。启动初期高度短暂相差一两个区块可以等待追齐，不要据此删除数据重装。

### Ubuntu 中启动现有服务

正常先在 Windows 启动整套环境，再在两台 Ubuntu 分别检查：

```bash
systemctl --user start talos-besu
systemctl --user status talos-besu --no-pager
journalctl --user -u talos-besu -n 30 --no-pager
```

只有原配置中承担索引任务的那台 Ubuntu 额外启动：

```bash
systemctl --user start talos-indexer
systemctl --user status talos-indexer --no-pager
```

Ubuntu 浏览器也打开 `http://localhost:8787`，通过已有反向 SSH 转发连接 Windows 上的同一 API。仅启动 Linux 的 Besu，不会自动启动 Windows 数据库或网页。

### 正常停止

在 Windows 执行：

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "D:\card_endfiled\Stop-Game.ps1"
```

单独停止 Ubuntu 链节点可使用 `systemctl --user stop talos-besu`。正常停止保留身份、卡牌与链数据。

## 三、首次获取源码和完整美术

从 https://github.com/ycwycw2020/ta_kard/releases/tag/v1.0.0 下载：

1. `ta_kard-v1.0.0-source-and-previews.zip`，解压得到 `ta_kard` 目录。
2. 全部五个 `ta_kard-art-4k-01.zip` 至 `ta_kard-art-4k-05.zip`，保存到同一下载目录。
3. 本指南与 `README.md`、`DOWNLOADS.md`；`SHA256SUMS.txt` 用于核对下载完整性。

`ta_kard-art-native-01.zip` 是原始生成图，供编辑用，运行时可不下载。五个 4K ZIP 可以分别解压，不是要拼接字节的分卷包；推荐让工具校验并导入：

```powershell
cd "D:\你的源码目录\ta_kard"
python tools/import-art.py --archives "D:\你的下载目录"
python tools/verify-assets.py
```

最终目录应包含 `game/assets/cards/display/`、`game/assets/cards/4k/`、`game/assets/cards/metadata/` 与 `game/assets/cards/motion/`。游戏仅把展示图和 4K 图成对齐全的卡面标为可用。4K 交付为 2160×3840 超分辨率结果，原始尺寸保留在元数据中。

## 四、首次独立部署：准备运行环境与链

### 运行环境

| 组件 | 用途与配置 |
|---|---|
| Windows＋VMware＋两台 Ubuntu x86_64 | 主节点与另外两个节点；根据宿主机内存合理分配虚拟机资源 |
| Besu 与匹配的 Java | 参考 `game/deployment/adaptive-node/installer-manifest.json` 的固定版本与摘要 |
| Node.js 20+，项目环境使用 Node.js 24；pnpm 9 | 安装和运行 Node.js 应用，锁文件为 pnpm 格式 |
| PostgreSQL | 数据库留在 Windows，原环境使用回环地址 `127.0.0.1:5433` |
| Python 3.10+ | 素材导入与 SHA-256 校验 |
| OpenSSH | Windows 与两台 Ubuntu 间建立已验证主机身份的连接与转发 |

在源码目录安装依赖、编译：

```powershell
cd "D:\你的源码目录\ta_kard\game\deployment"
corepack pnpm install --frozen-lockfile
npm run compile
npm run compile:battle
```

`npm test` 可选执行离线单元测试；`*.live.mjs` 与部署脚本不是离线测试，可能发送交易。

### 独立测试链的准备顺序

以下是**新网络开发者流程**，不要在原安装目录用它覆盖现有身份或创世文件。

1. 在独立工作副本运行 `node scripts/prepare.mjs`，生成本地 `private/config.json` 与 QBFT 生成配置。已有配置时脚本会拒绝重新生成。
2. 使用 Besu 的 QBFT 网络生成工具创建三个不同的验证者密钥和共同的创世文件。`scripts/configure-network.mjs` 展示节点配置生成方式，其中 IP 和 Linux 用户目录必须按自己的虚拟机环境修改。
3. 三个验证者使用同一 genesis，各自使用不同 node key；配置可达 P2P 地址和静态节点。RPC 仅监听本机回环地址。
4. 在 Windows 建立 PostgreSQL 应用用户和数据库，把实际连接信息填入本地 `private/config.json`。`schema.sql` 由应用初始化；`scripts/setup-db.mjs` 是原 Windows 目录专用参考，其他路径需要先适配。
5. 给独立生成的管理地址分配该网络的测试余额，然后依次部署铸造凭证、独立卡牌商城和战斗合约。脚本为 `scripts/deploy-contract.mjs`、`scripts/deploy-items.mjs`、`scripts/deploy-battle.mjs`。
6. `deploy-items.mjs` 校验 manifest 中的创世哈希，`deploy-battle.mjs` 也含原网络目录和链 ID 约定。新环境需使用自己的网络 manifest、配置和部署地址，不能直接复用 README 中的旧链地址。
7. 如果需要 16/20 费双版本，分别使用 `versions/battle-16/` 与当前 `contracts/` 的产物部署，记录旧实例至 `previousBattleContracts`，当前 20 费地址写入 `battleContract`。现有通用部署脚本不会自动替你完成整套双版本归档流程。
8. 按下面第五节配置 API 与索引器，建立 SSH 转发，再运行网页。

公开样例见 `config-templates/config.example.json` 和 `config-templates/indexer-config.example.json`。其中均为占位值，必须替换为在自己环境中生成的有效值；不得把真实私钥、密码或 token 提交到 GitHub。此版没有针对任意新电脑的一键主服务器部署器。

## 五、源码环境：运行 API 与索引器

在 `game/deployment` 工作目录下准备有效的 `private/config.json`，确认 RPC、PostgreSQL、合约和素材已经就绪，再启动 API：

```powershell
cd "D:\你的源码目录\ta_kard\game\deployment"
npm start
```

在另一个终端或配置好的 Linux 用户服务中启动索引器：

```bash
node indexer.mjs
```

索引器从它旁边的 `indexer-config.json` 读取自己的 RPC、API、铸造/ERC-721 地址与认证 token；token 要与 API 配置一致。它可部署在 Ubuntu，通过隧道访问 Windows API。原环境中 Ubuntu 索引器的 API 转发端口可能与网页端口不同，按实际服务配置填写。

原 API 固定接受 `localhost:8787` 的 Host/Origin。浏览器通过 `http://localhost:8787` 进入；外部机器通过 SSH 网页转发访问。不要只改浏览器网址就把原服务当作已经完成公网部署。

进入游戏后可连接测试钱包、领取测试账户资源，选择 16 费或 20 费对战规则，配装后进行 AI/PVP，或进入卡牌铸造与商城。战术点上限仍为 6，与编队费用 16/20 不同。

## 六、新增 Windows / Linux 同步节点

同步节点安装器位于 `game/deployment/adaptive-node`，用于加入其 manifest 指定的现有链，不会自动部署游戏 API、数据库或获得验证者资格。

Windows：进入该目录，双击 `Install.cmd`，输入服务器可互通的 WLAN IPv4，并选择安装目录。命令行等价方式：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -NoGui -ServerIP '192.168.1.10' -InstallDir 'D:\ta_kard_node'
```

Linux：

```bash
bash Install.sh --server 192.168.1.10 --root "$HOME/ta_kard_node"
```

上述 IP 为示例。安装后 Windows 使用 `Start-Node.cmd` / `Status-Node.cmd` / `Stop-Node.cmd`；Linux 使用生成的 `start-node.sh` / `status-node.sh` / `stop-node.sh`。

原服务器 IP 改变时，Windows 使用 `Change-Server.cmd`，Linux 使用 `change-server.sh`。换到同链的另一台入口时，使用对方导出的公开服务器连接文件；网页 SSH 转发的目标也需单独更新。

外部玩家通过同一 API 访问时，图片从原主机加载，不要求每个同步节点保存全套 4K 资源。若在新机器另起 API，则该机器也需导入完整素材。

## 七、常见问题

| 现象 | 检查方式 |
|---|---|
| `localhost:8787` 打不开 | Windows API 与 PostgreSQL 是否已启动；访问的是本机或正确的网页转发入口 |
| 状态页节点 2/3 离线，但 Besu 仍运行 | Windows 的 8546/8547 SSH 转发是否断开；重新建立转发后检查相同高度哈希 |
| `remote port forwarding failed for listen port 8787` | Ubuntu 的旧转发会话可能占用 8787；用 `ss -ltn` 检查，识别并退出对应旧会话，再启动。不要终止所有 SSH 会话 |
| Windows PowerShell 冷启动遇到 `NativeCommandError` | 在 PowerShell 7 中运行启动器，确认 Ubuntu 已完成开机并能通过已信任 SSH 身份连接 |
| 卡面未显示 | 五个 4K 包是否导入到同一 `game/assets`，展示图与 4K 是否成对齐全；运行素材校验工具 |
| 节点包连接失败 | 先检查服务器 IPv4 和 TCP 30303，再检查创世哈希、静态节点、公钥与新区块增长；端口可达不等于已经同步 |
| 旧房间拒绝 20 费编队 | 旧 16 费合约限制仍有效，改选新版或降低队伍费用 |
| 新电脑直接运行启动脚本失败 | 原主机启动脚本依赖原机器的私密配置与路径，不是通用新主机安装程序 |

更多配置说明：[使用说明](https://github.com/ycwycw2020/ta_kard/blob/main/docs/USAGE.md)；完整下载列表：[DOWNLOADS.md](https://github.com/ycwycw2020/ta_kard/blob/main/DOWNLOADS.md)。
