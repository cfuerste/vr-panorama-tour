@echo off
echo 🚀 VR Panorama Optimization Tool for Meta Quest 3
echo.

REM Check if ImageMagick is installed
magick -version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ ImageMagick not found. Please install from:
    echo https://imagemagick.org/script/download.php#windows
    echo.
    pause
    exit /b 1
)

REM Configuration
set INPUT_DIR=public\panos
set OUTPUT_DIR=public\panos\optimized
set MAX_WIDTH=4096
set MAX_HEIGHT=2048
set QUALITY=85
set MOBILE_QUALITY=75

REM Create output directory
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

echo 📁 Input directory: %INPUT_DIR%
echo 📁 Output directory: %OUTPUT_DIR%
echo 🎯 Target resolution: %MAX_WIDTH%x%MAX_HEIGHT%
echo 🎨 Quality: %QUALITY%%
echo.

REM Process all JPEG files
set /a count=0
set /a success=0

for %%f in ("%INPUT_DIR%\*.jpg") do (
    set /a count+=1
    echo 🖼️  Processing %%~nf...
    
    REM Standard optimized version
    magick "%%f" -resize %MAX_WIDTH%x%MAX_HEIGHT%^> -quality %QUALITY% -strip -sampling-factor 2x2 -colorspace RGB -interlace Plane "%OUTPUT_DIR%\%%~nxf"
    if !errorlevel! equ 0 (
        set /a success+=1
        echo     ✅ Standard version created
    ) else (
        echo     ❌ Failed to create standard version
    )
    
    REM Mobile version (for distant nodes)
    magick "%%f" -resize 2048x1024^> -quality %MOBILE_QUALITY% -strip -sampling-factor 2x2 -colorspace RGB -interlace Plane "%OUTPUT_DIR%\%%~nf_mobile.jpg"
    if !errorlevel! equ 0 (
        echo     ✅ Mobile version created
    ) else (
        echo     ❌ Failed to create mobile version
    )
    
    echo.
)

echo 📊 Optimization Complete!
echo     Processed: %success% / %count% files
echo.
echo 🔧 Next Steps:
echo 1. Replace original images with optimized versions
echo 2. Update your VR app to use mobile versions for distant nodes  
echo 3. Test on Meta Quest 3 to verify performance improvements
echo.
pause