# 公共 API 与兼容策略

Spatial Motion 从 v1.0.0 开始遵循 Semantic Versioning。本文件描述使用者可以依赖的边界，不代表所有内部类和生成声明都属于公共 API。

## 稳定入口

以下包入口在 v1.x 内保持兼容：

- `@itagan/spatial-motion`
- `@itagan/spatial-motion/layouts`
- `@itagan/spatial-motion/effects`
- `@itagan/spatial-motion/performance`
- `@itagan/spatial-motion/package.json`

`src`、`core`、`renderers` 及 `dist` 中其他文件是内部实现。即使文件存在，也不能通过未声明的深层路径导入；`pack:check` 会验证这条边界。

仓库中的 `demo/` 与 `examples/` 是使用说明和验证资产，不属于 npm 包入口或 v1.x API 承诺；复制示例不等同于增加稳定子路径。

## v1.x 承诺

- 已公开的函数、类方法、选项和联合类型不会在 minor/patch 版本中无迁移方案地移除或改成不兼容含义。
- 新增可选字段、布局、特效和性能统计字段属于向后兼容变更。
- 缺陷修复可能纠正非法输入、竞态或与文档不符的行为，但默认视觉和合法调用应保持兼容。
- `MotionItem.id` 必须是非空、唯一、稳定的字符串；依赖数组索引维持身份从来不是受支持行为。
- Three.js 是 peer dependency，支持范围记录在 `package.json`；升级到超出范围的 Three.js 不在兼容保证内。
- `LayoutConfig` 当前格式版本为 `1`；新增可选配置字段兼容，未来不兼容的序列化格式使用新的版本号并提供迁移说明。

## 可序列化布局配置

- `LayoutConfig` 是 Sphere、Box、Cylinder、Grid、Ring、Helix、Cone 和 Scatter 的可辨识联合类型，从主入口与 `layouts` 入口导出。
- `parseLayoutConfig(value)` 接受未知对象或 JSON 字符串，严格验证顶层字段和布局选项，并返回不补默认字段的配置。
- `createLayout(config)` 在运行时再次验证配置，再委托给对应布局函数；外部 JSON 不能绕过字段检查。
- 自动计算参数通过省略属性表达。解析与序列化不会根据当前实例数写入 `rings`、`columns` 或 `turns`。
- 配置 API 的严格验证不改变直接布局函数对已有合法调用和默认值的兼容承诺。
- v1.8 的高级字段继续使用配置版本 `1`：Sphere 分布/纬度范围、Cylinder 圆弧/行数、Ring 分配方向、Box 面选择/权重及 Cone 顶部半径均为可选字段。
- `BoxFace` 与 `boxFaces` 从主入口和 `layouts` 入口导出；Box 配置中的面数组采用固定 canonical 顺序生成，确保序列化后的布局顺序稳定。
- 严格解析会拒绝模式冲突与跨字段非法组合；直接布局函数则安全归一化异常数值，避免生成非有限 Transform。

## 性能契约

- 主体卡片场景使用一个实例 Mesh，正常布局、过渡、悬停和内置流式特效不为每张卡片增加 Draw Call。
- 布局过渡使用 GPU 插值；内置流式特效使用固定实例池，不使用 CPU 定时器生成卡片。
- 数据量、渲染上限和特效活跃数量受质量档位约束。
- 40 KB gzip、150 KB tarball 和 8 KB layout-only 是自动化预算，不是运行时网络大小承诺；调整预算需要单独评审。

## Stage extension

- `MotionStage.addExtension(extension)` 异步完成 mount，并返回具有 `enable()`、`disable()`、`enabled` 和幂等 `remove()` 的 `StageExtensionHandle`。disable 隐藏根节点并停止 update，但不 abort 或 dispose。
- 每个扩展仅获得自己的隔离 `Group`、只读 `PerspectiveCamera` 引用和随 remove/destroy 中止的 `AbortSignal`；不公开 Scene、Renderer 或内部卡片实例 Mesh。
- 可选的 `update({ elapsed, delta })` 与 Stage 同一 RAF 执行。首帧 `delta` 为 0，后续 delta 受 Stage 帧时间保护；`elapsed` 不累计暂停和页面隐藏时间。
- Stage 尺寸变化时调用 `resize({ width, height, pixelRatio })`；有效暂停状态变化时至多调用一次 `pause()` 或 `resume()`。
- 可选 `order` 决定 update/resize/pause/resume/dispose 顺序，数值较小者先执行，同值保持挂载顺序；非有限值安全归一化为 0。
- mount 后立即收到当前 `qualityChange(quality)` 与 `reducedMotionChange(boolean)`，后续质量或系统低动态偏好变化继续按稳定顺序通知，包括已 disable 的扩展。
- `remove()`、mount 失败、生命周期回调失败或 Stage 销毁都会从场景移除扩展根节点、触发取消信号并调用一次 `dispose()`。扩展仍负责释放自己创建的 Geometry、Material、Texture 和动画对象。
- `onExtensionError(error, extension)` 隔离报告 update/resize/pause/resume/dispose 错误；故障扩展不会中断卡片或其他扩展渲染。mount 错误还会从 `addExtension()` 原样拒绝。
- GSAP、anime.js 等动画库可在应用或 Demo 中实现该通用接口，但不是 Spatial Motion 核心依赖。
- `getExtensionStats()` 返回活动记录和最多 20 个已释放诊断快照；`StageExtensionStats.id` 可区分同名扩展，耗时分位数使用最近 120 次 update 的有界窗口，慢帧阈值为 2ms。

## 生命周期与并发

- 新布局或新 Timeline 会使旧动画失效，旧回调不能覆盖新状态。
- 布局过渡、内置流式特效和 Stage extension 由同一个 Stage `requestAnimationFrame` 驱动；启动过渡不会创建额外动画循环。
- `pause()`、页面隐藏与 WebGL context loss 会冻结布局过渡和流式特效的 elapsed；恢复后从暂停画面继续，不把后台停留时间计入动画。
- 被新操作中断或随 Stage 销毁的布局过渡会立即以 `false` 结算，不依赖后续浏览器帧清理残留回调。
- `startTransition()` 返回包含实时 status、`cancel()` 和结构化 `finished` 结果的句柄；完成原因区分 completed、interrupted、aborted 与 destroyed。`getTransitionState()` 提供当前布局名和进度。
- 所有 `TransitionOptions` 接受可选 `AbortSignal`；原有 `to()`、聚焦、恢复和特效入口继续返回 `Promise<boolean>`。
- `stage.timeline().wait()` 使用 Stage 暂停感知时钟，destroy 会让活动 wait 返回 `false` 并阻止后续步骤；直接 `new Timeline()` 仍使用普通计时器。
- 图片与自定义异步绘制使用 token 保护；过期结果不应用到当前图集。
- `destroy()` 幂等并释放监听器、Observer、纹理、几何体、材质和 WebGLRenderer；其他 API 在销毁后抛错。
- `transition` 可设置 Stage 默认 duration/easing，单次调用仍可覆盖；数据更新同样透传 easing。
- `cardResolution` 请求 32–256px 的图集单元，实际值可能为遵守 GPU 最大纹理尺寸而降低。
- `imageTimeout` 控制单图等待时间；`onContextChange` 与 `getPerformanceStats().contextLost` 暴露 WebGL 上下文状态。
- `imageConcurrency` 控制每个 Stage 同时进行的图片请求（默认 6）；`imageCacheSize` 控制 Stage 私有完成图片 LRU（默认 128，0 表示禁用）。重复 URL 在单次图集操作内去重，失效操作和 destroy 会中止未完成请求。
- `getPerformanceStats()` 额外提供帧分位数、长帧、Stage CPU/提交、布局/拾取、图集更新、图片加载、估算纹理上传、`extensions` 和 `extensionUpdateMs`；`renderedItems` 表示实例池容量，`submittedItems` 表示当前实际提交给 GPU 的实例数，累计字段在 Stage 生命周期内单调递增。
- `getPerformanceEnvironment()` 返回浏览器、GPU、视口、DPR、实际像素比与最大纹理尺寸，用于保存可复现基准环境。
- `BenchmarkSession` 汇总采样窗口并输出 `version: 1` 的结果；`parseBenchmarkResult()` 严格验证外部 JSON，同时兼容解析无 version 的旧结果。
- `compareBenchmarkResults()` 只在实例数、质量、布局与场景一致时标记结果可直接比较；`evaluateBenchmarkRegression()` 按指标方向、百分比和绝对阈值返回结构化通过/失败报告。
- `scatter()` 的 `layers` 和 `spinMode` 是向后兼容的可选视觉控制；默认 seed 行为仍保持确定性。

外部扩展不包含外部拾取、后处理、多相机或任意 Scene/Renderer 操作。CSS3D 渲染器、Vue/React 适配器和业务动画配方仍不属于稳定核心；未来如加入，会使用独立入口或薄适配层设计。

## 键盘与可访问交互

- `keyboardNavigation` 默认启用，为 Canvas 设置可聚焦 region 和动态 `aria-label`。
- 方向键循环当前可见卡片，Home/End 跳到首尾，Enter/Space 通过既有 `onItemClick` 激活。
- `onItemFocus`、`focusItem(id)` 和 `getFocusedItem()` 使用稳定 id；数据重排后保持焦点，删除或质量降级隐藏目标时清除焦点。
- 这是 Canvas 级键盘与区域语义，不等同于每张卡片具有独立 DOM/屏幕阅读器节点；需要完整 HTML 语义时仍应由应用提供并与 Stage 状态同步。
