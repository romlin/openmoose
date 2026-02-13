import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { Chat } from "./components/Chat";
import { MemoryView } from "./components/MemoryView";
import { DebugView } from "./components/DebugView";
import { SetupWizard } from "./components/SetupWizard";
import { DEFAULT_GATEWAY_PORT } from "./lib/utils";
import type { Message, ViewType, BrainStatus, DownloadProgress, MemoryEntry, GatewayMessage, StartupInfo } from "./lib/types";
import "./App.css";

function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: "moose", content: "How can I help you today?" }
  ]);
  const [view, setView] = useState<ViewType>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [setupComplete, setSetupComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isThinking, setIsThinking] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [brainStatus, setBrainStatus] = useState<BrainStatus>("ready");

  // Port received from the Rust backend (authoritative), falls back to the default.
  const gatewayPortRef = useRef<number>(DEFAULT_GATEWAY_PORT);

  /** Sends a JSON message over the WebSocket if connected. */
  const wsSend = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const handleGatewayMessage = useCallback((payload: GatewayMessage) => {
    switch (payload.type) {
      case "agent.delta":
        setIsThinking(false);
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === "moose") {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              content: last.content + (payload.text || "")
            };
            return updated;
          }
          return [...prev, { id: Date.now(), role: "moose", content: payload.text || "" }];
        });
        break;
      case "agent.tool_call":
        setIsThinking(true);
        break;
      case "agent.final":
        setIsThinking(false);
        break;
      case "error":
        setIsThinking(false);
        setMessages(prev => [...prev, { id: Date.now(), role: "moose", content: `Error: ${payload.message} ` }]);
        break;
      case "agent.history.result":
        if (payload.history && payload.history.length > 0) {
          setMessages(payload.history.map((m, index) => ({
            id: index + 1,
            role: m.role,
            content: m.content
          })));
        }
        break;
      case "agent.history.clear.result":
        if (payload.success) {
          setMessages([
            { id: Date.now(), role: "moose", content: "History wiped cleanly. Moose is ready!" }
          ]);
        }
        break;
      case "agent.memory.list.result":
      case "agent.memory.search.result":
        if (payload.memories) {
          setMemories(payload.memories);
        }
        break;
      case "brain.status":
        if (payload.status) {
          setBrainStatus(payload.status);
        }
        if (payload.status === "error") {
          setDownloadError(payload.message || "Unknown error");
        }
        break;
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const port = gatewayPortRef.current;
    const ws = new WebSocket(`ws://localhost:${port}`);

    ws.onopen = () => {
      console.log(`Connected to Gateway on port ${port}`);
      wsRef.current = ws;
      ws.send(JSON.stringify({ type: "agent.history", limit: 50 }));
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleGatewayMessage(payload);
      } catch (err) {
        console.error("Failed to parse gateway message:", err);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      ws.close();
      setTimeout(connectWebSocket, 1000);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      wsRef.current = null;
      setTimeout(connectWebSocket, 1000);
    };
  }, [handleGatewayMessage]);

  const startDownload = useCallback(async () => {
    setDownloadError(null);
    setIsDownloading(true);
    try {
      await invoke("download_model");
    } catch (err) {
      console.error("Model download failed:", err);
      setDownloadError(String(err));
      setIsDownloading(false);
    }
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const info = await invoke<StartupInfo>("get_startup_info");
        setSetupComplete(info.config.setup_complete);

        // Use the authoritative port from the Rust backend
        gatewayPortRef.current = info.gateway_port;

        const name = info.model_name.replace(".gguf", "");

        if (info.config.setup_complete && info.model_exists) {
          setMessages([
            { id: 1, role: "moose", content: `Moose is ready with **${name}**. How can I help you today?` }
          ]);
        }

        if (info.config.setup_complete) {
          if (!info.model_exists) {
            startDownload();
          } else {
            setDownloadProgress({ downloaded: info.model_size, total: info.model_size });
          }
          invoke("start_gateway").catch(err => console.error("Auto-start gateway failed:", err));
          connectWebSocket();
        }
      } catch (err) {
        console.error("Failed to load startup info:", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadConfig();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [startDownload, connectWebSocket]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setupListener = async () => {
      const cleanup = await listen<DownloadProgress>("download-progress", (event) => {
        setDownloadProgress(event.payload);
        if (event.payload.downloaded >= event.payload.total && event.payload.total > 0) {
          setIsDownloading(false);
        }
      });
      unlisten = cleanup;
    };
    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleSendMessage = (content: string) => {
    setMessages(prev => [...prev, { id: Date.now(), role: "user", content }]);
    setIsThinking(true);

    const trySend = () => {
      if (!wsSend({ type: "agent.run", message: content })) {
        setTimeout(trySend, 500);
      }
    };

    trySend();
  };

  const handleClearHistory = () => {
    if (confirm("Are you sure you want to wipe all chat history? This cannot be undone.")) {
      wsSend({ type: "agent.history.clear" });
    }
  };

  const handleClearMemory = () => {
    if (confirm("DANGER: This will permanently NUKE all long-term memories. Continue?")) {
      wsSend({ type: "agent.memory.clear" });
      wsSend({ type: "agent.memory.list" });
    }
  };

  const handleMemorySearch = (query: string, source?: "chat" | "doc") => {
    if (query.trim()) {
      wsSend({ type: "agent.memory.search", query, source });
    } else {
      wsSend({ type: "agent.memory.list", source });
    }
  };

  useEffect(() => {
    if (view === "memory") {
      wsSend({ type: "agent.memory.list" });
    }
  }, [view, wsSend]);

  const handleSetupComplete = async () => {
    try {
      await invoke("update_config", { config: { setup_complete: true, theme: "dark" } });
    } catch (err) {
      console.error("Failed to save config:", err);
    }
    // Always proceed with setup regardless of config save result
    setSetupComplete(true);
    await invoke("start_gateway");
    connectWebSocket();
  };

  if (isLoading) return <div className="app-loading">Loading...</div>;

  return (
    <div className="app-container">
      {!setupComplete && (
        <SetupWizard
          onComplete={handleSetupComplete}
          downloadProgress={downloadProgress}
          isDownloading={isDownloading}
          downloadError={downloadError}
          onStartDownload={startDownload}
        />
      )}
      <Sidebar
        activeView={view}
        onViewChange={setView}
        onClearHistory={handleClearHistory}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && (
        <div className="sidebar-overlay mobile-only" onClick={() => setSidebarOpen(false)} />
      )}
      {view === "chat" && (
        <Chat
          messages={messages}
          onSend={handleSendMessage}
          isThinking={isThinking}
          isDownloading={isDownloading}
          downloadProgress={downloadProgress}
          brainStatus={brainStatus}
          onMenuToggle={() => setSidebarOpen(true)}
        />
      )}
      {view === "memory" && (
        <MemoryView
          memories={memories}
          onSearch={handleMemorySearch}
          onBack={() => setView("chat")}
          onMenuToggle={() => setSidebarOpen(true)}
          onClearMemory={handleClearMemory}
        />
      )}
      {view === "debug" && (
        <DebugView
          onBack={() => setView("chat")}
          ws={wsRef.current}
          onMenuToggle={() => setSidebarOpen(true)}
        />
      )}
    </div>
  );
}

export default App;
