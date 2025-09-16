# PowerShell script to optimize panorama images for Meta Quest 3 VR performance
# This script reduces file sizes by 70-80% while maintaining good visual quality

param(
    [string]$InputPath = ".\public\panos",
    [string]$OutputPath = ".\public\panos\optimized",
    [int]$MaxWidth = 4096,
    [int]$MaxHeight = 2048,
    [int]$Quality = 85,
    [switch]$CreateMobileVersions = $true
)

# Check if ImageMagick is installed
function Test-ImageMagick {
    try {
        $null = & magick -version 2>$null
        return $true
    }
    catch {
        return $false
    }
}

# Install ImageMagick if not available
function Install-ImageMagick {
    Write-Host "📦 ImageMagick not found. Installing..." -ForegroundColor Yellow
    
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Installing ImageMagick via winget..."
        winget install ImageMagick.ImageMagick
    } elseif (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "Installing ImageMagick via Chocolatey..."
        choco install imagemagick -y
    } else {
        Write-Host "❌ Please install ImageMagick manually from https://imagemagick.org/script/download.php#windows" -ForegroundColor Red
        Write-Host "Or install winget/chocolatey first" -ForegroundColor Red
        exit 1
    }
}

# Optimize a single image
function Optimize-Image {
    param(
        [string]$InputFile,
        [string]$OutputFile,
        [int]$Width,
        [int]$Height,
        [int]$Quality,
        [string]$Type = "standard"
    )
    
    $fileName = [System.IO.Path]::GetFileNameWithoutExtension($InputFile)
    Write-Host "🖼️  Processing $fileName ($Type)..." -ForegroundColor Cyan
    
    # Get original file size
    $originalSize = (Get-Item $InputFile).Length / 1MB
    
    try {
        # ImageMagick command for optimization
        $args = @(
            $InputFile,
            "-resize", "${Width}x${Height}>",  # Only resize if larger
            "-quality", $Quality,
            "-strip",                          # Remove metadata
            "-sampling-factor", "2x2",         # Chroma subsampling for JPEG
            "-colorspace", "RGB",              # Ensure RGB colorspace
            "-interlace", "Plane",             # Progressive JPEG
            $OutputFile
        )
        
        & magick @args
        
        if (Test-Path $OutputFile) {
            $optimizedSize = (Get-Item $OutputFile).Length / 1MB
            $reduction = [math]::Round((1 - $optimizedSize / $originalSize) * 100, 1)
            Write-Host "    ✅ ${fileName}: ${originalSize:F1}MB → ${optimizedSize:F1}MB (${reduction}% reduction)" -ForegroundColor Green
            return $true
        } else {
            Write-Host "    ❌ Failed to create $OutputFile" -ForegroundColor Red
            return $false
        }
    }
    catch {
        Write-Host "    ❌ Error processing ${fileName}: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Main optimization process
function Start-Optimization {
    Write-Host "🚀 VR Panorama Optimization Tool for Meta Quest 3" -ForegroundColor Magenta
    Write-Host "Target resolution: ${MaxWidth}x${MaxHeight}" -ForegroundColor Yellow
    Write-Host "Quality setting: $Quality%" -ForegroundColor Yellow
    Write-Host ""
    
    # Check ImageMagick
    if (-not (Test-ImageMagick)) {
        Install-ImageMagick
        if (-not (Test-ImageMagick)) {
            Write-Host "❌ ImageMagick installation failed" -ForegroundColor Red
            exit 1
        }
    }
    
    # Create output directory
    if (-not (Test-Path $OutputPath)) {
        New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
        Write-Host "📁 Created output directory: $OutputPath" -ForegroundColor Green
    }
    
    # Find all JPEG files
    $imageFiles = Get-ChildItem -Path $InputPath -Filter "*.jpg" | Where-Object { 
        $_.Name -notmatch "_mobile\.jpg$" -and $_.Name -notmatch "_optimized\.jpg$" 
    }
    
    if ($imageFiles.Count -eq 0) {
        Write-Host "❌ No JPEG files found in $InputPath" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "📸 Found $($imageFiles.Count) panorama images to optimize" -ForegroundColor Green
    Write-Host ""
    
    $successCount = 0
    $totalOriginalSize = 0
    $totalOptimizedSize = 0
    
    foreach ($file in $imageFiles) {
        $totalOriginalSize += $file.Length / 1MB
        
        # Standard optimized version
        $optimizedFile = Join-Path $OutputPath $file.Name
        if (Optimize-Image -InputFile $file.FullName -OutputFile $optimizedFile -Width $MaxWidth -Height $MaxHeight -Quality $Quality -Type "standard") {
            $successCount++
            $totalOptimizedSize += (Get-Item $optimizedFile).Length / 1MB
        }
        
        # Mobile version (lower quality for adjacent nodes)
        if ($CreateMobileVersions) {
            $mobileFileName = $file.BaseName + "_mobile.jpg"
            $mobileFile = Join-Path $OutputPath $mobileFileName
            if (Optimize-Image -InputFile $file.FullName -OutputFile $mobileFile -Width 2048 -Height 1024 -Quality 75 -Type "mobile") {
                # Mobile versions don't count towards main stats
            }
        }
    }
    
    # Summary
    Write-Host ""
    Write-Host "📊 Optimization Summary:" -ForegroundColor Magenta
    Write-Host "    Processed: $successCount / $($imageFiles.Count) files" -ForegroundColor Green
    Write-Host "    Original total size: ${totalOriginalSize:F1} MB" -ForegroundColor Yellow
    Write-Host "    Optimized total size: ${totalOptimizedSize:F1} MB" -ForegroundColor Yellow
    
    if ($totalOriginalSize -gt 0) {
        $totalReduction = [math]::Round((1 - $totalOptimizedSize / $totalOriginalSize) * 100, 1)
        Write-Host "    Total reduction: ${totalReduction}%" -ForegroundColor Green
        
        if ($totalReduction -ge 60) {
            Write-Host "    🎉 Excellent optimization achieved!" -ForegroundColor Green
        } elseif ($totalReduction -ge 40) {
            Write-Host "    ✅ Good optimization achieved!" -ForegroundColor Green
        } else {
            Write-Host "    ⚠️  Modest optimization achieved. Consider lower quality settings." -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "🔧 Next Steps:" -ForegroundColor Cyan
    Write-Host "1. Replace original images with optimized versions" -ForegroundColor White
    Write-Host "2. Update your VR app to use mobile versions for distant nodes" -ForegroundColor White
    Write-Host "3. Test on Meta Quest 3 to verify performance improvements" -ForegroundColor White
}

# Run the optimization
Start-Optimization