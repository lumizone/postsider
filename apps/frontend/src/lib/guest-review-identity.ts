export const GUEST_NAME_MAX = 120;
export const GUEST_EMAIL_MAX = 254;

export type GuestIdentityError =
  | "nameRequired"
  | "nameTooLong"
  | "emailRequired"
  | "emailInvalid"
  | "emailTooLong";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateGuestIdentity(
  name: string,
  email: string,
):
  | { ok: true; name: string; email: string }
  | { ok: false; error: GuestIdentityError } {
  const n = name.trim();
  const e = email.trim();
  if (!n) return { ok: false, error: "nameRequired" };
  if (n.length > GUEST_NAME_MAX) return { ok: false, error: "nameTooLong" };
  if (!e) return { ok: false, error: "emailRequired" };
  if (e.length > GUEST_EMAIL_MAX) return { ok: false, error: "emailTooLong" };
  if (!EMAIL_SHAPE.test(e)) return { ok: false, error: "emailInvalid" };
  return { ok: true, name: n, email: e };
}
