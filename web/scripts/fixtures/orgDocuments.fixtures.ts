// Documents — `lib/orgDocuments`.

import { test, eq } from "./harness";
import { exportPrefix, fileMatchesRecord, documentRejection } from "../../src/lib/orgDocuments";

test("the export prefix is shop_category_title_version_", () => {
  eq(
    exportPrefix({ location_code: null, category: "Checklists", title: "Espresso Log", version: "01" }),
    "ALL_Checklists_Espresso Log_01_",
  );
  eq(
    exportPrefix({ location_code: "DF01", category: "Signs", title: "COVID-19 SIGN", version: "01" }),
    "DF01_Signs_COVID-19 SIGN_01_",
  );
});

test("a file matches its record by that prefix, exactly", () => {
  const rec = { location_code: null, category: "Training Forms", title: "Employee Review", version: "06" };
  eq(fileMatchesRecord("ALL_Training Forms_Employee Review_06_Performance-Review-06.pdf", rec), true);
  eq(fileMatchesRecord("ALL_Training Forms_Employee Review_01_Employee-Self-Review-180411.pdf", rec), false, "another version");
  eq(fileMatchesRecord("DF01_Training Forms_Employee Review_06_x.pdf", rec), false, "another shop");
});

test("the file card takes PDFs and pictures", () => {
  eq(documentRejection({ name: "a.pdf", type: "application/pdf" }), null);
  eq(documentRejection({ name: "a.png", type: "image/png" }), null);
  eq(typeof documentRejection({ name: "a.docx", type: "application/x" }), "string");
});
