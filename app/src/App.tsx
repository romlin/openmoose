import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { Chat } from "./components/Chat";
import { MemoryView } from "./components/MemoryView";
import { DebugView } from "./components/DebugView";
import { SetupWizard } from "./components/SetupWizard";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DEFAULT_GATEWAY_PORT } from "./lib/utils";
import type { Message, ViewType, BrainStatus, DownloadProgress, MemoryEntry, GatewayMessage, StartupInfo } from "./lib/types";
import "./App.css";

const MAX_UI_MESSAGES = 200;

function trimMessages(messages: Message[]): Message[] {
  return messages.length > MAX_UI_MESSAGES ? messages.slice(-MAX_UI_MESSAGES) : messages;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: "assistant", content: "How can I help you today?" }
  ]);
  const [view, setView] = useState<ViewType>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [setupComplete, setSetupComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isThinking, setIsThinking] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const sendRetryTokenRef = useRef(0);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [brainStatus, setBrainStatus] = useState<BrainStatus>("ready");
  const [gatewayPort, setGatewayPort] = useState<number>(DEFAULT_GATEWAY_PORT);
  const [gatewayReady, setGatewayReady] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const pendingSourceRef = useRef<string | null>(null);

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
      case "agent.delta": {
        setIsThinking(false);
        const source = pendingSourceRef.current;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant") {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              content: last.content + (payload.text || ""),
              ...(source && !last.source ? { source } : {}),
            };
            return trimMessages(updated);
          }
          return trimMessages([...prev, { id: Date.now(), role: "assistant", content: payload.text || "", ...(source ? { source } : {}) }]);
        });
        break;
      }
      case "agent.tool_call": {
        setIsThinking(true);
        // Store the source so it's applied when the first delta arrives
        const toolSource = payload.name === "browser_action" ? "browser"
          : payload.name ? `tools:${payload.name}` : undefined;
        if (toolSource) {
          pendingSourceRef.current = toolSource;
          // If there's already an assistant message being streamed, tag it now
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && last.content) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, source: toolSource };
              return updated;
            }
            return prev;
          });
        }
        break;
      }
      case "agent.final":
        setIsThinking(false);
        pendingSourceRef.current = null;
        if (payload.source) {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, source: payload.source };
              return updated;
            }
            return prev;
          });
        }
        break;
      case "error":
        setIsThinking(false);
        setMessages(prev => trimMessages([...prev, { id: Date.now(), role: "assistant", content: `Error: ${payload.message} ` }]));
        break;
      case "agent.history.result":
        if (payload.history && payload.history.length > 0) {
          setMessages(trimMessages(payload.history.map((m, index) => ({
            id: index + 1,
            role: m.role,
            content: m.content,
            source: m.source,
          }))));
        }
        break;
      case "agent.history.clear.result":
        if (payload.success) {
          setMessages([
            { id: Date.now(), role: "assistant", content: "History wiped cleanly. Moose is ready!" }
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
        if (payload.status === "ready") {
          setGatewayReady(true);
        }
        if (payload.status === "error") {
          setDownloadError(payload.message || "Unknown error");
        }
        break;
    }
  }, []);

  const closedIntentionallyRef = useRef(false);

  const connectWebSocket = useCallback(() => {
    // Return early if we have a socket that is not CLOSED.
    // This prevents CONNECTING or OPEN sockets from being overwritten.
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) return;
    closedIntentionallyRef.current = false;

    const port = gatewayPortRef.current;
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    // Set ref immediately so subsequent calls block
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`Connected to Gateway on port ${port}`);
      wsRef.current = ws;
      setWs(ws);
      ws.send(JSON.stringify({ type: "agent.history", limit: 50 }));
    };

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleGatewayMessage(payload);
      } catch (err) {
        console.error("Failed to parse gateway message:", err);
      }
    });

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      wsRef.current = null;
      setWs(null);
      // Only auto-reconnect on unexpected disconnects, not cleanup/HMR
      if (!closedIntentionallyRef.current) {
        setTimeout(connectWebSocket, 1000);
      }
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
        setGatewayPort(info.gateway_port);

        const name = info.model_name.replace(".gguf", "");

        if (info.config.setup_complete && info.model_exists) {
          setMessages([
            { id: 1, role: "assistant", content: `Moose is ready with **${name}**. How can I help you today?` }
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
      closedIntentionallyRef.current = true;
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
          // Model just finished downloading — tell the gateway to load it.
          // Retry a few times in case the WebSocket isn't connected yet.
          const tryWarmup = (attempt: number) => {
            if (wsSend({ type: "brain.warmup" })) return;
            if (attempt < 5) setTimeout(() => tryWarmup(attempt + 1), 2000);
          };
          tryWarmup(0);
        }
      });
      unlisten = cleanup;
    };
    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, [wsSend]);

  const handleSendMessage = (content: string) => {
    pendingSourceRef.current = null;
    setMessages(prev => trimMessages([...prev, { id: Date.now(), role: "user", content }]));
    setIsThinking(true);

    const MAX_RETRIES = 10;
    const token = ++sendRetryTokenRef.current;

    const trySend = (attempt: number) => {
      // Abort if a newer send has been initiated
      if (sendRetryTokenRef.current !== token) return;

      if (wsSend({ type: "agent.run", message: content })) return;

      if (attempt >= MAX_RETRIES) {
        setIsThinking(false);
        setMessages(prev => trimMessages([
          ...prev,
          { id: Date.now(), role: "assistant", content: "Failed to send message — connection unavailable. Please try again." }
        ]));
        return;
      }

      // Exponential backoff: 500ms, 1s, 2s, …
      const delay = Math.min(500 * 2 ** attempt, 5000);
      setTimeout(() => trySend(attempt + 1), delay);
    };

    trySend(0);
  };

  const handleClearHistory = () => {
    setPendingConfirm({
      message: "Are you sure you want to wipe all chat history? This cannot be undone.",
      onConfirm: () => {
        wsSend({ type: "agent.history.clear" });
        setPendingConfirm(null);
      }
    });
  };

  const handleClearMemory = () => {
    setPendingConfirm({
      message: "This will permanently delete all long-term memories. Continue?",
      onConfirm: () => {
        setPendingConfirm(null);
        wsSend({ type: "agent.memory.clear" });

        // Wait for result before refreshing list
        const tempListener = (event: MessageEvent) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === "agent.memory.clear.result") {
              wsSend({ type: "agent.memory.list" });
              ws?.removeEventListener('message', tempListener);
            }
          } catch {
            // ignore parsing errors in temp listener
          }
        };

        ws?.addEventListener('message', tempListener);
        setTimeout(() => ws?.removeEventListener('message', tempListener), 5000);
      }
    });
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
      {setupComplete && !gatewayReady && (
        <div className="gateway-overlay">
          <span className="gateway-spinner">🫎</span>
          <p className="gateway-label">Starting gateway...</p>
        </div>
      )}
      {!setupComplete && (
        <SetupWizard
          onComplete={handleSetupComplete}
          downloadProgress={downloadProgress}
          isDownloading={isDownloading}
          downloadError={downloadError}
          onStartDownload={startDownload}
          gatewayPort={gatewayPort}
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
          ws={ws}
          onMenuToggle={() => setSidebarOpen(true)}
        />
      )}
      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}

export default App;
