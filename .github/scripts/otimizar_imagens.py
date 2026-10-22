"""Otimiza as imagens da loja: converte para WebP no tamanho certo e atualiza os endereços.

Roda sozinho no GitHub (workflow otimizar-imagens.yml) sempre que uma imagem nova
entra pelo painel /admin. Também pode ser rodado à mão: python .github/scripts/otimizar_imagens.py

- Banner do computador: até 1920 px de largura
- Banner do celular: até 1080 px
- Fotos de produto: até 1000 px
- WebP grandes demais (largura acima do limite ou mais de 400 KB) são reduzidos no lugar
- logo.png não é mexido (é usado direto nas páginas)
"""
import json
import os
import re
import sys

from PIL import Image

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
os.chdir(RAIZ)

ARQUIVOS_DADOS = ["data/loja.json", "data/produtos.json"]
IGNORAR = {"/img/logo.png"}
EXTENSOES = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".avif"}
LIMITE_WEBP = 400 * 1024


def largura_maxima(caminho, loja):
    for k, v in loja.items():
        if v != caminho or not k.startswith("banner_"):
            continue
        return (1080, 78) if k.endswith("_celular") else (1920, 78)
    return 1000, 82


def abrir(arquivo):
    im = Image.open(arquivo)
    alfa = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    return im.convert("RGBA" if alfa else "RGB")


def reduzir(im, maxw):
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    return im


def destino_livre(base, ext):
    dst = base + ".webp"
    if os.path.exists(dst):
        dst = f"{base}-{ext.lstrip('.')}.webp"
    n = 2
    while os.path.exists(dst):
        dst = f"{base}-{n}.webp"
        n += 1
    return dst


def main():
    loja = json.load(open("data/loja.json", encoding="utf-8"))
    textos = {f: open(f, encoding="utf-8").read() for f in ARQUIVOS_DADOS}
    usados = sorted({r for t in textos.values() for r in re.findall(r'"(/img/[^"]+)"', t)} - IGNORAR)

    trocas, mudou = {}, False
    for ref in usados:
        arq = ref.lstrip("/")
        if not os.path.exists(arq):
            print(f"aviso: {ref} não existe, pulando")
            continue
        base, ext = os.path.splitext(arq)
        maxw, q = largura_maxima(ref, loja)
        if ext.lower() == ".webp":
            with Image.open(arq) as im0:
                grande = im0.width > maxw or os.path.getsize(arq) > LIMITE_WEBP
            if grande:
                antes = os.path.getsize(arq)
                reduzir(abrir(arq), maxw).save(arq, "WEBP", quality=q, method=6)
                print(f"{ref}: {antes // 1024} KB -> {os.path.getsize(arq) // 1024} KB")
                mudou = True
            continue
        if ext.lower() not in EXTENSOES:
            continue
        try:
            im = reduzir(abrir(arq), maxw)
        except Exception as e:
            print(f"aviso: não consegui abrir {ref}: {e}")
            continue
        dst = destino_livre(base, ext)
        im.save(dst, "WEBP", quality=q, method=6)
        print(f"{ref}: {os.path.getsize(arq) // 1024} KB -> /{dst} {os.path.getsize(dst) // 1024} KB")
        trocas[ref] = "/" + dst

    for f, t in textos.items():
        novo = t
        for a, b in trocas.items():
            novo = novo.replace(f'"{a}"', f'"{b}"')
        if novo != t:
            json.loads(novo)  # garante que o JSON continua válido
            open(f, "w", encoding="utf-8").write(novo)

    # só apaga o original depois que nenhum arquivo de dados aponta mais para ele
    restantes = "".join(open(f, encoding="utf-8").read() for f in ARQUIVOS_DADOS)
    for a in trocas:
        if f'"{a}"' not in restantes:
            os.remove(a.lstrip("/"))

    if not trocas and not mudou:
        print("Nada para otimizar.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
