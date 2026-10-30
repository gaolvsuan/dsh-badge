/* dsh-badge — client bundle.
 *
 * Two things the host half cannot do, because both belong to the page:
 *
 *   1. Draw the unread count on the tab icon. The favicon is redrawn on a
 *      canvas (original icon + a red disc with the number) and swapped in
 *      through the <link rel="icon"> element, so no asset ships with the
 *      plugin and the browser does not refetch anything.
 *   2. Chime when a turn finishes. The tone is synthesised with Web Audio,
 *      which needs no audio file and no network round trip.
 *
 * The count increments when a session flips running -> idle, and resets when
 * the tab regains focus (configurable).
 *
 * Hand-written in the shape the loader expects, so the package needs no build
 * step: window.__ModuleLoader__.load({ id, factory }).
 */
window.__ModuleLoader__.load({
  id: 'dsh-badge',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var inject = ['sessions', 'slots', 'locale']

    var ICON_SIZE = 64
    var BADGE_COLOR = '#f5455c'
    var BRAND_COLOR = '#4d6bfe'

    var state = {
      unread: 0,
      baseIcon: null,
      baseIconLoaded: false,
      iconLink: null,
      audio: null,
      cfg: null,
      prev: new Map(),
    }

    /* ---------------------------------------------------------------- config */

    function readConfig(raw) {
      var cfg = raw || {}

      // A volatile field can arrive as a reference with get(); reading it as a
      // plain value yields the object and every check falls back to the default.
      function pick(name, fallback) {
        var value = cfg[name]
        if (value === undefined || value === null) return fallback
        if (typeof value === 'object' && typeof value.get === 'function') {
          try {
            value = value.get()
          } catch (error) {
            return fallback
          }
        }
        return value === undefined || value === null ? fallback : value
      }

      var volumeValue = Number(pick('volume', 0.5))
      var durationValue = Number(pick('minTurnDurationMs', 3000))
      var colorValue = String(pick('badgeColor', '') || '')

      return {
        enabled: pick('enabled', true) !== false,
        badge: pick('badge', true) !== false,
        titlePrefix: pick('titlePrefix', true) !== false,
        sound: pick('sound', true) !== false,
        soundPreset: typeof pick('soundPreset', 'chime') === 'string' ? pick('soundPreset', 'chime') : 'chime',
        soundUrl: typeof pick('soundUrl', '') === 'string' ? pick('soundUrl', '') : '',
        volume: isFinite(volumeValue) ? Math.min(1, Math.max(0, volumeValue)) : 0.5,
        minTurnDurationMs: isFinite(durationValue) ? durationValue : 3000,
        clearOnFocus: pick('clearOnFocus', true) !== false,
        errorSound: pick('errorSound', false) === true,
        badgeColor: /^#[0-9a-f]{3,8}$/i.test(colorValue) ? colorValue : '#f5455c',
        badgePosition: pick('badgePosition', 'br') === 'tr' ? 'tr' : 'br',
      }
    }

    /* --------------------------------------------------------------- favicon */

    function iconLink() {
      if (state.iconLink && state.iconLink.parentNode) return state.iconLink
      var link = document.querySelector('link[rel~="icon"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      state.iconLink = link
      return link
    }

    // Capture the site's own icon once, before any badge replaces the href.
    function loadBaseIcon() {
      if (state.baseIconLoaded) return
      state.baseIconLoaded = true
      var link = document.querySelector('link[rel~="icon"]')
      var href = link && link.getAttribute('href')
      if (!href) return
      var img = new Image()
      img.onload = function () {
        state.baseIcon = img
        if (state.unread > 0) paint()
      }
      img.onerror = function () {
        state.baseIcon = null
      }
      img.src = href
    }

    function roundRect(g, x, y, w, h, r) {
      g.beginPath()
      g.moveTo(x + r, y)
      g.arcTo(x + w, y, x + w, y + h, r)
      g.arcTo(x + w, y + h, x, y + h, r)
      g.arcTo(x, y + h, x, y, r)
      g.arcTo(x, y, x + w, y, r)
      g.closePath()
    }

    function paint() {
      var cfg = state.cfg
      if (!cfg || !cfg.badge || typeof document === 'undefined') return

      var canvas = document.createElement('canvas')
      canvas.width = ICON_SIZE
      canvas.height = ICON_SIZE
      var g = canvas.getContext('2d')
      if (!g) return

      if (state.baseIcon) {
        g.drawImage(state.baseIcon, 0, 0, ICON_SIZE, ICON_SIZE)
      } else {
        g.fillStyle = BRAND_COLOR
        roundRect(g, 0, 0, ICON_SIZE, ICON_SIZE, 14)
        g.fill()
      }

      var count = state.unread
      if (count > 0) {
        var label = count > 99 ? '99+' : String(count)
        var r = ICON_SIZE * 0.33
        var cx = cfg.badgePosition === 'tr' ? r + 1 : ICON_SIZE - r - 1
        var cy = r + 1

        g.beginPath()
        g.arc(cx, cy, r, 0, Math.PI * 2)
        g.fillStyle = cfg.badgeColor
        g.fill()
        g.lineWidth = 3
        g.strokeStyle = 'rgba(255, 255, 255, 0.92)'
        g.stroke()

        g.fillStyle = '#ffffff'
        g.font = 'bold ' + (label.length > 2 ? 19 : label.length > 1 ? 25 : 30) + 'px system-ui, sans-serif'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(label, cx, cy + 1)
      }

      iconLink().setAttribute('href', canvas.toDataURL('image/png'))
    }

    /* ----------------------------------------------------------------- title */

    function applyTitle() {
      if (typeof document === 'undefined') return
      var cfg = state.cfg
      // Strip our own prefix instead of caching a base title: the app renames
      // the document as sessions change, and a cached title would go stale.
      var current = String(document.title || '')
      var base = current.replace(/^\(\d+\)\s*/, '') || 'DeepSeek Harness'
      if (cfg && cfg.titlePrefix && state.unread > 0) {
        document.title = '(' + state.unread + ') ' + base
      } else {
        document.title = base
      }
    }

    /* ----------------------------------------------------------------- sound */

    function ensureAudio() {
      if (!state.audio) {
        try {
          var Ctor = window.AudioContext || window.webkitAudioContext
          if (!Ctor) return null
          state.audio = new Ctor()
        } catch (e) {
          return null
        }
      }
      if (state.audio.state === 'suspended') {
        try {
          state.audio.resume()
        } catch (e) {}
      }
      return state.audio
    }

    // Browsers block audio until the user interacts with the page. Resume on
    // the first gesture and keep listening only until it works once.
    function armAudio() {
      function unlock() {
        var ac = ensureAudio()
        if (ac && ac.state === 'running') {
          window.removeEventListener('pointerdown', unlock, true)
          window.removeEventListener('keydown', unlock, true)
        }
      }
      window.addEventListener('pointerdown', unlock, true)
      window.addEventListener('keydown', unlock, true)
    }

    function tone(ac, freq, at, duration, type, volume) {
      var osc = ac.createOscillator()
      var gain = ac.createGain()
      osc.type = type || 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start(at)
      osc.stop(at + duration + 0.02)
    }

    function schedule(ac, cfg, kind) {
      var now = ac.currentTime + 0.02
      // Perceptual rather than linear: a linear 0.15 against 1.0 reads as the
      // same short blip on small speakers, so the low end is pulled down harder.
      var vol = Math.pow(Math.min(1, Math.max(0, cfg.volume)), 1.6) * 0.9
      state.lastChime = { volume: cfg.volume, preset: cfg.soundPreset, kind: kind, gain: vol }

      if (kind === 'error') {
        tone(ac, 392.0, now, 0.22, 'triangle', vol)
        tone(ac, 311.13, now + 0.16, 0.3, 'triangle', vol)
        return
      }

      if (cfg.soundPreset === 'beep') {
        tone(ac, 1000, now, 0.14, 'square', vol * 0.6)
        return
      }

      if (cfg.soundPreset === 'rise') {
        tone(ac, 659.25, now, 0.2, 'triangle', vol)
        tone(ac, 880.0, now + 0.09, 0.22, 'triangle', vol)
        tone(ac, 1318.51, now + 0.18, 0.3, 'triangle', vol)
        return
      }

      tone(ac, 880.0, now, 0.26, 'sine', vol)
      tone(ac, 1174.66, now + 0.1, 0.34, 'sine', vol)
    }

    function playSound(kind, override) {
      var cfg = override || state.cfg
      if (!cfg || !cfg.sound) return
      if (kind === 'error' && !cfg.errorSound) return

      if (cfg.soundUrl) {
        try {
          var audio = new Audio(cfg.soundUrl)
          audio.volume = cfg.volume
          var p = audio.play()
          if (p && p.catch) p.catch(function () {})
        } catch (e) {}
        return
      }

      var ac = ensureAudio()
      if (!ac) return

      // A suspended context resumes asynchronously. Scheduling into it right
      // away drops the notes, which is why the first click used to be silent.
      if (ac.state === 'suspended' && typeof ac.resume === 'function') {
        var resumed = ac.resume()
        if (resumed && typeof resumed.then === 'function') {
          resumed.then(function () {
            schedule(ac, cfg, kind)
          }).catch(function () {})
          return
        }
      }

      schedule(ac, cfg, kind)
    }

    /* ---------------------------------------------------------------- counter */

    function clear() {
      if (state.unread === 0) return
      state.unread = 0
      paint()
      applyTitle()
    }

    function bump(kind) {
      state.unread += 1
      paint()
      applyTitle()
      playSound(kind || 'done')
    }

    function armAutoClear() {
      if (typeof document === 'undefined') return
      function maybeClear() {
        if (!state.cfg || !state.cfg.clearOnFocus) return
        if (document.visibilityState !== 'visible') return
        // Small delay: the user may be glancing at the tab, not reading it.
        setTimeout(clear, 1200)
      }
      document.addEventListener('visibilitychange', maybeClear)
      window.addEventListener('focus', function () {
        setTimeout(maybeClear, 200)
      })
    }

    /* --------------------------------------------------------------- sessions */

    function snapshotRow(row) {
      return { pending: row.pendingInteraction, running: !!row.running, runningSince: 0 }
    }

    function watchSessions(sessions, ctx) {
      var list = sessions.list
      if (!list || typeof list.getSnapshot !== 'function' || typeof list.subscribe !== 'function') {
        return
      }

      var prev = state.prev
      var snap = list.getSnapshot()
      var ids = snap.ids || []
      for (var i = 0; i < ids.length; i++) {
        var row = snap.byId[ids[i]]
        if (row) prev.set(ids[i], snapshotRow(row))
      }

      var unsubscribe = list.subscribe(function () {
        var next = list.getSnapshot()
        var nextIds = next.ids || []
        for (var j = 0; j < nextIds.length; j++) {
          var id = nextIds[j]
          var item = next.byId[id]
          if (!item) continue
          if (item.origin === 'subagent') continue

          var seen = prev.get(id)
          if (!seen) {
            prev.set(id, snapshotRow(item))
            continue
          }

          if (!seen.running && item.running) {
            seen.runningSince = Date.now()
          }

          if (seen.running && !item.running) {
            var elapsed = seen.runningSince ? Date.now() - seen.runningSince : null
            var min = state.cfg ? state.cfg.minTurnDurationMs : 3000
            if (elapsed === null || elapsed >= min) bump('done')
          }

          seen.pending = item.pendingInteraction
          seen.running = !!item.running
          prev.set(id, seen)
        }
      })

      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            unsubscribe()
          }
        }, 'dsh-badge: session watch')
      }
    }

    /* --------------------------------------------------------------- settings */

    // The Plugins page in the settings sidebar hosts one card per configurable
    // plugin. A card registers into `plugins.item` and only appears while the
    // Host serves the matching settings namespace, so a deployment that never
    // loaded this plugin shows no trace of the page.
    var SETTINGS_NS = 'settings.badge'
    var NAMESPACES = ['badge', 'dsh-badge', 'badge-notify']
    // The bundle config slot is keyed by the installed package name; the browser
    // half cannot read package.json, so the name is spelled here.
    var BUNDLE_NAME = 'dsh-badge'

    var COPY = {
      zh: {
        title: '角标',
        description: '回合结束时的未读角标与提示音。',
        badgeColorLabel: '角标颜色',
        badgeColorHint: '十六进制颜色，例如 #f5455c。',
        badgePositionLabel: '角标位置',
        badgePositionHint: 'br 表示右下角，tr 表示右上角。',
        soundPresetLabel: '提示音',
        soundPresetHint: 'chime 是两音铃声，beep 是单声方波。',
        volumeLabel: '音量',
        volumeHint: '0 到 1 之间的小数。',
        minTurnDurationMsLabel: '最短回合时长（毫秒）',
        minTurnDurationHint: '短于该时长的回合不计角标、不响。',
        positionBottomRight: '右下角',
        positionTopRight: '右上角',
        presetChime: '两音铃声',
        presetBeep: '单声方波',
        presetRise: '三音上行',
        preview: '试听当前音色',
        autoSaved: '已自动保存',
        retrySave: '重试保存',
        discard: '取消修改',
        overridden: '已覆盖',
        reset: '恢复默认',
        invalid: '这个值不合法，改好再保存。',
        save: '保存',
        saving: '保存中…',
        saveFailed: '部署没有接受这些值，已保留供你修改。',
        readOnly: '本部署的设置为只读。',
        unavailable: '该插件当前未加载，暂时无法配置。',
      },
      en: {
        title: 'Badge',
        description: 'The unread badge and chime for finished turns.',
        badgeColorLabel: 'Badge colour',
        badgeColorHint: 'Hex colour such as #f5455c.',
        badgePositionLabel: 'Badge corner',
        badgePositionHint: 'br for the bottom-right corner, tr for the top-right.',
        soundPresetLabel: 'Chime',
        soundPresetHint: 'chime is a two-note bell, beep a single square blip.',
        volumeLabel: 'Volume',
        volumeHint: 'A decimal between 0 and 1.',
        minTurnDurationMsLabel: 'Minimum turn length (ms)',
        minTurnDurationHint: 'Shorter turns stay quiet and raise no badge.',
        positionBottomRight: 'Bottom right',
        positionTopRight: 'Top right',
        presetChime: 'Two-note chime',
        presetBeep: 'Square blip',
        presetRise: 'Three-note rise',
        preview: 'Preview current tone',
        autoSaved: 'Saved automatically',
        retrySave: 'Retry save',
        discard: 'Discard',
        overridden: 'Overridden',
        reset: 'Reset to default',
        invalid: 'That value is not valid; fix it before saving.',
        save: 'Save',
        saving: 'Saving…',
        saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
        readOnly: 'This deployment stores settings read-only.',
        unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      },
    }

    var FIELDS = ['badgeColor', 'badgePosition', 'soundPreset', 'volume', 'minTurnDurationMs']

    // Why the settings form is or is not on screen. Read it from the devtools
    // console with `__DSH_BADGE__.diag` when the page shows nothing.
    var DIAG = { build: '0.8.2', reason: '', served: null, registered: false }

    // `configForms` is not reachable as a property or through ctx.get; the
    // documented way is a dynamic inject, which hands back a child context
    // that carries it. Same shape dsh-context uses.
    function setupSettingsCard(ctx) {
      if (!ctx || typeof ctx.inject !== 'function') {
        DIAG.reason = 'ctx.inject missing'
        return
      }
      ctx.inject(['configForms'], function (child) {
        try {
          mountSettingsCard(child)
        } catch (error) {
          DIAG.reason = 'mount failed: ' + (error && error.message)
        }
      })
    }

    function mountSettingsCard(ctx) {
      var configForms = ctx.configForms
      var slots = ctx.slots
      var locale = ctx.locale
      if (!configForms || !slots || !locale) {
        DIAG.reason = 'missing service: ' + [!configForms && 'configForms', !slots && 'slots', !locale && 'locale'].filter(Boolean).join(',')
        return
      }
      if (typeof configForms.whileServed !== 'function') {
        DIAG.reason = 'configForms has no whileServed'
        return
      }

      // Ask the mirror which namespaces the Host actually serves, so a blank
      // page names the reason instead of leaving it to guesswork.
      try {
        DIAG.formsApi = Object.keys(configForms)
        if (typeof configForms.describe === 'function') {
          var described = configForms.describe()
          if (described && typeof described === 'object') {
            DIAG.describeKeys = Object.keys(described).slice(0, 12)
            DIAG.describe = Array.from(
              described.namespaces || described.served || described.entries || Object.keys(described),
            ).slice(0, 40)
          } else {
            DIAG.describe = String(described)
          }
        }
      } catch (error) {
        DIAG.describe = 'err: ' + (error && error.message)
      }

      var runtime
      var primitives
      var react
      try {
        runtime = require('react/jsx-runtime')
        primitives = require('@deepseek-ai/dsh-client-ui-primitives')
        react = require('react')
      } catch (error) {
        DIAG.reason = 'require failed: ' + (error && error.message)
        return
      }

      var jsx = runtime.jsx
      var jsxs = runtime.jsxs
      var SettingsFormModel = primitives.SettingsFormModel
      if (!jsx || !jsxs || !SettingsFormModel || !react || typeof react.useState !== 'function') {
        DIAG.reason = 'primitives missing jsx runtime, SettingsFormModel or useState'
        return
      }

      var t = locale.bind(SETTINGS_NS)
      ctx.effect(function () {
        return locale.register(SETTINGS_NS, COPY)
      }, 'dsh-badge: settings copy')

      function BadgeCardController(scope) {
        var self = this
        this.form = new SettingsFormModel(scope, [
          primitives.settingsTextField('badgeColor'),
          primitives.settingsTextField('badgePosition'),
          primitives.settingsTextField('soundPreset'),
          primitives.settingsNumberField('volume'),
          primitives.settingsNumberField('minTurnDurationMs'),
        ])
        this.store = this.form.bind(function () {
          var snapshot = self.form.shell()
          for (var i = 0; i < FIELDS.length; i += 1) {
            snapshot[FIELDS[i]] = self.form.field(FIELDS[i])
          }
          return snapshot
        })
      }
      BadgeCardController.prototype.inject = function () {
        var face = { hooks: { badgeCard: this.store } }
        var actions = this.form.actions()
        for (var key in actions) face[key] = actions[key]
        return face
      }
      BadgeCardController.prototype.dispose = function () {
        this.form.dispose()
      }

      // Colours the badge can take with one click; the picker covers the rest.
      var PRESET_COLORS = ['#f5455c', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#111827']

      var LABEL = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }
      var HINT = { margin: '6px 0 0', fontSize: 12, opacity: 0.6 }
      var ROW = { marginBottom: 18 }
      var SWATCH = {
        width: 26,
        height: 26,
        padding: 0,
        borderRadius: '50%',
        border: '2px solid transparent',
        cursor: 'pointer',
      }

      function tag(text) {
        return jsx('span', {
          children: text,
          style: {
            marginLeft: 8,
            padding: '1px 6px',
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 500,
            background: 'rgba(128,128,128,0.18)',
          },
        })
      }

      function choice(options, current, onPick, disabled) {
        return jsx('div', {
          style: { display: 'flex', gap: 8, flexWrap: 'wrap' },
          children: options.map(function (option) {
            var active = option.value === current
            return jsx('button', {
              type: 'button',
              key: option.value,
              disabled: disabled,
              onClick: function () {
                onPick(option.value)
              },
              children: option.label,
              style: {
                padding: '6px 14px',
                borderRadius: 8,
                font: 'inherit',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: 'inherit',
                cursor: disabled ? 'default' : 'pointer',
                border: '1px solid ' + (active ? 'currentColor' : 'rgba(128,128,128,0.35)'),
                background: active ? 'rgba(128,128,128,0.16)' : 'transparent',
              },
            })
          }),
        })
      }

      function BadgeCard(props) {
        var translate = props.t || t
        var snapshot = props.useBadgeCard(function (state) {
          return state
        })
        // The staged form echoes the Host's accepted value back, which can land
        // a frame late and snap a fresh pick back to the previous one. The local
        // draft wins until the accepted value catches up.
        var draftPair = react.useState({})
        var draft = draftPair[0] || {}
        var setDraft = draftPair[1]
        if (props.view === 'summary') return translate('description')

        var writable = snapshot.writable !== false
        var text = function (name) {
          var field = snapshot[name]
          return field && typeof field.text === 'string' ? field.text : ''
        }
        var value = function (name) {
          return Object.prototype.hasOwnProperty.call(draft, name) ? draft[name] : text(name)
        }

        // Changes take effect on the badge as they are made and are written
        // straight through. Only the slider debounces, because a drag fires on
        // every pixel and each write bumps the Host revision.
        var saveTimer = null
        var applyLive = function (patch) {
          if (!state.cfg) return
          state.cfg = Object.assign({}, state.cfg, patch)
          if (state.unread > 0) paint()
        }
        var flush = function () {
          try {
            props.save()
          } catch (error) {}
        }
        var edit = function (name) {
          return function (value) {
            props.edit(name, String(value))
            setDraft(function (previous) {
              var next = Object.assign({}, previous)
              next[name] = String(value)
              return next
            })
            var patch = {}
            if (name === 'volume') patch.volume = Number(value)
            else if (name === 'minTurnDurationMs') patch.minTurnDurationMs = Number(value) || 0
            else patch[name] = value
            applyLive(patch)
            if (name === 'volume') {
              if (saveTimer) clearTimeout(saveTimer)
              saveTimer = setTimeout(flush, 450)
              return
            }
            flush()
          }
        }
        var heading = function (name, key) {
          var field = snapshot[name]
          return jsxs('label', {
            style: LABEL,
            children: [
              translate(key + 'Label'),
              field && field.overridden ? tag(translate('overridden')) : null,
            ],
          })
        }

        var color = value('badgeColor') || '#f5455c'
        var position = value('badgePosition') || 'br'
        var preset = value('soundPreset') || 'chime'
        var volume = Number(value('volume'))
        if (!isFinite(volume)) volume = 0.5
        var duration = value('minTurnDurationMs') || '3000'

        var colorRow = jsxs('div', {
          style: ROW,
          children: [
            heading('badgeColor', 'badgeColor'),
            jsxs('div', {
              style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
              children: PRESET_COLORS.map(function (value) {
                var active = value.toLowerCase() === color.toLowerCase()
                return jsx('button', {
                  type: 'button',
                  key: value,
                  disabled: !writable,
                  title: value,
                  onClick: function () {
                    edit('badgeColor')(value)
                  },
                  style: {
                    width: SWATCH.width,
                    height: SWATCH.height,
                    padding: 0,
                    borderRadius: '50%',
                    background: value,
                    cursor: writable ? 'pointer' : 'default',
                    border: active ? '2px solid currentColor' : '2px solid rgba(128,128,128,0.25)',
                  },
                })
              }).concat([
                jsx('input', {
                  type: 'color',
                  disabled: !writable,
                  value: color,
                  onChange: function (event) {
                    edit('badgeColor')(event.target.value)
                  },
                  style: {
                    width: 44,
                    height: 30,
                    padding: 0,
                    borderRadius: 6,
                    cursor: writable ? 'pointer' : 'default',
                    border: '1px solid rgba(128,128,128,0.35)',
                    background: 'transparent',
                  },
                }),
              ]),
            }),
            jsx('p', { style: HINT }, translate('badgeColorHint')),
          ],
        })

        var positionRow = jsxs('div', {
          style: ROW,
          children: [
            heading('badgePosition', 'badgePosition'),
            choice([
              { value: 'br', label: translate('positionBottomRight') },
              { value: 'tr', label: translate('positionTopRight') },
            ], position, edit('badgePosition'), !writable),
            jsx('p', { style: HINT }, translate('badgePositionHint')),
          ],
        })

        var soundRow = jsxs('div', {
          style: ROW,
          children: [
            heading('soundPreset', 'soundPreset'),
            jsxs('div', {
              style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
              children: [
                choice([
                  { value: 'chime', label: translate('presetChime') },
                  { value: 'beep', label: translate('presetBeep') },
                  { value: 'rise', label: translate('presetRise') },
                ], preset, function (value) {
                  edit('soundPreset')(value)
                  // Picking a tone plays it; otherwise the click looks inert.
                  playSound('done', { sound: true, soundPreset: value, volume: volume, soundUrl: '' })
                }, !writable),
                jsx('button', {
                  type: 'button',
                  disabled: !writable,
                  onClick: function () {
                    playSound('done', { sound: true, soundPreset: preset, volume: volume, soundUrl: '' })
                  },
                  children: translate('preview'),
                  style: {
                    padding: '6px 14px',
                    borderRadius: 8,
                    font: 'inherit',
                    fontSize: 13,
                    color: 'inherit',
                    cursor: writable ? 'pointer' : 'default',
                    border: '1px dashed rgba(128,128,128,0.45)',
                    background: 'transparent',
                  },
                }),
              ],
            }),
            jsx('p', { style: HINT }, translate('soundPresetHint')),
          ],
        })

        var volumeRow = jsxs('div', {
          style: ROW,
          children: [
            heading('volume', 'volume'),
            jsxs('div', {
              style: { display: 'flex', alignItems: 'center', gap: 12 },
              children: [
                jsx('input', {
                  type: 'range',
                  min: 0,
                  max: 1,
                  step: 0.05,
                  disabled: !writable,
                  value: volume,
                  onChange: function (event) {
                    edit('volume')(event.target.value)
                  },
                  style: { flex: 1, maxWidth: 280, accentColor: color },
                }),
                jsx('span', {
                  style: { fontSize: 13, minWidth: 40, fontVariantNumeric: 'tabular-nums' },
                }, Math.round(volume * 100) + '%'),
              ],
            }),
            jsx('p', { style: HINT }, translate('volumeHint')),
          ],
        })

        var durationRow = jsxs('div', {
          style: ROW,
          children: [
            heading('minTurnDurationMs', 'minTurnDurationMs'),
            jsx('input', {
              type: 'number',
              min: 0,
              step: 500,
              disabled: !writable,
              value: duration,
              onChange: function (event) {
                edit('minTurnDurationMs')(event.target.value)
              },
              style: {
                width: 140,
                padding: '6px 10px',
                borderRadius: 8,
                font: 'inherit',
                fontSize: 13,
                color: 'inherit',
                background: 'transparent',
                border: '1px solid rgba(128,128,128,0.35)',
              },
            }),
            jsx('p', { style: HINT }, translate('minTurnDurationHint')),
          ],
        })

        var footer = jsxs('div', {
          style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 22 },
          children: [
            !writable
              ? jsx('span', { children: translate('readOnly'), style: { fontSize: 12, opacity: 0.6 } })
              : jsx('span', {
                children: snapshot.saving === true ? translate('saving') : translate('autoSaved'),
                style: { fontSize: 12, opacity: 0.6 },
              }),
            snapshot.saveFailed
              ? jsx('button', {
                type: 'button',
                onClick: function () {
                  props.save()
                },
                children: translate('retrySave'),
                style: {
                  padding: '5px 12px',
                  borderRadius: 8,
                  font: 'inherit',
                  fontSize: 12,
                  color: 'inherit',
                  cursor: 'pointer',
                  background: 'transparent',
                  border: '1px solid rgba(128,128,128,0.35)',
                },
              })
              : null,
          ],
        })

        return jsxs('div', {
          children: [colorRow, positionRow, soundRow, volumeRow, durationRow, footer],
        })
      }

      ctx.effect(function () {
        return configForms.whileServed(NAMESPACES, function (served) {
          try {
            DIAG.served = served && typeof served.forEach === 'function' ? Array.from(served) : String(served)
          } catch (error) {
            DIAG.served = 'unreadable'
          }
          var namespace = NAMESPACES[0]
          if (served && typeof served.has === 'function') {
            for (var i = 0; i < NAMESPACES.length; i += 1) {
              if (served.has(NAMESPACES[i])) {
                namespace = NAMESPACES[i]
                break
              }
            }
          }
          var scope = configForms.get(namespace)
          var controller = new BadgeCardController(scope)

          // Volatile fields are not serialized into the browser bundle, so the
          // config the page boots with holds only their defaults. The accepted
          // values live on the settings scope; adopt them and follow changes.
          try {
            var applyAccepted = function () {
              if (!scope || typeof scope.getSnapshot !== 'function') return
              var accepted = scope.getSnapshot()
              var values = accepted && accepted.value
              if (!values || typeof values !== 'object') return
              var patch = {}
              for (var key in values) {
                if (Object.prototype.hasOwnProperty.call(values, key)) patch[key] = values[key]
              }
              if (!state.cfg) return
              state.cfg = Object.assign({}, state.cfg, patch)
              if (state.unread > 0) paint()
            }
            applyAccepted()
            if (typeof scope.subscribe === 'function') {
              ctx.effect(function () {
                return scope.subscribe(applyAccepted)
              }, 'dsh-badge: accepted config')
            }
          } catch (error) {
            DIAG.reason = 'scope read failed: ' + (error && error.message)
          }

          // `plugins.item` is the official-plugin list; a community bundle gets
          // its form from `plugins.bundle.config`, keyed by the package name.
          var remove = slots.inject('plugins.bundle.config', function () {
            DIAG.registered = true
            return slots.register({
              name: 'plugins.bundle.config',
              key: BUNDLE_NAME,
              locale: SETTINGS_NS,
              inject: function () {
                return controller.inject()
              },
            }, BadgeCard)
          })
          return function () {
            try {
              remove()
            } catch (error) {}
            try {
              controller.dispose()
            } catch (error) {}
          }
        })
      }, 'dsh-badge: settings card')
    }

    /* ------------------------------------------------------------------ apply */

    function apply(ctx, config) {
      var cfg = readConfig(config)
      if (!cfg.enabled) return
      if (typeof document === 'undefined') return

      state.cfg = cfg
      loadBaseIcon()
      armAudio()
      armAutoClear()

      var sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
      if (sessions) watchSessions(sessions, ctx)

      // A broken settings card must never cost the user the badge or the chime.
      try {
        setupSettingsCard(ctx)
      } catch (error) {}

      // Manual hooks: `__DSH_BADGE__.test(3)` in the devtools console,
      // and the same surface the demo page drives.
      window.__DSH_BADGE__ = {
        // Live values, not the boot copy: the settings scope replaces state.cfg.
        get config() {
          return state.cfg
        },
        diag: DIAG,
        test: function (count) {
          state.unread = typeof count === 'number' && count > 0 ? Math.floor(count) : 1
          paint()
          applyTitle()
          playSound('done')
          return state.unread
        },
        setCount: function (count) {
          state.unread = Math.max(0, Math.floor(count || 0))
          paint()
          applyTitle()
          return state.unread
        },
        getCount: function () {
          return state.unread
        },
        lastChime: function () {
          return state.lastChime
        },
        clear: clear,
        sound: function (kind) {
          playSound(kind === 'error' ? 'error' : 'done')
        },
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
