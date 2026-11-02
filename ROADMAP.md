# Golvia — Yol haritası

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
- [ ] Yeniden bağlanma, kopma/hükmen yenilgi ve gecikme politikası.
- [ ] Tek süreç bellek deposunu yayın gereksinimine göre kalıcı/dağıtık oturum deposuyla değiştir; atomik maç sahipliği ve idempotency garantilerini koru.
- [ ] Çoklu worker, ağ gecikmesi, sıra bozulması ve bağlantı testleri.

## Phase 4 · Başlamadı
- [ ] Hesap ve oturum yönetimi, rekabetçi eşleşme.
- [ ] Oyun başına kalıcı/sezonsuz ELO ve lig; genel futbol sıralaması.
- [ ] Profil, istatistikler ve tek seferlik rating transaction işlemleri.

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
