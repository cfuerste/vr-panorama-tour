# PowerShell script to optimize panorama images for Meta Quest 3
# Reduces file sizes by 70-80% while maintaining visual quality

$InputPath = ".\public\panos"
$OutputPath = ".\public\panos\optimized"
$MaxWidth = 4096
$MaxHeight = 2048
$Quality = 85

Write-Host "VR Panorama Optimization Tool for Meta Quest 3" -ForegroundColor Magenta
Write-Host "Target resolution: ${MaxWidth}x${MaxHeight}" -ForegroundColor Yellow
Write-Host "Quality setting: $Quality%" -ForegroundColor Yellow
Write-Host ""

# ImageMagick path
$magickPath = "C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe"

if (-not (Test-Path $magickPath)) {
    Write-Host "ImageMagick not found at: $magickPath" -ForegroundColor Red
    Write-Host "Please check the installation path" -ForegroundColor Red
    exit 1
}

Write-Host "Found ImageMagick at: $magickPath" -ForegroundColor Green
Write-Host ""

# Create output directory
if (-not (Test-Path $OutputPath)) {
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    Write-Host "Created output directory: $OutputPath" -ForegroundColor Green
}

# Find all JPEG files
$imageFiles = Get-ChildItem -Path $InputPath -Filter "*.jpg" | Where-Object { 
    $_.Name -notmatch "_mobile\.jpg$" -and $_.Name -notmatch "_optimized\.jpg$" 
}

if ($imageFiles.Count -eq 0) {
    Write-Host "No JPEG files found in $InputPath" -ForegroundColor Red
    exit 1
}

Write-Host "Found $($imageFiles.Count) panorama images to optimize" -ForegroundColor Green
Write-Host ""

$successCount = 0
$totalOriginalSize = 0
$totalOptimizedSize = 0

foreach ($file in $imageFiles) {
    $fileName = $file.BaseName
    Write-Host "Processing $fileName..." -ForegroundColor Cyan
    
    $originalSize = $file.Length / 1MB
    $totalOriginalSize += $originalSize
    
    # Standard optimized version
    $optimizedFile = Join-Path $OutputPath $file.Name
    
    $arguments = @(
        "`"$($file.FullName)`"",
        "-resize", "${MaxWidth}x${MaxHeight}>",
        "-quality", $Quality,
        "-strip",
        "-sampling-factor", "2x2",
        "-colorspace", "RGB",
        "-interlace", "Plane",
        "`"$optimizedFile`""
    )
    
    try {
        $process = Start-Process -FilePath $magickPath -ArgumentList $arguments -Wait -PassThru -NoNewWindow
        
        if ($process.ExitCode -eq 0 -and (Test-Path $optimizedFile)) {
            $optimizedSize = (Get-Item $optimizedFile).Length / 1MB
            $totalOptimizedSize += $optimizedSize
            $reduction = [math]::Round((1 - $optimizedSize / $originalSize) * 100, 1)
            Write-Host "  Success: $($originalSize.ToString('F1'))MB -> $($optimizedSize.ToString('F1'))MB ($reduction% reduction)" -ForegroundColor Green
            $successCount++
            
            # Create mobile version
            $mobileFileName = $file.BaseName + "_mobile.jpg"
            $mobileFile = Join-Path $OutputPath $mobileFileName
            
            $mobileArgs = @(
                "`"$($file.FullName)`"",
                "-resize", "2048x1024>",
                "-quality", "75",
                "-strip",
                "-sampling-factor", "2x2",
                "-colorspace", "RGB",
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
Write-Host "Optimization Summary:" -ForegroundColor Magenta
Write-Host "  Processed: $successCount / $($imageFiles.Count) files" -ForegroundColor Green
Write-Host "  Original total size: $($totalOriginalSize.ToString('F1')) MB" -ForegroundColor Yellow
Write-Host "  Optimized total size: $($totalOptimizedSize.ToString('F1')) MB" -ForegroundColor Yellow

if ($totalOriginalSize -gt 0) {
    $totalReduction = [math]::Round((1 - $totalOptimizedSize / $totalOriginalSize) * 100, 1)
    Write-Host "  Total reduction: $totalReduction%" -ForegroundColor Green
    
    if ($totalReduction -ge 60) {
        Write-Host "  Excellent optimization achieved!" -ForegroundColor Green
    } elseif ($totalReduction -ge 40) {
        Write-Host "  Good optimization achieved!" -ForegroundColor Green
    } else {
        Write-Host "  Modest optimization achieved. Consider lower quality settings." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "1. Replace original images with optimized versions" -ForegroundColor White
Write-Host "2. Update your VR app to use mobile versions for distant nodes" -ForegroundColor White
Write-Host "3. Test on Meta Quest 3 to verify performance improvements" -ForegroundColor White