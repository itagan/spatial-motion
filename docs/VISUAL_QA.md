# v1.1 视觉与稳定性验收矩阵

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

重点序列：`sphere → box → cylinder → grid contain → ring → helix → cone → sphere`，每 700ms 切换一次以覆盖中断。

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

## 自动化覆盖

`npm run verify` 覆盖类型、95+ 单测、库/demo 构建、tgz 消费者、稳定子路径、Tree Shaking 和体积预算。自动化可证明数值、竞态和资源契约，但不能替代目标设备上的视觉判断；人工结果应随发布记录保存。

2026-07-15 已完成本地 Chromium / 2000 items / auto-high 的 60 秒压力基线：67 次中断/局部更新，平均 59.96 FPS、最低 59.15 FPS、最大 1 Draw Call、WebGL READY、无页面 error 日志。详细数值记录在 `docs/RELEASE.md`。
