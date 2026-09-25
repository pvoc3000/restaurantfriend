"use client";

import { useEffect, useRef, useState } from "react";
import type { DocOrg } from "@/lib/specialOrderDocs";
import { useExactViewportHeight } from "@/lib/tableHead";
import { formLabel, type FormKey } from "./formCatalog";

/**
 * One document from /forms, rendered to a real PDF in the browser by the SAME
 * component the app prints with, over `formSamples`. So an edit to a layout
 * file is an edit to what this shows — reload the page to see it.
 *
 * The renderer and the documents are imported DYNAMICALLY, the way every
 * print command in the app does it: @react-pdf needs a DOM and is large.
 *
 * Shown in a plain `<object>` rather than `ui/DocumentViewer`, whose fallback
 * text is about signed storage links that expire — this is a blob made here.
 */
export function FormPreview({
  form,
  docOrg,
  poSettings,
  orgName,
}: {
  form: FormKey;
  docOrg: DocOrg;
  /** `orgs.settings`, for the PO documents' billing block and email. */
  poSettings: Record<string, unknown>;
  orgName: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  useExactViewportHeight(frame);
  const [state, setState] = useState<
    { form: FormKey; url: string } | { form: FormKey; error: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const [{ pdf }, element] = await Promise.all([
          import("@react-pdf/renderer"),
          buildElement(form, docOrg, poSettings, orgName),
        ]);
        const blob = await pdf(element).toBlob();
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ form, url });
      } catch (e) {
        if (!cancelled) setState({ form, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [form, docOrg, poSettings, orgName]);

  const current = state?.form === form ? state : null;

  return (
    <div ref={frame} className="flex min-h-80 flex-col border border-ink bg-white">
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-ink px-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em]">{formLabel(form)}</span>
        {current && "url" in current ? (
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-ink underline-offset-2 hover:underline"
          >
            Open in new tab
          </a>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {!current ? (
          <p className="grid h-full place-items-center text-sm text-muted">Rendering…</p>
        ) : "error" in current ? (
          <p className="grid h-full place-items-center px-6 text-center text-sm text-red-700">
            This form didn’t render: {current.error}
          </p>
        ) : (
          <object key={current.url} data={current.url} type="application/pdf" className="h-full w-full">
            <p className="grid h-full place-items-center px-6 text-center text-sm text-muted">
              This browser won’t show the PDF inline —{" "}
              <a href={current.url} target="_blank" rel="noreferrer" className="text-ink">
                open it in a new tab
              </a>
              .
            </p>
          </object>
        )}
      </div>
    </div>
  );
}

async function buildElement(
  form: FormKey,
  docOrg: DocOrg,
  poSettings: Record<string, unknown>,
  orgName: string
) {
  const s = await import("./formSamples");
  switch (form) {
    case "quote":
    case "invoice":
    case "receipt":
    case "signed-quote": {
      const { OrderDocumentPdf } = await import("@/components/specialOrders/pdf/SpecialOrderPdfs");
      const kind = form === "signed-quote" ? "quote" : form;
      const order =
        form === "invoice" ? s.sampleInvoiceOrder : form === "receipt" ? s.sampleReceiptOrder : s.sampleQuoteOrder;
      return (
        <OrderDocumentPdf
          orders={[order]}
          org={docOrg}
          kind={kind}
          approval={form === "signed-quote" ? s.sampleApproval : null}
        />
      );
    }
    case "quote-app":
    case "signed-quote-app":
    case "invoice-app":
    case "receipt-app": {
      const { OrderDocumentAppStylePdf } = await import("./pdf/OrderDocumentAppStylePdf");
      const kind = form === "invoice-app" ? "invoice" : form === "receipt-app" ? "receipt" : "quote";
      const order =
        kind === "invoice" ? s.sampleInvoiceOrder : kind === "receipt" ? s.sampleReceiptOrder : s.sampleQuoteOrder;
      return (
        <OrderDocumentAppStylePdf
          orders={[order]}
          org={docOrg}
          kind={kind}
          approval={form === "signed-quote-app" ? s.sampleApproval : null}
        />
      );
    }
    case "kitchen-order-app": {
      const { KitchenOrderAppStylePdf } = await import("./pdf/OrderDocumentAppStylePdf");
      return <KitchenOrderAppStylePdf orders={[s.sampleQuoteOrder]} org={docOrg} printedOn="2026-09-25" />;
    }
    case "kitchen-order": {
      const { KitchenOrderPdf } = await import("@/components/specialOrders/pdf/SpecialOrderPdfs");
      return <KitchenOrderPdf orders={[s.sampleQuoteOrder]} org={docOrg} printedOn="2026-09-25" />;
    }
    case "customer-invoice-app":
    case "customer-invoice-one-app": {
      const { CustomerInvoiceAppStylePdf } = await import("./pdf/OrderDocumentAppStylePdf");
      const invoice = form === "customer-invoice-app" ? s.sampleCustomerInvoice : s.sampleItemizedInvoice;
      return <CustomerInvoiceAppStylePdf invoice={invoice} org={docOrg} />;
    }
    case "customer-invoice":
    case "customer-invoice-one": {
      const { CustomerInvoicePdf } = await import("@/components/specialOrders/pdf/SpecialOrderPdfs");
      const invoice = form === "customer-invoice" ? s.sampleCustomerInvoice : s.sampleItemizedInvoice;
      return <CustomerInvoicePdf invoice={invoice} org={docOrg} />;
    }
    case "statement-app": {
      const { StatementAppStylePdf } = await import("./pdf/OrderDocumentAppStylePdf");
      return <StatementAppStylePdf statement={s.sampleStatement} org={docOrg} />;
    }
    case "statement": {
      const { StatementPdf } = await import("@/components/specialOrders/pdf/SpecialOrderPdfs");
      return <StatementPdf statement={s.sampleStatement} org={docOrg} />;
    }
    case "purchase-order":
    case "shopping-list": {
      const { PoPdf, ShoppingListPdf } = await import("@/components/purchasing/pdf/PoPdfDocs");
      const org = s.poOrgFrom(orgName, poSettings);
      return form === "purchase-order" ? (
        <PoPdf pos={[s.samplePo]} org={org} />
      ) : (
        <ShoppingListPdf pos={[s.sampleShoppingPo]} org={org} />
      );
    }
    case "vendor-item-list": {
      const { VendorItemListPdf } = await import("@/components/catalog/pdf/VendorItemListPdf");
      return <VendorItemListPdf data={s.sampleVendorList(orgName)} />;
    }
    case "production-packet": {
      const { ProductionPacketPdf, PACKET_PARTS } = await import(
        "@/components/production/pdf/ProductionPacketPdfs"
      );
      return (
        <ProductionPacketPdf
          packet={s.samplePacket(orgName)}
          parts={PACKET_PARTS.map((p) => p.key)}
          orders={[s.sampleQuoteOrder]}
        />
      );
    }
    case "recipe": {
      const { RecipePdf } = await import("@/components/production/pdf/RecipePdf");
      return <RecipePdf data={s.sampleRecipe(orgName)} />;
    }
    case "checklist": {
      const { ChecklistPdf } = await import("@/components/checklists/pdf/ChecklistPdf");
      return <ChecklistPdf data={s.sampleChecklist(orgName)} />;
    }
    case "tags-2x3.5":
    case "tags-2x8":
    case "tags-2x10": {
      const { TagSheetPdf } = await import("@/components/tags/pdf/TagSheetPdf");
      const size = form.slice("tags-".length) as "2x3.5" | "2x8" | "2x10";
      return <TagSheetPdf size={size} tags={s.sampleTags(window.location.origin)} />;
    }
  }
}
