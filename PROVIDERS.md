# Provider Configuration Quick Reference

## Cloud Providers

### OpenAI
- **Base URL**: `https://api.openai.com`
- **Models**: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o3-mini`
- **API Key**: Get at https://platform.openai.com/api-keys

### Anthropic (Claude)
- **Base URL**: `https://api.anthropic.com`
- **Models**: `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`
- **API Key**: Get at https://console.anthropic.com
- **Note**: System prompt is sent separately (handled automatically)

### Google Gemini
- **Base URL**: `https://generativelanguage.googleapis.com`
- **Models**: `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`
- **API Key**: Get at https://aistudio.google.com
- **Note**: Key is embedded in URL, different message format (handled automatically)

### Mistral
- **Base URL**: `https://api.mistral.ai`
- **Models**: `mistral-large-latest`, `mistral-small-latest`, `codestral-latest`
- **API Key**: Get at https://console.mistral.ai

### Groq (fastest inference)
- **Base URL**: `https://api.groq.com/openai`
- **Models**: `llama-3.3-70b-versatile`, `mixtral-8x7b-32768`, `gemma2-9b-it`
- **API Key**: Get at https://console.groq.com
- **Note**: OpenAI-compatible, extremely low latency

### xAI (Grok)
- **Base URL**: `https://api.x.ai`
- **Models**: `grok-2-latest`, `grok-2-vision-1212`
- **API Key**: Get at https://console.x.ai

### DeepSeek
- **Base URL**: `https://api.deepseek.com`
- **Models**: `deepseek-chat`, `deepseek-reasoner`
- **API Key**: Get at https://platform.deepseek.com
- **Note**: OpenAI-compatible, very cost-effective

### Cohere
- **Base URL**: `https://api.cohere.com`
- **Models**: `command-r-plus-08-2024`, `command-r-08-2024`
- **API Key**: Get at https://dashboard.cohere.com

### Together AI
- **Base URL**: `https://api.together.xyz`
- **Models**: `meta-llama/Llama-3-70b-chat-hf`, `mistralai/Mixtral-8x7B-Instruct-v0.1`
- **API Key**: Get at https://api.together.xyz
- **Note**: Runs open-source models in the cloud

### Perplexity
- **Base URL**: `https://api.perplexity.ai`
- **Models**: `llama-3.1-sonar-large-128k-online`, `llama-3.1-sonar-small-128k-online`
- **API Key**: Get at https://www.perplexity.ai/settings/api
- **Note**: Has web search built-in

### Custom (OpenAI-compatible)
- Any provider with a `/v1/chat/completions` endpoint
- Examples: OpenRouter, Fireworks AI, Anyscale

---

## Local LLM Options

### Ollama (recommended for beginners)
- **URL**: `http://localhost:11434`
- **Setup**:
  ```bash
  # Install
  curl -fsSL https://ollama.com/install.sh | sh
  # Pull a model
  ollama pull llama3
  # Start server
  ollama serve
  ```
- **Popular models**: `llama3`, `mistral`, `phi3`, `gemma2`, `qwen2`
- **API used**: Ollama native `/api/chat`

### llama.cpp server
- **URL**: `http://localhost:8080`
- **Setup**:
  ```bash
  # Build or download from https://github.com/ggerganov/llama.cpp/releases
  ./llama-server -m your-model.gguf --port 8080 -c 4096
  ```
- **Models**: Any GGUF format model from https://huggingface.co
- **API used**: OpenAI-compatible `/v1/chat/completions`

### LM Studio
- **URL**: `http://localhost:1234`
- **Setup**: Download from https://lmstudio.ai, load a model, click "Start Server"
- **API used**: OpenAI-compatible `/v1/chat/completions`

### Jan
- **URL**: `http://localhost:1337`
- **Setup**: Download from https://jan.ai, load a model, start the API server
- **API used**: OpenAI-compatible `/v1/chat/completions`

### Other OpenAI-compatible servers
- text-generation-webui, vLLM, LocalAI, etc.
- Set the correct port and it will work

---

## Recommended Models by Use Case

| Use Case | Recommended |
|---|---|
| Best quality (cloud) | `claude-3-5-sonnet-20241022` or `gpt-4o` |
| Best value (cloud) | `gpt-4o-mini` or `gemini-2.0-flash` |
| Fastest (cloud) | Groq `llama-3.3-70b-versatile` |
| Best local (high-end GPU) | Ollama `llama3` 70B |
| Best local (mid GPU / 8GB) | Ollama `llama3` 8B or `mistral` 7B |
| Best local (CPU / no GPU) | llama.cpp `phi3` Q4 |
| Privacy-first | Any local model |

---

## Temperature Guide

| Value | Behaviour |
|---|---|
| 0.0–0.3 | Focused, factual, deterministic |
| 0.4–0.7 | Balanced (recommended for Q&A) |
| 0.8–1.0 | Creative, varied |

---

## Privacy Levels

1. **Local LLM** — data never leaves your machine
2. **Mistral** — EU-based, GDPR compliant
3. **Anthropic / DeepSeek / Cohere** — strong data policies
4. **OpenAI / Google / xAI** — standard cloud terms
