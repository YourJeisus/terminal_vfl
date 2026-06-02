@echo off
title Terminal VG — Kiosk Setup
chcp 65001 >nul 2>&1

:: Check admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Запустите от имени Администратора!
    echo     ПКМ → Запуск от имени администратора
    pause
    exit /b 1
)

set "INSTALL_DIR=%~dp0"
set "KIOSK_USER=TerminalKiosk"
set "KIOSK_PASS=Vg$Kiosk2026!"

echo.
echo  ==========================================
echo    Terminal VG — Настройка киоска
echo  ==========================================
echo.
echo  Папка:    %INSTALL_DIR%
echo  Пользователь: %KIOSK_USER%
echo.

:: ============================================
:: 1. Create kiosk user (limited, no password expiry)
:: ============================================
echo [1/7] Создание пользователя %KIOSK_USER%...
net user %KIOSK_USER% %KIOSK_PASS% /add /fullname:"Terminal VG Kiosk" /comment:"Kiosk mode user" /active:yes >nul 2>&1
if %errorlevel% equ 0 (
    echo       Создан.
) else (
    echo       Уже существует, обновляю пароль...
    net user %KIOSK_USER% %KIOSK_PASS% >nul 2>&1
)
:: Password never expires
wmic useraccount where "Name='%KIOSK_USER%'" set PasswordExpires=FALSE >nul 2>&1
:: Remove from Administrators if accidentally added
net localgroup Administrators %KIOSK_USER% /delete >nul 2>&1
:: Add to Users group
net localgroup Users %KIOSK_USER% /add >nul 2>&1

:: ============================================
:: 2. Lock down the project folder
:: ============================================
echo [2/7] Защита папки %INSTALL_DIR%...
:: Remove inherited permissions, grant full to Admins only
icacls "%INSTALL_DIR%" /inheritance:r /grant:r "Administrators:(OI)(CI)F" /grant:r "SYSTEM:(OI)(CI)F" >nul 2>&1
:: Kiosk user: read + execute only (can't edit code or .env)
icacls "%INSTALL_DIR%" /grant:r "%KIOSK_USER%:(OI)(CI)RX" >nul 2>&1
echo       Доступ: Администраторы=полный, %KIOSK_USER%=только чтение

:: ============================================
:: 3. Protect .env specifically (admin only)
:: ============================================
echo [3/7] Защита .env файла...
if not exist "%INSTALL_DIR%.env" goto :no_env
icacls "%INSTALL_DIR%.env" /inheritance:r /grant:r "Administrators:(F)" /grant:r "SYSTEM:(F)" >nul 2>&1
icacls "%INSTALL_DIR%.env" /deny "%KIOSK_USER%:(R)" >nul 2>&1
echo       .env доступен только администраторам
goto :env_done
:no_env
echo       [!] .env не найден — создайте из .env.example
:env_done

:: ============================================
:: 4. Hide project folder
:: ============================================
echo [4/7] Скрытие папки...
attrib +h +s "%INSTALL_DIR%" >nul 2>&1
echo       Папка скрыта (системный атрибут)

:: ============================================
:: 5. Auto-login as kiosk user
:: ============================================
echo [5/7] Настройка автовхода %KIOSK_USER%...
REG ADD "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v AutoAdminLogon /t REG_SZ /d "1" /f >nul 2>&1
REG ADD "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultUserName /t REG_SZ /d "%KIOSK_USER%" /f >nul 2>&1
REG ADD "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultPassword /t REG_SZ /d "%KIOSK_PASS%" /f >nul 2>&1
REG ADD "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultDomainName /t REG_SZ /d "%COMPUTERNAME%" /f >nul 2>&1
echo       Автовход включён

:: ============================================
:: 6. Autostart task (runs as admin for server.py)
:: ============================================
echo [6/7] Установка автозапуска...
set "PS_SCRIPT=%TEMP%\vg_kiosk_task.ps1"
> "%PS_SCRIPT%" echo $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + '%INSTALL_DIR%start-terminal.bat' + '"') -WorkingDirectory '%INSTALL_DIR%'
>> "%PS_SCRIPT%" echo $trigger = New-ScheduledTaskTrigger -AtLogOn -User '%KIOSK_USER%'
>> "%PS_SCRIPT%" echo $trigger.Delay = 'PT10S'
>> "%PS_SCRIPT%" echo $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
>> "%PS_SCRIPT%" echo $settings.ExecutionTimeLimit = 'PT0S'
>> "%PS_SCRIPT%" echo $principal = New-ScheduledTaskPrincipal -UserId '%COMPUTERNAME%\%KIOSK_USER%' -RunLevel Highest -LogonType Interactive
>> "%PS_SCRIPT%" echo Register-ScheduledTask -TaskName 'TerminalVG_Autostart' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
powershell -ExecutionPolicy Bypass -File "%PS_SCRIPT%" >nul 2>&1
del "%PS_SCRIPT%" >nul 2>&1
echo       Задача: TerminalVG_Autostart (при входе %KIOSK_USER%)

:: ============================================
:: 7. Disable kiosk user access to system tools
:: ============================================
echo [7/7] Блокировка системных инструментов...

:: Disable Task Manager
REG ADD "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f >nul 2>&1

:: Disable Run dialog (Win+R)
REG ADD "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoRun /t REG_DWORD /d 1 /f >nul 2>&1

:: Disable right-click on desktop
REG ADD "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoViewContextMenu /t REG_DWORD /d 1 /f >nul 2>&1

:: Disable Windows key
REG ADD "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoWinKeys /t REG_DWORD /d 1 /f >nul 2>&1

:: Disable desktop
REG ADD "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoDesktop /t REG_DWORD /d 1 /f >nul 2>&1

:: Disable Explorer file access
REG ADD "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoFileMenu /t REG_DWORD /d 1 /f >nul 2>&1

:: Chrome policies: disable DevTools, address bar, downloads
REG ADD "HKLM\SOFTWARE\Policies\Google\Chrome" /v DeveloperToolsAvailability /t REG_DWORD /d 2 /f >nul 2>&1
REG ADD "HKLM\SOFTWARE\Policies\Google\Chrome" /v DownloadRestrictions /t REG_DWORD /d 3 /f >nul 2>&1
REG ADD "HKLM\SOFTWARE\Policies\Google\Chrome" /v BookmarkBarEnabled /t REG_DWORD /d 0 /f >nul 2>&1

echo       Заблокированы: TaskManager, Win+R, ПКМ, Win key, DevTools

echo.
echo  ==========================================
echo    Настройка завершена!
echo  ==========================================
echo.
echo  Пользователь: %KIOSK_USER%
echo  Пароль:       %KIOSK_PASS%
echo  Автовход:     включён
echo  Автозапуск:   при входе %KIOSK_USER%
echo  Папка:        скрыта, только чтение для киоска
echo  .env:         доступен только администраторам
echo.
echo  Для доступа к файлам:
echo    1. Войти как администратор (Ctrl+Alt+Del → Сменить пользователя)
echo    2. attrib -h -s "%INSTALL_DIR%"
echo.
echo  Для удаления настроек:
echo    setup-kiosk.bat /uninstall
echo.
pause
