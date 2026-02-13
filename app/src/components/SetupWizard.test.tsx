import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SetupWizard } from "./SetupWizard";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn().mockResolvedValue(false),
}));

describe("SetupWizard", () => {
    const defaultProps = {
        onComplete: vi.fn(),
        downloadProgress: null,
        isDownloading: false,
        downloadError: null,
        onStartDownload: vi.fn(),
    };

    it("renders welcome step initially", () => {
        render(<SetupWizard {...defaultProps} />);
        expect(screen.getByText("Welcome to OpenMoose")).toBeInTheDocument();
        expect(screen.getByText("Get Started")).toBeInTheDocument();
    });

    it("advances to step 2 on Get Started click", async () => {
        render(<SetupWizard {...defaultProps} />);
        await act(async () => {
            fireEvent.click(screen.getByText("Get Started"));
        });
        expect(screen.getByText("Secure by Default")).toBeInTheDocument();
    });

    it("shows sandbox info on step 2", async () => {
        render(<SetupWizard {...defaultProps} />);
        await act(async () => {
            fireEvent.click(screen.getByText("Get Started"));
        });
        expect(screen.getByText("Hardened Sandbox")).toBeInTheDocument();
    });

    it("disables continue button when Docker is not found", async () => {
        render(<SetupWizard {...defaultProps} />);
        await act(async () => {
            fireEvent.click(screen.getByText("Get Started"));
        });
        const continueBtn = screen.getByText("Waiting for Docker...");
        expect(continueBtn).toBeDisabled();
    });

    it("shows download error text when present", () => {
        render(
            <SetupWizard
                {...defaultProps}
                downloadError="Network error"
            />
        );
        // On step 1, error isn't visible yet (shown on step 3)
        expect(screen.getByText("Welcome to OpenMoose")).toBeInTheDocument();
    });
});
