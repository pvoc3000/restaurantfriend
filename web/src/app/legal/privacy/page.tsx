export const metadata = {
  title: "Privacy policy — restaurantfriend",
};

const UPDATED = "September 1, 2026";

/**
 * The privacy policy Intuit's production-key checklist asks for.
 *
 * EVERY CLAIM HERE IS CHECKED AGAINST THE SCHEMA, which is the only reason a
 * page like this is worth anything. The two most useful sentences are the
 * negative ones — no Social Security numbers, no card numbers — and both are
 * enforced rather than promised: the HR transform is a field ALLOW-LIST that
 * never reads SSN (migration 020, `migration/field-map.md`), and the customer
 * migration deliberately drops FileMaker's plain-text card fields (051).
 *
 * The sub-processor list is the real one, taken from the edge functions: every
 * outside service this app sends data to has a function that calls it.
 */
export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        Privacy policy
      </h1>
      <p className="text-[13px] text-muted">Last updated {UPDATED}</p>

      <p>
        restaurantfriend is internal operations software built and operated by
        Donut Friend, Inc. (&ldquo;Donut Friend&rdquo;) for its own business. It
        is not a public service and has no users outside the company. This page
        describes what it holds, where that goes, and who to ask about it.
      </p>

      <h2>What it holds</h2>
      <ul>
        <li>
          <strong>Employees.</strong> Name, contact details, home address, date
          of birth, job and location, hours worked, tips, meal-break records,
          and scans of onboarding paperwork such as I-9, W-4 and food handler
          cards.
        </li>
        <li>
          <strong>Customers.</strong> Name, company, email, phone, address, and
          the special orders and payments associated with them.
        </li>
        <li>
          <strong>Vendors and business records.</strong> Vendor contacts and
          account numbers, purchase orders, invoice scans, recipes, production
          plans, checklists and daily sales totals.
        </li>
      </ul>

      <h2>What it deliberately does not hold</h2>
      <ul>
        <li>
          <strong>No Social Security numbers.</strong> They are not imported and
          there is no field for them.
        </li>
        <li>
          <strong>No card or bank numbers.</strong> Customer payments are
          recorded as an amount and a method; card details are never entered or
          stored.
        </li>
        <li>
          <strong>No pay rates.</strong> Payroll is exported as hours and tips.
          Wage rates live in the payroll system, not here.
        </li>
      </ul>

      <h2>Why it holds it</h2>
      <p>
        To run the business: to employ and schedule people, meet employment and
        food-safety record-keeping obligations, buy from suppliers, fulfil
        customer orders, and keep the books.
      </p>

      <h2>Where it goes</h2>
      <p>
        Donut Friend does not sell personal information and does not share it
        for advertising. It is processed by the services the app runs on and
        connects to:
      </p>
      <ul>
        <li>
          <strong>Supabase</strong> — database, sign-in and file storage.
        </li>
        <li>
          <strong>Vercel</strong> — web hosting.
        </li>
        <li>
          <strong>Google (Gmail API)</strong> — sending purchase orders, quotes,
          invoices and reports from Donut Friend&rsquo;s own mailboxes.
        </li>
        <li>
          <strong>Anthropic (Claude)</strong> — reading uploaded supplier
          invoices to extract line items. The document image is sent for that
          purpose only, under Anthropic&rsquo;s commercial API terms, which do
          not use submitted data to train models.
        </li>
        <li>
          <strong>Square</strong> — daily sales and tip totals are read in.
        </li>
        <li>
          <strong>Intuit QuickBooks Online</strong> — approved supplier bills
          are sent out so they appear on the books. Vendor names, invoice
          numbers, dates and amounts are shared. No employee or customer
          personal information is sent to QuickBooks.
        </li>
      </ul>
      <p>
        Information is also disclosed where the law requires it, or to
        professional advisers such as an accountant, under confidentiality.
      </p>

      <h2>How it is protected</h2>
      <p>
        Access needs an invited account, and what each person can see is limited
        by their role — HR records, for instance, are restricted to the owner and
        managers. Data is encrypted in transit and at rest by the hosting
        providers above, and uploaded documents are held in private storage
        reachable only through short-lived links.
      </p>

      <h2>How long it is kept</h2>
      <p>
        Business and employment records are kept for as long as the business or
        the law requires — employment records are retained after someone leaves,
        because tax and labour rules require it.
      </p>

      <h2>Your choices</h2>
      <p>
        Employees and customers may ask what the app holds about them, ask for
        corrections, or ask for deletion where no legal obligation requires it
        to be kept. Write to the address below and Donut Friend will respond.
        California residents have rights under California privacy law; the same
        address is the way to exercise them.
      </p>

      <h2>Children</h2>
      <p>
        The app is a workplace tool and is not directed to children.
      </p>

      <h2>Changes</h2>
      <p>
        This policy may be updated. The date above says when it last changed.
      </p>

      <h2>Contact</h2>
      <p>
        Donut Friend, Inc., 543 S Broadway, Los Angeles, CA 90013 —{" "}
        <a className="underline" href="mailto:info@donutfriend.com">
          info@donutfriend.com
        </a>
        , (213) 908-2743.
      </p>
    </>
  );
}
