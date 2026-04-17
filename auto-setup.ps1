param(
  [string]$AccountId = "saikanchi130",
  [ValidateSet("chrome", "edge")][string]$Browser = "chrome",
  [string]$CaptureProfile = "",
  [int]$CaptureTimeoutSec = 240,
  [string]$ApiKey = "",
  [string]$RouteAuthToken = "",
  [string]$BaseUrl = "http://localhost:3001",
  [string]$ProfileUrl = "",
  [string]$TestText = "Hi, test message from automation"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-ConfigValue {
  param([Parameter(Mandatory = $true)][string]$Key)

  $envValue = [Environment]::GetEnvironmentVariable($Key)
  if (-not [string]::IsNullOrWhiteSpace($envValue)) {
    return $envValue.Trim()
  }

  $envFile = Join-Path $repoRoot ".env"
  if (-not (Test-Path -LiteralPath $envFile)) {
    return ""
  }

  $pattern = "^\s*$([regex]::Escape($Key))=(.*)$"
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match $pattern } | Select-Object -Last 1
  if (-not $line) {
    return ""
  }

  return ($line -replace $pattern, '$1').Trim().Trim('"').Trim("'")
}

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  $ApiKey = Get-ConfigValue -Key "API_SECRET"
}
if ([string]::IsNullOrWhiteSpace($RouteAuthToken)) {
  $RouteAuthToken = Get-ConfigValue -Key "API_ROUTE_AUTH_TOKEN"
}

$isFrontendApi = $BaseUrl -match '/api/?$'
if ($isFrontendApi -and [string]::IsNullOrWhiteSpace($RouteAuthToken)) {
  throw "BaseUrl points to the public /api BFF. Provide -RouteAuthToken or set API_ROUTE_AUTH_TOKEN in .env/environment."
}

if ((-not $isFrontendApi) -and [string]::IsNullOrWhiteSpace($ApiKey)) {
  throw "Missing API key. Provide -ApiKey or set API_SECRET in .env/environment."
}

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
  "-RouteAuthToken", $RouteAuthToken,
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
  & $testScript -AccountId $AccountId -ProfileUrl $ProfileUrl -Text $TestText -ApiKey $ApiKey -RouteAuthToken $RouteAuthToken -BaseUrl $BaseUrl
  if ($LASTEXITCODE -ne 0) {
    throw "test-message.ps1 failed."
  }
} else {
  Write-Host "3/3 Skipping test message (no -ProfileUrl provided)."
}

Write-Host ""
Write-Host "Done. Frontend: http://localhost:3000"
Write-Host "Backend : http://localhost:3001/health"
