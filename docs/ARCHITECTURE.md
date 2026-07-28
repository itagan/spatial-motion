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
├── RendererStateCoordinator setItems 后的渲染状态统一恢复
├── QualityController     档位、Profile 和自适应性能状态
├── MotionController      可中断布局过渡
├── EffectController      特效准备、Renderer 协商和时钟
├── ItemCoordinator       稳定 id、Patch 合并和异步 revision
├── InteractionController 拾取、Hover 和键盘焦点
├── ExtensionHost         隔离的外部 Three.js 内容
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
- 高频 pointermove 合并到 Stage RAF。
- 图集构建必须支持取消；失效结果不得覆盖新 revision。
- 质量下降先减少提交和可见数量，资源压缩不得阻塞当前帧。
- 生产入口不加载 Dev 诊断，Three.js 始终由应用提供。

`StagePerformanceStats` 明确报告 input、resident、submitted、visible 和
activeEffectItems。高级 Shader、后处理、多相机和 CSS3D 不进入默认 Core，应由
独立 Renderer 或 experimental backend 承担。
