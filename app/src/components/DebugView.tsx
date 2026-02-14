import { useState, useEffect } from "react";
import { Clipboard, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { PageHeader } from "./PageHeader";
import { copyToClipboard, formatUptime } from "../lib/utils";
import type { DebugInfo, StartupInfo } from "../lib/types";

interface DebugViewProps {
    onBack: () => void;
    ws: WebSocket | null;
    onMenuToggle: () => void;
}

export function DebugView({ onBack, ws, onMenuToggle }: DebugViewProps) {
    const [info, setInfo] = useState<DebugInfo | null>(null);
    const [tauriInfo, setTauriInfo] = useState<StartupInfo | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        invoke<StartupInfo>("get_startup_info").then(setTauriInfo).catch(console.error);

        if (ws && ws.readyState === WebSocket.OPEN) {
            const handleMessage = (event: MessageEvent) => {
                const data = JSON.parse(event.data);
                if (data.type === "agent.system.info.result") {
                    setInfo(data);
                } else if (data.type === "error") {
                    console.error("Gateway Debug Error:", data.message);
                }
            };

            ws.addEventListener("message", handleMessage);
            ws.send(JSON.stringify({ type: "agent.system.info" }));

            const interval = setInterval(() => {
                ws.send(JSON.stringify({ type: "agent.system.info" }));
            }, 5000);

            return () => {
                ws.removeEventListener("message", handleMessage);
                clearInterval(interval);
            };
        }
    }, [ws]);

    const handleCopy = async () => {
        const fullInfo = {
            timestamp: new Date().toISOString(),
            tauri: tauriInfo,
            gateway: info,
        };
        const ok = await copyToClipboard(JSON.stringify(fullInfo, null, 2));
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="memory-view fadeIn">
            <PageHeader title="Debug" onBack={onBack} onMenuToggle={onMenuToggle}>
                <button className="action-btn" onClick={handleCopy}>
                    {copied ? <Check size={14} style={{ marginRight: '8px' }} /> : <Clipboard size={14} style={{ marginRight: '8px' }} />}
                    {copied ? "Copied!" : "Copy Full Report"}
                </button>
            </PageHeader>

            <div className="debug-content fadeIn">
                <div className="debug-section">
                    <h3>System</h3>
                    <div className="debug-row"><span>Platform</span> <code>{info?.platform || "Loading..."}</code></div>
                    <div className="debug-row"><span>Architecture</span> <code>{info?.arch || "Loading..."}</code></div>
                    <div className="debug-row"><span>Node Version</span> <code>{info?.version || "Loading..."}</code></div>
                    <div className="debug-row"><span>Moose Home</span> <code>~/.moose</code></div>
                    <div className="debug-row"><span>Uptime</span> <code>{info ? formatUptime(info.uptime) : "0s"}</code></div>
                    <div className="debug-row"><span>Gateway Memory</span> <code>{info ? Math.round(info.memory.rss / 1024 / 1024) : 0}MB RSS</code></div>
                </div>

                <div className="debug-section">
                    <h3>Brain</h3>
                    <div className="debug-row"><span>Provider</span> <code>{info?.brain.provider || "Loading..."}</code></div>
                    <div className="debug-row"><span>Model</span> <code>{info?.brain.model || tauriInfo?.model_name || "Loading..."}</code></div>
                    <div className="debug-row"><span>Inference</span> <code>{info?.brain.gpu === 'false' ? 'CPU' : (info?.brain.gpu || 'Auto')}</code></div>
                    <div className="debug-row"><span>Size</span> <code>{tauriInfo ? (tauriInfo.model_size / 1024 / 1024 / 1024).toFixed(2) : 0} GB</code></div>
                    <div className="debug-row"><span>Brain Status</span> <span className={`status-pill ${tauriInfo?.model_exists ? 'active' : 'inactive'}`}>
                        {tauriInfo?.model_exists ? 'Online' : 'Offline'}
                    </span></div>
                </div>

                <div className="debug-section">
                    <h3>Skills & Scheduler</h3>
                    <div className="debug-row"><span>Built-in Skills</span> <code>{info?.skills.builtin.length || 0} loaded</code></div>
                    <div className="debug-row"><span>Portable Skills</span> <code>{info?.skills.portable.length || 0} detected</code></div>
                    <div className="debug-row"><span>Scheduler</span> <code>{info?.scheduler?.status} ({info?.scheduler ? info.scheduler.pollInterval / 1000 : 0}s)</code></div>
                </div>

                <div className="debug-section">
                    <h3>Registry</h3>
                    <div className="debug-console-body">
                        {info?.skills.builtin.map((s: string) => <span key={s} className="skill-tag">{s}</span>)}
                        {info?.skills.portable.map((s: string) => <span key={s} className="skill-tag portable">{s}</span>)}
                    </div>
                </div>
            </div>
        </div>
    );
}
