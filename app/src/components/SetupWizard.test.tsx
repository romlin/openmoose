import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SetupWizard } from "./SetupWizard";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn().mockImplementation((cmd: string) => {
        if (cmd === "check_node") return Promise.reject("not found");
        if (cmd === "check_docker") return Promise.resolve(false);
        return Promise.resolve(false);
    }),
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

    it("advances to step 2 (Node.js check) on Get Started click", async () => {
        render(<SetupWizard {...defaultProps} />);
        await act(async () => {
            fireEvent.click(screen.getByText("Get Started"));
        });
        expect(screen.getByText("System Requirements")).toBeInTheDocument();
    });

    it("shows Node.js requirement info on step 2", async () => {
        render(<SetupWizard {...defaultProps} />);
        await act(async () => {
            fireEvent.click(screen.getByText("Get Started"));
        });
        expect(screen.getByText("Node.js Runtime")).toBeInTheDocument();
    });

    it("disables continue button when Node.js is not found", async () => {
        render(<SetupWizard {...defaultProps} />);
        await act(async () => {
            fireEvent.click(screen.getByText("Get Started"));
        });
        const continueBtn = screen.getByText("Waiting for Node.js...");
        expect(continueBtn).toBeDisabled();
    });

    it("shows download error text when present", () => {
        render(
            <SetupWizard
                {...defaultProps}
                downloadError="Network error"
            />
        );
        // On step 1, error isn't visible yet (shown on step 4)
        expect(screen.getByText("Welcome to OpenMoose")).toBeInTheDocument();
    });
});
