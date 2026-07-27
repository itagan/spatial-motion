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
- 布局过渡、流式特效和扩展共享单一 Stage RAF，并使用排除暂停时间的统一时钟
- 可取消过渡句柄、完成原因、实时进度和 `AbortSignal`，旧 `Promise<boolean>` API 保持兼容
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
- Canvas 键盘焦点、方向键导航、Enter/Space 激活和稳定 id 程序化聚焦
- 聚焦后恢复最近一次业务布局
- ResizeObserver 响应式画布及完整资源释放
- 圆角、圆形、边框与背景卡片样式，以及安全的 Canvas 自定义绘制
- 按需 ES6 tagged template 卡片内容，使用受控 HTML/CSS 子集并继续写入同一纹理图集
- 稳定按需批量渲染器协议及单 Draw Call `pointsRenderer()`
- 按需 Renderer/Layout 开发诊断与批量布局方向可视化
- 按稳定 `id` 局部重绘单张或多张图集卡片
- 统一的平滑特效运动曲线、mipmap 图集采样和 GPU 纹理尺寸保护
- WebGL context loss 暂停/恢复、图片超时回退和长时间压力基准
- 每 Stage 有界图片缓存、重复 URL 去重、并发请求上限和失效图集请求取消
- P50/P95/P99、长帧、Stage/图集分阶段成本和可导入对比的性能基准
- 八种布局的版本化 JSON 配置、严格解析与可折叠参数实验室
- Sphere 等面积/球带、Cylinder 圆弧、Ring 分配、Box 选面和 Cone 圆台等高级布局参数
- 受控 Stage extension 生命周期，可安全挂载原生 Three.js 内容并接入 GSAP 等外部动画库
- 数据感知的自定义 Layout 上下文，可按 item meta 和质量档位生成布局
- 可覆盖的质量 Profile 与自适应采样策略
- 类型化多订阅 Stage 事件，支持框架适配器、调试面板和业务同时监听
- Renderer 特效能力协商，自定义 Renderer 可定义自己的 GPU 特效 key

源码仓库为 [itagan/spatial-motion](https://github.com/itagan/spatial-motion)。包名为 `@itagan/spatial-motion`；源码已推进到 v1.15.0 交互与动画控制完善阶段，目前可从 GitHub 安装，暂不执行 npm 发布。

## 项目文档

- [开发指南](./docs/DEVELOPMENT.md)：环境、命令、架构职责、测试与发布检查。
- [架构说明](./docs/ARCHITECTURE.md)：调度内核、能力协议、扩展边界和性能约束。
- [路线图](./ROADMAP.md)：已完成阶段、当前目标和后续候选方向。
- [公共 API 与兼容策略](./docs/PUBLIC_API.md)：稳定入口、SemVer 承诺和迁移边界。
- [浏览器支持与限制](./docs/COMPATIBILITY.md)：运行环境、图片 CORS 和已知限制。
- [视觉验收矩阵](./docs/VISUAL_QA.md)：布局、特效、图集和长时间压力测试标准。
- [性能与效果优化记录](./docs/OPTIMIZATION.md)：可复现基线、测量口径和下一项优化假设。
- [发布清单](./docs/RELEASE.md)：版本验证、发布及发布后空项目安装步骤。
- [变更记录](./CHANGELOG.md)：各阶段功能与兼容说明。
- [独立示例](./examples/)：Vanilla、原生 Three.js extension、GSAP extension 和 Vue 抽奖大屏。
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
npm run build:examples
npm run pack:check
```

`build:lib` 输出可发布 ESM 和类型声明到 `dist/`；`build:demo` 输出综合演示站点到 `dist-demo/`；`build:examples` 输出五个集成示例到 `dist-examples/`。

## 独立集成示例

`examples/` 保持为单包仓库内的轻量项目，不引入 workspace，也不改变 npm 发布边界：

- [`vanilla`](./examples/vanilla/)：最小 Stage、数据、布局和暂停/恢复。
- [`three-extension`](./examples/three-extension/)：原生 Three.js Object3D 挂载、逐帧更新与资源释放。
- [`gsap-extension`](./examples/gsap-extension/)：使用 Stage elapsed 推进 paused GSAP timeline。
- [`custom-card-effect`](./examples/custom-card-effect/)：注册业务 Cards GPU Program，并保持单 Mesh / 单 Draw Call。
- [`lottery-screen`](./examples/lottery-screen/)：Vue 3 抽奖大屏，把奖项、轮次、名单、中奖历史、本地恢复和 CSV 导出保留在应用层，使用 Stage 编排滚动与揭晓。

```bash
npm run dev:examples
```

开发服务器分别提供 `/vanilla/`、`/three-extension/`、`/gsap-extension/`、`/custom-card-effect/` 和 `/lottery-screen/`。示例从正式包名导入并参与严格类型检查和 CI 构建，但不会进入 npm tarball；发布包消费边界仍由 `pack:check` 验证。

## 基础使用

```ts
import { MotionStage, cardsRenderer, cylinder, easing, sphere } from '@itagan/spatial-motion'

const stage = new MotionStage({
  container: document.querySelector('#stage')!,
  renderer: cardsRenderer({
    resolution: 'auto',
    imageTimeout: 10_000,
    imageConcurrency: 6,
    imageCacheSize: 128,
    texturePrewarm: undefined, // 自动：仅预热较小 Atlas；也可显式 true/false
    atlasMode: 'single', // 'single' | 'array' | 'auto'；默认保持单图集
  }),
  quality: 'auto',
  qualityProfiles: {
    high: {
      maxPixelRatio: 2,
      maxVisibleItems: 5000,
      maxActiveEffectItems: 800,
      antialias: true,
      targetFps: 60,
    },
  },
  adaptivePerformance: true,
  transition: { duration: 1200, easing: easing.sineInOut },
})
const unsubscribe = stage.on('qualitychange', ({ quality, stats }) => {
  console.log(quality, stats.frameTimeP95)
})
stage.on('contextchange', ({ state }) => {
  console.log('WebGL context:', state)
})
await stage.ready // 仅在构造参数提供 items 时需要等待初始 Renderer 数据准备

await stage.setItems(participants)
stage.autoRotate({ y: 0.25 })
await stage.to(sphere({ radius: 5 }), { duration: 1600 })
await stage.to(cylinder({ radius: 5 }), { duration: 1400 })
```

需要查询、取消或区分完成原因时使用句柄 API；原有 `to()` 仍返回 `Promise<boolean>`：

```ts
const transition = stage.startTransition(sphere({ radius: 5 }), { duration: 1600 })
console.log(stage.getTransitionState()) // layout、progress、status
transition.cancel()
const result = await transition.finished // { completed: false, status: 'aborted' }

const controller = new AbortController()
await stage.to(grid(), { signal: controller.signal })
```

按需子路径入口：

```ts
import { sphere, cylinder } from '@itagan/spatial-motion/layouts'
import { sphere as sphereOnly } from '@itagan/spatial-motion/layouts/sphere'
import { MotionStage } from '@itagan/spatial-motion/core'
import { cardsRenderer } from '@itagan/spatial-motion/renderers/cards'
import { tunnel, vortex } from '@itagan/spatial-motion/effects'
import { BenchmarkSession, compareBenchmarkResults } from '@itagan/spatial-motion/performance'
import { validateLayout, validateMotionRenderer } from '@itagan/spatial-motion/dev'
```

`core`、Cards/Points Renderer、布局集合与逐布局、`effects`、`performance`、`card-template`、`dev` 和 `package.json` 都是稳定导出路径。根入口是便利聚合入口；需要严格控制产物时使用子路径。`dev` 仅供开发期主动导入，不被根入口或生产模块引用。

可序列化布局配置：

```ts
import {
  createLayout,
  parseLayoutConfig,
  type LayoutConfig,
} from '@itagan/spatial-motion'

const config = parseLayoutConfig({
  version: 1,
  type: 'sphere',
  options: {
    radius: 5.2,
    rings: 18,
    stagger: true,
    density: 0.82,
    orientation: 'surface',
  },
}) satisfies LayoutConfig

await stage.to(createLayout(config), { duration: 800 })
localStorage.setItem('layout', JSON.stringify(config))
```

`parseLayoutConfig()` 也接受 JSON 字符串。它严格拒绝未知版本、布局、字段、枚举和非法数值，并在错误消息中给出 `options.rings` 一类字段路径。省略 `rings`、`columns`、`turns` 等字段会继续使用布局按实例数自动计算的行为，不会在解析时固化默认值。

主 Demo 的“布局参数”面板覆盖 Sphere、Box、Cylinder、Grid、Ring、Helix、Cone 和 Scatter，可实时调整参数、切换预设、复制 JSON/TypeScript 并通过 URL 恢复当前配置。

运行时状态：

```ts
stage.getQuality()          // 'high' | 'medium' | 'low'
stage.getQualityMode()      // 'auto' | 'high' | 'medium' | 'low'
stage.getPerformanceStats() // FPS、P50/P95/P99、长帧、CPU/提交、实例池/实际提交量、图集和 Draw Call 等
stage.getPerformanceEnvironment() // 浏览器、GPU、视口、DPR、MAX_TEXTURE_SIZE
```

质量与暂停控制：

```ts
stage.setQuality('low')  // 锁定低质量
stage.setQuality('auto') // 恢复自动检测和运行时升降级

stage.pause()
stage.resume()
```

外部 3D 内容与动画扩展：

```ts
import { MotionStage, type StageExtension } from '@itagan/spatial-motion'
import { Mesh, MeshBasicMaterial, TorusGeometry } from 'three'

const extension: StageExtension = {
  name: 'orbit-ring',
  order: 10,
  mount({ root, camera, signal }) {
    const geometry = new TorusGeometry(6, 0.03, 8, 96)
    const material = new MeshBasicMaterial({ color: 0x67e8f9 })
    root.add(new Mesh(geometry, material))
    signal.addEventListener('abort', () => console.log('extension removed'))
    void camera.position // 只读使用 Stage 相机
  },
  update({ elapsed }) {
    // elapsed 不包含 Stage 暂停或页面隐藏的时间
  },
  resize({ width, height, pixelRatio }) {},
  qualityChange(quality) {},
  reducedMotionChange(reducedMotion) {},
  pause() {},
  resume() {},
  dispose() {}, // 扩展负责释放自己创建的 geometry/material/texture
}

const handle = await stage.addExtension(extension)
handle.disable() // 暂停 update 并隐藏 root，不 dispose
handle.enable()  // 从已有 elapsed 继续
handle.remove() // 幂等；同时 abort signal、移除隔离 Group 并 dispose
```

每个扩展只获得独立 `Group`、只读相机引用和取消信号。Stage 继续独占场景渲染循环；扩展不能访问内部卡片 Mesh 或 WebGLRenderer。`extensionerror` 事件会收到生命周期错误，故障扩展会被隔离移除，其他扩展与卡片渲染继续运行。GSAP 等库应仅驱动扩展自己的对象，并通过 `update({ elapsed })` 对齐 Stage 时钟；核心包不依赖任何动画库。

`stage.getExtensionStats()` 按 `order` 和挂载顺序返回活动扩展，并附带最近 20 个已释放扩展的纯数据快照。重复名称通过稳定 `id` 区分；诊断包括 enabled、update 次数、平均/P95/P99/最大耗时、超过 2ms 的慢帧、错误次数和最近错误文本。

响应式平面、低动态偏好与悬停高亮：

```ts
const stage = new MotionStage({
  container,
  renderer: cardsRenderer(),
  motionPreference: 'auto', // 跟随 prefers-reduced-motion
  hover: true,
  hoverEffect: 'highlight',
})
stage.on('itemhover', ({ item, index }) => {
  console.log(item?.id ?? null, index)
})

await stage.to(grid({ fit: 'contain' })) // 完整放入相机可视范围
await stage.to(grid({ fit: 'cover' }))   // 铺满相机可视范围
```

低动态模式会立即完成布局切换、停止自动旋转，并把流式特效固定为确定性的静态首帧。`full` 可强制保留动画，`reduced` 可强制使用低动态行为。

默认 Canvas 可通过 Tab 聚焦，方向键在当前质量档位可见卡片之间循环，Home/End 跳到首尾，Enter/Space 触发 `itemclick`。`itemfocus` 接收键盘焦点变化，`focusItem(id)` 和 `getFocusedItem()` 提供稳定 id 控制；可用 `ariaLabel` 自定义区域名称，或以 `keyboardNavigation: false` 关闭内建键盘行为。

页面隐藏时 Stage 会自动停止唯一的 `requestAnimationFrame`，布局过渡、流式特效和扩展时钟同时冻结；恢复可见时从当前画面继续，后台停留时间不会造成动画跳跃或污染性能样本。手动 `pause()` 和 WebGL context loss 使用相同的时钟语义。

浏览器报告 WebGL context loss 时 Stage 会阻止默认销毁行为并暂停循环；context restored 后图集会重新标记上传并恢复运行。`getPerformanceStats().contextLost` 可用于状态面板。若此前由用户主动暂停，context 恢复不会越过该暂停状态。

动态更新数据：

```ts
await stage.updateItems(nextParticipants, {
  duration: 800,
  // 可选：更新后直接进入指定布局；默认恢复最近一次布局
  layout: sphere({ radius: 5 }),
})
```

相同 `id` 的卡片会继承更新发生时的位置，新卡片从初始状态进入；尺寸或实例数量变化时纹理图集会批量重建，但不进入逐帧渲染路径。
快速连续更新时仅最后一次调用生效，已失效的图集结果会被释放。`id` 必须是非空字符串且在完整输入中唯一，否则调用会在修改舞台状态前抛出错误。

同一次图集操作中的重复图片 URL 只发起一次请求；完成的图片按 Stage 保存在有界 LRU 缓存中，默认最多 128 项。`imageConcurrency` 默认 6，可针对低带宽设备降低；`imageCacheSize: 0` 可关闭跨更新缓存。新图集操作和 `destroy()` 会通过 `AbortSignal` 中止旧图片请求，缓存不会跨 Stage 持有。

只更新已有卡片内容时使用稳定 `id` API。它仅重绘受影响的图集单元，不重建 Mesh，也不会打断当前布局或流式特效：

```ts
await stage.updateItem('guest-8', {
  title: 'Winner',
  image: '/winner.webp',
})

await stage.updateItemsById([
  { id: 'guest-3', patch: { title: 'Finalist' } },
  { id: 'guest-9', patch: { meta: { rank: 2 } } },
])
```

卡片外观与自定义 Canvas 绘制：

```ts
const stage = new MotionStage({
  container,
  renderer: cardsRenderer({
    aspectRatio: 3 / 4, // Stage 内所有卡片共用，最长边仍为 1
    style: {
    shape: 'rounded', // square | rounded | circle
    cornerRadius: 10,
    borderWidth: 2,
    borderColor: '#f5d77a',
    backgroundColor: '#111827',
    imageFit: 'cover', // cover | contain | fill
    imagePosition: { x: 0.5, y: 0.25 },
    contentPadding: 0.04,
    overlayColor: 'rgba(0, 0, 0, .18)',
    titleStyle: {
      position: 'bottom',
      align: 'center',
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, .62)',
      fontSizeRatio: 0.12,
      maxLines: 2,
    },
    },
    resolveStyle(item) {
    return (item.meta as { winner?: boolean }).winner
      ? { borderColor: '#ffd700', borderWidth: 4 }
      : undefined
  },
    async draw(context, item, bounds, resolvedStyle) {
    context.fillStyle = '#16213e'
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
    context.fillStyle = '#fff'
    context.fillText(
      item.title ?? item.id,
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    )
    console.log(resolvedStyle.borderColor)
    },
  }),
})
```

不提供 `draw` 时，内置绘制器负责图片裁切、焦点定位、覆盖层和最多三行的标题排版。`resolveStyle()` 在 Renderer 基础样式之上按卡片合并，嵌套 `imagePosition` 和 `titleStyle` 也按字段覆盖。

绘制回调会在隔离的 Canvas 状态和卡片裁剪区域内执行；它替换内置内容，但仍沿用已解析的形状裁剪、背景和边框。抛错时回退为内置卡片。异步绘制同样受更新 token 保护，旧请求完成后不会覆盖新内容。核心库不会执行 HTML 模板或挂载框架组件。

不希望直接编写 Canvas 时，可按需导入安全的 ES6 模板子入口：

```ts
import { MotionStage, cardsRenderer } from '@itagan/spatial-motion'
import { defineCardTemplate, html } from '@itagan/spatial-motion/card-template'

const cardContent = defineCardTemplate<{ price: number }>(
  (item, { formatNumber, when }) => html`
    <div class="product">
      ${when(item.image, () => html`
        <img src=${item.image} style="height:65%;object-fit:cover" />
      `)}
      <span class="title">${item.title}</span>
      <span>¥${formatNumber(item.meta?.price ?? 0)}</span>
    </div>
  `,
  {
    styles: {
      product: {
        display: 'flex',
        flexDirection: 'column',
        padding: 8,
        gap: 4,
        background: 'linear-gradient(135deg, #3b1029, #be123c)',
      },
      title: { fontSize: 14, fontWeight: 700, lineClamp: 1 },
    },
  },
)

const stage = new MotionStage({
  container,
  renderer: cardsRenderer({ content: cardContent }),
})
```

模板支持 `div`、`span`、`img`、`br`、嵌套条件/数组、scoped class、inline style 与常用 flex/定位/图文样式。它不会创建 DOM、执行脚本或解析任意 HTML；未知标签或样式会回退内置卡片。模板图片继续使用 Cards Renderer 的去重、并发、超时、LRU 与取消机制。`content` 和 `draw` 互斥。

卡片内容能力按使用成本分为四层：`style` / `resolveStyle()` 负责常见图文调整，`defineCardTemplate()` 是推荐的组合内容方式，`draw()` 保留完整 Canvas 逃生口，直接实现 `CardContentRenderer` 面向高级资源准备场景。Vanilla 中的产品、人物和指标卡是可复制源码配方，不是官方预设。

## 批量渲染器

需要用同一套布局、过渡、质量、旋转和交互编排非卡片批量对象时，可显式导入 Points 入口：

```ts
import { MotionStage } from '@itagan/spatial-motion/core'
import { pointsRenderer } from '@itagan/spatial-motion/renderers/points'

const stage = new MotionStage({
  container,
  renderer: pointsRenderer({
    size: 0.8,
    resolveColor: (item) => item.meta?.color ?? '#67e8f9',
  }),
})

await stage.setItems(items)
```

`pointsRenderer()` 只创建一个 `THREE.Points`、Geometry 和 Material，支持布局插值、质量裁剪、hover/focus、圆形拾取与资源恢复，不创建 Atlas。自定义 Factory 只能获得隔离 `Group`、GPU 限制和销毁信号，不能接管 Scene、Camera、WebGLRenderer 或 RAF。不支持流式特效的渲染器会稳定停在特效时间 0 的静态首帧。

自定义 `MotionRenderer` 只需实现数据、Transform、过渡进度、质量可见比例、统计与销毁；局部 patch、视觉状态、高亮、viewport、资源恢复和流式特效通过 `capabilities` 按需声明。`descriptor.itemBounds` 可使用 quad、disc 或 `null`。`getPerformanceStats()` 将场景提交数据放在 `render`，将实例、GPU 字节与 Renderer 专属指标放在 `renderer`。

开发自定义 Renderer 或 Layout 时可使用独立诊断入口：

```ts
import {
  createLayoutDebugVisualization,
  validateLayout,
  validateMotionRenderer,
} from '@itagan/spatial-motion/dev'

const rendererReport = await validateMotionRenderer(pointsRenderer(), {
  items,
  cycles: 3,
})
const layoutReport = validateLayout(sphere())
const debug = createLayoutDebugVisualization(sphere(), {
  count: 500,
  context: { width: 1280, height: 720, itemWidth: 1, itemHeight: 1 },
})

// 通过 StageExtension 挂载 debug.group；结束时释放：
debug.dispose()
```

协议、非有限值和释放残留属于 error；重复位置、可能重叠和无拾取边界属于 warning。诊断不会自动修正输出。Cards/Points 的 `renderer.metrics` 同时报告 GPU 容量、Geometry 构建、Attribute 复用和 Atlas 上传范围。

拾取与聚焦：

```ts
const stage = new MotionStage({
  container,
  renderer: cardsRenderer(),
})
stage.on('itemclick', ({ item }) => {
  void stage.focusItems([item.id])
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

| 质量 | 最大像素比 | 最大实例数 | 特效活跃上限 | 目标帧率 |
| --- | ---: | ---: | ---: | ---: |
| high | 1.5 | 2000 | 300 | 60 |
| medium | 1.25 | 1000 | 220 | 45 |
| low | 1 | 500 | 140 | 30 |

输入数据超过当前质量档位的最大实例数时，尾部数据不会进入纹理图集或 GPU 实例缓冲。运行时切换质量会异步扩缩实例池，并从完整输入数据恢复高质量容量；降级期间先在 Shader 中提前裁剪超额实例，避免旧容量继续产生片元负担。

## 性能基准

启动开发服务器后打开：

```text
http://localhost:5173/benchmark.html
```

基准页支持：

- 100、500、1000、2000 个固定实例规模
- auto、high、medium、low 质量模式
- 球体、立方体/长方体、圆柱体、平面、同心圆环、螺旋和圆锥布局
- 时空隧道、漩涡和径向爆发特效及实际活跃实例统计
- FPS、平均帧时间、实例池/实际提交/可见实例、Draw Call、三角形和纹理图集内存
- P50/P95/P99、24/33/50ms 长帧、Stage CPU 与 WebGL 提交耗时
- 扩展数量与每帧扩展 update 耗时；NONE/NATIVE/GSAP/BOTH 对比
- 图集构建/patch、图片加载失败和估算纹理上传字节
- steady、cold-start、atlas-update、interaction-stress、transition-stress 五类可复现场景
- 导入基线 JSON，并通过 `compareBenchmarkResults()` 输出同配置前后差异
- 版本化基准 JSON 严格解析、方向感知回归阈值和可用于 CI 的退出码
- 3 秒至 30 分钟采样、持续布局/特效中断与局部图集更新压力模式

导出的基准结果包含 `version: 1`。可在代码中使用 `parseBenchmarkResult()` 和 `evaluateBenchmarkRegression()`，或直接在命令行比较同配置结果：

```bash
npm run benchmark:compare -- baseline.json current.json
npm run benchmark:compare -- baseline.json current.json --thresholds thresholds.json --json
npx spatial-motion-benchmark baseline.json current.json
npx spatial-motion-benchmark baseline.json current.json --preset transition-stress-2000-auto
```

默认阈值覆盖 FPS、最大帧时间、P95/P99、33ms 长帧、Stage CPU、WebGL 提交、Atlas build/patch、纹理内存与估算上传量。配置不兼容或超过阈值时命令返回非零退出码；自定义阈值可对每个指标设置 `maxRegressionPercent`、`maxRegressionAbsolute` 或两者。随包提供的六个 `--preset` 覆盖 100/500/1000/2000 实例、low/medium/high/auto 质量和四类固定场景，CLI 会拒绝与预设不一致的结果。

重复提交视觉数据完全一致的列表时，渲染器会复用当前纹理图集，避免无意义的 Canvas 重绘和 GPU 纹理替换。同一 JavaScript turn 内的稳定 id 更新会合并；Cards 按项目保存内容指纹，局部更新只检查去重后的变化索引，不扫描完整名单。已初始化图集只上传变化单元对应的数据行，相邻单元会合并连续上传范围。Cards/Points 的 GPU Attribute 使用容量桶并原位写入，同一容量档内的布局切换不会替换 Geometry、Material 或过渡 Attribute。
图集默认使用 4px 隔离、mipmap 和最高 4x 各向异性采样。Cards `resolution` 支持 `32–256` 的显式数值或 `'auto'`；内置默认卡片未显式配置时，超过 1024 项会使用 48px，否则使用 64px。模板和自定义 `drawCard` 未配置时继续固定 64px，只有显式选择 `'auto'` 才参与数量降级，避免改变基于像素的内容布局。`mipmaps: false` 可供对纹理内存更敏感的场景主动关闭 mipmap；默认仍开启以保持远处采样稳定。图集还会根据设备 `MAX_TEXTURE_SIZE` 收敛最终分辨率。

256 项以上的内置默认卡片会在支持时把首次整图绘制和 readback 放入 OffscreenCanvas Worker。图片按 URL 去重后转换为可转移 `ImageBitmap`；失败或中止会关闭位图并安全回退，模板、自定义 `drawCard` 和局部 patch 不跨线程。异步模板和自定义 `drawCard` 继续使用隔离单元 Canvas。

`atlasMode: 'single'` 保持默认的单图集、mipmap 和细粒度行 patch。`'array'` 使用 Texture2DArray 自适应分页，关闭 mipmap，并在不超过设备能力和 256 层的前提下选择尽量平衡的页尺寸；首帧约上传 3 MiB，后续每帧约上传 768 KiB，避免大型纹理一次提交。`'auto'` 只会在显式关闭 mipmap且完整图集像素不小于 16 MiB 时选择 array，小图集和需要 mipmap 的场景继续使用 single。

Single 模式的首次上传和 WebGL context 恢复使用完整图集上传，并默认只预热不超过 16 MiB 的 Atlas 像素缓冲；`texturePrewarm: true/false` 可强制开启或关闭。Array 模式按层渐进上传，局部更新会重传受影响的完整页面，因此更适合大量静态内容；频繁小范围更新通常应继续使用 single。两种模式都保持一个实例 Mesh 和主体 1 Draw Call。Array Store 与 GLSL3 Shader 只在实际选中时动态加载，不进入默认 Cards 消费产物。`renderer.metrics` 会报告实际模式、分辨率、层数、上传进度、mipmap、Worker/位图解码和预热数据。

## 包构建与体积基准

Library build 使用 ESM 保留模块结构并生成 `.d.ts`/声明映射，Three.js 保持为外部依赖。当前自动化预算和实测基线：

| 项目 | 预算 | 当前基线 |
| --- | ---: | ---: |
| 根入口真实消费者 gzip | ≤ 40 KB | 34.6 KB（35,433 bytes） |
| Core-only 真实消费者 gzip | ≤ 16 KB | 14.7 KB（15,075 bytes） |
| Cards-only 真实消费者 gzip | ≤ 10 KB | 8.2 KB（8,407 bytes） |
| 按需 card-template gzip | ≤ 12 KB | 6.0 KB（6,194 bytes） |
| 按需 Points Renderer gzip | ≤ 12 KB | 2.8 KB（2,918 bytes） |
| 按需开发诊断 gzip | ≤ 12 KB | 3.8 KB（3,923 bytes） |
| npm tarball | ≤ 150 KB | 109.9 KiB（112,543 bytes） |
| 仅引入 `sphere()` 的消费者产物 | ≤ 8 KB | 5.5 KB（5,598 bytes） |

`npm run pack:check` 会真实生成 `.tgz`，在临时消费者项目中完成安装、Node ESM 加载、严格 TypeScript 检查、未声明深层路径拦截、浏览器 Stage 构建和 Vite Tree Shaking 验证。根入口、Core-only 与 Cards-only 的预算按真实 Vite/Terser 消费产物计算，并保持 Three.js external；各输出模块 gzip 相加只保留为诊断值，不作为用户下载体积门禁。发布内容仅包含 `dist`、版本/使用文档、LICENSE 和包元数据。

约 2.5 秒采样窗口内，平均 FPS、P95 帧预算或 33ms 长帧比例任一持续恶化会下降一级；质量切换后有 5 秒冷却，FPS、P95 与长帧比例共同稳定约 8 秒后才允许恢复。页面切到后台、调试暂停及超过 100ms 的异常长帧不会参与判断。
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

所有内置流式特效统一通过 `enterEffect()` 进入。对应 Cards Effect Program 首次使用时
动态加载并缓存，不进入基础 Cards bundle；切换效果不会创建新的 Mesh 或增加 Draw Call。
业务 GPU 动画可以通过 `defineCardEffectProgram()` 声明私有 Attribute、Uniform、
运动 GLSL 和 payload 上传函数，完整示例见 `examples/custom-card-effect`。需要控制
完整 Material 或渲染管线时继续实现自定义 `MotionRenderer`。

球体头像朝向：

```ts
sphere({ orientation: 'surface' })         // 默认，严格贴合球面切线
sphere({ orientation: 'camera' })          // 始终正对相机
sphere({ orientation: 'upright-surface' }) // 像圆柱一样竖直包裹球面

sphere({
  fit: 'contain',            // 根据相机可视短边完整显示球体
  viewportPadding: 0.06,     // 每侧保留 6% 安全区
  startAngle: Math.PI / 2,   // 调整接缝和首列经度
  edgeFade: 0.08,            // 球体轮廓柔和淡出；默认 0
  poleMode: 'exclude',       // 头像场景避开方向不唯一的精确极点
})

sphere({
  distribution: 'fibonacci', // 等面积分布，自动避开精确极点
  minLatitude: 0,
  maxLatitude: Math.PI / 2,  // 北半球球冠
})
```

通用布局：

```ts
import { box, cone, cylinder, helix, ring } from '@itagan/spatial-motion'

await stage.to(box({
  width: 8,
  height: 6,
  depth: 5,
  faces: ['front', 'right'],
  edgePadding: 0.35,
  faceWeights: { front: 2, right: 1 },
  orientation: 'surface',
}))

await stage.to(cylinder({
  radius: 5,
  rows: 8,              // rows 与 columns 二选一
  startAngle: -Math.PI / 2,
  arcAngle: Math.PI,    // 半圆展墙
  orientation: 'camera',
}))

await stage.to(ring({
  innerRadius: 0.8,
  spacing: 0.42,
  distribution: 'equal',
  stagger: false,
  clockwise: true,
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
  topRadius: 2, // 0 为尖锥，等于 radius 时为等半径柱面
  height: 9,
  stagger: true,
  orientation: 'upright-surface', // surface 可严格贴合锥面
}))
```

这些布局会根据实例数量自动计算面分布、环数、圈数和卡片缩放，也可通过尺寸、范围、`rings`、`turns`、`density` 等参数锁定视觉密度。Sphere 支持固定半径或响应式 `contain`、起始经度和可选轮廓淡出；其 `rings`/`stagger` 仅用于 latitude 模式。Cylinder 的 `rows`/`columns` 在严格配置中互斥。它们遵循统一 `Layout` 契约，可直接插入 Timeline，并在任意中间帧切换到其他布局或流式特效。

确定性的散开布局可用于爆炸、解散和重新聚合配方：

```ts
import { box, scatter } from '@itagan/spatial-motion'

await stage.to(box())
await stage.to(scatter({
  direction: 'radial',
  distance: 12,
  depth: 8,
  layers: 6,
  spinMode: 'directional',
  opacity: 0,
  seed: 42,
}), { duration: 900 })
await stage.to(box(), { duration: 1300 })
```

`scatter()` 同样是普通 `Layout`，相同数量、配置和 `seed` 始终生成相同目标，因此可以安全插入 Timeline、被新布局中断或作为聚合动画的起点。`layers` 提供稳定的远近分层；`spinMode: 'directional'` 会沿散开方向旋转。Scatter 使用 surface 过渡，使 `spin` 真正参与 GPU 四元数插值。

连续编排：

```ts
await stage
  .timeline()
  .add(() => stage.to(sphere()))
  .wait(1000)
  .add(() => stage.to(cylinder()))
  .play()
```

`stage.timeline().wait()` 使用与布局和特效相同的暂停感知时钟；页面隐藏、手动暂停和 context loss 不消耗等待时间，destroy 会停止等待及后续步骤。直接 `new Timeline()` 仍使用普通计时器。

## 源码边界

```text
src/
├── core/          Stage、Timeline、公共类型和插值
├── layouts/       无渲染依赖的布局算法
├── effects/       隧道等固定对象池流式效果
├── renderers/     WebGL 实例渲染与纹理图集
├── renderers/     稳定批量渲染协议、Cards、Points 与纹理图集
└── performance/   设备质量检测与性能配置
demo/              性能和连续动画演示
examples/          Vanilla、Three.js extension 和 GSAP 单场景示例
```

## 兼容性与后续路线

v1.x 的公共入口和兼容承诺见[公共 API 文档](./docs/PUBLIC_API.md)，运行环境与已知限制见[兼容性文档](./docs/COMPATIBILITY.md)。CSS3D 可选渲染器、Vue/React 薄适配器等后续方向统一维护在[路线图](./ROADMAP.md)中。

## License

[MIT](./LICENSE)

## 性能原则

- 业务数据量与当前可视数量分离
- 运动过程中不反复创建对象、纹理、矩阵或 Tween
- 切换开始时上传起点和终点缓冲，逐帧插值交给 GPU
- 低配设备降低实例上限和像素比
- 普通头像使用低分辨率图集，聚焦对象按需加载高清资源
- 所有循环、监听器、纹理和 WebGL 资源必须支持销毁
