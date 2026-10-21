# check.ps1 - AI News quality gate (P1-2, 2026-09-30)
# Pure ASCII. Run after STAGE 2; exit 0 = all checks pass, exit 1 = any FAIL.
# Checks:
#   1. three artifacts exist and are > 1024 bytes
#   2. zero U+FFFD replacement chars in all three
#   3. push.md UTF-8 size in [3800, 6000] bytes AND CJK count >= 650
#   4. html header stat total == actual <article class="card"> count
#   5. html footer total == same actual count
#   6. each section <small>N</small> == cards in that section, and sum == total
param(
  [string]$Date = '',
  [string]$Dir = 'D:\ai-news'
)

if ($Date -eq '') { $Date = Get-Date -Format 'yyyy-MM-dd' }

$mdFile   = Join-Path $Dir ($Date + '.md')
$pushFile = Join-Path $Dir ($Date + '.push.md')
$htmlFile = Join-Path $Dir ('html\' + $Date + '.html')

$fails = 0

function Report([bool]$ok, [string]$msg) {
  if ($ok) {
    Write-Output ('[CHECK] PASS: ' + $msg)
  } else {
    Write-Output ('[CHECK] FAIL: ' + $msg)
    $script:fails = $script:fails + 1
  }
}

# --- 1. artifacts exist and > 1KB ---
foreach ($f in @($mdFile, $pushFile, $htmlFile)) {
  if (Test-Path $f) {
    $len = (Get-Item $f).Length
    Report ($len -gt 1024) ($f + ' size ' + $len + ' bytes (need > 1024)')
  } else {
    Report $false ($f + ' is MISSING')
  }
}

if (-not (Test-Path $pushFile) -or -not (Test-Path $htmlFile)) {
  Write-Output '[CHECK] missing core artifacts, aborting further checks'
  exit 1
}

# --- 2. U+FFFD scan (read as UTF-8) ---
if (Test-Path $mdFile) {
  $mdText = [System.IO.File]::ReadAllText($mdFile, [System.Text.Encoding]::UTF8)
} else { $mdText = '' }
$pushText = [System.IO.File]::ReadAllText($pushFile, [System.Text.Encoding]::UTF8)
$htmlText = [System.IO.File]::ReadAllText($htmlFile, [System.Text.Encoding]::UTF8)

$bad = [char]0xFFFD
Report ($mdText.IndexOf($bad)   -lt 0) 'full md has no U+FFFD'
Report ($pushText.IndexOf($bad) -lt 0) 'push md has no U+FFFD'
Report ($htmlText.IndexOf($bad) -lt 0) 'html has no U+FFFD'

# --- 3. push.md size sanity (calibrated 2026-09-30 on 29-day history) ---
# Data: substantive days (09-11..09-30) = 4145..5527 bytes, 802..1242 CJK,
# ratio 4.3..5.3; thin era (<=09-10, user complaint "too short") = <=3514 bytes.
# SKILL.md's "1250 chars ~ 3700 bytes" assumes ratio ~3.0, does NOT match reality.
# Floor 3800 = one full WeCom message (sits in the 3514..4145 data gap).
# Ceiling 6000 = runaway/duplication guard (observed max 5527).
# CJK floor 650 = anti-ASCII-padding guard (allows ratio up to ~5.85, observed max 5.84).
# Note: >3800 truncation by push.ps1 is by-design degradation (HTML attachment
# carries full text), so it is NOT a failure here.
$bytes = [System.Text.Encoding]::UTF8.GetByteCount($pushText)
$cjk = 0
foreach ($ch in $pushText.ToCharArray()) {
  $code = [int]$ch
  if ($code -ge 0x4E00 -and $code -le 0x9FFF) { $cjk = $cjk + 1 }
}
Report (($bytes -ge 3800) -and ($bytes -le 6000)) ('push md size ' + $bytes + ' bytes (need 3800..6000)')
Report ($cjk -ge 650) ('push md CJK count ' + $cjk + ' (need >= 650)')

# --- 4/5. html totals vs actual card count ---
$cards = ([regex]::Matches($htmlText, '<article class="card"')).Count

# CJK char "tiao" (item counter) as regex escape, keeps this file ASCII-only
$tiao = '\u6761'

$m = [regex]::Match($htmlText, 'class="stat">[^<]*?(\d+)\s*' + $tiao)
if ($m.Success) {
  $head = [int]$m.Groups[1].Value
  Report ($head -eq $cards) ('html header stat ' + $head + ' vs actual cards ' + $cards)
} else {
  Report $false 'html header stat pattern not found'
}

$m2 = [regex]::Match($htmlText, '(\d+)\s*' + $tiao + '\s*/\s*(\d+)')
if ($m2.Success) {
  $foot = [int]$m2.Groups[1].Value
  Report ($foot -eq $cards) ('html footer total ' + $foot + ' vs actual cards ' + $cards)
} else {
  Report $false 'html footer total pattern not found'
}

# --- 6. per-section counts ---
$h2s = [regex]::Matches($htmlText, '<h2 class="sec">[^<]*<small>(\d+)\s*' + $tiao + '</small></h2>')
if ($h2s.Count -eq 0) {
  Report $false 'no section headers with <small>N</small> found'
} else {
  $sum = 0
  for ($i = 0; $i -lt $h2s.Count; $i++) {
    $start = $h2s[$i].Index + $h2s[$i].Length
    if ($i + 1 -lt $h2s.Count) { $end = $h2s[$i + 1].Index } else { $end = $htmlText.Length }
    $seg = $htmlText.Substring($start, $end - $start)
    $actual = ([regex]::Matches($seg, '<article class="card"')).Count
    $claimed = [int]$h2s[$i].Groups[1].Value
    $sum = $sum + $claimed
    Report ($claimed -eq $actual) ('section ' + ($i + 1) + ' claims ' + $claimed + ' cards, has ' + $actual)
  }
  Report ($sum -eq $cards) ('section sum ' + $sum + ' vs actual cards ' + $cards)
}

# --- verdict ---
if ($fails -gt 0) {
  Write-Output ('[CHECK] RESULT: FAIL (' + $fails + ' check(s) failed)')
  exit 1
}
Write-Output '[CHECK] RESULT: PASS (all checks ok)'
exit 0
