# Spatial Motion 架构

Spatial Motion 采用“调度内核 + 能力协议 + 按需实现”的结构。它不是通用
Three.js 框架：Stage 负责一致的时间、数据和资源语义，具体画面能力由 Layout、
Renderer、Effect 和 Extension 组合完成。

## 设计目标

1. 基础场景不需要理解 GPU、图集、动画库或框架生命周期。
2. 自定义能力通过显式上下文和 capability 接入，不依赖继承或修改 Stage。
3. 稳态帧循环不创建 Transform、Tween、纹理或 GPU 对象。
4. 数据规模、GPU 驻留规模、提交规模和可见规模彼此独立。
5. 所有异步任务、监听器、RAF 和 GPU 资源都有唯一所有者并可终止。

## 运行时结构

```text
MotionStage facade
├── StageRuntime          RAF、暂停、页面可见性和 WebGL context
├── StageRenderHost       Scene、Camera、WebGLRenderer、Canvas 和能力
├── StageContentCoordinator 数据、Patch、质量扩容和特效恢复
├── StageContentState     items、Transform、Layout 与视觉状态
├── StageClock / Rotation Stage 时间等待与主体旋转
├── RendererStateCoordinator setItems 后的渲染状态统一恢复
├── QualityController     档位、Profile 和自适应性能状态
├── MotionController      可中断布局过渡
├── EffectController      特效准备、Renderer 协商和时钟
├── ItemCoordinator       稳定 id、Patch 合并和异步 revision
├── InteractionController 拾取、Hover 和键盘焦点
├── ExtensionHost         隔离的外部 Three.js 内容
├── CompiledRendererRuntime 一次校验后的稳定 Renderer 方法表
└── MotionRenderer        批量渲染能力协议
```

`MotionStage` 是面向使用者的门面，不应重新承载以上控制器已经拥有的状态。
新增能力优先成为控制器、Renderer capability 或 Extension 生命周期，而不是继续
增加 Stage 内部条件分支。

## 扩展边界

### Layout

Layout 是纯计算。`LayoutContext<TMeta>` 除视口和卡片尺寸外，还提供当前可见
`items` 和 `quality`，因此自定义布局可以按业务字段分组、排序和加权。Layout
不得创建 Three.js、DOM 或异步资源。

### Renderer

Renderer 独占主体批量对象和内容资源。核心方法负责数据、Transform、过渡进度
和提交比例；可选 capability 负责 Patch、视觉状态、拾取高亮、资源恢复、逐帧
更新和流式特效。

Renderer 通过可异步的 `streamingEffects.enable()` 协商特效 program key。Core
只管理进入、退出、generation 和时钟，不读取 Renderer 私有 payload，也不假定
自定义 Renderer 支持内置 Cards Shader。

`MotionRenderer` 的公开 capability 在构造期只校验一次并编译为内部稳定方法表。
Stage 热路径只调用已解析的方法，不逐帧执行可选链或重新探测 capability；自定义
Renderer 仍只需实现它实际支持的公开能力。

### Effect

Effect 提供确定性的 CPU 首帧/拾取 Transform 和
`{ kind, activeCount, payload }`。Cards 通过受约束的 Effect Program 处理 payload；
四个内置 Program 使用彼此独立的动态 chunk，首次进入对应 kind 时才加载并缓存。
其他 Renderer 可以定义自己的 key。
能力不匹配或 Program 准备失败时 Stage 固定降级为静态首帧并发出 `effecterror`。

### Cards Program

`defineCardMotionProgram()` 与 `defineCardEffectProgram()` 只允许声明私有前缀的
Attribute、Uniform、运动 GLSL 和上传函数。Atlas、过渡、Highlight、可见裁剪、
最终投影与 Material 生命周期仍由 Cards 公共管线负责。需要完整替换管线时使用
自定义 `MotionRenderer`，不通过 Program 绕过公共契约。

Effect Program 通过可选 `clockUniform` 显式声明由 Stage 驱动的 float Uniform，
Renderer 在 Material 创建时解析一次引用，逐帧不扫描 Program 定义。Program Loader
只缓存成功或仍在进行的加载；失败 Promise 会被移除，允许下一次激活重试。

Cards Renderer 内部由 Geometry、Atlas Metrics、`CardMaterialRuntime` 和 Program
Loader 分别承担实例缓冲、图集诊断、Material/Program 生命周期与动态实现选择。
Effect Program 可通过 `createRuntime()` 接管异步 prepare/restore、激活、逐帧更新
和释放，但只能通过受限 upload context 写入自身字段。Material、Attribute 和
TypedArray 继续按容量缓存，不增加 Mesh。

### Resource 与 Atlas

`ResourceScheduler` 为 Atlas build/patch 和 Effect Program 准备提供按 channel 的
latest-wins 提交屏障、AbortSignal 和同步 commit。异步 prepare 可以
并行，但只有仍拥有 channel 的任务能够发布；过期结果必须 discard。

Cards 默认使用延迟加载、支持 Worker 的 `DefaultCardAtlasBackend`。高级消费者可以
通过 `atlasBackend` 替换栅格、存储和上传策略，而公共 Renderer 仍拥有调度、纹理
切换、恢复和销毁语义。默认 backend 类本身也在首次图集请求时加载，不进入基础
Cards entry；传入自定义 backend 时不会下载默认实现。Backend 不能增加主体 Draw Call。

### Transform Buffer

Layout 可实现 `calculateInto(count, context, target)`，直接写入按容量增长的 SoA
`TransformBuffer`。内置 Grid 与 Helix 已使用该路径，避免生成中间 Transform
对象；旧式 `calculate()` 仍是同一 v2 契约的便利形式。Stage 当前在状态变化时把
Buffer 转为公共 Transform 快照，因此该路径先优化生成器内存，并为后续 Renderer
直接消费结构化缓冲保留边界；它不会进入稳态帧循环。

### Extension Render Pass

Extension 的 `beforeRender()` / `afterRender()` 在唯一 Stage scene submission 两侧
按 `order` 和挂载顺序执行，不获得 WebGLRenderer。`updateBudgetMs` 连续三帧超限时
跳过一帧 update 并累计 delta，防止单个外部动画长期挤占主体帧预算；渲染钩子耗时
与节流次数进入独立统计。

### Quality

`QualityController` 是质量状态的唯一所有者。应用可以覆盖三档 Profile 和自适应
采样参数。Profile 在创建 WebGLRenderer 前验证，非法的像素比、实例数量或目标
帧率不会进入运行期。

### Events

Stage 统一使用类型化多订阅事件。框架适配器、调试面板和业务模块使用
`stage.on()`，并保留返回的取消订阅函数；不再维护构造参数单回调的第二条路径。

## 性能约束

- Cards 和 Points 主体分别保持一个 Draw Call。
- 布局变换只在状态变化时计算，动画逐帧只更新进度 uniform。
- 流式特效只更新 Program 时间，Material、实例 Attribute 和 TypedArray 按容量复用。
- 布局切换直接标量写入复用 TypedArray，不为每项 position/quaternion 创建数组。
- 高频 pointermove 合并到 Stage RAF。
- Extension 顺序仅在增删时计算，frame context 和有界性能采样缓冲按实例复用。
- Renderer capability 只在构造期编译一次；Stage 热路径使用稳定方法表。
- Layout `calculateInto()` 使用 SoA 容量缓冲复用生成阶段内存。
- 图集构建必须支持取消；失效结果不得覆盖新 revision。
- 质量下降先减少提交和可见数量，资源压缩不得阻塞当前帧。
- 生产入口不加载 Dev 诊断，Three.js 始终由应用提供。

`StagePerformanceStats` 明确报告 input、resident、submitted、visible 和
activeEffectItems。高级 Shader、后处理、多相机和 CSS3D 不进入默认 Core，应由
独立 Renderer 或 experimental backend 承担。
