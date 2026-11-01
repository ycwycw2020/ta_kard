# 塔卫牌 v1.0 下载文件清单

下载页：https://github.com/ycwycw2020/ta_kard/releases/tag/v1.0.0

本次为 v1.0 的文档与附件修订：增加本地部署、运行与启动指南，移除答辩 PPT。代码版本仍以原 v1.0 标签为基础；最新说明和附加源码包的文档修订提交见发行说明，不移动原标签。

| 文件 | 内容 | 何时需要 |
|---|---|---|
| [README.md](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/README.md) | 项目简介、下载入口、本地部署与常用启动命令 | 首次阅读 |
| [LOCAL_DEPLOYMENT_AND_STARTUP.md](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/LOCAL_DEPLOYMENT_AND_STARTUP.md) | 已有三节点启动、新环境准备、源码运行、Windows/Linux 节点加入与故障排查 | 本地部署和日常运行 |
| [DOWNLOADS.md](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/DOWNLOADS.md) | 本下载文件清单 | 对照下载 |
| [ta_kard-v1.0.0-source-and-previews.zip](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/ta_kard-v1.0.0-source-and-previews.zip) | 前后端、合约、展示图、动态纹理、文档和许可证 | 阅读源码或独立部署；解压得到 ta_kard 目录 |
| `ta_kard-art-4k-01.zip` 至 `ta_kard-art-4k-05.zip` | 全部 306 张 2160×3840 卡面和 4K 背景，五个包需全部导入 | 在本机运行完整游戏 API 时必需 |
| [ta_kard-art-native-01.zip](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/ta_kard-art-native-01.zip) | 原始生成图与背景原图 | 美术编辑可选，运行可省略 |
| [SHA256SUMS.txt](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/SHA256SUMS.txt) | 下载文件 SHA-256 | 校验下载文件 |
| [release-assets.json](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/release-assets.json) | 文件名、字节数及摘要的机器可读清单 | 自动化核对 |

五个 4K 包：[01](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/ta_kard-art-4k-01.zip)、[02](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/ta_kard-art-4k-02.zip)、[03](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/ta_kard-art-4k-03.zip)、[04](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/ta_kard-art-4k-04.zip)、[05](https://github.com/ycwycw2020/ta_kard/releases/download/v1.0.0/ta_kard-art-4k-05.zip)。它们是可独立解压的 ZIP，不需要拼接字节。

## 本地部署的下载组合

**已有安装：** 先看 README 与本地部署指南，直接使用原安装目录的启动脚本。无需为了启动而重新下载或覆盖原链数据。

**首次从源码搭建应用：** 下载源码包＋全部五个 4K 包＋部署指南，并自行准备 Node.js、Java/Besu、PostgreSQL、SSH 与有效的私密配置。源码包不包含原网络身份或整机运行环境，不是解压即用的独立安装镜像。

**只新增一个现有网络的同步节点：** 使用源码包中的 `game/deployment/adaptive-node`，选择 Windows 或 Linux 入口；填写可达服务器 IPv4 和安装目录。使用原游戏 API 玩游戏时，无需在该同步节点另存全部 4K 资源。

## 常用启动入口

已有 Windows 主机在 PowerShell 7 执行：

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "D:\card_endfiled\Start-Game.ps1" -NoBrowser
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "D:\card_endfiled\Status-Game.ps1"
```

游戏网页：http://localhost:8787 。Ubuntu 已有链服务使用 `systemctl --user start talos-besu`，承担索引任务的机器额外启动 `talos-indexer`。

首次部署所需的配置、运行 API/索引器以及停止方式详见 [本地部署与运行启动指南](https://github.com/ycwycw2020/ta_kard/blob/main/docs/LOCAL_DEPLOYMENT_AND_STARTUP.md)。

## 源码与校验说明

GitHub 自动生成的 `Source code (zip/tar.gz)` 对应原 `v1.0.0` 标签，可能早于本次文档修订；建议下载上表的附加源码包与独立指南。附加源码包仍不含完整 4K 图，需另行导入。

`SHA256SUMS.txt` 覆盖源码、六个美术包和三份 Markdown 指南；`release-assets.json` 给出同一组文件的大小与摘要，两份清单不相互引用，避免循环校验。
