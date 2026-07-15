# Spatial Motion

面向活动大屏、数据展示和互动场景的高性能 3D 卡片动效引擎。核心库不依赖 Vue、React 或具体业务。

## 当前能力

- `InstancedBufferGeometry` 批量渲染卡片，主体场景保持单 Draw Call
- Canvas Texture Atlas，避免每个卡片独立纹理和材质
- 球体、立方体/长方体、圆柱体、平面网格、同心圆环、螺旋和圆锥布局
- 同一批实例在布局之间连续过渡，不重建 Three.js 对象
- GPU Shader 并行插值位置、缩放、透明度和四元数朝向
- 动画过程中 CPU 每帧仅更新一个进度 uniform
- 自动旋转和串行 Timeline
- 新布局可中断当前过渡，并自动终止已失效的 Timeline
- GPU 时空隧道、线性发射、漩涡和径向爆发固定实例对象池
- 统一 `enterEffect()` 入口，特效可直接插入 Timeline 并从当前帧回归任意布局
- 特效活跃数量独立于数据池大小，并随质量档位限制，超额实例进入休眠
- high、medium、low 设备质量分级
- 运行时帧率监控、自动降级与稳定恢复
- 自动限制像素比和可见实例数量
- 自动质量与 high、medium、low 手动质量锁定
- 页面进入后台时暂停渲染循环，回到前台后平滑恢复
- 独立性能基准页和 JSON 采样结果导出
- 按稳定 `id` 动态增删数据，并从已有卡片的当前空间位置继续过渡
- 基于投影四边形和相机深度的精确遮挡拾取、卡片点击回调和任意 `id` 聚焦
- 聚焦后恢复最近一次业务布局
- ResizeObserver 响应式画布及完整资源释放

源码仓库为 [itagan/spatial-motion](https://github.com/itagan/spatial-motion)。包名已确定为 `@itagan/spatial-motion`，目前可从 GitHub 安装，尚未发布到 npm Registry。

## 项目文档

- [开发指南](./docs/DEVELOPMENT.md)：环境、命令、架构职责、测试与发布检查。
- [路线图](./ROADMAP.md)：已完成阶段、当前目标和后续候选方向。
- [开发代理指南](./AGENTS.md)：Codex、Claude Code 等自动化开发代理的项目边界与完成标准。

## 安装

从 GitHub 安装当前主分支：

```bash
npm install github:itagan/spatial-motion three
```

发布到 npm 后使用：

```bash
npm install @itagan/spatial-motion three
```

Three.js `>=0.178.0 <1.0.0` 是 peer dependency，不会被 Spatial Motion 重复打包。

## 启动

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run typecheck
npm test
npm run build:lib
npm run build:demo
npm run pack:check
```

`build:lib` 输出可发布 ESM 和类型声明到 `dist/`；`build:demo` 独立输出演示站点到 `dist-demo/`。

## 基础使用

```ts
import { MotionStage, cylinder, sphere } from '@itagan/spatial-motion'

const stage = new MotionStage({
  container: document.querySelector('#stage')!,
  quality: 'auto',
  adaptivePerformance: true,
  onQualityChange(quality, stats) {
    console.log(quality, stats.fps)
  },
})

await stage.setItems(participants)
stage.autoRotate({ y: 0.25 })
await stage.to(sphere({ radius: 5 }), { duration: 1600 })
await stage.to(cylinder({ radius: 5 }), { duration: 1400 })
```

按需子路径入口：

```ts
import { sphere, cylinder } from '@itagan/spatial-motion/layouts'
import { tunnel, vortex } from '@itagan/spatial-motion/effects'
import { BenchmarkSession } from '@itagan/spatial-motion/performance'
```

仅主入口、`layouts`、`effects`、`performance` 和 `package.json` 是稳定导出路径。`renderers` 等内部目录受 `exports` 限制，不属于公共 API。

运行时状态：

```ts
stage.getQuality()          // 'high' | 'medium' | 'low'
stage.getQualityMode()      // 'auto' | 'high' | 'medium' | 'low'
stage.getPerformanceStats() // fps、帧时间、实例、Draw Call、三角形、纹理内存等
```

质量与暂停控制：

```ts
stage.setQuality('low')  // 锁定低质量
stage.setQuality('auto') // 恢复自动检测和运行时升降级

stage.pause()
stage.resume()
```

响应式平面、低动态偏好与悬停高亮：

```ts
const stage = new MotionStage({
  container,
  motionPreference: 'auto', // 跟随 prefers-reduced-motion
  hoverEffect: 'highlight',
  onItemHover(item, index) {
    console.log(item?.id ?? null, index)
  },
})

await stage.to(grid({ fit: 'contain' })) // 完整放入相机可视范围
await stage.to(grid({ fit: 'cover' }))   // 铺满相机可视范围
```

低动态模式会立即完成布局切换、停止自动旋转，并把流式特效固定为确定性的静态首帧。`full` 可强制保留动画，`reduced` 可强制使用低动态行为。

页面隐藏时 Stage 会自动停止 `requestAnimationFrame`，恢复可见时重置帧时间再继续，后台停留时间不会污染性能样本。

动态更新数据：

```ts
await stage.updateItems(nextParticipants, {
  duration: 800,
  // 可选：更新后直接进入指定布局；默认恢复最近一次布局
  layout: sphere({ radius: 5 }),
})
```

相同 `id` 的卡片会继承更新发生时的位置，新卡片从初始状态进入；纹理图集只在数据更新时批量重建，不进入逐帧渲染路径。
快速连续更新时仅最后一次调用生效，已失效的图集结果会被释放。`id` 必须是非空字符串且在完整输入中唯一，否则调用会在修改舞台状态前抛出错误。

拾取与聚焦：

```ts
const stage = new MotionStage({
  container,
  onItemClick(item, index) {
    void stage.focusItems([item.id])
  },
})

const hit = stage.pick(pointerEvent.clientX, pointerEvent.clientY)
const paddedHit = stage.pick(pointerEvent.clientX, pointerEvent.clientY, {
  padding: 6,
})

// 调试重叠卡片时，可按屏幕中心距离选择被遮挡卡片
const includingOccluded = stage.pick(pointerEvent.clientX, pointerEvent.clientY, {
  includeOccluded: true,
})

await stage.focusItems(['guest-1', 'guest-8'], {
  columns: 2,
  scale: 1.45,
  dimOpacity: 0.08,
})
await stage.restoreLayout({ duration: 1000 })
```

默认拾取按照卡片当前帧的投影四边形判断，多张卡片重叠时返回距离相机最近的一张；透明、休眠、质量降级隐藏、球体背面及背向相机的实例不会命中。计算仅发生在调用 `pick()` 或指针事件时，不进行 GPU readback，也不进入逐帧渲染路径。第三个参数传数字仍保留为旧版中心半径拾取兼容模式。

资源释放：

```ts
stage.destroy()
stage.destroy() // 幂等
```

除重复 `destroy()` 外，舞台销毁后的公开 API 调用都会抛出 `MotionStage has been destroyed`，用于尽早发现组件生命周期误用。

质量变化会同时调整：

| 质量 | 最大像素比 | 最大实例数 | 特效活跃上限 | 分布式可见比例 | 目标帧率 |
| --- | ---: | ---: | ---: | ---: | ---: |
| high | 1.5 | 2000 | 300 | 100% | 60 |
| medium | 1.25 | 1000 | 220 | 82% | 45 |
| low | 1 | 500 | 140 | 58% | 30 |

输入数据超过当前质量档位的最大实例数时，尾部数据不会进入纹理图集或 GPU 实例缓冲。

## 性能基准

启动开发服务器后打开：

```text
http://localhost:5173/benchmark.html
```

基准页支持：

- 100、300、600、1000、1500 个实例
- auto、high、medium、low 质量模式
- 球体、立方体/长方体、圆柱体、平面、同心圆环、螺旋和圆锥布局
- 时空隧道、漩涡和径向爆发特效及实际活跃实例统计
- FPS、平均帧时间、渲染/可见实例、Draw Call、三角形和纹理图集内存
- 3、10、20 秒采样与完整 JSON 结果导出

重复提交视觉数据完全一致的列表时，渲染器会复用当前纹理图集，避免无意义的 Canvas 重绘和 GPU 纹理替换。

## 包构建与体积基准

Library build 使用 ESM 保留模块结构并生成 `.d.ts`/声明映射，Three.js 保持为外部依赖。当前自动化预算和实测基线：

| 项目 | 预算 | 当前基线 |
| --- | ---: | ---: |
| Library JavaScript gzip 合计 | ≤ 40 KB | 21.6 KB |
| npm tarball | ≤ 150 KB | 72.0 KB |
| 仅引入 `sphere()` 的消费者产物 | ≤ 8 KB | 2.1 KB |

`npm run pack:check` 会真实生成 `.tgz`，在临时消费者项目中完成安装、Node ESM 加载、严格 TypeScript 检查、未声明深层路径拦截和 Vite Tree Shaking 验证。发布内容仅包含 `dist`、README、LICENSE 和包元数据。

连续低帧率约 2.5 秒后下降一级，质量切换后有 5 秒冷却；性能稳定约 8 秒后才允许恢复。页面切到后台、调试暂停及超过 100ms 的异常长帧不会参与判断。
手动锁定 high、medium 或 low 时仍持续记录 FPS 和帧时间，但采样结果不会触发自动升降级。

时空隧道：

```ts
import { tunnel } from '@itagan/spatial-motion'

const tunnelEffect = tunnel({
  directionCount: 20,
  speed: 0.18,
  outerRadius: 4.2,
  maxActiveItems: 260,
})

await stage.enterEffect(tunnelEffect, { duration: 1400 })

// 隧道持续运行，稍后从当时的位置聚合为圆柱
await stage.to(cylinder(), { duration: 1300 })
```

隧道和线性发射器支持连续、爆发与波浪三种 GPU 发射节奏；隧道还可切换圆形或方形截面：

```ts
await stage.enterEffect(tunnel({
  crossSection: 'square',
  emission: { mode: 'burst', burstInterval: 2, burstDuration: 0.45 },
}))

await stage.enterEffect(linearShooter({
  emission: { mode: 'wave', waveFrequency: 0.35, waveStrength: 0.75 },
}))
```

线性发射器：

```ts
import { linearShooter } from '@itagan/spatial-motion'

const shooter = linearShooter({
  directionCount: 18,
  speed: 0.26,
  outerRadius: 10,
  maxActiveItems: 180,
})

await stage.enterEffect(shooter, {
  duration: 1200,
})

// 捕获发射中的当前帧并重新聚合
await stage.to(sphere(), {
  duration: 1400,
})
```

漩涡与径向爆发：

```ts
import { radialBurst, vortex } from '@itagan/spatial-motion'

await stage.enterEffect(vortex({
  direction: 'in',
  turns: 2.6,
  maxActiveItems: 240,
}), { duration: 1300 })

await stage.to(ring(), { duration: 1200 })

await stage.enterEffect(radialBurst({
  direction: 'out', // 使用 in 可反向聚合
  depthScale: 0.3,
  maxActiveItems: 190,
}), { duration: 1100 })
```

`enterTunnel()` 和 `enterLinearShooter()` 继续作为兼容别名保留。所有内置流式特效使用统一的四分量路径缓冲和三组参数 uniform，切换效果不会创建新的 Mesh 或增加 Draw Call。

球体头像朝向：

```ts
sphere({ orientation: 'upright-surface' }) // 默认，像圆柱一样竖直包裹球面
sphere({ orientation: 'camera' })          // 始终正对相机
sphere({ orientation: 'surface' })         // 严格贴合球面切线
```

通用布局：

```ts
import { box, cone, helix, ring } from '@itagan/spatial-motion'

await stage.to(box({
  width: 8,
  height: 6,
  depth: 5,
  orientation: 'surface',
}))

await stage.to(ring({
  innerRadius: 0.8,
  spacing: 0.42,
  orientation: 'camera', // 或 tangent，沿圆环切向旋转
}))

await stage.to(helix({
  radius: 4.6,
  height: 9,
  turns: 8,
  orientation: 'surface',
}))

await stage.to(cone({
  radius: 5,
  height: 9,
  stagger: true,
  orientation: 'upright-surface', // surface 可严格贴合锥面
}))
```

这些布局会根据实例数量自动计算面分布、环数、圈数和卡片缩放，也可通过尺寸、`rings`、`turns`、`density` 等参数锁定视觉密度。它们遵循统一 `Layout` 契约，可直接插入 Timeline，并在任意中间帧切换到其他布局或流式特效。

确定性的散开布局可用于爆炸、解散和重新聚合配方：

```ts
import { box, scatter } from '@itagan/spatial-motion'

await stage.to(box())
await stage.to(scatter({
  direction: 'radial',
  distance: 12,
  depth: 8,
  opacity: 0,
  seed: 42,
}), { duration: 900 })
await stage.to(box(), { duration: 1300 })
```

`scatter()` 同样是普通 `Layout`，相同数量、配置和 `seed` 始终生成相同目标，因此可以安全插入 Timeline、被新布局中断或作为聚合动画的起点。

连续编排：

```ts
await stage
  .timeline()
  .add(() => stage.to(sphere()))
  .wait(1000)
  .add(() => stage.to(cylinder()))
  .play()
```

## 源码边界

```text
src/
├── core/          Stage、Timeline、公共类型和插值
├── layouts/       无渲染依赖的布局算法
├── effects/       隧道等固定对象池流式效果
├── renderers/     WebGL 实例渲染与纹理图集
└── performance/   设备质量检测与性能配置
demo/              性能和连续动画演示
```

## 后续路线

CSS3D 可选渲染器、Vue/React 薄适配器及发布准备工作的状态统一维护在[路线图](./ROADMAP.md)中。

## License

[MIT](./LICENSE)

## 性能原则

- 业务数据量与当前可视数量分离
- 运动过程中不反复创建对象、纹理、矩阵或 Tween
- 切换开始时上传起点和终点缓冲，逐帧插值交给 GPU
- 低配设备降低实例上限和像素比
- 普通头像使用低分辨率图集，聚焦对象按需加载高清资源
- 所有循环、监听器、纹理和 WebGL 资源必须支持销毁
