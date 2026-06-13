let mediaRecorder;
let audioChunks = [];
let audioPlayer = document.getElementById('audio-player');
let playButton = document.getElementById('play-btn');
let removeButton = document.getElementById('remove-btn');
let durationDisplay = document.getElementById('duration');
let saveButton = document.getElementById('save-btn');
let summarizeButton = document.getElementById('summarize-btn');
let isRecording = false;
let audioBlob = null; // Store the audio blob for recorded or uploaded audio

// Start recording audio
function startRecording() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.start();
            isRecording = true;
            audioChunks = []; // Reset audio chunks
            updateButtonStates();

            mediaRecorder.ondataavailable = function (event) {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstart = function () {
                document.getElementById('recording-status').style.display = 'block'; // Show recording status
                document.getElementById('recording-status').textContent = 'Recording...'; // Set status text
            };

            mediaRecorder.onstop = function () {
                audioBlob = new Blob(audioChunks, { type: 'audio/wav' }); // Store the recorded audio
                const audioUrl = URL.createObjectURL(audioBlob);
                audioPlayer.src = audioUrl;
                audioPlayer.style.display = 'block';

                // Calculate duration based on audio chunks
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                audioBlob.arrayBuffer()
                .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
                .then(buffer => {
                    const audioDuration = buffer.duration;
                    const minutes = Math.floor(audioDuration / 60);
                    const seconds = Math.floor(audioDuration % 60);
                    durationDisplay.textContent = `Duration: ${minutes}m ${seconds}s`;
                    durationDisplay.style.display = 'block'; // Show duration
                })
                .catch(err => console.error('Audio processing error:', err));

                playButton.style.display = 'inline-block'; // Show play button
                summarizeButton.style.display = 'inline-block'; // Show summarize button
                removeButton.style.display = 'inline-block'; // Show remove button
                document.getElementById('recording-status').style.display = 'none'; // Hide recording status when stopped
            };
        })
        .catch(err => console.log('Error accessing microphone: ', err));
    } else {
        alert('Microphone not supported on this browser.');
    }
}

// Stop recording audio
function stopRecording() {
    if (isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        updateButtonStates();
    }
}

// Play the recorded audio
function playAudio() {
    audioPlayer.play(); // Play the recorded audio
}

// Remove the recorded audio
function removeAudio() {
    audioBlob = null; // Clear the audio blob
    audioPlayer.src = ''; // Clear the audio source
    audioPlayer.style.display = 'none'; // Hide audio player
    durationDisplay.textContent = ''; // Clear duration display
    durationDisplay.style.display = 'none'; // Hide duration display
    playButton.style.display = 'none'; // Hide play button
    summarizeButton.style.display = 'none'; // Hide summarize button
    removeButton.style.display = 'none'; // Hide remove button
    saveButton.style.display = 'none'; // Hide save button
    audioChunks = []; // Reset audio chunks
    updateButtonStates(); // Update button states
}

// Upload audio file
function uploadAudio() {
    const uploadFile = document.getElementById('upload-file').files[0];
    if (uploadFile) {
        audioBlob = uploadFile; // Store uploaded file as audioBlob
        generateSummary(); // Trigger summary generation
    } else {
        alert('Please select a file to upload.');
    }
}

// Send audio blob to the backend and generate a summary
function sendAudioToBackend(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'audio.wav'); // Use a generic name for both recorded and uploaded audio

    // Show loading indicator
    if (document.getElementById('loading-indicator')) {
        document.getElementById('loading-indicator').style.display = 'block';
    }

    fetch('http://127.0.0.1:5000/transcribe', {
        method: 'POST',
        body: formData,
        // Add headers for better error handling
        headers: {
            // Don't set Content-Type for FormData - let the browser set it
        }
    })
    .then(response => {
        // Hide loading indicator
        if (document.getElementById('loading-indicator')) {
            document.getElementById('loading-indicator').style.display = 'none';
        }

        // If server returned non-2xx, try to parse JSON body for a friendly error
        if (!response.ok) {
            return response.json().then(err => {
                const msg = err && (err.error || err.details || err.message) ? (err.error || err.details || err.message) : `HTTP ${response.status}`;
                throw new Error(msg);
            }).catch(() => {
                throw new Error(`HTTP error! status: ${response.status}`);
            });
        }

        return response.json();
    })
    .then(data => {
        if (data.summary) {
            document.getElementById('summary').textContent = data.summary;
            saveButton.style.display = 'inline-block'; // Show save button
        } else if (data.error) {
            alert('Error: ' + data.error);
        } else {
            console.warn('Unexpected response format:', data);
            alert('Received unexpected response from server. Check console for details.');
        }
    })
    .catch(error => {
        // Hide loading indicator
        if (document.getElementById('loading-indicator')) {
            document.getElementById('loading-indicator').style.display = 'none';
        }

        console.error('Error fetching backend response:', error);

        // More specific error handling
        if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
            alert('Failed to connect to server. Please ensure the Flask server is running on port 5000.');
        } else if (error.message.includes('HTTP error!')) {
            alert(`Server responded with error: ${error.message}`);
        } else {
            alert('Failed to generate summary. Please try again.');
        }
    });
}

// Generate a summary for recorded or uploaded audio
function generateSummary() {
    if (audioBlob) {
        sendAudioToBackend(audioBlob); // Send the audio blob to the backend
    } else {
        alert('No audio available for summarization. Please record or upload an audio file.');
    }
}

// Save the summary as a text file and metadata in localStorage
function saveSummary() {
    const docName = document.getElementById('doc-name').value;
    const docSubject = document.getElementById('doc-subject').value;
    const docDate = document.getElementById('doc-date').value;
    const summaryText = document.getElementById('summary').textContent;
    if (!(docName && docSubject && docDate && summaryText)) {
        alert('Please fill in all fields.');
        return;
    }

    // POST to server to save the summary
    const payload = {
        name: docName,
        subject: docSubject,
        date: docDate,
        summary: summaryText
    };

    fetch('http://127.0.0.1:5000/save-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data && data.status === 'success') {
            alert('Summary saved to server successfully!');
            document.getElementById('summary-form').style.display = 'none';
            // Optionally navigate to summarized files page
            window.location.href = 'summarized_files.html';
        } else {
            console.error('Save error', data);
            alert('Failed to save summary on server. See console for details.');
        }
    })
    .catch(err => {
        console.error('Error saving summary to server', err);
        alert('Failed to save summary to server.');
    });
}

// Show the summary form
function showSummaryForm() {
    document.getElementById('summary-form').style.display = 'block';
}

// Hide the summary form
function cancelSummaryForm() {
    document.getElementById('summary-form').style.display = 'none';
}

// Update button states based on recording status
function updateButtonStates() {
    document.getElementById('start-btn').disabled = isRecording;
    document.getElementById('stop-btn').disabled = !isRecording;
    playButton.disabled = isRecording;
    summarizeButton.disabled = isRecording;
}