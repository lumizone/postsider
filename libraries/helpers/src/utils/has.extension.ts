export const hasExtension = (
  path: string | undefined | null,
  extension: string
): boolean => {
  if (!path) {
    return false;
  }
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  const pathname = path.split(/[?#]/, 1)[0] || '';
  return pathname.toLowerCase().endsWith(ext.toLowerCase());
};
