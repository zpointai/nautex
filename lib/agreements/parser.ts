/**
 * Agreement File Parser
 *
 * Adapted from SupplyChain Lens processAgreementComparison.
 * Handles CSV and XLSX parsing with intelligent column mapping
 * for maritime procurement supplier agreement files.
 */

/* -- Column Mappings ------------------------------------------------ */

const COLUMN_MAPPINGS: Record<string, string[]> = {
  system_id: [
    "system_id", "systemid", "csi", "csi_number", "csinumber",
    "itemrelation", "item_relation", "item relation",
    "vendor catalogue no.", "vendor catalogue no", "vendorcatalogueno",
    "catalogue no", "catalogueno", "catalog no", "catalognumber",
  ],
  offi_number: [
    "offi_number", "offinumber", "offi",
    "offi-nummer", "offinummer",
    "part no.", "part no", "partno", "part_no", "part number", "partnumber",
    "item no", "itemno", "item_no", "item number", "itemnumber",
    "artikel", "artikelnummer", "artikel nr", "art nr", "artnr",
  ],
  vendor_part_number: [
    "vendor_part_number", "vendorpartnumber", "vendor partnumber", "vendor part number",
    "vendor_part_no", "vendorpartno", "vendor part no", "vendor part no.",
    "sku", "supplier_sku", "suppliersku", "vendor_sku", "vendorsku",
    "supplier part", "supplier part number", "leverancier artikelnr",
    "vendor item", "vendor item number", "mfr part", "manufacturer part",
  ],
  description: [
    "description", "item_description", "itemdescription",
    "part description", "part_description", "partdescription",
    "searchname", "search_name", "search name",
    "name", "item name", "itemname", "product name", "productname",
    "omschrijving", "beschrijving", "artikel omschrijving",
  ],
  unit: [
    "unit", "uom", "unit_of_measure", "unitofmeasure", "unit of measure",
    "eenheid", "verpakking", "verpakkingseenheid",
    "sales unit", "salesunit", "purchase unit", "purchaseunit",
  ],
  moq: [
    "moq", "min_order_qty", "minorderqty", "minimum_order", "min order qty",
    "minimum order quantity", "minimumorderquantity",
    "min qty", "minqty", "minimum qty", "minimumqty",
    "min bestelling", "minimum bestelling",
  ],
  price: [
    "price", "unit_price", "unitprice", "unit price",
    "purchase pricing vendor", "purchasepricingvendor",
    "pricing vendor", "pricingvendor",
    "purchase price", "purchaseprice", "purchase_price",
    "sales order costs", "salesordercosts", "sales order cost",
    "cost", "costs", "unit cost", "unitcost",
    "prijs", "stukprijs", "eenheidsprijs", "verkoopprijs", "inkoopprijs",
    "amount", "rate", "tariff", "tarief",
    "net price", "netprice", "net_price",
    "gross price", "grossprice", "gross_price",
    "list price", "listprice", "list_price",
    "sales price", "salesprice", "sales_price",
    "price per unit", "priceperunit", "price_per_unit",
    "eur", "eur price", "euro", "euro price",
    "price eur", "price_eur", "priceeur",
    "value", "item value", "itemvalue",
    "new price", "newprice", "new_price",
    "updated price", "updatedprice",
    "vendor price", "vendorprice", "supplier price", "supplierprice",
  ],
  currency: [
    "currency", "curr", "ccy", "valuta", "munt",
    "currency code", "currencycode",
  ],
  hs_code: [
    "hs_code", "hscode", "hs code", "hs-code",
    "hss(taric) code", "hsstariccode", "hss taric code",
    "taric", "tariff_code", "tariffcode", "tariff code",
    "commodity code", "commoditycode", "goederencode",
  ],
  country_of_origin: [
    "country_of_origin", "countryoforigin", "country of origin",
    "coo", "origin", "country", "land van herkomst", "herkomst",
  ],
  lead_time_days: [
    "lead_time_days", "leadtimedays", "lead_time", "leadtime",
    "delivery time", "delivery_time", "deliverytime",
    "lead time", "levertijd", "leveringstijd", "doorlooptijd",
    "days", "delivery days", "deliverydays",
  ],
  manufacturer: [
    "manufacturer", "mfr", "brand", "merk", "fabrikant",
    "nieuwe vendor", "nieuwevendor",
    "vendor", "supplier", "leverancier", "producent",
  ],
};

/* -- Normalization Utilities ---------------------------------------- */

function normalizeString(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str.toLowerCase().trim().replace(/\s+/g, " ");
}

export function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return isNaN(value) ? null : value;

  let str = String(value).trim();
  str = str.replace(/[€$£¥₹\s]/g, "");

  const lastComma = str.lastIndexOf(",");
  const lastDot = str.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    const afterComma = str.substring(lastComma + 1);
    if (afterComma.length <= 2) {
      str = str.replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  }

  str = str.replace(/[^0-9.\-]/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function normalizeLeadTimeDays(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;

  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (/(stock|available|immediate|ex stock|in stock)/.test(raw)) return 0;

  const numbers = raw.match(/\d+(?:[.,]\d+)?/g)?.map((part) => Number(part.replace(",", "."))).filter(Number.isFinite) || [];
  if (numbers.length === 0) return normalizeNumber(raw);

  // Supplier files often express lead time as "1-2 working days" or "4/6 weeks".
  // Use the upper bound so procurement promises stay conservative.
  const upperBound = Math.max(...numbers);
  if (/(week|weeks|wk|wks)/.test(raw)) return Math.round(upperBound * 7);
  if (/(month|months|mth|mths)/.test(raw)) return Math.round(upperBound * 30);
  return Math.round(upperBound);
}

/* -- Column Mapping ------------------------------------------------- */

function mapColumnName(columnName: string): string | null {
  if (!columnName) return null;
  const normalized = normalizeString(columnName).replace(/[^a-z0-9]/g, "");

  // Exact match
  for (const [fieldName, aliases] of Object.entries(COLUMN_MAPPINGS)) {
    for (const alias of aliases) {
      if (normalized === alias.replace(/[^a-z0-9]/g, "")) return fieldName;
    }
  }

  // Substring match (aliases ≥4 chars)
  for (const [fieldName, aliases] of Object.entries(COLUMN_MAPPINGS)) {
    for (const alias of aliases) {
      const normAlias = alias.replace(/[^a-z0-9]/g, "");
      if (normAlias.length >= 4 && normalized.includes(normAlias)) return fieldName;
    }
  }

  return null;
}

/* -- Normalized Row ------------------------------------------------- */

export interface NormalizedRow {
  system_id: string | null;
  offi_number: string | null;
  vendor_part_number: string | null;
  description: string | null;
  unit: string | null;
  moq: number | null;
  price: number | null;
  currency: string | null;
  hs_code: string | null;
  country_of_origin: string | null;
  lead_time_days: number | null;
  manufacturer: string | null;
}

const NUMERIC_FIELDS = new Set(["price", "moq", "lead_time_days"]);

export function normalizeRow(rawRow: Record<string, unknown>): NormalizedRow {
  const normalized: NormalizedRow = {
    system_id: null, offi_number: null, vendor_part_number: null,
    description: null, unit: null, moq: null, price: null,
    currency: null, hs_code: null, country_of_origin: null,
    lead_time_days: null, manufacturer: null,
  };

  for (const [key, value] of Object.entries(rawRow)) {
    const field = mapColumnName(key);
    if (field && field in normalized) {
      if (field === "lead_time_days") {
        (normalized as unknown as Record<string, unknown>)[field] = normalizeLeadTimeDays(value);
      } else if (NUMERIC_FIELDS.has(field)) {
        (normalized as unknown as Record<string, unknown>)[field] = normalizeNumber(value);
      } else if (value !== null && value !== undefined) {
        (normalized as unknown as Record<string, unknown>)[field] = String(value).trim();
      }
    }
  }

  return normalized;
}

/* -- CSV Parsing ---------------------------------------------------- */

export function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if ((char === "," || char === ";") && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else current += char;
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseRow(lines[i]);
    if (values.some((v) => v)) {
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        if (h) row[h] = values[idx] || "";
      });
      rows.push(row);
    }
  }
  return rows;
}

/* -- XLSX Parsing --------------------------------------------------- */

export async function parseXLSX(buffer: Buffer): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const { sanitizeParsedRows } = await import("@/lib/documents/sheet-safety");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  return sanitizeParsedRows(rows);
}

/* -- Parse File (auto-detect type) ---------------------------------- */

export async function parseAgreementFile(
  buffer: Buffer,
  fileType: string,
): Promise<{ rows: NormalizedRow[]; rawCount: number; mappedColumns: string[] }> {
  let rawRows: Record<string, unknown>[];

  const ft = fileType.toLowerCase();
  if (ft === "xlsx" || ft === "xls") {
    rawRows = await parseXLSX(buffer);
  } else if (ft === "csv") {
    rawRows = parseCSV(buffer.toString("utf-8"));
  } else {
    throw new Error(`Unsupported file type: ${ft}`);
  }

  if (!rawRows.length) throw new Error("No data rows found in file");

  // Detect which columns mapped successfully
  const sampleRow = rawRows[0];
  const mappedColumns: string[] = [];
  for (const key of Object.keys(sampleRow)) {
    const mapped = mapColumnName(key);
    if (mapped) mappedColumns.push(`${key} → ${mapped}`);
  }

  const rows = rawRows
    .map((row) => normalizeRow(row as Record<string, unknown>))
    .filter((row) => Boolean(
      row.description
      || row.price !== null
      || row.offi_number
      || row.system_id
      || row.vendor_part_number,
    ));

  return { rows, rawCount: rawRows.length, mappedColumns };
}
