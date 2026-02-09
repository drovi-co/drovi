import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useT } from "@/i18n";

export const Route = createFileRoute("/success")({
  component: SuccessPage,
  validateSearch: (search) => ({
    checkout_id: search.checkout_id as string,
  }),
});

function SuccessPage() {
  const { checkout_id } = useSearch({ from: "/success" });
  const t = useT();

  return (
    <div className="container mx-auto px-4 py-8">
      <h1>{t("pages.success.title")}</h1>
      {checkout_id && <p>{t("pages.success.checkoutId", { id: checkout_id })}</p>}
    </div>
  );
}
