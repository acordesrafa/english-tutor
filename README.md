# English Tutor Local

Aplicación local para practicar inglés con voz. Permite hablar con una IA y recibir respuestas con audio, además de ejercicios de comprensión auditiva, dictado y shadowing.

## Características
- Conversación por voz con tutor de inglés
- Respuestas en audio (TTS local)
- Transcripción de voz (STT local)
- Ejercicios de comprensión auditiva
- Dictado
- Shadowing con score de similitud
- Práctica personalizada según errores recientes
- Historial y progreso en SQLite

## Requisitos
- Python 3.10+
- Ollama instalado y corriendo
- Modelo LLM: `qwen2.5-coder:7b` (o cambiar con `OLLAMA_MODEL`)
- faster-whisper (se descarga modelo small automáticamente)
- piper-tts con voz incluida

## Instalación y ejecución
```powershell
.\install.bat
.\run_all.bat
```

## Estructura
```
english-tutor-local/
├─ backend/
│  ├─ main.py
│  ├─ llm.py
│  ├─ stt.py
│  ├─ tts.py
│  └─ db.py
├─ frontend/
│  ├─ index.html
│  ├─ app.js
│  └─ style.css
├─ models/piper/
├─ requirements.txt
└─ README.md
```

## Endpoints
- `GET /health`
- `POST /stt`
- `POST /chat`
- `POST /tts`
- `POST /exercise`
- `POST /check`
- `POST /dictation`
- `POST /shadowing_check`
- `POST /personalized`
- `POST /progress`
- `GET /progress_summary`

## Uso recomendado
1. Empieza con **Conversación** para acostumbrarte al audio.
2. Usa **Dictado** para mejorar comprensión exacta.
3. Usa **Shadowing** para pronunciación.
4. Revisa **Progreso** para ver tu evolución.
5. Usa **Práctica personalizada** para reforzar errores.

## Notas
- Todo corre localmente.
- El LLM es de 7B, suficiente para MVP.
- Para mejor calidad, puedes cambiar a un modelo más grande si tu hardware lo permite.
- El progreso se guarda en `data/tutor.db`.


## Despliegue en Oracle Cloud (gratuito, permanente)

Esta app puede correr en Oracle Cloud Free Tier (ARM, 24 GB RAM) para tenerla disponible desde cualquier lugar.

### Requisitos
- Cuenta en Oracle Cloud (https://cloud.oracle.com) — gratuita, requiere tarjeta (no se cobra).
- Instancia "Always Free" ARM (Ampere A1, 4 OCPU, 24 GB RAM), Ubuntu 22.04.

### Pasos
1. Crea la instancia en Oracle Cloud Console.
2. Abre el puerto 8000 en Security List (Ingress Rule, TCP, 0.0.0.0/0, puerto 8000).
3. Conéctate por SSH: `ssh ubuntu@IP_PUBLICA`
4. Instala Docker:
   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose-v2
   sudo usermod -aG docker $USER
   ```
   (Cierra sesión y vuelve a entrar)
5. Clona el repositorio y ejecuta:
   ```bash
   git clone <tu-repo> english-tutor-local
   cd english-tutor-local
   docker compose up -d --build
   ```
6. La primera vez tarda varios minutos (descarga modelo ~4.7 GB).
7. Accede desde cualquier navegador: `http://IP_PUBLICA:8000/`

### En el teléfono
1. Abre `http://IP_PUBLICA:8000/` en Chrome.
2. Menú (⋮) → "Añadir a pantalla de inicio" / "Instalar app".
3. En la app, selecciona "Nube" y pega la URL de Oracle.

### Actualizar el código
```bash
cd english-tutor-local
git pull
docker compose up -d --build
```

## Selector de servidor en la app
La app incluye un selector en la barra superior:
- **Local (esta PC):** usa el backend en el mismo dispositivo.
- **Casa (LAN):** usa `http://192.168.1.7:8000` (tu PC desde el teléfono).
- **Nube:** pega la URL de tu servidor en Oracle Cloud.

La selección se guarda en el navegador.

## Docker (local)
```bash
# Construir y ejecutar
docker compose up -d --build

# Ver logs
docker compose logs -f

# Detener
docker compose down

# Reiniciar
docker compose restart
```
