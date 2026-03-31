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
    [string]$BodyJson = ""
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
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      Write-Host "API error from $Uri"
      Write-Host $_.ErrorDetails.Message
      exit 1
    }

    if ($_.Exception.Response) {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $body = $reader.ReadToEnd()
      Write-Host "API error from $Uri"
      Write-Host $body
      exit 1
    }
    throw
  }
}

function Get-ActiveAccountIds {
  $accountsResponse = Invoke-Api -Method "GET" -Uri "$BaseUrl/accounts"
  if (-not $accountsResponse -or -not $accountsResponse.accounts) {
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
$status = Invoke-Api -Method "GET" -Uri "$BaseUrl/accounts/$resolvedAccountId/session/status"
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
