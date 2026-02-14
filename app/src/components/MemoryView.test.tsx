import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryView } from "./MemoryView";
import type { MemoryEntry } from "../lib/types";

const mockMemories: MemoryEntry[] = [
    {
        id: "1",
        text: "User prefers dark mode",
        source: "chat",
        createdAt: Date.now(),
        metadata: "test",
    },
    {
        id: "2",
        text: "API documentation snippet",
        source: "doc",
        createdAt: Date.now() - 86400000,
        metadata: "test",
    },
];

describe("MemoryView", () => {
    it("renders the page header", () => {
        render(<MemoryView memories={[]} onSearch={() => { }} onClearMemory={() => { }} />);
        expect(screen.getByText("Memory")).toBeInTheDocument();
    });

    it("shows empty state when no memories", () => {
        render(<MemoryView memories={[]} onSearch={() => { }} onClearMemory={() => { }} />);
        expect(screen.getByText("No memories found matching your criteria.")).toBeInTheDocument();
    });

    it("renders memory entries", () => {
        render(<MemoryView memories={mockMemories} onSearch={() => { }} onClearMemory={() => { }} />);
        expect(screen.getByText("User prefers dark mode")).toBeInTheDocument();
        expect(screen.getByText("API documentation snippet")).toBeInTheDocument();
    });

    it("displays source tags correctly", () => {
        render(<MemoryView memories={mockMemories} onSearch={() => { }} onClearMemory={() => { }} />);
        // "Chat" appears in both filter chip and source tag
        const chatElements = screen.getAllByText("Chat");
        expect(chatElements.length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText("Doc")).toBeInTheDocument();
    });

    it("calls onClearMemory when nuke button is clicked", () => {
        const onClearMemory = vi.fn();
        render(<MemoryView memories={[]} onSearch={() => { }} onClearMemory={onClearMemory} />);

        fireEvent.click(screen.getByText("Nuke Memory"));
        expect(onClearMemory).toHaveBeenCalledTimes(1);
    });

    it("renders search input", () => {
        render(<MemoryView memories={[]} onSearch={() => { }} onClearMemory={() => { }} />);
        expect(screen.getByPlaceholderText("Search memories...")).toBeInTheDocument();
    });

    it("renders filter chips", () => {
        render(<MemoryView memories={[]} onSearch={() => { }} onClearMemory={() => { }} />);
        expect(screen.getByText("All")).toBeInTheDocument();
        expect(screen.getByText("Docs")).toBeInTheDocument();
    });
});
