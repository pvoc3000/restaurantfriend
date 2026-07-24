// Actively match every non-intercepted route to nothing. Without this, a
// parallel slot keeps its previous content on soft navigation — the panel
// would stay open when you click into the top nav.
export default function CatchAll() {
  return null;
}
