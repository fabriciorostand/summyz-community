import { BProgress } from "@bprogress/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNavigationProgress } from "./navigation-progress";

function Shell() {
  useNavigationProgress();
  return (
    <>
      <Link to="/next">next</Link>
      <Outlet />
    </>
  );
}

function renderWithPendingScreen() {
  let finish: (() => void) | undefined;
  const loaded = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const router = createMemoryRouter([
    {
      children: [
        { element: <h1>first</h1>, index: true },
        {
          lazy: async () => {
            await loaded;
            return { Component: () => <h1>second</h1> };
          },
          path: "next",
        },
      ],
      element: <Shell />,
    },
  ]);
  render(<RouterProvider router={router} />);
  return () => finish?.();
}

afterEach(() => {
  vi.restoreAllMocks();
  BProgress.done(true);
});

describe("useNavigationProgress", () => {
  it("starts the bar on the click and keeps the current screen until the next one loads", async () => {
    const start = vi.spyOn(BProgress, "start");
    const done = vi.spyOn(BProgress, "done");
    const finish = renderWithPendingScreen();

    await userEvent.click(screen.getByRole("link", { name: "next" }));

    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "first" })).toBeInTheDocument();
    expect(document.querySelector(".bprogress .bar")).not.toBeNull();

    done.mockClear();
    await act(async () => finish());

    expect(await screen.findByRole("heading", { name: "second" })).toBeInTheDocument();
    expect(done).toHaveBeenCalled();
  });

  it("uses a thin bar without the spinner", () => {
    renderWithPendingScreen();
    expect(BProgress.settings.showSpinner).toBe(false);
  });
});
