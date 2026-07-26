# v1.9 视觉与稳定性验收矩阵

本矩阵把“效果更顺、更清晰、更稳定”转化为可重复检查。每次修改布局、Shader、图集或运行时生命周期时，至少执行受影响组合；发布候选执行完整矩阵并保存 benchmark JSON。

## 固定环境

记录浏览器版本、GPU、屏幕尺寸/像素比、实例数、质量档位、采样时长和提交 SHA。推荐视口：

| 视口 | 尺寸 | 重点 |
| --- | --- | --- |
| 活动大屏 | 1920×1080 | 默认视觉密度、纹理清晰度、1 Draw Call |
| 超宽屏 | 2560×1080 | contain/cover、主体居中和边缘空洞 |
| 竖屏 | 1080×1920 | 响应式网格、近裁剪和控制区可用性 |
| 小窗口 | 390×844 | 降级策略、触控命中和高 DPI 图集 |

固定规模使用 500、1000、2000；固定质量使用 high、medium、low。移动设备需额外记录是否自动降级。

## 布局矩阵

Sphere、Box、Cylinder、Grid contain/cover、Ring、Helix、Cone 分别检查：

- [ ] 零张、单张和常见数量没有无效坐标、重复或缺失。
- [ ] 500/1000/2000 张下卡片间距、尺寸和主体边界合理。
- [ ] camera/surface 朝向不出现突然翻面，背面隐藏符合布局语义。
- [ ] 横屏、超宽、竖屏 resize 后主体仍位于可视区域。
- [ ] 布局互切中途连续点击，旧动画不会在稍后覆盖新布局。
- [ ] 主体场景 `CALLS = 1`，质量切换不创建额外 Mesh。
- [ ] Sphere latitude/Fibonacci、完整球/球冠/球带切换时密度均匀，exclude 模式没有极点重叠。
- [ ] Sphere surface 在完整横向旋转和上下倾斜中头像顶部持续朝北；contain 在横屏、竖屏、超宽屏下不裁切，edgeFade 不产生轮廓闪烁。
- [ ] Cylinder 完整闭环与部分圆弧首尾正确，显式 rows 下各行分配均衡且不越过圆弧范围。
- [ ] Ring area/equal、stagger 与 clockwise 组合只改变预期分配和顺序。
- [ ] Box 单面/多面、边缘留白和面权重不产生未选面卡片；Cone 在尖锥、圆台和等半径极限间连续。

重点序列：`sphere → box → cylinder → grid contain → ring → helix → cone → sphere`，每 700ms 切换一次以覆盖中断。

## 布局参数实验室

- [ ] 桌面右侧抽屉和 390×844 底部面板都可滚动、关闭，且不会遮住必要操作。
- [ ] 八种布局切换后保留本次会话中的配置，自动字段不会被当前实例数固化。
- [ ] 连续拖动数值控件只应用防抖后的最终值，旧过渡不会覆盖最终配置。
- [ ] 预设、恢复默认、复制 JSON、复制 TypeScript 和合法 JSON 导入均与画面一致。
- [ ] URL 刷新恢复当前布局；无效 URL/导入显示字段路径、恢复默认且清除无效参数。
- [ ] 500/2000 实例快速调整时 Stage、Mesh 与图集构建数不增加，主体保持单 Draw Call；high/medium/low 连续切换最终容量稳定在 2000/1000/500，过期图集不覆盖最新质量。
- [ ] 高级预设、Sphere 模式互斥、Cylinder rows/columns 互斥、Box 面多选及权重控件都能生成可再次导入的合法 JSON。

## 流式特效矩阵

Tunnel circle/square、Linear Shooter、Vortex in/out、Radial Burst in/out 分别检查 continuous、burst、wave（适用时）：

- [ ] 出生和回收均在不可见窗口完成，没有周期边界闪现。
- [ ] 近端卡片在接近裁剪面前已平滑淡出，高速时无突然放大。
- [ ] 位置和缩放在端点减速，循环中段保持足够动势。
- [ ] burst 起止双边淡入淡出；wave 不产生整屏硬闪。
- [ ] effect → layout 从当前 CPU 帧继续，切换后没有旧 uniform 覆盖。
- [ ] high/medium/low 的活跃上限正确，休眠实例 opacity 为零。
- [ ] 500/1000/2000 输入下主体 `CALLS = 1`。

## 卡片与图集

- [ ] square/rounded/circle 在近景和远景均无额外黑边、方形淡边或相邻图块串色。
- [ ] 1:1、3:4、16:9 和边界 `0.25/4` 宽高比不拉伸图片，矩形 Atlas UV 无串色。
- [ ] cover/contain/fill、四角焦点、内容留白、overlay 和 1–3 行标题与配置一致，溢出标题带省略号。
- [ ] `resolveCardStyle()` 可按 `meta` 改变边框与内容样式，更新单个 id 只产生对应图集 patch。
- [ ] camera/surface/upright-surface 在矩形卡片四角内拾取准确，透明外部和几何外部不误命中。
- [ ] 1x/1.5x/2x DPR 下文字、边框和头像清晰度可接受。
- [ ] 32/64/96/128 `cardResolution` 的纹理内存变化与预期一致。
- [ ] 2000 张且模拟较小 `MAX_TEXTURE_SIZE` 时自动降低单元分辨率，不创建超限 Canvas。
- [ ] CORS 失败、图片加载超时和 drawCard 抛错都显示稳定占位图。
- [ ] 快速更新同一 id，仅最后一次局部图集 patch 生效。
- [ ] 产品、人物和指标 ES6 模板在 1:1、3:4、16:9 下布局正确，flex、绝对定位、渐变、裁剪和文字省略无越界。
- [ ] 模板的嵌套条件/数组、scoped class、动态 style 和多图片加载正确；非法标签/样式回退内置占位且不创建 DOM 卡片。
- [ ] 模板模式 500/1000/2000 输入保持主体 1 Draw Call，局部数据更新只增加对应 Atlas patch，模板资源不会随更新持续增长。
- [ ] 同容量档快速布局切换时 `geometryBuilds` 不增长，`attributeReuses` 持续增加；跨容量档只保留一个活动 Geometry/Material。
- [ ] 相邻卡片 patch 的 `atlasUploadRanges` 少于逐卡逐行范围，离散 patch 不上传无关大块。
- [ ] `atlasMode=single`、`array` 与 `auto` 画面一致，array 渐进上传期间未完成层透明且不显示垃圾像素。
- [ ] `auto + mipmaps:true` 使用 single；`auto + mipmaps:false` 只在图集不小于 16 MiB 时使用 array。
- [ ] Array context restore 从首层恢复，上传过程中保持主体 1 Draw Call，完成后 `pendingLayers` 归零。

## 开发诊断

- [ ] `validateLayout()` 在横竖屏 Context 和 0/1/100/500/2000 数量下无 error，warning 与实际重叠/密度问题一致。
- [ ] `validateMotionRenderer()` 对 Cards、Points 和自定义最小 Renderer 返回有限统计，重复更新后对象数不持续增长。
- [ ] 布局调试 Group 的边界、蓝色法线和绿色顶部方向与卡片画面一致，`dispose()` 后无 Geometry/Material 残留。

## 生命周期和压力测试

在 `/benchmark.html` 选择 500、1000、2000，分别运行普通采样和“切换压力测试”。提交前至少 60 秒，发布候选建议 30 分钟。

压力序列覆盖 Sphere、Box、Tunnel Burst、Grid、Vortex、Cylinder、Shooter Wave、Ring、Radial Burst、Helix、Square Tunnel 和 Cone，因而同时包含 layout→layout、layout→effect、effect→layout 与 effect→effect。

- [ ] 压力模式持续布局/特效中断和稳定 id 局部更新，无未处理异常。
- [ ] 页面隐藏后 FPS 采样暂停，恢复后不计入后台长帧。
- [ ] 手动 pause 后发生 context lost/restored，仍保持用户暂停。
- [ ] context lost 显示 `WEBGL LOST`，恢复后为 `READY` 且图集重新上传。
- [ ] 多次创建/销毁 Stage 后 Canvas、Observer、监听器和纹理不残留。
- [ ] 运行期间 Draw Call 不增长，纹理内存不随局部更新持续上升。

## 外部 Stage extension

- [ ] 原生 Three.js 与 GSAP 扩展可分别或同时挂载，根节点互相隔离，卡片布局与拾取不受影响。
- [ ] pause、页面隐藏和 context loss 只触发一次有效暂停；resume 后动画从 Stage 时间继续且不跳过后台时长。
- [ ] resize 传入 CSS 尺寸与实际 pixel ratio；快速 add/remove 和 Stage destroy 后无残留对象或动画。
- [ ] 任一扩展的 update/resize/pause/resume/dispose 抛错时，只移除故障扩展，卡片和其他扩展继续渲染。
- [ ] benchmark 记录 1–5 个扩展的数量、update 耗时和额外 Draw Call；扩展不创建自己的 RAF 或 Renderer。
- [ ] disable 后根节点隐藏、update 停止且 Draw Call 回落，enable 后在不重建资源的情况下恢复；remove 才最终 dispose。
- [ ] 相同 `order` 保持挂载顺序，不同 `order` 的 update/resize/pause/resume/dispose 顺序稳定。
- [ ] high/medium/low 与 Reduced Motion 切换会通知活动和已 disable 扩展，外部动画按示例策略降级或冻结。
- [ ] 同名扩展仍具有不同诊断 id；移除后只保留有界纯数据历史，不保留 Group、信号或动画资源。

## 自动化覆盖

`npm run verify` 覆盖类型、布局配置解析与等价性单测、库/demo 构建、tgz 消费者、稳定子路径、Tree Shaking 和体积预算。自动化可证明数值、竞态和资源契约，但不能替代目标设备上的视觉判断；人工结果应随发布记录保存。

2026-07-15 已完成本地 Chromium / 2000 items / auto-high 的 60 秒与 30 分钟压力基线。30 分钟长测完成 2001 次中断/局部更新，平均 60.00 FPS、最低 56.65 FPS、最大帧时 17.65ms、最大 1 Draw Call，纹理内存保持 55,987,200 bytes，WebGL READY、无 context loss、无页面 error 日志。详细数值记录在 `docs/RELEASE.md`。

2026-07-16 已完成 v1.7 参数实验室桌面浏览器验收：八布局控件可访问，预设、会话记忆、严格 JSON 回退、无效 URL 清理、URL 刷新恢复和 TypeScript 复制通过；500/2000 items 快速参数写入均保持 60 FPS、1 Draw Call，且参数变化前后图集构建计数不变。响应式底部面板由 390×844 媒体规则覆盖，仍需在目标触控设备上完成最终手势验收。

2026-07-16 已完成 v1.8 桌面浏览器验收：Fibonacci Sphere、Box 前/右选面与权重、Cylinder 半圆展墙、Ring 等量顺时针和 Cone 圆台均可从预设生成并写入 URL，保持 60 FPS、1 Draw Call、1 Atlas，控制台无错误。500 steady 与 2000 transition-stress 均为 0 个 24/33/50ms 长帧；目标触控设备手势验收仍沿用上项待办。

2026-07-16 已完成 v1.9 桌面浏览器验收：原生 Three.js 与 GSAP 扩展可单独/同时挂载，BOTH 模式为 2 个扩展、4 Draw Calls，移除后恢复 0 扩展、主体 1 Draw Call；Stage pause/resume 控件和动画恢复通过，控制台无错误。500 steady 与 2000 transition-stress 均保持约 60 FPS、扩展 update 最大 0.10ms，且为 0 个 24/33/50ms 长帧。

2026-07-16 已完成 v1.11 桌面浏览器验收：主 Demo、原生 Three.js 示例和 GSAP 示例均可在不 dispose 的情况下停用/启用扩展；主 Demo 从 2/2 EXT、4 Draw Calls 降至 0/2 EXT、1 Draw Call，再恢复至 2/2 EXT、4 Draw Calls，暂停/恢复、质量切换与最终移除正常，控制台无错误。500 steady 与复测的 2000 transition-stress 均为 0 个 24/33/50ms 长帧；回调顺序、Reduced Motion、同名 id、历史上限和故障隔离由自动化测试覆盖。

2026-07-25 已完成 Sphere 容量与轮廓验收：390×844、1600×600 和默认桌面视口下 contain 均完整显示，经典头像预设避开极点并启用 0.08 轮廓淡出；约 360° 横向旋转及快速布局中断后头像仍顶部朝北。500/1000/2000 high 与 2000 输入下的 medium/low 容量分别稳定为 500/1000/2000、1000/500，主体保持 1 Draw Call。2000 high transition-stress / 3 秒为 P95 18.55ms、0 个 33ms 长帧，控制台无 error 日志。

2026-07-25 已完成卡片内容与统一宽高比验收：500 个 1:1 圆形头像、1000 个 3:4 人物卡和 2000 个 16:9 信息卡均保持 60 FPS、1 Draw Call，图片不拉伸，标题和逐卡边框正确；390×844 竖屏 contain 与矩形拾取通过。2000 high steady / transition-stress 的 P95 分别为 17.80/18.20ms，均为 0 个 33ms 长帧，控制台无 error 日志。

2026-07-26 已完成 ES6 模板桌面浏览器验收：500 个 1:1 产品模板、1000 个 3:4 人物模板和 2000 个 16:9 指标模板均正确绘制，保持 60 FPS、1 Draw Call；球体/圆柱快速中断与整卡拾取通过。2000 项模板单卡数据更新只产生 1 个 Atlas patch，舞台内只有 1 个 Canvas 子节点，没有逐卡 DOM。

2026-07-26 已完成 Vanilla 卡片入口收敛验收：内容配方与 `1:1`、`3:4`、`16:9` 比例独立选择，选中状态和新 `content` / `aspect` URL 可恢复；旧 `card=template-product` 首次操作会原子迁移并保留当前内容与比例。基础、产品和 Canvas 路径在 1000 项下均保持单 Canvas、1 Draw Call，控制台无 error；产品、人物和指标在界面与文档中明确为源码配方而非公共预设。源码面板会随五种内容模式切换，分别展示基础配置、三种 ES6 tagged template 和底层 `drawCard()` 写法。

2026-07-26 已完成批量渲染器桌面验收：Points 的 500/1000/2000 项均保持单 Canvas、1 Draw Call，球体/圆柱快速中断、圆形拾取、暂停恢复和源码面板通过，Cards 专属内容/比例控件在 Points 模式正确禁用。默认 Cards 2000/high 的 steady 与 transition-stress P95 均为 18.25ms、0 个 33ms 长帧、1 Draw Call，压力场景完成 4 次中断/patch；浏览器控制台无 error。

2026-07-26 已完成协议加固复验：Points 的 500/1000/2000 项、球体/圆柱快速中断、圆形拾取和暂停恢复继续保持单 Canvas、1 Draw Call；Cards 500/2000 项与产品横卡回归正常。默认 Cards 2000/high 的 steady / transition-stress P95 分别为 17.34/17.50ms，均为 60 FPS、0 个 33ms 长帧、1 Draw Call，压力场景完成 4 次中断/patch，控制台无 error。

2026-07-26 已完成未发布 API 收敛复验：显式 Cards/Points Renderer 下，Points 1000/2000 与 Cards 500/2000 均保持单 Canvas、60 FPS、主体 1 Draw Call；Points 2000 的球体/圆柱连续快速中断稳定，Cards 2000 产品横卡 Atlas build 完成后恢复 60 FPS，控制台无 error。

2026-07-26 已完成运行时容量复用复验：Cards/Points 的 500/1000/2000 项均保持 60 FPS、主体 1 Draw Call，容量分别进入 512/1024/2048 桶；同容量档球体/圆柱切换的 `geometryBuilds` 保持 1，`attributeReuses` 增长且无资源累积。默认 Cards 2000/high 的 steady、transition-stress、连续 Atlas 更新 P95 分别为 17.60/17.46/17.50ms，均无 33ms 长帧；控制台无 error。

2026-07-26 已完成高频交互合帧复验：Cards 2000/high 在约 240Hz 合成指针输入下，3 秒 707 次事件合并为 180 次拾取，减少 74.5%，保持 59.99 FPS、P95 17.70ms、0 个 33ms 长帧和 1 Draw Call。Points 2000 保持主体 1 Draw Call，控制台无 error。

2026-07-26 已完成拾取低分配复验：Cards 2000/high/interaction-stress 三轮均执行 180 次拾取，累计 192.1/192.7/205.0ms，中位单次约 1.071ms，较原 3.249ms 降低约 67.0%；P95 17.55–18.60ms、0 个 24/33/50ms 长帧、主体 1 Draw Call。矩形 padding、surface 正反面、遮挡排序、Points disc 和数据重排后的焦点索引由自动化回归覆盖。

2026-07-26 已完成 Atlas 默认绘制冷启动复验：Cards 2000/high/cold-start 三轮 Atlas build 由 299.9ms 中位数降至 51.7ms，cell render/readback 中位数为 7.3/44.0ms；默认路径只创建 1 张整图 Canvas，产品模板隔离绘制路径保持正常。三轮均提交 2000 项、保持 1 Draw Call，P95 17.60–17.65ms；两轮存在一次 50ms 以上冷启动峰值，后续对照继续区分 CPU readback 与纹理首传。默认与产品模板画面无异常，控制台无 warning/error。

2026-07-26 已完成 Atlas 自动分辨率对照：2000/high 的自动 48px 三轮 build 中位数 40.1ms、readback 中位数 33.1ms、纹理约 33.9MB，相比固定 64px 的 51.7/44.0ms 和约 53.4MB 明显下降；保持 2000 submitted、1 Draw Call，球面头像清晰度可接受且控制台无 warning/error。40px 与 64px/无 mipmap 对照证明继续降清晰度或默认关闭 mipmap都不能消除冷启动长帧，因此保留 48px+mipmap，并把离主线程绘制/readback列为后续独立课题。

2026-07-26 已完成图片 Atlas Worker 与纹理首传对照：默认头像 Cards 的 500/1000/2000 项均把去重图片转换为 `ImageBitmap` 并在 Worker 完成整图绘制/readback，主体保持 1 Draw Call。2000/high/cold-start 使用自适应预热时为 60.01 FPS、P95 17.45ms、P99 17.60ms、0 个 33ms 长帧；位图解码 2.6ms、Worker 绘制/readback 3.9/27.4ms，控制台无 warning/error。强制预热大图集的对照出现一次 33ms 长帧，默认策略因此跳过超过 16 MiB 的像素缓冲。

2026-07-26 已完成 mipmap 与局部指纹对照：2000/high/cold-start 关闭 mipmap 后纹理内存降至 24.2MB，但首次提交仍为 30.9ms，未改变首传瓶颈，因此默认继续开启。逐项内容指纹下，2000 项单卡 patch 只解析一个变化索引；3 秒连续更新完成 17 次 patch，保持 60 FPS、P95 17.50ms、P99 17.65ms、0 个 33ms 长帧和 1 Draw Call，控制台无 error。

2026-07-26 已完成 Texture2DArray 对照：2000/high 的显式 array 与 `auto + mipmaps:false` 均使用 250 层自适应页面，渐进上传期间画面稳定，完成后 2000 项全部显示；首次 WebGL 提交约 4.3ms，P95 18.4–18.6ms、0 个 33ms 长帧和主体 1 Draw Call。`auto + mipmaps:true` 与 500 项无 mipmap小图集均保持 single。17 次 array patch 估算上传约 1.71 MiB，无资源或 Draw Call 增长，控制台无 warning/error。

2026-07-26 已完成 Array Worker 分页批次复验：2000/high/auto、48px、250 层完成全部渐进上传，球面卡片方向和层顺序保持稳定。三轮 cold-start Atlas build 中位数 55.0ms、readback 中位数 31.8ms，P95 18.55–18.60ms、0 个 24/33/50ms 长帧、主体 1 Draw Call，首次提交 4.2–6.5ms；默认 Cards 消费体积不变。
