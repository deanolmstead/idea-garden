# magpie

A tiny general-purpose video downloader — the **honest** version of sites like
pastedownload. Those sites are a styled front-end over a server that does the
real work with [`yt-dlp`](https://github.com/yt-dlp/yt-dlp). magpie is exactly
that, minus the ad-tech: a small FastAPI backend + a single-page UI.

## Why a backend is required

A browser **cannot** extract a video from another site on its own:

- **CORS** blocks a page from reading another origin's media/manifest.
- The real media URLs are **signed/tokenized server-side** and often need the
  right `Referer`/headers to fetch.

So the form, spinner, and "pick a quality" UI are just presentation. The
download capability is 100% the backend extractor. That's what magpie's
`app.py` is.

## How it works

```
browser  ──POST /api/info──▶  FastAPI  ──▶ yt-dlp.extract_info()  (probe, no download)
         ◀── title/thumb/qualities ──
browser  ──POST /api/download─▶ FastAPI ──▶ yt-dlp download → temp file
         ◀──────── file stream ────────     (ffmpeg merges video+audio / makes mp3)
```

- `POST /api/info` `{url}` → metadata + available heights.
- `POST /api/download` `{url, kind, height}` → streams the file
  (`kind`: `"video"` capped at `height`, or `"audio"` → mp3). Temp files are
  cleaned up after the response is sent.

## Run it

```bash
cd magpie
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# ffmpeg must be on PATH (for HD merging + mp3 extraction):
#   macOS: brew install ffmpeg   |   Debian/Ubuntu: sudo apt install ffmpeg
uvicorn app:app --reload
```

Open <http://127.0.0.1:8000>, paste a link, pick a quality. Deep links work too:
`http://127.0.0.1:8000/?url=<video-url>` (or `#url=`).

## Notes & limits

- Works with the ~1800 sites yt-dlp supports. If a site changes, run
  `pip install -U yt-dlp`.
- Without `ffmpeg`, HD that needs separate video+audio streams and mp3
  extraction won't work; it falls back to the best single progressive file.
- This downloads server-side to a temp dir then streams the file — fine for a
  personal/local tool, not tuned for many concurrent large downloads.

## Use responsibly

Only download content you have the right to: your own uploads, public-domain
material, or where the platform's terms **and** your local laws permit. A
downloader is a neutral tool — copyright and site terms still apply.
