import { gzipSync } from 'node:zlib'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const packageName = packageJson.name
const jsGzipBudget = 40 * 1024
const tarballBudget = 150 * 1024
const treeShakenBudget = 8 * 1024
const keepConsumer = process.env.KEEP_PACKAGE_CONSUMER === '1'

assert(packageName === '@itagan/spatial-motion', `Unexpected package name: ${packageName}`)
assert(packageJson.sideEffects === false, 'Package must declare sideEffects: false')
assert(packageJson.peerDependencies?.three, 'Three.js must be a peer dependency')
assert(!packageJson.dependencies?.three, 'Three.js must not be a runtime dependency')

const requiredExports = ['.', './layouts', './effects', './performance']
for (const exportPath of requiredExports) {
  const declaration = packageJson.exports?.[exportPath]
  assert(declaration?.types && declaration?.import, `Missing typed ESM export: ${exportPath}`)
  await stat(join(root, declaration.types.replace(/^\.\//, '')))
  await stat(join(root, declaration.import.replace(/^\.\//, '')))
}

const distFiles = await listFiles(join(root, 'dist'))
const jsFiles = distFiles.filter((path) => path.endsWith('.js'))
const jsContents = await Promise.all(jsFiles.map((path) => readFile(path)))
const jsBytes = jsContents.reduce((total, contents) => total + contents.byteLength, 0)
const jsGzipBytes = jsContents.reduce((total, contents) => total + gzipSync(contents).byteLength, 0)
assert(jsBytes < 150 * 1024, `Library JS suggests Three.js was bundled: ${jsBytes} bytes`)
assert(jsGzipBytes <= jsGzipBudget, `Library JS gzip budget exceeded: ${jsGzipBytes} > ${jsGzipBudget}`)
assert(jsContents.some((contents) => /from\s*["']three["']/.test(contents.toString('utf8'))), 'Library should retain an external Three.js import')

const dryRun = parsePackResult(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts']))
assert(dryRun.size <= tarballBudget, `Tarball budget exceeded: ${dryRun.size} > ${tarballBudget}`)
for (const file of dryRun.files) {
  assert(
    file.path === 'package.json'
      || file.path === 'README.md'
      || file.path === 'ROADMAP.md'
      || file.path === 'AGENTS.md'
      || file.path === 'CLAUDE.md'
      || file.path === 'CHANGELOG.md'
      || file.path === 'LICENSE'
      || file.path.startsWith('docs/')
      || file.path.startsWith('dist/')
      || file.path === 'scripts/compare-benchmarks.mjs'
      || file.path === 'scripts/benchmark-presets.json',
    `Unexpected published file: ${file.path}`,
  )
}

const tempRoot = await mkdtemp(join(tmpdir(), 'spatial-motion-package-'))
try {
  const packResult = parsePackResult(run('npm', [
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    tempRoot,
  ]))
  const tarball = join(tempRoot, packResult.filename)
  const consumer = join(tempRoot, 'consumer')
  await mkdir(consumer)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies: {
      [packageName]: `file:${tarball}`,
      three: `file:${join(root, 'node_modules/three')}`,
    },
  }, null, 2))
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer)

  await writeFile(join(consumer, 'runtime-check.mjs'), `
    import assert from 'node:assert/strict'
    const main = await import('${packageName}')
    const layouts = await import('${packageName}/layouts')
    const effects = await import('${packageName}/effects')
    const performance = await import('${packageName}/performance')
    assert.equal(typeof main.MotionStage, 'function')
    assert.equal(typeof layouts.sphere, 'function')
    assert.equal(typeof layouts.box, 'function')
    assert.equal(typeof layouts.scatter, 'function')
    assert.equal(typeof layouts.createLayout, 'function')
    assert.equal(typeof layouts.parseLayoutConfig, 'function')
    const configured = layouts.parseLayoutConfig('{"version":1,"type":"sphere","options":{"rings":8}}')
    assert.equal(layouts.createLayout(configured).calculate(12, { width: 1, height: 1 }).length, 12)
    assert.equal(typeof effects.vortex, 'function')
    assert.equal(typeof performance.BenchmarkSession, 'function')
    assert.equal(typeof performance.compareBenchmarkResults, 'function')
    assert.equal(typeof performance.parseBenchmarkResult, 'function')
    assert.equal(typeof performance.evaluateBenchmarkRegression, 'function')
    assert.equal(typeof main.MotionStage.prototype.updateItem, 'function')
    assert.equal(typeof main.MotionStage.prototype.updateItemsById, 'function')
    assert.equal(typeof main.MotionStage.prototype.addExtension, 'function')
    assert.equal(typeof main.MotionStage.prototype.startTransition, 'function')
    assert.equal(typeof main.MotionStage.prototype.getTransitionState, 'function')
    assert.equal(typeof main.MotionStage.prototype.focusItem, 'function')
    assert.equal(typeof main.easing.sineInOut, 'function')
    await assert.rejects(
      import('${packageName}/renderers/InstancedCardRenderer'),
      (error) => error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    )
  `)
  run(process.execPath, ['runtime-check.mjs'], consumer)

  const benchmarkFixture = {
    version: 1,
    configuration: { itemCount: 1000, qualityMode: 'high', layout: 'sphere', scenario: 'steady' },
    samples: [],
    durationMs: 1000,
    sampleCount: 10,
    averageFps: 60,
    minimumFps: 58,
    averageFrameMs: 16.7,
    maximumFrameMs: 20,
    averageFrameTimeP50: 16.5,
    maximumFrameTimeP95: 18,
    maximumFrameTimeP99: 20,
    longFramesOver24Ms: 0,
    longFramesOver33Ms: 0,
    longFramesOver50Ms: 0,
    ignoredFrames: 0,
    averageFrameCpuMs: 0.3,
    maximumFrameCpuMs: 0.5,
    averageRenderSubmitMs: 0.5,
    maximumRenderSubmitMs: 0.8,
    averageExtensionUpdateMs: 0,
    maximumExtensionUpdateMs: 0,
    maximumExtensions: 0,
    transformCalculationMs: 0,
    transformCalculations: 0,
    pickingMs: 0,
    pickOperations: 0,
    atlasBuilds: 0,
    atlasPatches: 0,
    atlasDiscardedBuilds: 0,
    atlasDiscardedPatches: 0,
    atlasCellsUpdated: 0,
    atlasBuildMs: 0,
    atlasPatchMs: 0,
    atlasDrawMs: 0,
    imageLoadMs: 0,
    imageRequests: 0,
    imageFailures: 0,
    maximumDrawCalls: 1,
    maximumTriangles: 200,
    maximumTextureBytes: 1_000_000,
    estimatedTextureUploadBytes: 1_000_000,
    renderedItems: 100,
    submittedItems: 100,
    visibleItems: 100,
    extensionStats: [],
  }
  await writeFile(join(consumer, 'baseline.json'), JSON.stringify(benchmarkFixture))
  await writeFile(join(consumer, 'current.json'), JSON.stringify(benchmarkFixture))
  run(join(consumer, 'node_modules/.bin/spatial-motion-benchmark'), [
    'baseline.json',
    'current.json',
    '--preset',
    'steady-1000-high',
  ], consumer)

  await writeFile(join(consumer, 'consumer.ts'), `
    import {
      type CardStyle,
      type CardTitleStyle,
      type MotionItem,
      type MotionItemUpdate,
      type MotionPreference,
      type MotionStage,
      type MotionStageOptions,
      type ResolveCardStyle,
      type StagePerformanceEnvironment,
      type StageTransitionHandle,
      type StageTransitionResult,
      type StageExtension,
      type StageExtensionContext,
      type StageExtensionHandle,
      type StageExtensionStats,
      createLayout,
      parseLayoutConfig,
      type LayoutConfig,
      type BoxFace,
      sphere,
    } from '${packageName}'
    import { box, createLayout as createLayoutFromSubpath, parseLayoutConfig as parseLayoutConfigFromSubpath, ring, scatter, type LayoutConfig as SubpathLayoutConfig } from '${packageName}/layouts'
    import { vortex, type EmissionOptions } from '${packageName}/effects'
    import { BenchmarkSession, compareBenchmarkResults, evaluateBenchmarkRegression, parseBenchmarkResult, type BenchmarkRegressionThresholds, type BenchmarkResult } from '${packageName}/performance'
    const items: MotionItem[] = [{ id: 'one' }]
    declare const stage: MotionStage | undefined
    const emission: EmissionOptions = { mode: 'wave' }
    const motion: MotionPreference = 'auto'
    const titleStyle: CardTitleStyle = { position: 'bottom', fontSizeRatio: 0.12, maxLines: 2 }
    const cardStyle: CardStyle = {
      shape: 'rounded',
      cornerRadius: 8,
      imageFit: 'cover',
      imagePosition: { x: 0.5, y: 0.25 },
      titleStyle,
    }
    const resolveCardStyle: ResolveCardStyle = (item) =>
      item.meta ? { borderColor: '#ffd700' } : undefined
    const stageOptions: Omit<MotionStageOptions, 'container'> = {
      cardAspectRatio: 0.75,
      cardStyle,
      resolveCardStyle,
      drawCard(context, item, bounds, resolvedStyle) {
        void [context, item, bounds, resolvedStyle]
      },
      cardResolution: 96,
      imageTimeout: 5000,
      imageConcurrency: 4,
      imageCacheSize: 64,
      transition: { duration: 900 },
      onContextChange: (state) => void state,
      keyboardNavigation: true,
      ariaLabel: 'Participants',
    }
    const updates: MotionItemUpdate[] = [{ id: 'one', patch: { title: 'updated' } }]
    declare const benchmark: BenchmarkResult
    const environment: StagePerformanceEnvironment | undefined = stage?.getPerformanceEnvironment()
    const comparison = compareBenchmarkResults(benchmark, benchmark)
    const thresholds: BenchmarkRegressionThresholds = { averageFps: { maxRegressionPercent: 8 } }
    const regression = evaluateBenchmarkRegression(benchmark, benchmark, thresholds)
    const parsedBenchmark = parseBenchmarkResult(JSON.stringify(benchmark))
    const layoutConfig = parseLayoutConfig({ version: 1, type: 'sphere', options: { rings: 8 } }) satisfies LayoutConfig
    const face: BoxFace = 'front'
    const advancedLayouts: LayoutConfig[] = [
      { version: 1, type: 'sphere', options: { distribution: 'fibonacci', minLatitude: 0 } },
      { version: 1, type: 'box', options: { faces: [face], edgePadding: 0.2, faceWeights: { front: 2 } } },
      { version: 1, type: 'cylinder', options: { rows: 4, arcAngle: Math.PI } },
      { version: 1, type: 'ring', options: { distribution: 'equal', clockwise: true } },
      { version: 1, type: 'cone', options: { radius: 4, topRadius: 2 } },
    ]
    const extension: StageExtension = {
      order: 10,
      mount({ root, camera, signal }: StageExtensionContext) { void [root, camera, signal] },
      update({ elapsed, delta }) { void [elapsed, delta] },
      resize({ width, height, pixelRatio }) { void [width, height, pixelRatio] },
      qualityChange(quality) { void quality },
      reducedMotionChange(reducedMotion) { void reducedMotion },
      dispose() {},
    }
    const extensionHandle: Promise<StageExtensionHandle> | undefined = stage?.addExtension(extension)
    const transitionHandle: StageTransitionHandle | undefined = stage?.startTransition(sphere(), { duration: 100, signal: new AbortController().signal })
    const transitionResult: Promise<StageTransitionResult> | undefined = transitionHandle?.finished
    const extensionStats: StageExtensionStats[] | undefined = stage?.getExtensionStats()
    const subpathConfig = parseLayoutConfigFromSubpath(JSON.stringify(layoutConfig)) satisfies SubpathLayoutConfig
    const configuredLayouts = [createLayout(layoutConfig), createLayoutFromSubpath(subpathConfig)]
    stage?.updateItem('one', { title: 'winner' })
    stage?.updateItemsById(updates)
    void [items, stage, sphere(), box(), ring(), scatter({ layers: 4, spinMode: 'directional' }), configuredLayouts, advancedLayouts.map(createLayout), extensionHandle, extensionStats, transitionHandle, transitionResult, stage?.getTransitionState(), stage?.getFocusedItem(), vortex(), BenchmarkSession, comparison, regression, parsedBenchmark, environment, emission, motion, cardStyle, titleStyle, resolveCardStyle, stageOptions]
  `)
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022', 'DOM'],
      strict: true,
      skipLibCheck: false,
      noEmit: true,
    },
    include: ['consumer.ts'],
  }, null, 2))
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer)

  await writeFile(join(consumer, 'index.html'), '<div id="result"></div><script type="module" src="/tree.ts"></script>')
  await writeFile(join(consumer, 'tree.ts'), `
    import { sphere } from '${packageName}'
    document.querySelector('#result').textContent = String(sphere().calculate(3, { width: 1, height: 1 }).length)
  `)
  run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build'], consumer)
  const consumerJs = (await Promise.all(
    (await listFiles(join(consumer, 'dist')))
      .filter((path) => path.endsWith('.js'))
      .map((path) => readFile(path, 'utf8')),
  )).join('\n')
  assert(Buffer.byteLength(consumerJs) <= treeShakenBudget, `Tree-shaken layout bundle exceeded budget: ${Buffer.byteLength(consumerJs)} > ${treeShakenBudget}`)
  assert(!consumerJs.includes('MotionStage'), 'Layout-only bundle contains MotionStage')
  assert(!consumerJs.includes('WebGLRenderer'), 'Layout-only bundle contains the WebGL renderer')
  assert(!consumerJs.includes('effectMode'), 'Layout-only bundle contains streaming effect shaders')

  await writeFile(join(consumer, 'stage.html'), `
    <style>html,body,#stage{width:100%;height:100%;margin:0;background:#05070d}#result{position:fixed;z-index:2;color:white}</style>
    <pre id="result">starting</pre><div id="stage"></div><script type="module" src="/stage.ts"></script>
  `)
  await writeFile(join(consumer, 'stage.ts'), `
    import { MotionStage, sphere, type MotionItem, type StageExtension } from '${packageName}'
    import { Object3D } from 'three'
    const container = document.querySelector<HTMLElement>('#stage')!
    const result = document.querySelector<HTMLElement>('#result')!
    const items: MotionItem[] = Array.from({ length: 12 }, (_, index) => ({ id: String(index), title: String(index) }))
    const stage = new MotionStage({
      container,
      quality: 'low',
      adaptivePerformance: false,
      cardStyle: { shape: 'rounded', cornerRadius: 8 },
      cardResolution: 64,
      imageTimeout: 1000,
      transition: { duration: 0 },
    })
    await stage.setItems(items)
    const extension: StageExtension = {
      mount({ root }) { root.add(new Object3D()) },
      update() {},
    }
    await stage.addExtension(extension)
    const handle = await stage.addExtension({ mount() {} })
    handle.disable()
    handle.enable()
    handle.remove()
    await stage.to(sphere({ radius: 3 }), { duration: 0 })
    await stage.updateItem('0', { title: 'updated' })
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const stats = stage.getPerformanceStats()
    const environment = stage.getPerformanceEnvironment()
    const extensionStats = stage.getExtensionStats()
    stage.destroy()
    const smoke = { ready: true, renderedItems: stats.renderedItems, submittedItems: stats.submittedItems, extensions: stats.extensions, extensionStats: extensionStats.length, drawCalls: stats.drawCalls, contextLost: stats.contextLost, p95: stats.frameTimeP95, maxTextureSize: environment.maxTextureSize, destroyed: !container.querySelector('canvas') }
    document.documentElement.dataset.packageSmoke = smoke.destroyed ? 'passed' : 'failed'
    result.textContent = JSON.stringify(smoke)
  `)
  await writeFile(join(consumer, 'vite.stage.config.mjs'), `
    export default { build: { outDir: 'dist-stage', emptyOutDir: true, rollupOptions: { input: 'stage.html' } } }
  `)
  run(process.execPath, [
    join(root, 'node_modules/vite/bin/vite.js'),
    'build',
    '--config',
    'vite.stage.config.mjs',
  ], consumer)
  await stat(join(consumer, 'dist-stage/stage.html'))

  console.log(JSON.stringify({
    package: packageName,
    publishedFiles: dryRun.files.length,
    tarballBytes: dryRun.size,
    libraryJsBytes: jsBytes,
    libraryJsGzipBytes: jsGzipBytes,
    layoutConsumerBytes: Buffer.byteLength(consumerJs),
    consumerRuntime: 'passed',
    consumerTypes: 'passed',
    internalExportBoundary: 'passed',
    browserConsumerBuild: 'passed',
    keptConsumer: keepConsumer ? consumer : undefined,
  }, null, 2))
} finally {
  if (!keepConsumer) await rm(tempRoot, { recursive: true, force: true })
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  })
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
  return result.stdout.trim()
}

function parsePackResult(output) {
  const trimmed = output.trim()
  const jsonStart = trimmed.startsWith('[') ? 0 : trimmed.lastIndexOf('\n[') + 1
  assert(jsonStart >= 0 && trimmed.slice(jsonStart).startsWith('['), 'npm pack JSON result was not found')
  const result = JSON.parse(trimmed.slice(jsonStart))
  assert(Array.isArray(result) && result.length === 1, 'npm pack must return one package result')
  return result[0]
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  }))
  return files.flat()
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
