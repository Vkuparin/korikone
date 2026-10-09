import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export function Choice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  onChange: (value: string) => Promise<unknown>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 280,
    maxHeight: 340,
  });
  const selected = options.find((option) => option.value === value);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(box.width, 280), window.innerWidth - 24);
      const below = window.innerHeight - box.bottom - 20;
      const above = box.top - 20;
      const upwards = below < 180 && above > below;
      const height = Math.min(340, upwards ? above : below);
      setPosition({
        left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)),
        top: upwards
          ? box.top - Math.min(menu.current!.scrollHeight, height) - 8
          : box.bottom + 8,
        width,
        maxHeight: height,
      });
    };
    place();
    const chosen = menu.current?.querySelector<HTMLButtonElement>(
      '[aria-selected="true"]:not(:disabled)',
    );
    (
      chosen ??
      menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")
    )?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <>
      <button
        ref={trigger}
        className="choice-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={selected?.label ?? value}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="choice-value">{selected?.label ?? value}</span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
          <path
            d="m4 6 4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            aria-label={label}
            className="choice-menu"
            style={position}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
              if (event.key === "Tab") close();
              const items = Array.from(
                menu.current!.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const target =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : event.key === "ArrowDown"
                      ? (index + 1) % items.length
                      : event.key === "ArrowUp"
                        ? (index - 1 + items.length) % items.length
                        : -1;
              if (target >= 0) {
                event.preventDefault();
                items[target]?.focus();
              }
            }}
          >
            {options.map((option) => (
              <button
                key={option.value}
                role="option"
                aria-selected={value === option.value}
                tabIndex={-1}
                disabled={option.disabled}
                onClick={async () => {
                  close();
                  await onChange(option.value);
                  trigger.current?.focus();
                }}
              >
                <span>{option.label}</span>
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  style={{
                    visibility: value === option.value ? "visible" : "hidden",
                  }}
                >
                  <path
                    d="m4 10 4 4 8-8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
