# Quality calibration results

本目录保存跨环境质量矩阵证据。每个 JSON 同时记录浏览器、GPU、视口、DPR、源码
状态、完整 `BenchmarkResult` 和按运行时自适应降级语义生成的档位建议。

运行默认矩阵：

```bash
npm run benchmark:matrix
```

常用选项：

```bash
npm run benchmark:matrix -- \
  --items 500,1000,2000 \
  --qualities high,medium,low \
  --scenarios steady,transition-stress \
  --duration 10 \
  --viewport 1265x633 \
  --dpr 2 \
  --headed \
  --output benchmarks/results/device-name.json
```

`--headed` 用于采集真实有界面 GPU 环境；默认无头模式适合自动化和软件渲染基线。
不同 `gpuRenderer`、视口或 DPR 的结果不会合并推荐。无头 SwiftShader 结果只能代表
软件渲染环境，不能用于调整 Apple、Intel、NVIDIA、AMD 或移动 GPU 的默认档位。
有界面浏览器的窗口装饰可能使实际内容视口与请求值略有不同；校准以每条结果的
`configuration.environment.viewportWidth/viewportHeight` 为准，而不是只看命令参数。

推荐选择同一环境、实例数和布局下通过全部要求场景的最高档。通过条件与默认
`AdaptivePerformanceManager` 的降级边界一致：平均 FPS 不低于目标的 78%、P95 不
超过该 FPS 对应的帧预算、33ms 长帧比例低于 8%，并保持主体 1 Draw Call。resident 与
submitted 必须等于该档 `min(inputItems, maxVisibleItems)`，防止部分实例证据被误判通过。
`--items` 不受 Benchmark 页面预设按钮限制，可直接用于 3000、5000、10000 等拐点探测。
默认档位仍会执行自身的实例上限；仅在定位 High 全量渲染拐点时，可显式传入
`--high-max-visible-items 10000`。该参数及覆盖后的实例覆盖要求会写入结果，不能与默认
High 结果混为一组发布基线。
仅有 `steady` 结果表示初步建议；调整默认质量档前至少应同时采集
`transition-stress`，并在目标硬件上复验视觉效果。

文件名应包含日期和环境类型。`sourceRevision` 带 `-dirty` 表示采集时工作区存在未提交
变更，可以保留作开发证据，但不能作为正式发布基线。
