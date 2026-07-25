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
- [ ] 1x/1.5x/2x DPR 下文字、边框和头像清晰度可接受。
- [ ] 32/64/96/128 `cardResolution` 的纹理内存变化与预期一致。
- [ ] 2000 张且模拟较小 `MAX_TEXTURE_SIZE` 时自动降低单元分辨率，不创建超限 Canvas。
- [ ] CORS 失败、图片加载超时和 drawCard 抛错都显示稳定占位图。
- [ ] 快速更新同一 id，仅最后一次局部图集 patch 生效。

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
