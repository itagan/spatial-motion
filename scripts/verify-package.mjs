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
      || file.path === 'LICENSE'
      || file.path.startsWith('dist/'),
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
    assert.equal(typeof effects.vortex, 'function')
    assert.equal(typeof performance.BenchmarkSession, 'function')
    await assert.rejects(
      import('${packageName}/renderers/InstancedCardRenderer'),
      (error) => error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    )
  `)
  run(process.execPath, ['runtime-check.mjs'], consumer)

  await writeFile(join(consumer, 'consumer.ts'), `
    import { type MotionItem, type MotionStage, sphere } from '${packageName}'
    import { box, ring } from '${packageName}/layouts'
    import { vortex } from '${packageName}/effects'
    import { BenchmarkSession } from '${packageName}/performance'
    const items: MotionItem[] = [{ id: 'one' }]
    const stage: MotionStage | undefined = undefined
    void [items, stage, sphere(), box(), ring(), vortex(), BenchmarkSession]
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
    import { MotionStage, sphere, type MotionItem } from '${packageName}'
    const container = document.querySelector<HTMLElement>('#stage')!
    const result = document.querySelector<HTMLElement>('#result')!
    const items: MotionItem[] = Array.from({ length: 12 }, (_, index) => ({ id: String(index), title: String(index) }))
    const stage = new MotionStage({ container, quality: 'low', adaptivePerformance: false })
    await stage.setItems(items)
    await stage.to(sphere({ radius: 3 }), { duration: 0 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const stats = stage.getPerformanceStats()
    stage.destroy()
    const smoke = { ready: true, renderedItems: stats.renderedItems, drawCalls: stats.drawCalls, destroyed: !container.querySelector('canvas') }
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
