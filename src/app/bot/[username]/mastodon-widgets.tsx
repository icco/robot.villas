"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { interactionUrl, normalizeInstance, parseSuggestions } from "@/lib/instance";

const PEERS_SEARCH_URL = "https://mastodon.social/api/v1/peers/search?q=";
const STORAGE_KEY = "mastodon-instance";

function InstancePickerDialog({
  open,
  title,
  description,
  copyLabel,
  copyValue,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  copyLabel: string;
  copyValue: string;
  onPick: (instance: string) => void;
  onClose: () => void;
}) {
  const ids = { title: useId(), input: useId(), error: useId(), list: useId() };
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open) {
      dialog.showModal();
      setValue(localStorage.getItem(STORAGE_KEY) || "");
      setError(null);
      setSuggestions([]);
      setSelectedIndex(-1);
      setCopied(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const handler = () => onClose();
    dialog.addEventListener("close", handler);
    return () => dialog.removeEventListener("close", handler);
  }, [onClose]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
  }, []);

  // Suggestions are a convenience: failures are silent and typing still works.
  const fetchSuggestions = useCallback((query: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    abortRef.current?.abort();
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(PEERS_SEARCH_URL + encodeURIComponent(query.trim()), { signal: controller.signal });
        const list = res.ok ? parseSuggestions(await res.json()) : [];
        if ("mastodon.social".startsWith(query.trim().toLowerCase()) && !list.includes("mastodon.social")) {
          list.unshift("mastodon.social");
        }
        setSuggestions(list.slice(0, 10));
        setSelectedIndex(-1);
      } catch {
        // aborted or unavailable
      }
    }, 250);
  }, []);

  const submit = useCallback(
    (raw: string) => {
      const instance = normalizeInstance(raw);
      if (!instance) {
        setError("Enter your server's address, like mastodon.social or @you@mastodon.social.");
        inputRef.current?.focus();
        return;
      }
      localStorage.setItem(STORAGE_KEY, instance);
      onPick(instance);
    },
    [onPick],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [copyValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (suggestions.length === 0 || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) {
        return;
      }
      e.preventDefault();
      setSelectedIndex((i) => {
        const next = e.key === "ArrowDown"
          ? (i < suggestions.length - 1 ? i + 1 : 0)
          : (i > 0 ? i - 1 : suggestions.length - 1);
        setValue(suggestions[next]);
        return next;
      });
    },
    [suggestions],
  );

  return (
    <dialog ref={dialogRef} className="modal" aria-labelledby={ids.title}>
      <div className="modal-box">
        <h3 id={ids.title} className="font-bold text-lg">{title}</h3>
        <p className="py-2 text-sm text-base-content/70">{description}</p>
        <form
          className="flex gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
        >
          <label htmlFor={ids.input} className="sr-only">Your server</label>
          <input
            ref={inputRef}
            id={ids.input}
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="e.g. mastodon.social"
            className={`input input-bordered flex-1 ${error ? "input-error" : ""}`}
            value={value}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={ids.list}
            aria-autocomplete="list"
            aria-activedescendant={selectedIndex >= 0 ? `${ids.list}-${selectedIndex}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? ids.error : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
              fetchSuggestions(e.target.value);
            }}
            onKeyDown={handleKeyDown}
          />
          <button type="submit" className="btn btn-primary">
            Go
          </button>
        </form>
        {error && (
          <p id={ids.error} role="alert" className="text-error text-sm mt-2">{error}</p>
        )}
        {suggestions.length > 0 && (
          <ul id={ids.list} role="listbox" aria-label="Suggested servers" className="menu menu-sm mt-2 max-h-48 overflow-y-auto bg-base-200 rounded-box w-full">
            {suggestions.map((s, i) => (
              <li key={s} role="none">
                <button
                  type="button"
                  id={`${ids.list}-${i}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === selectedIndex}
                  className={i === selectedIndex ? "active" : ""}
                  onClick={() => submit(s)}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="divider text-xs my-3">or</div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-base-content/70">{copyLabel}</span>
          <code className="font-mono text-xs break-all">{copyValue}</code>
          <button type="button" className="btn btn-xs" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <span className="sr-only" aria-live="polite">{copied ? "Copied to clipboard" : ""}</span>
        </div>
        <p className="text-xs mt-3 opacity-60">
          Don&apos;t have an account? Find a server at{" "}
          <a
            href="https://joinmastodon.org/servers"
            target="_blank"
            rel="noopener noreferrer"
            className="link"
          >
            joinmastodon.org
          </a>
        </p>
        <div className="modal-action mt-2">
          <form method="dialog">
            <button className="btn btn-ghost btn-sm">Cancel</button>
          </form>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button tabIndex={-1} aria-hidden="true">close</button>
      </form>
    </dialog>
  );
}

/**
 * Opens a blank tab first: with `noopener`, `window.open()` returns null even
 * on success, so it could not tell a blocked popup apart. Falls back to
 * navigating this tab only when the popup really was blocked.
 */
function openInteraction(instance: string, uri: string) {
  const url = interactionUrl(instance, uri);
  const popup = window.open("", "_blank");
  if (!popup) {
    window.location.assign(url);
    return;
  }
  popup.opener = null;
  popup.location.href = url;
}

export function FollowButton({
  account,
  children,
}: {
  account: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const handle = `@${account}`;
  const handlePick = useCallback(
    (instance: string) => {
      setOpen(false);
      openInteraction(instance, handle);
    },
    [handle],
  );
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      {/* children is the visible, keyboard-focusable button; Enter/Space fire click. */}
      <span className="inline-block" onClickCapture={(e) => {
        e.preventDefault();
        setOpen(true);
      }}>
        {children}
      </span>
      <InstancePickerDialog
        open={open}
        title="Follow from your server"
        description="Enter the server your account is on. You'll finish following there."
        copyLabel="Or search your app for"
        copyValue={handle}
        onPick={handlePick}
        onClose={handleClose}
      />
    </>
  );
}

export function InteractButton({
  uri,
  action,
  children,
}: {
  uri: string;
  action: "boost" | "favorite";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const handlePick = useCallback(
    (instance: string) => {
      setOpen(false);
      openInteraction(instance, uri);
    },
    [uri],
  );
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <span className="inline-block" onClickCapture={(e) => {
        e.preventDefault();
        setOpen(true);
      }}>
        {children}
      </span>
      <InstancePickerDialog
        open={open}
        title={action === "boost" ? "Boost from your server" : "Favorite from your server"}
        description={`Enter the server your account is on. The post opens there so you can ${action} it.`}
        copyLabel="Or paste this post's address into your app's search:"
        copyValue={uri}
        onPick={handlePick}
        onClose={handleClose}
      />
    </>
  );
}
