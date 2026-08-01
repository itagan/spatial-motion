# 开发指南

本文面向维护者和开发代理，说明 Spatial Motion 的日常开发方式。面向使用者的 API 与示例请看根目录 `README.md`。

## 环境与启动

要求 Node.js 20 或更高版本；CI 当前使用 Node.js 22。首次进入项目执行：

```bash
npm ci
npm run dev
```

开发服务器默认提供：

- `/`：布局、特效、拾取和连续编排演示。
- `/benchmark.html`：不同实例数量和质量档位的性能基准。
- `/benchmark.html` 的压力模式：持续中断布局/特效并局部更新图集，可选择最长 30 分钟。

`npm run dev:examples` 独立启动集成示例站点，提供 `/vanilla/`、`/three-extension/`、`/gsap-extension/`、`/custom-card-effect/`、`/custom-renderer-layout/` 和 `/lottery-screen/`。Lottery Screen 使用 Vue 3 验证真实应用编排，但抽奖状态与随机选择保持在 examples，不进入核心库。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run typecheck` | 对源码、测试配置、demo 和 examples 执行严格类型检查 |
| `npm test` | 使用 Vitest 运行全部单元测试 |
| `npm run test:browser` | 使用 Playwright Chromium 运行真实 WebGL 冷启动与性能门禁 |
| `npm run test:watch` | 监听模式运行测试 |
| `npm run benchmark:compare -- baseline.json current.json` | 严格解析并按阈值判定性能回归 |
| `npm run benchmark:matrix` | 自动采集固定质量矩阵并输出按环境隔离的档位建议 |
| `npm run build:lib` | 构建 ESM 库与类型声明到 `dist/` |
| `npm run build:demo` | 构建演示站点到 `dist-demo/` |
| `npm run build:examples` | 构建六个独立示例到 `dist-examples/` |
| `npm run build` | 依次构建库、演示站点和独立示例 |
| `npm run pack:check` | 验证发布文件、体积、导出、类型、运行时消费和 Tree Shaking |
| `npm run verify` | 串行执行类型、全部测试、库/demo 构建和包消费者验证 |

`dist/`、`dist-demo/` 和 `dist-examples/` 是生成目录且已被忽略，不要手工编辑或提交。

## CI 与提交前检查

CI 对 pull request 以及 `main` 分支的 push 执行以下流程：

```bash
npm ci
npm run typecheck
npm test
npm run test:browser
npm run build:lib
npm run build:demo
npm run build:examples
npm run pack:check
```

代码、构建配置或包配置发生变化时，本地应执行同等检查。首次运行浏览器测试前执行 `npx playwright install chromium`。纯文档变更至少检查 Markdown 链接、命令和描述是否对应当前文件及脚本。

## 模块职责

### `demo` 与 `examples`

`demo/` 是覆盖布局、特效、参数实验室和 benchmark 的综合开发面板，可以通过源码别名快速联调。`examples/` 是面向使用者的单场景代码，从正式包名导入并保持可独立阅读；它们不使用 workspace、不发布为独立包，也不进入核心运行时。

新增集成示例时应保持目标单一、显式销毁 Stage 和外部资源，并将其纳入 `tsconfig.examples.json` 与 `build:examples`。真实 tgz 消费仍由 `pack:check` 负责，不能用 workspace 软链接替代。

### `src/core`

`MotionStage` 是公共门面，负责生命周期、公开 API 和帧提交；`StageRenderHost`
唯一拥有 WebGL 环境，`StageContentCoordinator` 管理数据，`StageMotionCoordinator`
管理布局/特效/聚焦用例。精确拾取、聚焦布局、Effect 入场和 Extension Host 属于
低频动态模块，不应重新进入 Core 基础 entry。`Timeline` 负责编排串行步骤。
公共契约放在 `types.ts`，通用插值放在 `math.ts`。

修改这里时重点检查：快速连续调用的竞态、中断旧动画、销毁后的行为、页面可见性、ResizeObserver 和事件监听器清理。
布局过渡的 `from` / `target` Buffer 由 `StageMotionCoordinator` 长期持有；修改
切换顺序时必须保证先同步解析当前帧、再取消旧 Motion、最后覆盖目标工作区。
Renderer 仍必须同步消费传入视图，不能跨下一次 Stage 提交保存可变 Buffer。

### `src/layouts`

布局是无渲染依赖的计算模块：根据数量和 `LayoutContext` 返回 `Transform[]`，或通过
`calculateInto()` 直接写入可复用的 SoA `TransformBuffer`。八个内置布局全部直接
使用 Buffer 路径；新增内置布局也必须如此。仅面向低频自定义布局的便利实现可以
返回数组。新增布局应：

1. 实现稳定的 `Layout` 契约。
2. 对 `count = 0`、单个元素和常见大量元素提供有限数值。
3. 在 `src/layouts/index.ts` 导出。
4. 在 `layouts.test.ts` 覆盖数量、有限值、几何特征和朝向。
5. 按需加入 demo、README 和公共入口示例。

### `src/effects`

特效描述持续变化的 GPU 路径，必须复用固定实例池，并遵守 `maxActiveItems` 与质量
档位限制。CPU 首帧、fallback 和拾取通过 `calculateInto()` 写入调用方 Buffer；
`prepare()` 在 count 不变时复用路径、速度和参数 TypedArray，禁止逐项临时数组。
新增特效不得为切换新建 Mesh 或 Draw Call，并需覆盖配置边界、容量复用和更新行为。

### `src/renderers`

渲染器负责批量协议、实例缓冲、Shader、纹理图集、拾取边界和 GPU 资源释放。只有 `renderers/cards` 与 `renderers/points` 是稳定公共子路径，其余文件保持内部。

修改这里时要重点验证：单 Draw Call、Buffer 更新频率、纹理图集复用、图片异步加载失效后的释放、拾取遮挡规则和 `destroy()` 后资源状态。

### `src/performance`

性能模块负责质量档位、自适应升降级和基准采样。修改阈值时必须同时考虑降级响应、恢复迟滞、后台页面、异常长帧以及手动质量锁定，并同步 README 中的档位表或说明。

## 公共 API 与包发布

这是 ESM-only 包。源码相对导入使用 `.js` 后缀，即使源文件是 `.ts`。Three.js 保持 external 和 peer dependency，不能打入库产物。

新增或调整公共 API 时逐项检查：

1. 实现模块自身的 `index.ts`。
2. 必要时更新 `src/index.ts`。
3. 若新增稳定子路径，更新 `vite.lib.config.ts` 和 `package.json#exports`。
4. 更新 README 的使用说明。
5. 扩展 `scripts/verify-package.mjs` 的运行时和类型消费者检查。
6. 运行 `npm run pack:check`，确认深层内部路径仍不可导入。

当前自动化硬预算按真实消费者产物执行：根入口 gzip 不超过 40 KB、Core-only 不超过 16 KB、Cards-only 不超过 10 KB；按需模板、Points Renderer 与 Dev 诊断入口各不超过 12 KB，npm tarball 不超过 150 KB，仅消费布局的 Tree Shaking 产物不超过 8 KB。Three.js 在这些消费者中保持 external。各 ESM 输出模块分别 gzip 后相加的数值只用于诊断模块增长，不代表网络下载量，也不单独阻断构建。预算变化属于需要明确讨论的工程决策。

npm tarball 只携带运行时 `dist`、README、CHANGELOG、LICENSE、PUBLIC_API 和 COMPATIBILITY。ROADMAP、DEVELOPMENT、OPTIMIZATION、RELEASE、VISUAL_QA 与 examples 保留在源码仓库，不增加安装包体积。

本地 `dist` 会生成声明映射便于源码跳转，但 npm tarball 排除 `.d.ts.map`；类型声明和 JavaScript source map 仍随包提供。该发布裁剪属于包体积控制，不应通过提高 150 KB 预算替代。

准备冻结的首版入口记录在 `docs/PUBLIC_API.md`。`core`、逐布局、Cards、Points 与 `card-template` 都必须通过真实消费者验证；包检查执行根入口/Core-only/Cards-only 以及各按需入口的独立 gzip 门禁。正式发布严格按照 `docs/RELEASE.md` 执行；准备发布的代码变更不自动授权 npm publish、tag 或 GitHub Release。

## 测试策略

- 布局和数学逻辑优先使用纯单元测试。
- 生命周期测试要覆盖初始化、运行、中断、更新和销毁。
- 异步测试要证明旧请求不会覆盖新状态，且失效资源被释放。
- 性能管理测试使用可控时间/样本，不依赖真实机器即时帧率。
- DOM/WebGL 难以在 Node 中直接证明的行为，在单元测试之外使用 demo 或包消费者构建做冒烟验证。

测试环境目前为 Node。若引入浏览器测试工具，应先明确它解决的缺口，不要把易于单元测试的逻辑全部迁入重量级端到端测试。

## 性能验证

涉及渲染循环、实例上限、Shader、纹理或质量策略的变更，应启动 `/benchmark.html`，至少比较一个变更前后都能复现的场景，并记录：

- 实例数量与质量模式；
- FPS 与平均帧时间；
- P50/P95/P99、24/33/50ms 长帧和异常帧；
- 渲染/可见/特效活跃实例数；
- Draw Call、三角形和纹理图集内存；
- Stage CPU、WebGL 提交、图集构建/patch、图片加载和估算纹理上传；
- 设备、浏览器和采样时长。

优先使用 steady、cold-start、atlas-update、interaction-stress 与 transition-stress 五类固定场景，并导出完整 JSON。`interaction-stress` 用于本地浏览器验证高频指针事件合帧；`scripts/benchmark-presets.json` 继续固化跨 100/500/1000/2000 实例和 low/medium/high/auto 质量的六组 CI 配置。CLI 的 `--preset` 会同时校验基线和当前结果。比较优化前后结果时，实例数、质量、布局、场景和环境应一致；`compareBenchmarkResults()` 会标记配置是否可直接比较，`evaluateBenchmarkRegression()` 和 `benchmark:compare` 可进一步按方向感知阈值产生 CI 退出码。基准 JSON 必须先通过 `parseBenchmarkResult()`，不要把结构不完整的手写对象作为性能证据。

性能结果会受设备与浏览器影响，所以不要只报告一个孤立 FPS 数字，也不要以降低视觉数量之外的指标来掩盖退化。

跨设备校准使用 `npm run benchmark:matrix`。默认采集 500/1000/2000 项的
high/medium/low steady 矩阵；准备调整默认档位时增加
`--scenarios steady,transition-stress --duration 10 --headed`。结果写入
`benchmarks/results`，按 GPU、视口和 DPR 隔离，不把 SwiftShader、无头调度或不同
分辨率的数据合并。建议门限与 `AdaptivePerformanceManager` 的默认降级条件保持一致，
但自动建议不能替代目标设备上的视觉和长时间压力验收。

分析动态 import、Worker 启动或首次 chunk 求值时增加 `--preview` 并使用未占用端口。采集器会先执行生产
构建，再启动静态 preview 服务，并在矩阵元数据写入 `serverMode: "preview"`；默认开发
模式记录为 `development`。不要直接比较两种 server mode 的绝对 cold-start 数字。

长时间稳定性使用 `--preview --stability --duration 60|300|1800`，transition-stress 验证
布局/Effect/局部更新，atlas-update 验证高频内容 patch。采集器保留完整原始样本，只以
后半段判断收敛后的 heap、DOM、Canvas、GPU/纹理容量、Geometry build 和失败趋势；
失败结果仍写入 JSON，进程退出码为非零。正式发布证据至少运行 300 秒，30 分钟用于
候选版本或资源所有权改动后的 soak，20 秒仅作为本地 smoke。

提交设备结果前运行 `npm run benchmark:coverage` 查看缺口；准备发布基线时运行
`npm run benchmark:coverage -- --strict`。设备匹配与场景要求集中维护在
`benchmarks/device-targets.json`，不要通过改名或手工汇总把不同 GPU、浏览器、平台和
源码状态的证据混为一组。dirty 或缺 SHA 的采集只用于开发判断。

## 文档维护

- `README.md`：已经实现、可供使用者依赖的能力。
- `ROADMAP.md`：阶段目标、当前重点、候选计划和非目标。
- `AGENTS.md`：长期稳定的开发代理约束。
- `CLAUDE.md`：Claude Code 的轻量入口，避免复制主规则。
- 本文：可执行的开发和验证流程。

计划尚未确定时使用“候选”或“待确认”，不要把想法写成承诺。完成路线图项目时，应提供对应代码、测试或发布证据后再勾选。
