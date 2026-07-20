import type { MotionItem } from '@itagan/spatial-motion'

export interface LotteryParticipant {
  id: string
  name: string
  department: string
}

export interface Prize {
  id: string
  name: string
  label: string
  color: string
  defaultCount: number
}

export interface WinnerRecord {
  id: string
  participantId: string
  prizeId: string
  round: number
  drawnAt: string
}

export interface PersistedLotteryState {
  version: 1
  participants: LotteryParticipant[]
  history: WinnerRecord[]
  selectedPrizeId: string
  drawCount: number
}

export const prizes: Prize[] = [
  { id: 'grand', name: '特等奖', label: 'GRAND PRIZE', color: '#ffe6a3', defaultCount: 1 },
  { id: 'first', name: '一等奖', label: 'FIRST PRIZE', color: '#ffbd73', defaultCount: 1 },
  { id: 'second', name: '二等奖', label: 'SECOND PRIZE', color: '#89d8ff', defaultCount: 3 },
  { id: 'lucky', name: '幸运奖', label: 'LUCKY PRIZE', color: '#b7a5ff', defaultCount: 5 },
]

const familyNames = ['赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '尤', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜']
const givenNames = ['子墨', '一诺', '宇轩', '若曦', '思远', '嘉怡', '明哲', '雨桐', '浩然', '诗涵', '景行', '安然', '星辰', '知夏', '向阳', '可欣', '博文', '清越', '晨曦', '亦凡']
const departments = ['产品中心', '技术中心', '设计中心', '市场中心', '客户成功', '运营中心', '财务中心', '综合管理']

export function createParticipants(count: number): LotteryParticipant[] {
  const safeCount = Math.min(2_000, Math.max(10, Math.floor(count)))
  return Array.from({ length: safeCount }, (_, index) => ({
    id: `guest-${String(index + 1).padStart(4, '0')}`,
    name: `${familyNames[index % familyNames.length]}${givenNames[Math.floor(index / familyNames.length) % givenNames.length]}`,
    department: departments[index % departments.length],
  }))
}

export function parseParticipants(text: string): LotteryParticipant[] {
  const rows = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/[,\t，]/).map((cell) => cell.trim()))

  if (rows[0]?.[0] && /^(姓名|name)$/i.test(rows[0][0])) rows.shift()
  const participants = rows
    .filter(([name]) => Boolean(name))
    .slice(0, 2_000)
    .map(([name, department], index) => ({
      id: `import-${String(index + 1).padStart(4, '0')}`,
      name,
      department: department || '现场嘉宾',
    }))

  if (participants.length < 2) throw new Error('名单至少需要两位参与者')
  return participants
}

export function pickParticipants(
  participants: LotteryParticipant[],
  count: number,
): LotteryParticipant[] {
  const pool = [...participants]
  const selectedCount = Math.min(pool.length, Math.max(1, Math.floor(count)))
  for (let index = 0; index < selectedCount; index += 1) {
    const target = index + secureRandomInt(pool.length - index)
    ;[pool[index], pool[target]] = [pool[target], pool[index]]
  }
  return pool.slice(0, selectedCount)
}

export function toMotionItem(
  participant: LotteryParticipant,
  winner?: { prize: Prize; round: number },
): MotionItem {
  return {
    id: participant.id,
    title: participant.name,
    meta: {
      department: participant.department,
      prizeName: winner?.prize.name,
      prizeColor: winner?.prize.color,
      round: winner?.round,
    },
  }
}

export function loadLotteryState(key: string): PersistedLotteryState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const state = value as Partial<PersistedLotteryState>
    if (state.version !== 1 || !Array.isArray(state.participants) || !Array.isArray(state.history)) return null
    const participants = state.participants.filter(isParticipant).slice(0, 2_000)
    if (participants.length < 2) return null
    const participantIds = new Set(participants.map(({ id }) => id))
    const prizeIds = new Set(prizes.map(({ id }) => id))
    return {
      version: 1,
      participants,
      history: state.history.filter((record) => isWinnerRecord(record)
        && participantIds.has(record.participantId)
        && prizeIds.has(record.prizeId)),
      selectedPrizeId: typeof state.selectedPrizeId === 'string' && prizeIds.has(state.selectedPrizeId)
        ? state.selectedPrizeId
        : prizes[0].id,
      drawCount: Number.isFinite(state.drawCount)
        ? Math.min(participants.length, Math.max(1, Math.floor(state.drawCount as number)))
        : 1,
    }
  } catch {
    return null
  }
}

function isParticipant(value: unknown): value is LotteryParticipant {
  if (!value || typeof value !== 'object') return false
  const participant = value as Partial<LotteryParticipant>
  return typeof participant.id === 'string'
    && participant.id.length > 0
    && typeof participant.name === 'string'
    && participant.name.length > 0
    && typeof participant.department === 'string'
}

function isWinnerRecord(value: unknown): value is WinnerRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<WinnerRecord>
  return typeof record.id === 'string'
    && typeof record.participantId === 'string'
    && typeof record.prizeId === 'string'
    && Number.isInteger(record.round)
    && typeof record.drawnAt === 'string'
}

function secureRandomInt(max: number): number {
  if (max <= 1) return 0
  const range = 0x1_0000_0000
  const limit = range - (range % max)
  const value = new Uint32Array(1)
  do crypto.getRandomValues(value)
  while (value[0] >= limit)
  return value[0] % max
}
