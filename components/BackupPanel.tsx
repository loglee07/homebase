"use client";

import { useEffect, useRef } from "react";
import { BACKUP_MAX_BYTES, parseBackup, type BackupPreview } from "@/lib/manualBackup";
import { formatCents } from "@/lib/money";

export type BackupStatus =
  | { kind: "error"; message: string }
  | { kind: "preview"; preview: BackupPreview }
  | { kind: "done"; message: string }
  | null;

interface Props {
  status: BackupStatus;
  setStatus: (s: BackupStatus) => void;
  currentCount: number;
  currentNetWorthCents: number;
  /** Replaces all manual accounts. Must return true only after the new data is saved. */
  onReplace: (preview: BackupPreview) => boolean;
  onExport: () => void;
}

/** Export and import buttons plus the messages and the replace confirmation. Nothing changes until "Replace". */
export function BackupPanel({ status, setStatus, currentCount, currentNetWorthCents, onReplace, onExport }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const importBtnRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status) messageRef.current?.focus();
  }, [status]);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again later
    if (!file) return;
    if (file.size > BACKUP_MAX_BYTES) return setStatus({ kind: "error", message: "That file is too large to be a backup." });
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setStatus({ kind: "error", message: "That file could not be read." });
    }
    const result = parseBackup(text);
    setStatus(result.ok ? { kind: "preview", preview: result.preview } : { kind: "error", message: result.error });
  };

  const dismiss = () => {
    setStatus(null);
    setTimeout(() => importBtnRef.current?.focus(), 0);
  };

  return (
    <>
      <div className="bk-toolbar-group">
        <button className="ft-btn" onClick={onExport} disabled={currentCount === 0} title={currentCount === 0 ? "Add an account first" : undefined}>
          Export backup
        </button>
        <button ref={importBtnRef} className="ft-btn" onClick={() => fileRef.current?.click()}>Import backup</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pick} tabIndex={-1} />
      </div>

      {status && (
        <article
          ref={messageRef}
          tabIndex={-1}
          className={`ft-card bk-notice ${status.kind === "error" ? "bk-notice-warn" : ""}`}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {status.kind === "error" && (
            <>
              <h3>That backup was not imported</h3>
              <p>{status.message} Your current accounts were not changed.</p>
              <div className="bk-actions"><button className="ft-btn" onClick={dismiss}>OK</button></div>
            </>
          )}
          {status.kind === "preview" && (
            <>
              <h3>Replace your accounts with this backup?</h3>
              <p>
                The backup has <b>{status.preview.accountCount}</b> {status.preview.accountCount === 1 ? "account" : "accounts"} and a net worth of{" "}
                <b>{formatCents(status.preview.netWorthCents)}</b>.
              </p>
              <p>
                This replaces your {currentCount} current {currentCount === 1 ? "account" : "accounts"} ({formatCents(currentNetWorthCents)} net worth).
                It cannot be undone, so export a backup of the current ones first if you want to keep them.
              </p>
              <div className="bk-actions">
                <button
                  className="ft-btn ft-btn-save"
                  onClick={() => {
                    const ok = onReplace(status.preview);
                    setStatus(
                      ok
                        ? { kind: "done", message: `Restored ${status.preview.accountCount} ${status.preview.accountCount === 1 ? "account" : "accounts"} from the backup.` }
                        : { kind: "error", message: "This browser would not save the restored accounts." },
                    );
                  }}
                >
                  Replace my accounts
                </button>
                <button className="ft-btn" onClick={dismiss}>Cancel <kbd>Esc</kbd></button>
              </div>
            </>
          )}
          {status.kind === "done" && (
            <>
              <p>{status.message}</p>
              <div className="bk-actions"><button className="ft-btn" onClick={dismiss}>OK</button></div>
            </>
          )}
        </article>
      )}
    </>
  );
}
