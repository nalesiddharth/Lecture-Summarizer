# AI Lecture Summarizer

This project records or accepts audio uploads, transcribes the audio using Whisper, and generates concise summaries using an external summarization API. Summaries are cleaned and persisted server-side so they can be listed, viewed, and downloaded later.

Features
--------
- Record or upload audio from the browser UI (`index.html`).
- Server-side transcription using Whisper (`test.py`).
- Summarization via an external API (configured with `ARLIAI_API_KEY`).
- Deterministic local fallback summarizer when the external API is unreachable.
- Sanitization: model control tokens/tags are stripped from summaries before returning or saving.
- Server-side persistence: summaries saved under the `summaries/` folder with an `index.json` index.

Requirements
------------
- Python 3.8+
- See `requirements.txt` for exact Python package versions.

Installation
------------
1. Clone the repository and change into the project folder.

2. (Recommended) Create and activate a virtual environment:

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Set your summarization API key (do NOT commit keys to git):

Windows PowerShell:
```powershell
$env:ARLIAI_API_KEY = "your_api_key_here"
```
macOS / Linux:
```bash
export ARLIAI_API_KEY="your_api_key_here"
```

Running the server
------------------
Start the backend server (development mode):

```bash
python test.py
```

The server runs at `http://127.0.0.1:5000` by default. Open `index.html` in your browser (or serve it via a static server) to access the UI that records/uploads audio and interacts with the backend.

API Endpoints
-------------
- `POST /transcribe` — multipart form upload with field `audio` (file). Returns JSON:
  - `transcription`: the transcribed text
  - `summary`: cleaned, bullet-form summary (up to 4 bullets)
  - `fallback`: boolean (true if the local fallback summarizer was used)

  Example:
  ```bash
  curl -X POST -F "audio=@lecture.wav" http://127.0.0.1:5000/transcribe
  ```

- `POST /save-summary` — save a summary to disk. Expects JSON `{ "name": ..., "subject": ..., "date": ..., "summary": ... }`. Returns `{status,file}` on success.

- `GET /get-files` — returns the `index.json` listing saved summaries.

- `GET /file/<filename>` — returns the saved file content as JSON `{status,content}`.

- `GET /download/<filename>` — downloads the saved file as an attachment.

Saved summaries are stored in the `summaries/` directory with an `index.json` index.

Sanitization & Fallback
-----------------------
- The server removes model control tokens (for example `<|...|>`) and common tags before returning or saving summaries. This prevents internal reasoning artifacts and tokens from appearing in the UI.
- If the external summarization API is unreachable, the server returns a deterministic local fallback summary (up to 4 bullets) and sets the response field `fallback: true` so the client can indicate that fallback was used.

Troubleshooting
---------------
- Whisper model download: the first run may download model files which requires disk space and time.
- API connectivity: if requests to the external summarization API fail, the server logs the error and returns the local fallback summary.
- Missing API key: ensure `ARLIAI_API_KEY` is set in your environment.

Development notes
-----------------
- Main server code: `test.py` (Flask app). The file contains the transcription, summarization call, sanitization (`clean_summary()`), and server-side storage logic.
- Frontend UI: `index.html`, `script.js`, and `styles.css` — records/uploads audio and interacts with the backend.

License
-------
This project is provided as-is for demonstration and educational purposes.