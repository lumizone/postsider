import {
  formatRecoveryCodesText,
  renderRecoveryCodesPrintDocument,
} from './mfa-recovery-export';

describe('MFA recovery-code export', () => {
  const codes = ['ABCD-EFGH', 'WXYZ-1234'];

  it('formats recovery codes as a portable text file', () => {
    expect(formatRecoveryCodesText(codes)).toBe(
      'PostSider recovery codes\n\nABCD-EFGH\nWXYZ-1234\n'
    );
  });

  it('renders a printable document without interpreting recovery codes as HTML', () => {
    const document = renderRecoveryCodesPrintDocument([
      '<script>alert(1)</script>',
    ]);

    expect(document).toContain('PostSider recovery codes');
    expect(document).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(document).not.toContain('<script>alert(1)</script>');
  });
});
