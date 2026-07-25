import type { CardTemplateHelpers, CardTemplateValue } from './types.js'

export const templateHelpers: CardTemplateHelpers = Object.freeze<CardTemplateHelpers>({
  when(
    condition: unknown,
    render: () => CardTemplateValue,
    otherwise?: () => CardTemplateValue,
  ) {
    return condition ? render() : otherwise?.() ?? null
  },
  each<T>(values: readonly T[] | null | undefined, render: (value: T, index: number) => CardTemplateValue) {
    return values ? values.map(render) : []
  },
  classNames(...values: Array<string | false | null | undefined>) {
    return values.filter(Boolean).join(' ')
  },
  truncate(value: unknown, maximumLength: number, suffix = '…') {
    const text = String(value ?? '')
    const limit = Math.max(0, Math.floor(maximumLength))
    return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - suffix.length))}${suffix}`
  },
  formatNumber(value: number, options?: Intl.NumberFormatOptions, locale?: string) {
    return new Intl.NumberFormat(locale, options).format(value)
  },
  formatDate(
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
    locale?: string,
  ) {
    return new Intl.DateTimeFormat(locale, options).format(new Date(value))
  },
  rgba(red: number, green: number, blue: number, alpha = 1) {
    return `rgba(${clamp255(red)}, ${clamp255(green)}, ${clamp255(blue)}, ${clamp(alpha, 0, 1)})`
  },
  linearGradient(angle: number | string, ...colors: string[]) {
    return `linear-gradient(${typeof angle === 'number' ? `${angle}deg` : angle}, ${colors.join(', ')})`
  },
})

function clamp255(value: number): number {
  return Math.round(clamp(value, 0, 255))
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
}
