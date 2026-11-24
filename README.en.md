# AI Video Workbench (DSH)

A desktop integration package for [DSH Video Workbench](https://github.com/Merziller/dsh-video-workbench) (original author: Merziller, MIT). One idea in, one finished MP4 out - storyboard, narration, rendering, QA and the publish pack all happen inside one workbench.

> This repository is the Ruodao desktop integration layer. The upstream project and its full documentation live at [Merziller/dsh-video-workbench](https://github.com/Merziller/dsh-video-workbench). Keep the upstream attribution when redistributing.

## What it does

- **Dual rendering engines** - Remotion (deterministic TSX, frame-exact) or Three.js / HTML5 CDP for live motion, chosen per shot.
- **Agent war room** - three skins showing plan, shot progress, coding and render status in real time.
- **Character library and figure styles** - silhouette, papercut, shadow puppet, ink, flat and stick figures with 37 actions; or let the AI design a custom look and keep it consistent across the film.
- **Visual self-check** - each shot is rendered to a still and reviewed by a vision-capable model for composition, text and exposure; problem shots are re-coded once with the screenshot attached.
- **Vibecoding toolkit** - eight tools the AI picks per shot; anything not covered is written as code.
- **CinePulse Plaza** - browse, apply, refresh and submit `MOTION.md` templates.
- **Reference video reverse-engineering** - FFprobe + cut detection + BPM / drop analysis + a 9-frame contact sheet produce a replicable `MOTION.md`.
- **Audio** - BPM cut snapping, 48 kHz SFX mastering, multi-engine TTS (Windows native / Edge-TTS / local cloning).
- **BYOK cloud media** - Seedream, Seedance, Kling, Flux, Suno, MiniMax and a custom HTTP protocol; can follow Ruodao models or the local image account pool.
- **MCP tools** - 41 tools exposed to the agent (storyboard, narration, render, QA, export).

## Install

1. Install from the Ruodao plugin marketplace.
2. Pick a workspace and model on first launch; aspect ratio, duration and style live under "Director".
3. Add your own keys under Settings -> Cloud generation if you want cloud media; Pexels / Pixabay keys are entered in the page as well.

## Permissions and privacy

- `storage`, `process`, `network`, `clipboard`.
- Projects, assets and renders stay in your local workspace. Cloud generation only happens with a key you configured and an explicit action.
- No local paths, keys or personal data are collected.

## License

MIT. Upstream copyright Merziller; integration layer copyright Ruodao.
