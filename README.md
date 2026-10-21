# Pi Rainbow Footer 🌈

为 [Pi coding agent](https://github.com/earendil-works/pi) 添加动态彩虹状态栏：工作目录、会话信息、Token、缓存命中率、上下文用量，以及可选的 Codex 额度信息。

[English](README.en.md) · MIT · 已验证 Pi **0.85.1** / Node.js **22.19+**

![使用模拟会话数据渲染的状态栏预览](assets/preview.svg)

预览由扩展的实际渲染结果生成，使用模拟数据。终端字体和真彩色支持会影响显示效果。

## 安装

在已安装 Pi 的终端中运行：

```bash
pi install git:github.com/zgj-119/pi-rainbow-footer
```

重新启动 Pi；已打开的交互会话也可以执行 `/reload`。

临时试用：

```bash
pi -e git:github.com/zgj-119/pi-rainbow-footer
```

扩展在 Pi 的交互终端模式下生效，使用 Pi 提供的依赖，无需单独构建。已验证版本为 0.85.1；旧版 `@mariozechner/*` 包不在本项目的兼容范围内。

如果已经手动安装过 `rainbow-footer.ts`，请只保留一种加载方式；其他替换底部状态栏的扩展也应关闭。

## 显示内容

| 位置 | 内容 |
| --- | --- |
| 第一行 | 当前目录、Git 分支、会话名称、统计、模型及思考等级 |
| 第二行 | 有相关响应头时显示 Codex 额度；否则显示 `....` |
| `↑` / `↓` | 会话中 assistant 消息的累计输入 / 输出 Token |
| `W` | 累计缓存写入 Token |
| `CH` | 最近一条 assistant 消息的缓存命中率 |
| `$` / `(sub)` | 消息上报的累计费用 / OAuth 订阅标记 |
| `%/窗口` | 当前上下文占比及上下文窗口大小 |

示例：

```text
CH88.0%       最近一次请求的缓存读取 Token / 总提示 Token
12.5%/200k    已使用约 12.5% 的 200k 上下文窗口
GPT 5h 12% ↻ 1h0m · 7d 40% ↻ 1d0h
```

额度百分比表示**已使用**的比例。额度和重置时长来自最近一次 `after_provider_response` 事件中的 `x-codex-*` 响应头，是响应时的快照；扩展不会额外请求账户接口，也不会独立查询额度。服务未提供这些头时无法显示额度，费用也以模型消息上报的数据为准。

动画约每 180 毫秒刷新一次，仅在本地渲染界面。统计口径为 assistant 消息，不包含单独记录在工具、压缩或分支总结条目中的费用。

## 自定义

编辑 `rainbow-footer.ts` 中的 `RAINBOW` 调整调色板；调整 `setInterval` 的 `180` 可改变刷新频率。修改后在 Pi 中执行 `/reload`。

卸载：

```bash
pi remove git:github.com/zgj-119/pi-rainbow-footer
```

## 本地开发

```bash
git clone https://github.com/zgj-119/pi-rainbow-footer.git
cd pi-rainbow-footer
npm ci --ignore-scripts
npm run check
npm run preview
pi -e ./rainbow-footer.ts
```

测试使用模拟的 Pi 会话检查扩展注册、统计显示、窄终端与 Unicode 宽度、额度头解析和资源清理。预览不使用真实会话、登录信息或账户额度。

## 许可证与来源

[MIT](LICENSE)。部分格式化与统计代码改编自 Pi 官方状态栏，来源和版权见 [NOTICE.md](NOTICE.md)。本项目是社区扩展。
