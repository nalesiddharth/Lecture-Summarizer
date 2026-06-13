import whisper
import torch

# 1. Verify that your GPU is actually available to PyTorch
if not torch.cuda.is_available():
    raise RuntimeError("GPU not found! Check your CUDA installation.")

print(f"Using GPU: {torch.cuda.get_device_name(0)}")

# 2. Load the model directly onto the GPU
# Options: 'tiny', 'base', 'small', 'medium', 'large'
model = whisper.load_model("base", device="cuda")

# 3. Run transcription using FP16 for maximum GPU speed
result = model.transcribe("your_audio_file.mp3", fp16=True)

print(result["text"])
