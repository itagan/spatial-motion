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

长时间稳定性门禁使用生产构建，并明确采样间隔：

```bash
npm run benchmark:matrix -- \
  --preview \
  --stability \
  --stability-interval 5 \
  --items 2000 \
  --qualities high \
  --scenarios transition-stress \
  --duration 60 \
  --headed \
  --output benchmarks/results/device-transition-soak.json
```

`--stability` 至少需要 20 秒。顶层 `stabilityDiagnostics` 保存浏览器 heap、DOM/Canvas
原始样本和自动判定；前半段允许 Atlas 与四个 Effect Program 预热，后半段作为稳定窗口。
默认要求稳定窗口内 GPU bytes、纹理 bytes、Geometry build、Canvas 和失败计数零增长，
DOM 最多增加 5 个节点；JS heap 使用前后分段低水位抵抗 GC 锯齿，保留量增长上限为
16 MiB。平台不提供 `performance.memory` 时 heap 指标为 `null`，其余资源门禁仍执行。
稳定窗口至少需要两个浏览器与两个 Renderer 样本，且 GPU、纹理、Geometry 和失败计数
都必须实际存在；缺样本不会按零增长处理。`--stability-interval` 不得超过采样时长一半。
任一运行不通过时结果仍会写盘，但命令返回非零退出码。只有 `evaluation.version: 2` 的完整
诊断可以满足跨设备长稳覆盖，旧结果保留作历史参考但不进入正式判定。

检查跨设备证据覆盖：

```bash
npm run benchmark:coverage
npm run benchmark:coverage -- --json
npm run benchmark:coverage -- --strict
```

目标与所需场景声明在 `device-targets.json`。当前覆盖 Apple Silicon、Intel 集成显卡、
Windows 主流桌面 GPU、Android 中端机和 iOS Safari；桌面要求 2000/high，移动端要求
1000/medium，均包含 10 秒 steady 与通过稳定性门禁的 300 秒 transition-stress。
普通报告允许缺口存在，便于逐台采集；`--strict` 要求每项目标均为 `qualified`。
dirty、缺少 `sourceRevision` 或不是 7–40 位 Git 十六进制 SHA 的结果只记作
`development-only`，不会满足正式门禁。
Apple Silicon 当前正式证据为 `2026-08-02-apple-m4-steady-qualified.json` 与
`2026-08-02-apple-m4-transition-stability-300s-v2.json`；二者均从采集开始时的干净 SHA
生成。其他目标必须在对应真实硬件上采集，不接受仅修改 UA、视口或设备缩放的模拟结果。

## 真实 Android / iOS 设备采集

从干净提交构建并让同一局域网中的手机访问 production preview：

```bash
npm run build:demo
npx vite preview --host 0.0.0.0 --port 4173
```

在手机打开 `http://<电脑局域网地址>:4173/benchmark.html`。Android 与 iOS 均先采集
1000/medium/steady/10 秒，再采集 1000/medium/transition-stress/300 秒；第二项使用
“运行切换压力测试”。每次完成后点击“导出设备证据”，把下载文件保留在仓库外，然后导入：

```bash
npm run benchmark:import-device -- ~/Downloads/android-soak.json \
  --output benchmarks/results/2026-08-02-android-soak.json
```

页面每 5 秒保存 Heap（平台支持时）、DOM 和 Canvas，并保留既有 500ms Renderer 样本。
导入器验证浏览器身份、矩阵配置和时长，在仓库端重新执行 v2 门禁；失败证据仍写盘但返回
非零退出码。浏览器样本还必须覆盖至少 90% 的运行时长，任意相邻样本间隔不得超过声明
间隔的 2.5 倍，页面切后台或计时器被长期节流不会被误判为稳定。导入时除
`benchmarks/results` 外的代码工作区必须干净，否则结果会标记
`-dirty`。production 构建会把源码指纹嵌入 capture；导入时必须与当前仓库指纹完全一致，
旧缓存、错分支或 dirty/clean 状态不一致都会被拒绝。这保证同批设备证据可以连续导入，
同时不会把其他版本或未提交代码标成正式基线。

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
`--resolution 40` 可显式覆盖 Cards Atlas 单元分辨率，用于同设备、同实例数下的容量与
清晰度对照；它不会改变库的默认自动策略，结果也必须与默认分辨率分开解释。
仅有 `steady` 结果表示初步建议；调整默认质量档前至少应同时采集
`transition-stress`，并在目标硬件上复验视觉效果。

文件名应包含日期和环境类型。`sourceRevision` 带 `-dirty` 表示采集时工作区存在未提交
变更，可以保留作开发证据，但不能作为正式发布基线。

矩阵顶层 `runDiagnostics` 与 `results` 按索引对应，保存页面级、无法由 500ms 定时样本
可靠还原的指标。当前包括 cold-start 重建后连续两个 RAF 内的首次提交峰值和场景操作数。
`stabilityDiagnostics` 同样按配置对应，但只在显式启用 `--stability` 时生成。
