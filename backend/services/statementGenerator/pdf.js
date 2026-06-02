/**
 * Branded statement PDF generator.
 *
 * Builds the visually-identical PDF by filling the real ACR11P.xlsx template
 * for each page of a customer and converting via LibreOffice. The heavy
 * lifting lives in `fill_template.py` (openpyxl + soffice/unoconvert) because
 * openpyxl is the only library that reproduces the validated prototype's
 * cell-for-cell fidelity while preserving the template's embedded images.
 * This module is a thin Node wrapper that:
 *
 *   - locates the template asset
 *   - feeds the parsed customer payload to Python on stdin (JSON)
 *   - awaits a single multi-page PDF written to `outPath`
 *
 * Renderer:
 *   - Prefers `unoconvert` (persistent LibreOffice via unoserver). Per-page
 *     cost is sub-second because the listener stays warm across calls.
 *   - Falls back to `soffice --headless --convert-to pdf` so a dev box without
 *     unoserver still works.
 *
 * Concurrency:
 *   - Each call uses an isolated soffice user-profile directory (handled in
 *     Python) so concurrent BullMQ workers don't fight over LibreOffice locks.
 *   - For higher throughput, run multiple unoservers (different ports) and
 *     spread per-customer jobs across them via `UNOSERVER_PORT` rotation in
 *     the worker.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DEFAULT_TEMPLATE_PATH = path.join(
  __dirname, '..', '..', 'assets', 'statement-template', 'ACR11P.xlsx'
);

function resolveTemplatePath(opts = {}) {
  return opts.templatePath
    || process.env.STATEMENT_TEMPLATE_PATH
    || DEFAULT_TEMPLATE_PATH;
}

function resolvePythonBin(opts = {}) {
  return opts.pythonBin
    || process.env.STATEMENT_PYTHON_BIN
    || 'python3';
}

/**
 * Generate the branded PDF for one customer.
 *
 * @param {object} cust - parsed customer object from `parseExportText`
 * @param {string} outPath - absolute path where the .pdf should be written
 * @param {object} [opts]
 * @param {string} [opts.templatePath] - override template path
 * @param {string} [opts.pythonBin] - override python3 binary
 * @param {string} [opts.renderer] - 'auto' | 'unoconvert' | 'soffice'
 * @param {string} [opts.unoHost]
 * @param {number} [opts.unoPort]
 * @param {number} [opts.timeoutMs] - hard timeout for the whole conversion
 * @returns {Promise<{ output: string, pages: number, renderer: string }>}
 */
async function buildPdf(cust, outPath, opts = {}) {
  const templatePath = resolveTemplatePath(opts);
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Statement template not found at ${templatePath}. ` +
      `Copy ACR11P.xlsx into backend/assets/statement-template/ ` +
      `or set STATEMENT_TEMPLATE_PATH.`
    );
  }

  const pythonBin = resolvePythonBin(opts);
  const scriptPath = path.join(__dirname, 'fill_template.py');

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

  const args = [scriptPath, '--template', templatePath, '--output', outPath];
  if (opts.renderer) args.push('--renderer', opts.renderer);
  if (opts.unoHost) args.push('--uno-host', opts.unoHost);
  if (opts.unoPort) args.push('--uno-port', String(opts.unoPort));
  // Outer (Node) timeout - covers the whole Python invocation (fill + N page
  // conversions + merge). Bumped to 15 min default so a worst-case ~100-page
  // customer doesn't get SIGKILL'd before its sub-process timeouts can fire
  // and report properly. The BullMQ job lockDuration must exceed this
  // (queueWorker.js sets it to 10 min by default - increase together if you
  // raise either).
  const timeoutMs = opts.timeoutMs || parseInt(process.env.STATEMENT_PDF_TIMEOUT_MS, 10) || 15 * 60 * 1000;

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn ${pythonBin}: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject(new Error(
          `Statement PDF generation timed out after ${timeoutMs}ms (custNo=${cust.custNo})`
        ));
      }
      if (code !== 0) {
        return reject(new Error(
          `Statement PDF generation failed (custNo=${cust.custNo}, exit=${code}): ${stderr.trim() || 'unknown error'}`
        ));
      }
      // Last line of stdout is the JSON summary.
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '{}';
      try {
        const summary = JSON.parse(last);
        resolve(summary);
      } catch (_) {
        // The script ran fine but didn't emit JSON - still resolve with the
        // path we asked for, since the PDF should exist on disk.
        resolve({ output: outPath, pages: (cust.pages || []).length });
      }
    });

    child.stdin.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to send customer payload to python: ${err.message}`));
    });

    child.stdin.end(JSON.stringify(cust));
  });
}

module.exports = {
  buildPdf,
  resolveTemplatePath,
  DEFAULT_TEMPLATE_PATH
};
