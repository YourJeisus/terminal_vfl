@echo off
chcp 866 >nul 2>&1
title Terminal VG - Update
cd /d "%~dp0"

echo.
echo  ========================================
echo    Terminal VG - Update
echo  ========================================
echo.

:: --- Check Git ---
git --version >nul 2>&1
if %errorlevel% neq 0 goto :install_git
echo  [OK] Git found.
goto :do_update

:install_git
echo  [!] Git not found. Installing...
set "GIT_EXE=%TEMP%\git_install.exe"
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe' -OutFile '%GIT_EXE%' -UseBasicParsing"
if not exist "%GIT_EXE%" goto :zip_update
echo  Installing...
"%GIT_EXE%" /VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS
timeout /t 5 /nobreak >nul
set "PATH=%PATH%;C:\Program Files\Git\cmd"
del /q "%GIT_EXE%" >nul 2>&1
git --version >nul 2>&1
if %errorlevel% neq 0 goto :zip_update
echo  [OK] Git installed.

:: --- Git update ---
:do_update
if not exist "%~dp0.git\" goto :do_clone
echo.
echo  Pulling latest changes...
git pull origin master
if %errorlevel% equ 0 goto :check_python
echo  [!] Pull failed. Resetting...
git fetch origin master
git reset --hard origin/master
if %errorlevel% equ 0 goto :check_python
echo  [!] Reset failed.
goto :zip_update

:do_clone
echo.
echo  Cloning repository...
git clone https://github.com/YourJeisus/TERMINAL_VG.git "%~dp0_clone_tmp"
if %errorlevel% neq 0 goto :clone_fail
xcopy /s /y /q "%~dp0_clone_tmp\*" "%~dp0" >nul 2>&1
rmdir /s /q "%~dp0_clone_tmp" >nul 2>&1
echo  [OK] Cloned.
goto :check_python

:clone_fail
if exist "%~dp0_clone_tmp" rmdir /s /q "%~dp0_clone_tmp" >nul 2>&1
echo  [!] Clone failed.

:: --- ZIP fallback ---
:zip_update
echo.
echo  Downloading ZIP from GitHub...
set "REPO_ZIP=%TEMP%\terminal_vg.zip"
set "REPO_DIR=%TEMP%\terminal_vg_ext"
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/YourJeisus/TERMINAL_VG/archive/refs/heads/master.zip' -OutFile '%REPO_ZIP%' -UseBasicParsing"
if not exist "%REPO_ZIP%" goto :update_fail
echo  Extracting...
if exist "%REPO_DIR%" rmdir /s /q "%REPO_DIR%" >nul 2>&1
powershell -NoProfile -Command "Expand-Archive -Path '%REPO_ZIP%' -DestinationPath '%REPO_DIR%' -Force"
if not exist "%REPO_DIR%\TERMINAL_VG-master\" goto :update_fail
xcopy /s /y /q "%REPO_DIR%\TERMINAL_VG-master\*" "%~dp0" >nul 2>&1
del /q "%REPO_ZIP%" >nul 2>&1
rmdir /s /q "%REPO_DIR%" >nul 2>&1
echo  [OK] Updated from ZIP.
goto :check_python

:update_fail
echo  [!] Update failed. Check internet connection.
if exist "%REPO_ZIP%" del /q "%REPO_ZIP%" >nul 2>&1
if exist "%REPO_DIR%" rmdir /s /q "%REPO_DIR%" >nul 2>&1

:: --- Check Python ---
:check_python
echo.
python --version >nul 2>&1
if %errorlevel% equ 0 goto :python_ok
echo  [!] Python not found. Installing...
set "PY_EXE=%TEMP%\python_install.exe"
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe' -OutFile '%PY_EXE%' -UseBasicParsing"
if not exist "%PY_EXE%" goto :python_fail
"%PY_EXE%" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1
timeout /t 10 /nobreak >nul
set "PATH=%PATH%;C:\Program Files\Python312;C:\Program Files\Python312\Scripts"
del /q "%PY_EXE%" >nul 2>&1

:python_ok
echo  [OK] Python found.
python -m pip install --quiet pywin32 Pillow >nul 2>&1
echo  [OK] Libraries ready.
goto :done

:python_fail
echo  [!] Python install failed.

:done
echo.
echo  ========================================
echo    Done!
echo  ========================================
echo.
pause
