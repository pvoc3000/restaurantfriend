"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { forgetDevice, registerThisDevice } from "@/app/deviceActions";
import { DataTable, type DataColumn } from "@/components/catalog/DataTable";
import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from "@/components/ui/buttons";
import { Dialog, DIALOG_CANCEL_CLASS, DIALOG_COMMIT_CLASS } from "@/components/ui/Dialog";
import { TextInput } from "@/components/ui/TextInput";
import { confirmDialog } from "@/lib/confirm";

export type RegisteredDevice = {
  id: string;
  name: string;
  registered_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

/**
 * The org's shared iPads (migration 097). Registering is done ON the iPad —
 * the secret goes into that browser's cookie and nowhere else — so the
 * command is "Register this iPad", never "add a device" from a desk.
 *
 * Both writes are refused on a PIN session, in words: a session minted by a
 * four-digit PIN may not mint more four-digit doors.
 */
export function SharedDevices({
  devices,
  loadError,
  thisDevice,
  editable,
  pinSession,
}: {
  devices: RegisteredDevice[];
  loadError: string | null;
  /** The id in THIS browser's device cookie, if any. */
  thisDevice: string | null;
  editable: boolean;
  pinSession: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const mayWrite = editable && !pinSession;
  const registeredHere = thisDevice !== null && devices.some((d) => d.id === thisDevice && !d.revoked_at);

  function register() {
    setError(null);
    startBusy(async () => {
      try {
        await registerThisDevice(name);
        setOpen(false);
        setName("");
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function forget(device: RegisteredDevice) {
    if (
      !(await confirmDialog({
        title: `Forget ${device.name}?`,
        body:
          device.id === thisDevice
            ? "This iPad will stop offering the PIN picker — the next time it opens the app it will ask for a password."
            : "That iPad will stop offering the PIN picker the next time it opens the app.",
        confirmLabel: "Forget device",
        tone: "danger",
      }))
    ) {
      return;
    }
    setError(null);
    startBusy(async () => {
      try {
        await forgetDevice(device.id);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  const columns: DataColumn<RegisteredDevice>[] = [
    {
      key: "name",
      label: "Device",
      width: 240,
      pinned: true,
      sortValue: (d) => d.name,
      render: (d) => (
        <span className="flex items-center gap-2">
          <span className="truncate">{d.name}</span>
          {d.id === thisDevice && (
            <span className="shrink-0 bg-mark-fill px-1 text-[11px] uppercase tracking-[0.08em]">
              this one
            </span>
          )}
        </span>
      ),
    },
    {
      key: "registered",
      label: "Registered",
      width: 130,
      sortValue: (d) => d.registered_at,
      render: (d) => d.registered_at.slice(0, 10),
    },
    {
      key: "seen",
      label: "Last unlock",
      width: 130,
      sortValue: (d) => d.last_seen_at ?? "",
      render: (d) => (d.last_seen_at ? d.last_seen_at.slice(0, 10) : "—"),
    },
    {
      key: "status",
      label: "Status",
      width: 120,
      sortValue: (d) => (d.revoked_at ? 1 : 0),
      render: (d) => (d.revoked_at ? <span className="text-muted">Forgotten</span> : "Active"),
    },
    {
      key: "actions",
      label: "",
      width: 120,
      render: (d) =>
        mayWrite && !d.revoked_at ? (
          <button
            type="button"
            className={`${DANGER_BUTTON_CLASS} h-8 px-3`}
            disabled={busy}
            onClick={() => void forget(d)}
          >
            Forget
          </button>
        ) : null,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <p className="max-w-2xl text-sm text-muted">
          An iPad the team shares. Once registered, it opens on a name picker and a four-digit
          PIN instead of a password, and locks itself after five minutes idle.
        </p>
        {mayWrite && !registeredHere && (
          <button
            type="button"
            className={`${BUTTON_CLASS} ml-auto shrink-0`}
            disabled={busy}
            onClick={() => {
              setName("");
              setError(null);
              setOpen(true);
            }}
          >
            Register this iPad…
          </button>
        )}
      </div>

      {pinSession && (
        <p className="text-sm text-muted">
          <a href="/login" className="underline hover:text-ink">
            Sign in with your password
          </a>{" "}
          to register or forget a device.
        </p>
      )}

      {loadError && <p className="text-sm text-accent">{loadError}</p>}
      {error && <p className="text-sm text-accent">{error}</p>}

      <DataTable
        rows={devices}
        columns={columns}
        rowKey={(d) => d.id}
        storageKey="rf.sharedDevices.v1"
        columnChooser
        empty={<p className="text-sm text-muted">No shared devices yet.</p>}
      />

      {open && (
        <Dialog
          title="Register this iPad"
          onClose={() => setOpen(false)}
          busy={busy}
          width="max-w-sm"
          onSubmit={() => {
            if (!busy && name.trim() !== "") register();
          }}
          footer={
            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                className={DIALOG_CANCEL_CLASS}
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={DIALOG_COMMIT_CLASS}
                disabled={busy || name.trim() === ""}
                onClick={register}
              >
                {busy ? "Registering…" : "Register"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Do this on the iPad itself — the registration lives in this browser.
            </p>
            <div className="space-y-1.5">
              <label className="block text-[11px] uppercase tracking-[0.12em] text-subtle">
                Name
              </label>
              <TextInput
                value={name}
                onValueChange={setName}
                placeholder="DF01 counter iPad"
                aria-label="Device name"
                fullWidth
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-accent">{error}</p>}
          </div>
        </Dialog>
      )}
    </section>
  );
}
