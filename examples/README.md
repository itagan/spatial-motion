# Spatial Motion examples

这里是面向单一集成场景的小型示例，不是独立 npm workspace。每个目录都可以单独阅读和复制，同时由根仓库统一安装依赖、类型检查和构建。

| 示例 | 内容 |
| --- | --- |
| [`vanilla`](./vanilla/) | 最小 `MotionStage`、数据、布局切换和暂停/恢复 |
| [`three-extension`](./three-extension/) | 使用 `StageExtension` 挂载原生 Three.js 内容，并演示启停、质量适配和释放 |
| [`gsap-extension`](./gsap-extension/) | 用 Stage 的 `elapsed` 驱动 paused GSAP timeline，并响应启停与低动态模式 |
| [`lottery-screen`](./lottery-screen/) | Vue 3 抽奖大屏：奖项/轮次、开始停止、多人揭晓、排除、历史、撤销、名单导入和本地恢复 |

在仓库根目录运行：

```bash
npm install
npm run dev:examples
```

然后访问：

- `/vanilla/`
- `/three-extension/`
- `/gsap-extension/`
- `/lottery-screen/`

生产构建使用 `npm run build:examples`，输出到 `dist-examples/`。示例从正式包名 `@itagan/spatial-motion` 导入，构建前需要先生成根包的 `dist/`；根级 `npm run build` 已按正确顺序执行。

这些示例不进入 npm tarball。真实发布包的 Node、TypeScript、浏览器消费和 Tree Shaking 仍由 `npm run pack:check` 独立验证。

`lottery-screen` 使用 `crypto.getRandomValues()` 完成本机无放回抽取，但它仍是前端集成 Demo，不包含服务端签名、第三方公证、权限控制或不可篡改审计；正式活动应根据合规要求补充可信抽奖服务。
