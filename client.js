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

    var inject = ['sessions']

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
      return {
        enabled: cfg.enabled !== false,
        badge: cfg.badge !== false,
        titlePrefix: cfg.titlePrefix !== false,
        sound: cfg.sound !== false,
        soundPreset: typeof cfg.soundPreset === 'string' ? cfg.soundPreset : 'chime',
        soundUrl: typeof cfg.soundUrl === 'string' ? cfg.soundUrl : '',
        volume: typeof cfg.volume === 'number' ? Math.min(1, Math.max(0, cfg.volume)) : 0.5,
        minTurnDurationMs: typeof cfg.minTurnDurationMs === 'number' ? cfg.minTurnDurationMs : 3000,
        clearOnFocus: cfg.clearOnFocus !== false,
        errorSound: cfg.errorSound === true,
        badgeColor: /^#[0-9a-f]{3,8}$/i.test(String(cfg.badgeColor || '')) ? String(cfg.badgeColor) : '#f5455c',
        badgePosition: cfg.badgePosition === 'tr' ? 'tr' : 'br',
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

    function playSound(kind) {
      var cfg = state.cfg
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
      var now = ac.currentTime + 0.02
      var vol = cfg.volume * 0.4

      if (kind === 'error') {
        tone(ac, 392.0, now, 0.22, 'triangle', vol)
        tone(ac, 311.13, now + 0.16, 0.3, 'triangle', vol)
        return
      }

      if (cfg.soundPreset === 'beep') {
        tone(ac, 1000, now, 0.14, 'square', vol * 0.6)
        return
      }

      tone(ac, 880.0, now, 0.26, 'sine', vol)
      tone(ac, 1174.66, now + 0.1, 0.34, 'sine', vol)
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

      // Manual hooks: `__DSH_BADGE__.test(3)` in the devtools console,
      // and the same surface the demo page drives.
      window.__DSH_BADGE__ = {
        config: cfg,
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
