# christien/documentserver

*English summary.* This repository is the source offer (GNU AGPL v3, section 13) for `christien/documentserver:10.0.0-176-csp5`, a rebuild of ONLYOFFICE Document Server 10.0.0.176 by Christien EI. It holds our modifications (patches, build-time hardening for a Content Security Policy without `unsafe-*`, Node 22 runtime), the scripts that build the package and the image, and a manifest pinning every upstream input (exact git commits, sha256 of every downloaded file). Upstream source: the public ONLYOFFICE repositories at tag `v10.0.0.176`. Not affiliated with Ascensio System SIA.

---

Ce dépôt est l'**offre de source** (GNU AGPL v3, article 13) du moteur d'édition `christien/documentserver:10.0.0-176-csp5`. C'est une reconstruction d'ONLYOFFICE Document Server 10.0.0.176 par Christien EI, construite depuis les sources publiques d'ONLYOFFICE.

**Christien EI n'est pas affiliée à Ascensio System SIA.** ONLYOFFICE est une marque d'Ascensio System SIA. Les logos, les mentions de droit d'auteur et les attributions d'Ascensio sont conservés dans l'image, comme l'exigent les conditions additionnelles (article 7) des sources ONLYOFFICE.

## Image concernée

| | |
|---|---|
| Image | `christien/documentserver:10.0.0-176-csp5` |
| Identifiant local | `sha256:db31e7c6c79d22d40341a3ceea8dcc072a804b5c42cbb018a7157a4e62079d0d` |
| Paquet | `christien-documentserver_10.0.0-176_amd64.deb` (sha256 `67d67f130f4acf4cb96c08e24edcdba81abbabc11b73e28ad0ae59d46df94378`) |
| Version amont | ONLYOFFICE `v10.0.0.176` (13 dépôts, même tag) |

## Source correspondante

La source correspondante de l'image comprend trois parties :

1. **La source amont ONLYOFFICE, au tag `v10.0.0.176`** :

   | Dépôt | Commit |
   |---|---|
   | [build_tools](https://github.com/ONLYOFFICE/build_tools) | `8cccb383182f45f5171a7c6d62f49ebf37aab400` |
   | [core](https://github.com/ONLYOFFICE/core) | `76af764fcb777291098c73728044249b6893af6a` |
   | [core-fonts](https://github.com/ONLYOFFICE/core-fonts) | `7030c6681fb5bbed560675cb42422f91df15d5c9` |
   | [dictionaries](https://github.com/ONLYOFFICE/dictionaries) | `d3223bbb777883db66ac3cd249f71c6ebdc992c7` |
   | [document-formats](https://github.com/ONLYOFFICE/document-formats) | `27188bac1f82c6ff0e7f02235cdbca22053a768e` |
   | [document-server-integration](https://github.com/ONLYOFFICE/document-server-integration) | `d57c945a1b971627a35c45709efe7a5167d95199` |
   | [document-server-package](https://github.com/ONLYOFFICE/document-server-package) | `8dc6a813f636d72821be21661d8dd151bf674aa8` |
   | [document-templates](https://github.com/ONLYOFFICE/document-templates) | `0a52fb76fa53fddf7d70da28878537cde3d29421` |
   | [Docker-DocumentServer](https://github.com/ONLYOFFICE/Docker-DocumentServer) | `839b73b568db94d117fdeaf3374f55f78ee9b1db` |
   | [sdkjs](https://github.com/ONLYOFFICE/sdkjs) | `c1a29cc83824661d799711be14ef12b6125302f3` |
   | [sdkjs-forms](https://github.com/ONLYOFFICE/sdkjs-forms) | `0148c8ed3f799136431be49d4d83b4064fbafd01` |
   | [server](https://github.com/ONLYOFFICE/server) | `f9a8df6e7c9aa388c0d525965923c803f4cbc071` |
   | [web-apps](https://github.com/ONLYOFFICE/web-apps) | `493e500c56ec96ccaa0452ab092cbce23b6dcc2e` |

   Les dépendances tierces récupérées par `build_tools` (boost, openssl, v8 8.9, x265, etc.) sont listées dans [`manifest-10.0.0-176-csp5.json`](manifest-10.0.0-176-csp5.json), avec leur commit exact : 187 dépôts au total.

2. **Nos modifications**, dans ce dépôt : voir la section suivante.

3. **Les scripts de construction**, dans ce dépôt : `env/`.

## Ce qui est modifié

| Modification | Fichiers | Effet |
|---|---|---|
| Plus de gestionnaire `onload` en ligne | `env/csp/patches/web-apps-0001-*` | `script-src` n'a pas besoin de `'unsafe-hashes'` |
| Sprite des formats généré avant la copie | `env/csp/patches/web-apps-0002-*` | correctif de l'ordre de build |
| Exécutables serveur empaquetés en Node 22.23.4 | `env/csp4/patches/build_tools-0001-*`, `PKG_TARGET=node22-linuxstatic-x64` | Node 20 et 18 remplacés (CVE-2026-111497) |
| Paquet au nom de Christien | `env/christien/patches/document-server-package-0001-*` | licence copiée à l'identique pour le paquet `christien-documentserver` |
| Dockerfile adapté | `env/csp4/patches-image/Docker-DocumentServer-0001-*` | builder classique, `full-upgrade`, pas de dépôt apt tiers |
| Durcissement CSP, appliqué au build sur la sortie de `build_tools` | `env/csp4/harden/` | voir ci-dessous |
| Minification | `env/minify/minify.js` | terser, à la version du lockfile de web-apps |
| Retrait de surface | `env/christien/prune.txt` | éditeur de macros, plugins, page d'accueil |

Le durcissement (`env/csp4/harden/`) permet aux éditeurs de fonctionner sans `'unsafe-eval'`, `'unsafe-inline'` ni `'wasm-unsafe-eval'` :
- **`templates.js`** : les gabarits underscore sont précompilés en fonctions, il n'y a plus de `new Function` à l'exécution ;
- **`pages.js` et `csp-shim.js`** : les attributs `style` statiques sont renommés, et une cale fait passer les styles par CSSOM ;
- **`code.js`** : les derniers `eval` de web-apps sont remplacés, et le système de plugins est coupé ;
- **`sdkjs.js`** : sdkjs charge ses moteurs asm.js au lieu de WebAssembly.

Les sources amont ne sont pas modifiées par ce durcissement. Il s'applique à la sortie du build, avant la minification.

## Reconstruire

L'image a été construite **hors ligne** par `env/csp4/csp4-offline.sh`. Les conteneurs de build tournaient sur un réseau Docker interne, sans aucune sortie, et leur seule source était un miroir local de toutes les entrées : dépôts git, fichiers téléchargés, caches npm et pkg, arbre v8, instantané apt. Ce miroir n'est pas publié ici, car il contient surtout des copies de sources tierces. [`manifest-10.0.0-176-csp5.json`](manifest-10.0.0-176-csp5.json) en donne le contenu exact : URL d'origine, commit ou sha256 de chaque entrée.

Il faut Docker, environ 180 Go de disque et 12 Go de mémoire. Le build dure environ 2 h, v8 compris.

1. **Images d'outillage.**
   - Base : `ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac`, plus les paquets installés par `build_tools/tools/linux/deps.py`.
   - Une version épinglée de cette image se construit avec `env/phase2/builder/Dockerfile` : paquets aux versions exactes, depuis l'instantané Ubuntu `20261019T100000Z`.
   - On y ajoute la surcouche Node 22 avec `env/csp4/toolchain/Dockerfile`. Elle demande l'archive officielle `node-v22.23.4-linux-x64.tar.xz`, vérifiée par sha256, ainsi que `@yao-pkg/pkg@6.24.0` et `grunt-cli@1.5.0`.
   - Noms attendus par les scripts : `christien-builder-deps:9.4.0.129-node22`, `christien-builder:9.4.0.129-pinned-node22`, `christien-builder-deps:9.4.0.129` (pour le serveur miroir) et `christien-unpack:1` (`env/phase2/Dockerfile.unpack`).
2. **Miroir.** Une racine de travail `D` contenant `mirror/` :
   - `git/<hôte>/<chemin>.git` ;
   - `http/<hôte>/<chemin>` ;
   - `apt/20261024T000000Z/` ;
   - `caches/csp4/{npm,pkg-cache,cache}` ;
   - `trees/v8_89-synced.tar.zst`.

   Il faut aussi une autorité de certification locale `PKI_DIR` (`ca.crt`, `ca-bundle.crt` = bundle système + `ca.crt`, `mirror.crt` et `mirror.key` pour les noms de `env/phase2/mirror-hosts.txt`). Les scripts `env/csp4/csp4-online.sh` et `env/csp4/csp4-package.sh` montrent comment le miroir a été constitué : build en ligne, puis enregistrement apt depuis `snapshot.ubuntu.com`. `env/phase2/git-inventory.sh` et `env/phase2/mirror-git.sh` versent les dépôts consommés dans le miroir.
3. **Build** :

   ```sh
   D=/chemin/racine PKI_DIR=/chemin/pki env/csp4/csp4-offline.sh
   ```

   Il enchaîne :
   - clone, prélude d'`automate.py`, 13 dépôts au tag, patchs ;
   - `automate.py server --branding-name=christien` ;
   - minification, retrait, durcissement (`env/csp4/csp4-harden.sh`) ;
   - `make deb`, puis `docker build` du Dockerfile patché.

   Journaux : `D/logs/B*`. Chaque requête au miroir est journalisée, et une entrée absente du miroir apparaît en `MISS`.
4. **Manifeste** : `env/phase2/git-inventory.sh` sur l'espace de travail, puis `env/csp4/make_manifest.py`.

## Reproductibilité

Le 2026-10-24, cette image a été comparée à une construction indépendante des mêmes sources : un build en ligne, puis un rejeu hors ligne. Les 204 commits consommés sont identiques. Sur 31 624 fichiers, 21 diffèrent, tous connus pour n'être pas reproductibles à l'octet :
- les caches V8 `sdkjs/*/sdk-all.bin` ;
- les exécutables `pkg` (`docservice`, `converter`, `metrics`, `npm/json`) ;
- des fichiers propres à chaque installation : secret JWT aléatoire, `machine-id`, date du changelog, base dpkg, journaux.

Les pages des éditeurs sont identiques. Les empreintes CSP de leurs blocs `<script>` et `<style>` en ligne aussi.

## Limites connues

- L'`eval` des **macros** et `isValidJs` restent dans sdkjs. Sous une CSP stricte, ils échouent proprement. Les macros doivent être désactivées dans la configuration de l'éditeur.
- Node 22 est maintenu jusqu'en avril 2027.
- Le coût en temps de chargement d'asm.js par rapport à WebAssembly n'est pas mesuré.

## Licences

- Le code ONLYOFFICE et nos modifications sont sous **GNU AGPL v3** ([`LICENSE`](LICENSE)), avec les conditions additionnelles de l'article 7 figurant dans les en-têtes des sources ONLYOFFICE.
- [`LICENSES/`](LICENSES) contient les textes de licence livrés dans le paquet, inchangés : AGPL v3 et CC BY-SA 4.0.
