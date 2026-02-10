# About OpenMoose

OpenMoose is a local-first AI assistant built for privacy, speed, and extensibility. Everything runs on your hardware -- no cloud required.

## How It Works

When you send a message, the gateway processes it through a pipeline:

1. **Intent Deconstruction** -- Complex queries like "check the weather in Berlin and send it to Vanja on WhatsApp" are broken into atomic actions ("get weather in Berlin", "send result to Vanja").
2. **Semantic Routing** -- Each action is matched against registered skills using local embedding similarity (Transformers.js). If confidence exceeds 0.68, the skill executes instantly without touching the LLM.
3. **LLM Fallback** -- Actions that don't match a skill route are handled by the full integrated LLM (`node-llama-cpp`) with tool calling. The brain iterates up to 10 tool call rounds to complete the task.
4. **Auto-capture** -- After responding, the system silently extracts useful facts from the conversation and stores them in vector memory for future recall.

## The Brain

The LLM interface uses the OpenAI-compatible chat completions API, which means it works with any provider that speaks that protocol:

- **Integrated Local Engine** (default) -- Ministral-8B Reasoning running via `node-llama-cpp`. Fast, private, free.
- **Mistral AI** -- Cloud-hosted models for higher capability when needed.

The brain supports streaming responses and native tool calling. System prompts are dynamically constructed with the current date/time, available tools, memory context, and skill definitions.

## The Memory

A dual-purpose vector database powered by LanceDB:

- **Chat Memory** -- Facts the assistant learns from conversations (e.g., "the user's name is Henric", "they prefer Python over JavaScript"). These are injected into the system prompt when semantically relevant to the current query.
- **Document Memory** -- Markdown files in the `docs/` directory are automatically chunked, embedded, and indexed on gateway startup. This lets the assistant answer questions grounded in your local knowledge base.

Embeddings are generated locally via Transformers.js (`xenova/all-MiniLM-L6-v2`).

## The Sandbox

All code execution is isolated in Docker containers with defense-in-depth:

- Read-only root filesystem prevents persistent modification
- All Linux capabilities are dropped
- Runs as non-root user (1000:1000)
- Resource limits on memory and CPU
- Timeout protection kills hanging processes
- Network isolation via bridge mode

Only skills explicitly marked with `host: true` can bypass the sandbox.

## The Voice

Text-to-speech uses Supertonic 2, a high-performance ONNX model that generates audio 167x faster than real-time. It supports 10 voice styles (5 male, 5 female) and 5 languages (English, Korean, Spanish, Portuguese, French). Audio is streamed as base64-encoded WAV over WebSocket.

## Semantic Router

The router pre-computes embeddings for skill examples at startup. When a message arrives, it computes the message embedding and finds the closest skill via cosine similarity. This enables sub-millisecond intent matching for common tasks (time, weather, messaging) without any LLM inference.

Skills scoring above 0.68 are executed directly. Skills scoring between 0.5 and 0.68 are noted but deferred to the LLM for confirmation.

## Portable Skills

Skills are defined as YAML files and loaded from the `skills/` directory. Each skill specifies:

- A name and description
- Example phrases for semantic matching
- A shell command with argument placeholders
- Whether to run on the host or in a Docker sandbox

Arguments are extracted from the user message using regex patterns. The `{{context}}` placeholder lets skills chain -- the output of a previous step becomes the input to the next.

## WhatsApp Integration

The assistant connects to WhatsApp via the Baileys library. It responds to:

- **Direct messages** -- All DMs are processed automatically.
- **Group messages** -- Only messages starting with "moose" trigger a response.

Contacts are auto-learned from incoming messages and synced from WhatsApp history, stored as a name-to-JID mapping in `.moose/data/contacts.json`.

## Task Scheduler

The scheduler supports three schedule types:

- **Cron** -- Standard cron expressions (e.g., `0 9 * * *` for daily at 9 AM)
- **Interval** -- Repeat every N milliseconds
- **Once** -- Run at a specific ISO timestamp

Tasks are persisted to `.moose/data/tasks.json` and survive gateway restarts. Each task is defined by a natural language prompt that the agent runner executes when due.
