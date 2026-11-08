# Futbol verisi — kapsam, kaynak ve import

## Wikidata görünüm verisi — Golvia 1.4.1 (8 Kasım 2026)

- Durum: canlı kaynak izni `cleared` (yalnız izole doğrulama DB'sinde `setSourceClearance` ile). Sürüm 1.4.1; canlı PostgreSQL'e yazılmadı, commit/push/deploy yapılmadı. Transfermarkt adayları hâlâ `unresolved` ve oynanabilir değil.
- Kaynak: [Wikidata](https://www.wikidata.org/), yapısal veri **CC0-1.0**, erişim 2026-11-08, kaynak kimliği `wd-appearances-2026-11-08-v1`. Yalnız **P54 (member of sports team)** üzerinde **P1350 (number of matches played) ≥ 1** olan üyelikler maç kanıtıdır; P54 tek başına üyelik/yurttaşlık kanıtı değildir.
- Dosyalar: `data/football-wikidata-appearances.json` (üretilen dataset, ~18 MB, Git dışı), `.local/wikidata-appearances/raw.json` (ham snapshot, Git dışı). Üretim: `npx tsx scripts/wikidata-appearances.ts --offline`; canlı toplama için gerçek iletişim içeren `WIKIDATA_USER_AGENT` gerekir ve yalnız ayrı checkpoint yetkisiyle çalıştırılır.
- Kapsam: A Top 100 kataloğu + 12 öncelikli kulüp + 18 A millî takımı, 24 ülke eşlemesi. Oyuncu yalnız en az **2** hedef seçimde görünüyorsa tutulur; 12.290 oyuncu, 32.927 kariyer, 112 kulüp, 18 A millî takımı, 130 seçim.
- Kanıt/provenance: `basis=wikidata-p1350-appearances`, `appearances`, `statementIds`, `retrieved`, `teamKind`, `teamLevel=senior`, `license=CC0-1.0`. Aynı oyuncu/takım dönemleri birleştirilir; ters veya 1880–2027 dışı yıllar yıl uydurulmadan boş bırakılır. 2012 sonrası doğum tarihleri upstream hatası sayılıp oyuncu düşürülür.
- Import: mevcut import hattı `wikidata-appearances` origin'ini tanır, eklemelidir ve idempotenttir. Kaynak import sırasında zorunlu `unresolved` olur; `football_link` değişmez. Oyun açımı yalnız `scripts/football-publish.ts grant` / `setSourceClearance` ile yapılır. Reviewed çiftler ve doğrulanmış kariyerler ezilmez; youth/transfer-only kayıtlar ayrı tutulur.
- İzole doğrulama: kapı öncesi 187 link, grant sonrası 33.114 link (Schalke dahil), 12.326 oyuncu, 131 seçim. Katalog içi oyun havuzu 130 seçim / 33.110 kariyer; 8.385 takım çiftinin 4.949'u ortak futbolcu içeriyor.

## Transfermarkt adayları — Golvia 1.4.0 (8 Kasım 2026)

- Durum: aday-only. Sürüm 1.4.0; canlı PostgreSQL'e yazılmadı, commit/push/deploy yapılmadı. Transfermarkt site koşulları canlı kullanım için hukuk onayı bekliyor.
- Kaynak: [dcaribou/transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets), depo lisansı **CC0-1.0**. Veri seti 6 Temmuz 2026'da donduruldu; güncelleme akışı devam etmiyor. Toplama hattı durduğu için 2026/27 kadroları ve sonrası yoktur.
- Dosya: `.local/tm/tm.duckdb` (Git dışı, ~55 MB). R2 CDN bu ağda engellendiği için aynı tablolar [HuggingFace aynasından](https://huggingface.co/datasets/ngeorgea/transfermarkt-player-scores) (CC0-1.0) indirilip yerel DuckDB'ye yüklendi. İndirme/oluşturma ağdan bağımsız yeniden yapılabilir; büyük dosyalar Git'e eklenmez.
- Lisans notu: CC0 depo derlemesi için geçerlidir; Transfermarkt sitesinin kendi kullanım koşulları ayrıdır. Bu nedenle veri **aday** olarak tutulur. Lisans/izin durumu `football_source_clearance` tablosunda tutulur; aday kaynak import sırasında zorunlu `unresolved` olur ve yalnız `setSourceClearance` ile temizlenebilir.
- Kapsam: TR1 (Süper Lig), IT1 (Serie A), GB1, ES1, DE1, FR1, NL1, PO1, BE1 ligleri + CL/EL'de oynamış ek kulüpler + A millî turnuvalar (Dünya Kupası, EURO, AFCON, Asya Kupası, Copa América). **TR2/TR3 ve Serie B bu veri setinde hiç yoktur** (games 2012-08 – 2026-05). Tarihî kariyerler 2012 öncesine uzanmaz.
- Kanıt kuralı: yalnız `appearances` satırları maç oynama kanıtıdır. Transfer kayıtları `football_transfer` tablosunda ayrı tutulur ve **tek başına A takım maçı kanıtı sayılmaz**. Üretilen her kariyer `appeared=true, verified=false` olur; provenance ilk/son maç, maç/gol/asist/dakika, turnuva listesi, `teamKind/teamLevel` ve kurtarılmış kulüp işaretini taşır. Sonuç: 23.641 yeni varlık (22.698 oyuncu, 781 kulüp, 120 ülke, 42 A millî takım), 44.081 kariyerin tamamı appearance-supported (transfer-only 0, ambiguous 0); 43.149 kulüp + 932 A millî takım; senior 44.081, youth/unknown 0.
- Eksik kulüpler: geniş taramada 624 bilinmeyen kimlik / 8.035 satır vardı. Kapsam içindeki 37 kulüp / 2.369 satır / 416 kariyer yalnız aynı `games.home_club_name/away_club_name` değerlerinden kurtarılır (`recoveredClub=true`, seviye senior; ülke uydurulmaz). Kapsam dışındaki 587 kulüp / 5.666 satır atlanır; kapsam içi çözülmemiş 0.
- Kimlik: Transfermarkt anahtarları `tm:player:`, `tm:club:`, `tm:nt:`, `tm:country:` önekidir. Mevcut Wikidata/PostgreSQL kimlikleri yalnız kesin kurallarla eşlenir: oyuncuda normalize ad/alias + aynı doğum tarihi; kulüpte tam normalize ad veya reviewed alias (bilinen ülkeler çelişirse eşleşmez); ülkede açık Türkçe→İngilizce etiket haritası; millî takımda aynı ülke. Sonuç: 98/98 confirmed (38 oyuncu, 52 kulüp, 4 ülke, 4 A millî takım), 98/98 denetim geçti. 4 elle incelenmiş kulüp eşlemesi `data/identity-aliases.json` içindedir: `1041→Q704 Lyon`, `964→Q29108 Zenit`, `18544→Q482764 Al-Nassr`, `1114→Q73965 Al-Hilal`. Şüpheli eşleşmeler `quality.json` pending kuyruğuna gider (5 oyuncu: 4× Rafinha, Diego Costa; aynı ad/farklı doğum tarihi) ve birleştirilmez. Yinelenen oyuncu grubu 1 (João Ricciulli, iki TM ID; aynı ad/doğum tarihi, kapsam içi kariyer yok) kanonik kanıt yokluğuyla ayrı tutulur; kulüp 0.
- Komutlar: `npm run data:transfermarkt -- --duckdb .local/tm/tm.duckdb --aliases data/identity-aliases.json` (çıktı Git dışı). Kalite raporu varsayılan `data/football-transfermarkt.quality.json`, katalog `data/club-catalog.top100.json`; `--report`/`--catalog` ile değiştirilir. Kimlikleri canlıya bağlanmadan mevcut PostgreSQL'den okumak için `--identities-db "$DATABASE_URL"` (yalnız SELECT) veya varsayılan `--identities data/football.reviewed.json` kullanılır. `DATABASE_ADMIN_URL=... npm run db:migrate`, `npm run db:import -- data/football.reviewed.json` sonra `npm run db:import -- data/football-transfermarkt.json`.
- Import ve oyun etkisi: aday import `football_dataset` sürümünü ve `football_link` oyun bağlarını değiştirmez; reviewed/verified satırı ezmez. `football_link` yalnız `football_source_clearance.status='cleared'` + `verified && appeared` satırlarını birleştirir; repository kataloğu yalnız bu bağı olan oyuncuları cevap havuzuna alır. Aynı dosyanın yeniden importu idempotenttir; tekrarlı import satır çoğaltmaz. Yeni bir aday revizyonu, `verified=false` ve `football_review` kaydı olmayan aday kariyer/transfer satırlarını güncelleyebilir; reviewed satırlar ve `tm:` dışı oyun bağları korunur. Temiz bir revizyon için yeni/boş aday DB'si önerilir (silinmeyen eski `tm:` entity'leri kalabilir).
- Kontrollü yayın: `npm run data:publish -- status [--source <id>]`; `grant --source <id> --basis <metin> --evidence <metin> --by <inceleyen>`; `publish --source <id> --by <inceleyen>`; `revert --batch <id> --by <inceleyen>`. `publish` yalnız temizlenmiş kaynak + `football_review.status='approved'` adayları doğrular ve `football_publish_batch` kaydı üretir; `revert` partiyi geri alır. İzin vermeyen komut yoktur.
- Oyun kapsamı (`npm run data:coverage`, salt okunur): canlı 55 seçim (51 kulüp + 4 A millî takım), 51 oyuncu, 183 kariyer; 1.485 çiftin 233'ü ortak futbolcu içeriyor, 1.252'si içermiyor. Aday 95 seçim (49 kulüp + 46 ülke), 6.081 oyuncu, 8.753 kariyer; 4.465 çiftin 1.468'i ortak, 2.997'si ortak değil; aday `playable=0`. Reviewed havuzun tamamı 187 kariyer/56 seçim; 4 Schalke kariyeri top-100 dışında olduğu için oyun kapsamına girmiyor.
- A Top 100: reviewed kimliği olan 51 kulübün **51'i** eşleşti; kalan 49 kulübün reviewed kimliği yok. `football_review` kuyruğu yalnız `wd-statement-` adaylarını işler; `tm-career:` adayları için inceleme ekranı henüz yok.

## Phase 9 maç kanıtı pilotu — 4 Kasım 2026

`football.match-proofs.json` dokuz **elle incelenmiş** resmî kaynak referansı taşır. Her kayıt sabit oyuncu/kulüp/P54 statement ID'si, ad ve doğum tarihi, kaynak URL'si, kontrol günü, pozitif maç sayısı veya tamamlanmış maçtaki gol/oyuna giriş/çıkış olayı ve Türkçe gerekçe içerir. Kaynak metinleri kopyalanmaz. `identityUrl` ayrı kimlik kontrolü olarak provenance'a yazılır; yeni onaylar ayrıca en az 40 karakterlik `sourceNote` ve `identityNote` taşımak zorundadır. PSV'nin Bruma profili, aynı adlı Jeffrey Bruma ile karışmayı önler.

`npm.cmd run data:evidence` salt okunur önizleme, `npm.cmd run data:evidence -- --apply` atomik reviewed JSON güncellemesidir. Kod P54 adayını, A katalog ID'sini, oyuncu ad/doğum tarihini, kulüp adını, resmî kaynak HTTPS alan adını ve pozitif A takım maç olayını denetler; belirsiz/altyapı/rezerv kayıtları reddeder. Çalışma **ağ isteği yapmaz**. Kaynak sayfasının maç içeriğini makineyle doğruladığını iddia etmez: insan kanıt kontrolü ve resmî alan adı ekleme kod incelemesi şarttır. İzinli/ruhsatlı API olmadan UEFA ve benzeri sitelerden otomatik içerik taranmaz. Kaynağın sonradan değişmesi veya silinmesi hâlâ risktir.

Kanonik akış artık PostgreSQL kararlarıdır: `npm.cmd run data:review:export` DB ile JSON'u karşılaştırır, incelenmemiş farkları çakışma olarak reddeder; `-- --apply` yalnız değişiklik varsa yedek alıp sürümü artırır ve SHA-256 checksum basar. `npm.cmd run data:review:integrity` kanıtlı `unknown` kulüp seviyesini onarır, kimlik kanıtı eksik eski kayıtları `pending` incelemeye alır ve onaylı ama oynanabilir olmayan bağları raporlar. 25 adaylık pilot girdisi `football.review-pilot.json`, kanıtları `football.match-proofs.json` dosyasındadır; `npm.cmd run data:review:pilot` `.local` snapshot'ı veya gömülü kanıt kullanmaz.

Staging'e aktarım öncesi `npm.cmd run db:backup -- --restore-test` ile yedek/izole geri yükleme, ardından `npm.cmd run db:import -- data/football.reviewed.json` kullanıldı. 4 Kasım 2026 Phase 9.1 sonucu: reviewed v7, DB ve JSON eşit; 187 doğrulanmış bağ, 219 A kulüp çifti, 2 onay / 23 bekletme / 4 yeniden inceleme. RB Leipzig kanıtlı biçimde `senior` yapıldı; toplu seviye değişikliği yapılmadı. Canlı Render DB'ye import yapılmadı.

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

### Phase 7 incelemeli veri — 4 Kasım 2026

`football.reviewed.json` v4: 50 oyuncu, 50 senior kulüp, 4 ülke, 4 A millî takım, 178 `verified && appeared` kariyer. Bunların 172'si kulüp bağıdır; 49 oyuncu en az bir kulüpte kanıtlıdır. A Top 100 içinden 49 kulüp ve 203 cevaplı çift, tüm incelenmiş kulüpler arasında 207 çift vardır. Schalke katalog dışı referans kulüptür. Kaynaklar UEFA resmî maç/katılım kayıtları ile National Football Teams pozitif senior lig maç sayılarını içerir; URL ve erişim tarihi `sources`, bağ başına gerekçe `provenance` alanındadır. P54 yalnız aday keşfine yarar. Yedek/rezerv, genç ve sıfır maç satırları onaylanmaz. Ham üç aday JSON ve SQLite checkpoint değiştirilmedi.

`npm run data:opportunities` salt okunur yerel paketlerden doğrulanmamış A kulüp adaylarını olası yeni çift etkisine göre sıralar. 1.887 farklı aday oyuncu–takım çifti kanıtsızdır; sıralama doğrulama değildir. A kataloğunun 100 benzersiz ID'si önbellekte futbol kulübü P31'i ve ad/etiket filtresinden geçti; bu otomatik kontrol 100 kimliğin bağımsız tek tek teyidi değildir. Belirsiz kimlik veya oynama bağı oyun verisine alınmaz. Canlı veritabanına aktarım yapılmadı.

### Phase 8 A grubu toplaması — 4 Kasım 2026

Yeni, bağımsız `data/.wikidata-top100-a.sqlite` checkpoint'i eski Top100 checkpoint'indeki tamamlanmış sayfaları ve üç yerel önbellekteki varlıkları tekrar indirmeden kullanır. Genel `discover` kuyruğu taşınmaz. `data/football-top100-a.json` ham aday çıktısıdır; bu iki dosya Git dışıdır. Dört canlı partide 185 iş denendi; ayrıca 23 iş önbellekten tamamlandı (gerçek HTTP sayısı ayrıca ölçülmedi). Son durumda 3.322 işten 1.318 tamam, 2.004 bekleyen, 0 başarısız; 14 A kulüpte en az bir sayfa işlendi, tam biten kulüp yok. 1.019 oyuncu, 158 kulüp, 7.003 P54 adayı bulundu; çözümlenmiş 1.823 aday bağın tamamı `verified=false, appeared=false`. 5.419 inceleme kaydı eksik/sınıflandırılmamış referansları da içerir. Bu sayılar tamamlanmış koleksiyon değildir.

Staging PostgreSQL'e aday paket iki kez transaction içinde import edildi; 1.025 toplam oyuncu, 168 kulüp, 2.001 kariyer (178 kanıtlı, 1.823 aday) ve 4 ayrı import checksum'u var. Veritabanı boyutu 15.341.235 bayt. İzole yedek geri yükleme 1.230 varlık, 2.001 kariyer ve 178 oyun bağını eşledi. Oyun yalnız kanıtlı bağı kullanır. Top100 JSON oyunda A kulüp izin listesi, PostgreSQL futbol kayıtlarının asıl kaynağıdır. Referans kulüpler ve kanıtsız adaylar oyun önerisi değildir. P54 üyeliği, kadro kaydı veya vatandaşlık resmî A takım maçı kanıtı sayılmaz. `football_import_batch` ayrı veri sürümlerinin import geçmişini tutar.

Devam: gerçek iletişim içeren `WIKIDATA_USER_AGENT` yalnız süreç ortamında ayarlanır; ardından `npm.cmd run data:fetch -- --mode top100 --max-tasks 100 --concurrency 2`. `--max-tasks` 0–10.000, eşzamanlılık 1–3 arasıdır. Aynı komut aynı checkpoint'ten devam eder; her iş SQLite transaction'ında saklanır, dışa aktarım atomiktir. `--progress` kulüp bazlı sayfaları gösterir; `--offline --max-tasks 0` yalnız yeniden dışa aktarır. Her yeni aday çıktıdan sonra `data:check` ve staging `db:import -- data/football-top100-a.json` çalıştırılır. Gerçek oynama kanıtı bulunmayan bağı incelenmiş pakete taşıma.

Wikimedia'nın [User-Agent politikasına](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy) ve [WDQS sorgu sınırlarına](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual) göre 2,5 saniyelik ortak istek aralığı, en fazla 3 çalışan, 429 `Retry-After` ve artan geri çekilme kullanılır. Top100 ID denetiminde 94 ad/alias doğrudan eşleşti; 6 ad varyasyonu (Q478167, Q670186, Q73965, Q503321, Q286191, Q17497) ayrıca incelendi. Resmî kulüp siteleri ilk beşinden dördünü ve Dinamo Moskova'yı destekledi; Q286191'in resmî sitesi otomatik okunamadığından bağımsız kimlik teyidi açık. Tüm 100 kimlik için tam bağımsız doğrulama iddia edilmez.

