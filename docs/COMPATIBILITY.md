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
- 加载失败、CORS 拒绝、超过 `imageTimeout` 或自定义 `drawCard` 抛错时，卡片会回退到基于 id/title 的内置占位图。
- 自定义绘制回调接收 Canvas 2D 上下文，不接收 HTML；异步回调应自行处理业务请求的超时和取消。
- 图集使用固定 64px 单元，适合大量缩略卡片，不是高清近景图片管线。

## 已知限制

- 不提供 DOM/CSS3D 卡片、HTML 模板、Vue/React 组件挂载或内建无障碍语义。
- WebGL context loss 会暂停 Stage，context restored 后重新上传图集并恢复；若浏览器无法恢复上下文，应用仍应提供重新创建 Stage 或静态回退入口。
- 一个 Stage 使用单张纹理图集，没有跨图集分页；图集会自动降低单元分辨率以遵守设备最大纹理尺寸，因此极端实例量下清晰度会下降。
- FPS 与纹理内存统计用于相对基准，不等同于浏览器完整 GPU/进程内存。
- 单 Draw Call 指主体实例卡片 Mesh；浏览器、调试工具或应用加入的其他场景对象不包含在该保证中。
- Stage extension 的额外 Object3D 可能增加 Draw Call；扩展必须复用应用提供且满足 peer 范围的同一 Three.js，不应捆绑第二份 Three.js。
- Reduced Motion 会立即完成布局、停止自动旋转并固定流式特效首帧。Stage extension 会收到 pause/resume 生命周期，但动画库的具体低动态表现仍由扩展实现。
- Stage extension 不提供外部对象拾取、后处理、多相机、CSS3D 或框架组件挂载；扩展创建的 GPU/动画资源由扩展在 dispose 中释放。
- disable 的扩展仍保留其 Three.js/动画资源并接收质量与低动态状态变化；只有 remove 或 Stage destroy 才会 abort 和 dispose。应用不应把 disable 当成释放内存。

移动设备表现高度依赖 GPU、散热、像素比和内嵌浏览器。默认质量策略会降级实例数量，但不承诺任意移动设备、任意数据量下固定帧率；请在目标硬件的 benchmark 页面实测。
