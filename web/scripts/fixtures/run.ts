// `npm run fixtures` — the whole suite.
//
// Importing a fixtures file registers its cases; runAll then runs them and
// exits non-zero on the first failure it reports.

import "./breakPunches.fixtures";
import "./calcPad.fixtures";
import "./batchLogFilters.fixtures";
import "./breakRules.fixtures";
import "./columnOrder.fixtures";
import "./columnVisibility.fixtures";
import "./rowDrag.fixtures";
import "./pickList.fixtures";
import "./documentLines.fixtures";
import "./employeeDocuments.fixtures";
import "./employeeEvents.fixtures";
import "./employees.fixtures";
import "./fileDrop.fixtures";
import "./guideDate.fixtures";
import "./gustoExport.fixtures";
import "./homebaseImport.fixtures";
import "./invoiceDate.fixtures";
import "./invoiceMatch.fixtures";
import "./lastPurchase.fixtures";
import "./invoices.fixtures";
import "./filedInvoice.fixtures";
import "./invoicePages.fixtures";
import "./fileReadings.fixtures";
import "./filterMenus.fixtures";
import "./nav.fixtures";
import "./vendors.fixtures";
import "./workday.fixtures";
import "./orderWorkflow.fixtures";
import "./overtime.fixtures";
import "./overtimeOrder.fixtures";
import "./packLabel.fixtures";
import "./payPeriods.fixtures";
import "./payrollBenefits.fixtures";
import "./poDocumentFileName.fixtures";
import "./poFilters.fixtures";
import "./productionBatches.fixtures";
import "./productionCost.fixtures";
import "./productionElements.fixtures";
import "./recipeIngredients.fixtures";
import "./productionHistory.fixtures";
import "./inquiry.fixtures";
import "./inventorySearch.fixtures";
import "./productionItems.fixtures";
import "./productionPlans.fixtures";
import "./productionScale.fixtures";
import "./productionSchedule.fixtures";
import "./purchaseRequests.fixtures";
import "./recipeCosts.fixtures";
import "./receiving.fixtures";
import "./roles.fixtures";
import "./specialOrders.fixtures";
import "./specialOrderDocs.fixtures";
import "./specialOrderLines.fixtures";
import "./specialOrderProgress.fixtures";
import "./sales.fixtures";
import "./squareSalesCsv.fixtures";
import "./tableSort.fixtures";
import "./tipPool.fixtures";
import "./timeZone.fixtures";
import "./timesheets.fixtures";
import "./unpaidBreaks.fixtures";
import { runAll } from "./harness";

runAll();
