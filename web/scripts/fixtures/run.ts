// `npm run fixtures` — the whole suite.
//
// Importing a fixtures file registers its cases; runAll then runs them and
// exits non-zero on the first failure it reports.

import "./breakPunches.fixtures";
import "./breakRules.fixtures";
import "./columnOrder.fixtures";
import "./columnVisibility.fixtures";
import "./documentLines.fixtures";
import "./employeeDocuments.fixtures";
import "./employees.fixtures";
import "./fileDrop.fixtures";
import "./gustoExport.fixtures";
import "./homebaseImport.fixtures";
import "./invoiceDate.fixtures";
import "./invoiceMatch.fixtures";
import "./invoices.fixtures";
import "./overtime.fixtures";
import "./overtimeOrder.fixtures";
import "./packLabel.fixtures";
import "./payPeriods.fixtures";
import "./poFilters.fixtures";
import "./receiving.fixtures";
import "./tableSort.fixtures";
import "./tipPool.fixtures";
import "./timeZone.fixtures";
import "./timesheets.fixtures";
import "./unpaidBreaks.fixtures";
import { runAll } from "./harness";

runAll();
