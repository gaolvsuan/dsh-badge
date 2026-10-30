import { appendFileSync } from 'node:fs'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-badge-notify'

/**
 * The badge and the chime live in the browser: the tab icon, the document
 * title and the audio output all belong to the page that renders the session
 * list. The host half therefore only carries the config schema and keeps the
 * plugin loadable, so a profile can list it as a bundle.
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
  debugLog: Schema.string().default('')
    .description('Optional file path. When set, the host appends one line every time this plugin loads, which is how you tell a missing badge apart from a plugin that never mounted.'),
})

export function apply(ctx, config) {
  // Nothing to wire on the host side. Log once at debug level so a plugin
  // inventory page can show that the config reached this half.
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
}
