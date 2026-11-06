import { expect, mock, test } from 'claude-code/testing'

import { cacheView, logRows, pickSummary, skyOf } from './view'

const HOUR = 3_600_000

const BAND = {
  plugin: 'cache-meter',
  component: 'PromptHint',
  requestId: 'hint',
  surface: 'terminal',
  viewport: { columns: 120, rows: 40 },
  props: { isDraft: false, isWorking: false, hint: 'esc to interrupt' },
} as const

const seed = (on: any, values: Record<string, unknown>) => {
  const all: Record<string, unknown> = { tick: 0, isCollapsed: false, ...values }

  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)

    return <Text>esc to interrupt</Text>
  })

  on('state.get', (_: unknown, e: { key: string }) => ({
    value: { value: all[e.key], version: 1 },
  }))
}

const METER = {
  cacheAt: 0,
  ttlMs: HOUR,
  hit: 93,
  percent: 9,
  threshold: 83,
  isThresholdRead: true,
}

const textOf = async (ui: any) =>
  (await ui.find({ type: 'Text', text: /Kontext/ }))?.text as string

test('Farben: grün, im letzten Viertel gelb, in den letzten 10 % rot', () => {
  expect(cacheView(0, HOUR, 0).color).toBe('success')
  expect(cacheView(0, HOUR, 0).label).toBe('60m')
  expect(cacheView(0, HOUR, 0).filled).toBe(20)
  expect(cacheView(0, HOUR, HOUR * 0.74).color).toBe('success')
  expect(cacheView(0, HOUR, HOUR * 0.75).color).toBe('warning')
  expect(cacheView(0, HOUR, HOUR * 0.9).color).toBe('error')
  expect(cacheView(0, HOUR, HOUR * 0.5).filled).toBe(10)
  expect(cacheView(0, 300_000, 120_000).label).toBe('3m')
})

test('bei 0 steht abgelaufen, leere Leiste', () => {
  expect(cacheView(0, HOUR, HOUR).label).toBe('abgelaufen')
  expect(cacheView(0, HOUR, HOUR).filled).toBe(0)
})

test('Wetter folgt der Auto-Compact-Schwelle', () => {
  expect(skyOf(41, 83)).toBe('sun')
  expect(skyOf(42, 83)).toBe('rain')
  expect(skyOf(66, 83)).toBe('rain')
  expect(skyOf(67, 83)).toBe('storm')
  expect(skyOf(19, 37)).toBe('rain')
})

test('lange Zusammenfassungen verlieren nichts und bleiben unter dem Limit', () => {
  const lines = Array.from({ length: 12 }, (_, i) => `Absatz ${i} ` + 'wort '.repeat(90))
  const long = 'x '.repeat(3000)
  const text = [...lines, long, 'Ende'].join('\n\n')
  const rows = logRows(text, 1900)

  for (const row of rows) {
    expect(row.length <= 1900).toBe(true)
    expect(row.includes('\n')).toBe(false)
  }

  const words = (s: string) => s.split(/\s+/).filter(Boolean)

  expect(words(rows.join('\n'))).toEqual(words(text))
  expect(rows[0]?.startsWith('Absatz 0')).toBe(true)
  expect(rows.at(-1)).toBe('Ende')
})

test('die Zusammenfassung wird unter den behaltenen Nachrichten gefunden', () => {
  const summary = 'This session is being continued from a previous conversation...'

  expect(
    pickSummary([
      { role: 'assistant', text: 'kept' },
      { role: 'user', text: summary },
    ]),
  ).toBe(summary)
})

test('volle Leiste zeigt alle Teile', async ($, on) => {
  mock.clock(on, { now: 0 })
  seed(on, { meter: METER })

  const ui = await $.ui.mount(BAND as any)
  const text = await textOf(ui)

  expect(text).toContain('cache 60m')
  expect(text).toContain('■'.repeat(20))
  expect(text).toContain('93% hit')
  expect(text).toContain('☀️ Kontext 9% (Auto-Compact 83%)')
  await ui.unmount()
})

test('bei ⛈️ ist Compact hervorgehoben, sonst nicht', async ($, on) => {
  mock.clock(on, { now: 0 })
  seed(on, { meter: { ...METER, percent: 70 } })

  const stormy = await $.ui.mount(BAND as any)

  expect(await textOf(stormy)).toContain('⛈️')
  expect(JSON.stringify(await stormy.drawn())).toContain('"variant":"primary"')
  await stormy.unmount()
})

test('die Hinweiszeile der Engine bleibt unter der Leiste erhalten', async ($, on) => {
  mock.clock(on, { now: 0 })
  seed(on, { meter: METER })

  const ui = await $.ui.mount(BAND as any)

  expect((await ui.find({ type: 'Text', text: /esc to interrupt/ }))?.text).toBe(
    'esc to interrupt',
  )
  await ui.unmount()
})

test('Ersatzschwelle 83 % ist als solche gekennzeichnet', async ($, on) => {
  mock.clock(on, { now: 0 })
  seed(on, { meter: { ...METER, isThresholdRead: false } })

  const ui = await $.ui.mount(BAND as any)

  expect(await textOf(ui)).toContain('(Auto-Compact ~83%)')
  await ui.unmount()
})

test('zugeklappt nur Wetter, Restzeit und Kontext', async ($, on) => {
  mock.clock(on, { now: 0 })
  seed(on, { meter: { ...METER, percent: 70 }, isCollapsed: true })

  const ui = await $.ui.mount(BAND as any)
  const text = await textOf(ui)

  expect(text).toContain('⛈️ 60m · Kontext 70%')
  expect(text.includes('hit')).toBe(false)
  expect(text.includes('■')).toBe(false)
  await ui.unmount()
})
