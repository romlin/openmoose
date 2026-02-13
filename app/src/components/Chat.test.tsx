import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Chat } from "./Chat";

describe("Chat", () => {
    it("renders messages correctly", () => {
        const messages = [
            { id: 1, role: "assistant" as const, content: "Hello" },
            { id: 2, role: "user" as const, content: "Hi" }
        ];
        render(<Chat messages={messages} onSend={() => { }} isThinking={false} onMenuToggle={() => { }} />);
        expect(screen.getByText("Hello")).toBeInTheDocument();
        expect(screen.getByText("Hi")).toBeInTheDocument();
    });

    it("calls onSend with input value and clears input", () => {
        const onSend = vi.fn();
        render(<Chat messages={[]} onSend={onSend} isThinking={false} onMenuToggle={() => { }} />);

        const input = screen.getByPlaceholderText(/Talk to the moose/i);
        const button = screen.getByLabelText(/Send message/i);

        fireEvent.change(input, { target: { value: "Test Message" } });
        fireEvent.click(button);

        expect(onSend).toHaveBeenCalledWith("Test Message");
        expect(input).toHaveValue("");
    });

    it("does not call onSend if input is empty", () => {
        const onSend = vi.fn();
        render(<Chat messages={[]} onSend={onSend} isThinking={false} onMenuToggle={() => { }} />);

        fireEvent.click(screen.getByLabelText(/Send message/i));
        expect(onSend).not.toHaveBeenCalled();
    });
});
