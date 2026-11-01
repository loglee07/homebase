"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AccountKind } from "@/lib/finance";
import { formatCents } from "@/lib/money";
import { NAME_MAX, validateAccountInput, type AccountErrors, type ManualAccount, type ValidAccount } from "@/lib/manualAccounts";

export const KIND_LABEL: Record<AccountKind, string> = {
  checking: "Checking",
  savings: "Savings",
  investment: "Investments",
  debt: "Debts",
};
const KIND_ORDER: AccountKind[] = ["checking", "savings", "investment", "debt"];

/** "1234.50", editable and unambiguous. Uses integer math only. */
const centsToInput = (c: number) => formatCents(c).replace(/[$,]/g, "");

interface Props {
  /** Present when editing an existing account. */
  initial?: ManualAccount;
  onSave: (value: ValidAccount) => void;
  onCancel: () => void;
}

export function AccountForm({ initial, onSave, onCancel }: Props) {
  const uid = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<AccountKind | "">(initial?.kind ?? "");
  const [amountText, setAmountText] = useState(initial ? centsToInput(initial.balanceCents) : "");
  const [errors, setErrors] = useState<AccountErrors>({});
  const rootRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    rootRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateAccountInput({ name, kind, amountText });
    if (result.ok) return onSave(result.value);
    setErrors(result.errors);
    (result.errors.name ? nameRef : result.errors.kind ? kindRef : amountRef).current?.focus();
  };

  const isDebt = kind === "debt";
  const err = (k: keyof AccountErrors) => (errors[k] ? `${uid}-${k}-err` : undefined);

  return (
    <form ref={rootRef} className="ft-card bk-form" onSubmit={submit} noValidate aria-labelledby={`${uid}-title`}>
      <h3 id={`${uid}-title`}>{initial ? `Edit ${initial.name}` : "Add an account"}</h3>

      <div className="bk-field">
        <label htmlFor={`${uid}-name`}>Nickname</label>
        <input
          id={`${uid}-name`}
          ref={nameRef}
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
          aria-describedby={`${uid}-name-hint ${err("name") ?? ""}`.trim()}
        />
        <p id={`${uid}-name-hint`} className="bk-hint">A name you will recognize. Never an account number.</p>
        {errors.name && <p id={`${uid}-name-err`} className="bk-error" role="alert">{errors.name}</p>}
      </div>

      <div className="bk-field">
        <label htmlFor={`${uid}-kind`}>Type</label>
        <select
          id={`${uid}-kind`}
          ref={kindRef}
          value={kind}
          onChange={(e) => setKind(e.target.value as AccountKind | "")}
          aria-invalid={!!errors.kind}
          aria-describedby={err("kind")}
        >
          <option value="">Choose a type</option>
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        {errors.kind && <p id={`${uid}-kind-err`} className="bk-error" role="alert">{errors.kind}</p>}
      </div>

      <div className="bk-field">
        <label htmlFor={`${uid}-amount`}>{isDebt ? "Amount you owe (USD)" : "Current balance (USD)"}</label>
        <input
          id={`${uid}-amount`}
          ref={amountRef}
          value={amountText}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          onChange={(e) => setAmountText(e.target.value)}
          aria-invalid={!!errors.amount}
          aria-describedby={`${uid}-amount-hint ${err("amount") ?? ""}`.trim()}
        />
        <p id={`${uid}-amount-hint`} className="bk-hint">
          {isDebt ? "Enter what you owe as a positive amount. It is subtracted from your net worth." : "Up to two decimal places, like 1,234.56."}
        </p>
        {errors.amount && <p id={`${uid}-amount-err`} className="bk-error" role="alert">{errors.amount}</p>}
      </div>

      <div className="bk-actions">
        <button type="submit" className="ft-btn ft-btn-save">{initial ? "Save changes" : "Add account"}</button>
        <button type="button" className="ft-btn" onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
      </div>
    </form>
  );
}
