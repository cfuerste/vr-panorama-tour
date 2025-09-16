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

# Check for ImageMagick installation
function Find-ImageMagick {
    # Common installation paths
    $possiblePaths = @(
        "C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe",
        "C:\Program Files\ImageMagick*\magick.exe",
        "C:\Program Files (x86)\ImageMagick*\magick.exe",
        "magick.exe"  # If in PATH
    )
    
    foreach ($path in $possiblePaths) {
        if ($path -like "*`**") {
            # Handle wildcards
            $found = Get-ChildItem $path -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) {
                return $found.FullName
            }
        } else {
            if (Test-Path $path) {
                return $path
            }
        }
    }
    
    # Try to find via Get-Command
    try {
        $cmd = Get-Command magick -ErrorAction Stop
        return $cmd.Source
    } catch {
        return $null
    }
}

# Install ImageMagick if not available
function Install-ImageMagick {
    Write-Host "📦 ImageMagick not found. Installing..." -ForegroundColor Yellow
    
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Installing ImageMagick via winget..."
        try {
            winget install ImageMagick.ImageMagick --accept-source-agreements --accept-package-agreements
            Write-Host "✅ ImageMagick installed. Please restart PowerShell and run the script again." -ForegroundColor Green
            return $true
        } catch {
            Write-Host "❌ Failed to install via winget" -ForegroundColor Red
        }
    } 
    
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "Installing ImageMagick via Chocolatey..."
        try {
            choco install imagemagick -y
            Write-Host "✅ ImageMagick installed. Please restart PowerShell and run the script again." -ForegroundColor Green
            return $true
        } catch {
            Write-Host "❌ Failed to install via Chocolatey" -ForegroundColor Red
        }
    }
    
    Write-Host "❌ Please install ImageMagick manually:" -ForegroundColor Red
    Write-Host "1. Download from: https://imagemagick.org/script/download.php#windows" -ForegroundColor Yellow
    Write-Host "2. Or install winget/chocolatey first" -ForegroundColor Yellow
    return $false
}

# Optimize a single image
function Optimize-Image {
    param(
        [string]$InputFile,
        [string]$OutputFile,
        [int]$Width,
        [int]$Height,
        [int]$Quality,
        [string]$Type = "standard",
        [string]$MagickPath
    )
    
    $fileName = [System.IO.Path]::GetFileNameWithoutExtension($InputFile)
    Write-Host "🖼️  Processing $fileName ($Type)..." -ForegroundColor Cyan
    
    # Get original file size
    $originalSize = (Get-Item $InputFile).Length / 1MB
    
    try {
        # ImageMagick command for optimization
        $args = @(
            "`"$InputFile`"",
            "-resize", "${Width}x${Height}>",  # Only resize if larger
            "-quality", $Quality,
            "-strip",                          # Remove metadata
            "-sampling-factor", "2x2",         # Chroma subsampling for JPEG
            "-colorspace", "RGB",              # Ensure RGB colorspace
            "-interlace", "Plane",             # Progressive JPEG
            "`"$OutputFile`""
        )
        
        Write-Host "    Running: `"$MagickPath`" $($args -join ' ')" -ForegroundColor Gray
        
        $process = Start-Process -FilePath $MagickPath -ArgumentList $args -Wait -PassThru -NoNewWindow -RedirectStandardError "error_temp.txt"
        
        if ($process.ExitCode -eq 0 -and (Test-Path $OutputFile)) {
            $optimizedSize = (Get-Item $OutputFile).Length / 1MB
            $reduction = [math]::Round((1 - $optimizedSize / $originalSize) * 100, 1)
            Write-Host "    ✅ ${fileName}: ${originalSize:F1}MB → ${optimizedSize:F1}MB (${reduction}% reduction)" -ForegroundColor Green
            return $true
        } else {
            $errorContent = ""
            if (Test-Path "error_temp.txt") {
                $errorContent = Get-Content "error_temp.txt" -Raw
                Remove-Item "error_temp.txt" -ErrorAction SilentlyContinue
            }
            Write-Host "    ❌ Failed to create $OutputFile" -ForegroundColor Red
            if ($errorContent) {
                Write-Host "    Error: $errorContent" -ForegroundColor Red
            }
            return $false
        }
    }
    catch {
        Write-Host "    ❌ Error processing ${fileName}: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
    finally {
        # Clean up temp files
        Remove-Item "error_temp.txt" -ErrorAction SilentlyContinue
    }
}

# Main optimization process
function Start-Optimization {
    Write-Host "🚀 VR Panorama Optimization Tool for Meta Quest 3" -ForegroundColor Magenta
    Write-Host "Target resolution: ${MaxWidth}x${MaxHeight}" -ForegroundColor Yellow
    Write-Host "Quality setting: $Quality%" -ForegroundColor Yellow
    Write-Host ""
    
    # Find ImageMagick
    $magickPath = Find-ImageMagick
    if (-not $magickPath) {
        $installed = Install-ImageMagick
        if ($installed) {
            Write-Host "Please restart PowerShell and run the script again." -ForegroundColor Yellow
            return
        } else {
            Write-Host "❌ Cannot proceed without ImageMagick" -ForegroundColor Red
            return
        }
    }
    
    Write-Host "✅ Found ImageMagick at: $magickPath" -ForegroundColor Green
    Write-Host ""
    
    # Test ImageMagick
    try {
        $testResult = & $magickPath -version 2>&1
        Write-Host "📝 ImageMagick version detected" -ForegroundColor Green
    } catch {
        Write-Host "❌ ImageMagick test failed: $($_.Exception.Message)" -ForegroundColor Red
        return
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
        return
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
        if (Optimize-Image -InputFile $file.FullName -OutputFile $optimizedFile -Width $MaxWidth -Height $MaxHeight -Quality $Quality -Type "standard" -MagickPath $magickPath) {
            $successCount++
            if (Test-Path $optimizedFile) {
                $totalOptimizedSize += (Get-Item $optimizedFile).Length / 1MB
            }
        }
        
        # Mobile version (lower quality for adjacent nodes)
        if ($CreateMobileVersions) {
            $mobileFileName = $file.BaseName + "_mobile.jpg"
            $mobileFile = Join-Path $OutputPath $mobileFileName
            Optimize-Image -InputFile $file.FullName -OutputFile $mobileFile -Width 2048 -Height 1024 -Quality 75 -Type "mobile" -MagickPath $magickPath | Out-Null
        }
        
        Write-Host ""
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