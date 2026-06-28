/**
 * Is the PLATFORM OpenAI key configured? When true, AI features (Post Checker,
 * caption rewrite) use the platform OpenaiService. When false (self-host), they
 * fall back to a per-org bring-your-own-key stored in ProviderCredentials.
 */
export function isPlatformAiEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}
