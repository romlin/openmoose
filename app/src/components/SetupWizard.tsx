import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes, calcProgressPercent } from "../lib/utils";
import type { DownloadProgress } from "../lib/types";

type CheckStatus = "not_checked" | "checking" | "found" | "missing" | "ready" | "error";

interface CheckRowProps {
    label: string;
    status: CheckStatus;
    detail?: string;
    errorHint?: string;
    onRetry: () => void;
}

/** Compact single-line requirement check with expandable error. */
function CheckRow({ label, status, detail, errorHint, onRetry }: CheckRowProps) {
    const ok = status === "found" || status === "ready";
    const bad = status === "missing" || status === "error";
    return (
        <div className={`check-row ${status}`}>
            <div className="check-row-main">
                <span className="check-icon">
                    {status === "checking" && "○"}
                    {ok && "✓"}
                    {bad && "✗"}
                </span>
                <span className="check-label">{label}</span>
                <span className="check-detail">
                    {status === "checking" && "checking..."}
                    {ok && (detail || "ready")}
                    {bad && "not found"}
                </span>
            </div>
            {bad && (
                <div className="check-error">
                    {errorHint && <span className="setup-note">{errorHint}</span>}
                    <button className="retry-btn" onClick={onRetry}>Retry</button>
                </div>
            )}
        </div>
    );
}

interface SetupWizardProps {
    onComplete: () => void;
    downloadProgress: DownloadProgress | null;
    isDownloading: boolean;
    downloadError: string | null;
    onStartDownload: () => void;
    gatewayPort: number;
}

export function SetupWizard({
    onComplete,
    downloadProgress,
    isDownloading,
    downloadError,
    onStartDownload,
    gatewayPort
}: SetupWizardProps) {
    const [step, setStep] = useState(1);
    const [nodeStatus, setNodeStatus] = useState<CheckStatus>("not_checked");
    const [nodeVersion, setNodeVersion] = useState<string | null>(null);
    const [dockerStatus, setDockerStatus] = useState<CheckStatus>("not_checked");
    const [browserStatus, setBrowserStatus] = useState<CheckStatus>("not_checked");
    const [browserError, setBrowserError] = useState<string | null>(null);

    const nextStep = () => setStep(prev => prev + 1);

    const checkNode = useCallback(async () => {
        setNodeStatus("checking");
        try {
            const version = await invoke<string>("check_node");
            setNodeVersion(version);
            setNodeStatus("found");
        } catch (err) {
            console.error("Node.js check failed:", err);
            setNodeStatus("missing");
        }
    }, []);

    const checkDocker = useCallback(async () => {
        setDockerStatus("checking");
        try {
            const isAvailable = await invoke<boolean>("check_docker");
            setDockerStatus(isAvailable ? "found" : "missing");
        } catch (err) {
            console.error("Docker check failed:", err);
            setDockerStatus("missing");
        }
    }, []);

    const ensureBrowserReady = useCallback(async () => {
        setBrowserStatus("checking");
        setBrowserError(null);
        try {
            await invoke("start_gateway");
            const base = `http://127.0.0.1:${gatewayPort}`;
            for (let i = 0; i < 60; i++) {
                try {
                    const r = await fetch(`${base}/health`);
                    if (r.ok) break;
                } catch { /* gateway not up yet */ }
                await new Promise((r) => setTimeout(r, 500));
            }
            const readyRes = await fetch(`${base}/setup/browser-ready`);
            if (readyRes.ok) {
                setBrowserStatus("ready");
                return;
            }
            const body = await readyRes.json().catch(() => ({}));
            setBrowserError(body.error || `HTTP ${readyRes.status}`);
            setBrowserStatus("error");
        } catch (err) {
            console.error("Browser setup failed:", err);
            setBrowserError(String(err));
            setBrowserStatus("error");
        }
    }, [gatewayPort]);

    useEffect(() => {
        if (step === 2) {
            if (nodeStatus === "not_checked") checkNode();
            if (dockerStatus === "not_checked") checkDocker();
        }
        if (step === 3 && browserStatus === "not_checked") {
            ensureBrowserReady();
        }
        if (step === 4 && !isDownloading && (!downloadProgress || (downloadProgress.downloaded < downloadProgress.total)) && !downloadError) {
            onStartDownload();
        }
    }, [step, nodeStatus, dockerStatus, browserStatus, isDownloading, onStartDownload, downloadProgress, downloadError, checkNode, checkDocker, ensureBrowserReady]);

    const progressPercent = calcProgressPercent(downloadProgress);
    const requirementsMet = nodeStatus === "found" && dockerStatus === "found";

    return (
        <div className="setup-overlay">
            <div className="setup-card">
                {step === 1 && (
                    <div className="setup-step fadeIn">
                        <h2>Welcome to OpenMoose</h2>
                        <p>Your local-first, privacy-focused AI assistant is almost ready.</p>
                        <button className="primary-btn" onClick={nextStep}>Get Started</button>
                    </div>
                )}

                {step === 2 && (
                    <div className="setup-step fadeIn">
                        <h2>System Requirements</h2>
                        <div className="check-list">
                            <CheckRow
                                label="Node.js"
                                status={nodeStatus}
                                detail={nodeVersion ?? undefined}
                                errorHint="Install Node.js v20+ from nodejs.org or via your package manager."
                                onRetry={checkNode}
                            />
                            <CheckRow
                                label="Docker"
                                status={dockerStatus}
                                detail="running"
                                errorHint="Install Docker and start the daemon."
                                onRetry={checkDocker}
                            />
                        </div>

                        <button className="primary-btn" onClick={nextStep} disabled={!requirementsMet}>
                            {requirementsMet ? "Continue" : "Waiting..."}
                        </button>
                    </div>
                )}

                {step === 3 && (
                    <div className="setup-step fadeIn">
                        <h2>Browser Sandbox</h2>
                        <div className="check-list">
                            <CheckRow
                                label="Sandbox image"
                                status={browserStatus}
                                detail="ready"
                                errorHint={browserError ?? undefined}
                                onRetry={ensureBrowserReady}
                            />
                        </div>
                        <p className="setup-note">Building Docker image for isolated browser skills.</p>

                        <button className="primary-btn" onClick={nextStep} disabled={browserStatus !== "ready"}>
                            {browserStatus === "ready" ? "Continue" : "Building..."}
                        </button>
                    </div>
                )}

                {step === 4 && (
                    <div className="setup-step fadeIn">
                        <h2>Setting Up Your Moose</h2>
                        <div className="progress-container">
                            <div className={`progress-circle ${progressPercent === 100 ? 'ready' : ''} ${downloadError ? 'error' : ''}`}>
                                <span className="progress-text">{downloadError ? "!" : `${progressPercent}%`}</span>
                            </div>
                            {downloadError ? (
                                <div className="error-box">
                                    <p>Download Error</p>
                                    <p className="setup-note">{downloadError}</p>
                                    <button className="retry-btn" onClick={onStartDownload}>Retry Download</button>
                                </div>
                            ) : (
                                <p>
                                    {progressPercent < 100
                                        ? `Downloading local brain... (${formatBytes(downloadProgress?.downloaded || 0)} / ${formatBytes(downloadProgress?.total || 0)})`
                                        : "Brain ready!"}
                                </p>
                            )}
                        </div>
                        <button
                            className="primary-btn"
                            onClick={() => onComplete()}
                            disabled={progressPercent < 100}
                        >
                            {progressPercent < 100 ? "Please Wait..." : "Finish Setup"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
