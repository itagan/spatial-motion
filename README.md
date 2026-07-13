# Spatial Motion

面向活动大屏、数据展示和互动场景的高性能 3D 卡片动效引擎。核心库不依赖 Vue、React 或具体业务。

## 当前能力

- `InstancedBufferGeometry` 批量渲染卡片，主体场景保持单 Draw Call
- Canvas Texture Atlas，避免每个卡片独立纹理和材质
- 球体、圆柱体、平面网格、同心圆环、螺旋和圆锥布局
- 同一批实例在布局之间连续过渡，不重建 Three.js 对象
- GPU Shader 并行插值位置、缩放、透明度和四元数朝向
- 动画过程中 CPU 每帧仅更新一个进度 uniform
- 自动旋转和串行 Timeline
- 新布局可中断当前过渡，并自动终止已失效的 Timeline
- GPU 时空隧道与固定实例对象池
- GPU 多方向线性发射器
- 隧道活跃数量独立于数据池大小，超额实例进入休眠
- 从静态布局进入隧道，或从隧道当前帧聚合回任意布局
- high、medium、low 设备质量分级
- 运行时帧率监控、自动降级与稳定恢复
- 自动限制像素比和可见实例数量
- 自动质量与 high、medium、low 手动质量锁定
- 页面进入后台时暂停渲染循环，回到前台后平滑恢复
- 独立性能基准页和 JSON 采样结果导出
- 按稳定 `id` 动态增删数据，并从已有卡片的当前空间位置继续过渡
- 屏幕坐标拾取、卡片点击回调和任意 `id` 聚焦
- 聚焦后恢复最近一次业务布局
- ResizeObserver 响应式画布及完整资源释放

目前是本地预研版本，源码仓库为 [itagan/spatial-motion](https://github.com/itagan/spatial-motion)，尚未发布 npm 包。

## 启动

```bash
npm install
npm run dev
```

质量检查：

```bash
npm run typecheck
npm test
npm run build
```

## 基础使用

```ts
import { MotionStage, cylinder, sphere } from 'spatial-motion'

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

await stage.focusItems(['guest-1', 'guest-8'], {
  columns: 2,
  scale: 1.45,
  dimOpacity: 0.08,
})
await stage.restoreLayout({ duration: 1000 })
```

资源释放：

```ts
stage.destroy()
stage.destroy() // 幂等
```

除重复 `destroy()` 外，舞台销毁后的公开 API 调用都会抛出 `MotionStage has been destroyed`，用于尽早发现组件生命周期误用。

质量变化会同时调整：

| 质量 | 最大像素比 | 最大实例数 | 分布式可见比例 | 目标帧率 |
| --- | ---: | ---: | ---: | ---: |
| high | 1.5 | 2000 | 100% | 60 |
| medium | 1.25 | 1000 | 82% | 45 |
| low | 1 | 500 | 58% | 30 |

输入数据超过当前质量档位的最大实例数时，尾部数据不会进入纹理图集或 GPU 实例缓冲。

## 性能基准

启动开发服务器后打开：

```text
http://localhost:5173/benchmark.html
```

基准页支持：

- 100、300、600、1000、1500 个实例
- auto、high、medium、low 质量模式
- 球体、圆柱体、平面、同心圆环、螺旋和圆锥布局
- FPS、平均帧时间、渲染/可见实例、Draw Call、三角形和纹理图集内存
- 3、10、20 秒采样与完整 JSON 结果导出

重复提交视觉数据完全一致的列表时，渲染器会复用当前纹理图集，避免无意义的 Canvas 重绘和 GPU 纹理替换。

连续低帧率约 2.5 秒后下降一级，质量切换后有 5 秒冷却；性能稳定约 8 秒后才允许恢复。页面切到后台、调试暂停及超过 100ms 的异常长帧不会参与判断。

时空隧道：

```ts
import { tunnel } from 'spatial-motion'

const tunnelEffect = tunnel({
  directionCount: 20,
  speed: 0.18,
  outerRadius: 4.2,
  maxActiveItems: 260,
})

await stage.enterTunnel(tunnelEffect, { duration: 1400 })

// 隧道持续运行，稍后从当时的位置聚合为圆柱
await stage.to(cylinder(), { duration: 1300 })
```

线性发射器：

```ts
import { linearShooter } from 'spatial-motion'

const shooter = linearShooter({
  directionCount: 18,
  speed: 0.26,
  outerRadius: 10,
  maxActiveItems: 180,
})

await stage.enterLinearShooter(shooter, {
  duration: 1200,
})

// 捕获发射中的当前帧并重新聚合
await stage.to(sphere(), {
  duration: 1400,
})
```

球体头像朝向：

```ts
sphere({ orientation: 'upright-surface' }) // 默认，像圆柱一样竖直包裹球面
sphere({ orientation: 'camera' })          // 始终正对相机
sphere({ orientation: 'surface' })         // 严格贴合球面切线
```

通用布局：

```ts
import { cone, helix, ring } from 'spatial-motion'

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

三种布局会根据实例数量自动计算环数、圈数和卡片缩放，也可通过 `rings`、`turns`、`density` 等参数锁定视觉密度。它们遵循统一 `Layout` 契约，可直接插入 Timeline，并在任意中间帧切换到其他布局或流式特效。

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

1. 更多固定对象池流式效果和精确遮挡拾取
2. 独立 library build、导出边界和包体积基准
3. CSS3D 可选渲染器以及 Vue/React 薄适配器

## 性能原则

- 业务数据量与当前可视数量分离
- 运动过程中不反复创建对象、纹理、矩阵或 Tween
- 切换开始时上传起点和终点缓冲，逐帧插值交给 GPU
- 低配设备降低实例上限和像素比
- 普通头像使用低分辨率图集，聚焦对象按需加载高清资源
- 所有循环、监听器、纹理和 WebGL 资源必须支持销毁
