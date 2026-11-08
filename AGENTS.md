# Golvia çalışma yönergeleri

## Sosyal sistem — 1.5.0

- `src/server/social` ilişkiler/davet/bildirim/özel geçmişi tutar. `/social` namespace işlemleri cookie oturumunu yeniden doğrular; actor ID istemciden alınmaz. Presence yalnız kabul edilmiş arkadaşlara gösterilir ve tek socket sürecine aittir.
- `Matchmaking` hesap sahipliği hem kuyruk/maç hem kabul edilmiş davet rezervasyonunu kapsar. `pairFriends` mevcut motoru kullanır; özel sonuç deposunu rekabetçi ELO deposuna yönlendirme. `queueEpoch`, sabit hesap kilit sırası, çift kabul ve süre kontrollerini koru.
- SocialProvider globaldir; yeni davet eski maç devam anahtarını taşımaz. İlk matchFound ve reconnect mesajlarında arkadaşın account ID'si tekrar davet içindir; kimlik doğrulama değildir. Sonuç kapatmada rakip state temizlenir.
- Sosyal migration mevcut `db:migrate` içindedir (auth önce). Canlıya otomatik uygulama. `test:social` yalnız localhost golvia_account_test ile çalışır; FK silme/anonim rakip geçmişi ve ELO izolasyonunu koru.

## Profil ve kariyer — 1.3.0

- Rank eşiklerini `src/lib/rating.ts` tek kaynağından kullan; 900/1100/1300/1500/1800 uyumluluğunu koru. İstemcide ELO/rank yazımı açma.
- Profil/geçmiş yalnız oturum sahibine aittir; geçmiş rakibinin rankı `elo_before` üzerinden gelir. Saklanmamış veri üretme; silinmiş hesapta özel bilgi geri getirme.
- Görünen ad Better Auth üzerinden 2–24 karakter/NFKC ile değişir; Google/e-posta/ELO kimliklerini profil güncellemesine ekleme. E-posta değişikliği şu sürümde kapalıdır; domain ve eski/yeni adres doğrulaması güvenlik testlerinden geçmeden açma.
- Sonuç görüntüsü kapanana kadar rakip adı korunabilir; kapatmada ve yeniden eşleşmede socket/kimlik/deadline kalıntısı bırakma.

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
- Phase 2 tamamlandı; mevcut Socket.IO/matchmaking işlevlerini koru. 7 Kasım 2026 isteği hesaplı rekabetçi maç/ELO/lig/profili yetkilendirdi; arkadaşlık/davet 1.5.0 ile eklendi; sezon sistemi eklenmedi.
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

## Transfermarkt adayları — 8 Kasım 2026

- Transfermarkt verisi `data:transfermarkt` ile yerel DuckDB'den üretilir; çıktı ve DuckDB/CSV dosyaları Git dışıdır. Veri seti 6 Temmuz 2026'da dondurulmuştur; güncel olduğunu varsayma. TR2/TR3 ve Serie B bu kaynakta yoktur.
- Yalnız `appearances` maç oynama kanıtıdır. Transfer kaydı tek başına A takım maçı kanıtı değildir ve `football_transfer` içinde ayrı tutulur. Aday kariyer `appeared=true, verified=false` olur; insan incelemesi olmadan `verified` yapma ve oyuna açma.
- Adaylar `tm:` ad alanını kullanır; reviewed/Wikidata kimliklerine yalnız `football_identity_link` içindeki kesin kurallarla bağlanır (oyuncu: ad+doğum tarihi, kulüp: tam ad ve çelişmeyen ülke). Şüpheli veya çoklu eşleşmeyi birleştirme; isimleri kimlik olarak kullanma.
- Aday import reviewed dataset sürümünü, doğrulanmış kariyerleri ve `football_link` oyun bağlarını değiştirmemeli. Lisans CC0-1.0 depo derlemesi içindir; Transfermarkt site koşulları ve canlı kullanım için ayrı hukuk onayı gerekir. Canlı DB'ye, commit/push'a dokunma.



## Veri lisans kapısı — 1.4.0

- `football_link` yalnız `football_source_clearance.status='cleared'` + `verified && appeared` satırlarını birleştirir. Aday kaynak importta zorunlu `unresolved` olur; lisansı kendiliğinden temizleme, yalnız `setSourceClearance` kullan. `reference-only` kaynak asla `cleared` olamaz.
- Yayın `publishApprovedCareers` ile kaynak `cleared` + `football_review.status='approved'` ister; parti `football_publish_batch` içinde kaydedilir ve `revertPublish` ile geri alınır. Adayı elle `verified=true` yaparak kapıyı açma.
- Reviewed/verified satırları, `football_dataset` sürümünü ve hesap/ELO/maç tablolarını değiştirme; tekrarlı import idempotent kalmalı. Aday kariyer/transfer yalnız `verified=false` ve inceleme kaydı yoksa güncellenebilir.
- `data/identity-aliases.json` yalnız insan incelemesiyle eklenir. Aynı ad/farklı doğum tarihi pending kalır; isim benzerliği tek başına kimlik kanıtı değildir.

## Wikidata görünüm verisi — 1.4.1

- Toplu oynanabilir havuz yalnız Wikidata CC0-1.0 yapısal verisinden ve yalnız **P54 + P1350 ≥ 1** kuralıyla üretilir. P54 tek başına üyeliktir; yurttaşlık, transfer veya kulüp listesi maç kanıtı değildir.
- Kapsam A Top 100 + 12 öncelikli kulüp + 18 A millî takımıdır; oyuncu en az 2 hedef seçimde görünmelidir. Genel dünya taraması, keyfî kulüp ekleme ve katalog dışı büyütme yapılmaz; yeni hedefler bilinçli katalog değişikliğidir.
- `wd-p1350:` kimlikleri sabittir; dönemler birleştirilir/tekilleştirilir, ters veya 1880–`retrievedYear+1` dışı yıllar uydurulmadan boş bırakılır, `retrievedYear-14` sonrası doğumlu oyuncular düşürülür. Reviewed çiftleri yineleme; youth/transfer-only kayıtları ayrı tut.
- Dataset importu eklemeli ve idempotenttir; kaynak zorunlu `unresolved` yazılır ve `football_link` değişmez. Oyun açımı yalnız açık `setSourceClearance`/`football-publish grant` ile olur; import kendi lisansını temizleyemez.
- Canlı toplama gerçek iletişim içeren `WIKIDATA_USER_AGENT` ister; adres repoya yazılmaz. Canlı DB'ye yazma, commit/push/deploy ve yeni toplama ayrı yetki ister.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
