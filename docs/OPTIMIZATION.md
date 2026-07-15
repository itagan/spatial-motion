# 性能与效果优化记录

本文件记录优化阶段的可复现证据和下一项优先工作，不承担发布清单职责。所有数字必须同时保存实例数、质量、场景、视口、DPR、GPU 和提交 SHA。

## v1.2 可观测性基线

2026-07-15 本地 Chromium 150 / Apple M4 / 1265×633 / DPR 2（Stage pixel ratio 1.5），500 items / auto-high / 3 秒：

| 场景 | 结果 |
| --- | --- |
| steady | 平均 60.01 FPS，最大窗口 P95 17.60ms，1 Draw Call，0 长帧 |
| cold-start | 2 次图集构建、500 个单元、构建墙钟时间 18.20ms；图片请求 500，失败 0 |
| atlas-update | 17 次单元 patch、patch 墙钟时间 13.20ms、估算整图上传 237,828,096 bytes |
| transition-stress | 4 次布局/特效中断与 4 次真实图集 patch，1 Draw Call，无页面 error 日志 |

图片加载耗时按每个请求累计，因此并发请求的总和可能大于图集构建墙钟时间。`estimatedTextureUploadBytes` 按 CanvasTexture 每次 `needsUpdate` 可能重新上传完整图集估算，不等同于浏览器驱动实际传输计数。

## v1.3 GPU 与纹理优化结果

同一设备与视口、500 items / auto-high / atlas-update / 3 秒：

| 指标 | v1.2 | v1.3 | 变化 |
| --- | ---: | ---: | ---: |
| 17 次单元 patch 估算上传 | 237,828,096 bytes | 278,528 bytes | -99.88% |
| patch 墙钟时间 | 13.20ms | 70.10ms | +56.90ms |
| 最大窗口 P95 | 17.60ms | 18.60ms | +1.00ms |
| 24/33/50ms 长帧 | 0 / 0 / 0 | 0 / 0 / 0 | 不变 |

局部上传显著降低 GPU 传输量，但 Canvas `getImageData()` 与 TypedArray 行复制增加了 CPU patch 成本。当前收益不是无条件胜出：P95 与长帧仍稳定，后续应继续减少读回和复制，而不是只看上传字节。

2000 items 的 Tunnel 稳定阶段只提交 300 个活动实例，三角形从完整实例池的 4,000 降至 600；切回 Sphere 后恢复提交 2,000 个实例和 4,000 个三角形，全程仍为单 Mesh、单 Draw Call。2000 items / transition-stress / 3 秒测得平均 60 FPS、最大窗口 P95 17.60ms、0 长帧，4 次 patch 估算上传 65,536 bytes。

实现约束：同一 JavaScript turn 的稳定 id 更新会合并；尚未渲染的多个 DataTexture patch 会累积更新范围。首次上传与 WebGL context 恢复使用完整纹理上传，避免依赖不存在的 GPU 基础内容。mipmap 生成仍可能涉及完整 mip 链成本，后续需单独评估。

## v1.4 下一步

Sphere 与 Cone 的奇点卡片增加留白，Box 六面使用统一尺度，Cylinder 各行独立闭环并交错接缝，Grid 残缺末行在三种 fit 模式下居中。浏览器固定视角已覆盖 Sphere、Box、Cylinder、Cone；2000 items / transition-stress / 3 秒保持平均 60 FPS、最大窗口 P95 17.60ms、0 长帧、1 Draw Call，平均 WebGL 提交 0.075ms。

布局测试新增奇点尺度、跨面尺度连续性、圆柱闭环/交错和三种 Grid 末行居中检查；布局测试共 40 项。

## v1.5 下一步

统一 Tunnel、Linear Shooter、Vortex 与 Radial Burst 的速度曲线、密度包络、近远端淡出和周期边界。先使用 CPU/Shader 同帧测试锁定数学一致性，再在 500/2000 实例下检查静态首帧、周期循环、快速进入/退出和 Reduced Motion。
