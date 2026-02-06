/**
 * Vector-based long-term memory backed by LanceDB.
 * Stores conversation facts and indexes local Markdown documents
 * for semantic retrieval using Ollama embeddings.
 */

import * as lancedb from '@lancedb/lancedb';
import { Ollama } from 'ollama';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config/index.js';
import { logger } from './logger.js';

/** A single memory record stored in the vector database. */
export interface MemoryEntry {
  id: string;
  text: string;
  source: 'chat' | 'doc';
  metadata: string; // JSON string
  vector: number[];
  createdAt: number;
}

/**
 * Semantic memory store using LanceDB for vector search and
 * Ollama (nomic-embed-text) for embedding generation.
 */
export class LocalMemory {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private ollama: Ollama;
  private dbPath: string;
  private embeddingModel: string;

  constructor(options: { dbPath?: string, ollamaHost?: string, embeddingModel?: string } = {}) {
    this.dbPath = options.dbPath || path.resolve(process.cwd(), config.memory.dbPath);
    this.ollama = new Ollama({ host: options.ollamaHost || config.brain.ollama.host });
    this.embeddingModel = options.embeddingModel || 'nomic-embed-text';
  }

  private async ensureInitialized() {
    if (this.table) return;

    await fs.mkdir(this.dbPath, { recursive: true });
    this.db = await lancedb.connect(this.dbPath);

    const tableNames = await this.db.tableNames();
    const tableName = 'memories_v2'; // Versioned table name for schema evolution

    if (tableNames.includes(tableName)) {
      this.table = await this.db.openTable(tableName);
    } else {
      // Get a dummy embedding to determine dimension
      const dummy = await this.getEmbedding("dummy");
      this.table = await this.db.createTable(tableName, [
        {
          id: randomUUID(),
          text: "initialization",
          source: 'chat',
          metadata: '{}',
          vector: dummy,
          createdAt: Date.now()
        }
      ]);
      // Remove initialization entry
      await this.table.delete('text = "initialization"');
    }
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const response = await this.ollama.embeddings({
      model: this.embeddingModel,
      prompt: text,
    });
    return response.embedding;
  }

  /**
   * Store a new memory
   */
  async store(text: string, source: 'chat' | 'doc' = 'chat', metadata: Record<string, unknown> = {}) {
    await this.ensureInitialized();
    const vector = await this.getEmbedding(text);

    await this.table!.add([{
      id: randomUUID(),
      text,
      source,
      metadata: JSON.stringify(metadata),
      vector,
      createdAt: Date.now()
    }]);
  }

  /**
   * Synchronize Markdown documents from a directory
   */
  async syncDocs(docsDirPath: string) {
    await this.ensureInitialized();
    logger.info(`Syncing documents from: ${docsDirPath}`, 'Memory');

    if (!(await fs.stat(docsDirPath).catch(() => null))?.isDirectory()) {
      await fs.mkdir(docsDirPath, { recursive: true });
      return;
    }

    const files = await this.getRecursiveFiles(docsDirPath, '.md');
    for (const file of files) {
      const stats = await fs.stat(file);
      const relativePath = path.relative(docsDirPath, file);

      const content = await fs.readFile(file, 'utf-8');
      const chunks = this.chunkMarkdown(content);

      // Clean old entries for this file using parameterized-style escaping
      const escapedPath = relativePath.replace(/'/g, "''");
      await this.table!.delete(`metadata LIKE '%"path":"${escapedPath}"%'`);

      for (const chunk of chunks) {
        if (chunk.trim().length < 10) continue;
        await this.store(chunk, 'doc', { path: relativePath, mtime: stats.mtimeMs });
      }
      logger.info(`Indexed: ${relativePath} (${chunks.length} chunks)`, 'Memory');
    }
  }

  private async getRecursiveFiles(dir: string, ext: string): Promise<string[]> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
      const res = path.resolve(dir, dirent.name);
      return dirent.isDirectory() ? this.getRecursiveFiles(res, ext) : res;
    }));
    return files.flat().filter(f => f.endsWith(ext));
  }

  private chunkMarkdown(content: string): string[] {
    return content
      .split(/\n(?=#{1,6}\s)/g)
      .flatMap(section => section.split(/\n\n+/g))
      .map(chunk => chunk.trim())
      .filter(chunk => chunk.length > 0);
  }

  /**
   * Recall relevant memories based on a query
   */
  async recall(query: string, limit: number = 5): Promise<string[]> {
    await this.ensureInitialized();
    const vector = await this.getEmbedding(query);

    const results = await this.table!
      .vectorSearch(vector)
      .limit(limit)
      .toArray();

    return results.map(r => r.text as string);
  }

  /**
   * Clear all memories
   */
  async clear() {
    await this.ensureInitialized();
    await this.table!.delete('id IS NOT NULL');
  }
}
