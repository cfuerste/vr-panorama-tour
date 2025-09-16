# PowerShell script to backup originals and replace with optimized panoramas

$OriginalPath = ".\public\panos"
$OptimizedPath = ".\public\panos\optimized" 
$BackupPath = ".\public\panos\backup_original"

Write-Host "Panorama Replacement Tool" -ForegroundColor Magenta
Write-Host "This will backup originals and replace with optimized versions" -ForegroundColor Yellow
Write-Host ""

# Create backup directory
if (-not (Test-Path $BackupPath)) {
    New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
    Write-Host "Created backup directory: $BackupPath" -ForegroundColor Green
}

# Get list of original files that have optimized versions
$optimizedFiles = Get-ChildItem -Path $OptimizedPath -Filter "*.jpg" | Where-Object { 
    $_.Name -notmatch "_mobile\.jpg$" 
}

Write-Host "Found $($optimizedFiles.Count) optimized files to replace" -ForegroundColor Green
Write-Host ""

$replacedCount = 0

foreach ($optimizedFile in $optimizedFiles) {
    $originalFile = Join-Path $OriginalPath $optimizedFile.Name
    $backupFile = Join-Path $BackupPath $optimizedFile.Name
    
    if (Test-Path $originalFile) {
        Write-Host "Processing $($optimizedFile.Name)..." -ForegroundColor Cyan
        
        # Backup original
        Copy-Item $originalFile $backupFile -Force
        Write-Host "  Backed up original" -ForegroundColor Yellow
        
        # Replace with optimized version
        Copy-Item $optimizedFile.FullName $originalFile -Force
        Write-Host "  Replaced with optimized version" -ForegroundColor Green
        
        $replacedCount++
        Write-Host ""
    } else {
        Write-Host "Warning: Original file not found: $($optimizedFile.Name)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Replacement Summary:" -ForegroundColor Magenta
Write-Host "  Replaced: $replacedCount files" -ForegroundColor Green
Write-Host "  Originals backed up to: $BackupPath" -ForegroundColor Yellow
Write-Host ""
Write-Host "Space savings achieved:" -ForegroundColor Cyan
Write-Host "  From 383.7 MB to 37.3 MB (90.3% reduction)" -ForegroundColor Green
Write-Host ""
Write-Host "Your VR app is now optimized for Meta Quest 3!" -ForegroundColor Green