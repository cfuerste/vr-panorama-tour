# PowerShell script to optimize panoramas while preserving original brightness
# This version maintains the natural brightness of the original images

$InputPath = ".\public\panos\backup_original"
$OutputPath = ".\public\panos\optimized_natural"
$StandardQuality = 94  # Slightly higher quality for better preservation
$MobileQuality = 88    # Better mobile quality

Write-Host "Creating Brightness-Preserved Optimized Panoramas" -ForegroundColor Magenta
Write-Host "Standard Quality: $StandardQuality% (natural brightness)" -ForegroundColor Yellow
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
    
    # High Quality version (6K resolution, natural brightness)
    $hqFile = Join-Path $OutputPath $file.Name
    
    $hqArgs = @(
        "`"$($file.FullName)`"",
        "-resize", "6144x3072>",     # Higher resolution 
        "-quality", $StandardQuality,
        "-strip",                    # Remove metadata
        "-colorspace", "sRGB",       # Consistent color space
        "-interlace", "Plane",       # Progressive JPEG
        "-unsharp", "0x0.5+0.5+0.05", # Subtle sharpening only
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
            
            # Standard quality version (4K, natural brightness)
            $stdFileName = $file.BaseName + "_std.jpg"
            $stdFile = Join-Path $OutputPath $stdFileName
            
            $stdArgs = @(
                "`"$($file.FullName)`"",
                "-resize", "4096x2048>",
                "-quality", "90",
                "-strip",
                "-colorspace", "sRGB",
                "-interlace", "Plane",
                "-unsharp", "0x0.5+0.5+0.05",
                "`"$stdFile`""
            )
            
            $stdProcess = Start-Process -FilePath $magickPath -ArgumentList $stdArgs -Wait -PassThru -NoNewWindow
            if ($stdProcess.ExitCode -eq 0) {
                Write-Host "  Standard version created (natural brightness)" -ForegroundColor Green
            }
            
            # Mobile version (2K, natural brightness)
            $mobileFileName = $file.BaseName + "_mobile.jpg"
            $mobileFile = Join-Path $OutputPath $mobileFileName
            
            $mobileArgs = @(
                "`"$($file.FullName)`"",
                "-resize", "2048x1024>",
                "-quality", $MobileQuality,
                "-strip",
                "-colorspace", "sRGB",
                "-interlace", "Plane",
                "-unsharp", "0x0.5+0.5+0.05",
                "`"$mobileFile`""
            )
            
            $mobileProcess = Start-Process -FilePath $magickPath -ArgumentList $mobileArgs -Wait -PassThru -NoNewWindow
            if ($mobileProcess.ExitCode -eq 0) {
                Write-Host "  Mobile version created (natural brightness)" -ForegroundColor Green
            }
            
            # Copy original image with _hq suffix (unprocessed original)
            $hqOriginalFileName = $file.BaseName + "_hq.jpg"
            $hqOriginalFile = Join-Path $OutputPath $hqOriginalFileName
            
            try {
                Copy-Item -Path $file.FullName -Destination $hqOriginalFile -Force
                if (Test-Path $hqOriginalFile) {
                    Write-Host "  Original HQ copy created (unprocessed)" -ForegroundColor Green
                } else {
                    Write-Host "  Failed to copy original HQ version" -ForegroundColor Red
                }
            }
            catch {
                Write-Host "  Error copying original HQ version: $($_.Exception.Message)" -ForegroundColor Red
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
Write-Host "Natural Brightness Optimization Summary:" -ForegroundColor Magenta
Write-Host "  Processed: $successCount / $($imageFiles.Count) files" -ForegroundColor Green
Write-Host "  Original total size: $($totalOriginalSize.ToString('F1')) MB" -ForegroundColor Yellow
Write-Host "  Optimized total size: $($totalOptimizedSize.ToString('F1')) MB" -ForegroundColor Yellow

if ($totalOriginalSize -gt 0) {
    $totalReduction = [math]::Round((1 - $totalOptimizedSize / $totalOriginalSize) * 100, 1)
    Write-Host "  Total reduction: $totalReduction%" -ForegroundColor Green
}

Write-Host ""
Write-Host "Brightness Preservation Features:" -ForegroundColor Cyan
Write-Host "- No artificial brightness enhancement" -ForegroundColor White
Write-Host "- Original color levels preserved" -ForegroundColor White
Write-Host "- Natural contrast maintained" -ForegroundColor White
Write-Host "- Subtle sharpening for clarity" -ForegroundColor White
Write-Host "- Progressive JPEG for better loading" -ForegroundColor White

Write-Host ""
Write-Host "Created 4 quality levels with natural brightness:" -ForegroundColor Cyan
Write-Host "1. High Quality (6K): For current panorama" -ForegroundColor White
Write-Host "2. Standard (4K): For near panoramas" -ForegroundColor White
Write-Host "3. Mobile (2K): For distant panoramas" -ForegroundColor White
Write-Host "4. Original HQ (_hq): Unprocessed original copy" -ForegroundColor White