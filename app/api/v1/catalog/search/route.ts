import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { searchItems, type ItemSearchSort, type ItemSearchSource } from "@/lib/item-search/service";

const SEARCH_SOURCES = new Set<ItemSearchSource | "all">([
  "all",
  "catalog",
  "inventory",
  "agreement",
  "customer_contract",
  "purchase_history",
  "rfq_history",
  "supplier_quote",
  "purchase_order",
]);

const SEARCH_SORTS = new Set<ItemSearchSort>(["relevance", "last_purchase", "price_asc", "price_desc"]);

// Operational Item Search endpoint.
// Searches catalogue, inventory, agreements, PO/RFQ history, and supplier quote evidence.
export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const sourceParam = searchParams.get("source")?.trim() || "all";
  const sortParam = searchParams.get("sort")?.trim() || "relevance";

  if (!q || q.length < 2) {
    return fail("INVALID_QUERY", "Query must be at least 2 characters.", 400);
  }

  if (!SEARCH_SOURCES.has(sourceParam as ItemSearchSource | "all")) {
    return fail("INVALID_SOURCE", "Unsupported item search source.", 400);
  }

  if (!SEARCH_SORTS.has(sortParam as ItemSearchSort)) {
    return fail("INVALID_SORT", "Unsupported item search sort.", 400);
  }

  try {
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(5, Number(searchParams.get("pageSize") || 25)));
    const data = await searchItems({
      organizationId: authorization.context.organizationId,
      query: q,
      source: sourceParam as ItemSearchSource | "all",
      supplier: searchParams.get("supplier"),
      category: searchParams.get("category"),
      vessel: searchParams.get("vessel"),
      page,
      pageSize,
      sort: sortParam as ItemSearchSort,
    });

    return ok(data.results, {
      ...data.summary,
      source: "postgres",
      scope: [
        "items",
        "inventory_items",
        "agreement_items",
        "customer_contract_items",
        "purchase_order_lines",
        "purchase_orders",
        "rfq_lines",
        "supplier_quotes",
      ],
    });
  } catch (error) {
    logApiError("GET /api/v1/catalog/search", error);
    return fail("CATALOG_SEARCH_FAILED", "Search failed.", 500);
  }
}
