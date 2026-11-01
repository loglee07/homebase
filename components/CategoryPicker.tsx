"use client";

import { ASSET_KINDS, ASSET_KIND_LABEL, type AssetKind } from "@/lib/brokerage";

interface Props {
  /** The provider's own category for this account. Never changed by the picker. */
  defaultKind: AssetKind;
  /** The saved override, if any. */
  override: AssetKind | undefined;
  label: string;
  onChange: (kind: AssetKind | null) => void;
}

/** Chooses which category a connected account is listed under. Display only: it never changes the balance or what counts. */
export function CategoryPicker({ defaultKind, override, label, onChange }: Props) {
  const shown = override ?? defaultKind;
  return (
    <div className="bk-cat">
      <label>
        <span>Show under</span>
        <select value={shown} aria-label={`Category for ${label}`} onChange={(e) => onChange(e.target.value === defaultKind ? null : (e.target.value as AssetKind))}>
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {ASSET_KIND_LABEL[k]}
              {k === defaultKind ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>
      {override !== undefined && (
        <button className="bk-link" onClick={() => onChange(null)}>
          Use default
        </button>
      )}
    </div>
  );
}
