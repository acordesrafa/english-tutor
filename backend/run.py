import asyncio
import sys
import os
import time

# Suppress deprecation warnings
import warnings
warnings.filterwarnings("ignore")

# Use the selector event loop on Windows for stability
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

import uvicorn

if __name__ == "__main__":
    print("Iniciando backend en http://0.0.0.0:8000 ...", flush=True)
    # Crash-restart loop with logging
    while True:
        try:
            uvicorn.run("main:app", host="0.0.0.0", port=8000, log_level="info")
        except Exception as e:
            print(f"Backend crashed: {e!r}. Restarting in 3s...", flush=True)
            time.sleep(3)
