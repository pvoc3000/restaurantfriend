// `npm run fixtures` — the whole suite.
//
// Importing a fixtures file registers its cases; runAll then runs them and
// exits non-zero on the first failure it reports.

import "./columnOrder.fixtures";
import "./columnVisibility.fixtures";
import "./documentLines.fixtures";
import "./employeeDocuments.fixtures";
import "./employees.fixtures";
import "./fileDrop.fixtures";
import "./invoiceDate.fixtures";
import "./invoiceMatch.fixtures";
import "./packLabel.fixtures";
import "./poFilters.fixtures";
import "./receiving.fixtures";
import "./tableSort.fixtures";
import { runAll } from "./harness";

runAll();
