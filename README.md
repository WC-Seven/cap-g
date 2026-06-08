# Cap-G — Ferramenta de Captura e Anotação de Tela

Aplicação desktop em Electron para capturar a tela, anotar e censurar dados sensíveis — similar ao Lightshot.

---

## Ícones e logotipo

Coloque os arquivos na pasta `assets/` com exatamente estes nomes:

| Arquivo | Uso | Tamanho recomendado |
|---------|-----|---------------------|
| `icon.ico` | Ícone da janela e da barra de tarefas do Windows | ICO multi-tamanho: 16, 32, 48, 64, 128, 256 px |
| `tray.png` | Ícone da bandeja do sistema (canto inferior direito) | 32×32 px, fundo transparente |
| `logo.png` | Logotipo na barra de título do editor | 32×32 px, fundo transparente |

> Enquanto os arquivos não existirem, o app usa um ícone gerado programaticamente como fallback.
> Ferramentas como **icoconvert.com** ou **IcoFX** aceitam um PNG 256×256 e geram o `.ico` multi-tamanho.

---

## Requisitos

- Node.js 18+
- `npm install`

## Iniciar

```bash
npm start
```

---

## Funcionalidades

### Captura de tela

- O app fica rodando na **bandeja do sistema** (system tray).
- Pressione o atalho global ou clique no ícone da bandeja para iniciar uma captura.
- **Atalho global**: o app tenta registrar em ordem até encontrar um disponível:
  1. `PrintScreen`
  2. `Ctrl+PrintScreen`
  3. `Alt+PrintScreen`
  4. `Ctrl+Shift+S`
  > No Windows 11 o `PrintScreen` nativo é interceptado pelo Snipping Tool. O atalho registrado com sucesso é exibido no tooltip da bandeja.

### Seleção de região

Após pressionar o atalho, uma **tela de sobreposição** exibe um screenshot de toda a tela:

- **Arraste** para criar a seleção inicial.
- Após soltar o mouse, a seleção fica **ativa com 8 alças** (cantos + bordas):
  - **Arrastar uma alça** → redimensiona a área.
  - **Arrastar dentro da seleção** → move a área.
  - **Clicar fora da seleção** → descarta e começa uma nova.
- **Teclas de seta** → move a seleção 1 px; **Shift + seta** → move 10 px.
- Um indicador mostra as dimensões em pixels em tempo real (ex.: `1337 × 872`).
- `Enter` ou **duplo clique** dentro da seleção → confirma e abre o editor.
- `Esc` cancela e fecha o overlay.

---

## Editor de anotações

Após selecionar a região, o editor abre com a captura recortada.

### Ferramentas de desenho

| Tecla | Ferramenta | Descrição |
|-------|-----------|-----------|
| `P`   | Caneta    | Traço livre |
| `L`   | Linha     | Linha reta entre dois pontos |
| `A`   | Seta      | Linha com cabeça de seta preenchida |
| `R`   | Retângulo / Elipse | Forma geométrica (ver abaixo) |
| `B`   | Borrar    | Borrão para ocultar dados sensíveis |
| `T`   | Texto     | Caixa de texto multi-linha |
| `C`   | Recortar  | Recorta a área capturada (preserva anotações) |

**Cor e espessura** são configuráveis pela barra lateral direita antes de usar qualquer ferramenta.

### Retângulo e Elipse

- Clique no botão `R` para usar a forma ativa.
- **Clique direito** no botão → abre o seletor de forma para alternar entre **Retângulo** e **Elipse/Círculo**.
- O ícone do botão atualiza para refletir a forma ativa.

### Ferramenta de Borrar (blur)

Usada para ocultar dados sensíveis como CPF, senhas e informações pessoais:

- Arraste para selecionar a área a borrar.
- Aplica **gaussian blur suavizado** (3 passes de box blur, raio 6) misturado com branco — efeito de vidro fosco.
- A área borrada recebe uma borda vermelha para sinalizar censura.
- O borrão é permanente no canvas (pode ser desfeito com `Ctrl+Z` enquanto não salvar).

**Formas de blur** — **clique direito** no botão de borrar para alternar:

| Forma | Comportamento |
|-------|--------------|
| Retângulo (padrão) | Borrão retangular |
| Elipse / Círculo | Borrão em forma oval com clip path |

### Ferramenta de Texto

- **Clique** em qualquer ponto do canvas para criar uma caixa de texto.
- **Enter** ou **Ctrl+Enter** / **Shift+Enter** — inserem uma nova linha.
- **Botão ✓** — confirma e trava o texto (o texto fica sobreposto ao canvas, mas ainda editável).
- **Esc** — confirma se houver conteúdo, ou descarta a caixa se estiver vazia.

**Após confirmar o texto** (estado travado):

- **Arrastar** a caixa para reposicioná-la.
- **Clique direito** sobre o texto → menu de contexto:
  - ✏️ **Editar texto** — reabre o modo de edição.
  - 🗑️ **Deletar texto** — remove o texto.
- O cursor vira `✋` ao passar sobre um texto confirmado com a ferramenta Texto ativa.
- O texto só é "queimado" no canvas ao salvar ou copiar.

### Desfazer

- `Ctrl+Z` — desfaz o último traço ou forma desenhada (até 40 passos).
- O histórico não abrange movimentação de caixas de texto.

---

## Atalhos globais do editor

| Atalho | Ação |
|--------|------|
| `C` | Ativar ferramenta de recorte |
| `Ctrl+S` | Salvar como PNG |
| `Ctrl+C` | Copiar para área de transferência |
| `Esc` | Fechar o editor |
| `Ctrl+Z` | Desfazer |
| `Ctrl+Shift+Z` | Refazer |
| `P` `L` `A` `R` `B` `T` | Ativar ferramentas |

---

## Reselecionar área (Ampliar / Reduzir)

O botão **⤢ Reselecionar** (barra inferior) abre um overlay com o **screenshot original completo** em escala.

- A região capturada atual é mostrada pré-selecionada com alças.
- Arraste as alças para **ampliar** (incluir mais área) ou **reduzir**.
- Mova arrastando dentro da seleção; nova seleção clicando fora.
- **Enter** ou duplo clique → aplica: o novo fundo vem do screenshot original e as anotações já feitas são preservadas na posição correta.
- **Esc** → cancela sem alterar nada.

> Diferente da ferramenta ✂ Recortar (que opera apenas sobre o canvas atual), o Reselecionar acessa o screenshot completo armazenado em memória — permitindo expandir além dos limites da captura original.

---

## Salvar / Copiar / Fechar

- **💾 Salvar** (`Ctrl+S`) — abre diálogo para salvar como `.png`.
- **📋 Copiar** (`Ctrl+C`) — copia a imagem anotada para a área de transferência.
- **✕ Fechar** (`Esc`) — fecha o editor sem salvar.

> Ao salvar ou copiar, todos os textos pendentes são automaticamente "queimados" no canvas antes da exportação.

---

## Estrutura do projeto

```
cap-g/
├── main.js              # Processo principal Electron (tray, shortcuts, IPC)
├── preload.js           # Bridge segura entre renderer e main (contextBridge)
├── package.json
└── src/
    ├── overlay/
    │   ├── overlay.html
    │   └── overlay.js   # Tela de seleção de região
    └── editor/
        ├── editor.html
        ├── editor.css
        └── editor.js    # Editor de anotações
```

---

## Notas técnicas

- `transparent: true` causa crash no GPU process no Windows 11 — o overlay usa `backgroundColor: '#000'` + `show: false` com delay de 80ms para evitar flash.
- O screenshot é capturado em resolução física (HiDPI) e redimensionado para resolução lógica antes de enviar via IPC, evitando mensagens excessivamente grandes.
- O recorte final multiplica as coordenadas pelo `scaleFactor` do display para manter precisão em telas HiDPI.
