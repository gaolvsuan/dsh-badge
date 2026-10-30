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
  return { env, mod: mod.factory(options.require || function () { throw new Error('no require') }) }
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

  const api = env.window.__DSH_BADGE__
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

  assert.equal(env.window.__DSH_BADGE__.getCount(), 1)
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
  env.window.__DSH_BADGE__.clear()

  assert.equal(env.window.__DSH_BADGE__.getCount(), 0)
  assert.equal(env.document.title, 'DeepSeek Harness')
})

test('turns shorter than minTurnDurationMs stay silent', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { minTurnDurationMs: 60_000 })

  sessions.update('session-a', { running: true })
  sessions.update('session-a', { running: false })

  assert.equal(env.window.__DSH_BADGE__.getCount(), 0)
  assert.equal(env.document.title, 'DeepSeek Harness')
})

test('subagent sessions never raise the badge', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { minTurnDurationMs: 0 })

  sessions.update('session-sub', { running: true })
  sessions.update('session-sub', { running: false })

  assert.equal(env.window.__DSH_BADGE__.getCount(), 0)
})

test('badge:false keeps the icon untouched while the title still counts', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { minTurnDurationMs: 0, badge: false })

  sessions.update('session-a', { running: true })
  sessions.update('session-a', { running: false })

  assert.equal(env.window.__DSH_BADGE__.getCount(), 1)
  assert.equal(env.document.title, '(1) DeepSeek Harness')
  assert.equal(env.faviconWrites.length, 0)
})

test('enabled:false leaves the plugin inert', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()
  mod.apply(makeCtx(sessions), { enabled: false })

  sessions.update('session-a', { running: true })
  sessions.update('session-a', { running: false })

  assert.equal(env.window.__DSH_BADGE__, undefined)
  assert.equal(env.document.title, 'DeepSeek Harness')
})

/* ------------------------------------------------------------------ settings */

function createSettingsStubs() {
  const calls = { specs: [], registrations: [], namespaces: [] }

  class FakeForm {
    constructor(scope, specs) {
      this.scope = scope
      calls.specs = specs
    }
    shell() {
      return { writable: true }
    }
    field() {
      return { text: '', overridden: false, invalid: false }
    }
    actions() {
      return { save() {}, discard() {}, edit() {}, resetField() {} }
    }
    bind(projection) {
      const useHook = function (selector) {
        return selector(projection())
      }
      return useHook
    }
    dispose() {}
  }

  const primitives = {
    SettingsForm: 'SettingsForm',
    SettingsValueField: 'SettingsValueField',
    SettingsFormModel: FakeForm,
    settingsTextField: (name) => ({ kind: 'text', name }),
    settingsNumberField: (name) => ({ kind: 'number', name }),
  }

  const runtime = {
    jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }),
  }

  const require = (id) => {
    if (id === 'react/jsx-runtime') return runtime
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('unexpected require: ' + id)
  }

  const locale = {
    bind: () => (key) => key,
    register: () => () => {},
  }

  const slots = {
    inject: (name, fn) => fn(),
    register: (registration, component) => {
      calls.registrations.push({ registration, component })
      return () => {}
    },
  }

  const configForms = {
    whileServed(namespaces, register) {
      calls.namespaces = namespaces
      return register(new Set(['badge']))
    },
    get(namespace) {
      return { namespace }
    },
  }

  return { calls, require, locale, slots, configForms }
}

function makeSettingsCtx(sessions, stubs) {
  const base = makeCtx(sessions)
  return {
    ...base,
    get(name) {
      if (name === 'sessions') return sessions
      if (name === 'configForms') return stubs.configForms
      if (name === 'slots') return stubs.slots
      if (name === 'locale') return stubs.locale
      return null
    },
  }
}

test('registers a Plugins-page card when the Host serves the namespace', async () => {
  const stubs = createSettingsStubs()
  const { mod } = await loadClient({ require: stubs.require })
  const sessions = createSessions()

  mod.apply(makeSettingsCtx(sessions, stubs), { minTurnDurationMs: 0 })

  assert.deepEqual(stubs.calls.namespaces, ['badge', 'badge-notify'])
  assert.equal(stubs.calls.registrations.length, 1)

  const { registration, component } = stubs.calls.registrations[0]
  assert.equal(registration.name, 'plugins.bundle.config')
  assert.equal(registration.key, 'dsh-badge')
  assert.equal(registration.label(), 'title')

  const face = registration.inject()
  assert.ok(face.hooks && face.hooks.badgeCard, 'card face must carry the hook store')
  assert.equal(typeof face.save, 'function')

  assert.equal(component({ view: 'summary', t: (key) => key, useBadgeCard: face.hooks.badgeCard }), 'description')

  const rendered = component({
    view: 'form',
    t: (key) => key,
    useBadgeCard: face.hooks.badgeCard,
    save() {},
    discard() {},
    edit() {},
    resetField() {},
  })
  assert.equal(rendered.type, 'div')
  assert.equal(rendered.props.children.length, 6, 'colour, corner, sound, volume, duration, footer')
})

test('a missing configForms service never breaks the badge', async () => {
  const { env, mod } = await loadClient()
  const sessions = createSessions()

  mod.apply(makeCtx(sessions), { minTurnDurationMs: 0 })
  sessions.update('session-a', { running: true })
  sessions.update('session-a', { running: false })

  assert.equal(env.window.__DSH_BADGE__.getCount(), 1)
})
