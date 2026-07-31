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
├── StageMotionCoordinator Layout、Effect、Focus 和恢复用例编排
├── StageClock / Rotation Stage 时间等待与主体旋转
├── RendererStateCoordinator setItems 后的渲染状态统一恢复
├── QualityController     档位、Profile 和自适应性能状态
├── MotionController      可中断布局过渡
├── EffectController      特效准备、Renderer 协商和时钟
├── ItemCoordinator       稳定 id、Patch 合并和异步 revision
├── InteractionController Hover 合帧、键盘焦点和拾取竞态
├── ProjectedItemPicker   按需加载的精确投影拾取内核
├── FocusLayout           按需加载的聚焦布局构造
├── StageEffectEntry      按需加载的 Effect 入场编排
├── ExtensionHost         按需创建的外部 Three.js 扩展运行时
├── CompiledRendererRuntime 一次校验后的稳定 Renderer 方法表
└── MotionRenderer        批量渲染能力协议
```

`MotionStage` 是面向使用者的门面，只保留公共 API、生命周期和帧提交；
`StageMotionCoordinator` 负责需要 Motion、Effect、Quality 与 Renderer 协作的用例，
不应重新把这些分支放回 Stage。
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

Renderer 的 Transform 契约直接使用 `TransformBufferView`。视图只保证在当前同步
调用期间有效；内置 Cards 直接上传到既有 Attribute，Points 复制到自有容量 Buffer。
完全自定义 Renderer 可以按同一原则复用 GPU/TypedArray 容量，不需要接收或还原
每项 Transform 对象。

Renderer 通过可异步的 `streamingEffects.enable()` 协商特效 program key。Core
只管理进入、退出、generation 和时钟，不读取 Renderer 私有 payload，也不假定
自定义 Renderer 支持内置 Cards Shader。

`MotionRenderer` 的公开 capability 在构造期只校验一次并编译为内部稳定方法表。
Stage 热路径只调用已解析的方法，不逐帧执行可选链或重新探测 capability；自定义
Renderer 仍只需实现它实际支持的公开能力。

`resourcePreparation.prewarm()` 是通用的显式准备边界。Stage 只传递纹理开关和
Renderer 私有 Program kind，不读取 Cards 实现；销毁后完成的异步准备不得发布。

### Effect

Effect 通过 `calculateInto()` 把确定性的 CPU 首帧、fallback 与拾取状态直接写入
EffectController 拥有的复用 `TransformBuffer`，并提供
`{ kind, activeCount, payload }`。Cards 通过受约束的 Effect Program 处理 payload；
四个内置 Program 使用彼此独立的动态 chunk，首次进入对应 kind 时才加载并缓存。
其他 Renderer 可以定义自己的 key。
能力不匹配或 Program 准备失败时 Stage 固定降级为静态首帧并发出 `effecterror`。

内置 Effect 的路径与速度 payload 在 count 不变的质量重配中保持同一 TypedArray；
路径字段使用标量写入，不为每个实例创建临时数组。EffectController 的 CPU Buffer
在入场、活动采样和 reduced-motion 之间复用，调用方只能同步消费返回视图。

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

Cards patch 使用有界 Workspace 租约保存规范化索引与并行指纹，异步 Atlas prepare
完成前独占租约，commit/discard 后统一归还。Stage 内容更新以共享 id 索引继承状态，
并通过独立 TransformBuffer 租约池支持并发 latest-wins，避免每次完整更新分配快照。

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
`TransformBuffer`。八个内置 Layout 全部直接使用该路径，避免生成中间 Transform
对象；`calculate()` 仍是同一 v2 契约的便利形式。Stage 状态、稳定 id 重排、
MotionController 插值、Cards/Points Renderer 和精确拾取都直接消费同一 SoA
契约，不再经过公共 Transform 快照。过渡 scratch、Effect CPU Buffer 和 Renderer
Attribute 按容量复用，不在稳态帧循环分配 Transform 对象。

`StageMotionCoordinator` 固定持有一对 `from` / `target` 过渡工作区。新过渡先把
当前帧同步快照到 `from`，取消旧 Motion 后再原位计算 `target`；Renderer 必须按
同步消费契约立即上传或复制，因此后续中断可以安全复用同一对象和已增长容量。
Effect 入场失败或 Reduced Motion 时已经提交的 `target` 就是确定性静态首帧，
不再复制 Buffer 或重复调用 `setTransforms()`。

`defineLayout()` 在定义边界验证 count 与有限值；Stage 信任已定义 Layout，避免每次
切换重复扫描同一 Buffer。低频 `focusItems()` 的布局构造和 Effect 入场编排位于
独立动态 chunk；请求 generation 确保后发 Layout、数据更新或 destroy 能使尚未完成
的旧入口失效。

### Interaction

`InteractionController` 常驻 Core，只负责事件监听、每帧最新 pointer 合并、稳定 id
焦点索引和异步 generation。投影四边形、遮挡深度与 surface 正反面计算位于
`ProjectedItemPicker` 动态 chunk；首次显式 `pick()` 或 pointer 交互加载并等待
同一个缓存 Promise，非交互 Stage 不下载。加载完成后 pointer hover/click 直接同步调用已缓存内核，
并按 TypedArray 下标读取 TransformBuffer，不物化 Transform 对象；不在稳态交互路径
创建 Promise，也不增加 RAF 或 GPU readback。销毁和 pointerleave
会使尚未完成的冷启动结果失效。

### Extension Render Pass

`ExtensionHost` 不随基础 Stage 构造，首次 `addExtension()` 才加载并缓存。未使用
Extension 的消费者不下载扩展调度、诊断和节流实现；加载期间 destroy 不会挂载
Extension，多个并发添加共享同一 Host 初始化。

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
