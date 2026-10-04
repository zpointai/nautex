# Import authorised catalogue data

IMPA content is not distributed: no item rows, images, backups, embeddings or indexes. Nautex offers a format-compatible importer; that does not grant a catalogue licence. Nothing is fetched automatically. Initial item count is zero.

Use IMPA Catalogue → Import catalogue and choose an authorised CSV or XLSX file. Download the empty template from the catalogue page or `public/templates/catalogue.csv`. CSV headers are `impaCode,description,unit,category,descriptionExtra`. Code and description are required. The normal UI accepts six-digit codes; the command-line importer supports custom codes with `--include-chandler`. `DESCRIPTION 1`, `DESCRIPTION 2`, `IMPA CODE`, and `UNIT` are accepted aliases. Category labels come from your file; no proprietary section-name table is supplied. Empty/unrecognised rows are skipped and the result reports imported, skipped and failed counts. Duplicate codes update existing catalogue records.

The local catalogue is shared within one installed workspace/database. Do not host unrelated tenants against that database expecting catalogue isolation. Review the file before importing: it is stored locally and may appear in catalogue searches, exports and related record links. Back up valuable data before replacing catalogue entries. The importer currently has no dedicated undo transaction or upload-size limit; use modest files and a trusted source.

Release tests use a single synthetic placeholder item with a synthetic code and explicitly fictional description. That record exists only in a separate test profile and is not an installer seed. No optional demo workspace is shipped. Empty catalogue data does not prevent manual orders, inventory, finance or rule validation.
