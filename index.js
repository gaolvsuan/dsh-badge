import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-badge'

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
 *
 * Only `volatile()` fields reach the settings service: the Host serves a
 * namespace for this entry only while at least one field is volatile, and the
 * settings card binds to that namespace. The five fields the card edits are
 * volatile; the rest stay ordinary configuration.
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
  soundPreset: Schema.string().default('chime').volatile()
    .description('Built-in tone: "chime" (two-note bell), "beep" (single square blip) or "rise" (three ascending notes).'),
  soundUrl: Schema.string().default('')
    .description('Optional audio URL. When set, it replaces the built-in tone.'),
  volume: Schema.number().default(0.5).volatile()
    .description('Chime volume, 0 to 1.'),
  minTurnDurationMs: Schema.number().default(3000).volatile()
    .description('Ignore turns shorter than this, so quick replies stay silent.'),
  clearOnFocus: Schema.boolean().default(true)
    .description('Reset the unread count when the tab regains focus.'),
  errorSound: Schema.boolean().default(false)
    .description('Play a lower two-tone alert when a turn fails.'),
  badgeColor: Schema.string().default('#f5455c').volatile()
    .description('Hex colour of the badge disc, for example #f5455c.'),
  badgePosition: Schema.string().default('br').volatile()
    .description('Corner the badge sits in: "br" bottom-right, "tr" top-right.'),
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

// A volatile field does not arrive as a plain value: the loader hands the
// plugin a reference with get(). Reading it directly yields the object, and
// every colour check silently fell back to the default.
function readConfigValue(config, name, fallback) {
  if (!config) return fallback
  const raw = config[name]
  if (raw === undefined || raw === null) return fallback
  if (typeof raw === 'object' && typeof raw.get === 'function') {
    try {
      const resolved = raw.get()
      return resolved === undefined ? fallback : resolved
    } catch {
      return fallback
    }
  }
  return raw
}

function badgeColorOf(config) {
  const value = String(readConfigValue(config, 'badgeColor', '') || '')
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#f5455c'
}

// The browser half skips child sessions; the host sees the same fact on the
// agent's session header. Subagents carry origin "subagent", while an Agent
// Team teammate carries a parent session id and no origin, so both are checked.
function isChildAgent(agent) {
  try {
    const header = agent && agent.session && agent.session.header
    if (!header) return false
    if (header.origin === 'subagent') return true
    if (header.parentSessionId) return true
    if (header.parentId) return true
    return false
  } catch {
    return false
  }
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
      '-BadgeColor', badgeColorOf(config),
      '-ParentPid', String(process.pid),
    ],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
  )

  try {
    if (config.debugLog) {
      appendFileSync(config.debugLog, `helper-spawn badgeColor=${badgeColorOf(config)} pid=${child.pid}\n`)
    }
  } catch {
    // Diagnostics must not break the helper.
  }

  // Drain stdout: an unread pipe would eventually block the helper. With a
  // debug log configured, keep the state lines 鈥?they are the only evidence
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

  // A settings write reloads this entry, so a live helper has to be told about
  // the new colour instead of waiting for the next turn.
  if (helper) {
    try {
      helper.stdin.write('color ' + badgeColorOf(config) + '\n')
    } catch {
      // A dead helper is replaced on the next send.
    }
  }

  const startedAt = new Map()
  const minDurationValue = Number(readConfigValue(config, 'minTurnDurationMs', 3000))
  const minDuration = Number.isFinite(minDurationValue) ? minDurationValue : 3000

  ctx.on('agent/status', ({ agent, status }) => {
    // A subagent's turn is internal work the user never sees as a session, and
    // the browser half already skips those rows. Counting them here made the
    // taskbar number run ahead of the tab number.
    if (isChildAgent(agent)) return
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

  ctx.on('agent/error', ({ agent } = {}) => {
    if (isChildAgent(agent)) return
    send('add')
  })

  ctx.on('agent/disposed', ({ agent }) => {
    startedAt.delete(agent)
  })

  // The colour is read again on every beat instead of once at apply: a volatile
  // field's reference reports the accepted value live, so a settings change
  // reaches a running helper without the plugin being reloaded.
  let lastColor = badgeColorOf(config)
  const colourWatch = setInterval(() => {
    const current = badgeColorOf(helperConfig)
    if (current === lastColor) return
    lastColor = current
    if (!helper) return
    try {
      helper.stdin.write('color ' + current + '\n')
    } catch {
      helper = null
    }
  }, 800)
  if (typeof colourWatch.unref === 'function') colourWatch.unref()
  ctx.effect(() => () => clearInterval(colourWatch))

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
    ctx?.logger?.debug?.('dsh-badge: loaded with %o', config)
  } catch {
    // A logger must never take the plugin down.
  }

  // Load marker: an install that silently did not mount looks exactly like a
  // browser that refused the favicon or the audio. One appended line tells
  // the two apart.
  try {
    if (config?.debugLog) {
      appendFileSync(
        config.debugLog,
        `loaded ${new Date().toISOString()} pid=${process.pid} badgeColor=${String(readConfigValue(config, 'badgeColor', ''))} keys=${Object.keys(config).join('|')}\n`,
      )
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
      ctx?.logger?.warn?.('dsh-badge: taskbar badge unavailable: %s', error?.message)
    } catch {
      // Nothing left to report to.
    }
  }
}
