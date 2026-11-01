# 塔卫牌 · ta_kard

**以太坊技术 × 同人卡牌对战 × 可核验的数字卡面**

作者：ycwycw2020。个人区块链课程项目，独立完成项目设计、前后端、合约集成、部署与文档；使用第三方软件依赖及 AI 辅助美术工具。项目角色与美术原型来自鹰角网络旗下《明日方舟：终末地》，**并非官方作品，未取得官方授权，未上传至任何除本地测试链以外所有区块链上**。

> 本仓库公开源码与美术资源，供非商业学习、研究和交流。**项目自有内容不提供商业使用授权。** 本次发布采用非商业源码公开许可，不能统称为 OSI 标准开源。第三方代码及已采用 MIT 的合约源码遵循其原许可，详见 [许可范围](LICENSE.md) 和 [美术声明](LICENSES/ARTWORK_NOTICE.md)。

<p align="center"><img src="game/assets/cards/display/c26-s15.webp" width="230" alt="庄方宜超精美卡面"><img src="game/assets/cards/display/c30-s16.webp" width="230" alt="诀超精美卡面"></p>

## 这个项目实现了什么

- **链上卡面获取：** ERC-1155 不可转让铸造凭证、服务端种子承诺与揭示、到期退款；品质只改变外观。
- **可交易的独立卡牌：** ERC-721，16 位编号 `QCCC RRRRRRRR HHHH`，支持转赠、用户自行定价挂售、测试 ETH 购买与卖家提现。
- **公开可验证对战：** 角色血量、数值护盾、行动顺序、技能与胜负由 Solidity 合约校验和执行，不再由旧的链下引擎决定最终胜负。
- **双规则版本：** 旧版 16 费与新版 20 费两个不可变对战合约并存；新建房间可切换，已开始的对局继续使用原合约。
- **可视化：** 编队站位与装备、PVP/AI、铸造、卡牌档案、商城、伤害日志；16:9 桌面对战界面。
- **美术：** 32 名角色、306 张静态插画；庄方宜与诀各 18 张。6 张超精美卡面另有 WebGL 呼吸与风动表现，不是 Live2D Cubism 模型，也没有第四种动态稀有度。

## 区块链用在哪里

| 合约类型 | 职责 | 源码 |
|---|---|---|
| `TalosCards`（ERC-1155） | 新手额度、铸造请求、种子承诺/揭示、奖励验签、到期退款 | [TalosCards.sol](game/deployment/contracts/TalosCards.sol) |
| `TalosCardItems`（ERC-721 + 定价市场） | 唯一编号、确权、转赠、挂售/撤单/购买、收益提取 | [TalosCardItems.sol](game/deployment/contracts/TalosCardItems.sol) |
| `TalosBattle`（自定义状态机） | 编队所有权与费用、行动权限、伤害/护盾/技能、状态哈希、胜负 | [TalosBattle.sol](game/deployment/contracts/TalosBattle.sol) |

这里是 **3 类业务合约、4 个业务合约实例**：对战合约保留 16/20 费两版，另有固定链接的规则库。它不是主网项目，也不声称完全去中心化。当前三个验证节点、应用 API、种子与奖励服务均由项目方管理。图片、账户会话、配装偏好与查询索引仍在链下。详见 [架构](docs/ARCHITECTURE.md)、[合约说明](docs/CONTRACTS.md)。

## 目录

```text
game/deployment/          前端、后端、Solidity、ABI/字节码、数据库结构与脚本
  web/                   原生 HTML/CSS/JavaScript、ethers、卡面动画
  lib/                   链访问、双版本路由、资产与游戏适配
  contracts/             当前 20 费合约与规则库；历史 MIT 声明保留
  versions/battle-16/     旧版 16 费源代码、编译产物与公开部署证据
  adaptive-node/         Windows / Linux 分开的自适应节点安装入口
game/assets/             展示图、动态纹理、元数据、背景缩略图
docs/                    使用说明、项目介绍、架构、合约与素材清单
tools/                   资源校验/导入工具；原主机启动脚本参考
LICENSES/                非商业许可、历史 MIT、第三方通知与美术声明
```

## 获取与启动

**仅克隆源码还不包含完整 4K 图片。** 游戏会检查展示图与 4K 图是否同时存在；请先从 [v1.0.0 下载页](https://github.com/ycwycw2020/ta_kard/releases/tag/v1.0.0) 下载并导入全部 `ta_kard-art-4k-*.zip`。原始图 `ta_kard-art-native-01.zip` 用于后续编辑，不是运行必需项。图片的 2160×3840 是超分辨率输出，原始分辨率保留于元数据，不能称为原生 4K。

```powershell
git clone https://github.com/ycwycw2020/ta_kard.git
cd ta_kard
python tools/import-art.py --archives "D:\下载目录"
python tools/verify-assets.py
cd game/deployment
corepack pnpm install --frozen-lockfile
npm test
```

上面的测试不需要钱包私钥或在线链。完整运行还需要 Besu 链、PostgreSQL、独立生成的私密配置、已部署合约和索引器；**仓库不携带原网络私钥、密码、玩家存档或链数据库，不是解压后自动重建原网络的整机备份。** 详细步骤及现有设备启动方式见 [使用说明](docs/USAGE.md)。

## 当前测试链的公开信息

链 ID：`20260926`；Besu QBFT；一台 Windows 主机和两台 Ubuntu 虚拟机。PostgreSQL 位于 Windows。这些地址仅属于项目当前私有测试链，不能直接用于其他网络。

| 实例 | 地址 |
|---|---|
| 铸造凭证 | `0x192A3cE528978B59e265fd6A3aE3fF6685b6b801` |
| 独立卡牌 / 商城 | `0x3CB5F558Df2E765b9e30d7b093D56b357B8f2E6e` |
| 旧版 16 费对战 | `0xF492595D24c45E0ABCC8eABE4858D401C0080eED` |
| 新版 20 费对战 | `0x245f7E77ca588B468bf912dF2747077f1907713d` |

## 许可与权利联系

默认原创软件采用 **PolyForm Noncommercial 1.0.0**；自有文档与美术中作者有权许可的贡献采用 **CC BY-NC-SA 4.0**。历史 MIT 合约与第三方文件保留原许可，不能被新的非商业条款追溯覆盖。[完整范围与研究依据](LICENSE.md)。

**相关美术素材原型全部来源于鹰角网络公司旗下的《明日方舟：终末地》，未取得官方授权。如有侵权，请通过本仓库 Issue 联系作者，作者将核实并删除该仓库及相关发布资源。** 公开文件、附加许可或“非商业使用”声明均不代表取得了原作权益人的授权。

提交权利通知：[新建 Issue](https://github.com/ycwycw2020/ta_kard/issues/new?template=rights.yml)。请提供受影响文件与权利依据，勿公开身份证件、住址或其他敏感资料。
