"""
magpie — a tiny general-purpose video downloader.

This is the honest version of sites like pastedownload: a styled front-end
over a backend that does the real extraction with yt-dlp. The browser cannot
do this on its own (CORS + URL signing live server-side), so all the actual
work happens here.

Run:
    pip install -r requirements.txt
    # ffmpeg must be on PATH for format merging / mp3 extraction
    python app.py            # serves on http://127.0.0.1:8010
    # or, for auto-reload during development:
    uvicorn app:app --reload # serves on http://127.0.0.1:8000
"""
from __future__ import annotations

import asyncio
import inspect
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator
from starlette.background import BackgroundTask

import yt_dlp

try:
    import imageio_ffmpeg
except Exception:  # noqa: BLE001 - optional fallback when system ffmpeg is installed
    imageio_ffmpeg = None

app = FastAPI(title="magpie", description="A tiny video downloader")

# Allow the GitHub Pages-hosted UI to talk to a local helper.
# GitHub Pages can host the interface, but yt-dlp + ffmpeg must run server-side
# on the Mac because Pages cannot run Python processes.
cors_options: dict[str, Any] = {
    "allow_origins": ["https://deanolmstead.github.io"],
    "allow_origin_regex": r"^http://(127\.0\.0\.1|localhost):\d+$",
    "allow_credentials": False,
    "allow_methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["*"],
    "expose_headers": ["Content-Disposition"],
}
if "allow_private_network" in inspect.signature(CORSMiddleware.__init__).parameters:
    cors_options["allow_private_network"] = True

app.add_middleware(CORSMiddleware, **cors_options)

STATIC_DIR = Path(__file__).parent / "static"

# yt-dlp is the workhorse. These options keep it quiet and predictable.
def _ffmpeg_location() -> Optional[str]:
    """Return a usable ffmpeg binary, preferring system ffmpeg when present."""
    system = shutil.which("ffmpeg")
    if system:
        return system
    if imageio_ffmpeg is not None:
        try:
            return imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:  # noqa: BLE001
            return None
    return None


BASE_YDL_OPTS: dict[str, Any] = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "nocheckcertificate": True,
    # A realistic UA helps with sites that gate on it.
    "http_headers": {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36"
        )
    },
}

_FFMPEG = _ffmpeg_location()
if _FFMPEG:
    BASE_YDL_OPTS["ffmpeg_location"] = _FFMPEG
@app.middleware("http")
async def _allow_private_network(request: Request, call_next):
    """Support GitHub Pages -> local helper requests in Chrome.

    Chrome may require Access-Control-Allow-Private-Network when a public HTTPS
    page calls a local helper. Add it on all responses so both preflight and
    non-preflight requests are accepted.
    """
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


class InfoRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def must_be_http_url(cls, v: str) -> str:
        v = v.strip()
        if not _URL_RE.match(v):
            raise ValueError("URL must start with http:// or https://")
        return v


class DownloadRequest(InfoRequest):
    # "video" picks the best mp4 up to `height`; "audio" extracts mp3.
    kind: str = "video"
    height: Optional[int] = None

    @field_validator("kind")
    @classmethod
    def kind_known(cls, v: str) -> str:
        if v not in ("video", "audio"):
            raise ValueError("kind must be 'video' or 'audio'")
        return v


def _extract_info(url: str) -> dict[str, Any]:
    """Probe a URL without downloading. Raises on extractor failure."""
    with yt_dlp.YoutubeDL(BASE_YDL_OPTS) as ydl:
        return ydl.extract_info(url, download=False)


def _summarize(info: dict[str, Any]) -> dict[str, Any]:
    """Reduce yt-dlp's huge info dict to what the UI needs."""
    heights: set[int] = set()
    has_audio_only = False
    for f in info.get("formats", []) or []:
        h = f.get("height")
        if h:
            heights.add(int(h))
        if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none"):
            has_audio_only = True

    duration = info.get("duration")
    return {
        "title": info.get("title") or "video",
        "uploader": info.get("uploader") or info.get("channel") or "",
        "thumbnail": info.get("thumbnail") or "",
        "duration": int(duration) if duration else None,
        "extractor": info.get("extractor_key") or info.get("extractor") or "",
        "webpage_url": info.get("webpage_url") or "",
        "heights": sorted(heights, reverse=True),
        "has_audio": has_audio_only or bool(heights),
    }


@app.post("/api/info")
async def api_info(req: InfoRequest) -> dict[str, Any]:
    try:
        info = await asyncio.to_thread(_extract_info, req.url)
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(status_code=422, detail=_clean_err(str(e)))
    except Exception as e:  # noqa: BLE001 - surface anything else cleanly
        raise HTTPException(status_code=500, detail=str(e))
    return _summarize(info)


def _safe_name(name: str) -> str:
    name = re.sub(r"[^\w\-. ]+", "_", name).strip()
    return (name or "video")[:120]


def _do_download(req: DownloadRequest, workdir: Path) -> Path:
    """Download to a temp dir and return the resulting file path."""
    outtmpl = str(workdir / "%(title).100s.%(ext)s")
    opts = dict(BASE_YDL_OPTS)
    opts["outtmpl"] = outtmpl

    if req.kind == "audio":
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ]
    else:
        cap = f"[height<={req.height}]" if req.height else ""
        # Prefer separate streams (merged to mp4) but fall back to progressive.
        opts["format"] = (
            f"bestvideo{cap}+bestaudio/best{cap}/best"
        )
        opts["merge_output_format"] = "mp4"

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(req.url, download=True)
        final = ydl.prepare_filename(info)
        path = Path(final)
        if req.kind == "audio":
            path = path.with_suffix(".mp3")
        elif not path.exists():
            # merge_output_format may have changed the extension
            path = path.with_suffix(".mp4")

    if not path.exists():
        # Last resort: grab whatever single file landed in the workdir.
        files = [p for p in workdir.iterdir() if p.is_file()]
        if not files:
            raise RuntimeError("download produced no file")
        path = max(files, key=lambda p: p.stat().st_size)
    return path


@app.post("/api/download")
async def api_download(req: DownloadRequest) -> FileResponse:
    workdir = Path(tempfile.mkdtemp(prefix=f"magpie_{uuid.uuid4().hex[:8]}_"))
    try:
        path = await asyncio.to_thread(_do_download, req, workdir)
    except yt_dlp.utils.DownloadError as e:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=_clean_err(str(e)))
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))

    filename = _safe_name(path.name)
    # Clean up the temp dir only after the response has been sent.
    cleanup = BackgroundTask(shutil.rmtree, workdir, ignore_errors=True)
    return FileResponse(
        path,
        filename=filename,
        media_type="application/octet-stream",
        background=cleanup,
    )


def _clean_err(msg: str) -> str:
    """yt-dlp errors are noisy; trim ANSI + the 'ERROR:' prefix."""
    msg = re.sub(r"\x1b\[[0-9;]*m", "", msg)
    msg = re.sub(r"^ERROR:\s*", "", msg.strip())
    return msg[:400]


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text(encoding="utf-8"))


# Anything else under /static (favicon etc.)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    # Convenience entry point so `python app.py` "just works" (e.g. the
    # Windows run.bat one-click launcher). For development with auto-reload,
    # prefer `uvicorn app:app --reload`.
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8010)
