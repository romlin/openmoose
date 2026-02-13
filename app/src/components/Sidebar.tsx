import { MessageSquare, Database, Trash2, Terminal } from "lucide-react";
import type { ViewType } from "../lib/types";

interface SidebarProps {
    activeView: ViewType;
    onViewChange: (view: ViewType) => void;
    onClearHistory: () => void;
    isOpen?: boolean;
    onClose?: () => void;
}

export function Sidebar({ activeView, onViewChange, onClearHistory, isOpen, onClose }: SidebarProps) {
    const handleViewChange = (view: ViewType) => {
        onViewChange(view);
        if (onClose) onClose();
    };

    return (
        <aside className={`sidebar ${isOpen ? "open" : ""}`}>
            <nav className="nav-container">
                <div
                    className={`nav-item ${activeView === "chat" ? "active" : ""}`}
                    onClick={() => handleViewChange("chat")}
                >
                    <MessageSquare size={18} style={{ marginRight: '12px' }} />
                    <span>Chat</span>
                </div>
                <div
                    className={`nav-item ${activeView === "memory" ? "active" : ""}`}
                    onClick={() => handleViewChange("memory")}
                >
                    <Database size={18} style={{ marginRight: '12px' }} />
                    <span>Memory</span>
                </div>
                <div
                    className={`nav-item ${activeView === "debug" ? "active" : ""}`}
                    onClick={() => handleViewChange("debug")}
                >
                    <Terminal size={18} style={{ marginRight: '12px' }} />
                    <span>Debug</span>
                </div>
                <div className="nav-item border-top" onClick={() => { onClearHistory(); if (onClose) onClose(); }} style={{ opacity: 0.6, marginTop: 'auto' }}>
                    <Trash2 size={18} style={{ marginRight: '12px' }} />
                    <span>Wipe History</span>
                </div>
            </nav>
        </aside>
    );
}
