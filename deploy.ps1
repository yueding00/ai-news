# deploy.ps1 - one-shot deploy of this skill package to a GitHub repo
# Usage: powershell -File deploy.ps1 [-RepoUrl git@github.com:you/ai-news.git]
param([string]$RepoUrl)
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

if (-not $RepoUrl) { $RepoUrl = Read-Host 'Repo URL (git@github.com:you/ai-news.git)' }
if (-not $RepoUrl) { Write-Output 'no repo url, abort'; exit 1 }

if (-not (Test-Path '.git')) { git init -b main | Out-Null }
git add -A
git -c user.name='ai-news-bot' -c user.email='ai-news-bot@users.noreply.github.com' commit -m 'ai-news: cloud skill initial commit' 2>$null | Out-Null
git remote remove origin 2>$null | Out-Null
git remote add origin $RepoUrl
git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Output ''
  Write-Output 'PUSH FAILED. Check:'
  Write-Output '  1) SSH key added to GitHub? (Settings -> SSH and GPG keys)'
  Write-Output '  2) Repo created and empty?'
  Write-Output '  3) If using HTTPS, use a Personal Access Token as password.'
  exit 1
}
Write-Output 'PUSH OK. Now add 4 secrets in repo Settings -> Secrets and variables -> Actions:'
Write-Output '  ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL / WECOM_WEBHOOK'
