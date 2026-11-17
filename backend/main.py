"""FastAPI backend for local English tutor."""
import os
import sys
import difflib
import threading

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse

import llm
import stt
import tts
import db

app = FastAPI(title="English Tutor Local", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    print("UNHANDLED ERROR:", repr(exc))
    return JSONResponse(status_code=500, content={"error": str(exc)})


def _warmup():
    try:
        llm.chat_raw("Hello")
        print("LLM warmup done")
    except Exception as e:
        print("LLM warmup error:", repr(e))


@app.on_event("startup")
def startup_warmup():
    threading.Thread(target=_warmup, daemon=True).start()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "stt_available": stt.is_available(),
        "tts_available": tts.is_available(),
        "llm_model": llm.MODEL,
    }


@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "data": [{"id": llm.MODEL, "object": "model", "owned_by": "local"}],
    }
async def warmup_endpoint():
    try:
        llm.chat_raw("Hello")
        return {"status": "ready", "model": llm.MODEL}
    except Exception as e:
        print("WARMUP error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/stt")
async def speech_to_text(audio: UploadFile = File(...)):
    data = await audio.read()
    suffix = os.path.splitext(audio.filename or ".webm")[1] or ".webm"
    try:
        with open("debug_last.wav", "wb") as f:
            f.write(data)
    except Exception:
        pass
    try:
        text = stt.transcribe_bytes(data, suffix=suffix)
        print("STT result:", repr(text), "bytes:", len(data), "suffix:", suffix)
        return {"text": text}
    except Exception as e:
        print("STT error:", repr(e))
        return JSONResponse(status_code=503, content={"error": str(e)})


@app.post("/chat")
async def chat_endpoint(text: str = Form(...), session_id: str = Form("default")):
    try:
        history = db.recent_history(session_id)
        reply = llm.chat(text, history=history)
        db.save_message(session_id, "user", text)
        db.save_message(session_id, "assistant", reply)
        return {"reply": reply}
    except Exception as e:
        print("CHAT error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/tts")
async def text_to_speech(text: str = Form(...)):
    try:
        wav = tts.synthesize(text)
        return Response(content=wav, media_type="audio/wav")
    except Exception as e:
        print("TTS error:", repr(e))
        return JSONResponse(status_code=503, content={"error": str(e)})


@app.post("/exercise")
async def exercise_endpoint(level: str = Form("beginner"), topic: str = Form("daily life")):
    try:
        text, question = llm.generate_listening(level, topic)
        db.save_message("default", "assistant", f"[exercise] {text} | Q: {question}")
        return {"text": text, "question": question}
    except Exception as e:
        print("EXERCISE error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/check")
async def check_endpoint(text: str = Form(...), question: str = Form(...), answer: str = Form(...)):
    try:
        feedback = llm.check_listening(text, question, answer)
        db.save_message("default", "user", answer)
        db.save_message("default", "assistant", feedback)
        return {"feedback": feedback}
    except Exception as e:
        print("CHECK error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/dictation")
async def dictation_endpoint(level: str = Form("beginner"), topic: str = Form("daily life")):
    try:
        text, _ = llm.generate_listening(level, topic)
        sentence = text.split(".")[0].strip() + "."
        return {"text": sentence}
    except Exception as e:
        print("DICTATION error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/progress")
async def progress_endpoint(session_id: str = Form("default"), mode: str = Form(...), score: int = Form(0), detail: str = Form("")):
    try:
        db.save_progress(session_id, mode, score, detail)
        return {"status": "saved"}
    except Exception as e:
        print("PROGRESS error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.get("/progress_summary")
async def progress_summary_endpoint(session_id: str = "default"):
    try:
        return db.progress_summary(session_id)
    except Exception as e:
        print("PROGRESS_SUMMARY error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/shadowing_check")
async def shadowing_check(target: str = Form(...), transcript: str = Form(...)):
    try:
        ratio = difflib.SequenceMatcher(None, target.lower(), transcript.lower()).ratio()
        score = round(ratio * 100)
        if score >= 85:
            feedback = f"Great job! Similarity: {score}%. Your pronunciation is very close."
        elif score >= 60:
            feedback = f"Good attempt. Similarity: {score}%. Try to match the rhythm and sounds more closely."
        else:
            feedback = f"Keep practicing. Similarity: {score}%. Listen again and repeat slowly."
        db.save_progress("default", "shadowing", score, target)
        return {"score": score, "feedback": feedback}
    except Exception as e:
        print("SHADOWING_CHECK error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/fillblank")
async def fillblank_endpoint(level: str = Form("beginner"), topic: str = Form("daily life")):
    try:
        text, _ = llm.generate_listening(level, topic)
        words = text.replace(".", "").split()
        if len(words) < 4:
            return {"sentence": text, "blank": "", "answer": ""}
        idx = len(words) // 2
        answer = words[idx]
        words[idx] = "_____"
        sentence = " ".join(words) + "."
        return {"sentence": sentence, "answer": answer}
    except Exception as e:
        print("FILLBLANK error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/personalized")
async def personalized_endpoint(level: str = Form("beginner"), topic: str = Form("daily life")):
    try:
        details = db.recent_details("default", 10)
        context = "\n".join(f"- {d['mode']}: {d['detail']}" for d in details if d.get("detail"))
        if not context:
            context = "No previous errors. Start with beginner level."
        prompt = f"""The student struggled with these items:
{context}
Create a new short English listening exercise (2 sentences) that helps practice similar vocabulary and structures.
Topic: {topic}. Level: {level}.
Return exactly:
TEXT: <sentences>
QUESTION: <question>"""
        raw = llm.chat_raw(prompt)
        t = ""
        q = ""
        for line in raw.splitlines():
            line = line.strip()
            if line.lower().startswith("text:"):
                t = line[5:].strip()
            elif line.lower().startswith("question:"):
                q = line[9:].strip()
        if not t or not q:
            t, q = llm.generate_listening(level, topic)
        return {"text": t, "question": q}
    except Exception as e:
        print("PERSONALIZED error:", repr(e))
        return JSONResponse(status_code=500, content={"error": str(e)})

# Serve frontend (single process: backend + frontend on one port)
import os as _os
_FRONTEND_DIR = _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", "frontend"))

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

@app.get("/")
def serve_index():
    return FileResponse(_os.path.join(_FRONTEND_DIR, "index.html"))

# Mount static assets (css, js) at root so /style.css and /app.js resolve
app.mount("/", StaticFiles(directory=_FRONTEND_DIR), name="frontend")
