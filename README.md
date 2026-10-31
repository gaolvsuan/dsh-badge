# dsh-badge

中文 | [English](README.en.md)

和 ChatGPT 标签页右上角那个红色数字角标同一个东西，搬到 DeepSeek Harness：回合结束时在标签页图标和 Windows 任务栏图标上叠加未读数，并播放提示音。

<p align="center">
  <img src="docs/taskbar-badge-colors.png" width="220" alt="任务栏角标的两种颜色：红色和紫色">
</p>

## 效果

- 标签页图标上出现角标，显示未读回合数（超过 99 显示 `99+`）
- 标题变成 `(3) DeepSeek Harness`
- Windows 上任务栏按钮同样挂上数字角标，窗口切回前台后清除
- 回合结束播放提示音，三种音色可选，错误回合可另配低音提示
- 标签页重新可见约 1.2 秒后自动清零

音效由 Web Audio 现场合成，插件不带任何音频文件；角标画在 canvas 上再替换 `<link rel="icon">`，站点原图标保留为底图。

## 安装

### 从插件市场安装

在市场里搜索 `dsh-badge` 后安装，安装完成后按市场提示重启或等待热挂载。

### 从 npm 安装

```bash
dsh plugin --profile desktop add dsh-badge
```

`dsh plugin add` 只跑 pnpm，不会改 `dsh.profile.bundles`，装完还要在 profile 的 `package.json` 里把 `dsh-badge` 加进那个数组，否则插件不会加载。

### 手工安装（本地开发）

把本仓库放到任意目录，然后在 profile 的 `package.json` 里加两处：

```jsonc
{
  "dependencies": {
    "dsh-badge": "file:../dsh-badge"
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
| `soundPreset` | `chime` | `chime` 两音铃声，`beep` 单声方波，`rise` 三音上行 |
| `soundUrl` | `''` | 自定义音频地址，设置后替代内置音 |
| `volume` | `0.5` | 音量，0 到 1，走幂曲线而非线性 |
| `minTurnDurationMs` | `3000` | 短于该时长的回合不计角标、不响 |
| `clearOnFocus` | `true` | 标签页重新可见时清零 |
| `badgeColor` | `#f5455c` | 角标圆点颜色，十六进制 |
| `badgePosition` | `br` | 角标位置，`br` 右下角，`tr` 右上角 |
| `errorSound` | `false` | 回合失败时播放低音提示 |
| `desktopBadge` | `true` | Windows 专用：是否在任务栏按钮上画数字角标 |
| `desktopBadgeWindow` | `DeepSeek Harness` | 承载任务栏按钮的进程名 |
| `desktopBadgeClearOnFocus` | `true` | 窗口切回前台时清除任务栏角标 |
| `debugLog` | `''` | 填一个文件路径，插件每次加载时向该文件追加一行，用来区分「没挂载」和「浏览器没画出来」 |

## 设置页

设置 → **插件管理** → 打开 `dsh-badge` 这个组合包，配置表单就在页面里：

- **颜色**：六个预设色块，外加一个取色器
- **位置**：右下角 / 右上角二选一
- **提示音**：两音铃声 / 单声方波 / 三音上行，点哪个当场响哪个，旁边还有「试听当前音色」
- **音量**：0–100% 滑杆
- **最短回合时长**：数字输入

改完立刻生效，停手后自动写入 Host 设置文档，没有保存按钮。底部只显示「已自动保存」或「保存中…」，写入失败时出现「重试保存」。

实现上，表单注册进 `plugins.bundle.config` 槽，键是包名 `dsh-badge`。社区组合包不能用 `plugins.item`，那个槽只列官方插件。表单只在 Host 提供对应设置命名空间时才注册，所以没装这个插件的部署看不到它。

控件是自己画的：DSH 共享的 `SettingsValueField` 只渲染文本框，没有开关、下拉和取色器，所以这里保留 `SettingsFormModel` 负责暂存与提交，界面用原生控件自己拼。布尔类配置仍走配置文件。

可编辑字段声明为 `volatile()`：Host 只为含 volatile 字段的条目提供设置命名空间。这类字段在宿主侧是带 `get()` 的引用对象，且不会序列化进浏览器 bundle，所以客户端从 settings scope 的 `getSnapshot().value` 读实时值并订阅后续变化。

## 手动验证

浏览器开发者工具控制台里：

```js
__DSH_BADGE__.test(3)          // 角标显示 3 并响一声
__DSH_BADGE__.clear()          // 清零
__DSH_BADGE__.sound()          // 只试听音效
__DSH_BADGE__.config           // 当前生效的配置
__DSH_BADGE__.lastChime()      // 上一声用的音量、音色和增益
__DSH_BADGE__.diag             // 设置表单的注册状态
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
宿主 index.js ──stdin: add / tick / color / quit──▶ taskbar.ps1 ──ITaskbarList3──▶ 任务栏按钮
```

- 助手自己维护计数、画图标、判断前台窗口，`add` 加一，`tick` 检查窗口是否刚切回前台并清除
- 图标用 `System.Drawing` 现画：32×32 圆底白字，超过 99 显示 `99`
- 颜色跟随 `badgeColor`：启动时用 `-BadgeColor` 传进去，改设置时宿主每 800 毫秒读一次 volatile 引用，发现变了就发 `color #rrggbb` 让助手立刻重画，不需要重启
- 子代理的回合不计入任务栏角标，和标签页保持一致
- 助手带 `-ParentPid` 启动，父进程消失后自行退出并清掉角标，不留孤儿

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

Windows 上用 PowerShell 读写含中文的文件要注意编码：`Get-Content` 对无 BOM 的 UTF-8 文件按本地代码页解码，会把中文写坏。改这类文件请用编辑器。

## 已知限制

- 任务栏角标只在 Windows 上可用，依赖一个常驻的 PowerShell 助手进程；macOS 和 Linux 上只剩标签页角标、标题前缀和音效。
- 助手按进程名找窗口。DSH 换名字或同机跑多个实例时，需要用 `desktopBadgeWindow` 指定，或者关掉 `desktopBadge`。
- 浏览器要求页面发生过一次点击或按键后才允许播放声音，插件在首次交互时解锁音频。
- 计数是全局未读回合数，不按会话分别统计。

## 许可证

MIT
