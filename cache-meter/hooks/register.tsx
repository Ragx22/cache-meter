import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  RenderElement,
  SessionCompacted,
  Timer,
} from 'claude-code'

import type { Meter } from '../types'
import {
  CELLS,
  SKY_EMOJI,
  cacheView,
  groupDigits,
  logRows,
  pickSummary,
  skyOf,
} from './view'

const HOUR = 60 * 60 * 1000
const FIVE_MINUTES = 5 * 60 * 1000
const FALLBACK_THRESHOLD = 83
const LOG_DELAY_MS = 500

const EMPTY: Meter = {
  cacheAt: null,
  ttlMs: HOUR,
  hit: null,
  percent: 0,
  threshold: FALLBACK_THRESHOLD,
  isThresholdRead: false,
}

const meter = atom({ plugin: 'cache-meter', key: 'meter' } as const, EMPTY)
const tick = atom({ plugin: 'cache-meter', key: 'tick' } as const, 0)
const isCollapsed = atom(
  { plugin: 'cache-meter', key: 'isCollapsed' } as const,
  false,
)

type Usage = {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

function hitRate(usage: Usage): number | null {
  const cached = usage.cache_read_input_tokens
  const total = cached + usage.cache_creation_input_tokens + usage.input_tokens

  return total === 0 ? null : Math.round((cached / total) * 100)
}

/** The last real main-thread response in a transcript's tail. */
function lastResponse(text: string) {
  for (const line of text.split('\n').reverse()) {
    if (!line.includes('"usage"')) continue

    try {
      const row = JSON.parse(line)

      if (!row.isSidechain && row.message?.usage && hitRate(row.message.usage) !== null) {
        return { usage: row.message.usage, timestamp: row.timestamp }
      }
    } catch {
      // The tail's first line starts mid-row.
    }
  }

  return null
}

async function readLastResponse($: EngineInterface, path: string) {
  if (!path) return null

  try {
    const { exitCode, stdout } = await $.process.run([
      'tail',
      '-c',
      '1000000',
      '--',
      path,
    ])

    return exitCode === 0 ? lastResponse(stdout) : null
  } catch {
    return null
  }
}

/** The API's usage leaves out the TTL it wrote at; the transcript's row has it. */
function ttlOf(usage: any, fallback: number): number {
  if (usage.cache_creation?.ephemeral_1h_input_tokens > 0) return HOUR
  if (usage.cache_creation?.ephemeral_5m_input_tokens > 0) return FIVE_MINUTES

  return fallback
}

async function measure($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown
  const threshold = breakdown?.autoCompactThreshold

  await update($, meter, m => ({
    ...m,
    percent: usage.context.percent ?? 0,
    // Right after a /clear the threshold goes unreported: the last one stands.
    ...(threshold !== undefined
      ? {
          threshold: Math.round((threshold / usage.context.window) * 100),
          isThresholdRead: true,
        }
      : breakdown?.isAutoCompactEnabled === false
        ? { threshold: FALLBACK_THRESHOLD, isThresholdRead: false }
        : {}),
  }))
}

async function afterCompact(
  $: EngineInterface,
  result: SessionCompacted,
  isShown: boolean,
) {
  const { context } = await $.session.usage()
  const after = result.tokensAfter

  await update($, meter, m => ({
    ...m,
    cacheAt: null,
    hit: null,
    percent: after === undefined ? 0 : Math.round((after / context.window) * 100),
  }))

  if (!isShown) return

  const say = (n: number | undefined) => (n === undefined ? '?' : groupDigits(n))

  const rows = [
    `Compact: ${say(result.tokensBefore)} Tokens vorher → ${say(after)} nachher`,
    ...logRows(pickSummary(result.messages) ?? ''),
  ]

  // Rows logged now would sit in the transcript the compaction is replacing.
  $.clock.after(LOG_DELAY_MS, () => {
    for (const row of rows) $.ui.log(row)
  })
}

let timer: Timer | undefined

/** Ticks on whole minutes of the cache's life, so the bar turns over on time. */
function arm($: EngineInterface) {
  timer?.cancel()
  timer = $.clock.every(60_000, async () => {
    const m = await read($, meter)

    await update($, tick, n => n + 1)

    if (m.cacheAt === null || m.cacheAt + m.ttlMs <= (await $.clock.now())) {
      timer?.cancel()
      timer = undefined
    }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { cacheAt, ttlMs } = await read($, meter)

    await $.command.register({
      name: 'meter-fold',
      description: 'Klappt die Cache-Meter-Leiste zu oder auf',
    })

    await measure($).catch(() => undefined)

    if (cacheAt !== null && cacheAt + ttlMs > (await $.clock.now())) {
      arm($)
    }

    return result
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const usage = result.usage

    if (e.agentId === undefined && usage) {
      const now = await $.clock.now()

      await update($, meter, m => ({
        ...m,
        cacheAt: now,
        hit: hitRate(usage) ?? m.hit,
      }))
      arm($)
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await measure($).catch(() => undefined)
    }

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    const last = await readLastResponse($, e.transcript_path)

    if (last) {
      await update($, meter, m => ({ ...m, ttlMs: ttlOf(last.usage, m.ttlMs) }))
    }

    return next(e)
  })

  // A resumed session's cache was warmed before this process began.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'resume' || e.source === 'fork') {
      const last = await readLastResponse($, e.transcript_path)
      const at = last ? Date.parse(last.timestamp) : NaN

      if (last && !Number.isNaN(at)) {
        await update($, meter, m => ({
          ...m,
          cacheAt: at,
          ttlMs: ttlOf(last.usage, m.ttlMs),
          hit: hitRate(last.usage),
        }))
        arm($)
      }
    }

    return next(e)
  })

  // Hears the typed and the queued /compact; a direct $.session.compact skips it.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)

    if (
      e.agentId === undefined &&
      e.trigger !== 'precompute' &&
      result.skip === undefined
    ) {
      await afterCompact($, result, e.trigger === 'manual').catch(() => undefined)
    }

    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, meter, m => ({ ...m, cacheAt: null, hit: null, percent: 0 }))
      // The new session's state starts over, and no session.start or measurement
      // follows until its first response.
      $.clock.after(LOG_DELAY_MS, () => {
        void measure($).catch(() => undefined)
      })
    }

    return next(e)
  })

  on('command.run', { command: 'meter-fold' }, async $ => {
    const wasCollapsed = await read($, isCollapsed)

    await update($, isCollapsed, () => !wasCollapsed)

    return { text: wasCollapsed ? 'Leiste aufgeklappt' : 'Leiste zugeklappt' }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // The engine's line keeps the permission mode and "esc to interrupt" in view.
    const engine = await next(e)

    if (e.surface !== 'terminal') {
      return engine
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const m = await read($, meter)
    const collapsed = await read($, isCollapsed)
    await read($, tick)

    const view = cacheView(m.cacheAt, m.ttlMs, await $.clock.now())
    const sky = skyOf(m.percent, m.threshold)
    const width = e.viewport?.columns ?? 120
    const stacked = (row: RenderElement) => (
      <Box flexDirection="column">
        {row}
        {engine}
      </Box>
    )

    const queue = async () => {
      $.ui.toast('Compact eingereiht, startet sobald Claude fertig ist')
      await $.command.run({ command: 'compact' })
    }

    const compact = async () => {
      if (e.props.isWorking) {
        await queue()

        return
      }

      let result

      try {
        result = await $.session.compact()
      } catch {
        // A turn began since this drawing: it rejects while one runs.
        await queue()

        return
      }

      if (result.skip !== undefined) {
        $.ui.toast(result.skip)
      } else {
        await afterCompact($, result, true)
      }
    }

    const arrow = (
      <Button
        key="fold"
        label={collapsed ? '▸' : '▾'}
        plain
        dimColor
        onPress={() => update($, isCollapsed, value => !value)}
      />
    )

    if (collapsed || width < 72) {
      return stacked(
        <Box flexDirection="row">
          <Text wrap="truncate">
            {SKY_EMOJI[sky]} <Text color={view.color}>{view.label}</Text>
            <Text dimColor> · Kontext </Text>
            <Text bold>{m.percent}%</Text>{' '}
          </Text>
          {arrow}
        </Box>
      )
    }

    const threshold = `${m.isThresholdRead ? '' : '~'}${m.threshold}%`

    return stacked(
      <Box flexDirection="row">
        <Text wrap="truncate">
          <Text dimColor>cache </Text>
          <Text color={view.color}>{view.label} </Text>
          {view.filled > 0 ? (
            <Text color={view.color}>{'■'.repeat(view.filled)}</Text>
          ) : null}
          <Text dimColor>{'■'.repeat(CELLS - view.filled)} </Text>
          <Text bold>{m.hit === null ? '–' : `${m.hit}%`}</Text>
          <Text dimColor> hit · </Text>
          {SKY_EMOJI[sky]}
          <Text dimColor> Kontext </Text>
          <Text bold>{m.percent}%</Text>
          {width >= 90 ? <Text dimColor> (Auto-Compact {threshold})</Text> : null}{' '}
        </Text>
        <Button
          key="compact"
          label="Compact"
          variant={sky === 'storm' ? 'primary' : 'secondary'}
          onPress={compact}
        />
        <Text> </Text>
        {arrow}
      </Box>
    )
  })
}
