/**
 * System prompt builder -- assembles the LLM system prompt from
 * skill definitions, memory context, and current date/time.
 */

import { SkillRegistry } from '../../runtime/registry.js';
export class PromptBuilder {
    constructor(private registry: SkillRegistry) { }

    /**
     * Build the final system prompt with all available context
     */
    build(_skillsPrompt?: string, memoryContext?: string): string {
        const toolsDef = this.registry.getPromptDefinitions();

        const now = new Date();
        const timeContext = `\n\n## Current Date & Time\n${now.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        })}\n`;

        const memorySection = memoryContext ? `\n\n## Memory\nFacts about the user (PRIORITIZE THESE):\n${memoryContext}\n` : '';

        return `You are OpenMoose (also called "Moose"), a friendly personal assistant.
Your name is OpenMoose. You are NOT the user.
When the user tells you something about themselves, remember it is about THEM, not you.

## CORE BEHAVIOR
- Be helpful, concise, and direct
- When given skill results (weather, time, etc.), incorporate them naturally into your response
- For complex tasks, use your tools when available
- When asked about the user, always use "your" (e.g. "Your name is ...")

## TOOLS
${toolsDef}

## BROWSER TASKS
For web-based tasks (WhatsApp, Web Browsing), use the \`browser_action\` tool:
- Use \`type\` or \`action\` to specify the command (navigate, click, type, wait, press)
- Every action returns a text-based "Snapshot" of the page
- A screenshot is saved to \`.moose/data/browser-previews/latest.png\`

## STYLE
- Be conversational and natural
- Don't narrate what you're doing unless helpful
- No excessive markdown or emojis
${timeContext}${memorySection}`;
    }
}
