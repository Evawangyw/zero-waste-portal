// 把抽取式回答里的 Markdown 拆成可渲染的块。不注入原始 HTML。
// 引用 [[n]] 单独成块，方便点开对应资料。

export type InlinePiece =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'cite'; readonly index: number }

export type AnswerBlock =
  | { readonly kind: 'heading'; readonly level: 2 | 3 | 4; readonly pieces: readonly InlinePiece[] }
  | { readonly kind: 'bullet'; readonly marker: string; readonly pieces: readonly InlinePiece[] }
  | { readonly kind: 'rule' }
  | { readonly kind: 'image'; readonly alt: string; readonly url: string }
  | { readonly kind: 'table'; readonly rows: readonly (readonly InlinePiece[])[][] }
  | { readonly kind: 'paragraph'; readonly pieces: readonly InlinePiece[] }

const INLINE_RE = /(\*\*[^*]+\*\*|\[\[(\d+)\]\])/g

export function parseAnswerMarkdown(body: string): readonly AnswerBlock[] {
  const lines = body.replace(/<br\s*\/?>/gi, '\n').split('\n')
  const blocks: AnswerBlock[] = []
  let index = 0
  while (index < lines.length) {
    const raw = lines[index] ?? ''
    const line = raw.trim()
    if (line === '') {
      index += 1
      continue
    }
    if (line === '---' || line === '***') {
      blocks.push({ kind: 'rule' })
      index += 1
      continue
    }
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/u.exec(line)
    if (image !== null && isSafeImageUrl(image[2] ?? '')) {
      blocks.push({ kind: 'image', alt: image[1] ?? '', url: image[2] ?? '' })
      index += 1
      continue
    }
    if (/^<table[\s>]/iu.test(line)) {
      let html = line
      while (index + 1 < lines.length && !/<\/table>/iu.test(html)) {
        index += 1
        html += lines[index] ?? ''
      }
      const rows = parseHtmlTable(html)
      if (rows.length > 0) blocks.push({ kind: 'table', rows })
      index += 1
      continue
    }
    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        tableLines.push((lines[index] ?? '').trim())
        index += 1
      }
      const rows = parsePipeTable(tableLines)
      if (rows.length > 0) blocks.push({ kind: 'table', rows })
      continue
    }
    const heading = /^(#{1,4})\s+(.+)$/u.exec(line)
    if (heading !== null) {
      const marks = heading[1] ?? '#'
      const level = Math.min(Math.max(marks.length, 2), 4) as 2 | 3 | 4
      blocks.push({ kind: 'heading', level, pieces: parseInline(heading[2] ?? '') })
      index += 1
      continue
    }
    const bullet = /^(?:[-*]|(\d+)[.)])\s+(.+)$/u.exec(line)
    if (bullet !== null) {
      blocks.push({
        kind: 'bullet',
        marker: bullet[1] !== undefined ? `${bullet[1]}.` : '•',
        pieces: parseInline(bullet[2] ?? ''),
      })
      index += 1
      continue
    }
    if (line.startsWith('_') && line.endsWith('_') && line.length > 2) {
      blocks.push({ kind: 'paragraph', pieces: parseInline(line.slice(1, -1)) })
      index += 1
      continue
    }
    blocks.push({ kind: 'paragraph', pieces: parseInline(line) })
    index += 1
  }
  return blocks
}

export function parseInline(text: string): readonly InlinePiece[] {
  const pieces: InlinePiece[] = []
  let last = 0
  for (const match of text.matchAll(INLINE_RE)) {
    const start = match.index ?? 0
    if (start > last) pieces.push({ kind: 'text', text: text.slice(last, start) })
    const token = match[0]
    if (token.startsWith('[[')) {
      pieces.push({ kind: 'cite', index: Number(match[2]) })
    } else {
      pieces.push({ kind: 'strong', text: token.slice(2, -2) })
    }
    last = start + token.length
  }
  if (last < text.length) pieces.push({ kind: 'text', text: text.slice(last) })
  return pieces.filter((piece) => piece.kind !== 'text' || piece.text !== '')
}

function parseHtmlTable(html: string): (readonly InlinePiece[])[][] {
  const rows: (readonly InlinePiece[])[][] = []
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const cells = [...(row[1] ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/giu)].map((cell) =>
      parseInline(stripTags(cell[1] ?? '')),
    )
    if (cells.some((cell) => cell.length > 0)) rows.push(cells)
  }
  return rows
}

function parsePipeTable(lines: readonly string[]): (readonly InlinePiece[])[][] {
  const rows: (readonly InlinePiece[])[][] = []
  for (const line of lines) {
    if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(line)) continue
    const cells = line
      .replace(/^\|/u, '')
      .replace(/\|$/u, '')
      .split('|')
      .map((cell) => parseInline(cell.trim()))
    if (cells.some((cell) => cell.length > 0)) rows.push(cells)
  }
  return rows
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function isSafeImageUrl(url: string): boolean {
  return url.startsWith('/') || url.startsWith('https://') || url.startsWith('http://')
}
