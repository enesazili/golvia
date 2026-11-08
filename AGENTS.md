# Golvia çalışma yönergeleri

## Hesap akışı — 8 Kasım 2026

- Hesap formu e-posta/şifre ile `/api/auth/continue/email` kullanır. Yeni hesap kararı yalnız sunucudadır; mevcut veya OAuth-only e-posta için ikinci credential/hesap oluşturma. Ortak hata mesajı, Better Auth parola/CSRF/hız sınırı ve doğrulanmadan rekabete kapalı hesap kuralını koru.
- E-posta benzersizliği PostgreSQL'de C collation ile sağlanır; Türkçe locale lower() davranışına dönme. Çakışmada migration veri birleştirmez/silmez.
- Render Free e-posta yolu Resend HTTPS'tir (RESEND_API_KEY + EMAIL_FROM). SMTP yalnız Render dışı kurulumda kullanılır. Public auth isteklerini `handleAuth` üzerinden geçir; gönderim hatalarını başarı sayma. Token/URL/parola loglama.
- Google state/PKCE ve nonce bağlamasını, doğrulama özetlerinin tek kullanımlılığını koru. Canlı anahtar/teslimat ve auth migrasyonu doğrulanmış varsayılmaz.

## UX yenilemesi — 8 Kasım 2026

- `/` doğrudan oyun ekranıdır; `/oyun/3-2-1` kalıcı yönlendirmedir. Tek koyu tema ve package.json kaynaklı sürüm korunur. Tanıtım/tema seçici geri eklenmez.
- 3 saniyelik seçim ve 15 saniyelik cevap süresi korunur. Yanlış cevap süreyi bitirmez; oyuncu başına 350 ms sunucu sınırı ve requestId idempotency zorunludur. İlk doğru cevabın tek puan garantisini koru.
- Misafir adı ve güncel koşul kabulü sunucuda doğrulanır. Misafirler yalnız misafirlerle eşleşir; ortak devam anahtarıyla ikinci aktif socket reddedilir. Hesaplı rekabette doğrulanmış oturum ve güncel koşul kaydı gerekir.
- Google OAuth yalnız iki sunucu anahtarıyla açılır. Hukuki sayfalar taslaktır; veri sorumlusu, iletişim, ülke/aktarım, saklama süreleri ve hukuk incelemesi tamamlanmış varsayılmaz. Yeni auth koşul sütunları canlıya otomatik uygulanmaz.

## Hızlı başlangıç (7 Kasım 2026)

- Depo kökü bu kopyada `/home/enes/Golvia/golvia`; önce `git status --short`, sonra PROJECT_CONTEXT.md başı, ROADMAP.md başı ve ilgili akışın kaynağı. Aşağıdaki `D:\golvia` kuralı önceki Windows ortamının konum kaydıdır.
- Yapısal sorularda Codebase Memory `list_projects`/`index_status` ile başla; gerekirse indeksi güncelle, grafikten çağıranları izle, `check_index_coverage` uygula. Kesin kanıt için ilgili kaynak satırlarını oku; eksik/parsiyel SQL aralıklarında grafiğe tek başına güvenme.
- Ponytail FULL: mevcut işlevi koruyarak en küçük kök neden düzeltmesini yap; standart kütüphane ve mevcut modülleri kullan, belirsiz dosyaları silme. Özellikle motorun sunucu otoritesi, `requestId` idempotency, seçim gizliliği, kanıtlı futbol bağları ve aday/onay ayrımını koru.
- Hızlı doğrulama: ilgili test için `npx tsx --test tests/<dosya>.test.ts`; ardından `npm test`, `npm run lint`, `npm run typecheck`. DB varsa ve izole test bağlantısı ayarlıysa `npm run test:db`/`npm run test:account`; yoksa geçmiş başarıyı güncel başarı diye yazma. HTTP/deploy değişiminde ayrıca uygun yerel sunucu testi yap.
- Token tasarrufu: belgelerin güncel özetini ve grafik sonuçlarını önce kullan, yalnız ilgili dosyaları aç, aynı dosyayı tekrar tarama. Git dışı Top100-a ham JSON ve `.env` olmadan testlerin çalışması amaçlanır; canlı aday toplama/import yapma.

- Kullanıcıyla Türkçe ve kısa iletişim kur. Önce PROJECT_CONTEXT.md, ROADMAP.md ve işle ilgili kodu oku; veri işinde data/README.md de okunmalı.
- Phase 2 tamamlandı; mevcut Socket.IO/matchmaking işlevlerini koru. 7 Kasım 2026 isteği hesaplı rekabetçi maç/ELO/lig/profili yetkilendirdi; arkadaşlık/davet ve sezon sistemi eklenmedi.
- Normal rekabetçi sonuç sunucu motorundan, hükmen sonuç sunucunun doğruladığı aktif maç ayrılma/kopma süresinden gelir. `CompetitiveRepository` transaction'ını, hesap kilit sırasını ve tek aktif katılımcı indeksini koru. DB başarı vermeden ELO başarısı döndürme. Maç başlamadan ayrılma, iki tarafın kaybolması, AFK ve sunucu yeniden başlatması ELO'suzdur; tek tarafın aktif maçtan ayrılması veya 30 saniyede dönememesi hükmen yenilgidir. Bitmiş maçın sonucunu iptalle silme. `npm run test:competitive` yalnız yerel izole `TEST_DATABASE_URL` ile çalışır.
- Yalnızca mevcut Golvia depo kökünde çalış (bu kopyada `/home/enes/Golvia/golvia`, önceki Windows kopyasında `D:\golvia`). Diğer projelerin mevcut değişikliklerine dokunma. Mevcut dosyaları, varsa proje içi yönergeleri ve Git durumunu incele; reset/overwrite/commit/push/yayın yapma.
- Codebase Memory varsa yapısal keşifte kullan; kesin metin aramalarında rg. Küçük projeyi gereksiz indeksleme. Güncel veya yabancı API için resmi belge/Context7 kullan.
- Next.js App Router, mevcut bileşenler ve tema değişkenlerini koru. TypeScript strict kalsın. Gereksiz paket/refactor ekleme.
- src/server/game motoru UI ve taşıma katmanından bağımsız kalsın. İstemciye süre, puan, doğruluk veya oyuncu koltuğu kararı verme. Sunucu modüllerini client bundle'a taşımama sınırını koru; istemcide yalnızca type import yapılabilir.
- Her maça ait eylem aynı seri işlem sınırından geçmeli. Deadline, çoklu cevap hız sınırı, tur+attempt, requestId, gizli rakip seçimi ve atomik tek puan garantilerini koru. Aynı işlem kimliği farklı içerikle kabul edilmemeli.
- Tek süreç bellek oturumları dağıtık güvenlik sağlamaz. Yeni worker/dağıtım eklemeden önce kalıcı sahiplik/transaction tasarımı şart. Bu kısıtı gizleme.
- PostgreSQL şemasını ve importer doğrulamasını birlikte güncelle. Değerleri SQL parametreleriyle gönder. Sadece citizenship veya P54 üyeliğini maçta oynama kanıtı sayma.
- Yeni futbol ilişkilerinde yeniden kullanıma uygun yapılandırılmış kaynak + resmî oynama kanıtı, erişim tarihi, sabit ID ve doğrulama durumu zorunlu. Kaynağı olmayan bağ uydurma; isimleri kimlik olarak kullanma. Test sentetiklerini gerçek seed'e koyma.
- .env/parola/token/DB bağlantı URL'sini rapora veya commit'e ekleme. docker compose down -v gibi veri silen komutları talimatsız çalıştırma. Diğer projelerin konteynerlerine/sunucularına dokunma.
- UI değişikliklerinde semantik HTML, klavye odağı, reduced-motion, tek koyu tema ve mobil taşmayı koru. Simüle rakibi gerçek oyuncu gibi sunma.
- İlgili kontroller: npm test, npm run test:db, npm run lint, npm run typecheck, npm run build. HTTP değişiminde yerel sunucu ve TEST_BASE_URL ile npm run test:http. test:db gerçek PostgreSQL ve geçici izole şema kullanır; bağlantı yokken başarı/skip iddia etme.
- Yapılmayan kontrolleri geçti diye yazma. Önemli karar/ilerleme/kanıtları PROJECT_CONTEXT.md ve ROADMAP.md'ye kaydet. Kısa, somut sonuç ve sınırlamalar bildir.
- npm audit fix --force ile kontrolsüz sürüm değişiklikleri yapma. Geliştirme araçlarındaki bilinen 16 moderate bildirimi ayrı raporla; üretim audit sonucuyla karıştırma.
- Üretimde GOLVIA_PUBLIC_ORIGIN ve BETTER_AUTH_URL aynı HTTPS origin olmalı. /socket.io reverse proxy ile tek Socket.IO sürecine yönlenir; maçlar hâlâ bellektedir ve restartta kaybolur. Çoklu replica desteklenmez. PostgreSQL olmadan üretim veri yedeği açılmaz; Desteklenen e-posta sağlayıcısı olmadan hesap kaydı kapalıdır; Render üzerinde doğrulanmış göndericiyle Resend HTTPS gerekir. Auth migrasyonu izole PostgreSQL'de test edildi; canlıya uygulamadan önce canlı yedek ve geri yükleme denemesi gerekir.
- Yerel staging PostgreSQL 127.0.0.1:55437 ve izole test dosyaları .local/postgres altındadır; Git dışıdır. Parola/token içeriğini yazdırma. golvia_stage gerçek kullanıcı verisi içermez; golvia_account_test yalnız sentetik hesap testleri içindir. Başka DB, Docker konteyneri veya projeye dokunma.

- Wikidata toplamasında gerçek iletişim içeren WIKIDATA_USER_AGENT zorunlu. contact@example.com yalnızca örnektir; canlı istek için kullanma. Kullanıcı gerçek iletişim adresini sağladı. WIKIDATA_USER_AGENT yalnızca çalışma ortamında ayarlansın; adres kaynak koda yazılmasın. Phase 8 isteği yalnız ayrı A Top 100 checkpoint'inde kontrollü toplamayı yeniden yetkilendirdi; genel dünya taraması, eski checkpoint/ham JSON değişimi ve canlı veritabanına yazma yasaktır.
- Toplayıcının SQLite checkpoint dosyasında veriler, sonraki işler ve tamamlanma işareti aynı transaction içinde kaydedilmeli. Başarısız sorguyu tamamlandı sayma. Çalışan checkpoint dosyasını tek başına kopyalama; WAL dosyalarını göz ardı etme.
- P54 adayları appeared=false/verified=false kalmalı; bilinmeyen takım inceleme kuyruğuna alınmalı. Kaynak revizyonu, statement kimliği, tüm qualifiers/references korunmalı. Aday import seed'i ve doğrulanmış ilişkileri ezmemeli.



<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
