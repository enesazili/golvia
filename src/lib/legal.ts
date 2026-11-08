/** Document revision, independent of the application release. */
export const TERMS_VERSION = '2026-11-08-draft-1';
export const legalLinks = [
  ['kosullar', 'Kullanım Koşulları'], ['kvkk', 'KVKK Aydınlatma Metni'],
  ['gizlilik', 'Gizlilik Politikası'], ['cerezler', 'Çerez Politikası'], ['basvuru', 'Veri Başvurusu ve Silme'],
] as const;
export function acceptsTerms(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'termsAccepted' in value && value.termsAccepted === true && 'termsVersion' in value && value.termsVersion === TERMS_VERSION;
}
