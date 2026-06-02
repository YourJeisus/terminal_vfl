@echo off
title Install Autostart Terminal VG

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Run as Administrator!
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   Install Autostart - Terminal VG
echo ==========================================
echo.

set "BAT_PATH=%~dp0start-terminal.bat"
set "WORK_DIR=%~dp0"
set "PS_SCRIPT=%TEMP%\install_vg_task.ps1"

echo Creating PowerShell script...

> "%PS_SCRIPT%" echo $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + '%BAT_PATH%' + '"') -WorkingDirectory '%WORK_DIR%'
>> "%PS_SCRIPT%" echo $trigger = New-ScheduledTaskTrigger -AtLogOn
>> "%PS_SCRIPT%" echo $trigger.Delay = 'PT15S'
>> "%PS_SCRIPT%" echo $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
>> "%PS_SCRIPT%" echo $settings.ExecutionTimeLimit = 'PT0S'
>> "%PS_SCRIPT%" echo $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType Interactive
>> "%PS_SCRIPT%" echo Register-ScheduledTask -TaskName 'TerminalVG_Autostart' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force

echo Running PowerShell script...
echo.
powershell -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

if %errorlevel% equ 0 (
    echo.
    echo [OK] Autostart installed!
    echo.
    echo   Task:     TerminalVG_Autostart
    echo   Script:   %BAT_PATH%
    echo   WorkDir:  %WORK_DIR%
    echo   Trigger:  on login, 15s delay
    echo   Rights:   Administrator
) else (
    echo.
    echo [ERROR] Failed. See output above.
)

del "%PS_SCRIPT%" >nul 2>&1

echo.
echo ==========================================
echo To REMOVE: schtasks /delete /tn "TerminalVG_Autostart" /f
echo To TEST:   schtasks /run /tn "TerminalVG_Autostart"
echo ==========================================
echo.
pause
