# dsh-badge

和 ChatGPT 标签页右上角那个红色数字角标同一个东西，搬到 DeepSeek Harness：回合结束时在标签页图标和 Windows 任务栏图标上叠加未读数，并播放提示音。

## 效果

- 标签页图标右下角出现红色角标，显示未读回合数（超过 99 显示 `99+`）
- 标题变成 `(3) DeepSeek Harness`
- Windows 上任务栏按钮同样挂上红色数字角标，窗口切回前台后清除
- 回合结束播放两音铃声，错误回合可另配低音提示
- 标签页重新可见约 1.2 秒后自动清零

音效由 Web Audio 现场合成，插件不带任何音频文件；角标画在 canvas 上再替换 `<link rel="icon">`，站点原图标保留为底图。

## 与 dsh-notification 的关系

| 能力 | dsh-notification | dsh-badge |
| --- | --- | --- |
| 系统通知 / webhook | ✅ | ❌ |
| 图标数字角标 | ❌ | ✅ |
| 标题计数前缀 | ❌ | ✅ |
| 提示音 | 跟随系统默认 | 可关闭、可调音量、可换自定义音频 |

两者可以同时装，互不冲突。

## 安装

### 从插件市场安装

在市场里搜索 `dsh-badge` 后安装，安装完成后按市场提示重启或等待热挂载。

### 手工安装（本地开发）

把本仓库放到任意目录，然后在 profile 的 `package.json` 里加两处：

```jsonc
{
  "dependencies": {
    "dsh-badge": "file:E:/AI工作站/deepseek插件编写"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...原有内容
        "dsh-badge"
      ]
    }
  }
}
```

再在 profile 目录执行 `pnpm install`。`bundles` 里少写这一行，插件不会加载。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖默认值（`id` 与 `name` 两项都要写，`id` 对应 `cordis.patch.yml` 里插入时用的 `badge`）：

```yaml
- id: badge
  name: dsh-badge
  config:
    volume: 0.6
    soundPreset: beep
    minTurnDurationMs: 5000
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `badge` | `true` | 是否绘制图标角标 |
| `titlePrefix` | `true` | 是否在标题前加 `(N) ` |
| `sound` | `true` | 是否播放提示音 |
| `soundPreset` | `chime` | `chime` 两音铃声，`beep` 单声方波 |
| `soundUrl` | `''` | 自定义音频地址，设置后替代内置音 |
| `volume` | `0.5` | 音量，0 到 1 |
| `minTurnDurationMs` | `3000` | 短于该时长的回合不计角标、不响 |
| `clearOnFocus` | `true` | 标签页重新可见时清零 |
| `errorSound` | `false` | 回合失败时播放低音提示 |
| `desktopBadge` | `true` | Windows 专用：是否在任务栏按钮上画数字角标 |
| `desktopBadgeWindow` | `DeepSeek Harness` | 承载任务栏按钮的进程名 |
| `desktopBadgeClearOnFocus` | `true` | 窗口切回前台时清除任务栏角标 |
| `debugLog` | `''` | 填一个文件路径，插件每次加载时向该文件追加一行，用来区分「没挂载」和「浏览器没画出来」 |

## 手动验证

浏览器开发者工具控制台里：

```js
__DSH_BADGE__.test(3)   // 角标显示 3 并响一声
__DSH_BADGE__.clear()   // 清零
__DSH_BADGE__.sound()   // 只试听音效
```

`demo/index.html` 是一个独立演示页，直接双击打开即可。它加载仓库里真实的 `client.js`，只把 DSH 的 sessions 服务换成假数据，用来单独验证角标和音效。

带上 `?auto=1` 时，演示页会自动跑一遍「开始回合 → 结束回合」，把结果写进 `<pre id="report">`，可以用无头浏览器抓取：

```bash
chrome --headless=new --disable-gpu --virtual-time-budget=4000 \
  --dump-dom "file:///…/demo/index.html?auto=1"
```

## 桌面端任务栏角标

Electron 的 `setOverlayIcon` 在这里用不了：插件跑在 DSH 的宿主进程里，带任务栏按钮的窗口属于另一个进程。Windows 允许任何进程通过 `ITaskbarList3` 给指定 HWND 画覆盖图标，所以宿主侧会拉起 `taskbar.ps1`，用管道喂它事件：

```
宿主 index.js ──stdin: add / tick / quit──▶ taskbar.ps1 ──ITaskbarList3──▶ 任务栏按钮
```

- 助手自己维护计数、画图标、判断前台窗口，`add` 加一，`tick` 检查窗口是否刚切回前台并清除
- 图标用 `System.Drawing` 现画：32×32 红底白字，超过 99 显示 `99`
- 宿主退出时管道关闭，助手随之退出并清掉角标，不留残留

不想装进 profile 也能单独看效果：

```bash
npm run demo:taskbar
```

它会拉起助手，把计数推到 1、2、3，停两秒再清掉。

## 开发

```bash
npm run check   # 语法检查
npm test        # 单元测试（node --test，用 DOM 桩驱动真实 client.js）
```

仓库没有构建步骤：`client.js` 手写成 `window.__ModuleLoader__.load({ id, factory })` 要求的形状，改完直接生效。

把仓库以目录链接的方式装进 profile 时，Node 会按仓库真实路径解析依赖，`@deepseek-ai/schemastery` 会找不到。在仓库里建一个 `node_modules/@deepseek-ai/schemastery` 指向 profile 中的同名包即可（`node_modules/` 已加入 `.gitignore`）。

## 已知限制

- 任务栏角标只在 Windows 上可用，依赖一个常驻的 PowerShell 助手进程；macOS 和 Linux 上只剩标签页角标、标题前缀和音效。
- 助手按进程名找窗口。DSH 换名字或同机跑多个实例时，需要用 `desktopBadgeWindow` 指定，或者关掉 `desktopBadge`。
- 浏览器要求页面发生过一次点击或按键后才允许播放声音，插件在首次交互时解锁音频。
- 计数是全局未读回合数，不按会话分别统计。

## 许可证

MIT
