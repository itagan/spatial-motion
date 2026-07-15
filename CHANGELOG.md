# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。日期使用 `YYYY-MM-DD`。

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
