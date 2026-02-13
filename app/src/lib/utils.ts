/**
 * Shared utility functions for the OpenMoose frontend.
 */

import type { DownloadProgress } from "./types";

/**
 * Formats bytes into a human-readable GB string using the decimal standard (1000^3).
 */
export const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 GB";
    const gb = bytes / (1000 * 1000 * 1000);
    return `${gb.toFixed(2)} GB`;
};

/**
 * Calculates download progress as a percentage (0-100).
 */
export const calcProgressPercent = (progress: DownloadProgress | null): number => {
    if (!progress || progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
};

/**
 * Formats seconds into a human-readable uptime string (e.g. "2h 15m 30s").
 */
export const formatUptime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
};

/**
 * Safely copies text to the clipboard.
 * Returns true on success, false on failure.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        console.error("Failed to copy to clipboard");
        return false;
    }
};

/**
 * Common constants.
 */
export const DEFAULT_GATEWAY_PORT = 18789;
