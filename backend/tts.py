"""Text-to-speech using Piper (optional)."""
import os
import tempfile
import wave
import subprocess
import shutil

try:
    from piper import PiperVoice
    _piper_py = True
except Exception:
    PiperVoice = None
    _piper_py = False


def is_available() -> bool:
    return _piper_py or shutil.which("piper") is not None


def _model_path() -> str:
    default = os.path.join(
        os.path.dirname(__file__), "..", "models", "piper", "en_US-lessac-medium.onnx"
    )
    return os.getenv("PIPER_MODEL", os.path.abspath(default))


def synthesize(text: str) -> bytes:
    """Return WAV bytes for the given text."""
    model = _model_path()
    if not os.path.exists(model):
        raise RuntimeError(
            f"Piper model not found at {model}. "
            "Download a voice from https://github.com/rhasspy/piper and set PIPER_MODEL."
        )

    # Python API
    if _piper_py:
        import numpy as np
        voice = PiperVoice.load(model)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as f:
            out_path = f.name
        try:
            chunks = list(voice.synthesize(text))
            if not chunks:
                raise RuntimeError("Piper produced no audio")
            sample_rate = chunks[0].sample_rate
            with wave.open(out_path, "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                for chunk in chunks:
                    audio = chunk.audio_float_array
                    pcm = (audio * 32767.0).clip(-32768, 32767).astype(np.int16)
                    wav_file.writeframes(pcm.tobytes())
            with open(out_path, "rb") as f:
                return f.read()
        finally:
            try:
                os.remove(out_path)
            except OSError:
                pass

    # CLI fallback
    if shutil.which("piper"):
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as f:
            out_path = f.name
        try:
            subprocess.run(
                ["piper", "--model", model, "--output_file", out_path],
                input=text.encode("utf-8"),
                check=True,
                capture_output=True,
            )
            with open(out_path, "rb") as f:
                return f.read()
        finally:
            try:
                os.remove(out_path)
            except OSError:
                pass

    raise RuntimeError("Piper is not available. Install piper-tts or the piper CLI.")
