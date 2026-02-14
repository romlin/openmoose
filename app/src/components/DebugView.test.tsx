import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DebugView } from "./DebugView";

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn().mockResolvedValue({
        config: { setup_complete: true },
        model_exists: true,
        model_size: 8_239_591_488,
        model_name: "test-model.gguf",
    }),
}));

describe("DebugView", () => {
    const defaultProps = {
        onBack: vi.fn(),
        ws: null,
        onMenuToggle: vi.fn(),
    };

    it("renders the debug header", async () => {
        await act(async () => {
            render(<DebugView {...defaultProps} />);
        });
        expect(screen.getByText("Debug")).toBeInTheDocument();
    });

    it("renders section headers", async () => {
        await act(async () => {
            render(<DebugView {...defaultProps} />);
        });
        expect(screen.getByText("System")).toBeInTheDocument();
        expect(screen.getByText("Brain")).toBeInTheDocument();
        expect(screen.getByText("Skills & Scheduler")).toBeInTheDocument();
        expect(screen.getByText("Registry")).toBeInTheDocument();
    });

    it("shows loading state when no gateway info", async () => {
        await act(async () => {
            render(<DebugView {...defaultProps} />);
        });
        const loadingElements = screen.getAllByText("Loading...");
        expect(loadingElements.length).toBeGreaterThan(0);
    });

    it("renders copy report button", async () => {
        await act(async () => {
            render(<DebugView {...defaultProps} />);
        });
        expect(screen.getByText("Copy Full Report")).toBeInTheDocument();
    });
});
