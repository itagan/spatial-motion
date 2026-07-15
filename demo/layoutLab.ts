import {
  createLayout,
  parseLayoutConfig,
  type Layout,
  type LayoutConfig,
  type LayoutConfigType,
} from '@spatial-motion'

interface LayoutLabOptions {
  root: HTMLElement
  onApply(config: LayoutConfig, duration: number): void | Promise<unknown>
}

export interface LayoutLab {
  readonly currentType: LayoutConfigType
  getConfig(type: LayoutConfigType): LayoutConfig
  getLayout(type: LayoutConfigType): Layout
  select(type: LayoutConfigType): void
}

type Control =
  | { key: string; label: string; kind: 'number'; min: number; max: number; step: number; auto?: boolean }
  | { key: string; label: string; kind: 'boolean' }
  | { key: string; label: string; kind: 'select'; values: Array<{ value: string; label: string }> }

interface Definition {
  label: string
  controls: Control[]
  presets: Array<{ label: string; config: LayoutConfig }>
}

const initialConfigs: Record<LayoutConfigType, LayoutConfig> = {
  sphere: { version: 1, type: 'sphere', options: { radius: 5.2 } },
  box: { version: 1, type: 'box', options: { width: 8, height: 7, depth: 6 } },
  cylinder: { version: 1, type: 'cylinder', options: { radius: 5 } },
  grid: { version: 1, type: 'grid', options: { fit: 'contain' } },
  ring: { version: 1, type: 'ring', options: { innerRadius: 0.8, spacing: 0.42 } },
  helix: { version: 1, type: 'helix', options: { radius: 4.6, height: 9 } },
  cone: { version: 1, type: 'cone', options: { radius: 5, height: 9, stagger: true } },
  scatter: { version: 1, type: 'scatter', options: { direction: 'random', distance: 11, depth: 7, opacity: 0, layers: 5, seed: 31 } },
}

const resolvedDefaults: Record<LayoutConfigType, Record<string, unknown>> = {
  sphere: { radius: 5, rings: 2, stagger: false, density: 0.86, orientation: 'upright-surface' },
  box: { width: 8, height: 8, depth: 8, density: 0.82, orientation: 'surface' },
  cylinder: { radius: 5, spacing: 0.1, columns: 3 },
  grid: { columns: 1, gap: 1.3, fit: 'fixed' },
  ring: { innerRadius: 0.8, spacing: 0.42, rings: 1, startAngle: -Math.PI / 2, orientation: 'camera', density: 0.78 },
  helix: { radius: 4.6, height: 9, turns: 2, startAngle: 0, clockwise: false, orientation: 'surface', density: 0.8 },
  cone: { radius: 5, height: 9, rings: 2, startAngle: 0, stagger: false, orientation: 'upright-surface', density: 0.82 },
  scatter: { direction: 'random', distance: 10, depth: 6, spin: Math.PI * 2, spinMode: 'random', layers: 4, scale: 0.25, opacity: 0, seed: 2030 },
}

const angle = { min: -Math.PI, max: Math.PI, step: 0.05 }
const density = { min: 0.2, max: 1.2, step: 0.01 }
const orientation3d = [
  { value: 'camera', label: '始终朝向相机' },
  { value: 'surface', label: '贴合曲面' },
  { value: 'upright-surface', label: '曲面直立' },
]

const definitions: Record<LayoutConfigType, Definition> = {
  sphere: {
    label: '球体',
    controls: [
      { key: 'radius', label: '半径', kind: 'number', min: 0.5, max: 12, step: 0.1 },
      { key: 'rings', label: '纬度圆环数', kind: 'number', min: 2, max: 64, step: 1, auto: true },
      { key: 'density', label: '卡片密度', kind: 'number', ...density },
      { key: 'stagger', label: '交错排列', kind: 'boolean' },
      { key: 'orientation', label: '朝向', kind: 'select', values: orientation3d },
    ],
    presets: [
      { label: '经典球体', config: initialConfigs.sphere },
      { label: '密集交错', config: { version: 1, type: 'sphere', options: { radius: 5.5, rings: 22, density: 0.76, stagger: true, orientation: 'upright-surface' } } },
      { label: '相机朝向', config: { version: 1, type: 'sphere', options: { radius: 5.2, rings: 16, density: 0.82, orientation: 'camera' } } },
    ],
  },
  box: {
    label: '立方体 / 长方体',
    controls: [
      { key: 'width', label: '宽度', kind: 'number', min: 0.5, max: 16, step: 0.1 },
      { key: 'height', label: '高度', kind: 'number', min: 0.5, max: 16, step: 0.1 },
      { key: 'depth', label: '深度', kind: 'number', min: 0.5, max: 16, step: 0.1 },
      { key: 'density', label: '卡片密度', kind: 'number', ...density },
      { key: 'orientation', label: '朝向', kind: 'select', values: orientation3d.slice(0, 2) },
    ],
    presets: [
      { label: '标准立方体', config: initialConfigs.box },
      { label: '宽屏长方体', config: { version: 1, type: 'box', options: { width: 12, height: 7, depth: 4, density: 0.78, orientation: 'surface' } } },
    ],
  },
  cylinder: {
    label: '圆柱',
    controls: [
      { key: 'radius', label: '半径', kind: 'number', min: 0.5, max: 12, step: 0.1 },
      { key: 'spacing', label: '垂直间距', kind: 'number', min: 0.1, max: 3, step: 0.05, auto: true },
      { key: 'columns', label: '每圈列数', kind: 'number', min: 3, max: 128, step: 1, auto: true },
    ],
    presets: [
      { label: '自适应圆柱', config: initialConfigs.cylinder },
      { label: '宽间距圆柱', config: { version: 1, type: 'cylinder', options: { radius: 5.5, spacing: 0.85, columns: 32 } } },
    ],
  },
  grid: {
    label: '平面网格',
    controls: [
      { key: 'columns', label: '列数', kind: 'number', min: 1, max: 100, step: 1, auto: true },
      { key: 'gap', label: '固定间距', kind: 'number', min: 0.2, max: 3, step: 0.05 },
      { key: 'fit', label: '适配方式', kind: 'select', values: [
        { value: 'fixed', label: '固定尺寸' },
        { value: 'contain', label: '完整显示' },
        { value: 'cover', label: '铺满屏幕' },
      ] },
    ],
    presets: [
      { label: '完整显示', config: initialConfigs.grid },
      { label: '铺满屏幕', config: { version: 1, type: 'grid', options: { fit: 'cover' } } },
      { label: '固定网格', config: { version: 1, type: 'grid', options: { fit: 'fixed', columns: 20, gap: 1.1 } } },
    ],
  },
  ring: {
    label: '同心圆环',
    controls: [
      { key: 'innerRadius', label: '内半径', kind: 'number', min: 0, max: 10, step: 0.1 },
      { key: 'spacing', label: '环间距', kind: 'number', min: 0.1, max: 3, step: 0.02 },
      { key: 'rings', label: '圆环数', kind: 'number', min: 1, max: 40, step: 1, auto: true },
      { key: 'startAngle', label: '起始角度', kind: 'number', ...angle },
      { key: 'density', label: '卡片密度', kind: 'number', ...density },
      { key: 'orientation', label: '朝向', kind: 'select', values: [
        { value: 'camera', label: '朝向相机' },
        { value: 'tangent', label: '沿圆环切线' },
      ] },
    ],
    presets: [
      { label: '轨道圆环', config: initialConfigs.ring },
      { label: '切线圆环', config: { version: 1, type: 'ring', options: { innerRadius: 1, spacing: 0.5, rings: 12, orientation: 'tangent', density: 0.76 } } },
    ],
  },
  helix: {
    label: '螺旋',
    controls: [
      { key: 'radius', label: '半径', kind: 'number', min: 0, max: 12, step: 0.1 },
      { key: 'height', label: '高度', kind: 'number', min: 0, max: 20, step: 0.1 },
      { key: 'turns', label: '圈数', kind: 'number', min: 0.25, max: 12, step: 0.25, auto: true },
      { key: 'startAngle', label: '起始角度', kind: 'number', ...angle },
      { key: 'density', label: '卡片密度', kind: 'number', ...density },
      { key: 'clockwise', label: '顺时针', kind: 'boolean' },
      { key: 'orientation', label: '朝向', kind: 'select', values: orientation3d.slice(0, 2) },
    ],
    presets: [
      { label: '自适应螺旋', config: initialConfigs.helix },
      { label: '紧凑螺旋', config: { version: 1, type: 'helix', options: { radius: 3.8, height: 10, turns: 5, clockwise: true, density: 0.75 } } },
    ],
  },
  cone: {
    label: '圆锥',
    controls: [
      { key: 'radius', label: '底部半径', kind: 'number', min: 0.5, max: 12, step: 0.1 },
      { key: 'height', label: '高度', kind: 'number', min: 0.5, max: 20, step: 0.1 },
      { key: 'rings', label: '水平圆环数', kind: 'number', min: 2, max: 64, step: 1, auto: true },
      { key: 'startAngle', label: '起始角度', kind: 'number', ...angle },
      { key: 'density', label: '卡片密度', kind: 'number', ...density },
      { key: 'stagger', label: '交错排列', kind: 'boolean' },
      { key: 'orientation', label: '朝向', kind: 'select', values: orientation3d },
    ],
    presets: [
      { label: '交错圆锥', config: initialConfigs.cone },
      { label: '密集圆锥', config: { version: 1, type: 'cone', options: { radius: 5.5, height: 10, rings: 18, density: 0.78, stagger: true } } },
    ],
  },
  scatter: {
    label: '散开',
    controls: [
      { key: 'direction', label: '方向', kind: 'select', values: [
        { value: 'random', label: '随机云' },
        { value: 'radial', label: '径向爆炸' },
        { value: 'left', label: '向左' },
        { value: 'right', label: '向右' },
      ] },
      { key: 'distance', label: '距离', kind: 'number', min: 0.1, max: 30, step: 0.1 },
      { key: 'depth', label: '深度', kind: 'number', min: 0, max: 20, step: 0.1 },
      { key: 'spin', label: '旋转量', kind: 'number', min: 0, max: Math.PI * 4, step: 0.1 },
      { key: 'spinMode', label: '旋转方式', kind: 'select', values: [
        { value: 'random', label: '随机' },
        { value: 'directional', label: '跟随方向' },
      ] },
      { key: 'layers', label: '距离层数', kind: 'number', min: 1, max: 20, step: 1 },
      { key: 'scale', label: '目标缩放', kind: 'number', min: 0, max: 2, step: 0.05 },
      { key: 'opacity', label: '目标透明度', kind: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'seed', label: '随机种子', kind: 'number', min: -99999, max: 99999, step: 1 },
    ],
    presets: [
      { label: '随机云', config: initialConfigs.scatter },
      { label: '径向爆炸', config: { version: 1, type: 'scatter', options: { direction: 'radial', distance: 12, depth: 8, opacity: 0, spinMode: 'directional', layers: 6, seed: 32 } } },
      { label: '向右飞散', config: { version: 1, type: 'scatter', options: { direction: 'right', distance: 12, depth: 6, opacity: 0, spinMode: 'directional', layers: 5, seed: 33 } } },
    ],
  },
}

export function createLayoutLab({ root, onApply }: LayoutLabOptions): LayoutLab {
  const configs = new Map<LayoutConfigType, LayoutConfig>(
    Object.entries(initialConfigs).map(([type, config]) => [type as LayoutConfigType, cloneConfig(config)]),
  )
  let currentType: LayoutConfigType = 'sphere'
  let applyTimer = 0

  const typeSelect = requiredElement<HTMLSelectElement>(root, '#layout-lab-type')
  const presetSelect = requiredElement<HTMLSelectElement>(root, '#layout-lab-preset')
  const controlsRoot = requiredElement<HTMLElement>(root, '#layout-lab-controls')
  const transfer = requiredElement<HTMLTextAreaElement>(root, '#layout-lab-transfer')
  const status = requiredElement<HTMLElement>(root, '#layout-lab-status')

  typeSelect.innerHTML = Object.entries(definitions)
    .map(([type, definition]) => `<option value="${type}">${definition.label}</option>`)
    .join('')

  const setStatus = (message: string, error = false) => {
    status.textContent = message
    status.dataset.error = String(error)
  }

  const updateUrl = (config: LayoutConfig) => {
    const url = new URL(window.location.href)
    url.searchParams.set('layout', JSON.stringify(config))
    history.replaceState(null, '', url)
  }

  const clearUrl = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('layout')
    history.replaceState(null, '', url)
  }

  const apply = (duration: number, persist = true) => {
    window.clearTimeout(applyTimer)
    const config = cloneConfig(configs.get(currentType)!)
    if (persist) updateUrl(config)
    setStatus('配置已应用')
    void onApply(config, duration)
  }

  const scheduleApply = () => {
    window.clearTimeout(applyTimer)
    applyTimer = window.setTimeout(() => apply(300), 100)
  }

  const updateOption = (key: string, value: unknown) => {
    const config = cloneConfig(configs.get(currentType)!)
    const options = { ...(config.options as Record<string, unknown> | undefined) }
    if (value === undefined) delete options[key]
    else options[key] = value
    const parsed = parseLayoutConfig({ ...config, options })
    configs.set(currentType, parsed)
    presetSelect.value = ''
    scheduleApply()
  }

  const renderControls = () => {
    const definition = definitions[currentType]
    const config = configs.get(currentType)!
    const options = (config.options ?? {}) as Record<string, unknown>
    typeSelect.value = currentType
    presetSelect.innerHTML = [
      '<option value="">自定义配置</option>',
      ...definition.presets.map((preset, index) => `<option value="${index}">${preset.label}</option>`),
    ].join('')
    const matchedPreset = definition.presets.findIndex((preset) => JSON.stringify(preset.config) === JSON.stringify(config))
    presetSelect.value = matchedPreset >= 0 ? String(matchedPreset) : ''
    controlsRoot.replaceChildren()

    definition.controls.forEach((control) => {
      const row = document.createElement('div')
      row.className = 'layout-field'
      const label = document.createElement('label')
      label.textContent = control.label
      row.append(label)

      if (control.kind === 'boolean') {
        const input = document.createElement('input')
        input.type = 'checkbox'
        input.checked = (options[control.key] ?? resolvedDefaults[currentType][control.key]) === true
        input.setAttribute('aria-label', control.label)
        input.addEventListener('change', () => updateOption(control.key, input.checked))
        row.append(input)
      } else if (control.kind === 'select') {
        const select = document.createElement('select')
        select.setAttribute('aria-label', control.label)
        select.innerHTML = control.values.map(({ value, label: optionLabel }) =>
          `<option value="${value}">${optionLabel}</option>`).join('')
        select.value = String(options[control.key] ?? resolvedDefaults[currentType][control.key] ?? control.values[0].value)
        select.addEventListener('change', () => updateOption(control.key, select.value))
        row.append(select)
      } else {
        const editor = document.createElement('div')
        editor.className = 'layout-number'
        const range = document.createElement('input')
        range.type = 'range'
        range.min = String(control.min)
        range.max = String(control.max)
        range.step = String(control.step)
        const number = document.createElement('input')
        number.type = 'number'
        number.min = range.min
        number.max = range.max
        number.step = range.step
        const fallback = defaultControlValue(currentType, control.key, control.min)
        const value = typeof options[control.key] === 'number' ? options[control.key] as number : fallback
        range.value = String(value)
        number.value = String(value)
        range.setAttribute('aria-label', `${control.label}滑块`)
        number.setAttribute('aria-label', control.label)
        const commit = (next: string) => {
          const numeric = Number(next)
          if (!Number.isFinite(numeric)) return
          range.value = String(numeric)
          number.value = String(numeric)
          updateOption(control.key, numeric)
        }
        range.addEventListener('input', () => commit(range.value))
        number.addEventListener('input', () => commit(number.value))
        editor.append(range, number)

        if (control.auto) {
          const autoLabel = document.createElement('label')
          autoLabel.className = 'layout-auto'
          const auto = document.createElement('input')
          auto.type = 'checkbox'
          auto.checked = options[control.key] === undefined
          auto.setAttribute('aria-label', `${control.label}自动`)
          range.disabled = auto.checked
          number.disabled = auto.checked
          auto.addEventListener('change', () => {
            range.disabled = auto.checked
            number.disabled = auto.checked
            updateOption(control.key, auto.checked ? undefined : Number(number.value))
          })
          autoLabel.append(auto, document.createTextNode('自动'))
          editor.append(autoLabel)
        }
        row.append(editor)
      }
      controlsRoot.append(row)
    })
  }

  const select = (type: LayoutConfigType) => {
    currentType = type
    renderControls()
    apply(800)
  }

  typeSelect.addEventListener('change', () => select(typeSelect.value as LayoutConfigType))
  presetSelect.addEventListener('change', () => {
    if (presetSelect.value === '') return
    const preset = definitions[currentType].presets[Number(presetSelect.value)]
    configs.set(currentType, cloneConfig(preset.config))
    renderControls()
    apply(800)
  })
  requiredElement(root, '#layout-lab-reset').addEventListener('click', () => {
    configs.set(currentType, cloneConfig(initialConfigs[currentType]))
    renderControls()
    apply(800)
  })
  requiredElement(root, '#layout-lab-copy-json').addEventListener('click', () => {
    const value = JSON.stringify(configs.get(currentType), null, 2)
    transfer.value = value
    void copyText(value, transfer, setStatus)
  })
  requiredElement(root, '#layout-lab-copy-ts').addEventListener('click', () => {
    const value = `createLayout(${JSON.stringify(configs.get(currentType), null, 2)} satisfies LayoutConfig)`
    transfer.value = value
    void copyText(value, transfer, setStatus)
  })
  requiredElement(root, '#layout-lab-import').addEventListener('click', () => {
    try {
      const config = parseLayoutConfig(transfer.value)
      configs.set(config.type, config)
      currentType = config.type
      renderControls()
      apply(800)
      setStatus('JSON 已导入')
    } catch (error) {
      const fallbackType = inferConfigType(transfer.value) ?? currentType
      configs.set(fallbackType, cloneConfig(initialConfigs[fallbackType]))
      currentType = fallbackType
      renderControls()
      clearUrl()
      apply(800, false)
      setStatus(error instanceof Error ? error.message : '配置无效', true)
    }
  })

  const toggle = requiredElement<HTMLButtonElement>(document, '#layout-lab-toggle')
  toggle.addEventListener('click', () => {
    const open = root.dataset.open !== 'true'
    root.dataset.open = String(open)
    toggle.setAttribute('aria-expanded', String(open))
  })
  requiredElement(root, '#layout-lab-close').addEventListener('click', () => {
    root.dataset.open = 'false'
    toggle.setAttribute('aria-expanded', 'false')
  })

  const url = new URL(window.location.href)
  const encoded = url.searchParams.get('layout')
  if (encoded) {
    try {
      const config = parseLayoutConfig(encoded)
      configs.set(config.type, config)
      currentType = config.type
      setStatus('已恢复 URL 配置')
    } catch (error) {
      url.searchParams.delete('layout')
      history.replaceState(null, '', url)
      setStatus(error instanceof Error ? error.message : 'URL 配置无效', true)
    }
  }
  renderControls()

  return {
    get currentType() { return currentType },
    getConfig: (type) => cloneConfig(configs.get(type)!),
    getLayout: (type) => createLayout(configs.get(type)!),
    select,
  }
}

function defaultControlValue(type: LayoutConfigType, key: string, fallback: number): number {
  const config = initialConfigs[type]
  const value = (config.options as Record<string, unknown> | undefined)?.[key]
  const defaultValue = resolvedDefaults[type][key]
  return typeof value === 'number'
    ? value
    : typeof defaultValue === 'number' ? defaultValue : fallback
}

function cloneConfig(config: LayoutConfig): LayoutConfig {
  return parseLayoutConfig(JSON.parse(JSON.stringify(config)) as unknown)
}

function inferConfigType(value: string): LayoutConfigType | null {
  try {
    const parsed = JSON.parse(value) as { type?: unknown }
    return typeof parsed.type === 'string' && Object.hasOwn(definitions, parsed.type)
      ? parsed.type as LayoutConfigType
      : null
  } catch {
    return null
  }
}

async function copyText(
  value: string,
  fallback: HTMLTextAreaElement,
  status: (message: string, error?: boolean) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    status('已复制到剪贴板')
  } catch {
    fallback.focus()
    fallback.select()
    status('无法访问剪贴板，已选中文本', true)
  }
}

function requiredElement<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Layout lab element not found: ${selector}`)
  return element
}
