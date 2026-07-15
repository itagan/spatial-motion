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

## v1.3 首要假设

500 张卡片时，17 次单元更新估算触发约 227MB 纹理上传，明显高于 Canvas 单元绘制成本。下一阶段优先验证并实现：

1. 同一帧和短时间窗口内的稳定 id 更新合并。
2. 可行时采用局部纹理上传；无法跨 Three.js/WebGL 安全实现时，至少降低上传频率。
3. 流式特效稳定阶段减少休眠实例的顶点工作，同时保持过渡期完整实例和单 Draw Call。
4. 使用本文件场景与导出的 Benchmark JSON 比较优化前后，不以降低可见数量掩盖收益。
