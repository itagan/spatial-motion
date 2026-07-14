# 浏览器支持与已知限制

## 运行环境

Spatial Motion 的 `MotionStage` 面向支持 WebGL2、ES2022、Canvas 2D、ResizeObserver 和 requestAnimationFrame 的现代常青桌面浏览器。CI 使用 Node.js 22；包声明的工具链最低版本是 Node.js 20。

- Chrome、Edge、Firefox、Safari 应使用仍受厂商支持的当前版本。
- Three.js 必须满足 `>=0.178.0 <1.0.0`，并由应用提供。
- 主入口包含浏览器运行时；纯布局子入口可在 Node ESM 中计算，不需要创建 WebGL 上下文。
- 服务端渲染阶段不要实例化 `MotionStage`，应在浏览器挂载后创建并在卸载时销毁。

项目不承诺 WebGL1、Internet Explorer、旧版内嵌 WebView 或关闭硬件加速的环境。应用应在创建 Stage 前检查自己的目标设备，并为 WebGL 创建失败提供静态回退界面。

## 图片与 Canvas

- 远程图片以匿名 CORS 请求加载；源站必须返回允许当前页面读取图片的响应头。
- 加载失败、CORS 拒绝或自定义 `drawCard` 抛错时，卡片会回退到基于 id/title 的内置占位图。
- 自定义绘制回调接收 Canvas 2D 上下文，不接收 HTML；异步回调应自行处理业务请求的超时和取消。
- 图集使用固定 64px 单元，适合大量缩略卡片，不是高清近景图片管线。

## 已知限制

- 不提供 DOM/CSS3D 卡片、HTML 模板、Vue/React 组件挂载或内建无障碍语义。
- 不恢复 WebGL context loss；浏览器或 GPU 重置后应销毁并重新创建 Stage。
- 一个 Stage 使用单张纹理图集，没有跨图集分页；极端自定义质量上限可能受设备最大纹理尺寸限制。
- FPS 与纹理内存统计用于相对基准，不等同于浏览器完整 GPU/进程内存。
- 单 Draw Call 指主体实例卡片 Mesh；浏览器、调试工具或应用加入的其他场景对象不包含在该保证中。
- Reduced Motion 会立即完成布局、停止自动旋转并固定流式特效首帧，但应用自行添加的 Timeline wait 或外部动画不受控制。

移动设备表现高度依赖 GPU、散热、像素比和内嵌浏览器。默认质量策略会降级实例数量，但不承诺任意移动设备、任意数据量下固定帧率；请在目标硬件的 benchmark 页面实测。
