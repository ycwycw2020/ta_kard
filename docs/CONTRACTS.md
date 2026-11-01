# 合约说明与代码位置

## 三类业务合约

### 1. TalosCards.sol

位置：`game/deployment/contracts/TalosCards.sol`；ABI 和字节码：`build/TalosCards.json`。

基于 ERC-1155、AccessControl、ReentrancyGuard、EIP-712 与 ECDSA。此合约的铸造凭证不可转让，转赠和交易走独立 ERC-721。

| 入口 | 作用 |
|---|---|
| `claimStarter` / `grantTestAccounts` | 领取或由管理员初始化测试账户 |
| `commitSeeds` | SEED_ROLE 提前登记种子 Keccak 承诺 |
| `requestMint` | 指定角色、预期种子序号、salt，扣除 3 credits，建立请求 |
| `fulfillMint` | 校验种子原像，拒绝采样后映射到卡面品质和差分 |
| `refundExpired` | 超过请求截止区块时返还额度 |
| `claimReward` | EIP-712 验证奖励凭证、域隔离、防重复与日上限 |

品质概率为普通 88%、精美 10%、超精美 2%；无第四种动态品质。抽取仍保留 10/5/3 个候选差分槽位，未全部绘完：制作清单为 306/576 张，不能把预留槽位写成全部已完成。测试新手额度用 3000 credits 表示 1000 次铸造。

### 2. TalosCardItems.sol

位置：`contracts/TalosCardItems.sol`；ABI：`build/TalosCardItems.json`。

基于 ERC-721 Enumerable。`sourceCollection` 指向铸造凭证；`materializeFor` 按凭证余额与已经登记的数量创建 NFT，调用者不能任意替换接收者。`artworkOf` 将独立 tokenId 与外观绑定。

- `gift`：钱包间转赠。
- `setListing` / `cancelListing`：持有者自行确定测试 ETH 价格与撤单。
- `buy(id, expectedSeller, expectedPrice, expectedRevision)`：检查当前所有者、价格和挂单版本，再转移 NFT；超额或不足支付的约束见代码。
- `withdrawProceeds`：卖家主动提取已成交款项。
- `_update`：转移时自动清除挂单。
- `verifyIdentifier`：验证 16 位十进制编号格式与四位校验段，不能证明合法拥有或官方身份。

编号：`Q CCC RRRRRRRR HHHH`。Q 为 1/2/3，CCC 为 001–032；后缀包含 8 位哈希派生随机数和 4 位校验。校验为 `keccak256(前12位十进制字符串) % 10000`，公开可计算，不是“加密防伪”。

### 3. TalosBattle.sol

当前 20 费：`contracts/TalosBattle.sol`；旧 16 费：`versions/battle-16/contracts/TalosBattle.sol`。

`createMatch` / `joinMatch` 核对四张卡的链上所有权、角色互异和总费用；`act` 按参与者与行动序号执行；`actAI` 仅允许固定 AI 操作者；`cancelMatch` 用于取消未开局房间。`getMatch` 和 `stateHash` 提供可复核状态。

规则库：`TalosBattleCatalog.sol` 提供角色数据，`TalosBattleEngine.sol` 含引擎、规则与连携库，`TalosBattleTypes.sol` 定义数据结构。库地址在部署时固定链接，不是可变升级代理。

现行护盾规则：对指定角色增加 12 点吸伤护盾、可叠加至 24 点、本回合结束清空、双方可见。连携技不耗资源；战术点初始 3、上限 6、每轮恢复 2。**20 费指编队上限，与战术点上限不同。**

## 同一测试链的实例

| 实例 | 地址 | 版本 |
|---|---|---|
| 铸造凭证 | `0x192A3cE528978B59e265fd6A3aE3fF6685b6b801` | ERC-1155 |
| 独立卡牌与商城 | `0x3CB5F558Df2E765b9e30d7b093D56b357B8f2E6e` | ERC-721 |
| 16 费对战 | `0xF492595D24c45E0ABCC8eABE4858D401C0080eED` | 1.1.0-public-shield |
| 20 费对战 | `0x245f7E77ca588B468bf912dF2747077f1907713d` | 1.1.1-team-cost20 |

20 费部署区块 50398；交易 `0x0f4ce55c1bc3bba933a7c48432de705201caeb2aeecbe30a972f4c4f1939eb33`。公开证据见根应用目录的 `battle-deployment.json`；旧版证据在 `versions/battle-16/`。这里只含公开信息，不提供现有链的签名密钥。

双版本路由：`lib/battle-fleet.mjs`；前端选择器：`web/app.js`、`web/battle-modes.css`。`current20` 与 `legacy16` 决定新房间使用的实例；历史对局按实际存在的合约解析。用户不能用篡改网页的方式使 17–20 费队伍通过旧 16 费合约的校验。

已部署合约是历史 MIT 源码，保留原 SPDX 与源哈希以便核验。本次非商业发布政策不撤销这些文件原有的 MIT 权利。
