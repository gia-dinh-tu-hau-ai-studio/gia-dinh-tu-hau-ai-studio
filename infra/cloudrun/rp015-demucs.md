# Demucs vocal separation for RP015

## Purpose

The RP015 clean Voice Reference operation uses Demucs `htdemucs_ft` in two-stem
mode and keeps only `vocals.wav`. FFmpeg is used only after separation to normalize
the vocal stem to mono, 48 kHz, PCM WAV.

The legacy FFmpeg attenuation result remains rejected as
`REJECTED_BACKGROUND_MUSIC_REMAINS`. Demucs creates a new V2 production job and a
new approval gate. It does not call Suno, Kits AI, Runway, or enable rendering.

## Required Cloud Run settings

The API image includes PyTorch, Demucs, the pinned model and FFmpeg. Before production
execution, deploy `ai-executor-api` with at least:

- 2 CPU
- 4 GiB memory
- request timeout 900 seconds
- concurrency 1

Example update:

```bash
gcloud run services update ai-executor-api \
  --project=tu-hau-ai-music \
  --region=asia-southeast1 \
  --cpu=2 \
  --memory=4Gi \
  --timeout=900 \
  --concurrency=1
```

Preserve the existing service account, environment variables, and Secret Manager
bindings. Do not run the production operation until the API revision is healthy.
