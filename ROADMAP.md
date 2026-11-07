# Golvia — Yol haritası

## Golvia 1.1 — 8 Kasım 2026

- [x] Aktif rekabetçi maçtan çıkış ve 30 saniyede dönmeme için hükmen sonuç; eşleşme öncesi ve iki taraf yokken ELO'suz iptal.
- [x] Tek transaction'da hükmen ELO, idempotent sonuç, mevcut şemadan eklemeli kısıt yükseltmesi ve izole PostgreSQL doğrulaması.
- [x] Rakip kopma geri sayımı, dönüş, hükmen sonuç ve ELO farkı; 390 px yerel mobil görünüm kontrolü.
- [ ] Fiziksel iki cihaz, gerçek TLS/proxy/SMTP ve yük doğrulaması; canlı migrasyon ancak yedek/geri yükleme provası ve kullanıcı onayıyla.

## Güncel öncelik — 7 Kasım 2026

- [x] Doğrulanmış hesapla rekabetçi kuyruk, tek aktif hesap, atomik/idempotent maç sonucu ve mod bazlı ELO; lig, genel puan, profil ve sayfalı liderlik tablosu.
- [x] İzole PostgreSQL'de çift sonuç, eşzamanlı transaction, zorlanmış rollback, iptal yarışı ve gerçek hesap çereziyle tam Socket.IO maçı.
- [x] Rekabetçi hükmen mağlubiyet politikası ve yerel mobil görünüm; gerçek cihaz doğrulaması 1.1 sonrası açık.
- [x] Asenkron hesap denetiminden sonra iptal edilen hızlı eşleşmenin kuyruğa yeniden girmesini engelle; iptal edilen maç oturumunu kapat.
- [x] Kanıt birim testlerini Git dışı Top100-a aday JSON'undan bağımsız çalıştır.
- [ ] P1: Tek süreçte kalan maç durumu ve rate limit için kalıcı/dağıtık sahiplik tasarla; çoklu replica ve restart kurtarma bunun ardından.
- [ ] P1: Gerçek TLS/proxy/SMTP ve iki cihazlı akış doğrulaması (izole PostgreSQL ve yerel SMTP testleri geçti).
- [ ] P1: Kanıtsız adayları resmî oynama ve bağımsız kimlik kaydıyla tek tek incele; dört eski kimlik kanıtını yeniden doğrula.
- [ ] P2: `src/server/productionServer.ts` dağıtımda kullanılıyor mu belirle; kullanılmıyorsa ikinci sunucu başlatma yolunu kaldır. Geçmiş faz kayıtlarındaki tamamlanma kutuları kendi tarihlerinin sonucudur; güncel durum için bu bölümü ve PROJECT_CONTEXT.md başını oku.

## Phase 1 · Tamamlandı
- [x] Next.js, TypeScript, Tailwind temeli; responsive ana sayfa ve oyun ekranı.
- [x] Açık/koyu tema, temel erişilebilirlik ve görsel tasarım.
- [x] İlk arayüz demosu ve proje belgeleri. Eski demo Phase 2'de sunuculu antrenmanla değiştirildi.

## Phase 2 · Tamamlandı
- [x] Bağımsız, sunucu otoriter iki oyunculu 3-2-1 motoru.
- [x] 3/15 saniye, seçim gizliliği, aynı/eksik seçim, tek cevap, ilk doğru, iki yanlış, puansız timeout ve 3 puanda maç sonu.
- [x] Maç kuyruğu, atomik puanlama, tur/attempt sürümü, idempotency, geç/tekrar cevap reddi.
- [x] PostgreSQL 17 şeması, transaction import, doğrulanmış 4 futbolcu / 9 kariyer bağlantısı.
- [x] CC0 kaynak revizyonları, resmî kaynaklarla çapraz kontrol, veri lisansı ve kapsam belgesi.
- [x] A millî takım ve fiilen oynanan A takım bağlantıları; geçmiş kulüpler; aynı isimli oyuncu ayrımı.
- [x] Türkçe/aksan/alias destekli parametrik SQL önerileri ve indeksler.
- [x] Mevcut tasarıma HTTP antrenman entegrasyonu; simüle rakip açıkça belirtiliyor.
- [x] 24 birim/servis testi, 7 PostgreSQL testi, 1 HTTP entegrasyon testi; lint, typecheck, build ve sınırlı tarayıcı kontrolü.
- [x] Proje bağlamı, veri kaynakları, sınırlamalar ve çalışma yönergeleri güncel.

## Phase 3 · Mevcut altyapı onarıldı; tamamlanmadı
- [x] Mevcut Socket.IO bağlantısını gerçek MatchService ile çalışır hale getirme.
- [ ] Push olay yayını ve bağımsız sunucu zamanlayıcısı.
- [x] Tek süreçte insan-insan misafir 1v1 kuyruğu; socket kimliğine bağlı katılım ve iki gerçek istemci testi.
- [x] Tek süreçte 15 saniye yeniden bağlanma ve rakibe kopma bildirimi.
- [ ] Uzun kopma, hükmen yenilgi ve ağ gecikmesi politikası.
- [ ] Tek süreç bellek deposunu yayın gereksinimine göre kalıcı/dağıtık oturum deposuyla değiştir; atomik maç sahipliği ve idempotency garantilerini koru.
- [ ] Çoklu worker, ağ gecikmesi, sıra bozulması ve bağlantı testleri.

## Phase 4 · Hesap temeli başlatıldı; tamamlanmadı
- [x] Better Auth hesap/oturum temeli ve yerel sentetik doğrulama.
- [x] Hesaba bağlı rekabetçi eşleşme (mevcut 3-2-1 modu).
- [x] Mod başına kalıcı/sezonsuz ELO ve hesaplanan lig; maç sayısıyla dengelenmiş genel futbol puanı.
- [x] Profil, istatistikler ve tek seferlik rating transaction işlemleri.
- [ ] Canlı DB'de yedek/geri yükleme ve kontrollü eklemeli migrasyon; gerçek proxy/SMTP ve yük doğrulaması.

## Phase 5 · Başlamadı
- [ ] Arkadaşlık, davet, engelleme; ELO etkilemeyen özel maç.
- [ ] Karşılıklı kabul edilen rövanş.

## Phase 6 · Başlamadı
- [ ] Geliştirme bağımlılığı bulguları, reverse proxy/HTTPS politikası, kapsamlı abuse koruması.
- [ ] E2E, erişilebilirlik, gerçek cihaz, performans ve yük testleri.
- [ ] İzleme, yedekleme, recovery, CI ve kullanıcı onayıyla yayın.

Detaylı kanıtlar ve güncel sınırlamalar: PROJECT_CONTEXT.md. Veri kapsamı: data/README.md.

## Güvenli veri temizliği — 2 Kasım 2026
- [x] Proje/veri/Git denetimi; büyük ham SQLite/JSON dosyalarını yerelde koruyup Git takibinden çıkarma ve ignore kuralı ekleme.
- [x] Yeniden üretilebilir TypeScript artığını temizleme; kimliği veya gerekliliği belirsiz yedek, görsel ve resolver dosyalarını koruma.
- [x] Checkpoint rol okumasını toplulaştırma, gelecek açılışlar için iş/rol indeksleri ve doğrulanmış kariyer PostgreSQL kısmi indeksi hazırlama.
- [x] Aday importunun incelenmiş oyun veri sürümünü değiştirmesini engelleme; otomatik test, lint, typecheck, build ve veri kontrolleri.
- [ ] PostgreSQL çalışırken migrasyon ve tekrar import regresyonunu `test:db` ile doğrulama; şu an bağlantı reddediliyor.
- [ ] Eski genel keşif kuyruğunu silmeden A-kulüp kapsamına taşıyacak iş kökeni modelini tasarlama; büyük JSON importunun bellek/yük performansını ölçme.

## Build ve veri toplama bakımı
- [x] Metadata server sayfası / GameClient ayrımı; mevcut antrenman ve multiplayer korunarak build düzeltmesi.
- [x] Atomik SQLite veri+ilerleme kaydı, kesintiden devam, yazma hatası ve zorla süreç kapatma testleri.
- [x] Kulüp/meslek/millî takım keşfi, tarihî üyelik, sayfalama ve retry; konservatif takım sınıflandırması.
- [x] Kaynak revizyonu, statement/dönem, TR/EN alias, lakap/kısaltma; bilinmeyen veriyi incelemeye ayırma.
- [x] Aday verinin seed'i ezmesini engelleme, provenance alanı ve PostgreSQL regresyon testi.
- [x] 37 otomatik + 8 PostgreSQL + 1 HTTP testi; lint, TypeScript, build başarılı.
- [ ] Gerçek User-Agent iletişim bilgisi yapılandırıldıktan sonra canlı toplama/sorgu performansı doğrulaması.
- [ ] İnceleme kuyruğundaki takım sınıfları ve oynama kanıtlarını insan denetimiyle doğrulama.
- [ ] Büyük hacimde dışa aktarım belleği, sorgu planları ve import yükünü ölçme. Tüm futbol tarihi kapsamı iddia edilmez.

- [x] Canlı 50 işte sıfır kulüp nedenini checkpoint'te belirleme: takım varlıkları FIFO kuyruğun gerisinde.
- [x] Takım/ülke işlerini öne alma, mevcut checkpoint'i ağsız yeniden dışa aktarma; 10 gerçek P54 hedef ID'sini inceleme.
- [x] Açık profesyonel takım + futbol sinyali sınıflandırması, genç/rezerv/altyapı elemesi ve regresyon testi.
- [ ] Gerçek User-Agent iletişimi yapılandırılınca en çok 10 canlı takım işi çekip önce/sonra `data:check` karşılaştırması yapma.

- [x] Gerçek iletişimli Wikidata toplamasını mevcut SQLite checkpoint'ten sürdürme; P54 hedeflerine kuyruk önceliği.
- [x] Bilinmeyen kulüp adayını ayrı `level=unknown` ile saklama; oyun araması ve doğru cevapları yalnız kanıtlı senior bağlantılarla sınırlama.
- [x] Resmî/kurumsal maç kaynaklarıyla Ronaldo, Messi, Neymar ve iki ülke temsilli Diego Costa örneklerini inceleyip PostgreSQL'e aktarma.
- [ ] 4.000+ bekleyen işin veri kaynağı sınırlarına uyarak tamamlanması ve daha geniş resmî maç kanıtı incelemesi.

## Oyun bakım işi — 2 Kasım 2026
- [x] Yenileme ve kısa kopmada güvenli socket kimliğiyle 15 saniyelik maça geri dönüş.
- [x] Rakip kopması/bekleme/iptal bildirimi; yeniden rakip bulma düğmesi.
- [x] İptal ile eşleşme yaratma yarışı testi; mevcut sunucu otoriter motor regresyonları.
- [ ] Çoklu worker ve sunucu yeniden başlatmasında oturum kurtarma için kalıcı sahiplik tasarımı.
- [ ] Gerçek cihaz, yük ve uzun ağ kesintisi uçtan uca testleri.

## Duraklatılmış veri ve P54 düzeltmesi — 2 Kasım 2026
- [x] Mevcut üç checkpoint ve dört JSON dosyasını salt okunur sayım ve kalite kontrolünden geçirme.
- [x] A grubu kulüplerden members keşfi; oyuncu P54 hedefini yalnız team işine ekleme; checkpoint/kesinti testleri.
- [x] Oynanabilir bağ için bağımsız inceleme kaynağı zorunluluğu ve kanıtsız adayların reddi.
- [x] PostgreSQL kapalıyken 15 doğrulanmış bağlantılı yerel incelemeli veriyle sunuculu oyun ve arama.
- [ ] PostgreSQL servisi açıldığında gerçek import ve test:db doğrulaması.
- [ ] Aday kariyerleri resmî maç kaynaklarıyla tek tek inceleyerek yeni oyun bağına dönüştürme.

## Oynanabilir veri havuzu — 2 Kasım 2026
- [x] UEFA'nın kulüp başına pozitif maç sayılarını mevcut P54 adaylarıyla kimlik bazında karşılaştırıp 57 bağı bağımsız kanıtla inceleme paketine ekleme.
- [x] 24 kulüp / 26 çok kulüplü oyuncu / 66 doğrulanmış kulüp bağı / 45 cevaplı kulüp çifti; toplam 72 doğrulanmış kariyer.
- [x] Antrenman rakibini yalnız doğrulanmış ortak futbolcusu olan seçeneklerden seçme; cevapsız antrenman eşleşmesini açmama.
- [x] Dosya tabanlı arama, cevap ret/kabul, tur/skor ve eşleşme regresyonları; test, lint, typecheck, build ve data:check.
- [ ] PostgreSQL açıldığında incelemeli paket importu ve `test:db`; şu anda bağlantı reddediliyor.
- [ ] Kalan 1.965 aday oyuncu–takım çiftini bağımsız oynama kanıtıyla inceleme; sayı hedefi için kanıt eşiğini düşürmeme.

## Oyun akışı ve mobil deneyim — 2 Kasım 2026
- [x] Sunucu tarafı hazır olma, AFK, ortak geri sayım, tek seçim, karşılaşma, cevap ve okunabilir tur sonucu aşamaları.
- [x] İki boş seçimde `no_selection` sonucu; aynı seçimde hazır olma ile tekrar; eski turun istekleri reddedilir.
- [x] Yerel HTTP için güvenli eylem kimliği yedeği, kulüp ön araması, seçim kilidi, VS, doğru cevap ve puan görünümü, mobil ve reduced-motion stilleri.
- [x] Oynanabilir oyuncuyla sınırlı ve ilgililik sıralı iki karakterlik arama; sekiz sonuç sınırı.
- [x] Sunucu motoru, gerçek Socket.IO, kesinti, yerel IP tarayıcı akışı, HTTP antrenman, lint, TypeScript ve build kontrolleri.
- [ ] Fiziksel telefon + bilgisayarla eşzamanlı maç ve uzun süreli kopma testi.
- [ ] PostgreSQL açıldığında arama SQL'i ve importun `test:db` ile doğrulanması.
- [ ] Zlatan Ibrahimović gibi henüz incelemeli havuzda olmayan oyuncular için bağımsız oynama kanıtı incelemesi.

## Production hazırlığı — 3 Kasım 2026

- [x] Futbol odaklı ana sayfa, oyun, hesap, hata/404 düzeni; iki tema ve 390/768/1366/1920 piksel yatay taşma kontrolü.
- [x] Same-origin proxy tasarımı, WebSocket Origin kontrolü, hız sınırı, health/readiness, restart bildirimi, ortam preflight, güvenli HTTP başlıkları.
- [x] Better Auth hesap şeması ve arayüz kodu; e-posta sağlayıcısı yoksa kayıt kapalı, misafir oyun korunur.
- [x] Production bağımlılık audit 0; tüm bağımlılıklarda 16 orta seviye geliştirme aracı uyarısı.
- [ ] PostgreSQL yedeği ve izole geri yükleme sonrası futbol + auth migrasyonu/importu ve test:db.
- [ ] Gerçek SMTP ile kayıt, doğrulama, sıfırlama, oturum iptali, hesap durum yetkilendirmesi ve gizlilik/ihracat/silme akışı.
- [ ] İki gerçek cihazla tekrar 1v1, uzun kopma, restart ve yük testi.
- [ ] Bellek maçlarını kalıcı atomik sahiplik modeline taşıma; sonra çoklu replica/adapter ve güvenli rolling deploy.
- [ ] Nonce tabanlı CSP, reverse proxy güvenlik testi, ASVS 5.0 kapsamlı inceleme ve kullanılabilirlik/erişilebilirlik denetimi.
- [ ] Barındırma, TLS, SMTP, backup/restore ve yasal/gizlilik gereksinimleri tamamlanınca canlıya çıkış kararı.

## İzole staging DB ve güvenli hesap — 3 Kasım 2026

- [x] PostgreSQL 17 izole loopback cluster; futbol/auth migration ve çift import; 28 oyuncu, 24 kulüp, 72 kariyer/oyun bağı.
- [x] Sınırlı uygulama rolü ve salt okunur futbol erişimi; gerçek PostgreSQL araması ve oyun kataloğu.
- [x] Custom yedek ve ayrı DB'ye geri yükleme; ID özetleri doğrulandı.
- [x] Yerel SMTP alıcısı ile sentetik hesap kayıt/doğrulama/giriş/çıkış/sıfırlama/silme/oturum/429 ve iki hesap izolasyonu testleri.
- [x] Better Auth çerezine bağlı Socket.IO kimliği; iptal edilen oturum ve başka hesapla resume reddi; misafir desteği.
- [x] Production socket readiness ve gerçek DB destekli iki istemcili eşleşme başlangıcı.
- [ ] Gerçek SMTP sağlayıcısı, TLS ve domain ile uçtan uca teslimat/hesap doğrulaması.
- [ ] npm start production sürecinin izin verilen ortamda uçtan uca başlatılması; burada otomatik işlem denetimi engelledi.
- [ ] Kalıcı/atomik maç deposu; restartta maçları kurtarma veya sonuç kaydı; çoklu replica.
- [ ] Canlıya çıkmadan gerçek proxy, yedek saklama/geri yükleme, yük ve güvenlik testleri.

## Production stabilizasyon turu — 3 Kasım 2026

- [x] TS2704 (`NODE_ENV` readonly delete) düzeltmesi; `.local` ve üretilen klasörler için ESLint ignore; lint, typecheck ve build yeşil.
- [x] `.env` çalışan staging PostgreSQL'e bağlandı; uygulama/admin/test URL ayrımı; `db:import` açık dosya yolu zorunluluğu.
- [x] Staging migration, auth migration ve reviewed import tekrarı; 28 oyuncu, 24 kulüp, 72 doğrulanmış kariyer korundu; `test:db` 9/9.
- [x] Parola sıfırlama belirtecini URL'den temizleme, mutlak reset yönlendirmesi, pasif hesabı gizleme; `test:account` izole DB ile geçti.
- [x] Antrenman oluşturmada IP başına ve süreç geneli hız sınırı ayrımı.
- [x] `npm start` ve Socket.IO production süreçlerinde health/readiness doğrulaması; preflight `.env` okuması.
- [x] Yerel Git kontrol noktası (push yok); sırlar ve ham veri commit dışında.
- [ ] Gerçek SMTP sağlayıcısı, domain, TLS ve reverse proxy ile uçtan uca hesap/e-posta doğrulaması.
- [ ] Nonce tabanlı CSP, süreç dışı/paylaşımlı rate limit ve socket bağlantı/IP limiti.
- [ ] Kalıcı maç sahipliği, restart kurtarma ve çoklu replica güvenliği.
- [ ] İki gerçek cihazla E2E, uzun kopma, yük testi ve canlı yedek geri yükleme provası.

## Phase 5 — production güvenlik ve dayanıklılık — 3 Kasım 2026

- [x] Maç yaşam döngüsü journal'ı (`golvia_match`), açılışta `recover()` ile yarım maçları kapatma, `service.shutdown()` ve istemciye yanıltıcı devam hakkı vermeme; canlı oyun durumu bilinçli olarak bellekte.
- [x] Nonce tabanlı CSP (`src/proxy.ts`), `'strict-dynamic'` script, nonce style, production'da `unsafe-inline` kaldırma; güvenli HTTP başlıkları ve HSTS.
- [x] Socket bağlantı/IP/hesap limitleri, handshake hız sınırı, varsayılan TCP eşinden IP; `WS_TRUST_PROXY` olmadan forwarded başlığı yok sayma.
- [x] Askıya alma/reactivate aracı, `activeSession()` ile oturum iptali, token tek kullanımı ve hesaplar arası erişim testleri; `TRUST_PROXY` kapılı Better Auth IP çözümü.
- [x] `golvia_match` migration + `golvia_app` SELECT/INSERT/UPDATE izni; football şemasıyla tek transaction.
- [x] `db:backup -- --restore-test` custom dump ve izole `golvia_restore_test` geri yükleme; 60 varlık/72 kariyer/72 bağ eşleşti.
- [x] Genişletilmiş production preflight: origin, auth secret, SMTP eşleşmesi, build, DB, tablolar, dataset ve opsiyonel readiness; kritik eksikte fail-closed.
- [x] `npm test` 49/49, `test:db` 10/10, `test:account`, `test:http`, lint, typecheck, build ve üretim audit 0.
- [ ] Gerçek SMTP sağlayıcı, domain, TLS ve nginx ile uçtan uca hesap/e-posta doğrulaması.
- [ ] Süreç dışı/paylaşımlı rate limit ve maç durumu için kalıcı atomik sahiplik; ancak sonrasında çoklu replica.
- [ ] İki gerçek cihaz, uzun kopma, yük ve canlı yedek geri yükleme provası.
- [ ] `style-src` nonce politikasının yeni istemci kütüphaneleriyle uyumunun sürekli doğrulanması.

## Phase 7 — futbol verisi — 4 Kasım 2026

- [x] Mevcut adaylardan bağımsız oynama kanıtıyla incelenmiş havuzu 50 oyuncu, 50 kulüp, 178 kariyere ve 203 A-katalog oynanabilir çifte çıkar.
- [x] Top100 benzersizlik/önbellek sınıf taraması, yerel fırsat sıralaması, staging çift importu, yeni arama/eşleşme testleri.
- [x] `data:check`, 49/49 test, 10/10 DB testi, lint, typecheck, build ve staging yedek/izole geri yükleme.
- [ ] Kalan 51 A kulüp ID'sini bağımsız teyit et; hepsine kanıtlı ortak oyuncu sağla. En az 150 oyuncu ve 300 kariyer hedefleri henüz karşılanmadı.
- [ ] Canlı aktarım öncesi canlı yedek + izole geri yükleme denemesi, veri sürümü/kaynak denetimi ve bakım penceresi; kullanıcı onayıyla kontrollü import. Maç oturumları süreç belleğinde, restart aktif maçları kapatır.

## Phase 8 — A Top 100 veri altyapısı — 4 Kasım 2026

- [x] Ayrı A checkpoint, eski veri/önbellek yeniden kullanımı, 185 canlı iş denemesi, 1.019 aday futbolcu ve 7.003 P54 bağ adayı; 0 başarısız iş.
- [x] Dengeli, 1–3 çalışanlı hız sınırlı toplama; kulüp sayfa ilerlemesi; staging aday importu, checksum geçmişi ve oyun için kanıtlı/A kulüp filtresi.
- [ ] Kalan 2.004 işi kontrollü partilerle tamamla; 100 kulübün tüm sayfaları ve eksik takım/ülke referanslarını çöz. Q286191 kimliğini ayrıca bağımsız teyit et.
- [ ] Güvenilir maç/oynama kaynaklarından yapılandırılmış otomatik kanıt alma ve insan inceleme kuyruğu; 1.823 adayı kanıtsız tut. Üretim ölçeğinde sorgu/yük testi.
- [ ] Canlıya aktarım ancak canlı yedek/geri yükleme ve kullanıcı onayı sonrasında; bu fazda deploy/push yok.
- [x] 52/52 test, 10/10 DB testi, lint, typecheck, build, aday `data:check` ve staging yedek/geri yükleme.
## Phase 9 — maç kanıtı pilotu — 4 Kasım 2026

- [x] Yedi öncelikli P54 adayını resmî A takım maç/sayı kaynağıyla tek tek denetle; kaynak, kimlik, tarih ve gerekçeyi yapılandırılmış kaydet.
- [x] Ağsız/idempotent kanıt merge, katı kimlik/A takım/pozitif maç kapısı ve Top100-a fırsat sıralaması; eski 178 bağı koru.
- [x] Staging yedek/izole geri yükleme ve çift import; 185 kanıtlı bağ, 51 oynanabilir oyuncu, 212 A kulüp çifti.
- [x] 57/57 uygulama testi, 10/10 PostgreSQL testi, lint, typecheck, production build ve iki veri kalite kontrolü.
- [ ] Kalan 1.816 import edilebilir aday için izinli/ruhsatlı maç verisi kaynağı veya insan incelemesi; kaynağın içerik denetimini otomatikleştirme ancak kullanım hakkı doğrulanınca.
- [ ] Canlı veri aktarımı için canlı yedek, bağımsız geri yükleme ve açık kullanıcı onayı; bu turda canlı import/push/deploy yok.

## Phase 9.1 — veri tutarlılığı ve güvenli inceleme — 4 Kasım 2026

- [x] Staging yedeği; DB/JSON tek kanonik akış, deterministik export, checksum, sürüm artırımı ve çakışma reddi.
- [x] DB-only iki Bruma onayını kanıt defterine taşı; reviewed v7 ile DB/JSON eşitliğini 187 bağ/219 çiftte sağla.
- [x] RB Leipzig'i yalnız kanıtlı onayla `senior` yap; onaylı ama oynanabilir olmayan bağ bütünlük kontrolünü ekle.
- [x] Dört eksik kimlikli eski kanıtı silmeden yeniden incelemeye işaretle; yeni onaylarda bağımsız kimlik ve insan notu zorunlu kıl.
- [x] `/inceleme` ve review API'yi production'da kesin kapat; Host güvenini kaldır, bearer/rate-limit/8 KB gövde/audit aktör+işlem kimliği ekle.
- [x] 25 adaylık pilotu `football.review-pilot.json` + `football.match-proofs.json` kanonik girdilerine bağla; `.local` ve gömülü kanıt bağımlılığını kaldır.
- [x] 70/70 uygulama testi, 11/11 PostgreSQL testi, lint, typecheck ve production build.
- [ ] Dört bekleyen eski kayıt için bağımsız kimlik kanıtıyla insan yeniden incelemesi.
- [ ] İnceleme erişimini paylaşılan tek token yerine hesapla/çok faktörle sınırlandırma ve dağıtık rate limit.
- [ ] Kalan 1.816 aday için izinli/ruhsatlı maç verisi veya insan incelemesi; canlı yedek/geri yükleme ve onaylı dağıtım.
