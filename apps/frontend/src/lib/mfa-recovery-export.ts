const TEXT_FILENAME = 'postsider-recovery-codes.txt';

export function formatRecoveryCodesText(codes: readonly string[]): string {
  return `PostSider recovery codes\n\n${codes.join('\n')}\n`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!
  );
}

export function renderRecoveryCodesPrintDocument(
  codes: readonly string[]
): string {
  const items = codes
    .map((code) => `<li>${escapeHtml(code)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>PostSider recovery codes</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 32px; color: #111; }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { line-height: 1.5; }
      ul { columns: 2; padding-left: 24px; }
      li { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 8px 0; }
      @media print { body { margin: 18mm; } }
    </style>
  </head>
  <body>
    <h1>PostSider recovery codes</h1>
    <p>Each code works once. Keep this page private and store it somewhere safe.</p>
    <ul>${items}</ul>
  </body>
</html>`;
}

export function downloadRecoveryCodes(codes: readonly string[]): void {
  const blob = new Blob([formatRecoveryCodesText(codes)], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = TEXT_FILENAME;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function printRecoveryCodes(codes: readonly string[]): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('The print window was blocked');
  }

  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(renderRecoveryCodesPrintDocument(codes));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
