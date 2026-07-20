import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createParticipants,
  loadLotteryState,
  parseParticipants,
  pickParticipants,
  prizes,
  toMotionItem,
} from './lottery'

afterEach(() => vi.unstubAllGlobals())

describe('lottery screen data model', () => {
  it('generates a bounded list with stable unique ids', () => {
    const minimum = createParticipants(1)
    const maximum = createParticipants(5_000)

    expect(minimum).toHaveLength(10)
    expect(maximum).toHaveLength(2_000)
    expect(new Set(maximum.map(({ id }) => id)).size).toBe(2_000)
  })

  it('parses comma and tab separated participant lists', () => {
    const participants = parseParticipants('姓名,部门\n林一,产品中心\n陈曦\t技术中心')

    expect(participants).toEqual([
      { id: 'import-0001', name: '林一', department: '产品中心' },
      { id: 'import-0002', name: '陈曦', department: '技术中心' },
    ])
    expect(() => parseParticipants('只有一个人')).toThrow('至少需要两位')
  })

  it('selects unique winners without changing the source pool', () => {
    const participants = createParticipants(40)
    const winners = pickParticipants(participants, 8)

    expect(winners).toHaveLength(8)
    expect(new Set(winners.map(({ id }) => id)).size).toBe(8)
    expect(participants).toHaveLength(40)
    winners.forEach((winner) => expect(participants).toContainEqual(winner))
  })

  it('maps winner metadata without leaking business fields into the core type', () => {
    const participant = createParticipants(10)[0]
    const item = toMotionItem(participant, { prize: prizes[0], round: 3 })

    expect(item.id).toBe(participant.id)
    expect(item.meta).toEqual({
      department: participant.department,
      prizeName: '特等奖',
      prizeColor: '#ffe6a3',
      round: 3,
    })
  })

  it('filters stale local winner records and clamps restored draw counts', () => {
    const participants = createParticipants(10)
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({
        version: 1,
        participants,
        history: [
          { id: 'valid', participantId: participants[0].id, prizeId: 'grand', round: 1, drawnAt: '2026-07-20T00:00:00.000Z' },
          { id: 'stale-person', participantId: 'missing', prizeId: 'grand', round: 2, drawnAt: '2026-07-20T00:00:00.000Z' },
          { id: 'stale-prize', participantId: participants[1].id, prizeId: 'missing', round: 2, drawnAt: '2026-07-20T00:00:00.000Z' },
        ],
        selectedPrizeId: 'missing',
        drawCount: 99,
      }),
    })

    const state = loadLotteryState('test')
    expect(state?.history.map(({ id }) => id)).toEqual(['valid'])
    expect(state?.selectedPrizeId).toBe('grand')
    expect(state?.drawCount).toBe(10)
  })
})
