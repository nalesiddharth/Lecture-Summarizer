let files = []; // Store the fetched files globally

// Function to fetch files from the backend
// Fetch files from the backend and render them
function fetchFiles() {
    fetch('http://127.0.0.1:5000/get-files')
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                files = data.files; // Update the global files array
                renderFiles(files); // Render the files in the table
                populateSubjectDropdown(); // Update the subject dropdown
            } else {
                console.warn('Backend returned non-success for /get-files:', data);
                loadFromLocalStorage();
            }
        })
        .catch(error => {
            console.warn('Error fetching files (backend may be offline):', error);
            // Fallback to localStorage if backend isn't available
            loadFromLocalStorage();
        });
}

function loadFromLocalStorage() {
    try {
        const stored = localStorage.getItem('summarizedFiles');
        if (stored) {
            files = JSON.parse(stored);
            renderFiles(files);
            populateSubjectDropdown();
        } else {
            files = [];
            renderFiles(files);
        }
    } catch (e) {
        console.error('Failed to load summaries from localStorage', e);
        files = [];
        renderFiles(files);
    }
}

// Render the files in the table
function renderFiles(filteredFiles) {
    const filesBody = document.getElementById('files-body');
    filesBody.innerHTML = ''; // Clear existing files

    filteredFiles.forEach(file => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${file.name}</td>
            <td>${file.subject || 'Unknown'}</td>
            <td>${file.date || 'Unknown'}</td>
            <td>
                <button onclick="downloadFile('${file.filename}')">Download</button>
                <button onclick="viewFile('${file.filename}')">View</button>
            </td>
        `;
        filesBody.appendChild(row);
    });
}

// Populate the subject dropdown dynamically
function populateSubjectDropdown() {
    const subjectFilter = document.getElementById('subject-filter');
    const subjects = [...new Set(files.map(file => file.subject))]; // Get unique subjects

    // Clear existing options (except the "All" option)
    subjectFilter.innerHTML = '<option value="">All</option>';

    // Add subjects to the dropdown
    subjects.forEach(subject => {
        const option = document.createElement('option');
        option.value = subject;
        option.textContent = subject;
        subjectFilter.appendChild(option);
    });
}

// Fetch and display files on page load
// Fetch and display files on page load
window.onload = function() {
    fetchFiles();
};


// Filter files based on subject and date
function filterFiles() {
    const subjectFilter = document.getElementById('subject-filter').value;
    const dateFilter = document.getElementById('date-filter').value;

    const filteredFiles = files.filter(file => {
        const matchesSubject = subjectFilter === '' || file.subject === subjectFilter;
        const matchesDate = dateFilter === '' || file.date === dateFilter;
        return matchesSubject && matchesDate;
    });

    renderFiles(filteredFiles);
}

// Search files by name
function searchFiles() {
    const searchTerm = document.getElementById('search-bar').value.toLowerCase();
    const filteredFiles = files.filter(file => file.name.toLowerCase().includes(searchTerm));
    renderFiles(filteredFiles);
}

// Refresh the files by fetching them again from the backend
function refreshFiles() {
    fetchFiles();
}

// Download a file (dummy implementation)
function downloadFile(filename) {
    // Trigger browser download from the server
    const url = `http://127.0.0.1:5000/download/${encodeURIComponent(filename)}`;
    window.location.href = url;
}

// View a file's content
function viewFile(filename) {
    const url = `http://127.0.0.1:5000/file/${encodeURIComponent(filename)}`;
    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (data && data.status === 'success') {
                const w = window.open('', '_blank');
                w.document.write('<pre>' + escapeHtml(data.content) + '</pre>');
                w.document.title = filename;
            } else {
                alert('Failed to load file: ' + (data.error || 'Unknown'));
            }
        })
        .catch(err => {
            console.error('Error fetching file content', err);
            alert('Error fetching file content');
        });
}

function escapeHtml(unsafe) {
    return unsafe.replace(/[&<>"'`]/g, function (s) {
        return ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '`': '&#96;'
        })[s];
    });
}

// Fetch and display files on page load
window.onload = function() {
    fetchFiles();
};
