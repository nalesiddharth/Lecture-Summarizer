from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import whisper
import os
import requests
import json
import time
from pathlib import Path
from werkzeug.utils import secure_filename
import logging
import tempfile
import re

app = Flask(__name__)
# Keep CORS permissive for local development; restrict in production
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load the Whisper model once at startup (may download models on first run)
try:
    model = whisper.load_model("base.en")
    logger.info("Loaded Whisper model: base.en")
except Exception as e:
    logger.error("Failed to load Whisper model: %s", e)
    model = None

API_KEY = "YOUR_API_KEY_HERE"
SUMMARIZATION_API_URL = "https://api.arliai.com/v1/completions"

# Max upload size (10 MB)
MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_EXTS = {'.wav', '.mp3', '.m4a', '.flac', '.ogg'}


@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    if model is None:
        return jsonify({'error': 'Transcription model not loaded'}), 500

    # Check if an audio file is provided
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['audio']
    filename = audio_file.filename or 'upload'
    _, ext = os.path.splitext(filename)
    ext = ext.lower()

    if ext not in ALLOWED_EXTS:
        return jsonify({'error': f'Unsupported file type: {ext}'}), 400

    # Try to determine size safely
    try:
        audio_file.stream.seek(0, os.SEEK_END)
        size = audio_file.stream.tell()
        audio_file.stream.seek(0)
    except Exception:
        data = audio_file.read()
        size = len(data)
        # If we read, reset the FileStorage stream by wrapping in BytesIO
        from io import BytesIO
        audio_file.stream = BytesIO(data)

    if size > MAX_FILE_SIZE:
        return jsonify({'error': 'File too large (max 10MB)'}), 400

    temp_path = None
    try:
        # Save to a secure temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            temp_path = tmp.name
            audio_file.save(temp_path)

        logger.info('Saved uploaded audio to %s (size=%d)', temp_path, size)

        # Transcribe the audio file
        result = model.transcribe(temp_path)
        transcription = result.get("text", "")
        logger.info("Transcription length=%d", len(transcription))

        # Require an API key at request time
        if not API_KEY:
            logger.error('Missing ARLIAI_API_KEY environment variable')
            return jsonify({'error': 'Server misconfiguration: missing API key'}), 500

        # Summarize the transcription using Arli AI (new completions endpoint)
        model_name = "Qwen3.5-27B-Derestricted"
        # Build a prompt that requests exactly 4 bullet points and blocks chain-of-thought
        instruction = (
            "Summarize the following transcript into exactly 4 concise bullet points. "
            "Do NOT include chain-of-thought, internal reasoning, or analysis. "
            "Output only 4 bullet points, each on its own line starting with a single dash and a space ('- ')."
        )

        prompt = (
            "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n"
            "You are a concise summarizer.\n\n"
            "<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n"
            f"{instruction}\n\nTranscript:\n{transcription}\n"
            "<|eot_id|>\n"
        )

        summary_payload = {
            "model": model_name,
            "prompt": prompt,
            "repetition_penalty": 1.1,
            "temperature": 0.3,
            "top_p": 0.9,
            "top_k": 40,
            "max_completion_tokens": 512,
            "stream": False
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}"
        }

        payload = json.dumps(summary_payload)
        response = requests.post(SUMMARIZATION_API_URL, headers=headers, data=payload, timeout=60)

        if response.status_code == 200:
            api_response = response.json()
            logger.debug("API Response: %s", api_response)

            # Try a few common response shapes for the completion text
            summary = None
            if isinstance(api_response, dict):
                if 'completion' in api_response:
                    summary = api_response.get('completion')
                elif 'output' in api_response:
                    summary = api_response.get('output')
                elif 'choices' in api_response and isinstance(api_response['choices'], list) and api_response['choices']:
                    choice = api_response['choices'][0]
                    summary = choice.get('text') or choice.get('message') or choice.get('content')

            if not summary:
                # Fallback to stringifying the response
                summary = json.dumps(api_response)

            # Clean the summary to remove control tokens/tags
            cleaned = clean_summary(summary)
            return jsonify({'transcription': transcription, 'summary': cleaned, 'fallback': False}), 200
        else:
            logger.error("Summarization API error %s: %s", response.status_code, response.text)
            return jsonify({'error': 'Failed to generate summary', 'details': response.text}), 500

    except Exception as e:
        logger.exception('Exception during /transcribe')
        # Provide a deterministic local fallback summary so the client still gets useful output
        tr = locals().get('transcription', '') or ''
        try:
            sents = re.split(r'(?<=[.!?])\s+', tr.strip()) if tr else []
            sents = [s.strip() for s in sents if len(s.strip()) > 20]
            if not sents and tr:
                parts = [p.strip() for p in tr.split(',') if len(p.strip()) > 20]
                sents = parts or [tr[:200].strip()]
            chosen = sents[:4] if sents else [tr[:200].strip()]
            fallback_summary = '\n'.join(['- ' + s for s in chosen])
        except Exception:
            fallback_summary = '- (No summary available)'

        cleaned = clean_summary(fallback_summary)
        return jsonify({'transcription': tr, 'summary': cleaned, 'fallback': True, 'error': str(e)}), 200

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
                logger.debug('Removed temp file %s', temp_path)
            except Exception:
                logger.warning('Failed to remove temp file %s', temp_path)


# --- Server-side storage for summaries ---------------------------------
STORAGE_DIR = Path.cwd() / 'summaries'
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
INDEX_FILE = STORAGE_DIR / 'index.json'

def load_index():
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text(encoding='utf-8'))
        except Exception:
            return []
    return []

def save_index(data):
    INDEX_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def clean_summary(text):
    """Remove model control tokens and tags, normalize into up to 4 bullet points."""
    if not text:
        return text
    # Remove tokens like <|...|>
    text = re.sub(r'<\|.*?\|>', ' ', text)
    # Remove tags like <think>...</think>
    text = re.sub(r'<\s*think\s*>.*?<\s*/\s*think\s*>', ' ', text, flags=re.S | re.I)
    # Remove any remaining angle-bracket tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    # If it already contains bullet lines, extract and normalize them
    if re.search(r'(^|\n)\s*-\s+', text):
        lines = [ln.strip() for ln in re.split(r'\n+', text) if ln.strip()]
        bullets = [re.sub(r'^[\s-]*', '', ln).strip() for ln in lines if re.match(r'\s*-\s+', ln)]
        if bullets:
            return '\n'.join(['- ' + b for b in bullets[:4]])

    # Otherwise split into sentences and pick up to 4 representative ones
    sents = re.split(r'(?<=[.!?])\s+', text)
    sents = [s.strip() for s in sents if len(s.strip()) > 20]
    if not sents:
        parts = [p.strip() for p in text.split(',') if len(p.strip()) > 20]
        sents = parts or [text[:200].strip()]

    chosen = sents[:4]
    return '\n'.join(['- ' + s for s in chosen])


@app.route('/save-summary', methods=['POST'])
def save_summary():
    try:
        data = request.get_json()
        name = data.get('name') or f'summary_{int(time.time())}'
        subject = data.get('subject', '')
        date = data.get('date', '')
        summary_text = data.get('summary', '')
        # Clean incoming summary text to avoid saving control tokens
        try:
            summary_text = clean_summary(summary_text)
        except Exception:
            pass

        # sanitize filename
        base_filename = secure_filename(name) or f'summary_{int(time.time())}'
        filename = f"{base_filename}_{int(time.time())}.txt"
        file_path = STORAGE_DIR / filename

        content = f"Title: {name}\nSubject: {subject}\nDate: {date}\n\nSummary:\n{summary_text}\n"
        file_path.write_text(content, encoding='utf-8')

        index = load_index()
        entry = {
            'name': name,
            'subject': subject,
            'date': date,
            'filename': filename,
            'created_at': int(time.time())
        }
        index.append(entry)
        save_index(index)

        return jsonify({'status': 'success', 'file': filename}), 200
    except Exception as e:
        logger.exception('Failed to save summary')
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/get-files', methods=['GET'])
def get_files():
    try:
        index = load_index()
        return jsonify({'status': 'success', 'files': index}), 200
    except Exception as e:
        logger.exception('Failed to load index')
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/download/<path:filename>', methods=['GET'])
def download_file(filename):
    try:
        return send_from_directory(str(STORAGE_DIR), filename, as_attachment=True)
    except Exception as e:
        logger.exception('Failed to send file')
        return jsonify({'status': 'error', 'error': str(e)}), 404


@app.route('/file/<path:filename>', methods=['GET'])
def get_file_content(filename):
    try:
        file_path = STORAGE_DIR / filename
        if not file_path.exists():
            return jsonify({'status': 'error', 'error': 'File not found'}), 404
        content = file_path.read_text(encoding='utf-8')
        return jsonify({'status': 'success', 'content': content}), 200
    except Exception as e:
        logger.exception('Failed to read file')
        return jsonify({'status': 'error', 'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)
