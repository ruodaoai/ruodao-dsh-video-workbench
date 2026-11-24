#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DSH Video Workbench - Persistent IndexTTS-2.5 / IndexTTS-2 HTTP Server
Loads IndexTTS-2.5 (`indextts.infer_v2_5.IndexTTS2`) first when available under INDEXTTS_ROOT,
and cleanly falls back to legacy compiled IndexTTS-2 (`cy_app.tts`) if pointing to a v2 directory.

Usage:  python tts-server.py --root <INDEXTTS_ROOT> --port 9880
Endpoints:
  GET  /health          -> {"ok": true, "engine": "indextts25" | "indextts2", "version": "2.5" | "2.0", "ready": bool}
  POST /tts  (JSON)     -> writes WAV to `output_path`, returns {"ok": true, "output_path": ...}
Zero hardcoded paths: everything comes from CLI args / env.
"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

for _stream in (sys.stdout, sys.stderr):
    try:
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def find_fallback_speaker_wav(root: str) -> str:
    if not root or not os.path.isdir(root):
        return ""
    for sub in ("voices", "examples", "prompts", "reference_audio", "assets"):
        cand_dir = os.path.join(root, sub)
        if not os.path.isdir(cand_dir):
            continue
        for dirpath, _, filenames in os.walk(cand_dir):
            for fn in sorted(filenames):
                if fn.lower().endswith((".wav", ".mp3", ".flac")):
                    p = os.path.join(dirpath, fn)
                    if os.path.getsize(p) >= 2048:
                        return p
    return ""

STATE = {
    "ready": False,
    "error": "",
    "tts": None,
    "engine": "indextts25",
    "version": "2.5",
    "use_qwen_emo": False,
    "loaded_sec": 0.0,
    "root": "",
}
LOCK = threading.Lock()


def detect_lang_code(text: str, explicit: str = "") -> str:
    if explicit and explicit.upper() in ("ZH", "EN", "JA", "ES", "AR"):
        return explicit.upper()
    if re.search(r"[\u3040-\u30ff]", text or ""):
        return "JA"
    if re.search(r"[\u0600-\u06ff]", text or ""):
        return "AR"
    if re.search(r"[\u4e00-\u9fff]", text or ""):
        return "ZH"
    return "EN"


def load_engine(root):
    t0 = time.time()
    try:
        os.chdir(root)
        if root not in sys.path:
            sys.path.insert(0, root)
        os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

        infer_v25 = os.path.join(root, "indextts", "infer_v2_5.py")
        cfg_yaml = os.path.join(root, "checkpoints", "config.yaml")
        ckpt_dir = os.path.join(root, "checkpoints")

        if os.path.isfile(infer_v25) and os.path.isfile(cfg_yaml):
            from indextts.infer_v2_5 import IndexTTS2  # type: ignore

            want_qwen_emo = os.environ.get("INDEXTTS_QWEN_EMO", "1") == "1" and os.path.isdir(
                os.path.join(ckpt_dir, "qwen0.6bemo4-merge")
            )
            tts = IndexTTS2(
                cfg_path=cfg_yaml,
                model_dir=ckpt_dir,
                use_bf16=True,
                use_qwen_emo=want_qwen_emo,
            )
            STATE["tts"] = tts
            STATE["engine"] = "indextts25"
            STATE["version"] = "2.5"
            STATE["use_qwen_emo"] = bool(want_qwen_emo)
            STATE["ready"] = True
            STATE["loaded_sec"] = round(time.time() - t0, 1)
            print(
                f"[tts-server] IndexTTS-2.5 ready in {STATE['loaded_sec']}s (qwen_emo={want_qwen_emo})",
                flush=True,
            )
            return

        # Legacy IndexTTS-2 compiled engine fallback
        import cy_app  # type: ignore

        tts = getattr(cy_app, "tts", None)
        if tts is None:
            raise RuntimeError("Neither indextts.infer_v2_5 nor cy_app.tts found in INDEXTTS_ROOT")
        STATE["tts"] = tts
        STATE["engine"] = "indextts2"
        STATE["version"] = "2.0"
        STATE["use_qwen_emo"] = True
        STATE["ready"] = True
        STATE["loaded_sec"] = round(time.time() - t0, 1)
        print(f"[tts-server] IndexTTS-2 ready in {STATE['loaded_sec']}s", flush=True)
    except Exception as exc:  # noqa
        STATE["error"] = f"{exc}"
        traceback.print_exc()


EMOTION_PROMPT_MAP = {
    "高兴": "开心明快、热情饱满地分享介绍",
    "欢快热情": "开心明快、热情饱满、充满活力地分享",
    "开心": "开心明快、热情饱满地分享介绍",
    "兴奋": "兴奋惊喜、节奏明快地讲解亮点",
    "激昂": "充满激情与感染力、坚定自信地演讲号召",
    "激昂有力": "充满激情与感染力、铿锵有力地号召讲述",
    "热血": "热血激昂、铿锵有力地讲述",
    "温和": "温柔亲切、耐心细致、略带微笑地讲解",
    "温柔": "温柔亲切、舒缓自然地娓娓道来",
    "亲切": "亲切友好、自然微笑着清晰讲解",
    "自信": "专业自信、条理清晰、朝气饱满地阐述",
    "热情": "热情有感染力、明快饱满地讲述",
    "专业": "专业自信、条理清晰地阐述原理",
    "严肃": "严肃认真、稳重清晰地提醒注意事项",
    "严肃强调": "郑重严肃、吐字笃定地强调重点",
    "重点强调": "重心加重、惊喜笃定地强调关键结论",
    "期待": "满怀期待、生机勃勃地引出下文",
    "悬念": "悬念低沉、制造神秘紧张感地推进",
    "悬念低沉": "压低声线、富有悬念与张力地讲述",
    "伤心": "低沉感伤、真挚动情地诉说",
    "悲壮": "悲壮苍凉、厚重深沉地叹述",
    "深沉": "沉稳低沉、富有磁性和仪式感地讲述",
    "沧桑": "历经沧桑、厚重凝练地追忆讲述",
    "害怕": "紧张警惕、压低嗓音提醒风险",
}

# IndexTTS-2.5 8-dim emotion vector: [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]
EMOTION_VECTOR_MAP = {
    "高兴": [0.64, 0.0, 0.0, 0.0, 0.0, 0.0, 0.14, 0.0],
    "欢快热情": [0.68, 0.0, 0.0, 0.0, 0.0, 0.0, 0.12, 0.0],
    "开心": [0.64, 0.0, 0.0, 0.0, 0.0, 0.0, 0.14, 0.0],
    "兴奋": [0.48, 0.0, 0.0, 0.0, 0.0, 0.0, 0.30, 0.0],
    "激昂": [0.46, 0.14, 0.0, 0.0, 0.0, 0.0, 0.18, 0.0],
    "激昂有力": [0.46, 0.16, 0.0, 0.0, 0.0, 0.0, 0.18, 0.0],
    "热血": [0.42, 0.18, 0.0, 0.0, 0.0, 0.0, 0.18, 0.0],
    "重点强调": [0.28, 0.10, 0.0, 0.0, 0.0, 0.0, 0.28, 0.12],
    "自信": [0.34, 0.0, 0.0, 0.0, 0.0, 0.0, 0.12, 0.32],
    "热情": [0.54, 0.0, 0.0, 0.0, 0.0, 0.0, 0.12, 0.12],
    "专业": [0.26, 0.0, 0.0, 0.0, 0.0, 0.0, 0.08, 0.42],
    "温和": [0.26, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.48],
    "温柔": [0.24, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.50],
    "亲切": [0.36, 0.0, 0.0, 0.0, 0.0, 0.0, 0.06, 0.34],
    "期待": [0.42, 0.0, 0.0, 0.0, 0.0, 0.0, 0.22, 0.14],
    "严肃": [0.0, 0.16, 0.0, 0.0, 0.0, 0.10, 0.0, 0.48],
    "严肃强调": [0.0, 0.22, 0.0, 0.0, 0.0, 0.12, 0.0, 0.42],
    "悬念": [0.0, 0.0, 0.0, 0.22, 0.0, 0.28, 0.14, 0.14],
    "悬念低沉": [0.0, 0.0, 0.06, 0.20, 0.0, 0.34, 0.08, 0.10],
    "深沉": [0.0, 0.06, 0.14, 0.0, 0.0, 0.34, 0.0, 0.24],
    "沧桑": [0.0, 0.04, 0.18, 0.0, 0.0, 0.38, 0.0, 0.18],
    "伤心": [0.0, 0.0, 0.50, 0.0, 0.0, 0.28, 0.0, 0.0],
    "悲壮": [0.0, 0.12, 0.40, 0.0, 0.0, 0.26, 0.0, 0.0],
    "害怕": [0.0, 0.0, 0.0, 0.58, 0.0, 0.12, 0.08, 0.0],
    "生气": [0.0, 0.62, 0.0, 0.0, 0.10, 0.0, 0.06, 0.0],
}


def synthesize(payload):
    tts = STATE["tts"]
    text = (payload.get("text") or "").strip()
    out = payload.get("output_path") or ""
    spk = payload.get("spk_audio_prompt") or payload.get("ref_audio_path") or ""
    emo_audio = payload.get("emo_audio_prompt") or ""
    emotion = (payload.get("emotion") or "").strip()
    emo_vector = payload.get("emo_vector")
    if not text or not out:
        raise ValueError("text and output_path are required")
    if not spk or not os.path.exists(spk):
        fallback = payload.get("fallback_ref") or ""
        if fallback and os.path.exists(fallback):
            spk = fallback
        else:
            auto_ref = find_fallback_speaker_wav(STATE.get("root") or "")
            if auto_ref and os.path.exists(auto_ref):
                spk = auto_ref
            else:
                raise ValueError(f"speaker reference not found (voices/ 目录为空，请放入任意 5~10 秒人声 WAV 或重新试听自动生成默认参考音): {spk}")

    fd, tmp_out = tempfile.mkstemp(prefix="dsh_srv_", suffix=".wav")
    os.close(fd)
    kwargs = {
        "spk_audio_prompt": spk,
        "text": text,
        "output_path": tmp_out,
        "verbose": False,
    }
    if STATE["version"] == "2.5":
        kwargs["lang"] = detect_lang_code(text, payload.get("lang") or "")
        dur_factor = payload.get("duration_factor")
        if dur_factor is not None:
            kwargs["duration_factor"] = max(0.5, min(2.0, float(dur_factor)))

    emo_alpha = float(payload.get("emo_alpha", 0.85))
    if isinstance(emo_vector, list) and len(emo_vector) == 8:
        kwargs["emo_vector"] = [float(x) for x in emo_vector]
        kwargs["emo_alpha"] = emo_alpha
    elif emo_audio and os.path.exists(emo_audio):
        kwargs["emo_audio_prompt"] = emo_audio
        kwargs["emo_alpha"] = float(payload.get("emo_alpha", 0.7))
    elif emotion and emotion not in ("平静", "neutral"):
        if emotion in EMOTION_VECTOR_MAP and STATE["version"] == "2.5":
            kwargs["emo_vector"] = list(EMOTION_VECTOR_MAP[emotion])
            kwargs["emo_alpha"] = emo_alpha
        elif STATE["use_qwen_emo"]:
            kwargs["use_emo_text"] = True
            kwargs["emo_text"] = EMOTION_PROMPT_MAP.get(emotion, emotion)
            kwargs["emo_alpha"] = emo_alpha

    with LOCK:
        tts.infer(**kwargs)

    if not os.path.exists(tmp_out) or os.path.getsize(tmp_out) < 1000:
        raise RuntimeError(f"IndexTTS-{STATE['version']} produced no audio")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    shutil.move(tmp_out, out)
    return out


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json(200, {
                "ok": True,
                "engine": STATE["engine"],
                "version": STATE["version"],
                "ready": STATE["ready"],
                "error": STATE["error"],
                "loadedSec": STATE["loaded_sec"],
                "qwenEmo": STATE["use_qwen_emo"],
            })
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/tts"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        if not STATE["ready"]:
            self._json(503, {"ok": False, "error": STATE["error"] or "engine loading"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            t0 = time.time()
            out = synthesize(payload)
            self._json(
                200,
                {
                    "ok": True,
                    "engine": STATE["engine"],
                    "version": STATE["version"],
                    "output_path": out,
                    "elapsedSec": round(time.time() - t0, 2),
                },
            )
        except Exception as exc:  # noqa
            traceback.print_exc()
            self._json(500, {"ok": False, "error": str(exc)})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--port", type=int, default=9880)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    STATE["root"] = a.root
    try:
        os.makedirs(os.path.join(a.root, "voices"), exist_ok=True)
    except Exception:
        pass
    server = ThreadingHTTPServer((a.host, a.port), Handler)
    threading.Thread(target=load_engine, args=(a.root,), daemon=True).start()
    print(f"[tts-server] listening on http://{a.host}:{a.port} (loading IndexTTS-2.5...)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
