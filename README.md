# RAG Chat

Chat with your Obsidian vault using any AI provider. Ask questions in natural language and get answers grounded in your actual notes, with clickable source citations.

**No Python backend, no external server, no setup required.** Everything runs inside Obsidian.

## How it works

1. When the plugin loads it indexes all your markdown notes using a built-in BM25 full-text search engine — no embeddings, no external model, no network calls for indexing.
2. When you ask a question, the top matching note chunks are retrieved and sent as context to your chosen LLM.
3. The answer is displayed in a chat panel alongside clickable source citations that open the referenced note.
4. The index stays up to date automatically as you create, edit, rename or delete notes.

## Supported AI providers

| Provider | Notes |
|---|---|
| OpenAI | GPT-4o, GPT-4, GPT-3.5, etc. |
| Anthropic | Claude 3.5 Sonnet, Claude 3, etc. |
| Google | Gemini 2.0 Flash, Gemini 1.5, etc. |
| Mistral | Mistral Large, Mistral Small, etc. |
| Groq | Fast inference for Llama, Mixtral, etc. |
| xAI | Grok |
| DeepSeek | DeepSeek Chat, DeepSeek Coder |
| Cohere | Command R+ |
| Together AI | Open-source models |
| Perplexity | Sonar models |
| Ollama | Local — llama3, mistral, phi3, etc. |
| llama.cpp | Local — any GGUF model |
| LM Studio | Local — any model |
| Jan | Local — any model |
| Custom | Any OpenAI-compatible API |

## Installation

Install via Obsidian's Community Plugins browser:

1. Open **Settings → Community plugins**
2. Disable **Restricted mode** if enabled
3. Click **Browse** and search for **RAG Chat**
4. Click **Install**, then **Enable**

## Setup

1. Open **Settings → RAG Chat**
2. Select your **provider** from the dropdown
3. Enter your **API key** (not required for local providers)
4. Check the **data consent** toggle
5. The plugin will automatically index your vault on first load

## Usage

- Click the **chat icon** (💬) in the left ribbon to open the chat panel
- Type a question and press **Enter** (or **Shift+Enter** for a new line)
- Click any source citation to jump directly to that note
- Use **Settings → Rebuild index** if you ever need to force a full re-index

## Privacy

- **Indexing is fully local.** Note content is tokenised and stored on-device only; nothing is sent to any server during indexing.
- **Your notes are sent to your chosen LLM provider** when you ask a question (only the top matching chunks, not your entire vault). If this concerns you, use a local provider such as Ollama.
- API keys are stored in Obsidian's plugin data folder on your device.

## Local LLM (no API key needed)

Select **Local LLM** as the provider, choose your server type (Ollama, llama.cpp, LM Studio, Jan, or other OpenAI-compatible), enter the server URL and model name, and you're done. No API key required.

Quick start with Ollama:

```
ollama serve
ollama pull llama3
```

Then set provider → Local LLM, type → Ollama, URL → `http://localhost:11434`, model → `llama3`.

## Troubleshooting

**No results / poor answers**
Go to Settings → RAG Chat and click **Rebuild index**. This re-indexes all notes from scratch.

**API errors**
Check that your API key is correct and the selected model name matches what your provider offers.

**Local LLM not reachable**
Use the **Test** button in settings to verify the server URL. Make sure your local server is running before sending a message.

## License

MIT — see [LICENSE](LICENSE)
