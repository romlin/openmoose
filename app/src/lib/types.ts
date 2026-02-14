/**
 * Shared TypeScript types for the OpenMoose frontend.
 */

export interface Message {
    id: number;
    role: "user" | "assistant";
    content: string;
    /** Source attribution: e.g. "skill:weather", "browser", "brain", "tools:python_execute" */
    source?: string;
}

export interface DownloadProgress {
    downloaded: number;
    total: number;
}

export type ViewType = "chat" | "memory" | "debug";

export type BrainStatus = "ready" | "warming_up" | "error";

export interface MemoryEntry {
    id: string;
    text: string;
    source: "chat" | "doc";
    createdAt: number;
    metadata: string;
}

export interface DebugInfo {
    uptime: number;
    memory: Record<string, number>;
    cpu: Record<string, number>;
    platform: string;
    arch: string;
    version: string;
    brain: {
        provider: string;
        model: string;
        gpu: string;
        status: string;
    };
    skills: {
        builtin: string[];
        portable: string[];
    };
    scheduler: {
        status: string;
        pollInterval: number;
    };
}

export interface StartupInfo {
    config: { setup_complete: boolean };
    model_exists: boolean;
    model_size: number;
    model_name: string;
    gateway_port: number;
}

export interface GatewayMessage {
    type: string;
    text?: string;
    status?: BrainStatus;
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string; source?: string }>;
    success?: boolean;
    memories?: MemoryEntry[];
    /** Tool name sent with agent.tool_call */
    name?: string;
    /** Source attribution sent with agent.final */
    source?: string;
}
