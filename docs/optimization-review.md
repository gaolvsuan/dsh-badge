# 代码审查与优化清单

审查对象：`dsh-badge` 0.8.7（client.js 1149 行、index.js 389 行、taskbar.ps1 297 行）。
审查日期：2026-11-11。本次改动随 0.9.0 发布。

## 一、实测基线

| 指标 | 数值 | 测法 |
| --- | --- | --- |
| 助手空闲 CPU | 启动 0.28 s，之后 10 秒内 **0.00 s** | `tools/measure-idle.mjs`，不发送任何命令 |
| 助手轮询 CPU（改前） | 10 秒 0.11 s，约 **1.09 %** | 同上，每 800 ms 发一次 `tick` |
| 助手内存 | 工作集 **82.6 MB**，私有 66.6 MB，句柄 545 | `Get-Process` 采样 |
| 助手启动耗时 | 约 1.5 s | 首次 `state=ready` 的延迟 |
| 单元测试 | 22 个 | `npm test` |

结论：空闲时进程阻塞在 `ReadLine` 上，CPU 为 0；只要一开轮询，就有约 1 % 的常驻开销。这个 1 % 来自每秒 1.25 次的唤醒与并发检查，属于可消除的部分。

## 二、本次已修

### 1. GDI 对象泄漏（稳定性）

`New-BadgeIcon` 每次绘制都 `New-Object SolidBrush / Font / StringFormat`，只 `Dispose` 了 Bitmap 和 Graphics。字体和画刷是 GDI+ 对象，助手常驻，几百个回合后会累积。

改法：全部放进 `try/finally` 释放。影响：长时间运行不再增长句柄。

### 2. 空闲轮询（性能）

改前 `tick` 每 800 ms 无条件发送，助手每次都要 `IsWindow` + `GetForegroundWindow`，宿主侧还有一次进程唤醒。

改法：助手通过 `state=shown / state=asked / state=cleared / state=bye` 把「屏幕上有没有东西」告诉宿主，宿主只在角标可见时才发 `tick`。跟 `clearOnFocus` 的语义完全一致 —— 没东西可清就不用查。

收益：空闲 CPU 从 1.09 % 降到 **0.000 %**。

### 3. 颜色心跳 800 ms → 2000 ms（性能）

颜色变化是低频操作，2 秒内生效肉眼无感。定时器唤醒次数减少 60 %。

### 4. 父进程存活检查降频（性能）

原来是每条命令一次 `Get-Process -Id`（含 WMI 查询）。改成每 10 条检查一次，退出检测延迟最多 8 秒，对不影响任何可见行为。

### 5. helper 主循环缺少异常边界（稳定性）

`$ErrorActionPreference = 'Stop'` 之下，`Publish` 里任何一次绘图或窗口异常都会结束整个 helper，宿主只能重启。现在循环体包 `try/catch`，出错输出 `state=error` 并继续。

### 6. `askingAgents` 未随 agent 释放（内存）

新增的提问跟踪集合在 `agent/disposed` 时清理，避免被释放的 agent 常驻。

### 7. 前几轮已修（记录在此备查）

- 助手连续启动失败会每 800 ms 重试一次 → 三次快速失败后停 5 分钟
- `prev` 会话表不清理 → 按快照裁剪
- 标题前缀无条件剥离 `(N)` → 只替换自己写的前缀

## 三、功能补强

模型停下来提问（宿主状态 `blocked`，客户端 `pendingInteraction`）时：

- 标签页图标换成**琥珀色问号**，标题变成 `(?) 标题`
- Windows 任务栏角标同步画问号
- 回答后自动恢复成计数

问号优先级高于数字：提问期间不显示未读数，回答后回到原来的计数。

## 四、待办清单（未做）

按「收益 / 投入」排序。

| # | 问题 | 位置 | 影响 | 建议 | 预估收益 |
| --- | --- | --- | --- | --- | --- |
| 1 | 助手是 PowerShell 进程，工作集 82 MB | taskbar.ps1 | 常驻内存偏大 | 用 `csc` 把同一段 C# 编译成独立小 exe，PowerShell 只做启动器或完全去掉 | 内存降到约 20 MB，启动从 1.5 s 到 0.05 s |
| 2 | `Add-Type` 每次启动都编译一遍 C# | taskbar.ps1:27 | 首次角标延迟 1.5 s | 预编译成 dll 随包发布，`Add-Type -Path` 加载 | 启动 -1.4 s |
| 3 | 客户端每次重画都新建 canvas 并 `toDataURL` | client.js `paint` | 单次 2–4 ms（仅计数变化时） | 复用一个 canvas 与 context | 每次省 1–2 ms |
| 4 | `sessions.list` 订阅在流式输出期间触发频繁 | client.js `watchSessions` | 每次是 O(会话数) 循环，通常 < 0.1 ms | 加 100 ms 节流（`requestAnimationFrame` 或时间戳） | 高频时减少 80 % 回调 |
| 5 | 按进程名找窗口，只取第一个 | taskbar.ps1 `Find-TargetWindow` | 多开 DSH 时角标可能画到别的窗口 | 支持按窗口标题或 PID 匹配 | 多实例场景可用 |
| 6 | 任务栏角标仅 Windows | index.js:349 | macOS/Linux 只剩标签页角标 | macOS 需要主进程 `app.setBadgeCount`，插件够不到 | 受限于宿主 |
| 7 | `debugLog` 无限追加 | index.js | 长期运行文件变大 | 超过 1 MB 时截断或轮转 | 磁盘可控 |
| 8 | 设置页没有「问号颜色」可选项 | client.js | 目前固定琥珀色 | 加一个字段（需要新的 volatile 配置） | 保持可定制 |

## 五、兼容性

已确认无风险的部分：

- 客户端代码按 ES5 语法书写（`var`、`Object.assign`），没有可选链、`structuredClone`，老 Chromium 可用
- 画布 `toDataURL('image/png')`、Web Audio、`visibilitychange` 都是基线能力
- 宿主侧用 `fileURLToPath`、可选链，要求 Node ≥ 18（DSH 内置 24）
- `taskbar.ps1` 只用 Windows PowerShell 5.1 已有的能力，没有 `??`、`?.` 等 PS7 语法
- `Intl`、`AbortController` 等均未使用

风险点：

- 依赖 `Get-Process -Name "DeepSeek Harness"` 找窗口，宿主改名后失效（有配置项兜底）
- `ITaskbarList3` 是系统 COM 接口，Windows 版本差异只会导致角标不显示，不会崩

## 六、复现方式

```bash
npm test                 # 22 个用例，含真实 PowerShell 集成测试
node tools/measure-idle.mjs   # 实测空闲与轮询的 CPU
```
