@echo off
cd /d "%~dp0"
echo Instalando dependencias Python...
python -m pip install -r requirements.txt
echo.
echo Verificando Ollama...
where ollama >nul 2>&1
if %errorlevel% neq 0 (
  echo Ollama no encontrado. Instala Ollama desde https://ollama.com
  pause
  exit /b 1
)
echo Descargando modelo LLM (si no existe)...
ollama pull qwen2.5-coder:7b
echo.
echo Instalacion completada.
pause