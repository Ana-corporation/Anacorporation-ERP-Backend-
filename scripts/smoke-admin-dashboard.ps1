# Smoke test Admin Dashboard API gaps
$ErrorActionPreference = 'Continue'
$base = 'http://localhost:3002/api/v1'
$script:pass = 0
$script:fail = 0

function Assert-Ok([string]$name, $resp) {
  if ($resp -and $resp.success -eq $true) {
    Write-Host "PASS  $name"
    $script:pass++
  } else {
    $msg = if ($resp) { $resp.message } else { 'null response' }
    Write-Host "FAIL  $name -- $msg"
    $script:fail++
  }
}

function Invoke-Api([string]$method, [string]$path, $token, $body) {
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($token) { $headers['Authorization'] = "Bearer $token" }
  $uri = $base + $path
  $params = @{
    Uri = $uri
    Method = $method
    Headers = $headers
    UseBasicParsing = $true
  }
  if ($null -ne $body) {
    $params['Body'] = ($body | ConvertTo-Json -Depth 8 -Compress)
  }
  try {
    $raw = Invoke-WebRequest @params
    return ($raw.Content | ConvertFrom-Json)
  } catch {
    $errBody = $_.ErrorDetails.Message
    Write-Host "HTTP ERR $method $path -- $errBody"
    if ($errBody) {
      try { return ($errBody | ConvertFrom-Json) } catch { return $null }
    }
    return $null
  }
}

$loginOwner = Invoke-Api 'POST' '/auth/login' $null @{
  companyCode = 'PLATFORM'
  employeeCode = 'OWNER001'
  password = 'Owner@123'
}
Assert-Ok 'PLATFORM login' $loginOwner
$ownerToken = $loginOwner.data.accessToken
if (-not $ownerToken) { $ownerToken = $loginOwner.data.tokens.accessToken }

$companies = Invoke-Api 'GET' '/companies' $ownerToken $null
Assert-Ok 'GET /companies' $companies
$first = $null
$companyId = $null
if ($companies.data.items) {
  $first = $companies.data.items[0]
  $acme = @($companies.data.items) | Where-Object { $_.companyCode -eq 'DEMO_ACME' } | Select-Object -First 1
  if ($acme) { $first = $acme; $companyId = [string]$acme.id }
}
if (-not $companyId -and $first) { $companyId = [string]$first.id }

if ($first -and ($null -ne $first.subscriptionStatus -or $null -ne $first.planCode -or $null -ne $first.userCount)) {
  Write-Host 'PASS  companies list summary fields'
  $script:pass++
} else {
  Write-Host 'WARN  companies list missing summary fields'
}

$plans = Invoke-Api 'GET' '/plans' $ownerToken $null
Assert-Ok 'GET /plans' $plans
$modules = Invoke-Api 'GET' '/modules' $ownerToken $null
Assert-Ok 'GET /modules' $modules

if (-not $companyId) {
  $co = Invoke-Api 'GET' ('/auth/company' + '?companyCode=DEMO_ACME') $null $null
  Assert-Ok 'GET /auth/company DEMO_ACME' $co
  $companyId = [string]$co.data.companyId
  if (-not $companyId) { $companyId = [string]$co.data.id }
}

Write-Host "Using companyId=$companyId"

$sub = Invoke-Api 'GET' "/companies/$companyId/subscription" $ownerToken $null
Assert-Ok 'GET .../subscription' $sub

$cmods = Invoke-Api 'GET' "/companies/$companyId/modules" $ownerToken $null
Assert-Ok 'GET .../modules' $cmods

$loginAdmin = Invoke-Api 'POST' '/auth/login' $null @{
  companyCode = 'DEMO_ACME'
  employeeCode = 'ADMIN001'
  password = 'Admin@123'
}
Assert-Ok 'DEMO_ACME ADMIN login' $loginAdmin
$adminToken = $loginAdmin.data.accessToken
if (-not $adminToken) { $adminToken = $loginAdmin.data.tokens.accessToken }
$adminCompanyId = [string]$loginAdmin.data.companyId
if (-not $adminCompanyId) { $adminCompanyId = [string]$loginAdmin.data.user.companyId }
if (-not $adminCompanyId) { $adminCompanyId = $companyId }

$roles = Invoke-Api 'GET' "/companies/$adminCompanyId/roles" $adminToken $null
Assert-Ok 'GET .../roles' $roles
$roleItem = $null
if ($roles.data.items) { $roleItem = $roles.data.items[0] }
$roleId = if ($roleItem) { [string]$roleItem.id } else { $null }

if ($roleId) {
  $perms = Invoke-Api 'GET' "/companies/$adminCompanyId/roles/$roleId/permissions" $adminToken $null
  Assert-Ok 'GET .../roles/:id/permissions' $perms
}

$users = Invoke-Api 'GET' "/companies/$adminCompanyId/users" $adminToken $null
Assert-Ok 'GET .../users' $users

$email = "smoke.invite.$((Get-Date).ToString('yyyyMMddHHmmss'))@example.com"
$inviteBody = @{
  email = $email
  firstName = 'Smoke'
  lastName = 'Invite'
}
if ($roleId) { $inviteBody['roleId'] = $roleId }
$invite = Invoke-Api 'POST' "/companies/$adminCompanyId/users/invite" $adminToken $inviteBody
Assert-Ok 'POST .../users/invite' $invite
$tempPw = $invite.data.temporaryPassword
if (-not $tempPw) { $tempPw = $invite.data.tempPassword }
if ($tempPw) {
  Write-Host 'PASS  invite returned temp password'
  $script:pass++
} else {
  Write-Host 'FAIL  invite missing temp password'
  $script:fail++
}

Write-Host ""
Write-Host "Result: $($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
