import { BProgress } from "@bprogress/core";
import { useEffect } from "react";
import { useNavigation } from "react-router-dom";

import "@bprogress/core/css";

BProgress.configure({ showSpinner: false });

/**
 * Shows the thin bar at the top of the window from the click until the next screen has loaded;
 * meanwhile the current screen stays in place. The data inside each screen keeps its own
 * loading panels.
 */
export function useNavigationProgress(): void {
  const { state } = useNavigation();
  useEffect(() => {
    if (state === "idle") BProgress.done();
    else BProgress.start();
  }, [state]);
}
