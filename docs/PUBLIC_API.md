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

## v1.x 承诺

- 已公开的函数、类方法、选项和联合类型不会在 minor/patch 版本中无迁移方案地移除或改成不兼容含义。
- 新增可选字段、布局、特效和性能统计字段属于向后兼容变更。
- 缺陷修复可能纠正非法输入、竞态或与文档不符的行为，但默认视觉和合法调用应保持兼容。
- `MotionItem.id` 必须是非空、唯一、稳定的字符串；依赖数组索引维持身份从来不是受支持行为。
- Three.js 是 peer dependency，支持范围记录在 `package.json`；升级到超出范围的 Three.js 不在兼容保证内。

## 性能契约

- 主体卡片场景使用一个实例 Mesh，正常布局、过渡、悬停和内置流式特效不为每张卡片增加 Draw Call。
- 布局过渡使用 GPU 插值；内置流式特效使用固定实例池，不使用 CPU 定时器生成卡片。
- 数据量、渲染上限和特效活跃数量受质量档位约束。
- 40 KB gzip、150 KB tarball 和 8 KB layout-only 是自动化预算，不是运行时网络大小承诺；调整预算需要单独评审。

## 生命周期与并发

- 新布局或新 Timeline 会使旧动画失效，旧回调不能覆盖新状态。
- 图片与自定义异步绘制使用 token 保护；过期结果不应用到当前图集。
- `destroy()` 幂等并释放监听器、Observer、纹理、几何体、材质和 WebGLRenderer；其他 API 在销毁后抛错。
- `transition` 可设置 Stage 默认 duration/easing，单次调用仍可覆盖；数据更新同样透传 easing。
- `cardResolution` 请求 32–256px 的图集单元，实际值可能为遵守 GPU 最大纹理尺寸而降低。
- `imageTimeout` 控制单图等待时间；`onContextChange` 与 `getPerformanceStats().contextLost` 暴露 WebGL 上下文状态。
- `getPerformanceStats()` 额外提供帧分位数、长帧、Stage CPU/提交、布局/拾取、图集更新、图片加载和估算纹理上传统计；累计字段在 Stage 生命周期内单调递增。
- `getPerformanceEnvironment()` 返回浏览器、GPU、视口、DPR、实际像素比与最大纹理尺寸，用于保存可复现基准环境。
- `BenchmarkSession` 汇总采样窗口，`compareBenchmarkResults()` 只在实例数、质量、布局与场景一致时标记结果可直接比较。
- `scatter()` 的 `layers` 和 `spinMode` 是向后兼容的可选视觉控制；默认 seed 行为仍保持确定性。

CSS3D 渲染器、Vue/React 适配器和业务动画配方不属于 v1.0 稳定核心；未来如加入，会使用独立入口或薄适配层设计。
