# gate.ps1 - idempotent gate for the AI news daily digest pipeline.
# Decides on every firing (daily 09:20 main, 09:40/10:10/10:20 backups, at logon):
#   - no run started today               -> launch the full two-stage pipeline (run.cmd)
#   - run started, still in progress     -> skip (unless stalled, see below)
#   - stalled (lock owner dead + >15min) -> retry (within daily budget) else blocked+alert
#   - run FAILED marker today            -> retry (within daily budget) else blocked+alert
#   - run ended but not pushed           -> run push.ps1 only (alert if push fails)
#   - already pushed                     -> skip
# Daily retry budget: at most $maxStarts 'run start' markers per day (1st run + 1 retry).
# Lock file carries PID+TIME; takeover only when the owner process is verified dead
# (2026-09-30 P0-4). Locks older than 7 days are purged on every firing.
# 2026-10-08 (P0-5): empty-digest sentinel D:\ai-news\empty-<date>.txt is written by
# run.cmd failure branches (stage=1/2) so the gate can tell 'never ran' from 'ran but
# produced no digest'; the sentinel text feeds the blocked-state alert reason. A full
# artifact set wins over any leftover sentinel; sentinels are purged with stale locks.
# Pure ASCII file. Logs to D:\ai-news\gate.log (override via -LogPath).
param(
  [string]$RunLog  = 'D:\ai-news\run.log',
  [string]$PushLog = 'D:\ai-news\push.log',
  [string]$LogPath = 'D:\ai-news\gate.log'
)

# Headless runs: raise auto-compact trigger to the model window ceiling
# (1M tokens) to avoid STAGE-1 autocompact thrash (killed 09-21-22-29).
# Accepted range for CLAUDE_CODE_AUTO_COMPACT_WINDOW: 100000..1000000.
# Inherited by Start-Process children (run.cmd -> claude). ASCII only.
$env:CLAUDE_CODE_AUTO_COMPACT_WINDOW = '1000000'

$newsDir   = 'D:\ai-news'
$runCmd    = 'C:\Users\huangyicheng\.claude\skills\ai-news\run.cmd'
$pushPs1   = 'C:\Users\huangyicheng\.claude\skills\ai-news\push.ps1'
$alertPs1  = 'C:\Users\huangyicheng\.claude\skills\ai-news\alert.ps1'
$maxStarts = 3   # 1st run + 2 automatic retries per day (09:20/09:40/10:10), alert at 10:20 if all fail

$todayDash  = Get-Date -Format 'yyyy-MM-dd'
$todaySlash = Get-Date -Format 'yyyy/MM/dd'
$lockPath   = $newsDir + '\gate-' + $todayDash + '.lock'

function Write-GateLog([string]$msg) {
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Try { Add-Content -Path $LogPath -Value ($stamp + ' ' + $msg) -Encoding ASCII } Catch { }
}

function Send-Alert([string]$reason) {
  Try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $alertPs1 -Reason $reason | Out-Null
  } Catch {
    Write-GateLog ('GATE: alert dispatch exception: ' + $_.Exception.GetType().Name)
  }
}

function Test-BigEnough([string]$path) {
  Try {
    if (Test-Path $path) {
      $len = (Get-Item $path).Length
      if ($len -gt 1024) { return $true }
    }
  } Catch { }
  return $false
}

function Get-State {
  $started = $false; $ended = $false; $failed = $false; $pushed = $false
  $startCount = 0
  if (Test-Path $RunLog) {
    Try {
      # run.log carries both old %DATE% (yyyy/MM/dd) and new yyyy-MM-dd markers
      $ls = Select-String -Path $RunLog -Pattern 'run start'
      $lsToday = @($ls | Where-Object { $_.Line -match $todaySlash -or $_.Line -match $todayDash })
      $startCount = $lsToday.Count
      $started = ($startCount -gt 0)
      $le = Select-String -Path $RunLog -Pattern 'run end'
      $ended = [bool]@($le | Where-Object { $_.Line -match $todaySlash -or $_.Line -match $todayDash })
      # 2026-11-19: run-daily.js now writes 'run FAILED:'; legacy lines wrote 'FAILED:' - match both
      $lf = Select-String -Path $RunLog -Pattern 'run FAILED|FAILED:'
      $failed = [bool]@($lf | Where-Object { $_.Line -match $todaySlash -or $_.Line -match $todayDash })
    } Catch { }
  }
  # artifact-based ended fallback: end marker may be missing (crash / legacy log) -
  # if all three artifacts exist and are big enough, treat the run as ended.
  if ($started -and -not $ended) {
    if ((Test-BigEnough ($newsDir + '\' + $todayDash + '.md')) -and
        (Test-BigEnough ($newsDir + '\' + $todayDash + '.push.md')) -and
        (Test-BigEnough ($newsDir + '\html\' + $todayDash + '.html'))) {
      $ended = $true
    }
  }
  # empty-digest sentinel: meaningful only when the run did NOT end with artifacts;
  # a complete artifact set wins over any leftover sentinel (e.g. fail in retry, ok later)
  $emptySent = Test-Path ($newsDir + '\empty-' + $todayDash + '.txt')
  if ($ended) { $emptySent = $false }
  if (Test-Path $PushLog) {
    Try {
      $pp = Select-String -Path $PushLog -Pattern 'push ok'
      $pushed = [bool]@($pp | Where-Object { $_.Line -match $todayDash })
    } Catch { }
  }
  return @{ started = $started; ended = $ended; failed = $failed; pushed = $pushed; startCount = $startCount; emptySent = $emptySent }
}

function Read-LockInfo([string]$path) {
  # returns @{ ProcId = [int]; Time = [datetime] }; legacy/empty locks -> ProcId 0
  $procId = 0
  $t = $null
  Try {
    if (Test-Path $path) {
      $raw = Get-Content $path -Raw
      if ($raw -match 'PID=(\d+)\s+TIME=(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})') {
        $procId = [int]$Matches[1]
        Try { $t = [datetime]::ParseExact($Matches[2], 'yyyy-MM-dd HH:mm:ss', $null) } Catch { $t = $null }
      }
    }
  } Catch { }
  if ($null -eq $t) {
    Try { $t = (Get-Item $path).LastWriteTime } Catch { $t = Get-Date }
  }
  return @{ ProcId = $procId; Time = $t }
}

function Set-LockInfo([string]$path, [int]$procId) {
  Try {
    $line = 'PID=' + $procId + ' TIME=' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    Set-Content -Path $path -Value $line -Encoding ASCII
  } Catch { }
}

function Test-LockOwnerAlive($info) {
  if ($info.ProcId -gt 0) {
    Try {
      $p = Get-Process -Id $info.ProcId -ErrorAction Stop
      if ($p) { return $true }
    } Catch { }
  }
  return $false
}

function Try-AcquireLock([string]$path) {
  $fs = $null
  Try {
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew,
                                 [System.IO.FileAccess]::Write,
                                 [System.IO.FileShare]::None)
  } Catch { $fs = $null }
  if ($fs) { $fs.Close(); $fs.Dispose(); return $true }
  return $false
}

function Decide([hashtable]$s) {
  if ($s.pushed)       { return 'done' }
  if (-not $s.started) { return 'launch' }
  if ($s.ended)        { return 'pushonly' }
  if ($s.failed) {
    if ($s.startCount -lt $maxStarts) { return 'retry' }
    return 'blocked'
  }
  return 'inprogress'
}

# Decide + stall upgrade in one place. 2026-11-19 fix: the lock-contention recheck
# used to call Decide only, losing the stalled->retry upgrade, so every backup
# firing skipped with 'another gate handled it' after a failed/stalled first run.
function Resolve-Action([hashtable]$s) {
  $a = Decide $s
  if ($a -eq 'inprogress') {
    $stalled = $false
    if (-not (Test-Path $lockPath)) {
      $stalled = $true
      Write-GateLog 'GATE: run in progress but no lock file - treating as stalled'
    } else {
      $li = Read-LockInfo $lockPath
      $ageMin = ((Get-Date) - $li.Time).TotalMinutes
      if (-not (Test-LockOwnerAlive $li)) {
        if ($ageMin -gt 15) {
          $stalled = $true
          Write-GateLog ('GATE: lock owner PID ' + $li.ProcId + ' dead, age ' + [int]$ageMin + 'min - stalled')
        } else {
          Write-GateLog ('GATE: lock owner PID ' + $li.ProcId + ' dead, age ' + [int]$ageMin + 'min - grace period, skip')
        }
      }
    }
    if ($stalled) {
      if ($s.startCount -lt $maxStarts) { $a = 'retry' } else { $a = 'blocked' }
    }
  }
  return $a
}

# --- housekeeping: purge lock files older than 7 days (12 legacy 0-byte locks) ---
Try {
  $cutoff = (Get-Date).AddDays(-7)
  Get-ChildItem -Path ($newsDir + '\gate-*.lock') -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
  Get-ChildItem -Path ($newsDir + '\empty-*.txt') -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
} Catch { }

$state  = Get-State
$action = Resolve-Action $state

if ($action -eq 'done')       { Write-GateLog 'GATE: already pushed today, skip'; exit 0 }
if ($action -eq 'inprogress') { Write-GateLog 'GATE: run in progress, skip';      exit 0 }

if ($action -eq 'blocked') {
  if ($state.failed) {
    $reason = 'daily digest run failed today and retry budget is exhausted - manual intervention needed'
    if ($state.emptySent) {
      Try {
        $sent = (Get-Content ($newsDir + '\empty-' + $todayDash + '.txt') -Raw).Trim()
        if ($sent) {
          $reason = 'daily digest failed with empty-digest sentinel (' + $sent + ') - retry budget exhausted - manual intervention needed'
        }
      } Catch { }
    }
    Write-GateLog 'GATE: run FAILED today, retry budget exhausted - blocked, alerting'
    Send-Alert $reason
  } else {
    Write-GateLog 'GATE: run stalled today, retry budget is exhausted - blocked, alerting'
    Send-Alert 'daily digest run stalled today and retry budget is exhausted - manual intervention needed'
  }
  exit 0
}

# 'launch', 'retry' and 'pushonly' all need the daily lock
$won = Try-AcquireLock $lockPath
if (-not $won) {
  Start-Sleep -Seconds 25
  $state2  = Get-State
  $action2 = Resolve-Action $state2
  if ($action2 -ne 'launch' -and $action2 -ne 'retry' -and $action2 -ne 'pushonly') {
    Write-GateLog 'GATE: another gate handled it, skip'
    exit 0
  }
  $li2 = Read-LockInfo $lockPath
  if (Test-LockOwnerAlive $li2) {
    Write-GateLog ('GATE: lock owner PID ' + $li2.ProcId + ' still alive, not taking over, skip')
    exit 0
  }
  Write-GateLog 'GATE: stale day lock detected (owner dead), taking over'
  Remove-Item -Path $lockPath -Force -ErrorAction SilentlyContinue
  $won = Try-AcquireLock $lockPath
  if (-not $won) { Write-GateLog 'GATE: lock race lost, skip'; exit 0 }
}

# stamp the lock with this gate's own PID first (replaced by run.cmd PID below)
Set-LockInfo $lockPath $PID

if ($action -eq 'launch' -or $action -eq 'retry') {
  if ($action -eq 'launch') {
    Write-GateLog 'GATE: no run today, launching full pipeline'
  } else {
    Write-GateLog ('GATE: retrying pipeline (start ' + ($state.startCount + 1) + ' of ' + $maxStarts + ')')
  }
  Try {
    $p = Start-Process -FilePath $runCmd -WindowStyle Hidden -PassThru
    # run.cmd's cmd.exe outlives this gate process: it is the real lock owner
    Set-LockInfo $lockPath $p.Id
    Write-GateLog ('GATE: pipeline started, lock owner PID ' + $p.Id)
  } Catch {
    Write-GateLog ('GATE: Start-Process exception: ' + $_.Exception.GetType().Name)
    Send-Alert 'gate could not start the daily digest pipeline (Start-Process failed)'
  }
} else {
  Write-GateLog 'GATE: run done but not pushed, pushing now'
  Try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $pushPs1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-GateLog ('GATE: push.ps1 exit ' + $LASTEXITCODE + ' - alerting')
      Send-Alert ('daily digest push.ps1 failed with exit code ' + $LASTEXITCODE)
    }
  } Catch {
    Write-GateLog ('GATE: push exception: ' + $_.Exception.GetType().Name)
    Send-Alert 'daily digest push raised an exception in gate pushonly mode'
  }
}
exit 0
