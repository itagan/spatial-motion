# 性能与效果优化记录

本文件记录优化阶段的可复现证据和下一项优先工作，不承担发布清单职责。所有数字必须同时保存实例数、质量、场景、视口、DPR、GPU 和提交 SHA。

## v2 resident / submitted / visible 模型

运行中从高档降到中、低档时，Stage 先同步降低 Shader visible ratio 和流式特效提交量，
保证当前帧立即减压；随后通过同一受 revision 保护的内容协调器，把布局
resident/submitted pool 收敛到 Profile 上限。非连续 rank 只存在于协调完成前，提交新
pool 后重新计算该规模的完整 Layout，因此空间分布、拾取索引和 Program 数据顺序一致。

Cards 若目标列表是当前 Atlas 内容的未变化前缀，只调整 active item/instance count 并
重新上传必要的 Motion 属性；Atlas、Geometry、纹理和完整内容指纹继续保留。恢复到已
保留的前缀范围同样无需 Atlas build，隐藏期间发生内容变化则由指纹不匹配触发正常重建。
Points 在容量桶内复用 Attribute，自定义 Renderer 继续通过既有 `setItems()` 契约协调。
后续基准仍需分别记录 resident、submitted、visible 与 GPU bytes，不能用单个 item count
解释逻辑提交量和保留的纹理容量。

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

Atlas 局部更新的内容指纹改为逐项保存。完整 `setItems()` 仍扫描全部输入以识别完全相同的数据，而 `updateItem(s)` 只对去重、校验后的变化索引序列化 `meta` 和解析样式。2000 项单卡更新自动化确认只调用一次样式解析。Chromium 的 2000/high/atlas-update 3 秒复验完成 17 次单元 patch，保持 60 FPS、P95 17.50ms、0 个 33ms 长帧和 1 Draw Call。

## Texture2DArray 分页与渐进首传

Cards 增加显式 `single`、`array` 和 `auto` 策略。最初默认 `single` 保留 mipmap、细粒度行 patch 与既有视觉；冷启动基准确认大型 single 首传仍可产生 33ms 长帧后，默认改为 `auto`：大于等于 16 MiB 且未显式要求 mipmap 时选择 array。`array` 把 Atlas 拆成自适应二维页面并装入单个 `DataArrayTexture`，页面层编码在既有 Atlas rect 数据中，不增加实例 Attribute、Mesh 或 Draw Call。页尺寸会在设备层数限制内选择最小平衡方案，并额外限制为 256 层。

2026-07-31 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2000/high/cold-start
默认策略复验命中 auto→array：60.00 FPS、P95/P99 17.60/17.70ms，0 个
24/33/50ms 长帧、1 Draw Call；首次 render submit 由同机 single 的 28.4ms 降至
2.3ms，纹理由约 32.3 MiB 降至 23.93 MiB。Atlas build/readback 为 49.2/28.0ms，
但 Worker 构建未阻塞 Stage 帧；250 层在 64 个 Stage 帧批次内上传完成。画面完整，
浏览器控制台无 warning/error。

Array 首帧上传预算约 3 MiB，后续 Stage RAF 从 768 KiB 起步；连续两个不超过 18ms 的稳定帧会把预算逐级提高到 3 MiB，超过 24ms 时减半并冷却六帧。Renderer `frame.update()` 可选能力只负责协调该上传队列；默认 Cards 以外的 Renderer 不需要空实现。context restore 会从首层重新上传，局部 patch 则重传受影响的整页，因此 array 面向大型、相对静态的内容，single 仍是高频稀疏 patch 的合理默认。

2026-07-26 Chromium 150 / Apple M4 / 2000 Cards 实测：array 和 `auto + mipmaps:false` 选择 2×4 单元页面、250 层，首次 WebGL 提交约 4.3ms，P95 18.4–18.6ms，0 个 33ms 长帧并保持主体 1 Draw Call；`auto + mipmaps:true` 确定性使用 single，首次提交约 34.7–37.3ms。500 项无 mipmap图集约 10.49 MiB，低于 16 MiB 门槛，auto 同样保持 single。

17 次局部更新下，自适应页面累计估算上传约 1.71 MiB，相比固定 4×4 页面约 3.41 MiB 减半；single 仍只需约 0.16 MiB，验证了默认不切换 array 的取舍。Array Store 与 GLSL3 Shader 通过动态模块隔离，默认 Cards 消费包不包含 `sampler2DArray`。完整包检查为 root 37,093 bytes、Core 13,048 bytes、Cards 12,227 bytes gzip，tarball 100,875 bytes，均在既有预算内。

Array 默认卡片 Worker 随后移除“完整 2D Atlas readback 后再逐单元重排”的中间路径，改为平衡分页批次直接绘制、批量 readback 并写入最终 layer 缓冲。批次上限最初约 8 MiB，先在内存指标验证后收紧到 4 MiB，再经正式批次矩阵收紧到 2 MiB；最终 array、局部 patch 与 context restore 所需的 CPU 权威缓冲保持不变。2000 项 48px/250 层的 TypedArray 构建峰值由 31.39 MiB 降至 25.27 MiB，减少 19.5%；Canvas backing store 同样随批次缩小，但不计入该 TypedArray 指标。

完整批次随后单独验证 Canvas `willReadFrequently`，没有把局部 patch 的结论直接推广到
所有路径。2026-08-01 Chromium 151 / Apple M4 / 2000/high/cold-start、10 秒四路对照：

| 路径 | Build 基线 → 提示 | Readback 基线 → 提示 | 结论 |
| --- | ---: | ---: | --- |
| 默认 Worker Array | 81.6 → 52.3ms | 26.1 → 20.3ms | 保留 |
| 默认主线程 fallback | 53.0 → 99.9ms | 38.0 → 42.1ms | 回退 |
| ES6 模板主线程 | 407.9 → 409.5ms | 198.3 → 207.0ms | 回退 |
| 自定义 Canvas 主线程 | 522.1 → 524.2ms | 288.0 → 304.4ms | 回退 |

四组均约 60 FPS 且无 24/33/50ms 长帧。最终只在默认 Worker 的 Array 分页
OffscreenCanvas 创建时传入提示，Worker Single 仍使用原上下文；主线程直接绘制默认卡时，
软件 Canvas 的绘制与额外 RAF 让出成本明显超过读回收益，因此确定性保持原策略。结果：

- `benchmarks/results/2026-08-01-apple-m4-worker-readback-baseline.json`
- `benchmarks/results/2026-08-01-apple-m4-worker-readback-hint.json`
- `benchmarks/results/2026-08-01-apple-m4-main-thread-readback-baseline.json`
- `benchmarks/results/2026-08-01-apple-m4-main-thread-readback-hint.json`
- `benchmarks/results/2026-08-01-apple-m4-template-readback-hint.json`
- `benchmarks/results/2026-08-01-apple-m4-canvas-readback-hint.json`

`arrayPackMs` 原先已经从 Worker/Main-thread rasterizer 返回，但在 Renderer 生命周期统计
和 Benchmark delta 之间丢失。现在新增 `atlasArrayPackMs`；Benchmark v1 将该字段定义为
可选，旧 JSON 仍可严格解析，新结果会验证非负数并输出当前采样窗口的增量。

同环境 2000/high/cold-start、10 秒正式分解中，Worker build 69.4ms 包含 cell render
2.7ms、readback 17.6ms、pack 8.0ms；显式禁用 Worker 时 build 73.7ms，包含 cell
render 6.9ms、readback 41.5ms、pack 7.1ms。pack 分别只占 build 约 11.5%/9.6%，
两组均约 60 FPS、P95 17.5ms且无 24/33/50ms 长帧。它在 Worker 中不阻塞 Stage，
现有逐层倒序行复制只保留最终权威 buffer 和一个有界 readback，不为约 7–8ms 成本引入
第二份 layer 缓冲、WASM 或复杂分支。后续应先分解 Worker 启动、消息传输与主线程资源
提交墙钟。结果：

- `benchmarks/results/2026-08-01-apple-m4-worker-pack-breakdown.json`
- `benchmarks/results/2026-08-01-apple-m4-main-thread-pack-breakdown.json`

Worker 协议随后把成功响应中的内部渲染墙钟作为 `workerRenderMs` 返回，主线程从发送
请求前到收到响应记录 `workerRoundTripMs`；Renderer 生命周期和 Benchmark v1 分别以
`atlasWorkerRenderMs`、`atlasWorkerRoundTripMs` 累积，两个新字段继续保持可选，旧 JSON
无需迁移。内部计时覆盖单元绘制、readback、Array pack 和少量循环开销，往返还覆盖新建
Worker 的启动/调度以及请求和最终 ArrayBuffer 的转移。

同环境 2000/high/cold-start、10 秒正式样本为 Atlas build 64.0ms、Worker 往返 49.5ms、
Worker 内部 44.6ms；其中 cell render 3.9ms、readback 28.4ms、pack 10.9ms，三段合计
43.2ms。往返与内部差值仅 4.9ms，占 build 7.7%、占往返 9.9%；内部未分段部分约
1.4ms。该上限不足以抵消常驻 Worker 所增加的空闲资源、取消、代际和位图所有权复杂度，
因此保持每次完整默认 Atlas 构建独立创建、成功/失败/取消后终止 Worker 的策略，并继续
优先优化已量化的 readback。样本约 60 FPS、P95 17.5ms，0 个 24/33/50ms 长帧；结果
保存在 `benchmarks/results/2026-08-01-apple-m4-worker-timing-breakdown.json`。

随后固定 `willReadFrequently` 和其余环境，对 Worker Array readback 批次执行
1/2/8 MiB 各三轮、4 MiB 复用三份同口径样本的 2000/high/cold-start 对照。中位数：

| Worker 批次 | Atlas build | Readback | Worker 内部 | TypedArray 构建峰值 |
| ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 52.6ms | 21.2ms | 32.3ms | 24.88 MiB |
| 2 MiB | 48.6ms | 19.5ms | 29.2ms | 25.27 MiB |
| 4 MiB | 64.0ms | 20.3ms | 29.2–44.6ms | 27.75 MiB |
| 8 MiB | 57.1ms | 22.7ms | 35.4ms | 31.39 MiB |

所有运行约 60 FPS、P95 17.5–17.7ms 且无 24/33/50ms 长帧。2 MiB 相对 8 MiB 的
build/Worker 内部中位数分别降低约 14.9%/17.5%，构建峰值降低约 19.5%；继续缩到
1 MiB 只再减少 0.39 MiB 峰值，却使 build/readback/Worker 内部增加约
8.2%/8.7%/10.6%，已经越过拐点。因此默认 Worker 固化为 2 MiB；主线程默认、模板与
自定义 Canvas 仍分别维持其独立验证过的 4 MiB/1 MiB/512 KiB 策略。样本保存在
`benchmarks/results/2026-08-01-apple-m4-worker-batch-{1,2,4,8}mib-*.json`。

为排除 2000 项最优但批次数在大容量回退的可能，随后显式把 High resident 上限提高到
10000，对 5000/10000 项各复跑两轮 10 秒全量 cold-start。2 MiB 的 5000 项两轮
build/readback 为 102.9/41.6ms 与 100.8/40.8ms，10000 项为 138.0/82.8ms 与
139.5/84.4ms；两档均提交全部实例、上传完整 250 层、约 60 FPS、P95 17.5–17.6ms，
且无 24/33/50ms 长帧。相对既有 4 MiB 的 5000 项 101.8/60.7ms，build 持平而
readback 降低约 32%；相对 10000 项 161.0/106.6ms，build/readback 分别降低约
14%/22%。构建峰值也由 63.40/123.46 MiB 降至 61.73/121.06 MiB。因此固定 2 MiB
在默认和大容量范围都成立，不为未观察到的收益增加容量判断。结果保存在
`benchmarks/results/2026-08-01-apple-m4-worker-batch-2mib-large-full*-10s.json`。

首次大容量采集未覆盖 `--high-max-visible-items`，5000/10000 输入实际都被默认 High
Profile 裁为 2000 resident；这组无效样本已删除，未进入上述结论。为防止终端的请求
项数再次掩盖实际容量，质量矩阵摘要和 `runDiagnostics` 现在同时输出 resident/submitted
与请求项数；固定质量校准仍按 Profile 上限判断覆盖率，全量扩展性采集则必须显式覆盖
High 上限并核对两个数值。

在 2 MiB 固定后继续针对 pack 做结构优化。默认 Worker 的批次页面从平衡二维网格改为
等层数的单列排列；每页绘制时在 Canvas context 内预先垂直镜像，readback 后的数据已经
符合现有 `DataArrayTexture`、rect 和 patch 使用的底向上行序，因此最终缓冲从“每层逐行
倒序 `set`”变为“每层一次连续 `set`”。Shader、Atlas rect、主线程 fallback、局部 patch
和 context restore 的 CPU 权威格式均未改变；页面绘制使用 `try/finally` 恢复 transform。

同环境 2000/high/cold-start 三轮对照中，pack 中位数由 6.3 降至 2.4ms（约 -62%），
readback 由 19.5 降至 16.9ms，Worker 内部由 29.2 降至 23.3ms（约 -20%），往返由
34.2 降至 29.6ms；TypedArray 峰值仍为 25.27 MiB，约 60 FPS 且无长帧。Benchmark 的
累计 `atlasBuildMs` 当时还不能直接区分窗口内多个完整构建，三轮出现 61.1–67.8ms
波动；目标 Worker 的内部与往返三轮均一致下降，后续以单次 build 快照继续拆分总墙钟。

全量 High 扩展性复验中，5000 项 pack/Worker/build 从两轮约 10.4/57.3/101.9ms 降至
5.1/52.1/95.8ms；10000 项从约 18.1/113.2/138.8ms 降至 10.4/104.7/130.0ms。
readback、25.27/61.73/121.06 MiB 构建峰值、完整 250 层上传和 P95 均无回退。
Chromium 门禁同时通过默认 Worker、主线程 fallback、真实模板/Canvas 冷启动及局部
patch，确认预翻转没有改变画面或更新方向。结果保存在
`benchmarks/results/2026-08-01-apple-m4-worker-contiguous-pack*.json`。

为消除上述累计口径歧义，Renderer 指标新增最后一次完整构建的 build、prepare、图片
墙钟、cell render、readback、Array pack、Worker render 与 Worker round-trip 快照。
Benchmark v1 对应 `atlasLast*` 字段保持可选；只有首尾样本间 `atlasBuilds` 增加时才从
末样本读取，否则统一输出 0，避免 steady 或只有 patch 的窗口复用历史构建。旧 JSON
缺少这些字段时仍可严格解析。

2000/high/cold-start 三轮正式样本中，窗口都包含两次完整构建，但累计/最后一次 build
分别为 60.4/60.0、66.4/66.0、68.9/68.5ms，说明清空数据产生的额外构建仅约 0.4ms，
此前总墙钟波动不是累计污染。目标 build 的 Worker 往返为 29.4/29.7/30.5ms，内部为
22.5/22.5/23.7ms；`lastBuild - lastWorkerRoundTrip` 仍有 30.6/36.3/38.0ms。由此把下一
瓶颈明确收敛到 postMessage 之前的动态模块加载、Worker 构造、资源/样式与 request
准备，而不是已经降至 1.7–1.8ms 的 pack。三轮约 60 FPS、P95 17.5–18.4ms，0 个
24/33/50ms 长帧；结果保存在
`benchmarks/results/2026-08-01-apple-m4-atlas-last-build-breakdown*.json`。

Renderer 指标同时报告 `atlasCpuBytes`、`atlasGpuBytes`、当前
`atlasBuildPixelBufferPeakBytes` 和生命周期 `maxAtlasBuildPixelBufferBytes`。
这里的构建峰值只统计可确定的 TypedArray 像素存储，不把浏览器内部 Canvas backing
store 伪装成精确值。CPU Atlas 是局部 patch 和 context restore 的权威副本，因此当前
不能在首次上传后释放；CPU/GPU 常驻值相等是明确的恢复能力成本，而不是重复复制缺陷。

2026-08-01 Chromium 151 / Apple M4 / 1250×625 实际内容视口 / DPR 2 的 10 秒
全量 High cold-start 复测如下：

| 实例数 | CPU / GPU 常驻 | TypedArray 构建峰值 | Atlas build / readback | 首次提交 | 上传帧 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2000 | 23.93 / 23.93 MiB | 27.75 MiB | 79.5 / 25.7ms | 1.8ms | 9 |
| 5000 | 59.81 / 59.81 MiB | 63.40 MiB | 101.8 / 60.7ms | 1.7ms | 21 |
| 10000 | 119.63 / 119.63 MiB | 123.46 MiB | 161.0 / 106.6ms | 1.7ms | 42 |

三档均约 60 FPS、P95 18.2–18.25ms、P99 18.55–18.7ms，0 个
24/33/50ms 长帧并完整上传 250 层。后续 2 MiB 矩阵完成后，Chromium WebGL 门禁要求
默认 2000 项的构建峰值不超过常驻 CPU buffer 加 2 MiB。此前 4 MiB 结果保存在
`benchmarks/results/2026-08-01-apple-m4-atlas-memory-4mib-10s.json`；8 MiB 对照保存在
`benchmarks/results/2026-08-01-apple-m4-atlas-memory-baseline.json`。

主线程 fallback 随后复用同一 Array 页面规划。默认内容保持 4 MiB 上限；需要隔离单元
Canvas 的 `cardContent`/模板收紧为 1 MiB，自定义 `drawCard` 收紧为 512 KiB。卡片样式、
模板内容和图片只准备一次；内置默认卡片直接绘入批次 Canvas，自定义内容则在完整构建
中复用一个单元 Canvas。旧路径的完整 2D ImageData 与最终
DataArrayTexture 像素同时存活被移除。以 48px 全量 High 计算，2000/5000/10000 项旧
TypedArray 峰值约为 48.15/120.12/239.26 MiB，新路径为 27.75/63.40/123.46 MiB，
分别降低约 42.4%/47.2%/48.4%；完整 2D Canvas backing store 也被 4 MiB 批次替代。

主线程栅格随后采用 8ms 或最多两批的可取消时间片并让出到下一 RAF，避免减峰后仍把
所有 readback 连续塞进同一任务，也避免小批次机械地逐批等待一帧。
`mainThreadRasterYields`/`mainThreadRasterYieldMs` 表示当前 Atlas 构建，
`totalMainThreadRasterYields`/`totalMainThreadRasterYieldMs` 保留 Renderer 生命周期累计值。

模板与 `drawCard` 的完整 Array 构建进一步不再为批次内每张卡并发创建单元 Canvas。
同一个隔离单元 Canvas 在异步回调完成后立即合入批次、重置状态并服务下一张卡；因此
最大回调并发为 1，浏览器只需保留一份单元 backing store。异常仍在当前单元内回退默认
卡片，AbortSignal 可在单元之间及 RAF 让出处中止；局部 patch 继续返回独立 Canvas，
没有改变公共更新契约。

Chromium 151 禁用 `Worker` 后的 10 秒 cold-start 实测仍完整上传 250 层：2000/5000/
10000 项分别为 60.01/60.00/60.00 FPS，P95 18.06/18.35/18.25ms，首次提交均约
1.9ms；Atlas build/readback 为 90.7/39.0、268.1/107.5、516.2/193.0ms，单次构建
分别让出 6/16/31 帧。三档均为 0 个 24/33/50ms 长帧；相较协作让出前 2000 项的一次
33ms 峰值和 5000 项的一次 50ms 峰值，响应性边界得到修复，代价是 fallback 总构建
墙钟增加。主线程路径解决的是不支持 Worker 环境的正确性、峰值内存和响应性，支持
Worker 时仍默认优先使用 Worker。浏览器门禁同时覆盖正常 Worker 和显式禁用 Worker
两条路径。结果保存在
`benchmarks/results/2026-08-01-apple-m4-main-thread-array-fallback.json`。

Benchmark 随后增加 `content=template|canvas`，分别调用真实按需 `card-template` 与公共
`draw` 回调；采集 CLI 可用 `--content` 选择内容、用 `--screenshot` 保存同次运行画面。
Chromium 门禁会把 WebGL Canvas 复制到小型 2D probe，检查非透明像素、色彩像素与颜色
桶，同时断言完整上传、单 Draw Call、主线程让出以及对应临时峰值，避免只测到空纹理。

2026-08-01 Chromium 151 / Apple M4 / 1250×625 实际内容视口 / DPR 2、2000/high/
cold-start、10 秒正式复测：模板为 60.00 FPS、P95/P99 18.66/18.75ms，Atlas build/
readback 407.9/198.3ms，当前峰值 24.88 MiB（常驻 23.93 MiB + 0.96 MiB），24 次
协作让出；自定义 Canvas 为 60.01 FPS、P95/P99 18.60/18.70ms，build/readback
522.1/288.0ms，当前峰值 24.31 MiB（常驻 + 0.38 MiB），31 次让出。两组均为 0 个
24/33/50ms 长帧、1 Draw Call、250 层完整上传且 Worker renders 为 0。结果与同步截图：

- `benchmarks/results/2026-08-01-apple-m4-template-content-cold-start.json`
- `benchmarks/results/2026-08-01-apple-m4-template-content.png`
- `benchmarks/results/2026-08-01-apple-m4-canvas-content-cold-start.json`
- `benchmarks/results/2026-08-01-apple-m4-canvas-content.png`

调参过程中，模板从 4 MiB 收紧到 1 MiB 后消除了 24/33/50ms 长帧；Canvas 使用
512 KiB 后同样清零长帧，而“两批或 8ms”时间片把逐批让出的约 1.03s 构建墙钟降回
约 0.52s。复用单元 Canvas 后，模板/Canvas 的 cell render 分别从 107.9/34.7ms 降至
68.1/10.7ms，约减少 36.9%/69.2%；节省出的 CPU 预算通过更保守的 8ms 时间片换成帧
响应余量，因此总构建墙钟基本持平。该策略只改变主线程 fallback 的临时内存和调度，
不影响 Worker 默认路径。

同环境三轮 2000/high/cold-start 的 Atlas build 为 51.7/74.6/55.0ms，中位数 55.0ms；readback 为 30.7/39.5/31.8ms，中位数 31.8ms。P95 为 18.55–18.60ms，均为 0 个 24/33/50ms 长帧、主体 1 Draw Call，首次提交 4.2–6.5ms。默认 root/Core/Cards 消费体积保持 37,093/13,048/12,227 bytes gzip，新增实现只进入按需 Worker/Array chunk；tarball 约 99.1 KiB，仍低于既有预算。

## Atlas 局部上传低分配化

Single Atlas patch 不再为每个像素行建立 Map 项、范围数组和 `{ start, end }` 对象。变化单元按稳定 index 扫描，同一卡片行内相邻单元合并为连续 run，再直接生成 Three.js update range；分离单元保持独立范围。最常见的单卡 patch 直接复用输入列表，不再执行 `slice().sort()`。像素 readback 与逐行写入语义保持不变。

后续真实模板/Canvas `atlas-update` 基准发现，局部 patch 的 `getImageData()` 一直包含在
apply 总耗时中，却没有累计到 `atlasReadbackMs`，导致诊断错误显示为 0。Single 与 Array
Store 现在只围绕实际 `getImageData()` 计时并在 patch 提交时累计；apply 总耗时减去
readback 即为像素复制、上传范围整理和纹理标记成本，不新增冻结后的公共配置 API。

2026-08-01 Chromium 151 / Apple M4 / 1250×625 / DPR 2、2000/high、10 秒连续 56 次
单卡更新的修正后基线显示：模板/Canvas patch 总成本为 213.6/176.2ms，其中 readback
为 154.7/150.0ms，而除读回外的 apply 仅 1.7/2.1ms。瓶颈约 99% 位于 Canvas 读回，
因此没有继续微调 TypedArray 行复制。对绘制后必定立即读回的独立单元 Canvas 设置
`willReadFrequently` 后，正式复测如下：

| 内容 | Patch 总耗时 | Cell render | Readback | 相对基线 |
| --- | ---: | ---: | ---: | ---: |
| ES6 模板 | 110.5ms | 84.2ms | 16.5ms | -48.3% |
| 自定义 Canvas | 76.6ms | 59.8ms | 11.6ms | -56.5% |

提示使软件绘制阶段变慢，但模板/Canvas readback 分别减少约 89.3%/92.3%，净 patch 成本
仍下降约 48%/57%。两组均约 60 FPS、P95 18.30/18.26ms；模板为 0 个长帧，Canvas
记录 1 个 24/33ms、0 个 50ms 长帧，主体保持 1 Draw Call且画面像素门禁通过。
基线与正式结果保存在：

- `benchmarks/results/2026-08-01-apple-m4-template-atlas-update.json`
- `benchmarks/results/2026-08-01-apple-m4-canvas-atlas-update.json`
- `benchmarks/results/2026-08-01-apple-m4-template-atlas-update-readback.json`
- `benchmarks/results/2026-08-01-apple-m4-canvas-atlas-update-readback.json`

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

## Effect CPU 路径 Buffer 化

`StreamingEffect` 的 CPU 契约由返回 `Transform[]` 改为
`calculateInto(count, elapsedSeconds, target)`。`EffectController` 独占并复用一组
按容量增长的 `TransformBuffer`，进入特效、活动态拾取和 Reduced Motion 收敛都直接
写入同一 SoA TypedArray；Stage 不再物化 Effect Transform 对象，也不再做数组到
Buffer 的二次适配。四个内置 Effect 同时改为标量写入，路径和速度 payload 在相同
item 容量下原位更新，质量上限变化不会替换 GPU 上传数组。

完整验证为 32 个测试文件、362 项测试。真实 root/Core/Cards-only 为
38,322/16,278/10,052 bytes gzip，layout-only 为 8,002 bytes，tarball 为
125,935 bytes；继续满足 40/16/10 KB gzip、8 KB layout 与 150 KB tarball
硬预算。

2026-07-30 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2,000 Cards/high
3 秒回归：steady 为 60.01 FPS、P95/P99 17.70/18.45ms；transition-stress 为
60.00 FPS、P95/P99 17.50/17.60ms并完成 4 次操作；layout interaction-stress
为 60.01 FPS、P95/P99 17.50/17.60ms，746 次输入合并为 180 次拾取。四个内置
Effect Program 均完成首次按需加载并保持活动池 300、主体 1 Draw Call。
Radial Burst 激活态 interaction-stress 为 60.01 FPS、P95/P99 17.50/17.60ms，
751 次输入合并为 180 次拾取，累计 157.9ms。所有场景均为 0 个 24/33/50ms
长帧，WebGL READY，浏览器控制台无 warning/error。

## 全布局 Buffer-native、Stage 用例协调与 Extension 按需化

Sphere、Cylinder、Ring、Cone、Box 和 Scatter 与既有 Grid、Helix 一致，全部通过
`calculateInto()` 直接向调用方 `TransformBuffer` 标量写入。测试会监视
`TransformBuffer.copyFrom()`，确保八个内置 Layout 不再落回 `Transform[]` 适配路径。
按布局切换只保留与环、面等几何分组规模相关的少量结构，不创建 O(item count) 的
Transform、position 或 rotation 临时对象。

新增内部 `StageMotionCoordinator`，统一拥有 Layout 过渡、Effect 入场、Focus、
恢复、resize 重算、Reduced Motion 收敛和布局计算指标。`MotionStage.ts` 由上一阶段
约 870 行收敛为 717 行，只保留公共门面、生命周期、帧提交、Host 和 Extension
协调。低频 Effect 入场移入独立动态 chunk，并通过跨模块 generation 保证后发 Layout、
数据替换或 destroy 不会被慢加载或慢 Program 激活覆盖。

`ExtensionHost` 改为首次 `addExtension()` 时动态加载并缓存；未使用外部 Three.js/GSAP
能力的 Stage 不下载约 2.24 KB gzip 的扩展调度、节流和诊断模块。并发添加共享同一
初始化 Promise，加载前 destroy 不执行 mount，已进入异步 mount 后 destroy 仍会
abort、dispose 并拒绝旧操作。包验证同时断言 Extension marker 不得出现在 Core
基础 entry 且必须存在于 lazy chunk。

完整 `npm run verify` 为 32 个测试文件、367 项测试，类型、库/Demo/Examples 构建、
真实 tarball 安装、Node ESM、严格消费者类型、公开边界与浏览器消费者全部通过。
root/Core/Cards-only 为 36,610/14,610/10,052 bytes gzip，Core 相对本阶段起点
16,278 bytes 减少 1,668 bytes，并在 16 KB 上限下保留 1,774 bytes 余量；
layout-only 为 7,956 bytes，tarball 为 127,019 bytes。

2026-07-30 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2,000 Cards/high
3 秒回归：steady 为 60.00 FPS、P95/P99 17.60/17.70ms；transition-stress 为
60.00 FPS、P95/P99 17.60/17.60ms并完成 4 次操作；interaction-stress 为
60.00 FPS、P95/P99 17.60/17.70ms，751 次输入合并为 180 次拾取，累计
119.1ms。三组均保持主体 1 Draw Call、0 个 24/33/50ms 长帧和 WebGL READY。
首次启用 Native + GSAP 后两个 Extension 继续由 Stage RAF 驱动，平均扩展更新
合计约 0.05ms，60.00 FPS、P95/P99 17.70/17.70ms；其自有 3D 对象使场景总
Draw Call 增至预期的 4，但没有第二个 RAF 或第二次 scene submission。

## Layout 过渡工作区复用

`StageMotionCoordinator` 固定持有一对按容量增长的 `fromTransforms` 与
`targetTransforms`。每次切换先同步解析当前帧到 `from`，随后取消旧 Motion，
再让 Layout 直接覆盖 `target`；连续中断不再创建两个新 `TransformBuffer` 或为相同
容量分配新 TypedArray。容量从 1 增至 8 后再缩回 1 的测试确认 Buffer 对象保持
同一引用，已增长的 position 容量保持 24 个 float，不随 count 下降重新分配。

Effect 入场 Layout 已经把确定性时间 0 首帧复制进相同 `target` 工作区。Reduced
Motion 或 Program 激活失败时直接保留该已提交状态，不再额外创建 Buffer、复制四组
TypedArray 或第二次调用 `setTransforms()`；后发 Layout、内容变更与 destroy 的
generation 保护保持不变。

完整 `npm run verify` 为 32 个测试文件、370 项测试。root/Core/Cards-only 为
36,632/14,636/10,052 bytes gzip，layout-only 为 7,956 bytes，tarball 为
127,022 bytes；仍满足 40/16/10 KB gzip、8 KB layout 与 150 KB tarball 预算。

2026-07-31 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2,000 Cards/high
transition-stress 三轮均完成 4 次切换并保持 60.00–60.02 FPS、主体 1 Draw Call、
0 个 24/33/50ms 长帧。P95/P99 分别为 17.9/18.6、18.6/18.7、
18.5/18.7ms；平均 Stage CPU 为 0.050/0.025/0.012ms，平均提交为
0.088/0.075/0.088ms。页面无 warning/error。由于每轮只有四次布局计算，浏览器
帧分位变化不作为分配收益证明；Buffer 身份、容量与单次 Effect fallback 提交由
确定性单元测试直接验证。

## 内容事务、显式预热与观测快照

Stage 现在只维护一份稳定 id → resident index，Interaction 与内容更新共享查询，
不再分别重建 Map。完整内容更新的当前帧快照和目标状态来自并发安全、最多保留四个
空闲项的 `ContentTransformPool`；顺序更新复用两份已增长容量，并发、失败、过期和
destroy 均有确定性归还测试。

Cards 局部 patch 的去重索引和指纹改为有界 Workspace 租约，移除 Set、映射对象和
每次 patch 的数组链式分配。`resolveContentKey` 允许大数据业务以稳定修订号绕过
meta JSON 与样式解析；默认路径继续保持自动内容正确性。Workspace 自身的分配、
复用与保留上限由独立确定性测试覆盖，不增加公共 Renderer 指标面。

新增通用 `resourcePreparation` capability 与 `stage.prewarm()`。Cards 可在业务空闲
期强制准备当前 Atlas 纹理并加载、编译指定 Effect Program，但不切换活动 Material；
慢编译在 Renderer/Stage 销毁后只释放临时资源并返回 false。同步性能观察者共享一次
规范化快照，WebGL 环境能力查询缓存到 viewport 或 pixel ratio 变化，降低诊断面板
重复读取开销。

最终 `npm run verify` 为 34 个测试文件、386 项测试。root/Core/Cards-only 为
37,415/15,210/10,240 bytes gzip，layout-only 为 7,956 bytes，tarball 约为
129.6 KB；Patch Workspace 及索引规范化位于首次局部更新才加载的 0.45 KB gzip
chunk，所有硬预算通过。

2026-07-31 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2,000 Cards/high
3 秒回归：steady 为 59.98 FPS、P95/P99 18.60/18.65ms；transition-stress 完成
4 次操作并为 60.00 FPS、P95/P99 18.60/18.70ms；interaction-stress 为 59.98 FPS、
P95/P99 18.60/18.70ms，751 次输入合并为 180 次拾取。三组均保持主体 1 Draw Call、
0 个 24/33/50ms 长帧、WebGL READY，控制台无 warning/error。

## 默认 Array 冷启动、浏览器门禁与 Cards 拆分

Cards 的未配置 `atlasMode` 现在按 `auto` 处理：像素达到 16 MiB 且未显式要求 mipmap
时选择渐进 Array Atlas；显式 `mipmaps: true` 仍确定性保留 Single Atlas。Benchmark
页面也不再把未配置参数改写成旧的 Single/mipmap 组合。2000/high/cold-start 实测为
60.0 FPS、P95/P99 17.6/17.7ms、0 个 24/33/50ms 长帧和主体 1 Draw Call；默认
auto 选择 250 层 Array，全部层在 64 帧内上传，首次提交 2.3ms，纹理约 23.93 MiB。

Stage 环境快照新增实际 WebGL context 的 antialias 状态，质量档位文档明确 antialias
只在创建 context 时生效；运行时降级继续通过 pixel ratio 和 shader-visible ratio 调整，
不会虚报 context 能力或缩减已提交实例池。Playwright 在真实 Chromium/WebGL 中固定
执行 2000 卡冷启动，检查 WebGL/antialias、完整上传、1 Draw Call、实例数量、首次提交、
FPS、P95、长帧与 CPU/提交预算；GitHub CI 独立安装 Chromium、运行门禁并保留失败制品。

Atlas 统计实现改为随首次 backend 准备动态加载，同时保留首次 `setItems()` 前完整的零值
统计契约。Renderer 配置/指纹策略和默认 backend 懒代理分别拆到独立模块，
`InstancedCardRenderer.ts` 从 784 行降到 652 行，并新增 5 个配置边界单测。
最终 `npm run verify` 为 35 个测试文件、392 项测试，类型、Library/Demo/Examples、真实
tarball 消费与公开边界全部通过；Chromium WebGL 门禁随后通过。root/Core/Cards-only
为 36,992/15,251/9,813 bytes gzip，Cards 在 10 KiB 硬上限下保留 427 bytes 余量；
layout-only 为 7,956 bytes，tarball 为 131,206 bytes。

## Array Atlas 自适应帧预算

固定 768 KiB 帧预算虽然能保护低性能设备，但在稳定 60 FPS 的桌面设备上会不必要地
延长渐进完整显示时间。新的内部上传策略只消费既有 `frame.update(deltaSeconds)`，不扩展
Renderer 公共协议：预算从 768 KiB 起步，连续稳定帧按 1×/2×/4× 增长，上一帧超过
24ms 时立即减半并进入六帧冷却。Atlas 重建和 WebGL context 恢复会重置策略；完成全部
层后不再执行无效 backend 调用。

2026-08-01 Chromium 150 / Apple M4 / 1265×633 / DPR 2 的 2000/high/cold-start
有界面三轮均为 60 FPS、P95 17.6–17.7ms、P99 17.7ms，0 个 24/33/50ms 长帧、
主体 1 Draw Call。预算稳定升至 3 MiB、退避为 0，250 层均在 9 个实际上传帧完成，
首次提交为 2.0–2.5ms；相对上一轮记录的 64 帧缩短约 86%。无头 Chromium 因自身
调度只有约 49 FPS 且存在 24ms 压力，策略保持 768 KiB 并在 34 个上传帧安全完成，
证明慢环境不会为了追求完成速度强制升档。策略确定性单测覆盖升档、退避、冷却与重置，
浏览器门禁在无退避升至 3 MiB 时要求不超过 12 个上传帧。

上传帧指标随后按资源代际收敛：`layerUploadFrames` 只表示当前 Atlas 自准备完成后的
实际渐进上传帧数，在 Atlas 重建、WebGL context restore 和 dispose 时归零；
`totalLayerUploadFrames` 保留同一 Renderer 生命周期累计值。Benchmark 同时输出两者，
避免连续场景或资源恢复后把历史帧数误判为本次冷启动成本。单测固定了首次上传、恢复后
重新计数和销毁后当前资源指标清零的行为。

最终 `npm run verify` 为 36 个测试文件、395 项测试，Library/Demo/Examples、真实
tarball 消费和 Chromium WebGL 门禁全部通过。root/Core/Cards-only 为
37,065/15,251/9,888 bytes gzip，layout-only 为 7,956 bytes，tarball 为
131,833 bytes；Cards 在 10 KiB 上限下剩余 352 bytes，下一阶段应优先拆分 Effect
Runtime，而不是提高预算。

## 2026-08-01 发布候选 API Freeze 验收

新增 `examples/custom-renderer-layout`，只从稳定包入口与 Three.js peer dependency
导入。业务 Layout 根据 `MotionItem.meta` 分组并直接写入 `TransformBuffer`；自定义
Renderer 使用单个 `LineSegments`、容量复用 Attribute、GPU 过渡和质量裁剪，完整
实现统计、context restore 与幂等释放。

真实 tgz 消费者会运行自定义 Layout/Renderer 诊断，验证业务 meta、Buffer count、
三轮容量变化及销毁后无对象残留；包检查同时冻结 `package.json#exports` 子路径白名单。
本地 Chromium 的业务分组与 Sphere 往返均为 1 Canvas、1 Draw Call、180 submitted、
34,816 GPU bytes，控制台无 warning/error。完整验证为 36 个测试文件、395 项测试；
root/Core/Cards-only 分别为 37,065/15,251/9,888 bytes gzip，tarball 132,785 bytes。

## 2026-08-01 多环境质量矩阵基础

仓库新增 `benchmark:matrix`，自动遍历固定实例数与 high/medium/low，保存完整环境、
原始 `BenchmarkResult` 和按环境隔离的建议。判定与默认自适应降级边界保持一致：
平均 FPS 不低于目标的 78%，P95 不超过该 FPS 的帧预算，33ms 长帧比例低于 8%，
同时要求主体 1 Draw Call 和有效提交。该工具只属于仓库工作流，没有改变已冻结的
包入口或运行时 API。

首份 1265×633、DPR 1、Chromium 151 无头 SwiftShader 的 3 秒 steady 矩阵保存在
`benchmarks/results/2026-08-01-swiftshader-quality-matrix.json`。500 项 High 为 87.4
FPS / P95 17.9ms，建议 High；1000 项 High 的 P95 为 27.1ms，Medium 为 73.6 FPS /
P95 27.1ms，建议 Medium；2000 项 High 为 51.9 FPS / P95 28.3ms，Medium 为 70.1
FPS / P95 26.7ms，建议 Medium。所有运行保持 1 Draw Call。

这些数字只证明采集与建议闭环，并暴露出软件渲染随短采样产生的调度波动；不能用于
修改 Apple M4 或其他原生 GPU 默认档位。正式校准仍需目标硬件的 10 秒 steady +
transition-stress、有界面模式和长时间视觉验收。

## 2026-08-01 Apple M4 原生 GPU 质量矩阵

首份原生 GPU 正式矩阵保存在
`benchmarks/results/2026-08-01-apple-m4-chromium-quality-matrix.json`。采集使用有界面
Chromium 151、ANGLE Metal Renderer: Apple M4、DPR 2；请求窗口为 1265×633，浏览器
实际内容视口为 1250×625。500/1000/2000 项分别遍历 High、Medium、Low，每档同时运行
10 秒 steady 与 transition-stress，共 18 组。

| 实例数 | 建议档位 | High steady | High transition-stress | High 实际提交 |
| ---: | --- | --- | --- | ---: |
| 500 | High | 60.0 FPS / P95 17.7ms | 60.0 FPS / P95 17.7ms | 500 |
| 1000 | High | 60.0 FPS / P95 17.5ms | 60.0 FPS / P95 17.5ms | 1000 |
| 2000 | High | 60.0 FPS / P95 17.6ms | 60.0 FPS / P95 17.6ms | 2000 |

18 组均为主体 1 Draw Call、0 个 24/33/50ms 长帧，且 rendered/submitted 与各质量
档的裁剪策略一致：High 提交全部实例，Medium 最多 1000，Low 最多 500。三个规模下
High 均同时通过平均 FPS、P95、33ms 长帧比例和提交有效性门槛，因此该环境建议 High。

这份矩阵证明默认 High 的 2000 项上限尚未触及 Apple M4 的稳定帧性能边界，不能据此
提高所有设备的默认档位。矩阵校准随后增加实例覆盖校验：每档必须恰好 resident/submitted
`min(inputItems, maxVisibleItems)`，避免把“输入 10000、实际只渲染 2000”误读为 10000
项全量性能。

开发基准提供显式 `--high-max-visible-items`，只用于绕过默认 High 上限寻找硬件边界，
不会改变库的默认配置。3000/5000/10000 项全量 High 的 3 秒探测均约 60 FPS；纹理占用
分别为 35.89/59.81/119.63 MiB，渐进上传分别需要 13/34/76 个实际上传帧。10000 项随后
完成 10 秒正式 steady 与 transition-stress 复测：两者均为 60.0 FPS、P95 18.4ms、
P99 18.60–18.65ms、0 个 24/33/50ms 长帧、1 Draw Call，并完整 resident/submitted
10000 项。结果保存在
`benchmarks/results/2026-08-01-apple-m4-10000-uncapped-quality-matrix.json`。

全量稳态帧率仍未触及 M4 拐点，但 10000 项纹理已经达到默认 2000 项约五倍；当前约束
首先是内容与纹理容量，而不是 Draw Call 或逐帧 CPU。默认 2000 上限保持不变。下一步
优先补齐 Intel 集显、Android 中低端 GPU 和 iOS Safari 的同规格证据，并增加冷启动/
内存压力边界；在至少覆盖一个桌面低端与一个移动端环境前，不调整默认质量参数。

同环境随后运行 2000/5000/10000 项全量 High、10 秒 cold-start 矩阵。采集器新增独立
`runDiagnostics`，保存页面在重建后连续两个 RAF 内捕获的首次真实提交峰值，避免 500ms
性能样本漏过纹理首传。

| 实例数 | Atlas build / readback | 首次提交 | 纹理 | 上传帧 |
| ---: | ---: | ---: | ---: | ---: |
| 2000 | 62.5 / 29.6ms | 2.3ms | 23.93 MiB | 9 |
| 5000 | 98.6 / 56.5ms | 2.0ms | 59.81 MiB | 22 |
| 10000 | 172.6 / 107.2ms | 2.0ms | 119.63 MiB | 42 |

修正上传帧的资源代际口径后复测，三档均约 60 FPS、P95 18.6–18.7ms、
P99 18.7–18.75ms、0 个 24/33/50ms 长帧，
并在采样结束前完整上传、resident/submitted 全量实例。Worker 隔离了随容量增长的绘制与
readback，分页上传也把首次提交稳定在 2.3ms 内；当前无需改动提交策略。先前表格的
18/60/144 混入了配置切换与 cold-start 重建的历史帧数，并非单个 Atlas generation；
本轮生命周期累计值 18/62/146 仅作为诊断保留。下一轮针对大容量
内存应评估更低的自动 resolution 或业务侧内容分页，但必须以清晰度验收为前提，不能仅
为 10000 项非默认场景牺牲默认 2000 项画质。结果保存在
`benchmarks/results/2026-08-01-apple-m4-atlas-upload-metrics.json`。

10000 项全量 High 随后显式对照 48/40/32px，每组运行 10 秒 cold-start；该参数只作用于
Benchmark 页面，不改变 Cards 的默认 `auto` 分辨率。

| 分辨率 | Atlas build / readback | 首次提交 | 纹理 | 上传帧 | 相对 48px 纹理 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 48px | 183.0 / 102.5ms | 1.8ms | 119.63 MiB | 84 | 基线 |
| 40px | 146.5 / 75.0ms | 1.7ms | 87.89 MiB | 64 | -26.5% |
| 32px | 133.6 / 64.4ms | 1.8ms | 61.04 MiB | 42 | -49.0% |

三组均为 60 FPS、P95 17.5ms、0 长帧并完成全部层上传。有界面 Chromium 固定使用
500 项 Grid 近景对照：40px 基本保留 48px 的头像轮廓、金色边缘和编号可辨识度；32px
的小字号编号与细边缘已经明显变软，页面无 warning/error。结论是 40px 可作为业务明确
接受画质折中后的超大容量显式选项，32px 不进入自动策略；默认 High/2000 项继续使用
现有 auto→48px，不因非默认 10000 项场景降低画质。

## Cards Effect Runtime 按需化

基础 Cards 入口只保留 Base Material、公共 Uniform 同步和自定义 Motion Program 上传；
Effect Program Loader、生命周期、编译缓存、材质切换与失败统计移入首次
`streamingEffects.enable()` 或显式 Program prewarm 才加载的 `CardEffectRuntime` chunk。
空 Program 列表和仅纹理 prewarm 不触发下载。动态 import 期间的 disable、Atlas 重建和
destroy 通过 generation、共享 ResourceScheduler 与绑定身份继续阻止旧结果提交。

真实 tgz 消费者门禁验证 Effect Runtime marker 不存在于 Cards 基础 bundle、只存在于
lazy chunk，四个内置 Effect Program 仍保持各自独立 chunk。加入后续 Atlas 诊断后，
Cards-only 从 9,888 降至 8,889 bytes gzip，减少 999 bytes；距 10 KiB 上限的余量
由 352 增至 1,351 bytes。root consumer 从 37,065 降至 36,285 bytes gzip；Core-only
保持 15,251 bytes，tarball 在加入独立主线程 fallback chunk、内容基准与单元 Canvas
复用、readback/pack/Worker 时序诊断、批次矩阵、连续 pack、单次 build 快照与冷启动
重叠后约为 141 KiB，仍低于
150 KiB 上限。
模块总量略增是独立 lazy 模块、诊断与 sourcemap 的代价，不代表基础消费者下载回退。

2026-08-01 Chromium 151 / Apple M4 / 1250×625 实际内容视口 / DPR 2 的 2000/high
10 秒回归：steady 为 59.99 FPS、P95/P99 17.7/17.7ms，Program load/switch/cache 均为
0，证明基础场景没有激活可选运行时；transition-stress 为 60.00 FPS、P95/P99
17.7/17.7ms，12 次操作触发 4 次 Program load、5 次切换并缓存 4 个内置 Program，
失败为 0。两组均为 0 个 24/33/50ms 长帧、主体 1 Draw Call，最大 Stage CPU 0.1ms、
最大提交 0.4/0.3ms。结果保存在
`benchmarks/results/2026-08-01-apple-m4-effect-runtime-split.json`。

完整 `npm run verify` 为 36 个测试文件、400 项测试；Library/Demo/Examples、真实 tgz、
严格 TypeScript、冻结 exports 与消费者浏览器构建全部通过。四项 Chromium WebGL 门禁
覆盖默认 Worker、显式禁用 Worker、模板/Canvas 冷启动，以及两类真实内容的连续局部
更新。该阶段不执行版本、Tag、npm publish 或 Release。

## Worker 冷启动分解与启动重叠

最后一次 Atlas build 快照继续细分为 Runtime 动态加载、`Worker` 构造、请求对象准备和
进入 Runtime 到 `postMessage()` 的总墙钟；所有字段在 Benchmark v1 中保持可选，旧结果
仍可解析。发送前新增 already-aborted 检查，覆盖图片位图异步解码完成后、监听器挂载前
发生中止的窗口，确保 Worker 和未转移的 `ImageBitmap` 只释放一次且 Promise 不悬挂。

2026-08-01 Chromium 151 / Apple M4 / 1250×625 / DPR 2 的 2000/high/cold-start
三轮对照如下（均为中位数）：

| Runtime 策略 | Atlas build | Runtime load | pre-post | round-trip | Worker render |
| --- | ---: | ---: | ---: | ---: | ---: |
| 动态串行基线 | 43.2ms | 11.2ms | 13.1ms | 30.6ms | 25.6ms |
| 静态合并实验 | 40.2ms | 0ms | 11.7ms | 28.1ms | 26.2ms |
| lazy + Worker 提前启动 | 40.6ms | 11.3ms | 12.8ms | 27.8ms | 25.9ms |

静态合并把约 11ms 首次成本转移到 Worker 启动期间的主线程准备，并没有等量消除，且会
放弃独立 Runtime 边界，因此不采用。最终方案先发起 Runtime `import()`，在等待期间构造
Worker，再把已启动的 Worker 交给 Runtime；Atlas build 相对串行基线降低约 6%，同时
保留默认 Atlas backend 和 Worker Runtime 的按需边界。三轮最终方案均为 60.0 FPS、
P95 18.6ms、0 个 24/33/50ms 长帧并完整 resident/submitted 2000 项。原始结果保存在
`benchmarks/results/2026-08-01-apple-m4-worker-pre-post-breakdown-run1.json` 至 `run3`、
`benchmarks/results/2026-08-01-apple-m4-worker-runtime-static-run1.json` 至 `run3`，以及
`benchmarks/results/2026-08-01-apple-m4-worker-runtime-overlap-run1.json` 至 `run3`。

## 生产冷启动采集与 Worker readback 复核

上述 Runtime 三轮对照来自同一 Vite development server 口径，适合比较同模式相对变化，
但 `runtimeLoad` 的绝对值可能包含首次请求触发的源码 transform。质量矩阵采集器因此新增
`--preview`：要求使用未占用端口，先执行生产构建，再启动 Vite preview；结果矩阵记录
`serverMode: "preview"`，默认开发采集则记录 `development`。两种模式不得混合比较。

生产 preview / Chromium 151 / Apple M4 / 1250×625 / DPR 2 的三轮 2000/high/
cold-start 重新验证了两个候选：

| 候选 | Atlas build | Runtime load | Prepare | Readback | Worker render |
| --- | ---: | ---: | ---: | ---: | ---: |
| lazy Runtime 控制组 | 63.0ms | 34.8ms | 1.0ms | 17.1ms | 24.6ms |
| 静态 Runtime | 61.6ms | 0ms | 33.7ms | 17.6ms | 24.9ms |
| `desynchronized` Canvas | 61.4ms | 33.7ms | 约 1ms | 17.9ms | 23.8ms |

静态 Runtime 只改善约 2.2%，加载成本主要转移到 Worker 启动期间的准备等待，同时会扩大
默认 Atlas backend chunk，因此继续保留 lazy Runtime。`desynchronized` 没有降低生产
readback（17.1→17.9ms），也不保留。两项实验均约 60 FPS、P95 17.6–17.7ms、无
24/33/50ms 长帧；这证明当前约 17ms readback 无法再通过 Canvas context hint 稳定降低。
下一步若继续攻击该段，需要评估不经 CPU `getImageData()` 的 GPU Array texture 上传链路，
并先解决局部 patch、context restore 与 CPU 权威缓冲契约，不能把读回简单搬到主线程。

## 长时间稳定性趋势门禁

Atlas 微优化停止后，投入转向跨设备校准和长时间资源稳定性。质量矩阵新增
`--stability`，在现有 steady/transition-stress/atlas-update 场景外不复制业务操作逻辑；
浏览器每个配置按指定间隔采集 JS heap、DOM 和 Canvas，既有 500ms Benchmark 样本继续
提供 GPU bytes、纹理 bytes、Geometry build、资源/Program 失败和 context loss。

判定将前半段定义为预热窗口，允许 Atlas 与四个 Effect Program 按需建立；后半段必须
收敛。Heap 使用稳定窗口首尾三分之一的低水位差抵抗 GC 锯齿，默认最多保留 16 MiB；
GPU/纹理/Geometry/Canvas 和失败计数不得增长，DOM 最多增加 5 个节点。原始样本、阈值、
指标和结构化失败原因全部写入 `stabilityDiagnostics`，失败时仍保存证据并返回非零退出码。

2026-08-02 production preview / Chromium 151 / Apple M4 / 1250×625 / DPR 2 的
2000/high/transition-stress 20 秒 smoke 完成 23 次操作：60.0 FPS、P95 17.4ms、0 个
24/33/50ms 长帧。后半段 retained heap、DOM、Canvas、GPU bytes、纹理 bytes 与 Geometry
build 均零增长，无 context loss 或图片失败。结果保存在
`benchmarks/results/2026-08-02-apple-m4-transition-stability-smoke.json`；该短样本只验证
门禁闭环，正式设备证据仍应运行 300 秒，候选版本资源改动运行 1800 秒。

同环境随后完成 60 秒 transition-stress：67 次操作、60.0 FPS、P95/P99
18.26/18.60ms、0 个长帧；稳定窗口 retained heap 增长约 0.63 MiB，其余资源与失败
指标全部零增长。20 秒 atlas-update 完成 112 次真实 patch，60.0 FPS、P95 18.25ms、
0 长帧；heap 低水位增长约 2.10 MiB，其余已采指标同样零增长。结果分别保存在
`benchmarks/results/2026-08-02-apple-m4-transition-stability-60s.json` 和
`benchmarks/results/2026-08-02-apple-m4-atlas-update-stability-smoke.json`。

同日的 300 秒 production preview 正式时长运行完成 334 次 transition/patch 操作：平均
60.0 FPS、最低窗口 59.98 FPS、P95/P99 17.60/17.75ms、主体 1 Draw Call，且没有
24/33/50ms 长帧。稳定窗口 retained heap 仅增长 342,146 bytes，DOM、Canvas、GPU bytes、
纹理 bytes 与 Geometry build 均零增长，无 context loss 或图片失败。
结果保存在 `benchmarks/results/2026-08-02-apple-m4-transition-stability-300s.json`。

为避免单机结果被误当成跨设备结论，`benchmarks/device-targets.json` 固化五类目标及其
steady/300 秒长稳要求，`npm run benchmark:coverage` 自动扫描证据并匹配浏览器、平台、
GPU、viewport、DPR、规模、质量和场景。审计发现 Stage 的 64 项 Renderer 指标上限会截掉
Cards 的资源与 Program 失败计数，旧结果因此只能证明已保存的部分趋势。上限已扩至 96，
长稳判定升级为 v2：必要样本或关键计数缺失时直接失败，覆盖工具也拒绝旧版 `passed`。

覆盖门禁随后进一步要求同一目标的所有场景共享同一个干净源码 SHA，不能把不同代码版本的
独立通过结果拼成 `qualified`。从干净 SHA `14e08574e821` 连续重采的 Apple M4 证据为：

- 10 秒 steady：60.0 FPS、P95 17.4ms、0 长帧、2000 resident/submitted、1 Draw Call；
- 300 秒 transition-stress：334 次操作、60.0 FPS、P95/P99 17.70/17.80ms、0 长帧；
  稳定窗口包含 16 个浏览器样本与 301 个 Renderer 样本，Heap、DOM、Canvas、GPU/纹理
  bytes、Geometry build、资源与 Program 失败均零增长。

结果分别保存在 `benchmarks/results/2026-08-02-apple-m4-same-revision-steady.json` 与
`benchmarks/results/2026-08-02-apple-m4-same-revision-stability-300s.json`，共同使
`apple-silicon-desktop` 在 SHA `14e08574e821` 上达到 `qualified`。Intel、Windows、
Android 与 iOS 仍缺真实设备证据；在覆盖完整前不调整默认 Profile，也不把 UA/viewport
模拟当作实机结论。

真实移动端采集入口随后补齐：Benchmark 页在任意设备浏览器中每 5 秒保存 Heap（可用时）、
DOM/Canvas，同时保留 500ms Renderer 样本和运行操作数；独立“导出设备证据”不会改变原有
单结果导出与基线比较格式。仓库端 `benchmark:import-device` 验证 UA 与环境一致、矩阵与
结果一致、时长和采样间隔有效，再绑定当前代码 SHA、重算 v2 稳定门禁及质量建议。这样
Android/iOS 可以用真实 GPU/WebKit/Chromium 数据进入同一覆盖报告，不依赖桌面设备模拟。
