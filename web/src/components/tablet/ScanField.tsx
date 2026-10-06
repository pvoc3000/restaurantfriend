import type { ReactNode } from "react";

/** A captioned field in the scan tiles' filing dialogs — `NewBill`'s own. */
export function ScanField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[12px] uppercase tracking-[0.12em] text-subtle">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </div>
  );
}
