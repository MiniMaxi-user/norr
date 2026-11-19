import { NewWorkOrderForm } from "./new-work-order-form";

/**
 * Create a work order on the spot (issue #223) — reached from the "+" on the
 * Today screen. Thin Server Component shell (`requireEngineerSession()` in
 * the `(app)` layout is the gate); the form itself is client-side because it
 * is four dependent pickers talking to the network. Online-only by design:
 * nothing here is ever queued offline.
 */
export default function NewWorkOrderPage() {
  return <NewWorkOrderForm />;
}
