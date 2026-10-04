"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Accessibility behaviour shared by modal dialogs.
 *
 * Returns a ref to attach to the dialog's content element. While mounted it:
 *  - moves focus into the dialog and restores it to the previously focused
 *    element on close,
 *  - traps Tab / Shift+Tab inside the dialog,
 *  - closes on Escape.
 *
 * The caller still supplies role="dialog" and aria-modal="true" so the label
 * can be wired up per dialog.
 *
 * The setup effect deliberately runs once on mount. `onClose` is kept in a ref
 * so that callers passing an inline arrow do not re-run the effect on every
 * render — doing so would steal focus back to the first field on each
 * keystroke, which is the failure mode this hook exists to prevent.
 */
export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(onClose?: () => void) {
  const containerRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () => {
      if (!container) return [] as HTMLElement[];
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.offsetParent !== null || element === document.activeElement);
    };

    const initial = focusable()[0];
    if (initial) {
      initial.focus();
    } else if (container) {
      if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
      container.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !container) return;

      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  return containerRef;
}
