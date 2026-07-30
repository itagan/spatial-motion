# 性能与效果优化记录

本文件记录优化阶段的可复现证据和下一项优先工作，不承担发布清单职责。所有数字必须同时保存实例数、质量、场景、视口、DPR、GPU 和提交 SHA。

## v2 resident / submitted / visible 模型

运行中从高档降到中、低档时，Stage 保留已经创建的 Renderer resident pool，并立即
降低 Shader visible ratio 和实际特效提交量。降级不再在性能已经承压的时间点重建
Atlas、Geometry 或 Attribute。局部 item patch 继续更新 resident pool，不会把质量
裁剪误写成数据裁剪。

从低档启动后升级到更高档位时，Stage 才异步扩展 resident pool；revision 继续保证
旧结果不能覆盖新质量或数据状态。后续基准需要分别记录 resident instance、
submitted instance 和 visible instance，不能再用单个 item count 解释性能。

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

v1.14 当时暂未启用 `createImageBitmap`/OffscreenCanvas Worker，因为公共 `drawCard` 仍要求主线程 Canvas 2D 上下文。后续实现只覆盖内置默认绘制，模板、自定义 `drawCard` 与局部 patch 不跨线程，因此没有改变回调契约。

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

自动验证当前为 20 个测试文件、265 项测试；真实包检查为主库 40,953 bytes gzip、模板 6,194 bytes、Points 2,918 bytes、Dev 3,892 bytes、tarball 85,238 bytes、layout-only 5,598 bytes，均未提高既有预算。

2026-07-26 Chromium 150 / Apple M4 / 1265×633 运行时打磨回归：默认 Cards 2000/high 的 steady 为 60.0 FPS、P95 17.60ms；transition-stress 为 60.0 FPS、P95 17.46ms、4 次中断/patch；连续 Atlas 更新为 60.0 FPS、P95 17.50ms、17 次局部 patch。三组均为 0 个 33ms 长帧和 1 Draw Call，steady 相对本轮前 17.34ms 基线仅增加约 1.5%，低于 10% 门槛。Cards/Points 的 500/1000/2000 项均保持主体 1 Draw Call；同容量档布局切换时 `geometryBuilds` 保持 1，`attributeReuses` 持续增加，控制台无 error。

## 稳态交互读取减负

布局已经稳定且没有流式特效时，Stage 直接把内部只读 Transform 快照用于拾取、聚焦和数据协调，不再为每次读取复制全部 Transform 对象。活动布局过渡和流式特效仍生成独立快照，保持中断时的帧连续性；公开只读契约和 Renderer 输入没有变化。Stage 时钟 wait 同时改为直接遍历现有 Set，完成项在遍历中安全删除，不再为每个动画帧创建临时数组。

启用 hover 后，高频 `pointermove` 只记录最新事件，并在 Stage 下一渲染帧执行一次拾取；暂停或 RAF 尚未启动时仍立即处理。Benchmark Demo 增加约 240Hz 合成输入的 `interaction-stress` 场景，结果中的 `operations` 与 `pickOperations` 可直接验证事件合并比例。

自动化增加稳态快照引用回归，确保 2000 项 hover/pick 不会重新引入整组 Transform 克隆。该改动不增加 Renderer、Draw Call、纹理或公开 API，主库仍受原 40,960 bytes gzip 门禁约束。

2026-07-26 Chromium 150 / Apple M4 / 1265×633 的 2000 Cards/high/interaction-stress 3 秒结果：合成输入触发 707 次 `pointermove`，Stage 实际执行 180 次拾取，合并 74.5%；平均 59.99 FPS、P95/P99 17.70/17.70ms、0 个 33ms 长帧、1 Draw Call。拾取累计 584.8ms，平均每次 3.249ms。Points 2000 浏览器复验继续保持 1 Draw Call，控制台无 error。

## 拾取热路径低分配化

InteractionController 保留原有屏幕四边形、disc、padding、遮挡深度和稳定顺序语义，但把中心、相机方向、世界角点与屏幕坐标改为实例级固定缓冲。每次拾取只计算一次相机方向、Group 旋转和投影尺度；Quad 先用包含实际四角的投影包围圆做保守排除，剩余候选才执行四角精确测试。命中结果在扫描过程中按原 comparator 在线更新，不再建立候选数组或排序。

高频 `pointermove` 同时改为标量坐标槽，不再为每个输入事件创建 pending 对象。焦点查询维护随 items 同步重建的稳定 id 索引，数据重排后仍正确更新 GPU highlight。自动化覆盖倾斜 surface 的粗筛边界、遮挡/距离排序、矩形/圆形边界、数据重排和 settled pick 期间零 `Vector3.clone()`。

2026-07-26 Chromium 150 / Apple M4 / 2000 Cards/high/interaction-stress 三轮结果：180 次拾取累计 192.1/192.7/205.0ms，中位数 192.7ms，平均每次约 1.071ms；相对改造前 3.249ms 降低约 67.0%。三轮 P95 为 17.55–18.60ms，均为 0 个 24/33/50ms 长帧、主体 1 Draw Call；每轮约 750 次合成 pointermove 仍只执行 180 次拾取。完整包检查为 root/Core 37,572/13,509 bytes gzip，Cards-only 保持 12,227 bytes，均低于既有预算。

## 真实消费者体积与 Atlas 冷启动

包体积门禁不再把所有 ESM 输出文件分别 gzip 后相加当作用户下载量。`pack:check` 会从真实 `.tgz` 创建 root、Core-only 和 Cards-only Vite/Terser 消费者，并把 Three.js 保持为 external；分模块 gzip 聚合值仍输出，专门用于观察内部模块增长。当前 root/Core-only/Cards-only 分别为 33,362 / 11,875 / 9,972 bytes gzip，均低于 40,960 / 16,384 / 12,288 bytes 预算；分模块聚合诊断为 41,500 bytes，但不对应任何单个消费者产物。

Atlas 指标拆分为 prepare、图片加载墙钟、单元绘制和整图像素 readback。内置默认卡片首次构建直接绘制到一个合成 Canvas，不再创建 2000 个临时单元 Canvas 或逐卡 `drawImage`；异步模板和自定义 `drawCard` 仍使用隔离单元 Canvas，局部 patch 路径不变。整图只执行一次 `getImageData()`，并直接把返回的 `Uint8ClampedArray` 交给 `DataTexture`，不再分配并复制第二份同尺寸 `Uint8Array`。

2026-07-26 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2000 Cards/high/cold-start 三轮结果：优化前 Atlas build 中位数 299.9ms，默认直接绘制后为 56.9 / 51.7 / 51.0ms，中位数 51.7ms，减少约 82.8%；cell render 中位数由 39.5ms 降至 7.3ms，readback 由 243.2ms 降至 44.0ms。三轮均提交 2000 项、保持 1 Draw Call，P95 为 17.60–17.65ms；其中两轮记录到一次 50ms 以上冷启动峰值，后续分辨率与提交对照继续区分 CPU readback 和纹理首传。默认与产品模板画面正常，控制台无 warning/error。

随后增加基础级 Atlas 策略：内置默认卡片的 `resolution` 未配置或为 `'auto'` 时，超过 1024 项使用 48px，否则使用 64px；显式数值始终优先。模板与自定义 `drawCard` 的未配置行为保持 64px，避免基于像素的内容布局被隐式缩放。`mipmaps` 默认开启但允许显式关闭，实际 resolution/mipmap 状态进入 Renderer metrics；Benchmark 摘要同时报告最大 CPU/submit、紧邻冷启动的首次 render submit 和 Atlas 设置。

同环境 2000/high/cold-start 的自动 48px 三轮 Atlas build 为 40.1/44.2/39.1ms，中位数 40.1ms，readback 中位数 33.1ms，纹理内存由固定 64px 的约 53.4MB 降至 33.9MB；主体保持 1 Draw Call，P95 为 17.50–18.25ms。40px 单轮为 build/readback 32.2/24.7ms、约 24.9MB，但仍记录一次 33ms 长帧，因此不继续牺牲清晰度。64px 关闭 mipmap 后纹理约 42.0MB，但 build/readback 仍为 56.4/46.5ms，说明 mipmap 不是 CPU 冷启动主瓶颈，默认继续开启。后续方向修正为离主线程默认绘制/readback，并单独评估纹理首传；不直接引入分页 Atlas。完整验证为 20 个测试文件、269 项测试，Library/Demo/Examples 与 tgz 消费检查全部通过。

内置默认卡片在 256 项以上且浏览器支持 Worker/OffscreenCanvas 时，会把首次整图绘制与 `getImageData()` readback 移到独立模块 Worker。包含图片时先沿用现有并发、超时、LRU、CORS 和 AbortSignal 管线加载资源，再按 URL 去重转换为 `ImageBitmap` 并转移；Worker 或主线程会在各自拥有期关闭位图。转换、构造、传输或任务执行失败时复用已加载的 HTML 图片回退主线程，不重复网络请求。模板、`drawCard` 和局部 patch 不跨线程。

纹理首传通过 Stage 提供的受限 `prepareTexture()` 能力单独计时。Cards 默认仅对原始像素不超过 16 MiB 的 Atlas 执行预热，大图集留给正常渲染提交，避免 `initTexture()` 自身占用 33ms 帧；显式 `texturePrewarm` 可覆盖策略。2026-07-26 Chromium 150 / Apple M4 / DPR 2 的头像 cold-start 验证：500、1000、2000 项均命中图片 Worker、保持主体 1 Draw Call；2000 项自适应策略为 60.01 FPS、P95 17.45ms、P99 17.60ms、0 个 33ms 长帧，位图解码 2.6ms、Worker 单元绘制/readback 3.9/27.4ms，控制台无 warning/error。强制预热 2000 项会出现一次 33ms 长帧，因此未作为默认。

同环境关闭 2000 项 Atlas mipmap 后，纹理内存由约 33.9MB 降为 24.2MB，但首次 render submit 仍为 30.9ms，P95 17.60ms；这说明 mipmap 能节省显存，却不是首传延迟的主要来源，默认继续保留远距采样质量。直接使用 ImageBitmap 纹理也会失去当前 DataTexture 的按行 patch，第一次内容更新需要整图回读和再次完整上传，因此没有作为低风险默认路径；后续 Texture2DArray/分页层上传应独立验证。

Atlas 局部更新的内容指纹改为逐项保存。完整 `setItems()` 仍扫描全部输入以识别完全相同的数据，而 `updateItem(s)` 只对去重、校验后的变化索引序列化 `meta` 和解析样式。2000 项单卡更新自动化确认只调用一次样式解析；Renderer metrics 记录 full/patch 扫描次数及累计扫描项目数。Chromium 的 2000/high/atlas-update 3 秒复验完成 17 次单元 patch，保持 60 FPS、P95 17.50ms、0 个 33ms 长帧和 1 Draw Call。

## Texture2DArray 分页与渐进首传

Cards 增加显式 `single`、`array` 和保守 `auto` 策略。默认 `single` 保留 mipmap、细粒度行 patch 与既有视觉；`array` 把 Atlas 拆成自适应二维页面并装入单个 `DataArrayTexture`，页面层编码在既有 Atlas rect 数据中，不增加实例 Attribute、Mesh 或 Draw Call。页尺寸会在设备层数限制内选择最小平衡方案，并额外限制为 256 层。

Array 首帧上传预算约 3 MiB，后续每个 Stage RAF 约 768 KiB。新的 Renderer `frame.update()` 可选能力只负责协调该上传队列；默认 Cards 以外的 Renderer 不需要空实现。context restore 会从首层重新上传，局部 patch 则重传受影响的整页，因此 array 面向大型、相对静态的内容，single 仍是高频稀疏 patch 的合理默认。

2026-07-26 Chromium 150 / Apple M4 / 2000 Cards 实测：array 和 `auto + mipmaps:false` 选择 2×4 单元页面、250 层，首次 WebGL 提交约 4.3ms，P95 18.4–18.6ms，0 个 33ms 长帧并保持主体 1 Draw Call；`auto + mipmaps:true` 确定性使用 single，首次提交约 34.7–37.3ms。500 项无 mipmap图集约 10.49 MiB，低于 16 MiB 门槛，auto 同样保持 single。

17 次局部更新下，自适应页面累计估算上传约 1.71 MiB，相比固定 4×4 页面约 3.41 MiB 减半；single 仍只需约 0.16 MiB，验证了默认不切换 array 的取舍。Array Store 与 GLSL3 Shader 通过动态模块隔离，默认 Cards 消费包不包含 `sampler2DArray`。完整包检查为 root 37,093 bytes、Core 13,048 bytes、Cards 12,227 bytes gzip，tarball 100,875 bytes，均在既有预算内。

Array 默认卡片 Worker 随后移除“完整 2D Atlas readback 后再逐单元重排”的中间路径，改为最多约 8 MiB 的平衡分页批次直接绘制、批量 readback 并写入最终 layer 缓冲。2000 项 48px/250 层只需约 3 次 readback；估算瞬时像素缓冲由完整 2D Canvas、完整 ImageData 和最终数组同时驻留的约 62 MiB，降低到最终数组加单批 Canvas/ImageData 的约 41 MiB。

同环境三轮 2000/high/cold-start 的 Atlas build 为 51.7/74.6/55.0ms，中位数 55.0ms；readback 为 30.7/39.5/31.8ms，中位数 31.8ms。P95 为 18.55–18.60ms，均为 0 个 24/33/50ms 长帧、主体 1 Draw Call，首次提交 4.2–6.5ms。默认 root/Core/Cards 消费体积保持 37,093/13,048/12,227 bytes gzip，新增实现只进入按需 Worker/Array chunk；tarball 约 99.1 KiB，仍低于既有预算。

## Atlas 局部上传低分配化

Single Atlas patch 不再为每个像素行建立 Map 项、范围数组和 `{ start, end }` 对象。变化单元按稳定 index 扫描，同一卡片行内相邻单元合并为连续 run，再直接生成 Three.js update range；分离单元保持独立范围。最常见的单卡 patch 直接复用输入列表，不再执行 `slice().sort()`。像素 readback 与逐行写入语义保持不变。

2026-07-27 Chromium 150 / Apple M4 / 2000 Cards/high/single/48px 的 3 秒连续更新三轮均完成 17 次 patch、保持约 60 FPS、1 Draw Call 和 0 个 24/33/50ms 长帧。P95 为 18.30–18.60ms；patch 累计耗时中位数 73.3ms，与优化前 73.0ms 基本持平，说明当前墙钟成本主要仍在 Canvas readback，但逐行临时对象已经移除。完整验证为 25 个测试文件、312 项测试；root/Core/Cards-only 为 37,628/13,509/12,276 bytes gzip，均未提高预算。

## Cards Program 与 Render Host 重构

Cards 的公共 Shader 只保留 Atlas、布局过渡、Highlight、质量裁剪和投影；四个内置
Effect Program、Array Shader 与 Atlas 引擎改为动态模块。Program Material、私有
Attribute 和 TypedArray 按容量复用，EffectController 与 Renderer 使用双层 generation
阻止慢加载结果覆盖新特效、质量变化、布局切换或销毁。Stage 的 Scene、Camera、
WebGLRenderer、Canvas、能力查询和基础 context 恢复由 `StageRenderHost` 唯一拥有。

2026-07-27 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2000 Cards/high 三组
3 秒回归：steady 为 60.03 FPS、P95/P99 18.23/18.70ms、平均 CPU/submit
0.025/0.088ms；transition-stress 为 60.00 FPS、P95/P99 18.35/18.60ms、完成 4 次
操作；interaction-stress 为 60.02 FPS、P95/P99 18.35/18.60ms，751 次输入合并为
180 次拾取，累计 picking 132.1ms。三组均为 1 Draw Call、0 个 24/33/50ms 长帧，
浏览器无 warning/error。自定义 GPU 示例激活后报告 300 submitted、1 cached Program
和 1 Draw Call。真实 root/Core/Cards-only 消费体积为 35,433/15,075/8,407 bytes
gzip，tarball 112,543 bytes。

### 独立 Effect chunk 与无查找时间热路径

四个内置 Cards Effect 从共享动态模块进一步拆为四个独立入口，首次进入某个 kind
不会再下载其他特效的运动 GLSL；公共 payload 校验与上传逻辑继续复用单独的共享
chunk。包检查会构建真实 Cards 消费者，并验证四段特效 GLSL 分别存在于不同 lazy
chunk，防止后续合并回单一特效包。

Program runtime 在 Material 创建时一次性解析时间 Uniform，逐帧更新直接写入缓存
引用；Transition、Visual、Highlight、可见比例和 Array Atlas 上传只同步基础材质与
当前活动材质，缓存的非活动材质在再次激活时从基础材质恢复公共状态。这样移除了
稳态帧中的 Uniform 定义扫描、内联回调和全量 Program Material 遍历。

2026-07-28 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2000 Cards/high 三组
3 秒回归：steady 为 60.05 FPS、P95/P99 18.20/18.30ms、平均 CPU/submit
0.013/0.125ms；transition-stress 为 60.00 FPS、P95/P99 18.05/18.50ms、完成 4 次
操作；interaction-stress 为 60.00 FPS、P95/P99 18.40/18.60ms，751 次输入合并为
180 次拾取，累计 picking 141.3ms。三组均保持 1 Draw Call、0 个 24/33/50ms
长帧且无浏览器 warning/error。完整验证为 29 个测试文件、333 项测试；真实
root/Core/Cards-only 为 35,743/15,075/8,635 bytes gzip，tarball 113,285 bytes。

## Stage 内容协调、Extension 热路径与 Cards 内聚

`MotionStage` 不再直接拥有 items、Transform、Layout 视觉状态、Stage wait 和主体
旋转；数据全量更新、Patch 合并、质量扩容和活动特效恢复由
`StageContentState` / `StageContentCoordinator` 编排。Renderer 协议校验与统计归一
也移入内部支持模块。`MotionStage.ts` 从 1163 行降至 877 行，实际类主体保持约
700 行，继续只承担跨控制器用例和公共门面。

`StageRuntime` 的帧回调改为三个标量参数，不再逐帧创建 frame 对象。
`ExtensionHost` 只在 Extension 增删时排序，逐帧复用每个 Extension 的只读 frame
context，并用固定 `Float64Array` 环形缓冲记录 120 个耗时样本；不再执行 Set 复制、
排序或数组 `shift()`。Extension 同时获得明确的 `contextLost()` /
`contextRestored()` 生命周期，恢复顺序固定为 Host、主体 Renderer、Effect Program、
Extension，之后才恢复 Stage RAF。

Cards 内部拆出 `CardGeometry`、`CardAtlasMetrics` 与 `CardProgramLoader`。
Effect Program 通过显式 `clockUniform` 绑定 Stage 时钟；失败的动态加载 Promise
立即从缓存删除，允许瞬时 chunk 故障在下一次激活重试。`InstancedCardRenderer.ts`
从 989 行降至 818 行，仍保持一个主体 Mesh、一个活动 Material 和一个 Draw Call。

2026-07-28 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2000 Cards/high
3 秒回归：steady 为 60.00 FPS、P95/P99 18.50/18.60ms、平均 CPU/submit
0.012/0.125ms；transition-stress 为 60.00 FPS、P95/P99 18.40/18.70ms、完成
4 次操作；interaction-stress 为 59.99 FPS、P95/P99 18.45/18.70ms，751 次输入
合并为 180 次拾取，累计 picking 115.3ms。三组主体均为 1 Draw Call、0 个
24/33/50ms 长帧。Native Three.js 与 GSAP 双 Extension 稳态为 60.02 FPS、
P95 18.55ms，两个 Extension 合计平均 update 0.037ms、无慢帧或错误。

完整验证为 29 个测试文件、336 项测试。真实 root/Core/Cards-only 为
36,558/15,644/8,859 bytes gzip，tarball 约 114 KiB；浏览器控制台无 warning/error。

## 编译式 Renderer、可取消资源与 SoA Layout

公开 Renderer capability 在 Stage 构造期校验并编译为固定方法表，帧循环不再探测
可选能力。Cards 的 Material、Effect Program lifecycle 和 Atlas backend 分别由
`CardMaterialRuntime`、`ResourceScheduler` 与 `CardAtlasBackend` 管理；同一资源
channel 严格 latest-wins，backend prepare 共享一次可重试 Promise，避免完成顺序
反转让旧数据晚于新 revision 发布。Layout 新增按容量增长的 SoA
`TransformBuffer`，Grid/Helix 通过 `calculateInto()` 直接写入。

Extension 增加唯一 scene submission 前后的 render hook，并以默认 4ms update 预算
统计连续超限；连续三帧超限时跳过一帧，下一次 update 收到累计 delta。主体继续只
使用 Stage 的一条 RAF，render hook 不获得 WebGLRenderer。

2026-07-29 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2000 Cards/high
3 秒回归：steady 为 60.00 FPS、P95/P99 17.70/17.70ms；transition-stress 为
60.00 FPS、P95/P99 17.60/17.70ms并完成 4 次操作；interaction-stress 为
60.00 FPS、P95/P99 18.50/18.60ms，751 次输入合并为 180 次拾取。三组主体均为
1 Draw Call、0 个 24/33/50ms 长帧。Native Three.js 与 GSAP 双 Extension 稳态为
59.99 FPS、P95/P99 18.60/18.70ms、4 Draw Calls、平均 Extension update
0.037ms，无预算超限、节流或页面 error。四个内置 Effect Program 均完成真实
WebGL 延迟加载与 Shader 激活。

完整验证为 32 个测试文件、351 项测试（最终资源竞态补测后为 353 项）。真实
root/Core/Cards-only 为 39,539/16,351/10,165 bytes gzip，layout-only 8,166 bytes，
tarball 123,624 bytes；全部保持在 40/16/10 KB gzip、8 KB layout 与 150 KB
tarball 硬预算内。

## Cards Transition 零临时数组与默认 Backend 分包

Cards 的 Transition 上传不再对每个 from/to Transform 分别创建 position 和
quaternion 数组。2,000 项布局切换由原来的约 8,000 个短命数组改为直接标量写入
既有 TypedArray；八个 Attribute update range 通过无分配 pair helper 标记，GPU
Attribute、容量桶和上传范围保持不变。

默认 `DefaultCardAtlasBackend` 实现进一步拆为独立动态 chunk。基础 Cards 只保留
负责首次加载、失败重试和幂等销毁的轻量代理；传入自定义 `atlasBackend` 时不会
下载默认 Canvas/Worker backend。包验证同时检查默认 backend 标记不在基础 entry，
但必须存在于 lazy chunk。Renderer capability 编译结果也从内部 class 收敛为纯方法
表，只保留控制器实际使用的 patch 标记。

2026-07-30 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2,000 Cards/high
3 秒回归：steady 为 60.00 FPS、P95/P99 18.20/18.60ms；transition-stress 为
59.99 FPS、P95/P99 18.45/18.65ms并完成 4 次操作。两组均保持主体 1 Draw Call、
0 个 24/33/50ms 长帧；默认图集与四个内置 Effect Program 延迟加载后 WebGL
保持 READY，页面无 error。

真实 root/Core/Cards-only 消费体积由上一轮的 39,539/16,351/10,165 bytes gzip
降为 39,294/16,258/10,038 bytes，基础 Cards 获得 202 bytes 余量；layout-only
保持 8,166 bytes，tarball 为 123,961 bytes。

## 精确拾取按需加载与热态同步

`InteractionController` 只常驻事件合帧、稳定 id 焦点索引和异步失效状态；
投影四边形、surface 正反面、遮挡深度和 padding 计算移入独立
`ProjectedItemPicker` chunk。首次显式或 pointer 拾取加载并复用同一个 Promise，
非交互 Stage 不下载；公开 `pick()` 改为异步精确查询，冷启动 pointer 结果受最新 generation 和 destroy
保护。内核就绪后 hover/click 直接同步调用缓存实例，不在每帧交互热路径创建
Promise。键盘方向导航同时改为循环扫描可见项，不再为每次按键构造索引数组。

包验证要求精确拾取 marker 不得出现在 Core 基础 entry，且必须存在于 lazy chunk。
真实 root/Core/Cards-only 为 38,222/15,662/10,038 bytes gzip，相对上一轮分别减少
1,072/596/0 bytes；layout-only 保持 8,166 bytes，tarball 为 124,713 bytes。

2026-07-30 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2,000 Cards/high
3 秒回归：steady 为 60.02 FPS、P95/P99 18.40/18.60ms；transition-stress 为
60.00 FPS、P95/P99 18.50/18.65ms并完成 4 次操作。interaction-stress 三轮均执行
180 次拾取，累计 142.2/168.2/153.6ms，中位约 0.853ms/次；P95 为
18.15–18.50ms。全部场景保持主体 1 Draw Call、0 个 24/33/50ms 长帧，浏览器
控制台无 warning/error。刷新页面后从未加载 picker 的冷态 interaction-stress
同样为 60.00 FPS、P95/P99 18.25/18.60ms，首次加载计入后 180 次累计
picking 151.5ms，未产生长帧。

## 端到端 SoA Transform 与按需聚焦布局

Stage 的 settled 状态、稳定 id 重排、MotionController 过渡插值、Cards/Points
Renderer 上传和 `ProjectedItemPicker` 已统一为 `TransformBufferView`。Renderer 的
`setTransforms()` / `prepareTransition()` 不再接收 Transform 对象数组；Cards 直接
写入既有 Attribute，Points 复制到自有容量 Buffer，精确拾取按 TypedArray 下标读取。
过渡 scratch 和 Effect 适配 Buffer 均复用容量，交互路径不再物化 O(n) Transform。

Buffer 的对象物化与有限值校验移到 `defineLayout()` 定义边界，Stage 不重复扫描已经
验证的布局结果；`setValues()` 去掉每项重复边界判断。低频 `focusItems()` 布局构造
拆为 0.45 KB gzip 动态 chunk，并在加载期间通过 items 引用和 destroy 状态阻止旧结果
提交。拾取循环缓存 positions/scales/rotations/opacities 数组引用，避免每项重复属性
查找。

完整验证为 32 个测试文件、357 项测试。真实 root/Core/Cards-only 为
38,205/16,271/10,052 bytes gzip，layout-only 为 8,002 bytes，tarball 为
125,555 bytes；全部保持既有 40/16/10 KB gzip、8 KB layout 与 150 KB tarball
硬预算。

2026-07-30 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2,000 Cards/high
3 秒最终回归：steady 为 59.99 FPS、P95/P99 18.00/18.40ms；transition-stress
为 60.01 FPS、P95/P99 18.00/18.30ms并完成 4 次操作。interaction-stress 三轮均
执行 180 次拾取，累计 73.5/59.9/63.8ms，中位约 0.354ms/次，P95 为
18.00ms。全部场景保持主体 1 Draw Call、0 个 24/33/50ms 长帧，页面无 warning/error。
