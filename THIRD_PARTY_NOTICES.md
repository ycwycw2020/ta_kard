# 第三方通知

下列组件保留其原有许可，不能被项目的非商业政策额外限制。作者原创应用的 PolyForm 许可不把这些组件重新许可为 PolyForm。

| 组件 | 锁定版本 | 许可 | 使用方式 |
|---|---|---|---|
| ethers | 6.15.0 | MIT | Node.js 依赖；浏览器构建 `web/ethers.js` 随源码分发 |
| OpenZeppelin Contracts | 5.4.0 | MIT | ERC-1155、ERC-721、权限与密码学库，通过包管理器安装 |
| pg | 8.16.3 | MIT | PostgreSQL 客户端，通过包管理器安装 |
| ws | 8.18.3 | MIT | Node.js 依赖，通过包管理器安装 |
| solc-js | 0.8.30 | MIT（npm 包声明） | 编译工具，通过包管理器安装；不包含 solc 编译器运行时副本 |
| @adraffy/ens-normalize | 1.10.1 | MIT | ethers 浏览器构建的依赖 |
| @noble/curves | 1.2.0 | MIT | ethers 浏览器构建的依赖 |
| @noble/hashes | 1.3.2 | MIT | ethers 浏览器构建的依赖 |
| aes-js | 4.0.0-beta.5 | MIT | ethers 浏览器构建的依赖 |
| tslib | 2.7.0 | 0BSD | ethers 浏览器构建的依赖 |

相应包自带的许可证副本及 package-info 位于 `LICENSES/third-party/`。使用 npm/pnpm 安装时还会引入传递依赖，其许可应以各自包内文件及锁文件为准；本仓库不捆绑 node_modules。不要移除其署名或版权通知。

`contracts/` 中已有 `SPDX-License-Identifier: MIT` 的项目合约、旧版归档及对应编译产物保留历史许可，不进行追溯撤销。MIT 文本见 `LICENSES/MIT-historical.txt`。项目整体的非商业发布政策不能阻止他人行使其已经合法获得的 MIT 权利。

部署依赖 Besu、OpenJDK、Node.js、PostgreSQL、VMware 等工具；仓库不附带这些工具的二进制，不声称拥有它们的版权。安装器从指定上游下载并核验摘要，使用与再分发工具应遵循上游对应条款。

卡面曾使用 AI 图像生成及 Real-ESRGAN 超分辨率处理；本包不包含这些生成/超分工具或其模型。角色与美术原型来源另见 `LICENSES/ARTWORK_NOTICE.md`，不得把原作形象当作项目原创版权或官方授权素材。
