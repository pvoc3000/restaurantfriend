import type { ReactNode } from "react";
import s from "./guide.module.css";

export const metadata = {
  title: "The Shift Report — Donut Friend guides",
  description:
    "Setting up your account, signing in, using the shop iPad, and filling in and sending the shift report.",
};

/**
 * The supervisor's guide to the shift report, public at /guides/shift-report.
 *
 * EVERY LABEL HERE IS THE SCREEN'S OWN, read from the components rather than
 * remembered: "Set my password" (/welcome), "Start or Resume a Shift Report"
 * (the tablet landing tile), "Start the report", "Resume the draft" and "Start another" (NewShiftReport), "Received a
 * 30 minute break" (RatingsPage), "Pin to checklists" (WalkItem), "Print All
 * Documents" (PrintPacket), "Pause & close" (ShiftReportRunner). When one of
 * those changes, this page is the other place it has to change — and the page
 * list mirrors `pagesForShift` in `lib/shiftReports`.
 */

function Ui({ children, go }: { children: ReactNode; go?: boolean }) {
  return <span className={go ? `${s.ui} ${s.go}` : s.ui}>{children}</span>;
}

function Note({ head, warn, children }: { head: string; warn?: boolean; children: ReactNode }) {
  return (
    <div className={warn ? `${s.note} ${s.warn}` : s.note}>
      <strong className={s.noteHead}>{head}</strong>
      {children}
    </div>
  );
}

function Page({
  name,
  closingOnly,
  children,
}: {
  name: string;
  closingOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={s.page}>
      <div className={s.who}>
        <b>{name}</b>
        <div className={s.shifts}>
          {closingOnly ? (
            <span className={s.closing}>Closing</span>
          ) : (
            <span>Every shift</span>
          )}
        </div>
      </div>
      <div className={s.what}>{children}</div>
    </div>
  );
}

export default function ShiftReportGuide() {
  return (
    <article className={s.guide}>
      <div className={s.head}>
        <div className={s.eyebrow}>For supervisors</div>
        <h1>The Shift Report</h1>
        <p>
          How to get into Restaurant Friend, and how to fill in and send the shift report at
          the end of your shift. It replaces the FileMaker shift report.
        </p>
      </div>

      <nav className={s.toc} aria-label="Sections">
        <a href="#account">1 · Set up your account</a>
        <a href="#signin">2 · Sign in</a>
        <a href="#ipad">3 · The shop iPad</a>
        <a href="#start">4 · Start a report</a>
        <a href="#pages">5 · The pages</a>
        <a href="#send">6 · Send it</a>
      </nav>

      <section className={s.part} id="account">
        <h2>
          <span className={s.tag}>Once</span>Set up your account
        </h2>
        <p className={s.lede}>
          A manager sends you an invitation by email. You only do this part once.
        </p>
        <ol className={s.steps}>
          <li>
            Open the invitation email and tap the link in it.
            <p>
              A page opens that says <strong>Welcome to Donut Friend!</strong> The link only
              works once.
            </p>
          </li>
          <li>
            Choose a password, type it again, and tap <Ui>Set my password</Ui>.
            <p>
              You’re signed in. From now on you sign in with the email address the invitation
              was sent to and this password.
            </p>
          </li>
          <li>
            Set your PIN for the shop iPad. Tap the <strong>gear</strong> at the top right to
            open <strong>Your account</strong>, and under <strong>PIN for shared iPads</strong>{" "}
            choose four digits.
            <p>
              Do this while signed in with your password. You can’t set or change a PIN while
              you’re signed in with a PIN.
            </p>
          </li>
        </ol>
        <Note head="The link doesn’t work?">
          If the page says the link is missing its token or has expired, ask a manager to send
          a new invitation. Old invitation links can’t be reused.
        </Note>
      </section>

      <section className={s.part} id="signin">
        <h2>
          <span className={s.tag}>Daily</span>Sign in
        </h2>
        <p className={s.lede}>
          On a phone or computer, go to the <a href="/login" className="underline">sign-in page</a>.
        </p>
        <ol className={s.steps}>
          <li>
            Enter your email and password, then tap <Ui>Sign in</Ui>.
          </li>
          <li>
            Forgot your password? Type your email into the email box first, then tap{" "}
            <Ui>Forgot your password?</Ui>
            <p>An email arrives with a link to set a new one. It looks the same as the invitation.</p>
          </li>
        </ol>
        <Note head="Use Safari 16.4 or newer.">
          On an older iPhone or iPad, the sign-in screen clears your details and nothing
          happens. Update iOS, or use another device.
        </Note>
      </section>

      <section className={s.part} id="ipad">
        <h2>
          <span className={s.tag}>Shared</span>The shop iPad
        </h2>
        <p className={s.lede}>The shop iPad is shared, so it asks who you are each time.</p>
        <ol className={s.steps}>
          <li>Tap your name, then enter your four-digit PIN.</li>
          <li>
            When you’re done, tap <Ui>Switch user</Ui> at the top right.
            <p>
              After 5 minutes without being touched, the iPad locks itself and goes back to the
              list of names.
            </p>
          </li>
        </ol>
        <Note head="Only work under your own name." warn>
          Everything you record is saved with the name of whoever is signed in. If someone
          else’s name is showing, tap <Ui>Switch user</Ui> and sign in as yourself. Several wrong
          PINs in a row lock you out for a few minutes.
        </Note>
      </section>

      <section className={s.part} id="start">
        <h2>
          <span className={s.tag}>Each shift</span>Start a shift report
        </h2>
        <ol className={s.steps}>
          <li>
            On the iPad, tap <Ui>Start or Resume a Shift Report</Ui> on the home screen.
            <p>
              On a computer: <strong>Operations › Shift Reports</strong>, then{" "}
              <Ui>New shift report</Ui>.
            </p>
          </li>
          <li>
            Check the <strong>Date</strong>, <strong>Shift</strong> and{" "}
            <strong>Next production day</strong>, then tap <Ui go>Start the report</Ui>.
            <p>
              The date is{" "}
              <span className={s.hl}>the day your shift started, not the day it ended.</span> A
              closing shift that runs past midnight still uses the earlier date.
            </p>
          </li>
        </ol>
        <Note head="Stopped halfway?">
          Your work is saved as you go. Tap the same home-screen button to pick up where you
          left off. On the Shift Reports list, open the <strong>⋯</strong> menu on your report
          and choose <strong>Resume…</strong>. If you tap <Ui>New shift report</Ui> for a
          shift that already has a draft, it offers <Ui go>Resume the draft</Ui>. Use that, not{" "}
          <Ui>Start another</Ui>.
        </Note>
      </section>

      <section className={s.part} id="pages">
        <h2>
          <span className={s.tag}>Step by step</span>The pages
        </h2>
        <p className={s.lede}>
          The black bar at the top shows where you are, for example <em>page 3 of 8</em>. A
          closing report has eight pages. Opening, mid and off-site reports have five.
        </p>

        <div className={s.pages}>
          <Page name="Info">
            <p>Check the date, shop and shift. Your name is filled in from your sign-in.</p>
          </Page>

          <Page name="Staff ratings">
            <p>
              Tap <Ui>Add Employee</Ui> for everyone who worked your shift. Give each person a
              position and a score, and add a note if there’s something to say.
            </p>
            <ul>
              <li>
                If they got a break, tick <strong>Received a 30 minute break</strong> and enter
                the time it <em>started</em>.
              </li>
              <li>
                If they didn’t, leave it unticked and write <em>why</em> in the box.
              </li>
            </ul>
            <p style={{ marginTop: 8 }}>
              You can’t send the report until every break has a time or a reason. Ratings go to
              management only. Other supervisors don’t see them.
            </p>
          </Page>

          <Page name="Sales" closingOnly>
            <p>
              Today’s net sales and tips come straight from Square. There’s nothing to type. If
              Square hasn’t reported yet, that’s normal. Carry on.
            </p>
          </Page>

          <Page name="Premades" closingOnly>
            <p>
              For each item on today’s production schedule, enter how many were{" "}
              <strong>Made</strong> and how many were <strong>Left</strong>. The rows are in the
              same order as the printed sheet.
            </p>
            <ul>
              <li>
                If you made exactly the par, tap the <strong>→</strong> arrow to copy it in.
              </li>
              <li>
                If nobody generated today’s schedule, the page is empty. Tap{" "}
                <Ui>Generate today’s schedule</Ui> and the rows appear.
              </li>
            </ul>
          </Page>

          <Page name="Checklist">
            <p>
              Walk the shop and mark each item <Ui>Done</Ui>, <Ui>Issue</Ui> or <Ui>N/A</Ui>.
              Issue and N/A ask for a short note: say what’s wrong, or why it doesn’t apply.
            </p>
            <ul>
              <li>
                Items that ask for a reading, like a fridge temperature: type the number. A
                reading out of range is flagged as an issue automatically.
              </li>
              <li>
                For a problem that needs fixing later, tap <Ui>Pin to checklists</Ui>. It will
                show up on every checklist until someone completes it. If you don’t pin it, it
                only appears in tonight’s report.
              </li>
              <li>
                Tap <Ui>Finish</Ui> when you’re done.
              </li>
            </ul>
          </Page>

          <Page name="Tomorrow’s production" closingOnly>
            <p>Get tomorrow’s kitchen paper printed.</p>
            <ul>
              <li>
                If there’s no schedule yet, tap <Ui>Generate schedules</Ui>. Special orders that
                are ready are included.
              </li>
              <li>
                Then tap <Ui>Print All Documents</Ui> to print the whole packet as one file.
              </li>
            </ul>
          </Page>

          <Page name="Report">
            <p>
              <strong>How was the shift?</strong> Write it up: what went well, what didn’t, what
              the next shift needs to know.
            </p>
          </Page>

          <Page name="Submit">
            <p>
              Lists anything that’s still missing. See <a href="#send" className="underline">Send it</a>{" "}
              below.
            </p>
          </Page>
        </div>

        <h3>The buttons along the bottom</h3>
        <div className={s.scroll}>
          <table className={s.bar}>
            <thead>
              <tr>
                <th>Button</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <Ui>Next</Ui> / <Ui>Back</Ui>
                </td>
                <td>Moves between pages. Everything you’ve entered is already saved.</td>
              </tr>
              <tr>
                <td>
                  <Ui>Pause &amp; close</Ui>
                </td>
                <td>Leaves the report as a draft, so you can finish later.</td>
              </tr>
              <tr>
                <td>
                  <Ui>Cancel</Ui>
                </td>
                <td>
                  Deletes this report. It asks you to confirm first. Use{" "}
                  <strong>Pause &amp; close</strong> if you just want to step away.
                </td>
              </tr>
              <tr>
                <td>
                  <Ui go>✓ Send</Ui>
                </td>
                <td>
                  On the last page. Sends the report. Only the person who started a report can
                  send it.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.part} id="send">
        <h2>
          <span className={s.tag}>Last step</span>Send it
        </h2>
        <p className={s.lede}>The Submit page shows a yellow box with anything that’s still missing.</p>
        <div className={s.two}>
          <div className={s.card}>
            <h3>“Before this can be sent”</h3>
            <ul>
              <li>
                These must be fixed before you can send, for example a break with no time or no
                reason.
              </li>
              <li>
                Tap <Ui>Back</Ui> to the page it names and fill it in.
              </li>
            </ul>
          </div>
          <div className={s.card}>
            <h3>“Still outstanding”</h3>
            <ul>
              <li>
                Things worth doing that won’t stop you, like an unprinted packet or an unfinished
                checklist.
              </li>
              <li>If you can’t finish them tonight, send anyway. They’re listed in the email.</li>
            </ul>
          </div>
        </div>
        <ol className={s.steps} style={{ marginTop: 14 }}>
          <li>
            Tap <Ui go>✓ Send</Ui>.
            <p>
              The report is emailed to managers and supervisors. Managers receive the staff
              ratings, supervisors don’t.
            </p>
          </li>
          <li>
            Tap <Ui>Switch user</Ui> so the iPad is ready for the next person.
          </li>
        </ol>
        <Note head="Made a mistake after sending?">
          A sent report can’t be edited. Ask a manager to reopen it, then fix it and send it
          again.
        </Note>
      </section>

      <footer className={s.foot}>Donut Friend · Restaurant Friend · Supervisor guide, September 2026</footer>
    </article>
  );
}
