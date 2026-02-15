import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { SetupWizard } from "./SetupWizard";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn().mockImplementation((cmd: string) => {
        if (cmd === "check_node") return Promise.reject("not found");
        if (cmd === "check_docker") return Promise.resolve(false);
        return Promise.resolve(false);
    }),
}));

describe("SetupWizard", () => {
    // Suppress expected console.error from rejected invoke mocks
    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeAll(() => { errorSpy = vi.spyOn(console, "error").mockImplementation(() => {}); });
    afterAll(() => { errorSpy.mockRestore(); });

    const defaultProps = {
        onComplete: vi.fn(),
        downloadProgress: null,
        isDownloading: false,
        downloadError: null,
        onStartDownload: vi.fn(),
        gatewayPort: 18789,
    };

    it("renders welcome step initially", () => {
        render(<SetupWizard {...defaultProps} />);
        expect(screen.getByText("Welcome to OpenMoose")).toBeInTheDocument();
        expect(screen.getByText("Get Started")).toBeInTheDocument();
    });

    it("advances to step 2 (system requirements) on Get Started click", async () => {
        render(<SetupWizard {...defaultProps} />);
        await act(async () => {
            fireEvent.click(screen.getByText("Get Started"));
        });
        await waitFor(() =>
            expect(screen.getByText("System Requirements")).toBeInTheDocument()
        );
    });

    it("shows both Node.js and Docker checks on step 2", async () => {
        render(<SetupWizard {...defaultProps} />);
        await act(async () => {
            fireEvent.click(screen.getByText("Get Started"));
        });
        expect(screen.getByText("Node.js")).toBeInTheDocument();
        expect(screen.getByText("Docker")).toBeInTheDocument();
    });

    it("disables continue button when requirements are not met", async () => {
        render(<SetupWizard {...defaultProps} />);
        await act(async () => {
            fireEvent.click(screen.getByText("Get Started"));
        });
        await waitFor(() => {
            const continueBtn = screen.getByText("Waiting...");
            expect(continueBtn).toBeDisabled();
        });
    });

    it("does not show download error on step 1", () => {
        render(
            <SetupWizard
                {...defaultProps}
                downloadError="Network error"
            />
        );
        // On step 1, error isn't visible yet (shown on step 4)
        expect(screen.getByText("Welcome to OpenMoose")).toBeInTheDocument();
        expect(screen.queryByText("Network error")).toBeNull();
    });
});
