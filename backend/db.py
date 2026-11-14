"""Simple SQLite storage for sessions/messages."""
import os
import sqlite3
from datetime import datetime

DB_PATH = os.getenv("TUTOR_DB", "data/tutor.db")


def _conn():
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            role TEXT,
            text TEXT,
            created_at TEXT
        )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            mode TEXT,
            score INTEGER,
            detail TEXT,
            created_at TEXT
        )"""
    )
    conn.commit()
    return conn


def save_message(session_id: str, role: str, text: str):
    conn = _conn()
    conn.execute(
        "INSERT INTO messages (session_id, role, text, created_at) VALUES (?,?,?,?)",
        (session_id, role, text, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()


def recent_history(session_id: str, limit: int = 6) -> list:
    conn = _conn()
    rows = conn.execute(
        "SELECT role, text FROM messages WHERE session_id=? ORDER BY id DESC LIMIT ?",
        (session_id, limit * 2),
    ).fetchall()
    conn.close()
    rows = list(reversed(rows))
    history = []
    i = 0
    while i < len(rows) - 1:
        if rows[i][0] == "user" and rows[i + 1][0] == "assistant":
            history.append({"user": rows[i][1], "assistant": rows[i + 1][1]})
            i += 2
        else:
            i += 1
    return history[-limit:]


def save_progress(session_id: str, mode: str, score: int, detail: str = ""):
    conn = _conn()
    conn.execute(
        "INSERT INTO progress (session_id, mode, score, detail, created_at) VALUES (?,?,?,?,?)",
        (session_id, mode, score, detail, datetime.utcnow().isoformat()),
    )
    conn.commit()
    conn.close()


def recent_details(session_id: str = "default", limit: int = 10) -> list:
    conn = _conn()
    rows = conn.execute(
        "SELECT mode, detail FROM progress WHERE session_id=? ORDER BY id DESC LIMIT ?",
        (session_id, limit),
    ).fetchall()
    conn.close()
    return [{"mode": r[0], "detail": r[1]} for r in rows]


def progress_summary(session_id: str = "default") -> dict:
    conn = _conn()
    rows = conn.execute(
        "SELECT mode, score, detail, created_at FROM progress WHERE session_id=? ORDER BY id DESC LIMIT 50",
        (session_id,),
    ).fetchall()
    conn.close()
    if not rows:
        return {"total": 0, "average": 0, "by_mode": {}, "recent": []}
    scores = [r[1] for r in rows if r[1] is not None]
    by_mode = {}
    for mode, score, detail, created in rows:
        by_mode.setdefault(mode, []).append(score)
    by_mode_avg = {m: round(sum(v) / len(v)) for m, v in by_mode.items()}
    recent = [{"mode": r[0], "score": r[1], "detail": r[2], "date": r[3]} for r in rows[:10]]
    return {
        "total": len(rows),
        "average": round(sum(scores) / len(scores)) if scores else 0,
        "by_mode": by_mode_avg,
        "recent": recent,
    }
