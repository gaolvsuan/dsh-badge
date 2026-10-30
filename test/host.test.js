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
  return {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(fn)
    },
    emit(event, payload) {
      for (const fn of handlers.get(event) || []) fn(payload)
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

test('subagent turns never raise the taskbar badge', { skip: process.platform !== 'win32' }, async (t) => {
  let mod
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

  mod.apply(ctx, {
    minTurnDurationMs: 0,
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
  })

  try {
    ctx.emit('agent/status', { agent: subagent, status: 'running' })
    ctx.emit('agent/status', { agent: subagent, status: 'idle' })

    await new Promise((resolve) => setTimeout(resolve, 2500))
    assert.ok(!readLog(logPath).includes('state=shown'), 'a subagent turn must not paint a badge')
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

function readLog(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8')
  } catch {
    return '(no log)'
  }
}
