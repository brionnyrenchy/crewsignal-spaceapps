import { useRef, type KeyboardEvent } from "react";

/**
 * W3C APG tabs pattern: one tab in the Tab order (roving tabindex), Left/Right
 * arrows move between tabs, Home/End jump to the ends, and each tab controls a
 * labelled tabpanel. With manual activation the arrows only move focus and
 * Enter/Space selects, so switching can still pass through draft protection.
 */
export function useTabList<T extends string>(opts: {
  ids: readonly T[];
  selected: T;
  onSelect: (id: T) => void;
  idPrefix: string;
  activation?: "automatic" | "manual";
}) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());
  const { ids, selected, onSelect, idPrefix, activation = "automatic" } = opts;
  const panelId = `${idPrefix}-panel`;
  const tabId = (id: T) => `${idPrefix}-tab-${id}`;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: T) => {
    const i = ids.indexOf(current);
    let next: T | undefined;
    switch (event.key) {
      case "ArrowRight":
        next = ids[(i + 1) % ids.length];
        break;
      case "ArrowLeft":
        next = ids[(i - 1 + ids.length) % ids.length];
        break;
      case "Home":
        next = ids[0];
        break;
      case "End":
        next = ids[ids.length - 1];
        break;
      default:
        return;
    }
    if (next === undefined) return;
    event.preventDefault();
    refs.current.get(next)?.focus();
    if (activation === "automatic") onSelect(next);
  };

  return {
    getTabProps: (id: T) => ({
      id: tabId(id),
      role: "tab" as const,
      "aria-selected": id === selected,
      "aria-controls": panelId,
      tabIndex: id === selected ? 0 : -1,
      ref: (el: HTMLButtonElement | null) => {
        refs.current.set(id, el);
      },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, id),
      onClick: () => onSelect(id),
    }),
    panelProps: {
      id: panelId,
      role: "tabpanel" as const,
      "aria-labelledby": tabId(selected),
    },
  };
}
