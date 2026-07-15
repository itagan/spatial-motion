# 发布清单

本清单适用于 v1.0.0 及后续版本。npm publish、Git tag 和 GitHub Release 都是明确的外部发布动作，只有维护者授权后才能执行。

## 1. 准备版本

- [ ] 从干净、已同步的 `main` 创建 release 分支。
- [ ] 确认 `package.json` 与 `package-lock.json` 版本一致。
- [ ] 更新 `CHANGELOG.md`、README、ROADMAP 和必要的兼容/迁移说明。
- [ ] 检查稳定入口仍只有主入口、`layouts`、`effects`、`performance` 和 `package.json`。
- [ ] 确认 Three.js 仍为 peer dependency，且没有引入框架运行时。

## 2. 完整验证

```bash
npm ci
npm run verify
```

- [ ] TypeScript 严格检查通过。
- [ ] 全部 Vitest 通过，包含零/单/大量数据、竞态、中断、暂停/恢复和销毁。
- [ ] library 与 demo 构建通过。
- [ ] `pack:check` 的 Node ESM、严格类型、浏览器 Stage 构建、内部路径拦截和 Tree Shaking 全部通过。
- [ ] gzip ≤ 40 KB、tarball ≤ 150 KB、layout-only ≤ 8 KB。
- [ ] 在目标 Chrome、Firefox、Safari/Edge 至少完成一轮真实图片、CORS 失败、悬停、动态更新、页面隐藏、销毁和 benchmark 冒烟。
- [ ] benchmark 主体 Draw Call 为 1，并记录设备、浏览器、实例数、质量档位与采样时长。

## 3. 发布

```bash
npm pack --dry-run
npm publish --access public
git tag v1.0.0
git push origin v1.0.0
```

- [ ] 发布命令使用有 scope 权限且启用所需 2FA 的 npm 身份。
- [ ] npm publish 成功后再创建并推送 tag，避免 tag 指向未发布版本。
- [ ] GitHub Release 使用对应 CHANGELOG 内容，并链接 demo/benchmark 验证结果。

版本号示例仅用于 v1.0.0；后续发布必须替换为实际版本。失败时不要覆盖已发布版本，应修复后递增 patch。

## 4. 发布后空项目验证

在不引用仓库源码的新目录执行：

```bash
npm init -y
npm install @itagan/spatial-motion three typescript vite
```

- [ ] Node ESM 可导入主入口和三个子路径。
- [ ] 严格 TypeScript 可解析所有公开类型。
- [ ] Vite 浏览器应用可创建 Stage、加载真实图片、局部更新并销毁。
- [ ] 未公开的 renderer 深层路径无法导入。
- [ ] 只导入 `sphere()` 的构建不包含 MotionStage/WebGLRenderer。
- [ ] npm 页面、README、版本号和 tarball 文件列表正确。

完成后把验证结果和实际发布链接写入 release 记录；只有 Registry 安装验证通过，才能把 README 的 npm 发布状态改成“已发布”。

## v1.0.0 候选版本验证记录

2026-07-14 本地验证：

- `npm run verify` 通过：85 项 Vitest、library/demo build、Node ESM、严格 TypeScript、子路径边界、浏览器消费者构建和 Tree Shaking。
- 包指标：Library JavaScript gzip 26,751 bytes；tarball 约 102 KB；layout-only 消费者 2,086 bytes。
- 本地 Chromium WebGL demo：600 items / high quality，页面显示 60 FPS，无 error 级控制台日志。
- benchmark：600 items 布局模式为 1 Draw Call；1500 items 的 burst tunnel 为 1 Draw Call，high 档活跃实例 300，无 error 级控制台日志。

尚未完成：Firefox/Safari/Edge 目标设备矩阵、真实远程 CORS 成功/失败源、长时间采样、npm publish、tag、GitHub Release 和 Registry 空项目安装。这些状态不得因本地候选验证而标记完成。
