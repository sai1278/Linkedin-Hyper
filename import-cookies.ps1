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

function Get-BrowserUserDataRoot {
  param([Parameter(Mandatory = $true)][string]$BrowserName)

  if ($BrowserName -eq 'edge') {
    return Join-Path $env:LOCALAPPDATA "Microsoft\\Edge\\User Data"
  }
  return Join-Path $env:LOCALAPPDATA "Google\\Chrome\\User Data"
}

function Resolve-CaptureProfileForBrowser {
  param([Parameter(Mandatory = $true)][string]$BrowserName)

  if (-not $CaptureProfile -or -not $CaptureProfile.Trim()) {
    return ""
  }

  $root = Get-BrowserUserDataRoot -BrowserName $BrowserName
  $candidate = Join-Path $root $CaptureProfile
  if (Test-Path -LiteralPath $candidate) {
    return $CaptureProfile
  }

  Write-Warning "Profile '$CaptureProfile' not found for browser '$BrowserName' at '$root'. Falling back to browser default profile."
  return ""
}

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
    [Parameter(Mandatory = $true)][string]$OutputFile,
    [switch]$ForceLiveProfile
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
      [Parameter(Mandatory = $true)][string]$BrowserName,
      [Parameter(Mandatory = $true)][bool]$LiveProfileMode,
      [Parameter(Mandatory = $true)][int]$Port
    )

    # Ensure stale browser processes from prior failed attempts don't hold profile/port.
    $procName = if ($BrowserName -eq 'edge') { 'msedge' } else { 'chrome' }
    Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    $args = @(
      $captureScript,
      "--browser", $BrowserName,
      "--timeoutSec", $CaptureTimeoutSec.ToString(),
      "--port", $Port.ToString(),
      "--output", $OutputFile
    )
    if ($LiveProfileMode) {
      $args += @("--use-live-profile")
    } else {
      $args += @("--use-temp-copy")
    }
    $effectiveProfile = Resolve-CaptureProfileForBrowser -BrowserName $BrowserName
    if ($effectiveProfile) {
      $args += @("--profile", $effectiveProfile)
    }

    Write-Host "Starting automatic LinkedIn cookie capture via $BrowserName..."
    Write-Host ("Capture mode: " + ($(if ($LiveProfileMode) { "live-profile" } else { "temp-profile-copy" })) + ", DevTools port: $Port")
    $hasNativeVar = $false
    $nativePrev = $null
    try {
      $nativeVar = Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue
      if ($null -ne $nativeVar) {
        $hasNativeVar = $true
        $nativePrev = $nativeVar.Value
        Set-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -Value $false
      }
    } catch {
      # Best effort only; continue.
    }

    $attemptOutputLines = New-Object System.Collections.Generic.List[string]
    $attemptExitCode = 0
    try {
      & node $args 2>&1 | ForEach-Object {
        $line = $_.ToString()
        [void]$attemptOutputLines.Add($line)
        Write-Host $line
      }
      $attemptExitCode = $LASTEXITCODE
    } finally {
      if ($hasNativeVar) {
        try {
          Set-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -Value $nativePrev
        } catch {
          # ignore restore failure
        }
      }
    }
    return @{
      code = $attemptExitCode
      outputText = (($attemptOutputLines | ForEach-Object { $_.ToString() }) -join "`n")
    }
  }

  function Should-StopRetry {
    param([string]$OutputText)

    if ($OutputText -match '\[(CHECKPOINT_INCOMPLETE|LOGIN_NOT_FINISHED|COOKIES_MISSING|AUTHENTICATED_STATE_NOT_REACHED)\]') {
      return $true
    }

    if (-not $OutputText) { return $false }
    $text = $OutputText.ToLowerInvariant()
    return (
      $text.Contains("timed out waiting for li_at and jsessionid cookies") -or
      $text.Contains("playwright fallback timed out waiting for li_at + jsessionid cookies") -or
      $text.Contains("auto-capture failed after retries on all browsers/ports")
    )
  }

  function Get-CaptureFailureCode {
    param([string]$OutputText)
    if ($OutputText -match '\[(CHECKPOINT_INCOMPLETE|LOGIN_NOT_FINISHED|COOKIES_MISSING|AUTHENTICATED_STATE_NOT_REACHED)\]') {
      return $Matches[1]
    }
    return ""
  }

  function Get-CaptureFailureHint {
    param([string]$Code)
    switch ($Code) {
      "CHECKPOINT_INCOMPLETE" { return "LinkedIn checkpoint/challenge is still pending. Complete checkpoint in browser and retry." }
      "LOGIN_NOT_FINISHED" { return "LinkedIn login is not fully completed. Finish login and wait for feed page before retry." }
      "COOKIES_MISSING" { return "Required cookies li_at and/or JSESSIONID were not captured from authenticated state." }
      default { return "Authenticated LinkedIn member state was not reached before timeout." }
    }
  }

  $browserCandidates = @($Browser)
  if ($Browser -eq 'chrome') {
    $browserCandidates += @('edge')
  }
  $browserCandidates = $browserCandidates | Select-Object -Unique

  $effectiveUseLiveProfile = $UseLiveProfile -or $ForceLiveProfile

  foreach ($browserName in $browserCandidates) {
    if ($browserName -ne $Browser) {
      Write-Warning "Retrying auto-capture with browser fallback: $browserName"
    }

    if ($effectiveUseLiveProfile) {
      foreach ($port in $portCandidates) {
        $result = Invoke-CaptureAttempt -BrowserName $browserName -LiveProfileMode $true -Port $port
        if ($result.code -eq 0) { return }
        Write-Warning "Live-profile capture failed on port $port ($browserName)."
        $captureCode = Get-CaptureFailureCode -OutputText $result.outputText
        if ($captureCode) {
          $hint = Get-CaptureFailureHint -Code $captureCode
          throw "Capture failed with code $captureCode. $hint"
        }
        if (Should-StopRetry -OutputText $result.outputText) {
          throw "Capture failed because login/cookie activation did not complete in browser. Complete LinkedIn sign-in/challenge and retry once."
        }
      }
      Write-Warning "Falling back to temp-profile-copy capture for $browserName."
    }

    foreach ($port in $portCandidates) {
      $result = Invoke-CaptureAttempt -BrowserName $browserName -LiveProfileMode $false -Port $port
      if ($result.code -eq 0) { return }
      Write-Warning "Temp-profile-copy capture failed on port $port ($browserName)."
      $captureCode = Get-CaptureFailureCode -OutputText $result.outputText
      if ($captureCode) {
        $hint = Get-CaptureFailureHint -Code $captureCode
        throw "Capture failed with code $captureCode. $hint"
      }
      if (Should-StopRetry -OutputText $result.outputText) {
        throw "Capture failed because login/cookie activation did not complete in browser. Complete LinkedIn sign-in/challenge and retry once."
      }
    }
  }

  throw "Auto-capture failed after retries on all browsers/ports. Please ensure the launched browser window appears and login can be completed."
}

function Invoke-ImportAndVerify {
  param(
    [Parameter(Mandatory = $true)][string]$AccountId,
    [Parameter(Mandatory = $true)][object[]]$Cookies,
    [Parameter(Mandatory = $true)][string]$SourcePath
  )

  $body = $Cookies | ConvertTo-Json -Depth 8 -Compress
  $headers = @{ "X-Api-Key" = $ApiKey }
  if ($RouteAuthToken -and $RouteAuthToken.Trim()) {
    $headers["Authorization"] = "Bearer $RouteAuthToken"
  }

  Write-Host "Importing cookies for account '$AccountId' from '$SourcePath'..."
  $import = Invoke-RestMethod -Method Post -Uri "$BaseUrl/accounts/$AccountId/session" -Headers $headers -ContentType "application/json" -Body $body
  $import | ConvertTo-Json -Depth 6 | Write-Host

  Write-Host ""
  Write-Host "Verifying session..."
  $verify = Invoke-RestMethod -Method Post -Uri "$BaseUrl/accounts/$AccountId/verify" -Headers $headers
  $verify | ConvertTo-Json -Depth 6 | Write-Host

  Write-Host ""
  Write-Host "Done."
}

function Should-RetryWithLiveProfile {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  if (-not $ErrorRecord) { return $false }
  $text = ""
  if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
    $text += [string]$ErrorRecord.ErrorDetails.Message
  }
  if ($ErrorRecord.Exception -and $ErrorRecord.Exception.Message) {
    $text += "`n" + [string]$ErrorRecord.Exception.Message
  }
  return ($text -match 'SESSION_EXPIRED|Session expired')
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

  $firstError = $null
  try {
    Invoke-ImportAndVerify -AccountId $AccountId -Cookies $cookies -SourcePath $selected.path
  } catch {
    $firstError = $_
  }

  if (
    $firstError -and
    $AutoCapture -and
    -not $UseLiveProfile -and
    (Should-RetryWithLiveProfile -ErrorRecord $firstError)
  ) {
    Write-Warning "Imported cookies were not active on server. Retrying auto-capture once with live-profile mode..."
    $capturedPath = if ($CookieFile -and $CookieFile.Trim()) { $CookieFile } else { Join-Path $repoRoot "linkedin-cookies-plain.json" }
    Invoke-AutoCapture -OutputFile $capturedPath -ForceLiveProfile
    $retrySelected = Try-LoadCookiesFromFile -Path $capturedPath
    if (-not $retrySelected) {
      throw $firstError
    }
    Invoke-ImportAndVerify -AccountId $AccountId -Cookies $retrySelected.cookies -SourcePath $retrySelected.path
  } elseif ($firstError) {
    throw $firstError
  }
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
      } elseif ($statusCode -eq 401 -and ($body -match 'CHECKPOINT_INCOMPLETE')) {
        Write-Host ""
        Write-Host "Hint: LinkedIn checkpoint/challenge is still pending. Complete it in browser, then re-capture."
      } elseif ($statusCode -eq 401 -and ($body -match 'LOGIN_NOT_FINISHED')) {
        Write-Host ""
        Write-Host "Hint: LinkedIn login is not fully completed in capture browser. Sign in and wait for feed page."
      } elseif ($statusCode -eq 401 -and ($body -match 'COOKIES_MISSING')) {
        Write-Host ""
        Write-Host "Hint: Required LinkedIn cookies (li_at/JSESSIONID) missing from capture."
      } elseif ($statusCode -eq 401 -and ($body -match 'AUTHENTICATED_STATE_NOT_REACHED')) {
        Write-Host ""
        Write-Host "Hint: Capture did not reach stable logged-in member page before export."
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
