param(
  [string]$AccountId = "",
  [string]$ProfileUrl = "",
  [string]$Text = "Hi, test message from automation",
  [switch]$AutoUseActiveAccount = $true,
  [string]$ApiKey = "dev-api-secret-key-change-in-production",
  [string]$RouteAuthToken = "",
  [string]$BaseUrl = "http://localhost:3001"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProfileUrl)) {
  Write-Error "Provide -ProfileUrl, for example: -ProfileUrl 'https://www.linkedin.com/in/someone/'"
  exit 1
}

if ($ProfileUrl -match 'REAL_CONNECTED_PERSON|REAL-SLUG|<|>') {
  Write-Error "Use a real 1st-degree connection profile URL (do not use placeholder text)."
  exit 1
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
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode
      } catch {}
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
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

    Write-Host "API error from $Uri"
    if ($responseBody) {
      Write-Host $responseBody
    } else {
      Write-Host $_.Exception.Message
    }

    if ($statusCode -eq 401 -and ($responseBody -match 'SESSION_EXPIRED|NO_SESSION|Unauthorized')) {
      Write-Host ""
      Write-Host "Hint: session is not active on server. Re-import fresh cookies and verify again."
    }
    exit 1
  }
}

function Get-SessionStatus {
  param([string]$TargetAccountId)

  # Preferred route (works for worker base and updated BFF base).
  $statusResponse = Invoke-Api -Method "GET" -Uri "$BaseUrl/accounts/$TargetAccountId/session/status" -AllowFailure
  $isFailed = $statusResponse.PSObject.Properties.Name -contains '__failed'
  if (-not $isFailed) {
    return $statusResponse
  }

  # Fallback for older servers where /session/status route isn't exposed via BFF.
  $accountsResponse = Invoke-Api -Method "GET" -Uri "$BaseUrl/accounts"
  $account = @($accountsResponse.accounts | Where-Object { $_.id -eq $TargetAccountId } | Select-Object -First 1)
  if ($account.Count -gt 0) {
    return [pscustomobject]@{
      exists = [bool]$account[0].lastSeen
      savedAt = $account[0].lastSeen
      isActive = [bool]$account[0].isActive
      source = "accounts-fallback"
    }
  }

  return [pscustomobject]@{
    exists = $false
    source = "accounts-fallback"
  }
}

function Get-ActiveAccountIds {
  $accountsResponse = Invoke-Api -Method "GET" -Uri "$BaseUrl/accounts"
  if (-not $accountsResponse) {
    return @()
  }
  $hasAccountsProperty = $accountsResponse.PSObject.Properties.Name -contains 'accounts'
  if (-not $hasAccountsProperty) {
    throw "Unexpected response from $BaseUrl/accounts (missing 'accounts'). Ensure server is updated and API routes are accessible."
  }
  if (-not $accountsResponse.accounts) {
    return @()
  }
  return @($accountsResponse.accounts | Where-Object { $_.isActive } | ForEach-Object { $_.id })
}

function Resolve-AccountId {
  param([string]$PreferredAccountId)

  $activeIds = @(Get-ActiveAccountIds)
  if ($activeIds.Count -eq 0) {
    if ($PreferredAccountId) { return $PreferredAccountId }
    throw "No active account session found. Import cookies first."
  }

  if ($PreferredAccountId -and ($activeIds -contains $PreferredAccountId)) {
    return $PreferredAccountId
  }

  if ($PreferredAccountId -and -not $AutoUseActiveAccount) {
    return $PreferredAccountId
  }

  if ($PreferredAccountId -and $activeIds.Count -gt 0) {
    Write-Host "No active session for '$PreferredAccountId'. Using active account '$($activeIds[0])' instead."
    return $activeIds[0]
  }

  return $activeIds[0]
}

$resolvedAccountId = Resolve-AccountId -PreferredAccountId $AccountId

Write-Host ""
Write-Host "1) Session status"
$status = Get-SessionStatus -TargetAccountId $resolvedAccountId
$status | ConvertTo-Json -Depth 6 | Write-Host

Write-Host ""
Write-Host "2) Verify session"
$verify = Invoke-Api -Method "POST" -Uri "$BaseUrl/accounts/$resolvedAccountId/verify"
$verify | ConvertTo-Json -Depth 6 | Write-Host

Write-Host ""
Write-Host "3) Send message"
$payload = @{
  accountId = $resolvedAccountId
  profileUrl = $ProfileUrl
  text = $Text
} | ConvertTo-Json -Compress

$send = Invoke-Api -Method "POST" -Uri "$BaseUrl/messages/send-new" -BodyJson $payload
$send | ConvertTo-Json -Depth 6 | Write-Host

Write-Host ""
Write-Host "Done."
