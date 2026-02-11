# Creating Custom Skills

OpenMoose is designed to be easily extensible. You can add new capabilities (skills) by simply creating YAML files in the `skills/` directory. No TypeScript or build steps required.

## Quick Start

1. Create a file named `skills/youtube.yaml`:
   ```yaml
   name: youtube
   description: Play a video or search for a creator
   examples:
     - "play latest video by pewdiepie"
     - "watch https://www.youtube.com/watch?v=dQw4w9WgXcQ"
   args:
     id:
       patterns:
         - 'https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]+)'
     query:
       patterns:
         - "play latest video by ([a-zA-Z0-9\\s]+)"
   host: true
   command: |
     if [ -n "{{id}}" ]; then
       xdg-open "https://www.youtube.com/watch?v={{id}}" &
     else
       CH=$(yt-dlp --print uploader_url --playlist-end 1 "ytsearch1:{{query}}" 2>/dev/null)
       ID=$(yt-dlp --get-id --flat-playlist --playlist-end 1 "$CH/videos" 2>/dev/null)
       xdg-open "https://www.youtube.com/watch?v=$ID" &
     fi
   ```
2. Restart the gateway (`pnpm gateway`).
3. Ask: "play latest video by pewdiepie".

> [!IMPORTANT]
> **Prerequisites & Platform Notes**:
> - **External Tools**: This skill requires `yt-dlp` and `xdg-open` on your host machine.
> - **Install yt-dlp**: Install via your platform's package manager (e.g., `brew install yt-dlp`, `sudo apt install yt-dlp`) or via pip (`pip install yt-dlp`) **before** running the gateway.
> - **OS Alternatives**: `xdg-open` is Linux-specific. For **macOS**, use `open`. For **Windows**, use `start`.

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

> [!CAUTION]
> By default, portable skills run inside a **hardened Docker sandbox**. However, if you set `host: true`, the command will run directly on your host machine. **Use this only for trusted skills** (e.g., controlling a local player or opening a browser).

- **Sandboxed (Default)**: Read-only view of your project, no host access, 30s timeout.
- **Host Mode (`host: true`)**: Full access to your environment. Required for opening local windows or hardware control.

## Testing Your Skill

You can test your skill directly from the CLI without starting the full gateway:

```bash
pnpm dev chat "weather in Berlin"
```

If the semantic router finds a high-confidence match, it will execute your skill and provide the result.
