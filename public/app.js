// ============================================================================
// CONFIGURATION & GLOBAL STATE
// ============================================================================
// Use current origin for production (Render) or localhost for development
const SERVER_URL = window.location.origin;
let socket;
let currentFlipbookId = '';
let currentFrameIndex = 0;
let frames = [];
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let allFlipbooks = [];
let isPlaying = false;
let playbackInterval = null;
let playbackSpeed = 5; // frames per second
let onionSkinEnabled = false;
let prevX = 0, prevY = 0;
let touchPrevX = 0, touchPrevY = 0;
let saveTimeout;
let modalAction = null;
let modalActionData = null;

// Canvas elements
const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const onionSkinCanvas = document.getElementById('onionSkinCanvas');
const onionSkinCtx = onionSkinCanvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const brushSize = document.getElementById('brushSize');
const brushSizeValue = document.getElementById('brushSizeValue');

// ============================================================================
// CANVAS INITIALIZATION & RESIZING
// ============================================================================
function resizeCanvas() {
    const container = canvas.parentElement.parentElement;
    const toolbar = document.querySelector('.toolbar');
    const frameNav = document.querySelector('.frame-navigation');
    const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
    const navHeight = frameNav ? frameNav.offsetHeight : 0;
    
    const maxWidth = container.clientWidth - 40;
    const maxHeight = container.clientHeight - toolbarHeight - navHeight - 60;
    const aspectRatio = 800 / 600;
    
    let newWidth = 800;
    let newHeight = 600;
    
    if (maxWidth < 800) {
        newWidth = maxWidth;
        newHeight = newWidth / aspectRatio;
    }
    
    if (maxHeight < newHeight) {
        newHeight = maxHeight;
        newWidth = newHeight * aspectRatio;
    }
    
    if (newWidth < 400) newWidth = 400;
    if (newHeight < 300) newHeight = 300;
    
    canvas.width = 800;
    canvas.height = 600;
    canvas.style.width = newWidth + 'px';
    canvas.style.height = newHeight + 'px';
    
    onionSkinCanvas.width = 800;
    onionSkinCanvas.height = 600;
    onionSkinCanvas.style.width = newWidth + 'px';
    onionSkinCanvas.style.height = newHeight + 'px';
    
    // Ensure onion skin canvas matches drawing canvas position
    onionSkinCanvas.style.position = 'absolute';
    onionSkinCanvas.style.top = '0';
    onionSkinCanvas.style.left = '0';
    
    if (currentFlipbookId) {
        loadCurrentFrame();
    }
}

function initCanvas() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colorPicker.value;
    ctx.lineWidth = brushSize.value;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    
    onionSkinCtx.imageSmoothingEnabled = true;
    onionSkinCtx.imageSmoothingQuality = 'high';
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function updateConnectionStatus(connected) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    if (connected) {
        statusDot.classList.remove('disconnected');
        statusText.textContent = 'Connected';
    } else {
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Disconnected';
    }
}

function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = 'notification';
    if (type === 'error') notification.classList.add('error');
    notification.style.background = type === 'error' ? '#ef4444' : '#10b981';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
}

function getCanvasCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function getCanvasCoordinatesTouch(touch) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY
    };
}

function debounceSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveCurrentFrame(), 1000);
}

// ============================================================================
// WEBSOCKET CONNECTION
// ============================================================================
function connectSocket() {
    // Socket.io automatically uses the current origin, so we don't need to pass SERVER_URL
    socket = io();

    socket.on('connect', () => {
        updateConnectionStatus(true);
        showNotification('Connected to server');
        loadFlipbooks();
        if (currentFlipbookId) {
            joinFlipbook();
        }
    });

    socket.on('disconnect', () => {
        updateConnectionStatus(false);
        showNotification('Disconnected from server', 'error');
    });

    socket.on('flipbook-state', (drawings) => {
        const sortedDrawings = drawings
            .map(d => ({
                flipbookId: d.flipbookId,
                frameIndex: d.frameIndex,
                drawingData: d.drawingData || null
            }))
            .sort((a, b) => a.frameIndex - b.frameIndex);
        
        frames = [];
        if (sortedDrawings.length > 0) {
            const maxIndex = Math.max(...sortedDrawings.map(d => d.frameIndex));
            for (let i = 0; i <= maxIndex; i++) {
                const drawing = sortedDrawings.find(d => d.frameIndex === i);
                frames[i] = drawing || {
                    flipbookId: currentFlipbookId,
                    frameIndex: i,
                    drawingData: null
                };
            }
        }
        
        if (frames.length === 0 && currentFlipbookId) {
            frames = [{
                flipbookId: currentFlipbookId,
                frameIndex: 0,
                drawingData: null
            }];
        }
        
        updateFramesList();
        loadCurrentFrame();
        updateCurrentFlipbookInfo();
        loadFlipbooks();
    });

    socket.on('drawing-updated', (data) => {
        if (data.flipbookId === currentFlipbookId) {
            while (frames.length <= data.frameIndex) {
                frames.push({
                    flipbookId: currentFlipbookId,
                    frameIndex: frames.length,
                    drawingData: null
                });
            }
            
            if (!frames[data.frameIndex]) {
                frames[data.frameIndex] = {
                    flipbookId: currentFlipbookId,
                    frameIndex: data.frameIndex,
                    drawingData: null
                };
            }
            
            frames[data.frameIndex].drawingData = data.drawingData;
            
            if (data.frameIndex === currentFrameIndex) {
                loadFrameData(data.drawingData);
            } else if (onionSkinEnabled && data.frameIndex === currentFrameIndex - 1) {
                updateOnionSkin();
            }
            
            updateFramesList();
        }
    });

    socket.on('frame-deleted', (data) => {
        if (data.flipbookId === currentFlipbookId) {
            frames = frames.filter(f => f.frameIndex !== data.frameIndex);
            if (currentFrameIndex >= frames.length) {
                currentFrameIndex = Math.max(0, frames.length - 1);
            }
            updateFramesList();
            loadCurrentFrame();
        }
    });

    socket.on('flipbook-deleted', (data) => {
        if (data.flipbookId === currentFlipbookId) {
            currentFlipbookId = '';
            frames = [];
            currentFrameIndex = 0;
            document.getElementById('flipbookId').value = '';
            updateFramesList();
            clearCanvas();
            updateCurrentFlipbookInfo();
        }
        loadFlipbooks();
    });

    socket.on('flipbook-renamed', (data) => {
        const { oldFlipbookId, newFlipbookId } = data;
        
        if (oldFlipbookId === currentFlipbookId) {
            currentFlipbookId = newFlipbookId;
            document.getElementById('flipbookId').value = newFlipbookId;
            socket.emit('join-flipbook', newFlipbookId);
            updateCurrentFlipbookInfo();
        }
        
        loadFlipbooks();
    });

    socket.on('drawing-error', (error) => {
        showNotification('Error: ' + error.error, 'error');
    });
}

// ============================================================================
// FLIPBOOK MANAGEMENT
// ============================================================================
function joinFlipbook() {
    if (isPlaying) stopPlayback();
    
    const flipbookIdInput = document.getElementById('flipbookId');
    const flipbookId = flipbookIdInput.value.trim();
    
    if (!flipbookId) {
        showNotification('Please enter a flipbook ID', 'error');
        return;
    }
    
    currentFlipbookId = flipbookId;
    
    if (socket && socket.connected) {
        socket.emit('join-flipbook', currentFlipbookId);
        showNotification(`Joined flipbook: ${currentFlipbookId}`);
        updateCurrentFlipbookInfo();
        updateFlipbooksListUI();
    } else {
        showNotification('Not connected to server', 'error');
    }
}

function createFlipbook() {
    const flipbookIdInput = document.getElementById('flipbookId');
    const flipbookId = flipbookIdInput.value.trim();
    
    if (!flipbookId) {
        openModal('Create New Flipbook', 'Enter flipbook name', 'create');
    } else {
        createFlipbookWithName(flipbookId);
    }
}

function createFlipbookWithName(flipbookId) {
    if (!flipbookId || flipbookId.trim() === '') {
        showNotification('Please enter a flipbook name', 'error');
        return;
    }

    currentFlipbookId = flipbookId.trim();
    document.getElementById('flipbookId').value = currentFlipbookId;
    
    if (socket && socket.connected) {
        socket.emit('join-flipbook', currentFlipbookId);
        showNotification(`Created flipbook: ${currentFlipbookId}`);
        frames = [];
        currentFrameIndex = 0;
        updateFramesList();
        clearCanvas();
        updateCurrentFlipbookInfo();
        loadFlipbooks();
    } else {
        showNotification('Not connected to server', 'error');
    }
}

async function loadFlipbooks() {
    try {
        const response = await fetch(`${SERVER_URL}/api/flipbooks`);
        if (response.ok) {
            allFlipbooks = await response.json();
            updateFlipbooksListUI();
        }
    } catch (error) {
        console.error('Error loading flipbooks:', error);
    }
}

function updateFlipbooksListUI() {
    const flipbooksList = document.getElementById('flipbooksList');
    const searchTerm = document.getElementById('flipbookSearch').value.toLowerCase();
    
    let filteredFlipbooks = allFlipbooks;
    if (searchTerm) {
        filteredFlipbooks = allFlipbooks.filter(fb => 
            fb.flipbookId.toLowerCase().includes(searchTerm)
        );
    }
    
    if (filteredFlipbooks.length === 0) {
        flipbooksList.innerHTML = `
            <div style="text-align: center; color: #64748b; padding: 20px;">
                ${searchTerm ? 'No flipbooks found' : 'No flipbooks yet. Create one!'}
            </div>
        `;
        return;
    }
    
    flipbooksList.innerHTML = filteredFlipbooks.map((flipbook) => {
        const isActive = flipbook.flipbookId === currentFlipbookId;
        const lastUpdated = flipbook.lastUpdated 
            ? new Date(flipbook.lastUpdated).toLocaleDateString()
            : 'Never';
        return `
            <div class="flipbook-item ${isActive ? 'active' : ''}" data-flipbook-id="${flipbook.flipbookId.replace(/"/g, '&quot;')}" style="cursor: pointer;">
                <div class="flipbook-item-header">
                    <div class="flipbook-item-name">${flipbook.flipbookId}</div>
                    <div class="flipbook-item-actions">
                        <button class="btn-edit" onclick="event.stopPropagation(); renameFlipbook('${flipbook.flipbookId.replace(/'/g, "\\'")}')" title="Rename flipbook">✎</button>
                        <button class="btn-delete" onclick="event.stopPropagation(); deleteFlipbook('${flipbook.flipbookId.replace(/'/g, "\\'")}')" title="Delete flipbook">×</button>
                    </div>
                </div>
                <div class="flipbook-item-meta">
                    <span>${flipbook.frameCount} frame${flipbook.frameCount !== 1 ? 's' : ''}</span>
                    <span>Updated: ${lastUpdated}</span>
                </div>
            </div>
        `;
    }).join('');
    
    flipbooksList.querySelectorAll('.flipbook-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.flipbook-item-actions')) return;
            const flipbookId = item.getAttribute('data-flipbook-id');
            if (flipbookId) selectFlipbook(flipbookId);
        });
    });
}

function selectFlipbook(flipbookId) {
    document.getElementById('flipbookId').value = flipbookId;
    joinFlipbook();
}

function filterFlipbooks() {
    updateFlipbooksListUI();
}

async function updateCurrentFlipbookInfo() {
    if (!currentFlipbookId) {
        document.getElementById('currentFlipbookInfo').style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${SERVER_URL}/api/flipbook/${currentFlipbookId}/info`);
        if (response.ok) {
            const info = await response.json();
            document.getElementById('currentFlipbookName').textContent = info.flipbookId;
            document.getElementById('currentFrameCount').textContent = info.frameCount;
            
            const lastUpdatedEl = document.getElementById('currentLastUpdated');
            if (info.lastUpdated) {
                const date = new Date(info.lastUpdated);
                lastUpdatedEl.textContent = `Last updated: ${date.toLocaleString()}`;
            } else {
                lastUpdatedEl.textContent = 'New flipbook';
            }
            
            document.getElementById('currentFlipbookInfo').style.display = 'block';
        }
    } catch (error) {
        console.error('Error fetching flipbook info:', error);
    }
}

async function deleteFlipbook(flipbookId) {
    if (!confirm(`Are you sure you want to delete "${flipbookId}"? This will delete all frames and cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/flipbook/${flipbookId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            const result = await response.json();
            showNotification(`Deleted flipbook: ${flipbookId} (${result.deletedCount} frames)`);
            
            if (flipbookId === currentFlipbookId) {
                currentFlipbookId = '';
                frames = [];
                currentFrameIndex = 0;
                document.getElementById('flipbookId').value = '';
                updateFramesList();
                clearCanvas();
                updateCurrentFlipbookInfo();
            }
            
            loadFlipbooks();
        } else {
            const error = await response.json();
            showNotification('Error: ' + (error.error || 'Failed to delete flipbook'), 'error');
        }
    } catch (error) {
        console.error('Error deleting flipbook:', error);
        showNotification('Error deleting flipbook', 'error');
    }
}

function deleteCurrentFlipbook() {
    if (currentFlipbookId) {
        deleteFlipbook(currentFlipbookId);
    }
}

function renameFlipbook(flipbookId) {
    openModal('Rename Flipbook', 'Enter new flipbook name', 'rename', flipbookId);
}

function renameCurrentFlipbook() {
    if (currentFlipbookId) {
        openModal('Rename Flipbook', 'Enter new flipbook name', 'rename', currentFlipbookId);
    }
}

async function renameFlipbookWithName(oldFlipbookId, newFlipbookId) {
    if (!newFlipbookId || newFlipbookId.trim() === '') {
        showNotification('Please enter a flipbook name', 'error');
        return;
    }

    const trimmedNewId = newFlipbookId.trim();

    if (trimmedNewId === oldFlipbookId) {
        showNotification('New name is the same as current name', 'error');
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/flipbook/${oldFlipbookId}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newFlipbookId: trimmedNewId })
        });

        if (response.ok) {
            showNotification(`Renamed flipbook to: ${trimmedNewId}`);
            
            if (oldFlipbookId === currentFlipbookId) {
                currentFlipbookId = trimmedNewId;
                document.getElementById('flipbookId').value = trimmedNewId;
                if (socket && socket.connected) {
                    socket.emit('leave-flipbook', oldFlipbookId);
                    socket.emit('join-flipbook', trimmedNewId);
                }
                updateCurrentFlipbookInfo();
            }
            
            loadFlipbooks();
        } else {
            const error = await response.json();
            showNotification('Error: ' + (error.error || 'Failed to rename flipbook'), 'error');
        }
    } catch (error) {
        console.error('Error renaming flipbook:', error);
        showNotification('Error renaming flipbook', 'error');
    }
}

// ============================================================================
// MODAL MANAGEMENT
// ============================================================================
function openModal(title, placeholder, action, actionData = null) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalFlipbookName').placeholder = placeholder;
    document.getElementById('modalFlipbookName').value = '';
    const confirmBtn = document.querySelector('#flipbookNameModal .btn-primary');
    confirmBtn.textContent = action === 'create' ? 'Create' : 'Rename';
    modalAction = action;
    modalActionData = actionData;
    document.getElementById('flipbookNameModal').classList.add('active');
    document.getElementById('modalFlipbookName').focus();
}

function closeModal() {
    document.getElementById('flipbookNameModal').classList.remove('active');
    modalAction = null;
    modalActionData = null;
}

function confirmModalAction() {
    const name = document.getElementById('modalFlipbookName').value.trim();
    
    if (!name) {
        showNotification('Please enter a flipbook name', 'error');
        return;
    }

    if (modalAction === 'create') {
        createFlipbookWithName(name);
    } else if (modalAction === 'rename') {
        renameFlipbookWithName(modalActionData, name);
    }
    
    closeModal();
}

// ============================================================================
// FRAME MANAGEMENT
// ============================================================================
async function addFrame() {
    if (!currentFlipbookId) {
        showNotification('Please join or create a flipbook first', 'error');
        return;
    }

    if (frames.length > 0 && currentFrameIndex < frames.length) {
        await saveCurrentFrame();
    }

    const newFrameIndex = frames.length;
    const emptyDrawingData = {
        imageData: null,
        timestamp: Date.now()
    };

    frames.push({
        flipbookId: currentFlipbookId,
        frameIndex: newFrameIndex,
        drawingData: emptyDrawingData
    });

    try {
        const response = await fetch(`${SERVER_URL}/api/flipbook/${currentFlipbookId}/frame/${newFrameIndex}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                drawingData: emptyDrawingData,
                createdBy: 'user'
            })
        });

        if (response.ok) {
            currentFrameIndex = newFrameIndex;
            updateFramesList();
            clearCanvas();
            loadCurrentFrame();
            updateCurrentFlipbookInfo();
            showNotification(`Added frame ${newFrameIndex + 1}`);
        } else {
            frames.pop();
            updateFramesList();
            showNotification('Failed to add frame', 'error');
        }
    } catch (error) {
        console.error('Error adding frame:', error);
        frames.pop();
        updateFramesList();
        showNotification('Error adding frame', 'error');
    }
}

function updateFramesList() {
    const framesList = document.getElementById('framesList');
    framesList.innerHTML = '';

    if (!currentFlipbookId) {
        framesList.innerHTML = `
            <div style="text-align: center; color: #64748b; padding: 20px; font-size: 12px;">
                Join or create a flipbook to add frames
            </div>
        `;
        return;
    }

    if (frames.length === 0 && currentFlipbookId) {
        framesList.innerHTML = `
            <div style="text-align: center; color: #64748b; padding: 20px; font-size: 12px;">
                No frames yet. Click "Add Frame" to start!
            </div>
        `;
        return;
    }

    frames.forEach((frame, index) => {
        const frameItem = document.createElement('div');
        frameItem.className = `frame-item ${index === currentFrameIndex ? 'active' : ''}`;
        const hasDrawing = frame.drawingData && frame.drawingData.imageData;
        frameItem.innerHTML = `
            <span class="frame-number">
                ${index + 1}${hasDrawing ? ' ✓' : ''}
            </span>
            ${frames.length > 1 ? `<button class="btn-icon" onclick="deleteFrame(${index})" title="Delete frame" style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">×</button>` : ''}
        `;
        frameItem.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON') {
                goToFrame(index);
            }
        };
        framesList.appendChild(frameItem);
    });
}

async function goToFrame(index) {
    if (index < 0 || index >= frames.length) return;
    if (isPlaying) stopPlayback();
    await saveCurrentFrame();
    currentFrameIndex = index;
    updateFramesList();
    loadCurrentFrame();
}

async function previousFrame() {
    if (isPlaying) stopPlayback();
    if (currentFrameIndex > 0) {
        await saveCurrentFrame();
        currentFrameIndex--;
        updateFramesList();
        loadCurrentFrame();
    }
}

async function nextFrame() {
    if (isPlaying) stopPlayback();
    await saveCurrentFrame();
    currentFrameIndex++;
    if (currentFrameIndex >= frames.length) {
        await addFrame();
    } else {
        updateFramesList();
        loadCurrentFrame();
    }
}

function loadCurrentFrame() {
    if (currentFrameIndex < 0 || currentFrameIndex >= frames.length) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Make canvas background transparent when empty so onion skin shows through
        canvas.style.backgroundColor = 'transparent';
        updateOnionSkin();
        updateFrameInfo();
        updateNavigationButtons();
        return;
    }
    
    const frame = frames[currentFrameIndex];
    
    if (frame && frame.drawingData && frame.drawingData.imageData) {
        loadFrameData(frame.drawingData);
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Make canvas background transparent when empty so onion skin shows through
        canvas.style.backgroundColor = 'transparent';
        updateOnionSkin();
    }
    updateFrameInfo();
    updateNavigationButtons();
}

function loadFrameData(drawingData) {
    if (drawingData && drawingData.imageData) {
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            // Restore white background when frame has content
            canvas.style.backgroundColor = 'white';
            updateOnionSkin();
        };
        img.onerror = () => {
            console.error('Error loading frame image');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // Make transparent when error
            canvas.style.backgroundColor = 'transparent';
            updateOnionSkin();
        };
        img.src = drawingData.imageData;
    } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Make transparent when empty
        canvas.style.backgroundColor = 'transparent';
        updateOnionSkin();
    }
}

function saveCurrentFrame() {
    if (!currentFlipbookId || currentFrameIndex < 0) return;
    
    const imageData = canvas.toDataURL();
    const drawingData = {
        imageData: imageData,
        timestamp: Date.now()
    };

    while (frames.length <= currentFrameIndex) {
        frames.push({
            flipbookId: currentFlipbookId,
            frameIndex: frames.length,
            drawingData: null
        });
    }

    if (!frames[currentFrameIndex]) {
        frames[currentFrameIndex] = {
            flipbookId: currentFlipbookId,
            frameIndex: currentFrameIndex,
            drawingData: null
        };
    }

    frames[currentFrameIndex].flipbookId = currentFlipbookId;
    frames[currentFrameIndex].frameIndex = currentFrameIndex;
    frames[currentFrameIndex].drawingData = drawingData;

    if (socket && socket.connected) {
        socket.emit('drawing-update', {
            flipbookId: currentFlipbookId,
            frameIndex: currentFrameIndex,
            drawingData: drawingData,
            createdBy: 'user-' + Math.random().toString(36).substr(2, 9)
        });
    }

    fetch(`${SERVER_URL}/api/flipbook/${currentFlipbookId}/frame/${currentFrameIndex}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            drawingData: drawingData,
            createdBy: 'user'
        })
    }).then(() => {
        updateCurrentFlipbookInfo();
        loadFlipbooks();
    }).catch(err => {
        console.error('Error saving frame:', err);
    });
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    saveCurrentFrame();
}

function deleteFrame(frameIndex) {
    if (isPlaying) stopPlayback();
    
    if (frames.length <= 1) {
        showNotification('Cannot delete the last frame', 'error');
        return;
    }

    if (!confirm(`Delete frame ${frameIndex + 1}?`)) {
        return;
    }

    const frameToDelete = frames[frameIndex];
    
    if (socket && socket.connected) {
        socket.emit('frame-delete', {
            flipbookId: currentFlipbookId,
            frameIndex: frameToDelete.frameIndex
        });
    }

    fetch(`${SERVER_URL}/api/flipbook/${currentFlipbookId}/frame/${frameToDelete.frameIndex}`, {
        method: 'DELETE'
    }).then(() => {
        frames = frames.filter((f, idx) => idx !== frameIndex);
        
        frames.forEach((frame, idx) => {
            frame.frameIndex = idx;
        });
        
        if (currentFrameIndex >= frames.length) {
            currentFrameIndex = frames.length - 1;
        } else if (currentFrameIndex > frameIndex) {
            currentFrameIndex--;
        }
        
        updateFramesList();
        loadCurrentFrame();
        updateCurrentFlipbookInfo();
        showNotification(`Deleted frame ${frameIndex + 1}`);
    }).catch(err => {
        console.error('Error deleting frame:', err);
        showNotification('Error deleting frame', 'error');
    });
}

function deleteCurrentFrame() {
    deleteFrame(currentFrameIndex);
}

function updateFrameInfo() {
    document.getElementById('frameInfo').textContent = `Frame ${currentFrameIndex + 1} of ${frames.length}`;
}

function updateNavigationButtons() {
    document.getElementById('prevBtn').disabled = currentFrameIndex === 0;
    document.getElementById('nextBtn').disabled = false;
}

// ============================================================================
// ONION SKIN
// ============================================================================
function toggleOnionSkin() {
    const checkbox = document.getElementById('onionSkinToggle');
    if (!checkbox) {
        console.error('Onion skin checkbox not found');
        return;
    }
    onionSkinEnabled = checkbox.checked;
    console.log('Onion skin toggled:', onionSkinEnabled, 'Current frame:', currentFrameIndex, 'Total frames:', frames.length);
    updateOnionSkin();
}

function updateOnionSkin() {
    if (!onionSkinCanvas || !onionSkinCtx) {
        console.error('Onion skin canvas not initialized');
        return;
    }
    
    // Always clear first
    onionSkinCtx.clearRect(0, 0, onionSkinCanvas.width, onionSkinCanvas.height);
    
    // Hide if disabled
    if (!onionSkinEnabled) {
        onionSkinCanvas.style.display = 'none';
        return;
    }
    
    // Hide if not enough frames or on first frame
    if (frames.length < 2 || currentFrameIndex === 0) {
        onionSkinCanvas.style.display = 'none';
        return;
    }
    
    // Show the canvas
    onionSkinCanvas.style.display = 'block';
    
    // Ensure sizes and position match exactly with the drawing canvas
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = canvas.parentElement.getBoundingClientRect();
    
    onionSkinCanvas.style.width = canvas.style.width;
    onionSkinCanvas.style.height = canvas.style.height;
    onionSkinCanvas.style.position = 'absolute';
    onionSkinCanvas.style.top = '0';
    onionSkinCanvas.style.left = '0';
    onionSkinCanvas.style.pointerEvents = 'none';
    onionSkinCanvas.style.zIndex = '3';
    onionSkinCanvas.style.background = 'transparent';
    onionSkinCanvas.style.mixBlendMode = 'multiply';
    
    console.log('Onion skin canvas positioned:', {
        width: onionSkinCanvas.style.width,
        height: onionSkinCanvas.style.height,
        display: onionSkinCanvas.style.display,
        zIndex: onionSkinCanvas.style.zIndex
    });
    
    // Get previous frame
    const prevFrame = frames[currentFrameIndex - 1];
    if (!prevFrame || !prevFrame.drawingData || !prevFrame.drawingData.imageData) {
        console.log('No previous frame data for onion skin');
        onionSkinCanvas.style.display = 'none';
        return;
    }
    
    console.log('Loading onion skin from frame', currentFrameIndex - 1);
    
    // Load and draw the previous frame
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        if (!onionSkinCanvas || !onionSkinCtx) {
            console.log('Canvas no longer available');
            return;
        }
        console.log('Onion skin image loaded, drawing...', 'Canvas size:', onionSkinCanvas.width, 'x', onionSkinCanvas.height);
        
        // Clear completely first
        onionSkinCtx.clearRect(0, 0, onionSkinCanvas.width, onionSkinCanvas.height);
        
        // Draw with transparency
        onionSkinCtx.save();
        onionSkinCtx.globalAlpha = 0.3;
        onionSkinCtx.drawImage(img, 0, 0, onionSkinCanvas.width, onionSkinCanvas.height);
        onionSkinCtx.restore();
        
        // Force browser to repaint
        onionSkinCanvas.style.opacity = '1';
        
        // Verify visibility
        const rect = onionSkinCanvas.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        
        console.log('Onion skin drawn successfully', {
            display: getComputedStyle(onionSkinCanvas).display,
            visibility: getComputedStyle(onionSkinCanvas).visibility,
            opacity: getComputedStyle(onionSkinCanvas).opacity,
            zIndex: getComputedStyle(onionSkinCanvas).zIndex,
            position: getComputedStyle(onionSkinCanvas).position,
            canvasBounds: { width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 },
            drawingCanvasBounds: { width: canvasRect.width, height: canvasRect.height }
        });
    };
    img.onerror = (e) => {
        console.error('Error loading onion skin image:', e);
        if (onionSkinCanvas) {
            onionSkinCanvas.style.display = 'none';
        }
    };
    img.src = prevFrame.drawingData.imageData;
}

// ============================================================================
// DRAWING HANDLERS
// ============================================================================
function drawPoint(x, y) {
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
}

function drawSmoothLine(prevX, prevY, lastX, lastY, currentX, currentY) {
    const cp1x = prevX + (lastX - prevX) * 0.5;
    const cp1y = prevY + (lastY - prevY) * 0.5;
    const cp2x = lastX + (currentX - lastX) * 0.5;
    const cp2y = lastY + (currentY - lastY) * 0.5;

    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, currentX, currentY);
    ctx.stroke();

    if (ctx.lineWidth > 10) {
        drawPoint(currentX, currentY);
    }
}

canvas.addEventListener('mousedown', (e) => {
    isDrawing = true;
    const coords = getCanvasCoordinates(e);
    lastX = coords.x;
    lastY = coords.y;
    prevX = lastX;
    prevY = lastY;
    drawPoint(lastX, lastY);
});

canvas.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;

    const coords = getCanvasCoordinates(e);
    const currentX = coords.x;
    const currentY = coords.y;

    drawSmoothLine(prevX, prevY, lastX, lastY, currentX, currentY);

    prevX = lastX;
    prevY = lastY;
    lastX = currentX;
    lastY = currentY;

    debounceSave();
});

canvas.addEventListener('mouseup', () => {
    if (isDrawing) {
        isDrawing = false;
        drawPoint(lastX, lastY);
        saveCurrentFrame();
    }
});

canvas.addEventListener('mouseleave', () => {
    if (isDrawing) {
        isDrawing = false;
        drawPoint(lastX, lastY);
        saveCurrentFrame();
    }
});

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const coords = getCanvasCoordinatesTouch(touch);
    lastX = coords.x;
    lastY = coords.y;
    touchPrevX = lastX;
    touchPrevY = lastY;
    isDrawing = true;
    drawPoint(lastX, lastY);
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!isDrawing) return;
    const touch = e.touches[0];
    const coords = getCanvasCoordinatesTouch(touch);
    const currentX = coords.x;
    const currentY = coords.y;

    drawSmoothLine(touchPrevX, touchPrevY, lastX, lastY, currentX, currentY);

    touchPrevX = lastX;
    touchPrevY = lastY;
    lastX = currentX;
    lastY = currentY;
    debounceSave();
});

canvas.addEventListener('touchend', () => {
    if (isDrawing) {
        isDrawing = false;
        drawPoint(lastX, lastY);
        saveCurrentFrame();
    }
});

// ============================================================================
// TOOL CONTROLS
// ============================================================================
colorPicker.addEventListener('change', (e) => {
    ctx.strokeStyle = e.target.value;
    ctx.fillStyle = e.target.value;
});

brushSize.addEventListener('input', (e) => {
    const newWidth = parseInt(e.target.value);
    ctx.lineWidth = newWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    brushSizeValue.textContent = newWidth;
});

// ============================================================================
// PLAYBACK CONTROLS
// ============================================================================
function togglePlayback() {
    if (frames.length < 2) {
        showNotification('Need at least 2 frames to play', 'error');
        return;
    }

    if (isPlaying) {
        stopPlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    if (isPlaying) return;
    
    saveCurrentFrame();
    
    isPlaying = true;
    const playBtn = document.getElementById('playBtn');
    playBtn.textContent = '⏸ Pause';
    playBtn.classList.add('playing');
    
    document.getElementById('prevBtn').disabled = true;
    document.getElementById('nextBtn').disabled = true;
    
    const interval = 1000 / playbackSpeed;
    
    playbackInterval = setInterval(() => {
        currentFrameIndex = (currentFrameIndex + 1) % frames.length;
        updateFramesList();
        loadCurrentFrame();
    }, interval);
}

function stopPlayback() {
    if (!isPlaying) return;
    
    isPlaying = false;
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    
    const playBtn = document.getElementById('playBtn');
    playBtn.textContent = '▶ Play';
    playBtn.classList.remove('playing');
    
    updateNavigationButtons();
}

const speedSlider = document.getElementById('playbackSpeed');
const speedValue = document.getElementById('speedValue');

if (speedSlider && speedValue) {
    speedSlider.addEventListener('input', (e) => {
        playbackSpeed = parseInt(e.target.value);
        speedValue.textContent = playbackSpeed + 'x';
        
        if (isPlaying) {
            stopPlayback();
            startPlayback();
        }
    });
}

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    const modalInput = document.getElementById('modalFlipbookName');
    if (modalInput) {
        modalInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                confirmModalAction();
            }
        });
    }
    
    document.getElementById('flipbookNameModal').addEventListener('click', (e) => {
        if (e.target.id === 'flipbookNameModal') {
            closeModal();
        }
    });
});

initCanvas();
connectSocket();
loadFlipbooks();
updateFramesList();
loadCurrentFrame();

