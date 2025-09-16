# PowerShell script to create better quality optimized panoramas
# This version maintains better visual quality while still reducing file sizes

$InputPath = ".\public\panos\backup_original"
$OutputPath = ".\public\panos\optimized_hq"
$StandardQuality = 92  # Higher quality (was 85)
$MobileQuality = 85    # Better mobile quality (was 75)

Write-Host "Creating High Quality Optimized Panoramas" -ForegroundColor Magenta
Write-Host "Standard Quality: $StandardQuality%" -ForegroundColor Yellow
Write-Host "Mobile Quality: $MobileQuality%" -ForegroundColor Yellow
Write-Host ""

# ImageMagick path
$magickPath = "C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe"

if (-not (Test-Path $magickPath)) {
    Write-Host "ImageMagick not found at: $magickPath" -ForegroundColor Red
    exit 1
}

# Create output directory
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    Write-Host "Created output directory: $OutputPath" -ForegroundColor Green
}

# Find all JPEG files in backup folder
$imageFiles = Get-ChildItem -Path $InputPath -Filter "*.jpg"

if ($imageFiles.Count -eq 0) {
    Write-Host "No JPEG files found in $InputPath" -ForegroundColor Red
    exit 1
}

Write-Host "Found $($imageFiles.Count) original images to optimize" -ForegroundColor Green
Write-Host ""

$successCount = 0
$totalOriginalSize = 0
$totalOptimizedSize = 0

foreach ($file in $imageFiles) {
    $fileName = $file.BaseName
    Write-Host "Processing $fileName..." -ForegroundColor Cyan
    
    $originalSize = $file.Length / 1MB
    $totalOriginalSize += $originalSize
    
    # High Quality version (6K resolution)
    $hqFile = Join-Path $OutputPath $file.Name
    
    $hqArgs = @(
        "`"$($file.FullName)`"",
        "-resize", "6144x3072>",  # Higher resolution 
        "-quality", $StandardQuality,
        "-strip",
        "-colorspace", "sRGB",    # Better color space
        "-enhance",               # Enhance brightness/contrast
        "-normalize",             # Auto-level adjustment
        "-interlace", "Plane",
        "`"$hqFile`""
    )
    
    try {
        $process = Start-Process -FilePath $magickPath -ArgumentList $hqArgs -Wait -PassThru -NoNewWindow
        
        if ($process.ExitCode -eq 0 -and (Test-Path $hqFile)) {
            $optimizedSize = (Get-Item $hqFile).Length / 1MB
            $totalOptimizedSize += $optimizedSize
            $reduction = [math]::Round((1 - $optimizedSize / $originalSize) * 100, 1)
            Write-Host "  HQ Version: $($originalSize.ToString('F1'))MB -> $($optimizedSize.ToString('F1'))MB ($reduction% reduction)" -ForegroundColor Green
            $successCount++
            
            # Standard quality version (4K)
            $stdFileName = $file.BaseName + "_std.jpg"
            $stdFile = Join-Path $OutputPath $stdFileName
            
            $stdArgs = @(
                "`"$($file.FullName)`"",
                "-resize", "4096x2048>",
                "-quality", "88",
                "-strip",
                "-colorspace", "sRGB",
                "-enhance",
                "-normalize",
                "-interlace", "Plane",
                "`"$stdFile`""
            )
            
            $stdProcess = Start-Process -FilePath $magickPath -ArgumentList $stdArgs -Wait -PassThru -NoNewWindow
            if ($stdProcess.ExitCode -eq 0) {
                Write-Host "  Standard version created" -ForegroundColor Green
            }
            
            # Mobile version (2K)
            $mobileFileName = $file.BaseName + "_mobile.jpg"
            $mobileFile = Join-Path $OutputPath $mobileFileName
            
            $mobileArgs = @(
                "`"$($file.FullName)`"",
                "-resize", "2048x1024>",
                "-quality", $MobileQuality,
                "-strip",
                "-colorspace", "sRGB",
                "-enhance",
                "-normalize",
                "-interlace", "Plane",
                "`"$mobileFile`""
            )
            
            $mobileProcess = Start-Process -FilePath $magickPath -ArgumentList $mobileArgs -Wait -PassThru -NoNewWindow
            if ($mobileProcess.ExitCode -eq 0) {
                Write-Host "  Mobile version created" -ForegroundColor Green
            }
        } else {
            Write-Host "  Failed to optimize $fileName" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "  Error processing $fileName : $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host ""
}

# Summary
Write-Host ""
Write-Host "High Quality Optimization Summary:" -ForegroundColor Magenta
Write-Host "  Processed: $successCount / $($imageFiles.Count) files" -ForegroundColor Green
Write-Host "  Original total size: $($totalOriginalSize.ToString('F1')) MB" -ForegroundColor Yellow
Write-Host "  Optimized total size: $($totalOptimizedSize.ToString('F1')) MB" -ForegroundColor Yellow

if ($totalOriginalSize -gt 0) {
    $totalReduction = [math]::Round((1 - $totalOptimizedSize / $totalOriginalSize) * 100, 1)
    Write-Host "  Total reduction: $totalReduction%" -ForegroundColor Green
}

Write-Host ""
Write-Host "Created 3 quality levels:" -ForegroundColor Cyan
Write-Host "1. High Quality (6K): For current panorama" -ForegroundColor White
Write-Host "2. Standard (4K): For near panoramas" -ForegroundColor White
Write-Host "3. Mobile (2K): For distant panoramas" -ForegroundColor White