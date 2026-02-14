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
       {{open}} "https://www.youtube.com/watch?v={{id}}" &
     else
       CH=$(yt-dlp --print uploader_url --playlist-end 1 "ytsearch1:{{query}}" 2>/dev/null)
       ID=$(yt-dlp --get-id --flat-playlist --playlist-end 1 "$CH/videos" 2>/dev/null)
       {{open}} "https://www.youtube.com/watch?v=$ID" &
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
| `command` | Yes | The shell command to execute (in a Docker sandbox by default, or on the host if `host: true`). |
| `host` | No | If `true`, runs the command directly on the host machine instead of in a Docker sandbox. Use for trusted skills that need host tools (e.g., `python3`, `xdg-open`). Default: `false`. |
| `image` | No | Custom Docker image for sandboxed execution (defaults to `python:3.12-slim`). Ignored when `host: true`. |

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
| `{{open}}` | OS-specific open command (`open`, `start`, or `xdg-open`). |

## Security & Sandbox

> [!CAUTION]
> By default, portable skills run inside a **structurally hardened Docker sandbox**. However, if you set `host: true`, the command will run directly on your host machine. **Use this only for trusted skills** (e.g., controlling a local player or opening a browser).

- **Sandboxed (Default)**: 
  - **Stdin-Piped**: Commands are streamed via stdin to neutralize shell injection.
  - **Kernel-Hardened**: `no-new-privileges` and `pids-limit` prevent process escalation and fork-bombs.
  - **OOM-Protected**: 5MB output cap prevents runaway scripts from crashing the host.
  - **Isolated**: Read-only view of your project, no host access, 30s timeout.
- **Host Mode (`host: true`)**: Full access to your environment. Required for opening local windows or hardware control.

## Testing Your Skill

You can test your skill directly from the CLI without starting the full gateway:

```bash
pnpm dev chat "weather in Berlin"
```

If the semantic router finds a high-confidence match, it will execute your skill and provide the result.

## Advanced: TypeScript Plugins

For complex logic requiring direct infrastructure access (via restricted capabilities), you can create TypeScript plugins.

1.  Create a file in `src/runtime/skills/custom/` (e.g., `my-plugin.ts`).
2.  Export a default skill using `defineSkill` (arguments are automatically inferred):

```typescript
import { z } from 'zod';
import { defineSkill } from '../../skill.js';

export default defineSkill({
    name: 'my_plugin',
    description: 'A custom logic block',
    isVerified: false, // isVerified is ignored for external plugins.
    argsSchema: z.object({
        query: z.string()
    }),
    execute: async (args, context) => {
        // args is automatically typed as { query: string }
        const mem = await context.memory.recall(args.query);
        return { success: true, data: { status: 'ok', related: mem } };
    }
});
```

### Capability-Based Isolation
TypeScript plugins are restricted to a **SkillContext** that provides scoped capabilities:
- **`memory`**: `store` and `recall` (no direct DB access).
- **`sandbox`**: `runPython`, `runNode`, `runPlaywright` (isolated Docker execution).
- **`brain`**: `ask` (nested LLM calls).
- **`whatsapp`**: `send` (if enabled, no access to session state).

### Security Note: Structural Integrity
OpenMoose enforces a **Quadruple-Lock** policy for host access:
1. **Trust-by-Location**: Skill must reside in `src/runtime/skills/builtins/`.
2. **Trust-by-Manifest**: Skill name must exist on the centralized `manifest.ts`.
3. **Trust-by-Integrity**: Skill `name` must match the manifest's mapping (e.g., `ls.js` vs name `ls`).
4. **Trust-by-Protocol**: Non-core skills use Stdin-piped execution with kernel-level restrictions.

Any custom skill or plugin residing outside core directories or with an unrecognized name is **Always unverified**. They are strictly isolated in a non-privileged Docker sandbox with no host access.
