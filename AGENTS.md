# Spatial Motion 开发代理指南

本文件适用于整个仓库，是 Codex、Claude Code 及其他自动化开发代理进入项目后的首要说明。

## 项目定位

Spatial Motion 是面向活动大屏、数据展示和互动场景的高性能 3D 卡片动效引擎。它是独立、框架无关的 TypeScript/Three.js 库，不是某个抽奖页面或 Vue 应用。

- 正式源码、测试、演示和文档全部位于本仓库内。
- 仓库之外的同级目录属于早期参考材料，不是依赖、兼容目标或事实来源；不要读取、修改或复制其中的实现，除非用户明确要求。
- 当前包名是 `@itagan/spatial-motion`，Three.js 必须保持为 peer dependency。
- v1.0.0 源码已具备发布形态，但 npm Registry 状态必须以 release 记录为准；README 中的 GitHub 安装方式始终可用于未发布提交。

## 事实来源与优先级

出现冲突时按以下顺序判断：

1. 用户在当前任务中的明确要求。
2. 实际源码、测试、`package.json` 和 CI 配置。
3. 本文件中的开发约束。
4. `ROADMAP.md` 中的当前目标和计划。
5. `docs/DEVELOPMENT.md` 中的工作流程。
6. `docs/PUBLIC_API.md` 和 `docs/COMPATIBILITY.md` 中的公开兼容承诺。
7. `README.md` 中面向使用者的功能说明。

不要把提交历史、分支名或历史参考项目当成未声明的产品需求。发现文档与实现不一致时，在同一变更中修正文档，或明确报告差异。

## 架构边界

```text
src/
├── core/          MotionStage、Timeline、公共类型和插值
├── layouts/       无渲染依赖的纯布局算法
├── effects/       固定对象池的流式特效及其配置
├── renderers/     WebGL 实例渲染、Shader 和纹理图集
└── performance/   质量档位、自适应性能和基准采样
demo/              使用源码的演示页和性能基准页
examples/          从正式包名导入的单场景集成示例
scripts/           包发布形态与消费者验证脚本
```

依赖方向应尽量保持为：`core` 负责编排，调用布局、特效、渲染和性能模块；`layouts` 不应依赖 DOM、WebGL 渲染器或框架；`renderers` 不承载业务流程；`demo` 不包含库运行所必需的逻辑。

稳定公共入口仅限：

- `@itagan/spatial-motion`
- `@itagan/spatial-motion/core`
- `@itagan/spatial-motion/layouts`
- `@itagan/spatial-motion/layouts/{sphere,cylinder,grid,ring,helix,cone,box,scatter}`
- `@itagan/spatial-motion/effects`
- `@itagan/spatial-motion/performance`
- `@itagan/spatial-motion/card-template`
- `@itagan/spatial-motion/renderers/cards`
- `@itagan/spatial-motion/renderers/points`
- `@itagan/spatial-motion/package.json`

除上述入口外，不要把 `renderers` 或其他内部目录暴露为公共子路径。新增公共 API 时，同时检查 `src/index.ts` 或对应子入口、类型声明、`package.json#exports`、README 示例和包消费者验证。

## 核心工程原则

- 保持框架无关，不在核心库中引入 Vue、React 或业务状态管理。
- 保持 ESM 和严格 TypeScript；源码内部相对导入使用 `.js` 后缀，以兼容构建后的 Node ESM。
- 数据项以非空、唯一、稳定的 `id` 识别；不要退回依赖数组索引维持对象身份。
- 动画期间避免逐帧创建对象、纹理、矩阵、Tween 或重建 Mesh；尽可能把插值交给 GPU。
- 保持主卡片场景单 Draw Call 的设计目标，流式特效复用固定实例对象池。
- 业务数据量与实际渲染/特效活跃数量分离，并遵守质量档位上限。
- 所有动画循环、监听器、Observer、纹理和 WebGL 资源都必须可停止并释放；`destroy()` 保持幂等。
- 异步更新和可中断动画必须防止旧结果覆盖新状态，并释放失效结果创建的资源。
- 页面隐藏、调试暂停和异常长帧不能污染自适应性能判断。
- 不降低 `scripts/verify-package.mjs` 中的体积预算或消费者检查来掩盖回归；如确有必要，先说明理由和实测影响。

## 开发流程

开始修改前：

1. 阅读 `README.md`、`ROADMAP.md` 和 `docs/DEVELOPMENT.md`。
2. 检查工作树，保留用户已有改动，不处理任务范围外的文件。
3. 找到相邻实现和测试，确认变更属于哪个架构模块、是否影响公共 API。

实现时：

- 优先做最小且完整的改动，不顺手重构无关代码。
- 修复缺陷时先补能复现问题的回归测试；新增行为时为正常路径、边界和资源释放补测试。
- 测试文件与实现放在同一目录，命名为 `*.test.ts`。
- 性能相关变更应说明实例数、质量档位、Draw Call、纹理内存或帧率中的相关指标，并按需在 `/benchmark.html` 实测。
- 用户可见行为、公共 API、安装方式、性能预算或路线变化必须同步更新相应文档。

完成前按风险执行验证：

```bash
npm run typecheck
npm test
npm run build:lib
npm run build:demo
npm run build:examples
npm run pack:check
```

纯文档改动可以不运行构建和测试，但要检查链接、命令、文件路径及其与当前实现是否一致。代码或配置变更默认运行完整验证；若环境或任务范围导致无法运行，交付时列出未运行项和原因。

## 完成标准

一项开发任务只有在以下条件满足后才算完成：

- 行为符合当前请求，且没有把历史参考项目引入正式实现。
- 类型检查和相关测试通过，必要时完整 CI 等价命令通过。
- 生命周期、并发更新和资源释放路径已考虑。
- 公共 API、包导出和性能预算没有意外变化。
- 文档与实际行为一致，路线图状态只在确有证据时更新。
- 交付说明列明修改内容、验证结果和仍存在的明确风险。
