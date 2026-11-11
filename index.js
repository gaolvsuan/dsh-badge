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
  minTurnDurationMs: Schema.number().default(1000).volatile()
    .description('Ignore turns shorter than this, so quick replies stay silent.'),
  clearOnFocus: Schema.boolean().default(true)
    .description('Reset the unread count when the tab regains focus.'),
  errorSound: Schema.boolean().default(false)
    .description('Play a lower two-tone alert when a turn fails.'),
  badgeColor: Schema.string().default('#f5455c').volatile()
    .description('Hex colour of the badge disc, for example #f5455c.'),
  badgePosition: Schema.string().default('br').volatile()
    .description('Corner the badge sits in: "br" bottom-right, "tr" top-right.'),
  desktopBadge: Schema.boolean().default(true).volatile()
    .description('Windows only: paint the count on the app taskbar button through taskbar.ps1.'),
  desktopBadgeWindow: Schema.string().default('DeepSeek Harness')
    .description('Process name whose window carries the taskbar button.'),
  desktopBadgeClearOnFocus: Schema.boolean().default(true).volatile()
    .description('Clear the taskbar badge when that window comes to the foreground.'),
  debugLog: Schema.string().default('')
    .description('Optional file path. When set, the host appends one line every time this plugin loads, which is how you tell a missing badge apart from a plugin that never mounted.'),
})

/* ------------------------------------------------------------------ taskbar */

let helper = null
let helperConfig = null

// A helper that dies right after it starts — PowerShell blocked by policy, a
// missing script — would otherwise be respawned by the next tick, twice a
// second, forever. Three quick deaths park the helper for five minutes.
const SPAWN_FAILURE_WINDOW_MS = 5000
const SPAWN_FAILURE_LIMIT = 3
const SPAWN_PARK_MS = 5 * 60 * 1000
let spawnFailures = 0
let spawnParkedUntil = 0
// True while the helper has something on screen. The foreground beat is idle
// the rest of the time, which is most of the time.
let badgeVisible = false

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
// agent's session header. A subagent carries origin "subagent", and any child
// session — an Agent Team teammate included — carries `parentSession` and a
// delegation depth above zero. The header uses those names, not the summary's
// `parentSessionId`.
function isChildAgent(agent) {
  try {
    const header = agent && agent.session && agent.session.header
    if (!header) return false
    if (header.origin === 'subagent') return true
    if (header.parentSession) return true
    if (header.parentSessionId) return true
    if (header.parentId) return true
    if (typeof header.delegationDepth === 'number' && header.delegationDepth > 0) return true
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
  // debug log configured, keep the state lines — they are the only evidence
  // that the overlay was actually painted.
  child.stdout.on('data', (chunk) => {
    // Any output means the helper got far enough to speak, so the failure
    // streak from an earlier crash no longer applies.
    spawnFailures = 0

    // The same lines tell the host whether anything is on screen, which is
    // what decides if the foreground beat has any work to do at all.
    const text = String(chunk)
    if (text.includes('state=shown') || text.includes('state=asked')) badgeVisible = true
    else if (text.includes('state=cleared') || text.includes('state=bye')) badgeVisible = false

    if (!config.debugLog) return
    try {
      appendFileSync(config.debugLog, text)
    } catch {
      // Diagnostics must not break the helper.
    }
  })
  child.on('error', () => {
    if (helper === child) helper = null
    noteHelperDeath(child)
  })
  child.on('exit', () => {
    if (helper === child) helper = null
    noteHelperDeath(child)
  })

  helperConfig = config
  return child
}

// Counts only deaths that come soon after a spawn: a helper that lived for a
// while and then stopped is normal, one that dies at once is a broken setup.
function noteHelperDeath(child) {
  const lived = Date.now() - (child.spawnedAt || 0)
  if (lived > SPAWN_FAILURE_WINDOW_MS) {
    spawnFailures = 0
    return
  }
  spawnFailures += 1
  if (spawnFailures >= SPAWN_FAILURE_LIMIT) {
    spawnParkedUntil = Date.now() + SPAWN_PARK_MS
    spawnFailures = 0
  }
}

function send(command) {
  if (!helperConfig) return
  if (Date.now() < spawnParkedUntil) return
  if (!helper || helper.exitCode !== null) {
    try {
      helper = startHelper(helperConfig)
      helper.spawnedAt = Date.now()
    } catch {
      helper = null
      spawnFailures += 1
      if (spawnFailures >= SPAWN_FAILURE_LIMIT) {
        spawnParkedUntil = Date.now() + SPAWN_PARK_MS
        spawnFailures = 0
      }
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
  const minDurationValue = Number(readConfigValue(config, 'minTurnDurationMs', 1000))
  const minDuration = Number.isFinite(minDurationValue) ? minDurationValue : 1000

  // Read on every use: the switch is volatile, so its reference carries the
  // accepted value as soon as the settings page writes it.
  const taskbarOn = () => readConfigValue(helperConfig || config, 'desktopBadge', true) !== false

  // An agent that stops to ask something reports `blocked` while it waits. The
  // taskbar says so with a question mark, which outranks the count on the tab
  // for the same reason: nothing can move until the user answers.
  const askingAgents = new Set()

  ctx.on('agent/status', ({ agent, status }) => {
    // A subagent's turn is internal work the user never sees as a session, and
    // the browser half already skips those rows. Counting them here made the
    // taskbar number run ahead of the tab number.
    if (isChildAgent(agent)) return

    if (status === 'blocked') {
      const first = askingAgents.size === 0
      askingAgents.add(agent)
      if (first && taskbarOn()) send('ask')
      return
    }

    if (askingAgents.delete(agent) && askingAgents.size === 0 && taskbarOn()) send('askoff')

    if (status === 'running') {
      startedAt.set(agent, Date.now())
      return
    }
    const started = startedAt.get(agent)
    startedAt.delete(agent)
    if (started == null) return
    if (Date.now() - started < minDuration) return
    if (!taskbarOn()) return
    send('add')
  })

  ctx.on('agent/error', ({ agent } = {}) => {
    if (isChildAgent(agent)) return
    if (!taskbarOn()) return
    send('add')
  })

  ctx.on('agent/disposed', ({ agent }) => {
    startedAt.delete(agent)
    // A turn can be disposed while it is waiting for an answer; the set must not
    // keep the agent around after that.
    askingAgents.delete(agent)
  })

  // Both switches are read live: a volatile reference reports the accepted
  // value as soon as the settings page writes it, so turning the taskbar badge
  // off stops the helper without waiting for a reload.
  let lastColor = badgeColorOf(config)
  let lastOn = taskbarOn()
  const colourWatch = setInterval(() => {
    const on = taskbarOn()
    if (on !== lastOn) {
      lastOn = on
      if (on) helperConfig = config
      else stopHelper()
    }

    const current = badgeColorOf(helperConfig || config)
    if (current !== lastColor) {
      lastColor = current
      if (!helper) return
      try {
        helper.stdin.write('color ' + current + '\n')
      } catch {
        helper = null
      }
    }
  }, 2000)
  if (typeof colourWatch.unref === 'function') colourWatch.unref()
  ctx.effect(() => () => clearInterval(colourWatch))

  // The foreground beat only runs while something is actually on screen: the
  // helper reports every state change, and an empty badge has nothing to clear.
  const tick = setInterval(() => {
    if (!badgeVisible) return
    if (readConfigValue(helperConfig || config, 'desktopBadgeClearOnFocus', true) === false) return
    send('tick')
  }, 800)
  if (typeof tick.unref === 'function') tick.unref()
  ctx.effect(() => () => clearInterval(tick))

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
  // `desktopBadge` is not checked here on purpose: it is volatile, and the
  // watch has to exist to notice it being switched back on.
  if (config?.enabled === false) return

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
