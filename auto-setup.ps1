param(
  [string]$AccountId = "saikanchi130",
  [ValidateSet("chrome", "edge")][string]$Browser = "chrome",
  [string]$CaptureProfile = "",
  [int]$CaptureTimeoutSec = 240,
  [string]$ApiKey = "dev-api-secret-key-change-in-production",
  [string]$BaseUrl = "http://localhost:3001",
  [string]$ProfileUrl = "",
  [string]$TestText = "Hi, test message from automation"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $repoRoot "start-dev.ps1"
$importScript = Join-Path $repoRoot "import-cookies.ps1"
$testScript = Join-Path $repoRoot "test-message.ps1"

if (-not (Test-Path -LiteralPath $startScript)) { throw "Missing script: $startScript" }
if (-not (Test-Path -LiteralPath $importScript)) { throw "Missing script: $importScript" }
if (-not (Test-Path -LiteralPath $testScript)) { throw "Missing script: $testScript" }

Write-Host "1/3 Starting frontend + backend..."
& $startScript
if ($LASTEXITCODE -ne 0) {
  throw "start-dev.ps1 failed."
}

Write-Host ""
Write-Host "2/3 Capturing/importing LinkedIn session for '$AccountId'..."
$importArgs = @(
  "-AccountId", $AccountId,
  "-AutoCapture",
  "-Browser", $Browser,
  "-CaptureTimeoutSec", $CaptureTimeoutSec.ToString(),
  "-ApiKey", $ApiKey,
  "-BaseUrl", $BaseUrl
)
if ($CaptureProfile -and $CaptureProfile.Trim()) {
  $importArgs += @("-CaptureProfile", $CaptureProfile)
}

& $importScript @importArgs
if ($LASTEXITCODE -ne 0) {
  throw "import-cookies.ps1 failed."
}

Write-Host ""
if ($ProfileUrl -and $ProfileUrl.Trim()) {
  Write-Host "3/3 Sending test message..."
  & $testScript -AccountId $AccountId -ProfileUrl $ProfileUrl -Text $TestText -ApiKey $ApiKey -BaseUrl $BaseUrl
  if ($LASTEXITCODE -ne 0) {
    throw "test-message.ps1 failed."
  }
} else {
  Write-Host "3/3 Skipping test message (no -ProfileUrl provided)."
}

Write-Host ""
Write-Host "Done. Frontend: http://localhost:3000"
Write-Host "Backend : http://localhost:3001/health"

