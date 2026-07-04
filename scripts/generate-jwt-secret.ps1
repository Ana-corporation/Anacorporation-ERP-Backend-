# Generate a secure JWT secret for .env
$secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
Write-Host ""
Write-Host "Add this to your .env file:" -ForegroundColor Cyan
Write-Host "JWT_SECRET=$secret" -ForegroundColor Green
Write-Host ""
