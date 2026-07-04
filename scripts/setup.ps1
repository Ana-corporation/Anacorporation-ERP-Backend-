Write-Host "=== ERP Backend Setup ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: Node.js is not installed. Install from https://nodejs.org" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "Created .env from .env.example" -ForegroundColor Green
}

Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Generating Prisma client..." -ForegroundColor Yellow
npx prisma generate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Running database migrations..." -ForegroundColor Yellow
Write-Host "NOTE: PostgreSQL must be running (docker compose up -d postgres redis)" -ForegroundColor DarkYellow
npx prisma migrate dev --name init
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Seeding permissions..." -ForegroundColor Yellow
npm run prisma:seed
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Setup complete! Start the server with:" -ForegroundColor Green
Write-Host "  npm run start:dev" -ForegroundColor White
Write-Host ""
Write-Host "Swagger docs: http://localhost:3000/docs" -ForegroundColor Cyan
