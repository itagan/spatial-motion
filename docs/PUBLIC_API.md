# 公共 API 与兼容策略

Spatial Motion 尚未发布。当前进入 v2 架构整理阶段，API 以清晰的职责和性能边界
优先，不为仓库内历史调用保留兼容层；发布候选冻结后再开始遵循 Semantic Versioning。

## 稳定入口

- `@itagan/spatial-motion`：便利聚合入口。
- `@itagan/spatial-motion/core`：`MotionStage`、Renderer 协议、核心类型、Timeline 和 extension。
- `@itagan/spatial-motion/renderers/cards`：`cardsRenderer()` 与卡片内容/样式类型。
- `@itagan/spatial-motion/renderers/points`：`pointsRenderer()`。
- `@itagan/spatial-motion/layouts` 与 `layouts/{sphere,cylinder,grid,ring,helix,cone,box,scatter}`。
- `@itagan/spatial-motion/effects`、`performance`、`card-template` 和 `package.json`。
- `@itagan/spatial-motion/dev`：按需开发诊断，不从根入口重导出。

未在 `package.json#exports` 中声明的 `src`、`dist` 和内部模块不可导入。旧 `experimental-renderer` 入口不存在。

## Core 与 Renderer

- `MotionStage<TMeta>` 强制接收 `renderer: MotionRendererFactory<TMeta>`，Core 不隐式创建 Cards。
- 构造参数提供 `items` 时通过 `stage.ready` 等待初始 Renderer 数据准备；后续数据使用 `setItems()` / `updateItem(s)`。
- `MotionItem<TMeta>`、Renderer/Layout 输入及更新索引使用只读契约；Stage、Cards/Points Resolver 和 item 回调共享同一泛型 meta。
- Factory 只获得隔离内容 `Group`、GPU 限制（含 `maxTextureSize`、`maxTextureLayers`）、受限纹理准备函数和 destroy `AbortSignal`，不能接管 Scene、Camera、WebGLRenderer 或 RAF。
- 核心协议负责数据、Transform Buffer、GPU 过渡进度、质量可见比例、统计和销毁；patch、visual、highlight、viewport、resource recovery、streaming effects 与逐帧 `frame.update()` 是可选能力。
- `setTransforms(buffer)` 与 `prepareTransition(from, to)` 强制接收
  `TransformBufferView`。视图包含 position/rotation 的三分量 Float32Array、
  scale/opacity 的单分量 Float32Array 和有效 `count`；Renderer 必须同步读取或复制，
  不得跨下一次 Stage 提交保存可变视图。需要自有持久状态时按容量复用 TypedArray。
- `TransformBuffer` 从 Core 与 Layouts 入口导出，供自定义 Renderer 测试、内部快照
  和 `calculateInto()` 使用；逐项写入使用 `setValues()`，容量从 TypedArray 长度读取。
- Renderer capability 在 Stage 构造期完成验证与编译；运行中修改 Renderer 方法不受
  支持。需要改变能力时创建新的 Renderer/Stage。
- `descriptor.itemBounds` 支持 layout/camera quad、camera disc 或 `null`；`null` 关闭指针拾取但不影响布局与程序化 focus。
- `stage.pick()` 返回精确命中的 Promise；投影拾取内核按需加载并在 Stage 内缓存。
  DOM hover/click 在内核预热后走同步热路径，冷启动结果受 destroy 和最新 pointer
  generation 保护。
- `stage.focusItems()` 的布局构造实现同样按需加载；调用本身保持 Promise 契约，
  加载期间 items 发生替换或 Stage 销毁时旧结果不会提交。
- `StagePerformanceStats` 明确报告 input、resident、submitted、visible 与 active effect 数量；`render` 报告场景 Draw Call/三角形，`renderer` 报告 GPU 字节和有限 metrics。
- `QualityController` 独立拥有模式、档位、Profile 和自适应采样器；Stage 接受
  `qualityProfiles` 与 `adaptivePerformanceOptions`，覆盖值在 Renderer 创建前验证。
- `stage.on()` 提供类型化多订阅事件并返回取消订阅函数，覆盖 item、quality、
  transition、context、extension error 和 `effecterror` 生命周期。
- Renderer 的 `streamingEffects.enable()` 可同步或异步协商开放式 effect key；
  `StreamingEffectGpuData` 仅包含 `kind`、`activeCount` 和 Renderer 私有 `payload`。
  不支持或准备失败时 Stage 使用确定性的静态首帧。

## Cards 与模板

- `cardsRenderer()` 统一接收 `style`、`resolveStyle`、`draw`、`content`、`aspectRatio` 和 Atlas 图片资源选项；`resolution` 支持显式像素值或 `'auto'`，`mipmaps` 可关闭，`texturePrewarm` 可覆盖默认的小图集自适应预热策略。
- `cardsRenderer()` 还接受 `motionProgram` 与按 kind 注册的 `effectPrograms`。
  `defineCardMotionProgram()` / `defineCardEffectProgram()` 验证私有字段前缀、GLSL
  入口、itemSize、初始值、重复字段和显式 `clockUniform`；四个内置特效默认可用
  但延迟加载。加载失败不会永久缓存 rejected Promise。
- Effect Program 可选 `createRuntime()`，用于一次性资源准备、context restore、
  activate/update/deactivate/dispose；所有异步操作都收到 destroy/切换可取消的
  `AbortSignal`，不得在失效后发布资源。
- `cardsRenderer({ atlasBackend })` 是高级 Atlas 后端入口。实现必须遵守
  prepare/build/patch/apply/advance/clear/dispose 契约；Renderer 继续负责 latest-wins
  调度、GPU 状态切换和幂等销毁。提供自定义 backend 时默认 Canvas/Worker backend
  不会下载；未提供时默认实现会在首次图集请求时加载。
- `atlasMode` 支持 `'single' | 'array' | 'auto'`，默认 `single`。`array` 使用无 mipmap 的 Texture2DArray 自适应分页与渐进上传；`auto` 仅在 `mipmaps: false` 且完整图集像素不小于 16 MiB 时选择 array。
- `content` 与 `draw` 互斥；卡片比例限制为 `0.25–4`，最长边归一为一个世界单位。
- `defineCardTemplate<TMeta>()` 返回 `CardContentRenderer<TMeta>`；模板只生成 Canvas 绘制树，不创建 DOM 或执行脚本。
- 产品、人物和指标卡是 Vanilla 源码配方，不是官方预设或单独公共入口。

## Layout

- `defineLayout()` 创建并冻结自定义 Layout，验证名称、枚举、count、返回数量和所有 Transform 数值。
- 高吞吐布局可以只实现 `calculateInto()`，从 `@itagan/spatial-motion/layouts`
  导入 `TransformBuffer` 并通过 `setValues()` 直接写入 SoA 缓冲；内置 Grid/Helix
  已采用此路径。普通布局继续实现 `calculate()`。
- `LayoutContext<TMeta>` 提供通用 `itemWidth/itemHeight`、当前可见 `items` 和质量档位，
  自定义布局可以按业务字段分组、排序或加权。
- `LayoutConfig` 当前格式版本为 `1`；`parseLayoutConfig()` 严格解析外部配置，`createLayout()` 创建内置布局。

## 性能与扩展

- Cards 与 Points 主体各保持单一批量对象；默认布局、过渡和质量裁剪不为每项增加 Draw Call。
- 质量下降保留已有 resident pool，只立即降低 submitted/visible 比例，避免设备已经
  承压时重建 Atlas；从较低初始档位升级时才扩展 resident pool。
- `dev` 导出 Renderer/Layout 验证报告和可挂载到 StageExtension 的布局方向可视化；error 不自动修正，重叠等启发式结果为 warning。
- 主库 40 KB、Core 16 KB、Cards 10 KB gzip，模板/Points/Dev 各 12 KB、
  150 KB tarball 和 8 KB layout-only 是自动化硬预算。
- Stage extension 只能挂载隔离 Group，并负责释放自身 Geometry、Material、Texture 和动画资源。
- Extension 的 `update(frame)` 会复用同一个只读 frame 对象，扩展不得保存或修改；
  `updateBudgetMs` 默认 4ms，连续三帧超限会节流一帧并把 delta 带到下一次 update。
  `beforeRender()` / `afterRender()` 围绕唯一 scene submission 确定性执行，不能提交
  第二个主体渲染循环；
  `contextLost()` / `contextRestored()` 用于重建自定义 GPU 资源。
