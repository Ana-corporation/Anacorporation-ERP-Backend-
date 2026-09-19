# Start Cloud SQL Auth Proxy for local Prisma/Nest.
# Usage (from repo root):  npm run db:proxy
# Reads GCP_SQL_* from .env.development or .env.production (first found).

$root = Split-Path -Parent $PSScriptRoot
$sa = Join-Path $root "gcp-service-account.json"
$proxy = Join-Path $root ".migrate-tmp\cloud-sql-proxy.exe"

function Find-EnvFile {
  $candidates = @(
    (Join-Path $root ".env.development"),
    (Join-Path $root ".env.production")
  )
  foreach ($path in $candidates) {
    if (Test-Path $path) { return $path }
  }
  return $null
}

function Get-EnvValue([string]$envFile, [string]$key) {
  if (-not $envFile) { return $null }
  $pattern = "^$([regex]::Escape($key))=(.*)$"
  $line = Get-Content $envFile | Where-Object { $_ -match $pattern } | Select-Object -First 1
  if (-not $line) { return $null }
  if ($line -match $pattern) {
    return $Matches[1].Trim().Trim('"').Trim("'")
  }
  return $null
}

if (-not (Test-Path $sa)) {
  throw "Missing gcp-service-account.json in the project root."
}
if (-not (Test-Path $proxy)) {
  throw "Missing Cloud SQL Auth Proxy at .migrate-tmp\cloud-sql-proxy.exe"
}

$envFile = Find-EnvFile
if (-not $envFile) {
  throw "No env file found. Create .env.development or .env.production (copy from .env.example) with GCP_SQL_INSTANCE_CONNECTION_NAME."
}

$instance = Get-EnvValue $envFile "GCP_SQL_INSTANCE_CONNECTION_NAME"
if (-not $instance) {
  throw "GCP_SQL_INSTANCE_CONNECTION_NAME is missing in $(Split-Path -Leaf $envFile)"
}

$port = Get-EnvValue $envFile "GCP_SQL_PORT"
if (-not $port) { $port = '5432' }

Write-Host "Using env file: $(Split-Path -Leaf $envFile)"
Write-Host "Starting Cloud SQL Auth Proxy for $instance on 127.0.0.1:$port"
& $proxy --credentials-file $sa --address 127.0.0.1 --port $port $instance
