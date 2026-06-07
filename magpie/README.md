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
# System ffmpeg is preferred, but requirements.txt also installs imageio-ffmpeg
# as a Mac-friendly fallback for HD merging + mp3 extraction.
# Optional: macOS: brew install ffmpeg   |   Debian/Ubuntu: sudo apt install ffmpeg
uvicorn app:app --reload
```

Open <http://127.0.0.1:8000>, paste a link, pick a quality. If port 8000 is
busy, run uvicorn with `--port 8010` and open <http://127.0.0.1:8010>. Deep
links work too: `http://127.0.0.1:8010/?url=<video-url>` (or `#url=`).


## GitHub Pages mode

GitHub Pages can host the UI, but it cannot run Python, yt-dlp, or ffmpeg. The
`magpie/index.html` page is therefore a static front end that tries to talk to
the local helper at `http://127.0.0.1:8000` or `http://127.0.0.1:8010` when opened from
`https://deanolmstead.github.io/idea-garden/magpie/`.

Start the helper on the **same machine as the browser** first — its `127.0.0.1`
is that computer's localhost, so the helper has to run there.

On Windows (PowerShell, from the `magpie` folder — see the full
[Windows 11 setup](#windows-11-setup) below for the first-time steps):

```powershell
.venv\Scripts\activate
python app.py
```

On macOS/Linux:

```bash
cd ~/idea-garden/magpie
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Either way the helper listens on `http://127.0.0.1:8010`. Then open the GitHub
Pages URL. If your browser blocks a public HTTPS page from calling a local
helper, use the page's **Open local helper** link instead. That opens the same
UI from FastAPI itself and avoids cross-origin/private-network browser policy
entirely.

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

## Windows 11 setup

magpie is pure Python and runs on Windows 11. `python app.py` serves the helper
on <http://127.0.0.1:8010>.

### 1. Install Python

1. Download **Python 3.11 or newer** from <https://www.python.org/downloads/windows/>.
2. Run the installer. **Check "Add python.exe to PATH"** on the first screen, then click **Install Now**.
3. Verify in a new PowerShell window:
   ```powershell
   python --version
   ```
   You should see `Python 3.11.x` or higher.

### 2. Get the magpie files

You have two options.

**Option A — Clone with Git (recommended)**

```powershell
cd $HOME
git clone https://github.com/deanolmstead/idea-garden.git
cd idea-garden\magpie
```

**Option B — Copy the folder manually**

Copy the entire `magpie` folder (containing `app.py`, `index.html`,
`requirements.txt`, `static/`) from your Mac to anywhere on your PC, e.g.
`C:\Users\<you>\magpie`, then:

```powershell
cd C:\Users\<you>\magpie
```

> Do **not** copy the `.venv` folder — you'll create a fresh one on Windows in the next step.

### 3. Create the virtual environment and install dependencies

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

You should see `(.venv)` at the start of your prompt while it's active.

The dependencies are:

- `fastapi`
- `uvicorn[standard]`
- `yt-dlp`
- `imageio-ffmpeg` — ships a Windows ffmpeg binary inside the wheel, so you do **not** need to install ffmpeg separately.

### 4. Run the helper

```powershell
python app.py
```

You'll see something like:

```
Uvicorn running on http://127.0.0.1:8010
```

Open <http://127.0.0.1:8010/> in your browser and you'll get the magpie UI.

The first time you launch it, Windows Defender / SmartScreen may prompt. Allow
it — the helper only listens on `127.0.0.1` (localhost), not the network.

### 5. One-click launcher (optional)

Create a file called **`run.bat`** in the `magpie` folder with this content:

```bat
@echo off
cd /d "%~dp0"
call .venv\Scripts\activate
python app.py
pause
```

Double-click `run.bat` to start the helper anytime. The `pause` keeps the
window open if there's an error.

For a desktop shortcut: right-click `run.bat` → **Send to** → **Desktop (create shortcut)**.

### 6. Using the live GitHub Pages page

The hosted magpie page (`https://deanolmstead.github.io/idea-garden/magpie/`)
talks to `http://127.0.0.1:8010` on **whatever machine the browser is on**. So
once the Windows helper is running, the same Pages URL works in your PC browser
too — no separate deployment needed.

If the page can't reach the helper (Chrome's private-network warning, etc.), use
the **"Open local helper"** fallback link on the page — it deep-links straight
into your local `http://127.0.0.1:8010/`.

### 7. Troubleshooting

| Problem | Fix |
|---|---|
| `python` not recognized | Reinstall Python with **"Add to PATH"** checked, or open a new PowerShell window. |
| `pip install` SSL errors | Run `python -m pip install --upgrade pip certifi` then retry. |
| Port 8010 already in use | Change the port in the `uvicorn.run(...)` call at the bottom of `app.py` (e.g. `port=8020`). |
| PowerShell blocks `.venv\Scripts\activate` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then retry. |
| Antivirus quarantines `ffmpeg.exe` | Whitelist the file inside `.venv\Lib\site-packages\imageio_ffmpeg\binaries\`. |
| `yt-dlp` says a site is broken | Update it: `pip install -U yt-dlp` |

### 8. Updating later

```powershell
cd C:\path\to\magpie
.venv\Scripts\activate
git pull              # if you cloned with git
pip install -U -r requirements.txt
```

Then `python app.py` (or double-click `run.bat`) again.
