<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  MotionStage,
  cardsRenderer,
  radialBurst,
  sphere,
  tunnel,
  vortex,
  type MotionItem,
} from '@itagan/spatial-motion'
import avatarAtlasUrl from './assets/avatar-atlas.jpg'
import {
  createParticipantTemplateCsv,
  createWinnerHistoryCsv,
  createParticipants,
  loadLotteryState,
  parseParticipants,
  pickParticipants,
  prizes,
  saveLotteryState,
  toMotionItem,
  type LotteryParticipant,
  type PersistedLotteryState,
  type Prize,
  type WinnerRecord,
} from './lottery'

type DrawPhase = 'idle' | 'drawing' | 'revealing'
type DrawEffectId = 'sphere' | 'vortex' | 'tunnel'

interface DrawEffectOption {
  id: DrawEffectId
  name: string
  label: string
  icon: string
}

const drawEffects: DrawEffectOption[] = [
  { id: 'sphere', name: '旋转球体', label: 'SPHERE', icon: '●' },
  { id: 'vortex', name: '幸运漩涡', label: 'VORTEX', icon: '◎' },
  { id: 'tunnel', name: '时空隧道', label: 'TUNNEL', icon: '◇' },
]
const avatarAtlas = loadAvatarAtlas(avatarAtlasUrl)

const storageKey = 'spatial-motion:lottery-screen:v1'
const savedState = loadLotteryState(storageKey)
const stageElement = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const participants = ref<LotteryParticipant[]>(savedState?.participants ?? createParticipants(320))
const history = ref<WinnerRecord[]>(savedState?.history ?? [])
const selectedPrizeId = ref(savedState?.selectedPrizeId ?? prizes[0].id)
const drawCount = ref(savedState?.drawCount ?? prizes[0].defaultCount)
const selectedDrawEffectId = ref<DrawEffectId>('vortex')
const generatedCount = ref(participants.value.length)
const phase = ref<DrawPhase>('idle')
const currentWinners = ref<LotteryParticipant[]>([])
const message = ref('名单已就绪，按空格开始抽奖')
const fps = ref(0)
const drawCalls = ref(0)
const quality = ref('AUTO')
const isFullscreen = ref(false)
const stageReady = ref(false)
const autoSaveAvailable = ref(true)
const effectParticles = Array.from({ length: 24 }, (_, index) => index)

let stage: MotionStage | null = null
let statusTimer = 0
let operation = 0

const selectedPrize = computed(() => prizes.find(({ id }) => id === selectedPrizeId.value) ?? prizes[0])
const selectedDrawEffect = computed(() => drawEffects.find(({ id }) => id === selectedDrawEffectId.value) ?? drawEffects[0])
const drawingHeadline = computed(() => ({
  sphere: 'LUCK IN ORBIT',
  vortex: 'LUCK IS MOVING',
  tunnel: 'THROUGH THE STARS',
})[selectedDrawEffectId.value])
const winnerIds = computed(() => new Set(history.value.map(({ participantId }) => participantId)))
const eligibleParticipants = computed(() => participants.value.filter(({ id }) => !winnerIds.value.has(id)))
const historyNewestFirst = computed(() => [...history.value].reverse())
const nextRound = computed(() => history.value.reduce((maximum, record) => Math.max(maximum, record.round), 0) + 1)
const canStart = computed(() => stageReady.value && eligibleParticipants.value.length > 0 && drawCount.value > 0)

watch([eligibleParticipants, drawCount], ([eligible, count]) => {
  const normalized = Math.min(Math.max(1, eligible.length), Math.max(1, Number.isFinite(count) ? Math.floor(count) : 1))
  if (drawCount.value !== normalized) drawCount.value = normalized
}, { immediate: true })
watch([participants, history, selectedPrizeId, drawCount], persistState, { deep: true, immediate: true })

onMounted(async () => {
  if (!stageElement.value) return
  stage = new MotionStage({
    container: stageElement.value,
    quality: 'auto',
    adaptivePerformance: true,
    cameraZ: 18,
    transition: { duration: 900 },
    motionPreference: 'auto',
    renderer: cardsRenderer({
      resolution: 96,
      style: {
        shape: 'rounded',
        cornerRadius: 7,
        borderWidth: 1,
        borderColor: 'rgba(255, 244, 218, .46)',
        backgroundColor: '#11101b',
      },
      draw: drawParticipantCard,
    }),
    ariaLabel: '抽奖参与者空间舞台',
    keyboardNavigation: false,
    onQualityChange(level) {
      quality.value = level.toUpperCase()
    },
  })

  await stage.setItems(motionItems())
  await stage.to(stageLayout(), { duration: 0 })
  stage.autoRotate({ y: 0.18 })
  stageReady.value = true
  statusTimer = window.setInterval(updatePerformance, 500)
  updatePerformance()
  window.addEventListener('keydown', handleKeyboard)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  window.addEventListener('pagehide', destroyStage, { once: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyboard)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  window.removeEventListener('pagehide', destroyStage)
  destroyStage()
})

function stageLayout() {
  const radius = Math.min(6.05, 5.45 + Math.sqrt(participants.value.length) / 60)
  return sphere({
    radius,
    distribution: 'latitude',
    poleMode: 'exclude',
    stagger: true,
    density: 0.92,
    orientation: 'surface',
  })
}

function winnerRecordFor(id: string): WinnerRecord | undefined {
  return history.value.find((record) => record.participantId === id)
}

function motionItems(order = participants.value): MotionItem[] {
  return order.map((participant) => {
    const record = winnerRecordFor(participant.id)
    const prize = record ? prizes.find(({ id }) => id === record.prizeId) : undefined
    return toMotionItem(participant, prize && record ? { prize, round: record.round } : undefined)
  })
}

async function startDraw(): Promise<void> {
  if (!stage || !canStart.value || phase.value === 'drawing') return
  const currentOperation = ++operation
  currentWinners.value = []
  phase.value = 'drawing'
  message.value = `${selectedPrize.value.name} · ${selectedDrawEffect.value.name}正在运行 · 再按空格停止`
  playCue('start')

  await stage.updateItems(motionItems(), { layout: stageLayout(), duration: 420 })
  if (!stage || currentOperation !== operation || phase.value !== 'drawing') return
  await enterSelectedDrawEffect(currentOperation)
}

async function enterSelectedDrawEffect(currentOperation: number): Promise<void> {
  if (!stage || currentOperation !== operation || phase.value !== 'drawing') return
  const seed = nextRound.value * 97

  if (selectedDrawEffectId.value === 'sphere') {
    stage.autoRotate({ x: 0.025, y: 0.52 })
    await stage.to(sphere({
      radius: Math.min(6.2, 5.58 + Math.sqrt(participants.value.length) / 60),
      distribution: 'latitude',
      poleMode: 'exclude',
      stagger: true,
      density: 0.94,
      orientation: 'surface',
    }), { duration: 760 })
    return
  }

  stage.autoRotate({ y: 0.08 })
  if (selectedDrawEffectId.value === 'tunnel') {
    await stage.enterEffect(tunnel({
      speed: 0.22,
      twist: 0.16,
      innerRadius: 0.3,
      outerRadius: 5.8,
      nearZ: 8,
      farZ: -16,
      maxActiveItems: 360,
      seed,
      crossSection: 'circle',
    }), { duration: 700 })
    return
  }

  await stage.enterEffect(vortex({
    speed: 0.24,
    turns: 3.2,
    outerRadius: 6.4,
    nearZ: 6,
    farZ: -10,
    maxActiveItems: 360,
    seed,
  }), { duration: 680 })
}

async function stopDraw(): Promise<void> {
  if (!stage || phase.value !== 'drawing') return
  ++operation
  const count = Math.min(drawCount.value, eligibleParticipants.value.length)
  const winners = pickParticipants(eligibleParticipants.value, count)
  const round = nextRound.value
  const drawnAt = new Date().toISOString()
  const records = winners.map((participant, index): WinnerRecord => ({
    id: `${round}-${participant.id}-${index}`,
    participantId: participant.id,
    prizeId: selectedPrize.value.id,
    round,
    drawnAt,
  }))

  history.value.push(...records)
  currentWinners.value = winners
  phase.value = 'revealing'
  stage.autoRotate({ y: 0.12 })
  message.value = `第 ${round} 轮揭晓 · ${selectedPrize.value.name}`
  persistState()
  playCue('reveal')

  const selected = new Set(winners.map(({ id }) => id))
  const revealOrder = [...winners, ...participants.value.filter(({ id }) => !selected.has(id))]
  await stage.updateItems(motionItems(revealOrder), { layout: stageLayout(), duration: 360 })
  if (!stage || phase.value !== 'revealing') return
  await stage.enterEffect(radialBurst({
    sourceRadius: 0.08,
    outerRadius: 7.4,
    speed: 0.16,
    z: 1.6,
    startScale: 0.16,
    endScale: 0.78,
    maxActiveItems: 220,
    seed: round * 131,
  }), { duration: 260 })
  if (!stage || phase.value !== 'revealing') return
  await stage.focusItems(winners.map(({ id }) => id), {
    duration: 860,
    columns: Math.ceil(Math.sqrt(winners.length)),
    gap: winners.length === 1 ? 0 : 1.72,
    scale: winners.length === 1 ? 1.72 : winners.length <= 4 ? 1.28 : 1.02,
    z: 6.7,
    dimOpacity: 0.018,
  })
}

function toggleDraw(): void {
  if (phase.value === 'drawing') void stopDraw()
  else void startDraw()
}

async function dismissWinners(): Promise<void> {
  if (!stage || phase.value === 'drawing') return
  ++operation
  currentWinners.value = []
  phase.value = 'idle'
  message.value = '准备下一轮 · 按空格开始'
  await stage.updateItems(motionItems(), { layout: stageLayout(), duration: 680 })
  stage.autoRotate({ y: 0.18 })
}

async function undoLastRound(startAgain = false): Promise<void> {
  if (!stage || phase.value === 'drawing' || history.value.length === 0) return
  const lastRound = Math.max(...history.value.map(({ round }) => round))
  history.value = history.value.filter(({ round }) => round !== lastRound)
  currentWinners.value = []
  phase.value = 'idle'
  ++operation
  persistState()
  message.value = `已撤销第 ${lastRound} 轮`
  await stage.updateItems(motionItems(), { layout: stageLayout(), duration: 560 })
  stage.autoRotate({ y: 0.18 })
  if (startAgain) await startDraw()
}

async function resetHistory(): Promise<void> {
  if (!stage || phase.value === 'drawing' || history.value.length === 0) return
  if (!window.confirm('确定清空全部中奖记录吗？此操作不能撤销。')) return
  history.value = []
  currentWinners.value = []
  phase.value = 'idle'
  ++operation
  persistState()
  message.value = '中奖记录已清空'
  await stage.updateItems(motionItems(), { layout: stageLayout(), duration: 560 })
  stage.autoRotate({ y: 0.18 })
}

async function regenerateParticipants(): Promise<void> {
  if (phase.value === 'drawing') return
  if (history.value.length && !window.confirm('生成新名单会清空现有中奖记录，是否继续？')) return
  await applyParticipantList(createParticipants(generatedCount.value))
  message.value = `已生成 ${participants.value.length} 位示例参与者`
}

async function importParticipantFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || phase.value === 'drawing') return
  try {
    const next = parseParticipants(await file.text())
    if (history.value.length && !window.confirm('导入新名单会清空现有中奖记录，是否继续？')) return
    await applyParticipantList(next)
    message.value = `已导入 ${next.length} 位参与者`
  } catch (error) {
    message.value = error instanceof Error ? error.message : '名单导入失败'
  }
}

async function applyParticipantList(next: LotteryParticipant[]): Promise<void> {
  if (!stage) return
  ++operation
  participants.value = next
  generatedCount.value = next.length
  history.value = []
  currentWinners.value = []
  phase.value = 'idle'
  persistState()
  await stage.updateItems(motionItems(), { layout: stageLayout(), duration: 620 })
  stage.autoRotate({ y: 0.18 })
}

function selectPrize(prize: Prize): void {
  if (phase.value === 'drawing') return
  selectedPrizeId.value = prize.id
  drawCount.value = Math.min(prize.defaultCount, Math.max(1, eligibleParticipants.value.length))
}

function selectDrawEffect(effect: DrawEffectOption): void {
  if (phase.value === 'drawing') return
  selectedDrawEffectId.value = effect.id
  message.value = `已选择${effect.name}效果 · 按空格开始`
}

function prizeWinnerCount(prizeId: string): number {
  return history.value.filter((record) => record.prizeId === prizeId).length
}

function participantById(id: string): LotteryParticipant | undefined {
  return participants.value.find((participant) => participant.id === id)
}

function prizeById(id: string): Prize | undefined {
  return prizes.find((prize) => prize.id === id)
}

function persistState(): void {
  const state: PersistedLotteryState = {
    version: 1,
    participants: participants.value,
    history: history.value,
    selectedPrizeId: selectedPrizeId.value,
    drawCount: drawCount.value,
  }
  autoSaveAvailable.value = saveLotteryState(storageKey, state)
}

function exportWinnerHistory(): void {
  if (!history.value.length) return
  const csv = createWinnerHistoryCsv(history.value.map((record) => {
    const participant = participantById(record.participantId)
    return {
      round: record.round,
      prize: prizeById(record.prizeId)?.name ?? '未知奖项',
      name: participant?.name ?? '未知参与者',
      department: participant?.department ?? '',
      drawnAt: new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date(record.drawnAt)),
    }
  }))
  downloadCsv(csv, `中奖记录-${new Date().toISOString().slice(0, 10)}.csv`)
  message.value = `已导出 ${history.value.length} 条中奖记录`
}

function downloadParticipantTemplate(): void {
  downloadCsv(createParticipantTemplateCsv(), '参与者名单模板.csv')
  message.value = '名单模板已下载'
}

function downloadCsv(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function updatePerformance(): void {
  if (!stage) return
  const stats = stage.getPerformanceStats()
  fps.value = stats.fps
  drawCalls.value = stats.render.drawCalls
  quality.value = stats.qualityMode.toUpperCase()
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch {
    message.value = '浏览器未允许进入全屏，请检查页面权限'
  }
}

function handleFullscreenChange(): void {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

function handleKeyboard(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, select, textarea, button, a, summary, [contenteditable]:not([contenteditable="false"])')) return
  if (event.code === 'Space') {
    event.preventDefault()
    toggleDraw()
  } else if (event.key === 'Escape' && phase.value === 'revealing') {
    void dismissWinners()
  } else if (event.key.toLowerCase() === 'f') {
    void toggleFullscreen()
  } else if (event.key.toLowerCase() === 'u') {
    void undoLastRound()
  }
}

async function drawParticipantCard(
  context: CanvasRenderingContext2D,
  item: MotionItem,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const meta = item.meta as { department?: string; prizeName?: string; prizeColor?: string } | undefined
  const winner = Boolean(meta?.prizeName)
  const image = await avatarAtlas
  if (image) {
    const columns = 6
    const tile = hash(item.id) % (columns * columns)
    const sourceWidth = image.naturalWidth / columns
    const sourceHeight = image.naturalHeight / columns
    context.drawImage(
      image,
      (tile % columns) * sourceWidth,
      Math.floor(tile / columns) * sourceHeight,
      sourceWidth,
      sourceHeight,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
    )
  } else {
    drawFallbackAvatar(context, item, bounds)
  }

  if (winner) {
    context.fillStyle = 'rgba(255, 194, 80, .2)'
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
    context.strokeStyle = meta?.prizeColor ?? '#ffe6a3'
    context.lineWidth = Math.max(2, bounds.width * .045)
    context.strokeRect(3, 3, bounds.width - 6, bounds.height - 6)
  }
}

function drawFallbackAvatar(
  context: CanvasRenderingContext2D,
  item: MotionItem,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  const hue = hash(item.id) % 360
  const gradient = context.createLinearGradient(bounds.x, bounds.y, bounds.width, bounds.height)
  gradient.addColorStop(0, `hsl(${hue} 58% 49%)`)
  gradient.addColorStop(1, `hsl(${(hue + 48) % 360} 56% 18%)`)
  context.fillStyle = gradient
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
  context.fillStyle = 'rgba(255,255,255,.92)'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `800 ${bounds.width * .22}px system-ui, sans-serif`
  context.fillText((item.title ?? item.id).slice(-2), bounds.width / 2, bounds.height / 2)
}

function loadAvatarAtlas(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener('error', () => resolve(null), { once: true })
    image.src = source
  })
}

function hash(value: string): number {
  let result = 0
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) >>> 0
  return result
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function playCue(type: 'start' | 'reveal'): void {
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return
  const audio = new AudioContextClass()
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  oscillator.type = type === 'start' ? 'sine' : 'triangle'
  oscillator.frequency.setValueAtTime(type === 'start' ? 220 : 520, audio.currentTime)
  oscillator.frequency.exponentialRampToValueAtTime(type === 'start' ? 360 : 880, audio.currentTime + 0.22)
  gain.gain.setValueAtTime(0.0001, audio.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.06, audio.currentTime + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.28)
  oscillator.connect(gain).connect(audio.destination)
  oscillator.start()
  oscillator.stop(audio.currentTime + 0.3)
  oscillator.addEventListener('ended', () => void audio.close(), { once: true })
}

function destroyStage(): void {
  window.clearInterval(statusTimer)
  stage?.destroy()
  stage = null
  stageReady.value = false
}
</script>

<template>
  <main
    class="lottery-shell"
    :data-phase="phase"
    :data-effect="selectedDrawEffectId"
    :style="{ '--active-prize': selectedPrize.color }"
  >
    <div class="ambient ambient-one"></div>
    <div class="ambient ambient-two"></div>

    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">SM</span>
        <div>
          <p class="eyebrow">SPATIAL MOTION · LIVE EVENT</p>
          <h1>星耀盛典 · 幸运抽奖</h1>
        </div>
      </div>
      <div class="runtime">
        <span><i class="live-dot"></i>{{ phase === 'drawing' ? 'DRAWING' : 'SYSTEM READY' }}</span>
        <span>{{ fps.toFixed(0) }} FPS</span>
        <span>{{ drawCalls }} DRAW CALL</span>
        <span>{{ quality }}</span>
        <button class="icon-button" type="button" :aria-label="isFullscreen ? '退出全屏' : '进入全屏'" @click="toggleFullscreen">
          {{ isFullscreen ? '收起' : '全屏' }}
        </button>
      </div>
    </header>

    <section class="workspace">
      <aside class="control-panel glass-panel">
        <div class="panel-heading">
          <div><p class="eyebrow">CONTROL DESK</p><h2>抽奖控制台</h2></div>
          <span class="round-chip">ROUND {{ nextRound.toString().padStart(2, '0') }}</span>
        </div>

        <section class="control-section">
          <div class="section-title"><span>选择奖项</span><small>{{ history.length }} 人已中奖</small></div>
          <div class="prize-list">
            <button
              v-for="prize in prizes"
              :key="prize.id"
              class="prize-option"
              :class="{ active: selectedPrizeId === prize.id }"
              :style="{ '--prize-color': prize.color }"
              type="button"
              :disabled="phase === 'drawing'"
              @click="selectPrize(prize)"
            >
              <i></i><span><strong>{{ prize.name }}</strong><small>{{ prize.label }}</small></span>
              <b>{{ prizeWinnerCount(prize.id) }}</b>
            </button>
          </div>
        </section>

        <section class="control-section effect-section">
          <div class="section-title"><span>抽取效果</span><small>{{ selectedDrawEffect.label }}</small></div>
          <div class="effect-picker">
            <button
              v-for="effect in drawEffects"
              :key="effect.id"
              type="button"
              :class="{ active: selectedDrawEffectId === effect.id }"
              :disabled="phase === 'drawing'"
              :aria-pressed="selectedDrawEffectId === effect.id"
              @click="selectDrawEffect(effect)"
            >
              <i>{{ effect.icon }}</i>
              <span>{{ effect.name }}</span>
            </button>
          </div>
        </section>

        <section class="control-section draw-settings">
          <div class="section-title"><span>本轮人数</span><small>剩余 {{ eligibleParticipants.length }}</small></div>
          <div class="number-control">
            <button type="button" :disabled="phase === 'drawing' || drawCount <= 1" @click="drawCount -= 1">−</button>
            <input v-model.number="drawCount" type="number" min="1" :max="Math.max(1, eligibleParticipants.length)" :disabled="phase === 'drawing'" aria-label="本轮中奖人数" />
            <button type="button" :disabled="phase === 'drawing' || drawCount >= eligibleParticipants.length" @click="drawCount += 1">＋</button>
          </div>
        </section>

        <button class="draw-button" :class="{ stop: phase === 'drawing' }" type="button" :disabled="phase !== 'drawing' && !canStart" @click="toggleDraw">
          <span class="draw-button-icon">{{ phase === 'drawing' ? '■' : '✦' }}</span>
          <span><strong>{{ phase === 'drawing' ? '停止并揭晓' : '开始抽奖' }}</strong><small>{{ phase === 'drawing' ? 'STOP & REVEAL' : 'PRESS SPACE TO START' }}</small></span>
        </button>

        <div class="action-row">
          <button type="button" :disabled="phase === 'drawing' || !history.length" @click="undoLastRound()">撤销上一轮</button>
          <button type="button" :disabled="phase === 'drawing' || !history.length" @click="undoLastRound(true)">重新抽取</button>
          <button type="button" :disabled="phase === 'drawing' || !history.length" @click="resetHistory">清空记录</button>
        </div>

        <details class="data-tools">
          <summary>参与者名单 · {{ participants.length }} 人</summary>
          <div class="data-tools-body">
            <label>生成示例人数<input v-model.number="generatedCount" type="number" min="10" max="2000" /></label>
            <button type="button" :disabled="phase === 'drawing'" @click="regenerateParticipants">重新生成</button>
            <button type="button" :disabled="phase === 'drawing'" @click="fileInput?.click()">导入 CSV / TSV</button>
            <button class="template-button" type="button" :disabled="phase === 'drawing'" @click="downloadParticipantTemplate">下载名单模板</button>
            <input ref="fileInput" class="visually-hidden" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" @change="importParticipantFile" />
            <p>支持逗号或制表符分隔、标准 CSV 引号；最多 2000 人。</p>
          </div>
        </details>
      </aside>

      <section class="stage-frame">
        <div class="stage-grid"></div>
        <div ref="stageElement" class="motion-stage"></div>
        <div class="stage-vignette"></div>
        <div class="stage-ceremony" aria-hidden="true">
          <div class="ceremony-halo"></div>
          <div class="ceremony-ring ceremony-ring-one"></div>
          <div class="ceremony-ring ceremony-ring-two"></div>
          <div class="ceremony-scan"></div>
          <span
            v-for="particle in effectParticles"
            :key="particle"
            class="ceremony-particle"
            :style="{
              '--particle-index': particle,
              '--particle-angle': `${particle * 15}deg`,
              '--particle-delay': `${(particle % 8) * -0.17}s`,
            }"
          ></span>
        </div>
        <div class="reveal-flash" aria-hidden="true"></div>
        <div class="stage-status" aria-hidden="true">
          <span>R{{ nextRound.toString().padStart(2, '0') }}</span>
          <i></i>
          <span>{{ selectedPrize.label }} · {{ selectedDrawEffect.label }}</span>
        </div>
        <div class="stage-copy" :class="{ compact: phase !== 'idle' }">
          <p>{{ selectedPrize.label }}</p>
          <h2 v-if="phase === 'idle'">{{ selectedPrize.name }}</h2>
          <h2 v-else-if="phase === 'drawing'" class="drawing-title">{{ drawingHeadline }}</h2>
          <h2 v-else>CONGRATULATIONS</h2>
          <span role="status" aria-live="polite">{{ message }}</span>
        </div>

        <Transition name="winner">
          <div v-if="phase === 'revealing' && currentWinners.length" class="winner-overlay" aria-live="polite">
            <p class="winner-kicker">{{ selectedPrize.name }} · WINNER</p>
            <div class="winner-names" :class="{ multiple: currentWinners.length > 1 }">
              <article v-for="(participant, index) in currentWinners" :key="participant.id">
                <i>{{ String(index + 1).padStart(2, '0') }}</i>
                <span>{{ participant.department }}</span>
                <strong>{{ participant.name }}</strong>
                <small>{{ selectedPrize.label }}</small>
              </article>
            </div>
            <button type="button" @click="dismissWinners">继续下一轮 <span>↗</span></button>
          </div>
        </Transition>

        <div class="stage-footer">
          <span><i></i>{{ eligibleParticipants.length }} ELIGIBLE</span>
          <span>SPACE 开始 / 停止</span>
          <span>ESC 返回阵列</span>
          <span>F 全屏</span>
        </div>
      </section>

      <aside class="history-panel glass-panel">
        <div class="panel-heading history-heading">
          <div><p class="eyebrow">WINNER LOG</p><h2>中奖记录</h2></div>
          <div class="history-actions">
            <button type="button" :disabled="!history.length" @click="exportWinnerHistory">导出 CSV</button>
            <span class="history-count">{{ history.length }}</span>
          </div>
        </div>
        <div v-if="historyNewestFirst.length" class="history-list">
          <article v-for="record in historyNewestFirst" :key="record.id" class="history-item">
            <span class="winner-avatar">{{ participantById(record.participantId)?.name.slice(-2) }}</span>
            <div>
              <strong>{{ participantById(record.participantId)?.name ?? '未知参与者' }}</strong>
              <small>{{ participantById(record.participantId)?.department }}</small>
            </div>
            <div class="history-meta">
              <b :style="{ color: prizeById(record.prizeId)?.color }">{{ prizeById(record.prizeId)?.name }}</b>
              <small>R{{ record.round }} · {{ formatTime(record.drawnAt) }}</small>
            </div>
          </article>
        </div>
        <div v-else class="empty-history">
          <span>✦</span>
          <strong>等待幸运揭晓</strong>
          <p>中奖记录会自动保存在本机</p>
        </div>
        <footer>
          <span>{{ autoSaveAvailable ? '本地自动保存' : '本地存储不可用' }}</span>
          <i></i>
          <span>设备随机源</span>
        </footer>
      </aside>
    </section>
  </main>
</template>
