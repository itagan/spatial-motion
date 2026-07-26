import type { MotionItem } from '../core/types.js'

export type CardTemplateLength = number | `${number}px` | `${number}%` | 'auto'

export interface CardTemplateStyle {
  display?: 'flex'
  flexDirection?: 'row' | 'column'
  justifyContent?: 'start' | 'center' | 'end' | 'space-between'
  alignItems?: 'start' | 'center' | 'end' | 'stretch'
  flex?: number
  position?: 'relative' | 'absolute'
  width?: CardTemplateLength
  height?: CardTemplateLength
  top?: CardTemplateLength
  right?: CardTemplateLength
  bottom?: CardTemplateLength
  left?: CardTemplateLength
  padding?: CardTemplateLength
  paddingTop?: CardTemplateLength
  paddingRight?: CardTemplateLength
  paddingBottom?: CardTemplateLength
  paddingLeft?: CardTemplateLength
  margin?: CardTemplateLength
  marginTop?: CardTemplateLength
  marginRight?: CardTemplateLength
  marginBottom?: CardTemplateLength
  marginLeft?: CardTemplateLength
  gap?: CardTemplateLength
  background?: string
  backgroundColor?: string
  border?: string
  borderWidth?: CardTemplateLength
  borderColor?: string
  borderRadius?: CardTemplateLength
  opacity?: number
  overflow?: 'visible' | 'hidden'
  color?: string
  fontFamily?: string
  fontSize?: CardTemplateLength
  fontWeight?: number | string
  lineHeight?: number
  textAlign?: 'left' | 'center' | 'right'
  lineClamp?: 1 | 2 | 3
  whiteSpace?: 'normal' | 'nowrap'
  objectFit?: 'cover' | 'contain' | 'fill'
  objectPosition?: string
}

export type CardTemplatePrimitive = string | number | boolean | null | undefined
export type CardTemplateValue =
  | CardTemplatePrimitive
  | Readonly<CardTemplateStyle>
  | CardTemplateResult
  | readonly CardTemplateValue[]

declare const templateResultBrand: unique symbol

export interface CardTemplateResult {
  readonly [templateResultBrand]: true
}

export type CardTemplateItem<TMeta = unknown> = MotionItem<TMeta>

export interface CardTemplateHelpers {
  when(
    condition: unknown,
    render: () => CardTemplateValue,
    otherwise?: () => CardTemplateValue,
  ): CardTemplateValue
  each<T>(
    values: readonly T[] | null | undefined,
    render: (value: T, index: number) => CardTemplateValue,
  ): CardTemplateValue[]
  classNames(...values: Array<string | false | null | undefined>): string
  truncate(value: unknown, maximumLength: number, suffix?: string): string
  formatNumber(value: number, options?: Intl.NumberFormatOptions, locale?: string): string
  formatDate(
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
    locale?: string,
  ): string
  rgba(red: number, green: number, blue: number, alpha?: number): string
  linearGradient(angle: number | string, ...colors: string[]): string
}

export interface DefineCardTemplateOptions<TMeta = unknown> {
  styles?: Readonly<Record<string, Readonly<CardTemplateStyle>>>
  onError?: (error: CardTemplateError, item: Readonly<MotionItem<TMeta>>) => void
}

export class CardTemplateError extends Error {
  readonly name = 'CardTemplateError'

  constructor(
    readonly code:
      | 'INVALID_MARKUP'
      | 'UNSUPPORTED_TAG'
      | 'UNSUPPORTED_ATTRIBUTE'
      | 'UNSUPPORTED_STYLE'
      | 'INVALID_VALUE',
    message: string,
  ) {
    super(message)
  }
}
