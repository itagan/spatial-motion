import {
  CardTemplateError,
  type CardTemplateResult,
  type CardTemplateValue,
} from './types.js'

const RESULT = Symbol('card-template-result')
const MARKER = /\uE000(\d+)\uE001/g
const cache = new WeakMap<TemplateStringsArray, BlueprintNode[]>()
const allowedTags = new Set(['div', 'span', 'img', 'br'])
const allowedAttributes = new Set(['class', 'style', 'src', 'alt'])

type Part = string | { value: number }
type BlueprintNode = BlueprintText | BlueprintElement
interface BlueprintText {
  type: 'text'
  parts: Part[]
}
interface BlueprintElement {
  type: 'element'
  tag: string
  attributes: Record<string, Part[]>
  children: BlueprintNode[]
}

export type RuntimeNode = RuntimeText | RuntimeElement
export interface RuntimeText {
  type: 'text'
  value: string
}
export interface RuntimeElement {
  type: 'element'
  tag: 'div' | 'span' | 'img' | 'br'
  attributes: Record<string, unknown>
  children: RuntimeNode[]
}

interface InternalTemplateResult extends CardTemplateResult {
  readonly [RESULT]: {
    blueprint: BlueprintNode[]
    values: readonly CardTemplateValue[]
  }
}

export function html(
  strings: TemplateStringsArray,
  ...values: CardTemplateValue[]
): CardTemplateResult {
  let blueprint = cache.get(strings)
  if (!blueprint) {
    blueprint = compile(strings)
    cache.set(strings, blueprint)
  }
  return {
    [RESULT]: { blueprint, values },
  } as unknown as CardTemplateResult
}

export function resolveTemplate(result: CardTemplateResult): RuntimeNode[] {
  const internal = result as InternalTemplateResult
  if (!internal?.[RESULT]) {
    throw new CardTemplateError('INVALID_VALUE', 'Expected a value created by html`...`')
  }
  return resolveNodes(internal[RESULT].blueprint, internal[RESULT].values)
}

export function isTemplateResult(value: unknown): value is CardTemplateResult {
  return Boolean(value && typeof value === 'object' && RESULT in value)
}

function compile(strings: TemplateStringsArray): BlueprintNode[] {
  const source = strings.map((part, index) =>
    `${part}${index < strings.length - 1 ? `\uE000${index}\uE001` : ''}`).join('')
  const root: BlueprintElement = { type: 'element', tag: 'div', attributes: {}, children: [] }
  const stack = [root]
  const tokens = source.match(/<[^>]*>|[^<]+/g) ?? []
  for (const token of tokens) {
    if (!token.startsWith('<')) {
      const parts = parseParts(token)
      if (parts.some((part) => typeof part !== 'string' || part.trim())) {
        stack.at(-1)!.children.push({ type: 'text', parts })
      }
      continue
    }
    if (/^<\//.test(token)) {
      const tag = token.slice(2, -1).trim().toLowerCase()
      if (stack.length === 1 || stack.at(-1)?.tag !== tag) {
        throw new CardTemplateError('INVALID_MARKUP', `Unexpected closing tag </${tag}>`)
      }
      stack.pop()
      continue
    }
    const selfClosing = /\/>$/.test(token)
    const body = token.slice(1, selfClosing ? -2 : -1).trim()
    const match = /^([a-zA-Z][\w-]*)([\s\S]*)$/.exec(body)
    if (!match) throw new CardTemplateError('INVALID_MARKUP', `Invalid tag ${token}`)
    const tag = match[1].toLowerCase()
    if (!allowedTags.has(tag)) {
      throw new CardTemplateError('UNSUPPORTED_TAG', `Unsupported tag <${tag}>`)
    }
    const element: BlueprintElement = {
      type: 'element',
      tag,
      attributes: parseAttributes(match[2]),
      children: [],
    }
    stack.at(-1)!.children.push(element)
    if (!selfClosing && tag !== 'img' && tag !== 'br') stack.push(element)
  }
  if (stack.length !== 1) {
    throw new CardTemplateError('INVALID_MARKUP', `Unclosed tag <${stack.at(-1)?.tag}>`)
  }
  return root.children
}

function parseAttributes(source: string): Record<string, Part[]> {
  const attributes: Record<string, Part[]> = {}
  const expression = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let consumed = ''
  let match: RegExpExecArray | null
  while ((match = expression.exec(source))) {
    consumed += source.slice(consumed.length, match.index) + match[0]
    const name = match[1].toLowerCase()
    if (name.startsWith('on')) {
      throw new CardTemplateError('UNSUPPORTED_ATTRIBUTE', `Event attribute ${name} is not supported`)
    }
    if (!allowedAttributes.has(name)) {
      throw new CardTemplateError('UNSUPPORTED_ATTRIBUTE', `Unsupported attribute ${name}`)
    }
    attributes[name] = parseParts(match[2] ?? match[3] ?? match[4] ?? '')
  }
  if (source.slice(consumed.length).trim()) {
    throw new CardTemplateError('INVALID_MARKUP', `Invalid attributes: ${source.trim()}`)
  }
  return attributes
}

function parseParts(value: string): Part[] {
  const parts: Part[] = []
  let cursor = 0
  for (const match of value.matchAll(MARKER)) {
    if (match.index! > cursor) parts.push(value.slice(cursor, match.index))
    parts.push({ value: Number(match[1]) })
    cursor = match.index! + match[0].length
  }
  if (cursor < value.length) parts.push(value.slice(cursor))
  return parts
}

function resolveNodes(nodes: BlueprintNode[], values: readonly CardTemplateValue[]): RuntimeNode[] {
  return nodes.flatMap((node): RuntimeNode[] => {
    if (node.type === 'element') {
      const attributes = Object.fromEntries(Object.entries(node.attributes).map(([name, parts]) => [
        name,
        resolveAttribute(parts, values),
      ]))
      validateResolvedAttributes(attributes)
      return [{
        type: 'element',
        tag: node.tag as RuntimeElement['tag'],
        attributes,
        children: resolveNodes(node.children, values),
      }]
    }
    if (node.parts.every((part) => typeof part !== 'string' || !part.trim())) {
      return node.parts.flatMap((part) => typeof part === 'string'
        ? []
        : resolveValue(values[part.value]))
    }
    const text = node.parts.map((part) => typeof part === 'string'
      ? part
      : primitiveText(values[part.value])).join('')
    return text.trim() ? [{ type: 'text', value: collapseWhitespace(text) }] : []
  })
}

function validateResolvedAttributes(attributes: Record<string, unknown>): void {
  Object.entries(attributes).forEach(([name, value]) => {
    if (value === null || value === undefined || value === false) return
    if (name === 'style' && (typeof value === 'string'
      || (typeof value === 'object' && !Array.isArray(value)))) return
    if (name !== 'style' && (typeof value === 'string' || typeof value === 'number')) return
    throw new CardTemplateError('INVALID_VALUE', `Invalid value for ${name}`)
  })
}

function resolveAttribute(parts: Part[], values: readonly CardTemplateValue[]): unknown {
  if (parts.length === 1 && typeof parts[0] !== 'string') return values[parts[0].value]
  return parts.map((part) => typeof part === 'string'
    ? part
    : primitiveText(values[part.value])).join('')
}

function resolveValue(value: CardTemplateValue): RuntimeNode[] {
  if (value === null || value === undefined || value === false || value === true) return []
  if (Array.isArray(value)) return value.flatMap(resolveValue)
  if (isTemplateResult(value)) return resolveTemplate(value)
  if (typeof value === 'string' || typeof value === 'number') {
    return [{ type: 'text', value: String(value) }]
  }
  throw new CardTemplateError('INVALID_VALUE', 'Template values must be text, templates, or arrays')
}

function primitiveText(value: CardTemplateValue): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
