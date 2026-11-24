#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DSH Video Workbench - audio/visual lip-sync evaluator (used by scripts/tests/avatar-lipsync.e2e.mjs).

Two independent measurements on a talking-head video (optionally restricted to a region, e.g. the PiP box):

1. SyncNet (Chung & Zisserman, "Out of time", 2016) re-implemented from joonson/syncnet_python (MIT), using the
   official `syncnet_v2.model` weights (mirrored in ByteDance/LatentSync on Hugging Face). Reports the standard
   AV offset (frames, +N = video lags audio), LSE-D (min distance, lower is better) and LSE-C (confidence,
   higher is better). Face crops follow syncnet_python's crop rule (S3FD box, 13-tap median smoothing, crop_scale 0.4).
2. Mouth-opening vs. audio-envelope cross-correlation: FAN 68-point inner-lip gap (normalised by face height)
   against the per-frame RMS loudness, both detrended; reports the lag (frames) with the best Pearson r.

Usage:
  python -I av_sync_eval.py --video out.mp4 [--audio narration.wav] [--roi x,y,w,h (normalised)] \
      --syncnet D:/dsh-ai/lipsync/eval/syncnet_v2.model --torch-home D:/dsh-ai/lipsync/torch-hub [--max-sec 30]
Prints one JSON object on stdout.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
REAL_STDOUT = sys.stdout
sys.stdout = sys.stderr
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def build_syncnet(torch):
    nn = torch.nn

    class SyncNetS(nn.Module):
        def __init__(self, num_layers_in_fc_layers=1024):
            super().__init__()
            self.netcnnaud = nn.Sequential(
                nn.Conv2d(1, 64, kernel_size=(3, 3), stride=(1, 1), padding=(1, 1)),
                nn.BatchNorm2d(64), nn.ReLU(inplace=True),
                nn.MaxPool2d(kernel_size=(1, 1), stride=(1, 1)),
                nn.Conv2d(64, 192, kernel_size=(3, 3), stride=(1, 1), padding=(1, 1)),
                nn.BatchNorm2d(192), nn.ReLU(inplace=True),
                nn.MaxPool2d(kernel_size=(3, 3), stride=(1, 2)),
                nn.Conv2d(192, 384, kernel_size=(3, 3), padding=(1, 1)),
                nn.BatchNorm2d(384), nn.ReLU(inplace=True),
                nn.Conv2d(384, 256, kernel_size=(3, 3), padding=(1, 1)),
                nn.BatchNorm2d(256), nn.ReLU(inplace=True),
                nn.Conv2d(256, 256, kernel_size=(3, 3), padding=(1, 1)),
                nn.BatchNorm2d(256), nn.ReLU(inplace=True),
                nn.MaxPool2d(kernel_size=(3, 3), stride=(2, 2)),
                nn.Conv2d(256, 512, kernel_size=(5, 4), padding=(0, 0)),
                nn.BatchNorm2d(512), nn.ReLU(),
            )
            self.netfcaud = nn.Sequential(
                nn.Linear(512, 512), nn.BatchNorm1d(512), nn.ReLU(), nn.Linear(512, num_layers_in_fc_layers),
            )
            self.netfclip = nn.Sequential(
                nn.Linear(512, 512), nn.BatchNorm1d(512), nn.ReLU(), nn.Linear(512, num_layers_in_fc_layers),
            )
            self.netcnnlip = nn.Sequential(
                nn.Conv3d(3, 96, kernel_size=(5, 7, 7), stride=(1, 2, 2), padding=0),
                nn.BatchNorm3d(96), nn.ReLU(inplace=True),
                nn.MaxPool3d(kernel_size=(1, 3, 3), stride=(1, 2, 2)),
                nn.Conv3d(96, 256, kernel_size=(1, 5, 5), stride=(1, 2, 2), padding=(0, 1, 1)),
                nn.BatchNorm3d(256), nn.ReLU(inplace=True),
                nn.MaxPool3d(kernel_size=(1, 3, 3), stride=(1, 2, 2), padding=(0, 1, 1)),
                nn.Conv3d(256, 256, kernel_size=(1, 3, 3), padding=(0, 1, 1)),
                nn.BatchNorm3d(256), nn.ReLU(inplace=True),
                nn.Conv3d(256, 256, kernel_size=(1, 3, 3), padding=(0, 1, 1)),
                nn.BatchNorm3d(256), nn.ReLU(inplace=True),
                nn.Conv3d(256, 256, kernel_size=(1, 3, 3), padding=(0, 1, 1)),
                nn.BatchNorm3d(256), nn.ReLU(inplace=True),
                nn.MaxPool3d(kernel_size=(1, 3, 3), stride=(1, 2, 2)),
                nn.Conv3d(256, 512, kernel_size=(1, 6, 6), padding=0),
                nn.BatchNorm3d(512), nn.ReLU(inplace=True),
            )

        def forward_aud(self, x):
            mid = self.netcnnaud(x)
            return self.netfcaud(mid.view((mid.size()[0], -1)))

        def forward_lip(self, x):
            mid = self.netcnnlip(x)
            return self.netfclip(mid.view((mid.size()[0], -1)))

    return SyncNetS()


def decode_frames(ffmpeg, ffprobe, path, fps, max_sec, roi):
    import numpy as np
    from musetalk_infer import even_dims, probe_media

    info = probe_media(ffprobe, path)
    W0, H0 = info["width"], info["height"]
    W, H = even_dims(W0, H0, 1920)
    vf = ["fps=%d" % fps]
    if roi:
        x, y, w, h = roi
        cw, ch = int(round(w * W0 / 2) * 2), int(round(h * H0 / 2) * 2)
        vf.append("crop=%d:%d:%d:%d" % (cw, ch, int(round(x * W0)), int(round(y * H0))))
        W, H = cw, ch
    else:
        vf.append("scale=%d:%d" % (W, H))
    cmd = [ffmpeg, "-v", "error", "-i", path, "-an", "-vf", ",".join(vf), "-t", str(max_sec), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frames, n = [], W * H * 3
    while True:
        buf = proc.stdout.read(n)
        if not buf or len(buf) < n:
            break
        frames.append(np.frombuffer(buf, dtype=np.uint8).reshape(H, W, 3))
    proc.wait()
    return frames


def decode_audio(ffmpeg, path, max_sec):
    import numpy as np

    cmd = [ffmpeg, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-t", str(max_sec), "-f", "s16le", "-"]
    out = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
    return np.frombuffer(out, dtype=np.int16)


def medfilt(x, k):
    from scipy import signal

    x = list(x)
    if len(x) < k:
        k = max(1, (len(x) // 2) * 2 - 1)
    return signal.medfilt(x, kernel_size=k) if k > 1 else x


def syncnet_eval(torch, net, device, frames, boxes, audio, vshift=15, batch=20):
    import cv2
    import numpy as np
    import python_speech_features

    cs = 0.4
    xs = [(b[0] + b[2]) / 2 for b in boxes]
    ys = [(b[1] + b[3]) / 2 for b in boxes]
    ss = [max(b[3] - b[1], b[2] - b[0]) / 2 for b in boxes]
    xs, ys, ss = medfilt(xs, 13), medfilt(ys, 13), medfilt(ss, 13)
    crops = []
    for f, img in enumerate(frames):
        bs = float(ss[f])
        bsi = int(bs * (1 + 2 * cs))
        padded = np.pad(img, ((bsi, bsi), (bsi, bsi), (0, 0)), "constant", constant_values=(110, 110))
        my, mx = ys[f] + bsi, xs[f] + bsi
        face = padded[int(my - bs):int(my + bs * (1 + 2 * cs)), int(mx - bs * (1 + cs)):int(mx + bs * (1 + cs))]
        crops.append(cv2.resize(face, (224, 224)))
    im = np.stack(crops, axis=3)[None]  # 1,224,224,3,T
    im = np.transpose(im, (0, 3, 4, 1, 2))  # 1,3,T,224,224 (BGR 0..255 like syncnet_python)
    imtv = torch.from_numpy(im.astype(np.float32))
    mfcc = np.stack([np.array(i) for i in zip(*python_speech_features.mfcc(audio, 16000))])
    cct = torch.from_numpy(mfcc[None, None].astype(np.float32))
    min_length = min(len(crops), math.floor(len(audio) / 640))
    lastframe = min_length - 5
    if lastframe < 2 * vshift + 5:
        return None
    im_feat, cc_feat = [], []
    with torch.inference_mode():
        for i in range(0, lastframe, batch):
            rng = range(i, min(lastframe, i + batch))
            im_in = torch.cat([imtv[:, :, v:v + 5] for v in rng], 0).to(device)
            im_feat.append(net.forward_lip(im_in).float().cpu())
            cc_in = torch.cat([cct[:, :, :, v * 4:v * 4 + 20] for v in rng], 0).to(device)
            cc_feat.append(net.forward_aud(cc_in).float().cpu())
    im_feat = torch.cat(im_feat, 0)
    cc_feat = torch.cat(cc_feat, 0)
    win = vshift * 2 + 1
    feat2p = torch.nn.functional.pad(cc_feat, (0, 0, vshift, vshift))
    dists = [torch.nn.functional.pairwise_distance(im_feat[[i], :].repeat(win, 1), feat2p[i:i + win, :]) for i in range(len(im_feat))]
    mdist = torch.mean(torch.stack(dists, 1), 1)
    minval, minidx = torch.min(mdist, 0)
    offset = vshift - int(minidx)
    conf = float(torch.median(mdist) - minval)
    return {"avOffsetFrames": int(offset), "lseD": round(float(minval), 3), "lseC": round(conf, 3), "evaluatedFrames": int(lastframe)}


def xcorr_eval(lms, audio, fps, n_frames, max_lag=10):
    import numpy as np

    mouth = np.full(n_frames, np.nan)
    for i, lm in enumerate(lms):
        if lm is None:
            continue
        gap = np.mean([np.linalg.norm(lm[62] - lm[66]), np.linalg.norm(lm[61] - lm[67]), np.linalg.norm(lm[63] - lm[65])])
        face_h = max(1e-3, np.linalg.norm(lm[27] - lm[8]))
        mouth[i] = gap / face_h
    valid = ~np.isnan(mouth)
    if valid.sum() < n_frames * 0.5:
        return None
    idx = np.arange(n_frames)
    mouth = np.interp(idx, idx[valid], mouth[valid])
    spf = 16000.0 / fps
    env = np.zeros(n_frames)
    a = audio.astype(np.float64) / 32768.0
    for i in range(n_frames):
        c = (i + 0.5) * spf
        s0, s1 = int(max(0, c - spf)), int(min(len(a), c + spf))
        env[i] = math.sqrt(np.mean(a[s0:s1] ** 2)) if s1 > s0 else 0.0
    env = np.log1p(env * 50.0)

    def detrend(x, k=25):
        k = min(k, len(x) // 2 * 2 + 1)
        pad = k // 2
        xp = np.pad(x, (pad, pad), mode="edge")
        return x - np.convolve(xp, np.ones(k) / k, mode="valid")

    m, e = detrend(mouth), detrend(env)
    best = (0, -2.0)
    curve = {}
    for lag in range(-max_lag, max_lag + 1):
        # lag > 0: mouth at frame t follows audio at frame t - lag (video lags audio)
        if lag >= 0:
            mm, ee = m[lag:], e[:len(e) - lag]
        else:
            mm, ee = m[:lag], e[-lag:]
        if len(mm) < 20 or np.std(mm) == 0 or np.std(ee) == 0:
            continue
        r = float(np.corrcoef(mm, ee)[0, 1])
        curve[lag] = round(r, 3)
        if r > best[1]:
            best = (lag, r)
    return {
        "bestLagFrames": best[0],
        "bestLagMs": round(best[0] * 1000.0 / fps, 1),
        "rAtBestLag": round(best[1], 3),
        "rAtZeroLag": curve.get(0),
        "mouthStd": round(float(np.std(mouth)), 4),
        "curve": curve,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--audio", default="")
    ap.add_argument("--roi", default="")
    ap.add_argument("--syncnet", default="")
    ap.add_argument("--torch-home", default=os.environ.get("TORCH_HOME", ""))
    ap.add_argument("--ffmpeg", default="")
    ap.add_argument("--max-sec", type=float, default=60.0)
    ap.add_argument("--fps", type=int, default=25)
    args = ap.parse_args()
    if args.torch_home:
        os.environ["TORCH_HOME"] = args.torch_home
    import numpy as np
    import torch
    import face_alignment
    from musetalk_infer import detect_landmarks, find_ffprobe, make_no_autotune, trusted_torch_load

    ffmpeg = args.ffmpeg or shutil.which("ffmpeg") or "ffmpeg"
    ffprobe = find_ffprobe(ffmpeg)
    roi = [float(v) for v in args.roi.split(",")] if args.roi else None
    frames = decode_frames(ffmpeg, ffprobe, args.video, args.fps, args.max_sec, roi)
    audio = decode_audio(ffmpeg, args.audio or args.video, args.max_sec)
    n = min(len(frames), int(len(audio) / 16000.0 * args.fps))
    frames = frames[:n]
    device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
    torch.backends.cudnn.benchmark = False
    ckpt = os.path.join(os.environ.get("TORCH_HOME", ""), "hub", "checkpoints")
    s3fd = os.path.join(ckpt, "s3fd-619a316812.pth")
    with trusted_torch_load(torch, [os.path.join(os.environ.get("TORCH_HOME", ""), "hub")]):
        fa = face_alignment.FaceAlignment(face_alignment.LandmarksType.TWO_D, flip_input=False, device=str(device.type),
                                          face_detector="sfd", face_detector_kwargs={"path_to_detector": s3fd})
    torch.backends.cudnn.benchmark = False
    fa.face_detector.face_detector = make_no_autotune(torch)(fa.face_detector.face_detector)
    lms, boxes = [], []
    last_box = None
    for fr in frames:
        lm, det = detect_landmarks(fa, fr, 640)
        lms.append(lm)
        if det is not None:
            last_box = [float(v) for v in det[:4]]
        boxes.append(last_box)
    first = next((b for b in boxes if b is not None), None)
    if first is None:
        REAL_STDOUT.write(json.dumps({"ok": False, "error": "no face found"}) + "\n")
        return 2
    boxes = [b if b is not None else first for b in boxes]
    result = {
        "ok": True,
        "video": os.path.abspath(args.video),
        "audio": os.path.abspath(args.audio) if args.audio else "(video track)",
        "roi": roi,
        "frames": n,
        "facesDetected": sum(1 for lm in lms if lm is not None),
        "xcorr": xcorr_eval(lms, audio, args.fps, n),
    }
    if args.syncnet and os.path.isfile(args.syncnet):
        net = build_syncnet(torch)
        try:
            state = torch.load(args.syncnet, map_location="cpu", weights_only=True)
        except Exception:
            with trusted_torch_load(torch, [os.path.dirname(os.path.abspath(args.syncnet))]):
                state = torch.load(args.syncnet, map_location="cpu")
        net.load_state_dict(state, strict=True)
        net = net.to(device).eval()
        result["syncnet"] = syncnet_eval(torch, net, device, frames, boxes, audio)
    REAL_STDOUT.write(json.dumps(result, ensure_ascii=True) + "\n")
    REAL_STDOUT.flush()
    return 0


if __name__ == "__main__":
    _rc = main()
    # skip CUDA / PyTorch interpreter teardown (can crash on Windows after the JSON result was written)
    try:
        sys.stderr.flush()
        REAL_STDOUT.flush()
    except Exception:
        pass
    os._exit(int(_rc or 0))
