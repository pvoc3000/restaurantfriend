export const metadata = {
  title: "Terms of use — restaurantfriend",
};

const UPDATED = "September 1, 2026";

/**
 * The end-user licence agreement Intuit's production-key checklist asks for.
 *
 * It says what is actually true: this is an internal tool built and run by
 * Donut Friend, Inc. for its own staff. It is not sold, not offered to the
 * public, and has no users outside the company — so the document is short,
 * because inventing clauses for a distribution that does not happen would make
 * it less accurate rather than more thorough.
 */
export default function TermsPage() {
  return (
    <>
      <h1 className="text-[28px] font-bold uppercase leading-tight tracking-[-0.02em]">
        Terms of use
      </h1>
      <p className="text-[13px] text-muted">Last updated {UPDATED}</p>

      <p>
        restaurantfriend (&ldquo;the app&rdquo;) is operations software built and
        operated by Donut Friend, Inc. (&ldquo;Donut Friend&rdquo;) for its own
        business. These terms cover its use.
      </p>

      <h2>Who may use it</h2>
      <p>
        The app is an internal tool. It is not sold, licensed or offered to the
        public, and it has no users outside Donut Friend. Access is granted by
        invitation to current employees and contractors for work purposes, and
        may be changed or withdrawn at any time — including automatically when
        someone stops working here.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Accounts are personal. Do not share your sign-in with anyone.</li>
        <li>
          Use the app only for Donut Friend&rsquo;s business, and only for the
          parts of it your role covers.
        </li>
        <li>
          Tell Donut Friend promptly if you think someone else has used your
          account.
        </li>
      </ul>

      <h2>The information in it</h2>
      <p>
        The app holds business records — orders, invoices, recipes, schedules —
        and personal information about employees and customers. Treat all of it
        as confidential. Do not copy, export or share it outside the company
        except as your job requires, and do not keep it after you stop working
        here.
      </p>

      <h2>Connected services</h2>
      <p>
        Donut Friend connects the app to services it uses to run the business,
        including QuickBooks Online, Square, and email. Those connections are
        made by Donut Friend using its own accounts, and each service&rsquo;s own
        terms apply to what happens inside it.
      </p>

      <h2>No warranty</h2>
      <p>
        The app is provided as it is, without warranties of any kind. Donut
        Friend does not promise it will be available without interruption or
        free of errors. Records in the app are working records; where a legal or
        tax obligation requires an authoritative copy, the system of record for
        that obligation governs.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, Donut Friend is not liable for indirect,
        incidental or consequential damages arising from use of the app.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may be updated. The date above says when they last changed.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of California, without
        regard to its conflict-of-laws rules.
      </p>

      <h2>Contact</h2>
      <p>
        Donut Friend, Inc., 543 S Broadway, Los Angeles, CA 90013 —{" "}
        <a className="underline" href="mailto:info@donutfriend.com">
          info@donutfriend.com
        </a>
        .
      </p>
    </>
  );
}
