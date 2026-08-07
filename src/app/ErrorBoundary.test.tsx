import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

describe("application error boundary", () => {
  it("offers a safe retry and explains that local records remain protected", () => {
    let shouldThrow = true;
    function Child() {
      if (shouldThrow) throw new Error("secret database path");
      return <p>Recovered application</p>;
    }

    render(
      <ErrorBoundary>
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("heading", { name: "MiroraTrack needs to recover" }))
      .toBeInTheDocument();
    expect(screen.getByText(/finance records remain stored locally and were not reset/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/secret database path/i)).not.toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered application")).toBeInTheDocument();
  });

  it("uses an injected safe reload action without offering data deletion", () => {
    const reload = vi.fn();
    render(
      <ErrorBoundary onReload={reload}>
        <Throw />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload MiroraTrack" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /reset|delete/i }))
      .not.toBeInTheDocument();
  });
});

function Throw(): never {
  throw new Error("render failed");
}

