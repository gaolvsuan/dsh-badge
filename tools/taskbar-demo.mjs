// 单独试任务栏角标，不用装进 profile、不用重启 DSH。
//
//   npm run demo:taskbar
//
// 它启动 taskbar.ps1，把计数推到 1、2、3，停两秒，再清掉。
// 期间看任务栏上 DeepSeek Harness 图标的右下角。

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../taskbar.ps1', import.meta.url))

if (process.platform !== 'win32') {
  console.error('任务栏角标只在 Windows 上可用')
  process.exit(1)
}

const child = spawn(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-WindowMatch', 'DeepSeek Harness'],
  { stdio: ['pipe', 'pipe', 'inherit'] },
)

child.stdout.on('data', (chunk) => process.stdout.write(`[helper] ${chunk}`))
child.on('exit', (code) => console.log(`[helper] 退出 code=${code}`))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run() {
  console.log('等 PowerShell 把助手拉起来…')
  await sleep(2500)

  for (const step of [1, 2, 3]) {
    console.log(`推到 ${step}`)
    child.stdin.write('add\n')
    await sleep(1200)
  }

  console.log('停两秒，看任务栏图标右下角')
  await sleep(2000)

  child.stdin.write('clear\n')
  await sleep(600)
  child.stdin.write('quit\n')
  await sleep(800)
  child.kill()
}

run().catch((error) => {
  console.error(error)
  child.kill()
  process.exitCode = 1
})
