# Spatial Motion examples

这里是面向单一集成场景的小型示例，不是独立 npm workspace。每个目录都可以单独阅读和复制，同时由根仓库统一安装依赖、类型检查和构建。

| 示例 | 内容 |
| --- | --- |
| [`vanilla`](./vanilla/) | 最小 `MotionStage`、数据、布局切换和暂停/恢复 |
| [`three-extension`](./three-extension/) | 使用 `StageExtension` 挂载和释放原生 Three.js 内容 |
| [`gsap-extension`](./gsap-extension/) | 用 Stage 的 `elapsed` 驱动 paused GSAP timeline |

在仓库根目录运行：

```bash
npm install
npm run dev:examples
```

然后访问：

- `/vanilla/`
- `/three-extension/`
- `/gsap-extension/`

生产构建使用 `npm run build:examples`，输出到 `dist-examples/`。示例从正式包名 `@itagan/spatial-motion` 导入，构建前需要先生成根包的 `dist/`；根级 `npm run build` 已按正确顺序执行。

这些示例不进入 npm tarball。真实发布包的 Node、TypeScript、浏览器消费和 Tree Shaking 仍由 `npm run pack:check` 独立验证。
