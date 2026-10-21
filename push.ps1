# AI News Digest - push to WeCom group bot webhook (ASCII only)
# 1) markdown digest from <today>.push.md   2) full digest attached as a group file (tappable)
$ErrorActionPreference = 'Stop'
$log = 'D:\ai-news\push.log'
$today = Get-Date -Format 'yyyy-MM-dd'
$pushFile = "D:\ai-news\$today.push.md"
$fullFile = "D:\ai-news\$today.md"
# P1-1 (2026-09-30): secret moved to %USERPROFILE%\.ai-news; the old artifact-dir
# path stays as fallback for a one-week migration window (remove after 2026-10-07).
$hookFile = Join-Path $env:USERPROFILE '.ai-news\webhook.txt'
if (-not (Test-Path $hookFile)) { $hookFile = 'D:\ai-news\webhook.txt' }

function Log($msg) { Add-Content -Path $log -Value ("===== " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " " + $msg) }

if (-not (Test-Path $hookFile)) { Log 'push FAILED: webhook.txt missing'; exit 1 }
$url = (Get-Content $hookFile -Raw).Trim()
if ($url -notlike 'https://qyapi.weixin.qq.com/*') { Log 'push FAILED: webhook.txt has no valid URL'; exit 1 }
if (-not (Test-Path $pushFile)) { Log "push FAILED: $pushFile missing"; exit 1 }

# --- 0. mojibake guard: refuse to push files containing U+FFFD replacement chars ---
$bad = @()
foreach ($f in @($pushFile, $fullFile, "D:\ai-news\html\$today.html")) {
  if (Test-Path $f) {
    $t = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
    if ($t.IndexOf([char]0xFFFD) -ge 0) { $bad += $f }
  }
}
if ($bad.Count -gt 0) { Log ('push BLOCKED: U+FFFD found in ' + ($bad -join ', ')); exit 1 }

function PostJson($u, $b) {
  for ($i = 1; $i -le 3; $i++) {
    try {
      $r = Invoke-RestMethod -Method Post -Uri $u -ContentType 'application/json' -Body $b -TimeoutSec 20
      if ($r.errcode -eq 0) { return $r }
      Log ("post attempt " + $i + " errcode " + $r.errcode + " " + $r.errmsg)
    } catch { Log ("post attempt " + $i + " exception: " + $_.Exception.Message) }
    Start-Sleep -Seconds 5
  }
  return $null
}

# --- 1. markdown digest summary ---
$content = [System.IO.File]::ReadAllText($pushFile, [System.Text.Encoding]::UTF8).Trim()
$bytes = [System.Text.Encoding]::UTF8.GetByteCount($content)
if ($bytes -gt 3800) {
  while ($bytes -gt 3700 -and $content.Contains("`n")) {
    $content = $content.Substring(0, $content.LastIndexOf("`n"))
    $bytes = [System.Text.Encoding]::UTF8.GetByteCount($content)
  }
  $content = $content + "`n...(truncated)"
}
$payload = @{ msgtype = 'markdown'; markdown = @{ content = $content } } | ConvertTo-Json -Depth 3
$ok1 = PostJson $url ([System.Text.Encoding]::UTF8.GetBytes($payload))
if ($ok1) { Log 'push ok (markdown)' } else { Log 'push FAILED (markdown) - aborting, exit 1'; exit 1 }

# --- 2. full digest as tappable group file (html preferred, md fallback) ---
$attach = $fullFile
$htmlFile = "D:\ai-news\html\$today.html"
if (Test-Path $htmlFile) { $attach = $htmlFile }
if (Test-Path $attach) {
  $tmp = Join-Path $env:TEMP ("AI-daily-" + $today + [System.IO.Path]::GetExtension($attach))
  Copy-Item $attach $tmp -Force
  $upUrl = ($url -replace '/send\?', '/upload_media?') + '&type=file'
  try {
    $resp = & curl.exe -s --max-time 30 --retry 2 --retry-delay 3 -F ("file=@""" + $tmp + """") $upUrl
    $j = $resp | ConvertFrom-Json
    if ($j.media_id) {
      $payload2 = @{ msgtype = 'file'; file = @{ media_id = $j.media_id } } | ConvertTo-Json -Depth 3
      $ok2 = PostJson $url ([System.Text.Encoding]::UTF8.GetBytes($payload2))
      if ($ok2) { Log 'push ok (file attachment)' } else { Log 'push FAILED (file attachment)' }
    } else { Log ("upload_media failed: " + $resp) }
  } catch { Log ("upload exception: " + $_.Exception.Message) }
}
exit 0
