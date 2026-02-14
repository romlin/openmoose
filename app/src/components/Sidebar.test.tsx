import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
    it("renders correctly", () => {
        render(<Sidebar activeView="chat" onViewChange={() => { }} onClearHistory={() => { }} />);
        expect(screen.getByText("Chat")).toBeInTheDocument();
        expect(screen.queryByText("Settings")).not.toBeInTheDocument();
        expect(screen.getByText("Memory")).toBeInTheDocument();
        expect(screen.queryByText("WhatsApp")).not.toBeInTheDocument();
    });
});
