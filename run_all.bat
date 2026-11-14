@echo off
cd /d "%~dp0"
echo === English Tutor Local ===
echo.

REM Start Ollama if not running
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /I "ollama.exe" >nul
if %errorlevel% neq 0 (
    echo Iniciando Ollama...
    start "" ollama serve
    timeout /t 5 /nobreak >nul
)

echo Deteniendo procesos previos en puerto 8000...
:kill8000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
netstat -aon | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 goto kill8000
timeout /t 2 /nobreak >nul

echo Iniciando backend (sirve tambien el frontend)...
start "English Tutor Backend" cmd /k "cd /d %~dp0backend && python run.py"

echo Esperando a que el backend este listo...
:waitloop
timeout /t 2 /nobreak >nul
python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" >nul 2>&1
if %errorlevel% neq 0 goto waitloop
echo Backend listo.

start http://localhost:8000/
echo.
echo App iniciada en http://localhost:8000/
echo Un solo proceso: backend + frontend.
echo (run.py reinicia automaticamente si el backend se cae)
pause