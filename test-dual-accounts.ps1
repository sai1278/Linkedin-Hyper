param(
  [string]$AccountIds = "",
  [string]$ProfileUrl = "",
  [string]$Text = "",
  [string]$CookieDir = ".",
  [string]$CookieFileMapJson = "",
  [string]$ApiKey = "dev-api-secret-key-change-in-production",
  [string]$RouteAuthToken = "",
  [string]$BaseUrl = "http://localhost:3001"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($CookieDir) -or $CookieDir.Trim() -eq ".") {
  $CookieDir = (Get-Location).Path
} elseif (-not [System.IO.Path]::IsPathRooted($CookieDir)) {
  $CookieDir = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $CookieDir))
} else {
  $CookieDir = [System.IO.Path]::GetFullPath($CookieDir)
}

if ([string]::IsNullOrWhiteSpace($ProfileUrl)) {
  Write-Error "Provide -ProfileUrl, for example: -ProfileUrl 'https://www.linkedin.com/in/someone/'"
  exit 1
}

if ([string]::IsNullOrWhiteSpace($Text)) {
  $Text = "Hi, test message from automation ($(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'))"
}

function Invoke-Api {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [string]$BodyJson = "",
    [switch]$AllowFailure
  )

  $headers = @{ "X-Api-Key" = $ApiKey }
  if ($RouteAuthToken -and $RouteAuthToken.Trim()) {
    $headers["Authorization"] = "Bearer $RouteAuthToken"
  }

  try {
    if ($BodyJson) {
      return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ContentType "application/json" -Body $BodyJson
    }
    return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers
  } catch {
    $statusCode = $null
    $responseBody = ""

    if ($_.Exception.Response) {
      try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
      try {
        if ($_.Exception.Response.Content) {
          $contentText = $_.Exception.Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
          if (-not [string]::IsNullOrWhiteSpace($contentText)) {
            $responseBody = $contentText
          }
        }
      } catch {}
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $legacyBody = $reader.ReadToEnd()
        if (-not [string]::IsNullOrWhiteSpace($legacyBody)) {
          $responseBody = $legacyBody
        }
      } catch {}
    }

    if (-not $responseBody -and $_.ErrorDetails -and $_.ErrorDetails.Message) {
      $responseBody = $_.ErrorDetails.Message
    }

    if ($AllowFailure) {
      return [pscustomobject]@{
        __failed = $true
        status = $statusCode
        body = $responseBody
      }
    }

    throw
  }
}

function Resolve-TargetAccountIds {
  param([string]$ExplicitCsv)

  $accountsResponse = Invoke-Api -Method "GET" -Uri "$BaseUrl/accounts"
  $allAccounts = @($accountsResponse.accounts)
  $activeAccounts = @($allAccounts | Where-Object { $_.isActive } | ForEach-Object { $_.id })

  if ($ExplicitCsv -and $ExplicitCsv.Trim()) {
    return @($ExplicitCsv.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) | Select-Object -Unique
  }

  if ($activeAccounts.Count -ge 2) {
    return @($activeAccounts | Select-Object -First 2)
  }

  if ($activeAccounts.Count -eq 1) {
    return @($activeAccounts[0])
  }

  throw "No active account sessions found. Import cookies first."
}

function Normalize-CookieArray {
  param([Parameter(Mandatory = $true)]$Parsed)

  if ($Parsed -is [System.Array]) {
    return @($Parsed)
  }

  if ($Parsed -and $Parsed.PSObject -and ($Parsed.PSObject.Properties.Name -contains 'cookies') -and ($Parsed.cookies -is [System.Array])) {
    return @($Parsed.cookies)
  }

  return @()
}

function Parse-CookieFileMap {
  param([string]$RawJson)

  if (-not $RawJson -or -not $RawJson.Trim()) {
    return @{}
  }

  try {
    $parsed = $RawJson | ConvertFrom-Json
    $map = @{}
    foreach ($prop in $parsed.PSObject.Properties) {
      $key = [string]$prop.Name
      $value = [string]$prop.Value
      if (-not [string]::IsNullOrWhiteSpace($key) -and -not [string]::IsNullOrWhiteSpace($value)) {
        $map[$key.Trim()] = $value.Trim()
      }
    }
    return $map
  } catch {
    Write-Host "WARNING: invalid -CookieFileMapJson; ignoring map."
    return @{}
  }
}

function To-HashtableSafe {
  param([Parameter(Mandatory = $true)]$InputObject)

  if ($null -eq $InputObject) {
    return @{}
  }

  if ($InputObject -is [hashtable]) {
    return $InputObject
  }

  if ($InputObject -is [System.Collections.IDictionary]) {
    $dict = @{}
    foreach ($key in $InputObject.Keys) {
      $name = [string]$key
      if (-not [string]::IsNullOrWhiteSpace($name)) {
        $dict[$name] = [string]$InputObject[$key]
      }
    }
    return $dict
  }

  $objMap = @{}
  try {
    foreach ($prop in $InputObject.PSObject.Properties) {
      $name = [string]$prop.Name
      $value = [string]$prop.Value
      if (-not [string]::IsNullOrWhiteSpace($name) -and -not [string]::IsNullOrWhiteSpace($value)) {
        $objMap[$name.Trim()] = $value.Trim()
      }
    }
  } catch {
    return @{}
  }
  return $objMap
}

function Get-CookieFileCandidates {
  param(
    [Parameter(Mandatory = $true)][string]$AccountId,
    [Parameter(Mandatory = $true)]$CookieFileMap
  )

  $CookieFileMap = To-HashtableSafe -InputObject $CookieFileMap
  $candidates = New-Object System.Collections.Generic.List[string]

  if ($CookieFileMap.ContainsKey($AccountId)) {
    $mapped = $CookieFileMap[$AccountId]
    if (-not [string]::IsNullOrWhiteSpace($mapped)) {
      $mappedPath = if ([System.IO.Path]::IsPathRooted($mapped)) { $mapped } else { Join-Path $CookieDir $mapped }
      [void]$candidates.Add($mappedPath)
    }
  }

  [void]$candidates.Add((Join-Path $CookieDir ("cookies-" + $AccountId + ".json")))

  $fallbackFiles = @(Get-ChildItem -Path $CookieDir -Filter 'cookies-*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  foreach ($file in $fallbackFiles) {
    [void]$candidates.Add($file.FullName)
  }

  # De-dupe while preserving order
  $seen = @{}
  $result = New-Object System.Collections.Generic.List[string]
  foreach ($path in $candidates) {
    if ([string]::IsNullOrWhiteSpace($path)) { continue }
    $full = [System.IO.Path]::GetFullPath($path)
    if ($seen.ContainsKey($full)) { continue }
    $seen[$full] = $true
    [void]$result.Add($full)
  }

  return @($result)
}

function Try-ImportAndVerifyFromCookies {
  param(
    [Parameter(Mandatory = $true)][string]$AccountId,
    [Parameter(Mandatory = $true)]$CookieFileMap
  )

  $attemptLogs = New-Object System.Collections.Generic.List[object]
  $candidates = @()
  try {
    $CookieFileMap = To-HashtableSafe -InputObject $CookieFileMap
    $candidates = @(Get-CookieFileCandidates -AccountId $AccountId -CookieFileMap $CookieFileMap)
  } catch {
    [void]$attemptLogs.Add([pscustomobject]@{
      file = '<preflight>'
      stage = 'exception'
      error = $_.Exception.Message
      detail = ($_ | Out-String).Trim()
    })
    return [pscustomobject]@{
      ok = $false
      attempts = @($attemptLogs)
    }
  }

  if ($candidates.Length -gt 0) {
    [void]$attemptLogs.Add([pscustomobject]@{
      file = "<candidate-order>"
      stage = 'discover'
      error = ($candidates -join '; ')
    })
  }
  foreach ($path in $candidates) {
    if (-not (Test-Path -LiteralPath $path)) { continue }

    try {
      $raw = Get-Content -LiteralPath $path -Raw
      if ([string]::IsNullOrWhiteSpace($raw)) {
        [void]$attemptLogs.Add([pscustomobject]@{ file = $path; stage = 'read'; error = 'empty file' })
        continue
      }
      $parsed = $raw | ConvertFrom-Json
      $cookies = Normalize-CookieArray -Parsed $parsed
      if ($cookies.Length -eq 0) {
        [void]$attemptLogs.Add([pscustomobject]@{ file = $path; stage = 'parse'; error = 'no cookie array found' })
        continue
      }

      $body = $cookies | ConvertTo-Json -Depth 10 -Compress
      $import = Invoke-Api -Method "POST" -Uri "$BaseUrl/accounts/$AccountId/session" -BodyJson $body -AllowFailure
      if ($import.PSObject.Properties.Name -contains '__failed') {
        [void]$attemptLogs.Add([pscustomobject]@{
          file = $path
          stage = 'import'
          status = $import.status
          error = [string]$import.body
        })
        continue
      }

      $verify = Invoke-Api -Method "POST" -Uri "$BaseUrl/accounts/$AccountId/verify" -AllowFailure
      if (-not ($verify.PSObject.Properties.Name -contains '__failed')) {
        return [pscustomobject]@{
          ok = $true
          cookieFile = $path
          verify = $verify
          attempts = @($attemptLogs)
        }
      }
      [void]$attemptLogs.Add([pscustomobject]@{
        file = $path
        stage = 'verify'
        error = [string]$verify.body
      })
    } catch {
      [void]$attemptLogs.Add([pscustomobject]@{
        file = $path
        stage = 'exception'
        error = $_.Exception.Message
      })
      continue
    }
  }

  return [pscustomobject]@{
    ok = $false
    attempts = @($attemptLogs)
  }
}

function Get-ConnectionsFallbackFromActivity {
  param([string[]]$AccountIds)

  $latestByKey = @{}
  foreach ($accountId in $AccountIds) {
    $resp = Invoke-Api -Method "GET" -Uri "$BaseUrl/stats/$accountId/activity?page=0&limit=300" -AllowFailure
    if ($resp.PSObject.Properties.Name -contains '__failed') {
      continue
    }
    foreach ($entry in @($resp.entries)) {
      if (-not $entry) { continue }
      if ($entry.type -ne 'connectionSent' -and $entry.type -ne 'messageSent') { continue }
      $name = [string]$entry.targetName
      $profileUrl = [string]$entry.targetProfileUrl
      if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($profileUrl)) { continue }
      $ts = [long]($entry.timestamp | ForEach-Object { $_ })
      $key = "$accountId|$profileUrl|$name"
      if (-not $latestByKey.ContainsKey($key) -or [long]$latestByKey[$key].connectedAt -lt $ts) {
        $latestByKey[$key] = [pscustomobject]@{
          accountId = $accountId
          name = $name
          profileUrl = $profileUrl
          connectedAt = $ts
          source = $entry.type
        }
      }
    }
  }

  return @($latestByKey.Values | Sort-Object -Property connectedAt -Descending)
}

$targetAccountIds = Resolve-TargetAccountIds -ExplicitCsv $AccountIds
$cookieFileMap = Parse-CookieFileMap -RawJson $CookieFileMapJson
Write-Host "Testing accounts: $($targetAccountIds -join ', ')"

$failed = $false
$successfulSends = @()

foreach ($accountId in $targetAccountIds) {
  Write-Host ""
  Write-Host "==== $accountId ===="

  Write-Host "1) Verify session"
  $verify = Invoke-Api -Method "POST" -Uri "$BaseUrl/accounts/$accountId/verify" -AllowFailure
  if ($verify.PSObject.Properties.Name -contains '__failed') {
    $verifyBody = [string]$verify.body
    $isRecoverableSessionFailure = (
      $verifyBody -match 'NO_SESSION' -or
      $verifyBody -match 'COOKIES_MISSING' -or
      $verifyBody -match 'SESSION_EXPIRED' -or
      $verifyBody -match 'AUTHENTICATED_STATE_NOT_REACHED'
    )

    if ($isRecoverableSessionFailure) {
      Write-Host "Self-heal: re-importing cookies for $accountId from local cookie files..."
      try {
        $heal = Try-ImportAndVerifyFromCookies -AccountId $accountId -CookieFileMap $cookieFileMap
      } catch {
        $heal = [pscustomobject]@{
          ok = $false
          attempts = @(
            [pscustomobject]@{
              file = '<callsite>'
              stage = 'exception'
              error = $_.Exception.Message
              detail = ($_ | Out-String).Trim()
            }
          )
        }
      }
      if ($heal.ok) {
        Write-Host "Self-heal success using: $($heal.cookieFile)"
        $verify = $heal.verify
      } else {
        $failed = $true
        Write-Host "FAILED: $($verify.body)"
        if ($heal.attempts -and $heal.attempts.Length -gt 0) {
          Write-Host "Self-heal attempts:"
          foreach ($attempt in $heal.attempts) {
            $statusInfo = if ($attempt.PSObject.Properties.Name -contains 'status' -and $attempt.status) { " status=$($attempt.status)" } else { "" }
            Write-Host "  - file=$($attempt.file) stage=$($attempt.stage)$statusInfo error=$($attempt.error)"
          }
        } else {
          Write-Host "Self-heal attempts: no cookie files were usable for this account."
        }
        continue
      }
    } else {
      $failed = $true
      Write-Host "FAILED: $($verify.body)"
      continue
    }
  }
  $verify | ConvertTo-Json -Depth 6 | Write-Host

  Write-Host "2) Send message"
  $payload = @{
    accountId = $accountId
    profileUrl = $ProfileUrl
    text = $Text
  } | ConvertTo-Json -Compress
  $send = Invoke-Api -Method "POST" -Uri "$BaseUrl/messages/send-new" -BodyJson $payload -AllowFailure
  if ($send.PSObject.Properties.Name -contains '__failed') {
    $failed = $true
    Write-Host "FAILED: $($send.body)"
    continue
  }
  $send | ConvertTo-Json -Depth 6 | Write-Host
  $successfulSends += $accountId
}

Write-Host ""
Write-Host "3) Unified inbox quick check"
$inbox = Invoke-Api -Method "GET" -Uri "$BaseUrl/inbox/unified?limit=50" -AllowFailure
if ($inbox.PSObject.Properties.Name -contains '__failed') {
  $failed = $true
  Write-Host "FAILED: $($inbox.body)"
} else {
  $inbox | ConvertTo-Json -Depth 6 | Write-Host
}

Write-Host ""
Write-Host "4) Unified connections quick check"
$connections = Invoke-Api -Method "GET" -Uri "$BaseUrl/connections/unified?limit=200" -AllowFailure
if ($connections.PSObject.Properties.Name -contains '__failed') {
  $bodyText = [string]$connections.body
  $looksLikeFrontend404 = (
    $connections.status -eq 404 -or
    $bodyText -match '404\s*Error' -or
    $bodyText -match 'Page Not Found' -or
    $bodyText -match '_next/static/chunks'
  )

  if ($looksLikeFrontend404) {
    Write-Host "WARNING: /connections/unified route is missing on frontend (stale build)."
    Write-Host "Hint: run server rebuild -> docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build frontend worker"
    $fallbackConnections = @(Get-ConnectionsFallbackFromActivity -AccountIds $targetAccountIds)
    if ($null -ne $fallbackConnections -and $fallbackConnections.Length -gt 0) {
      [pscustomobject]@{ connections = @($fallbackConnections) } | ConvertTo-Json -Depth 6 | Write-Host
    } else {
      $failed = $true
      Write-Host "FAILED: fallback connections from activity is empty or unavailable."
    }
  } else {
    $failed = $true
    Write-Host "FAILED: $($connections.body)"
  }
} else {
  $connections | ConvertTo-Json -Depth 6 | Write-Host
}

if ($failed) {
  Write-Host ""
  Write-Host "Result: FAILED. At least one account did not complete verify/send."
  exit 1
}

Write-Host ""
Write-Host "Result: SUCCESS. Accounts tested: $($targetAccountIds -join ', ')"
