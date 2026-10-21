# AI News Digest - daily insight block via internal AI gateway (ASCII only)
# Reads <date>.push.md, calls aliyun-ai-gateway /v1/chat/completions (qwen3.7-plus),
# inserts "> <marker><insight>" right after the title line, before push.ps1 runs.
# Marker + instruction text live in insight-prompt.txt (UTF-8) - this script is ASCII.
# Failure is non-fatal: log clearly and exit 0 so the digest push still happens.
param([string]$Date = '')
$ErrorActionPreference = 'Stop'
$log = 'D:\ai-news\insight.log'

function Log($msg) {
  Add-Content -Path $log -Value ("===== " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " " + $msg)
  Write-Output $msg
}

if (-not $Date) { $Date = Get-Date -Format 'yyyy-MM-dd' }
$pushFile = "D:\ai-news\$Date.push.md"
$promptFile = Join-Path $PSScriptRoot 'insight-prompt.txt'

if (-not (Test-Path $pushFile)) { Log "insight skipped: $pushFile missing"; exit 0 }
if (-not (Test-Path $promptFile)) { Log "insight skipped: $promptFile missing"; exit 0 }

$key = $env:VISION_API_KEY
if (-not $key) {
  # P1-1 (2026-09-30): key moved to %USERPROFILE%\.ai-news; the old artifact-dir
  # path is the fallback during the one-week migration window (remove after 2026-10-07).
  $keyFile = Join-Path $env:USERPROFILE '.ai-news\gateway-key.txt'
  if (-not (Test-Path $keyFile)) { $keyFile = 'D:\ai-news\gateway-key.txt' }
  if (Test-Path $keyFile) { $key = (Get-Content $keyFile -Raw).Trim() }
}
if (-not $key) { Log 'insight skipped: no gateway key (VISION_API_KEY or gateway-key.txt)'; exit 0 }

$pLines = [System.IO.File]::ReadAllLines($promptFile, [System.Text.Encoding]::UTF8)
if ($pLines.Length -lt 2) { Log 'insight skipped: insight-prompt.txt too short'; exit 0 }
$marker = $pLines[0].Trim()
$instruction = (($pLines[1..($pLines.Length - 1)]) -join "`n").Trim()

$digest = [System.IO.File]::ReadAllText($pushFile, [System.Text.Encoding]::UTF8)
if ($digest.Contains($marker)) { Log "insight skipped: marker already in $pushFile"; exit 0 }

$url = 'https://aliyun-ai-gateway.jlcops.com/v1/chat/completions'

function Get-Insight([string]$model, [int]$timeoutSec) {
  $body = @{
    model = $model
    messages = @(
      @{ role = 'system'; content = $instruction },
      @{ role = 'user'; content = $digest }
    )
    enable_thinking = $false
    temperature = 0.7
    max_tokens = 600
  } | ConvertTo-Json -Depth 5
  # PS 5.1 Invoke-RestMethod decodes charset-less UTF-8 JSON as Latin-1 ->
  # mojibake. Use WebClient with explicit UTF-8 in both directions instead.
  $wc = New-Object System.Net.WebClient
  try {
    $wc.Encoding = [System.Text.Encoding]::UTF8
    $wc.Headers.Add('Authorization', "Bearer $key")
    $wc.Headers.Add('Content-Type', 'application/json')
    $respText = $wc.UploadString($url, 'POST', $body)
    $r = $respText | ConvertFrom-Json
    return [string]$r.choices[0].message.content
  } finally {
    $wc.Dispose()
  }
}

$insight = ''
try { $insight = Get-Insight 'qwen3.7-plus' 120 } catch { Log ("qwen3.7-plus failed: " + $_.Exception.Message) }
if (-not $insight) {
  try { $insight = Get-Insight 'qwen3.6-flash' 60 } catch { Log ("qwen3.6-flash failed: " + $_.Exception.Message) }
}
if (-not $insight) { Log 'insight failed: no usable model response'; exit 0 }

$insight = $insight.Trim()
if ($insight.StartsWith($marker)) { $insight = $insight.Substring($marker.Length).Trim() }
$insight = ($insight -replace '\s+', ' ')
if ($insight.IndexOf([char]0xFFFD) -ge 0) { Log 'insight dropped: U+FFFD in model response'; exit 0 }
# An insight is mostly Chinese; if decoding failed, CJK count collapses to ~0.
$cjkCount = ([regex]::Matches($insight, '[\u4e00-\u9fff]')).Count
if ($cjkCount -lt 20) { Log ("insight dropped: not CJK (cjk=" + $cjkCount + ")"); exit 0 }
if ($insight.Length -lt 20 -or $insight.Length -gt 800) { Log ("insight dropped: bad length " + $insight.Length); exit 0 }

# insert after the first "# " title line; fall back to appending at the end
$lines = [System.IO.File]::ReadAllLines($pushFile, [System.Text.Encoding]::UTF8)
$titleIdx = -1
for ($i = 0; $i -lt $lines.Length; $i++) { if ($lines[$i].StartsWith('# ')) { $titleIdx = $i; break } }
$out = New-Object System.Collections.Generic.List[string]
$inserted = $false
if ($titleIdx -ge 0) {
  $out.Add($lines[$titleIdx])
  $j = $titleIdx + 1
  while ($j -lt $lines.Length -and $lines[$j].Trim() -eq '') { $j++ }
  $out.Add('')
  $out.Add(("> " + $marker + $insight))
  $out.Add('')
  for (; $j -lt $lines.Length; $j++) { $out.Add($lines[$j]) }
  $inserted = $true
}
if ($inserted) {
  [System.IO.File]::WriteAllText($pushFile, ($out -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
} else {
  [System.IO.File]::AppendAllText($pushFile, ("`n`n> " + $marker + $insight + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

$check = [System.IO.File]::ReadAllText($pushFile, [System.Text.Encoding]::UTF8)
if ($check.IndexOf([char]0xFFFD) -ge 0) { Log 'insight FAILED: U+FFFD found after append'; exit 1 }
Log ("insight ok: inserted into " + $pushFile + " (" + $insight.Length + " chars)")
exit 0
