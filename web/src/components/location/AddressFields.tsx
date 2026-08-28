import { InlineValue } from "@/components/catalog/InlineValue";
import { BOXED_FIELDS } from "@/components/ui/fieldMetrics";

export type AddressGroup = "shipping" | "billing";

type Field = { key: string; label: string };

const BASE: Field[] = [
  { key: "street1", label: "Street" },
  { key: "street2", label: "Street 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "ZIP" },
  { key: "phone", label: "Phone" },
];

/** Billing carries an email; shipping has nobody to write to. */
const EMAIL: Field = { key: "email", label: "Email" };

/**
 * One of the two addresses inside `locations.address`.
 *
 * It stays jsonb rather than becoming twelve columns because
 * `lib/poProcessing.ts` reads `address.shipping` straight through as the
 * Ship-to block on every vendor PO, and that contract shouldn't move for a
 * form. `InlineValue`'s json path is what makes the keys editable anyway.
 */
export function AddressFields({
  locationId,
  address,
  group,
  editable,
}: {
  locationId: string;
  /** The WHOLE `address` column — each cell derives the next one from it. */
  address: Record<string, unknown> | null;
  group: AddressGroup;
  editable: boolean;
}) {
  const fields = group === "billing" ? [...BASE, EMAIL] : BASE;
  const values = (address?.[group] ?? {}) as Record<string, unknown>;

  return (
    <dl className="grid max-w-md grid-cols-[6rem_1fr] items-center gap-x-4 gap-y-2 text-sm">
      {fields.map((field) => {
        const raw = values[field.key];
        const value = raw === undefined || raw === null ? null : String(raw);
        return (
          <div key={field.key} className="contents">
            <dt className="text-subtle">{field.label}</dt>
            <dd>
              {editable ? (
                <InlineValue
                  boxed={BOXED_FIELDS}
                  table="locations"
                  id={locationId}
                  column={field.key}
                  value={value}
                  jsonColumn="address"
                  jsonPath={[group, field.key]}
                  jsonDocument={address}
                />
              ) : (
                <span className={value ? "" : "text-faint"}>{value ?? "none"}</span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
