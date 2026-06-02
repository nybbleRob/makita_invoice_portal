# Statement Generator - Server Setup

The "Generate from Export" flow on the Statements page uploads an ACR11P
tab-delimited `.TXT` export and the worker generates a branded PDF + a simple
XLSX per customer.

This document covers the **server prerequisites** that must be installed for
that generation to work. None of this is needed for the existing PDF/XLS
upload flow.

---

## TL;DR install (Debian / Ubuntu)

```bash
sudo apt update
sudo apt install -y \
  libreoffice \
  python3 python3-pip \
  poppler-utils \
  fonts-liberation fontconfig

# unoserver (persistent LibreOffice listener) + openpyxl
sudo pip3 install --upgrade unoserver openpyxl

# Optional: pypdf as a pdfunite fallback for merge
sudo pip3 install --upgrade pypdf
```

Then install Arial / Arial Black / Calibri (see "Fonts" below) and start one
or more unoservers (see "Persistent LibreOffice listener" below).

---

## What the generator needs

| Dep                          | Why                                                        | Required? |
|------------------------------|------------------------------------------------------------|-----------|
| Python 3.8+                  | `fill_template.py` runs as a child process from the worker | yes       |
| `openpyxl`                   | Fills the `ACR11P.xlsx` template cell by cell              | yes       |
| LibreOffice (`soffice`)      | Converts the filled XLSX to PDF                            | yes       |
| `unoserver` (`unoconvert`)   | Persistent LibreOffice listener - no per-page startup cost | strongly recommended |
| `pdfunite` (poppler-utils)   | Merges per-page PDFs into one statement                    | yes (or pypdf) |
| `pypdf`                      | Pure-Python merge fallback if `pdfunite` is unavailable    | optional  |
| Arial, Arial Black, Calibri  | Visual parity with the existing Excel-macro output         | strongly recommended |
| `ACR11P.xlsx` template       | The branded layout - holds the logo + bank-details images  | yes       |

---

## ACR11P.xlsx template

The template is **not** committed to the repo (it carries business-confidential
bank details). Copy it onto the server during deployment:

```bash
sudo cp /path/to/ACR11P.xlsx \
  /opt/invoice-portal/backend/assets/statement-template/ACR11P.xlsx
sudo chown www-data:www-data /opt/invoice-portal/backend/assets/statement-template/ACR11P.xlsx
```

Default path resolved by the worker: `backend/assets/statement-template/ACR11P.xlsx`.
Override with `STATEMENT_TEMPLATE_PATH` if you need a different location.

The generator **fails fast** if the template is missing; it does not silently
fall back to a hand-built layout, because the output would not be visually
identical to the existing statement run.

---

## Fonts

LibreOffice renders the PDF. If the original fonts are not installed it
substitutes the closest match (typically Carlito for Calibri, Liberation Sans
for Arial). Metrics are close but not byte-identical, so for the
"visually identical" requirement you should install:

- **Arial**
- **Arial Black**
- **Calibri**

On Debian/Ubuntu these are not in the default repos because of licensing.
Common routes:

1. `ttf-mscorefonts-installer` (`sudo apt install ttf-mscorefonts-installer`)
   - Installs Arial, Arial Black, Times New Roman, etc. via Microsoft's
     freely-redistributable EULA.
2. Copy the .ttf files from a licensed Office install into
   `/usr/local/share/fonts/` and run `fc-cache -fv`.

Verify after install:

```bash
fc-list | grep -iE 'arial|calibri'
```

Restart LibreOffice / unoserver after adding fonts so they pick up the new
font cache:

```bash
sudo systemctl restart unoserver@2003
```

---

## Persistent LibreOffice listener (unoserver)

Without unoserver, every statement page incurs a ~3-5 s LibreOffice startup.
For a 379-customer run with one ~100-page customer that adds up to tens of
minutes of pure startup overhead.

`unoserver` runs LibreOffice once and accepts conversion requests via a local
socket; per-page cost drops to sub-second.

### Run as a systemd service (recommended)

Create `/etc/systemd/system/unoserver@.service`:

```ini
[Unit]
Description=unoserver (LibreOffice headless) on port %i
After=network.target

[Service]
Type=simple
User=www-data
ExecStart=/usr/local/bin/unoserver --port %i --interface 127.0.0.1
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Start a pool (one listener per concurrent worker - see "Sizing the pool"):

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now unoserver@2003
sudo systemctl enable --now unoserver@2004
sudo systemctl enable --now unoserver@2005
sudo systemctl enable --now unoserver@2006
```

Verify:

```bash
ss -ltn | grep -E '200[3-6]'
unoconvert --port 2003 some.xlsx some.pdf
```

### Telling the worker which port to use

`fill_template.py` reads `UNOSERVER_PORT` from the environment (default: let
`unoconvert` pick). For a multi-listener pool, set this via PM2 / systemd
environment per worker, or round-robin in the Node worker by passing
`opts.unoPort` to `buildPdf`. Default behaviour is fine for a single
listener - the bottleneck only matters at higher concurrency.

If `unoconvert` is not on the PATH, the Python script transparently falls
back to `soffice --headless --convert-to pdf` with an isolated user-profile
directory per call (so concurrent invocations don't fight over LibreOffice
lockfiles).

---

## Sizing the unoserver pool

The Node worker concurrency is controlled by `STATEMENT_GENERATE_CONCURRENCY`
(default: 4). Run **at least one** unoserver per concurrent worker - else
queued conversions serialise on a single listener and the larger concurrency
buys nothing.

Example for a 4-core server:

```bash
# .env (or PM2 ecosystem)
STATEMENT_GENERATE_CONCURRENCY=4
STATEMENT_PDF_RENDERER=unoconvert
UNOSERVER_HOST=127.0.0.1
# Per-worker port assignment is a refinement; the default behaviour is to let
# unoconvert pick whichever unoserver responds first. To pin, set
# UNOSERVER_PORT=2003 (etc.) on each worker process.
```

Memory: each LibreOffice instance idles at ~150-250 MB. A pool of 4 listeners
sits around ~1 GB resident before any conversion load.

---

## Environment variables (new)

| Variable                          | Default                                          | Purpose |
|-----------------------------------|--------------------------------------------------|---------|
| `STATEMENT_TEMPLATE_PATH`         | `backend/assets/statement-template/ACR11P.xlsx`  | Override template location |
| `STATEMENT_LOGO_PATH`             | `backend/assets/statement-template/makita_logo.png` | Logo embedded into XLSX output |
| `STATEMENT_PYTHON_BIN`            | `python3`                                        | Path to Python interpreter |
| `STATEMENT_PDF_RENDERER`          | `auto` (`unoconvert` if installed, else `soffice`) | Force a renderer |
| `STATEMENT_PDF_TIMEOUT`           | `180` (seconds, per-conversion in Python)        | Per-page conversion timeout |
| `STATEMENT_PDF_TIMEOUT_MS`        | `300000` (5 min, whole-customer in Node)         | Hard upper bound on the Python sidecar |
| `STATEMENT_GENERATE_CONCURRENCY`  | `4`                                              | BullMQ worker concurrency |
| `STATEMENT_GENERATE_LOCK_MS`      | `600000` (10 min)                                | BullMQ job lock; must outlast `STATEMENT_PDF_TIMEOUT_MS` |
| `UNOSERVER_HOST`                  | `127.0.0.1`                                      | unoconvert target host |
| `UNOSERVER_PORT`                  | (let unoconvert decide)                          | unoconvert target port |

None of these are required - sensible defaults are baked in. Override only
when sizing for a specific server.

---

## Smoke test (after install)

```bash
# 1. Template present?
ls -la /opt/invoice-portal/backend/assets/statement-template/ACR11P.xlsx

# 2. Python deps importable?
python3 -c "import openpyxl; print(openpyxl.__version__)"

# 3. LibreOffice can convert an XLSX?
echo "test" > /tmp/blank.xlsx  # use a real xlsx in practice
soffice --headless --convert-to pdf --outdir /tmp /tmp/blank.xlsx || true

# 4. unoserver listening?
ss -ltn | grep -E '200[3-6]'
unoconvert --port 2003 /tmp/blank.xlsx /tmp/blank.pdf

# 5. End-to-end (requires a real customer payload + template):
echo '<paste customer JSON here>' | python3 \
  /opt/invoice-portal/backend/services/statementGenerator/fill_template.py \
  --template /opt/invoice-portal/backend/assets/statement-template/ACR11P.xlsx \
  --output /tmp/out.pdf
```

---

## Notes for the parallel-validation rollout

While running new-generator and existing-import side by side:

- Disable customer-facing email by toggling `sendStatementEmail` off on the
  test users (or use the existing Settings test mode) until you're satisfied
  the generated PDFs match the existing pipeline.
- Sample customers 14 and 33 are the prototype's known-good fixtures; diff
  the generated PDFs against the existing pipeline's output for those two
  before broadening the comparison.
- Unmatched (non-CORP) customers always land in `unprocessed/failed/` by
  design - the export contains every customer in BPCS, not just portal ones.
  Do not treat these as failures during validation.
