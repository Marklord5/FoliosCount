#!/bin/sh
# Levanta la calculadora con la sección INE en http://localhost:8000 (doble clic en Finder o ./iniciar.command)
cd "$(dirname "$0")" || exit 1
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"  # tesseract y python3.12 de Homebrew aunque se abra desde Finder

[ -d .venv ] || python3.12 -m venv .venv || exit 1
if [ requirements.txt -nt .venv/instalado ]; then
  .venv/bin/pip install -r requirements.txt && touch .venv/instalado || exit 1
fi

(until curl -s -o /dev/null http://localhost:8000; do sleep 1; done; open http://localhost:8000) &
exec .venv/bin/uvicorn app:app --port 8000
