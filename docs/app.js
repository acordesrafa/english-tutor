// Force-update: clear stale caches if version mismatch
(function() {
  const V = "v7";
  if (localStorage.getItem("app_version") !== V) {
    localStorage.setItem("app_version", V);
    if ("caches" in window) {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage("skipWaiting");
        }
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  }
})();
let BACKEND = localStorage.getItem("backend_url") || "";

// ===== Groq mode helpers =====
function getTutorPrompt() {
  const level = (typeof getLevel === "function" ? getLevel() : "") || "intermediate";
  const topic = (typeof getTopic === "function" ? getTopic() : "") || "technology";
  return `You are a friendly native English conversation partner.
The student is a Spanish speaker learning English.
Speak naturally, like a native speaker, in clear standard English.
The conversation topic is: ${topic} (level: ${level}).
Stay on this topic and, when relevant, role-play real-world institutions and contexts (school, work, hospital, bank, store, airport, etc.) related to the topic.
After the student speaks:
- First answer naturally.
- If they made an important pronunciation or grammar mistake, briefly correct it in a kind way.
- If the student asks you to translate something to Spanish, provide the Spanish translation clearly.
- Keep your reply to 1-3 short sentences.
- End with one short follow-up question.
Do not use markdown, lists, or long explanations.
Always answer in English (except when giving a Spanish translation).`;
}

function isGroqMode() { return BACKEND === "groq"; }

function getGroqKey() { return localStorage.getItem("groq_api_key") || ""; }


function safeJson(r) {
  return r.text().then(t => {
    try { return JSON.parse(t); }
    catch (e) { throw new Error("El servidor devolvio una respuesta no-JSON (" + r.status + "). Verifica que el backend este corriendo y la URL sea correcta."); }
  });
}


const GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3-32b", "openai/gpt-oss-20b"];
async function groqChat(messages) {
  const apiKey = getGroqKey();
  let lastErr = null;
  for (const model of GROQ_MODELS) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 300 })
      });
      const rawText = await r.text();
      let d;
      try { d = JSON.parse(rawText); }
      catch (e) {
        lastErr = new Error("Groq devolvio respuesta no-JSON (" + r.status + "). Reintenta en unos segundos.");
        continue;
      }
      if (!r.ok || (d && d.error)) {
        const msg = (d && d.error && (d.error.message || d.error)) || ("HTTP " + r.status);
        lastErr = new Error(msg);
        if (d.error && /model|access|not found|does not exist/i.test(msg)) continue;
        throw lastErr;
      }
      if (!d.choices || !d.choices[0]) { lastErr = new Error("Respuesta vacia de Groq"); continue; }
      return d.choices[0].message.content;
    } catch (e) { lastErr = e; if (e && e.message && /no-JSON/i.test(e.message)) continue; }
  }
  throw lastErr || new Error("All Groq models failed");
}

async function groqGenerate(prompt) {
  return await groqChat([{ role: "user", content: prompt }]);
}

async function groqSTT(audioBlob) {
  const apiKey = getGroqKey();
  const form = new FormData();
  form.append("file", audioBlob, "audio.wav");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "en");
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey },
    body: form
  });
  const rawText = await r.text();
  let d;
  try { d = JSON.parse(rawText); } catch (e) { throw new Error("Groq STT devolvio respuesta no-JSON (" + r.status + ")"); }
  if (!r.ok || (d && d.error)) throw new Error((d && d.error && (d.error.message || d.error)) || ("HTTP " + r.status));
  return d.text || "";
}

function groqSpeak(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = slowAudio.checked ? 0.9 : 1.0;
  const voices = speechSynthesis.getVoices();
  const enVoice = voices.find(v => v.lang.startsWith("en")) || voices.find(v => v.lang.startsWith("en-"));
  if (enVoice) utterance.voice = enVoice;
  lastAudioText = text;
  if (replayBtn) replayBtn.disabled = false;
  speechSynthesis.speak(utterance);
}

async function groqGenerateListening(level, topic) {
  const prompt = `Create a short English listening exercise for a ${level} Spanish speaker.\nTopic: ${topic}.\nReturn exactly two lines:\nTEXT: <2-3 short sentences in clear English>\nQUESTION: <one simple comprehension question about the text>\nDo not add anything else.`;
  const raw = await groqGenerate(prompt);
  let text = "", question = "";
  for (const line of raw.split("\n")) {
    const l = line.trim();
    if (l.toLowerCase().startsWith("text:")) text = l.slice(5).trim();
    else if (l.toLowerCase().startsWith("question:")) question = l.slice(9).trim();
  }
  if (!text) text = "I go to the store every morning. I buy bread and milk.";
  if (!question) question = "Where does the person go every morning?";
  return { text, question };
}

async function groqCheckListening(text, question, answer) {
  const prompt = `You are an English teacher. Evaluate the student's answer to a listening comprehension question.\nTEXT: ${text}\nQUESTION: ${question}\nSTUDENT ANSWER: ${answer}\nReply in 2-4 sentences: say if correct, explain briefly, and give the correct answer if needed. Use simple English.`;
  return await groqGenerate(prompt);
}

// Progress storage for Groq mode (localStorage)
function groqSaveProgress(mode, score, detail) {
  const key = "progress_details";
  const list = JSON.parse(localStorage.getItem(key) || "[]");
  list.push({ mode, score, detail, date: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(list));
}


async function groqFillblank(level, topic) {
  const ex = await groqGenerateListening(level, topic);
  const words = ex.text.replace(/\./g, "").split(/\s+/);
  if (words.length < 4) return { sentence: ex.text, answer: "" };
  const idx = Math.floor(words.length / 2);
  const answer = words[idx];
  words[idx] = "_____";
  const sentence = words.join(" ") + ".";
  return { sentence, answer };
}

async function groqPersonalized(level, topic) {
  const details = JSON.parse(localStorage.getItem("progress_details") || "[]");
  let context = details.slice(-10).map(d => `- ${d.mode}: ${d.detail}`).join("\n");
  if (!context) context = "No previous errors. Start with beginner level.";
  const prompt = `The student struggled with these items:\n${context}\nCreate a new short English listening exercise (2 sentences) that helps practice similar vocabulary and structures.\nTopic: ${topic}. Level: ${level}.\nReturn exactly:\nTEXT: <sentences>\nQUESTION: <question>`;
  const raw = await groqGenerate(prompt);
  let text = "", question = "";
  for (const line of raw.split("\n")) {
    const l = line.trim();
    if (l.toLowerCase().startsWith("text:")) text = l.slice(5).trim();
    else if (l.toLowerCase().startsWith("question:")) question = l.slice(9).trim();
  }
  if (!text || !question) {
    const fb = await groqGenerateListening(level, topic);
    text = fb.text; question = fb.question;
  }
  return { text, question };
}

function groqProgressSummary() {
  const list = JSON.parse(localStorage.getItem("progress_details") || "[]");
  if (!list.length) return { total: 0, average: 0, by_mode: {}, recent: [] };
  const scores = list.map(x => x.score);
  const by_mode = {};
  for (const x of list) {
    if (!by_mode[x.mode]) by_mode[x.mode] = [];
    by_mode[x.mode].push(x.score);
  }
  const by_mode_avg = {};
  for (const m of Object.keys(by_mode)) {
    const v = by_mode[m];
    by_mode_avg[m] = Math.round(v.reduce((a,b)=>a+b,0) / v.length);
  }
  const recent = list.slice(-10).reverse().map(x => ({ mode: x.mode, score: x.score, detail: x.detail, date: x.date }));
  return {
    total: list.length,
    average: Math.round(scores.reduce((a,b)=>a+b,0) / scores.length),
    by_mode: by_mode_avg,
    recent
  };
}

function getLevel() { return document.getElementById("levelSelect").value; }
function getTopic() { return document.getElementById("topicSelect").value; }

const micSelect = document.getElementById("micSelect");

async function loadMicDevices() {
  try {
    // Request permission first
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === "audioinput");
    micSelect.innerHTML = "";
    inputs.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || ("Micrófono " + (i + 1));
      micSelect.appendChild(opt);
    });
    console.log("Micrófonos detectados:", inputs.map(d => d.label));
    // Prefer "Microphone Array", avoid "Mezcla estéreo"/"Stereo Mix"
    const preferred = inputs.find(d => /array/i.test(d.label || "") && !/mezcla|mix|stereo/i.test(d.label || ""))
      || inputs.find(d => /microphone/i.test(d.label || "") && !/mezcla|mix|stereo/i.test(d.label || ""))
      || inputs.find(d => /realtek/i.test(d.label || "") && !/mezcla|mix|stereo/i.test(d.label || ""));
    if (preferred) {
      micSelect.value = preferred.deviceId;
      console.log("Micrófono seleccionado automáticamente:", preferred.label);
    } else if (inputs.length) {
      micSelect.value = inputs[0].deviceId;
      console.log("Usando primer micrófono:", inputs[0].label);
    }
  } catch (e) {
    console.warn("No se pudieron listar micrófonos:", e);
  }
}
loadMicDevices();

const chatEl = document.getElementById("chat");
const statusEl = document.getElementById("status");
const groqKey = document.getElementById("groqKey");
const retryBtn = document.getElementById("retryBtn");
const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const replayBtn = document.getElementById("replayBtn");
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");
const showTranscript = document.getElementById("showTranscript");
const slowAudio = document.getElementById("slowAudio");

let audioContext = null;
let mediaStream = null;
let processor = null;
let source = null;
let recordedSamples = [];
let isRecording = false;
let lastAudioBlob = null;
let lastAudioText = null;

function addMsg(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.innerHTML = `<div class="label">${role === "user" ? "Tú" : "Tutor"}</div><div>${text}</div>`;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

let _modelWarmed = false;
async function warmupModel() {
  if (_modelWarmed) return;
  if (isGroqMode()) { _modelWarmed = true; return; }
  statusEl.textContent = "Cargando modelo (puede tardar la primera vez)...";
  try {
    const r = await fetch(BACKEND + "/warmup", { method: "POST" });
    if (r.ok) _modelWarmed = true;
  } catch (e) {}
}
async function checkHealth() {
  try {
    if (isGroqMode()) {
      // Test Groq API with a minimal request
      const r = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { "Authorization": "Bearer " + getGroqKey() }
      });
      if (r.ok) {
        if (retryBtn) retryBtn.style.display = "none";
        statusEl.textContent = "Groq OK | LLM: GPT-OSS 120B (con fallback) | STT: Whisper V3";
      } else {
        statusEl.textContent = "Groq: API key inválida o sin conexión.";
        if (retryBtn) retryBtn.style.display = "inline-block";
      }
      return;
    }
    const r = await fetch(BACKEND + "/health");
    const d = await safeJson(r);
    if (retryBtn) retryBtn.style.display = "none";
    if (!_modelWarmed) {
      statusEl.textContent = `Backend OK | Cargando modelo...`;
      warmupModel().then(() => {
        statusEl.textContent = `Backend OK | STT: ${d.stt_available ? "sí" : "no"} | TTS: ${d.tts_available ? "sí" : "no"} | LLM: ${d.llm_model} (listo)`;
      });
    } else {
      statusEl.textContent = `Backend OK | STT: ${d.stt_available ? "sí" : "no"} | TTS: ${d.tts_available ? "sí" : "no"} | LLM: ${d.llm_model}`;
    }
  } catch (e) {
    statusEl.textContent = "Backend no disponible. Ejecuta run_all.bat o inicia uvicorn en backend/.";
    if (retryBtn) retryBtn.style.display = "inline-block";
  }
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  function writeStr(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

async function sendText(text) {
  if (!text.trim()) return;
  addMsg("user", text);
  const thinking = document.createElement("div");
  thinking.className = "msg assistant";
  thinking.innerHTML = "<div class=\"label\">Tutor</div><div>Procesando...</div>";
  chatEl.appendChild(thinking);
  chatEl.scrollTop = chatEl.scrollHeight;
  try {
    let reply = "";
    if (isGroqMode()) {
      const history = [];
      const msgs = chatEl.querySelectorAll(".msg");
      const recent = Array.from(msgs).slice(-6);
      for (const m of recent) {
        const label = m.querySelector(".label");
        const body = m.querySelector("div:nth-child(2)");
        if (!label || !body) continue;
        const role = (label.textContent || "").trim() === "Tú" ? "user" : "assistant";
        const content = (body.textContent || "").trim();
        if (content && content !== "Procesando...") history.push({ role, content });
      }
      if (history.length && history[history.length-1].role === "user" && history[history.length-1].content === text.trim()) {
        history.pop();
      }
      const messages = [{ role: "system", content: getTutorPrompt() }];
      messages.push(...history);
      messages.push({ role: "user", content: text });
      reply = await groqChat(messages);
    } else {
      const form = new FormData();
      form.append("text", text);
      form.append("session_id", "default");
      const r = await fetch(BACKEND + "/chat", { method: "POST", body: form });
      const d = await safeJson(r);
      reply = d.reply || "[sin respuesta]";
    }
    thinking.remove();
    if (!reply) reply = "[sin respuesta]";
    const immersion = document.getElementById("immersionMode").checked;
    if (immersion) {
      // Modo inmersión: no mostrar texto, solo audio
    } else if (showTranscript.checked) {
      addMsg("assistant", reply);
    } else {
      addMsg("assistant", "🔊 (audio)");
    }
    await speak(reply);
  } catch (e) {
    thinking.remove();
    addMsg("assistant", "Error: " + e.message);
  }
}

async function speak(text) {
  if (isGroqMode()) {
    groqSpeak(text);
    lastAudioText = text;
    if (replayBtn) replayBtn.disabled = false;
    return;
  }
  try {
    const form = new FormData();
    form.append("text", text);
    const r = await fetch(BACKEND + "/tts", { method: "POST", body: form });
    if (!r.ok) {
      const d = await safeJson(r);
      console.warn("TTS no disponible:", d.error);
      return;
    }
    const blob = await r.blob();
    lastAudioBlob = blob;
    replayBtn.disabled = false;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = slowAudio.checked ? 0.9 : 1.0;
    audio.play();
  } catch (e) {
    console.warn("TTS error:", e);
  }
}

recordBtn.onclick = async () => {
  try {
    const selectedMic = micSelect.value;
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: selectedMic ? { deviceId: { exact: selectedMic } } : true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    await audioContext.resume();
    console.log("AudioContext state:", audioContext.state, "sampleRate:", audioContext.sampleRate);
    source = audioContext.createMediaStreamSource(mediaStream);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 10.0;
    source.connect(gainNode);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    gainNode.connect(processor);
    recordedSamples = [];
    processor.onaudioprocess = e => {
      const data = e.inputBuffer.getChannelData(0);
      recordedSamples.push(new Float32Array(data));
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
    isRecording = true;
    recordBtn.disabled = true;
    stopBtn.disabled = false;
  } catch (e) {
    alert("No se pudo acceder al micrófono: " + e.message);
  }
};

stopBtn.onclick = async () => {
  if (!isRecording) return;
  isRecording = false;
  if (processor) processor.disconnect();
  if (source) source.disconnect();
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());

  console.log("Recorded chunks:", recordedSamples.length);
  // Flatten samples
  let total = 0;
  recordedSamples.forEach(c => total += c.length);
  const samples = new Float32Array(total);
  let off = 0;
  recordedSamples.forEach(c => { samples.set(c, off); off += c.length; });

  const blob = encodeWav(samples, 16000);
  const rms = Math.sqrt(samples.reduce((a,b)=>a+b*b,0)/samples.length);
  console.log("WAV blob size:", blob.size, "samples:", samples.length, "RMS:", rms);
  statusEl.textContent = "Grabado. RMS=" + rms.toFixed(4) + " (si es ~0, el mic no captura)";
  recordBtn.disabled = false;
  stopBtn.disabled = true;

  try {
    let text = "";
    if (isGroqMode()) {
      text = await groqSTT(blob);
    } else {
      const form = new FormData();
      form.append("audio", blob, "recording.wav");
      const r = await fetch(BACKEND + "/stt", { method: "POST", body: form });
      const d = await safeJson(r);
      if (d.error) {
        addMsg("assistant", "STT no disponible: " + d.error);
        return;
      }
      text = d.text || "";
    }
    if (text) await sendText(text);
    else addMsg("assistant", "(No se detectó voz)");
  } catch (e) {
    addMsg("assistant", "Error STT: " + e.message);
  }
};

replayBtn.onclick = () => {
  if (isGroqMode()) {
    if (lastAudioText) groqSpeak(lastAudioText);
    return;
  }
  if (!lastAudioBlob) return;
  const url = URL.createObjectURL(lastAudioBlob);
  const audio = new Audio(url);
  audio.playbackRate = slowAudio.checked ? 0.9 : 1.0;
  audio.play();
};

sendBtn.onclick = () => {
  const t = textInput.value;
  textInput.value = "";
  sendText(t);
};
textInput.addEventListener("keydown", e => {
  if (e.key === "Enter") sendBtn.click();
});

// --- Listening exercise ---
let currentExercise = null;

const exerciseBtn = document.getElementById("exerciseBtn");
const exerciseText = document.getElementById("exerciseText");
const exerciseQuestion = document.getElementById("exerciseQuestion");
const answerInput = document.getElementById("answerInput");
answerInput.addEventListener("keydown", e => { if (e.key === "Enter") checkAnswer(); });
const checkBtn = document.getElementById("checkBtn");
const exerciseFeedback = document.getElementById("exerciseFeedback");

async function newExercise() {
  exerciseFeedback.textContent = "Generando ejercicio (cargando modelo si es la primera vez)...";
  exerciseText.style.display = "none";
  exerciseText.textContent = "";
  answerInput.value = "";
  try {
    let d;
    if (isGroqMode()) {
      d = await groqGenerateListening(getLevel(), getTopic());
    } else {
      const form = new FormData();
      form.append("level", getLevel());
      form.append("topic", getTopic());
      const r = await fetch(BACKEND + "/exercise", { method: "POST", body: form });
      d = await safeJson(r);
    }
    currentExercise = { text: d.text, question: d.question };
    exerciseQuestion.textContent = "Pregunta: " + d.question;
    // Play audio of the text
    await speak(d.text);
  } catch (e) {
    exerciseQuestion.textContent = "Error: " + e.message;
  }
}

async function checkAnswer() {
  if (!currentExercise) return;
  const ans = answerInput.value.trim();
  if (!ans) return;
  try {
    let feedback = "";
    if (isGroqMode()) {
      feedback = await groqCheckListening(currentExercise.text, currentExercise.question, ans);
    } else {
      const form = new FormData();
      form.append("text", currentExercise.text);
      form.append("question", currentExercise.question);
      form.append("answer", ans);
      const r = await fetch(BACKEND + "/check", { method: "POST", body: form });
      const d = await safeJson(r);
      feedback = d.feedback || "[sin feedback]";
    }
    exerciseFeedback.textContent = feedback;
    exerciseText.style.display = "block";
    exerciseText.textContent = "Texto: " + currentExercise.text;
  } catch (e) {
    exerciseFeedback.textContent = "Error: " + e.message;
  }
}

exerciseBtn.onclick = newExercise;
checkBtn.onclick = checkAnswer;

// --- Dictation & Shadowing ---
let currentDictation = null;
let currentShadowing = null;
let shadowSamples = [];
let shadowRecording = false;
let shadowContext = null;
let shadowSource = null;
let shadowProcessor = null;
let shadowStream = null;

const dictationBtn = document.getElementById("dictationBtn");
const dictationQuestion = document.getElementById("dictationQuestion");
const dictationInput = document.getElementById("dictationInput");
const checkDictationBtn = document.getElementById("checkDictationBtn");
dictationInput.addEventListener("keydown", e => { if (e.key === "Enter") checkDictation(); });
const dictationFeedback = document.getElementById("dictationFeedback");

const shadowingBtn = document.getElementById("shadowingBtn");
const shadowingText = document.getElementById("shadowingText");
const shadowingTarget = document.getElementById("shadowingTarget");
const shadowRecordBtn = document.getElementById("shadowRecordBtn");
const shadowStopBtn = document.getElementById("shadowStopBtn");
const shadowingFeedback = document.getElementById("shadowingFeedback");

async function newDictation() {
  dictationFeedback.textContent = "Generando dictado (cargando modelo si es la primera vez)...";
  dictationInput.value = "";
  dictationBtn.disabled = true;
  try {
    let text = "";
    if (isGroqMode()) {
      const ex = await groqGenerateListening(getLevel(), getTopic());
      text = ex.text.split(".")[0].trim() + ".";
    } else {
      const form = new FormData();
      form.append("level", getLevel());
      form.append("topic", getTopic());
      const r = await fetch(BACKEND + "/dictation", { method: "POST", body: form });
      const d = await safeJson(r);
      text = d.text;
    }
    currentDictation = text;
    dictationQuestion.textContent = "Escucha y escribe lo que oyes.";
    dictationBtn.disabled = false;
    await speak(text);
  } catch (e) {
    dictationQuestion.textContent = "Error: " + e.message;
  }
}

async function checkDictation() {
  if (!currentDictation) return;
  const user = dictationInput.value.trim();
  if (!user) return;
  const a = currentDictation.toLowerCase().replace(/[.,!?]/g, "").trim();
  const b = user.toLowerCase().replace(/[.,!?]/g, "").trim();
  if (a === b) {
    dictationFeedback.textContent = "Correcto. Muy bien.";
  } else {
    dictationFeedback.textContent = "No exacto.\nEsperado: " + currentDictation + "\nTu respuesta: " + user;
  }
}

dictationBtn.onclick = newDictation;
checkDictationBtn.onclick = checkDictation;

async function newShadowing() {
  shadowingFeedback.textContent = "Generando ejercicio (cargando modelo si es la primera vez)...";
  shadowingText.style.display = "none";
  shadowingBtn.disabled = true;
  shadowingText.textContent = "";
  try {
    let text = "";
    if (isGroqMode()) {
      const ex = await groqGenerateListening(getLevel(), getTopic());
      text = ex.text;
    } else {
      const form = new FormData();
      form.append("level", getLevel());
      form.append("topic", getTopic());
      const r = await fetch(BACKEND + "/exercise", { method: "POST", body: form });
      const d = await safeJson(r);
      text = d.text;
    }
    currentShadowing = text;
    shadowingTarget.textContent = "Repite esta frase: " + text;
    shadowingBtn.disabled = false;
    await speak(text);
  } catch (e) {
    shadowingTarget.textContent = "Error: " + e.message;
  }
}

shadowingBtn.onclick = newShadowing;

shadowRecordBtn.onclick = async () => {
  try {
    const selectedMic2 = micSelect.value;
    shadowStream = await navigator.mediaDevices.getUserMedia({ audio: selectedMic2 ? { deviceId: { exact: selectedMic2 } } : true });
    shadowContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    shadowSource = shadowContext.createMediaStreamSource(shadowStream);
    const shadowGain = shadowContext.createGain();
    shadowGain.gain.value = 10.0;
    shadowSource.connect(shadowGain);
    shadowProcessor = shadowContext.createScriptProcessor(4096, 1, 1);
    shadowGain.connect(shadowProcessor);
    shadowSamples = [];
    shadowProcessor.onaudioprocess = e => {
      const data = e.inputBuffer.getChannelData(0);
      shadowSamples.push(new Float32Array(data));
    };
    shadowSource.connect(shadowProcessor);
    shadowProcessor.connect(shadowContext.destination);
    shadowRecording = true;
    shadowRecordBtn.disabled = true;
    shadowStopBtn.disabled = false;
  } catch (e) {
    alert("No se pudo acceder al micrófono: " + e.message);
  }
};

shadowStopBtn.onclick = async () => {
  if (!shadowRecording) return;
  shadowRecording = false;
  if (shadowProcessor) shadowProcessor.disconnect();
  if (shadowSource) shadowSource.disconnect();
  if (shadowStream) shadowStream.getTracks().forEach(t => t.stop());

  let total = 0;
  shadowSamples.forEach(c => total += c.length);
  const samples = new Float32Array(total);
  let off = 0;
  shadowSamples.forEach(c => { samples.set(c, off); off += c.length; });

  const blob = encodeWav(samples, 16000);
  shadowRecordBtn.disabled = false;
  shadowStopBtn.disabled = true;

  try {
    let transcript = "";
    if (isGroqMode()) {
      transcript = await groqSTT(blob);
    } else {
      const form = new FormData();
      form.append("audio", blob, "shadow.wav");
      const r = await fetch(BACKEND + "/stt", { method: "POST", body: form });
      const d = await safeJson(r);
      if (d.error) {
        shadowingFeedback.textContent = "STT no disponible: " + d.error;
        return;
      }
      transcript = d.text || "";
    }
    // Compute similarity score client-side
    const a = (currentShadowing || "").toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
    const b = (transcript || "").toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
    let matches = 0;
    const used = new Set();
    for (const w of b) {
      const idx = a.findIndex((x, i) => x === w && !used.has(i));
      if (idx >= 0) { matches++; used.add(idx); }
    }
    const score = a.length ? Math.round((matches / a.length) * 100) : 0;
    let feedback = "";
    if (score >= 90) feedback = "Excelente pronunciación.";
    else if (score >= 70) feedback = "Bien, pero puedes mejorar.";
    else feedback = "Sigue practicando.";
    shadowingFeedback.textContent = feedback + "\nTu transcripción: " + transcript + "\nPuntaje: " + score + "%";
    await saveProgress("shadowing", score, currentShadowing);
    shadowingText.style.display = "block";
    shadowingText.textContent = "Texto objetivo: " + currentShadowing;
  } catch (e) {
    shadowingFeedback.textContent = "Error: " + e.message;
  }
};

checkHealth();
setInterval(checkHealth, 15000);
const progressBtn = document.getElementById("progressBtn");
const progressSummary = document.getElementById("progressSummary");

async function saveProgress(mode, score, detail) {
  if (isGroqMode()) {
    groqSaveProgress(mode, score, detail);
    return;
  }
  try {
    const form = new FormData();
    form.append("session_id", "default");
    form.append("mode", mode);
    form.append("score", score);
    form.append("detail", detail);
    await fetch(BACKEND + "/progress", { method: "POST", body: form });
  } catch (e) { console.warn("progress save error", e); }
}

async function showProgress() {
  try {
    let d;
    if (isGroqMode()) {
      d = groqProgressSummary();
    } else {
      const r = await fetch(BACKEND + "/progress_summary?session_id=default");
      d = await safeJson(r);
    }
    const canvas = document.getElementById("progressChart");
    const ctx = canvas.getContext("2d");
    canvas.style.display = "block";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const modes = Object.keys(d.by_mode || {});
    if (!modes.length) {
      progressSummary.textContent = "Sin datos aún. Completa ejercicios para ver tu progreso.";
      canvas.style.display = "none";
      document.getElementById("progressLine").style.display = "none";
      return;
    }
    const vals = modes.map(m => d.by_mode[m]);
    const barW = Math.max(20, (canvas.width - 40) / modes.length - 8);
    const maxH = canvas.height - 40;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px system-ui";
    ctx.textAlign = "center";
    modes.forEach((m, i) => {
      const x = 20 + i * (barW + 8);
      const h = (vals[i] / 100) * maxH;
      const y = canvas.height - 20 - h;
      const grad = ctx.createLinearGradient(x, y, x, canvas.height - 20);
      grad.addColorStop(0, "#60a5fa");
      grad.addColorStop(1, "#2563eb");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, h);
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText(m.slice(0,8), x + barW/2, canvas.height - 6);
      ctx.fillText(vals[i] + "%", x + barW/2, y - 4);
    });
    ctx.strokeStyle = "#374151";
    ctx.beginPath();
    ctx.moveTo(10, canvas.height - 20);
    ctx.lineTo(canvas.width - 10, canvas.height - 20);
    ctx.stroke();

    // Line chart: evolution over time, one color per mode
    const lineCanvas = document.getElementById("progressLine");
    const lctx = lineCanvas.getContext("2d");
    lineCanvas.style.display = "block";
    lctx.clearRect(0, 0, lineCanvas.width, lineCanvas.height);
    const recent = (d.recent || []).slice().reverse();
    if (recent.length >= 2) {
      const pad = 28;
      const w = lineCanvas.width - pad * 2;
      const h = lineCanvas.height - pad * 2 - 12;
      // axis
      lctx.strokeStyle = "#374151";
      lctx.beginPath();
      lctx.moveTo(pad, pad);
      lctx.lineTo(pad, lineCanvas.height - pad);
      lctx.lineTo(lineCanvas.width - pad, lineCanvas.height - pad);
      lctx.stroke();
      // y labels
      lctx.fillStyle = "#94a3b8";
      lctx.font = "9px system-ui";
      lctx.textAlign = "right";
      for (let v = 0; v <= 100; v += 25) {
        const y = lineCanvas.height - pad - (v/100)*h;
        lctx.fillText(v + "%", pad - 4, y + 3);
      }
      const colors = { "dictation": "#60a5fa", "shadowing": "#34d399", "exercise": "#f472b6", "fillblank": "#fbbf24", "conversation": "#a78bfa" };
      const colorFor = m => colors[m] || "#cbd5e1";
      const modes = [...new Set(recent.map(x => x.mode))];
      // map points
      const pts = recent.map((x, i) => ({
        x: pad + (i / (recent.length - 1)) * w,
        y: lineCanvas.height - pad - (x.score / 100) * h,
        score: x.score,
        mode: x.mode,
        date: x.date
      }));
      // draw one line per mode, connecting its own points in order
      modes.forEach(mode => {
        const mpts = pts.filter(p => p.mode === mode);
        if (mpts.length < 1) return;
        lctx.strokeStyle = colorFor(mode);
        lctx.lineWidth = 2;
        lctx.beginPath();
        mpts.forEach((p, i) => { if (i === 0) lctx.moveTo(p.x, p.y); else lctx.lineTo(p.x, p.y); });
        lctx.stroke();
        lctx.lineWidth = 1;
        mpts.forEach(p => {
          lctx.fillStyle = colorFor(mode);
          lctx.beginPath();
          lctx.arc(p.x, p.y, 3, 0, Math.PI*2);
          lctx.fill();
        });
      });
      // title
      lctx.fillStyle = "#a78bfa";
      lctx.font = "10px system-ui";
      lctx.textAlign = "left";
      lctx.fillText("Evolución de puntuaciones", pad, 14);
      // legend
      let lx = pad;
      const ly = lineCanvas.height - 10;
      lctx.font = "9px system-ui";
      modes.forEach(mode => {
        lctx.fillStyle = colorFor(mode);
        lctx.fillRect(lx, ly - 8, 10, 6);
        lctx.fillStyle = "#cbd5e1";
        lctx.textAlign = "left";
        lctx.fillText(mode, lx + 12, ly - 3);
        lx += 60;
      });
    } else {
      lineCanvas.style.display = "none";
    }

    let txt = `Total intentos: ${d.total}  |  Promedio: ${d.average}%\n`;
    if (d.recent && d.recent.length) {
      txt += "\nÚltimos:\n";
      d.recent.slice(0,6).forEach(x => { txt += `  - ${x.mode}: ${x.score}% (${x.date.slice(0,10)})\n`; });
    }
    progressSummary.textContent = txt;
  } catch (e) {
    progressSummary.textContent = "Error: " + e.message;
  }
}

progressBtn.onclick = showProgress;

// Save progress in dictation
const _origCheckDictation = checkDictation;
checkDictation = async function() {
  await _origCheckDictation();
  if (!currentDictation) return;
  const user = dictationInput.value.trim();
  const a = currentDictation.toLowerCase().replace(/[.,!?]/g, "").trim();
  const b = user.toLowerCase().replace(/[.,!?]/g, "").trim();
  const score = (a === b) ? 100 : 0;
  await saveProgress("dictation", score, currentDictation);
};

// Save progress in shadowing: hook into stop handler by wrapping fetch? Instead save after feedback.
const _origShadowStop = shadowStopBtn.onclick;
shadowStopBtn.onclick = async function() {
  await _origShadowStop();
  // score already displayed; recompute not needed; save last score from feedback? We'll save 0 placeholder? Better: parse not needed; call progress save inside original? We'll instead save before return? 
};
const personalizedBtn = document.getElementById("personalizedBtn");
personalizedBtn.onclick = async () => {
  exerciseFeedback.textContent = "Generando práctica personalizada (cargando modelo)...";
  exerciseText.style.display = "none";
  exerciseText.textContent = "";
  try {
    let d;
    if (isGroqMode()) {
      d = await groqPersonalized(getLevel(), getTopic());
    } else {
      const form = new FormData();
      form.append("level", getLevel());
      form.append("topic", getTopic());
      const r = await fetch(BACKEND + "/personalized", { method: "POST", body: form });
      d = await safeJson(r);
    }
    currentExercise = { text: d.text, question: d.question };
    const audioOnly = document.getElementById("audioOnly").checked;
    if (audioOnly) {
      exerciseQuestion.textContent = "Pregunta (audio): escucha y responde.";
      await speak(d.question);
    } else {
      exerciseQuestion.textContent = "Pregunta: " + d.question;
    }
    await speak(d.text);
    replayExerciseBtn.disabled = false;
  } catch (e) {
    exerciseQuestion.textContent = "Error: " + e.message;
  }
};
let currentFillblankAnswer = null;
const fillblankBtn = document.getElementById("fillblankBtn");
const fillblankSentence = document.getElementById("fillblankSentence");
const fillblankInput = document.getElementById("fillblankInput");
const checkFillblankBtn = document.getElementById("checkFillblankBtn");
const fillblankFeedback = document.getElementById("fillblankFeedback");
fillblankInput.addEventListener("keydown", e => { if (e.key === "Enter") checkFillblank(); });

async function newFillblank() {
  fillblankFeedback.textContent = "Generando ejercicio (cargando modelo)...";
  fillblankInput.value = "";
  try {
    let d;
    if (isGroqMode()) {
      d = await groqFillblank(getLevel(), getTopic());
    } else {
      const form = new FormData();
      form.append("level", getLevel());
      form.append("topic", getTopic());
      const r = await fetch(BACKEND + "/fillblank", { method: "POST", body: form });
      d = await safeJson(r);
    }
    currentFillblankAnswer = d.answer;
    fillblankSentence.textContent = d.sentence;
  } catch (e) {
    fillblankSentence.textContent = "Error: " + e.message;
  }
}

function checkFillblank() {
  if (!currentFillblankAnswer) return;
  const user = fillblankInput.value.trim().toLowerCase();
  const ans = currentFillblankAnswer.toLowerCase();
  if (user === ans) {
    fillblankFeedback.textContent = "Correcto.";
  } else {
    fillblankFeedback.textContent = "Incorrecto. Respuesta: " + currentFillblankAnswer;
  }
}

fillblankBtn.onclick = newFillblank;
checkFillblankBtn.onclick = checkFillblank;
const browserSttBtn = document.getElementById("browserSttBtn");
browserSttBtn.onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert("Tu navegador no soporta reconocimiento de voz.");
    return;
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  browserSttBtn.disabled = true;
  browserSttBtn.textContent = "Escuchando...";
  rec.onresult = e => {
    const text = e.results[0][0].transcript;
    browserSttBtn.disabled = false;
    browserSttBtn.textContent = "🗣️ Reconocimiento del navegador";
    if (text) sendText(text);
    else addMsg("assistant", "(No se detectó voz)");
  };
  rec.onerror = e => {
    browserSttBtn.disabled = false;
    browserSttBtn.textContent = "🗣️ Reconocimiento del navegador";
    addMsg("assistant", "Error de reconocimiento: " + e.error);
  };
  rec.onend = () => {
    browserSttBtn.disabled = false;
    browserSttBtn.textContent = "🗣️ Reconocimiento del navegador";
  };
  rec.start();
};
const replayDictationBtn = document.getElementById("replayDictationBtn");
replayDictationBtn.onclick = () => {
  if (currentDictation) speak(currentDictation);
};

// Enable replay button after new dictation
const _origNewDictation2 = newDictation;
newDictation = async function() {
  await _origNewDictation2();
  replayDictationBtn.disabled = false;
};
const replayExerciseBtn = document.getElementById("replayExerciseBtn");
replayExerciseBtn.onclick = () => {
  if (currentExercise) speak(currentExercise.text);
};

const replayShadowingBtn = document.getElementById("replayShadowingBtn");
replayShadowingBtn.onclick = () => {
  if (currentShadowing) speak(currentShadowing);
};

// Enable replay buttons after generating
const _origNewExercise3 = newExercise;
newExercise = async function() {
  await _origNewExercise3();
  replayExerciseBtn.disabled = false;
};

const _origNewShadowing3 = newShadowing;
newShadowing = async function() {
  await _origNewShadowing3();
  replayShadowingBtn.disabled = false;
};

// Rebind buttons to wrapped functions
exerciseBtn.onclick = newExercise;
dictationBtn.onclick = newDictation;
shadowingBtn.onclick = newShadowing;

if (retryBtn) {
  retryBtn.onclick = () => {
    retryBtn.style.display = "none";
    statusEl.textContent = "Reintentando...";
    checkHealth();
  };
}


// Register PWA service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js?v=7").catch(err => console.warn("SW register failed", err));
  });
}


// Server selector (local vs cloud)
const serverSelect = document.getElementById("serverSelect");
const cloudUrl = document.getElementById("cloudUrl");
const applyServerBtn = document.getElementById("applyServerBtn");

// Restore saved selection
const savedBackend = localStorage.getItem("backend_url") || "";
if (savedBackend === "") {
  serverSelect.value = "";
} else if (savedBackend === "http://192.168.1.7:8000") {
  serverSelect.value = "http://192.168.1.7:8000";
} else if (savedBackend === "groq") {
  serverSelect.value = "groq";
  groqKey.style.display = "inline-block";
  groqKey.value = localStorage.getItem("groq_api_key") || "";
  applyServerBtn.style.display = "inline-block";
} else {
  serverSelect.value = "cloud";
  cloudUrl.style.display = "inline-block";
  cloudUrl.value = savedBackend;
  applyServerBtn.style.display = "inline-block";
}

serverSelect.addEventListener("change", () => {
  cloudUrl.style.display = "none";
  groqKey.style.display = "none";
  applyServerBtn.style.display = "none";
  if (serverSelect.value === "cloud") {
    cloudUrl.style.display = "inline-block";
    applyServerBtn.style.display = "inline-block";
    cloudUrl.focus();
  } else if (serverSelect.value === "groq") {
    groqKey.style.display = "inline-block";
    applyServerBtn.style.display = "inline-block";
    groqKey.focus();
  } else {
    BACKEND = serverSelect.value;
    localStorage.setItem("backend_url", BACKEND);
    checkHealth();
  }
});

applyServerBtn.addEventListener("click", () => {
  if (serverSelect.value === "cloud") {
    const url = cloudUrl.value.trim().replace(/\/$/, "");
    if (!url) return;
    BACKEND = url;
    localStorage.setItem("backend_url", BACKEND);
    checkHealth();
  } else if (serverSelect.value === "groq") {
    const key = groqKey.value.trim();
    if (!key) return;
    localStorage.setItem("groq_api_key", key);
    BACKEND = "groq";
    localStorage.setItem("backend_url", "groq");
    checkHealth();
  }
});
