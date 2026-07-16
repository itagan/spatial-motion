# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。日期使用 `YYYY-MM-DD`。

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
