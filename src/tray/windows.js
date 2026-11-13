import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Windows: a small PowerShell script owns a NotifyIcon. We write the view to a JSON file, the
// script checks it twice a second, and clicks come back as "click:<id>" lines on stdout.
const SCRIPT = String.raw`
param([string]$StateFile, [int]$ParentPid)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$ni = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$ni.ContextMenuStrip = $menu
$script:stamp = [datetime]::MinValue
$script:icon = $null
function New-Dot([string]$hex) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex))), 3, 3, 26, 26)
  $g.DrawEllipse((New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 2), 3, 3, 26, 26)
  $g.Dispose()
  [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
function Send([string]$line) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
$ni.add_MouseClick({
  if ($_.Button -eq 'Left') { [System.Windows.Forms.NotifyIcon].GetMethod('ShowContextMenu', [Reflection.BindingFlags]'NonPublic,Instance').Invoke($ni, $null) }
})
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.add_Tick({
  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { $ni.Visible = $false; [System.Windows.Forms.Application]::Exit(); return }
  $f = Get-Item $StateFile -ErrorAction SilentlyContinue
  if (-not $f -or $f.LastWriteTimeUtc -eq $script:stamp) { return }
  $script:stamp = $f.LastWriteTimeUtc
  try { $v = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return }
  $old = $script:icon
  $script:icon = New-Dot $v.color
  $ni.Icon = $script:icon
  if ($old) { $old.Dispose() }
  $ni.Text = ([string]$v.tooltip).Substring(0, [Math]::Min(63, ([string]$v.tooltip).Length))
  $ni.Visible = $true
  $menu.Items.Clear()
  foreach ($it in $v.items) {
    if ($it.separator) { [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)); continue }
    $mi = New-Object System.Windows.Forms.ToolStripMenuItem ([string]$it.label)
    $mi.Enabled = ($it.enabled -ne $false)
    if ($null -ne $it.checked) { $mi.Checked = [bool]$it.checked }
    $id = [string]$it.id
    $mi.add_Click({ Send "click:$id" }.GetNewClosure())
    [void]$menu.Items.Add($mi)
  }
})
$timer.Start()
Send 'ready'
[System.Windows.Forms.Application]::Run()
$ni.Dispose()
`;

export async function createTray({ onClick }) {
  const dir = join(tmpdir(), `whatsgrep-tray-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'tray.ps1'), state = join(dir, 'state.json');
  writeFileSync(script, '﻿' + SCRIPT); // BOM so Windows PowerShell reads the file as UTF-8
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script, '-StateFile', state, '-ParentPid', String(process.pid)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let err = '';
  ps.stderr.on('data', (d) => { err += d; });
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (d) => { for (const line of d.split(/\r?\n/)) if (line.startsWith('click:')) onClick(line.slice(6)); });
  const exited = new Promise((r) => ps.once('exit', () => r()));
  ps.once('exit', (code) => { if (code) console.error(`tray helper exited (${code}) ${err.trim()}`); });
  return {
    registered: () => ps.exitCode === null,
    exited,
    update(v) {
      writeFileSync(state + '.tmp', JSON.stringify(v));
      renameSync(state + '.tmp', state);
    },
    close() { try { ps.kill(); } catch {} },
  };
}
