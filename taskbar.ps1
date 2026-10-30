# dsh-badge-notify — taskbar overlay helper.
#
# The DSH host plugin runs in its own process, so it cannot call Electron's
# setOverlayIcon on the window that owns the taskbar button. Windows lets any
# process draw that overlay through ITaskbarList3 as long as it has the HWND,
# which is what this script does.
#
# Protocol: one command per line on stdin, one state line per command on stdout.
#   add     increment the count and redraw the overlay
#   tick    clear the overlay when the window has just come to the foreground
#   clear   drop the count and remove the overlay
#   quit    clear and exit
# stdin closing also exits, so the helper dies with its host.

param(
    [string]$WindowMatch = 'DeepSeek Harness'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::ASCII

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
public class TaskbarList { }

[ComImport, Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ITaskbarList3
{
    void HrInit();
    void AddTab(IntPtr hwnd);
    void DeleteTab(IntPtr hwnd);
    void ActivateTab(IntPtr hwnd);
    void SetActiveAlt(IntPtr hwnd);
    void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fFullscreen);
    void SetProgressValue(IntPtr hwnd, ulong ullCompleted, ulong ullTotal);
    void SetProgressState(IntPtr hwnd, int tbpFlags);
    void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);
    void UnregisterTab(IntPtr hwndTab);
    void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
    void SetTabActive(IntPtr hwndTab, IntPtr hwndInsertBefore, uint dwReserved);
    void ThumbBarAddButtons(IntPtr hwnd, uint cButtons, IntPtr pButtons);
    void ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, IntPtr pButtons);
    void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);
    void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, [MarshalAs(UnmanagedType.LPWStr)] string pszDescription);
    void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string pszTip);
    void SetThumbnailClip(IntPtr hwnd, IntPtr prcClip);
}

public static class Native
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DestroyIcon(IntPtr hIcon);

    public static void SetOverlay(IntPtr hwnd, IntPtr hIcon, string description)
    {
        var list = (ITaskbarList3)new TaskbarList();
        list.HrInit();
        list.SetOverlayIcon(hwnd, hIcon, description);
    }
}
'@

Add-Type -AssemblyName System.Drawing

$script:count = 0
$script:hwnd = [IntPtr]::Zero
$script:icon = [IntPtr]::Zero
$script:wasForeground = $false
$script:seenTick = $false

function Find-TargetWindow {
    $process = Get-Process -Name $WindowMatch -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
    if ($process) { return [IntPtr]$process.MainWindowHandle }
    return [IntPtr]::Zero
}

function Get-TargetWindow {
    if ($script:hwnd -ne [IntPtr]::Zero -and [Native]::IsWindow($script:hwnd)) {
        return $script:hwnd
    }
    $script:hwnd = Find-TargetWindow
    return $script:hwnd
}

function New-BadgeIcon([int]$value) {
    $text = if ($value -gt 99) { '99' } elseif ($value -gt 0) { [string]$value } else { '' }
    $size = 32

    $bitmap = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 69, 92))
    $graphics.FillEllipse($brush, 0, 0, $size - 1, $size - 1)

    $font = New-Object System.Drawing.Font('Segoe UI', $(if ($text.Length -gt 1) { 13 } else { 16 }), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
    $graphics.DrawString($text, $font, [System.Drawing.Brushes]::White, $rect, $format)

    $graphics.Dispose()
    $handle = $bitmap.GetHicon()
    $bitmap.Dispose()
    return $handle
}

function Publish {
    param([int]$Value)

    $window = Get-TargetWindow
    if ($window -eq [IntPtr]::Zero) {
        Write-Output "state=no-window count=$script:count"
        return
    }

    if ($Value -le 0) {
        if ($script:icon -ne [IntPtr]::Zero) {
            [Native]::SetOverlay($window, [IntPtr]::Zero, '')
            [void][Native]::DestroyIcon($script:icon)
            $script:icon = [IntPtr]::Zero
        }
        Write-Output "state=cleared count=0 hwnd=$window"
        return
    }

    $next = New-BadgeIcon $Value
    [Native]::SetOverlay($window, $next, [string]$Value)
    if ($script:icon -ne [IntPtr]::Zero) { [void][Native]::DestroyIcon($script:icon) }
    $script:icon = $next
    Write-Output "state=shown count=$Value hwnd=$window"
}

function Sync-Foreground {
    $window = Get-TargetWindow
    if ($window -eq [IntPtr]::Zero) {
        $script:wasForeground = $false
        return
    }
    $foreground = [Native]::GetForegroundWindow() -eq $window

    # The first tick only records where we start. Without this, a turn that
    # ends while the window is already in front would clear its own badge on
    # the very next tick and the user would never see it.
    if (-not $script:seenTick) {
        $script:seenTick = $true
        $script:wasForeground = $foreground
        return
    }

    if ($foreground -and -not $script:wasForeground -and $script:count -gt 0) {
        $script:count = 0
        Publish -Value 0
    }
    $script:wasForeground = $foreground
}

Write-Output "state=ready pid=$PID"

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }

    switch ($line.Trim().ToLowerInvariant()) {
        'add' {
            $script:count++
            Publish -Value $script:count
        }
        'tick' {
            Sync-Foreground
        }
        'clear' {
            $script:count = 0
            Publish -Value 0
        }
        'quit' {
            $script:count = 0
            Publish -Value 0
            Write-Output 'state=bye'
            exit 0
        }
        '' { }
        default {
            Write-Output "state=unknown-command"
        }
    }
    [Console]::Out.Flush()
}

# stdin closed: the host went away, drop the overlay so nothing is left behind.
$script:count = 0
try { Publish -Value 0 } catch { }
