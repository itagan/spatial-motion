# 公共 API 与兼容策略

Spatial Motion 尚未发布。本文件记录准备冻结的首版边界；发布候选完成后再开始遵循 Semantic Versioning。

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
- `MotionItem<TMeta>`、`Transform`、Renderer/Layout 输入及更新索引使用只读契约；Stage、Cards/Points Resolver 和 item 回调共享同一泛型 meta。
- Factory 只获得隔离内容 `Group`、GPU 限制（含 `maxTextureSize`、`maxTextureLayers`）、受限纹理准备函数和 destroy `AbortSignal`，不能接管 Scene、Camera、WebGLRenderer 或 RAF。
- 核心协议负责数据、Transform、GPU 过渡进度、质量可见比例、统计和销毁；patch、visual、highlight、viewport、resource recovery、streaming effects 与逐帧 `frame.update()` 是可选能力。
- `descriptor.itemBounds` 支持 layout/camera quad、camera disc 或 `null`；`null` 关闭指针拾取但不影响布局与程序化 focus。
- `StagePerformanceStats.render` 报告场景 Draw Call/三角形；`renderer` 报告实例数、提交数、GPU 字节和有限 metrics。

## Cards 与模板

- `cardsRenderer()` 统一接收 `style`、`resolveStyle`、`draw`、`content`、`aspectRatio` 和 Atlas 图片资源选项；`resolution` 支持显式像素值或 `'auto'`，`mipmaps` 可关闭，`texturePrewarm` 可覆盖默认的小图集自适应预热策略。
- `atlasMode` 支持 `'single' | 'array' | 'auto'`，默认 `single`。`array` 使用无 mipmap 的 Texture2DArray 自适应分页与渐进上传；`auto` 仅在 `mipmaps: false` 且完整图集像素不小于 16 MiB 时选择 array。
- `content` 与 `draw` 互斥；卡片比例限制为 `0.25–4`，最长边归一为一个世界单位。
- `defineCardTemplate<TMeta>()` 返回 `CardContentRenderer<TMeta>`；模板只生成 Canvas 绘制树，不创建 DOM 或执行脚本。
- 产品、人物和指标卡是 Vanilla 源码配方，不是官方预设或单独公共入口。

## Layout

- `defineLayout()` 创建并冻结自定义 Layout，验证名称、枚举、count、返回数量和所有 Transform 数值。
- `LayoutContext` 只使用通用 `itemWidth/itemHeight`。
- `LayoutConfig` 当前格式版本为 `1`；`parseLayoutConfig()` 严格解析外部配置，`createLayout()` 创建内置布局。

## 性能与扩展

- Cards 与 Points 主体各保持单一批量对象；默认布局、过渡和质量裁剪不为每项增加 Draw Call。
- `dev` 导出 Renderer/Layout 验证报告和可挂载到 StageExtension 的布局方向可视化；error 不自动修正，重叠等启发式结果为 warning。
- 主库 40 KB gzip、模板/Points/Dev 各 12 KB、150 KB tarball 和 8 KB layout-only 是自动化硬预算。
- Stage extension 只能挂载隔离 Group，并负责释放自身 Geometry、Material、Texture 和动画资源。
