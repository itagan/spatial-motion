# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。日期使用 `YYYY-MM-DD`。

## Unreleased

- Cards 新增受约束的 Motion/Effect Program；四个内置 GPU 特效迁移为按需动态
  chunk，自定义 Program 可声明私有 Attribute、Uniform、GLSL 和 payload 上传。
- `StreamingEffectGpuData` 收敛为 `{ kind, activeCount, payload }`，异步特效激活
  使用 generation 隔离竞态并通过 `effecterror` 报告失败。
- 新增内部 `StageRenderHost` 与 `RendererStateCoordinator`，统一 WebGL 所有权、
  context 恢复和 setItems 后的渲染状态恢复。
- Cards-only 消费预算收紧到 10 KB gzip；Atlas 引擎、Array Shader 和内置 Effect
  Program 均在需要时加载。
- Stage 内容更新/质量恢复、时钟、旋转和 Renderer 校验从 `MotionStage` 抽离；
  Cards 内部拆分 Geometry、Atlas 指标和 Program Loader，保持原有公共入口。
- Extension 稳态更新不再逐帧排序或创建 frame 对象，并新增 WebGL
  `contextLost` / `contextRestored` 生命周期。
- Effect Program 使用显式 `clockUniform` 绑定 Stage 时钟；瞬时 chunk 加载失败不会
  永久污染缓存，后续激活可以重试。
- Renderer capability 在构造期编译为稳定方法表，Stage 热路径不再逐帧探测可选能力。
- Cards 新增 `CardMaterialRuntime`、可取消的 Effect Program runtime，以及可替换
  `atlasBackend`；Atlas 与 Program 准备统一通过 latest-wins 资源调度提交。
- Layout 新增 SoA `TransformBuffer` 与 `calculateInto()`；Grid/Helix 直接写入生成
  缓冲，再由状态更新边界输出公共 Transform 快照。
- Extension 新增确定性的 `beforeRender` / `afterRender` 和 `updateBudgetMs` 节流，
  并报告 render hook、预算超限与节流指标。
- Cards 布局切换改为直接写入复用的 TypedArray，不再为每项 position/quaternion
  创建短命数组；Attribute 更新范围也不再创建临时集合。
- 默认 Atlas backend 实现从基础 Cards 入口拆为首次图集请求时加载的独立 chunk；
  自定义 backend 不下载默认 Canvas/Worker backend。
- Renderer capability 编译结果收敛为纯方法表并只保留运行期需要的 patch 标记，
  继续降低 Core 固定成本。
- Cards 的 Effect Program Loader、生命周期、缓存和材质切换改为首次特效或显式
  Program 预热时加载；基础 Cards 与仅纹理预热不下载 Effect Runtime。
- Array Atlas 的 `layerUploadFrames` 改为只统计当前 Atlas 上传 generation；新增
  `totalLayerUploadFrames` 保留渲染器生命周期累计值，重建、context restore 与销毁
  不再把历史上传帧误报为当前资源成本。
- Atlas 诊断新增当前 CPU/GPU 常驻像素、当前构建 TypedArray 峰值与生命周期最大峰值；
  默认 Array Worker 的 readback 批次由 8 MiB 收紧到 2 MiB，降低默认 2000 项构建峰值。
- Worker 不可用以及 `drawCard`/`cardContent` 路径改为在主线程直接分页栅格化 Array
  Atlas；默认、模板、自定义 Canvas 分别使用 4 MiB、1 MiB、512 KiB 临时批次上限，
  准备会话跨批复用图片与内容，并移除完整 2D readback 到最终 array 的双缓冲。
- 主线程 Array 栅格使用 8ms/最多两批的可取消 RAF 时间片；当前构建与生命周期累计
  让出指标分离，防止大图集 fallback 在同一任务内形成长帧。
- 模板与自定义 Canvas 的完整 Array 构建改为顺序复用单个隔离单元 Canvas，绘制后立即
  合入当前批次；异步回调、异常回退与取消语义保持不变，局部 patch 仍返回独立 Canvas。
- Benchmark 新增 `default`、真实 ES6 模板与自定义 Canvas 内容模式、同步截图采集和像素
  有效性门禁；浏览器回归同时约束内容正确性、临时像素峰值与主线程响应性。
- Single/Array 局部 patch 现在把 Canvas readback 计入 `atlasReadbackMs`；需要立即读回的
  独立单元 Canvas 使用 `willReadFrequently`，真实模板/Canvas 连续更新门禁同时约束
  patch 次数、读回成本、长帧与视觉有效性。
- 默认 Worker 的 Array 批次 OffscreenCanvas 启用读频繁提示，降低冷启动 build/readback；
  Worker Single 和主线程批次保持原上下文策略，避免软件绘制导致 fallback 构建回退。
- Benchmark v1 向后兼容地新增可选 `atlasArrayPackMs`，区分 Array 页面翻转/行复制与
  Canvas readback；实测 pack 仅占默认冷启动约一成，因此保持现有零额外缓冲算法。
- Worker 协议、Renderer 指标与 Benchmark v1 新增可选 `atlasWorkerRenderMs` 和
  `atlasWorkerRoundTripMs`；正式冷启动数据表明启动、调度与传输差值不足 5ms，因此
  保持一次性 Worker、失败回退和转移所有权语义，不引入常驻 Worker。
- Worker Array 的 2 MiB 批次在 5000/10000 项全量 High 下继续完整上传；相对 4 MiB
  对照，readback 分别降低约 32%/22%，未引入容量自适应分支或大规模构建回退。
- 质量矩阵终端摘要和运行诊断现在显式报告 resident/submitted 与请求项数，避免把质量
  Profile 裁剪后的大输入误读为全量 Atlas 扩展性结果。
- 默认 Worker Array 批次改为单列连续页面，绘制阶段预翻转页面后按层连续复制，避免
  pack 的逐层逐行翻转；2000/5000/10000 项均降低 Worker 内部耗时且保持 patch 契约。
- Renderer 与 Benchmark v1 向后兼容地新增最后一次完整 Atlas build 的精确分段快照；
  cold-start 可区分目标构建与累计 delta，无完整构建的 steady/update 窗口输出 0。
- Worker 冷启动诊断进一步区分 Runtime 加载、Worker 构造、请求准备与发送前墙钟；
  默认路径在保留 Runtime lazy chunk 的同时并行启动 Worker，Apple M4 三轮 2000/high
  cold-start 的 Atlas build 中位数由 43.2ms 降至 40.6ms。
- 质量矩阵采集器新增 `--preview` 生产构建模式，并在输出中记录 `serverMode`；动态
  import/Worker 冷启动不再把 Vite 开发服务器的按需 transform 当作浏览器运行时成本。
- 质量矩阵新增 `--stability` 长时间门禁：保存 JS heap、DOM/Canvas 与 Renderer 资源
  趋势，在预热后的稳定窗口检查 GPU/纹理/Geometry 增长、资源失败和 context loss。
- 新增版本化跨设备目标清单与 `benchmark:coverage`：自动匹配浏览器、平台、GPU、规模、
  场景和长稳结果，区分正式、dirty 开发与缺失证据，并提供严格 CI 退出码。
- Renderer 诊断指标上限由 64 扩至 96，确保 Cards 的 Program 与资源失败计数不会被
  Atlas 指标截断；长稳 v2 判定拒绝缺少必要样本或关键计数的历史证据。
- Benchmark 页面新增真实设备证据导出；`benchmark:import-device` 校验浏览器、矩阵和时长，
  校验构建指纹与当前代码 SHA，并在仓库端生成 v2 稳定性与质量校准结果，支持 Android/iOS
  实机闭环且拒绝旧缓存或错版本 capture。

### Added

- 新增独立 `QualityController`、可覆盖质量 Profile/自适应参数、类型化 `stage.on()`
  事件和开放式 Renderer effect key 协商。
- `LayoutContext<TMeta>` 新增当前可见 items 与质量档位，自定义布局可直接使用业务
  meta 生成数据驱动布局。
- 新增内部 `EffectController`，统一拥有特效准备、Renderer 激活、暂停时钟、质量
  重配、恢复和低动态结算。
- Sphere 新增 `fit: 'contain'`、`viewportPadding`、`startAngle` 和 `edgeFade`，参数实验室的经典头像球体默认完整适配视口、避开精确极点并启用轻量轮廓淡出。
- 卡片增加图片定位、多行标题、逐卡样式和统一宽高比，并收口为稳定 `cardsRenderer()` 配置。
- 新增按需 `card-template` 入口、`html` tagged template、`defineCardTemplate()` 和受控 HTML/CSS 子集；模板图片复用 Atlas 资源管线。
- `MotionRenderer` 成为稳定 Core 契约，新增 `core`、Cards、Points 和逐布局按需入口。
- 新增 `defineLayout()`，为自定义布局提供冻结对象与 Transform 输出验证。
- 新增按需 `dev` 入口，可验证自定义 Renderer/Layout 并生成批量边界、法线和顶部方向调试对象。
- 新增只使用稳定入口的 `custom-renderer-layout` 案例：业务 Layout 直接写入 SoA
  Buffer，自定义单批次 Renderer 负责 GPU 过渡、质量裁剪、统计和幂等资源释放；
  真实 tgz 消费者会运行同类协议并对公共子路径执行冻结白名单检查。
- 新增仓库级 `benchmark:matrix` 采集器和质量校准测试；按 GPU、视口与 DPR 隔离
  high/medium/low 证据，并使用默认自适应降级边界生成最高稳定档建议，不新增包导出。
- Benchmark Atlas 指标新增 prepare、图片墙钟、单元绘制和像素 readback 分段耗时，便于定位冷启动瓶颈。
- Cards `resolution` 新增 `'auto'`，内置默认卡片超过 1024 项时使用 48px；新增 `mipmaps` 开关及实际分辨率/mipmap Renderer 指标。
- 默认图片卡片可将去重后的图片转换为可转移 `ImageBitmap`，在 OffscreenCanvas Worker 中完成首次 Atlas 绘制与 readback；Benchmark 同步报告位图解码和纹理预热成本。
- Cards 新增 `atlasMode: 'single' | 'array' | 'auto'`。可选 Texture2DArray 路径使用自适应分页和逐帧分层上传；`auto` 仅在关闭 mipmap 且完整图集像素不小于 16 MiB 时启用。

### Fixed

- Canvas 的 CSS 尺寸现在始终跟随 Stage 容器，避免高 DPR 设备把内部像素尺寸当作布局尺寸，导致画面放大、偏移和裁切。
- Sphere `surface` 朝向现在让每张卡片的法线精确对齐球面外法线；默认球体与经典 Demo 预设也改用完整球面贴合朝向，`upright-surface` 仍可显式选用。
- Sphere `surface` 卡片的顶部统一朝向球面北极，避免头像随经纬度发生无规则滚转或倒置。
- 质量下降保留已有 resident pool，只立即降低 submitted/visible 比例，避免承压时
  重建 Atlas；从低档启动后升级才异步扩展 resident pool。
- Cards/Points 现在按容量桶复用 Geometry、Material、过渡 Attribute 和 TypedArray；Atlas 相邻单元合并上传范围，模板复用有界文字测量结果。
- 稳态布局与交互读取直接复用 Stage 持有的 Transform 快照，Stage wait 直接遍历现有集合；高频 `pointermove` 合并到 Stage 下一帧并只拾取最新坐标，避免 hover、pick 和每帧计时产生重复工作或临时数组。
- Atlas 默认卡片首次构建直接写入整图 Canvas，不再创建逐卡临时 Canvas 或执行逐卡 `drawImage`；`DataTexture` 直接复用整图 `ImageData` 像素缓冲，移除同尺寸 `Uint8Array` 二次复制。
- 256 项以上的内置默认卡片会在支持时把首次 Atlas 栅格与 readback 移入 OffscreenCanvas Worker；重复图片 URL 只转移一份 `ImageBitmap`，中止、转换失败和不支持 Worker 时安全回退主线程并复用已加载图片。模板、自定义 Canvas 与局部 patch 保持原路径。
- Cards 可自适应预热首次 Atlas 纹理上传；默认仅预热不超过 16 MiB 的像素缓冲，避免大图集预热本身形成长帧，也可通过 `texturePrewarm` 显式覆盖。
- Cards 的稳定内容指纹改为逐项保存；局部 `updateItem(s)` 只序列化去重后的变化索引，不再为单卡 Atlas patch 扫描完整名单。
- Array Atlas 根据设备层数限制和项目数量选择平衡页尺寸，最多规划 256 层；首次约 3 MiB、后续每帧约 768 KiB 的上传预算避免大纹理一次提交，context restore 会从首层重新协调。
- 默认卡片的 Array Worker 改为最多约 2 MiB 的平衡分页批次直接绘制和 readback，不再同时保留完整 2D Atlas 像素与最终数组缓冲。
- 指针拾取改为固定向量/屏幕缓冲、保守投影粗筛和在线最佳命中选择，不再为每项创建角点/候选对象或排序；焦点 id 同步使用稳定索引。
- Array Atlas 的首次分层上传与局部 patch 统一受每帧预算协调；连续更新按层去重，尚未显示的层只更新 CPU 数据并在首次可见时上传最新内容。
- Worker 请求在注册中止监听器前会再次检查已中止的 signal，避免图片解码结束与发送之间
  的竞态留下悬挂 Promise；Client/Runtime 的 Worker 与 ImageBitmap 所有权保持单次释放。
- Single Atlas 局部 patch 改为按卡片行扫描连续上传 run，移除逐像素行 Map、数组和区间对象；单卡更新同时跳过无意义的 cell 列表复制与排序。

### Compatibility

- 未发布事件 API 直接重构：删除 `MotionStageOptions` 的单回调字段和 `stage.off()`，
  统一使用 `stage.on()` 返回的取消订阅函数；仅需要 hover 事件时显式设置
  `hover: true`。
- anti-bundling 检查改为逐模块 64 KB 上限并继续验证 Three.js 外置，避免内部模块
  拆分数量影响诊断；真实 root 40 KB、
  Core 16 KB、Cards 10 KB gzip、layout-only 8 KB 和 tarball 150 KB 为当前产品预算。
- 发布构建改用 Terser 保持既有 40 KB gzip 预算；本地继续生成隐藏 JavaScript source map，但 npm tarball 不再携带 `.js.map`，类型声明和运行时导出不变。
- 主库继续受 40 KB gzip 门禁约束，模板与 Points 入口分别限制为 12 KB；Cards `content` 与 `draw` 互斥。
- Vanilla 卡片示例将内容配方与 `1:1`、`3:4`、`16:9` 比例拆分，产品、人物和指标展示明确为可复制源码而非公共预设，并可展开复制当前 ES6 或 Canvas 写法；旧 `card=` 演示链接继续映射到新参数。
- 未发布 API 直接收敛：`MotionStage` 强制显式传入 Renderer，删除 Symbol 注入、实验入口、Cards Stage 字段及旧特效/布局别名。
- `MotionItem<TMeta>`、`MotionStage<TMeta>`、Renderer 与回调统一泛型 meta；性能统计拆分为通用 `render` 与 `renderer`。
- 构造期 `items` 现在实际进入 Renderer，并通过 `stage.ready` 暴露初始化完成状态。
- `LayoutContext` 统一为 `itemWidth/itemHeight`，不保留 `cardWidth/cardHeight`。
- 未发布数据契约收紧为只读 `MotionItem`、`Transform` 与 Renderer/Layout 输入数组，不保留可变签名。
- 包体积门禁改为真实 root/Core-only/Cards-only 消费者构建；分模块 gzip 总和继续输出为诊断信息，不再误作实际下载体积。
- 默认 Atlas 仍为支持 mipmap 和细粒度 patch 的 `single`；Array Store、GLSL3 Shader 与 Texture2DArray 代码只在显式或自动选中时动态加载，不进入默认 Cards 消费路径，也不增加主体 Draw Call。
- Renderer 新增可选 `frame.update()` 能力，Stage 每个活动 RAF 调用一次；不声明该能力的 Renderer 行为不变。

## 1.15.0 - 2026-07-19

可取消动画控制、统一 Timeline 时钟和键盘交互。

### Added

- 新增 `startTransition()`、`StageTransitionHandle`、结构化完成原因和 `getTransitionState()` 进度查询。
- `TransitionOptions` 增加 `AbortSignal`，并保持现有 `Promise<boolean>` 调用兼容。
- Stage Timeline wait 改用暂停感知时钟，destroy 会终止等待和后续步骤。
- 新增 Canvas 方向键/Home/End 导航、Enter/Space 激活、`onItemFocus`、`focusItem()`、`getFocusedItem()` 和动态 aria-label。

### Compatibility

- `to()`、`focusItems()`、`restoreLayout()` 与 `enterEffect()` 继续返回 `Promise<boolean>`；句柄 API 为新增选择。
- 直接构造的 `Timeline` 继续使用普通计时器，只有 `stage.timeline()` 绑定 Stage 时钟。
- 键盘导航默认开启，可通过 `keyboardNavigation: false` 恢复不可聚焦 Canvas。
- npm tarball 排除仅供声明源码跳转使用的 `.d.ts.map`，保留 `.d.ts` 和 JavaScript source map，在不提高 150 KB 预算的前提下容纳新增 API。

## 1.14.0 - 2026-07-19

图片加载和纹理图集异步管线优化。

### Added

- `MotionStageOptions` 增加 `imageConcurrency` 和 `imageCacheSize`，默认每 Stage 6 个并发请求和 128 项有界缓存。
- 单次图集操作按 URL 去重，跨增量更新复用已完成图片。
- 新图集操作和 Stage destroy 使用 `AbortSignal` 中止失效图片请求。

### Compatibility

- 默认绘制、图片超时和 CORS 回退行为不变；缓存仅保留成功完成的图片。
- 缓存属于单个 Stage 并在 destroy 时释放，不引入全局图片状态。

## 1.13.0 - 2026-07-19

性能基准结果校验与自动回归门禁。

### Added

- 基准结果增加 `version: 1`，新增 `parseBenchmarkResult()` 严格解析外部 JSON。
- 新增方向感知的 `evaluateBenchmarkRegression()`、默认阈值和结构化失败报告。
- 新增 `benchmark:compare` CLI，支持六组固定规模/质量/场景预设、自定义阈值、JSON 输出及 CI 退出码。

### Compatibility

- `parseBenchmarkResult()` 继续接受 v1.12 及更早未带 version 的完整基准结果，并归一化为 version 1。
- `compareBenchmarkResults()` 的现有指标和配置兼容判断不变。

## 1.12.0 - 2026-07-18

Stage 单帧循环与暂停感知动画时钟。

### Changed

- 布局过渡不再创建独立 `requestAnimationFrame`，改由 Stage 主循环推进，卡片、过渡、流式特效和 extension 共享唯一 RAF。
- 手动暂停、页面隐藏和 WebGL context loss 现在同时冻结布局过渡与流式特效时钟，恢复后从当前画面连续播放。
- 新操作中断或 Stage 销毁会立即以 `false` 结算活动过渡，不再等待一个残留浏览器帧。

### Compatibility

- `to()`、`focusItems()`、`restoreLayout()` 和 `enterEffect()` 的签名及成功/中断返回值不变。
- 正常前台播放的时长和 easing 保持兼容；变化仅涉及暂停期间不再消耗动画时间。
- 没有新增依赖、公共入口或 Draw Call，Three.js 继续作为 peer dependency。

## 1.11.0 - 2026-07-16

Stage extension 运行时控制、设备联动和逐扩展诊断。

### Added

- `StageExtensionHandle` 增加幂等 `enable()`、`disable()` 与 `enabled`，停用时隐藏根节点并停止 update，但不释放资源。
- `StageExtension` 增加确定性 `order`、`qualityChange()` 和 `reducedMotionChange()` 可选生命周期。
- 新增 `StageExtensionStats` 与 `MotionStage.getExtensionStats()`，提供稳定 ID、状态、平均/P95/P99/最大 update 耗时、慢帧和错误历史。
- Benchmark JSON 与面板增加逐扩展诊断；Demo 和独立 Three.js/GSAP 示例增加启停、质量与低动态适配。

### Compatibility

- 未指定 `order` 的扩展使用 0，同 order 保持挂载顺序；旧扩展的运行顺序和默认启用行为不变。
- `disable()` 不触发 AbortSignal 或 dispose，`remove()` 与 Stage destroy 的释放语义保持不变。
- 故障扩展仍被隔离移除，最近 20 个已释放扩展只保留纯诊断快照，不保留 Three.js 或动画资源引用。

## 1.10.0 - 2026-07-16

单包仓库内的独立集成示例与构建验证。

### Added

- 新增 Vanilla 最小 Stage、原生 Three.js extension 和 GSAP extension 三个单场景示例。
- 新增 `dev:examples`、`build:examples` 和独立示例 TypeScript 配置。
- CI 与根级 `verify` 现在同时检查三个示例的类型和生产构建。

### Compatibility

- 继续保持单包仓库，不引入 workspace，也不改变核心源码位置、稳定导出路径或发布方式。
- `examples/` 不进入 npm tarball；GSAP 仍只属于开发和示例依赖。

## 1.9.0 - 2026-07-16

受控的外部 3D 内容与动画扩展。

### Added

- 新增 `StageExtension`、`StageExtensionContext`、`StageFrameContext`、`StageViewport` 与 `StageExtensionHandle` 公共类型。
- `MotionStage.addExtension()` 为每个扩展提供隔离 `Group`、只读相机、`AbortSignal` 和 mount/update/resize/pause/resume/dispose 生命周期。
- 新增 `onExtensionError` 错误边界，以及扩展数量和逐帧 update 耗时统计。
- Demo 增加原生 Three.js 与 GSAP 扩展示例；benchmark 可比较 NONE/NATIVE/GSAP/BOTH。

### Compatibility

- Stage 继续独占渲染循环，不开放内部卡片 Mesh 或 WebGLRenderer；主体卡片的单 Draw Call 保证不变。
- GSAP 仅为 Demo 开发依赖，不进入核心运行时依赖或发布产物。
- 未使用扩展的现有调用保持 v1.8 行为。

## 1.8.0 - 2026-07-16

高级布局生成与参数实验室扩展。

### Added

- Sphere 增加 latitude/Fibonacci 等面积分布、球冠/球带范围和极点包含策略。
- Cylinder 增加起始角、部分圆弧、显式行数、密度和 camera/surface 朝向。
- Ring 增加按面积/等量分配、交错开关和顺逆时针排序。
- Box 增加稳定的 `BoxFace` 类型、面选择、世界单位边缘留白和逐面权重。
- Cone 增加 `topRadius`，统一支持尖锥、圆台和等半径柱面。
- 参数实验室增加全部高级字段、互斥控制和对应预设。

### Compatibility

- 所有字段均为 `LayoutConfig v1` 可选字段；旧 JSON 和无参数布局保持可读取及默认视觉兼容。
- 严格配置拒绝 Fibonacci 与纬度圆环字段混用、Cylinder 行列同时指定、重复/空 Box 面和无效圆台半径。

## 1.7.0 - 2026-07-16

布局参数化与可序列化配置实验室。

### Added

- 版本化 `LayoutConfig` 联合类型，以及 `parseLayoutConfig()`、`createLayout()` 公共 API。
- 对八种布局配置进行字段白名单、枚举、有限数值和语义范围的严格运行时验证。
- Demo 右侧/移动端底部参数实验室，支持全部布局、自动字段、会话记忆、预设和防抖实时预览。
- JSON 导入导出、TypeScript 代码复制和 URL 配置恢复。

### Compatibility

- 直接使用 `sphere()`、`box()` 等布局函数的默认值与兼容行为不变。
- v1.7 不增加新的几何分布模式，也不包含流式特效参数面板。

## 1.6.0 - 2026-07-15

动画中断朝向与自适应质量迟滞优化。

### Changed

- CPU 当前帧变换采样对三个旋转轴使用最短角路径，快速中断时与 GPU 最短四元数插值保持相同方向。
- 自动降级同时参考平均 FPS、P95 帧时间和窗口内 33ms 长帧比例；恢复要求 FPS、P95 与长帧比例同时稳定。
- 自动质量仍保留采样窗口、恢复窗口和切换冷却，页面挂起与超过 100ms 的异常帧继续排除。

## 1.5.0 - 2026-07-15

现有流式特效的密度与质量切换连续性优化。

### Changed

- Tunnel、Linear Shooter、Vortex 与 Radial Burst 使用固定 seed 的低差异相位序列，活动前缀在周期内保持均匀分布。
- 质量档位改变活动上限时，保留实例不再重算相位或轨迹，只增减固定实例池的活动前缀。

## 1.4.0 - 2026-07-15

现有布局的密度、奇点和接缝视觉精修。

### Changed

- Sphere 与 Cone 在极点/顶点使用局部间距和留白系数，缓解曲面奇点处的卡片拥挤。
- Box 六个占用面共享卡片尺度，避免面切换处的尺寸跳变。
- Cylinder 每行独立闭合环绕，奇数行错开半个单元，不完整末行不再堆积在接缝一侧。
- Grid 的不完整末行在 fixed、contain 与 cover 模式下保持水平居中。

## 1.3.0 - 2026-07-15

GPU 提交、纹理局部上传与增量更新优化。

### Added

- 性能统计与 benchmark 增加实际提交实例数，区分实例池容量、GPU 提交量与可见量。
- 同一 JavaScript turn 内的稳定 id 卡片更新自动合并，重复 id 采用最后一次字段更新。

### Changed

- 图集改为 `DataTexture`，已初始化纹理的单元更新仅提交变化行；初始构建与 WebGL context 恢复仍安全回退为完整上传。
- 内置流式特效完成过渡后只提交连续活动实例，离开特效时恢复完整实例池，保持单 Mesh 和单 Draw Call。

### Fixed

- 连续补丁会累积待上传区间，避免同一渲染帧内后一次更新覆盖前一次更新范围。

## 1.2.0 - 2026-07-15

性能可观测性与可复现优化基线。

### Added

- 实时帧时间 P50/P95/P99、24/33/50ms 长帧计数与异常帧计数。
- Stage CPU、渲染提交、布局计算、拾取、图集构建/patch、图片加载和估算纹理上传统计。
- `getPerformanceEnvironment()`，记录浏览器、GPU、视口、DPR 和最大纹理尺寸。
- steady、cold-start、atlas-update 与 transition-stress 四类 benchmark 场景。
- 完整 Benchmark JSON 环境元数据、结果导入和 `compareBenchmarkResults()` 前后对比。

### Fixed

- 压力测试操作使用跨运行唯一标题，避免连续场景之间因数据相同而漏记图集 patch。

## 1.1.0 - 2026-07-15

视觉打磨与运行时加固版本。

### Added

- Stage 级默认过渡参数、`sineInOut` 缓动和 update API 的 easing 透传。
- `cardResolution`、`imageTimeout`、`onContextChange` 与 `contextLost` 性能状态。
- GPU 最大纹理尺寸自动收敛、mipmap、各向异性采样和图片加载超时回退。
- benchmark 的 500/1000/2000 固定规模、WebGL 状态和 60 秒至 30 分钟切换压力测试。
- Scatter 的稳定距离分层和 directional spin，并修复 billboard 导致 spin 不生效的问题。
- 可重复执行的视觉验收矩阵。

### Changed

- Tunnel、Linear Shooter、Vortex、Radial Burst 统一使用端点零速度运动曲线和双边淡出窗口。
- Burst 发射在周期开始与结束均平滑过渡，避免周期边界闪烁。
- WebGL context loss 会暂停渲染，恢复时重新上传图集并按原暂停状态恢复。

## 1.0.0 - 2026-07-14

首个稳定 API 版本。主体 WebGL 卡片场景继续使用单个实例 Mesh、固定实例池和 GPU 插值。

### Added

- `box()` 立方体/长方体六面布局，支持面积分配与 camera/surface 朝向。
- Tunnel 和 Linear Shooter 的 continuous、burst、wave GPU 发射节奏，以及 Tunnel 方形截面。
- 确定性 `scatter()` 布局与基于 Timeline 的演示配方。
- 响应式 `grid()` contain/cover、Reduced Motion 和 GPU 悬停高亮。
- 方形、圆角、圆形卡片样式，边框、背景与隔离的 Canvas 自定义绘制。
- `updateItem()`、`updateItemsById()` 稳定 id 局部图集更新。
- CHANGELOG、发布清单、公共 API 策略、浏览器支持和独立包消费者验证。

### Compatibility

- 默认布局、发射节奏和卡片形态保持既有视觉行为。
- 稳定入口固定为主入口、`layouts`、`effects`、`performance` 和 `package.json`。
- Three.js 保持 peer dependency；CSS3D 和框架适配器不属于 1.0 范围。

## 0.5.0 - 2026-07-14

- 建立 Typed ESM 构建、多子路径导出、Tree Shaking、体积预算和独立消费者验证。

## 0.4.0 - 2026-07-14

- 统一固定对象池流式特效、精确遮挡拾取、点击与聚焦。

## 0.3.0 - 2026-07-14

- 增加球体、圆柱、网格、圆环、螺旋和圆锥布局及连续变形演示。

## 0.2.0 - 2026-07-14

- 增加质量档位、自适应性能、页面可见性暂停和 benchmark 采样。

## 0.1.0 - 2026-07-14

- 建立 MotionStage 生命周期、动态数据、Timeline、拾取、资源释放和 CI 基线。
