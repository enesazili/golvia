# Futbol verisi — kapsam, kaynak ve import

`football.seed.json`, 1 Kasım 2026 tarihinde kontrol edilmiş küçük ve **kısmi** bir başlangıç veri kümesidir. 10 varlık (4 futbolcu, 2 kulüp, 2 ülke, 2 A millî takım) ve 9 kariyer bağlantısı içerir. Futbolcuların tüm kulüplerini kapsadığı iddia edilmez. Bilinmeyen bağ doğrulanmış kabul edilmez; arayüz bunu açıkça belirtir.

## Kaynaklar ve yeniden kullanım

Yeniden kullanılan yapılandırılmış bilgi: **Wikidata CC0**. [Resmî lisans politikası](https://www.wikidata.org/wiki/Wikidata:Licensing) yapılandırılmış ana ad alanı verisini CC0 olarak yayımlar; diğer ad alanlarındaki metinler aynı lisansa sahip değildir. Seed içindeki bütün Wikidata kaynakları erişim tarihi ve `oldid` revizyonuyla sabitlenmiştir. Adlar, doğum tarihleri ve seçili P54 takım ilişkileri bu kayıtlardan kontrol edildi; bütün Wikidata ifadeleri topluca güvenilir kabul edilmedi.

Resmî kulüp, UEFA ve FIFA sayfaları **yalnızca çapraz doğrulama referansıdır** (`reference-only`). Bu sitelerin yazıları, fotoğrafları, logoları ve veritabanları için yeniden dağıtım izni varsayılmadı; hiçbir makale/fotoğraf/logo kopyalanmadı. UEFA'nın kaynak sayfasında hakların saklı olduğu ve markalarının korunduğu belirtilir. Seed'in yapısal verisinin CC0 kökeni ile kontrol bağlantıları ayrı tutulur.

| Futbolcu / sabit ID | İçe aktarılan bağlantılar | Resmî kontrol kaynakları |
|---|---|---|
| Cristiano Ronaldo / Q11571 | Real Madrid (2009–2018), Portekiz A millî takım | [Real Madrid](https://www.realmadrid.com/en-US/the-club/history/football-legends/cristiano-ronaldo-dos-santos-aveiro/), [FIFA](https://inside.fifa.com/news/cristiano-the-extraordinary-centurion) |
| Lionel Messi / Q615 | Barcelona (2004–2021), Arjantin A millî takım | [Barcelona](https://www.fcbarcelona.com/en/ficha/2214377/leo-messi), [FIFA 2022 finali](https://www.fifa.com/es/articles/argentina-le-gano-por-penales-a-francia-y-se-consagro-campeon-del-mundo) |
| Luís Figo / Q483145 | Barcelona (1995–2000), Real Madrid, Portekiz A millî takım | [UEFA kariyer özeti](https://www.uefa.com/uefachampionsleague/news/0253-0d0407b3a177-5873da9acc34-1000--ambassador-luis-figo/), [FIFA EURO 2004 maç olayı](https://inside.fifa.com/news/cristiano-the-extraordinary-centurion) |
| Ángel Di María / Q251683 | Real Madrid (2010–2014), Arjantin A millî takım | [Real Madrid](https://www.realmadrid.com/en-US/the-club/history/football-legends/angel-di-maria), [FIFA 2022 finali](https://www.fifa.com/es/articles/argentina-le-gano-por-penales-a-francia-y-se-consagro-campeon-del-mundo) |

Doğum tarihleri Wikidata P569; alternatif isimler Wikidata isim/alias alanları ve bunların aksansız arama biçimleridir. Türkçe ülke/temsil takımı etiketleri yerel sunum etiketleridir. Mevcut ID'ler Wikidata Q kimlikleridir; şema başka sağlayıcılardan `provider:stable-id` biçimini de destekler. İsimler benzersiz değildir. Aynı isimli futbolcular doğum tarihi + ID ile önerilerde ayrılır.

## Bağlantının anlamı

- Kulüp: oyuncunun **A takımda fiilen sahaya çıktığı** doğrulanmış takım. Kadroya yazılma, sözleşme, transfer söylentisi veya yedek kulübesinde bulunma tek başına yeterli değildir. Bu başlangıç kümesi erkek A takımlarını kapsar.
- Millî takım: ülkeyi temsil eden **A millî takımda fiilî maç temsili**. Vatandaşlık, doğum yeri, uygunluk, genç millî takım ve olimpik/U23 temsil tek başına yeterli değildir.
- `football_entity.kind = national_team` ayrı bir varlıktır; ülkeye `country_id` ile bağlanır. `level=senior` gerekir. Genç takımlar modele eklenebilir, ancak oyun bağlantısı üretmez.
- Kariyerde `verified=true` ve `appeared=true` birlikte gerekir. SQL `football_link` görünümü bu filtreyi uygular; isim eşleştirmesi veya vatandaşlık bağı yoktur.
- Eski kulüpler ve farklı dönemler kabul edilir; iki bağlantının aynı yıllarda olması gerekmez. Kiralık oynama da aynı doğrulama koşuluyla kabul edilebilir. Altyapı, rezerv takım ve teknik direktörlük bağlantıları mevcut oyun kapsamına girmez.
- Tam dönem bilinmiyorsa tarih alanları boş bırakılır. `fromYear/toYear` yıl hassasiyetindedir; sahte gün/ay üretilmez. Güncel toplam maç/gol sayısı saklanmaz.
- Ortak futbolcusu olmayan çift motor tarafından iptal edilmez. Eksik veri nedeniyle gerçek dünyada mümkün olan ama veri kümesinde bulunmayan bir bağlantı kabul edilmez; bunu gidermek için yeni kaynaklı veri gerekir.

## Şema ve arama

`football_source` kaynak/lisans/erişim tarihi; `football_entity` kimlik/tür/ad/ülke/doğum tarihi/seviye; `football_alias` orijinal ve normalize ad; `football_career` dönem/oynama/doğrulama/kaynak/kanıt; `football_dataset` son import sürümü.

Arama Unicode NFD + Türkçe küçük harf + aksan kaldırma + ı/i normalizasyonu kullanır. SQL değerleri parametrelenir; `%`, `_` ve ters eğik çizgi literal olarak kaçırılır. Alias üzerinden alt dize araması, `pg_trgm` GIN indeksi ve 20 sonuç sınırı vardır; prefix indeksi de hazırdır. Kısa sorgu/small dataset için PostgreSQL sıralı tarama seçebilir. Gelecekte büyük veri üzerinde EXPLAIN/performans ölçümü gerekir.

Maç oluşturulurken repeatable-read transaction ile katalog snapshot'ı alınır; doğru cevap bağlantıları tarayıcıya gönderilmez. Geliştirmede PostgreSQL bağlantısı reddedilirse sunucu yalnız yerel, incelemeli football.reviewed.json dosyasını salt okunur yedek olarak kullanır; üretimde bağlantı hatası güvenli biçimde isteği başarısız kılar. Doğrulanmamış adaylar oyuna alınmaz.

## Yeni veri içe aktarma

```powershell
npm run db:migrate
npm run db:import -- D:\golvia\data\football.reviewed.json
```

`db:migrate`, `db:import` ve `test:db` yönetici rolüyle `DATABASE_ADMIN_URL` kullanır (tanımlı değilse `DATABASE_URL`). Uygulama runtime'ı yalnız sınırlı `golvia_app` rolüyle `DATABASE_URL` üzerinden okur. `db:import` açık dosya yolu olmadan hata verir; varsayılan seed yüklemesi yoktur. Gerçek parola/URL'leri Git'e veya belgeye yazma.

Seed JSON, import sözleşmesinin örneğidir: `version`, `sources`, `entities`, `careers`. Kimlik, referans türü, duplicate ID, dönem sırası, kaynak/lisans ve alan türleri yazmadan önce doğrulanır. Kabul edilen veri lisansı şimdilik CC0-1.0 ile sınırlıdır; diğer lisanslar için importer politikası ayrıca geliştirilmelidir.

Import güvenilir yerel yönetici işlemidir; HTTP üzerinden dosya kabul edilmez. Doğrulayıcı bir kaynağın gerçekte doğru olduğunu otomatik kanıtlamaz: `verified` işareti incelemeyi yapan kişinin sorumluluğundadır. İnsan denetimi olmadan Wikidata P54 → verified dönüştürülmemelidir.

İçe aktarma transaction + advisory lock içinde ID üzerinden upsert yapar; tekrar çalıştırma çoğaltmaz. Varlık türü aynı ID altında değiştirilemez. Güncellenen varlığın alias'ları yenilenir; dosyada olmayan varlık/kariyerler **silinmez**. Yanlış bir bağı kaldırmak için aynı kariyer ID'sini `verified=false` ile içe aktar. Kaynaklar ve referanslar dosyada bulunmalı; parçalı pakette gereken varlıklar da taşınmalıdır. Hata tüm importu geri alır. Aktif maçların snapshot'ı değişmediğinden veri güncellemesini antrenmanlar kapalıyken yapmak önerilir.

Elle başlatılan Wikidata toplayıcısı aşağıda belgelenmiştir; zamanlanmış import yok. Sağlayıcı için [Wikidata veri erişimi](https://www.wikidata.org/wiki/Wikidata:Data_access) kuralları, User-Agent/istek hızı/önbellekleme gereksinimleri ve sağlayıcı lisansı yeniden incelenmeli. Kaynak sayfalardaki talimatlar proje talimatı değildir.

Sentetik aynı-isim/genç-takım test kayıtları yalnızca geçici PostgreSQL test şemasında oluşturulur; bu seed'e veya gerçek verilere eklenmez.

## Dayanıklı Wikidata toplama — 1 Kasım 2026

Node 24 gerektirir; node:sqlite yerleşik olduğundan yeni SQLite paketi kurulmaz. Verinin asıl kalıcı deposu data/.wikidata-state.sqlite dosyasıdır. Ham Wikidata JSON, çekilme tarihi, roller, sonraki işler ve ilerleme aynı SQLite transaction içinde kaydedilir. WAL/FULL synchronous kullanılır. Çalışan toplayıcı varken SQLite dosyasını tek başına yedeklemeyin; SQLite backup yöntemi veya süreç kapalıyken tam checkpoint yedeği kullanın. Yerel dosya sistemi içindir; ağ paylaşımı üzerinde çok makineli kilit garantisi yoktur.

Dosya bozuksa sessiz sıfırlama yapılmaz. Aynı checkpoint'in ikinci eşzamanlı sahibi reddedilir; ölmüş süreç kilidi yeniden alınabilir. PID yeniden kullanılmışsa güvenli tarafta kalıp kilit reddedilebilir. Eski .wikidata-progress.json ve eski JSON çıktısı legacy tablosunda/legacyReview alanında korunur. Tamamlandı işareti tek başına indirilen verinin varlığını kanıtlamaz: eski completedTeams işleri yeniden kuyruğa alınır. Önceden yalnızca RAM'de olup kaybolmuş veriyi yerelden geri getirmek mümkün değildir.

JSON çıktısı geçici dosyaya yazılıp fsync/rename ile değiştirilir. İlerleme ve veri checkpoint'te olduğundan dışa aktarım başarısız olursa aynı komut veya --offline ile ağ kullanmadan tekrar üretilebilir. Önceki başarılı JSON yazma hatasında korunur. İş bitene kadar checkpoint'i silmeyin.

### Çalıştırma

Canlı kullanımda WIKIDATA_USER_AGENT ortam değişkeninde gerçek iletişim gerekir. GolviaBot/1.0 (contact@example.com) yalnızca belge örneğidir; kod bunu reddeder. Kullanıcı gerçek iletişim adresini sağladı; mevcut çalışmada veri toplama duraklatıldı. data:fetch .env dosyasını otomatik okumaz; PowerShell ortam değişkenini veya Node --env-file seçeneğini açıkça kullanın.

Ağ kullanmadan checkpoint dışa aktarımı:

    npm.cmd run data:fetch -- --offline
    npm.cmd run data:check -- data/football-wikidata.json

Gerçek iletişim yapılandırıldıktan sonra sınırlı çalışma ve devam:

    npm.cmd run data:fetch -- --max-tasks 50
    npm.cmd run data:fetch -- --max-tasks 50

Açık hedef seçenekleri --players Q11571,Q615 ve --teams Q8682; alternatif çalışma dosyaları --checkpoint data/another.sqlite --out data/another.json. Bunlar mevcut checkpoint'teki bekleyen işleri temizlemez; yalnızca iş ekler. Tamamlanan işler yeniden indirilmez; aynı varlığın ilk indirilen revizyonu sabit tutulur. Güncel veri yenilemesi için yeni checkpoint/çıktı kullanıp kontrollü inceleme gerekir. Varsayılan 50, en fazla 10000 iş; varsayılanlar seed dosyasını ezmez.

Ctrl+C bir devam eden isteği iptal eder; commit edilmiş kayıtlar korunur. Hatalar pending kalır, o çalıştırmada bir iş bir kez ele alınır; sonraki çalıştırmada tekrar denenir. Kalıcı hatalarda sıfır sonuç gibi davranılmaz. complete yalnızca yapılandırılmış işler bitti demektir; tüm dünya futbol verisinin eksiksizliği demek değildir.

### Kapsam, hız ve doğruluk

- Mesleği futbolcu olan insanlar, futbol kulüpleri ve millî takımlar Q1…Q9 kimlik önekleriyle keşfedilir; takımların tüm P54 üyeleri ayrıca taranır. Vatandaşlık, faal olma veya A millî takım üyeliği önkoşulu yoktur. Eksik Wikidata occupation/P31/P54 kayıtları kapsam dışında kalabilir.
- 100 kayıtlık sıralı cursor sayfaları, tek eşzamanlı istek, en az 2,5 saniye aralık, 45 saniye timeout ve ilk istekten sonra dört tekrar sınırı vardır. 429 Retry-After gözetilir; geçici 408/5xx/ağ hataları artan gecikmeyle denenir. Büyük SPARQL sorguları yine timeout olabilir; canlı ölçek performansı henüz ölçülmedi.
- Profesyonel kulüp için yalnızca genel football club sınıfı yeterli değildir. İncelenmiş seed veya açık football + professional sports + representation team sınıfları gerekir. Genel national team sınıfı A takım kanıtı değildir; genç/rezerv/altyapı ve belirsiz takımlar ayrı review kayıtlarında tutulur. İsimler yalnızca şüphe/eleme işaretidir.
- P54 her durumda aday üyelik oluşturur: appeared=false ve verified=false. Bunlar oynanmadı anlamına gelmez; doğrulanmadı anlamına gelir. Oyuna kabul için ayrıca resmî fiilî oynama kanıtı gerekir.
- Kariyer ID'si Wikidata statement GUID'sinden gelir; aynı takımın farklı dönemleri birleştirilmez. GUID yoksa içeriğin hash'i kullanılır. Başlangıç/bitiş yıl hassasiyeti uygunsa çıkarılır; eksik/çoklu tarihler uydurulmaz. Ham qualifiers, kaynak references, rank ve statementId provenance içinde korunur; kiralık durumu unreviewed kalır.
- TR/EN etiket ve alias, P1449 lakap ve P1813 kısa adlar saklanır. Kimlik ad değil Q-ID'dir. Türkçe normalizasyon mevcut parametrik PostgreSQL aramasındadır.
- Kaynaklar revizyon URL'si + erişim tarihi + CC0-1.0 lisansı taşır. Wikidata kaynak bağlantısının bulunması tek başına doğruluk kanıtı sayılmaz.

### Oyuna import ve sınırlar

origin=wikidata-candidates çıktısı mevcut Dataset alanlarını korur, review/counts/collection ekler. Importer adayların verified/appeared iddiasını reddeder; mevcut kaynak/varlık/kariyerleri ezmez, alias ekleyebilir. İçe aktarılabilir adayların provenance bilgisi PostgreSQL jsonb alanında saklanır. Altyapı/rezerv/belirsiz kayıtlar çalışma kataloğuna zorla çevrilmez, checkpoint ve JSON review içinde kalır. Eski güvenilir seed formatı desteklenir.

    npm.cmd run db:migrate
    npm.cmd run db:import -- data/football-wikidata.json

Bu komut toplama sırasında otomatik çalıştırılmaz. Oyun her cevap için Wikidata'ya bağlanmaz; maç kendi katalog snapshot'ını kullanır. Import transaction/advisory lock içinde yapılır; büyük import yine PostgreSQL kaynaklarını tüketir, bakım saatinde çalıştırılmalıdır. Büyük ölçek import yükü ve tam JSON dışa aktarımının bellek kullanımı henüz ölçülmedi.

Mevcut doğrulanmış seed: 4 futbolcu, 2 kulüp, 2 A millî takım, 9 kariyer; 9 doğrulanmış / 0 doğrulanmamış. Yeni offline çıktı: tüm veri sayıları 0, 27 keşif işi bekliyor. Toplama tamamlanmadı; seed değiştirilmedi.

Resmî politika kaynakları: [Wikidata veri erişimi ve CC0](https://www.wikidata.org/wiki/Wikidata:Data_access), [Wikimedia User-Agent politikası](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy), [WDQS kullanım ve sınırlar](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual).


Güncel canlı çalışma incelemesi: ilk 50 işte 23 oyuncu ve 41 P54 adayı kaydedilmiş, takım varlığı sıfır. FIFO sıradaki 1760 takım işi oyuncu keşiflerinin gerisinde kalmıştı; takım/ülke işleri önceliklendirildi. `--offline` ile mevcut 50 iş tekrar indirilmeden yeniden dışa aktarılır. İlk ağsız sayı değişmez; ancak yeni küçük canlı çalışma, takım varlıklarını önce çekerek farkı ölçebilir. Gerçek WIKIDATA_USER_AGENT bu ortamda henüz yoktur; önceki kullanıcı kararı gereği örnek adres kullanılamaz. Ayrıntılı 10 ID ve sınırlar PROJECT_CONTEXT.md sonundadır.

1 Kasım 2026 güncellemesi: Gerçek iletişim adresi kullanıcı tarafından sağlandı ve yalnız süreç ortam değişkeniyle kullanıldı. `data/football.reviewed.json` doğrulanmış eklemeleri taşır; seed ayrı korunur. Kulüp adayları `level=unknown` ile PostgreSQL'de tutulur, oyunda önerilmez ve P54 tek başına doğru cevap değildir. Aday/verifiye ayrımı `seniorClubs`, `clubCandidates`, `verified` alanlarında izlenir. Canlı büyük kuyruk ve kaynaklı oynama kanıtlarının insan incelemesi devam eder; tam dünya futbol kapsamı iddia edilmez.

2 Kasım 2026: Toplama kullanıcı isteğiyle duraklatıldı; yeni ağ isteği yok. P54 oyuncu hedefleri yalnız takım entity işine eklenir, A katalog kulüpleri members taraması açar. Oynanabilir kariyerler ayrı maç inceleme kaynağı gerektirir. PostgreSQL kapalıyken sunucu yalnız football.reviewed.json içindeki 15 doğrulanmış bağı kullanır. Ana/curated/top100 checkpoint ve JSON dosyaları değiştirilmedi. PostgreSQL tekrar açıldığında aday ve incelemeli importlar ile test:db çalıştırılmalıdır.

2 Kasım 2026 havuz genişletmesi: Toplama/checkpoint/ham aday JSON değiştirilmedi. `football.reviewed.json` 24 senior kulüp, 28 kayıtlı oyuncu ve 72 doğrulanmış kariyer bağı içerir; bunların 26 oyuncu/66 kulüp bağı 45 cevaplı kulüp çifti oluşturur. Yeni bağlar UEFA'nın resmî [2022/23 Şampiyonlar Ligi istatistik el kitabındaki](https://editorial.uefa.com/resources/0282-184079e97393-127f15886394-1000/ucl_202223_facts_md13.pdf) pozitif kulüp maç sayılarına, Ronaldo/Sporting bağı ayrıca [2026 UEFA kulüp katılım listesine](https://www.uefa.com/uefachampionsleague/news/0257-0e9a0f70e31c-e6f6d51eef60-1000--most-uefa-club-appearances/) dayanır. Her bağ `evidenceId`, aday kariyer ID'si ve inceleme gerekçesi taşır. Kaynak içeriği yeniden dağıtılmaz (`reference-only`). 1.965 aday çift henüz onaylanmadı. PostgreSQL kapalıyken dosya tabanlı kaynak güncel havuzu sağlar; açık veritabanında yeni paket ayrıca import edilmelidir.

