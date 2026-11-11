import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'taskbar.ps1')

function cpuOf(pid) {
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).CPU`], { windowsHide: true })
    let out = ''
    ps.stdout.on('data', (c) => (out += c))
    ps.on('close', () => resolve(Number(out.trim())))
  })
}

function run({ ticks, seconds }) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-WindowMatch', 'DeepSeek Harness', '-BadgeColor', '#8b5cf6',
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })

    child.stdout.resume()
    let timer = null
    if (ticks > 0) {
      timer = setInterval(() => {
        try { child.stdin.write('tick\n') } catch {}
      }, 800)
    }

    // The first seconds are the one-time Add-Type compile, so the marginal rate
    // is measured between two later samples.
    setTimeout(async () => {
      const first = await cpuOf(child.pid)
      setTimeout(async () => {
        const second = await cpuOf(child.pid)
        if (timer) clearInterval(timer)
        try { child.stdin.write('quit\n') } catch {}
        child.kill()
        resolve({ ticks, startupAndFirst: first, second, marginal: second - first, windowSeconds: seconds })
      }, seconds * 1000)
    }, 5000)
  })
}

const idle = await run({ ticks: 0, seconds: 10 })
const busy = await run({ ticks: 12, seconds: 10 })
for (const [name, r] of [['idle', idle], ['ticking', busy]]) {
  console.log(`${name}: startup ${r.startupAndFirst.toFixed(2)}s, then ${r.marginal.toFixed(2)}s over ${r.windowSeconds}s = ${((r.marginal / r.windowSeconds) * 100).toFixed(3)}% CPU`)
}

