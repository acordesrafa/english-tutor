#!/bin/bash
set -e

echo "=== English Tutor Local (Docker) ==="

# Start Ollama in background
echo "Iniciando Ollama..."
ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "Esperando a Ollama..."
for i in $(seq 1 30); do
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "Ollama listo."
        break
    fi
    sleep 2
done

# Pull model if not present
MODEL="${OLLAMA_MODEL:-qwen2.5-coder:7b}"
echo "Verificando modelo $MODEL..."
if ! ollama list | grep -q "$MODEL"; then
    echo "Descargando modelo $MODEL (puede tardar varios minutos)..."
    ollama pull "$MODEL"
fi

echo "Iniciando backend en puerto 8000..."
cd /app/backend
exec python run.py