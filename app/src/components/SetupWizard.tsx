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
}

export function SetupWizard({
    onComplete,
    downloadProgress,
    isDownloading,
    downloadError,
    onStartDownload
}: SetupWizardProps) {
    const [step, setStep] = useState(1);
    const [dockerStatus, setDockerStatus] = useState<"not_checked" | "checking" | "found" | "missing">("not_checked");

    const nextStep = () => setStep(prev => prev + 1);

    useEffect(() => {
        if (step === 2 && dockerStatus === "not_checked") {
            checkDocker();
        }
        if (step === 3 && !isDownloading && (!downloadProgress || (downloadProgress.downloaded < downloadProgress.total))) {
            onStartDownload();
        }
    }, [step, dockerStatus, isDownloading, onStartDownload, downloadProgress]);

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

                {step === 3 && (
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
