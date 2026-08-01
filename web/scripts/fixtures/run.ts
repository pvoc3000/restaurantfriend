// `npm run fixtures` — the whole suite.
//
// Importing a fixtures file registers its cases; runAll then runs them and
// exits non-zero on the first failure it reports.

import "./columnOrder.fixtures";
import "./invoiceMatch.fixtures";
import "./receiving.fixtures";
import { runAll } from "./harness";

runAll();
