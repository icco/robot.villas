"use client";

import { ErrorMessage } from "@icco/react-common/ErrorMessage";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: Props) {
  return (
    <div>
      <ErrorMessage error={error} message={error.message || "Something went wrong."} />
      <button className="btn btn-ghost btn-sm mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
