@echo off
rem ============================================================
rem  auto build script for amsys + login launcher
rem  requires MinGW-w64 / TDM-GCC (g++ and windres in PATH)
rem ============================================================
cd /d "%~dp0"

echo [1/4] Compiling icon.res ...
windres icon.rc -O coff -o icon.res
if errorlevel 1 goto :err

echo [2/4] Compiling launcher.res ...
windres launcher.rc -O coff -o launcher.res
if errorlevel 1 goto :err

echo [3/4] Building amsys.exe ...
g++ -std=c++20 -Wall src/*.cpp icon.res -o amsys.exe -static -lole32 -lwbemuuid -loleaut32
if errorlevel 1 goto :err

echo [4/4] Building launcher.exe ...
g++ -std=c++20 -Wall -Isrc launcher/launcher_main.cpp launcher/passwd_shadow.cpp src/config.cpp src/path_manager.cpp src/floder_reader.cpp launcher.res -o launcher.exe -static -lole32 -lwbemuuid -loleaut32
if errorlevel 1 goto :err

echo.
echo ============================================================
echo  Build OK: amsys.exe + launcher.exe
echo  Usage: run launcher.exe, log in, then amsys starts.
echo ============================================================
pause
exit /b 0

:err
echo.
echo Build FAILED. Check the errors above.
pause
exit /b 1
