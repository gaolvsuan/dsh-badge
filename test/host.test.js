import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const indexPath = path.join(here, '..', 'index.js')

function createCtx() {
  const handlers = new Map()
  const disposers = []
  const routes = []
  return {
    routes,
    // The browser channel is an HTTP route on this deployment's web server.
    inject(deps, fn) {
      if (!deps.includes('webServer')) return
      fn({
        webServer: {
          register(route) {
            routes.push(route)
            return () => {}
          },
        },
      })
    },
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(fn)
    },
    emit(event, ...payload) {
      for (const fn of handlers.get(event) || []) fn(...payload)
    },
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    dispose() {
      while (disposers.length) disposers.pop()()
    },
    logger: { debug() {}, warn() {} },
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return predicate()
}

test('a finished turn reaches the taskbar helper', { skip: process.platform !== 'win32' }, async (t) => {
  let mod
  try {
    mod = await import(pathToFileURL(indexPath).href)
  } catch (error) {
    t.skip(`host half needs @deepseek-ai/schemastery: ${error.message}`)
    return
  }

  const logPath = path.join(os.tmpdir(), `dsh-badge-host-${process.pid}.log`)
  fs.rmSync(logPath, { force: true })

  const ctx = createCtx()
  const agent = {}

  mod.apply(ctx, {
    minTurnDurationMs: 0,
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
    // The loader hands volatile fields over as references with get().
    badgeColor: { get: () => '#3b82f6' },
  })

  try {
    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/status', { agent, status: 'idle' })

    const shown = await waitFor(() => {
      try {
        return fs.readFileSync(logPath, 'utf8').includes('state=shown count=1')
      } catch {
        return false
      }
    }, 20_000)

    assert.ok(shown, `helper never reported a painted badge; log:\n${readLog(logPath)}`)
    assert.ok(
      readLog(logPath).includes('helper-spawn badgeColor=#3b82f6'),
      `helper started without the configured colour; log:\n${readLog(logPath)}`,
    )
  } finally {
    ctx.dispose()
    fs.rmSync(logPath, { force: true })
  }
})

test('turns shorter than minTurnDurationMs never reach the helper', { skip: process.platform !== 'win32' }, async (t) => {
  let mod
  try {
    mod = await import(pathToFileURL(indexPath).href)
  } catch (error) {
    t.skip(`host half needs @deepseek-ai/schemastery: ${error.message}`)
    return
  }

  const logPath = path.join(os.tmpdir(), `dsh-badge-skip-${process.pid}.log`)
  fs.rmSync(logPath, { force: true })

  const ctx = createCtx()
  const agent = {}

  mod.apply(ctx, {
    minTurnDurationMs: 60_000,
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
  })

  try {
    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/status', { agent, status: 'idle' })

    await new Promise((resolve) => setTimeout(resolve, 3000))
    assert.ok(!readLog(logPath).includes('state=shown'), 'short turn must stay quiet')
  } finally {
    ctx.dispose()
    fs.rmSync(logPath, { force: true })
  }
})

test('subagent turns never raise the taskbar badge', { skip: process.platform !== 'win32' }, async (t) => {  let mod
  try {
    mod = await import(pathToFileURL(indexPath).href)
  } catch (error) {
    t.skip(`host half needs @deepseek-ai/schemastery: ${error.message}`)
    return
  }

  const logPath = path.join(os.tmpdir(), `dsh-badge-subagent-${process.pid}.log`)
  fs.rmSync(logPath, { force: true })

  const ctx = createCtx()
  const subagent = { session: { header: { origin: 'subagent' } } }
  // An Agent Team teammate has no origin: the header carries parentSession.
  const teammate = { session: { header: { parentSession: 'session-49afb6c6', delegationDepth: 1 } } }

  mod.apply(ctx, {
    minTurnDurationMs: 0,
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
  })

  try {
    ctx.emit('agent/status', { agent: subagent, status: 'running' })
    ctx.emit('agent/status', { agent: subagent, status: 'idle' })
    ctx.emit('agent/status', { agent: teammate, status: 'running' })
    ctx.emit('agent/status', { agent: teammate, status: 'idle' })

    await new Promise((resolve) => setTimeout(resolve, 2500))
    assert.ok(!readLog(logPath).includes('state=shown'), 'a child turn must not paint a badge')
  } finally {
    ctx.dispose()
    fs.rmSync(logPath, { force: true })
  }
})

test('a colour change reaches a running helper without a reload', { skip: process.platform !== 'win32' }, async (t) => {
  let mod
  try {
    mod = await import(pathToFileURL(indexPath).href)
  } catch (error) {
    t.skip(`host half needs @deepseek-ai/schemastery: ${error.message}`)
    return
  }

  const logPath = path.join(os.tmpdir(), `dsh-badge-recolour-${process.pid}.log`)
  fs.rmSync(logPath, { force: true })

  const ctx = createCtx()
  const agent = {}
  let colour = '#3b82f6'

  mod.apply(ctx, {
    minTurnDurationMs: 0,
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
    badgeColor: { get: () => colour },
  })

  try {
    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/status', { agent, status: 'idle' })

    const painted = await waitFor(() => readLog(logPath).includes('state=shown count=1'), 20_000)
    assert.ok(painted, `helper never painted; log:\n${readLog(logPath)}`)

    colour = '#10b981'
    const repainted = await waitFor(
      () => (readLog(logPath).match(/state=shown count=1/g) || []).length >= 2,
      8_000,
    )
    assert.ok(repainted, `helper never repainted after the colour changed; log:\n${readLog(logPath)}`)
  } finally {
    ctx.dispose()
    fs.rmSync(logPath, { force: true })
  }
})

test('the taskbar switch off never spawns a helper', { skip: process.platform !== 'win32' }, async (t) => {
  let mod
  try {
    mod = await import(pathToFileURL(indexPath).href)
  } catch (error) {
    t.skip(`host half needs @deepseek-ai/schemastery: ${error.message}`)
    return
  }

  const logPath = path.join(os.tmpdir(), `dsh-badge-off-${process.pid}.log`)
  fs.rmSync(logPath, { force: true })

  const ctx = createCtx()
  mod.apply(ctx, {
    minTurnDurationMs: 0,
    desktopBadge: false,
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
  })

  try {
    const agent = { session: { header: {} } }
    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/status', { agent, status: 'idle' })

    await new Promise((resolve) => setTimeout(resolve, 2500))
    const log = readLog(logPath)
    assert.ok(!log.includes('helper-spawn'), 'no helper may be spawned while the switch is off')
    assert.ok(!log.includes('state=shown'), 'nothing may be painted while the switch is off')
  } finally {
    ctx.dispose()
    fs.rmSync(logPath, { force: true })
  }
})

test('switching the taskbar badge off stops a running helper', { skip: process.platform !== 'win32' }, async (t) => {
  let mod
  try {
    mod = await import(pathToFileURL(indexPath).href)
  } catch (error) {
    t.skip(`host half needs @deepseek-ai/schemastery: ${error.message}`)
    return
  }

  const logPath = path.join(os.tmpdir(), `dsh-badge-toggle-${process.pid}.log`)
  fs.rmSync(logPath, { force: true })

  // A volatile reference: the switch reports its accepted value as it changes.
  let switchOn = true
  const ctx = createCtx()
  mod.apply(ctx, {
    minTurnDurationMs: 0,
    desktopBadge: { get: () => switchOn },
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
  })

  try {
    const agent = { session: { header: {} } }
    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/status', { agent, status: 'idle' })

    const painted = await waitFor(() => readLog(logPath).includes('state=shown'), 8_000)
    assert.ok(painted, `the badge never painted; log:\n${readLog(logPath)}`)

    switchOn = false
    const quit = await waitFor(() => readLog(logPath).includes('state=bye'), 8_000)
    assert.ok(quit, `the helper kept running after the switch went off; log:\n${readLog(logPath)}`)
  } finally {
    ctx.dispose()
    fs.rmSync(logPath, { force: true })
  }
})

test('a blocked turn asks on the taskbar', { skip: process.platform !== 'win32' }, async (t) => {
  let mod
  try {
    mod = await import(pathToFileURL(indexPath).href)
  } catch (error) {
    t.skip(`host half needs @deepseek-ai/schemastery: ${error.message}`)
    return
  }

  const logPath = path.join(os.tmpdir(), `dsh-badge-ask-${process.pid}.log`)
  fs.rmSync(logPath, { force: true })

  const ctx = createCtx()
  mod.apply(ctx, {
    minTurnDurationMs: 0,
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
  })

  try {
    const agent = { session: { header: {} } }
    const session = { header: { id: 'session-ask' } }
    ctx.emit('agent/status', { agent, status: 'running' })

    // The host publishes a waiting turn as a session event, not a status.
    ctx.emit('session/event', session, { type: 'approval/asked' })

    const asked = await waitFor(() => readLog(logPath).includes('state=asked'), 8_000)
    assert.ok(asked, `the taskbar never showed the question mark; log:\n${readLog(logPath)}`)

    // Answering closes the event: the mark has to go away on its own.
    ctx.emit('session/event', session, { type: 'approval/decided' })
    const cleared = await waitFor(() => readLog(logPath).includes('state=cleared'), 8_000)
    assert.ok(cleared, `the question mark stayed after the answer; log:\n${readLog(logPath)}`)
  } finally {
    ctx.dispose()
    fs.rmSync(logPath, { force: true })
  }
})

test('the browser can ask the taskbar for a question mark', { skip: process.platform !== 'win32' }, async (t) => {
  let mod
  try {
    mod = await import(pathToFileURL(indexPath).href)
  } catch (error) {
    t.skip(`host half needs @deepseek-ai/schemastery: ${error.message}`)
    return
  }

  const logPath = path.join(os.tmpdir(), `dsh-badge-bridge-${process.pid}.log`)
  fs.rmSync(logPath, { force: true })

  const ctx = createCtx()
  mod.apply(ctx, {
    minTurnDurationMs: 0,
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
  })

  try {
    const route = ctx.routes.find((entry) => entry.path === '/dsh-badge/api/asking')
    assert.ok(route, 'the host must serve the browser channel')

    const post = (body) => {
      const listeners = {}
      const req = {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin' },
        socket: { remoteAddress: '127.0.0.1' },
        on(event, fn) {
          listeners[event] = fn
        },
      }
      const res = { status: 0, writeHead(status) { this.status = status }, end() {} }
      route.handler(req, res)
      if (listeners.data) listeners.data(body)
      if (listeners.end) listeners.end()
      return res
    }

    assert.equal(post('{"asking":true}').status, 204)
    const asked = await waitFor(() => readLog(logPath).includes('state=asked'), 8_000)
    assert.ok(asked, `the bridge never reached the helper; log:\n${readLog(logPath)}`)

    post('{"asking":false}')
    const cleared = await waitFor(() => readLog(logPath).includes('state=cleared'), 8_000)
    assert.ok(cleared, `the question mark stayed after the answer; log:\n${readLog(logPath)}`)

    // Anything that is not this machine's own browser is refused.
    const listeners = {}
    const stranger = {
      method: 'POST',
      headers: {},
      socket: { remoteAddress: '10.0.0.9' },
      on(event, fn) {
        listeners[event] = fn
      },
    }
    const refused = { status: 0, writeHead(status) { this.status = status }, end() {} }
    route.handler(stranger, refused)
    assert.equal(refused.status, 403)
  } finally {
    ctx.dispose()
    fs.rmSync(logPath, { force: true })
  }
})

function readLog(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8')
  } catch {
    return '(no log)'
  }
}
