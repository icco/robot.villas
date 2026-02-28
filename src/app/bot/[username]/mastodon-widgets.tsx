"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const PEERS_SEARCH_URL = "https://mastodon.social/api/v1/peers/search?q=";

function InstancePickerDialog({
  open,
  onPick,
  onClose,
}: {
  open: boolean;
  onPick: (instance: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open) {
      dialog.showModal();
      if (inputRef.current) {
        inputRef.current.value =
          localStorage.getItem("mastodon-instance") || "";
      }
      setSuggestions([]);
      setSelectedIndex(-1);
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

  const fetchSuggestions = useCallback(async (query: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(PEERS_SEARCH_URL + encodeURIComponent(query), {
        signal: abortRef.current.signal,
      });
      let json: string[] = await res.json();
      if (!json) {
        json = [];
      }
      if (
        query.length &&
        "mastodon.social".startsWith(query.toLowerCase())
      ) {
        json.unshift("mastodon.social");
      }
      setSuggestions(json.slice(0, 10));
      setSelectedIndex(-1);
    } catch {
      // aborted or network error
    }
  }, []);

  const submit = useCallback(
    (domain: string) => {
      const trimmed = domain.trim();
      if (!trimmed) {
        return;
      }
      localStorage.setItem("mastodon-instance", trimmed);
      onPick(trimmed);
    },
    [onPick],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => {
          const next = i < suggestions.length - 1 ? i + 1 : 0;
          if (inputRef.current && suggestions[next]) {
            inputRef.current.value = suggestions[next];
          }
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => {
          const next = i > 0 ? i - 1 : suggestions.length - 1;
          if (inputRef.current && suggestions[next]) {
            inputRef.current.value = suggestions[next];
          }
          return next;
        });
      }
    },
    [suggestions],
  );

  return (
    <dialog ref={dialogRef} className="modal">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Pick your instance</h3>
        <p className="py-2 text-sm text-base-content/70">
          Enter the Mastodon instance your account is hosted at.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(inputRef.current?.value || "");
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="e.g. mastodon.social"
            className="input input-bordered flex-1"
            onChange={(e) => fetchSuggestions(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button type="submit" className="btn btn-primary">
            Go
          </button>
        </form>
        {suggestions.length > 0 && (
          <ul className="menu menu-sm mt-2 max-h-48 overflow-y-auto bg-base-200 rounded-box">
            {suggestions.map((s, i) => (
              <li key={s}>
                <a
                  className={i === selectedIndex ? "active" : ""}
                  onClick={() => submit(s)}
                >
                  {s}
                </a>
              </li>
            ))}
          </ul>
        )}
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
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

export function FollowButton({
  account,
  children,
}: {
  account: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const handlePick = useCallback(
    (instance: string) => {
      setOpen(false);
      window.open(
        `https://${instance}/authorize_interaction?uri=@${account}`,
        "_blank",
        "noopener,noreferrer",
      );
    },
    [account],
  );

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <span
        className="inline-block cursor-pointer"
        onClick={() => setOpen(true)}
      >
        {children}
      </span>
      <InstancePickerDialog
        open={open}
        onPick={handlePick}
        onClose={handleClose}
      />
    </>
  );
}

export function InteractButton({
  uri,
  children,
}: {
  uri: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const handlePick = useCallback(
    (instance: string) => {
      setOpen(false);
      window.open(
        `https://${instance}/authorize_interaction?uri=${encodeURIComponent(uri)}`,
        "_blank",
        "noopener,noreferrer",
      );
    },
    [uri],
  );

  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <span className="inline-block" onClick={() => setOpen(true)}>
        {children}
      </span>
      <InstancePickerDialog
        open={open}
        onPick={handlePick}
        onClose={handleClose}
      />
    </>
  );
}
