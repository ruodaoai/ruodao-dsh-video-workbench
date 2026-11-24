#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DSH Video Workbench - MuseTalk 1.5 lip-sync CLI wrapper (Windows friendly, no mmcv / mmpose).

It reuses MuseTalk's own UNet / VAE / Whisper / face-parsing / blending code from the official repo
(passed with --engine-root) and replaces the DWPose (mmpose, CUDA-compiled mmcv) landmark step with
face-alignment (FAN 68-point, pure PyTorch). The 68-point layout is the same iBUG layout DWPose
returns for its face keypoints, so MuseTalk's crop rule (nose-bridge point 29 -> chin) is unchanged.

Usage:
  python -I musetalk_infer.py --doctor --engine-root <MuseTalk>
  python -I musetalk_infer.py --engine-root <MuseTalk> --source <video|image> --audio <wav> --output <mp4> [options]

stdout carries one JSON object per line (everything else goes to stderr):
  {"event": "progress", "stage": "...", "pct": 0-100, "message": "..."}
  {"event": "result", "ok": true, ...metrics}
  {"event": "error", "ok": false, "code": "...", "message": "..."}
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import time
import traceback

# `python -I` ignores PYTHONUTF8 / PYTHONIOENCODING, so force UTF-8 explicitly (Windows defaults to the ANSI code page).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr  # third-party prints / tqdm never pollute the JSON channel

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")


def emit(obj):
    # ASCII-escaped JSON lines: robust against any console / pipe code page
    REAL_STDOUT.write(json.dumps(obj, ensure_ascii=True) + "\n")
    REAL_STDOUT.flush()


T_PROCESS_START = time.time()


def progress(stage, pct, message, **extra):
    payload = {"event": "progress", "stage": stage, "pct": round(float(pct), 1), "message": message, "t": round(time.time() - T_PROCESS_START, 2)}
    payload.update(extra)
    emit(payload)


class LipsyncError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def apply_env_defaults(engine_root):
    """Keep every cache next to the engine (never the system drive), even when launched by hand.
    Layout written by scripts/install-lipsync-engine.mjs: <base>/.cache, <base>/lipsync/{MuseTalk,torch-hub}."""
    if not engine_root:
        return
    home = os.path.dirname(os.path.abspath(engine_root))
    cache = os.path.join(os.path.dirname(home), ".cache")
    os.environ.setdefault("TORCH_HOME", os.path.join(home, "torch-hub"))
    os.environ.setdefault("HF_HOME", os.path.join(cache, "hf"))
    os.environ.setdefault("CUDA_CACHE_PATH", os.path.join(cache, "nv-compute"))
    os.environ.setdefault("CUDA_CACHE_MAXSIZE", "2147483648")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")


def find_ffprobe(ffmpeg):
    if ffmpeg and os.path.isabs(ffmpeg):
        cand = os.path.join(os.path.dirname(ffmpeg), "ffprobe.exe" if os.name == "nt" else "ffprobe")
        if os.path.exists(cand):
            return cand
    return shutil.which("ffprobe") or "ffprobe"


def probe_media(ffprobe, path):
    res = subprocess.run(
        [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if res.returncode != 0:
        raise LipsyncError("SOURCE_READ", "ffprobe failed: " + res.stderr.decode("utf-8", "replace")[-400:])
    data = json.loads(res.stdout.decode("utf-8", "replace") or "{}")
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    info = {"duration": float(data.get("format", {}).get("duration") or 0), "has_audio": a is not None}
    if v:
        w, h = int(v.get("width") or 0), int(v.get("height") or 0)
        rot = 0
        for sd in v.get("side_data_list", []) or []:
            if "rotation" in sd:
                rot = int(float(sd["rotation"]))
        if not rot and v.get("tags", {}).get("rotate"):
            rot = int(float(v["tags"]["rotate"]))
        if abs(rot) % 180 == 90:
            w, h = h, w
        info.update(width=w, height=h)
    return info


def even_dims(w, h, max_side):
    scale = min(1.0, float(max_side) / float(max(w, h)))
    return max(2, int(round(w * scale / 2.0)) * 2), max(2, int(round(h * scale / 2.0)) * 2)


def read_video_frames(ffmpeg, path, fps, width, height, max_frames):
    import numpy as np

    cmd = [
        ffmpeg, "-v", "error", "-i", path, "-an", "-sn",
        "-vf", "fps=%s,scale=%d:%d:flags=bicubic" % (fps, width, height),
        "-frames:v", str(int(max_frames)),
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frame_bytes = width * height * 3
    frames = []
    try:
        while len(frames) < max_frames:
            buf = proc.stdout.read(frame_bytes)
            if not buf or len(buf) < frame_bytes:
                break
            frames.append(np.frombuffer(buf, dtype=np.uint8).reshape(height, width, 3).copy())
    finally:
        try:
            proc.stdout.close()
        except Exception:
            pass
        proc.wait()
    return frames


def read_image(path, max_side):
    import cv2
    import numpy as np

    data = np.fromfile(path, dtype=np.uint8)  # unicode-safe on Windows
    img = cv2.imdecode(data, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise LipsyncError("SOURCE_READ", "cannot decode image: %s" % path)
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(np.float32) / 255.0
        img = (img[:, :, :3].astype(np.float32) * alpha + 255.0 * (1 - alpha)).astype(np.uint8)
    h, w = img.shape[:2]
    W, H = even_dims(w, h, max_side)
    if (W, H) != (w, h):
        img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA if W < w else cv2.INTER_CUBIC)
    return img


def motion_params(i, n, fps):
    """Gentle 'live camera' motion for still portraits. All terms have zero velocity at both ends of
    the base segment, so MuseTalk's ping-pong frame cycling never produces a visible bounce."""
    T = max(1.0, n / float(fps))
    t = i / float(fps)
    s1 = math.sin(math.pi * t / T) ** 2
    s2 = math.sin(2.0 * math.pi * t / T) ** 2
    zoom = 1.0 + 0.022 * s1
    dx = 0.006 * (s2 - 0.5)
    dy = -0.004 * s1
    ang = 0.5 * (s2 - 0.5)
    return zoom, dx, dy, ang


def synth_image_frames(img, n, fps):
    import cv2

    H, W = img.shape[:2]
    frames, mats = [], []
    for i in range(n):
        zoom, dx, dy, ang = motion_params(i, n, fps)
        M = cv2.getRotationMatrix2D((W / 2.0, H / 2.0), ang, zoom)
        M[0, 2] += dx * W
        M[1, 2] += dy * H
        frames.append(cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT101))
        mats.append(M)
    return frames, mats


def transform_box(box, M):
    import numpy as np

    x1, y1, x2, y2 = box
    pts = np.array([[x1, y1, 1.0], [x2, y1, 1.0], [x1, y2, 1.0], [x2, y2, 1.0]])
    tp = pts @ M.T
    return [float(tp[:, 0].min()), float(tp[:, 1].min()), float(tp[:, 0].max()), float(tp[:, 1].max())]


def musetalk_bbox(lm, det_box):
    """Exact MuseTalk v1.5 crop rule from musetalk/utils/preprocessing.py (bbox_shift = 0)."""
    import numpy as np

    lmi = lm.astype(np.int32)
    half_face_coord = lmi[29].copy()
    half_face_dist = int(np.max(lmi[:, 1])) - int(half_face_coord[1])
    upper_bond = max(0, int(half_face_coord[1]) - half_face_dist)
    x1, y1, x2, y2 = int(np.min(lmi[:, 0])), int(upper_bond), int(np.max(lmi[:, 0])), int(np.max(lmi[:, 1]))
    if y2 - y1 <= 0 or x2 - x1 <= 0 or x1 < 0:
        x1, y1, x2, y2 = [int(v) for v in det_box[:4]]
    return [float(x1), float(y1), float(x2), float(y2)]


def detect_landmarks(fa, frame_bgr, det_max_side=640):
    """S3FD face detection on a <= det_max_side copy (4x faster on 720p/1080p webcam frames),
    then FAN 68-point landmarks on the full-resolution frame around the largest face."""
    import cv2
    import numpy as np

    rgb = np.ascontiguousarray(frame_bgr[:, :, ::-1])
    h, w = rgb.shape[:2]
    s = min(1.0, float(det_max_side) / float(max(h, w)))
    small = cv2.resize(rgb, (max(1, int(round(w * s))), max(1, int(round(h * s)))), interpolation=cv2.INTER_AREA) if s < 1.0 else rgb
    dets = fa.face_detector.detect_from_image(small.copy())
    if dets is None or len(dets) == 0:
        return None, None
    best = max(dets, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
    det_full = np.array([best[0] / s, best[1] / s, best[2] / s, best[3] / s, best[4]], dtype=np.float32)
    lms = fa.get_landmarks_from_image(rgb, detected_faces=[det_full])
    if not lms:
        return None, None
    return lms[0], det_full


def make_no_autotune(torch):
    class NoAutotune(torch.nn.Module):
        """face-alignment's batch_detect() sets torch.backends.cudnn.benchmark = True on every call; cuDNN autotuning
        then spends seconds and multi-GB workspaces on every new shape. Re-disable it right before S3FD runs."""

        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, *a, **k):
            torch.backends.cudnn.benchmark = False
            return self.inner(*a, **k)

    return NoAutotune


def smooth_boxes(boxes, k):
    import numpy as np

    arr = np.array(boxes, dtype=np.float64)
    if k <= 1 or len(arr) < 3:
        return arr
    k = int(k) | 1
    pad = k // 2
    padded = np.pad(arr, ((pad, pad), (0, 0)), mode="edge")
    kernel = np.ones(k) / k
    return np.stack([np.convolve(padded[:, c], kernel, mode="valid") for c in range(4)], axis=1)


def finalize_boxes(arr, W, H, extra_margin):
    out = []
    for x1, y1, x2, y2 in arr:
        x1, y1, x2, y2 = int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))
        y2 = y2 + int(extra_margin)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(W, x2), min(H, y2)
        if x2 - x1 < 16 or y2 - y1 < 16:
            raise LipsyncError("BAD_FACE_BOX", "face box too small: %s" % ([x1, y1, x2, y2],))
        out.append([x1, y1, x2, y2])
    return out


def crop_pad(img, x0, y0, x1, y1):
    """PIL Image.crop() semantics on a numpy image: out-of-frame areas are zero (black)."""
    import numpy as np

    H, W = img.shape[:2]
    out = np.zeros((y1 - y0, x1 - x0) + img.shape[2:], dtype=img.dtype)
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    if sx1 > sx0 and sy1 > sy0:
        out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = img[sy0:sy1, sx0:sx1]
    return out


def blend_face(frame, face, face_box, mask, crop_box):
    """Numerically equivalent to MuseTalk's get_image_blending(): inside the crop box the pasted 'face_large' equals
    the frame everywhere except the face box, so only the face box needs the masked mix (same 8-bit maths)."""
    import numpy as np

    x, y, x1, y1 = face_box
    x_s, y_s = crop_box[0], crop_box[1]
    out = frame.copy()
    m = mask[y - y_s:y1 - y_s, x - x_s:x1 - x_s].astype(np.uint16)[:, :, None]
    region = out[y:y1, x:x1].astype(np.uint16)
    mixed = (face.astype(np.uint16) * m + region * (255 - m) + 127) // 255
    out[y:y1, x:x1] = mixed.astype(np.uint8)
    return out


def prepare_blend_masks(torch, fp, frames, boxes, mode, device, bs=8, upper_boundary_ratio=0.5, expand=1.5):
    """Batched, GPU-argmax equivalent of MuseTalk's get_image_prepare_material() + FaceParsing.__call__():
    identical crop / resize / normalisation / jaw-mode morphology / blur, but BiSeNet runs on batches and only
    the uint8 label map (not 19x512x512 float logits) is copied back to the CPU."""
    import cv2
    import numpy as np
    from PIL import Image

    from musetalk.utils.blending import get_crop_box

    mean = torch.tensor([0.485, 0.456, 0.406], device=device).view(1, 3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225], device=device).view(1, 3, 1, 1)
    out = [None] * len(frames)
    for b0 in range(0, len(frames), bs):
        idxs = list(range(b0, min(len(frames), b0 + bs)))
        larges, crop_boxes, inputs = [], [], []
        for i in idxs:
            crop_box, _s = get_crop_box(boxes[i], expand)
            face_large = Image.fromarray(np.ascontiguousarray(crop_pad(frames[i], *crop_box)[:, :, ::-1]))
            larges.append(face_large)
            crop_boxes.append(crop_box)
            inputs.append(np.asarray(face_large.resize((512, 512), Image.BILINEAR)))
        x = torch.from_numpy(np.stack(inputs)).to(device).permute(0, 3, 1, 2).float().div_(255.0)
        x = (x - mean) / std
        with torch.inference_mode():
            labels = fp.net(x)[0].argmax(1).to(torch.uint8).cpu().numpy()
        for k, i in enumerate(idxs):
            parsing = labels[k].copy()
            if mode == "neck":
                parsing[np.isin(parsing, [1, 11, 12, 13, 14])] = 255
                parsing[np.where(parsing != 255)] = 0
            elif mode == "jaw":
                face_region = (np.isin(parsing, [1]) * 255).astype(np.uint8)
                original_dilated = cv2.dilate(face_region, fp.kernel, iterations=1)
                eroded = cv2.erode(original_dilated, fp.cheek_kernel, iterations=2)
                face_region = cv2.bitwise_and(eroded, fp.cheek_mask)
                face_region = cv2.bitwise_or(face_region, cv2.bitwise_and(original_dilated, ~fp.cheek_mask))
                parsing[(face_region == 255) & (~np.isin(parsing, [10]))] = 255
                parsing[np.isin(parsing, [11, 12, 13])] = 255
                parsing[np.where(parsing != 255)] = 0
            else:
                parsing[np.isin(parsing, [1, 11, 12, 13])] = 255
                parsing[np.where(parsing != 255)] = 0
            face_large = larges[k]
            ori_shape = face_large.size
            seg = Image.fromarray(parsing.astype(np.uint8)).resize(ori_shape)
            bx, by, bx1, by1 = boxes[i]
            x_s, y_s, _x_e, _y_e = crop_boxes[k]
            mask_small = seg.crop((bx - x_s, by - y_s, bx1 - x_s, by1 - y_s))
            mask_image = Image.new("L", ori_shape, 0)
            mask_image.paste(mask_small, (bx - x_s, by - y_s, bx1 - x_s, by1 - y_s))
            width, height = mask_image.size
            top_boundary = int(height * upper_boundary_ratio)
            modified = Image.new("L", ori_shape, 0)
            modified.paste(mask_image.crop((0, top_boundary, width, height)), (0, top_boundary))
            blur_kernel_size = int(0.1 * ori_shape[0] // 2 * 2) + 1
            mask_array = cv2.GaussianBlur(np.array(modified), (blur_kernel_size, blur_kernel_size), 0)
            out[i] = (mask_array, crop_boxes[k])
    return out


class trusted_torch_load(object):
    """torch>=2.6 defaults to weights_only=True, which cannot read the legacy .tar checkpoints that MuseTalk's
    face parser (torchvision resnet18-5c106cde.pth, 79999_iter.pth) and S3FD ship with. Allow full unpickling
    ONLY for files inside the installed engine directories, and only while the models are being constructed."""

    def __init__(self, torch, roots):
        self.torch = torch
        self.roots = [os.path.normcase(os.path.abspath(r)) for r in roots if r]
        self.orig = None

    def __enter__(self):
        self.orig = self.torch.load
        orig = self.orig
        roots = self.roots

        def patched(f, *a, **kw):
            if "weights_only" not in kw and isinstance(f, (str, os.PathLike)):
                p = os.path.normcase(os.path.abspath(os.fspath(f)))
                if any(p.startswith(r + os.sep) for r in roots):
                    kw["weights_only"] = False
            return orig(f, *a, **kw)

        self.torch.load = patched
        return self

    def __exit__(self, *exc):
        self.torch.load = self.orig
        return False


def cuda_mem_mb(torch, device):
    if device.type != "cuda":
        return {}
    free_b, total_b = torch.cuda.mem_get_info(device)
    return {"freeMb": round(free_b / 1048576.0), "totalMb": round(total_b / 1048576.0)}


def fp16_unet_path(unet_path):
    return os.path.join(os.path.dirname(unet_path), "unet_fp16.safetensors")


def convert_unet_fp16(torch, unet_path):
    """One-time install step: 3.4 GB fp32 .pth -> 1.7 GB fp16 safetensors (halves the per-job disk read and
    loads straight onto the GPU). Inference already runs in fp16, so this is lossless for our use."""
    from safetensors.torch import save_file

    dst = fp16_unet_path(unet_path)
    try:
        sd = torch.load(unet_path, map_location="cpu", mmap=True, weights_only=True)
    except Exception:
        sd = torch.load(unet_path, map_location="cpu", weights_only=True)
    out = {k: (v.to(torch.float16) if v.is_floating_point() else v).contiguous() for k, v in sd.items()}
    tmp = dst + ".part"
    save_file(out, tmp, metadata={"source": os.path.basename(unet_path), "dtype": "float16"})
    os.replace(tmp, dst)
    return dst


def load_unet(torch, unet_cfg_path, unet_path, device, dtype):
    from diffusers import UNet2DConditionModel

    with open(unet_cfg_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    fp16_path = fp16_unet_path(unet_path)
    if dtype == torch.float16 and os.path.isfile(fp16_path):
        from safetensors.torch import load_file

        sd = load_file(fp16_path, device=str(device) if device.type == "cuda" else "cpu")
    else:
        try:
            sd = torch.load(unet_path, map_location="cpu", mmap=True, weights_only=True)
        except Exception:
            sd = torch.load(unet_path, map_location="cpu", weights_only=True)
    unet = None
    try:
        with torch.device("meta"):
            unet = UNet2DConditionModel(**cfg)
        unet.load_state_dict(sd, strict=True, assign=True)
        if any(t.is_meta for t in list(unet.parameters()) + list(unet.buffers())):
            raise RuntimeError("meta tensors left after assign")
    except Exception:
        unet = UNet2DConditionModel(**cfg)
        unet.load_state_dict(sd, strict=True)
    unet = unet.to(device=device, dtype=dtype).eval()
    unet.requires_grad_(False)
    del sd
    return unet


def run_doctor(args):
    info = {"event": "doctor", "ok": False, "python": sys.executable, "pythonVersion": sys.version.split()[0]}
    checks = []

    def check(name, fn, required=True):
        try:
            checks.append({"name": name, "ok": True, "detail": fn(), "required": required})
        except Exception as exc:  # noqa
            checks.append({"name": name, "ok": False, "detail": str(exc)[:300], "required": required})

    versions = {}

    def imp(mod, attr="__version__"):
        m = __import__(mod)
        versions[mod] = str(getattr(m, attr, "?"))
        return versions[mod]

    for mod in ("torch", "diffusers", "transformers", "cv2", "face_alignment", "librosa", "numpy", "skimage"):
        check("import:" + mod, lambda mod=mod: imp(mod))
    cuda = {}
    try:
        import torch

        cuda["available"] = bool(torch.cuda.is_available())
        cuda["torchCuda"] = torch.version.cuda
        if torch.cuda.is_available():
            dev = torch.device("cuda:0")
            cuda["device"] = torch.cuda.get_device_name(0)
            cuda["capability"] = list(torch.cuda.get_device_capability(0))
            cuda.update(cuda_mem_mb(torch, dev))
            x = torch.randn(64, 64, device=dev, dtype=torch.float16)
            cuda["matmulOk"] = bool(torch.isfinite(x @ x).all().item())
    except Exception as exc:  # noqa
        cuda["error"] = str(exc)[:300]
    if args.device == "cuda":
        checks.append({"name": "cuda", "ok": bool(cuda.get("available") and cuda.get("matmulOk")), "detail": cuda, "required": True})
    root = os.path.abspath(args.engine_root or ".")
    torch_home = os.environ.get("TORCH_HOME", "")
    files = {
        "unet": os.path.join(root, "models", "musetalkV15", "unet.pth"),
        "unetConfig": os.path.join(root, "models", "musetalkV15", "musetalk.json"),
        "vae": os.path.join(root, "models", "sd-vae", "config.json"),
        "whisper": os.path.join(root, "models", "whisper", "config.json"),
        "faceParse": os.path.join(root, "models", "face-parse-bisent", "79999_iter.pth"),
        "faceParseBackbone": os.path.join(root, "models", "face-parse-bisent", "resnet18-5c106cde.pth"),
        "musetalkCode": os.path.join(root, "musetalk", "utils", "blending.py"),
    }
    if torch_home:
        files["s3fd"] = os.path.join(torch_home, "hub", "checkpoints", "s3fd-619a316812.pth")
        files["fan"] = os.path.join(torch_home, "hub", "checkpoints", "2DFAN4-cd938726ad.zip")
    for k, p in files.items():
        checks.append({"name": "file:" + k, "ok": os.path.isfile(p) and os.path.getsize(p) > 0, "detail": p, "required": True})
    ff = args.ffmpeg or shutil.which("ffmpeg") or "ffmpeg"
    check("ffmpeg", lambda: subprocess.run([ff, "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout.decode("utf-8", "replace").splitlines()[0])
    info["fp16UnetCache"] = os.path.isfile(os.path.join(root, "models", "musetalkV15", "unet_fp16.safetensors"))
    info["checks"] = checks
    info["versions"] = versions
    info["cuda"] = cuda
    info["ok"] = all(c["ok"] for c in checks if c.get("required", True))
    if not info["ok"]:
        info["error"] = "; ".join("%s: %s" % (c["name"], c["detail"]) for c in checks if not c["ok"])[:800]
    emit(info)
    return 0 if info["ok"] else 2


def run(args):
    import gc

    import numpy as np

    t_start = time.time()
    timings = {}
    stage_peaks = {}
    state = {"torch": None, "device": None}

    def mark(name, t0):
        timings[name] = round(time.time() - t0, 3)
        torch_mod, dev = state["torch"], state["device"]
        if torch_mod is not None and dev is not None and dev.type == "cuda":
            stage_peaks[name] = round(torch_mod.cuda.max_memory_allocated(dev) / 1048576.0)
            torch_mod.cuda.reset_peak_memory_stats(dev)

    root = os.path.abspath(args.engine_root)
    source = os.path.abspath(args.source)
    audio = os.path.abspath(args.audio)
    output = os.path.abspath(args.output)
    if not os.path.isfile(source):
        raise LipsyncError("SOURCE_READ", "source not found: %s" % source)
    if not os.path.isfile(audio):
        raise LipsyncError("AUDIO_READ", "audio not found: %s" % audio)
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    os.chdir(root)  # MuseTalk resolves ./models/... relative to its repo root
    if root not in sys.path:
        sys.path.insert(0, root)

    t0 = time.time()
    progress("load", 2, "正在加载 PyTorch / CUDA 运行时...")
    import cv2
    import torch

    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = bool(args.cudnn_benchmark)
    want_cuda = args.device == "cuda"
    if want_cuda and not torch.cuda.is_available():
        raise LipsyncError("NO_CUDA", "CUDA is not available in this Python environment")
    device = torch.device("cuda:0" if want_cuda else "cpu")
    dtype = torch.float16 if (args.fp16 and device.type == "cuda") else torch.float32
    if device.type == "cuda":
        torch.cuda.set_device(device)
        torch.zeros(1, device=device)  # initialise the caching allocator before touching its stats
        torch.cuda.reset_peak_memory_stats(device)
    state["torch"], state["device"] = torch, device
    vram_start = cuda_mem_mb(torch, device)
    ffmpeg = args.ffmpeg or shutil.which("ffmpeg") or "ffmpeg"
    ffprobe = find_ffprobe(ffmpeg)

    # --- audio duration / frame count
    audio_info = probe_media(ffprobe, audio)
    audio_sec = float(audio_info["duration"])
    if audio_sec <= 0.2:
        raise LipsyncError("AUDIO_READ", "audio too short: %.3fs" % audio_sec)
    fps = int(args.fps)
    n_out = int(math.ceil(audio_sec * fps - 1e-6))
    max_src = max(1, min(n_out, int(round(args.max_source_sec * fps))))
    is_image = args.source_is_image or source.lower().endswith(IMAGE_EXTS)
    mark("init", t0)

    # --- source frames
    t0 = time.time()
    progress("decode", 5, "正在解码出镜素材 (%s)..." % ("人像照片" if is_image else "视频"))
    mats = None
    base = None
    if is_image:
        base = read_image(source, args.max_side)
        H, W = base.shape[:2]
        n_base = max(1, min(n_out, int(round(args.image_motion_sec * fps))))
        frames, mats = synth_image_frames(base, n_base, fps)
        src_kind = "image"
    else:
        info = probe_media(ffprobe, source)
        if not info.get("width"):
            raise LipsyncError("SOURCE_READ", "no video stream in source: %s" % source)
        W, H = even_dims(info["width"], info["height"], args.max_side)
        frames = read_video_frames(ffmpeg, source, fps, W, H, max_src)
        src_kind = "video"
    if not frames:
        raise LipsyncError("SOURCE_READ", "no frames decoded from source: %s" % source)
    S = len(frames)
    mark("decode", t0)

    # --- face analysis FIRST, while no generator weights are resident (FAN's TorchScript graph has cuDNN
    #     autotuning baked in: a one-off multi-GB workspace spike), then free it before loading MuseTalk.
    t0 = time.time()
    progress("detect", 8, "正在检测人脸与 68 点关键点 (%d 帧)..." % (1 if is_image else S))
    import face_alignment

    lt = getattr(face_alignment.LandmarksType, "TWO_D", None) or getattr(face_alignment.LandmarksType, "_2D")
    torch_home = os.environ.get("TORCH_HOME", "")
    ckpt_dir = os.path.join(torch_home, "hub", "checkpoints")
    s3fd_path = os.path.join(ckpt_dir, "s3fd-619a316812.pth")
    fan_path = os.path.join(ckpt_dir, "2DFAN4-cd938726ad.zip")
    for p in (s3fd_path, fan_path):
        if not os.path.isfile(p):
            # face-alignment would otherwise silently download into an arbitrary cache dir
            raise LipsyncError("MISSING_WEIGHTS", "face-alignment weights missing: %s (re-run install-lipsync-engine)" % p)
    with trusted_torch_load(torch, [os.path.join(root, "models"), os.path.join(torch_home, "hub")]):
        fa = face_alignment.FaceAlignment(
            lt,
            flip_input=False,
            device="cuda" if device.type == "cuda" else "cpu",
            face_detector="sfd",
            face_detector_kwargs={"path_to_detector": s3fd_path},
        )
    torch.backends.cudnn.benchmark = bool(args.cudnn_benchmark)  # FaceAlignment() switched it on globally
    if not args.cudnn_benchmark:
        fa.face_detector.face_detector = make_no_autotune(torch)(fa.face_detector.face_detector)
    # FAN is a traced TorchScript graph with cudnn benchmark=True baked into every conv: its first call autotunes
    # with up to ~4.3 GB of workspace. Disable the profiling executor (no re-optimisation pass on call 2) and cap
    # the caching allocator so oversized workspaces are skipped (~1.2 GB peak, 2x faster warm-up).
    try:
        torch._C._jit_set_profiling_executor(False)
        torch._C._jit_set_profiling_mode(False)
    except Exception:
        pass
    mem_capped = False
    if device.type == "cuda" and args.face_vram_cap_mb > 0:
        total_mb = torch.cuda.get_device_properties(device).total_memory / 1048576.0
        torch.cuda.set_per_process_memory_fraction(min(1.0, max(0.05, args.face_vram_cap_mb / total_mb)), device)
        mem_capped = True
    face_frames = 0
    if is_image:
        lm, det = detect_landmarks(fa, base, args.det_max_side)
        if lm is None:
            raise LipsyncError("NO_FACE", "未在人像照片中检测到人脸，请换一张正脸清晰的照片")
        face_frames = 1
        box0 = musetalk_bbox(lm, det)
        raw_boxes = [transform_box(box0, M) for M in mats]
    else:
        raw_boxes = [None] * S
        last_pct = 0
        for i, fr in enumerate(frames):
            lm, det = detect_landmarks(fa, fr, args.det_max_side)
            if lm is not None:
                raw_boxes[i] = musetalk_bbox(lm, det)
                face_frames += 1
            pct = 8 + 22 * (i + 1) / S
            if pct - last_pct >= 2:
                last_pct = pct
                progress("detect", pct, "人脸关键点 %d/%d" % (i + 1, S))
        if face_frames == 0:
            raise LipsyncError("NO_FACE", "未在视频中检测到人脸，请确认出镜画面为清晰正脸")
        # fill gaps with nearest valid box
        valid = [i for i, b in enumerate(raw_boxes) if b is not None]
        for i in range(S):
            if raw_boxes[i] is None:
                j = min(valid, key=lambda v: abs(v - i))
                raw_boxes[i] = list(raw_boxes[j])
    boxes = finalize_boxes(smooth_boxes(raw_boxes, 1 if is_image else args.smooth), W, H, args.extra_margin)
    if mem_capped:
        torch.cuda.set_per_process_memory_fraction(1.0, device)
    del fa
    gc.collect()
    if device.type == "cuda":
        torch.cuda.empty_cache()
    mark("detect", t0)

    # --- MuseTalk generator models
    t0 = time.time()
    progress("load", 32, "正在加载 MuseTalk 1.5 模型 (UNet / VAE / Whisper / 人脸解析)...")
    from diffusers import AutoencoderKL
    from transformers import WhisperModel

    from musetalk.models.unet import PositionalEncoding
    from musetalk.utils.audio_processor import AudioProcessor
    from musetalk.utils.face_parsing import FaceParsing

    unet = load_unet(torch, os.path.join("models", "musetalkV15", "musetalk.json"), os.path.join("models", "musetalkV15", "unet.pth"), device, dtype)
    vae = AutoencoderKL.from_pretrained(os.path.join("models", "sd-vae"), torch_dtype=dtype).to(device).eval()
    vae.requires_grad_(False)
    sf = float(vae.config.scaling_factor)
    whisper = WhisperModel.from_pretrained(os.path.join("models", "whisper"), torch_dtype=dtype).to(device).eval()
    whisper.requires_grad_(False)
    pe = PositionalEncoding(d_model=384).to(device=device, dtype=dtype)
    audio_processor = AudioProcessor(feature_extractor_path=os.path.join("models", "whisper"))
    with trusted_torch_load(torch, [os.path.join(root, "models")]):
        fp = FaceParsing(left_cheek_width=args.cheek_width, right_cheek_width=args.cheek_width)
    torch.backends.cudnn.benchmark = bool(args.cudnn_benchmark)
    mark("loadModels", t0)

    # --- VAE latents + blending masks per source frame
    t0 = time.time()
    progress("encode", 42, "正在编码面部潜变量与融合遮罩...")
    latents = []
    enc_bs = max(1, int(args.vae_batch))
    with torch.inference_mode():
        for b0 in range(0, S, enc_bs):
            crops = []
            for i in range(b0, min(S, b0 + enc_bs)):
                x1, y1, x2, y2 = boxes[i]
                crop = cv2.resize(frames[i][y1:y2, x1:x2], (256, 256), interpolation=cv2.INTER_LANCZOS4)
                crops.append(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            x = torch.from_numpy(np.stack(crops)).to(device).permute(0, 3, 1, 2).float().div_(255.0)
            masked = x.clone()
            masked[:, :, 128:, :] = 0.0
            x = x.mul(2.0).sub(1.0).to(dtype)
            masked = masked.mul(2.0).sub(1.0).to(dtype)
            m_lat = vae.encode(masked).latent_dist.mode() * sf
            r_lat = vae.encode(x).latent_dist.mode() * sf
            latents.append(torch.cat([m_lat, r_lat], dim=1))
        latents = torch.cat(latents, dim=0)
    mark("encode", t0)
    t0 = time.time()
    progress("encode", 48, "正在解析面部区域生成融合遮罩 (%d 帧)..." % S)
    masks = prepare_blend_masks(torch, fp, frames, boxes, args.parsing_mode, device)
    mark("masks", t0)

    # --- audio -> whisper chunks
    t0 = time.time()
    progress("audio", 52, "正在提取 Whisper 音频特征...")
    feats, librosa_len = audio_processor.get_audio_feature(audio)
    with torch.inference_mode():
        chunks = audio_processor.get_whisper_chunk(
            feats, device, dtype, whisper, librosa_len, fps=fps,
            audio_padding_length_left=2, audio_padding_length_right=2,
        )
    if chunks.shape[0] < n_out:
        pad = chunks[-1:].repeat(n_out - chunks.shape[0], 1, 1)
        chunks = torch.cat([chunks, pad], dim=0)
    chunks = chunks[:n_out]
    mark("audio", t0)

    # --- batched UNet inference + blending + streaming encode
    t0 = time.time()
    progress("infer", 55, "正在逐帧生成口型 (%d 帧, batch=%d, %s)..." % (n_out, args.batch_size, "fp16" if dtype == torch.float16 else "fp32"))
    cycle = list(range(S)) + list(range(S - 1, -1, -1))
    tmp_out = output + ".part.mp4"
    err_log = output + ".ffmpeg.log"
    enc_cmd = [
        ffmpeg, "-y", "-v", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", "%dx%d" % (W, H), "-r", str(fps), "-i", "-",
        "-i", audio,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-t", "%.3f" % audio_sec, "-movflags", "+faststart", tmp_out,
    ]
    with open(err_log, "wb") as elog:
        writer = subprocess.Popen(enc_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=elog)
        timesteps = torch.tensor([0], device=device)
        infer_s = 0.0
        blend_s = 0.0
        last_pct = 0
        try:
            for b0 in range(0, n_out, args.batch_size):
                idxs = list(range(b0, min(n_out, b0 + args.batch_size)))
                tb = time.time()
                with torch.inference_mode():
                    w = chunks[idxs].to(device=device, dtype=dtype)
                    lat = latents[[cycle[i % len(cycle)] for i in idxs]].to(dtype)
                    pred = unet(lat, timesteps, encoder_hidden_states=pe(w)).sample
                    decoded = []
                    for d0 in range(0, pred.shape[0], max(1, int(args.vae_batch))):
                        dec = vae.decode(pred[d0:d0 + max(1, int(args.vae_batch))] / sf).sample
                        decoded.append((dec / 2 + 0.5).clamp(0, 1).mul(255).round().to(torch.uint8))
                    img = torch.cat(decoded, dim=0)
                    img = img.permute(0, 2, 3, 1).flip(-1).contiguous().cpu().numpy()  # RGB -> BGR
                infer_s += time.time() - tb
                tb = time.time()
                for k, i in enumerate(idxs):
                    si = cycle[i % len(cycle)]
                    x1, y1, x2, y2 = boxes[si]
                    res = cv2.resize(img[k], (x2 - x1, y2 - y1))
                    mask, crop_box = masks[si]
                    combined = blend_face(frames[si], res, [x1, y1, x2, y2], mask, crop_box)
                    writer.stdin.write(combined.tobytes())
                blend_s += time.time() - tb
                pct = 55 + 40 * (idxs[-1] + 1) / n_out
                if pct - last_pct >= 2:
                    last_pct = pct
                    progress("infer", pct, "口型生成 %d/%d 帧" % (idxs[-1] + 1, n_out))
        finally:
            try:
                writer.stdin.close()
            except Exception:
                pass
            rc = writer.wait()
    timings["unetVae"] = round(infer_s, 3)
    timings["blendEncode"] = round(blend_s, 3)
    mark("inferTotal", t0)
    if rc != 0 or not os.path.isfile(tmp_out):
        with open(err_log, "rb") as f:
            tail = f.read()[-600:].decode("utf-8", "replace")
        raise LipsyncError("FFMPEG", "ffmpeg encode failed (%s): %s" % (rc, tail))
    os.replace(tmp_out, output)
    try:
        os.remove(err_log)
    except Exception:
        pass

    # --- metrics
    arr = np.array(boxes, dtype=np.float64)
    cx = float(np.median((arr[:, 0] + arr[:, 2]) / 2.0)) / W
    cy = float(np.median((arr[:, 1] + arr[:, 3]) / 2.0)) / H
    bw = float(np.median(arr[:, 2] - arr[:, 0])) / W
    bh = float(np.median(arr[:, 3] - arr[:, 1])) / H
    peak_alloc = peak_reserved = None
    if device.type == "cuda":
        peak_alloc = max(list(stage_peaks.values()) + [round(torch.cuda.max_memory_allocated(device) / 1048576.0)])
        peak_reserved = round(torch.cuda.max_memory_reserved(device) / 1048576.0)
    total = time.time() - t_start
    result = {
        "event": "result",
        "ok": True,
        "engine": "musetalk-1.5",
        "output": output,
        "sourceKind": src_kind,
        "width": W,
        "height": H,
        "fps": fps,
        "frames": n_out,
        "sourceFrames": S,
        "faceFrames": face_frames,
        "audioSec": round(audio_sec, 3),
        "faceBox": {"cx": round(cx, 4), "cy": round(cy, 4), "w": round(bw, 4), "h": round(bh, 4)},
        "device": torch.cuda.get_device_name(0) if device.type == "cuda" else "cpu",
        "dtype": "fp16" if dtype == torch.float16 else "fp32",
        "batchSize": args.batch_size,
        "vramAtStart": vram_start,
        "peakVramAllocatedMb": peak_alloc,
        "peakVramReservedMb": peak_reserved,
        "timings": timings,
        "stagePeakVramMb": stage_peaks,
        "wallSec": round(total, 3),
        "rtf": round(total / audio_sec, 3),
        "inferFps": round(n_out / max(1e-6, timings.get("inferTotal", total)), 2),
    }
    progress("done", 100, "唇形同步完成 (%.1fs, RTF %.2f)" % (total, total / audio_sec))
    emit(result)
    return 0


def main():
    ap = argparse.ArgumentParser(description="MuseTalk 1.5 lip-sync wrapper for DSH Video Workbench")
    ap.add_argument("--doctor", action="store_true")
    ap.add_argument("--convert-fp16", action="store_true")
    ap.add_argument("--engine-root", default=os.environ.get("MUSETALK_ROOT", ""))
    ap.add_argument("--source", default="")
    ap.add_argument("--source-is-image", action="store_true")
    ap.add_argument("--audio", default="")
    ap.add_argument("--output", default="")
    ap.add_argument("--fps", type=int, default=25)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    ap.add_argument("--fp16", action="store_true")
    ap.add_argument("--max-side", type=int, default=1280)
    ap.add_argument("--max-source-sec", type=float, default=8.0)
    ap.add_argument("--image-motion-sec", type=float, default=6.0)
    ap.add_argument("--extra-margin", type=int, default=10)
    ap.add_argument("--parsing-mode", default="jaw")
    ap.add_argument("--cheek-width", type=int, default=90)
    ap.add_argument("--smooth", type=int, default=5)
    ap.add_argument("--cudnn-benchmark", action="store_true")
    ap.add_argument("--det-max-side", type=int, default=640)
    ap.add_argument("--vae-batch", type=int, default=8)
    ap.add_argument("--face-vram-cap-mb", type=int, default=1500)
    ap.add_argument("--ffmpeg", default="")
    args = ap.parse_args()
    apply_env_defaults(args.engine_root)

    if args.doctor:
        try:
            return run_doctor(args)
        except Exception as exc:  # noqa
            emit({"event": "doctor", "ok": False, "error": str(exc)})
            return 2
    if args.convert_fp16:
        try:
            import torch

            src = os.path.join(os.path.abspath(args.engine_root), "models", "musetalkV15", "unet.pth")
            t0 = time.time()
            dst = convert_unet_fp16(torch, src)
            emit({"event": "result", "ok": True, "output": dst, "bytes": os.path.getsize(dst), "sec": round(time.time() - t0, 2)})
            return 0
        except Exception as exc:  # noqa
            emit({"event": "error", "ok": False, "code": "CONVERT_FP16", "message": str(exc)[:600]})
            return 4
    try:
        if not (args.engine_root and args.source and args.audio and args.output):
            raise LipsyncError("BAD_ARGS", "--engine-root, --source, --audio and --output are required")
        return run(args)
    except LipsyncError as exc:
        emit({"event": "error", "ok": False, "code": exc.code, "message": str(exc)})
        return 3
    except Exception as exc:  # noqa
        code = "INTERNAL"
        msg = str(exc)
        if exc.__class__.__name__ == "OutOfMemoryError" or "out of memory" in msg.lower():
            code = "CUDA_OOM"
            msg = "显存不足 (CUDA OOM)：请关闭占用显存的程序、降低 AVATAR_LIPSYNC_BATCH_SIZE 或 AVATAR_LIPSYNC_MAX_SIDE。" + msg[:200]
        traceback.print_exc()
        emit({"event": "error", "ok": False, "code": code, "message": msg[:800]})
        return 4


if __name__ == "__main__":
    _rc = main()
    # Skip interpreter teardown: on Windows, CUDA / cuDNN / TorchScript worker threads can crash during normal
    # shutdown (e.g. 0xC0000409) after the result was already emitted. Everything is flushed above.
    try:
        sys.stderr.flush()
        REAL_STDOUT.flush()
    except Exception:
        pass
    os._exit(int(_rc or 0))
