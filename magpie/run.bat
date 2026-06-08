@echo off
rem One-click launcher for the magpie helper on Windows.
rem Always runs from this script's own folder and activates the venv,
rem so it works no matter where it's double-clicked from.
cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
    echo First-time setup: creating virtual environment and installing dependencies...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    python -m pip install --upgrade pip
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

python app.py
pause
