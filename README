Obsidian RAG Chat Plugin
========================

A retrieval-augmented generation system that lets you chat with your Obsidian vault using any LLM provider. Built following Unix philosophy: do one thing well.

What is this?
-------------

This plugin turns your Obsidian notes into a searchable knowledge base. Ask questions in natural language, get answers backed by your actual notes with source citations. Click a source to jump straight to that note.

The system consists of two parts:
- Backend: FastAPI server handling vector search and LLM calls
- Frontend: Obsidian plugin providing the chat interface

Architecture
------------

The backend uses sentence-transformers for embeddings (all-MiniLM-L6-v2) and ChromaDB for vector storage. Files are chunked semantically, hashed for incremental updates, and indexed automatically on modification.

The frontend watches vault changes and keeps the index synchronized. When you ask a question, it retrieves relevant chunks, sends them with your question to your chosen LLM, and displays the response with clickable source citations.

Supported LLM Providers
-----------------------

- OpenAI (GPT-4, GPT-3.5, etc.)
- Anthropic (Claude)
- Google (Gemini)
- Mistral
- Any OpenAI-compatible API
- Local LLMs (llama.cpp, Ollama)

Installation
------------

### Prerequisites

Python 3.10+ and Node.js 18+

### Backend Setup

1. Install Python dependencies:

   cd backend
   pip install -r requirements.txt

2. Start the server:

   python main.py

The server runs on http://localhost:8000 by default.

### Plugin Setup

1. Build the plugin:

   cd plugin
   npm install
   npm run build

2. Copy built files to your Obsidian vault:

   mkdir -p /path/to/your/vault/.obsidian/plugins/obsidian-rag-chat
   cp main.js manifest.json styles.css /path/to/your/vault/.obsidian/plugins/obsidian-rag-chat/

3. In Obsidian:
   - Settings > Community Plugins
   - Disable "Restricted mode" if enabled
   - Enable "RAG Chat" plugin

### Configuration

1. Open plugin settings
2. Select your AI provider
3. Enter your API key
4. Enter the model name (e.g., gpt-4, claude-3-opus-20240229, gemini-2.0-flash-exp)
5. Optionally customize system prompt and temperature
6. Check the consent box
7. Click "Rebuild Index" to index your vault

Usage
-----

Click the chat icon in the left ribbon to open the chat panel. Type your question and press Enter or click Send.

The system automatically:
- Indexes new notes as you create them
- Re-indexes notes when you modify them
- Removes deleted notes from the index
- Updates the index when you rename notes

All indexing happens silently in the background. You only see notifications for initial indexing and manual rebuilds.

Performance
-----------

Indexing is incremental. Files are hashed (SHA256) and only re-indexed if content changes. The system uses a 1-second debounce on file modifications to avoid hammering the backend.

Vector search uses cosine similarity with a threshold of 1.6 (on a 0-2 scale). This filters out irrelevant results while keeping related content. Results are deduplicated by file to avoid showing multiple chunks from the same note.

Local LLM Support
-----------------

For privacy or offline use, point the system at a local LLM:

- llama.cpp server: http://localhost:8080
- Ollama: http://localhost:11434

Enable "Local LLM" in settings and no API key is required.

Privacy
-------

Your notes are sent to whatever LLM provider you configure. If this concerns you, use a local LLM. The backend never stores your notes permanently - only vector embeddings and file hashes.

The embedding model (all-MiniLM-L6-v2) runs locally. Your notes are not sent anywhere for embedding.

Development
-----------

Backend is a single Python file. Frontend is TypeScript compiled with esbuild. No frameworks, no unnecessary dependencies.

To modify:
1. Edit backend/main.py or plugin/main.ts
2. Restart backend or rebuild plugin
3. Reload plugin in Obsidian (Ctrl+R)

File Structure
--------------

backend/
  main.py           - FastAPI server with RAG pipeline
  requirements.txt  - Python dependencies
  chroma_db/        - Vector database (generated)

plugin/
  main.ts           - Plugin source code
  styles.css        - UI styling
  manifest.json     - Plugin metadata
  package.json      - Node dependencies
  esbuild.config.mjs - Build configuration

Troubleshooting
---------------

Backend won't start:
- Check Python version (3.10+)
- Install dependencies: pip install -r requirements.txt
- Check port 8000 is available

Plugin doesn't appear:
- Ensure files are in .obsidian/plugins/obsidian-rag-chat/
- Check console (Ctrl+Shift+I) for errors
- Verify "Restricted mode" is disabled

Index not updating:
- Check backend is running (http://localhost:8000/health)
- Verify backend URL in plugin settings
- Check file permissions on chroma_db directory

No search results:
- Click "Rebuild Index" in settings
- Check backend logs for errors
- Verify markdown files exist in vault

License
-------

MIT

This is free software. Use it, modify it, break it, fix it. No warranties.

Author
------

Built with the philosophy that software should be simple, direct, and do what it claims without magic or hidden complexity.
