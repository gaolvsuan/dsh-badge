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

  const logPath = path.join(os.tmpdir(), `dsh-badge-notify-host-${process.pid}.log`)
  fs.rmSync(logPath, { force: true })

  const ctx = createCtx()
  const agent = {}

  mod.apply(ctx, {
    minTurnDurationMs: 0,
    debugLog: logPath,
    desktopBadgeClearOnFocus: false,
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

  const logPath = path.join(os.tmpdir(), `dsh-badge-notify-skip-${process.pid}.log`)
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

function readLog(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8')
  } catch {
    return '(no log)'
  }
}
