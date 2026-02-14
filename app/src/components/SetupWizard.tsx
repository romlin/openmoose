import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes, calcProgressPercent } from "../lib/utils";
import type { DownloadProgress } from "../lib/types";

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
    const [nodeStatus, setNodeStatus] = useState<"not_checked" | "checking" | "found" | "missing">("not_checked");
    const [nodeVersion, setNodeVersion] = useState<string | null>(null);
    const [dockerStatus, setDockerStatus] = useState<"not_checked" | "checking" | "found" | "missing">("not_checked");
    const [browserStatus, setBrowserStatus] = useState<"not_checked" | "checking" | "ready" | "error">("not_checked");
    const [browserError, setBrowserError] = useState<string | null>(null);

    const nextStep = () => setStep(prev => prev + 1);

    useEffect(() => {
        if (step === 2 && nodeStatus === "not_checked") {
            checkNode();
        }
        if (step === 3 && dockerStatus === "not_checked") {
            checkDocker();
        }
        if (step === 4 && browserStatus === "not_checked") {
            ensureBrowserReady();
        }
        if (step === 5 && !isDownloading && (!downloadProgress || (downloadProgress.downloaded < downloadProgress.total)) && !downloadError) {
            onStartDownload();
        }
    }, [step, nodeStatus, dockerStatus, browserStatus, isDownloading, onStartDownload, downloadProgress, downloadError]);

    const checkNode = async () => {
        setNodeStatus("checking");
        try {
            const version = await invoke<string>("check_node");
            setNodeVersion(version);
            setNodeStatus("found");
        } catch (err) {
            console.error("Node.js check failed:", err);
            setNodeStatus("missing");
        }
    };

    const checkDocker = async () => {
        setDockerStatus("checking");
        try {
            const isAvailable = await invoke<boolean>("check_docker");
            setDockerStatus(isAvailable ? "found" : "missing");
        } catch (err) {
            console.error("Docker check failed:", err);
            setDockerStatus("missing");
        }
    };

    const ensureBrowserReady = async () => {
        setBrowserStatus("checking");
        setBrowserError(null);
        try {
            await invoke("start_gateway");
            const base = `http://127.0.0.1:${gatewayPort}`;
            const healthUrl = `${base}/health`;
            const browserReadyUrl = `${base}/setup/browser-ready`;
            for (let i = 0; i < 60; i++) {
                try {
                    const r = await fetch(healthUrl);
                    if (r.ok) break;
                } catch {
                    // Gateway not up yet
                }
                await new Promise((r) => setTimeout(r, 500));
            }
            const readyRes = await fetch(browserReadyUrl);
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
    };

    const progressPercent = calcProgressPercent(downloadProgress);

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
                        <div className="mode-options">
                            <div className="mode-card active">
                                <h3>Node.js Runtime</h3>
                                <p>The AI gateway requires Node.js (v20+) to run locally.</p>
                            </div>
                        </div>

                        <div className={`docker-status ${nodeStatus}`}>
                            {nodeStatus === "checking" && <p>Checking for Node.js...</p>}
                            {nodeStatus === "found" && <p>Node.js detected: {nodeVersion}</p>}
                            {nodeStatus === "missing" && (
                                <div className="error-box">
                                    <p>Node.js not found.</p>
                                    <p className="setup-note">OpenMoose requires Node.js v20 or later. Install it from <strong>nodejs.org</strong> or via your package manager, then click retry.</p>
                                    <button className="retry-btn" onClick={checkNode}>Retry Check</button>
                                </div>
                            )}
                        </div>

                        <button
                            className="primary-btn"
                            onClick={nextStep}
                            disabled={nodeStatus !== "found"}
                        >
                            {nodeStatus === "found" ? "Continue" : "Waiting for Node.js..."}
                        </button>
                    </div>
                )}

                {step === 3 && (
                    <div className="setup-step fadeIn">
                        <h2>Secure by Default</h2>
                        <div className="mode-options">
                            <div className="mode-card active">
                                <h3>Hardened Sandbox</h3>
                                <p>All code skills (Python, Node.js) run in isolated Docker containers for maximum privacy and safety.</p>
                            </div>
                        </div>

                        <div className={`docker-status ${dockerStatus}`}>
                            {dockerStatus === "checking" && <p>Checking for Docker...</p>}
                            {dockerStatus === "found" && <p>Docker detected and running.</p>}
                            {dockerStatus === "missing" && (
                                <div className="error-box">
                                    <p>Docker not found or not running.</p>
                                    <p className="setup-note">OpenMoose requires Docker to run safely. Please install Docker and start the daemon, then click retry.</p>
                                    <button className="retry-btn" onClick={checkDocker}>Retry Check</button>
                                </div>
                            )}
                        </div>

                        <button
                            className="primary-btn"
                            onClick={nextStep}
                            disabled={dockerStatus !== "found"}
                        >
                            {dockerStatus === "found" ? "Continue" : "Waiting for Docker..."}
                        </button>
                    </div>
                )}

                {step === 4 && (
                    <div className="setup-step fadeIn">
                        <h2>Browser Container</h2>
                        <div className="mode-options">
                            <div className="mode-card active">
                                <h3>Build Sandbox Image</h3>
                                <p>OpenMoose builds a Docker image for running browser-based skills in isolation. This runs once.</p>
                            </div>
                        </div>

                        <div className={`docker-status ${browserStatus}`}>
                            {browserStatus === "checking" && <p>Starting gateway and building browser image...</p>}
                            {browserStatus === "ready" && <p>Browser container ready.</p>}
                            {browserStatus === "error" && (
                                <div className="error-box">
                                    <p>Browser image build failed.</p>
                                    <p className="setup-note">{browserError}</p>
                                    <button className="retry-btn" onClick={ensureBrowserReady}>Retry</button>
                                </div>
                            )}
                        </div>

                        <button
                            className="primary-btn"
                            onClick={nextStep}
                            disabled={browserStatus !== "ready"}
                        >
                            {browserStatus === "ready" ? "Continue" : "Waiting for browser container..."}
                        </button>
                    </div>
                )}

                {step === 5 && (
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
