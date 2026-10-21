# alert.ps1 - pipeline failure alert to a PRIVATE WeCom bot group (ASCII only).
# Decision A (2026-09-30): dedicated alert webhook, separate from the daily group.
#   URL file: %USERPROFILE%\.ai-news\alert-webhook.txt (preferred)
#             D:\ai-news\alert-webhook.txt (fallback)
#   No URL configured -> log only, exit 0 (silent until the group exists).
# Decision D: weekends (Sat/Sun) -> log only, never send.
# Same-day dedup: at most one alert per day via D:\ai-news\alert-<date>.sent marker.
# Always exits 0: alerting must never break the caller's flow.
param(
  [string]$Reason = 'unspecified failure'
)

$ErrorActionPreference = 'Continue'
$log    = 'D:\ai-news\alert.log'
$today  = Get-Date -Format 'yyyy-MM-dd'
$marker = 'D:\ai-news\alert-' + $today + '.sent'

function Log([string]$msg) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Try { Add-Content -Path $log -Value ($stamp + ' ' + $msg) -Encoding ASCII } Catch { }
}

# --- Decision D: weekend silence (log only, no send) ---
$wd = (Get-Date).DayOfWeek
if ($wd -eq 'Saturday' -or $wd -eq 'Sunday') {
  Log ('alert suppressed (weekend policy): ' + $Reason)
  exit 0
}

# --- same-day dedup: at most one alert per day ---
if (Test-Path $marker) {
  Log ('alert skip (already sent today): ' + $Reason)
  exit 0
}

# --- resolve alert webhook (new private bot group, Decision A/B) ---
$hookFile = Join-Path $env:USERPROFILE '.ai-news\alert-webhook.txt'
if (-not (Test-Path $hookFile)) { $hookFile = 'D:\ai-news\alert-webhook.txt' }
if (-not (Test-Path $hookFile)) {
  Log ('alert NOT sent: no alert-webhook.txt configured - reason was: ' + $Reason)
  exit 0
}
$url = ''
Try { $url = (Get-Content $hookFile -Raw).Trim() } Catch { $url = '' }
if ($url -notlike 'https://qyapi.weixin.qq.com/*') {
  Log ('alert NOT sent: webhook file has no valid qyapi URL - reason was: ' + $Reason)
  exit 0
}

# --- build markdown payload (plain text, no emoji: ASCII discipline) ---
$content = '**AI News pipeline WARNING**' + "`n" +
           '> date: ' + $today + ' (' + $wd + ')' + "`n" +
           '> reason: ' + $Reason + "`n" +
           '> host: ' + [System.Environment]::MachineName + "`n" +
           '> action: manual check needed - see D:\ai-news\run.log / gate.log / push.log'
$payload = @{ msgtype = 'markdown'; markdown = @{ content = $content } } | ConvertTo-Json -Depth 3
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)

$sent = $false
for ($i = 1; $i -le 2; $i++) {
  Try {
    $r = Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json' -Body $bytes -TimeoutSec 20
    if ($r.errcode -eq 0) { $sent = $true; break }
    Log ('alert attempt ' + $i + ' errcode ' + $r.errcode + ' ' + $r.errmsg)
  } Catch {
    Log ('alert attempt ' + $i + ' exception: ' + $_.Exception.GetType().Name)
  }
  Start-Sleep -Seconds 5
}

if ($sent) {
  Try { Set-Content -Path $marker -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Encoding ASCII } Catch { }
  Log ('alert ok: ' + $Reason)
} else {
  Log ('alert NOT delivered after retries: ' + $Reason)
}
exit 0
