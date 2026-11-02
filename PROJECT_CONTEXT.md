# Golvia — Proje bağlamı

Son güncelleme: 1 Kasım 2026. Phase 2 tamamlandı. Phase 3 kullanıcı onayı bekliyor.

## Konum ve çalıştırma

Proje `D:\Projeler\golvia`. Mevcut Phase 1 tasarımı korundu; diğer projeler değiştirilmedi. Proje üst klasöründeki Git deposunda başka projelerin değişiklikleri var; bunlara dokunulmadı. Commit, push veya yayın yapılmadı.

Node.js 24.22.1 / npm 11.19.1 ile doğrulandı. Next.js 16.4.3, React 19.3.1, TypeScript strict, Tailwind 4.3.3 korunuyor. PostgreSQL 17 ayrı Docker Compose projesinde (`golvia-phase2`) ve yalnızca `127.0.0.1:5437` üzerinde. Veri kalıcı Docker volume içinde. Gerçek PostgreSQL bağlantısı kullanılır; sahte/veritabanısız fallback yoktur.

```powershell
cd D:\Projeler\golvia
npm ci
# İlk kurulum: .env.example dosyasını .env olarak kopyala;
# iki yerdeki parola değerini aynı, rastgele yerel parola ile değiştir.
docker compose -p golvia-phase2 up -d --wait
npm run db:migrate
npm run db:import
npm run dev -- --port 3211
```

Bu çalışma sırasında `.env` rastgele parola ile oluşturuldu ve Git dışında bırakıldı. Parolayı belgelere/sohbete yazma. Mevcut `.env` dosyasını ezme. Üretim önizlemesi: `npm run build` ardından `npm run start -- --port 3211`. Ana sayfa `/`, antrenman `/oyun/3-2-1`. Başlangıçtaki 3210 sunucusu durdurulmadı; Phase 2 önizlemesi 3211'de doğrulandı.

## Uygulanan mimari

- `src/server/game/engine.ts`: UI, ağ ve veritabanından bağımsız deterministik iki oyunculu durum makinesi. Saat yalnızca sunucu servisinden gelir.
- `src/server/game/service.ts`: maç başına sıralı komut kuyruğu, kriptografik koltuk anahtarları, süreli bellek oturumları ve antrenman rakibi.
- `src/server/runtime.ts`, `db.ts`: server-only uygulama bileşimi, PostgreSQL pool ve tek-süreç servis örneği.
- `src/server/football`: veri türleri, Türkçe/aksan normalizasyonu, parametrik SQL arama, transaction ile katalog okuma, doğrulanan JSON import ve SQL şeması.
- `data/football.seed.json`: revizyonları sabitlenmiş, kaynakları kaydedilmiş küçük veri kümesi. Lisans ve doğrulama detayları `data/README.md` içinde.
- `src/app/api/practice`: antrenman oluşturma, görünüm okuma, oyuncu eylemi; REST/HTTP. İkinci oyuncunun anahtarı hiçbir HTTP yanıtına eklenmez.
- `src/app/api/football`: veritabanından sınırlı arama önerileri; bağlantı/cevap anahtarı göndermez.
- `src/features/game`: mevcut görsel tasarımı kullanan HTTP istemcisi. Artık skor/doğruluk belirlemez. Önceki demo reducer, fixture ve bunlara ait 9 test kaldırıldı; yerlerini gerçek motor testleri aldı.
- Yeni bağımlılıklar: PostgreSQL sürücüsü `pg`, istemci import sınırı için `server-only`; geliştirmede `@types/pg` ve TS test/script çalıştırıcısı `tsx`. ORM/WebSocket/hesap bağımlılığı eklenmedi.

## Motor kuralları ve teknik kararlar

- 2 koltuk, ilk 3 puan kazanır. Seçim 3 saniye, cevap 15 saniye.
- İki seçim de son tarihe kadar saklıdır; oyuncu yalnızca kendi seçimini görür. İki seçim erken gönderilse de süre bitmeden açılmaz.
- Aynı seçim veya iki eksik seçim: aynı turda yeni `attempt`, temiz seçimler, 3 saniyelik yeni pencere, puan yok.
- Tek eksik seçim: seçim yapan oyuncu +1 puan.
- Cevap önerisi ID ile gönderilir; veri kümesinde olmayan oyuncu reddedilir ve hakkı tüketmez. Geçerli oyuncu ID'siyle yapılan ilk cevap hakkı tüketir. Yanlış cevap sonrası rakip cevap verebilir.
- İlk doğru cevap turu kapatır. İki yanlış cevap turu anında kapatır. Ortak futbolcu olmayan çift iptal edilmez.
- 15 saniyede doğru cevap yoksa puansız yeni seçim turu tam deadline üzerinde başlar. Diğer tur sonuçları 2,5 saniyelik, eylem kabul etmeyen sonuç gösteriminden sonra otomatik yeni tura geçer. Üçüncü puanda maç kalıcı olarak kapanır.
- Her komut `requestId`, `round`, `attempt`, `type`, `id` taşır. Türü ve izin verilen alanlar HTTP sınırında doğrulanır; istemci skor, süre, koltuk veya doğruluk gönderemez.
- Aynı oyuncu + aynı requestId + aynı içerik orijinal işlem makbuzunu döndürür. Farklı içerikle tekrar 409 conflict. Güncel görünüm ayrıca döner. Eski tur/attempt ve ikinci cevap reddedilir.
- Aynı anda gelen iki doğru cevap FIFO sunucu kuyruğunda sıralanır; ilk işlenen geçerli doğru cevap kazanır. Karar bloğunda await yoktur. Bu atomiklik tek süreç için geçerlidir.
- Kabul zamanı, kuyruğun işlemi yürüttüğü sunucu zamanıdır; ağda gönderim zamanı veya istemci saati kullanılmaz. Son tarihe eşit cevap geçtir. Gecikme telafisi bu fazda yoktur.
- Servis monotonic saat kullanır. Geçişler polling anına göre süre uzatmaz, önceki deadline üzerinden hesaplanır. Zaman ilerletme istek alındığında tembel değerlendirilir; istemci turu ilerleten bir `tick/next/finish` komutu gönderemez. WebSocket zamanlayıcı/olay yayını henüz yok.
- Her maç PostgreSQL'den alınmış tutarlı bir veri bağlantıları snapshot'ına bağlıdır. Sonradan yapılan import mevcut maçın doğrulamasını değiştirmez. Canlı import sırasında yeni öneriler mevcut maç snapshot'ında olmayabilir; importu maçlar kapalıyken yap, sonra yeni maç başlat.

## HTTP sözleşmesi

- `POST /api/practice` + `{ "type": "create" }`: sunucu antrenmanını başlatır; HttpOnly, SameSite=Strict ve HTTPS'te Secure cookie. Anahtar JavaScript'e verilmez.
- `GET /api/practice`: cookie ile kişiye özel `view`, `serverNow`, deadline ve revision; Cache-Control no-store.
- `POST /api/practice`: `{requestId, round, attempt, type: "choose" | "answer", id}`. Kabul 200; oyun reddi 409 ve işlem makbuzu; bozuk istek 400, kimlik yok 401, kaynak/yetki 403, oturum yok 404, sınır 429, altyapı sorunu 503.
- `GET /api/football?kind=selection|player&q=...`: en fazla 80 karakter sorgu, en fazla 20 öneri. İsim, ID, doğum tarihi ayırt edicisi; oyuncu bağlantıları yok.
- POST aynı origin ister, gövde akış üzerinden 2 KB ile sınırlanır. En fazla 500 oturum, 30 dakikalık mutlak TTL, maç başına en fazla 2048 farklı işlem makbuzu; dakikada 30 yeni antrenman (süreç genelinde).
- UI 250 ms aralıkla HTTP durum okur. Geri sayım sunucu zamanından görselleştirilir; karar vermez. Eski revision yanıtları yok sayılır. İşlem sırasında çift tıklama kilitli; ağ hatasında aynı istek kimliğiyle tekrar düğmesi vardır. Oturum sona erince yeni antrenman açılabilir.

## Gerçek ve simüle kısımlar

Gerçek: PostgreSQL arama ve bağlantılar, sunucuda seçim gizliliği/süre/puan/tek cevap/doğruluk/maç sonu, HTTP sınırları, yeniden gönderim güvenliği.

Simülasyon: kullanıcı karşısındaki antrenman rakibi sunucuda Real Madrid seçer ve hiç cevap vermez. Antrenman dışında mevcut Socket.IO ile insan-insan hızlı eşleşme onarıldı; hesap, ELO ve arkadaşlık yok. İki bağımsız oyuncu motor/servis testlerinde doğrulanır. Verinin küçük/kısmi olduğu arayüzde açıkça belirtilir.

Oturumlar yalnızca tek Node sürecinin belleğinde; süreç yeniden başlatılırsa kaybolur. Çoklu worker, yatay ölçekleme, kalıcı maç kurtarma veya dağıtık kilit güvenliği iddia edilmez. Sayfa yenileme hazır ekranına döner; eski oturum TTL dolana kadar sunucuda kalabilir. Bu faz yayın veya rekabetçi maç kullanımına hazır değildir. Reverse proxy origin/TLS politikası, kapsamlı rate-limit ve yük güvenliği yayın öncesinde ayrıca ele alınmalı.

## Önceki Phase 2 doğrulaması — 1 Kasım 2026

- `npm test`: 24 motor/servis/HTTP sınır testi geçti; iki eşzamanlı doğru cevap her iki sırada, 20 paralel tekrar, geç cevap, iki yanlış, eksik/aynı seçimler, üçüncü puan ve oturum izolasyonu dahil.
- `npm run test:db`: gerçek PostgreSQL üzerinde 7 test geçti (6 alt senaryo ve kapsayıcı test). Migration/import tekrar çalıştırma, arama, millî takım/klüp bağlantıları, aynı isimli oyuncular, kaynak reddi ve transaction rollback doğrulandı. Teste özel geçici şema kullanılır; gerçek veri değiştirilmez.
- `npm run test:http`: çalışan üretim sunucusunda kimlik, cookie, seçim gizliliği, origin, istemci skor sahteciliği, veri araması, 8 paralel tekrar ve tek puan senaryosu geçti. Çalıştırmadan önce `$env:TEST_BASE_URL='http://127.0.0.1:3211'` ayarla; sonra kaldır.
- `npm run lint`, `npm run typecheck`, `npm run build`: geçti.
- Tarayıcı: sunuculu Portekiz → Cristiano Ronaldo yanıtı skoru artırdı; otomatik sonraki tur çalıştı. 1440 px masaüstü ve 390 px mobil oyun ekranı incelendi; mobilde yatay taşma yok. Açık/koyu tema çalıştı. İncelenen oturumda console error/warn yok.
- `npm audit --omit=dev`: 0 bulgu. Geliştirme zincirinde önceki 16 moderate ESLint/minimatch bildirimi sürüyor; zorla sürüm düşürülmedi.
- Yapılmayanlar: çoklu sunucu, gerçek ağ gecikmesi/yük, tam WCAG/ekran okuyucu, gerçek cihaz ve tüm tarayıcı matrisi; veri kümesinin tüm futbol kariyerlerini kapsaması.

## Devam sınırı

Mevcut Phase 3 altyapısı bu bakımda onarıldı; faz bütünü tamamlandı sayılmaz. Yeniden bağlanma politikası, sunucu olay yayını, kalıcı/dağıtık oturum sahipliği sonraki işlerdir. Phase 4 başlamadı.

## Build ve Wikidata bakım sonucu — 1 Kasım 2026

- Oyun page.tsx metadata içeren Server Component olarak korundu. Hook/quick-match arayüzü GameClient içine taşındı; PracticeGame ve sunuculu antrenman korundu. Diğer app sayfalarında aynı metadata/hook ihlali bulunmadı.
- Mevcut socket sunucusundaki geçersiz motor importu, kimlik/kuyruk uyumsuzluğu ve TypeScript sorunları giderildi. Socket kimliği sunucuda üretilir; koltuk ve gizli servis tokenları sunucuda bağlanır. İki gerçek Socket.IO istemcisiyle eşleşme, gizlilik, tek puan, tekrar ve kopma testi geçti.
- Çalıştırma: Next ayrı süreç, npm.cmd run socket ayrı süreç. Varsayılan WS_PORT=3001, izinli origin localhost/127.0.0.1:3211; başka UI portu için WS_ORIGINS ayarlanmalı. İstemci NEXT_PUBLIC_WS_URL veya NEXT_PUBLIC_WS_PORT kullanabilir.
- Multiplayer durum okuma Socket.IO acknowledgement üzerinden 250 ms polling kullanır; tam push zamanlayıcısı ve reconnect/resume yok. Kopma eşleşmeyi iptal eder. Tek süreç bellek deposu korunur; dağıtık/yayın güvenliği iddia edilmez.
- Wikidata: Node 24 yerleşik SQLite, WAL + FULL synchronous; ham kayıt, rol, ilerleme ve sonraki işler aynı transaction. İkinci toplayıcı için süreç kilidi; kesilmiş işlemde rollback. JSON dışa aktarımı geçici dosya + fsync + rename. Eski ilerleme dosyası tamamlanma kanıtı sayılmaz; eski payload saklanır ve kayıp işler yeniden sorgulanır.
- İnsan futbolcu meslek keşfi, kulüp/millî takım keşfi ve tüm tarihî P54 üyelikleri beraber kullanılır. Q-ID bölümleri, 100 kayıt sayfalar, sabit cursor, tek istek akışı, 429/Retry-After ve sınırlı retry uygulanır. Kapsam Wikidata'nın eksik sınıflandırmalarıyla sınırlıdır.
- Bilinmeyen/genç/rezerv/altyapı sınıfları inceleme için korunur. P54 otomatik oynama veya doğrulama kanıtı değildir. Statement bazlı dönemler ve tüm kaynak/nitelikler korunur. Aday importer doğrulanmış seed'i ezmez; oyun dış servise cevap sorgulamaz.
- Kullanıcı talimatı: gerçek iletişim henüz yok. WIKIDATA_USER_AGENT ortam değişkeni kullanılacak; contact@example.com örneği canlı kullanımda reddedilir. Geniş canlı toplama BAŞLATILMADI.
- Mevcut seed: 4 futbolcu, 2 kulüp, 2 A millî takım, 9 kariyer; 9 doğrulanmış, 0 doğrulanmamış ilişki. Offline toplayıcı: 0 yeni kayıt, 27 bekleyen keşif işi, complete=false. Veri toplama tamamlandı iddiası yok.
- Güncel kontroller: 37 birim/servis/socket/veri testi, gerçek PostgreSQL üzerinde 8 test (7 alt + kapsayıcı), güncel üretim build'i üzerinde 1 HTTP testi geçti. Lint, TypeScript, production build, additive migration ve iki veri dosyasının kalite kontrolü geçti. Üretim bağımlılığı audit: 0 bulgu.
- Kesinti testi iki ayrı alt süreç zorla kapatılarak yapıldı: commit edilmiş veri/ilerleme korundu; commit edilmemiş ikisi birlikte geri alındı. Yazma hatası, tekrar indirmeme, hatalı/başarısız sorguyu pending bırakma, 429, yanlış sınıflandırma ve seed koruma test edildi.
- Bu bakımda yeni tarayıcı görsel/gerçek cihaz kontrolü yapılmadı; yukarıdaki görsel sonuçlar önceki Phase 2 kaydıdır. Canlı Wikidata sorgularının ölçek/servis performansı doğrulanmadı. Kaynaklar, çalıştırma ve sınırlar: data/README.md.

## Canlı 50 iş incelemesi — 1 Kasım 2026

Kullanıcının canlı çalışması: 50/4438 tamamlanan iş, 23 oyuncu, 41 P54 aday bağlantı, 0 takım varlığı. Checkpoint sorgusunda `entities=23`, `roles: player=23`; 1760 takım işi bekliyor. Kesin sıfır kulüp nedeni: FIFO kuyruk, binlerce oyuncu işini takım işlerinden önce işliyor. Dolayısıyla ilk 41 bağlantının hedef ID'leri henüz indirilmemiş ve hepsi `Unresolved team or conflicting dates` incelemesine düşmüş. Bu hata, 41 takımın yanlış sınıflandırıldığı anlamına gelmez: hiçbirinin P31 verisi checkpoint'te yoktu.

İlk 10 farklı gerçek hedef örneği (kaynak: yerel checkpoint/JSON; adlar Wikidata sayfa incelemesiyle yalnızca gösterildiği yerde karşılaştırıldı):

| Oyuncu | Hedef takım | Durum |
|---|---|---|
| Q1000050 Mayk Bullerjahn | Q142005 F.C. Hansa Rostock | takım varlığı bekliyor |
| Q1000190 Christoph Behr | Q161034 SV Wacker Burghausen | takım varlığı bekliyor |
| Q1000190 Christoph Behr | Q566183 TSV Buchbach | takım varlığı bekliyor |
| Q1000198 Richard Mademann | Q2521436 | takım varlığı bekliyor |
| Q1000198 Richard Mademann | Q32494 Schalke 04 | takım varlığı bekliyor |
| Q1000198 Richard Mademann | Q137499 FC 08 Homburg | takım varlığı bekliyor |
| Q1000198 Richard Mademann | Q170157 Wuppertaler SV | takım varlığı bekliyor |
| Q1000198 Richard Mademann | Q493464 | takım varlığı bekliyor |
| Q1000242 Karl-Heinz Singer | Q796981 | takım varlığı bekliyor |
| Q1000296 Fred Carreiro | Q7089046 | takım varlığı bekliyor |

Ayrı sayfa kontrolünde Q142005, Q161034, Q566183, Q32494, Q137499 ve Q170157 futbol kulübü adları görüldü; bu sayfa adları profesyonellik veya sahaya çıkış kanıtı kabul edilmedi. Q2521436 sayfası okunamadı. Q7156/seed kulüp ve Q267245/seed A millî takım güvenilir ön inceleme ile sınıflanıyor; Q1129595 İspanya U21 genel millî takım tipine rağmen genç takım olarak kalıyor.

Düzeltme: bekleyen takım ve ülke entity işleri öncelikli; kaydedilmiş Q-ID/ham veri/ilerleme korunuyor. Cache'deki varlık tekrar indirilmez. SPARQL `P31/P279*` keşfi kulüp ve millî takımları kapsar; varlığın sınıflanması ayrıca P31, futbol P641 ve açık profesyonel takım niteliğine bakar. Genel Q476028 kulüp tipi tek başına profesyonel statü sağlamaz. Genç/rezerv/altyapı elemesi önceliklidir. P54 ilişki varlığı, takımın sınıfı ve sahaya çıkış kanıtı ayrı tutulur; P54 adayları `appeared=false`, `verified=false` kalır. Oyun `verified && appeared` bağlarını kullanır; bu kuralı gevşetmek güvenilir olmayan cevapları doğru saydıracağından korunmuştur.

Düzeltmeden sonra yalnızca ağsız yeniden dışa aktarım yapıldı: 23 oyuncu, 0 kulüp, 0 A millî takım, 41 aday/41 inceleme, 0 içe aktarılabilir bağlantı; 50 tamamlanmış, 4388 bekleyen iş. Sayıların değişmemesi beklenir, çünkü 0 takım ham kaydı var. Küçük canlı sayfa kontrolü yapıldı; toplayıcıyla yeni indirme yapılmadı: ortamda gerçek WIKIDATA_USER_AGENT bulunmuyor. Kullanıcının önceki talimatı gereği örnek iletişim adresi canlı istekte kullanılamaz. Gerçek adres eklendiğinde `npm.cmd run data:fetch -- --max-tasks 10` mevcut checkpoint'ten ilk takım işlerini alır; sonra `data:check` ile sayılar tekrar karşılaştırılmalıdır. Toplama ve insan kaynaklı oynama doğrulaması tamamlanmadı.

## Geniş veri çalışması — 1 Kasım 2026

Kullanıcı gerçek Wikidata iletişim adresini verdi; yalnızca süreç ortamındaki WIKIDATA_USER_AGENT ile kullanıldı, Git içindeki dosyalara yazılmadı. Önceki 50 işlik SQLite checkpoint korunarak canlı toplama sürdürüldü. Tamamlanmış işler yeniden indirilmedi. İlk 10 takım incelemesi P31 Q476028 ve P641 Q2736 gibi genel kulüp/futbol alanları gösterdi; bu profesyonel A takım ve oynama kanıtı değildir. Bekleyen oyuncuların P54 ile işaret ettiği takım ID'leri diğer keşif kulüplerinin önüne alındı; hedef tablosu mevcut checkpoint'teki oyunculardan yeniden kurulur.

Veri modeli `club` için `level=unknown` kabul eder. Bunlar kaynaklı kulüp adayları ve P54 ilişkileriyle PostgreSQL'e alınabilir; arama, oyun kataloğu ve `football_link` yalnız `senior`, `verified && appeared` kayıtlarını kullanır. Böylece kayıp ilişkiler saklanır, otomatik doğru cevap üretilmez. `data:check` seniorClubs/clubCandidates ayrımını raporlar. Belirsiz millî takımlar, genç/rezerv takımlar ve eksik ülke bağlantıları incelemede kalır. Geniş toplama veri kapsamını artırır; oynama kanıtını otomatik doğrulamaz.

Ek incelemeli dosya `data/football.reviewed.json` seed'i genişletir. Neymar/Barcelona için Barcelona'nın 50 resmî maç kaydı; Messi ve Neymar/PSG için UEFA 6 Eylül 2022 tam maç raporu; Ronaldo/Al-Nassr için AFC maç raporu; Diego Costa/İspanya için FIFA Dünya Kupası ilk 11 kaydı ve Diego Costa/Brezilya için RSSSF uluslararası maç dökümü kullanıldı. Kaynaklar yeniden dağıtılmadı, yalnız bağlantı/kanıt kimliği saklandı. Wikidata Q-ID'leri kişi/kulüp/millî takım kimliğidir. Bu dosya seed'i değiştirmez ve tekrar import edilebilir. Diego Costa Brezilya maçları hazırlık maçlarıdır; A millî takım temsili olarak kabul edilir, FIFA rekabetçi maç statüsü iddia edilmez.

İncelenen örnek oyun bağları: Real Madrid–Al-Nassr → Ronaldo, Barcelona–PSG → Messi ve Neymar, Real Madrid–Portekiz → Ronaldo, Brezilya–İspanya → Diego Costa. Oyun sunucusu doğruluğu PostgreSQL `football_link` snapshot'ından alır, cevap sırasında dış API kullanmaz. Kullanıcının önceki seed verileri ve multiplayer motoru korunur.

## 3-2-1 oyun sağlamlaştırması — 2 Kasım 2026

- Mevcut Match motorunun 3/15 saniye, gizli seçim, eşzamanlı yanıt, tek cevap, iki yanlış sonrası hemen tur bitişi, zaman aşımı, üçüncü puan ve sunucu doğrulaması korundu. Yeni veri `football_link` görünümündeki yalnız verified + appeared ilişkileriyle maç snapshot'ına girer. Futbol verisi ve canlı toplayıcıya müdahale edilmedi.
- Hızlı eşleşme bağlantısına kısa süreli sunucu kimliği eklendi. Tarayıcı oturumundaki geri dönüş anahtarıyla sayfa yenileme veya geçici ağ kopmasından sonraki 15 saniyede aynı maça dönülebilir. Rakip kopunca bekleme durumu gösterilir; süre dolunca maç iptal edilir. Anahtar yetkili socket bağlantısı dışında oyuncu kimliği sağlamaz. Tek süreç belleği yeniden başlatıldığında maç kurtarılamaz.
- Eşleşme oluşturma sırasında iptal yarışına işlem nesli kontrolü eklendi; iptal edilmiş oyuncu geç gelen katalog sonucuyla eşleşemez. Oyuncu eylemleri hâlâ socket kimliği ve MatchService seri sınırından geçer.
- Oyun ekranında çevrim içi başlık/sonuç, rakip bekleme/yeniden bağlanma durumu ve tek düğmeyle yeni rakip akışı düzeltildi. Antrenman metnindeki eski 'WebSocket yok' ve sabit dört oyuncu iddiaları kaldırıldı. Arama mevcut PostgreSQL alias/Türkçe normalizasyonunu kullanır; şüpheli aday ilişkileri doğru cevap sayılmaz.
- Oyun odaklı 29 motor/HTTP sınır/socket testi geçti; gerçek socket geri dönüşü, süreli iptal ve maç oluşturma yarışı dahil. Lint, TypeScript ve üretim build kontrolleri çalıştırıldı. Genel npm test başka terminalde eşzamanlı değişen veri toplayıcı koduna bağlı `wikidata.test.ts` devam testi nedeniyle başarısız oldu; bu görev kapsamı gereği veri toplama dosyalarına müdahale edilmedi.
- Sınırlar: bellek oturumları tek süreçtir; 15 saniyelik kopma dışında devam veya sunucu yeniden başlatmasından kurtarma yoktur. Gerçek mobil cihaz, tüm tarayıcılar ve yük altında uzun süreli ağ kopması testi yapılmadı. Socket.IO ayrı süreçte çalışır; farklı yerel UI origin için WS_ORIGINS gerekir.

## Veri toplama duraklatıldı — 2 Kasım 2026

Bu işte Wikidata'ya istek yapılmadı; mevcut SQLite checkpoint'ler ve JSON verileri yalnızca okundu. Ana checkpoint 4.682 iş / 1.502 tamamlanan / 3.180 bekleyen; 23 oyuncu, 1.452 takım ham varlığı, 41 P54 ifadesi. Curated checkpoint: 407 oyuncu, 108 takım ham varlığı, 2.487 P54. Top100 checkpoint: 833 oyuncu, 100 takım ham varlığı, 5.594 P54. Bunlar birbirinden bağımsız kısmi toplamalardır; ham P54 sayısı oyunda kullanılabilir bağlantı sayısı değildir.

JSON kalite kontrolü: football-wikidata.json 23 oyuncu / 724 kulüp adayı / 34 içe aktarılabilir ama doğrulanmamış kariyer; football-curated.json 407 oyuncu / 80 kulüp / 992 doğrulanmamış kariyer; football-top100.json 833 oyuncu / 82 kulüp / 1.193 doğrulanmamış kariyer. ID birleşiminde 1.248 ayrı oyuncu, 863 ayrı kulüp, 2.208 ayrı içe aktarılmış kariyer ifadesi var; bunlar doğrulanmış oyun bağı değildir. İncelemeli football.reviewed.json 6 oyuncu, 4 senior kulüp, 4 A millî takım, 15 verified + appeared kariyer içerir. Oyun için 4 kulüp, 6 oyuncu ve 15 doğrulanmış kariyer bağı kullanılabilir. Üç aday pakette otomatik doğrulanmış bağlantı sayısı 0.

P54 hatası: oyuncu entity işi artık P54 hedeflerini yalnız entity/team olarak ekliyor; otomatik members taraması açmıyor. Katalogdaki A grubu kulüpler members keşfi başlatıyor; B grubu yalnız takım varlığını ekliyor. Tekrar işler SQLite ID/rol anahtarıyla birleşiyor ve ham varlık önbellekten okunuyor. Eski veri dosyaları değiştirilmedi. Kesinti, yeniden açma ve aynı takımı tekrar indirmeme testleri geçti.

## Oynanabilir havuz incelemesi — 2 Kasım 2026

Yeni Wikidata sorgusu yapılmadı; üç aday JSON ve checkpoint değiştirilmedi. `football.reviewed.json` mevcut incelemeleri koruyarak 57 ayrı kulüp kariyer bağıyla genişletildi. Bağımsız fiilî maç kanıtı: [UEFA Şampiyonlar Ligi 2022/23 İstatistik El Kitabı](https://editorial.uefa.com/resources/0282-184079e97393-127f15886394-1000/ucl_202223_facts_md13.pdf), “All-time top player appearances” bölümünde kulüp başına pozitif maç sayısı; Cristiano Ronaldo/Sporting CP için ayrıca [UEFA 2026 kulüp müsabakası katılım listesi](https://www.uefa.com/uefachampionsleague/news/0257-0e9a0f70e31c-e6f6d51eef60-1000--most-uefa-club-appearances/) (kulüplerin yalnızca oyuncunun forma giydiği takımlar olduğu açıklanır). UEFA içerikleri kopyalanmadı; `reference-only` URL ve her bağda inceleme gerekçesi saklandı. Kulüp kimliği Wikidata Q-ID, P54 ise yalnız aday eşleştirmesidir. Belgede sıfır maç görünen veya kulüp/oyuncu kimliği yerel adayla eşleşmeyen bağ onaylanmadı.

Güncel incelemeli paket: 24 oynanabilir kulüp, 26 en az iki kulübe bağlanan oyuncu, 66 doğrulanmış kulüp kariyer bağı, en az bir doğru cevabı olan 45 farklı kulüp çifti. Pakette ayrıca 6 A millî takım bağı bulunur; toplam 72 `verified && appeared` kariyer. Üç aday JSON'un 2.026 farklı oyuncu–takım çiftinden 1.965'i bu incelemeli pakette henüz bağımsız kanıtla onaylanmadı; bu “yanlış” kararı değildir. Antrenman botu sunucu katalogundaki gerçek ortak oyuncu bağlantılarına göre rakip seçer; bağlantısız seçim aynı seçim turunu yeniden başlatır. İki insanın bağımsız seçim yaptığı multiplayer'da cevapsız çift mümkün olmaya devam eder; oyun kuralı gereği tur otomatik iptal edilmez.

Dosya tabanlı yedek kaynak, arama, yanlış/doğru cevap ve antrenman botu testleri geçti. `data:check`, 46 otomatik test, lint, TypeScript ve production build geçti. PostgreSQL `127.0.0.1:5437` bağlantısı reddedildiği için gerçek import ve `test:db` doğrulanamadı; sunucu PostgreSQL kapalıyken incelemeli JSON'u kullanır.

## Oyun akışı ve mobil revizyonu — 2 Kasım 2026

Sunucu motorunda maç/tur hazırlığı (`ready`, 30 saniye AFK sınırı), iki oyuncu hazır olunca ortak 3 saniyelik geri sayım, 3 saniyelik tek seçim, 1,8 saniyelik karşılaşma gösterimi, ardından tam 15 saniyelik cevap ve 5 saniyelik sonuç aşaması var. İki boş seçim `no_selection` olarak puansız sonuç verir; yeni seçim için yeniden hazır olmak gerekir, otomatik 3 saniye döngüsü yok. Tek oyuncu seçmezse karşı tarafa puan verilir. Aynı seçim yeni hazırlıkla aynı turun sonraki denemesine geçer. Sunucu kimlik, süre, tek cevap ve puan kararlarını korur; kabul edilen seçim değiştirilemez. Doğru cevap ID ve adı sonuçta sunucudan gelir.

İstemci eylem kimliği `randomUUID` yoksa `getRandomValues` ile üretilir; güvenli rastgelelik tamamen yoksa eylem gönderilmez ve hata gösterilir. Bu kimlik yetki belirteci değildir; maç/oturum kimliği sunucuda üretilmeye devam eder. 192.168.1.102:3215 yerel HTTP tarayıcı denemesinde hazırlık, kulüp seçimi, gizli rakip seçimi, futbolcu araması ve doğru cevap/puan çalıştı; gerçek fiziksel telefonla tekrar denenmedi. Geliştirme sunucusu LAN'a bağlanır; Socket.IO geliştirmede özel ağdaki 3000/3211 UI origin'lerini kabul eder, üretimde yalnız yapılandırılmış origin'ler geçerlidir. Çalışan eski dev/socket süreçlerinin yeni kodu yüklemesi için yeniden başlatılması gerekebilir; mevcut süreçler durdurulmadı.

Mevcut kullanıcıya ait 3000 geliştirme süreci son kontrolde hâlâ eski `select` başlangıç yanıtını verdi; bu süreç korunup yeniden başlatılmadı. Güncel kod ayrı 3215 üretim önizlemesinde doğrulandı ve geçici önizleme kapatıldı. 3000/3001 süreçlerinin yeni oyun akışını sunması için sahipleri tarafından yeniden başlatılması gerekir.

Futbol araması iki karakterden önce boş; doğrulanmış bağlantılarla oynanabilir oyuncularla sınırlı, en fazla sekiz sonuç, tam ad/kelime başlangıcı öncelikli. Takım adları ekran için ayrı katalog isteğiyle yüklenir; arama listesi başlangıçta boş kalır. Kulüp sorgusu hazırlık sırasında yazılabilir ve seçim başlayınca korunur. `ibra` sorgusunda mevcut 28 oyunculuk incelemeli pakette Zlatan Ibrahimović bulunmadığından sonuç yoktur; sırf aramada görünmesi için doğrulanmamış oyuncu eklenmedi. PostgreSQL import testi bağlantı reddi nedeniyle doğrulanamadı.

İçe aktarma kuralı: wikidata-candidates dosyasındaki bağlar appeared/verified true olamaz. Oynanabilir bağ için ayrı reference-only maç inceleme kaynağı zorunlu; kaynak URL'si tek başına doğru kanıt sayılmaz, insanın maç içeriğini incelemesi gerekir. PostgreSQL kapalıysa FootballRepository yalnız yerel incelemeli dosyayı salt okunur yedek olarak kullanır; aday paketleri oyuna eklemez. Arama ve maç kataloğu aynı 15 kanıtlı bağı kullanır, cevap sırasında Wikidata sorgusu yapılmaz.

Kontroller: npm test 45/45, lint, TypeScript, production build, dört JSON kalite kontrolü ve kapalı PostgreSQL ile üretim HTTP testi geçti. PostgreSQL bağlantısı 127.0.0.1:5437 üzerinde reddedildi; Docker daemon da kapalıydı. Bu turda gerçek PostgreSQL importu ve test:db çalıştırılamadı; sunucu açıldığında incelemeli dosya ve aday paketlerin ayrı importu yeniden doğrulanmalı. 3213 yerel production önizlemesi salt okunur yedek veriyle çalıştı.

## Dosya ve veri denetimi — 2 Kasım 2026

- Başlangıçta 858.702.144 bayt / 22.867 dosya ölçüldü. `node_modules` ve `.next` çalışma/geliştirme çıktıları, `football.reviewed.json` ve seed oyun verisi, üç aday JSON ile üç SQLite ve yan dosyaları toplama/inceleme verisi olarak korundu. `preview.jpg`, Top100 giriş listesi ve resolver, katalog yedeği/progress/review dosyaları kullanımı veya yeniden üretilebilirliği kesinleşmediği için silinmedi.
- Yalnızca yeniden üretilebilir `tsconfig.tsbuildinfo` (126.216 bayt) silindi. Build nedeniyle son toplam 859.008.620 bayt / 22.871 dosya; toplam artış build çıktısından gelir. Dört büyük ham paket (159.445.271 bayt) yerelde korunarak Git indeksinden çıkarıldı ve `.gitignore` genişletildi; bu staged silme yalnız Git takibi içindir, fiziksel veri silme değildir. `football.reviewed.json` ve seed Git'te kalır. Commit yapılmadı.
- Aday JSON'ların birleşiminde 1.244 ayrı futbolcu ID, 863 kulüp ID, 2.193 ayrı kariyer ID var. Paketler arasında 52 varlık ID ve 26 kariyer ID tekrar eder; dosya içi yinelenen ID sıfırdır. Seed ve incelemeli paket eklendiğinde 1.248 futbolcu, 863 kulüp, 2.265 kariyer ID; 2.037 farklı futbolcu–takım çifti var. Aynı çiftin farklı kariyer dönemleri otomatik birleştirilmedi. İncelemeli pakette 28 oyuncu, 24 senior kulüp ve 72 `verified && appeared` bağ var; üç aday pakette doğrulanmış bağ sıfır.
- Salt okunur SQLite sayımı: ana checkpoint 1.475 varlık / 4.682 iş (1.502 tamam, 3.180 bekleyen), curated 533 / 632 (538 tamam), top100 956 / 1.095 (965 tamam). JSON `collection` özetleri export anına aittir; güncel checkpoint ilerlemesi olarak kullanılmamalı. Checkpoint ve JSON dosyaları değiştirilmedi, yeni Wikidata isteği yapılmadı.
- Gelecekteki checkpoint açılışında `jobs(done)` ve `roles(role,id)` indeksleri kurulacak; dışa aktarım rol okumaları N+1 yerine tek sorguyla yapılır. PostgreSQL migrasyonuna yalnız `verified && appeared` takım/oyuncu kısmi indeksi eklendi. Aday import artık incelenmiş oyun veri sürümünü değiştirmez. Gerçek PostgreSQL migration/import uygulanmadı; `127.0.0.1:5437` bağlantısı reddedildi. Büyük JSON importu hâlâ tüm dosyayı belleğe alır; ölçek yük testi ve parça parça import ayrı iş olarak kalır.
- Katalog A kulüpleri `members`, P54 referansları yalnız `entity/team` işi ekler; ID/rol anahtarı ve varlık önbelleği tekrar indirmeyi önler. Eski checkpoint'teki genel `discover` işleri hâlâ bekler; mevcut kuyruğu veri kaybı yaşamadan A kataloğuna daraltmak için iş kökeni kaydı gerekir. Yeni toplama başlatılmadı ve tam A-only devam hazır ilan edilmedi.
- Son kontroller: `npm test` 39/39, lint, typecheck, build ve dört JSON `data:check` başarılı. `test:db` bağlantı reddi nedeniyle başarısız; yeni SQL migrasyonu ve import sürüm regresyon testi gerçek PostgreSQL'de doğrulanmadı. Multiplayer Socket.IO testleri otomatik pakette geçti; çalışan harici süreçler yeniden başlatılmadı.
