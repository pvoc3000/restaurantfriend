// The COSTS matrix on a recipe's Info tab.
//
// THE ARITHMETIC ITSELF LIVES IN `lib/productionCost` (Mark, 2026-08-12: "why
// are you reinventing the wheel? … Just do one calculation (that includes
// labor) and use it everywhere"). It is THE cost calculation — what an element
// costs and what this block prints are the same number now, taken from the same
// function at the same column — so it belongs in the costing module rather than
// in one named for the screen that happens to render it.
//
// This file is what that screen imports. It exists so the components keep a
// stable import path, and so anyone starting from the block has one hop to the
// real thing rather than having to know where it moved to.

export { METADATA_LABELS, metadataLine } from "./production";
export {
  recipeCostMatrix,
  defaultColumn,
  type CostColumnFigures,
  // The matrix's own view of a line — its label and its scaling. Named
  // `CostLine` here because that is what this module's callers have always
  // called it; `MatrixLine` is its name at home.
  type MatrixLine as CostLine,
} from "./productionCost";
