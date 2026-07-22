# Spatial Motion examples

这里是面向单一集成场景的小型示例，不是独立 npm workspace。每个目录都可以单独阅读和复制，同时由根仓库统一安装依赖、类型检查和构建。

| 示例 | 内容 |
| --- | --- |
| [`vanilla`](./vanilla/) | 最小 `MotionStage`、数据、布局切换和暂停/恢复 |
| [`three-extension`](./three-extension/) | 使用 `StageExtension` 挂载原生 Three.js 内容，并演示启停、质量适配和释放 |
| [`gsap-extension`](./gsap-extension/) | 用 Stage 的 `elapsed` 驱动 paused GSAP timeline，并响应启停与低动态模式 |
| [`lottery-screen`](./lottery-screen/) | Vue 3 抽奖大屏：奖项/轮次、开始停止、多人揭晓、排除、历史、撤销、名单导入、本地恢复和中奖 CSV 导出 |

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

名单导入支持带表头或无表头的 CSV、TSV 和 TXT，标准双引号转义以及字段内换行。页面可直接下载 UTF-8 CSV 模板；每行至少填写姓名，部门为空时使用“现场嘉宾”。

默认球体使用交错纬线与完整曲面朝向，顶部、底部和侧边卡片随球面法线倾斜；抽奖球体沿水平方向稳定旋转，便于在大屏上保持完整轮廓和空间纵深。

示例内置一张原创 6×6 头像图集，按参与者稳定 `id` 裁切头像并直接绘制为球面卡片的全幅纹理；图集只加载一次，不为每位参与者发起独立图片请求。
