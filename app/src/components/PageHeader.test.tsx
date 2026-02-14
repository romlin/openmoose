import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
    it("renders the title", () => {
        render(<PageHeader title="Test Title" />);
        expect(screen.getByText("Test Title")).toBeInTheDocument();
    });

    it("renders back button when onBack is provided", () => {
        const onBack = vi.fn();
        render(<PageHeader title="Title" onBack={onBack} />);

        const backBtn = screen.getByText("Back");
        expect(backBtn).toBeInTheDocument();

        fireEvent.click(backBtn);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("does not render back button when onBack is not provided", () => {
        render(<PageHeader title="Title" />);
        expect(screen.queryByText("Back")).not.toBeInTheDocument();
    });

    it("renders menu toggle on mobile when onMenuToggle is provided", () => {
        const onMenuToggle = vi.fn();
        render(<PageHeader title="Title" onMenuToggle={onMenuToggle} />);

        const menuBtn = screen.getByLabelText("Toggle Menu");
        expect(menuBtn).toBeInTheDocument();

        fireEvent.click(menuBtn);
        expect(onMenuToggle).toHaveBeenCalledTimes(1);
    });

    it("renders children in header actions", () => {
        render(
            <PageHeader title="Title">
                <button>Action</button>
            </PageHeader>
        );
        expect(screen.getByText("Action")).toBeInTheDocument();
    });
});
