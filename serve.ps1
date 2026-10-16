Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "Serving Outdoor Console at http://localhost:8000"
Write-Host "Press Ctrl+C to stop."
python -m http.server 8000

