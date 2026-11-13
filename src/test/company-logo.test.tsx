import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandMark } from "@/components/kora/BrandMark";
import { companyLogoUrl } from "@/lib/branding/companyLogo";

const BRAND = { initials: "AT", bg: "#eeeeee", fg: "#222222" };
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Brandfetch company logos", () => {
  it("normalizes domains and uses a fixed CDN destination", () => {
    expect(companyLogoUrl("  Example.COM ", " client_123 ")).toBe(
      "https://cdn.brandfetch.io/domain/example.com/fallback/404?c=client_123",
    );
  });
  it.each([
    "",
    "localhost",
    "127.0.0.1",
    "192.168.1.1",
    "example.123",
    "http://example.com",
    "foo/bar.com",
    "example..com",
    "-bad.com",
  ])("rejects an invalid domain: %s", (domain) => {
    expect(companyLogoUrl(domain, "client_123")).toBeNull();
  });
  it("rejects an absent or unsafe client ID", () => {
    expect(companyLogoUrl("example.com", undefined)).toBeNull();
    expect(companyLogoUrl("example.com", "bad?key=x")).toBeNull();
  });
  it("uses the built-in Brandfetch client ID when none is configured", () => {
    vi.stubEnv("VITE_BRANDFETCH_CLIENT_ID", "");
    const { container } = render(
      <BrandMark name="Atelier Test" brand={BRAND} domain="example.com" />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toContain("c=1idN_gdBifvgQSOoG-X");
  });
  it("renders an image and uses the local fallback on image error", () => {
    vi.stubEnv("VITE_BRANDFETCH_CLIENT_ID", "client_123");
    const { container } = render(
      <BrandMark name="Atelier Test" brand={BRAND} domain="example.com" />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("/domain/example.com/fallback/404?");
    expect(img?.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    if (!img) throw new Error("Expected a logo image");
    fireEvent.load(img);
    expect(screen.queryByText("AT")).toBeNull();
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AT")).toBeTruthy();
  });
  it("handles changing company domain without preserving the previous logo", () => {
    vi.stubEnv("VITE_BRANDFETCH_CLIENT_ID", "client_123");
    const { container, rerender } = render(
      <BrandMark name="Atelier Test" brand={BRAND} domain="example.com" />,
    );
    const img = container.querySelector("img");
    if (!img) throw new Error("Expected logo image");
    fireEvent.load(img);
    rerender(<BrandMark name="Atelier Test" brand={BRAND} domain="new-example.com" />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "/domain/new-example.com/",
    );
    expect(screen.getByText("AT")).toBeTruthy();
  });
  it("times out when an image does not load", () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_BRANDFETCH_CLIENT_ID", "client_123");
    const { container } = render(
      <BrandMark name="Atelier Test" brand={BRAND} domain="example.com" />,
    );
    expect(container.querySelector("img")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(10_001);
    });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AT")).toBeTruthy();
  });
  it("does not request logos for media without an explicit company domain", () => {
    vi.stubEnv("VITE_BRANDFETCH_CLIENT_ID", "client_123");
    const { container } = render(<BrandMark name="Les Echos" brand={BRAND} />);
    expect(container.querySelector("img")).toBeNull();
  });
});
