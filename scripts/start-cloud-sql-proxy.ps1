# Start Cloud SQL Auth Proxy for local Prisma/Nest.
# Usage (from repo root):  powershell -File scripts/start-cloud-sql-proxy.ps1

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
$sa = Join-Path $root "gcp-service-account.json"
$proxy = Join-Path $root ".migrate-tmp\cloud-sql-proxy.exe"

if (-not (Test-Path $sa)) {
  throw "Missing gcp-service-account.json in the project root."
}
if (-not (Test-Path $proxy)) {
  throw "Missing Cloud SQL Auth Proxy at .migrate-tmp\cloud-sql-proxy.exe"
}

$instance = (Get-Content $envFile | Where-Object { $_ -match '^GCP_SQL_INSTANCE_CONNECTION_NAME=(.*)$' } | ForEach-Object { $Matches[1].Trim().Trim('"') } | Select-Object -First 1)
if (-not $instance) {
  throw "GCP_SQL_INSTANCE_CONNECTION_NAME is missing in .env"
}

$port = (Get-Content $envFile | Where-Object { $_ -match '^GCP_SQL_PORT=(.*)$' } | ForEach-Object { $Matches[1].Trim().Trim('"') } | Select-Object -First 1)
if (-not $port) { $port = '5432' }

Write-Host "Starting Cloud SQL Auth Proxy for $instance on 127.0.0.1:$port"
& $proxy --credentials-file $sa --address 127.0.0.1 --port $port $instance
