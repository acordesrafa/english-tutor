# syntax=docker/dockerfile:1
FROM python:3.11-slim

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /app

# Python dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy application code
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/

# Make run.py executable
RUN chmod +x /app/backend/run.py

# Expose port
EXPOSE 8000

# Environment
ENV OLLAMA_URL=http://localhost:11434/api/generate
ENV OLLAMA_MODEL=qwen2.5-coder:7b
ENV TUTOR_DB=/app/data/tutor.db

# Create data directory
RUN mkdir -p /app/data

# Startup script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]