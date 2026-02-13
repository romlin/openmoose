import { describe, it, expect } from "vitest";
import { formatBytes, calcProgressPercent, formatUptime } from "./utils";

describe("formatBytes", () => {
    it("returns '0 GB' for zero bytes", () => {
        expect(formatBytes(0)).toBe("0 GB");
    });

    it("formats bytes to GB with two decimal places", () => {
        expect(formatBytes(1_000_000_000)).toBe("1.00 GB");
        expect(formatBytes(8_239_591_488)).toBe("8.24 GB");
    });

    it("formats small values correctly", () => {
        expect(formatBytes(500_000_000)).toBe("0.50 GB");
    });
});

describe("calcProgressPercent", () => {
    it("returns 0 for null progress", () => {
        expect(calcProgressPercent(null)).toBe(0);
    });

    it("returns 0 when total is 0", () => {
        expect(calcProgressPercent({ downloaded: 0, total: 0 })).toBe(0);
    });

    it("returns 0 when total is negative", () => {
        expect(calcProgressPercent({ downloaded: 100, total: -1 })).toBe(0);
    });

    it("calculates correct percentage", () => {
        expect(calcProgressPercent({ downloaded: 50, total: 100 })).toBe(50);
        expect(calcProgressPercent({ downloaded: 100, total: 100 })).toBe(100);
        expect(calcProgressPercent({ downloaded: 1, total: 3 })).toBe(33);
    });

    it("caps at 100%", () => {
        expect(calcProgressPercent({ downloaded: 150, total: 100 })).toBe(100);
    });
});

describe("formatUptime", () => {
    it("formats zero seconds", () => {
        expect(formatUptime(0)).toBe("0h 0m 0s");
    });

    it("formats seconds only", () => {
        expect(formatUptime(45)).toBe("0h 0m 45s");
    });

    it("formats minutes and seconds", () => {
        expect(formatUptime(125)).toBe("0h 2m 5s");
    });

    it("formats hours, minutes, and seconds", () => {
        expect(formatUptime(3661)).toBe("1h 1m 1s");
    });

    it("handles large values", () => {
        expect(formatUptime(86400)).toBe("24h 0m 0s");
    });
});
