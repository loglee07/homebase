"use client";

import { useEffect, useRef, useState } from "react";
import type { Mode } from "@/lib/manualAccounts";
import type { Scenario } from "@/lib/sampleData";
import type { Access } from "./useBrokerage";
import { PixelIcon } from "./PixelIcon";

export interface HudProps {
  /** Already formatted by formatCents (integer cents -> "$1,234.56"). */
  netWorthText: string;
  /** Included connected balances are not all loaded, so the total is incomplete. */
  partial: boolean;
  homeTier: 1 | 2;
  mode: Mode;
  onMode: (m: Mode) => void;
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
  access: Access;
  onLock: () => void;
  onBank: () => void;
  onSchool: () => void;
  /** A dashboard is open: the town buttons are inert. */
  dialogOpen: boolean;
}

/** Compact Data menu: choose Demo or My accounts (and the demo scenario). A popover with real radio buttons. */
function DataMenu({ mode, onMode, scenario, onScenario }: Pick<HudProps, "mode" | "onMode" | "scenario" | "onScenario">) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="hud-menu" ref={root}>
      <button ref={button} className="hud-btn hud-btn-small" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>Data</span>
        {mode === "demo" ? <span className="hud-tag hud-tag-demo">Demo</span> : <span className="hud-menu-value">My accounts</span>}
        <PixelIcon name="chevron" size={14} />
      </button>
      {open && (
        <div className="hud-popover">
          <fieldset>
            <legend>Data source</legend>
            <label>
              <input type="radio" name="mode" checked={mode === "demo"} onChange={() => {
                  onMode("demo");
                  setOpen(false);
                }} />
              Demo <small>sample data only</small>
            </label>
            <label>
              <input type="radio" name="mode" checked={mode === "manual"} onChange={() => {
                  onMode("manual");
                  setOpen(false);
                }} />
              My accounts <small>saved in this browser</small>
            </label>
          </fieldset>
          {mode === "demo" && (
            <fieldset>
              <legend>Demo net worth</legend>
              <label>
                <input type="radio" name="scenario" checked={scenario === "below"} onChange={() => onScenario("below")} />
                Below $100k
              </label>
              <label>
                <input type="radio" name="scenario" checked={scenario === "above"} onChange={() => onScenario("above")} />
                Above $100k
              </label>
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}

/** The town's HUD: wooden title plaque, menu buttons, coin counter, data menu and the one global Lock. */
export function Hud(p: HudProps) {
  const loading = p.partial && p.access !== "locked";
  const counterLabel = p.partial
    ? `Net worth in USD, incomplete: ${loading ? "connected balances are still loading" : "connected balances are locked"}. ${p.netWorthText} so far`
    : `Net worth in USD: ${p.netWorthText}`;
  return (
    <header className="hud">
      <h1 className="hud-title">Finance Town</h1>

      <nav className="hud-nav" aria-label="Town buildings">
        <button className="hud-btn" onClick={p.onBank} disabled={p.dialogOpen}>
          <PixelIcon name="bank" />
          <span>Bank</span>
        </button>
        <button className="hud-btn" onClick={p.onSchool} disabled={p.dialogOpen}>
          <PixelIcon name="school" />
          <span>School</span>
        </button>
      </nav>

      <div className={`hud-counter${p.partial ? " hud-counter-partial" : ""}`} role="group" aria-label={counterLabel} title="Net worth in USD">
        <PixelIcon name="coin" size={26} />
        <span className="hud-amount" aria-hidden="true">
          {p.netWorthText}
        </span>
        {p.partial && (
          <span className="hud-tag hud-tag-partial" aria-hidden="true">
            {loading ? "Loading" : "Partial"}
          </span>
        )}
        {p.mode === "demo" && (
          <span className="hud-tag hud-tag-demo" aria-hidden="true">
            Demo
          </span>
        )}
      </div>
      <span className="hud-home" title="Your home grows with net worth">
        Home: {p.homeTier === 2 ? "Manor" : "Cottage"}
      </span>

      <div className="hud-right">
        <DataMenu mode={p.mode} onMode={p.onMode} scenario={p.scenario} onScenario={p.onScenario} />
        {p.access === "unlocked" ? (
          <button className="hud-btn hud-btn-small hud-lock" onClick={p.onLock} title="End the local session and clear private data from this page">
            <PixelIcon name="lock" size={20} />
            <span>Lock</span>
          </button>
        ) : (
          <span className="hud-locked" role="status" title="Private data is hidden until you unlock it in the Bank or School">
            <PixelIcon name="lock" size={18} />
            <span>{p.access === "checking" ? "Checking…" : p.access === "not_configured" ? "Private data off" : "Locked"}</span>
          </span>
        )}
      </div>
    </header>
  );
}
