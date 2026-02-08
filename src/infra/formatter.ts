/**
 * Shared formatting logic for OpenMoose output.
 * Simplified version - tool call parsing removed (now handled by native API).
 */
export class Formatter {
  /**
   * Remove internal reasoning blocks from the text.
   */
  static cleanForUser(text: string): string {
    return text
      .replace(/<(thought|think)>[\s\S]*?<\/(thought|think)>/gi, '')
      .replace(/<final>([\s\S]*?)<\/final>/gi, '$1')
      .replace(/```json\s*\{\s*"thought"[\s\S]*?\}\s*```/g, '')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      // Label Suppression
      .replace(/^\**Response:\**\s*/gmi, '')
      .replace(/^\**Assistant:\**\s*/gmi, '')
      .replace(/^\**Moose:\**\s*/gmi, '')
      .replace(/\*\*Step-by-Step Explanation:\*\*[\s\S]*?(?=\*\*Final Answer:\*\*|$)/g, '')
      .replace(/\*\*Final Answer:\*\*\s*/g, '')
      .replace(/Step-by-Step Explanation:[\s\S]*?(?=Final Answer:|$)/g, '')
      .replace(/Final Answer:\s*/g, '')
      // Strip Markdown (Partial - keep code blocks but strip decoration)
      .replace(/(\*\*|__)(.*?)\1/g, '$2') // Bold
      .replace(/(\*|_)(.*?)\1/g, '$2')    // Italics
      .replace(/^#+\s+/gm, '')            // Headers
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

/**
 * StreamingFormatter - Stateful filter for LLM deltas
 * Simplified version - only filters thought blocks (tool calls handled by native API)
 */
export class StreamingFormatter {
  private inThought = false;
  private inCodeBlock = false;
  private hasContentEmitted = false;
  private buffer = '';

  /**
   * Process a delta and return only "clean" text.
   * Handles tags split across deltas.
   */
  process(delta: string): string {
    this.buffer += delta;
    let output = '';

    while (this.buffer.length > 0) {
      if (this.inThought) {
        const lowerBuf = this.buffer.toLowerCase();
        const endThought = lowerBuf.indexOf('</thought>');
        const endThink = lowerBuf.indexOf('</think>');

        let endIdx = -1;
        let tagLen = 0;

        if (endThought !== -1 && (endThink === -1 || endThought < endThink)) {
          endIdx = endThought;
          tagLen = 10;
        } else if (endThink !== -1) {
          endIdx = endThink;
          tagLen = 8;
        }

        if (endIdx !== -1) {
          this.inThought = false;
          this.buffer = this.buffer.substring(endIdx + tagLen);
        } else {
          // Check for partial end tags
          const potentialStart = this.buffer.toLowerCase().lastIndexOf('<');
          if (potentialStart !== -1) {
            const tail = this.buffer.toLowerCase().substring(potentialStart);
            if ('</thought>'.startsWith(tail) || '</think>'.startsWith(tail)) {
              this.buffer = this.buffer.substring(potentialStart);
            } else {
              this.buffer = '';
            }
          } else {
            this.buffer = '';
          }
          break;
        }
      } else if (this.inCodeBlock) {
        const endIdx = this.buffer.indexOf('```');
        if (endIdx !== -1) {
          this.inCodeBlock = false;
          this.buffer = this.buffer.substring(endIdx + 3);
        } else {
          const potentialStart = this.buffer.lastIndexOf('`');
          if (potentialStart !== -1 && '```'.startsWith(this.buffer.substring(potentialStart))) {
            this.buffer = this.buffer.substring(potentialStart);
          } else {
            this.buffer = '';
          }
          break;
        }
      } else {
        // Look for start tags
        const lowerBuf = this.buffer.toLowerCase();
        const thoughtIdx = lowerBuf.indexOf('<thought>');
        const thinkIdx = lowerBuf.indexOf('<think>');
        const codeIdx = this.buffer.indexOf('```');

        let startIdx = -1;
        let isThoughtTag = false;

        if (thoughtIdx !== -1 && (thinkIdx === -1 || thoughtIdx < thinkIdx)) {
          startIdx = thoughtIdx;
          isThoughtTag = true;
        } else if (thinkIdx !== -1) {
          startIdx = thinkIdx;
          isThoughtTag = true;
        }

        if (isThoughtTag && (codeIdx === -1 || startIdx < codeIdx)) {
          output += this.buffer.substring(0, startIdx);
          this.inThought = true;
          this.buffer = this.buffer.substring(startIdx);
        } else {
          // No tags found - emit content but keep potential partial tags
          let emitUntil = this.buffer.length;
          const lowerBuf = this.buffer.toLowerCase();

          for (let i = Math.max(0, this.buffer.length - 12); i < this.buffer.length; i++) {
            const tail = lowerBuf.substring(i);
            if ('<thought>'.startsWith(tail) || '<think>'.startsWith(tail) || '<final>'.startsWith(tail) || '</final>'.startsWith(tail)) {
              emitUntil = i;
              break;
            }
          }

          if (emitUntil > 0) {
            let toEmit = this.buffer.substring(0, emitUntil);

            // Trim leading whitespace if we haven't emitted anything yet
            if (!this.hasContentEmitted) {
              toEmit = toEmit.trimStart();
              if (toEmit.length > 0) {
                this.hasContentEmitted = true;
              }
            }

            // Strip tags and Markdown symbols for streaming (only if symbols are present)
            let cleanToEmit = toEmit;
            if (cleanToEmit.includes('<') || cleanToEmit.includes('*') || cleanToEmit.includes('#') || cleanToEmit.includes('_')) {
              cleanToEmit = cleanToEmit
                .replace(/<\/?final>/gi, '')
                .replace(/\*\*|__|#+|\*|_/g, '');
            }
            output += cleanToEmit;
            this.buffer = this.buffer.substring(emitUntil);
          }
          break;
        }
      }
    }

    return output;
  }

  /**
   * Final flush of any remaining clean text.
   * Resets internal state for the next interaction wave.
   */
  flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    this.hasContentEmitted = false;
    this.inThought = false;
    this.inCodeBlock = false;

    return Formatter.cleanForUser(remaining);
  }
}
