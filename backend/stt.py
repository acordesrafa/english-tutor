"""Speech-to-text using faster-whisper (optional)."""
import os
import tempfile
import wave
import struct

try:
    import numpy as np
    _numpy = True
except Exception:
    np = None
    _numpy = False

try:
    from faster_whisper import WhisperModel
    _available = True
except Exception:
    WhisperModel = None
    _available = False

_model = None


def is_available() -> bool:
    return _available


def get_model():
    global _model
    if not _available:
        return None
    if _model is None:
        size = os.getenv("WHISPER_MODEL", "small")
        device = os.getenv("WHISPER_DEVICE", "cpu")
        compute = os.getenv("WHISPER_COMPUTE", "int8")
        _model = WhisperModel(size, device=device, compute_type=compute)
    return _model


def _load_wav(path: str):
    with wave.open(path, "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        raw = wf.readframes(n)
        if wf.getsampwidth() != 2:
            raise RuntimeError("WAV must be 16-bit PCM")
        if wf.getnchannels() != 1:
            raise RuntimeError("WAV must be mono")
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        return samples, sr


def transcribe_bytes(data: bytes, suffix: str = ".webm") -> str:
    if not _available:
        raise RuntimeError("faster-whisper is not installed. Run: pip install faster-whisper")
    model = get_model()

    if suffix.lower() == ".wav" and _numpy:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as f:
            f.write(data)
            path = f.name
        try:
            audio, sr = _load_wav(path)
            # faster-whisper expects 16k; resample if needed
            if sr != 16000:
                # simple linear resample
                import numpy as np
                new_len = int(len(audio) * 16000 / sr)
                audio = np.interp(
                    np.linspace(0, len(audio), new_len, endpoint=False),
                    np.arange(len(audio)),
                    audio,
                ).astype("float32")
            segments, info = model.transcribe(audio, language="en", beam_size=1)
            return " ".join(seg.text.strip() for seg in segments).strip()
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    # Fallback for other formats (requires av/ffmpeg)
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as f:
        f.write(data)
        path = f.name
    try:
        segments, info = model.transcribe(path, language="en")
        return " ".join(seg.text.strip() for seg in segments).strip()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
