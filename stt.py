import whisper

model = whisper.load_model("base.en", device="cuda")
transcription = ""
transcription = whisper.transcribe(model, 'cheetahs.mp3')
print(transcription["text"])