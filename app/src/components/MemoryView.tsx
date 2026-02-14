import { useState, useEffect } from "react";
import { MessageSquare, FileText, Trash2 } from "lucide-react";
import { PageHeader } from "./PageHeader";
import type { MemoryEntry } from "../lib/types";

interface MemoryViewProps {
    memories: MemoryEntry[];
    onSearch: (query: string, source?: "chat" | "doc") => void;
    onBack?: () => void;
    onMenuToggle?: () => void;
    onClearMemory: () => void;
}

export function MemoryView({ memories, onSearch, onBack, onMenuToggle, onClearMemory }: MemoryViewProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [filterType, setFilterType] = useState<"all" | "chat" | "doc">("all");

    useEffect(() => {
        const timer = setTimeout(() => {
            onSearch(searchQuery, filterType === "all" ? undefined : filterType);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery, filterType, onSearch]);

    return (
        <div className="memory-view fadeIn">
            <PageHeader title="Memory" onBack={onBack} onMenuToggle={onMenuToggle}>
                <button className="action-btn" onClick={onClearMemory} title="Nuke All Memories" style={{ color: '#ef4444' }}>
                    <Trash2 size={14} style={{ marginRight: '8px' }} />
                    Nuke Memory
                </button>
            </PageHeader>

            <div className="memory-controls">
                <div className="search-bar-row">
                    <input
                        type="text"
                        placeholder="Search memories..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="memory-search-input"
                    />
                </div>
                <div className="filter-row">
                    <button
                        className={`filter-chip ${filterType === "all" ? "active" : ""}`}
                        onClick={() => setFilterType("all")}
                    >
                        All
                    </button>
                    <button
                        className={`filter-chip ${filterType === "chat" ? "active" : ""}`}
                        onClick={() => setFilterType("chat")}
                    >
                        <MessageSquare size={14} style={{ marginRight: '6px' }} />
                        Chat
                    </button>
                    <button
                        className={`filter-chip ${filterType === "doc" ? "active" : ""}`}
                        onClick={() => setFilterType("doc")}
                    >
                        <FileText size={14} style={{ marginRight: '6px' }} />
                        Docs
                    </button>
                </div>
            </div>

            <div className="memory-list">
                {memories.length === 0 ? (
                    <div className="empty-memory">
                        <p>No memories found matching your criteria.</p>
                    </div>
                ) : (
                    memories.map((entry) => (
                        <div key={entry.id} className="memory-item">
                            <div className="memory-meta">
                                <span className={`source-tag ${entry.source}`}>
                                    {entry.source === "chat" ? (
                                        <><MessageSquare size={12} style={{ marginRight: '4px' }} /> Chat</>
                                    ) : (
                                        <><FileText size={12} style={{ marginRight: '4px' }} /> Doc</>
                                    )}
                                </span>
                                <span className="memory-date">
                                    {new Date(entry.createdAt).toLocaleString()}
                                </span>
                            </div>
                            <div className="memory-text">{entry.text}</div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
