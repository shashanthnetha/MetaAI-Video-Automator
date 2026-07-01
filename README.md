# 🚀 Meta AI Video Automator

A Chrome Extension + Python WebSocket Server that automates **Meta AI video generation** through the browser.

The project communicates with a local Python server over WebSockets, accepts generation requests, submits prompts to Meta AI, tracks the automation lifecycle, and streams real-time status updates back to the server.

> **Status:** 🚧 Active Development

---

# ✨ Features

- 🎬 Automated text-to-video generation
- 🌐 Chrome Extension (Manifest V3)
- 🔌 Local WebSocket communication
- ⚡ Real-time status streaming
- 📡 Command dispatcher architecture
- 🤖 Automatic prompt submission
- 🔄 Auto reconnection to local server
- 📊 Live telemetry & logging
- 🛠 Modular automation pipeline

---

# 🏗 Architecture

```
                    ┌──────────────────────┐
                    │   Python Server      │
                    │     server.py        │
                    └──────────┬───────────┘
                               │
                     WebSocket (localhost:8765)
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Chrome Extension     │
                    │ Background Worker    │
                    └──────────┬───────────┘
                               │
                      Command Dispatcher
                               │
         ┌─────────────────────┴─────────────────────┐
         │                                           │
         ▼                                           ▼
  Launcher Module                            Content Script
         │                                           │
         └─────────────────────┬─────────────────────┘
                               ▼
                    https://www.meta.ai/create
                               │
                               ▼
                     Meta AI Video Generation
```

---

# 📂 Project Structure

```
.
├── background.js          # Background Service Worker
├── content.js             # Browser automation logic
├── launcher.js            # Automation launcher
├── manifest.json          # Chrome extension manifest
├── sidebar.html           # Extension UI
├── sidebar.css
├── sidebar.js
├── server.py              # Local WebSocket server
├── icons/
└── README.md
```

---

# ⚙️ Technology Stack

### Frontend

- JavaScript (ES6)
- Chrome Extensions Manifest V3
- HTML
- CSS

### Backend

- Python 3
- asyncio
- websockets

### Communication

- WebSocket Protocol

---

# 🔄 Automation Flow

```
Server Starts
      │
      ▼
Extension Connects
      │
      ▼
HELLO Handshake
      │
      ▼
PING / PONG
      │
      ▼
GENERATE Command
      │
      ▼
Prompt Validation
      │
      ▼
Launch Automation
      │
      ▼
Inject Content Script
      │
      ▼
Populate Prompt
      │
      ▼
Click Create
      │
      ▼
Meta AI Generates Video
      │
      ▼
Stream Status Updates
      │
      ▼
Automation Complete
```

---

# 📡 WebSocket Protocol

## HELLO

```json
{
  "type": "HELLO",
  "extension": "Meta AI Automator",
  "version": "0.2"
}
```

---

## PING

```json
{
  "type": "PING"
}
```

---

## PONG

```json
{
  "type": "PONG"
}
```

---

## GENERATE

```json
{
  "id": "job001",
  "type": "GENERATE",
  "provider": "meta",
  "mode": "text",
  "prompt": "A futuristic city at sunset"
}
```

---

## ACK

```json
{
  "id": "job001",
  "type": "ACK",
  "accepted": true
}
```

---

## STATUS

```json
{
  "id": "job001",
  "type": "STATUS",
  "status": "running"
}
```

Possible status values:

- starting
- launching
- running
- waiting_generation
- downloading
- completed
- error

---

# 🚀 Getting Started

## 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/MetaAI-Video-Automator.git
```

---

## 2. Install Python dependencies

```bash
pip install websockets
```

---

## 3. Start the server

```bash
python server.py
```

---

## 4. Load the extension

1. Open Chrome
2. Navigate to:

```
chrome://extensions
```

3. Enable **Developer Mode**
4. Click **Load unpacked**
5. Select the project folder

---

## 5. Open Meta AI

Navigate to

```
https://www.meta.ai/create
```

---

# 📊 Current Workflow

```
Server
   │
   ▼
Send GENERATE
   │
   ▼
Extension validates request
   │
   ▼
Prompt injected
   │
   ▼
Create button clicked
   │
   ▼
Video generation begins
   │
   ▼
Status updates streamed
```

---

# 📌 Current Status

✅ WebSocket communication

✅ Service Worker integration

✅ Command dispatcher

✅ Automatic prompt injection

✅ Unified `/create` page support

✅ Real-time telemetry

✅ Status streaming

🚧 Download automation improvements in progress

🚧 Enhanced gallery detection

🚧 Improved generation tracking

---

# 🧪 Testing

The project has been verified through automated end-to-end testing covering:

- WebSocket connectivity
- Service Worker lifecycle
- Command dispatch
- Prompt submission
- Unified interface detection
- Status event streaming
- Automation pipeline

---

# 🎯 Future Roadmap

- Download generated videos automatically
- Queue multiple generation jobs
- Batch processing
- REST API wrapper
- Docker support
- Multiple AI provider support
- Remote server mode
- Authentication
- Job persistence
- Dashboard UI

---

# ⚠️ Disclaimer

This project is intended for educational and research purposes.

Users are responsible for complying with the terms of service of any platforms they automate.

---

# 👨‍💻 Author

**Shashanth**

B.Tech Student | Full Stack & AI Enthusiast

GitHub: https://github.com/YOUR_USERNAME

---

# ⭐ Support

If you found this project interesting, consider giving it a ⭐ on GitHub.
