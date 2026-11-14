"""LLM integration via local Ollama."""
import os
import requests

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")

TUTOR_PROMPT = """You are a friendly native English conversation partner.
The student is a Spanish speaker learning English.
Speak naturally, like a native speaker, in clear standard English.
After the student speaks:
- First answer naturally.
- If they made an important pronunciation or grammar mistake, briefly correct it in a kind way.
- Keep your reply to 1-3 short sentences.
- End with one short follow-up question.
Do not use markdown, lists, or long explanations.
Always answer in English.
"""


def generate_listening(level: str = "beginner", topic: str = "daily life") -> tuple[str, str]:
    prompt = f"""Create a short English listening exercise for a {level} Spanish speaker.
Topic: {topic}.
Return exactly two lines:
TEXT: <2-3 short sentences in clear English>
QUESTION: <one simple comprehension question about the text>
Do not add anything else."""
    raw = chat_raw(prompt)
    text = ""
    question = ""
    for line in raw.splitlines():
        line = line.strip()
        if line.lower().startswith("text:"):
            text = line[5:].strip()
        elif line.lower().startswith("question:"):
            question = line[9:].strip()
    if not text:
        text = "I go to the store every morning. I buy bread and milk."
    if not question:
        question = "Where does the person go every morning?"
    return text, question


def check_listening(text: str, question: str, answer: str) -> str:
    prompt = f"""You are an English teacher. Evaluate the student's answer to a listening comprehension question.
TEXT: {text}
QUESTION: {question}
STUDENT ANSWER: {answer}
Reply in 2-4 sentences: say if correct, explain briefly, and give the correct answer if needed. Use simple English."""
    return chat_raw(prompt)


def chat_raw(prompt: str) -> str:
    try:
        r = requests.post(
            OLLAMA_URL,
            json={"model": MODEL, "prompt": prompt, "stream": False},
            timeout=300,
        )
        r.raise_for_status()
        data = r.json()
        return (data.get("response") or "").strip()
    except Exception as e:
        return f"[LLM error: {e}]"


def chat(user_text: str, history: list | None = None) -> str:
    history = history or []
    prompt = TUTOR_PROMPT + "\n\n"
    for h in history[-6:]:
        prompt += f"Student: {h['user']}\nTutor: {h['assistant']}\n"
    prompt += f"Student: {user_text}\nTutor:"
    return chat_raw(prompt)
