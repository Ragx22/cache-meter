export const CELLS = 20

/** The terminal draws the first 2000 characters of a log line. */
export const LOG_LIMIT = 1900

export type CacheView = {
  label: string
  filled: number
  color: 'success' | 'warning' | 'error' | undefined
}

export function cacheView(
  cacheAt: number | null,
  ttlMs: number,
  now: number,
): CacheView {
  if (cacheAt === null) {
    return { label: '–', filled: 0, color: undefined }
  }

  const left = cacheAt + ttlMs - now

  if (left <= 0) {
    return { label: 'abgelaufen', filled: 0, color: 'error' }
  }

  const share = left / ttlMs

  return {
    label: `${Math.ceil(left / 60_000)}m`,
    filled: Math.min(CELLS, Math.ceil(share * CELLS)),
    color: share <= 0.1 ? 'error' : share <= 0.25 ? 'warning' : 'success',
  }
}

export type Sky = 'sun' | 'rain' | 'storm'

export function skyOf(percent: number, threshold: number): Sky {
  const share = percent / threshold

  if (share <= 0.5) return 'sun'

  return share <= 0.8 ? 'rain' : 'storm'
}

export const SKY_EMOJI: Record<Sky, string> = {
  sun: '☀️',
  rain: '🌧️',
  storm: '⛈️',
}

export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, '.')
}

/** Cuts a piece too long for one line, at a line end or a space if it has one. */
function cutLong(piece: string, max: number): string[] {
  const parts: string[] = []
  let rest = piece

  while (rest.length > max) {
    const window = rest.slice(0, max)
    const newline = window.lastIndexOf('\n')
    const space = window.lastIndexOf(' ')
    const at = newline > 0 ? newline : space > 0 ? space : max

    parts.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }

  if (rest) parts.push(rest)

  return parts
}

/**
 * One log row per line of the text, each of at most `max` characters. A log row
 * cannot hold a line break: the terminal draws one as a replacement character.
 * Only blank lines are dropped.
 */
export function logRows(text: string, max = LOG_LIMIT): string[] {
  return text
    .split('\n')
    .filter(line => line.trim() !== '')
    .flatMap(line => cutLong(line, max))
}

/** The message a compaction continues from, among its summary and kept rows. */
export function pickSummary(
  messages: readonly { role: string; text: string }[],
): string | null {
  const texts = messages.filter(m => m.text.trim() !== '')
  const marked = texts.find(m => m.text.includes('continued from a previous'))

  if (marked) return marked.text

  const firstUser = texts.find(m => m.role === 'user')

  return firstUser ? firstUser.text : null
}
