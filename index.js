import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-badge-notify'

/**
 * Two halves, two different windows onto the same event.
 *
 * The browser half draws the tab icon and plays the chime, because the favicon
 * and the audio device belong to the page.
 *
 * The desktop half draws the taskbar overlay. Electron's setOverlayIcon is out
 * of reach here: the host runs in its own process and the window with the
 * taskbar button belongs to another one. Windows still lets any process paint
 * that overlay through ITaskbarList3 given the HWND, so this half spawns
 * taskbar.ps1, feeds it turn events, and lets it own the count and the
 * foreground rule.
 *
 * Every default here is mirrored in client.js. The client reads the raw patch
 * config and applies its own fallbacks, because a client bundle can load
 * before the host ever validates the schema.
 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true)
    .description('Turn the whole plugin on or off.'),
  badge: Schema.boolean().default(true)
    .description('Draw the unread count on the tab icon (favicon).'),
  titlePrefix: Schema.boolean().default(true)
    .description('Prefix the document title with "(N) " while there are unread turns.'),
  sound: Schema.boolean().default(true)
    .description('Play a chime when a turn finishes.'),
  soundPreset: Schema.string().default('chime')
    .description('Built-in tone: "chime" (two-note bell) or "beep" (single square blip).'),
  soundUrl: Schema.string().default('')
    .description('Optional audio URL. When set, it replaces the built-in tone.'),
  volume: Schema.number().default(0.5)
    .description('Chime volume, 0 to 1.'),
  minTurnDurationMs: Schema.number().default(3000)
    .description('Ignore turns shorter than this, so quick replies stay silent.'),
  clearOnFocus: Schema.boolean().default(true)
    .description('Reset the unread count when the tab regains focus.'),
  errorSound: Schema.boolean().default(false)
    .description('Play a lower two-tone alert when a turn fails.'),
  desktopBadge: Schema.boolean().default(true)
    .description('Windows only: paint the count on the app taskbar button through taskbar.ps1.'),
  desktopBadgeWindow: Schema.string().default('DeepSeek Harness')
    .description('Process name whose window carries the taskbar button.'),
  desktopBadgeClearOnFocus: Schema.boolean().default(true)
    .description('Clear the taskbar badge when that window comes to the foreground.'),
  debugLog: Schema.string().default('')
    .description('Optional file path. When set, the host appends one line every time this plugin loads, which is how you tell a missing badge apart from a plugin that never mounted.'),
})

/* ------------------------------------------------------------------ taskbar */

let helper = null
let helperConfig = null

function helperScript() {
  return fileURLToPath(new URL('./taskbar.ps1', import.meta.url))
}

function startHelper(config) {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', helperScript(),
      '-WindowMatch', config.desktopBadgeWindow || 'DeepSeek Harness',
    ],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
  )

  // Drain stdout: an unread pipe would eventually block the helper. With a
  // debug log configured, keep the state lines — they are the only evidence
  // that the overlay was actually painted.
  child.stdout.on('data', (chunk) => {
    if (!config.debugLog) return
    try {
      appendFileSync(config.debugLog, String(chunk))
    } catch {
      // Diagnostics must not break the helper.
    }
  })
  child.on('error', () => {
    if (helper === child) helper = null
  })
  child.on('exit', () => {
    if (helper === child) helper = null
  })

  helperConfig = config
  return child
}

function send(command) {
  if (!helperConfig) return
  if (!helper || helper.exitCode !== null) {
    try {
      helper = startHelper(helperConfig)
    } catch {
      helper = null
      return
    }
  }
  try {
    helper.stdin.write(command + '\n')
  } catch {
    helper = null
  }
}

function stopHelper() {
  const child = helper
  helper = null
  helperConfig = null
  if (!child) return
  try {
    child.stdin.write('quit\n')
  } catch {
    // The helper may already be gone.
  }
  const timer = setTimeout(() => {
    try {
      child.kill()
    } catch {
      // Nothing left to kill.
    }
  }, 1500)
  if (typeof timer.unref === 'function') timer.unref()
}

function watchTurnsForTaskbar(ctx, config) {
  // The helper is spawned lazily on the first turn event, so the config has to
  // be visible to send() before that happens.
  helperConfig = config

  const startedAt = new Map()
  const minDuration = typeof config.minTurnDurationMs === 'number' ? config.minTurnDurationMs : 3000

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') {
      startedAt.set(agent, Date.now())
      return
    }
    const started = startedAt.get(agent)
    startedAt.delete(agent)
    if (started == null) return
    if (Date.now() - started < minDuration) return
    send('add')
  })

  ctx.on('agent/error', () => {
    send('add')
  })

  ctx.on('agent/disposed', ({ agent }) => {
    startedAt.delete(agent)
  })

  if (config.desktopBadgeClearOnFocus !== false) {
    const tick = setInterval(() => send('tick'), 800)
    if (typeof tick.unref === 'function') tick.unref()
    ctx.effect(() => () => clearInterval(tick))
  }

  ctx.effect(() => () => stopHelper())
}

/* -------------------------------------------------------------------- apply */

export function apply(ctx, config) {
  // Log once at debug level so a plugin inventory page can show that the
  // config reached this half.
  try {
    ctx?.logger?.debug?.('dsh-badge-notify: loaded with %o', config)
  } catch {
    // A logger must never take the plugin down.
  }

  // Load marker: an install that silently did not mount looks exactly like a
  // browser that refused the favicon or the audio. One appended line tells
  // the two apart.
  try {
    if (config?.debugLog) {
      appendFileSync(config.debugLog, `loaded ${new Date().toISOString()} pid=${process.pid}\n`)
    }
  } catch {
    // A diagnostic must never take the plugin down either.
  }

  if (process.platform !== 'win32') return
  if (config?.enabled === false || config?.desktopBadge === false) return

  try {
    watchTurnsForTaskbar(ctx, config || {})
  } catch (error) {
    try {
      ctx?.logger?.warn?.('dsh-badge-notify: taskbar badge unavailable: %s', error?.message)
    } catch {
      // Nothing left to report to.
    }
  }
}
