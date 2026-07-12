# Spatial Motion

面向活动大屏、数据展示和互动场景的高性能 3D 卡片动效引擎。核心库不依赖 Vue、React 或具体业务。

## 当前能力

- `InstancedMesh` 批量渲染卡片，主体场景保持单 Draw Call
- Canvas Texture Atlas，避免每个卡片独立纹理和材质
- 球体、圆柱体、平面网格布局
- 同一批实例在布局之间连续过渡，不重建 Three.js 对象
- 自动旋转和串行 Timeline
- high、medium、low 设备质量分级
- 自动限制像素比和可见实例数量
- ResizeObserver 响应式画布及完整资源释放

目前是本地预研版本，尚未初始化独立 Git 仓库，也未发布 npm 包。

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
})

await stage.setItems(participants)
stage.autoRotate({ y: 0.25 })
await stage.to(sphere({ radius: 5 }), { duration: 1600 })
await stage.to(cylinder({ radius: 5 }), { duration: 1400 })
```

球体头像朝向：

```ts
sphere({ orientation: 'upright-surface' }) // 默认，像圆柱一样竖直包裹球面
sphere({ orientation: 'camera' })          // 始终正对相机
sphere({ orientation: 'surface' })         // 严格贴合球面切线
```

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
├── renderers/     WebGL 实例渲染与纹理图集
└── performance/   设备质量检测与性能配置
demo/              性能和连续动画演示
```

## 后续路线

1. GPU Shader 布局插值，进一步降低大量实例过渡时的 CPU 消耗
2. 时空隧道、线性发射器及固定对象池
3. 动态性能监控与运行时自动降级
4. 动态增删数据、卡片聚焦和拾取事件
5. CSS3D 可选渲染器以及 Vue/React 薄适配器
6. 独立 library build、导出边界和包体积基准

## 性能原则

- 业务数据量与当前可视数量分离
- 运动过程中不反复创建对象、纹理或 Tween
- 低配设备降低实例上限和像素比
- 普通头像使用低分辨率图集，聚焦对象按需加载高清资源
- 所有循环、监听器、纹理和 WebGL 资源必须支持销毁
