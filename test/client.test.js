import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'client.js')

let loadCount = 0

/**
 * client.js is a browser bundle: it touches window/document at import time and
 * captures window.__ModuleLoader__.load. Give it just enough DOM to run, then
 * hand back the module the loader received.
 */
async function loadClient(options = {}) {
  const env = createEnv(options)
  globalThis.window = env.window
  globalThis.document = env.document
  globalThis.Image = env.Image
  globalThis.Audio = env.Audio

  loadCount += 1
  const url = pathToFileURL(clientPath).href + '?case=' + loadCount
  await import(url)

  const mod = env.window.__dshModule
  assert.ok(mod, 'client.js must call window.__ModuleLoader__.load')
  return { env, mod: mod.factory(function () { throw new Error('no require') }) }
}

function makeContext2d() {
  return new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key]
      return function () {}
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
}

function createEnv(options = {}) {
  const faviconWrites = []
  const baseHref = 'data:image/svg+xml;base64,BASE'

  const link = {
    rel: 'icon',
    parentNode: null,
    getAttribute(name) {
      if (name !== 'href') return null
      return faviconWrites.length ? faviconWrites[faviconWrites.length - 1] : baseHref
    },
    setAttribute(name, value) {
      if (name === 'href') faviconWrites.push(value)
    },
  }

  const head = {
    appendChild(node) {
      node.parentNode = head
    },
  }

  const document = {
    title: options.title || 'DeepSeek Harness',
    visibilityState: 'visible',
    head,
    createElement(tag) {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => makeContext2d(),
          toDataURL: () => 'data:image/png;base64,FAKE',
        }
      }
      return { rel: '', parentNode: null, setAttribute() {} }
    },
    querySelector(selector) {
      return String(selector).includes('icon') ? link : null
    },
    addEventListener() {},
  }
  link.parentNode = head

  const window = {
    __ModuleLoader__: {
      load(mod) {
        window.__dshModule = mod
      },
    },
    addEventListener() {},
  }

  class FakeImage {
    set src(value) {
      this._src = value
    }
    get src() {
      return this._src
    }
  }

  class FakeAudio {
    constructor() {
      this.volume = 1
    }
    play() {
      return Promise.resolve()
    }
  }

  return {
    window,
    document,
    Image: FakeImage,
    Audio: FakeAudio,
    faviconWrites,
    baseHref,
    link,
  }
}

function createSessions() {
  const rows = {
    'session-a': { id: 'session-a', title: '主会话', running: false, pendingInteraction: undefined, origin: 'user' },
    'session-sub': { id: 'session-sub', title: '子代理', running: false, pendingInteraction: undefined, origin: 'subagent' },
  }
  const ids = Object.keys(rows)
  let subscribers = []

  function emit() {
    subscribers.slice().forEach((fn) => fn())
  }

  return {
    list: {
      getSnapshot() {
        return { ids: ids.slice(), byId: rows }
      },
      subscribe(fn) {
        subscribers.push(fn)
        return () => {
          subscribers = subscribers.filter((item) => item !== fn)
        }
      },
    },
    update(id, patch) {
      Object.assign(rows[id], patch)
      emit()
    },
  }
}

function makeCtx(sessions) {
  return {
    get(name) {
      return name === 'sessions' ? sessions : null
    },
    effect(fn) {
      return fn()
    },
  }
}

test('apply exposes the manual API and leaves the favicon alone until a turn ends', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { minTurnDurationMs: 0 })

  const api = env.window.__DSH_BADGE_NOTIFY__
  assert.ok(api, 'manual API must be exposed')
  assert.equal(api.getCount(), 0)
  assert.equal(env.document.title, 'DeepSeek Harness')
  assert.equal(env.faviconWrites.length, 0, 'no badge before the first finished turn')
})

test('a finished turn increments the badge, prefixes the title and redraws the icon', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { minTurnDurationMs: 0 })

  sessions.update('session-a', { running: true })
  sessions.update('session-a', { running: false })

  assert.equal(env.window.__DSH_BADGE_NOTIFY__.getCount(), 1)
  assert.equal(env.document.title, '(1) DeepSeek Harness')
  assert.equal(env.faviconWrites.length, 1)
  assert.match(env.faviconWrites[0], /^data:image\/png/)
})

test('clear resets both the count and the title', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { minTurnDurationMs: 0 })

  sessions.update('session-a', { running: true })
  sessions.update('session-a', { running: false })
  env.window.__DSH_BADGE_NOTIFY__.clear()

  assert.equal(env.window.__DSH_BADGE_NOTIFY__.getCount(), 0)
  assert.equal(env.document.title, 'DeepSeek Harness')
})

test('turns shorter than minTurnDurationMs stay silent', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { minTurnDurationMs: 60_000 })

  sessions.update('session-a', { running: true })
  sessions.update('session-a', { running: false })

  assert.equal(env.window.__DSH_BADGE_NOTIFY__.getCount(), 0)
  assert.equal(env.document.title, 'DeepSeek Harness')
})

test('subagent sessions never raise the badge', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { minTurnDurationMs: 0 })

  sessions.update('session-sub', { running: true })
  sessions.update('session-sub', { running: false })

  assert.equal(env.window.__DSH_BADGE_NOTIFY__.getCount(), 0)
})

test('badge:false keeps the icon untouched while the title still counts', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { minTurnDurationMs: 0, badge: false })

  sessions.update('session-a', { running: true })
  sessions.update('session-a', { running: false })

  assert.equal(env.window.__DSH_BADGE_NOTIFY__.getCount(), 1)
  assert.equal(env.document.title, '(1) DeepSeek Harness')
  assert.equal(env.faviconWrites.length, 0)
})

test('enabled:false leaves the plugin inert', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { enabled: false })

  sessions.update('session-a', { running: true })
  sessions.update('session-a', { running: false })

  assert.equal(env.window.__DSH_BADGE_NOTIFY__, undefined)
  assert.equal(env.document.title, 'DeepSeek Harness')
})
