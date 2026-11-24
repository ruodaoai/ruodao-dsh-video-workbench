#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DSH Video Workbench - Local TTS Python Worker Bridge
Adapts proven synthesis patterns from local `_r27_voice/voice/workers/indextts_worker.py`
and `gsv_worker.py` with ASCII temporary staging for Windows 11 compatibility.
Zero hardcoded paths: all engine directories are passed via CLI arguments or env vars.
"""

import argparse
import json
import math
import os
import shutil
import struct
import sys
import tempfile
import traceback
import urllib.error
import urllib.request
import wave

# Ensure UTF-8 stdio on Windows Chinese locale so JSON errors never turn into GBK mojibake
for _stream in (sys.stdout, sys.stderr):
    try:
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def stage_ascii_path(src_path: str, prefix: str = "ref", max_seconds: float = 9.0) -> str:
    """
    Copy a file with non-ASCII characters (e.g. Chinese folder/file names)
    to an ASCII temporary path. If it is a WAV file longer than `max_seconds`
    (such as 14MB~18MB audiobook samples), automatically slice an 8-second window
    so IndexTTS-2 and GPT-SoVITS never overflow VRAM.
    """
    if not src_path or not os.path.exists(src_path):
        return ""
    ext = os.path.splitext(src_path)[1].lower() or ".wav"
    fd, tmp_path = tempfile.mkstemp(prefix=f"dsh_{prefix}_", suffix=ext)
    os.close(fd)

    if ext == ".wav" and max_seconds > 0:
        try:
            with wave.open(src_path, "rb") as rf:
                nchannels = rf.getnchannels()
                sampwidth = rf.getsampwidth()
                framerate = rf.getframerate()
                nframes = rf.getnframes()
                duration = nframes / float(framerate) if framerate > 0 else 0
                if duration > max_seconds + 1.0:
                    start_frame = min(int(0.4 * framerate), max(0, nframes - int(max_seconds * framerate)))
                    rf.setpos(start_frame)
                    frames_to_read = int(max_seconds * framerate)
                    raw_frames = rf.readframes(frames_to_read)
                    with wave.open(tmp_path, "wb") as wf:
                        wf.setnchannels(nchannels)
                        wf.setsampwidth(sampwidth)
                        wf.setframerate(framerate)
                        wf.writeframes(raw_frames)
                    return tmp_path
        except Exception:
            pass

    shutil.copy2(src_path, tmp_path)
    return tmp_path


def generate_fallback_speech_like_wav(output_path: str, text: str, emotion: str = "平静", voice_id: str = "default"):
    """
    Deterministic multi-harmonic speech-envelope WAV synthesizer used ONLY when
    local GPU/HTTP TTS engine is offline or requested in `--mode fallback`.
    Produces a clean 24kHz 16-bit mono WAV whose exact duration reflects syllable cadence.
    """
    clean = "".join(ch for ch in (text or "") if not ch.isspace())
    char_count = max(4, len(clean))
    # Natural Chinese speaking rate ~ 4.2 chars/sec + pause padding
    punct_pauses = sum(0.22 for ch in (text or "") if ch in "，。！？；、,.!?;:")
    duration_sec = round(max(1.6, min(25.0, char_count / 4.2 + punct_pauses + 0.35)), 3)

    sample_rate = 24000
    total_samples = int(duration_sec * sample_rate)

    # Pitch base varies by voice_id & emotion
    is_female = any(k in (voice_id or "").lower() for k in ("female", "suyao", "anchor", "f", "女"))
    base_f0 = 215.0 if is_female else 125.0
    if emotion in ("高兴", "激昂"):
        base_f0 *= 1.12
    elif emotion in ("伤心", "深沉"):
        base_f0 *= 0.90

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    syllables = max(3, min(40, char_count))
    syl_len = total_samples / syllables

    buf = bytearray(total_samples * 2)
    two_pi = 2.0 * math.pi
    for i in range(total_samples):
        t = i / sample_rate
        syl_pos = (i % syl_len) / syl_len
        # Syllable amplitude envelope (attack-sustain-decay with natural pauses)
        if syl_pos < 0.12:
            env = syl_pos / 0.12
        elif syl_pos < 0.78:
            env = 1.0 - 0.15 * ((syl_pos - 0.12) / 0.66)
        elif syl_pos < 0.90:
            env = 0.85 * (1.0 - (syl_pos - 0.78) / 0.12)
        else:
            env = 0.02

        # Prosody pitch contour
        f0 = base_f0 * (1.0 + 0.08 * math.sin(two_pi * 2.2 * t) - 0.06 * (i / total_samples))
        phase = two_pi * f0 * t
        sig = (
            0.55 * math.sin(phase)
            + 0.25 * math.sin(2.0 * phase + 0.3)
            + 0.12 * math.sin(3.0 * phase + 0.7)
            + 0.06 * math.sin(4.0 * phase)
        )
        sample = int(max(-32767, min(32767, sig * env * 11500)))
        struct.pack_into("<h", buf, i * 2, sample)

    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(buf))

    return {
        "ok": True,
        "provider": "acoustic-cadence-synth",
        "outputPath": os.path.abspath(output_path),
    }


def try_http_tts(endpoint: str, payload: dict, output_path: str, timeout: float = 15.0, engine: str = "indextts25", error_bucket: list = None) -> bool:
    """Attempt HTTP synthesis against IndexTTS-2.5/2 server (scripts/tts-server.py) or GPT-SoVITS api_v2/api_v1."""
    if not endpoint:
        return False
    url = endpoint.rstrip("/")
    # Never route localhost TTS traffic through a system HTTP proxy
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    candidates = []
    if engine == "gptvoice":
        gsv_v2 = {
            "text": payload.get("text", ""),
            "text_lang": (payload.get("text_lang") or payload.get("lang") or "zh").lower(),
            "ref_audio_path": payload.get("ref_audio_path") or payload.get("spk_audio_prompt") or "",
            "prompt_text": payload.get("prompt_text") or "",
            "prompt_lang": (payload.get("prompt_lang") or payload.get("lang") or "zh").lower(),
            "text_split_method": payload.get("text_split_method") or "cut5",
            "media_type": "wav",
            "streaming_mode": False,
            "speed_factor": float(payload.get("speed_factor") or payload.get("duration_factor") or 1.0),
        }
        gsv_v1 = {
            "text": payload.get("text", ""),
            "text_language": (payload.get("text_lang") or "zh").lower(),
            "refer_wav_path": payload.get("ref_audio_path") or "",
            "prompt_text": payload.get("prompt_text") or "",
            "prompt_language": (payload.get("prompt_lang") or "zh").lower(),
        }
        candidates = [
            ("POST", "/tts", gsv_v2),
            ("POST", "/api/tts", payload),
            ("POST", "/", gsv_v1),
        ]
    else:
        candidates = [
            ("POST", "/tts", payload),
            ("POST", "/api/tts", payload),
        ]

    for method, path_suffix, body_obj in candidates:
        try:
            req_data = json.dumps(body_obj).encode("utf-8")
            req = urllib.request.Request(
                url + path_suffix,
                data=req_data,
                headers={"Content-Type": "application/json"},
                method=method,
            )
            with opener.open(req, timeout=timeout) as resp:
                body = resp.read()
                ctype = (resp.headers.get("Content-Type") or "").lower()
                if "audio" in ctype or body[:4] == b"RIFF" or body[:4] == b"OggS" or body[:3] == b"ID3":
                    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
                    with open(output_path, "wb") as f:
                        f.write(body)
                    return True
                if body[:1] == b"{":
                    parsed = json.loads(body.decode("utf-8", errors="ignore"))
                    audio_path = parsed.get("output_path") or parsed.get("audio_path") or parsed.get("path")
                    if audio_path and os.path.exists(audio_path):
                        if os.path.abspath(audio_path) != os.path.abspath(output_path):
                            os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
                            shutil.copy2(audio_path, output_path)
                        return True
                    if parsed.get("ok") is False:
                        err_msg = str(parsed.get("error") or "unknown error")
                        if error_bucket is not None:
                            error_bucket.append(err_msg)
                        sys.stderr.write(f"[tts-bridge] server error: {err_msg}\n")
        except urllib.error.HTTPError as he:
            try:
                raw_err = he.read().decode("utf-8", errors="replace")
                parsed_err = json.loads(raw_err) if raw_err.strip().startswith("{") else {}
                detail = parsed_err.get("error") or parsed_err.get("message") or raw_err.strip() or f"HTTP {he.code}"
            except Exception:
                detail = f"HTTP {he.code}"
            if he.code != 404 and error_bucket is not None:
                error_bucket.append(f"{path_suffix} -> {detail}")
            sys.stderr.write(f"[tts-bridge] HTTP {he.code} on {path_suffix}: {detail}\n")
            continue
        except Exception as exc:
            if error_bucket is not None:
                error_bucket.append(str(exc))
            continue
    return False


def run_indextts_direct(indextts_root: str, ref_audio: str, emo_audio: str, text: str, emotion: str, output_path: str, lang: str = "", duration_factor: float = 1.0):
    """Invoke IndexTTS-2.5 (`indextts.infer_v2_5`) or legacy IndexTTS-2 (`cy_app`) directly."""
    if not indextts_root or not os.path.isdir(indextts_root):
        raise RuntimeError(f"INDEXTTS_ROOT not found: {indextts_root}")

    orig_cwd = os.getcwd()
    staged_ref = ""
    staged_emo = ""
    fd, staged_out = tempfile.mkstemp(prefix="dsh_idx_out_", suffix=".wav")
    os.close(fd)

    try:
        os.chdir(indextts_root)
        if indextts_root not in sys.path:
            sys.path.insert(0, indextts_root)

        staged_ref = stage_ascii_path(ref_audio, "spk") if ref_audio else ""
        staged_emo = stage_ascii_path(emo_audio, "emo") if emo_audio else ""

        infer_v25 = os.path.join(indextts_root, "indextts", "infer_v2_5.py")
        cfg_yaml = os.path.join(indextts_root, "checkpoints", "config.yaml")
        if os.path.isfile(infer_v25) and os.path.isfile(cfg_yaml):
            from indextts.infer_v2_5 import IndexTTS2  # type: ignore

            want_qwen_emo = os.path.isdir(os.path.join(indextts_root, "checkpoints", "qwen0.6bemo4-merge"))
            tts = IndexTTS2(
                cfg_path=cfg_yaml,
                model_dir=os.path.join(indextts_root, "checkpoints"),
                use_bf16=True,
                use_qwen_emo=want_qwen_emo,
            )
            infer_kwargs = {
                "spk_audio_prompt": staged_ref or ref_audio,
                "text": text,
                "output_path": staged_out,
                "lang": (lang or "ZH").upper(),
                "duration_factor": max(0.5, min(2.0, float(duration_factor or 1.0))),
                "verbose": False,
            }
            if staged_emo and os.path.exists(staged_emo):
                infer_kwargs["emo_audio_prompt"] = staged_emo
                infer_kwargs["emo_alpha"] = 0.75
            elif emotion and emotion != "平静" and want_qwen_emo:
                infer_kwargs["use_emo_text"] = True
                infer_kwargs["emo_text"] = emotion
                infer_kwargs["emo_alpha"] = 0.85
            tts.infer(**infer_kwargs)
            provider_name = "indextts25-direct"
        else:
            import cy_app  # type: ignore

            tts = getattr(cy_app, "tts", None)
            if tts is None:
                raise RuntimeError("cy_app.tts instance not available")

            infer_kwargs = {
                "spk_audio_prompt": staged_ref or ref_audio,
                "text": text,
                "output_path": staged_out,
                "verbose": False,
            }
            if staged_emo and os.path.exists(staged_emo):
                infer_kwargs["emo_audio_prompt"] = staged_emo
                infer_kwargs["emo_alpha"] = 0.75
            elif emotion and emotion != "平静":
                infer_kwargs["use_emo_text"] = True
                infer_kwargs["emo_text"] = emotion
            tts.infer(**infer_kwargs)
            provider_name = "indextts2-cy_app"

        if not os.path.exists(staged_out) or os.path.getsize(staged_out) < 100:
            raise RuntimeError("IndexTTS infer did not produce a valid WAV file")

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        shutil.move(staged_out, output_path)
        return {"ok": True, "provider": provider_name, "outputPath": os.path.abspath(output_path)}
    finally:
        os.chdir(orig_cwd)
        for p in (staged_ref, staged_emo, staged_out):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


def main():
    parser = argparse.ArgumentParser(description="DSH Video Workbench Local TTS Worker Bridge")
    parser.add_argument("--engine", default="indextts25")
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--emotion", default="平静")
    parser.add_argument("--lang", default="")
    parser.add_argument("--duration-factor", default="1.0")
    parser.add_argument("--speed", default="")
    parser.add_argument("--voice-id", default="auto")
    parser.add_argument("--ref-audio", default="")
    parser.add_argument("--emo-audio", default="")
    parser.add_argument("--prompt-text", default="")
    parser.add_argument("--endpoint", default="")
    parser.add_argument("--engine-root", default="")
    parser.add_argument("--allow-direct-python", action="store_true")
    parser.add_argument("--allow-placeholder", action="store_true")
    parser.add_argument("--fallback-ref", default="")
    parser.add_argument("--http-timeout", default="300")
    args = parser.parse_args()

    out_abs = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)

    if args.engine == "fallback":
        res = generate_fallback_speech_like_wav(out_abs, args.text, args.emotion, args.voice_id)
        print(json.dumps(res, ensure_ascii=False))
        return

    # Stage reference and emotion audio to ASCII temp path (slicing >9s WAVs down to 8s golden window)
    staged_ref = stage_ascii_path(args.ref_audio, "spk") if args.ref_audio else ""
    staged_emo = stage_ascii_path(args.emo_audio, "emo") if args.emo_audio else ""

    try:
        dur_factor = max(0.65, min(1.5, float(args.duration_factor or 1.0)))
        spd_factor = max(0.65, min(1.5, float(args.speed))) if str(args.speed or "").strip() else round(1.0 / dur_factor, 3)

        # 1. Try HTTP endpoint first (non-blocking fast path if IndexTTS-2.5 / GPT-SoVITS server is running)
        http_errors = []
        if args.endpoint:
            payload = {
                "text": args.text,
                "text_lang": (args.lang or "zh").lower(),
                "lang": args.lang or "",
                "duration_factor": dur_factor,
                "speed_factor": spd_factor,
                "ref_audio_path": staged_ref or args.ref_audio,
                "prompt_text": args.prompt_text,
                "prompt_lang": (args.lang or "zh").lower(),
                "emotion": args.emotion,
                "spk_audio_prompt": staged_ref or args.ref_audio,
                "emo_audio_prompt": staged_emo or args.emo_audio,
                "fallback_ref": args.fallback_ref,
                "output_path": out_abs,
            }
            if try_http_tts(args.endpoint, payload, out_abs, timeout=float(args.http_timeout), engine=args.engine, error_bucket=http_errors):
                print(json.dumps({
                    "ok": True,
                    "provider": f"{args.engine}-http",
                    "outputPath": out_abs,
                }, ensure_ascii=False))
                return

        # 2. Optional heavy direct Python inference if explicitly requested
        if args.allow_direct_python and args.engine in ("indextts25", "indextts2", "auto") and args.engine_root:
            try:
                res = run_indextts_direct(
                    args.engine_root,
                    staged_ref or args.ref_audio,
                    staged_emo or args.emo_audio,
                    args.text,
                    args.emotion,
                    out_abs,
                    args.lang,
                    float(args.duration_factor or 1.0),
                )
                print(json.dumps(res, ensure_ascii=False))
                return
            except Exception as exc:
                sys.stderr.write(f"[tts-bridge] direct inference skipped: {exc}\n")

        # 3. Placeholder tone WAV is ONLY allowed when explicitly requested (CI / offline pipeline tests).
        #    It is NOT speech, so it must never silently end up in a real video.
        if args.allow_placeholder:
            res = generate_fallback_speech_like_wav(out_abs, args.text, args.emotion, args.voice_id)
            res["note"] = "PLACEHOLDER tone (not real speech): local TTS engine unavailable."
            res["placeholder"] = True
            print(json.dumps(res, ensure_ascii=False))
            return
        detail_suffix = f" [底层详情: {http_errors[0]}]" if http_errors else ""
        if args.engine == "gptvoice":
            raise RuntimeError(
                f"GPT-SoVITS 服务未连接或合成失败 ({args.endpoint or 'http://127.0.0.1:9881'}){detail_suffix}：请确认已启动 GPT-SoVITS api_v2.py 且存在有效参考音频，或点击「一键安装配音模型 / 切换 Windows 原生语音」。"
            )
        raise RuntimeError(
            f"本地 TTS 引擎合成失败{detail_suffix}（请确认 IndexTTS-2.5 常驻服务已就绪且 voices/ 目录含参考音色 WAV，或直接切换 Windows 原生语音 / GPT-SoVITS / 一键安装依赖包）。"
        )
    finally:
        for p in (staged_ref, staged_emo):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))
        sys.exit(1)
