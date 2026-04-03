param(
  [Parameter(Mandatory = $true)][string]$AccountId,
  [string]$CookieFile = "",
  [switch]$AutoCapture,
  [switch]$UseLiveProfile,
  [ValidateSet("chrome", "edge")][string]$Browser = "chrome",
  [int]$CaptureTimeoutSec = 240,
  [int]$CapturePort = 9229,
  [string]$CaptureProfile = "",
  [string]$ApiKey = "dev-api-secret-key-change-in-production",
  [string]$RouteAuthToken = "",
  [string]$BaseUrl = "http://localhost:3001"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-CandidateCookieFiles {
  param([string]$PreferredPath)

  $candidates = New-Object System.Collections.Generic.List[string]
  if ($PreferredPath -and $PreferredPath.Trim()) {
    $candidates.Add($PreferredPath)
  }

  $defaults = @(
    (Join-Path $repoRoot "linkedin-cookies-plain.json"),
    (Join-Path $env:USERPROFILE "Downloads\\linkedin-cookies-plain.json"),
    (Join-Path $env:USERPROFILE "Downloads\\cookies.json")
  )

  foreach ($p in $defaults) {
    if (-not $candidates.Contains($p)) {
      $candidates.Add($p)
    }
  }

  return @($candidates)
}

function Get-CookieArrayFromFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Cookie file not found: $Path"
  }

  $raw = Get-Content -LiteralPath $Path -Raw
  if (-not $raw -or -not $raw.Trim()) {
    throw "Cookie file is empty: $Path"
  }

  $parsed = $raw | ConvertFrom-Json

  if ($parsed -is [System.Array]) {
    return $parsed
  }

  # Some tools export { cookies: [...] }
  if ($parsed.PSObject.Properties.Name -contains 'cookies' -and $parsed.cookies -is [System.Array]) {
    return $parsed.cookies
  }

  # Some tools export { data: "[...]" } (JSON string payload)
  if ($parsed.PSObject.Properties.Name -contains 'data' -and ($parsed.data -is [string])) {
    $data = $parsed.data.Trim()
    if ($data.StartsWith('[')) {
      $inner = $data | ConvertFrom-Json
      if ($inner -is [System.Array]) {
        return $inner
      }
    }

    # Known encrypted Cookie-Editor/HotCleaner wrapper
    if (($parsed.PSObject.Properties.Name -contains 'url') -and ($parsed.url -like '*hotcleaner.com*')) {
      throw @"
Detected encrypted HotCleaner/Cookie-Editor export format.
This app needs plain JSON array cookies.
Export again as plain JSON cookies (array of objects with name/value/domain/path), not encrypted backup format.
"@
    }
  }

  throw "Unsupported cookie JSON format. Expected a JSON array of cookie objects."
}

function Try-LoadCookiesFromFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  try {
    $cookies = Get-CookieArrayFromFile -Path $Path
    Validate-CookieShape -Cookies $cookies
    return @{
      path = $Path
      cookies = $cookies
    }
  } catch {
    Write-Warning "Skipping cookie file '$Path': $($_.Exception.Message)"
    return $null
  }
}

function Validate-CookieShape {
  param([Parameter(Mandatory = $true)][object[]]$Cookies)

  if ($Cookies.Count -eq 0) {
    throw "Cookie array is empty."
  }

  $liAt = $false
  $jsession = $false

  foreach ($c in $Cookies) {
    if (-not $c.name -or -not $c.value -or -not $c.domain) {
      throw "Each cookie must include at least: name, value, domain."
    }
    if ($c.name -eq 'li_at') { $liAt = $true }
    if ($c.name -eq 'JSESSIONID') { $jsession = $true }
  }

  if (-not $liAt -or -not $jsession) {
    throw "Missing required LinkedIn cookies. Need both li_at and JSESSIONID."
  }
}

function Invoke-AutoCapture {
  param(
    [Parameter(Mandatory = $true)][string]$OutputFile
  )

  $captureScript = Join-Path $repoRoot "scripts\\capture-linkedin-cookies.mjs"
  if (-not (Test-Path -LiteralPath $captureScript)) {
    throw "Auto-capture script not found: $captureScript"
  }

  $portCandidates = @($CapturePort, ($CapturePort + 111), ($CapturePort + 222)) |
    Where-Object { $_ -ge 1024 -and $_ -le 65535 } |
    Select-Object -Unique

  function Invoke-CaptureAttempt {
    param(
      [Parameter(Mandatory = $true)][bool]$LiveProfileMode,
      [Parameter(Mandatory = $true)][int]$Port
    )

    # Ensure stale browser processes from prior failed attempts don't hold profile/port.
    $procName = if ($Browser -eq 'edge') { 'msedge' } else { 'chrome' }
    Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    $args = @(
      $captureScript,
      "--browser", $Browser,
      "--timeoutSec", $CaptureTimeoutSec.ToString(),
      "--port", $Port.ToString(),
      "--output", $OutputFile
    )
    if ($LiveProfileMode) {
      $args += @("--use-live-profile")
    } else {
      $args += @("--use-temp-copy")
    }
    if ($CaptureProfile -and $CaptureProfile.Trim()) {
      $args += @("--profile", $CaptureProfile)
    }

    Write-Host "Starting automatic LinkedIn cookie capture via $Browser..."
    Write-Host ("Capture mode: " + ($(if ($LiveProfileMode) { "live-profile" } else { "temp-profile-copy" })) + ", DevTools port: $Port")
    & node $args
    return $LASTEXITCODE
  }

  if ($UseLiveProfile) {
    foreach ($port in $portCandidates) {
      $code = Invoke-CaptureAttempt -LiveProfileMode $true -Port $port
      if ($code -eq 0) { return }
      Write-Warning "Live-profile capture failed on port $port."
    }
    Write-Warning "Falling back to temp-profile-copy capture. Live-profile DevTools can be blocked by newer Chrome security behavior."
  }

  foreach ($port in $portCandidates) {
    $code = Invoke-CaptureAttempt -LiveProfileMode $false -Port $port
    if ($code -eq 0) { return }
    Write-Warning "Temp-profile-copy capture failed on port $port."
  }

  throw "Auto-capture failed after retries. Please ensure LinkedIn login can be completed in the launched browser window."
}

try {
  $selected = $null
  if ($AutoCapture) {
    # Force fresh capture first when explicitly requested.
    $capturedPath = if ($CookieFile -and $CookieFile.Trim()) {
      $CookieFile
    } else {
      Join-Path $repoRoot "linkedin-cookies-plain.json"
    }
    Invoke-AutoCapture -OutputFile $capturedPath
    $selected = Try-LoadCookiesFromFile -Path $capturedPath
  }

  if (-not $selected) {
    foreach ($candidate in (Resolve-CandidateCookieFiles -PreferredPath $CookieFile)) {
      $loaded = Try-LoadCookiesFromFile -Path $candidate
      if ($loaded) {
        $selected = $loaded
        break
      }
    }
  }

  if (-not $selected) {
    $hint = if ($AutoCapture) {
      "Auto-capture did not produce valid li_at + JSESSIONID cookies."
    } else {
      "No usable cookie file found. Pass -AutoCapture to capture from browser automatically."
    }
    throw $hint
  }

  $cookies = $selected.cookies

  $body = $cookies | ConvertTo-Json -Depth 8 -Compress
  $headers = @{ "X-Api-Key" = $ApiKey }
  if ($RouteAuthToken -and $RouteAuthToken.Trim()) {
    $headers["Authorization"] = "Bearer $RouteAuthToken"
  }

  Write-Host "Importing cookies for account '$AccountId' from '$($selected.path)'..."
  $import = Invoke-RestMethod -Method Post -Uri "$BaseUrl/accounts/$AccountId/session" -Headers $headers -ContentType "application/json" -Body $body
  $import | ConvertTo-Json -Depth 6 | Write-Host

  Write-Host ""
  Write-Host "Verifying session..."
  $verify = Invoke-RestMethod -Method Post -Uri "$BaseUrl/accounts/$AccountId/verify" -Headers $headers
  $verify | ConvertTo-Json -Depth 6 | Write-Host

  Write-Host ""
  Write-Host "Done."
} catch {
  $response = $null
  if (
    $_.Exception -and
    $_.Exception.PSObject -and
    $_.Exception.PSObject.Properties.Name -contains 'Response'
  ) {
    $response = $_.Exception.Response
  }

  if ($response) {
    try {
      $statusCode = [int]$response.StatusCode
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      $body = $reader.ReadToEnd()
      if ($body) {
        Write-Host $body
      } else {
        Write-Host $_.Exception.Message
      }
      if ($statusCode -eq 401 -and ($body -match 'SESSION_EXPIRED|NO_SESSION|Unauthorized')) {
        Write-Host ""
        Write-Host "Hint: imported cookies are not active now. Re-capture fresh cookies and import again."
      }
      exit 1
    } catch {
      # fall through to existing handlers
    }
  }

  if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
    Write-Host $_.ErrorDetails.Message
    exit 1
  }
  Write-Host $_.Exception.Message
  exit 1
}
