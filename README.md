# Agent-Shield

## Ollama setup

This project uses a local Ollama server for model calls. Install Ollama, start
the server, and pull the model configured in `.env`:

```bash
ollama pull llama3.2:3b
```

Copy `.env.example` to `.env` if needed. Set `OLLAMA_HOST` when Ollama is
running somewhere other than `http://127.0.0.1:11434`, and set `OLLAMA_MODEL`
to the model you pulled.