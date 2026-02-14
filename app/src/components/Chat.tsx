import { useState, useEffect, useRef } from "react";
import { formatBytes, calcProgressPercent, copyToClipboard } from "../lib/utils";
import type { Message, DownloadProgress, BrainStatus } from "../lib/types";
import { Clipboard, Check, Brain } from "lucide-react";
import { PageHeader } from "./PageHeader";

interface ChatProps {
    messages: Message[];
    onSend: (message: string) => void;
    isThinking: boolean;
    isDownloading?: boolean;
    downloadProgress?: DownloadProgress | null;
    brainStatus?: BrainStatus;
    onMenuToggle: () => void;
}

function FormattedText({ text }: { text: string }) {
    const parts = text.split(/(\[.*?\]\(.*?\))|(\*\*.*?\*\*)/g);

    return (
        <>
            {parts.map((part, i) => {
                if (!part) return null;

                const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
                if (linkMatch) {
                    return (
                        <a
                            key={i}
                            href={linkMatch[2]}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="chat-link"
                        >
                            {linkMatch[1]}
                        </a>
                    );
                }

                const boldMatch = part.match(/\*\*(.*?)\*\*/);
                if (boldMatch) {
                    return <strong key={i}>{boldMatch[1]}</strong>;
                }

                return (
                    <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
                        {part}
                    </span>
                );
            })}
        </>
    );
}

function CopyButton({ content }: { content: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const ok = await copyToClipboard(content);
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <button
            className={`copy-btn ${copied ? 'copied' : ''}`}
            onClick={handleCopy}
            title="Copy message"
        >
            {copied ? <Check size={14} /> : <Clipboard size={14} />}
        </button>
    );
}

export function Chat({ messages, onSend, isThinking, isDownloading, downloadProgress, brainStatus, onMenuToggle }: ChatProps) {
    const [input, setInput] = useState("");
    const chatRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (chatRef.current) {
            chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
    }, [messages, isThinking]);

    const handleSend = () => {
        if (!input.trim()) return;
        onSend(input);
        setInput("");
    };

    const progressPercent = calcProgressPercent(downloadProgress ?? null);

    return (
        <main className="main-content">
            <div style={{ padding: '0 var(--side-padding)' }}>
                <PageHeader title="Chat" onMenuToggle={onMenuToggle} />
            </div>
            <div className="chat-window" ref={chatRef}>
                {isDownloading && (
                    <div className="download-status-chat fadeIn">
                        <div className="download-info">
                            <span className="brain-label"><Brain size={16} style={{ marginRight: '8px' }} /> Setting up local Brain...</span>
                            <span className="progress-percent">{progressPercent}%</span>
                        </div>
                        <div className="download-bar-container">
                            <div className="download-bar-fill" style={{ width: `${progressPercent}%` }}></div>
                        </div>
                        <div className="download-meta">
                            {formatBytes(downloadProgress?.downloaded || 0)} / {formatBytes(downloadProgress?.total || 0)}
                        </div>
                    </div>
                )}
                {messages.map((m) => (
                    <div key={m.id} className={`message ${m.role} fadeIn`}>
                        <div className="message-content">
                            <FormattedText text={m.content} />
                        </div>
                        <CopyButton content={m.content} />
                    </div>
                ))}
                {(isThinking || brainStatus === "warming_up") && (
                    <div className="message moose thinking fadeIn">
                        <span className="thinking-moose">🫎</span>
                        <span>
                            {brainStatus === "warming_up"
                                ? "Loading 12GB local brain into RAM..."
                                : (messages[messages.length - 1]?.role === "assistant" ? "Moose is writing..." : "Moose is thinking...")}
                        </span>
                    </div>
                )}
            </div>

            <div className="input-area">
                <div className="input-container">
                    <input
                        type="text"
                        placeholder={brainStatus === "warming_up" ? "Loading brain..." : "Talk to the moose..."}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        disabled={isDownloading || brainStatus === "warming_up"}
                    />
                    <button
                        className="send-btn"
                        onClick={handleSend}
                        disabled={!input.trim() || isDownloading || brainStatus === "warming_up"}
                        aria-label="Send message"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
            </div>
        </main>
    );
}
