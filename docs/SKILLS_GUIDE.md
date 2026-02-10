# Creating Custom Skills

OpenMoose is designed to be easily extensible. You can add new capabilities (skills) by simply creating YAML files in the `skills/` directory. No TypeScript or build steps required.

## Quick Start

1. Create a file named `skills/hn.yaml`:
   ```yaml
   name: hacker_news
   description: Get top stories from Hacker News
   examples:
     - "what is on hacker news?"
     - "hn top stories"
   command: "curl -s https://hacker-news.firebaseio.com/v0/topstories.json | python3 -c \"import sys, json, urllib.request; ids=json.load(sys.stdin)[:5]; print('\\n'.join([json.loads(urllib.request.urlopen(f'https://hacker-news.firebaseio.com/v0/item/{id}.json').read())['title'] for id in ids]))\""
   ```
2. Restart the gateway (`pnpm gateway`).
3. Ask: "What's on hacker news?".

## Skill Schema

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Unique identifier for the skill. |
| `description` | Yes | Human-readable purpose. |
| `examples` | Yes | Phrases that trigger this skill (used for semantic matching). |
| `args` | No | Definitions for extracting variables from the user's message. |
| `command` | Yes | The shell command to execute inside the sandbox. |
| `image` | No | Custom Docker image (defaults to `python:3.12-slim`). |

## Argument Extraction

You can extract variables from user input using regex patterns:

```yaml
args:
  city:
    patterns:
      - "weather in ([a-zA-Z\\s]+)"
      - "how is the weather in ([a-zA-Z\\s]+)"
    fallback: "Stockholm"
```

In your `command`, you can use these arguments:
- `{{city}}`: Shell-escaped value.
- `{{city|u}}`: URL-encoded value.

## Built-in Placeholders

| Placeholder | Description |
|---|---|
| `{{context}}` | The result of a previous step (or the raw input if it's the first step). |
| `{{text}}` | Alias for context. Automatically used if no specific args are extracted. |
| `{{message}}` | Alias for context. Automatically used if no specific args are extracted. |
| `{{arg|u}}` | URL-encoded version of any argument (e.g., `{{city|u}}`). |

## Security & Sandbox

> [!IMPORTANT]
> All portable skills run inside a **hardened Docker sandbox**. They have a read-only view of your project and cannot modify your host system.

- **Timeout**: Skills are killed after 15 seconds by default.
- **Resource Limits**: 512MB RAM and 1 CPU.
- **Isolation**: No privileged capabilities are granted to the container.

## Testing Your Skill

You can test your skill directly from the CLI without starting the full gateway:

```bash
pnpm dev chat "weather in Berlin"
```

If the semantic router finds a high-confidence match, it will execute your skill and provide the result.
