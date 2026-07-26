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

四类流式特效改用与活动上限无关的 seeded 低差异相位。质量从 high 切到 low 时，Tunnel 实际提交从 300 降到 140，保留前缀的 path 与 speed factor 逐项不变；视觉检查确认密度仍均匀，没有全体实例重排。

2000 items / transition-stress / 3 秒测得平均 59.66 FPS、最大窗口 P95 17.40ms、0 长帧、1 Draw Call，平均 WebGL 提交 0.10ms。共享曲线测试覆盖端点零速度、双边淡出、burst 周期连续性、低差异分桶和四种特效质量上限切换的轨迹稳定性。

## v1.6 下一步

布局中断继续从当前帧位置、缩放、透明度和朝向开始；CPU 旋转采样改为最短角路径，避免跨周界时与 GPU 最短四元数插值选择相反方向。自动质量的 2.5 秒窗口现在同时检查平均 FPS、P95 帧预算和 33ms 长帧比例，恢复窗口则要求三项同时干净，并保留 5 秒切换冷却。

测试覆盖平均 FPS 尚高于旧降级阈值、但 P95/长帧压力已经恶化时的提前降级，以及含周期性 34ms 尖峰的窗口不得恢复质量。页面挂起、调试暂停和超过 100ms 的异常帧仍不参与决策。

最终 2000 items / auto-high / transition-stress / 3 秒回归：平均 60.01 FPS、最大窗口 P95 17.24ms、P99 17.50ms、0 长帧、1 Draw Call；4 次局部更新估算上传 65,536 bytes。

## 优化阶段结论

v1.2–v1.6 已形成从可观测基线、GPU/纹理、布局、特效到动画/自适应质量的闭环。后续继续优化前应先积累不同设备的 Benchmark JSON；当前阶段不执行 npm publish、Tag 或 GitHub Release。

## v1.7 参数化验收

布局配置层只在创建或切换布局时解析 JSON 和选项，不进入逐帧渲染路径。参数实验室复用 `stage.to()` 的中断语义，不重建 Stage、Mesh 或纹理图集；快速滑动采用 100ms 防抖和 300ms GPU 过渡。

验收同时记录 500/2000 实例的快速参数切换、Draw Call、图集构建次数、P95 和长帧。新的 `createLayout()` 聚合入口允许主动引入全部布局，但继续验证只导入 `sphere()` 的 layout-only 消费者不突破既有 8 KB 预算。

2026-07-16 本地 Chromium 验收：500 items 连续写入 5 次 Sphere 半径后保持 60 FPS、1 Draw Call，图集构建数保持 2；2000 items 连续写入 4 次后保持 60 FPS、1 Draw Call，图集构建数保持 17，证明布局参数更新未新增图集构建。独立 2000 items / transition-stress / 3 秒测得平均 59.55 FPS、P95 17.94ms、P99 18.47ms、0 长帧、1 Draw Call。

## v1.8 高级布局验收

高级布局继续在 `Layout.calculate()` 阶段生成目标 Transform，不进入逐帧渲染路径。浏览器依次验证 Fibonacci Sphere、Box 选面/权重、部分圆弧 Cylinder、等量顺时针 Ring 和 Cone 圆台；所有模式保持 60 FPS、1 Draw Call、同一图集，控制台无错误。

2026-07-16 同一 Chromium 150 / Apple M4 / 1265×633 / DPR 2 环境：500 items / auto-high / steady / 3 秒平均 60.00 FPS，P95 18.00ms、P99 18.60ms、0 长帧、1 Draw Call；2000 items / auto-high / transition-stress / 3 秒平均 59.54 FPS，P95 18.30ms、P99 18.70ms、0 长帧、1 Draw Call，完成 4 次中断和 4 次局部图集 patch。相对 v1.7 的 2000-item P95 17.94ms 增加约 2%，低于 10% 回归门槛。

包验证结果：Library JavaScript gzip 35,383 bytes、npm tarball 145,545 bytes、sphere-only 消费者 3,572 bytes，均在既有 40 KB / 150 KB / 8 KB 预算内。高级布局没有增加稳定子路径或把 Three.js 打入产物。

## v1.9 外部扩展验收

Stage extension 与卡片、Timeline 和自适应质量共用同一 RAF；扩展 update 在一次 Stage render 前集中执行，分别记录数量和 CPU 耗时。原生 Three.js 示例增加一个 Torus 和 Points，GSAP 示例增加一个线框 TorusKnot，所以 BOTH 模式总 Draw Call 为 4，其中主体卡片仍为单实例 Mesh、1 Draw Call。GSAP timeline 保持 paused，仅由 Stage 提供的 `elapsed` 推进，不创建第二条渲染循环。

2026-07-16 同一 Chromium 150 / Apple M4 / 1265×633 / DPR 2 环境：

| 场景 | 结果 |
| --- | --- |
| 500 items / auto-high / steady / BOTH / 3 秒 | 60.00 FPS，P95 18.50ms，P99 18.65ms，扩展 update 平均 0.05ms/最大 0.10ms，0 长帧，4 Draw Calls |
| 2000 items / auto-high / transition-stress / BOTH / 3 秒 | 60.05 FPS，P95 17.50ms，P99 17.67ms，扩展 update 平均 0.05ms/最大 0.10ms，0 长帧，4 Draw Calls，4 次中断/patch |

500-item P95 相对 v1.8 的 18.00ms 增加 2.8%；2000-item P95 相对 v1.8 的 18.30ms 降低 4.4%，均满足不回退超过 10% 且不新增 33ms 长帧的门槛。浏览器同时验证两扩展挂载、Stage pause/resume、移除后恢复 0 扩展/1 Draw Call，以及无 error 级控制台日志。1–5 个扩展共享单一 Stage RAF 由自动化测试覆盖。

最终包验证为 Library JavaScript gzip 36,306 bytes、npm tarball 150,429 bytes、sphere-only 3,572 bytes，继续满足 40 KB / 150 KB / 8 KB 预算；GSAP 只存在于 Demo 开发依赖，Three.js 与其声明包保持 peer dependency。

## v1.11 扩展运行时诊断验收

逐扩展诊断只在现有 Stage RAF 内记录 update 耗时；每个活动扩展保留最近 120 次样本，已释放记录转为最多 20 条纯数据快照。disable 的扩展不执行 update，因此不增加逐帧采样成本；全局 `extensionUpdateMs` 与原有性能指标语义保持不变。

2026-07-16 同一 Chromium 150 / Apple M4 / 1265×633 / DPR 2 环境：

| 场景 | 结果 |
| --- | --- |
| 500 items / auto-high / steady / BOTH / 3 秒 | 59.98 FPS，P95 18.60ms，P99 18.70ms，扩展 update 平均 0.038ms/最大 0.20ms，逐扩展 P95 为 0/0.10ms，0 长帧，4 Draw Calls |
| 2000 items / auto-high / transition-stress / BOTH / 3 秒 | 60.00 FPS，P95 18.40ms，P99 18.60ms，扩展 update 平均 0.013ms/最大 0.10ms，逐扩展 P95 为 0/0.10ms，0 长帧，4 Draw Calls，4 次中断/patch |

相对 v1.9，500-item P95 从 18.50ms 增加 0.5%，2000-item P95 从 17.50ms 增加 5.1%，均低于 10% 回归门槛且未新增 33ms 长帧。主 Demo 启停扩展时 Draw Call 在 4 与 1 之间正确切换，两个独立示例也保持单一 Canvas/RAF，浏览器控制台无错误。

最终包验证为 Library JavaScript gzip 37,207 bytes、npm tarball 141,968 bytes、layout-only 3,572 bytes，继续满足 40 KB / 150 KB / 8 KB 预算。为维持既有 tarball 上限，发布包只携带公共 API、兼容性、README、CHANGELOG 和许可证；路线图、开发/发布/视觉/优化记录及 examples 保留在源码仓库。

## v1.13–v1.15 自动回归与异步管线验收

v1.13 将 Benchmark JSON 固定为 version 1，并通过严格字段校验、方向感知阈值与 CLI 退出码形成自动回归门禁。六组预设覆盖 100/500/1000/2000 实例、low/medium/high/auto 和四类场景，默认门禁包含 Atlas build/patch；包消费者验证会真实安装 tarball、调用 `parseBenchmarkResult()`/`evaluateBenchmarkRegression()`，并以 `--preset` 执行安装后的 `spatial-motion-benchmark` 二进制。包体积继续由同一 `pack:check` 的 40/150/8 KB 硬阈值阻断。

v1.14 的图片管线不改变纹理数量或 Draw Call：单次操作按 URL 去重，默认最多 6 个请求并发，每个 Stage 保留最多 128 个成功图片引用。自动化测试证明两个卡片共享 URL 只请求一次、后续 patch 命中缓存不再请求、并发上限为 2 时只启动两个 Image，以及 abort 会停止活动请求；A→B→A 并发回归证明中间图集不能覆盖最新请求。

本阶段评估后未默认启用 `createImageBitmap`/OffscreenCanvas Worker：当前公共 `drawCard` 接收主线程 Canvas 2D 上下文，直接迁移 Worker 会破坏回调契约；ImageBitmap 还需要额外 close 生命周期和跨浏览器/CORS 实测。后续只有在 cold-start/atlas-update 基准证明解码或主线程绘制是主要瓶颈时，才考虑保持现有路径的可选实现。

v1.15 的过渡、流式特效、Stage Timeline 和 extension 继续共享单个 Stage RAF。自动化测试覆盖 completed/interrupted/aborted/destroyed 完成原因、暂停感知进度、destroy 停止 Timeline 后续步骤，以及键盘焦点、方向导航和激活。上述变更没有增加卡片 Mesh 或内建特效 Draw Call。

真实 Chromium/WebGL 2 验收中，500 items / high / cold-start / 3 秒保持平均 59.1 FPS、P95 18.20ms、1 Draw Call，完整图集构建 85.1ms；1000 items / high / atlas-update / 3 秒保持平均 60.0 FPS、P95 18.30ms、0 个 33ms 长帧、1 Draw Call，17 次局部更新累计 45.6ms、估算上传 272 KB。页面键盘实测可从首项移动到第 2/1000 项并同步无障碍标签，控制台无 error 日志。

2026-07-20 加入不随 npm 发布的 Vue Lottery Screen 示例后复验：Library JavaScript gzip 40,939 bytes、npm tarball 151,507 bytes、layout-only 3,572 bytes，仍满足 40 KB / 150 KB / 8 KB 硬预算。npm 包排除 `.d.ts.map`，但保留类型声明和 JavaScript source map；Three.js 继续保持 peer dependency。

## Sphere 容量与轮廓优化

质量档位不再叠加固定可见比例：当前池严格按 high/medium/low 的 2000/1000/500 上限异步协调，升级从 `sourceItems` 恢复数据，降级等待图集期间先在顶点着色阶段提前裁剪。连续质量切换、数据更新和 destroy 使用代次保护，旧异步结果不能覆盖最新状态。

Sphere 的响应式半径、起始经度和轮廓淡出仍只在布局计算或现有 Shader 中完成，不增加 Mesh、纹理或 Draw Call。库构建改用 Terser 并保留本地隐藏 source map，npm tarball 排除 `.js.map` 以同时守住 JavaScript gzip 与发布包预算。最终性能与包体积数值以本次完整验收结果为准。

2026-07-25 Chromium 150 / Apple M4 / 1265×633 / DPR 1 验收：500、1000、2000 输入在 high 下分别提交 500、1000、2000 个实例；2000 输入切换 medium/low 后分别提交 1000/500，恢复 high 后回到 2000。全部场景保持主体 1 Draw Call，图集容量随质量回收，不叠加第二层可见比例。

2000 items / high / steady / 3 秒为 60.00 FPS、P95 18.10ms、P99 18.60ms、0 个 33ms 长帧；2000 items / high / transition-stress / 3 秒为 60.00 FPS、P95 18.55ms、P99 18.70ms、0 个 33ms 长帧、1 Draw Call、4 次中断/patch。相对 v1.11 的 18.40ms P95 增加 0.8%，低于 10% 门槛。390×844、1600×600 与默认桌面视口均完成 contain 边界、轮廓淡出、约 360° 旋转和快速布局中断检查；Canvas 脱离 Grid 的内在尺寸计算后，连续横竖屏切换不再反向撑大舞台，头像顶部朝北且控制台无 error 日志。

最终包验证为 Library JavaScript gzip 36,057 bytes、npm tarball 65,495 bytes、layout-only 消费者 3,947 bytes，满足既有 40 KB / 150 KB / 8 KB 硬预算。

## 卡片内容与统一宽高比

卡片宽高比在 Cards Renderer 初始化时归一化到最长边为 1；矩形 PlaneGeometry、Atlas 单元、UV、局部行上传和拾取四边形共享同一宽高，不增加实例属性、Mesh 或 Draw Call。`resolution` 代表最长像素边，图集按单元比例选择行列并同时遵守最大纹理宽高。

内置 Canvas 绘制增加图片 fit/焦点、相对留白、覆盖层和多行标题；逐卡样式只在图集生成或 patch 阶段解析，不进入 Stage RAF。最终浏览器性能和包体积数值以本次完整验收结果为准。

2026-07-25 Chromium 150 / Apple M4 / 1265×633 / DPR 1 验收：500 个 1:1 圆形头像、1000 个 3:4 人物卡和 2000 个 16:9 信息卡均保持 60 FPS、主体 1 Draw Call，图片比例、标题覆盖层和逐卡金色边框正确；390×844 竖屏 contain 完整显示，矩形卡片点击命中正确，控制台无 error 日志。

2000 items / high / steady / 3 秒为 59.55 FPS、P95 17.80ms、P99 18.40ms、0 个 33ms 长帧；transition-stress / 3 秒为 60.00 FPS、P95 18.20ms、P99 18.50ms、0 个 33ms 长帧、1 Draw Call、4 次局部 patch。相对 Sphere 优化阶段的 18.55ms 压力 P95 降低约 1.9%。

最终包验证为 Library JavaScript gzip 37,283 bytes、npm tarball 67,759 bytes、layout-only 消费者 4,012 bytes，满足既有 40,960 / 153,600 / 8,192 bytes 硬预算。

## ES6 卡片模板引擎

`card-template` 将稳定的 tagged template 字符串结构编译并缓存在 `WeakMap`，动态值只参与节点绑定和 Canvas 布局。模板不创建 DOM，不进入 Stage RAF；准备阶段声明的图片 URL 由 Atlas 统一去重、限流、缓存和取消，随后只绘制对应的初始或局部 patch 单元。

主入口只新增擦除后的类型协议，不引用模板运行时代码。包门禁改为分别统计主库与按需模板：当前主库 37,537 bytes gzip、模板 5,820 bytes gzip、npm tarball 约 75 KB、layout-only 4,012 bytes，分别低于 40,960 / 12,288 / 153,600 / 8,192 bytes 限制。

模板稳态仍复用一个 Atlas、一个实例 Mesh 和一个 Draw Call。性能验收重点放在 cold-start、atlas-update 和 transition-stress，避免仅凭稳态 FPS 掩盖模板布局或批量重绘成本。

2026-07-26 Chromium 150 / Apple M4 实测：等价 2000 项指标卡的三次 Atlas build 中位数，模板为 410.9ms、手写 Canvas 为 380.2ms，模板层增加约 8.1%，低于 15% 门槛。模板单卡更新产生 1 个 patch、约 7.5ms patch 累计耗时，Stage 内只有一个 Canvas 子节点。

默认 Cards 的 2000/high/3 秒 steady 为 60.0 FPS、P95 18.50ms；transition-stress 为 60.0 FPS、P95 18.60ms、4 次 patch、0 个 24/33/50ms 长帧和 1 Draw Call。相对卡片宽高比阶段的 17.80/18.20ms 基线分别回退约 3.9%/2.2%，均低于 10% 门槛。

## 稳定批量渲染器协议

Stage 持有专属内容 `Group` 并通过稳定 `MotionRenderer` 协议编排显式 Renderer；整体旋转、稳定 id、布局/过渡、质量、遮挡拾取和 RAF 仍由 Stage 管理。Cards 配置集中在 `cardsRenderer()`，Core 只读取通用 descriptor、核心生命周期与可选能力。

核心协议不再要求空实现：patch、visual、highlight、viewport、resource recovery 和 streaming effects 使用独立能力对象。缺少 patch 时完整重设数据并按 token 恢复当前过渡、视觉、质量和特效状态；无边界描述时退出指针拾取。测试夹具使用真实单 `LineSegments` 最小实现与单 `InstancedMesh` 部分能力实现，证明第三、第四种批量对象无需修改 Stage。

按需 `pointsRenderer()` 使用单个 `THREE.Points`、`BufferGeometry` 和 `ShaderMaterial`，位置、缩放与透明度在 GPU 插值，质量隐藏在顶点阶段完成。容量变化替换并立即释放旧 Geometry，局部数据 patch 只更新颜色范围；通用统计报告实际 Buffer 字节，Atlas、纹理和图片指标归零。不支持 streaming effects 时只计算时间 0 的静态首帧，避免建立无效逐帧状态。

API 收敛后的真实包检查结果为主库 40,379 bytes gzip、Points 2,556 bytes gzip、模板 5,820 bytes gzip、tarball 79,972 bytes、layout-only 5,598 bytes，全部保持在独立预算内。严格 TypeScript 与 Node ESM 消费验证 Core、Cards、Points 和逐布局入口可用，内部深层路径继续被拦截。

2026-07-26 Chromium 150 / Apple M4 / 1265×633 协议加固回归：默认 Cards 的 2000/high/3 秒 steady 为 60.0 FPS、P95 17.34ms；transition-stress 为 60.0 FPS、P95 17.50ms、4 次中断/patch。两者均为 0 个 33ms 长帧、1 Draw Call，相对协议前 18.50/18.60ms 基线没有回退。Points 的 500/1000/2000 项球体与圆柱、快速中断、拾取和暂停恢复均保持单 Canvas、主体 1 Draw Call，控制台无 error。

## 运行时容量与开发诊断打磨

Cards 与 Points 将活动数量和 GPU 容量分离为二次幂容量桶；同一容量档内只原位更新 DynamicDrawUsage Attribute，布局切换不再成组创建位置、四元数、缩放和透明度 TypedArray。Cards 在容量不变时保留 Mesh、Geometry 和 Material，只替换 Atlas 纹理与矩形数据；Points 局部颜色更新只标记变化范围。

Atlas patch 会按纹理行合并相邻卡片范围，模板实例保留最多 2048 项的字体/宽度/文本测量 LRU，并预解析 class 样式组合。`renderer.metrics` 增加 capacity、geometryBuilds、attributeReuses、atlasUploadRanges 和模板测量命中指标。

自动验证当前为 20 个测试文件、264 项测试；真实包检查为主库 40,922 bytes gzip、模板 6,194 bytes、Points 2,918 bytes、Dev 3,892 bytes、tarball 85,087 bytes、layout-only 5,598 bytes，均未提高既有预算。

2026-07-26 Chromium 150 / Apple M4 / 1265×633 运行时打磨回归：默认 Cards 2000/high 的 steady 为 60.0 FPS、P95 17.60ms；transition-stress 为 60.0 FPS、P95 17.46ms、4 次中断/patch；连续 Atlas 更新为 60.0 FPS、P95 17.50ms、17 次局部 patch。三组均为 0 个 33ms 长帧和 1 Draw Call，steady 相对本轮前 17.34ms 基线仅增加约 1.5%，低于 10% 门槛。Cards/Points 的 500/1000/2000 项均保持主体 1 Draw Call；同容量档布局切换时 `geometryBuilds` 保持 1，`attributeReuses` 持续增加，控制台无 error。
